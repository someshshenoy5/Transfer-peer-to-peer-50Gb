import { useEffect, useRef, useCallback, useState } from "react";
import { io } from "socket.io-client";

const CHUNK_SIZE    = 64 * 1024;
const BUFFER_HIGH   = 8 * 1024 * 1024;
const UPDATE_INTERVAL = 200;

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

export function useWebRTC({ onTransferUpdate }) {
  const socketRef   = useRef(null);
  const peersRef    = useRef({});
  const receiveRef  = useRef({});
  const onUpdateRef = useRef(onTransferUpdate);
  // pendingRef: peerId -> resolve fn (called with true/false when user decides)
  const pendingRef  = useRef({});

  const [peers, setPeers] = useState([]);
  const [myId,  setMyId ] = useState(null);

  useEffect(() => { onUpdateRef.current = onTransferUpdate; }, [onTransferUpdate]);

  // ── socket ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    // const socket = io("http://localhost:3001");
    const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on("connect", () => { console.log("Socket connected:", socket.id); setMyId(socket.id); });
    socket.on("peer-joined", ({ peerId }) => { console.log("Peer joined:", peerId); createPC(peerId, true); });
    socket.on("peer-left",   ({ peerId }) => { closePC(peerId); setPeers(p => p.filter(id => id !== peerId)); });

    socket.on("signal", async ({ from, data }) => {
      let entry = peersRef.current[from];
      if (!entry) entry = createPC(from, false);
      const { pc } = entry;
      if (data.type === "offer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("signal", { to: from, data: answer });
      } else if (data.type === "answer") {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
      } else if (data.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
      }
    });

    return () => socket.disconnect();
  }, []); // eslint-disable-line

  // ── peer connection ─────────────────────────────────────────────────────────
  function createPC(peerId, isInitiator) {
    const pc = new RTCPeerConnection(ICE_SERVERS);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socketRef.current?.emit("signal", { to: peerId, data: candidate });
    };
    pc.onconnectionstatechange = () => {
      console.log(`PC ${peerId}:`, pc.connectionState);
      if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        closePC(peerId);
        setPeers(p => p.filter(id => id !== peerId));
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel("filedrop", { ordered: true });
      wireChannel(dc, peerId);
      peersRef.current[peerId] = { pc, dc };
      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socketRef.current?.emit("signal", { to: peerId, data: offer });
      });
    } else {
      peersRef.current[peerId] = { pc, dc: null };
      pc.ondatachannel = ({ channel }) => {
        wireChannel(channel, peerId);
        peersRef.current[peerId].dc = channel;
      };
    }

    setPeers(p => p.includes(peerId) ? p : [...p, peerId]);
    return peersRef.current[peerId];
  }

  // ── data channel wire ───────────────────────────────────────────────────────
  function wireChannel(dc, peerId) {
    dc.binaryType = "arraybuffer";
    dc.bufferedAmountLowThreshold = 512 * 1024;
    dc.onopen  = () => console.log("DataChannel OPEN with", peerId);
    dc.onerror = (e) => console.error("DataChannel error", e);

    dc.onmessage = ({ data }) => {
      // ── control messages (JSON strings) ──────────────────────────────────
      if (typeof data === "string") {
        const msg = JSON.parse(data);

        // Sender → Receiver: file request
        if (msg.type === "file-request") {
          // Show accept/reject prompt; stash a resolve function
          onUpdateRef.current?.({
            peerId,
            fileName : msg.name,
            fileSize : msg.size,
            fileType : msg.fileType,
            transferred: 0,
            speed    : 0,
            status   : "pending",   // <-- new status
          });
          // Create a promise the UI resolves via respondToRequest()
          pendingRef.current[peerId] = msg;
          return;
        }

        // Receiver → Sender: accepted
        if (msg.type === "file-accepted") {
          const resolve = pendingRef.current[`send-${peerId}`];
          if (resolve) { resolve(true); delete pendingRef.current[`send-${peerId}`]; }
          return;
        }

        // Receiver → Sender: rejected
        if (msg.type === "file-rejected") {
          const resolve = pendingRef.current[`send-${peerId}`];
          if (resolve) { resolve(false); delete pendingRef.current[`send-${peerId}`]; }
          onUpdateRef.current?.({
            peerId,
            fileName : msg.name,
            fileSize : 0,
            transferred: 0,
            speed    : 0,
            status   : "rejected",
          });
          return;
        }

        return;
      }

      // ── binary chunk ──────────────────────────────────────────────────────
      const s = receiveRef.current[peerId];
      if (!s) return;

      s.chunks.push(data);
      s.received += data.byteLength;

      const now = Date.now();
      if (now - s.lastUpdate > UPDATE_INTERVAL || s.received >= s.meta.size) {
        const dt    = (now - s.lastTime) / 1000;
        const speed = dt > 0 ? (s.received - s.lastBytes) / dt : 0;
        s.lastUpdate = now; s.lastBytes = s.received; s.lastTime = now;

        if (s.received >= s.meta.size) {
          const blob = new Blob(s.chunks, { type: s.meta.fileType });
          const url  = URL.createObjectURL(blob);
          onUpdateRef.current?.({
            peerId, fileName: s.meta.name, fileSize: s.meta.size,
            transferred: s.received, speed: 0, status: "done", url,
          });
          delete receiveRef.current[peerId];
        } else {
          onUpdateRef.current?.({
            peerId, fileName: s.meta.name, fileSize: s.meta.size,
            transferred: s.received, speed, status: "receiving",
          });
        }
      }
    };
  }

  // ── called by UI when user accepts or rejects a pending file ───────────────
  const respondToRequest = useCallback((peerId, accepted) => {
    const meta = pendingRef.current[peerId];
    if (!meta) return;
    delete pendingRef.current[peerId];

    const { dc } = peersRef.current[peerId] || {};
    if (!dc || dc.readyState !== "open") return;

    if (accepted) {
      // Prepare receive buffer
      receiveRef.current[peerId] = {
        meta, chunks: [], received: 0,
        lastUpdate: 0, lastBytes: 0, lastTime: Date.now(),
      };
      dc.send(JSON.stringify({ type: "file-accepted" }));
      onUpdateRef.current?.({
        peerId, fileName: meta.name, fileSize: meta.size,
        transferred: 0, speed: 0, status: "receiving",
      });
    } else {
      dc.send(JSON.stringify({ type: "file-rejected", name: meta.name }));
      onUpdateRef.current?.({
        peerId, fileName: meta.name, fileSize: meta.size,
        transferred: 0, speed: 0, status: "declined",
      });
    }
  }, []);

  // ── send file ────────────────────────────────────────────────────────────────
  const sendFile = useCallback(async (file, targetPeerId = null) => {
    const targets = targetPeerId
      ? [targetPeerId]
      : Object.keys(peersRef.current);

    for (const peerId of targets) {
      const { dc } = peersRef.current[peerId] || {};
      if (!dc || dc.readyState !== "open") {
        console.warn("DataChannel not open for", peerId, dc?.readyState);
        continue;
      }

      // 1. Send request and wait for accept/reject
      dc.send(JSON.stringify({
        type: "file-request",
        name: file.name,
        size: file.size,
        fileType: file.type,
      }));

      onUpdateRef.current?.({
        peerId, fileName: file.name, fileSize: file.size,
        transferred: 0, speed: 0, status: "requesting",
      });

      const accepted = await new Promise(resolve => {
        pendingRef.current[`send-${peerId}`] = resolve;
      });

      if (!accepted) {
        onUpdateRef.current?.({
          peerId, fileName: file.name, fileSize: file.size,
          transferred: 0, speed: 0, status: "rejected",
        });
        continue;
      }

      // 2. Receiver accepted — stream chunks
      let offset = 0, lastUpdate = 0, lastBytes = 0, lastTime = Date.now();

      onUpdateRef.current?.({
        peerId, fileName: file.name, fileSize: file.size,
        transferred: 0, speed: 0, status: "sending",
      });

      while (offset < file.size) {
        if (dc.bufferedAmount > BUFFER_HIGH) {
          await new Promise(r => { dc.onbufferedamountlow = r; });
        }
        const slice  = file.slice(offset, offset + CHUNK_SIZE);
        const buffer = await slice.arrayBuffer();
        dc.send(buffer);
        offset += buffer.byteLength;

        const now = Date.now();
        if (now - lastUpdate > UPDATE_INTERVAL) {
          const dt    = (now - lastTime) / 1000;
          const speed = dt > 0 ? (offset - lastBytes) / dt : 0;
          lastUpdate = now; lastBytes = offset; lastTime = now;
          onUpdateRef.current?.({
            peerId, fileName: file.name, fileSize: file.size,
            transferred: offset, speed, status: "sending",
          });
        }
      }

      onUpdateRef.current?.({
        peerId, fileName: file.name, fileSize: file.size,
        transferred: file.size, speed: 0, status: "done",
      });
    }
  }, []);

  function closePC(peerId) {
    const e = peersRef.current[peerId];
    if (e) { e.dc?.close(); e.pc?.close(); delete peersRef.current[peerId]; }
  }

  const createRoom = roomId =>
    new Promise((res, rej) =>
      socketRef.current?.emit("create-room", roomId, r =>
        r.error ? rej(r.error) : res(r)));

  const joinRoom = roomId =>
    new Promise((res, rej) =>
      socketRef.current?.emit("join-room", roomId, r => {
        if (r.error) return rej(r.error);
        r.peers.forEach(pid => createPC(pid, true));
        res(r);
      }));

  return { myId, peers, createRoom, joinRoom, sendFile, respondToRequest };
}

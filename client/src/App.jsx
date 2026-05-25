import { useState, useCallback, useRef } from "react";
import { useWebRTC } from "./hooks/useWebRTC";
import "./index.css";

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024, sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function formatSpeed(bps) { return formatBytes(bps) + "/s"; }
function formatETA(remaining, speed) {
  if (!speed) return "";
  const s = Math.round(remaining / speed);
  if (s < 60) return `${s}s left`;
  if (s < 3600) return `${Math.round(s / 60)}m left`;
  return `${(s / 3600).toFixed(1)}h left`;
}

// ── File type icon ─────────────────────────────────────────────────────────
function fileIcon(name = "") {
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) return "🖼";
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "🎬";
  if (["mp3","wav","flac","aac","ogg"].includes(ext)) return "🎵";
  if (["zip","rar","7z","tar","gz"].includes(ext)) return "📦";
  if (["pdf"].includes(ext)) return "📄";
  if (["doc","docx","txt","md"].includes(ext)) return "📝";
  if (["xls","xlsx","csv"].includes(ext)) return "📊";
  return "📁";
}

// ── Incoming file request dialog ───────────────────────────────────────────
function IncomingRequest({ transfer, onAccept, onDecline }) {
  return (
    <div className="request-card">
      <div className="request-icon">{fileIcon(transfer.fileName)}</div>
      <div className="request-info">
        <div className="request-title">Incoming file</div>
        <div className="request-name">{transfer.fileName}</div>
        <div className="request-size">{formatBytes(transfer.fileSize)}</div>
      </div>
      
      <div className="request-actions">
        <button className="btn-accept" onClick={onAccept}>Accept</button>
        <button className="btn-decline" onClick={onDecline}>Decline</button>
      </div>
    </div>
  );
}

export default function App() {
  const [screen,    setScreen   ] = useState("lobby");
  const [roomInput, setRoomInput] = useState("");
  const [roomId,    setRoomId   ] = useState("");
  const [error,     setError    ] = useState("");
  const [transfers, setTransfers] = useState({});
  const [dragging,  setDragging ] = useState(false);
  const [copied,    setCopied   ] = useState(false);
  const fileInputRef = useRef();

  const onTransferUpdate = useCallback((update) => {
    const key = `${update.peerId}__${update.fileName}`;
    setTransfers(prev => ({ ...prev, [key]: { ...prev[key], ...update } }));
  }, []);

  const { myId, peers, createRoom, joinRoom, sendFile, respondToRequest } =
    useWebRTC({ onTransferUpdate });

  const genCode   = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  const handleCreate = async () => {
    const id = roomInput.trim().toUpperCase() || genCode();
    try { await createRoom(id); setRoomId(id); setScreen("room"); setError(""); }
    catch (e) { setError(typeof e === "string" ? e : "Could not create room"); }
  };

  const handleJoin = async () => {
    const id = roomInput.trim().toUpperCase();
    if (!id) return setError("Enter a room code first");
    try { await joinRoom(id); setRoomId(id); setScreen("room"); setError(""); }
    catch (e) { setError(typeof e === "string" ? e : "Room not found"); }
  };

  const handleFiles = (files) => [...files].forEach(f => sendFile(f));

  const copyCode = () => {
    navigator.clipboard.writeText(roomId);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const allTransfers  = Object.values(transfers);
  const pendingList   = allTransfers.filter(t => t.status === "pending");
  const transferList  = allTransfers.filter(t => t.status !== "pending");
  const hasActive     = transferList.some(t => !["done","rejected","declined"].includes(t.status));

  // ── LOBBY ──────────────────────────────────────────────────────────────────
  if (screen === "lobby") {
    return (
      <div className="page">
        <div className="lobby-card">
          <div className="logo">
            <span className="logo-icon">⬡</span>
            <span className="logo-text">FileDrop</span>
          </div>
          <p className="tagline">Direct browser-to-browser file transfer.<br/>No servers. No size limits.</p>

          <div className="input-group">
            <input
              className="room-input"
              placeholder="Room code (blank = auto-generate)"
              value={roomInput}
              onChange={e => setRoomInput(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && handleJoin()}
              maxLength={8} spellCheck={false}
            />
            {error && <p className="error">⚠ {error}</p>}
          </div>

          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleCreate}>Create room</button>
            <button className="btn btn-ghost"   onClick={handleJoin  }>Join room</button>
          </div>

          <div className="features">
            <div className="feat"><span>🔒</span><span>End-to-end encrypted via WebRTC</span></div>
            <div className="feat"><span>⚡</span><span>Direct P2P — no relay, full speed</span></div>
            <div className="feat"><span>✋</span><span>Receiver approves every file</span></div>
          </div>
        </div>
      </div>
    );
  }

  // ── ROOM ───────────────────────────────────────────────────────────────────
  return (
    <div className="page">
      <div className="room-layout">

        {/* Header */}
        <header className="room-header">
          <div className="logo small">
            <span className="logo-icon">⬡</span>
            <span className="logo-text">FileDrop</span>
          </div>
          <div className="room-badge">
            <span className="room-label">Room</span>
            <span className="room-code">{roomId}</span>
            <button className="copy-btn" onClick={copyCode}>{copied ? "✓" : "⎘"}</button>
          </div>
          {hasActive && <span className="pulse-dot" title="Transfer in progress" />}
          <button className="btn btn-ghost small"
            onClick={() => { setScreen("lobby"); setRoomInput(""); setTransfers({}); }}>
            Leave
          </button>
        </header>

        <div className="room-body">

          {/* Sidebar */}
          <aside className="sidebar">
            <div className="sidebar-title">
              Connected <span className="peer-count">{peers.length + 1}</span>
            </div>
            <div className="peer-item you">
              <span className="peer-dot online" />
              <span className="peer-name">You</span>
              <span className="peer-id">{myId?.slice(0, 6) ?? "…"}</span>
            </div>
            {peers.length === 0 ? (
              <div className="waiting">
                <div className="waiting-spinner" />
                <p>Share the code<br/><strong>{roomId}</strong><br/>to invite peers</p>
              </div>
            ) : peers.map(pid => (
              <div className="peer-item" key={pid}>
                <span className="peer-dot online" />
                <span className="peer-name">Peer</span>
                <span className="peer-id">{pid.slice(0, 6)}</span>
              </div>
            ))}
          </aside>

          {/* Main */}
          <main className="main-area">

            {/* ── Pending incoming requests (shown at top) ── */}
            {pendingList.map(t => {
              const key = `${t.peerId}__${t.fileName}`;
              return (
                <IncomingRequest
                  key={key}
                  transfer={t}
                  onAccept  ={() => respondToRequest(t.peerId, true )}
                  onDecline ={() => respondToRequest(t.peerId, false)}
                />
              );
            })}

            {/* ── Drop zone ── */}
            <div
              className={`dropzone ${dragging ? "dragging" : ""} ${peers.length === 0 ? "disabled" : ""}`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => peers.length > 0 && fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" multiple
                style={{ display: "none" }}
                onChange={e => handleFiles(e.target.files)} />
              <div className={`drop-icon ${dragging ? "bounce" : ""}`}>
                {peers.length === 0 ? "⏳" : "⬆"}
              </div>
              <div className="drop-text">
                {peers.length === 0 ? "Waiting for peers to connect…"
                  : dragging ? "Release to send!" : "Drop files here or click to select"}
              </div>
              {peers.length > 0 && (
                <div className="drop-hint">
                  Peer will be asked to accept · any size supported
                </div>
              )}
            </div>

            {/* ── Transfer list ── */}
            {transferList.length > 0 && (
              <div className="transfers">
                <div className="transfers-title">Transfers</div>
                {transferList.map(t => {
                  const key  = `${t.peerId}__${t.fileName}`;
                  const pct  = t.fileSize > 0 ? Math.min(100, (t.transferred / t.fileSize) * 100) : 0;
                  const done = t.status === "done";
                  const bad  = t.status === "rejected" || t.status === "declined";
                  const waiting = t.status === "requesting";

                  return (
                    <div className={`transfer-item ${done ? "is-done" : ""} ${bad ? "is-bad" : ""}`} key={key}>
                      <div className="transfer-top">
                        <span className="transfer-file-icon">{fileIcon(t.fileName)}</span>
                        <span className="transfer-name" title={t.fileName}>{t.fileName}</span>
                        <span className={`transfer-status status-${t.status}`}>
                          { done    ? "✓ done"
                          : bad     ? "✗ declined"
                          : waiting ? "⏳ waiting…"
                          : t.status === "sending"   ? "↑ sending"
                          : "↓ receiving" }
                        </span>
                      </div>

                      {!bad && (
                        <div className="progress-track">
                          <div className={`progress-fill ${done ? "fill-done" : waiting ? "fill-wait" : "fill-active"}`}
                            style={{ width: `${waiting ? 100 : pct}%` }} />
                        </div>
                      )}

                      {!bad && !waiting && (
                        <div className="transfer-bottom">
                          <span className="transfer-bytes">
                            {formatBytes(t.transferred)}
                            <span className="transfer-sep"> / </span>
                            {formatBytes(t.fileSize)}
                          </span>
                          {!done && t.speed > 0 && <span className="transfer-speed">{formatSpeed(t.speed)}</span>}
                          {!done && t.speed > 0 && <span className="transfer-eta">{formatETA(t.fileSize - t.transferred, t.speed)}</span>}
                          <span className="transfer-pct">{pct.toFixed(1)}%</span>
                          {done && t.url && (
                            <a className="dl-link" href={t.url} download={t.fileName}>↓ Save file</a>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

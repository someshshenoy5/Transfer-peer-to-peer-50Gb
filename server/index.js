const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
});

// rooms: { roomId: Set<socketId> }
const rooms = {};

io.on("connection", (socket) => {
  console.log("connected:", socket.id);

  socket.on("create-room", (roomId, cb) => {
    if (rooms[roomId]) return cb({ error: "Room already exists" });
    rooms[roomId] = new Set([socket.id]);
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`Room created: ${roomId}`);
    cb({ success: true, peers: [] });
  });

  socket.on("join-room", (roomId, cb) => {
    if (!rooms[roomId]) return cb({ error: "Room not found" });
    const peers = [...rooms[roomId]];
    rooms[roomId].add(socket.id);
    socket.join(roomId);
    socket.roomId = roomId;
    console.log(`${socket.id} joined room: ${roomId}`);
    // tell existing peers about new joiner
    peers.forEach((peerId) => {
      io.to(peerId).emit("peer-joined", { peerId: socket.id });
    });
    cb({ success: true, peers });
  });

  socket.on("signal", ({ to, data }) => {
    io.to(to).emit("signal", { from: socket.id, data });
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (roomId && rooms[roomId]) {
      rooms[roomId].delete(socket.id);
      if (rooms[roomId].size === 0) delete rooms[roomId];
      socket.to(roomId).emit("peer-left", { peerId: socket.id });
    }
    console.log("disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Signaling server running on port ${PORT}`));

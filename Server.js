
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

// Frontend HTML, CSS, JavaScript serve करना
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function createRoomCode() {
  let code;

  do {
    code = Math.floor(
      100000 + Math.random() * 900000
    ).toString();
  } while (rooms.has(code));

  return code;
}

// Server Status
app.get("/api/status", (req, res) => {
  res.json({
    message: "Blind People Free Fire Server Online",
    totalRooms: rooms.size,
    totalPlayers: io.engine.clientsCount
  });
});

// Socket.IO Connection
io.on("connection", (socket) => {

  socket.emit(
    "serverMessage",
    "Welcome to Blind People Free Fire"
  );

  // Create Room
  socket.on("createRoom", (data = {}, callback) => {

    const reply =
      typeof callback === "function"
        ? callback
        : () => {};

    const maxPlayers = Math.max(
      2,
      Math.min(30, Number(data.maxPlayers) || 2)
    );

    const code = createRoomCode();

    const room = {
      code,
      host: socket.id,
      maxPlayers,
      privateRoom: Boolean(data.privateRoom),
      password: data.password || "",
      players: new Map()
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: data.playerName || "Player"
    });

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;

    reply({
      success: true,
      message: "Room created successfully",
      roomCode: code,
      maxPlayers
    });

    io.to(code).emit("roomUpdate", {
      roomCode: code,
      players: Array.from(room.players.values()),
      maxPlayers
    });
  });

  // Join Room
  socket.on("joinRoom", (data = {}, callback) => {

    const reply =
      typeof callback === "function"
        ? callback
        : () => {};

    const room = rooms.get(
      String(data.roomCode || "")
    );

    if (!room) {
      return reply({
        success: false,
        message: "Room not found"
      });
    }

    if (
      room.privateRoom &&
      room.password !== (data.password || "")
    ) {
      return reply({
        success: false,
        message: "Incorrect password"
      });
    }

    if (room.players.size >= room.maxPlayers) {
      return reply({
        success: false,
        message: "Room is full"
      });
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: data.playerName || "Player"
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;

    reply({
      success: true,
      message: "Joined room successfully",
      roomCode: room.code
    });

    io.to(room.code).emit("roomUpdate", {
      roomCode: room.code,
      players: Array.from(room.players.values()),
      maxPlayers: room.maxPlayers
    });
  });

  // Quick Match
  socket.on("quickMatch", (data = {}, callback) => {

    const reply =
      typeof callback === "function"
        ? callback
        : () => {};

    const room = Array.from(rooms.values()).find(
      (r) =>
        !r.privateRoom &&
        r.players.size < r.maxPlayers
    );

    if (!room) {
      return reply({
        success: false,
        message: "No public room available"
      });
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: data.playerName || "Player"
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;

    reply({
      success: true,
      message: "Quick match joined",
      roomCode: room.code
    });

    io.to(room.code).emit("roomUpdate", {
      roomCode: room.code,
      players: Array.from(room.players.values()),
      maxPlayers: room.maxPlayers
    });
  });

  // Leave Room
  socket.on("leaveRoom", () => {
    leaveRoom(socket);
  });

  // Disconnect
  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

// Leave Room Function
function leaveRoom(socket) {

  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(code);

  delete socket.data.roomCode;

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  io.to(code).emit("roomUpdate", {
    roomCode: code,
    players: Array.from(room.players.values()),
    maxPlayers: room.maxPlayers
  });
}

// Start Server
server.listen(PORT, "0.0.0.0", () => {
  console.log(
    "Blind People Free Fire Server running on port " +
    PORT
  );
});

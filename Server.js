const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.json());

const PORT = process.env.PORT || 3000;

const players = new Map();
const rooms = new Map();

const ROOM_CAPACITIES = [
  2, 4, 8, 10, 16, 20, 25, 30
];

const ALLOWED_ACTIONS = new Set([
  "move",
  "turn",
  "fire",
  "reload",
  "jump",
  "medkit",
  "ready"
]);

function createPlayerId() {
  return "BPF-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function createRoomId() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function getPlayerRoom(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) {
      return room;
    }
  }
  return null;
}

function publicPlayer(player) {
  return {
    playerId: player.playerId,
    name: player.name,
    online: true
  };
}

function roomInfo(room) {
  return {
    roomId: room.roomId,
    roomName: room.roomName,
    roomType: room.roomType,
    capacity: room.capacity,
    playerCount: room.players.size,
    players: Array.from(room.players.values()).map(publicPlayer)
  };
}

function leaveRoom(socket, notify = true) {
  const room = getPlayerRoom(socket.id);

  if (!room) return;

  room.players.delete(socket.id);
  socket.leave(room.roomId);

  if (notify) {
    io.to(room.roomId).emit("room:player-left", {
      playerId: players.get(socket.id)?.playerId,
      room: roomInfo(room)
    });
  }

  if (room.players.size === 0) {
    rooms.delete(room.roomId);
  } else {
    io.to(room.roomId).emit("room:updated", roomInfo(room));
  }
}

// Server status
app.get("/", (req, res) => {
  res.json({
    game: "Blind People Free Fire",
    status: "Online",
    message: "Multiplayer server is running"
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    playersOnline: players.size,
    activeRooms: rooms.size
  });
});

// Socket connections
io.on("connection", (socket) => {
  const player = {
    playerId: createPlayerId(),
    name: "Player",
    socketId: socket.id
  };

  players.set(socket.id, player);

  socket.emit("player:connected", {
    playerId: player.playerId,
    message: "Connected to Blind People Free Fire server"
  });

  io.emit("players:online", players.size);

  // Set player name
  socket.on("player:set-name", (name) => {
    if (typeof name !== "string") return;

    const cleanName = name.trim().slice(0, 20);

    if (!cleanName) return;

    player.name = cleanName;

    socket.emit("player:name-updated", {
      name: player.name
    });
  });

  // Get online players
  socket.on("players:get-online", () => {
    const onlinePlayers = Array.from(players.values())
      .filter((p) => p.socketId !== socket.id)
      .map(publicPlayer);

    socket.emit("players:online-list", onlinePlayers);
  });

  // Friend request
  socket.on("friend:request", (targetPlayerId) => {
    if (typeof targetPlayerId !== "string") return;

    const target = Array.from(players.values()).find(
      (p) => p.playerId === targetPlayerId
    );

    if (!target || target.socketId === socket.id) {
      socket.emit("friend:request-result", {
        success: false,
        message: "Player not found"
      });
      return;
    }

    io.to(target.socketId).emit("friend:request-received", {
      playerId: player.playerId,
      name: player.name
    });

    socket.emit("friend:request-result", {
      success: true,
      message: "Friend request sent"
    });
  });

  // Create room
  socket.on("room:create", (data = {}) => {
    leaveRoom(socket);

    const capacity = Number(data.capacity || 4);

    if (!ROOM_CAPACITIES.includes(capacity)) {
      socket.emit("room:error", {
        message: "Invalid room capacity"
      });
      return;
    }

    const roomType =
      data.roomType === "private" ? "private" : "public";

    let roomId;

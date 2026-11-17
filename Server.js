
const express = require("express");
const http = require("http");
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

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

function createRoomCode() {
  let code;
  do {
    code = Math.floor(100000 + Math.random() * 900000).toString();
  } while (rooms.has(code));
  return code;
}

function cleanPlayerName(value) {
  if (typeof value !== "string") return "Player";
  return value.trim().slice(0, 24) || "Player";
}

function roomUpdate(room) {
  return {
    roomCode: room.code,
    players: Array.from(room.players.values()),
    maxPlayers: room.maxPlayers
  };
}

function sendRoomUpdate(room) {
  io.to(room.code).emit("roomUpdate", roomUpdate(room));
}

function leaveRoom(socket) {
  const code = socket.data.roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) {
    delete socket.data.roomCode;
    return;
  }

  room.players.delete(socket.id);
  socket.leave(code);
  delete socket.data.roomCode;

  if (room.players.size === 0) {
    rooms.delete(code);
    return;
  }

  if (room.host === socket.id) {
    room.host = room.players.keys().next().value;
  }

  sendRoomUpdate(room);
}

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Blind Fire Game Server Online",
    status: "online",
    totalRooms: rooms.size,
    totalPlayers: io.engine.clientsCount
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    status: "online",
    totalRooms: rooms.size,
    totalPlayers: io.engine.clientsCount
  });
});

io.on("connection", (socket) => {
  socket.emit("serverMessage", "Welcome to Blind Fire Game Server");

  socket.on("createRoom", (data = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!data || typeof data !== "object") data = {};

    leaveRoom(socket);

    const requestedPlayers = Number(data.maxPlayers) || 2;
    const maxPlayers = Math.max(2, Math.min(30, requestedPlayers));
    const code = createRoomCode();

    const room = {
      code,
      host: socket.id,
      maxPlayers,
      privateRoom: Boolean(data.privateRoom),
      password: typeof data.password === "string" ? data.password : "",
      players: new Map()
    };

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanPlayerName(data.playerName)
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

    sendRoomUpdate(room);
  });

  socket.on("joinRoom", (data = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!data || typeof data !== "object") data = {};

    const code = String(data.roomCode || "").trim();
    const room = rooms.get(code);

    if (!room) {
      reply({ success: false, message: "Room not found" });
      return;
    }

    if (room.privateRoom && room.password !== (data.password || "")) {
      reply({ success: false, message: "Incorrect password" });
      return;
    }

    if (socket.data.roomCode === room.code && room.players.has(socket.id)) {
      reply({
        success: true,
        message: "Already in this room",
        roomCode: room.code
      });
      return;
    }

    if (room.players.size >= room.maxPlayers) {
      reply({ success: false, message: "Room is full" });
      return;
    }

    leaveRoom(socket);

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanPlayerName(data.playerName)
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;

    reply({
      success: true,
      message: "Joined room successfully",
      roomCode: room.code
    });

    sendRoomUpdate(room);
  });

  socket.on("quickMatch", (data = {}, callback) => {
    const reply = typeof callback === "function" ? callback : () => {};
    if (!data || typeof data !== "object") data = {};

    const room = Array.from(rooms.values()).find(
      item => !item.privateRoom && item.players.size < item.maxPlayers
    );

    if (!room) {
      reply({
        success: false,
        message: "No public room available"
      });
      return;
    }

    if (socket.data.roomCode === room.code && room.players.has(socket.id)) {
      reply({
        success: true,
        message: "Already in this room",
        roomCode: room.code
      });
      return;
    }

    leaveRoom(socket);

    room.players.set(socket.id, {
      id: socket.id,
      name: cleanPlayerName(data.playerName)
    });

    socket.join(room.code);
    socket.data.roomCode = room.code;

    reply({
      success: true,
      message: "Quick match joined",
      roomCode: room.code
    });

    sendRoomUpdate(room);
  });

  socket.on("leaveRoom", () => {
    leaveRoom(socket);
    socket.emit("roomLeft", {
      success: true,
      message: "Left room"
    });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("========================================");
  console.log("Blind Fire Game Server Online");
  console.log("Host: 0.0.0.0");
  console.log("Port: " + PORT);
  console.log("========================================");
});

server.on("error", error => {
  console.error("Server startup/runtime error:", error);
});

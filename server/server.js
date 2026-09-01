const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const DEFAULT_ORIGINS = [
  "https://lydiatar.github.io",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
];

const configuredOrigins = String(process.env.CLIENT_ORIGINS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const allowedOrigins = new Set(configuredOrigins.length ? configuredOrigins : DEFAULT_ORIGINS);

function originAllowed(origin) {
  if (!origin) return true; // non-browser clients / health tooling
  if (allowedOrigins.has(origin)) return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return false;
}

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (originAllowed(origin)) return callback(null, true);
      return callback(new Error("Origin not allowed by Rina's 2048 server."));
    },
    methods: ["GET", "POST"]
  },
  maxHttpBufferSize: 256 * 1024,
  pingInterval: 25000,
  pingTimeout: 20000
});

const rooms = new Map();
const TILE_RACE_TARGETS = [2048, 4096, 8192];
const CUSTOM_TARGETS = [1024, 2048, 4096, 8192, 16384];
const ALLOWED_MODES = ["tile-race", "custom-race", "freeplay"];
const ALLOWED_THEMES = ["classic", "pastel", "ocean", "candy", "midnight"];
const MAX_SCORE = Number.MAX_SAFE_INTEGER;

app.get("/", (req, res) => {
  res.type("text/plain").send("Rina's 2048 multiplayer server is running!");
});

app.get("/health", (req, res) => {
  res.json({ ok: true, rooms: rooms.size, timestamp: new Date().toISOString() });
});

function sanitizeNickname(value, fallback) {
  const clean = String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
  return clean || fallback;
}

function sanitizeTheme(value) {
  return ALLOWED_THEMES.includes(value) ? value : "classic";
}

function sanitizeMode(value) {
  return ALLOWED_MODES.includes(value) ? value : "tile-race";
}

function sanitizeTileRaceTarget(value) {
  const target = Number(value);
  return TILE_RACE_TARGETS.includes(target) ? target : 2048;
}

function sanitizeCustomTarget(value, fallback) {
  const target = Number(value);
  return CUSTOM_TARGETS.includes(target) ? target : fallback;
}

function isPowerOfTwo(value) {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

function safeCoordinate(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n < 4 ? n : null;
}

function sanitizeGrid(rawGrid) {
  if (!rawGrid || Number(rawGrid.size) !== 4 || !Array.isArray(rawGrid.cells) || rawGrid.cells.length !== 4) {
    return null;
  }

  const cells = Array.from({ length: 4 }, () => Array(4).fill(null));
  for (let x = 0; x < 4; x += 1) {
    if (!Array.isArray(rawGrid.cells[x]) || rawGrid.cells[x].length !== 4) return null;
    for (let y = 0; y < 4; y += 1) {
      const rawTile = rawGrid.cells[x][y];
      if (rawTile == null) continue;
      const value = Number(rawTile.value);
      if (!isPowerOfTwo(value) || value > 1048576) return null;
      cells[x][y] = { position: { x, y }, value };
    }
  }

  return { size: 4, cells };
}

function highestFromGrid(grid) {
  let highest = 0;
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const tile = grid.cells[x][y];
      if (tile) highest = Math.max(highest, Number(tile.value || 0));
    }
  }
  return highest;
}

function gridMovesAvailable(grid) {
  for (let x = 0; x < 4; x += 1) {
    for (let y = 0; y < 4; y += 1) {
      const tile = grid.cells[x][y];
      if (!tile) return true;
      if (x + 1 < 4 && grid.cells[x + 1][y] && grid.cells[x + 1][y].value === tile.value) return true;
      if (y + 1 < 4 && grid.cells[x][y + 1] && grid.cells[x][y + 1].value === tile.value) return true;
    }
  }
  return false;
}

function sanitizeMotion(rawMotion) {
  if (!rawMotion || typeof rawMotion !== "object") return null;

  const cleanPoint = (point) => {
    if (!point || typeof point !== "object") return null;
    const x = safeCoordinate(point.x);
    const y = safeCoordinate(point.y);
    return x === null || y === null ? null : { x, y };
  };

  const transitions = Array.isArray(rawMotion.transitions)
    ? rawMotion.transitions.slice(0, 32).map((item) => {
        const from = cleanPoint(item && item.from);
        const to = cleanPoint(item && item.to);
        const value = Number(item && item.value);
        return from && to && isPowerOfTwo(value) ? { from, to, value } : null;
      }).filter(Boolean)
    : [];

  const cleanTile = (item) => {
    if (!item || typeof item !== "object") return null;
    const x = safeCoordinate(item.x);
    const y = safeCoordinate(item.y);
    const value = Number(item.value);
    return x === null || y === null || !isPowerOfTwo(value) ? null : { x, y, value };
  };

  return {
    id: Number.isSafeInteger(Number(rawMotion.id)) ? Number(rawMotion.id) : 0,
    type: rawMotion.type === "undo" ? "undo" : undefined,
    direction: [0, 1, 2, 3].includes(Number(rawMotion.direction)) ? Number(rawMotion.direction) : undefined,
    duration: Math.max(90, Math.min(140, Number(rawMotion.duration || 105))),
    transitions,
    spawnedTile: cleanTile(rawMotion.spawnedTile),
    removedTile: cleanTile(rawMotion.removedTile),
    merges: Array.isArray(rawMotion.merges) ? rawMotion.merges.slice(0, 16).map(cleanTile).filter(Boolean) : []
  };
}

function sanitizePlayerState(rawState, fallbackProfile) {
  if (!rawState || typeof rawState !== "object") return null;
  const grid = sanitizeGrid(rawState.grid);
  if (!grid) return null;

  const score = Number(rawState.score);
  if (!Number.isSafeInteger(score) || score < 0 || score > MAX_SCORE) return null;

  const highestTile = highestFromGrid(grid);
  const reportedHighest = Number(rawState.highestTile || highestTile);
  if (reportedHighest !== highestTile) return null;

  return {
    grid,
    score,
    highestTile,
    over: !gridMovesAvailable(grid),
    won: !!rawState.won,
    mode: sanitizeMode(rawState.mode),
    targetTile: Number(rawState.targetTile || 0),
    ownTarget: Number(rawState.ownTarget || 0),
    theme: sanitizeTheme(rawState.theme || (fallbackProfile && fallbackProfile.theme)),
    nickname: sanitizeNickname(rawState.nickname, (fallbackProfile && fallbackProfile.nickname) || "Player"),
    motion: sanitizeMotion(rawState.motion)
  };
}

function createRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    let code = "";
    for (let i = 0; i < 6; i += 1) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not create a unique room code.");
}

function findRoomForSocket(socketId) {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.includes(socketId)) return { roomCode, room };
  }
  return null;
}

function makeProfile(raw, fallbackName) {
  return {
    nickname: sanitizeNickname(raw && raw.nickname, fallbackName),
    theme: sanitizeTheme(raw && raw.theme)
  };
}

function roomProfiles(room) {
  return room.players.map((playerId, index) => {
    const profile = room.profiles[playerId] || makeProfile(null, `Player ${index + 1}`);
    return { playerNumber: index + 1, nickname: profile.nickname, theme: profile.theme };
  });
}

function targetForPlayer(room, playerNumber) {
  if (room.mode === "custom-race") return Number(room.targets[playerNumber] || 2048);
  if (room.mode === "tile-race") return Number(room.targetTile || 2048);
  return null;
}

function roomPayload(roomCode, room, playerNumber) {
  return {
    roomCode,
    playerNumber,
    mode: room.mode,
    targetTile: room.mode === "tile-race" ? room.targetTile : null,
    ownTarget: targetForPlayer(room, playerNumber),
    opponentTarget: targetForPlayer(room, playerNumber === 1 ? 2 : 1),
    targets: room.mode === "custom-race" ? room.targets : null,
    players: roomProfiles(room)
  };
}

function removeSocketFromRoom(socket, notifyOpponent) {
  const found = findRoomForSocket(socket.id);
  if (!found) return;
  const { roomCode, room } = found;
  socket.leave(roomCode);
  if (notifyOpponent && room.players.length > 1) socket.to(roomCode).emit("opponentLeftMatch");
  rooms.delete(roomCode);
  console.log("Room", roomCode, "deleted because a player left.");
}

function finishRoom(roomCode, room, winnerNumber, reason, loserNumber) {
  if (room.status !== "playing" || room.winner !== null) return;
  room.status = "finished";
  room.winner = winnerNumber;
  room.rematchVotes = [];
  io.to(roomCode).emit("gameWinner", {
    winner: winnerNumber,
    loser: loserNumber || null,
    reason,
    mode: room.mode,
    targetTile: room.targetTile || null,
    targets: room.targets || null
  });
  console.log("Room", roomCode, "finished. Winner: Player", winnerNumber, "Reason:", reason);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", (settings) => {
    removeSocketFromRoom(socket, true);
    const mode = sanitizeMode(settings && settings.mode);
    const roomCode = createRoomCode();
    const profile = makeProfile(settings, "Player 1");
    const room = {
      players: [socket.id],
      profiles: { [socket.id]: profile },
      states: {},
      status: "waiting",
      winner: null,
      rematchVotes: [],
      mode,
      targetTile: null,
      targets: null
    };

    if (mode === "tile-race") room.targetTile = sanitizeTileRaceTarget(settings && settings.targetTile);
    else if (mode === "custom-race") {
      room.targets = {
        1: sanitizeCustomTarget(settings && settings.hostTarget, 2048),
        2: sanitizeCustomTarget(settings && settings.guestTarget, 2048)
      };
    }

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit("roomCreated", roomPayload(roomCode, room, 1));
    console.log("Room", roomCode, "created. Mode:", mode);
  });

  socket.on("joinRoom", (payload) => {
    const isObject = payload && typeof payload === "object";
    const rawRoomCode = isObject ? payload.roomCode : payload;
    const roomCode = String(rawRoomCode || "").trim().toUpperCase();
    const room = rooms.get(roomCode);

    if (!room) return socket.emit("joinError", "Room not found.");
    if (room.players.includes(socket.id)) {
      return socket.emit("gameStart", roomPayload(roomCode, room, room.players.indexOf(socket.id) + 1));
    }
    if (room.players.length >= 2) return socket.emit("joinError", "Room is full.");

    removeSocketFromRoom(socket, true);
    const playerNumber = room.players.length + 1;
    const profile = makeProfile(isObject ? payload : null, `Player ${playerNumber}`);
    room.players.push(socket.id);
    room.profiles[socket.id] = profile;
    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];
    room.states = {};
    socket.join(roomCode);

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit("gameStart", roomPayload(roomCode, room, index + 1));
    });
    console.log("Player", socket.id, "joined room", roomCode, "mode:", room.mode);
  });

  socket.on("updateProfile", (rawProfile) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;
    const playerNumber = room.players.indexOf(socket.id) + 1;
    const current = room.profiles[socket.id] || {};
    room.profiles[socket.id] = makeProfile({
      nickname: rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "nickname") ? rawProfile.nickname : current.nickname,
      theme: rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "theme") ? rawProfile.theme : current.theme
    }, `Player ${playerNumber}`);
    io.to(roomCode).emit("playerProfileUpdated", {
      playerNumber,
      nickname: room.profiles[socket.id].nickname,
      theme: room.profiles[socket.id].theme
    });
  });

  socket.on("leaveRoom", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;

    if (room.status === "playing" && room.players.length === 2 && room.mode !== "freeplay") {
      const loserNumber = room.players.indexOf(socket.id) + 1;
      const winnerNumber = loserNumber === 1 ? 2 : 1;
      const winnerSocketId = room.players[winnerNumber - 1];
      room.status = "finished";
      room.winner = winnerNumber;
      io.to(winnerSocketId).emit("gameWinner", {
        winner: winnerNumber,
        loser: loserNumber,
        reason: "forfeit",
        mode: room.mode,
        targetTile: room.targetTile || null,
        targets: room.targets || null
      });
      removeSocketFromRoom(socket, false);
      return;
    }

    removeSocketFromRoom(socket, true);
  });

  socket.on("playerState", (rawState) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;
    if (room.status !== "playing") return;

    const playerNumber = room.players.indexOf(socket.id) + 1;
    const currentProfile = room.profiles[socket.id] || makeProfile(null, `Player ${playerNumber}`);
    const state = sanitizePlayerState(rawState, currentProfile);
    if (!state) return;

    room.states[socket.id] = state;
    room.profiles[socket.id] = makeProfile({ nickname: state.nickname, theme: state.theme }, `Player ${playerNumber}`);
    socket.to(roomCode).emit("opponentState", { playerNumber, state });

    // The validated board snapshot is the match authority. The client may emit
    // reachedTarget/playerEliminated slightly before playerState for the same move,
    // so adjudicate here after the resulting grid has reached the server.
    if (room.mode !== "freeplay" && room.winner === null) {
      const requiredTarget = targetForPlayer(room, playerNumber);
      const opponentNumber = playerNumber === 1 ? 2 : 1;
      if (state.highestTile >= requiredTarget) {
        finishRoom(roomCode, room, playerNumber, "target", opponentNumber);
      } else if (!gridMovesAvailable(state.grid)) {
        finishRoom(roomCode, room, opponentNumber, "board-stuck", playerNumber);
      }
    }
  });

  socket.on("reachedTarget", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;
    if (room.status !== "playing" || room.winner !== null || (room.mode !== "tile-race" && room.mode !== "custom-race")) return;

    const playerNumber = room.players.indexOf(socket.id) + 1;
    const requiredTarget = targetForPlayer(room, playerNumber);
    const state = room.states[socket.id];
    if (!state || Number(state.highestTile) < requiredTarget) return;

    const loserNumber = playerNumber === 1 ? 2 : 1;
    finishRoom(roomCode, room, playerNumber, "target", loserNumber);
  });

  socket.on("playerEliminated", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;
    if (room.status !== "playing" || room.winner !== null || room.players.length < 2 || room.mode === "freeplay") return;

    const state = room.states[socket.id];
    if (!state || gridMovesAvailable(state.grid)) return;

    const loserNumber = room.players.indexOf(socket.id) + 1;
    const winnerNumber = loserNumber === 1 ? 2 : 1;
    finishRoom(roomCode, room, winnerNumber, "board-stuck", loserNumber);
  });

  socket.on("requestRematch", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room } = found;
    if (room.mode === "freeplay" || room.status !== "finished" || room.players.length !== 2) return;

    if (!room.rematchVotes.includes(socket.id)) room.rematchVotes.push(socket.id);
    if (room.rematchVotes.length < 2) return socket.emit("rematchWaiting");

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];
    room.states = {};
    room.players.forEach((playerId, index) => {
      io.to(playerId).emit("rematchStart", roomPayload(roomCode, room, index + 1));
    });
    console.log("Rematch started in room", roomCode);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    removeSocketFromRoom(socket, true);
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Rina's 2048 server running on port ${PORT}`);
  console.log("Allowed browser origins:", Array.from(allowedOrigins).join(", "));
});

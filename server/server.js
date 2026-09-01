const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" }
});

const rooms = new Map();
const TILE_RACE_TARGETS = [2048, 4096, 8192];
const CUSTOM_TARGETS = [1024, 2048, 4096, 8192, 16384];
const ALLOWED_MODES = ["tile-race", "custom-race", "freeplay"];
const ALLOWED_THEMES = ["classic", "pastel", "ocean", "candy", "midnight"];

app.get("/", (req, res) => {
  res.send("Rina's 2048 multiplayer server is running!");
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

function createRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";

    for (let i = 0; i < 6; i++) {
      code += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    if (!rooms.has(code)) {
      return code;
    }
  }

  throw new Error("Could not create a unique room code.");
}

function findRoomForSocket(socketId) {
  for (const [roomCode, room] of rooms.entries()) {
    if (room.players.includes(socketId)) {
      return { roomCode, room };
    }
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

    return {
      playerNumber: index + 1,
      nickname: profile.nickname,
      theme: profile.theme
    };
  });
}

function targetForPlayer(room, playerNumber) {
  if (room.mode === "custom-race") {
    return Number(room.targets[playerNumber] || 2048);
  }

  if (room.mode === "tile-race") {
    return Number(room.targetTile || 2048);
  }

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

  if (!found) {
    return;
  }

  const { roomCode, room } = found;

  socket.leave(roomCode);

  if (notifyOpponent && room.players.length > 1) {
    socket.to(roomCode).emit("opponentLeftMatch");
  }

  rooms.delete(roomCode);
  console.log("Room", roomCode, "deleted because a player left.");
}

function finishRoom(roomCode, room, winnerNumber, reason, loserNumber) {
  if (room.status !== "playing" || room.winner !== null) {
    return;
  }

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

  console.log(
    "Room",
    roomCode,
    "finished. Winner: Player",
    winnerNumber,
    "Reason:",
    reason
  );
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
      status: "waiting",
      winner: null,
      rematchVotes: [],
      mode,
      targetTile: null,
      targets: null
    };

    if (mode === "tile-race") {
      room.targetTile = sanitizeTileRaceTarget(settings && settings.targetTile);
    } else if (mode === "custom-race") {
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

    if (!room) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    if (room.players.includes(socket.id)) {
      socket.emit(
        "gameStart",
        roomPayload(roomCode, room, room.players.indexOf(socket.id) + 1)
      );
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    removeSocketFromRoom(socket, true);

    const playerNumber = room.players.length + 1;
    const profile = makeProfile(
      isObject ? payload : null,
      `Player ${playerNumber}`
    );

    room.players.push(socket.id);
    room.profiles[socket.id] = profile;
    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    socket.join(roomCode);

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit(
        "gameStart",
        roomPayload(roomCode, room, index + 1)
      );
    });

    console.log("Player", socket.id, "joined room", roomCode, "mode:", room.mode);
  });

  socket.on("updateProfile", (rawProfile) => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;
    const playerNumber = room.players.indexOf(socket.id) + 1;
    const current = room.profiles[socket.id] || {};

    room.profiles[socket.id] = makeProfile(
      {
        nickname:
          rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "nickname")
            ? rawProfile.nickname
            : current.nickname,
        theme:
          rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "theme")
            ? rawProfile.theme
            : current.theme
      },
      `Player ${playerNumber}`
    );

    io.to(roomCode).emit("playerProfileUpdated", {
      playerNumber,
      nickname: room.profiles[socket.id].nickname,
      theme: room.profiles[socket.id].theme
    });
  });

  socket.on("leaveRoom", () => {
    removeSocketFromRoom(socket, true);
  });

  socket.on("playerState", (state) => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;

    if (room.status !== "playing") {
      return;
    }

    const playerNumber = room.players.indexOf(socket.id) + 1;

    if (state && typeof state === "object") {
      const current = room.profiles[socket.id] || {};
      room.profiles[socket.id] = makeProfile(
        {
          nickname: state.nickname || current.nickname,
          theme: state.theme || current.theme
        },
        `Player ${playerNumber}`
      );
    }

    socket.to(roomCode).emit("opponentState", {
      playerNumber,
      state
    });
  });

  socket.on("reachedTarget", (data) => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;

    if (
      room.status !== "playing" ||
      room.winner !== null ||
      (room.mode !== "tile-race" && room.mode !== "custom-race")
    ) {
      return;
    }

    const playerNumber = room.players.indexOf(socket.id) + 1;
    const requiredTarget = targetForPlayer(room, playerNumber);
    const reportedTile = Number(data && data.tileValue);

    if (!Number.isFinite(reportedTile) || reportedTile < requiredTarget) {
      return;
    }

    const loserNumber = playerNumber === 1 ? 2 : 1;
    finishRoom(roomCode, room, playerNumber, "target", loserNumber);
  });

  socket.on("playerEliminated", () => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;

    if (
      room.status !== "playing" ||
      room.winner !== null ||
      room.players.length < 2 ||
      room.mode === "freeplay"
    ) {
      return;
    }

    const loserNumber = room.players.indexOf(socket.id) + 1;
    const winnerNumber = loserNumber === 1 ? 2 : 1;

    finishRoom(roomCode, room, winnerNumber, "board-stuck", loserNumber);
  });

  socket.on("requestRematch", () => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;

    if (
      room.mode === "freeplay" ||
      room.status !== "finished" ||
      room.players.length !== 2
    ) {
      return;
    }

    if (!room.rematchVotes.includes(socket.id)) {
      room.rematchVotes.push(socket.id);
    }

    if (room.rematchVotes.length < 2) {
      socket.emit("rematchWaiting");
      return;
    }

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit(
        "rematchStart",
        roomPayload(roomCode, room, index + 1)
      );
    });

    console.log("Rematch started in room", roomCode);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    removeSocketFromRoom(socket, true);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Rina's 2048 server running on port ${PORT}`);
});

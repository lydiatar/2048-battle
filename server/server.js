const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const rooms = new Map();
const ALLOWED_TARGETS = [2048, 4096, 8192];
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

  console.log(
    "Room",
    roomCode,
    "finished. Winner: Player",
    winnerNumber,
    "Reason:",
    reason
  );

  io.to(roomCode).emit("gameWinner", {
    winner: winnerNumber,
    loser: loserNumber || null,
    reason,
    targetTile: room.targetTile
  });
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", (settings) => {
    removeSocketFromRoom(socket, true);

    const requestedTarget = Number(settings && settings.targetTile);
    const targetTile = ALLOWED_TARGETS.includes(requestedTarget)
      ? requestedTarget
      : 2048;

    const roomCode = createRoomCode();
    const profile = makeProfile(settings, "Player 1");

    rooms.set(roomCode, {
      players: [socket.id],
      profiles: {
        [socket.id]: profile
      },
      status: "waiting",
      winner: null,
      rematchVotes: [],
      mode: "tile-race",
      targetTile
    });

    socket.join(roomCode);

    socket.emit("roomCreated", {
      roomCode,
      playerNumber: 1,
      mode: "tile-race",
      targetTile,
      players: [
        {
          playerNumber: 1,
          nickname: profile.nickname,
          theme: profile.theme
        }
      ]
    });

    console.log(
      "Room",
      roomCode,
      "created by",
      socket.id,
      "target:",
      targetTile
    );
  });

  socket.on("joinRoom", (payload) => {
    const isObject = payload && typeof payload === "object";
    const rawRoomCode = isObject ? payload.roomCode : payload;

    const roomCode = String(rawRoomCode || "")
      .trim()
      .toUpperCase();

    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    if (room.players.includes(socket.id)) {
      socket.emit("gameStart", {
        playerNumber: room.players.indexOf(socket.id) + 1,
        mode: room.mode,
        targetTile: room.targetTile,
        roomCode,
        players: roomProfiles(room)
      });
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

    const profiles = roomProfiles(room);

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit("gameStart", {
        playerNumber: index + 1,
        mode: room.mode,
        targetTile: room.targetTile,
        roomCode,
        players: profiles
      });
    });

    console.log(
      "Player",
      socket.id,
      "joined room",
      roomCode,
      "- players:",
      room.players.length
    );
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

    if (room.status !== "playing" || room.winner !== null) {
      return;
    }

    const reportedTile = Number(data && data.tileValue);

    if (!Number.isFinite(reportedTile) || reportedTile < room.targetTile) {
      return;
    }

    const playerNumber = room.players.indexOf(socket.id) + 1;
    const loserNumber = playerNumber === 1 ? 2 : 1;

    finishRoom(
      roomCode,
      room,
      playerNumber,
      "target",
      loserNumber
    );
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
      room.players.length < 2
    ) {
      return;
    }

    const loserNumber = room.players.indexOf(socket.id) + 1;
    const winnerNumber = loserNumber === 1 ? 2 : 1;

    finishRoom(
      roomCode,
      room,
      winnerNumber,
      "elimination",
      loserNumber
    );
  });

  socket.on("requestRematch", () => {
    const found = findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const { roomCode, room } = found;

    if (room.status !== "finished" || room.players.length !== 2) {
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

    io.to(roomCode).emit("rematchStart", {
      mode: room.mode,
      targetTile: room.targetTile,
      roomCode,
      players: roomProfiles(room)
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

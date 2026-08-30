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

app.get("/", (req, res) => {
  res.send("Rina's 2048 multiplayer server is running!");
});

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

    rooms.set(roomCode, {
      players: [socket.id],
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
      targetTile
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

  socket.on("joinRoom", (rawRoomCode) => {
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
        roomCode
      });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    removeSocketFromRoom(socket, true);

    room.players.push(socket.id);
    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    socket.join(roomCode);

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit("gameStart", {
        playerNumber: index + 1,
        mode: room.mode,
        targetTile: room.targetTile,
        roomCode
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
      roomCode
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

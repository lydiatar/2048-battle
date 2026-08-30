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
      return {
        roomCode: roomCode,
        room: room
      };
    }
  }

  return null;
}

function removePlayerFromRooms(socketId) {
  for (const [roomCode, room] of rooms.entries()) {
    if (!room.players.includes(socketId)) {
      continue;
    }

    if (room.players.length > 1) {
      io.to(roomCode).emit("opponentDisconnected");
    }

    rooms.delete(roomCode);

    console.log(
      "Room",
      roomCode,
      "deleted because a player left."
    );
  }
}

function finishRoom(
  roomCode,
  room,
  winnerNumber,
  reason,
  loserNumber
) {
  if (
    room.status !== "playing" ||
    room.winner !== null
  ) {
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
    reason: reason
  });
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", () => {
    removePlayerFromRooms(socket.id);

    const roomCode = createRoomCode();

    rooms.set(roomCode, {
      players: [socket.id],
      status: "waiting",
      winner: null,
      rematchVotes: []
    });

    socket.join(roomCode);

    socket.emit("roomCreated", {
      roomCode: roomCode,
      playerNumber: 1
    });

    console.log(
      "Room",
      roomCode,
      "created by",
      socket.id
    );
  });

  socket.on("joinRoom", (rawRoomCode) => {
    const roomCode = String(
      rawRoomCode || ""
    )
      .trim()
      .toUpperCase();

    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit(
        "joinError",
        "Room not found."
      );

      return;
    }

    if (room.players.includes(socket.id)) {
      socket.emit("gameStart", {
        playerNumber:
          room.players.indexOf(socket.id) + 1
      });

      return;
    }

    if (room.players.length >= 2) {
      socket.emit(
        "joinError",
        "Room is full."
      );

      return;
    }

    removePlayerFromRooms(socket.id);

    room.players.push(socket.id);
    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    socket.join(roomCode);

    room.players.forEach(
      (playerId, index) => {
        io.to(playerId).emit(
          "gameStart",
          {
            playerNumber: index + 1
          }
        );
      }
    );

    console.log(
      "Player",
      socket.id,
      "joined room",
      roomCode,
      "- players:",
      room.players.length
    );
  });

  socket.on("playerState", (state) => {
    const found =
      findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const roomCode =
      found.roomCode;

    const room =
      found.room;

    if (room.status !== "playing") {
      return;
    }

    const playerNumber =
      room.players.indexOf(socket.id) + 1;

    socket
      .to(roomCode)
      .emit(
        "opponentState",
        {
          playerNumber: playerNumber,
          state: state
        }
      );
  });

  socket.on("reached2048", () => {
    const found =
      findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const roomCode =
      found.roomCode;

    const room =
      found.room;

    if (
      room.status !== "playing" ||
      room.winner !== null
    ) {
      return;
    }

    const playerNumber =
      room.players.indexOf(socket.id) + 1;

    const loserNumber =
      playerNumber === 1 ? 2 : 1;

    finishRoom(
      roomCode,
      room,
      playerNumber,
      "2048",
      loserNumber
    );
  });

  socket.on("playerEliminated", () => {
    const found =
      findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const roomCode =
      found.roomCode;

    const room =
      found.room;

    if (
      room.status !== "playing" ||
      room.winner !== null ||
      room.players.length < 2
    ) {
      return;
    }

    const loserNumber =
      room.players.indexOf(socket.id) + 1;

    const winnerNumber =
      loserNumber === 1 ? 2 : 1;

    finishRoom(
      roomCode,
      room,
      winnerNumber,
      "elimination",
      loserNumber
    );
  });

  socket.on("requestRematch", () => {
    const found =
      findRoomForSocket(socket.id);

    if (!found) {
      return;
    }

    const roomCode =
      found.roomCode;

    const room =
      found.room;

    if (
      room.status !== "finished" ||
      room.players.length !== 2
    ) {
      return;
    }

    if (
      !room.rematchVotes.includes(
        socket.id
      )
    ) {
      room.rematchVotes.push(
        socket.id
      );
    }

    if (room.rematchVotes.length < 2) {
      socket.emit("rematchWaiting");
      return;
    }

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    io.to(roomCode).emit(
      "rematchStart"
    );

    console.log(
      "Rematch started in room",
      roomCode
    );
  });

  socket.on("disconnect", () => {
    console.log(
      "Player disconnected:",
      socket.id
    );

    removePlayerFromRooms(
      socket.id
    );
  });
});

const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Rina's 2048 server running on port ${PORT}`
  );
});

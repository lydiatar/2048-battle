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
  res.send("2048 Battle server is running!");
});

function createRoomCode() {
  var characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (var attempt = 0; attempt < 100; attempt++) {
    var code = "";

    for (var i = 0; i < 6; i++) {
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

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", () => {
    // Remove player from any old room.
    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(
          (id) => id !== socket.id
        );

        if (room.players.length === 0) {
          rooms.delete(roomCode);
        }
      }
    }

    const roomCode = createRoomCode();

  rooms.set(roomCode, {
  players: [socket.id],
  status: "waiting",
  winner: null,
  rematchVotes: []
});

    socket.join(roomCode);

    console.log(
      "Room",
      roomCode,
      "created by",
      socket.id
    );

    socket.emit("roomCreated", {
      roomCode: roomCode,
      playerNumber: 1
    });
  });

  socket.on("joinRoom", (roomCode) => {
    roomCode = String(roomCode).trim().toUpperCase();

    const room = rooms.get(roomCode);

    if (!room) {
      socket.emit("joinError", "Room not found.");
      return;
    }

    if (room.players.includes(socket.id)) {
      socket.emit("gameStart", {
        playerNumber: room.players.indexOf(socket.id) + 1
      });
      return;
    }

    if (room.players.length >= 2) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    room.players.push(socket.id);
    room.status = "playing";

    socket.join(roomCode);

    console.log(
      "Player",
      socket.id,
      "joined room",
      roomCode
    );

    console.log(
      "Room",
      roomCode,
      "now has",
      room.players.length,
      "players."
    );

    room.players.forEach((playerId, index) => {
      io.to(playerId).emit("gameStart", {
        playerNumber: index + 1
      });
    });
  });

  /*
   * Player reports that they reached 2048.
   */
  socket.on("playerState", (state) => {
  for (const [roomCode, room] of rooms.entries()) {
    if (!room.players.includes(socket.id)) {
      continue;
    }

    if (room.status !== "playing") {
      return;
    }

    var playerNumber =
      room.players.indexOf(socket.id) + 1;

    // Send this player's latest board to their opponent.
    socket.to(roomCode).emit("opponentState", {
      playerNumber: playerNumber,
      state: state
    });

    return;
  }
});
  
  socket.on("reached2048", () => {
    for (const [roomCode, room] of rooms.entries()) {
      if (!room.players.includes(socket.id)) {
        continue;
      }

      // Someone already won.
      if (room.winner !== null) {
        return;
      }

      var playerNumber =
        room.players.indexOf(socket.id) + 1;

      room.winner = playerNumber;
      room.status = "finished";

      console.log(
        "Player",
        playerNumber,
        "won room",
        roomCode
      );

      io.to(roomCode).emit("gameWinner", {
        winner: playerNumber
      });

      return;
    }
  });

  socket.on("requestRematch", () => {
  for (const [roomCode, room] of rooms.entries()) {
    if (!room.players.includes(socket.id)) {
      continue;
    }

    if (room.status !== "finished") {
      return;
    }

    if (!room.rematchVotes) {
      room.rematchVotes = [];
    }

    if (!room.rematchVotes.includes(socket.id)) {
      room.rematchVotes.push(socket.id);
    }

    console.log(
      "Rematch vote in room",
      roomCode,
      room.rematchVotes.length + "/2"
    );

    if (room.rematchVotes.length < 2) {
      socket.emit("rematchWaiting");
      return;
    }

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    console.log(
      "Rematch starting in room",
      roomCode
    );

    io.to(roomCode).emit("rematchStart");
    return;
  }
});

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(
          (id) => id !== socket.id
        );

        if (room.players.length === 0) {
          rooms.delete(roomCode);

          console.log(
            "Room",
            roomCode,
            "deleted because it is empty."
          );
        } else {
          room.status = "waiting";

          io.to(roomCode).emit(
            "opponentDisconnected"
          );

          console.log(
            "Room",
            roomCode,
            "is waiting for another player."
          );
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `2048 Battle server running on port ${PORT}`
  );
});

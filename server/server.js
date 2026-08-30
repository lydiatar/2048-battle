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
    // If this player was already in another room,
    // remove them from that room first.
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
      status: "waiting"
    });

    socket.join(roomCode);

    console.log(
      "Room",
      roomCode,
      "created by",
      socket.id
    );

    socket.emit("roomCreated", roomCode);
  });

  socket.on("joinRoom", (roomCode) => {
    roomCode = String(roomCode).trim().toUpperCase();

    const room = rooms.get(roomCode);

    if (!room) {
      console.log(
        "Join failed:",
        roomCode,
        "does not exist"
      );

      socket.emit("joinError", "Room not found.");
      return;
    }

    // Don't add the same player twice.
    if (room.players.includes(socket.id)) {
      console.log(
        "Player",
        socket.id,
        "is already in room",
        roomCode
      );

      socket.emit("gameStart");
      return;
    }

    if (room.players.length >= 2) {
      console.log(
        "Join failed:",
        roomCode,
        "is full. Players:",
        room.players
      );

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

    io.to(roomCode).emit("gameStart");
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    for (const [roomCode, room] of rooms.entries()) {
      if (room.players.includes(socket.id)) {
        room.players = room.players.filter(
          (id) => id !== socket.id
        );

        console.log(
          "Removed",
          socket.id,
          "from room",
          roomCode
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

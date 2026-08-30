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

io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    socket.on("createRoom", () => {
        const roomCode = Math.random()
            .toString(36)
            .substring(2, 8)
            .toUpperCase();

        rooms.set(roomCode, {
            players: [socket.id],
            status: "waiting"
        });

        socket.join(roomCode);

        socket.emit("roomCreated", roomCode);

        console.log(`Room ${roomCode} created`);
    });

    socket.on("joinRoom", (roomCode) => {
        roomCode = roomCode.toUpperCase();

        const room = rooms.get(roomCode);

        if (!room) {
            socket.emit("joinError", "Room not found.");
            return;
        }

        if (room.players.length >= 2) {
            socket.emit("joinError", "Room is full.");
            return;
        }

        room.players.push(socket.id);
        room.status = "playing";

        socket.join(roomCode);

        io.to(roomCode).emit("gameStart");

        console.log(`Player joined room ${roomCode}`);
    });

    socket.on("disconnect", () => {
        console.log("Player disconnected:", socket.id);

        for (const [roomCode, room] of rooms.entries()) {
            if (room.players.includes(socket.id)) {
                rooms.delete(roomCode);
            }
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`2048 Battle server running on port ${PORT}`);
});

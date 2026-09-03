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
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const MAX_CHAT_MESSAGES = 20;
const MAX_CHAT_LENGTH = 160;
const CHAT_RATE_WINDOW_MS = 5000;
const CHAT_RATE_LIMIT = 5;

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

function sanitizeChatMessage(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CHAT_LENGTH);
}

function sanitizeTheme(value) {
  return ALLOWED_THEMES.includes(value) ? value : "classic";
}

function sanitizeMode(value) {
  return ALLOWED_MODES.includes(value) ? value : "tile-race";
}

function sanitizeRequiredPlayers(value) {
  const count = Number(value);
  return count >= MIN_PLAYERS && count <= MAX_PLAYERS && Number.isInteger(count)
    ? count
    : MIN_PLAYERS;
}

function sanitizeTileRaceTarget(value) {
  const target = Number(value);
  return TILE_RACE_TARGETS.includes(target) ? target : 2048;
}

function sanitizeCustomTarget(value) {
  const target = Number(value);
  return CUSTOM_TARGETS.includes(target) ? target : null;
}

function createRoomCode() {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 100; attempt++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    if (!rooms.has(code)) return code;
  }

  throw new Error("Could not create a unique room code.");
}

function sortedPlayers(room) {
  return room.players.slice().sort((a, b) => a.slot - b.slot);
}

function findPlayer(room, socketId) {
  return room.players.find((player) => player.socketId === socketId) || null;
}

function findRoomForSocket(socketId) {
  for (const [roomCode, room] of rooms.entries()) {
    const player = findPlayer(room, socketId);
    if (player) return { roomCode, room, player };
  }
  return null;
}

function nextAvailableSlot(room) {
  for (let slot = 1; slot <= room.requiredPlayers; slot++) {
    if (!room.players.some((player) => player.slot === slot)) return slot;
  }
  return null;
}

function makePlayer(socketId, slot, raw, isHost) {
  return {
    id: socketId,
    socketId,
    slot,
    nickname: sanitizeNickname(raw && raw.nickname, `Player ${slot}`),
    theme: sanitizeTheme(raw && raw.theme),
    connected: true,
    ready: false,
    targetTile: null,
    isHost: !!isHost,
    status: "waiting"
  };
}

function publicPlayer(player) {
  return {
    playerId: player.id,
    playerNumber: player.slot,
    nickname: player.nickname,
    theme: player.theme,
    connected: player.connected,
    ready: !!player.ready,
    targetTile: player.targetTile,
    isHost: !!player.isHost,
    status: player.status
  };
}

function roomProfiles(room) {
  return sortedPlayers(room).map(publicPlayer);
}

function targetForPlayer(room, playerNumber) {
  if (room.mode === "custom-race") {
    const player = room.players.find((entry) => entry.slot === Number(playerNumber));
    return player ? player.targetTile : null;
  }
  if (room.mode === "tile-race") return Number(room.targetTile || 2048);
  return null;
}

function customTargetsObject(room) {
  if (room.mode !== "custom-race") return null;
  const targets = {};
  sortedPlayers(room).forEach((player) => {
    targets[player.slot] = player.targetTile;
  });
  return targets;
}

function roomStartCheck(room) {
  if (room.status !== "waiting") {
    return { canStart: false, reason: "This room is no longer waiting." };
  }

  if (room.players.length < room.requiredPlayers) {
    const missing = room.requiredPlayers - room.players.length;
    return {
      canStart: false,
      reason: `Waiting for ${missing} more player${missing === 1 ? "" : "s"}.`
    };
  }

  if (room.mode === "custom-race") {
    const host = room.players.find((player) => player.isHost);
    if (!host || !host.targetTile) {
      return { canStart: false, reason: "Choose your target to start." };
    }

    const choosing = sortedPlayers(room).find((player) => !player.targetTile);
    if (choosing) {
      return { canStart: false, reason: `${choosing.nickname} is choosing a target.` };
    }
  }

  const notReady = sortedPlayers(room).find((player) => !player.isHost && !player.ready);
  if (notReady) {
    return { canStart: false, reason: `Waiting for ${notReady.nickname} to ready up.` };
  }

  return { canStart: true, reason: "Everyone's ready." };
}

function roomPayload(roomCode, room, socketId) {
  const localPlayer = findPlayer(room, socketId);
  const players = roomProfiles(room);
  const startCheck = roomStartCheck(room);
  const opponent = localPlayer
    ? sortedPlayers(room).find((player) => player.socketId !== socketId)
    : null;

  return {
    roomCode,
    playerNumber: localPlayer ? localPlayer.slot : null,
    isHost: !!(localPlayer && localPlayer.isHost),
    mode: room.mode,
    status: room.status,
    requiredPlayers: room.requiredPlayers,
    joinedPlayers: room.players.length,
    targetTile: room.mode === "tile-race" ? room.targetTile : null,
    ownTarget: localPlayer ? targetForPlayer(room, localPlayer.slot) : null,
    opponentTarget: opponent ? targetForPlayer(room, opponent.slot) : null,
    targets: customTargetsObject(room),
    players,
    canStart: startCheck.canStart,
    startStatus: startCheck.reason,
    gameplaySupported: room.requiredPlayers === 2,
    chatMessages: room.chatMessages.slice(-MAX_CHAT_MESSAGES)
  };
}

function broadcastRoomState(roomCode, room) {
  sortedPlayers(room).forEach((player) => {
    io.to(player.socketId).emit("roomState", roomPayload(roomCode, room, player.socketId));
  });
}

function transferHostIfNeeded(room) {
  if (room.players.some((player) => player.isHost)) return;
  const nextHost = sortedPlayers(room)[0];
  if (nextHost) nextHost.isHost = true;
}

function removeWaitingPlayer(socket, roomCode, room, player) {
  socket.leave(roomCode);
  room.players = room.players.filter((entry) => entry.socketId !== socket.id);

  if (!room.players.length) {
    rooms.delete(roomCode);
    console.log("Room", roomCode, "deleted because the waiting room became empty.");
    return;
  }

  if (player && player.isHost) transferHostIfNeeded(room);
  broadcastRoomState(roomCode, room);
}

function removeSocketFromRoom(socket, notifyOpponent) {
  const found = findRoomForSocket(socket.id);
  if (!found) return;

  const { roomCode, room, player } = found;

  if (room.status === "waiting") {
    removeWaitingPlayer(socket, roomCode, room, player);
    return;
  }

  socket.leave(roomCode);

  if (notifyOpponent && room.players.length > 1) {
    socket.to(roomCode).emit("opponentLeftMatch");
  }

  rooms.delete(roomCode);
  console.log("Room", roomCode, "deleted because a player left an active legacy match.");
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
    targets: customTargetsObject(room)
  });

  console.log("Room", roomCode, "finished. Winner: Player", winnerNumber, "Reason:", reason);
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);
  socket.data.lobbyMessageTimes = [];

  socket.on("createRoom", (settings) => {
    removeSocketFromRoom(socket, true);

    const mode = sanitizeMode(settings && settings.mode);
    const requiredPlayers = sanitizeRequiredPlayers(settings && settings.requiredPlayers);
    const roomCode = createRoomCode();
    const host = makePlayer(socket.id, 1, settings, true);

    const room = {
      players: [host],
      requiredPlayers,
      status: "waiting",
      winner: null,
      rematchVotes: [],
      mode,
      targetTile: mode === "tile-race"
        ? sanitizeTileRaceTarget(settings && settings.targetTile)
        : null,
      chatMessages: []
    };

    rooms.set(roomCode, room);
    socket.join(roomCode);
    socket.emit("roomCreated", roomPayload(roomCode, room, socket.id));
    broadcastRoomState(roomCode, room);

    console.log("Room", roomCode, "created. Mode:", mode, "Players:", requiredPlayers);
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

    const existing = findPlayer(room, socket.id);
    if (existing) {
      socket.emit("roomJoined", roomPayload(roomCode, room, socket.id));
      return;
    }

    if (room.status !== "waiting") {
      socket.emit("joinError", "This match has already started.");
      return;
    }

    if (room.players.length >= room.requiredPlayers) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    removeSocketFromRoom(socket, true);

    const slot = nextAvailableSlot(room);
    if (!slot) {
      socket.emit("joinError", "Room is full.");
      return;
    }

    const player = makePlayer(socket.id, slot, isObject ? payload : null, false);
    room.players.push(player);
    socket.join(roomCode);

    socket.emit("roomJoined", roomPayload(roomCode, room, socket.id));
    broadcastRoomState(roomCode, room);

    console.log("Player", socket.id, "joined room", roomCode, "as slot", slot);
  });

  socket.on("setReady", (payload) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (room.status !== "waiting" || player.isHost) return;

    const nextReady = !!(payload && payload.ready);
    if (nextReady && room.mode === "custom-race" && !player.targetTile) {
      socket.emit("lobbyError", "Choose your target before you ready up.");
      return;
    }

    player.ready = nextReady;
    broadcastRoomState(roomCode, room);
  });

  socket.on("setPlayerTarget", (payload) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (room.status !== "waiting" || room.mode !== "custom-race") return;

    const target = sanitizeCustomTarget(payload && payload.targetTile);
    if (!target) {
      socket.emit("lobbyError", "Choose a valid target.");
      return;
    }

    player.targetTile = target;
    if (!player.isHost) player.ready = false;
    broadcastRoomState(roomCode, room);
  });

  socket.on("startMatch", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (!player.isHost) {
      socket.emit("startError", "Only the host can start the match.");
      return;
    }

    const check = roomStartCheck(room);
    if (!check.canStart) {
      socket.emit("startError", check.reason);
      return;
    }

    // Phase 4 delivers scalable room/setup state. The existing gameplay renderer
    // is still a 1v1 renderer, so larger rooms deliberately stop here until Phase 5.
    if (room.requiredPlayers > 2) {
      socket.emit("startError", "3- and 4-player gameplay is not enabled in this build yet.");
      return;
    }

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    sortedPlayers(room).forEach((entry) => {
      entry.status = "active";
      io.to(entry.socketId).emit("gameStart", roomPayload(roomCode, room, entry.socketId));
    });

    console.log("Host started room", roomCode);
  });

  socket.on("sendLobbyMessage", (payload) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (room.status !== "waiting") return;

    const text = sanitizeChatMessage(payload && payload.text);
    if (!text) return;

    const now = Date.now();
    const recent = (socket.data.lobbyMessageTimes || []).filter(
      (time) => now - time < CHAT_RATE_WINDOW_MS
    );

    if (recent.length >= CHAT_RATE_LIMIT) {
      socket.data.lobbyMessageTimes = recent;
      socket.emit("lobbyChatError", "Slow down for a moment.");
      return;
    }

    recent.push(now);
    socket.data.lobbyMessageTimes = recent;

    const message = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      playerId: player.id,
      playerNumber: player.slot,
      nickname: player.nickname,
      text,
      createdAt: now
    };

    room.chatMessages.push(message);
    if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
      room.chatMessages.splice(0, room.chatMessages.length - MAX_CHAT_MESSAGES);
    }

    io.to(roomCode).emit("lobbyMessage", message);
  });

  socket.on("updateProfile", (rawProfile) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    player.nickname = sanitizeNickname(
      rawProfile && Object.prototype.hasOwnProperty.call(rawProfile, "nickname")
        ? rawProfile.nickname
        : player.nickname,
      `Player ${player.slot}`
    );

    // Themes are editable in a waiting room, but locked once a match starts.
    if (
      room.status === "waiting" &&
      rawProfile &&
      Object.prototype.hasOwnProperty.call(rawProfile, "theme")
    ) {
      player.theme = sanitizeTheme(rawProfile.theme);
    }

    if (room.status === "waiting") {
      broadcastRoomState(roomCode, room);
      return;
    }

    io.to(roomCode).emit("playerProfileUpdated", publicPlayer(player));
  });

  socket.on("leaveRoom", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;

    if (room.status === "waiting") {
      removeWaitingPlayer(socket, roomCode, room, player);
      return;
    }

    if (
      room.status === "playing" &&
      room.winner === null &&
      room.players.length === 2 &&
      room.mode !== "freeplay"
    ) {
      const loserNumber = player.slot;
      const other = room.players.find((entry) => entry.socketId !== socket.id);
      const winnerNumber = other ? other.slot : null;
      if (winnerNumber) finishRoom(roomCode, room, winnerNumber, "forfeit", loserNumber);
      socket.leave(roomCode);
      rooms.delete(roomCode);
      console.log("Room", roomCode, "deleted after forfeit by Player", loserNumber);
      return;
    }

    removeSocketFromRoom(socket, true);
  });

  socket.on("playerState", (state) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (room.status !== "playing") return;

    if (state && typeof state === "object") {
      player.nickname = sanitizeNickname(state.nickname || player.nickname, `Player ${player.slot}`);
      // Never accept an active-match theme mutation.
    }

    socket.to(roomCode).emit("opponentState", {
      playerNumber: player.slot,
      state
    });
  });

  socket.on("reachedTarget", (data) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (
      room.status !== "playing" ||
      room.winner !== null ||
      room.players.length !== 2 ||
      (room.mode !== "tile-race" && room.mode !== "custom-race")
    ) return;

    const requiredTarget = targetForPlayer(room, player.slot);
    const reportedTile = Number(data && data.tileValue);
    if (!Number.isFinite(reportedTile) || !requiredTarget || reportedTile < requiredTarget) return;

    const other = room.players.find((entry) => entry.socketId !== socket.id);
    finishRoom(roomCode, room, player.slot, "target", other ? other.slot : null);
  });

  socket.on("playerEliminated", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (
      room.status !== "playing" ||
      room.winner !== null ||
      room.players.length !== 2 ||
      room.mode === "freeplay"
    ) return;

    const other = room.players.find((entry) => entry.socketId !== socket.id);
    if (other) finishRoom(roomCode, room, other.slot, "board-stuck", player.slot);
  });

  socket.on("requestRematch", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room } = found;
    if (
      room.mode === "freeplay" ||
      room.status !== "finished" ||
      room.players.length !== 2
    ) return;

    if (!room.rematchVotes.includes(socket.id)) room.rematchVotes.push(socket.id);

    if (room.rematchVotes.length < 2) {
      socket.emit("rematchWaiting");
      return;
    }

    room.status = "playing";
    room.winner = null;
    room.rematchVotes = [];

    sortedPlayers(room).forEach((player) => {
      player.status = "active";
      io.to(player.socketId).emit("rematchStart", roomPayload(roomCode, room, player.socketId));
    });

    console.log("Rematch started in room", roomCode);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    if (found.room.status === "waiting") {
      removeWaitingPlayer(socket, found.roomCode, found.room, found.player);
      return;
    }

    removeSocketFromRoom(socket, true);
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Rina's 2048 server running on port ${PORT}`);
});

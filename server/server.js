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
    status: "waiting",
    state: {
      grid: null,
      score: 0,
      highestTile: 0,
      boardValue: 0
    },
    eliminationSequence: null,
    placement: null
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
    status: player.status,
    score: Number(player.state && player.state.score || 0),
    highestTile: Number(player.state && player.state.highestTile || 0),
    placement: player.placement || null
  };
}

function roomProfiles(room) {
  return sortedPlayers(room).map(publicPlayer);
}


function isPowerOfTwo(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 2 && (n & (n - 1)) === 0;
}

function sanitizeGridSnapshot(rawGrid) {
  if (!rawGrid || Number(rawGrid.size) !== 4 || !Array.isArray(rawGrid.cells) || rawGrid.cells.length !== 4) {
    return null;
  }

  const cells = [];
  let highestTile = 0;
  let boardValue = 0;

  for (let x = 0; x < 4; x++) {
    if (!Array.isArray(rawGrid.cells[x]) || rawGrid.cells[x].length !== 4) return null;
    cells[x] = [];

    for (let y = 0; y < 4; y++) {
      const tile = rawGrid.cells[x][y];
      if (!tile) {
        cells[x][y] = null;
        continue;
      }

      const value = Number(tile.value);
      if (!isPowerOfTwo(value) || value > 1073741824) return null;

      highestTile = Math.max(highestTile, value);
      boardValue += value;
      cells[x][y] = {
        position: { x, y },
        value
      };
    }
  }

  return {
    grid: { size: 4, cells },
    highestTile,
    boardValue
  };
}

function gridHasLegalMove(grid) {
  if (!grid || !grid.cells) return true;

  for (let x = 0; x < 4; x++) {
    for (let y = 0; y < 4; y++) {
      const tile = grid.cells[x][y];
      if (!tile) return true;

      const right = x < 3 ? grid.cells[x + 1][y] : null;
      const down = y < 3 ? grid.cells[x][y + 1] : null;
      if ((right && right.value === tile.value) || (down && down.value === tile.value)) return true;
    }
  }

  return false;
}

function playerProgress(room, player) {
  const target = targetForPlayer(room, player.slot);
  if (!target) return 0;
  const highest = Math.max(2, Number(player.state && player.state.highestTile || 2));
  const currentStep = Math.max(0, Math.log2(highest) - 1);
  const totalSteps = Math.max(1, Math.log2(Math.max(4, target)) - 1);
  return Math.max(0, Math.min(1, currentStep / totalSteps));
}

function compareLivePlayers(room, a, b) {
  const progressDiff = playerProgress(room, b) - playerProgress(room, a);
  if (Math.abs(progressDiff) > 0.000001) return progressDiff;

  const highestDiff = Number(b.state && b.state.highestTile || 0) - Number(a.state && a.state.highestTile || 0);
  if (highestDiff) return highestDiff;

  const boardDiff = Number(b.state && b.state.boardValue || 0) - Number(a.state && a.state.boardValue || 0);
  if (boardDiff) return boardDiff;

  return a.slot - b.slot;
}

function raceState(room) {
  const active = sortedPlayers(room)
    .filter((player) => player.status === "active" || player.status === "winner")
    .sort((a, b) => compareLivePlayers(room, a, b));

  const rankById = new Map();
  active.forEach((player, index) => rankById.set(player.id, index + 1));

  (room.eliminationOrder || []).forEach((playerId, index) => {
    rankById.set(playerId, room.requiredPlayers - index);
  });

  return {
    leaderPlayerId: active.length ? active[0].id : null,
    players: sortedPlayers(room).map((player) => ({
      playerId: player.id,
      playerNumber: player.slot,
      nickname: player.nickname,
      status: player.status,
      connected: player.connected,
      highestTile: Number(player.state && player.state.highestTile || 0),
      score: Number(player.state && player.state.score || 0),
      progress: playerProgress(room, player),
      rank: player.placement || rankById.get(player.id) || null,
      targetTile: targetForPlayer(room, player.slot)
    }))
  };
}

function resetMatchPlayer(player) {
  player.status = "active";
  player.state = { grid: null, score: 0, highestTile: 0, boardValue: 0 };
  player.eliminationSequence = null;
  player.placement = null;
}

function finalizePlacements(room, winner) {
  const occupied = new Set();

  if (winner) {
    winner.status = "winner";
    winner.placement = 1;
    occupied.add(1);
  }

  (room.eliminationOrder || []).forEach((playerId, index) => {
    const player = room.players.find((entry) => entry.id === playerId);
    if (!player) return;
    const placement = room.requiredPlayers - index;
    player.placement = placement;
    occupied.add(placement);
  });

  const remaining = room.players
    .filter((player) => player !== winner && !player.placement)
    .sort((a, b) => compareLivePlayers(room, a, b));

  let next = 2;
  remaining.forEach((player) => {
    while (occupied.has(next)) next += 1;
    player.placement = next;
    occupied.add(next);
    next += 1;
  });

  return sortedPlayers(room)
    .slice()
    .sort((a, b) => Number(a.placement || 99) - Number(b.placement || 99))
    .map((player) => ({
      placement: player.placement,
      playerId: player.id,
      playerNumber: player.slot,
      nickname: player.nickname,
      score: Number(player.state && player.state.score || 0),
      highestTile: Number(player.state && player.state.highestTile || 0),
      status: player.status
    }));
}

function finishScalableMatch(roomCode, room, winner, reason) {
  if (room.status !== "playing" || room.winner !== null || !winner) return;

  room.status = "finished";
  room.winner = winner.slot;
  room.winnerPlayerId = winner.id;
  room.rematchVotes = [];
  const placements = finalizePlacements(room, winner);
  const payload = {
    winner: winner.slot,
    winnerPlayerId: winner.id,
    reason,
    mode: room.mode,
    targetTile: room.targetTile || null,
    targets: customTargetsObject(room),
    placements,
    raceState: raceState(room)
  };

  if (room.requiredPlayers === 2) {
    const loser = placements.find((entry) => entry.placement === 2);
    payload.loser = loser ? loser.playerNumber : null;
    io.to(roomCode).emit("gameWinner", payload);
  } else {
    io.to(roomCode).emit("matchFinished", payload);
  }

  console.log("Room", roomCode, "finished. Winner: Player", winner.slot, "Reason:", reason);
}

function eliminatePlayer(roomCode, room, player, reason) {
  if (!player || player.status !== "active" || room.mode === "freeplay") return false;

  player.status = reason === "forfeit" || reason === "disconnect" ? "forfeited" : "eliminated";
  if (!room.eliminationOrder.includes(player.id)) room.eliminationOrder.push(player.id);
  player.eliminationSequence = room.eliminationOrder.length;

  io.to(roomCode).emit("playerEliminated", {
    playerId: player.id,
    playerNumber: player.slot,
    nickname: player.nickname,
    reason,
    raceState: raceState(room)
  });

  const active = room.players.filter((entry) => entry.status === "active");
  if (active.length === 1) {
    finishScalableMatch(roomCode, room, active[0], "last-standing");
  }

  return true;
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
    gameplaySupported: room.requiredPlayers >= 2 && room.requiredPlayers <= 4,
    startAt: room.startAt || null,
    raceState: room.status === "playing" || room.status === "finished" ? raceState(room) : null,
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

  if (room.status === "countdown") {
    if (room.countdownTimer) clearTimeout(room.countdownTimer);
    room.countdownTimer = null;
    room.startAt = null;
    room.status = "waiting";
    socket.leave(roomCode);
    room.players = room.players.filter((entry) => entry.id !== player.id);
    transferHostIfNeeded(room);
    room.players.forEach((entry) => {
      entry.status = "waiting";
      if (!entry.isHost) entry.ready = false;
    });
    if (!room.players.length) rooms.delete(roomCode);
    else broadcastRoomState(roomCode, room);
    return;
  }

  socket.leave(roomCode);
  player.connected = false;

  if (room.status === "playing") {
    if (room.mode === "freeplay") {
      player.status = "left";
      io.to(roomCode).emit("playerLeftMatch", {
        playerId: player.id,
        playerNumber: player.slot,
        nickname: player.nickname,
        raceState: raceState(room)
      });
    } else {
      eliminatePlayer(roomCode, room, player, notifyOpponent ? "disconnect" : "forfeit");
    }

    if (!room.players.some((entry) => entry.connected)) rooms.delete(roomCode);
    return;
  }

  if (room.status === "finished" && !room.players.some((entry) => entry.connected)) {
    rooms.delete(roomCode);
  }
}

function finishRoom(roomCode, room, winnerNumber, reason, loserNumber) {
  const winner = room.players.find((player) => player.slot === Number(winnerNumber));
  finishScalableMatch(roomCode, room, winner, reason);
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
      winnerPlayerId: null,
      eliminationOrder: [],
      eventSequence: 0,
      startAt: null,
      countdownTimer: null,
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

    room.status = "countdown";
    room.winner = null;
    room.winnerPlayerId = null;
    room.eliminationOrder = [];
    room.rematchVotes = [];
    room.startAt = Date.now() + 3400;

    sortedPlayers(room).forEach((entry) => {
      resetMatchPlayer(entry);
      io.to(entry.socketId).emit("gameStart", roomPayload(roomCode, room, entry.socketId));
    });

    room.countdownTimer = setTimeout(() => {
      if (room.status !== "countdown") return;
      room.status = "playing";
      room.countdownTimer = null;
      io.to(roomCode).emit("matchStart", {
        roomCode,
        startAt: room.startAt,
        raceState: raceState(room)
      });
    }, Math.max(0, room.startAt - Date.now() - 120));

    console.log("Host started countdown for room", roomCode, "with", room.requiredPlayers, "players.");
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

    if (found.room.status === "waiting") {
      removeWaitingPlayer(socket, found.roomCode, found.room, found.player);
      return;
    }

    removeSocketFromRoom(socket, false);
  });

  socket.on("playerState", (state) => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;

    const { roomCode, room, player } = found;
    if (room.status !== "playing" || player.status !== "active") return;
    if (room.startAt && Date.now() + 30 < room.startAt) return;

    const sanitized = sanitizeGridSnapshot(state && state.grid);
    if (!sanitized) return;

    player.nickname = sanitizeNickname(state && state.nickname || player.nickname, `Player ${player.slot}`);
    player.state = {
      grid: sanitized.grid,
      score: Math.max(0, Math.floor(Number(state && state.score || 0))),
      highestTile: sanitized.highestTile,
      boardValue: sanitized.boardValue
    };

    const outbound = {
      playerNumber: player.slot,
      playerId: player.id,
      status: player.status,
      state: {
        grid: sanitized.grid,
        score: player.state.score,
        highestTile: player.state.highestTile,
        over: !!(state && state.over),
        won: !!(state && state.won),
        mode: room.mode,
        targetTile: room.targetTile || 0,
        ownTarget: targetForPlayer(room, player.slot) || 0,
        theme: player.theme,
        nickname: player.nickname,
        motion: state && state.motion || null
      }
    };

    socket.to(roomCode).emit("playerStateUpdate", outbound);
    if (room.requiredPlayers === 2) {
      socket.to(roomCode).emit("opponentState", outbound);
    }

    if (room.mode !== "freeplay") {
      const target = targetForPlayer(room, player.slot);
      if (target && sanitized.highestTile >= target) {
        finishScalableMatch(roomCode, room, player, "target");
        return;
      }

      if (!gridHasLegalMove(sanitized.grid)) {
        eliminatePlayer(roomCode, room, player, "board-stuck");
        return;
      }

      io.to(roomCode).emit("raceState", raceState(room));
    }
  });

  socket.on("reachedTarget", () => {
    // Outcome is derived from the authoritative sanitized playerState snapshot.
  });

  socket.on("playerEliminated", () => {
    const found = findRoomForSocket(socket.id);
    if (!found) return;
    const { roomCode, room, player } = found;
    if (room.status !== "playing" || room.mode === "freeplay") return;

    // The final state normally resolves this automatically. This event is a
    // fallback for a locked board whose last state has already been accepted.
    if (player.state && player.state.grid && !gridHasLegalMove(player.state.grid)) {
      eliminatePlayer(roomCode, room, player, "board-stuck");
    }
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
    room.winnerPlayerId = null;
    room.eliminationOrder = [];
    room.rematchVotes = [];

    sortedPlayers(room).forEach((player) => {
      resetMatchPlayer(player);
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

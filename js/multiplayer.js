(function () {
  "use strict";

  window.multiplayerMode = true;

  var socket = io("https://two048-battle-oc8k.onrender.com");

  function resetMultiplayerGame() {
  if (!window.multiplayerGame) {
    setTimeout(resetMultiplayerGame, 50);
    return;
  }

  window.multiplayerAllowRestart = true;
  window.multiplayerGame.restart();
  window.multiplayerAllowRestart = false;
}
  
  window.multiplayerSocket = socket;

  var gameContainer = document.querySelector(".container");
  var battleShell = null;
  var opponentGrid = null;
  var opponentScore = null;
  var opponentStatus = null;
  var latestOpponentState = null;

  gameContainer.style.display = "none";

  // -------------------------
  // LOBBY
  // -------------------------

  var lobby = document.createElement("div");
  lobby.id = "multiplayer-lobby";

  lobby.innerHTML =
    '<div class="lobby-box">' +
      '<h1>Rina\'s 2048</h1>' +
      '<p class="lobby-subtitle">First player to reach 2048 wins!</p>' +

      '<button id="create-game" class="lobby-button">' +
        'Create Game' +
      '</button>' +

      '<div class="lobby-divider">OR</div>' +

      '<input ' +
        'id="room-code" ' +
        'class="room-input" ' +
        'type="text" ' +
        'maxlength="6" ' +
        'placeholder="ROOM CODE" ' +
        'autocomplete="off">' +

      '<button id="join-game" class="lobby-button">' +
        'Join Game' +
      '</button>' +

      '<p id="lobby-status"></p>' +
    '</div>';

  document.body.insertBefore(lobby, document.body.firstChild);

  // -------------------------
  // STYLES
  // -------------------------

  var style = document.createElement("style");

  style.textContent =
    "#multiplayer-lobby {" +
      "min-height: 100vh;" +
      "display: flex;" +
      "align-items: center;" +
      "justify-content: center;" +
      "background: #faf8ef;" +
      "font-family: Arial, sans-serif;" +
      "box-sizing: border-box;" +
      "padding: 20px;" +
    "}" +

    ".lobby-box {" +
      "width: 100%;" +
      "max-width: 420px;" +
      "text-align: center;" +
      "background: #ffffff;" +
      "padding: 40px 30px;" +
      "border-radius: 12px;" +
      "box-sizing: border-box;" +
      "box-shadow: 0 4px 20px rgba(0,0,0,0.08);" +
    "}" +

    ".lobby-box h1 {" +
      "margin: 0 0 10px;" +
      "font-size: 52px;" +
      "font-weight: bold;" +
    "}" +

    ".lobby-subtitle {" +
      "margin: 0 0 30px;" +
      "font-size: 18px;" +
      "color: #666;" +
    "}" +

    ".lobby-button {" +
      "display: block;" +
      "width: 100%;" +
      "border: 0;" +
      "border-radius: 6px;" +
      "padding: 15px;" +
      "margin: 10px 0;" +
      "font-size: 18px;" +
      "font-weight: bold;" +
      "cursor: pointer;" +
      "background: #8f7a66;" +
      "color: white;" +
    "}" +

    ".lobby-divider {" +
      "margin: 20px 0;" +
      "color: #999;" +
      "font-size: 14px;" +
      "font-weight: bold;" +
    "}" +

    ".room-input {" +
      "width: 100%;" +
      "box-sizing: border-box;" +
      "padding: 14px;" +
      "border: 2px solid #ddd;" +
      "border-radius: 6px;" +
      "font-size: 20px;" +
      "text-align: center;" +
      "letter-spacing: 4px;" +
      "text-transform: uppercase;" +
      "outline: none;" +
    "}" +

    "#lobby-status {" +
      "min-height: 24px;" +
      "margin-top: 20px;" +
      "font-weight: bold;" +
    "}" +

    ".battle-shell {" +
      "max-width: 1100px;" +
      "margin: 30px auto;" +
      "padding: 0 20px;" +
      "box-sizing: border-box;" +
    "}" +

    ".battle-heading {" +
      "text-align: center;" +
      "margin-bottom: 25px;" +
      "font-family: Arial, sans-serif;" +
    "}" +

    ".battle-heading h1 {" +
      "margin: 0;" +
      "font-size: 42px;" +
    "}" +

    ".battle-heading p {" +
      "margin-top: 8px;" +
      "font-size: 18px;" +
      "font-weight: bold;" +
    "}" +

    ".battle-layout {" +
      "display: flex;" +
      "justify-content: center;" +
      "align-items: flex-start;" +
      "gap: 30px;" +
    "}" +

    ".battle-layout .container {" +
      "margin: 0;" +
    "}" +

    ".opponent-panel {" +
      "width: 500px;" +
      "box-sizing: border-box;" +
      "font-family: Arial, sans-serif;" +
    "}" +

    ".opponent-header {" +
      "display: flex;" +
      "justify-content: space-between;" +
      "align-items: center;" +
      "margin-bottom: 15px;" +
    "}" +

    ".opponent-header h2 {" +
      "margin: 0;" +
      "font-size: 30px;" +
    "}" +

    ".opponent-score-box {" +
      "background: #bbada0;" +
      "color: white;" +
      "padding: 10px 18px;" +
      "border-radius: 4px;" +
      "font-weight: bold;" +
      "text-align: center;" +
    "}" +

    ".opponent-score-label {" +
      "display: block;" +
      "font-size: 12px;" +
      "text-transform: uppercase;" +
    "}" +

    "#opponent-score {" +
      "display: block;" +
      "font-size: 22px;" +
    "}" +

    ".opponent-grid {" +
      "display: grid;" +
      "grid-template-columns: repeat(4, 1fr);" +
      "gap: 15px;" +
      "padding: 15px;" +
      "background: #bbada0;" +
      "border-radius: 6px;" +
      "box-sizing: border-box;" +
    "}" +

    ".opponent-cell {" +
      "aspect-ratio: 1 / 1;" +
      "background: rgba(238,228,218,0.35);" +
      "border-radius: 3px;" +
      "display: flex;" +
      "align-items: center;" +
      "justify-content: center;" +
      "font-size: 32px;" +
      "font-weight: bold;" +
      "color: #776e65;" +
    "}" +

    ".opponent-cell.has-tile {" +
      "background: #eee4da;" +
    "}" +

    ".opponent-cell.tile-4 {" +
      "background: #ede0c8;" +
    "}" +

    ".opponent-cell.tile-8 {" +
      "background: #f2b179;" +
      "color: #f9f6f2;" +
    "}" +

    ".opponent-cell.tile-16 {" +
      "background: #f59563;" +
      "color: #f9f6f2;" +
    "}" +

    ".opponent-cell.tile-32 {" +
      "background: #f67c5f;" +
      "color: #f9f6f2;" +
    "}" +

    ".opponent-cell.tile-64 {" +
      "background: #f65e3b;" +
      "color: #f9f6f2;" +
    "}" +

    ".opponent-cell.tile-128 {" +
      "background: #edcf72;" +
      "color: #f9f6f2;" +
      "font-size: 28px;" +
    "}" +

    ".opponent-cell.tile-256 {" +
      "background: #edcc61;" +
      "color: #f9f6f2;" +
      "font-size: 28px;" +
    "}" +

    ".opponent-cell.tile-512 {" +
      "background: #edc850;" +
      "color: #f9f6f2;" +
      "font-size: 28px;" +
    "}" +

    ".opponent-cell.tile-1024 {" +
      "background: #edc53f;" +
      "color: #f9f6f2;" +
      "font-size: 22px;" +
    "}" +

    ".opponent-cell.tile-2048 {" +
      "background: #edc22e;" +
      "color: #f9f6f2;" +
      "font-size: 22px;" +
    "}" +

    "#opponent-status {" +
      "text-align: center;" +
      "margin-top: 12px;" +
      "font-weight: bold;" +
      "min-height: 24px;" +
    "}" +
    ".battle-shell, .battle-shell * {" +
      "font-family: \"Clear Sans\", \"Helvetica Neue\", Arial, sans-serif;" +
    "}" +

    ".battle-layout .container .title {" +
      "display: none;" +
    "}" +

    ".battle-layout .container .above-game {" +
      "display: none;" +
    "}" +

    ".battle-layout .container > p," +
    ".battle-layout .container > hr {" +
      "display: none;" +
    "}" +

    ".battle-layout .container .heading {" +
      "display: flex;" +
      "align-items: center;" +
      "justify-content: space-between;" +
      "margin-bottom: 15px;" +
    "}" +

    ".battle-layout .container .heading:before {" +
      "content: \"You\";" +
      "font-size: 30px;" +
      "font-weight: bold;" +
      "color: #776e65;" +
    "}" +

    ".battle-layout .container .scores-container {" +
      "float: none;" +
      "margin-top: 0;" +
    "}" +

    ".battle-layout .container {" +
      "width: 500px;" +
      "max-width: 100%;" +
    "}" +

    ".opponent-panel {" +
      "width: 500px;" +
      "max-width: 100%;" +
    "}";
   "#battle-result {" +
      "position: fixed;" +
      "inset: 0;" +
      "z-index: 9999;" +
      "display: flex;" +
      "align-items: center;" +
      "justify-content: center;" +
      "background: rgba(250,248,239,0.94);" +
      "padding: 20px;" +
      "box-sizing: border-box;" +
    "}" +

    ".battle-result-box {" +
      "width: 100%;" +
      "max-width: 440px;" +
      "background: white;" +
      "border-radius: 14px;" +
      "padding: 45px 30px;" +
      "text-align: center;" +
      "box-shadow: 0 10px 40px rgba(0,0,0,0.15);" +
    "}" +

    ".battle-result-icon {" +
      "font-size: 65px;" +
      "margin-bottom: 10px;" +
    "}" +

    ".battle-result-box h1 {" +
      "font-size: 46px;" +
      "margin: 0 0 15px;" +
      "color: #776e65;" +
    "}" +

    ".battle-result-box p {" +
      "font-size: 19px;" +
      "margin-bottom: 28px;" +
      "color: #776e65;" +
    "}" +

    "#battle-back-lobby {" +
      "border: 0;" +
      "border-radius: 6px;" +
      "padding: 14px 24px;" +
      "background: #8f7a66;" +
      "color: white;" +
      "font-size: 18px;" +
      "font-weight: bold;" +
      "cursor: pointer;" +
    "}" +
    "@media (max-width: 1050px) {" +
      ".battle-layout {" +
        "flex-direction: column;" +
        "align-items: center;" +
      "}" +

      ".opponent-panel {" +
        "width: 500px;" +
        "max-width: 100%;" +
      "}" +
    "}" +

    "@media (max-width: 520px) {" +
      ".lobby-box {" +
        "padding: 30px 20px;" +
      "}" +

      ".lobby-box h1 {" +
        "font-size: 44px;" +
      "}" +

      ".battle-shell {" +
        "padding: 0 10px;" +
      "}" +

      ".opponent-grid {" +
        "gap: 10px;" +
        "padding: 10px;" +
      "}" +

      ".opponent-cell {" +
        "font-size: 24px;" +
      "}" +
    "}";

  document.head.appendChild(style);

  var createButton = document.getElementById("create-game");
  var joinButton = document.getElementById("join-game");
  var roomInput = document.getElementById("room-code");
  var status = document.getElementById("lobby-status");

  // -------------------------
  // BATTLE SCREEN
  // -------------------------

  function createBattleView() {
    if (battleShell) {
      return;
    }

    battleShell = document.createElement("div");
    battleShell.className = "battle-shell";

    var heading = document.createElement("div");
    heading.className = "battle-heading";

    heading.innerHTML =
     "<h1>Rina's 2048</h1>" +
      "<p>You are Player " +
      window.multiplayerPlayerNumber +
      " — first to reach 2048 wins!</p>";

    var layout = document.createElement("div");
    layout.className = "battle-layout";

    var opponentPanel = document.createElement("div");
    opponentPanel.className = "opponent-panel";

    opponentPanel.innerHTML =
      '<div class="opponent-header">' +
        '<h2>Opponent</h2>' +
        '<div class="opponent-score-box">' +
          '<span class="opponent-score-label">Score</span>' +
          '<span id="opponent-score">0</span>' +
        '</div>' +
      '</div>' +

      '<div id="opponent-grid" class="opponent-grid"></div>' +

      '<div id="opponent-status">' +
        'Waiting for opponent to make a move...' +
      '</div>';

    battleShell.appendChild(heading);
    battleShell.appendChild(layout);

    document.body.insertBefore(
      battleShell,
      gameContainer
    );

    layout.appendChild(gameContainer);
    layout.appendChild(opponentPanel);

    opponentGrid = document.getElementById("opponent-grid");
    opponentScore = document.getElementById("opponent-score");
    opponentStatus = document.getElementById("opponent-status");

    // Create 16 empty cells.
    for (var i = 0; i < 16; i++) {
      var cell = document.createElement("div");
      cell.className = "opponent-cell";
      opponentGrid.appendChild(cell);
    }

    if (latestOpponentState) {
      renderOpponentState(latestOpponentState);
    }
  }

  function renderOpponentState(state) {
    if (!opponentGrid || !state || !state.grid) {
      return;
    }

    var cells = opponentGrid.children;
    var cellIndex = 0;

    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        var cellElement = cells[cellIndex];
        var tile = state.grid.cells[x][y];

        cellElement.className = "opponent-cell";
        cellElement.textContent = "";

        if (tile) {
          cellElement.textContent = tile.value;
          cellElement.className =
            "opponent-cell has-tile tile-" + tile.value;
        }

        cellIndex++;
      }
    }

    opponentScore.textContent = state.score || 0;

    if (state.won) {
      opponentStatus.textContent =
        "Opponent reached 2048!";
    } else if (state.over) {
      opponentStatus.textContent =
        "Opponent has no moves left.";
    } else {
      opponentStatus.textContent =
        "Opponent is playing...";
    }
  }

  // -------------------------
  // LOBBY BUTTONS
  // -------------------------

  createButton.addEventListener("click", function () {
    status.textContent = "Creating game...";
    createButton.disabled = true;

    socket.emit("createRoom");
  });

  joinButton.addEventListener("click", function () {
    var roomCode = roomInput.value.trim().toUpperCase();

    if (roomCode.length !== 6) {
      status.textContent =
        "Please enter a 6-character room code.";
      return;
    }

    window.multiplayerRoomCode = roomCode;

    status.textContent = "Joining game...";
    joinButton.disabled = true;

    socket.emit("joinRoom", roomCode);
  });

  // -------------------------
  // SOCKET EVENTS
  // -------------------------

  socket.on("roomCreated", function (data) {
    var roomCode = data.roomCode;

    window.multiplayerPlayerNumber = data.playerNumber;
    window.multiplayerRoomCode = roomCode;

    status.innerHTML =
      "Your room code is:<br>" +
      "<strong style=\"font-size:32px;letter-spacing:5px;\">" +
      roomCode +
      "</strong><br><br>" +
      "You are Player 1.<br>" +
      "Send this code to your opponent.<br>" +
      "Waiting for them to join...";

    createButton.disabled = true;
  });

  socket.on("joinError", function (message) {
    status.textContent = message;
    joinButton.disabled = false;
  });

  socket.on("gameStart", function (data) {
    window.multiplayerPlayerNumber = data.playerNumber;
    window.multiplayerGameOver = false;

resetMultiplayerGame();
// Multiplayer matches always start with a fresh board.

    status.textContent =
      "Opponent found! You are Player " +
      data.playerNumber +
      ". Starting game...";

    setTimeout(function () {
      createBattleView();

      lobby.style.display = "none";
      gameContainer.style.display = "";
    }, 1000);
  });

  socket.on("opponentState", function (data) {
    latestOpponentState = data.state;

    renderOpponentState(data.state);
  });

  socket.on("opponentDisconnected", function () {
    if (opponentStatus) {
      opponentStatus.textContent =
        "Opponent disconnected.";
    }
  });

  socket.on("rematchWaiting", function () {
  console.log(
    "Waiting for opponent to accept rematch."
  );
});

socket.on("rematchStart", function () {
  window.multiplayerGameOver = false;

  var result = document.getElementById("battle-result");

  if (result) {
    result.remove();
  }

  latestOpponentState = null;

  if (opponentScore) {
    opponentScore.textContent = "0";
  }

  if (opponentStatus) {
    opponentStatus.textContent =
      "Waiting for opponent to make a move...";
  }

  if (opponentGrid) {
    var cells = opponentGrid.children;

    for (var i = 0; i < cells.length; i++) {
      cells[i].className = "opponent-cell";
      cells[i].textContent = "";
    }
  }

 resetMultiplayerGame();
});
  
socket.on("gameWinner", function (data) {
  window.multiplayerGameOver = true;

  var didWin =
    data.winner === window.multiplayerPlayerNumber;

  // Prevent duplicate result screens.
  var oldResult = document.getElementById("battle-result");

  if (oldResult) {
    oldResult.remove();
  }

  var overlay = document.createElement("div");
  overlay.id = "battle-result";

  overlay.style.position = "fixed";
  overlay.style.top = "0";
  overlay.style.left = "0";
  overlay.style.right = "0";
  overlay.style.bottom = "0";
  overlay.style.zIndex = "99999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(40, 36, 32, 0.72)";
  overlay.style.padding = "20px";
  overlay.style.boxSizing = "border-box";

  var box = document.createElement("div");

  box.style.width = "100%";
  box.style.maxWidth = "420px";
  box.style.background = "#faf8ef";
  box.style.borderRadius = "12px";
  box.style.padding = "42px 30px";
  box.style.boxSizing = "border-box";
  box.style.textAlign = "center";
  box.style.boxShadow = "0 16px 50px rgba(0,0,0,0.30)";
  box.style.fontFamily =
    '"Clear Sans", "Helvetica Neue", Arial, sans-serif';
  box.style.color = "#776e65";

  var icon = document.createElement("div");
  icon.textContent = didWin ? "🏆" : "💥";
  icon.style.fontSize = "64px";
  icon.style.marginBottom = "12px";

  var title = document.createElement("h1");
  title.textContent = didWin ? "YOU WIN!" : "YOU LOSE";
  title.style.fontSize = "44px";
  title.style.margin = "0 0 14px";
  title.style.color = "#776e65";

  var description = document.createElement("p");
  description.textContent = didWin
    ? "You were first to reach 2048!"
    : "Your opponent reached 2048 first.";

  description.style.fontSize = "18px";
  description.style.lineHeight = "1.5";
  description.style.margin = "0 0 28px";

  var rematchButton = document.createElement("button");
rematchButton.textContent = "Rematch";

rematchButton.style.border = "0";
rematchButton.style.borderRadius = "6px";
rematchButton.style.padding = "14px 24px";
rematchButton.style.background = "#edc22e";
rematchButton.style.color = "#ffffff";
rematchButton.style.fontSize = "17px";
rematchButton.style.fontWeight = "bold";
rematchButton.style.cursor = "pointer";
rematchButton.style.marginRight = "10px";

rematchButton.addEventListener("click", function () {
  rematchButton.disabled = true;
  rematchButton.textContent = "Waiting...";

  socket.emit("requestRematch");
});
  
  var button = document.createElement("button");
  button.textContent = "Back to Lobby";

  button.style.border = "0";
  button.style.borderRadius = "6px";
  button.style.padding = "14px 24px";
  button.style.background = "#8f7a66";
  button.style.color = "#ffffff";
  button.style.fontSize = "17px";
  button.style.fontWeight = "bold";
  button.style.cursor = "pointer";

  button.addEventListener("click", function () {
    window.location.href =
      "https://lydiatar.github.io/2048-battle/?v=7";
  });

 box.appendChild(icon);
box.appendChild(title);
box.appendChild(description);
box.appendChild(rematchButton);
box.appendChild(button);

  overlay.appendChild(box);
  document.body.appendChild(overlay);
});
  socket.on("connect", function () {
    console.log(
      "Connected to 2048 Battle server."
    );
  });

  socket.on("disconnect", function () {
    console.log(
      "Disconnected from 2048 Battle server."
    );
  });
})();

(function () {
  "use strict";

  var socket = io("https://two048-battle-oc8k.onrender.com");
window.multiplayerSocket = socket;
  var gameContainer = document.querySelector(".container");

  gameContainer.style.display = "none";

  var lobby = document.createElement("div");
  lobby.id = "multiplayer-lobby";

  lobby.innerHTML =
    '<div class="lobby-box">' +
      '<h1>2048 Battle</h1>' +
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
      "box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);" +
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

    ".lobby-button:hover {" +
      "opacity: 0.9;" +
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

    ".room-input:focus {" +
      "border-color: #8f7a66;" +
    "}" +

    "#lobby-status {" +
      "min-height: 24px;" +
      "margin-top: 20px;" +
      "font-weight: bold;" +
    "}" +

    "@media (max-width: 520px) {" +
      ".lobby-box {" +
        "padding: 30px 20px;" +
      "}" +

      ".lobby-box h1 {" +
        "font-size: 44px;" +
      "}" +
    "}";

  document.head.appendChild(style);

  var createButton = document.getElementById("create-game");
  var joinButton = document.getElementById("join-game");
  var roomInput = document.getElementById("room-code");
  var status = document.getElementById("lobby-status");

  createButton.addEventListener("click", function () {
    status.textContent = "Creating game...";
    createButton.disabled = true;

    socket.emit("createRoom");
  });

  joinButton.addEventListener("click", function () {
    var roomCode = roomInput.value.trim().toUpperCase();

    if (roomCode.length !== 6) {
      status.textContent = "Please enter a 6-character room code.";
      return;
    }

    status.textContent = "Joining game...";
    joinButton.disabled = true;

    socket.emit("joinRoom", roomCode);
  });

 socket.on("roomCreated", function (data) {
  var roomCode = data.roomCode;

  window.multiplayerPlayerNumber = data.playerNumber;
  window.multiplayerRoomCode = roomCode;

  status.innerHTML =
    "Your room code is:<br>" +
    "<strong style=\"font-size: 32px; letter-spacing: 5px;\">" +
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

  status.textContent =
    "Opponent found! You are Player " +
    data.playerNumber +
    ". Starting game...";

  setTimeout(function () {
    lobby.style.display = "none";
    gameContainer.style.display = "";
  }, 1000);
});

  socket.on("connect", function () {
    console.log("Connected to 2048 Battle server.");
  });

  socket.on("disconnect", function () {
    console.log("Disconnected from 2048 Battle server.");
  });
  socket.on("gameWinner", function (data) {
  var message;

  if (data.winner === window.multiplayerPlayerNumber) {
    message = "YOU WIN! 🎉";
  } else {
    message = "YOU LOSE!";
  }

  alert(message);
});
})();

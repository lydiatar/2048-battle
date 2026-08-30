(function () {
  "use strict";

  window.multiplayerMode = true;

  var socket = io(
    "https://two048-battle-oc8k.onrender.com"
  );

  window.multiplayerSocket = socket;

  var gameContainer =
    document.querySelector(".container");

  var battleShell = null;
  var opponentGrid = null;
  var opponentScore = null;
  var opponentHighest = null;
  var opponentStatus = null;
  var ownSecondChance = null;
  var opponentSecondChance = null;
  var latestOpponentState = null;

  gameContainer.style.display = "none";


  // =========================================================
  // RESET GAME
  // =========================================================

  function resetMultiplayerGame() {
    if (!window.multiplayerGame) {
      setTimeout(
        resetMultiplayerGame,
        50
      );

      return;
    }

    window.multiplayerAllowRestart = true;

    window.multiplayerGame.restart();

    window.multiplayerAllowRestart = false;
  }


  // =========================================================
  // SECOND CHANCE
  // =========================================================

  function updateOwnSecondChanceUI() {
    if (!ownSecondChance) {
      return;
    }

    if (
      window.multiplayerSecondChanceUsed
    ) {
      ownSecondChance.textContent =
        "🛟 Second Chance: USED";

      ownSecondChance.className =
        "chance-badge used";
    } else {
      ownSecondChance.textContent =
        "🛟 Second Chance: AVAILABLE";

      ownSecondChance.className =
        "chance-badge available";
    }
  }


  function updateOpponentSecondChanceUI(
    used
  ) {
    if (!opponentSecondChance) {
      return;
    }

    if (used) {
      opponentSecondChance.textContent =
        "🛟 USED";

      opponentSecondChance.className =
        "chance-badge used compact";
    } else {
      opponentSecondChance.textContent =
        "🛟 AVAILABLE";

      opponentSecondChance.className =
        "chance-badge available compact";
    }
  }


  window.showSecondChanceUsed =
    function (removedValue) {

      updateOwnSecondChanceUI();

      var existing =
        document.getElementById(
          "second-chance-toast"
        );

      if (existing) {
        existing.remove();
      }

      var toast =
        document.createElement("div");

      toast.id =
        "second-chance-toast";

      var detail =
        removedValue
          ? "A " +
            removedValue +
            " tile was cleared. Keep going!"
          : "One of your lowest tiles was cleared. Keep going!";

      toast.innerHTML =
        "<strong>🛟 SECOND CHANCE ACTIVATED</strong><br>" +
        detail;

      document.body.appendChild(
        toast
      );

      setTimeout(function () {
        if (toast.parentNode) {
          toast.remove();
        }
      }, 3000);
    };


  // =========================================================
  // HIGHEST TILE
  // =========================================================

  function getHighestTile(grid) {
    if (!grid || !grid.cells) {
      return 0;
    }

    var highest = 0;

    for (
      var x = 0;
      x < grid.cells.length;
      x++
    ) {
      for (
        var y = 0;
        y < grid.cells[x].length;
        y++
      ) {
        var tile =
          grid.cells[x][y];

        if (
          tile &&
          tile.value > highest
        ) {
          highest = tile.value;
        }
      }
    }

    return highest;
  }


  // =========================================================
  // LOBBY
  // =========================================================

  var lobby =
    document.createElement("div");

  lobby.id =
    "multiplayer-lobby";

  lobby.innerHTML = `
    <div class="lobby-box">

      <h1>Rina's 2048</h1>

      <p class="lobby-subtitle">
        Race your friend to 2048.
      </p>

      <div class="rules-card">

        <strong>
          Race Rules
        </strong>

        <ul>

          <li>
            First player to make a 2048 tile wins.
          </li>

          <li>
            Each player gets one automatic Second Chance.
          </li>

          <li>
            If your board gets stuck, your Second Chance
            clears one of your lowest-value tiles.
          </li>

          <li>
            If you run out of moves again,
            you're eliminated.
          </li>

          <li>
            Score does not decide the winner.
          </li>

        </ul>

      </div>

      <button
        id="create-game"
        class="lobby-button"
      >
        Create Game
      </button>

      <div class="lobby-divider">
        OR
      </div>

      <input
        id="room-code"
        class="room-input"
        type="text"
        maxlength="6"
        placeholder="ROOM CODE"
        autocomplete="off"
      >

      <button
        id="join-game"
        class="lobby-button"
      >
        Join Game
      </button>

      <p id="lobby-status"></p>

    </div>
  `;

  document.body.insertBefore(
    lobby,
    document.body.firstChild
  );


  // =========================================================
  // STYLES
  // =========================================================

  var style =
    document.createElement("style");

  style.textContent = `

    #multiplayer-lobby {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;

      background: #faf8ef;

      font-family:
        "Clear Sans",
        "Helvetica Neue",
        Arial,
        sans-serif;

      box-sizing: border-box;

      padding: 20px;
    }


    .lobby-box {
      width: 100%;
      max-width: 470px;

      text-align: center;

      background: #ffffff;

      padding: 36px 30px;

      border-radius: 12px;

      box-sizing: border-box;

      box-shadow:
        0 4px 20px
        rgba(0, 0, 0, 0.08);
    }


    .lobby-box h1 {
      margin: 0 0 8px;

      font-size: 50px;
      font-weight: bold;

      color: #776e65;
    }


    .lobby-subtitle {
      margin: 0 0 20px;

      font-size: 18px;

      color: #776e65;
    }


    .rules-card {
      margin: 0 0 24px;

      padding: 16px 18px;

      background: #f3efe6;

      border-radius: 8px;

      text-align: left;

      color: #776e65;

      font-size: 14px;

      line-height: 1.45;
    }


    .rules-card strong {
      display: block;

      margin-bottom: 6px;

      font-size: 16px;
    }


    .rules-card ul {
      margin: 0;

      padding-left: 20px;
    }


    .lobby-button {
      display: block;

      width: 100%;

      border: 0;

      border-radius: 6px;

      padding: 15px;

      margin: 10px 0;

      font-size: 18px;
      font-weight: bold;

      cursor: pointer;

      background: #8f7a66;

      color: white;
    }


    .lobby-button:disabled {
      opacity: 0.6;

      cursor: default;
    }


    .lobby-divider {
      margin: 18px 0;

      color: #999;

      font-size: 13px;
      font-weight: bold;
    }


    .room-input {
      width: 100%;

      box-sizing: border-box;

      padding: 14px;

      border: 2px solid #ddd;

      border-radius: 6px;

      font-size: 20px;

      text-align: center;

      letter-spacing: 4px;

      text-transform: uppercase;

      outline: none;
    }


    .room-input:focus {
      border-color: #8f7a66;
    }


    #lobby-status {
      min-height: 24px;

      margin-top: 18px;

      font-weight: bold;

      color: #776e65;
    }


    /* =======================================================
       BATTLE SCREEN
       ======================================================= */

    .battle-shell,
    .battle-shell * {
      font-family:
        "Clear Sans",
        "Helvetica Neue",
        Arial,
        sans-serif;
    }


    .battle-shell {
      max-width: 920px;

      margin: 24px auto;

      padding: 0 18px;

      box-sizing: border-box;
    }


    .battle-heading {
      text-align: center;

      margin-bottom: 20px;

      color: #776e65;
    }


    .battle-heading h1 {
      margin: 0;

      font-size: 42px;
    }


    .battle-meta {
      display: flex;

      justify-content: center;
      align-items: center;

      gap: 10px;

      flex-wrap: wrap;

      margin-top: 8px;

      font-size: 14px;
      font-weight: bold;
    }


    .room-badge {
      background: #bbada0;

      color: #ffffff;

      border-radius: 6px;

      padding: 7px 10px;

      letter-spacing: 1px;
    }


    .mode-badge {
      background: #eee4da;

      color: #776e65;

      border-radius: 6px;

      padding: 7px 10px;
    }


    .battle-rule-line {
      max-width: 720px;

      margin: 9px auto 0;

      font-size: 14px;

      font-weight: normal;

      line-height: 1.4;
    }


    .battle-layout {
      display: flex;

      justify-content: center;
      align-items: flex-start;

      gap: 24px;
    }


    /* =======================================================
       YOUR SIDE
       ======================================================= */

    .own-panel {
      width: 500px;
      max-width: 100%;

      min-width: 0;
    }


    .battle-layout .container {
      width: 500px;
      max-width: 100%;

      margin: 0;
    }


    .battle-layout .container .title,
    .battle-layout .container .above-game,
    .battle-layout .container > p,
    .battle-layout .container > hr {
      display: none;
    }


    .battle-layout .container .heading {
      display: flex;

      align-items: center;
      justify-content: space-between;

      margin-bottom: 8px;
    }


    .battle-layout .container .heading:before {
      content: "You";

      font-size: 30px;
      font-weight: bold;

      color: #776e65;
    }


    .battle-layout .container .scores-container {
      float: none;

      margin-top: 0;
    }


    /*
     * Change original 2048 BEST
     * label to HIGHEST.
     */

    .battle-layout .container .best-container:after {
      content: "Highest" !important;

      font-size: 10px;
    }


    /*
     * Your Second Chance sits
     * directly below YOU + stats.
     */

    .own-status-row {
      display: flex;

      justify-content: flex-start;

      margin: 0 0 12px;
    }


    /* =======================================================
       SECOND CHANCE BADGES
       ======================================================= */

    .chance-badge {
      display: inline-block;

      border-radius: 999px;

      padding: 7px 10px;

      font-size: 12px;
      font-weight: bold;

      white-space: nowrap;
    }


    .chance-badge.available {
      background: #eee4da;

      color: #776e65;
    }


    .chance-badge.used {
      background: #bbada0;

      color: #ffffff;
    }


    .chance-badge.compact {
      padding: 6px 8px;

      font-size: 11px;
    }


    /* =======================================================
       OPPONENT
       ======================================================= */

    .opponent-panel {
      width: 280px;
      max-width: 100%;

      box-sizing: border-box;

      color: #776e65;
    }


    .opponent-header {
      display: flex;

      justify-content: space-between;
      align-items: flex-start;

      gap: 8px;

      margin-bottom: 10px;
    }


    .opponent-header h2 {
      margin: 0;

      font-size: 24px;
    }


    .opponent-stats {
      display: flex;

      gap: 6px;
    }


    .opponent-stat-box {
      min-width: 58px;

      background: #bbada0;

      color: white;

      padding: 7px 8px;

      border-radius: 4px;

      font-weight: bold;

      text-align: center;

      box-sizing: border-box;
    }


    .opponent-stat-label {
      display: block;

      font-size: 9px;

      text-transform: uppercase;
    }


    .opponent-stat-value {
      display: block;

      font-size: 17px;
    }


    /*
     * Opponent's Second Chance
     * sits directly under Opponent.
     */

    .opponent-chance-row {
      display: flex;

      justify-content: flex-start;

      margin-bottom: 8px;
    }


    .opponent-grid {
      display: grid;

      grid-template-columns:
        repeat(4, 1fr);

      gap: 8px;

      padding: 8px;

      background: #bbada0;

      border-radius: 6px;

      box-sizing: border-box;
    }


    .opponent-cell {
      aspect-ratio: 1 / 1;

      background:
        rgba(
          238,
          228,
          218,
          0.35
        );

      border-radius: 3px;

      display: flex;

      align-items: center;
      justify-content: center;

      font-size: 20px;
      font-weight: bold;

      color: #776e65;
    }


    .opponent-cell.has-tile {
      background: #eee4da;
    }


    .opponent-cell.tile-4 {
      background: #ede0c8;
    }


    .opponent-cell.tile-8 {
      background: #f2b179;
      color: #f9f6f2;
    }


    .opponent-cell.tile-16 {
      background: #f59563;
      color: #f9f6f2;
    }


    .opponent-cell.tile-32 {
      background: #f67c5f;
      color: #f9f6f2;
    }


    .opponent-cell.tile-64 {
      background: #f65e3b;
      color: #f9f6f2;
    }


    .opponent-cell.tile-128 {
      background: #edcf72;
      color: #f9f6f2;

      font-size: 17px;
    }


    .opponent-cell.tile-256 {
      background: #edcc61;
      color: #f9f6f2;

      font-size: 17px;
    }


    .opponent-cell.tile-512 {
      background: #edc850;
      color: #f9f6f2;

      font-size: 17px;
    }


    .opponent-cell.tile-1024 {
      background: #edc53f;
      color: #f9f6f2;

      font-size: 14px;
    }


    .opponent-cell.tile-2048 {
      background: #edc22e;
      color: #f9f6f2;

      font-size: 14px;
    }


    #opponent-status {
      text-align: center;

      margin-top: 9px;

      font-weight: bold;

      min-height: 20px;

      font-size: 12px;
    }


    /* =======================================================
       SECOND CHANCE POPUP
       ======================================================= */

    #second-chance-toast {
      position: fixed;

      top: 25px;
      left: 50%;

      transform:
        translateX(-50%);

      z-index: 100000;

      background: #8f7a66;

      color: white;

      padding: 14px 22px;

      border-radius: 8px;

      text-align: center;

      font-weight: bold;

      box-shadow:
        0 6px 20px
        rgba(0, 0, 0, 0.25);
    }


    /* =======================================================
       RESULT POPUP
       ======================================================= */

    #battle-result {
      position: fixed;

      inset: 0;

      z-index: 99999;

      display: flex;

      align-items: center;
      justify-content: center;

      background:
        rgba(
          40,
          36,
          32,
          0.72
        );

      padding: 20px;

      box-sizing: border-box;
    }


    .battle-result-box {
      width: 100%;
      max-width: 420px;

      background: #faf8ef;

      border-radius: 12px;

      padding: 42px 30px;

      box-sizing: border-box;

      text-align: center;

      box-shadow:
        0 16px 50px
        rgba(0, 0, 0, 0.30);

      color: #776e65;
    }


    .battle-result-icon {
      font-size: 64px;

      margin-bottom: 12px;
    }


    .battle-result-box h1 {
      font-size: 44px;

      margin: 0 0 14px;

      color: #776e65;
    }


    .battle-result-box p {
      font-size: 18px;

      line-height: 1.5;

      margin: 0 0 28px;
    }


    .battle-result-actions {
      display: flex;

      justify-content: center;

      gap: 10px;

      flex-wrap: wrap;
    }


    .battle-result-actions button {
      border: 0;

      border-radius: 6px;

      padding: 14px 22px;

      color: #ffffff;

      font-size: 17px;
      font-weight: bold;

      cursor: pointer;
    }


    .rematch-button {
      background: #edc22e;
    }


    .lobby-return-button {
      background: #8f7a66;
    }


    /* =======================================================
       RESPONSIVE
       ======================================================= */

    @media (max-width: 850px) {

      .battle-layout {
        flex-direction: column;

        align-items: center;
      }


      .opponent-panel {
        width: 280px;
      }

    }


    @media (max-width: 520px) {

      .lobby-box {
        padding: 28px 18px;
      }


      .lobby-box h1 {
        font-size: 42px;
      }


      .battle-shell {
        padding: 0 10px;
      }


      .battle-heading h1 {
        font-size: 34px;
      }


      .own-panel,
      .battle-layout .container {
        width: 100%;
      }


      .opponent-panel {
        width: 235px;
      }


      .opponent-cell {
        font-size: 17px;
      }

    }

  `;


  document.head.appendChild(
    style
  );


  // =========================================================
  // LOBBY ELEMENTS
  // =========================================================

  var createButton =
    document.getElementById(
      "create-game"
    );

  var joinButton =
    document.getElementById(
      "join-game"
    );

  var roomInput =
    document.getElementById(
      "room-code"
    );

  var status =
    document.getElementById(
      "lobby-status"
    );


  // =========================================================
  // CREATE BATTLE VIEW
  // =========================================================

  function createBattleView() {

    if (battleShell) {
      updateOwnSecondChanceUI();

      return;
    }


    battleShell =
      document.createElement("div");

    battleShell.className =
      "battle-shell";


    var heading =
      document.createElement("div");

    heading.className =
      "battle-heading";


    heading.innerHTML = `

      <h1>
        Rina's 2048
      </h1>

      <div class="battle-meta">

        <span class="mode-badge">
          Player ${window.multiplayerPlayerNumber}
        </span>

        <span class="room-badge">
          Room ${window.multiplayerRoomCode || "------"}
        </span>

      </div>

      <p class="battle-rule-line">

        First to 2048 wins.
        If you get stuck, your Second Chance clears one low tile.
        Get stuck again = elimination.

      </p>

    `;


    var layout =
      document.createElement("div");

    layout.className =
      "battle-layout";


    // -------------------------
    // YOUR PANEL
    // -------------------------

    var ownPanel =
      document.createElement("div");

    ownPanel.className =
      "own-panel";


    var ownStatusRow =
      document.createElement("div");

    ownStatusRow.className =
      "own-status-row";


    ownSecondChance =
      document.createElement("span");


    ownStatusRow.appendChild(
      ownSecondChance
    );


    // -------------------------
    // OPPONENT PANEL
    // -------------------------

    var opponentPanel =
      document.createElement("div");

    opponentPanel.className =
      "opponent-panel";


    opponentPanel.innerHTML = `

      <div class="opponent-header">

        <h2>
          Opponent
        </h2>

        <div class="opponent-stats">

          <div class="opponent-stat-box">

            <span class="opponent-stat-label">
              Score
            </span>

            <span
              id="opponent-score"
              class="opponent-stat-value"
            >
              0
            </span>

          </div>

          <div class="opponent-stat-box">

            <span class="opponent-stat-label">
              Highest
            </span>

            <span
              id="opponent-highest"
              class="opponent-stat-value"
            >
              0
            </span>

          </div>

        </div>

      </div>


      <div class="opponent-chance-row">

        <span
          id="opponent-second-chance"
          class="chance-badge available compact"
        >
          🛟 AVAILABLE
        </span>

      </div>


      <div
        id="opponent-grid"
        class="opponent-grid"
      ></div>


      <div id="opponent-status">

        Waiting for opponent to make a move...

      </div>

    `;


    /*
     * Build shell first.
     */

    battleShell.appendChild(
      heading
    );

    battleShell.appendChild(
      layout
    );

    document.body.appendChild(
      battleShell
    );


    layout.appendChild(
      ownPanel
    );

    layout.appendChild(
      opponentPanel
    );


    /*
     * Move original 2048 game
     * into your panel.
     */

    ownPanel.appendChild(
      gameContainer
    );


    /*
     * Put Second Chance directly
     * below the YOU + stats heading.
     */

    var ownHeading =
      gameContainer.querySelector(
        ".heading"
      );


    if (
      ownHeading &&
      ownHeading.nextSibling
    ) {

      gameContainer.insertBefore(
        ownStatusRow,
        ownHeading.nextSibling
      );

    } else if (ownHeading) {

      gameContainer.appendChild(
        ownStatusRow
      );

    } else {

      ownPanel.insertBefore(
        ownStatusRow,
        gameContainer
      );
    }


    opponentGrid =
      document.getElementById(
        "opponent-grid"
      );

    opponentScore =
      document.getElementById(
        "opponent-score"
      );

    opponentHighest =
      document.getElementById(
        "opponent-highest"
      );

    opponentStatus =
      document.getElementById(
        "opponent-status"
      );

    opponentSecondChance =
      document.getElementById(
        "opponent-second-chance"
      );


    for (
      var i = 0;
      i < 16;
      i++
    ) {

      var cell =
        document.createElement("div");

      cell.className =
        "opponent-cell";

      opponentGrid.appendChild(
        cell
      );
    }


    updateOwnSecondChanceUI();

    updateOpponentSecondChanceUI(
      false
    );


    if (latestOpponentState) {

      renderOpponentState(
        latestOpponentState
      );
    }
  }


  // =========================================================
  // RENDER OPPONENT
  // =========================================================

  function renderOpponentState(
    state
  ) {

    if (
      !opponentGrid ||
      !state ||
      !state.grid
    ) {
      return;
    }


    var cells =
      opponentGrid.children;

    var cellIndex = 0;


    for (
      var y = 0;
      y < 4;
      y++
    ) {

      for (
        var x = 0;
        x < 4;
        x++
      ) {

        var cellElement =
          cells[cellIndex];

        var tile =
          state.grid.cells[x][y];


        cellElement.className =
          "opponent-cell";

        cellElement.textContent =
          "";


        if (tile) {

          cellElement.textContent =
            tile.value;

          cellElement.className =
            "opponent-cell has-tile tile-" +
            tile.value;
        }


        cellIndex++;
      }
    }


    opponentScore.textContent =
      state.score || 0;


    opponentHighest.textContent =
      state.highestTile ||
      getHighestTile(
        state.grid
      );


    updateOpponentSecondChanceUI(
      !!state.secondChanceUsed
    );


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


  // =========================================================
  // RESET OPPONENT
  // =========================================================

  function resetOpponentView() {

    latestOpponentState =
      null;


    if (opponentScore) {
      opponentScore.textContent =
        "0";
    }


    if (opponentHighest) {
      opponentHighest.textContent =
        "0";
    }


    if (opponentStatus) {

      opponentStatus.textContent =
        "Waiting for opponent to make a move...";
    }


    updateOpponentSecondChanceUI(
      false
    );


    if (opponentGrid) {

      var cells =
        opponentGrid.children;


      for (
        var i = 0;
        i < cells.length;
        i++
      ) {

        cells[i].className =
          "opponent-cell";

        cells[i].textContent =
          "";
      }
    }
  }


  // =========================================================
  // CREATE ROOM
  // =========================================================

  createButton.addEventListener(
    "click",
    function () {

      status.textContent =
        "Creating game...";

      createButton.disabled =
        true;

      socket.emit(
        "createRoom"
      );
    }
  );


  // =========================================================
  // JOIN ROOM
  // =========================================================

  joinButton.addEventListener(
    "click",
    function () {

      var roomCode =
        roomInput
          .value
          .trim()
          .toUpperCase();


      if (
        roomCode.length !== 6
      ) {

        status.textContent =
          "Please enter a 6-character room code.";

        return;
      }


      window.multiplayerRoomCode =
        roomCode;


      status.textContent =
        "Joining game...";

      joinButton.disabled =
        true;


      socket.emit(
        "joinRoom",
        roomCode
      );
    }
  );


  // =========================================================
  // ROOM CREATED
  // =========================================================

  socket.on(
    "roomCreated",
    function (data) {

      var roomCode =
        data.roomCode;


      window.multiplayerPlayerNumber =
        data.playerNumber;

      window.multiplayerRoomCode =
        roomCode;


      status.innerHTML =

        "Your room code is:<br>" +

        '<strong style="' +
        'font-size:32px;' +
        'letter-spacing:5px;' +
        '">' +

        roomCode +

        "</strong><br><br>" +

        "You are Player 1.<br>" +

        "Send this code to your opponent.<br>" +

        "Waiting for them to join...";


      createButton.disabled =
        true;
    }
  );


  // =========================================================
  // JOIN ERROR
  // =========================================================

  socket.on(
    "joinError",
    function (message) {

      status.textContent =
        message;

      joinButton.disabled =
        false;
    }
  );


  // =========================================================
  // GAME START
  // =========================================================

  socket.on(
    "gameStart",
    function (data) {

      window.multiplayerPlayerNumber =
        data.playerNumber;

      window.multiplayerGameOver =
        false;

      window.multiplayerSecondChanceUsed =
        false;


      resetMultiplayerGame();


      status.textContent =

        "Opponent found! You are Player " +

        data.playerNumber +

        ". Starting game...";


      setTimeout(
        function () {

          createBattleView();

          updateOwnSecondChanceUI();

          lobby.style.display =
            "none";

          gameContainer.style.display =
            "";

        },
        700
      );
    }
  );


  // =========================================================
  // OPPONENT STATE
  // =========================================================

  socket.on(
    "opponentState",
    function (data) {

      latestOpponentState =
        data.state;

      renderOpponentState(
        data.state
      );
    }
  );


  // =========================================================
  // DISCONNECT
  // =========================================================

  socket.on(
    "opponentDisconnected",
    function () {

      if (opponentStatus) {

        opponentStatus.textContent =
          "Opponent disconnected.";
      }
    }
  );


  // =========================================================
  // REMATCH
  // =========================================================

  socket.on(
    "rematchWaiting",
    function () {

      console.log(
        "Waiting for opponent to accept rematch."
      );
    }
  );


  socket.on(
    "rematchStart",
    function () {

      window.multiplayerGameOver =
        false;

      window.multiplayerSecondChanceUsed =
        false;


      var result =
        document.getElementById(
          "battle-result"
        );


      if (result) {
        result.remove();
      }


      resetOpponentView();

      updateOwnSecondChanceUI();

      resetMultiplayerGame();
    }
  );


  // =========================================================
  // WIN / LOSE
  // =========================================================

  socket.on(
    "gameWinner",
    function (data) {

      window.multiplayerGameOver =
        true;


      var didWin =
        data.winner ===
        window.multiplayerPlayerNumber;


      var oldResult =
        document.getElementById(
          "battle-result"
        );


      if (oldResult) {
        oldResult.remove();
      }


      var overlay =
        document.createElement("div");

      overlay.id =
        "battle-result";


      var box =
        document.createElement("div");

      box.className =
        "battle-result-box";


      var icon =
        document.createElement("div");

      icon.className =
        "battle-result-icon";

      icon.textContent =
        didWin
          ? "🏆"
          : "💥";


      var title =
        document.createElement("h1");

      title.textContent =
        didWin
          ? "YOU WIN!"
          : "YOU LOSE";


      var description =
        document.createElement("p");


      if (
        data.reason ===
        "elimination"
      ) {

        description.textContent =
          didWin

            ? "Your opponent ran out of moves after using their Second Chance."

            : "You ran out of moves after using your Second Chance.";

      } else {

        description.textContent =
          didWin

            ? "You were first to reach 2048!"

            : "Your opponent reached 2048 first.";
      }


      var actions =
        document.createElement("div");

      actions.className =
        "battle-result-actions";


      var rematchButton =
        document.createElement(
          "button"
        );

      rematchButton.className =
        "rematch-button";

      rematchButton.textContent =
        "Rematch";


      rematchButton.addEventListener(
        "click",
        function () {

          rematchButton.disabled =
            true;

          rematchButton.textContent =
            "Waiting...";

          socket.emit(
            "requestRematch"
          );
        }
      );


      var lobbyButton =
        document.createElement(
          "button"
        );

      lobbyButton.className =
        "lobby-return-button";

      lobbyButton.textContent =
        "Back to Lobby";


      lobbyButton.addEventListener(
        "click",
        function () {

          window.location.href =
            window.location.origin +
            window.location.pathname;
        }
      );


      actions.appendChild(
        rematchButton
      );

      actions.appendChild(
        lobbyButton
      );


      box.appendChild(
        icon
      );

      box.appendChild(
        title
      );

      box.appendChild(
        description
      );

      box.appendChild(
        actions
      );


      overlay.appendChild(
        box
      );


      document.body.appendChild(
        overlay
      );
    }
  );


  // =========================================================
  // CONNECTION
  // =========================================================

  socket.on(
    "connect",
    function () {

      console.log(
        "Connected to Rina's 2048 server."
      );
    }
  );


  socket.on(
    "disconnect",
    function () {

      console.log(
        "Disconnected from Rina's 2048 server."
      );
    }
  );

})();

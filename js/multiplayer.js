(function () {
  "use strict";

  var socket = io(
    "https://two048-battle-oc8k.onrender.com"
  );

  window.multiplayerSocket = socket;

  var appRoot = document.getElementById("app-root");
  var gameHost = document.getElementById("game-host");
  var soloToolbar = document.getElementById("solo-toolbar");
  var gameContainer = document.querySelector(".container");

  var SETTINGS_KEY = "rinas2048.settings";
  var LAST_TARGET_KEY = "rinas2048.lastRaceTarget";
  var LAST_CUSTOM_HOST_TARGET_KEY = "rinas2048.lastCustomHostTarget";
  var LAST_CUSTOM_GUEST_TARGET_KEY = "rinas2048.lastCustomGuestTarget";
  var THEMES = ["classic", "pastel", "ocean", "candy", "midnight"];
  var TARGETS = [2048, 4096, 8192];
  var CUSTOM_TARGETS = [1024, 2048, 4096, 8192, 16384];

  function safeStorageGet(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (error) {
      return fallback;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Settings still work for this session if storage is unavailable.
    }
  }

  var currentScreen = "main";
  var currentRoomCode = null;
  var selectedTarget = Number(safeStorageGet(LAST_TARGET_KEY, 2048));
  var selectedCustomHostTarget = Number(safeStorageGet(LAST_CUSTOM_HOST_TARGET_KEY, 2048));
  var selectedCustomGuestTarget = Number(safeStorageGet(LAST_CUSTOM_GUEST_TARGET_KEY, 4096));
  var battleShell = null;
  var opponentGrid = null;
  var opponentHighest = null;
  var opponentStatus = null;
  var ownHighestDisplay = null;
  var ownScoreDisplay = null;
  var opponentScoreDisplay = null;
  var ownProgressFill = null;
  var opponentProgressFill = null;
  var ownProgressText = null;
  var opponentProgressText = null;
  var ownProgressNote = null;
  var opponentProgressNote = null;
  var ownNicknameDisplay = null;
  var opponentNicknameDisplay = null;
  var ownRankBadge = null;
  var opponentRankBadge = null;
  var latestOpponentState = null;
  var lastOwnHighest = 0;
  var lastOwnScore = 0;
  var lastLeaderNumber = null;
  var lastOwnOneAway = false;
  var lastOpponentOneAway = false;
  var audioContext = null;
  var opponentPanelElement = null;

  if (TARGETS.indexOf(selectedTarget) === -1) {
    selectedTarget = 2048;
  }

  if (CUSTOM_TARGETS.indexOf(selectedCustomHostTarget) === -1) {
    selectedCustomHostTarget = 2048;
  }

  if (CUSTOM_TARGETS.indexOf(selectedCustomGuestTarget) === -1) {
    selectedCustomGuestTarget = 4096;
  }

  function sanitizeNickname(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  function getOwnNickname() {
    return sanitizeNickname(window.rinasSettings && window.rinasSettings.nickname) ||
      "Player " + (window.multiplayerPlayerNumber || "");
  }

  function getOpponentNumber() {
    return window.multiplayerPlayerNumber === 1 ? 2 : 1;
  }

  function getProfile(playerNumber) {
    var profiles = window.multiplayerProfiles || [];

    for (var i = 0; i < profiles.length; i++) {
      if (Number(profiles[i].playerNumber) === Number(playerNumber)) {
        return profiles[i];
      }
    }

    return null;
  }

  function getOpponentNickname() {
    var profile = getProfile(getOpponentNumber());
    return profile && sanitizeNickname(profile.nickname)
      ? sanitizeNickname(profile.nickname)
      : "Opponent";
  }

  function loadSettings() {
    var defaults = {
      theme: "classic",
      soloUndo: false,
      soundEffects: true,
      sfxVolume: 0.75,
      nickname: "",
      controlScheme: "arrows"
    };

    try {
      var saved = JSON.parse(safeStorageGet(SETTINGS_KEY, "{}"));

      if (THEMES.indexOf(saved.theme) !== -1) {
        defaults.theme = saved.theme;
      }

      defaults.soloUndo = !!saved.soloUndo;

      if (typeof saved.soundEffects === "boolean") {
        defaults.soundEffects = saved.soundEffects;
      }

      if (typeof saved.sfxVolume === "number") {
        defaults.sfxVolume = Math.max(0, Math.min(1, saved.sfxVolume));
      }


      if (typeof saved.nickname === "string") {
        defaults.nickname = sanitizeNickname(saved.nickname);
      }

      if (saved.controlScheme === "wasd" || saved.controlScheme === "arrows") {
        defaults.controlScheme = saved.controlScheme;
      }
    } catch (error) {
      // Use defaults.
    }

    return defaults;
  }

  window.rinasSettings = loadSettings();

  function saveSettings() {
    safeStorageSet(
      SETTINGS_KEY,
      JSON.stringify(window.rinasSettings)
    );
  }

  function applyTheme(theme) {
    THEMES.forEach(function (name) {
      document.body.classList.remove("theme-" + name);
    });

    document.body.classList.add("theme-" + theme);
  }

  applyTheme(window.rinasSettings.theme);

  function getAudioContext() {
    if (!window.rinasSettings || !window.rinasSettings.soundEffects) {
      return null;
    }

    var AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      return null;
    }

    if (!audioContext) {
      audioContext = new AudioContextClass();
    }

    if (audioContext.state === "suspended") {
      audioContext.resume().catch(function () {});
    }

    return audioContext;
  }

  function playTone(ctx, frequency, duration, volume, type, delay, endFrequency) {
    var start = ctx.currentTime + (delay || 0);
    var sfxScale = Math.max(0, Math.min(1, Number(typeof window.rinasSettings.sfxVolume === "number" ? window.rinasSettings.sfxVolume : 0.75)));
    volume = Math.min(0.18, (volume || 0.025) * sfxScale * 2.8);
    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();

    oscillator.type = type || "sine";
    oscillator.frequency.setValueAtTime(frequency, start);

    if (endFrequency) {
      oscillator.frequency.exponentialRampToValueAtTime(
        Math.max(1, endFrequency),
        start + duration
      );
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(
      Math.max(0.0001, volume || 0.025),
      start + 0.008
    );
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      start + duration
    );

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  function playSound(name) {
    var ctx = getAudioContext();

    if (!ctx) {
      return;
    }

    if (name === "ui") {
      playTone(ctx, 420, 0.045, 0.018, "sine", 0, 500);
    } else if (name === "move") {
      playTone(ctx, 180, 0.035, 0.015, "triangle", 0, 150);
    } else if (name === "merge") {
      playTone(ctx, 260, 0.07, 0.025, "sine", 0, 350);
      playTone(ctx, 520, 0.055, 0.015, "sine", 0.025, 620);
    } else if (name === "undo") {
      playTone(ctx, 440, 0.09, 0.022, "triangle", 0, 210);
      playTone(ctx, 260, 0.07, 0.014, "sine", 0.045, 170);

    } else if (name === "lead") {
      playTone(ctx, 520, 0.08, 0.022, "triangle", 0, 650);
      playTone(ctx, 700, 0.10, 0.024, "triangle", 0.06, 840);
    } else if (name === "lead-lost") {
      playTone(ctx, 420, 0.09, 0.024, "triangle", 0, 310);
      playTone(ctx, 300, 0.12, 0.020, "triangle", 0.07, 220);
    } else if (name === "tie") {
      playTone(ctx, 470, 0.07, 0.022, "square", 0, 520);
      playTone(ctx, 470, 0.07, 0.022, "square", 0.10, 520);
    } else if (name === "danger") {
      playTone(ctx, 620, 0.06, 0.024, "square", 0, 700);
      playTone(ctx, 820, 0.07, 0.026, "square", 0.08, 920);
      playTone(ctx, 1040, 0.09, 0.022, "square", 0.16, 1160);
    } else if (name === "milestone") {
      playTone(ctx, 440, 0.12, 0.025, "sine", 0, 520);
      playTone(ctx, 660, 0.13, 0.024, "sine", 0.08, 780);
      playTone(ctx, 880, 0.16, 0.02, "sine", 0.16, 990);
    } else if (name === "win") {
      playTone(ctx, 392, 0.12, 0.025, "sine", 0, 470);
      playTone(ctx, 523, 0.14, 0.026, "sine", 0.09, 620);
      playTone(ctx, 784, 0.20, 0.028, "sine", 0.18, 900);
    } else if (name === "lose") {
      playTone(ctx, 260, 0.15, 0.024, "triangle", 0, 180);
      playTone(ctx, 170, 0.20, 0.018, "sine", 0.10, 110);
    }
  }

  window.rinasPlaySound = playSound;

  // Background music was intentionally removed in v40.
  // These no-op helpers keep older gameplay call sites harmless.
  function startCompetitiveMusic() {}
  function stopCompetitiveMusic() {}
  function updateCompetitiveMusicIntensity() {}
  function duckCompetitiveMusic() {}

  document.addEventListener("click", function (event) {
    var button = event.target.closest ? event.target.closest("button") : null;

    if (
      button &&
      !button.disabled &&
      button.getAttribute("data-no-ui-sound") !== "true"
    ) {
      playSound("ui");
    }
  }, true);

  function withGame(callback) {
    if (window.multiplayerGame) {
      callback(window.multiplayerGame);
      return;
    }

    setTimeout(function () {
      withGame(callback);
    }, 30);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // =========================================================
  // STYLES
  // =========================================================

  var style = document.createElement("style");

  style.textContent = `
    body {
      min-height: 100vh;
    }

    #app-root,
    #game-host,
    .battle-shell,
    .settings-overlay {
      font-family: "Clear Sans", "Helvetica Neue", Arial, sans-serif;
    }

    #game-host {
      display: none;
    }

    .app-screen {
      min-height: 100vh;
      box-sizing: border-box;
      padding: 28px 20px 48px;
      background: #faf8ef;
      color: #776e65;
    }

    .app-screen-inner {
      width: 100%;
      max-width: 720px;
      margin: 0 auto;
    }

    .app-header {
      min-height: 44px;
      display: grid;
      grid-template-columns: 110px 1fr 110px;
      align-items: center;
      gap: 10px;
      margin-bottom: 28px;
    }

    .app-header h1 {
      margin: 0;
      text-align: center;
      font-size: 40px;
      line-height: 1.05;
      color: #776e65;
    }

    .app-header-side {
      display: flex;
      align-items: center;
    }

    .app-header-side.right {
      justify-content: flex-end;
    }

    .nav-button,
    .settings-button,
    .secondary-button,
    .primary-button,
    .danger-button,
    .small-button {
      border: 0;
      border-radius: 7px;
      font-family: inherit;
      font-weight: bold;
      cursor: pointer;
    }

    .nav-button,
    .settings-button,
    .secondary-button,
    .small-button {
      background: #eee4da;
      color: #776e65;
    }

    .nav-button,
    .settings-button {
      padding: 10px 13px;
      font-size: 14px;
    }

    .primary-button {
      background: #8f7a66;
      color: #fff;
      padding: 14px 18px;
      font-size: 17px;
    }

    .secondary-button {
      padding: 14px 18px;
      font-size: 17px;
    }

    .danger-button {
      background: #a85f4b;
      color: #fff;
      padding: 11px 14px;
      font-size: 14px;
    }

    .small-button {
      padding: 10px 12px;
      font-size: 13px;
    }

    button:disabled {
      opacity: 0.48;
      cursor: default;
    }

    .hero-title {
      margin: 56px 0 8px;
      text-align: center;
      font-size: 58px;
      color: #776e65;
    }

    .hero-subtitle {
      margin: 0 0 34px;
      text-align: center;
      font-size: 19px;
      color: #8f7a66;
    }

    .mode-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
    }

    .mode-card {
      position: relative;
      box-sizing: border-box;
      min-height: 170px;
      padding: 22px;
      border: 2px solid #eee4da;
      border-radius: 12px;
      background: #fff;
      color: #776e65;
      text-align: left;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.05);
    }

    button.mode-card {
      width: 100%;
      font-family: inherit;
      cursor: pointer;
    }

    .mode-card:hover:not(.coming-soon) {
      border-color: #bbada0;
    }

    .mode-icon {
      font-size: 31px;
      display: block;
      margin-bottom: 10px;
    }

    .mode-card h2,
    .mode-card h3 {
      margin: 0 0 7px;
      color: #776e65;
    }

    .mode-card p {
      margin: 0;
      line-height: 1.45;
      color: #8f7a66;
    }

    .coming-soon {
      opacity: 0.72;
      cursor: default;
    }

    .coming-soon-badge {
      position: absolute;
      top: 14px;
      right: 14px;
      padding: 5px 8px;
      border-radius: 999px;
      background: #eee4da;
      color: #8f7a66;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.6px;
    }

    .solo-stats {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      margin: 20px 0;
    }

    .stat-card {
      padding: 17px;
      border-radius: 10px;
      background: #bbada0;
      color: #fff;
      text-align: center;
    }

    .stat-card span {
      display: block;
      font-size: 11px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .stat-card strong {
      display: block;
      margin-top: 5px;
      font-size: 25px;
    }

    .button-stack {
      display: grid;
      gap: 10px;
      max-width: 430px;
      margin: 24px auto 0;
    }

    .info-card,
    .rules-card {
      padding: 18px 20px;
      border-radius: 10px;
      background: #f1ece3;
      line-height: 1.5;
    }

    .rules-card {
      margin: 18px 0;
    }

    .rules-card strong {
      display: block;
      margin-bottom: 7px;
      font-size: 16px;
    }

    .rules-card ul {
      margin: 0;
      padding-left: 20px;
    }

    .race-columns {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 16px;
      margin-top: 18px;
    }

    .race-box {
      box-sizing: border-box;
      padding: 20px;
      border-radius: 11px;
      background: #fff;
      border: 2px solid #eee4da;
    }

    .race-box h2 {
      margin-top: 0;
      font-size: 22px;
    }

    .target-picker {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 12px 0 17px;
    }

    .target-button {
      flex: 1;
      min-width: 78px;
      border: 2px solid #eee4da;
      border-radius: 7px;
      padding: 10px;
      background: #faf8ef;
      color: #776e65;
      font-family: inherit;
      font-weight: bold;
      cursor: pointer;
    }

    .target-button.selected {
      border-color: #8f7a66;
      background: #8f7a66;
      color: #fff;
    }

    .room-input {
      width: 100%;
      box-sizing: border-box;
      margin: 12px 0;
      padding: 13px;
      border: 2px solid #ddd;
      border-radius: 7px;
      outline: none;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 4px;
      font-size: 20px;
    }

    .room-input:focus {
      border-color: #8f7a66;
    }

    .room-code-display {
      margin: 18px 0;
      font-size: 36px;
      font-weight: bold;
      letter-spacing: 6px;
    }

    .status-text {
      min-height: 22px;
      margin: 14px 0 0;
      font-weight: bold;
      color: #8f7a66;
    }

    /* Solo toolbar */
    #solo-toolbar {
      width: 500px;
      max-width: calc(100% - 24px);
      margin: 18px auto 10px;
      display: none;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .solo-toolbar-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .solo-control-hint {
      flex-basis: 100%;
      margin-top: 2px;
      text-align: center;
      color: var(--app-muted, #8f7a66);
      font-size: 12px;
      font-weight: 600;
    }

    .solo-control-hint kbd {
      display: inline-block;
      min-width: 22px;
      padding: 2px 6px;
      border: 1px solid var(--app-border, #ddd3c8);
      border-bottom-width: 2px;
      border-radius: 5px;
      background: var(--app-card, #ffffff);
      color: var(--app-text, #776e65);
      font-family: inherit;
      font-size: 11px;
      line-height: 1.35;
      text-align: center;
    }

    /* Smooth Solo rewind: the tile spawned by the last move
       quickly contracts, then HTMLActuator slides/splits the
       remaining tiles back using the same movement engine as
       normal forward play. */
    .rinas-undo-removing {
      z-index: 30;
      pointer-events: none;
    }

    .rinas-undo-removing .tile-inner {
      opacity: 0 !important;
      transform: scale(0.05) !important;
      transition:
        transform 70ms ease-in,
        opacity 70ms ease-in !important;
    }

    body.solo-active #game-host {
      display: block;
    }

    body.solo-active #solo-toolbar {
      display: flex;
    }

    body.solo-active .container {
      display: block !important;
    }

    body.solo-active .above-game {
      display: none;
    }

    /* Multiplayer battle */
    .battle-shell {
      max-width: 1120px;
      margin: 24px auto;
      padding: 0 18px 40px;
      box-sizing: border-box;
      color: #776e65;
    }

    .battle-topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .battle-heading {
      text-align: center;
      margin-bottom: 18px;
    }

    .battle-heading h1 {
      margin: 0;
      font-size: 42px;
    }

    .battle-meta {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .mode-badge,
    .room-badge,
    .target-badge {
      border-radius: 7px;
      padding: 7px 10px;
      font-size: 13px;
      font-weight: bold;
    }

    .mode-badge,
    .target-badge {
      background: #eee4da;
      color: #776e65;
    }

    .room-badge {
      background: #bbada0;
      color: #fff;
      letter-spacing: 1px;
    }

    .battle-rule-line {
      max-width: 690px;
      margin: 9px auto 0;
      font-size: 14px;
      line-height: 1.4;
    }

    .battle-layout {
      display: grid;
      grid-template-columns:
        minmax(0, 540px)
        48px
        minmax(0, 340px);
      justify-content: center;
      align-items: start;
      column-gap: 28px;
      row-gap: 22px;
    }

    .battle-player-card {
      box-sizing: border-box;
      border: 2px solid var(--app-border, #ddd3c8);
      border-radius: 16px;
      background: var(--app-card, #ffffff);
      box-shadow: 0 5px 20px var(--app-shadow, rgba(0, 0, 0, 0.08));
      padding: 18px;
    }

    .own-panel {
      width: 540px;
      max-width: 100%;
      min-width: 0;
      border-color: var(--app-accent, #8f7a66);
    }

    .battle-layout .container {
      width: 500px;
      max-width: 100%;
      margin: 0;
      display: block !important;
    }

    .battle-layout .container .title,
    .battle-layout .container .above-game,
    .battle-layout .container > p,
    .battle-layout .container > hr {
      display: none;
    }

    .battle-layout .container .heading,
    .opponent-header {
      min-height: 54px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 9px;
    }

    .battle-layout .container .heading:before {
      content: "You";
      font-size: 30px;
      line-height: 1.05;
      font-weight: bold;
      color: #776e65;
    }

    .battle-layout .container .scores-container {
      float: none;
      margin-top: 0;
    }

    .battle-layout .container .score-container {
      display: none !important;
    }

    .battle-layout .container .best-container:after {
      content: "Highest" !important;
    }

    .own-status-row,
    .opponent-chance-row {
      min-height: 31px;
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
      margin: 0 0 10px;
    }

    .chance-badge {
      display: inline-block;
      padding: 7px 10px;
      border-radius: 999px;
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
      color: #fff;
    }

    .chance-badge.compact {
      padding: 6px 8px;
      font-size: 11px;
    }

    .battle-vs {
      padding-top: 118px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
    }

    .battle-vs span {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      border: 2px solid var(--app-border, #ddd3c8);
      border-radius: 50%;
      background: var(--app-soft, #eee4da);
      color: var(--app-text, #776e65);
      font-size: 15px;
      font-weight: 800;
      letter-spacing: 0.5px;
    }

    .opponent-panel {
      width: 340px;
      max-width: 100%;
      box-sizing: border-box;
    }

    .opponent-header h2 {
      margin: 0;
      font-size: 24px;
      line-height: 1.1;
    }

    .opponent-stat-box {
      min-width: 70px;
      padding: 7px 9px;
      border-radius: 5px;
      background: #bbada0;
      color: #fff;
      text-align: center;
      font-weight: bold;
    }

    .opponent-stat-label {
      display: block;
      font-size: 9px;
      text-transform: uppercase;
    }

    .opponent-stat-value {
      display: block;
      font-size: 18px;
    }

    .opponent-grid {
      width: 100%;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      padding: 8px;
      border-radius: 6px;
      background: #bbada0;
      box-sizing: border-box;
    }

    .opponent-cell {
      aspect-ratio: 1 / 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 3px;
      background: rgba(238, 228, 218, 0.35);
      color: var(--tile-dark-text, #776e65);
      font-size: 19px;
      font-weight: bold;
    }

    .opponent-cell.has-tile {
      background: var(--tile-2);
    }

    .opponent-cell.tile-2 { background: var(--tile-2); }
    .opponent-cell.tile-4 { background: var(--tile-4); }
    .opponent-cell.tile-8 { background: var(--tile-8); color: var(--tile-light-text); }
    .opponent-cell.tile-16 { background: var(--tile-16); color: var(--tile-light-text); }
    .opponent-cell.tile-32 { background: var(--tile-32); color: var(--tile-light-text); }
    .opponent-cell.tile-64 { background: var(--tile-64); color: var(--tile-light-text); }
    .opponent-cell.tile-128 { background: var(--tile-128); color: var(--tile-light-text); font-size: 16px; }
    .opponent-cell.tile-256 { background: var(--tile-256); color: var(--tile-light-text); font-size: 16px; }
    .opponent-cell.tile-512 { background: var(--tile-512); color: var(--tile-light-text); font-size: 16px; }
    .opponent-cell.tile-1024 { background: var(--tile-1024); color: var(--tile-light-text); font-size: 13px; }
    .opponent-cell.tile-2048 { background: var(--tile-2048); color: var(--tile-light-text); font-size: 13px; }
    .opponent-cell.tile-4096 { background: var(--tile-4096); color: var(--tile-light-text); font-size: 13px; }
    .opponent-cell.tile-8192 { background: var(--tile-8192); color: var(--tile-light-text); font-size: 13px; }

    #opponent-status {
      min-height: 20px;
      margin-top: 8px;
      text-align: center;
      font-size: 12px;
      font-weight: bold;
    }

    #second-chance-toast {
      position: fixed;
      top: 25px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 100000;
      max-width: calc(100% - 40px);
      box-sizing: border-box;
      padding: 14px 22px;
      border-radius: 8px;
      background: #8f7a66;
      color: #fff;
      text-align: center;
      font-weight: bold;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    }

    .result-overlay,
    .settings-overlay {
      position: fixed;
      inset: 0;
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 20px;
      background: rgba(40, 36, 32, 0.72);
    }

    .result-box,
    .settings-dialog {
      width: 100%;
      max-width: 440px;
      box-sizing: border-box;
      padding: 30px;
      border-radius: 12px;
      background: #faf8ef;
      color: #776e65;
      box-shadow: 0 16px 50px rgba(0, 0, 0, 0.3);
    }

    .settings-dialog {
      max-height: calc(100vh - 40px);
      overflow-y: auto;
    }

    .result-box {
      text-align: center;
    }

    .result-icon {
      margin-bottom: 10px;
      font-size: 58px;
    }

    .result-box h1,
    .settings-dialog h2 {
      margin-top: 0;
    }

    .result-actions {
      display: flex;
      justify-content: center;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 24px;
    }

    #solo-milestone-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      z-index: 100000;
      transform: translateX(-50%);
      max-width: calc(100% - 32px);
      box-sizing: border-box;
      padding: 13px 20px;
      border-radius: 9px;
      background: #8f7a66;
      color: #fff;
      text-align: center;
      font-weight: bold;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.25);
    }

    .settings-dialog-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 22px;
    }

    .settings-dialog-header h2 {
      margin: 0;
    }

    .close-settings {
      border: 0;
      background: transparent;
      color: #776e65;
      font-size: 26px;
      cursor: pointer;
    }

    .settings-section + .settings-section {
      margin-top: 24px;
      padding-top: 20px;
      border-top: 1px solid #ddd3c8;
    }

    .settings-section h3 {
      margin: 0 0 6px;
    }

    .settings-help {
      margin: 0 0 13px;
      color: #8f7a66;
      font-size: 13px;
      line-height: 1.45;
    }

    .theme-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 9px;
    }

    .theme-choice {
      border: 2px solid #eee4da;
      border-radius: 8px;
      padding: 10px;
      background: #fff;
      color: #776e65;
      font-family: inherit;
      font-weight: bold;
      cursor: pointer;
    }

    .theme-choice.selected {
      border-color: #8f7a66;
    }

    .theme-swatches {
      display: flex;
      gap: 4px;
      margin-top: 7px;
    }

    .theme-swatches i {
      flex: 1;
      height: 15px;
      border-radius: 3px;
    }

    .toggle-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
    }

    .toggle-button {
      min-width: 72px;
      border: 0;
      border-radius: 999px;
      padding: 9px 12px;
      font-family: inherit;
      font-weight: bold;
      cursor: pointer;
    }

    .toggle-button.on {
      background: #8f7a66;
      color: #fff;
    }

    .toggle-button.off {
      background: #eee4da;
      color: #776e65;
    }

    /* Tile theme variables */
    body.theme-classic,
    #opponent-grid[data-theme="classic"] {
      --tile-2: #eee4da;
      --tile-4: #ede0c8;
      --tile-8: #f2b179;
      --tile-16: #f59563;
      --tile-32: #f67c5f;
      --tile-64: #f65e3b;
      --tile-128: #edcf72;
      --tile-256: #edcc61;
      --tile-512: #edc850;
      --tile-1024: #edc53f;
      --tile-2048: #edc22e;
      --tile-4096: #c9a227;
      --tile-8192: #a98418;
      --tile-dark-text: #776e65;
      --tile-light-text: #f9f6f2;
    }

    body.theme-pastel,
    #opponent-grid[data-theme="pastel"] {
      --tile-2: #f8e8ee;
      --tile-4: #eadcf8;
      --tile-8: #cfe8f6;
      --tile-16: #cdeedb;
      --tile-32: #fff0b8;
      --tile-64: #ffd6b8;
      --tile-128: #ffc8dd;
      --tile-256: #cdb4db;
      --tile-512: #a2d2ff;
      --tile-1024: #bde0fe;
      --tile-2048: #ffafcc;
      --tile-4096: #b9fbc0;
      --tile-8192: #98f5e1;
      --tile-dark-text: #5f5760;
      --tile-light-text: #4f4650;
    }

    body.theme-ocean,
    #opponent-grid[data-theme="ocean"] {
      --tile-2: #d9f0f7;
      --tile-4: #b8e3ef;
      --tile-8: #83c5d5;
      --tile-16: #5bb5c8;
      --tile-32: #3c9db5;
      --tile-64: #2589a5;
      --tile-128: #16758f;
      --tile-256: #0e647c;
      --tile-512: #0a5368;
      --tile-1024: #084456;
      --tile-2048: #063747;
      --tile-4096: #042c39;
      --tile-8192: #03232e;
      --tile-dark-text: #31525b;
      --tile-light-text: #f4fbfd;
    }

    body.theme-candy,
    #opponent-grid[data-theme="candy"] {
      --tile-2: #ffe1ec;
      --tile-4: #ffd2e1;
      --tile-8: #ffc3a0;
      --tile-16: #ff9f9f;
      --tile-32: #ff7b9c;
      --tile-64: #ff5d8f;
      --tile-128: #f759ab;
      --tile-256: #d65db1;
      --tile-512: #aa66cc;
      --tile-1024: #845ec2;
      --tile-2048: #ff9671;
      --tile-4096: #ff6f91;
      --tile-8192: #c34a9b;
      --tile-dark-text: #704b59;
      --tile-light-text: #fff7fa;
    }

    body.theme-midnight,
    #opponent-grid[data-theme="midnight"] {
      --tile-2: #dce1f2;
      --tile-4: #c8cee8;
      --tile-8: #9ea7d8;
      --tile-16: #7f8acb;
      --tile-32: #626db8;
      --tile-64: #4d579e;
      --tile-128: #41477f;
      --tile-256: #393a69;
      --tile-512: #312f58;
      --tile-1024: #292649;
      --tile-2048: #211e3d;
      --tile-4096: #19172f;
      --tile-8192: #111021;
      --tile-dark-text: #434866;
      --tile-light-text: #f3f4ff;
    }

    .tile.tile-2 .tile-inner { background: var(--tile-2) !important; color: var(--tile-dark-text) !important; }
    .tile.tile-4 .tile-inner { background: var(--tile-4) !important; color: var(--tile-dark-text) !important; }
    .tile.tile-8 .tile-inner { background: var(--tile-8) !important; color: var(--tile-light-text) !important; }
    .tile.tile-16 .tile-inner { background: var(--tile-16) !important; color: var(--tile-light-text) !important; }
    .tile.tile-32 .tile-inner { background: var(--tile-32) !important; color: var(--tile-light-text) !important; }
    .tile.tile-64 .tile-inner { background: var(--tile-64) !important; color: var(--tile-light-text) !important; }
    .tile.tile-128 .tile-inner { background: var(--tile-128) !important; color: var(--tile-light-text) !important; }
    .tile.tile-256 .tile-inner { background: var(--tile-256) !important; color: var(--tile-light-text) !important; }
    .tile.tile-512 .tile-inner { background: var(--tile-512) !important; color: var(--tile-light-text) !important; }
    .tile.tile-1024 .tile-inner { background: var(--tile-1024) !important; color: var(--tile-light-text) !important; }
    .tile.tile-2048 .tile-inner { background: var(--tile-2048) !important; color: var(--tile-light-text) !important; }
    .tile.tile-super .tile-inner { background: var(--tile-8192) !important; color: var(--tile-light-text) !important; }
    .tile.tile-4096 .tile-inner { background: var(--tile-4096) !important; color: var(--tile-light-text) !important; }
    .tile.tile-8192 .tile-inner { background: var(--tile-8192) !important; color: var(--tile-light-text) !important; }

    /* =======================================================
       FULL APP THEMES
       Each theme now controls the whole interface, not just tiles.
       ======================================================= */

    body.theme-classic {
      --app-bg: #faf8ef;
      --app-card: #ffffff;
      --app-soft: #f1ece3;
      --app-border: #eee4da;
      --app-text: #776e65;
      --app-muted: #8f7a66;
      --app-accent: #8f7a66;
      --app-accent-hover: #7f6b59;
      --app-on-accent: #ffffff;
      --app-board: #bbada0;
      --app-cell: rgba(238, 228, 218, 0.35);
      --app-stat: #bbada0;
      --app-danger: #a85f4b;
      --app-overlay: rgba(40, 36, 32, 0.72);
      --app-message-bg: rgba(250, 248, 239, 0.82);
      --app-shadow: rgba(0, 0, 0, 0.12);
    }

    body.theme-pastel {
      --app-bg: #ffffff;
      --app-card: #fbfbfe;
      --app-soft: #f4f2f8;
      --app-border: #e6e1ec;
      --app-text: #57515f;
      --app-muted: #7b7382;
      --app-accent: #a88fba;
      --app-accent-hover: #947aa8;
      --app-on-accent: #ffffff;
      --app-board: #ded9e7;
      --app-cell: #f1eef5;
      --app-stat: #b8a9c5;
      --app-danger: #c97985;
      --app-overlay: rgba(71, 62, 77, 0.48);
      --app-message-bg: rgba(255, 255, 255, 0.88);
      --app-shadow: rgba(76, 61, 88, 0.11);
    }

    body.theme-ocean {
      --app-bg: #edf8fb;
      --app-card: #f9fdff;
      --app-soft: #dff1f6;
      --app-border: #c8e4ec;
      --app-text: #27505c;
      --app-muted: #4f7480;
      --app-accent: #2f8198;
      --app-accent-hover: #286f83;
      --app-on-accent: #ffffff;
      --app-board: #8eb7c3;
      --app-cell: #d7eaf0;
      --app-stat: #5f9bad;
      --app-danger: #b76565;
      --app-overlay: rgba(20, 50, 61, 0.60);
      --app-message-bg: rgba(237, 248, 251, 0.88);
      --app-shadow: rgba(30, 89, 105, 0.14);
    }

    body.theme-candy {
      --app-bg: #fff3f8;
      --app-card: #fffafd;
      --app-soft: #fde4ef;
      --app-border: #f4c9dc;
      --app-text: #704b59;
      --app-muted: #9a6479;
      --app-accent: #d65d91;
      --app-accent-hover: #c44d80;
      --app-on-accent: #ffffff;
      --app-board: #dfa8bd;
      --app-cell: #f8dce7;
      --app-stat: #cf7da0;
      --app-danger: #bd5d73;
      --app-overlay: rgba(84, 42, 62, 0.55);
      --app-message-bg: rgba(255, 243, 248, 0.88);
      --app-shadow: rgba(132, 70, 97, 0.13);
    }

    body.theme-midnight {
      --app-bg: #121622;
      --app-card: #1b2130;
      --app-soft: #252d40;
      --app-border: #343e55;
      --app-text: #eef1ff;
      --app-muted: #b4bdd8;
      --app-accent: #6975c7;
      --app-accent-hover: #7c87d7;
      --app-on-accent: #ffffff;
      --app-board: #30384d;
      --app-cell: #3b455d;
      --app-stat: #485372;
      --app-danger: #a75469;
      --app-overlay: rgba(4, 7, 13, 0.78);
      --app-message-bg: rgba(18, 22, 34, 0.90);
      --app-shadow: rgba(0, 0, 0, 0.35);
    }

    /* Opponent mini-board keeps the opponent's chosen board/tile theme. */
    #opponent-grid[data-theme="classic"] {
      --opponent-board: #bbada0;
      --opponent-cell: rgba(238, 228, 218, 0.35);
    }

    #opponent-grid[data-theme="pastel"] {
      --opponent-board: #ded9e7;
      --opponent-cell: #f1eef5;
    }

    #opponent-grid[data-theme="ocean"] {
      --opponent-board: #8eb7c3;
      --opponent-cell: #d7eaf0;
    }

    #opponent-grid[data-theme="candy"] {
      --opponent-board: #dfa8bd;
      --opponent-cell: #f8dce7;
    }

    #opponent-grid[data-theme="midnight"] {
      --opponent-board: #30384d;
      --opponent-cell: #3b455d;
    }

    html,
    body {
      background: var(--app-bg) !important;
      color: var(--app-text) !important;
    }

    body,
    .app-screen,
    .battle-shell,
    #game-host {
      background: var(--app-bg) !important;
      color: var(--app-text) !important;
    }

    .app-header h1,
    .hero-title,
    .mode-card h2,
    .mode-card h3,
    .race-box h2,
    .battle-heading,
    .battle-heading h1,
    .opponent-header h2,
    .settings-dialog h2,
    .settings-dialog h3,
    .result-box h1,
    .container,
    .container .heading,
    .container .heading:before,
    .battle-layout .container .heading:before,
    .game-explanation,
    .game-explanation strong,
    .container p,
    .container a {
      color: var(--app-text) !important;
    }

    .hero-subtitle,
    .mode-card p,
    .status-text,
    .settings-help,
    #opponent-status,
    .battle-rule-line,
    .race-box p {
      color: var(--app-muted) !important;
    }

    .mode-card,
    .race-box,
    .result-box,
    .settings-dialog,
    .theme-choice {
      background: var(--app-card) !important;
      color: var(--app-text) !important;
      border-color: var(--app-border) !important;
      box-shadow: 0 4px 18px var(--app-shadow);
    }

    .info-card,
    .rules-card,
    .coming-soon-badge,
    .nav-button,
    .settings-button,
    .secondary-button,
    .small-button,
    .mode-badge,
    .target-badge,
    .chance-badge.available,
    .toggle-button.off {
      background: var(--app-soft) !important;
      color: var(--app-text) !important;
      border-color: var(--app-border) !important;
    }

    .primary-button,
    .target-button.selected,
    .toggle-button.on,
    #second-chance-toast,
    #solo-milestone-toast {
      background: var(--app-accent) !important;
      color: var(--app-on-accent) !important;
    }

    .primary-button:hover,
    .target-button.selected:hover,
    .toggle-button.on:hover {
      background: var(--app-accent-hover) !important;
    }

    .danger-button {
      background: var(--app-danger) !important;
      color: #ffffff !important;
    }

    .room-badge,
    .stat-card,
    .opponent-stat-box,
    .chance-badge.used {
      background: var(--app-stat) !important;
      color: var(--app-on-accent) !important;
    }

    .target-button,
    .room-input {
      background: var(--app-card) !important;
      color: var(--app-text) !important;
      border-color: var(--app-border) !important;
    }

    .room-input::placeholder {
      color: var(--app-muted) !important;
      opacity: 0.75;
    }

    .room-input:focus,
    .target-button.selected,
    .theme-choice.selected {
      border-color: var(--app-accent) !important;
    }

    .settings-section + .settings-section {
      border-top-color: var(--app-border) !important;
    }

    .close-settings {
      color: var(--app-text) !important;
    }

    .result-overlay,
    .settings-overlay {
      background: var(--app-overlay) !important;
    }

    .result-box,
    .settings-dialog {
      box-shadow: 0 16px 50px var(--app-shadow) !important;
    }

    /* Original 2048 board + Solo UI */
    .container .score-container,
    .container .best-container {
      background: var(--app-stat) !important;
      color: var(--app-on-accent) !important;
    }

    .container .score-container:after,
    .container .best-container:after {
      color: rgba(255, 255, 255, 0.78) !important;
    }

    .game-container {
      background: var(--app-board) !important;
    }

    .grid-cell {
      background: var(--app-cell) !important;
    }

    .game-message {
      background: var(--app-message-bg) !important;
      color: var(--app-text) !important;
    }

    .game-message p {
      color: var(--app-text) !important;
    }

    .game-message .retry-button,
    .game-message .keep-playing-button,
    .restart-button {
      background: var(--app-accent) !important;
      color: var(--app-on-accent) !important;
    }

    hr {
      border-color: var(--app-border) !important;
    }

    /* Multiplayer mini board. The surrounding page uses your theme;
       the mini board itself uses the opponent's theme. */
    .opponent-grid {
      background: var(--opponent-board, var(--app-board)) !important;
    }

    .opponent-cell {
      background: var(--opponent-cell, var(--app-cell)) !important;
    }

    .opponent-cell.has-tile,
    .opponent-cell.tile-2 { background: var(--tile-2) !important; }
    .opponent-cell.tile-4 { background: var(--tile-4) !important; }
    .opponent-cell.tile-8 { background: var(--tile-8) !important; }
    .opponent-cell.tile-16 { background: var(--tile-16) !important; }
    .opponent-cell.tile-32 { background: var(--tile-32) !important; }
    .opponent-cell.tile-64 { background: var(--tile-64) !important; }
    .opponent-cell.tile-128 { background: var(--tile-128) !important; }
    .opponent-cell.tile-256 { background: var(--tile-256) !important; }
    .opponent-cell.tile-512 { background: var(--tile-512) !important; }
    .opponent-cell.tile-1024 { background: var(--tile-1024) !important; }
    .opponent-cell.tile-2048 { background: var(--tile-2048) !important; }
    .opponent-cell.tile-4096 { background: var(--tile-4096) !important; }
    .opponent-cell.tile-8192 { background: var(--tile-8192) !important; }

    /* v36 motion + multiplayer identity/race UI */
    @keyframes rinas-screen-in {
      from { opacity: 0; transform: translateX(24px); }
      to { opacity: 1; transform: translateX(0); }
    }

    @keyframes rinas-pop-in {
      from { opacity: 0; transform: translateY(8px) scale(0.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes rinas-rank-bump {
      0% { transform: scale(1); }
      45% { transform: scale(1.14); }
      100% { transform: scale(1); }
    }

    @keyframes rinas-toast-in {
      from { opacity: 0; transform: translate(-50%, -8px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }

    .app-screen {
      animation: rinas-screen-in 240ms cubic-bezier(.2,.8,.2,1);
    }

    .battle-shell,
    body.solo-active #game-host {
      animation: rinas-pop-in 240ms cubic-bezier(.2,.8,.2,1);
    }

    .settings-dialog,
    .result-box {
      animation: rinas-pop-in 180ms cubic-bezier(.2,.8,.2,1);
    }

    button,
    .mode-card,
    .target-button,
    .theme-choice {
      transition:
        transform 120ms ease,
        box-shadow 160ms ease,
        border-color 160ms ease,
        background-color 160ms ease,
        opacity 160ms ease;
    }

    button:not(:disabled):active,
    button.mode-card:not(:disabled):active,
    .target-button:not(:disabled):active,
    .theme-choice:not(:disabled):active {
      transform: scale(0.975);
    }

    @media (hover: hover) and (pointer: fine) {
      button.mode-card:hover:not(.coming-soon) {
        transform: translateY(-4px);
        box-shadow: 0 8px 22px var(--app-shadow, rgba(0,0,0,.10));
      }

      .primary-button:hover:not(:disabled),
      .secondary-button:hover:not(:disabled),
      .nav-button:hover:not(:disabled),
      .settings-button:hover:not(:disabled),
      .small-button:hover:not(:disabled) {
        transform: translateY(-1px);
      }
    }

    .battle-layout {
      grid-template-columns:
        minmax(0, 540px)
        56px
        minmax(0, 340px);
      column-gap: 44px;
    }

    .battle-vs span {
      width: 56px;
      height: 56px;
    }

    .battle-layout .container .heading {
      display: none !important;
    }

    .player-card-header {
      min-height: 92px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .player-name-block {
      min-width: 0;
    }

    .player-name {
      margin: 0;
      max-width: 280px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--app-text, #776e65);
      font-size: 25px;
      line-height: 1.08;
      font-weight: 800;
    }

    .player-subline {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 25px;
      margin-top: 6px;
      color: var(--app-muted, #8f7a66);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .55px;
    }

    .rank-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 46px;
      min-height: 24px;
      box-sizing: border-box;
      padding: 4px 8px;
      border-radius: 999px;
      background: var(--app-soft, #eee4da);
      color: var(--app-text, #776e65);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .45px;
    }

    .rank-badge.first {
      background: var(--app-accent, #8f7a66);
      color: var(--app-on-accent, #fff);
    }

    .rank-badge.rank-bump {
      animation: rinas-rank-bump 360ms ease;
    }

    .highest-box {
      min-width: 72px;
      padding: 8px 10px;
      border-radius: 7px;
      background: var(--app-stat, #bbada0);
      color: var(--app-on-accent, #fff);
      text-align: center;
      font-weight: bold;
      box-sizing: border-box;
    }

    .highest-box span {
      display: block;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .45px;
      opacity: .82;
    }

    .highest-box strong {
      display: block;
      margin-top: 2px;
      font-size: 19px;
      line-height: 1.1;
    }

    .own-status-row {
      min-height: 31px;
      margin: 0 0 12px;
    }

    .battle-room-mini {
      display: inline-flex;
      align-items: center;
      min-height: 34px;
      padding: 6px 10px;
      border-radius: 7px;
      background: var(--app-soft, #eee4da);
      color: var(--app-text, #776e65);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .65px;
    }

    #battle-toast {
      position: fixed;
      top: 22px;
      left: 50%;
      z-index: 100001;
      transform: translateX(-50%);
      max-width: calc(100% - 40px);
      box-sizing: border-box;
      padding: 11px 17px;
      border-radius: 8px;
      background: var(--app-accent, #8f7a66);
      color: var(--app-on-accent, #fff);
      text-align: center;
      font-size: 13px;
      font-weight: 800;
      box-shadow: 0 7px 24px var(--app-shadow, rgba(0,0,0,.20));
      animation: rinas-toast-in 180ms ease-out;
    }

    .identity-line {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin: -8px 0 22px;
      color: var(--app-muted, #8f7a66);
      font-size: 14px;
    }

    .identity-line strong {
      color: var(--app-text, #776e65);
    }

    .nickname-field {
      width: 100%;
      box-sizing: border-box;
      padding: 12px 13px;
      border: 2px solid var(--app-border, #ddd3c8);
      border-radius: 7px;
      background: var(--app-card, #fff);
      color: var(--app-text, #776e65);
      font: inherit;
      font-size: 16px;
      outline: none;
    }

    .nickname-field:focus {
      border-color: var(--app-accent, #8f7a66);
    }

    @media (prefers-reduced-motion: reduce) {
      .app-screen,
      .battle-shell,
      .settings-dialog,
      .result-box,
      .rank-badge,
      #battle-toast {
        animation: none !important;
      }

      button,
      .mode-card,
      .target-button,
      .theme-choice {
        transition: none !important;
      }
    }

    @media (max-width: 900px) {
      .battle-shell {
        max-width: 580px;
      }

      .battle-layout {
        grid-template-columns: minmax(0, 540px);
        justify-items: center;
        row-gap: 18px;
      }

      .battle-vs {
        padding-top: 0;
      }

      .battle-vs span {
        width: auto;
        height: auto;
        padding: 7px 16px;
        border-radius: 999px;
      }

      .opponent-panel {
        width: 340px;
      }
    }

    @media (max-width: 620px) {
      .app-header {
        grid-template-columns: 82px 1fr 82px;
      }

      .app-header h1 {
        font-size: 30px;
      }

      .mode-grid,
      .race-columns {
        grid-template-columns: 1fr;
      }

      .hero-title {
        font-size: 46px;
        margin-top: 35px;
      }

      .theme-grid {
        grid-template-columns: 1fr;
      }

      #solo-toolbar {
        align-items: flex-start;
      }
    }
  `;

  document.head.appendChild(style);



  var v37Style = document.createElement("style");
  v37Style.textContent = `
    /* v37: unified Solo card + competitive progress + custom/freeplay */
    .mode-card.mode-live {
      border-color: var(--app-accent, #8f7a66);
    }

    .mode-card .mode-kicker {
      display: inline-block;
      margin-top: 10px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .65px;
      text-transform: uppercase;
      color: var(--app-accent, #8f7a66);
    }

    .control-choice-row {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      margin-top: 10px;
    }

    .control-choice {
      min-height: 46px;
      border: 2px solid var(--app-border, #ddd3c8);
      border-radius: 8px;
      background: var(--app-card, #fff);
      color: var(--app-text, #776e65);
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }

    .control-choice.selected {
      border-color: var(--app-accent, #8f7a66);
      background: var(--app-accent, #8f7a66);
      color: var(--app-on-accent, #fff);
    }

    .solo-active {
      background: var(--app-bg, #faf8ef);
    }

    body.solo-active #game-host {
      min-height: 100vh;
      padding: 22px 18px 46px;
      box-sizing: border-box;
      background: var(--app-bg, #faf8ef);
    }

    body.solo-active #solo-toolbar {
      width: min(760px, calc(100% - 8px));
      max-width: none;
      margin: 0 auto 18px;
      display: block;
    }

    .solo-floating-header {
      display: grid;
      grid-template-columns: 120px 1fr 120px;
      align-items: center;
      gap: 12px;
      min-height: 52px;
    }

    .solo-floating-center {
      text-align: center;
      color: var(--app-text, #776e65);
    }

    .solo-floating-center strong {
      display: block;
      font-size: 24px;
      line-height: 1.05;
    }

    .solo-mode-label {
      display: inline-block;
      margin-top: 5px;
      padding: 4px 9px;
      border-radius: 999px;
      background: var(--app-soft, #eee4da);
      color: var(--app-muted, #8f7a66);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .8px;
    }

    .solo-floating-right {
      display: flex;
      justify-content: flex-end;
    }

    body.solo-active .container {
      width: 540px;
      max-width: calc(100% - 8px);
      box-sizing: border-box;
      margin: 0 auto !important;
      padding: 18px;
      border: 2px solid var(--app-accent, #8f7a66);
      border-radius: 16px;
      background: var(--app-card, #fff);
      box-shadow: 0 7px 24px var(--app-shadow, rgba(0,0,0,.08));
    }

    body.solo-active .container .heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }

    body.solo-active .container .title {
      display: block !important;
      float: none;
      margin: 0;
      font-size: 58px;
      line-height: .95;
      color: var(--app-text, #776e65);
    }

    body.solo-active .container .scores-container {
      float: none;
      display: flex;
      gap: 6px;
    }

    body.solo-active .container .score-container,
    body.solo-active .container .best-container {
      margin: 0;
    }

    .solo-card-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
      margin: 0 0 14px;
    }

    .solo-card-actions kbd,
    .freeplay-controls kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 22px;
      height: 22px;
      margin-left: 5px;
      padding: 0 5px;
      box-sizing: border-box;
      border: 1px solid currentColor;
      border-radius: 5px;
      font: inherit;
      font-size: 10px;
      opacity: .78;
    }

    body.solo-active .container .above-game,
    body.solo-active .container .game-explanation,
    body.solo-active .container > hr,
    body.solo-active .container > p {
      display: none !important;
    }

    body.solo-active .game-container {
      margin-top: 0;
    }

    .battle-mode-title {
      text-align: center;
      min-width: 0;
    }

    .battle-mode-title strong {
      display: block;
      font-size: 20px;
      line-height: 1.05;
      color: var(--app-text, #776e65);
    }

    .battle-mode-title span {
      display: inline-block;
      margin-top: 5px;
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .7px;
      text-transform: uppercase;
      color: var(--app-muted, #8f7a66);
    }

    .battle-topbar {
      display: grid;
      grid-template-columns: 150px 1fr 220px;
      align-items: center;
      gap: 12px;
      margin-bottom: 10px;
    }

    .battle-topbar-right {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      min-width: 0;
    }

    .battle-room-mini {
      opacity: .82;
    }

    .progress-wrap {
      margin-top: 12px;
    }

    .progress-track {
      width: 100%;
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--app-soft, #eee4da);
    }

    .progress-fill {
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: var(--app-accent, #8f7a66);
      transition: width 260ms cubic-bezier(.2,.8,.2,1);
    }

    .progress-meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-top: 6px;
      color: var(--app-muted, #8f7a66);
      font-size: 11px;
      font-weight: 800;
    }

    .progress-note {
      min-height: 16px;
      margin-top: 5px;
      color: var(--app-accent, #8f7a66);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .5px;
      text-transform: uppercase;
    }

    .stat-pair {
      display: flex;
      gap: 6px;
    }

    .mini-stat {
      min-width: 70px;
      padding: 8px 9px;
      border-radius: 7px;
      box-sizing: border-box;
      background: var(--app-stat, #bbada0);
      color: var(--app-on-accent, #fff);
      text-align: center;
      font-weight: bold;
    }

    .mini-stat span {
      display: block;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: .45px;
      opacity: .82;
    }

    .mini-stat strong {
      display: block;
      margin-top: 2px;
      font-size: 18px;
    }

    .freeplay-controls {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 12px 0 0;
    }

    .custom-target-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
      margin: 16px 0;
    }

    .custom-target-panel {
      padding: 15px;
      border: 1px solid var(--app-border, #ddd3c8);
      border-radius: 9px;
      background: var(--app-soft, #f1ece3);
    }

    .custom-target-panel h3 {
      margin: 0 0 5px;
      font-size: 15px;
      color: var(--app-text, #776e65);
    }

    .custom-target-panel p {
      margin: 0 0 9px;
      font-size: 12px;
      color: var(--app-muted, #8f7a66);
    }

    .freeplay-banner {
      margin: 0 0 16px;
      padding: 10px 13px;
      border-radius: 9px;
      background: var(--app-soft, #eee4da);
      color: var(--app-muted, #8f7a66);
      text-align: center;
      font-size: 12px;
      font-weight: 700;
    }

    @media (max-width: 900px) {
      .battle-topbar {
        grid-template-columns: 120px 1fr 170px;
      }
    }

    @media (max-width: 620px) {
      .solo-floating-header {
        grid-template-columns: 82px 1fr 82px;
      }

      .solo-floating-center strong {
        font-size: 20px;
      }

      body.solo-active .container {
        padding: 10px;
      }

      body.solo-active .container .title {
        font-size: 44px;
      }

      .battle-topbar {
        grid-template-columns: 1fr 1fr;
      }

      .battle-mode-title {
        grid-column: 1 / -1;
        grid-row: 1;
      }

      .battle-topbar > .danger-button {
        grid-column: 1;
        grid-row: 2;
        justify-self: start;
      }

      .battle-topbar-right {
        grid-column: 2;
        grid-row: 2;
      }

      .battle-room-mini {
        display: none;
      }

      .custom-target-grid {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(v37Style);

  // =========================================================
  // v38 VISUAL DESIGN PASS
  // Fast competitive puzzle-game styling inspired by arcade HUDs.
  // Gameplay logic remains unchanged.
  // =========================================================

  var v38Style = document.createElement("style");
  v38Style.textContent = `
    :root {
      --hud-display: "Oxanium", "Arial Narrow", sans-serif;
      --hud-body: "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      --hud-radius: 4px;
      --hud-cut: 14px;
      --hud-speed: 220ms;
    }

    html,
    body {
      min-height: 100%;
    }

    html {
      background: var(--game-bg-a) !important;
    }

    body {
      position: relative;
      isolation: isolate;
      overflow-x: hidden;
      background: transparent !important;
      font-family: var(--hud-body) !important;
      letter-spacing: .01em;
    }

    #app-root,
    #game-host,
    .battle-shell,
    .settings-overlay,
    .result-overlay {
      font-family: var(--hud-body) !important;
    }

    h1,
    h2,
    h3,
    .app-title-brand,
    .game-logo-rinas,
    .game-logo-number,
    .battle-mode-title,
    .player-name,
    .rank-badge,
    .score-container,
    .best-container,
    .highest-box,
    .mini-stat,
    .stat-card strong,
    .room-code-display {
      font-family: var(--hud-display) !important;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
    }

    body::before {
      z-index: -3;
      background:
        radial-gradient(circle at 18% 10%, var(--game-glow-a), transparent 32%),
        radial-gradient(circle at 82% 76%, var(--game-glow-b), transparent 34%),
        linear-gradient(145deg, var(--game-bg-a), var(--game-bg-b));
    }

    body::after {
      z-index: -2;
      opacity: var(--game-grid-opacity);
      background-image:
        linear-gradient(var(--game-grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--game-grid-line) 1px, transparent 1px),
        linear-gradient(120deg, transparent 0 48%, var(--game-stripe) 49% 51%, transparent 52% 100%);
      background-size: 42px 42px, 42px 42px, 240px 240px;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.72), rgba(0,0,0,.16));
      animation: rinas-grid-drift 24s linear infinite;
    }

    body.theme-classic {
      --app-bg: #f3efe6;
      --app-card: #fffaf0;
      --app-soft: #e9dfd0;
      --app-border: #cbbbab;
      --app-text: #2c2825;
      --app-muted: #776e65;
      --app-accent: #e96f3d;
      --app-accent-hover: #d65e2e;
      --app-on-accent: #fffaf4;
      --app-board: #a99786;
      --app-cell: rgba(255, 246, 232, .38);
      --app-stat: #39312c;
      --app-danger: #b9424b;
      --app-overlay: rgba(24, 20, 18, .76);
      --app-message-bg: rgba(255, 250, 240, .92);
      --app-shadow: rgba(55, 36, 24, .22);
      --game-bg-a: #efe7da;
      --game-bg-b: #fbf7ef;
      --game-panel: rgba(255,250,240,.82);
      --game-panel-strong: #fffaf0;
      --game-line: rgba(78,62,49,.20);
      --game-grid-line: rgba(78,62,49,.09);
      --game-grid-opacity: .72;
      --game-stripe: rgba(233,111,61,.07);
      --game-glow-a: rgba(242,177,121,.32);
      --game-glow-b: rgba(237,194,46,.18);
      --game-accent-2: #f2b179;
      --game-accent-3: #edc22e;
      --game-deep: #2c2825;
      --game-on-deep: #fffaf0;
    }

    body.theme-pastel {
      --app-bg: #fbfbff;
      --app-card: #ffffff;
      --app-soft: #f0edfa;
      --app-border: #d8d0ed;
      --app-text: #312e43;
      --app-muted: #706a86;
      --app-accent: #8f74ff;
      --app-accent-hover: #7458e7;
      --app-on-accent: #ffffff;
      --app-board: #d9d2e9;
      --app-cell: #f4f1fb;
      --app-stat: #403956;
      --app-danger: #d85876;
      --app-overlay: rgba(37,31,53,.64);
      --app-message-bg: rgba(255,255,255,.94);
      --app-shadow: rgba(69,52,110,.18);
      --game-bg-a: #ffffff;
      --game-bg-b: #f7f4ff;
      --game-panel: rgba(255,255,255,.82);
      --game-panel-strong: #ffffff;
      --game-line: rgba(96,76,150,.18);
      --game-grid-line: rgba(96,76,150,.075);
      --game-grid-opacity: .82;
      --game-stripe: rgba(255,142,199,.07);
      --game-glow-a: rgba(143,116,255,.18);
      --game-glow-b: rgba(255,142,199,.19);
      --game-accent-2: #ff8ec7;
      --game-accent-3: #6bc8ff;
      --game-deep: #312e43;
      --game-on-deep: #ffffff;
    }

    body.theme-ocean {
      --app-bg: #071923;
      --app-card: #0e2633;
      --app-soft: #153746;
      --app-border: #2a5a69;
      --app-text: #e9fbff;
      --app-muted: #9bc7d2;
      --app-accent: #28d7df;
      --app-accent-hover: #5ce8ee;
      --app-on-accent: #052127;
      --app-board: #1f5360;
      --app-cell: #2a6572;
      --app-stat: #163846;
      --app-danger: #ff667c;
      --app-overlay: rgba(2,10,15,.82);
      --app-message-bg: rgba(7,25,35,.94);
      --app-shadow: rgba(0,0,0,.42);
      --game-bg-a: #04131c;
      --game-bg-b: #0b2531;
      --game-panel: rgba(10,36,47,.80);
      --game-panel-strong: #0e2633;
      --game-line: rgba(67,216,225,.22);
      --game-grid-line: rgba(67,216,225,.09);
      --game-grid-opacity: .85;
      --game-stripe: rgba(40,215,223,.055);
      --game-glow-a: rgba(40,215,223,.17);
      --game-glow-b: rgba(44,111,255,.15);
      --game-accent-2: #64f0b8;
      --game-accent-3: #4d89ff;
      --game-deep: #031117;
      --game-on-deep: #e9fbff;
    }

    body.theme-candy {
      --app-bg: #241222;
      --app-card: #351833;
      --app-soft: #4a2143;
      --app-border: #6b315e;
      --app-text: #fff2fb;
      --app-muted: #e4a8cf;
      --app-accent: #ff4f9f;
      --app-accent-hover: #ff7ab7;
      --app-on-accent: #2a1024;
      --app-board: #6d335e;
      --app-cell: #81446f;
      --app-stat: #4a2143;
      --app-danger: #ff695f;
      --app-overlay: rgba(20,7,18,.82);
      --app-message-bg: rgba(36,18,34,.94);
      --app-shadow: rgba(0,0,0,.36);
      --game-bg-a: #1a0b18;
      --game-bg-b: #32142e;
      --game-panel: rgba(53,24,51,.82);
      --game-panel-strong: #351833;
      --game-line: rgba(255,102,183,.22);
      --game-grid-line: rgba(255,102,183,.08);
      --game-grid-opacity: .88;
      --game-stripe: rgba(255,205,84,.05);
      --game-glow-a: rgba(255,79,159,.20);
      --game-glow-b: rgba(143,116,255,.18);
      --game-accent-2: #ffd054;
      --game-accent-3: #9b7bff;
      --game-deep: #170914;
      --game-on-deep: #fff2fb;
    }

    body.theme-midnight {
      --app-bg: #080912;
      --app-card: #121526;
      --app-soft: #1b2038;
      --app-border: #30375f;
      --app-text: #f3f4ff;
      --app-muted: #a6afd4;
      --app-accent: #8d7cff;
      --app-accent-hover: #a899ff;
      --app-on-accent: #0d0e18;
      --app-board: #262b49;
      --app-cell: #343a5d;
      --app-stat: #1f2440;
      --app-danger: #ff5c82;
      --app-overlay: rgba(2,3,8,.88);
      --app-message-bg: rgba(8,9,18,.94);
      --app-shadow: rgba(0,0,0,.50);
      --game-bg-a: #05060c;
      --game-bg-b: #111326;
      --game-panel: rgba(18,21,38,.84);
      --game-panel-strong: #121526;
      --game-line: rgba(141,124,255,.24);
      --game-grid-line: rgba(141,124,255,.09);
      --game-grid-opacity: .90;
      --game-stripe: rgba(68,221,255,.05);
      --game-glow-a: rgba(141,124,255,.20);
      --game-glow-b: rgba(68,221,255,.14);
      --game-accent-2: #44ddff;
      --game-accent-3: #ff5ca8;
      --game-deep: #05060c;
      --game-on-deep: #f3f4ff;
    }

    @keyframes rinas-grid-drift {
      from { background-position: 0 0, 0 0, 0 0; }
      to { background-position: 42px 42px, 42px 42px, 240px 120px; }
    }

    @keyframes rinas-screen-in-forward {
      from { opacity: 0; transform: translateX(48px) scale(.99); filter: blur(2px); }
      to { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
    }

    @keyframes rinas-screen-in-back {
      from { opacity: 0; transform: translateX(-48px) scale(.99); filter: blur(2px); }
      to { opacity: 1; transform: translateX(0) scale(1); filter: blur(0); }
    }

    @keyframes rinas-screen-out-forward {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(-42px) scale(.99); }
    }

    @keyframes rinas-screen-out-back {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to { opacity: 0; transform: translateX(42px) scale(.99); }
    }

    @keyframes rinas-logo-pulse {
      0%, 100% { transform: translateY(0); text-shadow: 0 0 0 transparent; }
      50% { transform: translateY(-3px); text-shadow: 0 10px 30px var(--game-glow-a); }
    }

    @keyframes rinas-tile-float-a {
      0%,100% { transform: translate(0,0) rotate(-6deg); }
      50% { transform: translate(8px,-12px) rotate(2deg); }
    }

    @keyframes rinas-tile-float-b {
      0%,100% { transform: translate(0,0) rotate(5deg); }
      50% { transform: translate(-9px,11px) rotate(-2deg); }
    }

    @keyframes rinas-shimmer {
      from { background-position: -180% 0; }
      to { background-position: 180% 0; }
    }

    .app-screen {
      min-height: 100vh;
      padding: 22px 22px 56px;
      background: transparent !important;
      color: var(--app-text) !important;
      animation: none !important;
    }

    .app-screen.enter-forward {
      animation: rinas-screen-in-forward var(--hud-speed) cubic-bezier(.2,.85,.2,1) both !important;
    }

    .app-screen.enter-back {
      animation: rinas-screen-in-back var(--hud-speed) cubic-bezier(.2,.85,.2,1) both !important;
    }

    .screen-ghost {
      position: fixed !important;
      inset: 0 !important;
      z-index: 9000 !important;
      width: 100% !important;
      height: 100% !important;
      overflow: hidden !important;
      pointer-events: none !important;
      background: transparent !important;
    }

    .screen-ghost.forward {
      animation: rinas-screen-out-forward var(--hud-speed) cubic-bezier(.4,0,.2,1) both !important;
    }

    .screen-ghost.back {
      animation: rinas-screen-out-back var(--hud-speed) cubic-bezier(.4,0,.2,1) both !important;
    }

    .app-screen-inner {
      max-width: 980px;
    }

    .app-header {
      position: relative;
      min-height: 62px;
      grid-template-columns: 160px 1fr 160px;
      margin-bottom: 34px;
      padding: 7px 0 11px;
      border-bottom: 1px solid var(--game-line);
    }

    .app-header::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -2px;
      width: 96px;
      height: 3px;
      transform: translateX(-50%);
      background: linear-gradient(90deg, transparent, var(--app-accent), var(--game-accent-2), transparent);
    }

    .app-title-stack {
      min-width: 0;
      text-align: center;
    }

    .app-title-brand {
      display: block;
      margin-bottom: 2px;
      color: var(--app-accent);
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      letter-spacing: .24em;
      text-transform: uppercase;
    }

    .app-header h1 {
      margin: 0;
      color: var(--app-text) !important;
      font-size: 32px;
      font-weight: 700;
      line-height: 1.05;
      letter-spacing: -.03em;
      text-transform: uppercase;
    }

    .nav-button,
    .settings-button,
    .secondary-button,
    .primary-button,
    .danger-button,
    .small-button,
    .target-button,
    .control-choice,
    .toggle-button {
      position: relative;
      overflow: hidden;
      border-radius: 3px !important;
      border: 1px solid var(--game-line) !important;
      font-family: var(--hud-display) !important;
      font-weight: 700 !important;
      letter-spacing: .035em;
      text-transform: uppercase;
      box-shadow: none !important;
    }

    .nav-button,
    .settings-button,
    .secondary-button,
    .small-button,
    .target-button,
    .control-choice,
    .toggle-button.off {
      background: var(--game-panel) !important;
      color: var(--app-text) !important;
      backdrop-filter: blur(12px);
    }

    .primary-button,
    .toggle-button.on,
    .target-button.selected,
    .control-choice.selected {
      border-color: color-mix(in srgb, var(--app-accent) 74%, white 6%) !important;
      background: linear-gradient(110deg, var(--app-accent), var(--game-accent-2)) !important;
      color: var(--app-on-accent) !important;
      box-shadow: 0 0 24px var(--game-glow-a) !important;
    }

    .danger-button {
      border-color: color-mix(in srgb, var(--app-danger) 70%, transparent) !important;
      background: color-mix(in srgb, var(--app-danger) 76%, var(--game-deep)) !important;
      color: white !important;
    }

    button:not(:disabled)::after,
    .target-button:not(:disabled)::after,
    .control-choice:not(:disabled)::after {
      content: "";
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(110deg, transparent 20%, rgba(255,255,255,.15) 45%, transparent 70%);
      transform: translateX(-130%);
      transition: transform 240ms ease;
    }

    @media (hover:hover) and (pointer:fine) {
      button:not(:disabled):hover::after,
      .target-button:not(:disabled):hover::after,
      .control-choice:not(:disabled):hover::after {
        transform: translateX(130%);
      }

      .primary-button:hover:not(:disabled),
      .secondary-button:hover:not(:disabled),
      .nav-button:hover:not(:disabled),
      .settings-button:hover:not(:disabled),
      .small-button:hover:not(:disabled) {
        transform: translateY(-2px) !important;
        border-color: var(--app-accent) !important;
      }
    }

    button:not(:disabled):active {
      transform: translateY(1px) scale(.985) !important;
    }

    /* TITLE SCREEN */
    .screen-menu .app-screen-inner {
      max-width: 900px;
    }

    .screen-menu .app-header {
      grid-template-columns: 1fr 150px;
      margin-bottom: 0;
      border-bottom: 0;
    }

    .screen-menu .app-header::after,
    .screen-menu .app-header-side.left,
    .screen-menu .app-title-stack {
      display: none;
    }

    .screen-menu .app-header-side.right {
      grid-column: 2;
    }

    .title-stage {
      position: relative;
      min-height: 285px;
      display: grid;
      place-items: center;
      margin: 0 auto 18px;
      isolation: isolate;
    }

    .title-stage::before {
      content: "";
      position: absolute;
      width: min(560px, 90vw);
      height: 160px;
      border: 1px solid var(--game-line);
      clip-path: polygon(7% 0, 100% 0, 93% 100%, 0 100%);
      background: linear-gradient(90deg, transparent, var(--game-panel), transparent);
      z-index: -1;
      opacity: .72;
    }

    .game-logo {
      position: relative;
      text-align: center;
      animation: rinas-logo-pulse 4s ease-in-out infinite;
    }

    .game-logo-rinas {
      display: block;
      margin-left: .2em;
      color: var(--app-text);
      font-size: 27px;
      font-weight: 700;
      letter-spacing: .26em;
      line-height: 1;
    }

    .game-logo-number {
      display: block;
      margin-top: 3px;
      color: var(--app-text);
      font-size: clamp(78px, 12vw, 122px);
      font-weight: 800;
      letter-spacing: -.08em;
      line-height: .78;
    }

    .game-logo-number em {
      color: var(--app-accent);
      font-style: normal;
      text-shadow: 0 0 28px var(--game-glow-a);
    }

    .logo-tagline {
      margin: 18px 0 0;
      color: var(--app-muted);
      font-family: var(--hud-display);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .14em;
      text-transform: uppercase;
    }

    .logo-float-tile {
      position: absolute;
      width: 48px;
      height: 48px;
      display: grid;
      place-items: center;
      border: 1px solid var(--game-line);
      background: var(--game-panel-strong);
      color: var(--app-text);
      font-family: var(--hud-display);
      font-size: 18px;
      font-weight: 800;
      box-shadow: 0 10px 30px var(--app-shadow);
    }

    .logo-float-tile.one {
      left: -75px;
      top: 6px;
      background: var(--tile-8);
      color: var(--tile-light-text);
      animation: rinas-tile-float-a 4.2s ease-in-out infinite;
    }

    .logo-float-tile.two {
      right: -74px;
      bottom: 2px;
      background: var(--tile-16);
      color: var(--tile-light-text);
      animation: rinas-tile-float-b 4.6s ease-in-out infinite;
    }

    .hero-subtitle {
      margin: 0;
      color: var(--app-muted) !important;
    }

    .home-mode-grid {
      max-width: 720px;
      margin: 0 auto;
      grid-template-columns: 1fr !important;
      gap: 12px !important;
    }

    .home-mode-card {
      min-height: 110px !important;
      display: grid !important;
      grid-template-columns: 76px minmax(0,1fr) 92px;
      align-items: center;
      gap: 18px;
      padding: 16px 22px !important;
      border: 1px solid var(--game-line) !important;
      border-left: 4px solid var(--app-accent) !important;
      border-radius: 2px !important;
      background:
        linear-gradient(100deg, color-mix(in srgb, var(--app-accent) 10%, transparent), transparent 48%),
        var(--game-panel) !important;
      color: var(--app-text) !important;
      clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 14px 100%, 0 calc(100% - 14px));
      backdrop-filter: blur(16px);
    }

    .home-mode-card.multiplayer-card {
      border-left-color: var(--game-accent-2) !important;
      background:
        linear-gradient(100deg, color-mix(in srgb, var(--game-accent-2) 12%, transparent), transparent 48%),
        var(--game-panel) !important;
    }

    .home-mode-card .mode-icon {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      margin: 0;
      border: 1px solid var(--game-line);
      background: var(--app-soft);
      font-size: 28px;
    }

    .home-mode-card h2 {
      margin: 0 0 3px;
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      font-size: 26px;
      font-weight: 700;
      letter-spacing: -.025em;
      text-transform: uppercase;
    }

    .home-mode-card p {
      margin: 0;
      color: var(--app-muted) !important;
      font-size: 14px;
      line-height: 1.32;
    }

    .mode-enter {
      justify-self: end;
      color: var(--app-accent);
      font-family: var(--hud-display);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: .08em;
      text-transform: uppercase;
    }

    .multiplayer-card .mode-enter {
      color: var(--game-accent-2);
    }

    .mode-enter::after {
      content: "  ›";
      font-size: 20px;
      vertical-align: -1px;
    }

    .home-footnote {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      margin-top: 20px;
      color: var(--app-muted);
      font-family: var(--hud-display);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: .12em;
      text-transform: uppercase;
    }

    .home-footnote i {
      width: 4px;
      height: 4px;
      background: var(--app-accent);
      transform: rotate(45deg);
    }

    /* GENERIC MENUS */
    .screen-solo-menu .app-screen-inner {
      max-width: 760px;
    }

    .screen-multiplayer-menu .app-screen-inner {
      max-width: 1080px;
    }

    .screen-multiplayer-menu .mode-grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .screen-multiplayer-menu .mode-live {
      min-height: 190px !important;
    }

    .screen-multiplayer-menu .mode-live .mode-icon {
      width: 44px;
      height: 44px;
      display: grid;
      place-items: center;
      margin: 0 0 18px;
      border: 1px solid var(--game-line);
      background: var(--app-soft);
      font-size: 23px;
    }

    .screen-multiplayer-menu .coming-soon {
      min-height: 122px !important;
      opacity: .52 !important;
    }

    .screen-multiplayer-menu .coming-soon .mode-icon {
      font-size: 22px;
      margin-bottom: 5px;
    }

    .screen-multiplayer-menu .coming-soon h3 {
      font-size: 16px;
    }

    .screen-multiplayer-menu .coming-soon p {
      font-size: 12px;
    }

    .mode-grid:not(.home-mode-grid) {
      gap: 12px !important;
    }

    .mode-grid:not(.home-mode-grid) .mode-card {
      min-height: 156px;
      padding: 18px 18px 17px 20px;
      border: 1px solid var(--game-line) !important;
      border-radius: 2px !important;
      background: var(--game-panel) !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
      clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
      backdrop-filter: blur(14px);
    }

    .mode-grid:not(.home-mode-grid) button.mode-card::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 4px;
      background: linear-gradient(var(--app-accent), var(--game-accent-2));
    }

    .mode-card h2,
    .mode-card h3 {
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      text-transform: uppercase;
      letter-spacing: -.015em;
    }

    .mode-card p {
      color: var(--app-muted) !important;
      font-size: 14px;
      line-height: 1.35;
    }

    .mode-card .mode-kicker,
    .coming-soon-badge {
      border-radius: 2px !important;
      background: var(--app-soft) !important;
      color: var(--app-muted) !important;
      font-family: var(--hud-display);
      letter-spacing: .08em;
    }

    .identity-line,
    .info-card,
    .rules-card,
    .race-box,
    .custom-target-panel,
    .freeplay-banner {
      border: 1px solid var(--game-line) !important;
      border-radius: 2px !important;
      background: var(--game-panel) !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
      backdrop-filter: blur(14px);
    }

    .info-card,
    .rules-card,
    .freeplay-banner {
      position: relative;
      overflow: hidden;
    }

    .info-card::before,
    .rules-card::before,
    .freeplay-banner::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 3px;
      background: var(--app-accent);
    }

    .stat-card {
      border: 1px solid var(--game-line);
      border-radius: 2px !important;
      background: var(--game-deep) !important;
      color: var(--game-on-deep) !important;
      clip-path: polygon(0 0, calc(100% - 9px) 0, 100% 9px, 100% 100%, 0 100%);
    }

    .stat-card span {
      color: color-mix(in srgb, var(--game-on-deep) 68%, transparent);
      font-family: var(--hud-display);
      letter-spacing: .09em;
    }

    .stat-card strong {
      color: var(--game-on-deep);
      font-size: 30px;
    }

    .race-box h2,
    .rules-card strong,
    .settings-section h3 {
      font-family: var(--hud-display) !important;
      text-transform: uppercase;
      letter-spacing: .04em;
    }

    .room-input,
    .nickname-field {
      border-radius: 2px !important;
      border: 1px solid var(--game-line) !important;
      background: color-mix(in srgb, var(--game-panel-strong) 88%, transparent) !important;
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      font-weight: 600;
      box-shadow: inset 0 -2px 0 color-mix(in srgb, var(--app-accent) 20%, transparent);
    }

    .room-input:focus,
    .nickname-field:focus {
      border-color: var(--app-accent) !important;
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--app-accent) 18%, transparent);
    }

    /* SETTINGS */
    .settings-overlay,
    .result-overlay {
      background: color-mix(in srgb, var(--app-overlay) 88%, transparent) !important;
      backdrop-filter: blur(10px);
    }

    .settings-dialog,
    .result-box {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--game-line) !important;
      border-top: 4px solid var(--app-accent) !important;
      border-radius: 2px !important;
      background: var(--game-panel-strong) !important;
      color: var(--app-text) !important;
      box-shadow: 0 24px 70px var(--app-shadow) !important;
    }

    .settings-dialog::after,
    .result-box::after {
      content: "";
      position: absolute;
      width: 80px;
      height: 80px;
      right: -40px;
      bottom: -40px;
      border: 1px solid var(--game-line);
      transform: rotate(45deg);
      pointer-events: none;
    }

    .settings-dialog h2,
    .result-box h1 {
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      text-transform: uppercase;
      letter-spacing: -.02em;
    }

    .settings-help {
      color: var(--app-muted) !important;
    }

    .settings-section + .settings-section {
      border-top-color: var(--game-line) !important;
    }

    .theme-choice {
      border-radius: 2px !important;
      border: 1px solid var(--game-line) !important;
      background: var(--game-panel) !important;
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      text-transform: uppercase;
    }

    .theme-choice.selected {
      border-color: var(--app-accent) !important;
      box-shadow: inset 3px 0 0 var(--app-accent) !important;
    }

    .theme-swatches i {
      border-radius: 1px !important;
    }

    /* SOLO GAME */
    body.solo-active #game-host {
      min-height: 100vh;
      padding: 18px 18px 58px !important;
      background: transparent !important;
    }

    body.solo-active #solo-toolbar {
      width: min(860px, calc(100% - 12px));
      margin: 0 auto 16px;
    }

    .solo-floating-header {
      position: relative;
      min-height: 60px;
      padding: 7px 0 10px;
      border-bottom: 1px solid var(--game-line);
    }

    .solo-floating-header::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -2px;
      width: 76px;
      height: 3px;
      transform: translateX(-50%);
      background: linear-gradient(90deg, transparent, var(--app-accent), transparent);
    }

    .solo-floating-center strong {
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      font-size: 25px;
      letter-spacing: -.035em;
      text-transform: uppercase;
    }

    .solo-mode-label {
      margin-top: 3px;
      padding: 0;
      border-radius: 0;
      background: transparent !important;
      color: var(--app-accent) !important;
      font-family: var(--hud-display);
      font-size: 10px;
      letter-spacing: .18em;
    }

    body.solo-active .container {
      position: relative;
      width: 560px;
      padding: 18px !important;
      border: 1px solid var(--game-line) !important;
      border-top: 4px solid var(--app-accent) !important;
      border-radius: 2px !important;
      background: var(--game-panel) !important;
      box-shadow: 0 24px 60px var(--app-shadow) !important;
      clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
      backdrop-filter: blur(14px);
    }

    body.solo-active .container::after {
      content: "SOLO RUN";
      position: absolute;
      right: 18px;
      bottom: 8px;
      color: var(--game-line);
      font-family: var(--hud-display);
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .18em;
      pointer-events: none;
    }

    body.solo-active .container .heading {
      margin-bottom: 12px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--game-line);
    }

    body.solo-active .container .title {
      color: var(--app-text) !important;
      font-size: 56px !important;
      font-weight: 800 !important;
      letter-spacing: -.075em;
      text-shadow: 0 0 28px var(--game-glow-a);
    }

    body.solo-active .container .score-container,
    body.solo-active .container .best-container {
      min-width: 78px;
      margin: 0 !important;
      padding: 7px 10px !important;
      border: 1px solid var(--game-line);
      border-radius: 2px !important;
      background: var(--game-deep) !important;
      color: var(--game-on-deep) !important;
      font-family: var(--hud-display) !important;
      box-shadow: none !important;
    }

    body.solo-active .container .score-container::after,
    body.solo-active .container .best-container::after {
      color: color-mix(in srgb, var(--game-on-deep) 68%, transparent) !important;
      font-family: var(--hud-display) !important;
      letter-spacing: .08em;
    }

    .solo-card-actions {
      justify-content: space-between !important;
      margin-bottom: 12px !important;
      padding: 0;
    }

    .solo-card-actions .small-button {
      min-width: 112px;
    }

    .solo-card-actions kbd,
    .freeplay-controls kbd {
      border-radius: 2px !important;
      border-color: currentColor !important;
      font-family: var(--hud-display) !important;
    }

    body.solo-active .game-container {
      border: 1px solid var(--game-line);
      box-shadow: 0 16px 36px var(--app-shadow);
    }

    /* MULTIPLAYER MATCH */
    .battle-shell {
      max-width: 1240px !important;
      margin: 0 auto !important;
      padding: 18px 22px 54px !important;
      background: transparent !important;
      color: var(--app-text) !important;
    }

    .battle-topbar {
      position: relative;
      min-height: 62px;
      margin-bottom: 6px !important;
      padding: 6px 0 10px;
      border-bottom: 1px solid var(--game-line);
    }

    .battle-topbar::after {
      content: "";
      position: absolute;
      left: 50%;
      bottom: -2px;
      width: 92px;
      height: 3px;
      transform: translateX(-50%);
      background: linear-gradient(90deg, transparent, var(--app-accent), var(--game-accent-2), transparent);
    }

    .battle-mode-title strong {
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      font-size: 24px !important;
      letter-spacing: -.025em;
      text-transform: uppercase;
    }

    .battle-mode-title span {
      color: var(--app-accent) !important;
      letter-spacing: .14em !important;
    }

    .battle-room-mini {
      border: 1px solid var(--game-line);
      border-radius: 2px !important;
      background: var(--game-panel) !important;
      color: var(--app-muted) !important;
      font-family: var(--hud-display);
      letter-spacing: .12em !important;
    }

    .battle-heading {
      margin: 6px 0 18px !important;
    }

    .battle-rule-line {
      max-width: 740px;
      color: var(--app-muted) !important;
      font-size: 13px !important;
      letter-spacing: .01em;
    }

    .battle-layout {
      grid-template-columns: minmax(0, 570px) 66px minmax(0, 370px) !important;
      column-gap: 34px !important;
      align-items: stretch !important;
    }

    .battle-player-card {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--game-line) !important;
      border-radius: 2px !important;
      background: var(--game-panel) !important;
      box-shadow: 0 20px 52px var(--app-shadow) !important;
      clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
      backdrop-filter: blur(14px);
    }

    .battle-player-card::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0;
      width: 100%;
      height: 4px;
      background: var(--game-line);
    }

    .own-panel {
      width: 570px !important;
      border-color: color-mix(in srgb, var(--app-accent) 45%, var(--game-line)) !important;
    }

    .own-panel::before {
      background: linear-gradient(90deg, var(--app-accent), var(--game-accent-2));
      box-shadow: 0 0 22px var(--game-glow-a);
    }

    .opponent-panel {
      width: 370px !important;
    }

    .player-card-header {
      min-height: 88px !important;
      margin-bottom: 8px !important;
      padding-bottom: 9px;
      border-bottom: 1px solid var(--game-line);
    }

    .player-name {
      color: var(--app-text) !important;
      font-size: 27px !important;
      font-weight: 700 !important;
      letter-spacing: -.035em;
      text-transform: uppercase;
    }

    .player-subline {
      color: var(--app-muted) !important;
      font-family: var(--hud-display);
      letter-spacing: .10em !important;
    }

    .rank-badge {
      min-width: 54px !important;
      border: 1px solid var(--game-line);
      border-radius: 2px !important;
      background: var(--app-soft) !important;
      color: var(--app-text) !important;
      font-size: 11px !important;
      letter-spacing: .08em !important;
      clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%);
    }

    .rank-badge.first {
      border-color: var(--app-accent) !important;
      background: linear-gradient(110deg, var(--app-accent), var(--game-accent-2)) !important;
      color: var(--app-on-accent) !important;
      box-shadow: 0 0 20px var(--game-glow-a);
    }

    .highest-box,
    .mini-stat {
      border: 1px solid var(--game-line);
      border-radius: 2px !important;
      background: var(--game-deep) !important;
      color: var(--game-on-deep) !important;
      clip-path: polygon(0 0, calc(100% - 7px) 0, 100% 7px, 100% 100%, 0 100%);
    }

    .highest-box span,
    .mini-stat span {
      color: color-mix(in srgb, var(--game-on-deep) 68%, transparent) !important;
      letter-spacing: .09em !important;
    }

    .battle-vs {
      padding-top: 160px !important;
      align-items: flex-start !important;
    }

    .battle-vs span {
      position: relative;
      width: 64px !important;
      height: 64px !important;
      border: 1px solid var(--app-accent) !important;
      border-radius: 0 !important;
      background: var(--game-deep) !important;
      color: var(--game-on-deep) !important;
      font-family: var(--hud-display);
      font-size: 17px !important;
      font-weight: 800 !important;
      clip-path: polygon(50% 0, 100% 24%, 100% 76%, 50% 100%, 0 76%, 0 24%);
      box-shadow: 0 0 30px var(--game-glow-a);
    }

    .battle-vs span::before,
    .battle-vs span::after {
      content: "";
      position: absolute;
      left: 50%;
      width: 1px;
      height: 52px;
      background: linear-gradient(transparent, var(--game-line));
      transform: translateX(-50%);
    }

    .battle-vs span::before { bottom: 100%; }
    .battle-vs span::after { top: 100%; transform: translateX(-50%) rotate(180deg); }

    .progress-track {
      height: 11px !important;
      border: 1px solid var(--game-line);
      border-radius: 1px !important;
      background:
        repeating-linear-gradient(90deg, var(--app-soft) 0 14px, color-mix(in srgb, var(--app-soft) 70%, transparent) 14px 16px) !important;
    }

    .progress-fill {
      position: relative;
      border-radius: 0 !important;
      background:
        linear-gradient(90deg, var(--app-accent), var(--game-accent-2), var(--app-accent)) !important;
      background-size: 180% 100% !important;
      box-shadow: 0 0 16px var(--game-glow-a);
      animation: rinas-shimmer 2.4s linear infinite;
    }

    .progress-meta,
    .progress-note {
      font-family: var(--hud-display);
      letter-spacing: .07em !important;
    }

    .opponent-grid {
      border: 1px solid color-mix(in srgb, var(--app-accent) 24%, var(--game-line));
      border-radius: 2px !important;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.03), 0 12px 26px var(--app-shadow);
    }

    .opponent-cell {
      border-radius: 1px !important;
      font-family: var(--hud-display);
      font-weight: 700;
    }

    #opponent-status {
      color: var(--app-muted) !important;
      font-family: var(--hud-display);
      font-size: 10px !important;
      letter-spacing: .07em;
      text-transform: uppercase;
    }

    #battle-toast,
    #solo-milestone-toast {
      border: 1px solid color-mix(in srgb, var(--app-accent) 70%, white 5%) !important;
      border-radius: 2px !important;
      background: var(--game-deep) !important;
      color: var(--game-on-deep) !important;
      font-family: var(--hud-display) !important;
      letter-spacing: .05em;
      text-transform: uppercase;
      box-shadow: 0 0 28px var(--game-glow-a) !important;
    }

    .result-icon {
      filter: drop-shadow(0 8px 20px var(--game-glow-a));
    }

    /* Native 2048 board gets a crisper competitive-game finish. */
    .game-container {
      border-radius: 3px !important;
      background: var(--app-board) !important;
    }

    .grid-cell {
      border-radius: 2px !important;
      background: var(--app-cell) !important;
    }

    .tile .tile-inner {
      border-radius: 2px !important;
      font-family: var(--hud-display) !important;
      font-weight: 700 !important;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.09);
    }

    /* Small HUD line under active cards. */
    .race-box,
    .custom-target-panel,
    .battle-player-card,
    body.solo-active .container {
      isolation: isolate;
    }

    @media (max-width: 900px) {
      .battle-layout {
        grid-template-columns: minmax(0, 570px) !important;
        row-gap: 14px !important;
      }

      .battle-vs {
        padding-top: 0 !important;
      }

      .battle-vs span {
        width: 88px !important;
        height: 34px !important;
        clip-path: polygon(10px 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 10px 100%, 0 50%);
      }

      .battle-vs span::before,
      .battle-vs span::after {
        display: none;
      }

      .opponent-panel {
        width: min(370px, 100%) !important;
      }
    }

    @media (max-width: 680px) {
      .app-screen {
        padding: 12px 12px 42px;
      }

      .app-header {
        grid-template-columns: 92px 1fr 92px;
      }

      .app-header h1 {
        font-size: 24px;
      }

      .app-title-brand {
        font-size: 8px;
      }

      .title-stage {
        min-height: 240px;
      }

      .game-logo-rinas {
        font-size: 20px;
      }

      .logo-float-tile {
        width: 38px;
        height: 38px;
        font-size: 14px;
      }

      .logo-float-tile.one { left: -43px; }
      .logo-float-tile.two { right: -42px; }

      .home-mode-card {
        grid-template-columns: 58px minmax(0,1fr);
        gap: 12px;
        padding: 14px !important;
      }

      .home-mode-card .mode-icon {
        width: 48px;
        height: 48px;
        font-size: 23px;
      }

      .home-mode-card h2 {
        font-size: 21px;
      }

      .home-mode-card p {
        font-size: 13px;
      }

      .mode-enter {
        display: none;
      }

      .mode-grid:not(.home-mode-grid),
      .screen-multiplayer-menu .mode-grid {
        grid-template-columns: 1fr !important;
      }

      .home-footnote {
        flex-wrap: wrap;
        font-size: 9px;
      }

      .solo-floating-header {
        grid-template-columns: 84px 1fr 84px !important;
      }

      .solo-floating-center strong {
        font-size: 19px !important;
      }

      body.solo-active .container {
        width: min(520px, 100%);
        max-width: 100% !important;
        padding: 10px !important;
      }

      body.solo-active .container .title {
        font-size: 42px !important;
      }

      body.solo-active .container .score-container,
      body.solo-active .container .best-container {
        min-width: 66px;
        padding: 6px !important;
      }

      .solo-card-actions .small-button {
        min-width: 0;
        flex: 1;
      }

      .battle-shell {
        padding: 10px 10px 42px !important;
      }

      .battle-player-card {
        padding: 12px !important;
      }

      .own-panel {
        width: 100% !important;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      body::after,
      .game-logo,
      .logo-float-tile,
      .progress-fill,
      .app-screen,
      .screen-ghost {
        animation: none !important;
      }
    }
  `;
  document.head.appendChild(v38Style);

  // =========================================================
  // v39: playful graphic UI + integrated HUD + audio controls
  // =========================================================

  var v39Style = document.createElement("style");
  v39Style.textContent = `
    :root {
      --hud-display: "Barlow Semi Condensed", "Arial Narrow", sans-serif;
      --hud-body: "Barlow Semi Condensed", "Helvetica Neue", Arial, sans-serif;
      --tile-font: "Nunito Sans", "Arial Rounded MT Bold", Arial, sans-serif;
      --fun-teal: #34c8ba;
      --fun-coral: #ff694f;
      --fun-yellow: #ffc54d;
      --fun-ink: #282522;
    }

    body {
      background: var(--game-bg-b) !important;
    }

    body::before {
      background:
        radial-gradient(circle at 16% 13%, color-mix(in srgb, var(--fun-coral) 12%, transparent), transparent 30%),
        radial-gradient(circle at 82% 77%, color-mix(in srgb, var(--fun-yellow) 12%, transparent), transparent 32%),
        linear-gradient(145deg, var(--game-bg-a), var(--game-bg-b)) !important;
    }

    body::after {
      opacity: .28 !important;
      background-image:
        linear-gradient(var(--game-grid-line) 1px, transparent 1px),
        linear-gradient(90deg, var(--game-grid-line) 1px, transparent 1px) !important;
      background-size: 44px 44px !important;
      animation: none !important;
      mask-image: linear-gradient(to bottom, rgba(0,0,0,.45), rgba(0,0,0,.10)) !important;
    }

    .app-screen {
      background: transparent !important;
    }

    .app-screen-inner {
      max-width: 860px !important;
    }

    .screen-menu .app-header {
      min-height: 38px !important;
      margin-bottom: 0 !important;
    }

    .screen-menu .app-title-stack {
      visibility: hidden;
    }

    .game-logo {
      transform: none !important;
      filter: none !important;
    }

    .game-logo-rinas {
      font-family: var(--hud-body) !important;
      font-weight: 800 !important;
      letter-spacing: .34em !important;
      color: var(--app-text) !important;
    }

    .game-logo-number {
      font-family: var(--tile-font) !important;
      font-weight: 900 !important;
      letter-spacing: -.075em !important;
      text-shadow: none !important;
    }

    .game-logo-number em {
      color: var(--fun-coral) !important;
      font-style: normal !important;
    }

    .logo-tagline {
      font-family: var(--hud-display) !important;
      font-size: 14px !important;
      font-weight: 800 !important;
      letter-spacing: .22em !important;
      text-transform: uppercase;
      color: var(--app-muted) !important;
    }

    .logo-float-tile {
      border-radius: 7px !important;
      box-shadow: 0 10px 22px rgba(45,33,26,.15) !important;
      font-family: var(--tile-font) !important;
    }

    .home-mode-grid { display: none !important; }

    .home-mode-stack {
      width: min(620px, 100%);
      margin: 30px auto 0;
      display: grid;
      gap: 15px;
    }

    .home-brush-button {
      position: relative;
      width: 100%;
      min-height: 92px;
      display: grid;
      grid-template-columns: 58px 1fr 34px;
      align-items: center;
      gap: 16px;
      border: 0;
      padding: 16px 24px 16px 20px;
      color: #252525;
      cursor: pointer;
      text-align: left;
      font-family: var(--hud-body);
      isolation: isolate;
      transition: transform 150ms ease, filter 150ms ease;
      clip-path: polygon(0 8%, 97% 0, 100% 14%, 98.5% 91%, 2% 100%, .8% 84%);
      box-shadow: none;
    }

    .home-brush-button::before,
    .home-brush-button::after {
      content: "";
      position: absolute;
      pointer-events: none;
      z-index: -1;
    }

    .home-brush-button::before {
      inset: 0;
      background: inherit;
    }

    .home-brush-button::after {
      inset: 4px -8px 2px 7px;
      opacity: .24;
      background:
        repeating-linear-gradient(173deg, rgba(255,255,255,.45) 0 2px, transparent 2px 7px),
        repeating-linear-gradient(7deg, rgba(0,0,0,.09) 0 1px, transparent 1px 8px);
      mix-blend-mode: soft-light;
      clip-path: polygon(0 3%, 100% 8%, 98% 88%, 1% 100%);
    }

    .solo-brush {
      background: linear-gradient(105deg, #4ad4c8, #82ded4 72%, #51c8bd);
    }

    .multiplayer-brush {
      background: linear-gradient(105deg, #ff735b, #ff8f71 70%, #ff6e52);
    }

    @media (hover:hover) and (pointer:fine) {
      .home-brush-button:hover {
        transform: translateX(7px) rotate(-.15deg);
        filter: saturate(1.08) brightness(1.02);
      }
    }

    .home-brush-button:active {
      transform: translateX(4px) scale(.992);
    }

    .brush-icon {
      width: 50px;
      height: 50px;
      display: grid;
      place-items: center;
      border: 2px solid rgba(37,37,37,.18);
      background: rgba(255,255,255,.24);
      font-size: 25px;
      transform: rotate(-2deg);
    }

    .brush-copy {
      min-width: 0;
      display: grid;
      gap: 2px;
    }

    .brush-copy strong {
      font-family: var(--hud-display);
      font-size: 30px;
      font-weight: 900;
      letter-spacing: -.02em;
      line-height: 1;
    }

    .brush-copy small {
      font-size: 14px;
      font-weight: 600;
      color: rgba(30,30,30,.72);
    }

    .brush-arrow {
      font-family: var(--tile-font);
      font-size: 42px;
      font-weight: 900;
      line-height: 1;
    }

    .home-controls-ribbon {
      width: min(620px, 100%);
      margin: 18px auto 0;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      flex-wrap: wrap;
      border-top: 1px solid var(--game-line);
      border-bottom: 1px solid var(--game-line);
      color: var(--app-muted);
      background: color-mix(in srgb, var(--app-card) 54%, transparent);
    }

    .control-key-row {
      display: inline-flex;
      align-items: center;
      gap: 9px;
      font-family: var(--hud-display);
      font-weight: 800;
      letter-spacing: .08em;
    }

    .control-key-row.compact {
      gap: 7px;
      color: inherit;
    }

    .control-label {
      font-size: 11px;
      color: var(--app-muted);
    }

    .key-cluster {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }

    .key-cluster > span {
      display: flex;
      gap: 2px;
    }

    .control-key-row kbd,
    .solo-strip-item kbd,
    .solo-card-actions kbd {
      min-width: 24px;
      height: 23px;
      display: inline-grid;
      place-items: center;
      box-sizing: border-box;
      padding: 0 5px;
      border: 1px solid color-mix(in srgb, var(--app-text) 24%, transparent);
      border-bottom-width: 2px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--app-card) 88%, white 12%);
      color: var(--app-text);
      font-family: var(--tile-font);
      font-size: 11px;
      font-weight: 900;
      box-shadow: none;
    }

    .home-controls-copy {
      font-size: 12px;
      font-weight: 600;
    }

    .touch-control-label {
      display: none;
      font-size: 11px;
      font-weight: 700;
      color: var(--app-muted);
    }

    .home-footnote {
      margin-top: 16px !important;
    }

    .solo-menu-intro {
      margin: 12px 0 18px;
      padding: 4px 0 12px 16px;
      border-left: 4px solid var(--app-accent);
    }

    .solo-menu-kicker {
      display: block;
      margin-bottom: 4px;
      font-family: var(--hud-display);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .14em;
      color: var(--app-accent);
    }

    .solo-menu-intro p {
      margin: 0;
      max-width: 640px;
      color: var(--app-text);
      font-size: 16px;
      line-height: 1.45;
    }

    .solo-undo-note {
      display: inline-block;
      margin-top: 8px;
      color: var(--app-muted);
      font-size: 13px;
      font-weight: 600;
    }

    .solo-stats {
      gap: 0 !important;
      border-top: 1px solid var(--game-line);
      border-bottom: 1px solid var(--game-line);
    }

    .solo-stats .stat-card {
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
    }

    .solo-stats .stat-card + .stat-card {
      border-left: 1px solid var(--game-line) !important;
    }

    .solo-stats .stat-card span {
      color: var(--app-muted) !important;
    }

    .solo-stats .stat-card strong {
      color: var(--app-text) !important;
      font-family: var(--tile-font) !important;
      font-size: 34px !important;
    }

    /* Solo active view: one cohesive play area instead of floating web controls. */
    body.solo-active #solo-toolbar {
      width: min(720px, calc(100% - 28px)) !important;
      margin: 20px auto 8px !important;
    }

    .solo-floating-header {
      min-height: 58px;
      border-bottom: 1px solid var(--game-line);
    }

    .solo-floating-center strong {
      font-family: var(--hud-display) !important;
      font-size: 26px !important;
      font-weight: 900 !important;
      letter-spacing: -.02em !important;
    }

    .solo-mode-label {
      display: inline-block;
      margin-top: 2px;
      padding: 2px 9px;
      color: #1f3735 !important;
      background: linear-gradient(90deg, #63d9ce, #9ce8df);
      font-family: var(--hud-display) !important;
      font-size: 10px !important;
      font-weight: 900;
      letter-spacing: .18em !important;
      clip-path: polygon(3% 10%, 98% 0, 100% 80%, 2% 100%);
    }

    body.solo-active .container {
      width: min(560px, calc(100% - 28px)) !important;
      margin: 10px auto 48px !important;
      padding: 18px !important;
      border: 0 !important;
      border-top: 4px solid var(--app-accent) !important;
      border-radius: 0 !important;
      background: color-mix(in srgb, var(--app-card) 86%, transparent) !important;
      box-shadow: 0 14px 34px var(--app-shadow) !important;
      clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    }

    body.solo-active .container .heading {
      margin: 0 0 12px !important;
      padding: 0 0 12px !important;
      border-bottom: 1px solid var(--game-line);
    }

    body.solo-active .container .title {
      font-family: var(--tile-font) !important;
      font-size: 52px !important;
      font-weight: 900 !important;
      letter-spacing: -.06em !important;
      color: var(--app-text) !important;
    }

    body.solo-active .scores-container {
      gap: 7px;
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      min-width: 82px !important;
      border-radius: 0 !important;
      background: var(--app-stat) !important;
      font-family: var(--tile-font) !important;
      box-shadow: none !important;
    }

    .solo-card-actions {
      margin: 0 0 10px !important;
      padding: 0 !important;
      border: 0 !important;
      justify-content: space-between !important;
    }

    .solo-card-actions .small-button {
      min-width: 116px;
      border: 1px solid var(--game-line) !important;
      border-radius: 4px !important;
      background: transparent !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
    }

    #solo-control-strip {
      margin-top: 10px;
    }

    .solo-control-strip {
      min-height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 18px;
      padding: 8px 10px;
      border-top: 1px solid var(--game-line);
      color: var(--app-muted);
    }

    .solo-strip-item {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      font-family: var(--hud-display);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .08em;
    }

    body.solo-active .game-container {
      margin-top: 0 !important;
      border-radius: 6px !important;
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--app-text) 8%, transparent);
    }

    .tile .tile-inner {
      font-family: var(--tile-font) !important;
      font-weight: 900 !important;
      letter-spacing: -.045em !important;
      border-radius: 5px !important;
    }

    /* Multiplayer: lighter match framing, more spacing, less armored-card look. */
    .battle-shell {
      max-width: 1180px !important;
      padding-top: 18px !important;
    }

    .battle-topbar {
      min-height: 58px !important;
      border-bottom: 1px solid var(--game-line) !important;
    }

    .battle-topbar::after {
      width: 128px !important;
      height: 4px !important;
      background: linear-gradient(90deg, transparent, var(--fun-teal), var(--fun-coral), transparent) !important;
      box-shadow: none !important;
    }

    .battle-mode-title strong,
    .player-name,
    .rank-badge,
    .highest-box strong,
    .mini-stat strong,
    .progress-meta,
    .progress-note {
      font-family: var(--hud-display) !important;
    }

    .battle-layout {
      grid-template-columns: minmax(0, 560px) 72px minmax(0, 330px) !important;
      column-gap: 42px !important;
      align-items: start !important;
    }

    .battle-player-card {
      overflow: visible !important;
      padding: 18px 16px 16px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      clip-path: none !important;
      backdrop-filter: none !important;
    }

    .battle-player-card::before {
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
      height: 5px !important;
      border-radius: 0 !important;
      box-shadow: none !important;
    }

    .battle-player-card::after {
      content: "";
      position: absolute;
      inset: 4px 0 auto 0;
      height: 64px;
      z-index: -1;
      background: linear-gradient(180deg, color-mix(in srgb, var(--app-card) 74%, transparent), transparent);
      pointer-events: none;
    }

    .own-panel {
      width: 560px !important;
      border-left: 3px solid color-mix(in srgb, var(--fun-teal) 80%, var(--app-accent)) !important;
    }

    .own-panel::before {
      background: linear-gradient(90deg, var(--fun-teal), color-mix(in srgb, var(--app-accent) 70%, var(--fun-yellow))) !important;
    }

    .opponent-panel {
      width: 330px !important;
      border-left: 3px solid var(--opponent-accent, var(--fun-coral)) !important;
    }

    .opponent-panel::before {
      background: linear-gradient(90deg, var(--opponent-accent, var(--fun-coral)), var(--opponent-accent-2, #ffb26d)) !important;
    }

    .player-card-header {
      min-height: 76px !important;
      margin-bottom: 12px !important;
      padding: 0 0 10px !important;
      border-bottom: 1px solid var(--game-line) !important;
    }

    .player-name {
      font-size: 30px !important;
      text-transform: none !important;
      letter-spacing: -.02em !important;
    }

    .player-subline {
      font-family: var(--hud-body) !important;
      font-size: 12px !important;
      letter-spacing: .04em !important;
      text-transform: uppercase;
    }

    .rank-badge {
      min-width: 50px !important;
      border: 0 !important;
      border-radius: 999px !important;
      padding: 4px 10px !important;
      background: var(--app-soft) !important;
      clip-path: none !important;
    }

    .rank-badge.first {
      background: var(--fun-yellow) !important;
      color: #35290c !important;
      box-shadow: 0 4px 12px rgba(150,110,20,.18) !important;
    }

    .highest-box,
    .mini-stat {
      border: 0 !important;
      border-radius: 5px !important;
      background: var(--app-stat) !important;
      clip-path: none !important;
      box-shadow: none !important;
    }

    .highest-box strong,
    .mini-stat strong {
      font-family: var(--tile-font) !important;
      font-weight: 900 !important;
    }

    .battle-vs {
      padding-top: 150px !important;
    }

    .battle-vs span {
      width: 70px !important;
      height: auto !important;
      min-height: 54px;
      display: grid;
      place-items: center;
      border: 0 !important;
      border-top: 2px solid var(--fun-teal) !important;
      border-bottom: 2px solid var(--fun-coral) !important;
      background: transparent !important;
      color: var(--app-text) !important;
      font-family: var(--tile-font) !important;
      font-size: 28px !important;
      font-style: italic;
      clip-path: none !important;
      box-shadow: none !important;
      transform: rotate(-4deg);
    }

    .battle-vs span::before,
    .battle-vs span::after {
      display: none !important;
    }

    .progress-wrap {
      margin-bottom: 16px !important;
    }

    .progress-track {
      height: 12px !important;
      border: 0 !important;
      border-radius: 999px !important;
      overflow: hidden;
      background: repeating-linear-gradient(90deg, var(--app-soft) 0 16px, color-mix(in srgb, var(--app-soft) 66%, transparent) 16px 18px) !important;
    }

    .progress-fill {
      border-radius: 999px !important;
      background: linear-gradient(90deg, var(--fun-teal), var(--fun-yellow)) !important;
      box-shadow: none !important;
      animation: none !important;
    }

    .opponent-panel .progress-fill {
      background: linear-gradient(90deg, var(--opponent-accent, var(--fun-coral)), var(--opponent-accent-2, #ffb26d)) !important;
    }

    .progress-note {
      color: var(--app-accent) !important;
      font-weight: 900 !important;
    }

    .opponent-grid {
      border: 2px solid var(--opponent-grid-border, var(--game-line)) !important;
      border-radius: 7px !important;
      background: var(--opponent-board, #bbada0) !important;
      box-shadow: 0 10px 24px color-mix(in srgb, var(--opponent-accent, var(--fun-coral)) 10%, transparent) !important;
    }

    .opponent-cell {
      border-radius: 4px !important;
      font-family: var(--tile-font) !important;
      font-weight: 900 !important;
    }

    .opponent-panel[data-opponent-theme="classic"] {
      --opponent-accent: #e96f3d;
      --opponent-accent-2: #f5b06d;
      --opponent-board: #a99786;
      --opponent-grid-border: #c9b7a6;
    }

    .opponent-panel[data-opponent-theme="pastel"] {
      --opponent-accent: #ff8fae;
      --opponent-accent-2: #88d8d0;
      --opponent-board: #d9d5e1;
      --opponent-grid-border: #c8bdd8;
    }

    .opponent-panel[data-opponent-theme="ocean"] {
      --opponent-accent: #2589a5;
      --opponent-accent-2: #63c4d7;
      --opponent-board: #8eb7c3;
      --opponent-grid-border: #6ba1b0;
    }

    .opponent-panel[data-opponent-theme="candy"] {
      --opponent-accent: #ff5d8f;
      --opponent-accent-2: #845ec2;
      --opponent-board: #dfa8bd;
      --opponent-grid-border: #ce8eaa;
    }

    .opponent-panel[data-opponent-theme="midnight"] {
      --opponent-accent: #8b91ff;
      --opponent-accent-2: #ef75c7;
      --opponent-board: #30384d;
      --opponent-grid-border: #525d79;
    }

    #opponent-status {
      margin-top: 8px !important;
      font-family: var(--hud-body) !important;
      font-size: 11px !important;
      text-transform: none !important;
      letter-spacing: .02em !important;
    }

    /* Settings: integrated controls, no cards-for-everything look. */
    .settings-dialog-v39 {
      max-width: 760px !important;
      border-radius: 8px !important;
    }

    .settings-kicker {
      display: block;
      margin-bottom: 1px;
      color: var(--app-accent);
      font-family: var(--hud-display);
      font-size: 10px;
      font-weight: 900;
      letter-spacing: .18em;
    }

    .settings-grid-v39 {
      display: grid;
      grid-template-columns: repeat(2, minmax(0,1fr));
      gap: 0 24px;
      border-top: 1px solid var(--game-line);
    }

    .settings-grid-v39 .settings-section {
      margin: 0 !important;
      padding: 18px 0 !important;
      border: 0 !important;
      border-bottom: 1px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
    }

    .settings-grid-v39 .settings-section h3 {
      margin: 0 0 10px !important;
      font-size: 18px !important;
    }

    .settings-grid-v39 .settings-section h4 {
      margin: 0 0 2px;
      font-family: var(--hud-body);
      font-size: 14px;
      font-weight: 800;
    }

    .settings-profile-section,
    .settings-theme-section {
      grid-column: 1 / -1;
    }

    .settings-section-heading-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
    }

    .locked-badge {
      flex: 0 0 auto;
      padding: 5px 8px;
      border: 1px solid var(--game-line);
      border-radius: 999px;
      color: var(--app-muted);
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }

    .theme-choice:disabled {
      opacity: .55 !important;
      cursor: not-allowed !important;
    }

    .audio-control-group + .audio-control-group {
      margin-top: 17px;
      padding-top: 15px;
      border-top: 1px dashed var(--game-line);
    }

    .volume-row {
      display: grid;
      grid-template-columns: 92px 1fr 46px;
      align-items: center;
      gap: 10px;
      margin-top: 9px;
      color: var(--app-muted);
      font-size: 12px;
      font-weight: 700;
    }

    .volume-row input[type="range"] {
      width: 100%;
      accent-color: var(--app-accent);
      cursor: pointer;
    }

    .volume-row output {
      text-align: right;
      color: var(--app-text);
      font-family: var(--tile-font);
      font-weight: 800;
    }

    .settings-inline-toggle {
      margin-top: 16px;
      padding-top: 14px;
      border-top: 1px dashed var(--game-line);
    }

    .field-label {
      display: block;
      margin-bottom: 6px;
      color: var(--app-muted);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .08em;
    }

    .settings-footer {
      margin-top: 18px;
      display: flex;
      justify-content: flex-end;
    }

    /* Slightly softer general controls: still graphic, no fake-paper/sticky-note language. */
    .nav-button,
    .settings-button,
    .secondary-button,
    .primary-button,
    .danger-button,
    .small-button,
    .control-choice,
    .target-button,
    .toggle-button {
      border-radius: 4px !important;
      box-shadow: none !important;
    }

    .primary-button {
      background: linear-gradient(100deg, var(--app-accent), color-mix(in srgb, var(--app-accent) 75%, var(--fun-yellow))) !important;
    }

    .result-box {
      border-radius: 8px !important;
    }

    #battle-toast,
    #solo-milestone-toast {
      border-radius: 999px !important;
      text-transform: none !important;
      font-family: var(--hud-body) !important;
      font-size: 14px !important;
      font-weight: 800 !important;
      letter-spacing: .01em !important;
    }

    @media (max-width: 980px) {
      .battle-layout {
        grid-template-columns: minmax(0, 560px) !important;
        row-gap: 14px !important;
      }

      .battle-vs {
        padding-top: 0 !important;
      }

      .battle-vs span {
        width: 88px !important;
        margin: 0 auto;
      }

      .opponent-panel,
      .own-panel {
        width: 100% !important;
      }

      .opponent-panel {
        max-width: 430px;
        justify-self: center;
      }
    }

    @media (max-width: 700px) {
      .settings-grid-v39 {
        grid-template-columns: 1fr;
      }

      .settings-profile-section,
      .settings-theme-section {
        grid-column: auto;
      }

      .home-brush-button {
        grid-template-columns: 48px 1fr 24px;
        min-height: 84px;
        padding: 14px 16px;
      }

      .brush-icon {
        width: 42px;
        height: 42px;
        font-size: 21px;
      }

      .brush-copy strong {
        font-size: 25px;
      }

      .brush-copy small {
        font-size: 12px;
      }
    }

    @media (max-width: 520px) {
      .home-controls-copy {
        display: none;
      }

      .touch-control-label {
        display: inline;
      }

      body.solo-active .container {
        padding: 10px !important;
      }

      .solo-control-strip {
        gap: 10px;
      }
    }
  `;
  document.head.appendChild(v39Style);

  // =========================================================
  // V40 — ONE GAME, ONE VISUAL SYSTEM
  // =========================================================

  var v40Style = document.createElement("style");
  v40Style.textContent = `
    /* The UI gets its personality from type, color, motion and the boards — not extra shapes. */

    .solo-launch-screen {
      width: min(690px, 100%);
      margin: 70px auto 0;
      text-align: center;
    }

    .solo-launch-rule {
      display: flex;
      align-items: baseline;
      justify-content: center;
      gap: 14px;
      margin-bottom: 32px;
      color: var(--app-muted);
    }

    .solo-launch-rule span {
      color: var(--app-accent);
      font-family: var(--hud-display);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .16em;
    }

    .solo-launch-rule strong {
      color: var(--app-text);
      font-size: 15px;
      font-weight: 600;
    }

    .solo-launch-stats {
      display: grid;
      grid-template-columns: 1fr 1px 1fr;
      align-items: stretch;
      margin: 0 auto 38px;
      border-top: 1px solid var(--game-line);
      border-bottom: 1px solid var(--game-line);
    }

    .solo-launch-stats::before {
      content: "";
      grid-column: 2;
      grid-row: 1;
      background: var(--game-line);
    }

    .solo-launch-stat {
      min-height: 132px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 7px;
      padding: 18px 28px;
    }

    .solo-launch-stat:first-child { grid-column: 1; }
    .solo-launch-stat:last-child { grid-column: 3; }

    .solo-launch-stat span {
      font-family: var(--hud-display);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .14em;
      color: var(--app-muted);
    }

    .solo-launch-stat strong {
      font-family: var(--tile-font);
      font-size: clamp(42px, 6vw, 64px);
      line-height: .95;
      font-weight: 900;
      letter-spacing: -.045em;
      color: var(--app-text);
    }

    .solo-launch-actions {
      width: min(370px, 100%);
      margin: 0 auto;
      display: grid;
      gap: 12px;
    }

    .solo-main-action {
      min-height: 54px !important;
      font-size: 17px !important;
    }

    .solo-text-action,
    .nickname-link {
      border: 0;
      background: transparent;
      color: var(--app-muted);
      cursor: pointer;
      font: 800 12px/1 var(--hud-display);
      letter-spacing: .08em;
      text-transform: uppercase;
      padding: 10px;
    }

    .solo-text-action:hover,
    .nickname-link:hover { color: var(--app-accent); }

    /* Multiplayer selection is a game mode rail, not a dashboard of cards. */
    .multiplayer-entry-head {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 8px;
      margin: 22px 0 20px;
      color: var(--app-muted);
      font-size: 13px;
    }

    .multiplayer-entry-head > span {
      font-family: var(--hud-display);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .13em;
    }

    .multiplayer-entry-head > strong {
      color: var(--app-text);
      font-size: 15px;
    }

    .mode-selector-shell {
      display: grid;
      grid-template-columns: minmax(210px, .78fr) minmax(0, 1.4fr);
      gap: 44px;
      align-items: stretch;
      margin-top: 10px;
      border-top: 1px solid var(--game-line);
      border-bottom: 1px solid var(--game-line);
      padding: 24px 0 28px;
    }

    .mode-rail {
      display: grid;
      align-content: start;
    }

    .mode-rail-item {
      width: 100%;
      min-height: 68px;
      display: grid;
      grid-template-columns: 38px 1fr;
      gap: 12px;
      align-items: center;
      padding: 11px 12px;
      border: 0;
      border-bottom: 1px solid var(--game-line);
      background: transparent;
      color: var(--app-text);
      text-align: left;
      cursor: pointer;
      transition: padding-left 160ms ease, color 160ms ease, background 160ms ease;
    }

    .mode-rail-item:first-child { border-top: 1px solid var(--game-line); }

    .mode-rail-item:hover:not(:disabled),
    .mode-rail-item.selected {
      padding-left: 18px;
      color: var(--app-accent);
      background: linear-gradient(90deg, color-mix(in srgb, var(--app-accent) 7%, transparent), transparent 76%);
    }

    .mode-rail-item.selected {
      box-shadow: inset 3px 0 0 var(--app-accent);
    }

    .mode-index {
      font-family: var(--tile-font);
      font-size: 18px;
      font-weight: 900;
      color: color-mix(in srgb, currentColor 60%, transparent);
    }

    .mode-rail-item strong,
    .mode-rail-item small {
      display: block;
    }

    .mode-rail-item strong {
      font-family: var(--hud-display);
      font-size: 17px;
      font-weight: 900;
      letter-spacing: -.01em;
    }

    .mode-rail-item small {
      margin-top: 3px;
      color: var(--app-muted);
      font-size: 11px;
    }

    .mode-rail-item.locked {
      cursor: default;
      opacity: .36;
    }

    .mode-stage {
      min-height: 430px;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      padding: 18px clamp(10px, 4vw, 50px);
      border-left: 1px solid var(--game-line);
    }

    .mode-stage-pop { animation: v40ModePop 180ms ease-out; }

    @keyframes v40ModePop {
      from { opacity: .45; transform: translateX(9px); }
      to { opacity: 1; transform: translateX(0); }
    }

    .mode-stage-eyebrow {
      color: var(--app-accent);
      font: 900 11px/1 var(--hud-display);
      letter-spacing: .16em;
    }

    .mode-stage h2 {
      margin: 12px 0 12px;
      font-family: var(--hud-display);
      font-size: clamp(38px, 5vw, 64px);
      line-height: .95;
      letter-spacing: -.045em;
      color: var(--app-text);
    }

    .mode-stage > p {
      max-width: 520px;
      margin: 0;
      color: var(--app-muted);
      font-size: 17px;
      line-height: 1.55;
    }

    .mode-stage-facts {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      margin: 26px 0 34px;
      padding-top: 18px;
      border-top: 1px solid var(--game-line);
      color: var(--app-text);
      font-family: var(--hud-display);
      font-size: 11px;
      font-weight: 800;
      letter-spacing: .06em;
      text-transform: uppercase;
    }

    .mode-stage-facts span::before {
      content: "•";
      margin-right: 8px;
      color: var(--app-accent);
    }

    .mode-stage-action { min-width: 220px; }

    /* Solo and multiplayer now share the same visual rhythm. */
    body.solo-active #solo-toolbar {
      width: min(1040px, calc(100% - 36px)) !important;
      margin: 20px auto 14px !important;
    }

    .solo-floating-header,
    .battle-topbar {
      min-height: 64px !important;
      padding: 0 !important;
      border-bottom: 1px solid var(--game-line) !important;
    }

    body.solo-active .container {
      width: min(560px, calc(100% - 28px)) !important;
      margin: 24px auto 48px !important;
      padding: 16px !important;
      border: 0 !important;
      border-left: 3px solid var(--app-accent) !important;
      border-top: 4px solid var(--app-accent) !important;
      border-radius: 0 !important;
      clip-path: none !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    body.solo-active .container::before,
    body.solo-active .container::after { display: none !important; }

    body.solo-active .container .heading {
      min-height: 92px;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 20px;
      margin: 0 0 14px !important;
      padding: 0 0 14px !important;
      border-bottom: 1px solid var(--game-line) !important;
    }

    body.solo-active .container .title {
      margin: 0 !important;
      font-family: var(--hud-display) !important;
      font-size: 34px !important;
      font-weight: 900 !important;
      letter-spacing: -.025em !important;
    }

    body.solo-active .scores-container {
      display: flex !important;
      align-items: stretch !important;
      gap: 14px !important;
      margin: 0 !important;
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      width: 104px !important;
      min-width: 104px !important;
      min-height: 72px !important;
      margin: 0 !important;
      padding: 28px 12px 9px !important;
      border: 0 !important;
      border-radius: 4px !important;
      background: var(--app-stat) !important;
      font-family: var(--tile-font) !important;
      font-size: 29px !important;
      font-weight: 900 !important;
      line-height: 1.05 !important;
      text-align: center !important;
      box-shadow: none !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top: 9px !important;
      width: 100% !important;
      left: 0 !important;
      font-family: var(--hud-display) !important;
      font-size: 9px !important;
      font-weight: 800 !important;
      letter-spacing: .12em !important;
    }

    .solo-card-actions {
      margin: 0 0 12px !important;
      padding: 0 !important;
    }

    body.solo-active .game-container,
    .battle-layout .game-container {
      overflow: visible !important;
      border-radius: 6px !important;
      clip-path: none !important;
      background-clip: padding-box !important;
    }

    body.solo-active .grid-container,
    .battle-layout .grid-container,
    .opponent-grid {
      overflow: hidden !important;
      border-radius: 6px !important;
      clip-path: none !important;
    }

    .tile,
    .tile .tile-inner,
    .grid-cell,
    .opponent-cell {
      clip-path: none !important;
      background-clip: padding-box !important;
    }

    .tile .tile-inner,
    .grid-cell,
    .opponent-cell {
      border-radius: 4px !important;
    }

    .tile .tile-inner::before,
    .tile .tile-inner::after,
    .grid-cell::before,
    .grid-cell::after,
    .opponent-cell::before,
    .opponent-cell::after {
      display: none !important;
      content: none !important;
    }

    .tile .tile-inner {
      font-family: var(--tile-font) !important;
      font-weight: 900 !important;
      letter-spacing: -.035em !important;
    }

    /* Multiplayer: two arenas, one match. No floating VS column. */
    .battle-shell { max-width: 1120px !important; }

    .battle-layout {
      position: relative;
      grid-template-columns: minmax(0, 560px) minmax(0, 350px) !important;
      column-gap: clamp(48px, 7vw, 92px) !important;
      align-items: start !important;
      justify-content: center !important;
    }

    .battle-layout::before { display: none !important; }

    .battle-vs { display: none !important; }

    .own-panel {
      width: 560px !important;
      border-left-width: 3px !important;
    }

    .opponent-panel {
      width: 350px !important;
      min-height: 0 !important;
    }

    .battle-player-card {
      padding: 18px 14px 18px !important;
    }

    .player-card-header {
      min-height: 86px !important;
      align-items: flex-start !important;
      gap: 18px !important;
    }

    .highest-box {
      min-width: 86px !important;
      padding: 9px 12px 10px !important;
    }

    .highest-box span {
      display: block;
      margin-bottom: 4px;
    }

    .highest-box strong { font-size: 28px !important; line-height: 1 !important; }

    .opponent-grid {
      width: 280px !important;
      margin: 18px auto 0 !important;
    }

    #opponent-status {
      margin-top: 10px !important;
      text-align: center !important;
    }

    .settings-grid-v40 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 14px;
    }

    .single-audio-group { margin-bottom: 0 !important; }

    @media (max-width: 900px) {
      .mode-selector-shell {
        grid-template-columns: 1fr;
        gap: 20px;
      }

      .mode-stage {
        min-height: 330px;
        border-left: 0;
        border-top: 1px solid var(--game-line);
        padding: 30px 14px;
      }

      .battle-layout {
        grid-template-columns: minmax(0, 560px) !important;
        row-gap: 30px !important;
      }

      .battle-layout::before { display: none; }

      .opponent-panel {
        width: min(560px, 100%) !important;
      }

      .opponent-grid { width: 280px !important; }

      .settings-grid-v40 { grid-template-columns: 1fr; }
    }

    @media (max-width: 600px) {
      .solo-launch-screen { margin-top: 38px; }
      .solo-launch-rule { display: grid; gap: 6px; }
      .solo-launch-stats { margin-bottom: 26px; }
      .solo-launch-stat { min-height: 106px; padding: 14px 10px; }
      .solo-launch-stat strong { font-size: 38px; }
      .mode-selector-shell { padding-top: 14px; }
      .mode-stage h2 { font-size: 38px; }

      body.solo-active .container .heading {
        align-items: flex-start !important;
        flex-direction: column !important;
      }

      body.solo-active .scores-container { width: 100% !important; }
      body.solo-active .score-container,
      body.solo-active .best-container { flex: 1 !important; width: auto !important; }
    }
  `;
  document.head.appendChild(v40Style);

  // =========================================================
  // v41: theme-aware home screen + Solo live theme switching
  // =========================================================

  var v41Style = document.createElement("style");
  v41Style.textContent = `
    /*
     * The home screen now inherits the active theme instead of
     * always using the same teal/coral palette. These variables
     * also keep the visual accents coherent throughout the UI.
     */
    body.theme-classic {
      --fun-teal: #d7a24b;
      --fun-coral: #e96f3d;
      --fun-yellow: #edc22e;
      --home-solo-a: #e4bd70;
      --home-solo-b: #f0d59c;
      --home-solo-c: #d3a255;
      --home-multi-a: #e96f3d;
      --home-multi-b: #f38c62;
      --home-multi-c: #d85d31;
    }

    body.theme-pastel {
      --fun-teal: #9b8cff;
      --fun-coral: #ff9fc7;
      --fun-yellow: #ffd09d;
      --home-solo-a: #a99cff;
      --home-solo-b: #c8beff;
      --home-solo-c: #8d7cf2;
      --home-multi-a: #ff9fc7;
      --home-multi-b: #ffc1da;
      --home-multi-c: #ef86b2;
    }

    body.theme-ocean {
      --fun-teal: #28d7df;
      --fun-coral: #4d89ff;
      --fun-yellow: #64f0b8;
      --home-solo-a: #28d7df;
      --home-solo-b: #62e6ea;
      --home-solo-c: #1fb9c0;
      --home-multi-a: #4d89ff;
      --home-multi-b: #73a5ff;
      --home-multi-c: #326bd7;
    }

    body.theme-candy {
      --fun-teal: #9b7bff;
      --fun-coral: #ff5d9e;
      --fun-yellow: #ffd054;
      --home-solo-a: #9b7bff;
      --home-solo-b: #b99fff;
      --home-solo-c: #805fdc;
      --home-multi-a: #ff5d9e;
      --home-multi-b: #ff83b6;
      --home-multi-c: #df3f82;
    }

    body.theme-midnight {
      --fun-teal: #8d7cff;
      --fun-coral: #44ddff;
      --fun-yellow: #ff5ca8;
      --home-solo-a: #7666e8;
      --home-solo-b: #9b8dff;
      --home-solo-c: #6254c9;
      --home-multi-a: #2cc8e8;
      --home-multi-b: #56e0f8;
      --home-multi-c: #219ebc;
    }

    .solo-brush {
      background: linear-gradient(105deg,
        var(--home-solo-a),
        var(--home-solo-b) 72%,
        var(--home-solo-c)) !important;
    }

    .multiplayer-brush {
      background: linear-gradient(105deg,
        var(--home-multi-a),
        var(--home-multi-b) 70%,
        var(--home-multi-c)) !important;
    }

    .game-logo-number em {
      color: var(--fun-coral) !important;
    }

    /* Keep button copy readable on both light and dark themes. */
    body.theme-ocean .home-brush-button,
    body.theme-candy .home-brush-button,
    body.theme-midnight .home-brush-button {
      color: #ffffff !important;
    }

    body.theme-ocean .brush-copy small,
    body.theme-candy .brush-copy small,
    body.theme-midnight .brush-copy small {
      color: rgba(255,255,255,.78) !important;
    }

    body.theme-ocean .brush-icon,
    body.theme-candy .brush-icon,
    body.theme-midnight .brush-icon {
      border-color: rgba(255,255,255,.24) !important;
      background: rgba(255,255,255,.10) !important;
    }
  `;
  document.head.appendChild(v41Style);


  // =========================================================
  // COMMON UI
  // =========================================================

  function clearModeClasses() {
    document.body.classList.remove("solo-active");
  }

  function isTypingTarget(target) {
    return !!(
      target &&
      (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
    );
  }

  var nextScreenTransitionDirection = 1;

  function removeIdsFromClone(root) {
    if (!root) return;

    if (root.removeAttribute) {
      root.removeAttribute("id");
    }

    if (!root.querySelectorAll) return;

    Array.prototype.forEach.call(root.querySelectorAll("[id]"), function (node) {
      node.removeAttribute("id");
    });
  }

  function createScreenGhost(direction) {
    var outgoing = appRoot.querySelector(".app-screen");

    if (!outgoing) return;

    var ghost = outgoing.cloneNode(true);
    removeIdsFromClone(ghost);
    ghost.classList.remove("enter-forward", "enter-back");
    ghost.classList.add("screen-ghost", direction < 0 ? "back" : "forward");

    document.body.appendChild(ghost);

    setTimeout(function () {
      if (ghost.parentNode) ghost.remove();
    }, 280);
  }

  function getScreenClass() {
    return "screen-" + String(window.currentGameMode || "menu")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function showScreen(title, backHandler, contentHtml) {
    var direction = nextScreenTransitionDirection || 1;
    nextScreenTransitionDirection = 1;

    createScreenGhost(direction);

    clearModeClasses();
    restoreGameContainer();
    gameHost.style.display = "none";
    gameContainer.style.display = "none";
    soloToolbar.style.display = "none";

    currentScreen = title;

    appRoot.innerHTML = `
      <div class="app-screen ${getScreenClass()} ${direction < 0 ? "enter-back" : "enter-forward"}">
        <div class="app-screen-inner">
          <div class="app-header">
            <div class="app-header-side left">
              ${backHandler ? '<button class="nav-button" id="screen-back">← Back</button>' : ""}
            </div>
            <div class="app-title-stack">
              <span class="app-title-brand">Rina's 2048</span>
              <h1>${escapeHtml(title)}</h1>
            </div>
            <div class="app-header-side right">
              <button class="settings-button" id="screen-settings">Settings</button>
            </div>
          </div>
          <div id="screen-content">${contentHtml}</div>
        </div>
      </div>
    `;

    document.getElementById("screen-settings").addEventListener("click", openSettings);

    if (backHandler) {
      document.getElementById("screen-back").addEventListener("click", function () {
        nextScreenTransitionDirection = -1;
        backHandler();
      });
    }
  }

  function openNicknamePrompt(onComplete) {
    var old = document.getElementById("nickname-overlay");

    if (old) {
      old.remove();
    }

    var overlay = document.createElement("div");
    overlay.id = "nickname-overlay";
    overlay.className = "settings-overlay";

    overlay.innerHTML = `
      <div class="settings-dialog" style="max-width:410px;">
        <div class="settings-dialog-header">
          <h2>Choose a nickname</h2>
        </div>
        <p class="settings-help">This is the name your opponent will see. You can change it later in Settings.</p>
        <input
          id="nickname-prompt-input"
          class="nickname-field"
          type="text"
          maxlength="16"
          autocomplete="nickname"
          placeholder="Nickname"
          value="${escapeHtml(window.rinasSettings.nickname || "")}"
        >
        <p class="status-text" id="nickname-prompt-status" style="min-height:20px;margin:8px 0 0;"></p>
        <div class="result-actions">
          <button class="primary-button" id="nickname-prompt-save">Continue</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    var input = document.getElementById("nickname-prompt-input");
    var status = document.getElementById("nickname-prompt-status");

    function saveNicknameAndContinue() {
      var nickname = sanitizeNickname(input.value);

      if (!nickname) {
        status.textContent = "Please enter a nickname.";
        input.focus();
        return;
      }

      window.rinasSettings.nickname = nickname;
      saveSettings();
      overlay.remove();

      if (onComplete) {
        onComplete();
      }
    }

    document.getElementById("nickname-prompt-save").addEventListener("click", saveNicknameAndContinue);
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        saveNicknameAndContinue();
      }
    });

    input.focus();
    input.select();
  }

  function ensureNickname(callback) {
    if (sanitizeNickname(window.rinasSettings.nickname)) {
      callback();
      return;
    }

    openNicknamePrompt(callback);
  }

  function updateProfiles(profiles) {
    if (!Array.isArray(profiles)) {
      return;
    }

    window.multiplayerProfiles = profiles.map(function (profile) {
      return {
        playerNumber: Number(profile.playerNumber),
        nickname: sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber),
        theme: THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic"
      };
    });
  }

  function updateOneProfile(profile) {
    if (!profile) {
      return;
    }

    var profiles = window.multiplayerProfiles || [];
    var found = false;

    for (var i = 0; i < profiles.length; i++) {
      if (Number(profiles[i].playerNumber) === Number(profile.playerNumber)) {
        profiles[i] = {
          playerNumber: Number(profile.playerNumber),
          nickname: sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber),
          theme: THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic"
        };
        found = true;
        break;
      }
    }

    if (!found) {
      profiles.push({
        playerNumber: Number(profile.playerNumber),
        nickname: sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber),
        theme: THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic"
      });
    }

    window.multiplayerProfiles = profiles;
  }

  // =========================================================
  // MAIN + SOLO
  // =========================================================

  function movementKeysMarkup(compact) {
    var scheme = window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";
    var cls = compact ? "control-key-row compact" : "control-key-row";

    if (scheme === "wasd") {
      return '<div class="' + cls + '"><span class="control-label">MOVE</span><span class="key-cluster wasd"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span></div>';
    }

    return '<div class="' + cls + '"><span class="control-label">MOVE</span><span class="key-cluster arrows"><span><kbd>↑</kbd></span><span><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span></span></div>';
  }

  function soloControlsMarkup() {
    var undo = window.rinasSettings.soloUndo
      ? '<div class="solo-strip-item"><span>UNDO</span><kbd>Z</kbd></div>'
      : '';

    return '<div class="solo-control-strip">' + movementKeysMarkup(true) + undo + '<span class="touch-control-label">Swipe to move</span></div>';
  }

  function showMainMenu() {
    window.currentGameMode = "menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = null;
    stopCompetitiveMusic(260);

    showScreen(
      "Rina's 2048",
      null,
      `
        <div class="title-stage">
          <div class="game-logo">
            <span class="logo-float-tile one">8</span>
            <span class="logo-float-tile two">16</span>
            <span class="game-logo-rinas">RINA'S</span>
            <span class="game-logo-number">20<em>48</em></span>
            <p class="logo-tagline">Merge. Race. Win.</p>
          </div>
        </div>

        <div class="home-mode-stack">
          <button class="home-brush-button solo-brush" id="choose-solo">
            <span class="brush-icon">🎮</span>
            <span class="brush-copy"><strong>SOLO</strong><small>Build an endless board and beat your best.</small></span>
            <span class="brush-arrow">›</span>
          </button>

          <button class="home-brush-button multiplayer-brush" id="choose-multiplayer">
            <span class="brush-icon">👥</span>
            <span class="brush-copy"><strong>MULTIPLAYER</strong><small>Race, freeplay, or balance a match with custom targets.</small></span>
            <span class="brush-arrow">›</span>
          </button>
        </div>

        <div class="home-controls-ribbon">
          ${movementKeysMarkup(false)}
          <span class="home-controls-copy">Choose Arrow Keys or WASD in Settings.</span>
          <span class="touch-control-label">Swipe on touch devices</span>
        </div>

        <div class="home-footnote">
          <span>Solo saves locally</span>
          <i></i>
          <span>Multiplayer with friends</span>
        </div>
      `
    );

    document.getElementById("choose-solo").addEventListener("click", showSoloMenu);
    document.getElementById("choose-multiplayer").addEventListener("click", function () {
      ensureNickname(showMultiplayerMenu);
    });
  }


  function previewBoardMarkup(values, extraClass) {
    var items = Array.isArray(values) ? values.slice(0, 16) : [];
    while (items.length < 16) items.push(0);

    return '<div class="ui-mini-board ' + (extraClass || '') + '">' + items.map(function (value) {
      var number = Number(value || 0);
      return '<span class="ui-mini-cell ' + (number ? 'filled pv-' + number : '') + '">' + (number ? number : '') + '</span>';
    }).join('') + '</div>';
  }

  function savedSoloPreviewMarkup(state) {
    var values = [];

    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        var tile = state && state.grid && state.grid.cells && state.grid.cells[x]
          ? state.grid.cells[x][y]
          : null;
        values.push(tile && tile.value ? tile.value : 0);
      }
    }

    if (!values.some(function (value) { return value; })) {
      values = [0, 2, 0, 4, 0, 0, 8, 0, 0, 16, 0, 0, 32, 0, 64, 0];
    }

    return previewBoardMarkup(values, 'solo-run-preview-board');
  }

  function modePreviewMarkup(mode) {
    if (mode === 'tile-race') {
      return '<div class="mode-visual-pair">' +
        '<div class="mode-visual-player"><b>YOU</b>' + previewBoardMarkup([0,0,0,0,0,0,4,0,0,8,16,0,2,32,64,128], 'race-preview-a') + '<span>512</span></div>' +
        '<div class="mode-visual-player"><b>RIVAL</b>' + previewBoardMarkup([0,0,0,0,0,2,0,0,4,8,0,0,16,32,64,0], 'race-preview-b') + '<span>256</span></div>' +
      '</div>';
    }

    if (mode === 'freeplay') {
      return '<div class="mode-freeplay-visual">' +
        previewBoardMarkup([0,2,4,0,8,16,0,0,32,0,64,0,0,2,4,8], 'freeplay-preview') +
        '<div class="undo-loop"><span>MOVE</span><i>↔</i><span>UNDO</span></div>' +
      '</div>';
    }

    return '<div class="mode-custom-visual">' +
      '<div class="custom-target"><small>PLAYER 1</small><strong>2048</strong><span>Target</span></div>' +
      '<div class="custom-target harder"><small>PLAYER 2</small><strong>4096</strong><span>Target</span></div>' +
    '</div>';
  }

  function showSoloMenu() {
    window.currentGameMode = "solo-menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    withGame(function (game) {
      var hasSave = game.storageManager.hasGameState();
      var savedState = game.storageManager.getGameState();
      var best = game.storageManager.getBestScore();
      var highest = game.storageManager.getHighestTileEver();

      showScreen(
        "Solo 2048",
        showMainMenu,
        `
          <div class="solo-launch-screen solo-launch-v43">
            <section class="solo-launch-copy">
              <span class="solo-launch-kicker">ENDLESS SOLO</span>
              <h2>Pick up where you left off.</h2>
              <p>2048 is a milestone, not the finish. Keep the board alive and chase a bigger run.</p>

              <div class="solo-launch-stats" aria-label="Solo records">
                <div class="solo-launch-stat">
                  <span>BEST SCORE</span>
                  <strong>${best}</strong>
                </div>
                <div class="solo-launch-stat">
                  <span>HIGHEST TILE</span>
                  <strong>${highest || 0}</strong>
                </div>
              </div>

              <div class="solo-launch-actions">
                ${hasSave ? '<button class="solo-main-action" id="continue-solo">Continue Run <span>→</span></button>' : '<button class="solo-main-action" id="start-solo">Start Run <span>→</span></button>'}
                ${hasSave ? '<button class="solo-text-action" id="new-solo">Start a new run</button>' : ''}
              </div>
            </section>

            <aside class="solo-preview-stage" aria-label="Preview of your Solo board">
              <div class="preview-orbit orbit-one"></div>
              <div class="preview-orbit orbit-two"></div>
              <div class="solo-preview-heading">
                <span>${hasSave ? 'YOUR SAVED RUN' : 'YOUR BOARD'}</span>
                <strong>${savedState && savedState.score ? savedState.score : 0}</strong>
              </div>
              ${savedSoloPreviewMarkup(savedState)}
              <div class="solo-preview-caption">
                <span>${window.rinasSettings.controlScheme === 'wasd' ? 'WASD' : 'ARROW KEYS'} TO MOVE</span>
                ${window.rinasSettings.soloUndo ? '<span>Z TO UNDO</span>' : ''}
              </div>
            </aside>
          </div>
        `
      );

      var continueButton = document.getElementById("continue-solo");
      var startButton = document.getElementById("start-solo");
      var newButton = document.getElementById("new-solo");

      if (continueButton) continueButton.addEventListener("click", function () { startSolo(false); });
      if (startButton) startButton.addEventListener("click", function () { startSolo(true); });
      if (newButton) {
        newButton.addEventListener("click", function () {
          if (window.confirm("Start a new Solo run? Your current saved board will be replaced.")) {
            startSolo(true);
          }
        });
      }
    });
  }

  function removeSoloActionRow() {
    var row = document.getElementById("solo-card-actions");
    if (row) row.remove();
  }

  function renderSoloChrome() {
    soloToolbar.innerHTML = `
      <div class="solo-floating-header">
        <div><button class="nav-button" id="solo-back">← Back</button></div>
        <div class="solo-floating-center">
          <strong>Rina's 2048</strong>
          <span class="solo-mode-label">SOLO</span>
        </div>
        <div class="solo-floating-right">
          <button class="settings-button" id="solo-settings">Settings</button>
        </div>
      </div>
    `;

    soloToolbar.style.display = "block";

    document.getElementById("solo-back").addEventListener("click", showSoloMenu);
    document.getElementById("solo-settings").addEventListener("click", openSettings);

    removeSoloActionRow();

    var actionRow = document.createElement("div");
    actionRow.id = "solo-card-actions";
    actionRow.className = "solo-card-actions";
    actionRow.innerHTML = `
      <button class="small-button" id="solo-new">New Game</button>
      <button class="small-button" id="solo-undo" data-no-ui-sound="true">Undo <kbd>Z</kbd></button>
    `;

    var board = gameContainer.querySelector(".game-container");
    gameContainer.insertBefore(actionRow, board);

    var existingStrip = document.getElementById("solo-control-strip");
    if (existingStrip) existingStrip.remove();

    var controlStrip = document.createElement("div");
    controlStrip.id = "solo-control-strip";
    controlStrip.innerHTML = soloControlsMarkup();
    gameContainer.insertBefore(controlStrip, board.nextSibling);

    document.getElementById("solo-new").addEventListener("click", function () {
      if (window.confirm("Start a new Solo game?")) {
        withGame(function (game) { game.restart(); });
      }
    });

    document.getElementById("solo-undo").addEventListener("click", function () {
      withGame(function (game) { game.undo(); });
    });

    window.refreshSoloControls();
  }

  function startSolo(startNew) {
    stopCompetitiveMusic(260);
    restoreGameContainer();
    window.currentGameMode = "solo";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = null;
    window.multiplayerPlayerNumber = null;

    appRoot.innerHTML = "";
    clearModeClasses();
    document.body.classList.add("solo-active");
    gameHost.style.display = "block";
    gameContainer.style.display = "block";

    renderSoloChrome();

    withGame(function (game) {
      game.actuator.continueGame();

      if (startNew) game.restart();
      else game.setup();

      window.refreshSoloControls();

      if (
        !startNew &&
        game.won &&
        !game.keepPlaying &&
        !game.over &&
        Number(game.soloHighestMilestone || 0) >= 2048
      ) {
        window.showSolo2048Milestone();
      }
    });
  }

  window.refreshSoloControls = function () {
    var undoButton = document.getElementById("solo-undo");
    var strip = document.getElementById("solo-control-strip");
    if (strip) strip.innerHTML = soloControlsMarkup();

    if (!undoButton) return;

    if (!window.rinasSettings.soloUndo) {
      undoButton.style.display = "none";
      return;
    }

    undoButton.style.display = "inline-flex";

    if (!window.multiplayerGame) {
      undoButton.disabled = true;
      return;
    }

    undoButton.disabled = !!window.multiplayerGame.undoAnimating ||
      window.multiplayerGame.storageManager.getUndoStack().length === 0;
  };

  // Z is an action only. It never toggles Undo On/Off.
  document.addEventListener("keydown", function (event) {
    if (String(event.key || "").toLowerCase() !== "z") return;
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat) return;
    if (isTypingTarget(event.target)) return;
    if (document.getElementById("settings-overlay") || document.getElementById("solo-2048-overlay")) return;

    var soloCanUndo = window.currentGameMode === "solo" && window.rinasSettings.soloUndo;
    var freeplayCanUndo = window.currentGameMode === "multiplayer-freeplay";

    if (!soloCanUndo && !freeplayCanUndo) return;

    event.preventDefault();
    withGame(function (game) { game.undo(); });
  });

  // =========================================================
  // SOLO MILESTONES
  // =========================================================

  window.showSolo2048Milestone = function () {
    if (window.multiplayerMode || window.currentGameMode !== "solo") return;

    var old = document.getElementById("solo-2048-overlay");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "solo-2048-overlay";
    overlay.className = "result-overlay";
    overlay.innerHTML = `
      <div class="result-box">
        <div class="result-icon">🎉</div>
        <h1>You made 2048!</h1>
        <p>2048 is only the first milestone. Keep this board and see how far you can go.</p>
        <div class="result-actions">
          <button class="primary-button" id="solo-2048-continue">Continue</button>
          <button class="secondary-button" id="solo-2048-new">New Game</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    playSound("milestone");

    document.getElementById("solo-2048-continue").addEventListener("click", function () {
      withGame(function (game) {
        game.keepPlaying = true;
        if (!game.movesAvailable()) game.over = true;
        game.actuator.continueGame();
        game.actuate();
        overlay.remove();
      });
    });

    document.getElementById("solo-2048-new").addEventListener("click", function () {
      withGame(function (game) {
        overlay.remove();
        game.restart();
      });
    });
  };

  window.showSoloMilestoneToast = function (tileValue) {
    if (window.multiplayerMode || window.currentGameMode !== "solo") return;

    showBattleToast(tileValue + " reached!");
    playSound("milestone");
  };

  // =========================================================
  // MULTIPLAYER MENUS
  // =========================================================

  function showMultiplayerMenu() {
    window.currentGameMode = "multiplayer-menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = null;
    restoreGameContainer();

    showScreen(
      "Multiplayer",
      showMainMenu,
      `
        <div class="multiplayer-entry-head">
          <span>PLAYING AS</span>
          <strong>${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Player")}</strong>
          <button class="nickname-link" id="change-nickname">Change</button>
        </div>

        <div class="mode-showcase-list">
          <button class="mode-showcase mode-showcase-race" id="mode-tile-race">
            <div class="mode-showcase-copy">
              <span class="mode-showcase-index">01 · COMPETITIVE</span>
              <h2>Tile Race</h2>
              <p>First player to reach the target tile wins. A stuck board loses.</p>
              <div class="mode-showcase-facts"><span>Live position</span><span>No Undo</span><span>2048 / 4096 / 8192</span></div>
              <strong class="mode-showcase-action">Play Tile Race →</strong>
            </div>
            <div class="mode-showcase-preview">${modePreviewMarkup('tile-race')}</div>
          </button>

          <button class="mode-showcase mode-showcase-freeplay" id="mode-freeplay">
            <div class="mode-showcase-copy">
              <span class="mode-showcase-index">02 · CASUAL</span>
              <h2>Freeplay Duel</h2>
              <p>Build side-by-side with no winner or elimination. Compare progress and rewind one move at a time.</p>
              <div class="mode-showcase-facts"><span>No finish line</span><span>One-step Undo</span><span>Restart anytime</span></div>
              <strong class="mode-showcase-action">Play Freeplay →</strong>
            </div>
            <div class="mode-showcase-preview">${modePreviewMarkup('freeplay')}</div>
          </button>

          <button class="mode-showcase mode-showcase-custom" id="mode-custom-race">
            <div class="mode-showcase-copy">
              <span class="mode-showcase-index">03 · HANDICAP</span>
              <h2>Custom Race</h2>
              <p>Give each player a different finish tile. Balance a beginner against an expert without hidden advantages.</p>
              <div class="mode-showcase-facts"><span>Different targets</span><span>Live position</span><span>Transparent rules</span></div>
              <strong class="mode-showcase-action">Build Custom Race →</strong>
            </div>
            <div class="mode-showcase-preview">${modePreviewMarkup('custom-race')}</div>
          </button>
        </div>

        <div class="future-modes-strip" aria-label="Future multiplayer modes">
          <span><b>Score Sprint</b> Coming soon</span>
          <span><b>Blitz</b> Coming soon</span>
          <span><b>Survival</b> Coming soon</span>
        </div>
      `
    );

    document.getElementById("change-nickname").addEventListener("click", function () {
      openNicknamePrompt(showMultiplayerMenu);
    });

    document.getElementById("mode-tile-race").addEventListener("click", showTileRaceLobby);
    document.getElementById("mode-freeplay").addEventListener("click", showFreeplayLobby);
    document.getElementById("mode-custom-race").addEventListener("click", showCustomRaceLobby);
  }

  function roomJoinMarkup() {
    return `
      <div class="race-box">
        <h2>Join Game</h2>
        <p>Enter the room code your friend sent you.</p>
        <input id="room-code" class="room-input" maxlength="6" placeholder="ROOM CODE" autocomplete="off">
        <button class="primary-button" id="join-room">Join Game</button>
      </div>
    `;
  }

  function bindJoinRoom() {
    document.getElementById("join-room").addEventListener("click", function () {
      var input = document.getElementById("room-code");
      var status = document.getElementById("lobby-status");
      var code = input.value.trim().toUpperCase();

      if (code.length !== 6) {
        status.textContent = "Please enter a 6-character room code.";
        return;
      }

      currentRoomCode = code;
      window.multiplayerRoomCode = code;
      status.textContent = "Joining room...";
      this.disabled = true;

      socket.emit("joinRoom", {
        roomCode: code,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });
  }

  function targetButtons(targets, selected, groupClass) {
    return targets.map(function (target) {
      return '<button class="target-button ' + groupClass + ' ' + (target === selected ? 'selected' : '') + '" data-target="' + target + '">' + target + '</button>';
    }).join("");
  }

  function bindTargetGroup(selector, onSelect) {
    Array.prototype.forEach.call(document.querySelectorAll(selector), function (button) {
      button.addEventListener("click", function () {
        var value = Number(button.getAttribute("data-target"));
        onSelect(value);
        Array.prototype.forEach.call(document.querySelectorAll(selector), function (other) {
          other.classList.toggle("selected", other === button);
        });
      });
    });
  }

  function showTileRaceLobby() {
    window.currentGameMode = "tile-race-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    showScreen(
      "Tile Race",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="rules-card">
          <strong>Tile Race Rules</strong>
          <ul>
            <li>First player to make the target tile wins.</li>
            <li>Both players use standard 2048 rules with no Undo.</li>
            <li>If your board has no legal moves before you reach the target, you lose.</li>
            <li>The live race meter shows who is closer to the finish.</li>
            <li>Score does not decide the winner.</li>
          </ul>
        </div>

        <div class="race-columns">
          <div class="race-box">
            <h2>Create Race</h2>
            <p>Choose a shared target.</p>
            <div class="target-picker" id="target-picker">${targetButtons(TARGETS, selectedTarget, "shared-target")}</div>
            <button class="primary-button" id="create-room">Create Game</button>
          </div>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text" id="lobby-status"></p>
      `
    );

    bindTargetGroup(".shared-target", function (value) {
      selectedTarget = value;
      safeStorageSet(LAST_TARGET_KEY, selectedTarget);
    });

    document.getElementById("create-room").addEventListener("click", function () {
      document.getElementById("lobby-status").textContent = "Creating room...";
      this.disabled = true;
      socket.emit("createRoom", {
        mode: "tile-race",
        targetTile: selectedTarget,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function showFreeplayLobby() {
    window.currentGameMode = "freeplay-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    showScreen(
      "Freeplay Duel",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="rules-card">
          <strong>Freeplay Rules</strong>
          <ul>
            <li>There is no winner and no elimination.</li>
            <li>Play side-by-side for as long as you like and watch each other's board.</li>
            <li>Each successful move earns one single-step Undo. Use the Undo button or Z.</li>
            <li>If your board gets stuck, Undo the last move or restart your own board; your opponent keeps playing.</li>
            <li>Score and Highest are shown for friendly comparison only.</li>
          </ul>
        </div>

        <div class="race-columns">
          <div class="race-box">
            <h2>Create Freeplay</h2>
            <p>Open a relaxed room with no finish line.</p>
            <button class="primary-button" id="create-room">Create Game</button>
          </div>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text" id="lobby-status"></p>
      `
    );

    document.getElementById("create-room").addEventListener("click", function () {
      document.getElementById("lobby-status").textContent = "Creating room...";
      this.disabled = true;
      socket.emit("createRoom", {
        mode: "freeplay",
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function showCustomRaceLobby() {
    window.currentGameMode = "custom-race-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    showScreen(
      "Custom Race",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="rules-card">
          <strong>Custom Race</strong>
          <ul>
            <li>Each player can have a different target tile.</li>
            <li>Use a lower target for the newer player and a higher target for the stronger player.</li>
            <li>First player to reach their own target wins.</li>
            <li>There is no Undo. If your board gets stuck, you lose.</li>
            <li>The live meter compares percentage progress toward each player's own target.</li>
          </ul>
        </div>

        <div class="race-columns">
          <div class="race-box">
            <h2>Create Custom Race</h2>
            <div class="custom-target-grid">
              <div class="custom-target-panel">
                <h3>Your target</h3>
                <p>Player 1 / room creator</p>
                <div class="target-picker">${targetButtons(CUSTOM_TARGETS, selectedCustomHostTarget, "host-target")}</div>
              </div>
              <div class="custom-target-panel">
                <h3>Opponent target</h3>
                <p>Player 2 / person joining</p>
                <div class="target-picker">${targetButtons(CUSTOM_TARGETS, selectedCustomGuestTarget, "guest-target")}</div>
              </div>
            </div>
            <button class="primary-button" id="create-room">Create Game</button>
          </div>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text" id="lobby-status"></p>
      `
    );

    bindTargetGroup(".host-target", function (value) {
      selectedCustomHostTarget = value;
      safeStorageSet(LAST_CUSTOM_HOST_TARGET_KEY, value);
    });
    bindTargetGroup(".guest-target", function (value) {
      selectedCustomGuestTarget = value;
      safeStorageSet(LAST_CUSTOM_GUEST_TARGET_KEY, value);
    });

    document.getElementById("create-room").addEventListener("click", function () {
      document.getElementById("lobby-status").textContent = "Creating room...";
      this.disabled = true;
      socket.emit("createRoom", {
        mode: "custom-race",
        hostTarget: selectedCustomHostTarget,
        guestTarget: selectedCustomGuestTarget,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function modeTitle(mode) {
    if (mode === "freeplay") return "Freeplay Duel";
    if (mode === "custom-race") return "Custom Race";
    return "Tile Race";
  }

  function backToLobbyForMode(mode) {
    if (mode === "freeplay") showFreeplayLobby();
    else if (mode === "custom-race") showCustomRaceLobby();
    else showTileRaceLobby();
  }

  function showWaitingRoom(data) {
    currentRoomCode = data.roomCode;
    window.multiplayerRoomCode = data.roomCode;
    var mode = data.mode || "tile-race";

    showScreen(
      modeTitle(mode),
      function () { leaveRoomSilently(); backToLobbyForMode(mode); },
      `
        <div class="race-box" style="max-width:520px;margin:0 auto;text-align:center;">
          <h2>Room Created</h2>
          <p>Send this code to your opponent:</p>
          <div class="room-code-display">${escapeHtml(data.roomCode)}</div>
          ${mode === "tile-race" ? '<p><strong>Target:</strong> ' + Number(data.targetTile || 2048) + '</p>' : ""}
          ${mode === "custom-race" ? '<p><strong>Your target:</strong> ' + Number(data.ownTarget || 2048) + ' &nbsp;·&nbsp; <strong>Opponent target:</strong> ' + Number(data.opponentTarget || 2048) + '</p>' : ""}
          ${mode === "freeplay" ? '<p><strong>Mode:</strong> No finish line, no elimination.</p>' : ""}
          <p><strong>Playing as:</strong> ${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Player 1")}</p>
          <p>Waiting for Player 2 to join...</p>
        </div>
      `
    );
  }

  // =========================================================
  // MULTIPLAYER MATCH
  // =========================================================

  function startMultiplayerMatch(data) {
    currentRoomCode = data.roomCode || currentRoomCode;
    updateProfiles(data.players || []);

    var mode = data.mode || "tile-race";

    window.currentGameMode = "multiplayer-" + mode;
    window.multiplayerMode = true;
    window.multiplayerMatchActive = true;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = mode;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerTargetTile = Number(data.targetTile || 0);
    window.multiplayerOwnTarget = Number(data.ownTarget || data.targetTile || 0);
    window.multiplayerOpponentTarget = Number(data.opponentTarget || data.targetTile || 0);

    appRoot.innerHTML = "";
    gameHost.style.display = "none";
    soloToolbar.style.display = "none";
    clearModeClasses();
    removeSoloActionRow();

    latestOpponentState = null;
    lastOwnHighest = 0;
    lastOwnScore = 0;
    lastLeaderNumber = null;
    lastOwnOneAway = false;
    lastOpponentOneAway = false;

    startCompetitiveMusic();

    withGame(function (game) {
      window.multiplayerAllowRestart = true;
      game.restart();
      window.multiplayerAllowRestart = false;
      game.freeplayUndoEntry = null;

      lastOwnHighest = game.getHighestTileValue();
      lastOwnScore = game.score;
      createBattleView();
      gameContainer.style.display = "block";
      window.updateMatchProgress(lastOwnHighest, lastOwnScore);
    });
  }

  function progressRatio(highest, target) {
    highest = Math.max(2, Number(highest || 2));
    target = Math.max(4, Number(target || 2048));

    var currentStep = Math.max(0, Math.log(highest) / Math.LN2 - 1);
    var totalSteps = Math.max(1, Math.log(target) / Math.LN2 - 1);
    return Math.max(0, Math.min(1, currentStep / totalSteps));
  }

  function createProgressHtml(prefix, target) {
    return `
      <div class="progress-wrap">
        <div class="progress-track"><div class="progress-fill" id="${prefix}-progress-fill"></div></div>
        <div class="progress-meta">
          <span id="${prefix}-progress-text">2 / ${target}</span>
          <span>${target}</span>
        </div>
        <div class="progress-note" id="${prefix}-progress-note"></div>
      </div>
    `;
  }

  function createBattleView() {
    removeBattleShell();

    var mode = window.multiplayerModeName || "tile-race";
    var isFreeplay = mode === "freeplay";
    var ownTarget = Number(window.multiplayerOwnTarget || window.multiplayerTargetTile || 2048);
    var opponentTarget = Number(window.multiplayerOpponentTarget || window.multiplayerTargetTile || 2048);
    var ownName = getOwnNickname();
    var opponentName = getOpponentNickname();
    var opponentProfile = getProfile(getOpponentNumber());
    var opponentTheme = opponentProfile && THEMES.indexOf(opponentProfile.theme) !== -1 ? opponentProfile.theme : "classic";

    battleShell = document.createElement("div");
    battleShell.className = "battle-shell";

    var ruleLine = isFreeplay
      ? "Relaxed side-by-side play. No winner, no elimination. Undo one move at a time or restart your board whenever you need."
      : mode === "custom-race"
        ? "Each player races to their own target. A stuck board loses."
        : "First to the target tile wins. A stuck board loses.";

    battleShell.innerHTML = `
      <div class="battle-topbar">
        <button class="danger-button" id="leave-match">Leave Match</button>
        <div class="battle-mode-title">
          <strong>Rina's 2048</strong>
          <span>${escapeHtml(modeTitle(mode))}</span>
        </div>
        <div class="battle-topbar-right">
          <span class="battle-room-mini">Room ${escapeHtml(window.multiplayerRoomCode || "------")}</span>
          <button class="settings-button" id="battle-settings">Settings</button>
        </div>
      </div>

      <div class="battle-heading">
        <p class="battle-rule-line">${ruleLine}</p>
      </div>

      ${isFreeplay ? '<div class="freeplay-banner">Play at your own pace. Score and Highest are just for friendly comparison.</div>' : ""}

      <div class="battle-layout">
        <section class="battle-player-card own-panel" id="own-panel" aria-label="Your board">
          <div class="player-card-header">
            <div class="player-name-block">
              <h2 class="player-name" id="own-nickname">${escapeHtml(ownName)}</h2>
              <div class="player-subline">
                <span>You</span>
                ${isFreeplay ? "" : '<span class="rank-badge" id="own-rank">TIED</span>'}
              </div>
            </div>
            ${isFreeplay
              ? '<div class="stat-pair"><div class="mini-stat"><span>Score</span><strong id="own-score">0</strong></div><div class="mini-stat"><span>Highest</span><strong id="own-highest">' + Number(lastOwnHighest || 0) + '</strong></div></div>'
              : '<div class="highest-box"><span>Highest</span><strong id="own-highest">' + Number(lastOwnHighest || 0) + '</strong></div>'}
          </div>
          ${isFreeplay ? "" : createProgressHtml("own", ownTarget)}
        </section>

        <section class="battle-player-card opponent-panel" id="opponent-panel" data-opponent-theme="${escapeHtml(opponentTheme)}" aria-label="Opponent board">
          <div class="player-card-header">
            <div class="player-name-block">
              <h2 class="player-name" id="opponent-nickname">${escapeHtml(opponentName)}</h2>
              <div class="player-subline">
                <span>Opponent</span>
                ${isFreeplay ? "" : '<span class="rank-badge" id="opponent-rank">TIED</span>'}
              </div>
            </div>
            ${isFreeplay
              ? '<div class="stat-pair"><div class="mini-stat"><span>Score</span><strong id="opponent-score">0</strong></div><div class="mini-stat"><span>Highest</span><strong id="opponent-highest">0</strong></div></div>'
              : '<div class="highest-box"><span>Highest</span><strong id="opponent-highest">0</strong></div>'}
          </div>
          ${isFreeplay ? "" : createProgressHtml("opponent", opponentTarget)}
          <div id="opponent-grid" class="opponent-grid" data-theme="${escapeHtml(opponentTheme)}"></div>
          <div id="opponent-status">Waiting for opponent to move...</div>
        </section>
      </div>
    `;

    document.body.appendChild(battleShell);

    var ownPanel = document.getElementById("own-panel");
    ownPanel.appendChild(gameContainer);

    if (isFreeplay) {
      var controls = document.createElement("div");
      controls.className = "freeplay-controls";
      controls.innerHTML = `
        <button class="small-button" id="freeplay-undo" data-no-ui-sound="true">Undo <kbd>Z</kbd></button>
        <button class="small-button" id="freeplay-restart">Restart Board</button>
      `;
      ownPanel.appendChild(controls);

      document.getElementById("freeplay-undo").addEventListener("click", function () {
        withGame(function (game) { game.undo(); });
      });
      document.getElementById("freeplay-restart").addEventListener("click", function () {
        if (window.confirm("Restart your Freeplay board? Your opponent will keep playing.")) {
          restartFreeplayBoard();
        }
      });
    }

    ownHighestDisplay = document.getElementById("own-highest");
    ownScoreDisplay = document.getElementById("own-score");
    opponentScoreDisplay = document.getElementById("opponent-score");
    ownNicknameDisplay = document.getElementById("own-nickname");
    opponentNicknameDisplay = document.getElementById("opponent-nickname");
    ownRankBadge = document.getElementById("own-rank");
    opponentRankBadge = document.getElementById("opponent-rank");
    opponentPanelElement = document.getElementById("opponent-panel");
    opponentGrid = document.getElementById("opponent-grid");
    opponentHighest = document.getElementById("opponent-highest");
    opponentStatus = document.getElementById("opponent-status");
    ownProgressFill = document.getElementById("own-progress-fill");
    opponentProgressFill = document.getElementById("opponent-progress-fill");
    ownProgressText = document.getElementById("own-progress-text");
    opponentProgressText = document.getElementById("opponent-progress-text");
    ownProgressNote = document.getElementById("own-progress-note");
    opponentProgressNote = document.getElementById("opponent-progress-note");

    for (var i = 0; i < 16; i++) {
      var cell = document.createElement("div");
      cell.className = "opponent-cell";
      opponentGrid.appendChild(cell);
    }

    document.getElementById("leave-match").addEventListener("click", function () {
      if (window.confirm("Leave this multiplayer room?")) leaveMultiplayerMatch();
    });
    document.getElementById("battle-settings").addEventListener("click", openSettings);

    window.refreshFreeplayControls();
    window.updateMatchProgress(lastOwnHighest, lastOwnScore);
    if (latestOpponentState) renderOpponentState(latestOpponentState);
  }

  function restoreGameContainer() {
    if (gameContainer.parentNode !== gameHost) {
      gameHost.appendChild(gameContainer);
    }
    gameContainer.style.display = "none";
    removeBattleShell();
  }

  function removeBattleShell() {
    if (battleShell && battleShell.parentNode) battleShell.remove();
    battleShell = null;
    opponentGrid = null;
    opponentHighest = null;
    opponentStatus = null;
    ownHighestDisplay = null;
    ownScoreDisplay = null;
    opponentScoreDisplay = null;
    ownNicknameDisplay = null;
    opponentNicknameDisplay = null;
    ownRankBadge = null;
    opponentRankBadge = null;
    opponentPanelElement = null;
    ownProgressFill = null;
    opponentProgressFill = null;
    ownProgressText = null;
    opponentProgressText = null;
    ownProgressNote = null;
    opponentProgressNote = null;
  }

  function leaveRoomSilently() {
    if (currentRoomCode) socket.emit("leaveRoom");
    currentRoomCode = null;
    window.multiplayerRoomCode = null;
  }

  function leaveMultiplayerMatch() {
    stopCompetitiveMusic(320);
    socket.emit("leaveRoom");
    currentRoomCode = null;
    window.multiplayerRoomCode = null;
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerPlayerNumber = null;
    window.multiplayerProfiles = [];
    window.multiplayerModeName = null;
    restoreGameContainer();
    showMultiplayerMenu();
  }

  function showBattleToast(message) {
    var existing = document.getElementById("battle-toast");
    if (existing) existing.remove();

    var toast = document.createElement("div");
    toast.id = "battle-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 2200);
  }

  function applyRankBadge(badge, text, isFirst) {
    if (!badge) return;
    var changed = badge.textContent !== text;
    badge.textContent = text;
    badge.classList.toggle("first", !!isFirst);
    if (changed) {
      badge.classList.remove("rank-bump");
      void badge.offsetWidth;
      badge.classList.add("rank-bump");
    }
  }

  function setProgress(prefix, highest, target) {
    var ratio = progressRatio(highest, target);
    var fill = prefix === "own" ? ownProgressFill : opponentProgressFill;
    var text = prefix === "own" ? ownProgressText : opponentProgressText;
    var note = prefix === "own" ? ownProgressNote : opponentProgressNote;

    if (fill) fill.style.width = Math.round(ratio * 100) + "%";
    if (text) text.textContent = Number(highest || 0) + " / " + target;
    if (note) {
      note.textContent = Number(highest || 0) >= target / 2 && Number(highest || 0) < target
        ? "One merge away"
        : "";
    }

    return ratio;
  }

  window.updateMatchProgress = function (ownHighest, ownScore) {
    lastOwnHighest = Number(ownHighest || 0);
    lastOwnScore = Number(ownScore || 0);

    if (ownHighestDisplay) ownHighestDisplay.textContent = lastOwnHighest;
    if (ownScoreDisplay) ownScoreDisplay.textContent = lastOwnScore;

    var mode = window.multiplayerModeName || "tile-race";
    if (mode === "freeplay") {
      lastOwnOneAway = false;
      lastOpponentOneAway = false;
      updateCompetitiveMusicIntensity();
      return;
    }

    var ownTarget = Number(window.multiplayerOwnTarget || window.multiplayerTargetTile || 2048);
    var opponentTarget = Number(window.multiplayerOpponentTarget || window.multiplayerTargetTile || 2048);
    var ownRatio = setProgress("own", lastOwnHighest, ownTarget);
    var ownOneAwayNow = lastOwnHighest >= ownTarget / 2 && lastOwnHighest < ownTarget;

    if (!latestOpponentState) {
      setProgress("opponent", 0, opponentTarget);
      applyRankBadge(ownRankBadge, "TIED", false);
      applyRankBadge(opponentRankBadge, "TIED", false);

      if (ownOneAwayNow && !lastOwnOneAway) {
        showBattleToast(getOwnNickname() + " is one merge away.");
        playSound("danger");
      }

      lastOwnOneAway = ownOneAwayNow;
      lastOpponentOneAway = false;
      updateCompetitiveMusicIntensity();
      return;
    }

    var opponentHighestValue = Number(latestOpponentState.highestTile || 0);
    var opponentRatio = setProgress("opponent", opponentHighestValue, opponentTarget);
    var opponentOneAwayNow = opponentHighestValue >= opponentTarget / 2 && opponentHighestValue < opponentTarget;
    var leaderNumber = 0;
    var ownNumber = Number(window.multiplayerPlayerNumber);
    var opponentNumber = getOpponentNumber();
    var epsilon = 0.00001;

    if (ownRatio > opponentRatio + epsilon) {
      leaderNumber = ownNumber;
      applyRankBadge(ownRankBadge, "1ST", true);
      applyRankBadge(opponentRankBadge, "2ND", false);
    } else if (opponentRatio > ownRatio + epsilon) {
      leaderNumber = opponentNumber;
      applyRankBadge(ownRankBadge, "2ND", false);
      applyRankBadge(opponentRankBadge, "1ST", true);
    } else {
      applyRankBadge(ownRankBadge, "TIED", false);
      applyRankBadge(opponentRankBadge, "TIED", false);
    }

    if (lastLeaderNumber !== null && leaderNumber !== lastLeaderNumber) {
      if (leaderNumber === 0) {
        showBattleToast("The race is tied.");
        playSound("tie");
      } else {
        var leaderName = leaderNumber === ownNumber ? getOwnNickname() : getOpponentNickname();
        showBattleToast(leaderName + " takes the lead.");
        playSound(leaderNumber === ownNumber ? "lead" : "lead-lost");
      }
    }

    if (ownOneAwayNow && !lastOwnOneAway) {
      showBattleToast(getOwnNickname() + " is one merge away.");
      playSound("danger");
    } else if (opponentOneAwayNow && !lastOpponentOneAway) {
      showBattleToast(getOpponentNickname() + " is one merge away.");
      playSound("danger");
    }

    lastOwnOneAway = ownOneAwayNow;
    lastOpponentOneAway = opponentOneAwayNow;
    lastLeaderNumber = leaderNumber;
    updateCompetitiveMusicIntensity();
  };

  function renderOpponentState(state) {
    if (!opponentGrid || !state || !state.grid) return;

    if (state.nickname) {
      updateOneProfile({
        playerNumber: getOpponentNumber(),
        nickname: state.nickname,
        theme: state.theme
      });
    }

    if (opponentNicknameDisplay) opponentNicknameDisplay.textContent = getOpponentNickname();

    var opponentThemeName = THEMES.indexOf(state.theme) !== -1 ? state.theme : "classic";
    opponentGrid.setAttribute("data-theme", opponentThemeName);
    if (opponentPanelElement) opponentPanelElement.setAttribute("data-opponent-theme", opponentThemeName);

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
          cellElement.className = "opponent-cell has-tile tile-" + tile.value;
        }
        cellIndex++;
      }
    }

    if (opponentHighest) opponentHighest.textContent = state.highestTile || 0;
    if (opponentScoreDisplay) opponentScoreDisplay.textContent = state.score || 0;

    if (state.over) opponentStatus.textContent = getOpponentNickname() + "'s board is finished.";
    else opponentStatus.textContent = getOpponentNickname() + " is playing...";

    window.updateMatchProgress(lastOwnHighest, lastOwnScore);
  }

  function resetOpponentView() {
    latestOpponentState = null;
    lastLeaderNumber = null;

    if (opponentHighest) opponentHighest.textContent = "0";
    if (opponentScoreDisplay) opponentScoreDisplay.textContent = "0";
    if (opponentStatus) opponentStatus.textContent = "Waiting for opponent to move...";

    if (opponentGrid) {
      var opponentProfile = getProfile(getOpponentNumber());
      var opponentThemeName = opponentProfile && THEMES.indexOf(opponentProfile.theme) !== -1 ? opponentProfile.theme : "classic";
      opponentGrid.setAttribute("data-theme", opponentThemeName);
      if (opponentPanelElement) opponentPanelElement.setAttribute("data-opponent-theme", opponentThemeName);
      var cells = opponentGrid.children;
      for (var i = 0; i < cells.length; i++) {
        cells[i].className = "opponent-cell";
        cells[i].textContent = "";
      }
    }

    applyRankBadge(ownRankBadge, "TIED", false);
    applyRankBadge(opponentRankBadge, "TIED", false);
  }

  window.refreshFreeplayControls = function () {
    var button = document.getElementById("freeplay-undo");
    if (!button) return;

    button.disabled = !window.multiplayerGame ||
      !!window.multiplayerGame.undoAnimating ||
      !window.multiplayerGame.freeplayUndoEntry;
  };

  function restartFreeplayBoard() {
    removeFreeplayBoardOver();
    withGame(function (game) {
      window.multiplayerAllowRestart = true;
      game.restart();
      window.multiplayerAllowRestart = false;
      game.freeplayUndoEntry = null;
      window.multiplayerGameOver = false;
      window.refreshFreeplayControls();
    });
  }

  function removeFreeplayBoardOver() {
    var overlay = document.getElementById("freeplay-board-over");
    if (overlay) overlay.remove();
  }

  window.showFreeplayBoardOver = function () {
    if (window.multiplayerModeName !== "freeplay") return;
    removeFreeplayBoardOver();

    var overlay = document.createElement("div");
    overlay.id = "freeplay-board-over";
    overlay.className = "result-overlay";

    var canUndo = !!(window.multiplayerGame && window.multiplayerGame.freeplayUndoEntry);
    overlay.innerHTML = `
      <div class="result-box">
        <h1>Board Full</h1>
        <p>Freeplay doesn't eliminate you. Undo the last move or start a fresh board while your opponent keeps playing.</p>
        <div class="result-actions">
          ${canUndo ? '<button class="primary-button" id="freeplay-over-undo">Undo Last Move</button>' : ""}
          <button class="secondary-button" id="freeplay-over-restart">Restart Board</button>
          <button class="secondary-button" id="freeplay-over-leave">Leave Freeplay</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    var undoButton = document.getElementById("freeplay-over-undo");
    if (undoButton) {
      undoButton.addEventListener("click", function () {
        withGame(function (game) {
          game.undo();
          overlay.remove();
        });
      });
    }

    document.getElementById("freeplay-over-restart").addEventListener("click", restartFreeplayBoard);
    document.getElementById("freeplay-over-leave").addEventListener("click", function () {
      overlay.remove();
      leaveMultiplayerMatch();
    });
  };

  // =========================================================
  // RESULTS
  // =========================================================

  function removeResultOverlay() {
    var existing = document.getElementById("result-overlay");
    if (existing) existing.remove();
  }

  function showMatchResult(data) {
    removeResultOverlay();
    window.multiplayerGameOver = true;

    var didWin = Number(data.winner) === Number(window.multiplayerPlayerNumber);
    var mode = data.mode || window.multiplayerModeName || "tile-race";
    var opponentName = getOpponentNickname();
    var description;

    if (data.reason === "board-stuck") {
      description = didWin
        ? opponentName + " ran out of legal moves."
        : "Your board ran out of legal moves.";
    } else if (mode === "custom-race") {
      description = didWin
        ? "You reached your target of " + Number(window.multiplayerOwnTarget || 2048) + " first!"
        : opponentName + " reached their target of " + Number(window.multiplayerOpponentTarget || 2048) + " first.";
    } else {
      var target = Number(window.multiplayerTargetTile || 2048);
      description = didWin
        ? "You were first to reach " + target + "!"
        : opponentName + " reached " + target + " first.";
    }

    var overlay = document.createElement("div");
    overlay.id = "result-overlay";
    overlay.className = "result-overlay";
    overlay.innerHTML = `
      <div class="result-box">
        <div class="result-icon">${didWin ? "🏆" : "💥"}</div>
        <h1>${didWin ? "YOU WIN!" : "YOU LOSE"}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="result-actions">
          <button class="primary-button" id="result-rematch">Rematch</button>
          <button class="secondary-button" id="result-back">Back to Multiplayer</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    duckCompetitiveMusic();
    playSound(didWin ? "win" : "lose");

    document.getElementById("result-rematch").addEventListener("click", function () {
      this.disabled = true;
      this.textContent = "Waiting...";
      socket.emit("requestRematch");
    });
    document.getElementById("result-back").addEventListener("click", function () {
      removeResultOverlay();
      leaveMultiplayerMatch();
    });
  }

  function showOpponentLeft() {
    stopCompetitiveMusic(260);
    removeResultOverlay();
    removeFreeplayBoardOver();
    window.multiplayerGameOver = true;
    window.multiplayerMatchActive = false;

    var overlay = document.createElement("div");
    overlay.id = "result-overlay";
    overlay.className = "result-overlay";
    overlay.innerHTML = `
      <div class="result-box">
        <div class="result-icon">👋</div>
        <h1>Room Ended</h1>
        <p>${escapeHtml(getOpponentNickname())} left the room.</p>
        <div class="result-actions"><button class="primary-button" id="opponent-left-back">Back to Multiplayer</button></div>
      </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("opponent-left-back").addEventListener("click", function () {
      removeResultOverlay();
      currentRoomCode = null;
      window.multiplayerRoomCode = null;
      window.multiplayerMode = false;
      window.multiplayerGameOver = false;
      window.multiplayerModeName = null;
      restoreGameContainer();
      showMultiplayerMenu();
    });
  }

  // =========================================================
  // SETTINGS
  // =========================================================

  function themePreview(theme) {
    var previews = {
      classic: ["#faf8ef", "#bbada0", "#eee4da", "#f65e3b", "#edc22e"],
      pastel: ["#ffffff", "#ded9e7", "#f8e8ee", "#ffd6b8", "#ffafcc"],
      ocean: ["#edf8fb", "#8eb7c3", "#d9f0f7", "#2589a5", "#063747"],
      candy: ["#fff3f8", "#dfa8bd", "#ffe1ec", "#ff5d8f", "#845ec2"],
      midnight: ["#121622", "#30384d", "#dce1f2", "#4d579e", "#211e3d"]
    };

    return previews[theme].map(function (color) {
      return '<i style="background:' + color + '"></i>';
    }).join("");
  }

  function prettyThemeName(theme) {
    return theme.charAt(0).toUpperCase() + theme.slice(1);
  }

  function openSettings() {
    var old = document.getElementById("settings-overlay");
    if (old) old.remove();

    var themeLocked = !!window.multiplayerMatchActive;
    var sfxPercent = Math.round(Number(typeof window.rinasSettings.sfxVolume === "number" ? window.rinasSettings.sfxVolume : 0.75) * 100);

    var overlay = document.createElement("div");
    overlay.id = "settings-overlay";
    overlay.className = "settings-overlay";
    overlay.innerHTML = `
      <div class="settings-dialog settings-dialog-v40">
        <div class="settings-dialog-header">
          <div>
            <span class="settings-kicker">RINA'S 2048</span>
            <h2>Settings</h2>
          </div>
          <button class="close-settings" id="close-settings" aria-label="Close">×</button>
        </div>

        <div class="settings-grid-v40">
          <section class="settings-section settings-profile-section">
            <h3>Profile</h3>
            <label class="field-label" for="settings-nickname">Nickname</label>
            <input id="settings-nickname" class="nickname-field" type="text" maxlength="16" autocomplete="nickname" placeholder="Nickname" value="${escapeHtml(window.rinasSettings.nickname || "")}">
            <p class="settings-help">Shown to the other player in multiplayer rooms.</p>
          </section>

          <section class="settings-section">
            <h3>Controls</h3>
            <p class="settings-help">Choose one keyboard movement scheme. Touch controls always use swipe.</p>
            <div class="control-choice-row">
              <button class="control-choice ${window.rinasSettings.controlScheme === "arrows" ? "selected" : ""}" data-controls="arrows">Arrow Keys</button>
              <button class="control-choice ${window.rinasSettings.controlScheme === "wasd" ? "selected" : ""}" data-controls="wasd">WASD</button>
            </div>

            <div class="toggle-row settings-inline-toggle">
              <div>
                <h4>Solo Undo</h4>
                <p class="settings-help">One rewind after each successful Solo move. Press Z or use the Undo button.</p>
              </div>
              <button id="solo-undo-toggle" class="toggle-button ${window.rinasSettings.soloUndo ? "on" : "off"}">${window.rinasSettings.soloUndo ? "ON" : "OFF"}</button>
            </div>
          </section>

          <section class="settings-section settings-audio-section">
            <h3>Sound</h3>
            <div class="audio-control-group single-audio-group">
              <div class="toggle-row">
                <div>
                  <h4>Sound Effects</h4>
                  <p class="settings-help">Moves, merges, Undo, lead changes, milestones and match results.</p>
                </div>
                <button id="sound-effects-toggle" class="toggle-button ${window.rinasSettings.soundEffects ? "on" : "off"}">${window.rinasSettings.soundEffects ? "ON" : "OFF"}</button>
              </div>
              <label class="volume-row" for="sfx-volume">
                <span>SFX volume</span>
                <input id="sfx-volume" type="range" min="0" max="100" step="1" value="${sfxPercent}">
                <output id="sfx-volume-output">${sfxPercent}%</output>
              </label>
            </div>
          </section>

          <section class="settings-section settings-theme-section ${themeLocked ? "locked" : ""}">
            <div class="settings-section-heading-row">
              <div>
                <h3>Theme</h3>
                <p class="settings-help">Choose your visual theme. In multiplayer, your opponent can see your board theme.</p>
              </div>
              ${themeLocked ? '<span class="locked-badge">Locked during multiplayer match</span>' : ''}
            </div>
            <div class="theme-grid">
              ${THEMES.map(function (theme) {
                return '<button class="theme-choice ' + (theme === window.rinasSettings.theme ? 'selected' : '') + '" data-theme="' + theme + '" ' + (themeLocked ? 'disabled' : '') + '>' + prettyThemeName(theme) + '<span class="theme-swatches">' + themePreview(theme) + '</span></button>';
              }).join("")}
            </div>
          </section>
        </div>

        <div class="settings-footer"><button class="primary-button" id="settings-done">Done</button></div>
      </div>
    `;

    document.body.appendChild(overlay);
    var nicknameInput = document.getElementById("settings-nickname");

    function saveNickname() {
      window.rinasSettings.nickname = sanitizeNickname(nicknameInput.value);
      nicknameInput.value = window.rinasSettings.nickname;
      saveSettings();

      if (window.multiplayerMatchActive) {
        socket.emit("updateProfile", {
          nickname: window.rinasSettings.nickname,
          theme: window.rinasSettings.theme
        });
        updateOneProfile({
          playerNumber: window.multiplayerPlayerNumber,
          nickname: window.rinasSettings.nickname,
          theme: window.rinasSettings.theme
        });
        if (ownNicknameDisplay) ownNicknameDisplay.textContent = getOwnNickname();
      }
    }

    function close() {
      saveNickname();
      overlay.remove();
      window.refreshSoloControls();
    }

    document.getElementById("close-settings").addEventListener("click", close);
    document.getElementById("settings-done").addEventListener("click", close);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
    nicknameInput.addEventListener("change", saveNickname);

    Array.prototype.forEach.call(overlay.querySelectorAll(".control-choice"), function (button) {
      button.addEventListener("click", function () {
        window.rinasSettings.controlScheme = button.getAttribute("data-controls");
        saveSettings();
        Array.prototype.forEach.call(overlay.querySelectorAll(".control-choice"), function (other) {
          other.classList.toggle("selected", other === button);
        });
        window.refreshSoloControls();
      });
    });

    document.getElementById("sound-effects-toggle").addEventListener("click", function () {
      window.rinasSettings.soundEffects = !window.rinasSettings.soundEffects;
      saveSettings();
      this.className = "toggle-button " + (window.rinasSettings.soundEffects ? "on" : "off");
      this.textContent = window.rinasSettings.soundEffects ? "ON" : "OFF";
      if (window.rinasSettings.soundEffects) playSound("ui");
    });

    document.getElementById("sfx-volume").addEventListener("input", function () {
      var value = Math.max(0, Math.min(100, Number(this.value || 0)));
      window.rinasSettings.sfxVolume = value / 100;
      document.getElementById("sfx-volume-output").textContent = value + "%";
      saveSettings();
    });

    Array.prototype.forEach.call(overlay.querySelectorAll(".theme-choice"), function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        var theme = button.getAttribute("data-theme");
        window.rinasSettings.theme = theme;
        saveSettings();
        applyTheme(theme);

        Array.prototype.forEach.call(overlay.querySelectorAll(".theme-choice"), function (other) {
          other.classList.toggle("selected", other.getAttribute("data-theme") === theme);
        });
      });
    });

    document.getElementById("solo-undo-toggle").addEventListener("click", function () {
      window.rinasSettings.soloUndo = !window.rinasSettings.soloUndo;
      saveSettings();
      this.className = "toggle-button " + (window.rinasSettings.soloUndo ? "on" : "off");
      this.textContent = window.rinasSettings.soloUndo ? "ON" : "OFF";

      if (!window.rinasSettings.soloUndo && window.multiplayerGame && !window.multiplayerMode) {
        window.multiplayerGame.storageManager.clearUndoStack();
      }
      window.refreshSoloControls();
    });
  }

  // =========================================================
  // SOCKET EVENTS
  // =========================================================

  socket.on("connect", function () {
    console.log("Connected to Rina's 2048 server.");
  });

  socket.on("roomCreated", function (data) {
    updateProfiles(data.players || []);
    showWaitingRoom(data);
  });

  socket.on("joinError", function (message) {
    var status = document.getElementById("lobby-status");
    var joinButton = document.getElementById("join-room");
    var createButton = document.getElementById("create-room");
    if (status) status.textContent = message;
    if (joinButton) joinButton.disabled = false;
    if (createButton) createButton.disabled = false;
  });

  socket.on("gameStart", function (data) {
    currentRoomCode = data.roomCode || currentRoomCode;
    startMultiplayerMatch(data);
  });

  socket.on("opponentState", function (data) {
    latestOpponentState = data.state;
    renderOpponentState(data.state);
  });

  socket.on("playerProfileUpdated", function (profile) {
    updateOneProfile(profile);

    if (Number(profile.playerNumber) === Number(window.multiplayerPlayerNumber)) {
      if (ownNicknameDisplay) ownNicknameDisplay.textContent = getOwnNickname();
    } else {
      if (opponentNicknameDisplay) opponentNicknameDisplay.textContent = getOpponentNickname();
      if (opponentGrid && THEMES.indexOf(profile.theme) !== -1) opponentGrid.setAttribute("data-theme", profile.theme);
      if (opponentPanelElement && THEMES.indexOf(profile.theme) !== -1) opponentPanelElement.setAttribute("data-opponent-theme", profile.theme);
    }
  });

  socket.on("gameWinner", function (data) { showMatchResult(data); });

  socket.on("rematchWaiting", function () {
    var button = document.getElementById("result-rematch");
    if (button) button.textContent = "Waiting for opponent...";
  });

  socket.on("rematchStart", function (data) {
    removeResultOverlay();
    updateProfiles(data.players || []);

    window.multiplayerMode = true;
    window.multiplayerMatchActive = true;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = data.mode || window.multiplayerModeName;
    window.multiplayerTargetTile = Number(data.targetTile || 0);
    window.multiplayerOwnTarget = Number(data.ownTarget || data.targetTile || window.multiplayerOwnTarget || 0);
    window.multiplayerOpponentTarget = Number(data.opponentTarget || data.targetTile || window.multiplayerOpponentTarget || 0);

    resetOpponentView();
    lastOwnOneAway = false;
    lastOpponentOneAway = false;
    startCompetitiveMusic();

    withGame(function (game) {
      window.multiplayerAllowRestart = true;
      game.restart();
      window.multiplayerAllowRestart = false;
      game.freeplayUndoEntry = null;
      lastOwnHighest = game.getHighestTileValue();
      lastOwnScore = game.score;
      window.updateMatchProgress(lastOwnHighest, lastOwnScore);
    });
  });

  socket.on("opponentLeftMatch", function () {
    if (window.multiplayerMatchActive || currentRoomCode) showOpponentLeft();
  });

  socket.on("disconnect", function () {
    console.log("Disconnected from Rina's 2048 server.");
  });


  // =========================================================
  // v42: desktop-first game UI cleanup
  // =========================================================

  var v42Style = document.createElement("style");
  v42Style.textContent = `
    /* -------------------------------------------------------
       NAVIGATION: game HUD text actions, not generic boxes
       ------------------------------------------------------- */
    .nav-button,
    .settings-button,
    .battle-topbar .danger-button {
      position: relative !important;
      min-height: 0 !important;
      padding: 9px 2px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-text) !important;
      font: 900 13px/1 var(--hud-display) !important;
      letter-spacing: .055em !important;
      text-transform: uppercase !important;
      cursor: pointer !important;
      transition: color 150ms ease, transform 150ms ease !important;
    }

    .nav-button::after,
    .settings-button::after,
    .battle-topbar .danger-button::after {
      content: "";
      position: absolute;
      left: 0;
      right: 100%;
      bottom: 2px;
      height: 2px;
      background: var(--app-accent);
      transition: right 170ms ease;
    }

    .nav-button:hover,
    .settings-button:hover { color: var(--app-accent) !important; }
    .nav-button:hover::after,
    .settings-button:hover::after,
    .battle-topbar .danger-button:hover::after { right: 0; }
    .nav-button:active,
    .settings-button:active,
    .battle-topbar .danger-button:active { transform: translateY(1px) !important; }

    .battle-topbar .danger-button { color: var(--game-danger) !important; }
    .battle-topbar .danger-button::after { background: var(--game-danger) !important; }

    .app-header,
    .solo-floating-header,
    .battle-topbar {
      width: 100% !important;
      border-bottom: 1px solid color-mix(in srgb, var(--game-line) 74%, transparent) !important;
    }

    .app-header-side,
    .solo-floating-header > div:first-child,
    .solo-floating-right,
    .battle-topbar > .danger-button,
    .battle-topbar-right {
      min-width: 150px;
    }

    .app-header-side.right,
    .solo-floating-right,
    .battle-topbar-right { justify-content: flex-end !important; }

    /* -------------------------------------------------------
       SETTINGS: desktop-first, fully scrollable, no trapped UI
       ------------------------------------------------------- */
    .settings-overlay {
      display: block !important;
      overflow-y: auto !important;
      overscroll-behavior: contain;
      padding: 34px 22px 56px !important;
    }

    .settings-dialog.settings-dialog-v40,
    #nickname-overlay .settings-dialog {
      width: min(900px, calc(100% - 20px)) !important;
      max-width: 900px !important;
      max-height: none !important;
      overflow: visible !important;
      margin: 0 auto !important;
      padding: 0 34px 30px !important;
      border: 0 !important;
      border-top: 3px solid var(--app-accent) !important;
      border-radius: 0 !important;
      background: var(--game-panel-strong) !important;
      box-shadow: 0 24px 70px var(--app-shadow) !important;
    }

    .settings-dialog::after,
    .result-box::after { display: none !important; }

    .settings-dialog-header {
      position: sticky;
      top: -34px;
      z-index: 4;
      margin: 0 -34px 28px !important;
      padding: 24px 34px 18px !important;
      border-bottom: 1px solid var(--game-line);
      background: color-mix(in srgb, var(--game-panel-strong) 96%, transparent);
      backdrop-filter: blur(12px);
    }

    .settings-kicker {
      display: block;
      margin-bottom: 4px;
      color: var(--app-accent);
      font: 900 10px/1 var(--hud-display);
      letter-spacing: .16em;
    }

    .settings-dialog-header h2 {
      margin: 0 !important;
      font-size: 36px !important;
      line-height: 1 !important;
    }

    .close-settings {
      width: 42px;
      height: 42px;
      display: grid;
      place-items: center;
      border: 0 !important;
      background: transparent !important;
      color: var(--app-muted) !important;
      font-size: 28px !important;
      transition: color 140ms ease, transform 140ms ease;
    }
    .close-settings:hover { color: var(--app-accent) !important; transform: rotate(4deg); }

    .settings-grid-v40 {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      grid-template-areas:
        "profile profile"
        "controls audio"
        "theme theme";
      gap: 34px 52px !important;
    }

    .settings-profile-section { grid-area: profile; }
    .settings-grid-v40 > .settings-section:nth-child(2) { grid-area: controls; }
    .settings-audio-section { grid-area: audio; }
    .settings-theme-section { grid-area: theme; }

    .settings-section,
    .settings-section + .settings-section {
      margin: 0 !important;
      padding: 0 !important;
      border-top: 0 !important;
    }

    .settings-section h3 {
      margin: 0 0 12px !important;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--game-line);
      font-size: 20px !important;
      letter-spacing: .025em !important;
    }

    .settings-help {
      max-width: 620px;
      margin-bottom: 14px !important;
      line-height: 1.5 !important;
    }

    .nickname-field { min-height: 48px !important; font-size: 17px !important; }

    .control-choice-row { display: flex !important; gap: 18px !important; }
    .control-choice,
    .toggle-button {
      border: 0 !important;
      border-bottom: 2px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-muted) !important;
      padding: 10px 2px !important;
      font: 900 13px/1 var(--hud-display) !important;
      text-transform: uppercase !important;
    }
    .control-choice.selected,
    .toggle-button.on {
      border-bottom-color: var(--app-accent) !important;
      color: var(--app-accent) !important;
    }

    .settings-inline-toggle,
    .audio-control-group,
    .toggle-row {
      gap: 24px !important;
    }

    .volume-row {
      display: grid !important;
      grid-template-columns: 88px minmax(140px, 1fr) 52px !important;
      align-items: center !important;
      gap: 12px !important;
    }

    .volume-row input[type="range"] { width: 100% !important; }

    .theme-grid {
      display: grid !important;
      grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
      gap: 16px !important;
    }

    .theme-choice {
      min-height: 92px;
      padding: 12px 4px 8px !important;
      border: 0 !important;
      border-bottom: 3px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      transition: transform 140ms ease, border-color 140ms ease, color 140ms ease !important;
    }
    .theme-choice:hover:not(:disabled) { transform: translateY(-2px); color: var(--app-accent) !important; }
    .theme-choice.selected { border-bottom-color: var(--app-accent) !important; box-shadow: none !important; }
    .theme-swatches { margin-top: 12px !important; clip-path: none !important; border-radius: 0 !important; }

    .settings-footer {
      position: sticky;
      bottom: -30px;
      z-index: 3;
      display: flex;
      justify-content: flex-end;
      margin: 30px -34px -30px !important;
      padding: 18px 34px 24px !important;
      border-top: 1px solid var(--game-line);
      background: color-mix(in srgb, var(--game-panel-strong) 96%, transparent);
      backdrop-filter: blur(12px);
    }

    #settings-done {
      width: auto !important;
      min-width: 150px;
    }

    /* -------------------------------------------------------
       SOLO MENU: one-player arena entrance, not a dashboard
       ------------------------------------------------------- */
    .screen-solo-menu #screen-content {
      width: min(760px, 100%);
      margin: 0 auto;
    }

    .solo-launch-screen {
      position: relative;
      margin-top: 42px !important;
      padding: 0 !important;
      text-align: center;
    }

    .solo-launch-rule {
      display: flex !important;
      justify-content: center;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 34px !important;
      padding: 0 !important;
      border: 0 !important;
      color: var(--app-muted);
    }
    .solo-launch-rule span { color: var(--app-accent) !important; }

    .solo-launch-stats {
      display: grid !important;
      grid-template-columns: 1fr auto 1fr !important;
      gap: 0 !important;
      width: min(620px, 100%) !important;
      margin: 0 auto 34px !important;
      border-top: 1px solid var(--game-line);
      border-bottom: 1px solid var(--game-line);
    }
    .solo-launch-stats::before {
      content: "";
      grid-column: 2;
      grid-row: 1;
      width: 1px;
      min-height: 140px;
      background: var(--game-line);
    }
    .solo-launch-stat {
      min-height: 140px !important;
      display: flex !important;
      flex-direction: column !important;
      justify-content: center !important;
      gap: 10px !important;
      padding: 16px 34px !important;
      background: transparent !important;
      border: 0 !important;
    }
    .solo-launch-stat:first-child { grid-column: 1 !important; grid-row: 1; }
    .solo-launch-stat:last-child { grid-column: 3 !important; grid-row: 1; }
    .solo-launch-stat strong { font-size: clamp(52px, 6vw, 72px) !important; }

    .solo-launch-actions { width: min(430px, 100%) !important; }
    .solo-main-action,
    .mode-stage-action {
      position: relative;
      width: auto !important;
      min-width: 0 !important;
      min-height: 0 !important;
      padding: 11px 3px !important;
      border: 0 !important;
      border-bottom: 3px solid var(--app-accent) !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
      font-size: 19px !important;
      letter-spacing: .025em !important;
      transition: color 150ms ease, transform 150ms ease !important;
    }
    .solo-main-action::after,
    .mode-stage-action::after { content: "  →"; color: var(--app-accent); }
    .solo-main-action:hover,
    .mode-stage-action:hover { color: var(--app-accent) !important; transform: translateX(4px); }

    /* -------------------------------------------------------
       MULTIPLAYER MODE SELECT: bigger type, less website chrome
       ------------------------------------------------------- */
    .screen-multiplayer-menu #screen-content {
      width: min(1000px, 100%);
      margin: 0 auto;
    }

    .multiplayer-entry-head {
      margin: 28px 0 10px !important;
      padding: 0 2px 16px;
      border-bottom: 1px solid var(--game-line);
    }

    .mode-selector-shell {
      grid-template-columns: minmax(290px, .82fr) minmax(0, 1.18fr) !important;
      gap: 64px !important;
      margin-top: 0 !important;
      padding: 26px 0 20px !important;
      border: 0 !important;
    }

    .mode-rail-item {
      min-height: 78px !important;
      grid-template-columns: 44px 1fr !important;
      border: 0 !important;
      border-bottom: 1px solid var(--game-line) !important;
      padding: 10px 0 !important;
      background: transparent !important;
    }
    .mode-rail-item:first-child { border-top: 0 !important; }
    .mode-rail-item:hover:not(:disabled),
    .mode-rail-item.selected {
      padding-left: 10px !important;
      background: transparent !important;
      box-shadow: inset 3px 0 0 var(--app-accent) !important;
    }
    .mode-index { font-size: 22px !important; }
    .mode-rail-item strong { font-size: 22px !important; }
    .mode-rail-item small { font-size: 12px !important; }

    .mode-stage {
      min-height: 460px !important;
      padding: 44px 0 42px 58px !important;
      border-left: 1px solid var(--game-line) !important;
    }
    .mode-stage h2 { font-size: clamp(52px, 6vw, 78px) !important; }
    .mode-stage > p { font-size: 18px !important; max-width: 510px !important; }
    .mode-stage-facts { border-top: 0 !important; padding-top: 0 !important; }

    /* -------------------------------------------------------
       ACTIVE SOLO: same HUD grammar as multiplayer
       ------------------------------------------------------- */
    body.solo-active #solo-toolbar {
      width: min(980px, calc(100% - 44px)) !important;
      margin: 24px auto 12px !important;
    }

    body.solo-active .container {
      width: min(610px, calc(100% - 32px)) !important;
      margin: 18px auto 48px !important;
      padding: 18px 16px 18px !important;
      border: 0 !important;
      border-top: 3px solid var(--app-accent) !important;
      border-left: 2px solid color-mix(in srgb, var(--app-accent) 72%, transparent) !important;
      background: transparent !important;
    }

    body.solo-active .container .heading {
      min-height: 104px !important;
      gap: 28px !important;
      padding: 0 0 16px !important;
      margin-bottom: 12px !important;
    }

    body.solo-active .container .title {
      font-size: 42px !important;
      letter-spacing: -.035em !important;
    }

    body.solo-active .scores-container {
      gap: 0 !important;
      border-left: 1px solid var(--game-line);
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      width: 132px !important;
      min-width: 132px !important;
      min-height: 82px !important;
      padding: 32px 16px 8px !important;
      border: 0 !important;
      border-right: 1px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--app-text) !important;
      font-size: 34px !important;
      box-shadow: none !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top: 9px !important;
      color: var(--app-muted) !important;
    }

    .solo-card-actions {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin: 0 0 14px !important;
      padding: 0 2px !important;
      border: 0 !important;
    }

    .solo-card-actions .small-button,
    .freeplay-controls .small-button {
      border: 0 !important;
      border-bottom: 2px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
      padding: 8px 2px !important;
    }
    .solo-card-actions .small-button:hover:not(:disabled),
    .freeplay-controls .small-button:hover:not(:disabled) {
      border-bottom-color: var(--app-accent) !important;
      color: var(--app-accent) !important;
    }

    #solo-control-strip {
      margin-top: 14px !important;
      padding: 12px 0 0 !important;
      border-top: 1px solid var(--game-line) !important;
      background: transparent !important;
    }

    /* -------------------------------------------------------
       ACTIVE MULTIPLAYER: same clean stat language
       ------------------------------------------------------- */
    .battle-shell {
      max-width: 1160px !important;
      padding: 0 24px 48px !important;
    }

    .battle-room-mini {
      border: 0 !important;
      background: transparent !important;
      padding: 0 !important;
      color: var(--app-muted) !important;
    }

    .battle-player-card {
      background: transparent !important;
      box-shadow: none !important;
    }

    .highest-box {
      min-width: 104px !important;
      padding: 8px 0 8px 20px !important;
      border: 0 !important;
      border-left: 1px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: var(--app-text) !important;
      text-align: right !important;
    }
    .highest-box span { color: var(--app-muted) !important; }
    .highest-box strong { color: var(--app-text) !important; font-size: 34px !important; }

    .own-panel,
    .opponent-panel {
      border-top-width: 3px !important;
      border-bottom: 0 !important;
      box-shadow: none !important;
    }

    .player-card-header {
      border-bottom: 1px solid var(--game-line) !important;
      padding-bottom: 16px !important;
    }

    .progress-track { border-radius: 0 !important; }
    .progress-fill { border-radius: 0 !important; }

    /* -------------------------------------------------------
       DESKTOP SCALE + RESPONSIVE FALLBACK
       ------------------------------------------------------- */
    @media (min-width: 1100px) {
      .app-screen-inner { width: min(1080px, calc(100% - 72px)) !important; }
      .screen-solo-menu .app-screen-inner { width: min(960px, calc(100% - 72px)) !important; }
      .screen-multiplayer-menu .app-screen-inner { width: min(1100px, calc(100% - 72px)) !important; }
    }

    @media (max-width: 820px) {
      .settings-overlay { padding: 18px 10px 36px !important; }
      .settings-dialog.settings-dialog-v40 { width: 100% !important; padding: 0 18px 24px !important; }
      .settings-dialog-header { margin-left: -18px !important; margin-right: -18px !important; padding-left: 18px !important; padding-right: 18px !important; }
      .settings-grid-v40 { grid-template-columns: 1fr !important; grid-template-areas: "profile" "controls" "audio" "theme" !important; }
      .theme-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      .settings-footer { margin-left: -18px !important; margin-right: -18px !important; padding-left: 18px !important; padding-right: 18px !important; }

      .mode-selector-shell { grid-template-columns: 1fr !important; gap: 18px !important; }
      .mode-stage { min-height: 320px !important; padding: 28px 0 !important; border-left: 0 !important; border-top: 1px solid var(--game-line) !important; }
      .mode-stage h2 { font-size: 46px !important; }

      .app-header-side,
      .solo-floating-header > div:first-child,
      .solo-floating-right,
      .battle-topbar > .danger-button,
      .battle-topbar-right { min-width: 0; }
    }

    @media (max-width: 600px) {
      .app-header { grid-template-columns: auto 1fr auto !important; gap: 10px !important; }
      .app-title-stack h1 { font-size: 24px !important; }
      .nav-button, .settings-button { font-size: 11px !important; }

      .solo-launch-stats { grid-template-columns: 1fr 1px 1fr !important; }
      .solo-launch-stat { padding: 12px 8px !important; }
      .solo-launch-stat strong { font-size: 42px !important; }

      body.solo-active .container .heading { flex-direction: column !important; align-items: stretch !important; }
      body.solo-active .scores-container { border-left: 0 !important; border-top: 1px solid var(--game-line); }
      body.solo-active .score-container,
      body.solo-active .best-container { flex: 1 !important; width: auto !important; min-width: 0 !important; }
    }
  `;
  document.head.appendChild(v42Style);



  // =========================================================
  // v43: sophisticated playful puzzle-game UI
  // =========================================================
  var v43Style = document.createElement("style");
  v43Style.textContent = `
    /* Larger, friendlier base type without turning toy-like. */
    body, button, input, output { font-size: 16px; }
    .app-screen-inner { width: min(1120px, calc(100% - 56px)) !important; }
    .app-title-stack h1 { font-size: 34px !important; letter-spacing: -.025em !important; }
    .app-title-brand { font-size: 11px !important; }
    .app-header { min-height: 86px !important; }
    .nav-button, .settings-button { font-size: 14px !important; padding: 12px 2px !important; }

    /* Motion stays tile-inspired rather than decorative shine. */
    .progress-fill { animation: none !important; background-size: 100% 100% !important; }
    .app-header::after, .solo-floating-header::after, .battle-topbar::after { animation: none !important; }
    @keyframes tile-breathe-v43 {
      0%, 100% { transform: translate3d(0,0,0) rotate(-2deg); }
      50% { transform: translate3d(0,-5px,0) rotate(1deg); }
    }
    @keyframes preview-enter-v43 {
      from { opacity: 0; transform: translateY(12px) scale(.985); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* -----------------------------------------------------
       SETTINGS: all core settings visible on desktop
       ----------------------------------------------------- */
    .settings-overlay {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: auto !important;
      padding: 14px !important;
    }
    .settings-dialog.settings-dialog-v40 {
      width: min(1040px, calc(100% - 20px)) !important;
      max-width: 1040px !important;
      max-height: calc(100vh - 28px) !important;
      overflow-y: auto !important;
      margin: auto !important;
      padding: 0 30px 20px !important;
      border-top-width: 3px !important;
    }
    .settings-dialog-header {
      position: static !important;
      margin: 0 -30px 16px !important;
      padding: 18px 30px 14px !important;
      backdrop-filter: none !important;
    }
    .settings-dialog-header h2 { font-size: 31px !important; }
    .settings-kicker { font-size: 10px !important; }
    .settings-grid-v40 {
      grid-template-columns: 1fr 1fr !important;
      grid-template-areas: "profile profile" "controls audio" "theme theme" !important;
      gap: 18px 42px !important;
    }
    .settings-section h3 {
      margin-bottom: 8px !important;
      padding-bottom: 6px !important;
      font-size: 21px !important;
    }
    .settings-help {
      margin: 0 0 9px !important;
      font-size: 14px !important;
      line-height: 1.35 !important;
    }
    .field-label { font-size: 11px !important; margin-bottom: 5px !important; }
    .nickname-field { min-height: 42px !important; padding: 8px 12px !important; }
    .control-choice-row { gap: 14px !important; }
    .control-choice, .toggle-button { padding: 8px 2px !important; font-size: 13px !important; }
    .settings-inline-toggle { margin-top: 12px !important; padding-top: 10px !important; }
    .settings-inline-toggle h4, .audio-control-group h4 { font-size: 16px !important; margin: 0 0 3px !important; }
    .volume-row { margin-top: 8px !important; }
    .theme-grid {
      grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
      gap: 12px !important;
    }
    .theme-choice {
      min-height: 68px !important;
      padding: 8px 4px 5px !important;
      font-size: 13px !important;
    }
    .theme-swatches { height: 19px !important; margin-top: 7px !important; }
    .settings-footer {
      position: static !important;
      margin: 16px -30px -20px !important;
      padding: 12px 30px 15px !important;
      backdrop-filter: none !important;
    }
    #settings-done { min-width: 128px !important; padding: 11px 24px !important; }

    /* -----------------------------------------------------
       SOLO ENTRY: game preview + records, not a dashboard
       ----------------------------------------------------- */
    .screen-solo-menu #screen-content { width: min(980px, 100%) !important; }
    .solo-launch-v43 {
      display: grid !important;
      grid-template-columns: minmax(0, 1fr) 400px !important;
      align-items: center !important;
      gap: 72px !important;
      margin-top: 42px !important;
      text-align: left !important;
    }
    .solo-launch-copy { min-width: 0; }
    .solo-launch-kicker {
      color: var(--app-accent);
      font: 900 13px/1 var(--hud-display);
      letter-spacing: .12em;
    }
    .solo-launch-copy h2 {
      margin: 10px 0 10px;
      font: 900 clamp(42px, 5vw, 66px)/.98 var(--hud-display);
      letter-spacing: -.035em;
      color: var(--app-text);
    }
    .solo-launch-copy > p {
      max-width: 520px;
      margin: 0 0 28px;
      color: var(--app-muted);
      font-size: 18px;
      line-height: 1.5;
    }
    .solo-launch-v43 .solo-launch-stats {
      width: 100% !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 28px !important;
      margin: 0 0 26px !important;
      border: 0 !important;
    }
    .solo-launch-v43 .solo-launch-stat {
      grid-column: auto !important;
      padding: 0 !important;
      text-align: left !important;
      border: 0 !important;
    }
    .solo-launch-v43 .solo-launch-stat span { font-size: 12px !important; }
    .solo-launch-v43 .solo-launch-stat strong {
      display: block;
      margin-top: 3px;
      font: 900 48px/1 var(--tile-font) !important;
      color: var(--app-text);
    }
    .solo-launch-actions { width: 100% !important; align-items: flex-start !important; }
    .solo-main-action {
      display: inline-flex !important;
      align-items: center;
      gap: 18px;
      border: 0 !important;
      border-bottom: 3px solid var(--app-accent) !important;
      color: var(--app-text) !important;
      background: transparent !important;
      padding: 10px 0 !important;
      font: 900 20px/1 var(--hud-display) !important;
    }
    .solo-main-action::after { content: none !important; }
    .solo-main-action span { color: var(--app-accent); transition: transform 160ms ease; }
    .solo-main-action:hover span { transform: translateX(6px); }
    .solo-text-action { margin-top: 10px !important; font-size: 14px !important; }

    .solo-preview-stage {
      position: relative;
      width: 400px;
      min-height: 470px;
      padding: 22px;
      border-radius: 28px;
      background: color-mix(in srgb, var(--game-panel-strong) 82%, transparent);
      box-shadow: 0 18px 50px var(--app-shadow);
      overflow: hidden;
      animation: preview-enter-v43 300ms ease both;
    }
    .solo-preview-stage::before {
      content: "";
      position: absolute;
      inset: 0;
      border: 1px solid color-mix(in srgb, var(--app-accent) 28%, var(--game-line));
      border-radius: inherit;
      pointer-events: none;
    }
    .preview-orbit {
      position: absolute;
      border-radius: 50%;
      border: 1px solid color-mix(in srgb, var(--app-accent) 22%, transparent);
      pointer-events: none;
    }
    .orbit-one { width: 240px; height: 240px; right: -120px; top: -110px; }
    .orbit-two { width: 180px; height: 180px; left: -100px; bottom: -90px; }
    .solo-preview-heading {
      position: relative;
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      margin-bottom: 14px;
    }
    .solo-preview-heading span { font: 900 12px/1 var(--hud-display); letter-spacing: .1em; color: var(--app-muted); }
    .solo-preview-heading strong { font: 900 26px/1 var(--tile-font); color: var(--app-accent); }
    .solo-preview-caption {
      position: relative;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      margin-top: 13px;
      color: var(--app-muted);
      font: 800 11px/1 var(--hud-display);
      letter-spacing: .08em;
    }

    .ui-mini-board {
      position: relative;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      width: 100%;
      aspect-ratio: 1;
      padding: 10px;
      border-radius: 17px;
      background: var(--app-board);
    }
    .ui-mini-cell {
      display: grid;
      place-items: center;
      border-radius: 8px;
      background: var(--app-cell);
      color: var(--app-text);
      font: 900 18px/1 var(--tile-font);
    }
    .ui-mini-cell.filled { background: color-mix(in srgb, var(--app-accent) 15%, var(--game-panel-strong)); }
    .ui-mini-cell.pv-4, .ui-mini-cell.pv-16, .ui-mini-cell.pv-64 { background: color-mix(in srgb, var(--game-accent-2) 38%, var(--game-panel-strong)); }
    .ui-mini-cell.pv-8, .ui-mini-cell.pv-32, .ui-mini-cell.pv-128 { background: color-mix(in srgb, var(--app-accent) 42%, var(--game-panel-strong)); color: var(--app-on-accent); }
    .ui-mini-cell.pv-256, .ui-mini-cell.pv-512, .ui-mini-cell.pv-1024, .ui-mini-cell.pv-2048 { background: var(--game-accent-3); color: var(--game-deep); }

    /* -----------------------------------------------------
       MULTIPLAYER ENTRY: all modes understood at a glance
       ----------------------------------------------------- */
    .screen-multiplayer-menu #screen-content { width: min(1050px, 100%) !important; }
    .multiplayer-entry-head {
      display: flex !important;
      justify-content: flex-end !important;
      gap: 10px !important;
      margin: 20px 0 18px !important;
      padding: 0 0 12px !important;
      font-size: 13px !important;
    }
    .mode-showcase-list { display: grid; gap: 16px; }
    .mode-showcase {
      --mode-hue: var(--app-accent);
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 310px;
      align-items: center;
      gap: 36px;
      width: 100%;
      min-height: 176px;
      padding: 24px 26px 24px 30px;
      border: 0;
      border-radius: 22px;
      background:
        linear-gradient(100deg, color-mix(in srgb, var(--mode-hue) 10%, var(--game-panel-strong)), color-mix(in srgb, var(--game-panel-strong) 94%, transparent) 64%);
      color: var(--app-text);
      text-align: left;
      overflow: hidden;
      cursor: pointer;
      box-shadow: inset 4px 0 0 var(--mode-hue);
      transition: transform 180ms ease, box-shadow 180ms ease, background 180ms ease;
    }
    .mode-showcase::after {
      content: "";
      position: absolute;
      width: 160px;
      height: 160px;
      right: 72px;
      top: 8px;
      border: 1px solid color-mix(in srgb, var(--mode-hue) 22%, transparent);
      border-radius: 50%;
      pointer-events: none;
    }
    .mode-showcase-freeplay { --mode-hue: var(--game-accent-2); }
    .mode-showcase-custom { --mode-hue: var(--game-accent-3); }
    @media (hover:hover) and (pointer:fine) {
      .mode-showcase:hover {
        transform: translateX(7px);
        box-shadow: inset 5px 0 0 var(--mode-hue), 0 14px 36px var(--app-shadow);
      }
      .mode-showcase:hover .mode-showcase-action { letter-spacing: .02em; }
      .mode-showcase:hover .ui-mini-board { transform: rotate(.8deg) scale(1.015); }
    }
    .mode-showcase:active { transform: translateX(3px) scale(.995); }
    .mode-showcase-copy { position: relative; z-index: 1; }
    .mode-showcase-index { color: var(--mode-hue); font: 900 12px/1 var(--hud-display); letter-spacing: .11em; }
    .mode-showcase h2 {
      margin: 6px 0 5px;
      font: 900 34px/1 var(--hud-display);
      letter-spacing: -.025em;
      color: var(--app-text);
    }
    .mode-showcase p { margin: 0; max-width: 590px; color: var(--app-muted); font-size: 16px; line-height: 1.4; }
    .mode-showcase-facts { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 12px; }
    .mode-showcase-facts span { font: 800 12px/1 var(--hud-display); color: var(--app-muted); }
    .mode-showcase-facts span::before { content: "·"; margin-right: 6px; color: var(--mode-hue); }
    .mode-showcase-action {
      display: inline-block;
      margin-top: 16px;
      color: var(--app-text);
      font: 900 15px/1 var(--hud-display);
      transition: color 150ms ease, letter-spacing 150ms ease;
    }
    .mode-showcase:hover .mode-showcase-action { color: var(--mode-hue); }
    .mode-showcase-preview { position: relative; z-index: 1; min-width: 0; }

    .mode-visual-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: end; }
    .mode-visual-player { min-width: 0; }
    .mode-visual-player b { display: block; margin-bottom: 5px; color: var(--app-muted); font: 800 9px/1 var(--hud-display); letter-spacing: .08em; }
    .mode-visual-player > span { display: block; margin-top: 5px; font: 900 17px/1 var(--tile-font); color: var(--mode-hue); }
    .mode-showcase .ui-mini-board { gap: 3px; padding: 5px; border-radius: 9px; transition: transform 180ms ease; }
    .mode-showcase .ui-mini-cell { border-radius: 4px; font-size: 8px; }
    .mode-freeplay-visual { display: grid; grid-template-columns: 140px 1fr; align-items: center; gap: 20px; }
    .undo-loop { display: flex; align-items: center; justify-content: center; gap: 8px; color: var(--app-muted); font: 800 10px/1 var(--hud-display); }
    .undo-loop i { color: var(--mode-hue); font-size: 27px; font-style: normal; }
    .mode-custom-visual { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .custom-target {
      display: flex;
      min-height: 108px;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      border-radius: 18px;
      background: color-mix(in srgb, var(--mode-hue) 12%, var(--game-panel-strong));
    }
    .custom-target small, .custom-target span { color: var(--app-muted); font: 800 9px/1 var(--hud-display); letter-spacing: .07em; }
    .custom-target strong { margin: 5px 0; font: 900 26px/1 var(--tile-font); color: var(--mode-hue); }
    .custom-target.harder { transform: translateY(7px); }
    .future-modes-strip {
      display: flex;
      gap: 28px;
      justify-content: center;
      padding: 20px 0 0;
      color: var(--app-muted);
      font-size: 13px;
    }
    .future-modes-strip b { margin-right: 5px; color: var(--app-text); }

    /* -----------------------------------------------------
       ACTIVE SOLO: fix stat collisions and keep board dominant
       ----------------------------------------------------- */
    body.solo-active #solo-toolbar { width: min(980px, calc(100% - 48px)) !important; }
    .solo-floating-header { min-height: 82px !important; }
    .solo-floating-center strong { font-size: 27px !important; }
    body.solo-active .container {
      width: min(570px, calc(100% - 32px)) !important;
      margin-top: 18px !important;
      padding: 14px 14px 18px !important;
      border-left: 0 !important;
      border-top: 3px solid var(--app-accent) !important;
    }
    body.solo-active .container .heading {
      min-height: 96px !important;
      display: grid !important;
      grid-template-columns: 1fr auto !important;
      align-items: center !important;
      gap: 24px !important;
      padding: 4px 0 16px !important;
    }
    body.solo-active .container .title { font-size: 38px !important; }
    body.solo-active .scores-container { display: flex !important; border: 0 !important; gap: 10px !important; }
    body.solo-active .score-container,
    body.solo-active .best-container {
      position: relative !important;
      display: flex !important;
      align-items: flex-end !important;
      justify-content: center !important;
      width: 118px !important;
      min-width: 118px !important;
      min-height: 82px !important;
      padding: 31px 12px 12px !important;
      border: 1px solid color-mix(in srgb, var(--game-line) 78%, transparent) !important;
      border-radius: 13px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 82%, transparent) !important;
      color: var(--app-text) !important;
      font: 900 30px/1 var(--tile-font) !important;
    }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position: absolute !important;
      top: 10px !important;
      left: 0 !important;
      right: 0 !important;
      width: auto !important;
      color: var(--app-muted) !important;
      font: 800 10px/1 var(--hud-display) !important;
      letter-spacing: .1em !important;
    }
    .solo-card-actions { margin: 0 0 14px !important; padding: 0 2px 10px !important; border-bottom: 1px solid var(--game-line) !important; }
    .solo-card-actions .small-button { font-size: 13px !important; }
    #solo-control-strip { font-size: 12px !important; }

    /* -----------------------------------------------------
       ACTIVE MATCH: slightly larger readable text
       ----------------------------------------------------- */
    .battle-shell { max-width: 1180px !important; }
    .battle-mode-title strong { font-size: 28px !important; }
    .battle-rule-line { font-size: 15px !important; }
    .player-card-header h2 { font-size: 31px !important; }
    .player-subline { font-size: 13px !important; }
    .highest-box span { font-size: 10px !important; }
    .progress-meta { font-size: 12px !important; }

    @media (max-width: 900px) {
      .solo-launch-v43 { grid-template-columns: 1fr !important; gap: 32px !important; }
      .solo-preview-stage { width: min(400px, 100%); margin: 0 auto; }
      .mode-showcase { grid-template-columns: 1fr 250px; gap: 24px; }
    }
    @media (max-width: 720px) {
      .settings-overlay { align-items: flex-start !important; padding: 10px !important; }
      .settings-dialog.settings-dialog-v40 { width: 100% !important; max-height: none !important; }
      .settings-grid-v40 { grid-template-columns: 1fr !important; grid-template-areas: "profile" "controls" "audio" "theme" !important; }
      .theme-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
      .mode-showcase { grid-template-columns: 1fr !important; }
      .mode-showcase-preview { max-width: 300px; }
      .future-modes-strip { flex-direction: column; gap: 7px; align-items: center; }
      body.solo-active .container .heading { grid-template-columns: 1fr !important; }
    }
  `;
  document.head.appendChild(v43Style);

  restoreGameContainer();
  showMainMenu();
})();

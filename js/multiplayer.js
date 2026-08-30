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
  var THEMES = ["classic", "pastel", "ocean", "candy", "midnight"];
  var TARGETS = [2048, 4096, 8192];

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
  var battleShell = null;
  var opponentGrid = null;
  var opponentHighest = null;
  var opponentStatus = null;
  var ownRescueStatus = null;
  var ownHighestDisplay = null;
  var ownNicknameDisplay = null;
  var opponentNicknameDisplay = null;
  var ownRankBadge = null;
  var opponentRankBadge = null;
  var latestOpponentState = null;
  var opponentRescueSeen = false;
  var lastOwnHighest = 0;
  var lastLeaderNumber = null;
  var audioContext = null;

  if (TARGETS.indexOf(selectedTarget) === -1) {
    selectedTarget = 2048;
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
      nickname: ""
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

      if (typeof saved.nickname === "string") {
        defaults.nickname = sanitizeNickname(saved.nickname);
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
    } else if (name === "rescue") {
      playTone(ctx, 260, 0.11, 0.026, "sine", 0, 430);
      playTone(ctx, 520, 0.12, 0.02, "sine", 0.07, 720);
    } else if (name === "lead") {
      playTone(ctx, 520, 0.08, 0.02, "sine", 0, 650);
      playTone(ctx, 700, 0.10, 0.022, "sine", 0.06, 840);
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

    .rescue-status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      color: var(--app-muted, #8f7a66);
      font-size: 11px;
      font-weight: 900;
      letter-spacing: .45px;
      margin-top: 7px;
    }

    .rescue-status.used {
      color: var(--app-text, #776e65);
      opacity: .72;
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

  // =========================================================
  // COMMON UI
  // =========================================================

  function clearModeClasses() {
    document.body.classList.remove("solo-active");
  }

  function showScreen(title, backHandler, contentHtml) {
    clearModeClasses();
    gameHost.style.display = "none";
    gameContainer.style.display = "none";
    soloToolbar.style.display = "none";

    currentScreen = title;

    appRoot.innerHTML = `
      <div class="app-screen">
        <div class="app-screen-inner">
          <div class="app-header">
            <div class="app-header-side left">
              ${backHandler ? '<button class="nav-button" id="screen-back">← Back</button>' : ""}
            </div>
            <h1>${escapeHtml(title)}</h1>
            <div class="app-header-side right">
              <button class="settings-button" id="screen-settings">⚙️ Settings</button>
            </div>
          </div>
          <div id="screen-content">${contentHtml}</div>
        </div>
      </div>
    `;

    var settingsButton = document.getElementById("screen-settings");
    settingsButton.addEventListener("click", openSettings);

    if (backHandler) {
      document.getElementById("screen-back").addEventListener("click", backHandler);
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

    document.getElementById("nickname-prompt-save").addEventListener(
      "click",
      saveNicknameAndContinue
    );

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

  function showMainMenu() {
    window.currentGameMode = "menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    showScreen(
      "Rina's 2048",
      null,
      `
        <p class="hero-subtitle">Choose how you want to play.</p>

        <div class="mode-grid">
          <button class="mode-card" id="choose-solo">
            <span class="mode-icon">🎮</span>
            <h2>Solo 2048</h2>
            <p>Endless solo play with optional Undo. Reach 2048, then keep climbing to 4096, 8192, and beyond. Your game and records are saved.</p>
          </button>

          <button class="mode-card" id="choose-multiplayer">
            <span class="mode-icon">👥</span>
            <h2>Multiplayer</h2>
            <p>Race a friend now, with more multiplayer modes ready to grow later.</p>
          </button>
        </div>
      `
    );

    document.getElementById("choose-solo").addEventListener("click", showSoloMenu);
    document.getElementById("choose-multiplayer").addEventListener("click", function () {
      ensureNickname(showMultiplayerMenu);
    });
  }

  function showSoloMenu() {
    window.currentGameMode = "solo-menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    withGame(function (game) {
      var hasSave = game.storageManager.hasGameState();
      var best = game.storageManager.getBestScore();
      var highest = game.storageManager.getHighestTileEver();
      var undoLabel = window.rinasSettings.soloUndo ? "On" : "Off";
      var undoHelp = window.rinasSettings.soloUndo
        ? "Use the Undo button or press Z to reverse one move."
        : "Turn it on in Settings if you want Undo available.";

      showScreen(
        "Solo 2048",
        showMainMenu,
        `
          <div class="info-card">
            Your current Solo game is saved automatically, so you can close the browser or computer and continue later.
            <br><br>
            <strong>Endless play:</strong> 2048 is a milestone, not the finish. Continue to 4096, 8192, 16384, and beyond.
            <br><br>
            <strong>Undo:</strong> ${undoLabel}. ${undoHelp}
          </div>

          <div class="solo-stats">
            <div class="stat-card">
              <span>Best Score</span>
              <strong>${best}</strong>
            </div>
            <div class="stat-card">
              <span>Highest Tile Ever</span>
              <strong>${highest || 0}</strong>
            </div>
          </div>

          <div class="button-stack">
            ${hasSave ? '<button class="primary-button" id="continue-solo">Continue Game</button>' : '<button class="primary-button" id="start-solo">Start Game</button>'}
            ${hasSave ? '<button class="secondary-button" id="new-solo">New Game</button>' : ""}
          </div>
        `
      );

      var continueButton = document.getElementById("continue-solo");
      var startButton = document.getElementById("start-solo");
      var newButton = document.getElementById("new-solo");

      if (continueButton) {
        continueButton.addEventListener("click", function () {
          startSolo(false);
        });
      }

      if (startButton) {
        startButton.addEventListener("click", function () {
          startSolo(true);
        });
      }

      if (newButton) {
        newButton.addEventListener("click", function () {
          if (window.confirm("Start a new Solo game? Your current saved board will be replaced.")) {
            startSolo(true);
          }
        });
      }
    });
  }

  function startSolo(startNew) {
    window.currentGameMode = "solo";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerPlayerNumber = null;

    appRoot.innerHTML = "";
    clearModeClasses();
    document.body.classList.add("solo-active");
    gameHost.style.display = "block";
    gameContainer.style.display = "block";

    renderSoloToolbar();

    withGame(function (game) {
      game.actuator.continueGame();

      if (startNew) {
        game.restart();
      } else {
        game.setup();
      }

      window.refreshSoloControls();

      // If the browser was closed while the 2048 celebration was
      // waiting for a choice, show it again when the saved Solo
      // run is resumed. Once Continue is chosen, keepPlaying is
      // saved and this will not repeat.
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

  function renderSoloToolbar() {
    soloToolbar.innerHTML = `
      <button class="nav-button" id="solo-back">← Back</button>
      <div class="solo-toolbar-actions">
        <button class="small-button" id="solo-undo" data-no-ui-sound="true" title="Undo last move (Z)">↶ Undo</button>
        <button class="small-button" id="solo-new">New Game</button>
        <button class="settings-button" id="solo-settings">⚙️ Settings</button>
      </div>
      <div class="solo-control-hint" id="solo-control-hint"></div>
    `;

    soloToolbar.style.display = "flex";

    document.getElementById("solo-back").addEventListener("click", showSoloMenu);

    document.getElementById("solo-new").addEventListener("click", function () {
      if (window.confirm("Start a new Solo game?")) {
        withGame(function (game) {
          game.restart();
        });
      }
    });

    document.getElementById("solo-settings").addEventListener("click", openSettings);

    document.getElementById("solo-undo").addEventListener("click", function () {
      withGame(function (game) {
        game.undo();
      });
    });

    window.refreshSoloControls();
  }

  window.refreshSoloControls = function () {
    var undoButton = document.getElementById("solo-undo");
    var controlHint = document.getElementById("solo-control-hint");

    if (!undoButton) {
      return;
    }

    if (!window.rinasSettings.soloUndo) {
      undoButton.style.display = "none";

      if (controlHint) {
        controlHint.innerHTML =
          "Arrow keys / swipe to move";
      }

      return;
    }

    undoButton.style.display = "inline-block";

    if (controlHint) {
      controlHint.innerHTML =
        'Arrow keys / swipe to move &nbsp;·&nbsp; <kbd>Z</kbd> to undo';
    }

    if (!window.multiplayerGame) {
      undoButton.disabled = true;
      return;
    }

    undoButton.disabled =
      !!window.multiplayerGame.undoAnimating ||
      window.multiplayerGame.storageManager.getUndoStack().length === 0;
  };

  /*
   * Solo Undo keyboard shortcut.
   *
   * Z only performs Undo when Solo Undo is enabled.
   * There is deliberately NO keyboard shortcut for switching
   * the Undo setting itself on or off.
   */
  document.addEventListener("keydown", function (event) {
    var key = String(event.key || "").toLowerCase();

    if (key !== "z") {
      return;
    }

    if (
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey ||
      event.repeat
    ) {
      return;
    }

    if (
      window.currentGameMode !== "solo" ||
      !window.rinasSettings.soloUndo
    ) {
      return;
    }

    var target = event.target;

    if (
      target &&
      (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )
    ) {
      return;
    }

    if (
      document.getElementById("settings-overlay") ||
      document.getElementById("solo-2048-overlay")
    ) {
      return;
    }

    event.preventDefault();

    withGame(function (game) {
      game.undo();
    });
  });

  // =========================================================
  // SOLO MILESTONES
  // =========================================================

  window.showSolo2048Milestone = function () {
    if (window.multiplayerMode || window.currentGameMode !== "solo") {
      return;
    }

    var old = document.getElementById("solo-2048-overlay");
    if (old) {
      old.remove();
    }

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

        // Rare edge case: the move that created 2048 can also
        // leave the board with no legal moves. In that case,
        // Continue should correctly reveal Solo Game Over rather
        // than leaving the player on an immovable board.
        if (!game.movesAvailable()) {
          game.over = true;
        }

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
    if (window.multiplayerMode || window.currentGameMode !== "solo") {
      return;
    }

    var existing = document.getElementById("solo-milestone-toast");
    if (existing) {
      existing.remove();
    }

    var toast = document.createElement("div");
    toast.id = "solo-milestone-toast";
    toast.textContent = "✨ " + tileValue + " reached! Keep going.";
    document.body.appendChild(toast);
    playSound("milestone");

    setTimeout(function () {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 2600);
  };

  // =========================================================
  // MULTIPLAYER MODE MENUS
  // =========================================================

  function showMultiplayerMenu() {
    window.currentGameMode = "multiplayer-menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    restoreGameContainer();

    showScreen(
      "Multiplayer",
      showMainMenu,
      `
        <div class="identity-line">
          Playing as <strong>${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Player")}</strong>
          <button class="small-button" id="change-nickname">Change</button>
        </div>

        <div class="mode-grid">
          <button class="mode-card" id="mode-tile-race">
            <span class="mode-icon">🏁</span>
            <h3>Tile Race</h3>
            <p>First to reach the chosen tile wins. Play to 2048, 4096, or 8192.</p>
          </button>

          <div class="mode-card coming-soon">
            <span class="coming-soon-badge">Coming Soon</span>
            <span class="mode-icon">🏆</span>
            <h3>Score Sprint</h3>
            <p>First player to reach the target score wins.</p>
          </div>

          <div class="mode-card coming-soon">
            <span class="coming-soon-badge">Coming Soon</span>
            <span class="mode-icon">🎮</span>
            <h3>Freeplay Duel</h3>
            <p>Relaxed multiplayer with forgiving rules and no elimination.</p>
          </div>

          <div class="mode-card coming-soon">
            <span class="coming-soon-badge">Coming Soon</span>
            <span class="mode-icon">⚡</span>
            <h3>Blitz</h3>
            <p>Highest tile when the timer ends wins.</p>
          </div>

          <div class="mode-card coming-soon">
            <span class="coming-soon-badge">Coming Soon</span>
            <span class="mode-icon">☠️</span>
            <h3>Survival</h3>
            <p>Last player with a playable board wins.</p>
          </div>
        </div>
      `
    );

    document.getElementById("change-nickname").addEventListener("click", function () {
      openNicknamePrompt(showMultiplayerMenu);
    });

    document.getElementById("mode-tile-race").addEventListener("click", showTileRaceLobby);
  }

  function showTileRaceLobby() {
    window.currentGameMode = "tile-race-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    showScreen(
      "Tile Race",
      function () {
        leaveRoomSilently();
        showMultiplayerMenu();
      },
      `
        <div class="rules-card">
          <strong>Tile Race Rules</strong>
          <ul>
            <li>First player to reach the room's target tile wins.</li>
            <li>Each player gets one automatic Rescue.</li>
            <li>If your board gets stuck, Rescue automatically clears one of your lowest-value tiles.</li>
            <li>If you get stuck again after Rescue has been used, you're eliminated.</li>
            <li>Score is not shown and does not decide the winner.</li>
          </ul>
        </div>

        <div class="race-columns">
          <div class="race-box">
            <h2>Create Race</h2>
            <p>Choose the target for this room.</p>

            <div class="target-picker" id="target-picker">
              ${TARGETS.map(function (target) {
                return '<button class="target-button ' + (target === selectedTarget ? 'selected' : '') + '" data-target="' + target + '">' + target + '</button>';
              }).join("")}
            </div>

            <button class="primary-button" id="create-race">Create Game</button>
          </div>

          <div class="race-box">
            <h2>Join Race</h2>
            <p>Enter the room code your friend sent you.</p>

            <input id="room-code" class="room-input" maxlength="6" placeholder="ROOM CODE" autocomplete="off">

            <button class="primary-button" id="join-race">Join Game</button>
          </div>
        </div>

        <p class="status-text" id="race-status"></p>
      `
    );

    Array.prototype.forEach.call(
      document.querySelectorAll(".target-button"),
      function (button) {
        button.addEventListener("click", function () {
          selectedTarget = Number(button.getAttribute("data-target"));
          safeStorageSet(LAST_TARGET_KEY, selectedTarget);

          Array.prototype.forEach.call(
            document.querySelectorAll(".target-button"),
            function (other) {
              other.classList.toggle(
                "selected",
                Number(other.getAttribute("data-target")) === selectedTarget
              );
            }
          );
        });
      }
    );

    document.getElementById("create-race").addEventListener("click", function () {
      var status = document.getElementById("race-status");
      status.textContent = "Creating room...";
      this.disabled = true;

      socket.emit("createRoom", {
        mode: "tile-race",
        targetTile: selectedTarget,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    document.getElementById("join-race").addEventListener("click", function () {
      var roomInput = document.getElementById("room-code");
      var status = document.getElementById("race-status");
      var code = roomInput.value.trim().toUpperCase();

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

  function showWaitingRoom(data) {
    currentRoomCode = data.roomCode;
    window.multiplayerRoomCode = data.roomCode;
    selectedTarget = Number(data.targetTile || 2048);

    showScreen(
      "Tile Race",
      function () {
        leaveRoomSilently();
        showTileRaceLobby();
      },
      `
        <div class="race-box" style="max-width:500px;margin:0 auto;text-align:center;">
          <h2>Room Created</h2>
          <p>Send this code to your opponent:</p>
          <div class="room-code-display">${escapeHtml(data.roomCode)}</div>
          <p><strong>Target:</strong> ${selectedTarget}</p>
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

    window.currentGameMode = "multiplayer-tile-race";
    window.multiplayerMode = true;
    window.multiplayerMatchActive = true;
    window.multiplayerGameOver = false;
    window.multiplayerSecondChanceUsed = false;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerTargetTile = Number(data.targetTile || 2048);

    appRoot.innerHTML = "";
    gameHost.style.display = "none";
    soloToolbar.style.display = "none";
    clearModeClasses();

    latestOpponentState = null;
    opponentRescueSeen = false;
    lastOwnHighest = 0;
    lastLeaderNumber = null;

    withGame(function (game) {
      window.multiplayerAllowRestart = true;
      game.restart();
      window.multiplayerAllowRestart = false;

      lastOwnHighest = game.getHighestTileValue();
      createBattleView();
      gameContainer.style.display = "block";
      updateOwnSecondChanceUI();
      window.updateRacePosition(lastOwnHighest);
    });
  }

  function createBattleView() {
    removeBattleShell();

    battleShell = document.createElement("div");
    battleShell.className = "battle-shell";

    var target = Number(window.multiplayerTargetTile || 2048);
    var ownName = getOwnNickname();
    var opponentName = getOpponentNickname();
    var opponentProfile = getProfile(getOpponentNumber());
    var opponentTheme = opponentProfile && THEMES.indexOf(opponentProfile.theme) !== -1
      ? opponentProfile.theme
      : "classic";

    battleShell.innerHTML = `
      <div class="battle-topbar">
        <button class="danger-button" id="leave-match">Leave Match</button>
        <span class="battle-room-mini">Room ${escapeHtml(window.multiplayerRoomCode || "------")}</span>
        <button class="settings-button" id="battle-settings">⚙️ Settings</button>
      </div>

      <div class="battle-heading">
        <h1>Rina's 2048</h1>
        <div class="battle-meta">
          <span class="target-badge">Race to ${target}</span>
        </div>
        <p class="battle-rule-line">
          First to ${target} wins. If you get stuck, Rescue automatically clears one low tile. Get stuck again and you're eliminated.
        </p>
      </div>

      <div class="battle-layout">
        <section class="battle-player-card own-panel" id="own-panel" aria-label="Your board">
          <div class="player-card-header">
            <div class="player-name-block">
              <h2 class="player-name" id="own-nickname">${escapeHtml(ownName)}</h2>
              <div class="player-subline">
                <span>You</span>
                <span class="rank-badge" id="own-rank">TIED</span>
              </div>
              <div id="own-rescue" class="rescue-status">AUTOMATIC RESCUE: READY</div>
            </div>
            <div class="highest-box">
              <span>Highest</span>
              <strong id="own-highest">${Number(lastOwnHighest || 0)}</strong>
            </div>
          </div>
        </section>

        <div class="battle-vs" aria-hidden="true">
          <span>VS</span>
        </div>

        <section class="battle-player-card opponent-panel" aria-label="Opponent board">
          <div class="player-card-header">
            <div class="player-name-block">
              <h2 class="player-name" id="opponent-nickname">${escapeHtml(opponentName)}</h2>
              <div class="player-subline">
                <span>Opponent</span>
                <span class="rank-badge" id="opponent-rank">TIED</span>
              </div>
            </div>
            <div class="highest-box">
              <span>Highest</span>
              <strong id="opponent-highest">0</strong>
            </div>
          </div>

          <div id="opponent-grid" class="opponent-grid" data-theme="${escapeHtml(opponentTheme)}"></div>
          <div id="opponent-status">Waiting for opponent to move...</div>
        </section>
      </div>
    `;

    document.body.appendChild(battleShell);

    var ownPanel = document.getElementById("own-panel");
    ownPanel.appendChild(gameContainer);

    ownRescueStatus = document.getElementById("own-rescue");
    ownHighestDisplay = document.getElementById("own-highest");
    ownNicknameDisplay = document.getElementById("own-nickname");
    opponentNicknameDisplay = document.getElementById("opponent-nickname");
    ownRankBadge = document.getElementById("own-rank");
    opponentRankBadge = document.getElementById("opponent-rank");
    opponentGrid = document.getElementById("opponent-grid");
    opponentHighest = document.getElementById("opponent-highest");
    opponentStatus = document.getElementById("opponent-status");

    for (var i = 0; i < 16; i++) {
      var cell = document.createElement("div");
      cell.className = "opponent-cell";
      opponentGrid.appendChild(cell);
    }

    document.getElementById("leave-match").addEventListener("click", function () {
      if (window.confirm("Leave this multiplayer match?")) {
        leaveMultiplayerMatch();
      }
    });

    document.getElementById("battle-settings").addEventListener("click", openSettings);

    updateOwnSecondChanceUI();
    window.updateRacePosition(lastOwnHighest);

    if (latestOpponentState) {
      renderOpponentState(latestOpponentState);
    }
  }

  function restoreGameContainer() {
    if (gameContainer.parentNode !== gameHost) {
      gameHost.appendChild(gameContainer);
    }

    gameContainer.style.display = "none";
    removeBattleShell();
  }

  function removeBattleShell() {
    if (battleShell && battleShell.parentNode) {
      battleShell.remove();
    }

    battleShell = null;
    opponentGrid = null;
    opponentHighest = null;
    opponentStatus = null;
    ownRescueStatus = null;
    ownHighestDisplay = null;
    ownNicknameDisplay = null;
    opponentNicknameDisplay = null;
    ownRankBadge = null;
    opponentRankBadge = null;
  }

  function leaveRoomSilently() {
    if (currentRoomCode) {
      socket.emit("leaveRoom");
    }

    currentRoomCode = null;
    window.multiplayerRoomCode = null;
  }

  function leaveMultiplayerMatch() {
    socket.emit("leaveRoom");

    currentRoomCode = null;
    window.multiplayerRoomCode = null;
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerPlayerNumber = null;
    window.multiplayerSecondChanceUsed = false;
    window.multiplayerProfiles = [];

    restoreGameContainer();
    showMultiplayerMenu();
  }

  function updateOwnSecondChanceUI() {
    if (!ownRescueStatus) {
      return;
    }

    if (window.multiplayerSecondChanceUsed) {
      ownRescueStatus.textContent = "AUTOMATIC RESCUE: USED";
      ownRescueStatus.className = "rescue-status used";
    } else {
      ownRescueStatus.textContent = "AUTOMATIC RESCUE: READY";
      ownRescueStatus.className = "rescue-status";
    }
  }

  function showBattleToast(message) {
    var existing = document.getElementById("battle-toast");

    if (existing) {
      existing.remove();
    }

    var toast = document.createElement("div");
    toast.id = "battle-toast";
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) {
        toast.remove();
      }
    }, 2200);
  }

  window.showSecondChanceUsed = function (removedValue) {
    updateOwnSecondChanceUI();

    showBattleToast(
      removedValue
        ? "Rescue activated — a " + removedValue + " tile was cleared."
        : "Rescue activated — one low tile was cleared."
    );
  };

  function applyRankBadge(badge, text, isFirst) {
    if (!badge) {
      return;
    }

    var changed = badge.textContent !== text;
    badge.textContent = text;
    badge.classList.toggle("first", !!isFirst);

    if (changed) {
      badge.classList.remove("rank-bump");
      void badge.offsetWidth;
      badge.classList.add("rank-bump");
    }
  }

  window.updateRacePosition = function (ownHighest) {
    lastOwnHighest = Number(ownHighest || 0);

    if (ownHighestDisplay) {
      ownHighestDisplay.textContent = lastOwnHighest;
    }

    var opponentValue = latestOpponentState
      ? Number(latestOpponentState.highestTile || 0)
      : 0;

    if (!latestOpponentState) {
      applyRankBadge(ownRankBadge, "TIED", false);
      applyRankBadge(opponentRankBadge, "TIED", false);
      return;
    }

    var leaderNumber = 0;
    var ownNumber = Number(window.multiplayerPlayerNumber);
    var opponentNumber = getOpponentNumber();

    if (lastOwnHighest > opponentValue) {
      leaderNumber = ownNumber;
      applyRankBadge(ownRankBadge, "1ST", true);
      applyRankBadge(opponentRankBadge, "2ND", false);
    } else if (opponentValue > lastOwnHighest) {
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
      } else {
        var leaderName = leaderNumber === ownNumber
          ? getOwnNickname()
          : getOpponentNickname();

        showBattleToast(leaderName + " takes the lead.");
        playSound("lead");
      }
    }

    lastLeaderNumber = leaderNumber;
  };

  function renderOpponentState(state) {
    if (!opponentGrid || !state || !state.grid) {
      return;
    }

    var oldRescueUsed = opponentRescueSeen;
    opponentRescueSeen = !!state.secondChanceUsed;

    if (state.nickname) {
      updateOneProfile({
        playerNumber: getOpponentNumber(),
        nickname: state.nickname,
        theme: state.theme
      });
    }

    if (opponentNicknameDisplay) {
      opponentNicknameDisplay.textContent = getOpponentNickname();
    }

    opponentGrid.setAttribute(
      "data-theme",
      THEMES.indexOf(state.theme) !== -1 ? state.theme : "classic"
    );

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

    opponentHighest.textContent = state.highestTile || 0;

    if (!oldRescueUsed && opponentRescueSeen) {
      showBattleToast(getOpponentNickname() + " used their Rescue.");
    }

    if (state.won) {
      opponentStatus.textContent = getOpponentNickname() + " reached the target!";
    } else if (state.over) {
      opponentStatus.textContent = getOpponentNickname() + " has no moves left.";
    } else {
      opponentStatus.textContent = getOpponentNickname() + " is playing...";
    }

    window.updateRacePosition(lastOwnHighest);
  }

  function resetOpponentView() {
    latestOpponentState = null;
    opponentRescueSeen = false;
    lastLeaderNumber = null;

    if (opponentHighest) {
      opponentHighest.textContent = "0";
    }

    if (opponentStatus) {
      opponentStatus.textContent = "Waiting for opponent to move...";
    }

    if (opponentNicknameDisplay) {
      opponentNicknameDisplay.textContent = getOpponentNickname();
    }

    if (opponentGrid) {
      var opponentProfile = getProfile(getOpponentNumber());
      opponentGrid.setAttribute(
        "data-theme",
        opponentProfile && THEMES.indexOf(opponentProfile.theme) !== -1
          ? opponentProfile.theme
          : "classic"
      );

      var cells = opponentGrid.children;

      for (var i = 0; i < cells.length; i++) {
        cells[i].className = "opponent-cell";
        cells[i].textContent = "";
      }
    }

    applyRankBadge(ownRankBadge, "TIED", false);
    applyRankBadge(opponentRankBadge, "TIED", false);
  }

  // =========================================================
  // RESULT DIALOGS
  // =========================================================

  function removeResultOverlay() {
    var existing = document.getElementById("result-overlay");
    if (existing) {
      existing.remove();
    }
  }

  function showMatchResult(data) {
    removeResultOverlay();

    window.multiplayerGameOver = true;

    var didWin = data.winner === window.multiplayerPlayerNumber;
    var target = Number(data.targetTile || window.multiplayerTargetTile || 2048);
    var description;

    var opponentName = getOpponentNickname();

    if (data.reason === "elimination") {
      description = didWin
        ? opponentName + " ran out of moves after using their Rescue."
        : "You ran out of moves after using your Rescue.";
    } else {
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
    removeResultOverlay();
    window.multiplayerGameOver = true;
    window.multiplayerMatchActive = false;

    var overlay = document.createElement("div");
    overlay.id = "result-overlay";
    overlay.className = "result-overlay";

    overlay.innerHTML = `
      <div class="result-box">
        <div class="result-icon">👋</div>
        <h1>Match Ended</h1>
        <p>${escapeHtml(getOpponentNickname())} left the room.</p>
        <div class="result-actions">
          <button class="primary-button" id="opponent-left-back">Back to Multiplayer</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("opponent-left-back").addEventListener("click", function () {
      removeResultOverlay();
      currentRoomCode = null;
      window.multiplayerRoomCode = null;
      window.multiplayerMode = false;
      window.multiplayerGameOver = false;
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
    if (old) {
      old.remove();
    }

    var overlay = document.createElement("div");
    overlay.id = "settings-overlay";
    overlay.className = "settings-overlay";

    overlay.innerHTML = `
      <div class="settings-dialog">
        <div class="settings-dialog-header">
          <h2>Settings</h2>
          <button class="close-settings" id="close-settings" aria-label="Close">×</button>
        </div>

        <div class="settings-section">
          <h3>Multiplayer Nickname</h3>
          <p class="settings-help">The name your opponent sees during multiplayer. Maximum 16 characters.</p>
          <input
            id="settings-nickname"
            class="nickname-field"
            type="text"
            maxlength="16"
            autocomplete="nickname"
            placeholder="Nickname"
            value="${escapeHtml(window.rinasSettings.nickname || "")}"
          >
        </div>

        <div class="settings-section">
          <h3>Theme</h3>
          <p class="settings-help">Changes the whole app: background, menus, board, controls, and tiles. Your choice is saved on this browser. In multiplayer, your opponent can see your chosen board and tile theme on your mini board.</p>

          <div class="theme-grid">
            ${THEMES.map(function (theme) {
              return `
                <button class="theme-choice ${theme === window.rinasSettings.theme ? "selected" : ""}" data-theme="${theme}">
                  ${prettyThemeName(theme)}
                  <span class="theme-swatches">${themePreview(theme)}</span>
                </button>
              `;
            }).join("")}
          </div>
        </div>

        <div class="settings-section">
          <div class="toggle-row">
            <div>
              <h3>Sound Effects</h3>
              <p class="settings-help">
                Plays subtle sounds for moves, merges, Undo, Rescue, lead changes, menus, and results.
              </p>
            </div>
            <button id="sound-effects-toggle" class="toggle-button ${window.rinasSettings.soundEffects ? "on" : "off"}">
              ${window.rinasSettings.soundEffects ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div class="settings-section">
          <div class="toggle-row">
            <div>
              <h3>Solo Undo</h3>
              <p class="settings-help">
                When On, Solo mode lets you undo repeatedly with the on-screen Undo button or the Z key.
                Multiplayer modes ignore this setting. There is no keyboard shortcut for turning Undo on or off.
              </p>
            </div>
            <button id="solo-undo-toggle" class="toggle-button ${window.rinasSettings.soloUndo ? "on" : "off"}">
              ${window.rinasSettings.soloUndo ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div style="margin-top:24px;text-align:right;">
          <button class="primary-button" id="settings-done">Done</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
    }

    document.getElementById("close-settings").addEventListener("click", close);
    document.getElementById("settings-done").addEventListener("click", close);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        close();
      }
    });

    var nicknameInput = document.getElementById("settings-nickname");

    nicknameInput.addEventListener("change", function () {
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

        if (ownNicknameDisplay) {
          ownNicknameDisplay.textContent = getOwnNickname();
        }
      }
    });

    document.getElementById("sound-effects-toggle").addEventListener("click", function () {
      window.rinasSettings.soundEffects = !window.rinasSettings.soundEffects;
      saveSettings();

      this.className = "toggle-button " + (window.rinasSettings.soundEffects ? "on" : "off");
      this.textContent = window.rinasSettings.soundEffects ? "ON" : "OFF";

      if (window.rinasSettings.soundEffects) {
        playSound("ui");
      }
    });

    Array.prototype.forEach.call(
      overlay.querySelectorAll(".theme-choice"),
      function (button) {
        button.addEventListener("click", function () {
          var theme = button.getAttribute("data-theme");
          window.rinasSettings.theme = theme;
          saveSettings();
          applyTheme(theme);

          Array.prototype.forEach.call(
            overlay.querySelectorAll(".theme-choice"),
            function (other) {
              other.classList.toggle(
                "selected",
                other.getAttribute("data-theme") === theme
              );
            }
          );

          if (window.multiplayerGame && window.multiplayerMatchActive) {
            socket.emit("updateProfile", {
              nickname: window.rinasSettings.nickname,
              theme: theme
            });

            updateOneProfile({
              playerNumber: window.multiplayerPlayerNumber,
              nickname: window.rinasSettings.nickname,
              theme: theme
            });

            window.multiplayerGame.actuate();
          }
        });
      }
    );

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
    var status = document.getElementById("race-status");
    var joinButton = document.getElementById("join-race");
    var createButton = document.getElementById("create-race");

    if (status) {
      status.textContent = message;
    }

    if (joinButton) {
      joinButton.disabled = false;
    }

    if (createButton) {
      createButton.disabled = false;
    }
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
      if (ownNicknameDisplay) {
        ownNicknameDisplay.textContent = getOwnNickname();
      }
    } else {
      if (opponentNicknameDisplay) {
        opponentNicknameDisplay.textContent = getOpponentNickname();
      }

      if (
        opponentGrid &&
        THEMES.indexOf(profile.theme) !== -1
      ) {
        opponentGrid.setAttribute("data-theme", profile.theme);
      }
    }
  });

  socket.on("gameWinner", function (data) {
    showMatchResult(data);
  });

  socket.on("rematchWaiting", function () {
    var button = document.getElementById("result-rematch");
    if (button) {
      button.textContent = "Waiting for opponent...";
    }
  });

  socket.on("rematchStart", function (data) {
    removeResultOverlay();
    updateProfiles(data.players || []);

    window.multiplayerMode = true;
    window.multiplayerMatchActive = true;
    window.multiplayerGameOver = false;
    window.multiplayerSecondChanceUsed = false;
    window.multiplayerTargetTile = Number(data.targetTile || window.multiplayerTargetTile || 2048);

    resetOpponentView();
    updateOwnSecondChanceUI();

    withGame(function (game) {
      window.multiplayerAllowRestart = true;
      game.restart();
      window.multiplayerAllowRestart = false;
      lastOwnHighest = game.getHighestTileValue();
      window.updateRacePosition(lastOwnHighest);
    });
  });

  socket.on("opponentLeftMatch", function () {
    if (window.multiplayerMatchActive || currentRoomCode) {
      showOpponentLeft();
    }
  });

  socket.on("disconnect", function () {
    console.log("Disconnected from Rina's 2048 server.");
  });

  // =========================================================
  // START APP
  // =========================================================

  restoreGameContainer();
  showMainMenu();
})();

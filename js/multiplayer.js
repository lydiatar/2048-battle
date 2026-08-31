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

  // Optional support links. Leave blank until the owner supplies exact URLs.
  var KOFI_URL = "";
  var PAYPAL_URL = "";

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
  var raceSpineElement = null;
  var raceSpineTrack = null;
  var raceSpineFill = null;
  var raceSpineLocalMarker = null;
  var raceSpineOpponentMarker = null;
  var raceSpineLocalTarget = null;
  var raceSpineOpponentTarget = null;
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
  var opponentStateQueue = [];
  var opponentStateAnimating = false;
  var lastRenderedOpponentState = null;
  var opponentAnimationTimer = null;
  var preMatchCountdownTimers = [];
  var pendingGameStartData = null;

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
      musicEnabled: true,
      musicVolume: 0.42,
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

      if (typeof saved.musicEnabled === "boolean") {
        defaults.musicEnabled = saved.musicEnabled;
      }

      if (typeof saved.musicVolume === "number") {
        defaults.musicVolume = Math.max(0, Math.min(1, saved.musicVolume));
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
  if (window.rinasAudio && window.rinasAudio.syncSettings) {
    window.rinasAudio.syncSettings(window.rinasSettings);
  }

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
    if (window.rinasAudio && window.rinasAudio.playEvent) {
      window.rinasAudio.playEvent(name);
      return;
    }

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

  // v63 approved adaptive audio system. The Web Audio manager owns playback,
  // bus gain, crossfades, ducking and SFX voice limiting.
  function transitionMusic(state, fadeMs) {
    if (window.rinasAudio && window.rinasAudio.transitionMusic) {
      window.rinasAudio.transitionMusic(state, fadeMs);
    }
  }

  function startCompetitiveMusic() {
    transitionMusic(window.multiplayerModeName === "freeplay" ? "FREEPLAY" : "MULTIPLAYER", 1100);
    playSound("match-start");
  }

  function stopCompetitiveMusic(fadeMs) {
    transitionMusic("LOBBY", fadeMs || 700);
  }

  function updateCompetitiveMusicIntensity() {
    if (window.rinasAudio && window.rinasAudio.setCompetitiveIntensity) {
      window.rinasAudio.setCompetitiveIntensity(
        (lastOwnOneAway || lastOpponentOneAway) ? 1 : 0
      );
    }
  }

  function duckCompetitiveMusic() {
    if (window.rinasAudio && window.rinasAudio.duckMusic) {
      window.rinasAudio.duckMusic(0.10, 680);
    }
  }

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

  function uiIcon(name, extraClass) {
    var cls = "ui-icon" + (extraClass ? " " + extraClass : "");
    var common = 'viewBox="0 0 24 24" aria-hidden="true" focusable="false"';
    var graphicAssetNames = {
      solo: "solo",
      multiplayer: "multiplayer",
      settings: "settings",
      win: "win",
      loss: "loss",
      celebrate: "celebrate",
      milestone: "milestone",
      exit: "exit",
      disconnect: "disconnect",
      "tile-race": "tile-race",
      freeplay: "freeplay",
      "custom-race": "custom-race",
      move: "move",
      undo: "undo",
      edit: "edit"
    };

    if (graphicAssetNames[name]) {
      return '<svg class="' + cls + ' icon-asset" ' + common + '><use href="assets/icons/rinas-icons.svg#' + graphicAssetNames[name] + '"></use></svg>';
    }

    var body = "";

    if (name === "solo") {
      body = '<rect x="3.5" y="3.5" width="7" height="7" rx="1.7"></rect>' +
        '<rect x="13.5" y="3.5" width="7" height="7" rx="1.7"></rect>' +
        '<rect x="3.5" y="13.5" width="7" height="7" rx="1.7"></rect>' +
        '<rect x="13.5" y="13.5" width="7" height="7" rx="1.7"></rect>';
    } else if (name === "multiplayer") {
      body = '<rect x="2.5" y="5" width="7" height="7" rx="1.5"></rect>' +
        '<rect x="5" y="12" width="4.5" height="4.5" rx="1.1"></rect>' +
        '<rect x="14.5" y="5" width="7" height="7" rx="1.5"></rect>' +
        '<rect x="14.5" y="12" width="4.5" height="4.5" rx="1.1"></rect>' +
        '<path d="M10.8 8.5h2.4M12 7.3v2.4"></path>';
    } else if (name === "settings") {
      body = '<path d="M4 6h10M18 6h2M4 12h3M11 12h9M4 18h8M16 18h4"></path>' +
        '<circle cx="16" cy="6" r="2"></circle>' +
        '<circle cx="9" cy="12" r="2"></circle>' +
        '<circle cx="14" cy="18" r="2"></circle>';
    } else if (name === "new") {
      body = '<circle cx="12" cy="12" r="8.5"></circle>' +
        '<path d="M12 8v8M8 12h8"></path>';
    } else if (name === "undo") {
      body = '<path d="M8.5 7H4v-4"></path>' +
        '<path d="M4.4 7.2A8.2 8.2 0 1 1 5.6 17"></path>';
    } else if (name === "sound") {
      body = '<path d="M4 10h4l5-4v12l-5-4H4z"></path>' +
        '<path d="M16 9.2c1.2 1.4 1.2 4.2 0 5.6M18.8 7c2.6 2.8 2.6 7.2 0 10"></path>';
    } else if (name === "sound-off") {
      body = '<path d="M4 10h4l5-4v12l-5-4H4z"></path>' +
        '<path d="M16 9l5 6M21 9l-5 6"></path>';
    } else if (name === "exit") {
      body = '<path d="M13 4H5v16h8"></path>' +
        '<path d="M11 12h10M17 8l4 4-4 4"></path>';
    } else if (name === "save") {
      body = '<circle cx="12" cy="12" r="9"></circle>' +
        '<path d="M8 12.2l2.6 2.6L16.8 8.6"></path>';
    } else if (name === "win") {
      body = '<path d="M4 9l4 3 4-7 4 7 4-3-1.8 9H5.8z"></path>' +
        '<path d="M7 21h10"></path>';
    } else if (name === "loss") {
      body = '<path d="M4 4h7v7H4zM13 4h7v5h-7zM4 13h5v7H4zM12 13h8v7h-8z"></path>' +
        '<path d="M11 9l2 4M9 13l3-2"></path>';
    } else if (name === "celebrate") {
      body = '<rect x="4" y="5" width="4" height="4" rx=".8"></rect>' +
        '<rect x="15.5" y="4" width="3.5" height="3.5" rx=".8"></rect>' +
        '<rect x="10" y="10" width="4.5" height="4.5" rx="1"></rect>' +
        '<rect x="5" y="16" width="3.5" height="3.5" rx=".8"></rect>' +
        '<rect x="16" y="15" width="4" height="4" rx=".8"></rect>' +
        '<path d="M3 12h2M19 11h2M12 3v2M12 19v2"></path>';
    } else if (name === "disconnect") {
      body = '<path d="M13 4H5v16h8"></path>' +
        '<path d="M11 12h10M17 8l4 4-4 4"></path>';
    } else if (name === "back") {
      body = '<path d="M20 12H5M10 7l-5 5 5 5"></path>';
    } else {
      body = '<circle cx="12" cy="12" r="8"></circle>';
    }

    return '<svg class="' + cls + '" ' + common + '>' + body + '</svg>';
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

  function createScreenGhost() {
    // v47: intentionally disabled. Cloning live screens caused a visible jump
    // on Back/Change. Incoming screens now animate without duplicating UI.
  }

  function animateCurrentScreenOut(direction, callback) {
    var screen = appRoot.querySelector(".app-screen");
    if (!screen) {
      callback();
      return;
    }

    screen.classList.remove("screen-exit-forward", "screen-exit-back");
    screen.classList.add(direction < 0 ? "screen-exit-back" : "screen-exit-forward");
    setTimeout(callback, 150);
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
              ${backHandler ? '<button class="nav-button icon-text-button" id="screen-back">' + uiIcon('back','button-icon') + '<span>Back</span></button>' : ""}
            </div>
            <div class="app-title-stack">
              <span class="app-title-brand">Rina's 2048</span>
              <h1>${escapeHtml(title)}</h1>
            </div>
            <div class="app-header-side right">
              <button class="settings-button icon-text-button" id="screen-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button>
            </div>
          </div>
          <div id="screen-content">${contentHtml}</div>
        </div>
      </div>
    `;

    document.getElementById("screen-settings").addEventListener("click", openSettings);

    if (backHandler) {
      document.getElementById("screen-back").addEventListener("click", function () {
        animateCurrentScreenOut(-1, function () {
          nextScreenTransitionDirection = -1;
          backHandler();
        });
      });
    }

    window.requestAnimationFrame(function () {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });
  }


  function closeOverlaySmoothly(overlay, callback) {
    if (!overlay) {
      if (callback) callback();
      return;
    }

    overlay.classList.add("ui-overlay-leaving");
    setTimeout(function () {
      if (overlay.parentNode) overlay.remove();
      if (callback) callback();
    }, 230);
  }

  function openGameConfirm(options) {
    options = options || {};

    var old = document.getElementById("game-confirm-overlay");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "game-confirm-overlay";
    overlay.className = "game-modal-overlay";

    var title = options.title || "Are you sure?";
    var message = options.message || "";
    var confirmLabel = options.confirmLabel || "Confirm";
    var cancelLabel = options.cancelLabel || "Cancel";
    var toneClass = options.tone === "danger" ? " danger" : "";

    overlay.innerHTML = `
      <div class="game-modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title">
        <div class="game-modal-accent"></div>
        <span class="game-modal-kicker">RINA'S 2048</span>
        <h2 id="game-confirm-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="game-modal-actions">
          <button class="game-modal-button secondary" id="game-confirm-cancel">${escapeHtml(cancelLabel)}</button>
          <button class="game-modal-button primary${toneClass}" id="game-confirm-ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    var cancelButton = document.getElementById("game-confirm-cancel");
    var okButton = document.getElementById("game-confirm-ok");

    function cancel() {
      document.removeEventListener("keydown", onKey);
      closeOverlaySmoothly(overlay, function () {
        if (options.onCancel) options.onCancel();
      });
    }

    function confirmAction() {
      document.removeEventListener("keydown", onKey);
      okButton.disabled = true;
      closeOverlaySmoothly(overlay, function () {
        if (options.onConfirm) options.onConfirm();
      });
    }

    cancelButton.addEventListener("click", cancel);
    okButton.addEventListener("click", confirmAction);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) cancel();
    });

    function onKey(event) {
      if (!overlay.parentNode) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        document.removeEventListener("keydown", onKey);
        cancel();
      }
    }
    document.addEventListener("keydown", onKey);
    okButton.focus();
  }

  function openNicknamePrompt(onComplete) {
    var old = document.getElementById("nickname-overlay");
    if (old) old.remove();

    var overlay = document.createElement("div");
    overlay.id = "nickname-overlay";
    overlay.className = "game-modal-overlay nickname-modal-overlay";

    overlay.innerHTML = `
      <div class="game-modal nickname-modal" role="dialog" aria-modal="true" aria-labelledby="nickname-modal-title">
        <div class="game-modal-accent"></div>
        <span class="game-modal-kicker">MULTIPLAYER PROFILE</span>
        <h2 id="nickname-modal-title">Choose a nickname</h2>
        <p class="nickname-modal-copy">This is what your opponent will see during a match.</p>
        <div class="nickname-input-stage">
          <span>YOU'LL APPEAR AS</span>
          <input
            id="nickname-prompt-input"
            class="nickname-field nickname-field-centered"
            type="text"
            maxlength="16"
            autocomplete="nickname"
            placeholder="Nickname"
            value="${escapeHtml(window.rinasSettings.nickname || "")}"
          >
        </div>
        <p class="status-text" id="nickname-prompt-status" aria-live="polite"></p>
        <div class="game-modal-actions">
          <button class="game-modal-button secondary" id="nickname-prompt-cancel">Back</button>
          <button class="game-modal-button primary" id="nickname-prompt-save">Continue <span>→</span></button>
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

      if (onComplete) {
        overlay.classList.add("ui-overlay-leaving");
        onComplete();
        setTimeout(function () {
          if (overlay.parentNode) overlay.remove();
        }, 230);
      } else {
        closeOverlaySmoothly(overlay);
      }
    }

    function cancelNickname() {
      closeOverlaySmoothly(overlay);
    }

    document.getElementById("nickname-prompt-save").addEventListener("click", saveNicknameAndContinue);
    document.getElementById("nickname-prompt-cancel").addEventListener("click", cancelNickname);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) cancelNickname();
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        saveNicknameAndContinue();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        cancelNickname();
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
    var undoHint = window.rinasSettings.soloUndo
      ? '<div class="control-key-row compact solo-undo-key-hint"><span class="control-label">UNDO</span><kbd>Z</kbd></div>'
      : '';
    return '<div class="solo-control-strip">' + movementKeysMarkup(true) + undoHint + '<span class="touch-control-label">Swipe on touch devices</span></div>';
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
            <span class="brush-icon graphic-icon">${uiIcon("solo", "home-mode-icon")}</span>
            <span class="brush-copy"><strong>SOLO</strong><small>Build an endless board and beat your best.</small></span>
            <span class="brush-arrow">›</span>
          </button>

          <button class="home-brush-button multiplayer-brush" id="choose-multiplayer">
            <span class="brush-icon graphic-icon">${uiIcon("multiplayer", "home-mode-icon")}</span>
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

    document.getElementById("choose-solo").addEventListener("click", function () {
      animateCurrentScreenOut(1, showSoloMenu);
    });
    document.getElementById("choose-multiplayer").addEventListener("click", function () {
      if (sanitizeNickname(window.rinasSettings.nickname)) {
        animateCurrentScreenOut(1, showMultiplayerMenu);
        return;
      }

      openNicknamePrompt(function () {
        // Build the destination while the nickname overlay is fading out.
        // This avoids a blank/refresh-like flash between the two screens.
        showMultiplayerMenu();
      });
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
        '<div class="undo-loop"><span>' + uiIcon("move", "mode-rewind-icon") + '<b>MOVE</b></span><i></i><span>' + uiIcon("undo", "mode-rewind-icon") + '<b>UNDO</b></span></div>' +
      '</div>';
    }

    return '<div class="mode-custom-visual">' +
      '<div class="custom-target"><small>PLAYER 1</small><strong>2048</strong><span>Target</span></div>' +
      '<div class="custom-target harder"><small>PLAYER 2</small><strong>4096</strong><span>Target</span></div>' +
    '</div>';
  }

  function showSoloMenu() {
    transitionMusic("LOBBY", 850);
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
                ${hasSave ? '<button class="solo-main-action" id="continue-solo">Continue Game</button>' : '<button class="solo-main-action" id="start-solo">Start New Game</button>'}
                ${hasSave ? '<button class="solo-text-action" id="new-solo">Start New Game</button>' : ''}
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
                ${movementKeysMarkup(true)}
                ${window.rinasSettings.soloUndo ? '<div class="solo-preview-undo-hint"><span class="control-label">UNDO</span>' + uiIcon("undo", "solo-preview-undo-inline") + '<kbd>Z</kbd></div>' : ''}
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
          openGameConfirm({
            title: "Start a new game?",
            message: "Your current saved board will be replaced. Your Best Score and records will stay saved.",
            confirmLabel: "Start New Game",
            tone: "danger",
            onConfirm: function () { startSolo(true); }
          });
        });
      }
    });
  }

  function removeSoloActionRow() {
    var row = document.getElementById("solo-card-actions");
    if (row) row.remove();
  }

  function removeSoloGameplayLayout() {
    var layout = document.getElementById("solo-gameplay-layout");
    if (!layout) return;
    if (gameContainer.parentNode !== gameHost) gameHost.appendChild(gameContainer);
    layout.remove();
  }

  function nextSoloMilestone(highest) {
    var value = Math.max(2, Number(highest || 2));
    if (value < 128) return 128;
    var next = 128;
    while (next <= value) next *= 2;
    return next;
  }

  window.updateSoloGameplayHud = function (score, highest, best) {
    var scoreNode = document.getElementById("solo-live-score");
    var bestNode = document.getElementById("solo-live-best");
    var highestNode = document.getElementById("solo-live-highest");
    var nextNode = document.getElementById("solo-next-milestone");
    if (scoreNode) scoreNode.textContent = Number(score || 0).toLocaleString();
    if (bestNode) bestNode.textContent = Number(best || 0).toLocaleString();
    if (highestNode) highestNode.textContent = Number(highest || 0).toLocaleString();
    if (nextNode) nextNode.textContent = Number(nextSoloMilestone(highest || 2)).toLocaleString();
  };

  function renderSoloChrome() {
    removeSoloGameplayLayout();
    soloToolbar.innerHTML = `
      <div class="solo-floating-header">
        <div><button class="nav-button icon-text-button" id="solo-back">${uiIcon("back", "button-icon")}<span>Back</span></button></div>
        <div class="solo-floating-center">
          <strong>Rina's 2048</strong>
          <span class="solo-mode-label">SOLO</span>
        </div>
        <div class="solo-floating-right">
          <button class="settings-button icon-text-button" id="solo-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button>
        </div>
      </div>
    `;
    soloToolbar.style.display = "block";

    var layout = document.createElement("div");
    layout.id = "solo-gameplay-layout";
    layout.className = "solo-gameplay-layout direction-a";
    layout.innerHTML = `
      <aside class="solo-gameplay-context">
        <span>ENDLESS SOLO</span>
        <h2>Stay in the flow.</h2>
        <p>Keep building. 2048 is a milestone, not the finish.</p>
      </aside>
      <main class="solo-gameplay-center">
        <div class="solo-gameplay-stat-rail" aria-label="Current Solo stats">
          <div><span>SCORE</span><strong id="solo-live-score">0</strong></div>
          <div><span>BEST</span><strong id="solo-live-best">0</strong></div>
          <div><span>HIGHEST</span><strong id="solo-live-highest">0</strong></div>
        </div>
      </main>
      <aside class="solo-gameplay-actions">
        <button class="primary-button" id="solo-new">New Game</button>
        <div class="solo-next-milestone"><span>NEXT MILESTONE</span><strong id="solo-next-milestone">4096</strong><p>Keep this board alive and climb.</p></div>
      </aside>
    `;
    gameHost.appendChild(layout);
    var center = layout.querySelector(".solo-gameplay-center");
    center.appendChild(gameContainer);

    document.getElementById("solo-back").addEventListener("click", showSoloMenu);
    document.getElementById("solo-settings").addEventListener("click", openSettings);
    document.getElementById("solo-new").addEventListener("click", function () {
      openGameConfirm({
        title: "Start a new game?",
        message: "Your current Solo board will be replaced. Your Best Score and records will stay saved.",
        confirmLabel: "New Game",
        tone: "danger",
        onConfirm: function () { withGame(function (game) { game.restart(); }); }
      });
    });

    removeSoloActionRow();
    var existingStrip = document.getElementById("solo-control-strip");
    if (existingStrip) existingStrip.remove();
    var board = gameContainer.querySelector(".game-container");
    var controlStrip = document.createElement("div");
    controlStrip.id = "solo-control-strip";
    controlStrip.innerHTML = soloControlsMarkup();
    gameContainer.insertBefore(controlStrip, board.nextSibling);

    withGame(function (game) {
      window.updateSoloGameplayHud(game.score, game.getHighestTileValue(), game.storageManager.getBestScore());
    });
    window.refreshSoloControls();
  }

  function startSolo(startNew) {
    transitionMusic("SOLO", 1050);
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

    window.requestAnimationFrame(function () {
      window.scrollTo(0, 0);
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    });

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
    var strip = document.getElementById("solo-control-strip");
    if (strip) strip.innerHTML = soloControlsMarkup();
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
        <div class="result-icon result-icon-graphic">${uiIcon("celebrate", "result-graphic")}</div>
        <h1>You made 2048!</h1>
        <p>2048 is only the first milestone. Keep this board and see how far you can go.</p>
        <div class="result-actions">
          <button class="primary-button" id="solo-2048-continue">Continue</button>
          <button class="secondary-button" id="solo-2048-new">New Game</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    playSound("target");

    document.getElementById("solo-2048-continue").addEventListener("click", function () {
      withGame(function (game) {
        game.keepPlaying = true;
        if (!game.movesAvailable()) game.over = true;
        game.actuator.continueGame();
        game.actuate();
        overlay.remove();
        transitionMusic("SOLO", 500);
      });
    });

    document.getElementById("solo-2048-new").addEventListener("click", function () {
      withGame(function (game) {
        overlay.remove();
        game.restart();
        transitionMusic("SOLO", 500);
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
    transitionMusic("LOBBY", 850);
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
          <strong id="multiplayer-current-nickname">${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Player")}</strong>
          <button class="nickname-link" id="change-nickname">Change</button>
        </div>

        <div class="mode-showcase-list">
          <button class="mode-showcase mode-showcase-race" id="mode-tile-race">
            <div class="mode-showcase-copy">
              <div class="mode-showcase-title-row">
                <span class="mode-showcase-modeicon">${uiIcon("tile-race", "mode-art-icon")}</span>
                <div><span class="mode-showcase-index">01 · COMPETITIVE</span><h2>Tile Race</h2></div>
              </div>
              <p>First player to reach the target tile wins. A stuck board loses.</p>
              <div class="mode-showcase-facts"><span>Live position</span><span>No Undo</span><span>2048 / 4096 / 8192</span></div>
              <strong class="mode-showcase-action">Play Tile Race →</strong>
            </div>
            <div class="mode-showcase-preview">${modePreviewMarkup('tile-race')}</div>
          </button>

          <button class="mode-showcase mode-showcase-freeplay" id="mode-freeplay">
            <div class="mode-showcase-copy">
              <div class="mode-showcase-title-row">
                <span class="mode-showcase-modeicon">${uiIcon("freeplay", "mode-art-icon")}</span>
                <div><span class="mode-showcase-index">02 · CASUAL</span><h2>Freeplay Duel</h2></div>
              </div>
              <p>Build side-by-side with no winner or elimination. Compare progress and rewind one move at a time.</p>
              <div class="mode-showcase-facts"><span>No finish line</span><span>One-step Undo</span><span>Restart anytime</span></div>
              <strong class="mode-showcase-action">Play Freeplay →</strong>
            </div>
            <div class="mode-showcase-preview">${modePreviewMarkup('freeplay')}</div>
          </button>

          <button class="mode-showcase mode-showcase-custom" id="mode-custom-race">
            <div class="mode-showcase-copy">
              <div class="mode-showcase-title-row">
                <span class="mode-showcase-modeicon">${uiIcon("custom-race", "mode-art-icon")}</span>
                <div><span class="mode-showcase-index">03 · HANDICAP</span><h2>Custom Race</h2></div>
              </div>
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
      openNicknamePrompt(function () {
        var label = document.getElementById("multiplayer-current-nickname");
        if (label) label.textContent = sanitizeNickname(window.rinasSettings.nickname) || "Player";
      });
    });

    document.getElementById("mode-tile-race").addEventListener("click", function () { animateCurrentScreenOut(1, showTileRaceLobby); });
    document.getElementById("mode-freeplay").addEventListener("click", function () { animateCurrentScreenOut(1, showFreeplayLobby); });
    document.getElementById("mode-custom-race").addEventListener("click", function () { animateCurrentScreenOut(1, showCustomRaceLobby); });
  }

  function roomJoinMarkup() {
    return `
      <section class="match-setup-join" aria-label="Join a room">
        <span class="match-setup-kicker">JOIN A ROOM</span>
        <h2>Enter a room code.</h2>
        <p>Paste the six-character code your friend sent you.</p>
        <input id="room-code" class="match-room-input" maxlength="6" placeholder="ENTER CODE" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <button class="primary-button" id="join-room">Join Match</button>
      </section>
    `;
  }

  function normalizeRoomCode(value) {
    return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }

  function bindJoinRoom() {
    var input = document.getElementById("room-code");
    var joinButton = document.getElementById("join-room");
    if (!input || !joinButton) return;

    input.addEventListener("input", function () {
      var normalized = normalizeRoomCode(input.value);
      if (input.value !== normalized) input.value = normalized;
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") {
        event.preventDefault();
        joinButton.click();
      }
    });

    joinButton.addEventListener("click", function () {
      var status = document.getElementById("lobby-status");
      var code = normalizeRoomCode(input.value);
      input.value = code;

      if (code.length !== 6) {
        if (status) status.textContent = "Please enter a 6-character room code.";
        input.focus();
        return;
      }

      currentRoomCode = code;
      window.multiplayerRoomCode = code;
      if (status) status.textContent = "Joining room...";
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

  function modeSetupSummary(mode) {
    if (mode === "freeplay") {
      return {
        kicker: "02 · CASUAL",
        title: "Freeplay Duel",
        copy: "No finish line. Build side-by-side, use one-step Undo with Z, and restart your own board whenever you want.",
        facts: ["No finish line", "One-step Undo", "Restart anytime"]
      };
    }
    if (mode === "custom-race") {
      return {
        kicker: "03 · HANDICAP",
        title: "Custom Race",
        copy: "Give each player a different finish tile. The targets stay visible and the race compares progress transparently.",
        facts: ["Different targets", "No Undo", "A stuck board loses"]
      };
    }
    return {
      kicker: "01 · COMPETITIVE",
      title: "Tile Race",
      copy: "First to the shared target wins. No Undo. If your board gets stuck before the target, you lose.",
      facts: ["First to target", "No Undo", "A stuck board loses"]
    };
  }

  function setupFactsMarkup(facts) {
    return '<div class="match-setup-facts">' + facts.map(function (fact) {
      return '<span>' + escapeHtml(fact) + '</span>';
    }).join("") + '</div>';
  }

  function showTileRaceLobby() {
    window.currentGameMode = "tile-race-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    var info = modeSetupSummary("tile-race");

    showScreen(
      "Tile Race",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="match-setup-screen">
          <section class="match-setup-create">
            <span class="match-setup-kicker">${info.kicker}</span>
            <h2>${info.title}</h2>
            <p>${info.copy}</p>
            ${setupFactsMarkup(info.facts)}
            <div class="match-target-section">
              <span class="match-setup-kicker">SHARED TARGET</span>
              <div class="target-picker match-target-picker" id="target-picker">${targetButtons(TARGETS, selectedTarget, "shared-target")}</div>
            </div>
            <button class="primary-button match-create-button" id="create-room">Create Race</button>
          </section>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text match-setup-status" id="lobby-status"></p>
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
    var info = modeSetupSummary("freeplay");

    showScreen(
      "Freeplay Duel",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="match-setup-screen">
          <section class="match-setup-create">
            <span class="match-setup-kicker">${info.kicker}</span>
            <h2>${info.title}</h2>
            <p>${info.copy}</p>
            ${setupFactsMarkup(info.facts)}
            <div class="freeplay-setup-controls">
              ${movementKeysMarkup(true)}
              <div class="control-key-row compact"><span class="control-label">UNDO</span><kbd>Z</kbd></div>
            </div>
            <button class="primary-button match-create-button" id="create-room">Create Freeplay</button>
          </section>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text match-setup-status" id="lobby-status"></p>
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
    var info = modeSetupSummary("custom-race");

    showScreen(
      "Custom Race",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="match-setup-screen custom">
          <section class="match-setup-create">
            <span class="match-setup-kicker">${info.kicker}</span>
            <h2>${info.title}</h2>
            <p>${info.copy}</p>
            ${setupFactsMarkup(info.facts)}
            <div class="custom-target-grid match-custom-targets">
              <div class="custom-target-panel">
                <span class="match-setup-kicker">YOUR TARGET</span>
                <div class="target-picker">${targetButtons(CUSTOM_TARGETS, selectedCustomHostTarget, "host-target")}</div>
              </div>
              <div class="custom-target-panel">
                <span class="match-setup-kicker">OPPONENT TARGET</span>
                <div class="target-picker">${targetButtons(CUSTOM_TARGETS, selectedCustomGuestTarget, "guest-target")}</div>
              </div>
            </div>
            <button class="primary-button match-create-button" id="create-room">Create Custom Race</button>
          </section>
          ${roomJoinMarkup()}
        </div>
        <p class="status-text match-setup-status" id="lobby-status"></p>
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
    transitionMusic("LOBBY", 700);
    currentRoomCode = data.roomCode;
    window.multiplayerRoomCode = data.roomCode;
    var mode = data.mode || "tile-race";
    var info = modeSetupSummary(mode);
    var code = normalizeRoomCode(data.roomCode);
    var ownName = sanitizeNickname(window.rinasSettings.nickname) || "Player 1";
    var targetCopy = mode === "tile-race"
      ? '<span>Target ' + Number(data.targetTile || 2048) + '</span>'
      : mode === "custom-race"
        ? '<span>Your target ' + Number(data.ownTarget || 2048) + '</span><span>Opponent target ' + Number(data.opponentTarget || 2048) + '</span>'
        : '<span>No finish line</span>';

    showScreen(
      modeTitle(mode),
      function () { leaveRoomSilently(); backToLobbyForMode(mode); },
      `
        <div class="match-staging-screen">
          <section class="match-staging-code">
            <span class="match-setup-kicker">MATCH STAGING</span>
            <h2>Invite your opponent.</h2>
            <p>Share this room code. The full six-character value copies as one item.</p>
            <div class="match-room-code-block">
              <span class="match-setup-kicker">ROOM CODE</span>
              <div class="match-room-code-row">
                <span class="match-room-code" id="match-room-code" role="button" tabindex="0" aria-label="Copy room code ${escapeHtml(code)}">${escapeHtml(code.slice(0,3))}<span aria-hidden="true"></span>${escapeHtml(code.slice(3))}</span>
                <button class="match-copy-code" id="match-copy-code" type="button">Copy</button>
              </div>
              <p class="match-copy-status" id="match-copy-status">Share ${escapeHtml(code)} with your opponent.</p>
            </div>
            <div class="match-staging-mode">
              <span class="match-setup-kicker">${info.kicker}</span>
              <strong>${info.title}</strong>
              <div class="match-staging-mode-facts">${targetCopy}${setupFactsMarkup(info.facts)}</div>
            </div>
          </section>

          <section class="match-staging-players" aria-label="Players in room">
            <span class="match-setup-kicker">PLAYERS</span>
            <div class="match-staging-player ready"><div><strong>${escapeHtml(ownName)}</strong><span><i></i>Ready</span></div><b>YOU</b></div>
            <div class="match-staging-player waiting"><div><strong>Player 2</strong><span><i></i>Waiting to join</span></div><b>OPPONENT</b></div>
            <p class="match-staging-wait">Waiting for your opponent. When they join, both players get a short 3–2–1 countdown.</p>
          </section>
        </div>
      `
    );

    function copyRoomCode() {
      var status = document.getElementById("match-copy-status");
      var button = document.getElementById("match-copy-code");
      var onSuccess = function () {
        if (button) button.textContent = "✓ Copied";
        if (status) status.textContent = "Copied " + code;
        window.setTimeout(function () {
          if (button) button.textContent = "Copy";
          if (status) status.textContent = "Share " + code + " with your opponent.";
        }, 1300);
      };

      function selectFallback() {
        var node = document.getElementById("match-room-code");
        if (node && window.getSelection && document.createRange) {
          var range = document.createRange();
          range.selectNodeContents(node);
          var selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (status) status.textContent = "Room code selected — press Cmd/Ctrl+C to copy.";
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(onSuccess).catch(selectFallback);
      } else {
        selectFallback();
      }
    }

    var roomCodeNode = document.getElementById("match-room-code");
    roomCodeNode.addEventListener("click", copyRoomCode);
    roomCodeNode.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        copyRoomCode();
      }
    });
    document.getElementById("match-copy-code").addEventListener("click", copyRoomCode);
  }

  function clearPreMatchCountdown() {
    while (preMatchCountdownTimers.length) {
      window.clearTimeout(preMatchCountdownTimers.pop());
    }
    pendingGameStartData = null;
  }

  function countdownModeSummary(data) {
    var mode = data.mode || "tile-race";
    if (mode === "freeplay") return "No finish line · One-step Undo · Restart anytime";
    if (mode === "custom-race") {
      return "Your target " + Number(data.ownTarget || data.targetTile || 2048) +
        " · Opponent target " + Number(data.opponentTarget || data.targetTile || 2048);
    }
    return "First to " + Number(data.targetTile || 2048) + " · No Undo · A stuck board loses";
  }

  function showPreMatchCountdown(data) {
    clearPreMatchCountdown();
    pendingGameStartData = data;

    currentRoomCode = data.roomCode || currentRoomCode;
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    updateProfiles(data.players || []);

    var mode = data.mode || "tile-race";
    var ownName = getOwnNickname();
    var opponentName = getOpponentNickname();

    window.currentGameMode = "multiplayer-countdown";

    showScreen(
      modeTitle(mode),
      function () {
        clearPreMatchCountdown();
        leaveRoomSilently();
        backToLobbyForMode(mode);
      },
      `
        <div class="match-countdown-screen" aria-live="polite">
          <section class="match-countdown-copy">
            <span class="match-setup-kicker">MATCH FOUND</span>
            <h2>Your opponent joined.</h2>
            <p>${escapeHtml(countdownModeSummary(data))}</p>
            <div class="match-countdown-number" id="match-countdown-number"><span>GET READY</span></div>
          </section>

          <section class="match-countdown-players" aria-label="Players ready">
            <span class="match-setup-kicker">PLAYERS</span>
            <div class="match-staging-player ready connected">
              <div><strong>${escapeHtml(ownName)}</strong><span><i></i>Ready</span></div><b>YOU</b>
            </div>
            <div class="match-staging-player ready connected">
              <div><strong>${escapeHtml(opponentName)}</strong><span><i></i>Connected</span></div><b>OPPONENT</b>
            </div>
            <p class="match-countdown-status" id="match-countdown-status">Both players are connected.</p>
          </section>
        </div>
      `
    );

    var numberNode = document.getElementById("match-countdown-number");
    var statusNode = document.getElementById("match-countdown-status");

    function showCount(value, statusText) {
      if (!numberNode) return;
      numberNode.classList.remove("count-snap");
      numberNode.innerHTML = "<strong>" + value + "</strong>";
      void numberNode.offsetWidth;
      numberNode.classList.add("count-snap");
      if (statusNode) statusNode.textContent = statusText;
      playSound("ui");
    }

    // Give the host and joiner a visible connected state before counting.
    preMatchCountdownTimers.push(window.setTimeout(function () {
      showCount("3", "Match starts in 3…");
    }, 850));

    preMatchCountdownTimers.push(window.setTimeout(function () {
      showCount("2", "Match starts in 2…");
    }, 1550));

    preMatchCountdownTimers.push(window.setTimeout(function () {
      showCount("1", "Match starts in 1…");
    }, 2250));

    preMatchCountdownTimers.push(window.setTimeout(function () {
      var startData = pendingGameStartData;
      clearPreMatchCountdown();
      if (startData) startMultiplayerMatch(startData);
    }, 3050));
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

  function powerStep(value) {
    value = Math.max(2, Number(value || 2));
    return Math.max(1, Math.round(Math.log(value) / Math.LN2));
  }

  function spinePositionPercent(value, maxTarget) {
    var startStep = 1;
    var targetStep = Math.max(startStep + 1, powerStep(maxTarget));
    var currentStep = Math.max(startStep, Math.min(targetStep, powerStep(value)));
    var ratio = (currentStep - startStep) / (targetStep - startStep);
    return 92 - (ratio * 82);
  }

  function raceSpineTicks(maxTarget) {
    var maxStep = powerStep(maxTarget);
    var candidates = [maxStep, maxStep - 1, maxStep - 2, Math.round((maxStep + 1) / 2), Math.max(2, maxStep - 5)];
    var seen = {};
    return candidates.filter(function (step) {
      if (step <= 1 || step > maxStep || seen[step]) return false;
      seen[step] = true;
      return true;
    }).sort(function (a, b) { return b - a; }).slice(0, 5).map(function (step) {
      return Math.pow(2, step);
    });
  }

  function createRaceSpineHtml(mode, ownTarget, opponentTarget) {
    var maxTarget = Math.max(ownTarget, opponentTarget, 4);
    var ticks = raceSpineTicks(maxTarget);
    var isCustom = mode === "custom-race";
    var tickHtml = ticks.map(function (value) {
      return '<span class="race-spine-tick" data-value="' + value + '" style="top:' + spinePositionPercent(value, maxTarget) + '%"><i></i><b>' + value + '</b></span>';
    }).join("");

    var targetFlags = isCustom
      ? '<span class="race-target-flag local" id="race-local-target" style="top:' + spinePositionPercent(ownTarget, maxTarget) + '%"><b>' + ownTarget + '</b><small>YOUR TARGET</small></span>' +
        '<span class="race-target-flag opponent" id="race-opponent-target" style="top:' + spinePositionPercent(opponentTarget, maxTarget) + '%"><b>' + opponentTarget + '</b><small>OPPONENT TARGET</small></span>'
      : '<span class="race-spine-target"><b>' + ownTarget + '</b><small>TARGET</small></span>';

    return '<div class="race-spine" id="race-spine" data-max-target="' + maxTarget + '" data-mode="' + escapeHtml(mode) + '">' +
      targetFlags +
      '<div class="race-spine-track" id="race-spine-track"><span class="race-spine-fill" id="race-spine-fill"></span></div>' +
      tickHtml +
      '<span class="race-spine-marker local" id="race-spine-local-marker"><span class="marker-copy"><strong>' + escapeHtml(getOwnNickname()) + '</strong><small>2</small></span><i></i></span>' +
      '<span class="race-spine-marker opponent" id="race-spine-opponent-marker"><i></i><span class="marker-copy"><strong>' + escapeHtml(getOpponentNickname()) + '</strong><small>2</small></span></span>' +
      '<span class="race-spine-start">START</span>' +
    '</div>';
  }

  function updateRaceSpine(ownHighest, opponentHighest) {
    if (!raceSpineElement || !raceSpineLocalMarker || !raceSpineOpponentMarker) return;
    var maxTarget = Number(raceSpineElement.getAttribute("data-max-target") || 2048);
    var ownValue = Math.max(2, Number(ownHighest || 2));
    var opponentValue = Math.max(2, Number(opponentHighest || 2));
    var ownTop = spinePositionPercent(ownValue, maxTarget);
    var opponentTop = spinePositionPercent(opponentValue, maxTarget);
    raceSpineLocalMarker.style.top = ownTop + "%";
    raceSpineOpponentMarker.style.top = opponentTop + "%";
    var ownSmall = raceSpineLocalMarker.querySelector("small");
    var opponentSmall = raceSpineOpponentMarker.querySelector("small");
    var ownStrong = raceSpineLocalMarker.querySelector("strong");
    var opponentStrong = raceSpineOpponentMarker.querySelector("strong");
    if (ownSmall) ownSmall.textContent = ownValue;
    if (opponentSmall) opponentSmall.textContent = opponentValue;
    if (ownStrong) ownStrong.textContent = getOwnNickname();
    if (opponentStrong) opponentStrong.textContent = getOpponentNickname();

    if (raceSpineFill) {
      var leadingTop = Math.min(ownTop, opponentTop);
      raceSpineFill.style.top = leadingTop + "%";
    }
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
    battleShell.className = "battle-shell direction-a-battle " + (isFreeplay ? "freeplay-battle" : "race-battle");

    var ruleLine = isFreeplay
      ? "Build side-by-side. No finish line, no elimination. Use Z for one-step Undo."
      : mode === "custom-race"
        ? "Each player races to their own target. A stuck board loses."
        : "First to the target tile wins. A stuck board loses.";

    var middleStage = isFreeplay
      ? `<div class="freeplay-match-center">
          <span class="freeplay-match-kicker">FREEPLAY</span>
          <strong>No finish line.</strong>
          <div class="freeplay-live-controls">${movementKeysMarkup(true)}<div class="control-key-row compact"><span class="control-label">UNDO</span><kbd>Z</kbd></div></div>
        </div>`
      : createRaceSpineHtml(mode, ownTarget, opponentTarget);

    battleShell.innerHTML = `
      <div class="battle-topbar">
        <button class="danger-button icon-text-button" id="leave-match">${uiIcon("exit", "button-icon")}<span>Leave Match</span></button>
        <div class="battle-mode-title"><strong>Rina's 2048</strong><span>${escapeHtml(modeTitle(mode))}</span></div>
        <div class="battle-topbar-right"><span class="battle-room-mini">Room ${escapeHtml(window.multiplayerRoomCode || "------")}</span><button class="settings-button icon-text-button" id="battle-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button></div>
      </div>
      <div class="battle-heading"><p class="battle-rule-line">${ruleLine}</p></div>
      <div class="battle-layout direction-a-layout">
        <section class="battle-player-card own-panel" id="own-panel" aria-label="Your board">
          <div class="player-card-header">
            <div class="player-name-block"><span class="player-role-label">YOU${isFreeplay ? '' : ' · '}<b id="own-rank-inline">${isFreeplay ? '' : 'TIED'}</b></span><h2 class="player-name" id="own-nickname">${escapeHtml(ownName)}</h2></div>
            ${isFreeplay
              ? '<div class="stat-pair"><div class="mini-stat"><span>Score</span><strong id="own-score">0</strong></div><div class="mini-stat"><span>Highest</span><strong id="own-highest">' + Number(lastOwnHighest || 0) + '</strong></div></div>'
              : '<div class="highest-box"><span>Highest</span><strong id="own-highest">' + Number(lastOwnHighest || 0) + '</strong></div>'}
          </div>
          <div class="own-board-slot" id="own-board-slot"></div>
          <div class="battle-board-foot">${movementKeysMarkup(true)}${isFreeplay ? '<div class="control-key-row compact"><span class="control-label">UNDO</span><kbd>Z</kbd></div>' : '<span class="battle-no-undo">NO UNDO</span>'}</div>
          ${isFreeplay ? '<button class="small-button freeplay-restart-only" id="freeplay-restart">Restart Board</button>' : ''}
        </section>

        <div class="battle-center-stage">${middleStage}</div>

        <section class="battle-player-card opponent-panel" id="opponent-panel" data-opponent-theme="${escapeHtml(opponentTheme)}" aria-label="Opponent board">
          <div class="player-card-header">
            <div class="player-name-block"><span class="player-role-label opponent">OPPONENT${isFreeplay ? '' : ' · '}<b id="opponent-rank-inline">${isFreeplay ? '' : 'TIED'}</b></span><h2 class="player-name" id="opponent-nickname">${escapeHtml(opponentName)}</h2></div>
            ${isFreeplay
              ? '<div class="stat-pair"><div class="mini-stat"><span>Score</span><strong id="opponent-score">0</strong></div><div class="mini-stat"><span>Highest</span><strong id="opponent-highest">0</strong></div></div>'
              : '<div class="highest-box"><span>Highest</span><strong id="opponent-highest">0</strong></div>'}
          </div>
          <div id="opponent-grid" class="opponent-grid" data-theme="${escapeHtml(opponentTheme)}"></div>
          <div id="opponent-status" class="opponent-live-status"><span></span>Connected</div>
        </section>
      </div>
    `;

    document.body.appendChild(battleShell);

    var ownPanel = document.getElementById("own-panel");
    var ownBoardSlot = document.getElementById("own-board-slot");
    ownBoardSlot.appendChild(gameContainer);

    if (isFreeplay) {
      document.getElementById("freeplay-restart").addEventListener("click", function () {
        openGameConfirm({
          title: "Restart your board?",
          message: "Your Freeplay board will restart. Your opponent will keep playing.",
          confirmLabel: "Restart Board",
          tone: "danger",
          onConfirm: restartFreeplayBoard
        });
      });
    }

    ownHighestDisplay = document.getElementById("own-highest");
    ownScoreDisplay = document.getElementById("own-score");
    opponentScoreDisplay = document.getElementById("opponent-score");
    ownNicknameDisplay = document.getElementById("own-nickname");
    opponentNicknameDisplay = document.getElementById("opponent-nickname");
    ownRankBadge = document.getElementById("own-rank-inline");
    opponentRankBadge = document.getElementById("opponent-rank-inline");
    opponentPanelElement = document.getElementById("opponent-panel");
    opponentGrid = document.getElementById("opponent-grid");
    opponentHighest = document.getElementById("opponent-highest");
    opponentStatus = document.getElementById("opponent-status");
    ownProgressFill = null;
    opponentProgressFill = null;
    ownProgressText = null;
    opponentProgressText = null;
    ownProgressNote = null;
    opponentProgressNote = null;
    raceSpineElement = document.getElementById("race-spine");
    raceSpineTrack = document.getElementById("race-spine-track");
    raceSpineFill = document.getElementById("race-spine-fill");
    raceSpineLocalMarker = document.getElementById("race-spine-local-marker");
    raceSpineOpponentMarker = document.getElementById("race-spine-opponent-marker");
    raceSpineLocalTarget = document.getElementById("race-local-target");
    raceSpineOpponentTarget = document.getElementById("race-opponent-target");

    for (var i = 0; i < 16; i++) {
      var cell = document.createElement("div");
      cell.className = "opponent-cell";
      opponentGrid.appendChild(cell);
    }

    document.getElementById("leave-match").addEventListener("click", function () {
      openGameConfirm({
        title: "Leave this match?",
        message: "You will disconnect from the room and return to the multiplayer menu.",
        confirmLabel: "Leave Match",
        tone: "danger",
        onConfirm: leaveMultiplayerMatch
      });
    });
    document.getElementById("battle-settings").addEventListener("click", openSettings);

    window.refreshFreeplayControls();
    window.updateMatchProgress(lastOwnHighest, lastOwnScore);
    if (latestOpponentState) renderOpponentState(latestOpponentState);
  }

  function restoreGameContainer() {
    removeSoloGameplayLayout();
    if (gameContainer.parentNode !== gameHost) {
      gameHost.appendChild(gameContainer);
    }
    gameContainer.style.display = "none";
    removeBattleShell();
  }

  function removeBattleShell() {
    if (opponentAnimationTimer) {
      window.clearTimeout(opponentAnimationTimer);
      opponentAnimationTimer = null;
    }

    opponentStateQueue = [];
    opponentStateAnimating = false;
    lastRenderedOpponentState = null;
    clearOpponentMotionTiles();

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
    raceSpineElement = null;
    raceSpineTrack = null;
    raceSpineFill = null;
    raceSpineLocalMarker = null;
    raceSpineOpponentMarker = null;
    raceSpineLocalTarget = null;
    raceSpineOpponentTarget = null;
  }

  function leaveRoomSilently() {
    clearPreMatchCountdown();
    if (currentRoomCode) socket.emit("leaveRoom");
    currentRoomCode = null;
    window.multiplayerRoomCode = null;
  }

  function leaveMultiplayerMatch() {
    clearPreMatchCountdown();
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
    var ownRatio = progressRatio(lastOwnHighest, ownTarget);
    var ownOneAwayNow = lastOwnHighest >= ownTarget / 2 && lastOwnHighest < ownTarget;
    var opponentHighestValue = latestOpponentState ? Number(latestOpponentState.highestTile || 0) : 0;
    var opponentRatio = latestOpponentState ? progressRatio(opponentHighestValue, opponentTarget) : 0;
    var opponentOneAwayNow = latestOpponentState && opponentHighestValue >= opponentTarget / 2 && opponentHighestValue < opponentTarget;

    updateRaceSpine(lastOwnHighest || 2, opponentHighestValue || 2);

    if (!latestOpponentState) {
      applyRankBadge(ownRankBadge, "TIED", false);
      applyRankBadge(opponentRankBadge, "TIED", false);
      if (ownOneAwayNow && !lastOwnOneAway) {
        showBattleToast(getOwnNickname() + " is one merge away.");
      }
      lastOwnOneAway = ownOneAwayNow;
      lastOpponentOneAway = false;
      updateCompetitiveMusicIntensity();
      return;
    }

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

    if (lastLeaderNumber !== null && leaderNumber !== lastLeaderNumber && leaderNumber !== 0) {
      var leaderName = leaderNumber === ownNumber ? getOwnNickname() : getOpponentNickname();
      showBattleToast(leaderName + " takes the lead.");
      playSound(leaderNumber === ownNumber ? "lead" : "lead-lost");
    }

    if (ownOneAwayNow && !lastOwnOneAway) {
      showBattleToast(getOwnNickname() + " is one merge away.");
    } else if (opponentOneAwayNow && !lastOpponentOneAway) {
      showBattleToast(getOpponentNickname() + " is one merge away.");
    }

    lastOwnOneAway = ownOneAwayNow;
    lastOpponentOneAway = opponentOneAwayNow;
    lastLeaderNumber = leaderNumber;
    updateCompetitiveMusicIntensity();
  };

  function opponentCellAt(x, y) {
    if (!opponentGrid || !opponentGrid.children) return null;
    var index = (Number(y) * 4) + Number(x);
    return opponentGrid.children[index] || null;
  }

  function clearOpponentMotionTiles() {
    if (!opponentGrid) return;
    var overlays = opponentGrid.querySelectorAll(".opponent-motion-tile");
    for (var i = 0; i < overlays.length; i++) {
      overlays[i].remove();
    }
  }

  function applyOpponentStateMeta(state) {
    if (!state) return;

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

    var opponentThemeName = THEMES.indexOf(state.theme) !== -1
      ? state.theme
      : "classic";

    if (opponentGrid) {
      opponentGrid.setAttribute("data-theme", opponentThemeName);
    }

    if (opponentPanelElement) {
      opponentPanelElement.setAttribute("data-opponent-theme", opponentThemeName);
    }

    if (opponentHighest) {
      opponentHighest.textContent = state.highestTile || 0;
    }

    if (opponentScoreDisplay) {
      opponentScoreDisplay.textContent = state.score || 0;
    }

    if (opponentStatus) {
      opponentStatus.innerHTML = state.over
        ? '<span class="finished"></span>Board finished'
        : '<span></span>Connected';
    }
  }

  function paintOpponentGrid(state, motion) {
    if (!opponentGrid || !state || !state.grid) return;

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

    if (!motion) return;

    var merges = Array.isArray(motion.merges) ? motion.merges : [];

    merges.forEach(function (merge) {
      var cell = merge && opponentCellAt(merge.x, merge.y);
      if (!cell) return;

      cell.classList.remove("opponent-cell-pop");
      void cell.offsetWidth;
      cell.classList.add("opponent-cell-pop");
    });

    if (motion.spawnedTile) {
      var spawned = opponentCellAt(
        motion.spawnedTile.x,
        motion.spawnedTile.y
      );

      if (spawned) {
        spawned.classList.remove("opponent-cell-spawn");
        void spawned.offsetWidth;
        spawned.classList.add("opponent-cell-spawn");
      }
    }
  }

  function commitOpponentState(state, motion) {
    var hadPreviousState = !!lastRenderedOpponentState;

    clearOpponentMotionTiles();
    applyOpponentStateMeta(state);
    paintOpponentGrid(state, motion || null);

    if (hadPreviousState && !motion && opponentGrid) {
      opponentGrid.classList.remove("opponent-grid-soft-refresh");
      void opponentGrid.offsetWidth;
      opponentGrid.classList.add("opponent-grid-soft-refresh");
    }

    lastRenderedOpponentState = state;
    window.updateMatchProgress(lastOwnHighest, lastOwnScore);
  }

  function opponentMotionIsUsable(state) {
    if (!state || !state.motion || !Array.isArray(state.motion.transitions)) {
      return false;
    }

    if (
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return false;
    }

    return state.motion.transitions.some(function (transition) {
      return transition &&
        transition.from &&
        transition.to &&
        (
          Number(transition.from.x) !== Number(transition.to.x) ||
          Number(transition.from.y) !== Number(transition.to.y)
        );
    });
  }

  function animateOpponentState(state, done) {
    if (
      !opponentGrid ||
      !lastRenderedOpponentState ||
      !opponentMotionIsUsable(state)
    ) {
      commitOpponentState(state, state && state.motion);
      done();
      return;
    }

    var motion = state.motion;
    var duration = Math.max(
      90,
      Math.min(140, Number(motion.duration || 105))
    );

    clearOpponentMotionTiles();

    var transitions = motion.transitions.filter(function (transition) {
      return transition &&
        transition.from &&
        transition.to &&
        (
          Number(transition.from.x) !== Number(transition.to.x) ||
          Number(transition.from.y) !== Number(transition.to.y)
        );
    });

    var overlays = [];
    var clearedSources = {};

    if (motion.removedTile) {
      var removedCell = opponentCellAt(
        Number(motion.removedTile.x),
        Number(motion.removedTile.y)
      );

      if (removedCell) {
        removedCell.className = "opponent-cell";
        removedCell.textContent = "";
      }
    }

    transitions.forEach(function (transition) {
      var fromX = Number(transition.from.x);
      var fromY = Number(transition.from.y);
      var toX = Number(transition.to.x);
      var toY = Number(transition.to.y);

      var fromCell = opponentCellAt(fromX, fromY);
      var toCell = opponentCellAt(toX, toY);

      if (!fromCell || !toCell) return;

      var sourceKey = fromX + ":" + fromY;

      if (!clearedSources[sourceKey]) {
        fromCell.className = "opponent-cell";
        fromCell.textContent = "";
        clearedSources[sourceKey] = true;
      }

      var overlay = document.createElement("div");
      overlay.className =
        "opponent-cell opponent-motion-tile has-tile tile-" +
        Number(transition.value || 2);
      overlay.textContent = Number(transition.value || 2);

      overlay.style.left = fromCell.offsetLeft + "px";
      overlay.style.top = fromCell.offsetTop + "px";
      overlay.style.width = fromCell.offsetWidth + "px";
      overlay.style.height = fromCell.offsetHeight + "px";
      overlay.style.transitionDuration = duration + "ms";

      opponentGrid.appendChild(overlay);

      overlays.push({
        element: overlay,
        dx: toCell.offsetLeft - fromCell.offsetLeft,
        dy: toCell.offsetTop - fromCell.offsetTop
      });
    });

    if (!overlays.length) {
      commitOpponentState(state, motion);
      done();
      return;
    }

    // One frame establishes the starting position. The second frame
    // starts the transform, mirroring the feel of the local 2048 tiles
    // instead of snapping between network snapshots.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        overlays.forEach(function (item) {
          item.element.style.transform =
            "translate3d(" + item.dx + "px," + item.dy + "px,0)";
        });
      });
    });

    opponentAnimationTimer = window.setTimeout(function () {
      opponentAnimationTimer = null;
      commitOpponentState(state, motion);
      done();
    }, duration + 22);
  }

  function processOpponentStateQueue() {
    if (
      opponentStateAnimating ||
      !opponentGrid ||
      !opponentStateQueue.length
    ) {
      return;
    }

    opponentStateAnimating = true;

    var nextState = opponentStateQueue.shift();

    animateOpponentState(nextState, function () {
      opponentStateAnimating = false;
      processOpponentStateQueue();
    });
  }

  function renderOpponentState(state) {
    if (!opponentGrid || !state || !state.grid) return;

    // The first received board should appear immediately. After that,
    // states are played in order so quick remote moves do not snap.
    if (!lastRenderedOpponentState && !opponentStateAnimating) {
      commitOpponentState(state, null);
      return;
    }

    opponentStateQueue.push(state);

    // Avoid letting a very fast remote player build seconds of visual lag.
    // Keep the next queued animation plus the newest state.
    if (opponentStateQueue.length > 4) {
      opponentStateQueue = [
        opponentStateQueue[0],
        opponentStateQueue[opponentStateQueue.length - 1]
      ];
    }

    processOpponentStateQueue();
  }

  function resetOpponentView() {
    latestOpponentState = null;
    lastRenderedOpponentState = null;
    opponentStateQueue = [];
    opponentStateAnimating = false;
    lastLeaderNumber = null;

    if (opponentAnimationTimer) {
      window.clearTimeout(opponentAnimationTimer);
      opponentAnimationTimer = null;
    }

    clearOpponentMotionTiles();

    if (opponentHighest) opponentHighest.textContent = "0";
    if (opponentScoreDisplay) opponentScoreDisplay.textContent = "0";
    if (opponentStatus) opponentStatus.innerHTML = '<span></span>Connected';

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
    var key = document.querySelector(".freeplay-battle .battle-board-foot .control-key-row:last-child kbd");
    if (!key) return;
    var enabled = !!window.multiplayerGame && !window.multiplayerGame.undoAnimating && !!window.multiplayerGame.freeplayUndoEntry;
    key.classList.toggle("disabled", !enabled);
    key.setAttribute("aria-disabled", enabled ? "false" : "true");
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

  window.showSoloGameOver = function (score, highest, best) {
    if (window.currentGameMode !== "solo" || window.multiplayerMode) return;
    var existing = document.getElementById("solo-gameover-overlay");
    if (existing) return;

    var overlay = document.createElement("div");
    overlay.id = "solo-gameover-overlay";
    overlay.className = "result-overlay direction-a-result solo-result";
    overlay.innerHTML = `
      <div class="result-box">
        <span class="result-kicker">ENDLESS SOLO</span>
        <h1>Game Over</h1>
        <div class="solo-result-stats">
          <div><span>FINAL SCORE</span><strong>${Number(score || 0).toLocaleString()}</strong></div>
          <div><span>HIGHEST</span><strong>${Number(highest || 0).toLocaleString()}</strong></div>
          <div><span>BEST</span><strong>${Number(best || 0).toLocaleString()}</strong></div>
        </div>
        <div class="result-actions">
          <button class="primary-button" id="solo-result-new">Start New Game</button>
          <button class="secondary-button" id="solo-result-back">Back to Solo</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.getElementById("solo-result-new").addEventListener("click", function () {
      overlay.remove();
      withGame(function (game) { game.restart(); });
    });
    document.getElementById("solo-result-back").addEventListener("click", function () {
      overlay.remove();
      showSoloMenu();
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
        <div class="result-icon result-icon-graphic">${uiIcon(didWin ? "win" : "loss", "result-graphic")}</div>
        <span class="result-kicker">${didWin ? "TARGET REACHED" : "MATCH ENDED"}</span><h1>${didWin ? "You Win" : "You Lost"}</h1>
        <p>${escapeHtml(description)}</p>
        <div class="result-actions">
          <button class="primary-button" id="result-rematch">Rematch</button>
          <button class="secondary-button" id="result-back">Back to Lobby</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    duckCompetitiveMusic();
    playSound(didWin ? "win" : "lose");

    document.getElementById("result-rematch").addEventListener("click", function () {
      playSound("rematch");
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
    duckCompetitiveMusic();
    playSound("disconnect");
    removeResultOverlay();
    removeFreeplayBoardOver();
    window.multiplayerGameOver = true;
    window.multiplayerMatchActive = false;

    var overlay = document.createElement("div");
    overlay.id = "result-overlay";
    overlay.className = "result-overlay";
    overlay.innerHTML = `
      <div class="result-box">
        <div class="result-icon result-icon-graphic">${uiIcon("disconnect", "result-graphic")}</div>
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
    var musicPercent = Math.round(Number(typeof window.rinasSettings.musicVolume === "number" ? window.rinasSettings.musicVolume : 0.42) * 100);

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
          <div class="settings-header-actions">
            <button class="settings-done-inline icon-text-button" id="settings-save">${uiIcon("save", "button-icon")}<span>Save</span></button>
          </div>
        </div>

        <div class="settings-grid-v40">
          <section class="settings-section settings-profile-section">
            <h3>Profile</h3>
            <div class="nickname-setting-centered">
              <label class="field-label" for="settings-nickname">Nickname</label>
              <input id="settings-nickname" class="nickname-field nickname-field-centered" type="text" maxlength="16" autocomplete="nickname" placeholder="Nickname" value="${escapeHtml(window.rinasSettings.nickname || "")}">
              <p class="settings-help">This is the name your opponent sees.</p>
            </div>
          </section>

          <section class="settings-section">
            <h3>Controls</h3>
            <p class="settings-help">Choose one keyboard movement scheme. Touch controls always use swipe.</p>
            <div class="control-choice-row control-choice-visual-row">
              <button class="control-choice control-choice-visual ${window.rinasSettings.controlScheme === "arrows" ? "selected" : ""}" data-controls="arrows">
                <span class="scheme-keys arrow-scheme"><kbd>↑</kbd><span><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span></span>
                <span class="scheme-name">Arrow Keys</span>
              </button>
              <button class="control-choice control-choice-visual ${window.rinasSettings.controlScheme === "wasd" ? "selected" : ""}" data-controls="wasd">
                <span class="scheme-keys wasd-scheme"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span>
                <span class="scheme-name">WASD</span>
              </button>
            </div>

            <div class="toggle-row settings-inline-toggle">
              <div>
                <h4>Solo Undo</h4>
                <p class="settings-help">Enable one-step Solo Undo. Press Z to rewind one successful move.</p>
              </div>
              <button id="solo-undo-toggle" class="toggle-button ${window.rinasSettings.soloUndo ? "on" : "off"}">${window.rinasSettings.soloUndo ? "ON" : "OFF"}</button>
            </div>
          </section>

          <section class="settings-section settings-audio-section">
            <h3>Sound</h3>
            <div class="settings-audio-stack-v63">
              <div class="audio-control-group">
                <div class="toggle-row">
                  <div>
                    <h4>Sound Effects</h4>
                    <p class="settings-help">Moves, merges, Undo, milestones and match results.</p>
                  </div>
                  <button id="sound-effects-toggle" class="toggle-button ${window.rinasSettings.soundEffects ? "on" : "off"}">${window.rinasSettings.soundEffects ? "ON" : "OFF"}</button>
                </div>
                <label class="volume-row" for="sfx-volume">
                  <span>SFX volume</span>
                  <input id="sfx-volume" type="range" min="0" max="100" step="1" value="${sfxPercent}" ${window.rinasSettings.soundEffects ? "" : "disabled"}>
                  <output id="sfx-volume-output">${sfxPercent}%</output>
                </label>
              </div>

              <div class="audio-control-group music-control-group-v63">
                <div class="toggle-row">
                  <div>
                    <h4>Background Music</h4>
                    <p class="settings-help">Lobby, Solo focus music and the Multiplayer layer.</p>
                  </div>
                  <button id="background-music-toggle" class="toggle-button ${window.rinasSettings.musicEnabled ? "on" : "off"}">${window.rinasSettings.musicEnabled ? "ON" : "OFF"}</button>
                </div>
                <label class="volume-row" for="music-volume">
                  <span>Music volume</span>
                  <input id="music-volume" type="range" min="0" max="100" step="1" value="${musicPercent}" ${window.rinasSettings.musicEnabled ? "" : "disabled"}>
                  <output id="music-volume-output">${musicPercent}%</output>
                </label>
              </div>
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
      closeOverlaySmoothly(overlay, function () {
        window.refreshSoloControls();
      });
    }

    document.getElementById("settings-save").addEventListener("click", close);
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
      document.getElementById("sfx-volume").disabled = !window.rinasSettings.soundEffects;
      if (window.rinasAudio && window.rinasAudio.setSfxEnabled) {
        window.rinasAudio.setSfxEnabled(window.rinasSettings.soundEffects);
      }
      if (window.rinasSettings.soundEffects) playSound("ui");
    });

    document.getElementById("sfx-volume").addEventListener("input", function () {
      var value = Math.max(0, Math.min(100, Number(this.value || 0)));
      window.rinasSettings.sfxVolume = value / 100;
      document.getElementById("sfx-volume-output").textContent = value + "%";
      saveSettings();
      if (window.rinasAudio && window.rinasAudio.setSfxVolume) {
        window.rinasAudio.setSfxVolume(window.rinasSettings.sfxVolume);
      }
    });

    document.getElementById("background-music-toggle").addEventListener("click", function () {
      window.rinasSettings.musicEnabled = !window.rinasSettings.musicEnabled;
      saveSettings();
      this.className = "toggle-button " + (window.rinasSettings.musicEnabled ? "on" : "off");
      this.textContent = window.rinasSettings.musicEnabled ? "ON" : "OFF";
      document.getElementById("music-volume").disabled = !window.rinasSettings.musicEnabled;
      if (window.rinasAudio && window.rinasAudio.setMusicEnabled) {
        window.rinasAudio.setMusicEnabled(window.rinasSettings.musicEnabled);
      }
    });

    document.getElementById("music-volume").addEventListener("input", function () {
      var value = Math.max(0, Math.min(100, Number(this.value || 0)));
      window.rinasSettings.musicVolume = value / 100;
      document.getElementById("music-volume-output").textContent = value + "%";
      saveSettings();
      if (window.rinasAudio && window.rinasAudio.setMusicVolume) {
        window.rinasAudio.setMusicVolume(window.rinasSettings.musicVolume);
      }
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

  function configureSupportFooter() {
    var support = document.getElementById("support-links");
    if (!support) return;

    var links = [];
    if (KOFI_URL) links.push('<a href="' + escapeHtml(KOFI_URL) + '" target="_blank" rel="noopener noreferrer">Ko-fi</a>');
    if (PAYPAL_URL) links.push('<a href="' + escapeHtml(PAYPAL_URL) + '" target="_blank" rel="noopener noreferrer">PayPal</a>');

    if (links.length) {
      support.innerHTML = ' · Support: ' + links.join(' · ');
      support.hidden = false;
    } else {
      support.hidden = true;
    }
  }

  configureSupportFooter();

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
    showPreMatchCountdown(data);
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



  // =========================================================
  // v44: viewport-fit, readable themes, compact settings,
  //      and game-first mode navigation
  // =========================================================

  var v44Style = document.createElement("style");
  v44Style.textContent = `
    /* Remove the decorative shine sweep from controls entirely. */
    button::after,
    .target-button::after,
    .control-choice::after,
    .toggle-button::after,
    .settings-done-inline::after {
      display: none !important;
      content: none !important;
    }

    /* Remove the floating circular ornament in multiplayer mode rows. */
    .mode-showcase::after {
      display: none !important;
      content: none !important;
    }

    /* Make type readable across every theme. */
    #app-root,
    .battle-shell,
    .settings-dialog,
    .result-box {
      font-size: 16px !important;
    }

    body.theme-ocean {
      --app-muted: #c2e8ef;
      --game-line: rgba(117, 226, 235, .30);
    }

    body.theme-candy {
      --app-muted: #f2c2df;
      --game-line: rgba(255, 139, 205, .30);
    }

    body.theme-midnight {
      --app-muted: #c8cff0;
      --game-line: rgba(166, 151, 255, .32);
    }

    .settings-help,
    .mode-showcase p,
    .battle-rule-line,
    .player-subline,
    #opponent-status {
      color: var(--app-muted) !important;
    }

    /* -----------------------------------------------------
       SETTINGS: one-screen desktop control deck
       ----------------------------------------------------- */
    .settings-overlay {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      overflow: hidden !important;
      padding: 14px !important;
    }

    .settings-dialog.settings-dialog-v40,
    #nickname-overlay .settings-dialog {
      width: min(980px, calc(100vw - 32px)) !important;
      max-width: 980px !important;
      max-height: calc(100vh - 28px) !important;
      overflow: hidden !important;
      margin: 0 auto !important;
      padding: 0 30px 24px !important;
      border: 1px solid var(--game-line) !important;
      border-top: 3px solid var(--app-accent) !important;
      border-radius: 14px !important;
      background: var(--game-panel-strong) !important;
      box-shadow: 0 26px 70px var(--app-shadow) !important;
    }

    .settings-dialog-header {
      position: static !important;
      margin: 0 -30px 18px !important;
      padding: 17px 30px 14px !important;
      min-height: 72px !important;
      border-bottom: 1px solid var(--game-line) !important;
      background: transparent !important;
      backdrop-filter: none !important;
    }

    .settings-dialog-header h2 {
      font-size: 30px !important;
    }

    .settings-kicker {
      font-size: 10px !important;
      letter-spacing: .13em !important;
    }

    .settings-header-actions {
      display: flex;
      align-items: center;
      gap: 18px;
    }

    .settings-done-inline,
    .close-settings {
      position: relative !important;
      width: auto !important;
      height: auto !important;
      min-height: 38px !important;
      padding: 8px 2px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-text) !important;
      font: 900 13px/1 var(--hud-display) !important;
      text-transform: uppercase !important;
    }

    .settings-done-inline {
      color: var(--app-accent) !important;
    }

    .close-settings {
      font-size: 25px !important;
      color: var(--app-muted) !important;
    }

    .settings-grid-v40 {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      grid-template-areas:
        "profile profile"
        "controls audio"
        "theme theme" !important;
      gap: 18px 42px !important;
    }

    .settings-profile-section { grid-area: profile !important; }
    .settings-grid-v40 > .settings-section:nth-child(2) { grid-area: controls !important; }
    .settings-audio-section { grid-area: audio !important; }
    .settings-theme-section { grid-area: theme !important; }

    .settings-section h3 {
      margin: 0 0 8px !important;
      padding-bottom: 6px !important;
      font-size: 19px !important;
    }

    .settings-help {
      margin: 0 0 9px !important;
      font-size: 14px !important;
      line-height: 1.32 !important;
    }

    .field-label {
      margin-bottom: 5px !important;
      font-size: 11px !important;
    }

    .nickname-field {
      min-height: 42px !important;
      height: 42px !important;
      padding: 8px 11px !important;
      font-size: 16px !important;
    }

    .control-choice-row {
      display: flex !important;
      gap: 24px !important;
      margin-bottom: 8px !important;
    }

    .control-choice {
      min-height: 34px !important;
      padding: 6px 1px 8px !important;
      border: 0 !important;
      border-bottom: 2px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-muted) !important;
      font-size: 13px !important;
      overflow: visible !important;
    }

    .control-choice.selected {
      border-bottom-color: var(--app-accent) !important;
      background: transparent !important;
      color: var(--app-text) !important;
      box-shadow: none !important;
    }

    .toggle-row.settings-inline-toggle,
    .audio-control-group .toggle-row {
      min-height: 66px !important;
      gap: 18px !important;
      align-items: center !important;
    }

    .toggle-row h4 {
      margin: 0 0 3px !important;
      font-size: 16px !important;
    }

    /* Switch treatment instead of another rectangular ON/OFF box. */
    .toggle-button {
      position: relative !important;
      flex: 0 0 54px !important;
      width: 54px !important;
      min-width: 54px !important;
      height: 28px !important;
      min-height: 28px !important;
      padding: 0 !important;
      border: 1px solid var(--game-line) !important;
      border-radius: 999px !important;
      background: var(--app-soft) !important;
      box-shadow: none !important;
      color: transparent !important;
      font-size: 0 !important;
      overflow: visible !important;
    }

    .toggle-button::before {
      content: "" !important;
      display: block !important;
      position: absolute !important;
      top: 3px !important;
      left: 3px !important;
      width: 20px !important;
      height: 20px !important;
      border-radius: 50% !important;
      background: var(--app-muted) !important;
      transition: transform 160ms ease, background 160ms ease !important;
    }

    .toggle-button.on {
      border-color: color-mix(in srgb, var(--app-accent) 75%, transparent) !important;
      background: color-mix(in srgb, var(--app-accent) 24%, var(--game-panel-strong)) !important;
    }

    .toggle-button.on::before {
      transform: translateX(26px) !important;
      background: var(--app-accent) !important;
    }

    .volume-row {
      grid-template-columns: 78px minmax(130px, 1fr) 48px !important;
      gap: 10px !important;
      margin-top: 4px !important;
      font-size: 13px !important;
    }

    .theme-grid {
      display: grid !important;
      grid-template-columns: repeat(5, minmax(0, 1fr)) !important;
      gap: 18px !important;
    }

    .theme-choice {
      min-height: 54px !important;
      padding: 5px 0 8px !important;
      border: 0 !important;
      border-bottom: 2px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-muted) !important;
      font-size: 12px !important;
      overflow: visible !important;
    }

    .theme-choice.selected {
      border-bottom-color: var(--app-accent) !important;
      color: var(--app-text) !important;
    }

    .theme-swatches {
      display: grid !important;
      grid-template-columns: repeat(5, 1fr) !important;
      gap: 3px !important;
      height: 12px !important;
      margin-top: 7px !important;
      border-radius: 0 !important;
      overflow: visible !important;
    }

    .theme-swatches i {
      min-height: 12px !important;
      border-radius: 2px !important;
    }

    .settings-footer {
      display: none !important;
    }

    /* -----------------------------------------------------
       MULTIPLAYER MODE MENU: lanes, not cards
       ----------------------------------------------------- */
    .screen-multiplayer-menu #screen-content {
      width: min(1060px, 100%) !important;
    }

    .mode-showcase-list {
      gap: 0 !important;
      border-top: 1px solid var(--game-line);
    }

    .mode-showcase {
      --mode-hue: var(--app-accent);
      min-height: 158px !important;
      grid-template-columns: minmax(0, 1fr) 300px !important;
      gap: 30px !important;
      padding: 20px 12px 20px 18px !important;
      border: 0 !important;
      border-bottom: 1px solid var(--game-line) !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: inset 3px 0 0 transparent !important;
      overflow: visible !important;
    }

    .mode-showcase:hover {
      transform: none !important;
      background: color-mix(in srgb, var(--mode-hue) 7%, transparent) !important;
      box-shadow: inset 3px 0 0 var(--mode-hue) !important;
    }

    .mode-showcase h2 {
      font-size: 32px !important;
    }

    .mode-showcase p {
      max-width: 620px !important;
      font-size: 16px !important;
      line-height: 1.35 !important;
    }

    .mode-showcase-action {
      margin-top: 12px !important;
      font-size: 14px !important;
    }

    .mode-showcase .ui-mini-board {
      box-shadow: none !important;
      transform: none !important;
    }

    .custom-target {
      min-height: 84px !important;
      border-radius: 0 !important;
      border-bottom: 2px solid var(--game-line) !important;
      background: transparent !important;
    }

    .custom-target.harder {
      transform: none !important;
    }

    /* -----------------------------------------------------
       ACTIVE SOLO: score/best are HUD stats, not dark cards
       ----------------------------------------------------- */
    body.solo-active .container {
      width: 540px !important;
      max-width: 540px !important;
      margin-top: 8px !important;
      padding: 10px 12px 12px !important;
      border: 0 !important;
      border-top: 3px solid var(--app-accent) !important;
      background: transparent !important;
      box-shadow: none !important;
    }

    body.solo-active .container .heading {
      min-height: 76px !important;
      display: grid !important;
      grid-template-columns: 1fr auto !important;
      align-items: center !important;
      gap: 20px !important;
      padding: 0 0 10px !important;
      border-bottom: 1px solid var(--game-line) !important;
    }

    body.solo-active .container .title {
      font-size: 40px !important;
      line-height: 1 !important;
    }

    body.solo-active .scores-container {
      display: grid !important;
      grid-template-columns: 112px 112px !important;
      gap: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      position: relative !important;
      display: flex !important;
      align-items: flex-end !important;
      justify-content: center !important;
      width: 112px !important;
      min-width: 112px !important;
      min-height: 66px !important;
      padding: 25px 12px 7px !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      color: var(--app-text) !important;
      font: 900 30px/1 var(--tile-font) !important;
    }

    body.solo-active .best-container {
      border-left: 1px solid var(--game-line) !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position: absolute !important;
      top: 7px !important;
      left: 0 !important;
      right: 0 !important;
      width: auto !important;
      color: var(--app-muted) !important;
      font: 800 10px/1 var(--hud-display) !important;
      letter-spacing: .09em !important;
    }

    .solo-card-actions {
      margin: 0 0 10px !important;
      padding: 8px 0 8px !important;
    }

    body.solo-active .game-container {
      margin-top: 0 !important;
    }

    #solo-control-strip {
      margin-top: 8px !important;
      padding-top: 8px !important;
      font-size: 11px !important;
    }

    /* Keep active match compact and readable. */
    .battle-shell {
      margin: 8px auto 0 !important;
      padding-bottom: 0 !important;
    }

    .battle-topbar {
      min-height: 68px !important;
      margin-bottom: 6px !important;
    }

    .battle-rule-line {
      margin: 4px auto 8px !important;
    }

    .battle-layout {
      margin-top: 0 !important;
    }

    /* Desktop height fitting. The board stays completely visible without page scroll. */
    @media (min-width: 901px) and (max-height: 920px) {
      body.solo-active #solo-toolbar {
        min-height: 68px !important;
        margin-bottom: 0 !important;
      }
      body.solo-active .container {
        zoom: .84;
      }
      .battle-layout {
        zoom: .86;
      }
    }

    @media (min-width: 901px) and (max-height: 790px) {
      body.solo-active .container {
        zoom: .75;
      }
      .battle-layout {
        zoom: .77;
      }
    }

    @media (max-width: 720px) {
      .settings-overlay {
        display: block !important;
        overflow-y: auto !important;
        padding: 8px !important;
      }
      .settings-dialog.settings-dialog-v40 {
        max-height: none !important;
        overflow: visible !important;
      }
      .settings-grid-v40 {
        grid-template-columns: 1fr !important;
        grid-template-areas: "profile" "controls" "audio" "theme" !important;
      }
      .theme-grid {
        grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
      }
      .mode-showcase {
        grid-template-columns: 1fr !important;
      }
      body.solo-active .container {
        width: min(500px, calc(100% - 18px)) !important;
        zoom: 1 !important;
      }
    }
  `;
  document.head.appendChild(v44Style);

  function fitActiveGameToViewport() {
    var isSolo = document.body.classList.contains("solo-active");
    var shell = document.querySelector(".battle-shell");
    var footer = document.getElementById("site-footer");

    document.body.classList.toggle("battle-fit-active", !!shell);

    if (gameHost) gameHost.style.zoom = "1";
    if (shell) shell.style.zoom = "1";

    if (window.innerWidth <= 900) {
      return;
    }

    // Active Solo is measured against the REAL space left between the
    // floating header and the fixed footer. This replaces the old
    // window.innerHeight - 8 estimate, which ignored the header/footer
    // and was the reason players had to zoom the browser out manually.
    if (isSolo && gameHost) {
      // Measure what is actually painted, including the board, action row and
      // bottom controls. scrollHeight was too optimistic because several legacy
      // 2048 elements use positioned descendants.
      gameHost.style.zoom = "1";

      var hostRect = gameHost.getBoundingClientRect();
      var hostTop = Math.max(0, hostRect.top);
      var naturalBottom = hostRect.bottom;
      var soloMeasured = gameHost.querySelectorAll(
        ".container, .heading, #solo-card-actions, .game-container, #solo-control-strip"
      );
      for (var sm = 0; sm < soloMeasured.length; sm++) {
        var smRect = soloMeasured[sm].getBoundingClientRect();
        if (smRect.bottom > naturalBottom) naturalBottom = smRect.bottom;
      }

      var naturalHeight = Math.max(1, naturalBottom - hostTop);
      // Reserve explicit breathing room for the fixed credit/footer.
      var safeBottom = window.innerHeight - 34;
      if (footer) safeBottom = Math.min(safeBottom, footer.getBoundingClientRect().top - 8);
      var availableHeight = Math.max(320, safeBottom - hostTop);
      var scale = Math.min(1, availableHeight / naturalHeight);

      // At desktop sizes the entire board and controls must fit at browser 100%.
      // Prefer fitting over preserving an arbitrary minimum scale.
      scale = Math.max(0.56, scale);
      gameHost.style.zoom = scale.toFixed(3);
    }

    if (shell) {
      // Direction A has its own responsive board sizes. Legacy shell zoom was
      // shrinking the three-column match and causing the opponent panel to wrap.
      if (shell.classList.contains("direction-a-battle")) {
        shell.style.zoom = "1";
      } else {
        var shellFooterTop = footer
          ? footer.getBoundingClientRect().top
          : window.innerHeight - 10;
        var shellTop = Math.max(0, shell.getBoundingClientRect().top);
        var shellAvailable = Math.max(360, shellFooterTop - shellTop - 10);
        var shellNatural = Math.max(1, shell.scrollHeight);
        var shellScale = Math.min(1, shellAvailable / shellNatural);
        shellScale = Math.max(0.68, shellScale);
        shell.style.zoom = shellScale.toFixed(3);
      }
    }
  }

  window.addEventListener("resize", function () {
    window.requestAnimationFrame(fitActiveGameToViewport);
  });

  var v44FitObserver = new MutationObserver(function () {
    window.requestAnimationFrame(function () {
      fitActiveGameToViewport();
    });
  });

  v44FitObserver.observe(document.body, {
    childList: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  window.setTimeout(fitActiveGameToViewport, 80);


  // =========================================================
  // v45: desktop game-flow polish
  // - no accidental page-scroll on desktop menus/matches
  // - stable hover targets (no edge shake)
  // - smooth nickname handoff
  // - game-HUD overlays instead of generic cards
  // - theme-colored segmented dividers
  // =========================================================

  var v45Style = document.createElement("style");
  v45Style.textContent = `
    /* -----------------------------------------------------
       DESKTOP VIEWPORT: use the available screen like a game
       ----------------------------------------------------- */
    @media (min-width: 901px) {
      html, body {
        min-height: 100% !important;
      }

      body:not(.solo-active):not(.battle-fit-active) {
        overflow: hidden !important;
      }

      .app-screen {
        height: 100vh !important;
        min-height: 0 !important;
        overflow: hidden !important;
        padding: 10px 20px 14px !important;
      }

      .app-screen-inner {
        height: 100% !important;
        min-height: 0 !important;
        display: flex !important;
        flex-direction: column !important;
      }

      #screen-content {
        min-height: 0 !important;
        flex: 1 1 auto !important;
      }

      .app-header {
        min-height: 66px !important;
        margin-bottom: 10px !important;
        padding: 5px 0 8px !important;
        flex: 0 0 auto !important;
      }

      .screen-menu .title-stage {
        min-height: 205px !important;
        margin-bottom: 8px !important;
      }

      .screen-menu .home-mode-stack {
        margin-top: 10px !important;
        gap: 10px !important;
      }

      .screen-menu .home-brush-button {
        min-height: 76px !important;
        padding-top: 11px !important;
        padding-bottom: 11px !important;
      }

      .screen-menu .home-controls-ribbon {
        margin-top: 12px !important;
        padding-top: 8px !important;
        padding-bottom: 8px !important;
      }

      .screen-menu .home-footnote {
        margin-top: 9px !important;
      }

      .screen-multiplayer-menu #screen-content,
      .screen-solo-menu #screen-content {
        overflow: hidden !important;
      }
    }

    /* -----------------------------------------------------
       DIVIDERS: color/competition rather than gray web rules
       ----------------------------------------------------- */
    .app-header,
    .solo-floating-header,
    .battle-topbar {
      border-bottom: 0 !important;
    }

    .app-header::after,
    .solo-floating-header::after,
    .battle-topbar::after {
      left: 0 !important;
      right: 0 !important;
      bottom: -1px !important;
      width: 100% !important;
      height: 3px !important;
      transform: none !important;
      opacity: .92 !important;
      background:
        linear-gradient(90deg,
          transparent 0%,
          transparent 4%,
          color-mix(in srgb, var(--app-accent) 28%, transparent) 4%,
          color-mix(in srgb, var(--app-accent) 28%, transparent) 35%,
          var(--app-accent) 43%,
          var(--game-accent-2) 57%,
          color-mix(in srgb, var(--app-accent) 28%, transparent) 65%,
          color-mix(in srgb, var(--app-accent) 28%, transparent) 96%,
          transparent 96%,
          transparent 100%) !important;
    }

    .settings-section h3,
    .race-rules h2,
    .race-box h2 {
      border-bottom: 0 !important;
      position: relative !important;
      padding-bottom: 9px !important;
    }

    .settings-section h3::after,
    .race-rules h2::after,
    .race-box h2::after {
      content: "";
      position: absolute;
      left: 0;
      bottom: 0;
      width: 68px;
      height: 3px;
      background: linear-gradient(90deg, var(--app-accent), var(--game-accent-2));
    }

    /* -----------------------------------------------------
       STABLE HOVER: feedback without moving the hit target
       ----------------------------------------------------- */
    .home-brush-button,
    .mode-showcase,
    .ui-mini-board,
    .ui-mini-cell,
    .theme-choice,
    .control-choice {
      transform: none !important;
    }

    @media (hover:hover) and (pointer:fine) {
      .home-brush-button:hover,
      .mode-showcase:hover,
      .theme-choice:hover,
      .control-choice:hover {
        transform: none !important;
      }

      .home-brush-button:hover {
        filter: brightness(1.035) saturate(1.025) !important;
      }

      .home-brush-button:hover .brush-arrow,
      .mode-showcase:hover .mode-showcase-action {
        transform: translateX(4px) !important;
      }

      .mode-showcase:hover .ui-mini-board,
      .mode-showcase:hover .ui-mini-cell {
        transform: none !important;
      }
    }

    /* -----------------------------------------------------
       SETTINGS: desktop HUD deck, never a tall modal card
       ----------------------------------------------------- */
    .settings-overlay {
      padding: 10px !important;
      background: color-mix(in srgb, #000 58%, transparent) !important;
      backdrop-filter: blur(8px) !important;
      animation: overlay-in-v45 160ms ease both;
    }

    @keyframes overlay-in-v45 {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes hud-deck-in-v45 {
      from { opacity: 0; transform: translateY(10px) scale(.992); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    @keyframes overlay-out-v45 {
      to { opacity: 0; }
    }

    @keyframes hud-deck-out-v45 {
      to { opacity: 0; transform: translateY(-8px) scale(.993); }
    }

    .settings-overlay.ui-overlay-leaving {
      animation: overlay-out-v45 190ms ease both !important;
      pointer-events: none !important;
    }

    .settings-overlay.ui-overlay-leaving .settings-dialog {
      animation: hud-deck-out-v45 190ms ease both !important;
    }

    .settings-dialog.settings-dialog-v40,
    #nickname-overlay .settings-dialog {
      animation: hud-deck-in-v45 180ms cubic-bezier(.2,.8,.2,1) both !important;
      border-radius: 0 !important;
      border: 0 !important;
      border-left: 4px solid var(--app-accent) !important;
      border-right: 4px solid var(--game-accent-2) !important;
      box-shadow: 0 24px 70px var(--app-shadow) !important;
      background:
        linear-gradient(110deg,
          color-mix(in srgb, var(--app-accent) 7%, var(--game-panel-strong)),
          var(--game-panel-strong) 42%,
          color-mix(in srgb, var(--game-accent-2) 6%, var(--game-panel-strong))) !important;
    }

    .settings-dialog.settings-dialog-v40::before,
    #nickname-overlay .settings-dialog::before {
      content: "";
      position: absolute;
      left: 20px;
      right: 20px;
      top: 0;
      height: 3px;
      background: linear-gradient(90deg, var(--app-accent), var(--game-accent-2));
      pointer-events: none;
    }

    @media (min-width: 901px) {
      .settings-overlay {
        overflow: hidden !important;
      }

      .settings-dialog.settings-dialog-v40 {
        width: min(1060px, calc(100vw - 54px)) !important;
        max-width: 1060px !important;
        height: auto !important;
        max-height: min(610px, calc(100vh - 22px)) !important;
        overflow: hidden !important;
        padding: 0 26px 18px !important;
      }

      .settings-dialog-header {
        min-height: 60px !important;
        margin: 0 -26px 12px !important;
        padding: 12px 26px 10px !important;
      }

      .settings-dialog-header h2 {
        font-size: 27px !important;
      }

      .settings-grid-v40 {
        display: grid !important;
        grid-template-columns: 1.15fr .95fr 1.2fr !important;
        grid-template-areas:
          "profile profile profile"
          "controls audio theme" !important;
        gap: 12px 30px !important;
        align-items: start !important;
      }

      .settings-profile-section { grid-area: profile !important; }
      .settings-grid-v40 > .settings-section:nth-child(2) { grid-area: controls !important; }
      .settings-audio-section { grid-area: audio !important; }
      .settings-theme-section { grid-area: theme !important; }

      .settings-section h3 {
        margin-bottom: 7px !important;
        font-size: 18px !important;
      }

      .settings-help {
        margin-bottom: 7px !important;
        font-size: 13px !important;
        line-height: 1.28 !important;
      }

      .nickname-field {
        height: 38px !important;
        min-height: 38px !important;
      }

      .toggle-row.settings-inline-toggle,
      .audio-control-group .toggle-row {
        min-height: 56px !important;
      }

      .theme-grid {
        grid-template-columns: 1fr !important;
        gap: 2px !important;
      }

      .theme-choice {
        min-height: 35px !important;
        display: grid !important;
        grid-template-columns: 82px 1fr !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 5px 0 !important;
        text-align: left !important;
      }

      .theme-swatches {
        margin-top: 0 !important;
        height: 11px !important;
      }

      #nickname-overlay .settings-dialog {
        width: min(720px, calc(100vw - 52px)) !important;
        max-width: 720px !important;
        min-height: 0 !important;
        max-height: none !important;
        padding: 0 34px 26px !important;
        overflow: visible !important;
      }

      #nickname-overlay .settings-dialog-header {
        margin: 0 -34px 16px !important;
        padding-left: 34px !important;
        padding-right: 34px !important;
      }

      #nickname-overlay .result-actions {
        margin-top: 14px !important;
      }
    }

    /* -----------------------------------------------------
       MODE SELECTOR: game lanes, not rounded cards
       ----------------------------------------------------- */
    .screen-multiplayer-menu .multiplayer-entry-head {
      margin: 0 0 8px !important;
      min-height: 28px !important;
    }

    .mode-showcase-list {
      border-top: 0 !important;
      display: grid !important;
      gap: 4px !important;
    }

    .mode-showcase {
      position: relative !important;
      min-height: 122px !important;
      grid-template-columns: minmax(0, 1fr) 250px !important;
      gap: 22px !important;
      padding: 14px 14px 14px 18px !important;
      border: 0 !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      background:
        linear-gradient(90deg,
          color-mix(in srgb, var(--mode-hue) 10%, transparent) 0%,
          color-mix(in srgb, var(--mode-hue) 4%, transparent) 54%,
          transparent 100%) !important;
      overflow: hidden !important;
    }

    .mode-showcase::before {
      content: "" !important;
      display: block !important;
      position: absolute !important;
      left: 0 !important;
      top: 12px !important;
      bottom: 12px !important;
      width: 4px !important;
      background: var(--mode-hue) !important;
      pointer-events: none !important;
    }

    .mode-showcase + .mode-showcase {
      border-top: 0 !important;
    }

    .mode-showcase-copy {
      align-self: center !important;
    }

    .mode-showcase h2 {
      margin: 3px 0 3px !important;
      font-size: 28px !important;
    }

    .mode-showcase p {
      margin-bottom: 6px !important;
      font-size: 14px !important;
      line-height: 1.28 !important;
    }

    .mode-showcase-index,
    .mode-showcase-facts,
    .mode-showcase-action {
      font-size: 11px !important;
    }

    .mode-showcase-action {
      display: inline-block !important;
      transition: color 150ms ease, transform 150ms ease !important;
    }

    .mode-showcase-preview {
      align-self: center !important;
      max-height: 104px !important;
      overflow: hidden !important;
    }

    .mode-showcase .ui-mini-board {
      max-height: 102px !important;
      width: auto !important;
    }

    .future-modes-strip {
      margin-top: 7px !important;
      padding-top: 6px !important;
      border-top: 0 !important;
      color: var(--app-muted) !important;
      background:
        linear-gradient(90deg,
          var(--app-accent) 0 42px,
          transparent 42px 54px,
          var(--game-accent-2) 54px 96px,
          transparent 96px) left top / 120px 2px no-repeat !important;
    }

    @media (min-width: 901px) and (max-height: 820px) {
      .screen-multiplayer-menu .app-header {
        min-height: 58px !important;
      }

      .mode-showcase {
        min-height: 108px !important;
        grid-template-columns: minmax(0, 1fr) 220px !important;
        padding-top: 10px !important;
        padding-bottom: 10px !important;
      }

      .mode-showcase h2 { font-size: 25px !important; }
      .mode-showcase-preview { max-height: 90px !important; }
      .mode-showcase .ui-mini-board { max-height: 88px !important; }
    }

    /* -----------------------------------------------------
       SOLO ENTRY: less blank air, board preview floats
       ----------------------------------------------------- */
    .solo-launch-v43 {
      gap: 38px !important;
      margin-top: 14px !important;
      align-items: center !important;
    }

    .solo-launch-copy h2 {
      font-size: clamp(38px, 4vw, 54px) !important;
      margin-top: 7px !important;
    }

    .solo-launch-copy > p {
      margin-bottom: 18px !important;
      font-size: 16px !important;
    }

    .solo-preview-stage {
      width: 340px !important;
      min-height: 0 !important;
      padding: 12px !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }

    .solo-preview-stage::before,
    .preview-orbit {
      display: none !important;
    }

    .solo-preview-stage .ui-mini-board {
      width: 300px !important;
      margin: 0 auto !important;
      border-radius: 12px !important;
      box-shadow: 0 12px 34px var(--app-shadow) !important;
    }

    .solo-preview-heading,
    .solo-preview-caption {
      width: 300px !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }

    /* -----------------------------------------------------
       ACTIVE SOLO + MATCH: guaranteed no desktop page scroll
       ----------------------------------------------------- */
    @media (min-width: 901px) {
      body.solo-active,
      body.battle-fit-active {
        height: 100vh !important;
        overflow: hidden !important;
      }

      body.solo-active #game-host,
      body.battle-fit-active .battle-shell {
        max-height: 100vh !important;
      }

      body.solo-active .scores-container {
        grid-template-columns: 128px 128px !important;
        gap: 14px !important;
      }

      body.solo-active .score-container,
      body.solo-active .best-container {
        width: 128px !important;
        min-width: 128px !important;
        min-height: 70px !important;
        padding-top: 29px !important;
        padding-bottom: 7px !important;
      }

      body.solo-active .best-container {
        border-left: 0 !important;
      }

      body.solo-active .score-container,
      body.solo-active .best-container {
        border-bottom: 3px solid color-mix(in srgb, var(--app-accent) 38%, transparent) !important;
      }
    }

    /* Mobile retains natural document scrolling. */
    @media (max-width: 900px) {
      body,
      body.solo-active,
      body.battle-fit-active {
        height: auto !important;
        overflow-y: auto !important;
      }

      .app-screen {
        height: auto !important;
        min-height: 100vh !important;
        overflow: visible !important;
      }

      .settings-overlay {
        overflow-y: auto !important;
      }
    }
  `;
  document.head.appendChild(v45Style);

  // Reset inherited scroll position whenever the app changes modes.
  var v45ScrollObserver = new MutationObserver(function () {
    window.requestAnimationFrame(function () {
      if (window.innerWidth > 900) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    });
  });

  v45ScrollObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: false
  });


  // =========================================================
  // v46: cohesive adult-game UI polish
  // - visual control schemes
  // - rounded game modals / no browser confirms
  // - stable mode previews + restored motion
  // - rebuilt Solo HUD spacing
  // - viewport-fit desktop gameplay
  // =========================================================

  var v46Style = document.createElement("style");
  v46Style.textContent = `
    :root {
      --v46-radius-lg: 20px;
      --v46-radius-md: 14px;
      --v46-radius-sm: 10px;
      --v46-ease: cubic-bezier(.2,.82,.2,1);
    }

    /* -------------------- screen motion -------------------- */
    @keyframes v46-screen-in-forward {
      from { opacity: 0; transform: translate3d(24px,0,0) scale(.992); }
      to { opacity: 1; transform: translate3d(0,0,0) scale(1); }
    }
    @keyframes v46-screen-in-back {
      from { opacity: 0; transform: translate3d(-24px,0,0) scale(.992); }
      to { opacity: 1; transform: translate3d(0,0,0) scale(1); }
    }
    @keyframes v46-screen-out-forward {
      from { opacity: 1; transform: translate3d(0,0,0) scale(1); }
      to { opacity: 0; transform: translate3d(-20px,0,0) scale(.995); }
    }
    @keyframes v46-screen-out-back {
      from { opacity: 1; transform: translate3d(0,0,0) scale(1); }
      to { opacity: 0; transform: translate3d(20px,0,0) scale(.995); }
    }

    .app-screen.enter-forward { animation: v46-screen-in-forward 300ms var(--v46-ease) both !important; }
    .app-screen.enter-back { animation: v46-screen-in-back 300ms var(--v46-ease) both !important; }
    .screen-ghost.forward { animation: v46-screen-out-forward 300ms var(--v46-ease) both !important; }
    .screen-ghost.back { animation: v46-screen-out-back 300ms var(--v46-ease) both !important; }

    /* -------------------- common game controls -------------------- */
    .nav-button,
    .settings-button,
    .nickname-link {
      border-radius: 10px !important;
      padding: 9px 12px !important;
      min-height: 38px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 72%, transparent) !important;
      border: 1px solid color-mix(in srgb, var(--game-line) 85%, transparent) !important;
      box-shadow: 0 6px 16px color-mix(in srgb, var(--app-shadow) 50%, transparent) !important;
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease !important;
    }
    .nav-button:hover,
    .settings-button:hover,
    .nickname-link:hover {
      transform: none !important;
      border-color: color-mix(in srgb, var(--app-accent) 65%, var(--game-line)) !important;
      background: color-mix(in srgb, var(--app-accent) 10%, var(--game-panel-strong)) !important;
      box-shadow: 0 8px 20px color-mix(in srgb, var(--app-shadow) 65%, transparent) !important;
    }
    .nav-button::after,
    .settings-button::after,
    .nickname-link::after { display: none !important; }

    /* Replace gray divider language with restrained theme accent. */
    .app-header,
    .solo-floating-header,
    .battle-topbar {
      border-bottom: 0 !important;
      background-image: linear-gradient(90deg,
        transparent 0%,
        color-mix(in srgb, var(--app-accent) 38%, transparent) 18%,
        color-mix(in srgb, var(--game-accent-2) 44%, transparent) 50%,
        color-mix(in srgb, var(--app-accent) 38%, transparent) 82%,
        transparent 100%) !important;
      background-repeat: no-repeat !important;
      background-size: 100% 2px !important;
      background-position: left bottom !important;
    }
    .app-header::after,
    .solo-floating-header::after,
    .battle-topbar::after { display: none !important; }

    /* -------------------- game modal system -------------------- */
    @keyframes v46-overlay-in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes v46-modal-in {
      from { opacity: 0; transform: translateY(12px) scale(.975); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes v46-overlay-out { to { opacity: 0; } }
    @keyframes v46-modal-out { to { opacity: 0; transform: translateY(8px) scale(.985); } }

    .settings-overlay,
    .game-modal-overlay {
      position: fixed !important;
      inset: 0 !important;
      z-index: 12000 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 20px !important;
      background: rgba(18, 17, 17, .56) !important;
      backdrop-filter: blur(10px) saturate(.82) !important;
      overflow: hidden !important;
      animation: v46-overlay-in 180ms ease both !important;
    }
    .settings-overlay.ui-overlay-leaving,
    .game-modal-overlay.ui-overlay-leaving { animation: v46-overlay-out 210ms ease both !important; }
    .settings-overlay.ui-overlay-leaving > *,
    .game-modal-overlay.ui-overlay-leaving > * { animation: v46-modal-out 210ms ease both !important; }

    .game-modal {
      position: relative;
      width: min(540px, calc(100vw - 36px));
      padding: 30px 32px 28px;
      border: 1px solid color-mix(in srgb, var(--app-accent) 25%, var(--game-line));
      border-radius: var(--v46-radius-lg);
      background:
        radial-gradient(circle at 88% 8%, color-mix(in srgb, var(--game-accent-2) 10%, transparent), transparent 30%),
        var(--game-panel-strong);
      color: var(--app-text);
      box-shadow: 0 28px 80px rgba(0,0,0,.28);
      animation: v46-modal-in 240ms var(--v46-ease) both;
      overflow: hidden;
    }
    .game-modal-accent {
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 4px;
      background: linear-gradient(90deg, var(--app-accent), var(--game-accent-2));
    }
    .game-modal-kicker {
      display: block;
      margin-bottom: 7px;
      color: var(--app-accent);
      font: 800 11px/1 var(--hud-display);
      letter-spacing: .12em;
    }
    .game-modal h2 {
      margin: 0 0 9px;
      font: 900 30px/1.05 var(--hud-display);
      color: var(--app-text);
    }
    .game-modal > p,
    .nickname-modal-copy {
      margin: 0 0 20px;
      color: var(--app-muted);
      font: 600 15px/1.45 var(--ui-font);
    }
    .game-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 22px;
    }
    .game-modal-button {
      min-width: 132px;
      min-height: 44px;
      padding: 10px 18px;
      border: 1px solid var(--game-line);
      border-radius: 12px;
      font: 900 14px/1 var(--hud-display);
      text-transform: uppercase;
      letter-spacing: .02em;
      transition: background 150ms ease, border-color 150ms ease, box-shadow 150ms ease;
    }
    .game-modal-button.secondary {
      color: var(--app-text);
      background: color-mix(in srgb, var(--game-panel) 80%, transparent);
    }
    .game-modal-button.primary {
      color: var(--button-text, #fff);
      border-color: var(--app-accent);
      background: var(--app-accent);
      box-shadow: 0 8px 22px color-mix(in srgb, var(--app-accent) 28%, transparent);
    }
    .game-modal-button.primary.danger {
      background: #b94b55;
      border-color: #b94b55;
    }
    .game-modal-button:hover { box-shadow: 0 10px 24px color-mix(in srgb, var(--app-shadow) 70%, transparent); }

    .nickname-modal { width: min(520px, calc(100vw - 36px)); text-align: center; }
    .nickname-input-stage {
      display: grid;
      justify-items: center;
      gap: 8px;
      margin: 16px auto 0;
    }
    .nickname-input-stage > span {
      color: var(--app-muted);
      font: 800 10px/1 var(--hud-display);
      letter-spacing: .12em;
    }
    .nickname-field-centered {
      width: 300px !important;
      max-width: 100% !important;
      min-height: 46px !important;
      text-align: center !important;
      border-radius: 11px !important;
      font-size: 18px !important;
      font-weight: 800 !important;
      letter-spacing: .02em !important;
    }
    .nickname-modal .status-text { min-height: 20px; margin: 9px 0 0; text-align: center; }
    .nickname-modal .game-modal-actions { justify-content: center; }

    /* -------------------- settings -------------------- */
    .settings-dialog.settings-dialog-v40 {
      width: min(980px, calc(100vw - 40px)) !important;
      max-width: 980px !important;
      max-height: min(640px, calc(100vh - 40px)) !important;
      padding: 0 28px 24px !important;
      overflow: hidden !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 24%, var(--game-line)) !important;
      border-radius: 20px !important;
      background:
        radial-gradient(circle at 94% 0%, color-mix(in srgb, var(--game-accent-2) 8%, transparent), transparent 26%),
        var(--game-panel-strong) !important;
      box-shadow: 0 30px 90px rgba(0,0,0,.30) !important;
      animation: v46-modal-in 240ms var(--v46-ease) both !important;
    }
    .settings-dialog.settings-dialog-v40::before { border-radius: 20px 20px 0 0 !important; }
    .settings-dialog-header {
      margin: 0 -28px 16px !important;
      padding: 16px 28px 13px !important;
      min-height: 68px !important;
      border-bottom: 0 !important;
      background: color-mix(in srgb, var(--game-panel) 65%, transparent) !important;
    }
    .settings-dialog-header h2 { font-size: 29px !important; }
    .settings-header-actions { gap: 9px !important; }
    .settings-done-inline,
    .close-settings {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      min-height: 42px !important;
      border-radius: 11px !important;
      border: 1px solid var(--game-line) !important;
      box-shadow: none !important;
    }
    .settings-done-inline {
      min-width: 88px !important;
      padding: 9px 16px !important;
      background: var(--app-accent) !important;
      border-color: var(--app-accent) !important;
      color: var(--button-text, #fff) !important;
    }
    .close-settings {
      width: 42px !important;
      min-width: 42px !important;
      padding: 0 !important;
      background: color-mix(in srgb, var(--game-panel) 82%, transparent) !important;
      color: var(--app-text) !important;
      font-size: 23px !important;
    }
    .settings-done-inline:hover,
    .close-settings:hover { transform: none !important; border-color: var(--app-accent) !important; }

    .settings-grid-v40 {
      grid-template-columns: 1.08fr .92fr .98fr !important;
      grid-template-areas:
        "profile profile profile"
        "controls audio theme" !important;
      gap: 14px 26px !important;
    }
    .settings-section {
      min-width: 0;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    .settings-section h3 {
      margin: 0 0 9px !important;
      padding: 0 !important;
      border: 0 !important;
      font-size: 18px !important;
    }
    .settings-section h3::after {
      content: "";
      display: block;
      width: 44px;
      height: 3px;
      margin-top: 6px;
      border-radius: 3px;
      background: linear-gradient(90deg, var(--app-accent), var(--game-accent-2));
    }
    .settings-help { font-size: 12.5px !important; line-height: 1.28 !important; margin: 0 0 8px !important; }
    .nickname-setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      min-height: 52px;
      padding: 8px 0 12px;
    }
    .nickname-setting-copy { min-width: 0; }
    .nickname-setting-copy .settings-help { margin: 4px 0 0 !important; }
    .settings-profile-section .nickname-field {
      width: 300px !important;
      max-width: 300px !important;
      flex: 0 0 300px !important;
      height: 42px !important;
      text-align: center !important;
      border-radius: 11px !important;
    }

    .control-choice-visual-row {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 10px !important;
      margin: 7px 0 12px !important;
    }
    .control-choice.control-choice-visual {
      min-height: 112px !important;
      padding: 12px 9px 10px !important;
      border: 1px solid var(--game-line) !important;
      border-radius: 14px !important;
      background: color-mix(in srgb, var(--game-panel) 74%, transparent) !important;
      color: var(--app-muted) !important;
      box-shadow: 0 7px 18px color-mix(in srgb, var(--app-shadow) 35%, transparent) !important;
      display: flex !important;
      flex-direction: column !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 9px !important;
    }
    .control-choice.control-choice-visual.selected {
      border-color: color-mix(in srgb, var(--app-accent) 72%, var(--game-line)) !important;
      background: color-mix(in srgb, var(--app-accent) 12%, var(--game-panel-strong)) !important;
      color: var(--app-text) !important;
      box-shadow: 0 9px 24px color-mix(in srgb, var(--app-accent) 18%, transparent) !important;
    }
    .scheme-keys {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
    }
    .scheme-keys > span { display: flex; gap: 3px; }
    .scheme-keys kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 27px;
      height: 27px;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: color-mix(in srgb, var(--game-panel-strong) 80%, transparent);
      color: inherit;
      box-shadow: inset 0 -2px 0 color-mix(in srgb, currentColor 18%, transparent);
      font: 800 12px/1 var(--hud-display);
    }
    .scheme-name { font: 900 13px/1 var(--hud-display); }

    .toggle-row.settings-inline-toggle,
    .audio-control-group .toggle-row { min-height: 54px !important; }
    .volume-row { margin-top: 9px !important; }

    .theme-grid {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 5px !important;
    }
    .theme-choice {
      position: relative !important;
      display: grid !important;
      grid-template-columns: 72px minmax(0,1fr) !important;
      align-items: center !important;
      min-height: 38px !important;
      padding: 4px 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      text-align: left !important;
      color: var(--app-muted) !important;
    }
    .theme-choice.selected { color: var(--app-text) !important; }
    .theme-choice.selected::before {
      content: "";
      position: absolute;
      left: -8px;
      width: 3px;
      height: 22px;
      border-radius: 2px;
      background: var(--app-accent);
    }
    .theme-swatches { margin: 0 !important; height: 13px !important; }
    .theme-swatches i { border-radius: 3px !important; }

    /* -------------------- mode selector -------------------- */
    .screen-multiplayer-menu .app-screen-inner { width: min(1080px, calc(100% - 52px)) !important; }
    .screen-multiplayer-menu .multiplayer-entry-head { margin-bottom: 10px !important; }
    .mode-showcase-list {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 12px !important;
      border: 0 !important;
    }
    .mode-showcase {
      min-height: 164px !important;
      grid-template-columns: minmax(0, 1fr) 330px !important;
      gap: 28px !important;
      padding: 20px 22px !important;
      border: 1px solid color-mix(in srgb, var(--mode-hue) 24%, var(--game-line)) !important;
      border-radius: 18px !important;
      background:
        radial-gradient(circle at 90% 12%, color-mix(in srgb, var(--mode-hue) 10%, transparent), transparent 30%),
        color-mix(in srgb, var(--game-panel-strong) 92%, transparent) !important;
      box-shadow: 0 10px 30px color-mix(in srgb, var(--app-shadow) 36%, transparent) !important;
      overflow: visible !important;
      transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease !important;
    }
    .mode-showcase::before {
      top: 18px !important;
      bottom: 18px !important;
      left: 0 !important;
      width: 4px !important;
      border-radius: 0 4px 4px 0 !important;
    }
    .mode-showcase:hover {
      transform: none !important;
      border-color: color-mix(in srgb, var(--mode-hue) 58%, var(--game-line)) !important;
      box-shadow: 0 14px 34px color-mix(in srgb, var(--mode-hue) 14%, var(--app-shadow)) !important;
    }
    .mode-showcase h2 { margin: 4px 0 5px !important; font-size: 30px !important; }
    .mode-showcase p { font-size: 15px !important; line-height: 1.34 !important; margin-bottom: 8px !important; }
    .mode-showcase-index { font-size: 11px !important; }
    .mode-showcase-facts { font-size: 11px !important; }
    .mode-showcase-action { margin-top: 10px !important; font-size: 13px !important; color: var(--mode-hue) !important; }
    .mode-showcase-preview {
      min-height: 124px !important;
      max-height: none !important;
      overflow: visible !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      padding: 8px !important;
      border-radius: 14px !important;
      background: color-mix(in srgb, var(--mode-hue) 6%, var(--game-panel)) !important;
    }
    .mode-showcase .ui-mini-board {
      width: 116px !important;
      height: 116px !important;
      max-height: none !important;
      border-radius: 10px !important;
      overflow: hidden !important;
    }
    .mode-visual-pair { gap: 12px !important; }
    .mode-freeplay-visual { gap: 18px !important; }
    .mode-custom-visual { gap: 12px !important; }
    .custom-target {
      min-width: 112px !important;
      min-height: 88px !important;
      border: 1px solid color-mix(in srgb, var(--mode-hue) 30%, var(--game-line)) !important;
      border-radius: 12px !important;
      background: color-mix(in srgb, var(--mode-hue) 8%, var(--game-panel-strong)) !important;
    }
    .mode-showcase:hover .ui-mini-cell.filled {
      animation: v46-preview-pop 850ms var(--v46-ease) both;
    }
    .mode-showcase:hover .ui-mini-cell.filled:nth-child(3n+1) { animation-delay: 35ms; }
    .mode-showcase:hover .ui-mini-cell.filled:nth-child(3n+2) { animation-delay: 85ms; }
    .mode-showcase:hover .ui-mini-cell.filled:nth-child(3n) { animation-delay: 135ms; }
    @keyframes v46-preview-pop {
      0% { transform: scale(1); }
      45% { transform: scale(1.07); }
      100% { transform: scale(1); }
    }
    .future-modes-strip { margin-top: 10px !important; }

    /* -------------------- game lobbies -------------------- */
    .rules-card,
    .race-box,
    .waiting-card,
    .result-box {
      border: 1px solid color-mix(in srgb, var(--app-accent) 20%, var(--game-line)) !important;
      border-radius: 18px !important;
      background:
        radial-gradient(circle at 100% 0%, color-mix(in srgb, var(--game-accent-2) 7%, transparent), transparent 32%),
        color-mix(in srgb, var(--game-panel-strong) 92%, transparent) !important;
      box-shadow: 0 12px 32px color-mix(in srgb, var(--app-shadow) 38%, transparent) !important;
    }
    .primary-button,
    .target-button,
    .small-button,
    .result-actions button {
      border-radius: 11px !important;
    }
    .room-input { border-radius: 11px !important; }

    /* -------------------- Solo entry -------------------- */
    .solo-launch-v43 {
      max-width: 980px !important;
      margin: 12px auto 0 !important;
      gap: 42px !important;
      align-items: center !important;
    }
    .solo-launch-copy h2 { font-size: clamp(42px, 4vw, 58px) !important; line-height: .98 !important; }
    .solo-launch-stats {
      gap: 12px !important;
      border: 0 !important;
    }
    .solo-launch-stat {
      border: 0 !important;
      border-radius: 14px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 86%, transparent) !important;
      box-shadow: 0 8px 22px color-mix(in srgb, var(--app-shadow) 32%, transparent) !important;
      padding: 14px 16px !important;
    }
    .solo-main-action,
    .solo-text-action { border-radius: 11px !important; }
    .solo-preview-stage {
      padding: 14px !important;
      border-radius: 18px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 78%, transparent) !important;
      box-shadow: 0 12px 32px color-mix(in srgb, var(--app-shadow) 36%, transparent) !important;
    }

    /* -------------------- active Solo: rebuild HUD -------------------- */
    body.solo-active #solo-toolbar {
      width: min(860px, calc(100% - 36px)) !important;
      margin: 0 auto !important;
      min-height: 62px !important;
    }
    .solo-floating-header {
      width: 100% !important;
      min-height: 62px !important;
      padding: 8px 0 10px !important;
    }
    .solo-floating-center strong { font-size: 25px !important; }

    body.solo-active .container {
      width: 500px !important;
      max-width: 500px !important;
      margin: 8px auto 0 !important;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
    }
    body.solo-active .container .heading {
      display: grid !important;
      grid-template-columns: auto 1fr !important;
      align-items: center !important;
      gap: 18px !important;
      min-height: 78px !important;
      padding: 0 0 12px !important;
      border: 0 !important;
      background: transparent !important;
    }
    body.solo-active .container .title {
      margin: 0 !important;
      font-size: 46px !important;
      line-height: 1 !important;
    }
    body.solo-active .scores-container {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 10px !important;
      width: 100% !important;
      margin: 0 !important;
      border: 0 !important;
      background: transparent !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      position: relative !important;
      display: flex !important;
      align-items: flex-end !important;
      justify-content: center !important;
      width: auto !important;
      min-width: 0 !important;
      min-height: 68px !important;
      padding: 29px 14px 9px !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 16%, var(--game-line)) !important;
      border-radius: 14px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 86%, transparent) !important;
      box-shadow: 0 8px 20px color-mix(in srgb, var(--app-shadow) 32%, transparent) !important;
      color: var(--app-text) !important;
      font: 900 29px/1 var(--tile-font) !important;
      text-shadow: none !important;
    }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top: 10px !important;
      left: 0 !important;
      right: 0 !important;
      color: var(--app-muted) !important;
      font: 800 10px/1 var(--hud-display) !important;
      letter-spacing: .10em !important;
    }
    .solo-card-actions {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      margin: 0 0 10px !important;
      padding: 0 !important;
      border: 0 !important;
    }
    .solo-card-actions .small-button {
      min-height: 38px !important;
      padding: 8px 13px !important;
      border: 1px solid var(--game-line) !important;
      border-radius: 10px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 80%, transparent) !important;
      box-shadow: 0 5px 14px color-mix(in srgb, var(--app-shadow) 26%, transparent) !important;
    }
    body.solo-active .game-container {
      margin: 0 auto !important;
      border-radius: 14px !important;
      overflow: hidden !important;
      box-shadow: 0 14px 32px color-mix(in srgb, var(--app-shadow) 40%, transparent) !important;
    }
    #solo-control-strip {
      margin: 8px 0 0 !important;
      padding: 7px 0 0 !important;
      border: 0 !important;
      color: var(--app-muted) !important;
    }

    @media (min-width: 901px) {
      body.solo-active,
      body.battle-fit-active {
        height: 100vh !important;
        overflow: hidden !important;
      }
      body.solo-active #game-host,
      body.solo-active #solo-toolbar,
      body.solo-active .container { max-height: 100vh !important; }
      .battle-shell { max-height: 100vh !important; overflow: hidden !important; }
    }

    @media (min-width: 901px) and (max-height: 820px) {
      body.solo-active .container { zoom: .88 !important; }
      body.solo-active #solo-toolbar { min-height: 56px !important; }
      .screen-multiplayer-menu .mode-showcase { min-height: 145px !important; padding-top: 16px !important; padding-bottom: 16px !important; }
      .screen-multiplayer-menu .mode-showcase-preview { min-height: 108px !important; }
      .screen-multiplayer-menu .mode-showcase .ui-mini-board { width: 102px !important; height: 102px !important; }
    }
    @media (min-width: 901px) and (max-height: 730px) {
      body.solo-active .container { zoom: .78 !important; }
      .screen-multiplayer-menu .mode-showcase { min-height: 126px !important; }
      .screen-multiplayer-menu .mode-showcase h2 { font-size: 27px !important; }
      .screen-multiplayer-menu .mode-showcase p { font-size: 14px !important; }
    }

    @media (max-width: 900px) {
      .settings-overlay,
      .game-modal-overlay { overflow-y: auto !important; align-items: flex-start !important; }
      .settings-dialog.settings-dialog-v40 { max-height: none !important; overflow: visible !important; }
      .settings-grid-v40 { grid-template-columns: 1fr !important; grid-template-areas: "profile" "controls" "audio" "theme" !important; }
      .nickname-setting-row { flex-direction: column !important; align-items: stretch !important; }
      .settings-profile-section .nickname-field { width: 100% !important; max-width: none !important; flex-basis: auto !important; }
      .control-choice-visual-row { grid-template-columns: 1fr 1fr !important; }
      .mode-showcase { grid-template-columns: 1fr !important; }
      .mode-showcase-preview { min-height: 0 !important; }
      body.solo-active .container { width: min(500px, calc(100% - 18px)) !important; zoom: 1 !important; }
    }
  `;
  document.head.appendChild(v46Style);

  var v47Style = document.createElement("style");
  v47Style.id = "rinas-v47-style";
  v47Style.textContent = `
    /* =========================================================
       v47 — deliberate adult-game polish
       ========================================================= */

    html, body { min-height: 100%; }

    /* One consistent transition system. No cloned ghost screens. */
    .app-screen.enter-forward { animation: v47ScreenInForward 260ms cubic-bezier(.2,.78,.2,1) both !important; }
    .app-screen.enter-back { animation: v47ScreenInBack 260ms cubic-bezier(.2,.78,.2,1) both !important; }
    .app-screen.screen-exit-forward { animation: v47ScreenOutForward 150ms ease both !important; pointer-events:none; }
    .app-screen.screen-exit-back { animation: v47ScreenOutBack 150ms ease both !important; pointer-events:none; }
    @keyframes v47ScreenInForward { from { opacity:0; transform:translate3d(18px,0,0); } to { opacity:1; transform:none; } }
    @keyframes v47ScreenInBack { from { opacity:0; transform:translate3d(-18px,0,0); } to { opacity:1; transform:none; } }
    @keyframes v47ScreenOutForward { to { opacity:0; transform:translate3d(-10px,0,0); } }
    @keyframes v47ScreenOutBack { to { opacity:0; transform:translate3d(10px,0,0); } }

    .game-modal-overlay, .settings-overlay { animation: v47OverlayIn 180ms ease both !important; }
    .game-modal, .settings-dialog { animation: v47ModalIn 220ms cubic-bezier(.2,.8,.2,1) both !important; }
    .ui-overlay-leaving { animation: v47OverlayOut 170ms ease both !important; }
    .ui-overlay-leaving .game-modal, .ui-overlay-leaving .settings-dialog { animation: v47ModalOut 170ms ease both !important; }
    @keyframes v47OverlayIn { from { opacity:0; } to { opacity:1; } }
    @keyframes v47OverlayOut { from { opacity:1; } to { opacity:0; } }
    @keyframes v47ModalIn { from { opacity:0; transform:translateY(10px) scale(.985); } to { opacity:1; transform:none; } }
    @keyframes v47ModalOut { to { opacity:0; transform:translateY(6px) scale(.99); } }

    /* SETTINGS — breathing room and one clear Save action. */
    .settings-overlay { padding: 22px !important; align-items: center !important; }
    .settings-dialog.settings-dialog-v40 {
      width: min(940px, calc(100vw - 44px)) !important;
      max-height: calc(100vh - 44px) !important;
      border-radius: 22px !important;
      overflow: hidden !important;
      box-shadow: 0 30px 80px color-mix(in srgb, var(--app-shadow) 52%, transparent) !important;
    }
    .settings-dialog-header {
      padding: 20px 26px 18px !important;
      min-height: 78px !important;
      align-items: center !important;
    }
    .settings-dialog-header h2 { margin: 3px 0 0 !important; font-size: 30px !important; line-height: 1 !important; }
    .settings-kicker { font-size: 10px !important; letter-spacing: .13em !important; }
    .settings-header-actions { gap: 10px !important; }
    .settings-done-inline {
      min-width: 120px !important;
      min-height: 44px !important;
      padding: 0 24px !important;
      border: 0 !important;
      border-radius: 13px !important;
      background: var(--app-accent) !important;
      color: var(--app-on-accent, #fff) !important;
      box-shadow: 0 9px 22px color-mix(in srgb, var(--app-accent) 28%, transparent) !important;
      font-size: 14px !important;
    }
    .settings-done-inline:hover { transform: translateY(-1px) !important; }
    .close-settings { display:none !important; }

    .settings-grid-v40 {
      padding: 18px 26px 22px !important;
      gap: 24px 30px !important;
      grid-template-columns: 1.05fr .9fr 1.05fr !important;
      align-items: start !important;
    }
    .settings-section { min-width:0; padding:0 !important; }
    .settings-section h3 {
      position:relative !important;
      margin:0 0 18px !important;
      padding:0 0 9px !important;
      border:0 !important;
      font-size:18px !important;
      line-height:1.05 !important;
    }
    .settings-section h3::after {
      content:"";
      position:absolute;
      left:0;
      bottom:0;
      width:36px;
      height:3px;
      border-radius:999px;
      background:var(--app-accent);
    }
    .settings-help { margin:6px 0 0 !important; font-size:13px !important; line-height:1.42 !important; }
    .settings-profile-section { grid-column:1 / -1 !important; }
    .nickname-setting-row, .nickname-setting-copy { display:none !important; }
    .nickname-setting-centered {
      display:grid !important;
      justify-items:center !important;
      gap:7px !important;
      max-width:360px !important;
      margin:0 auto !important;
      text-align:center !important;
    }
    .nickname-setting-centered .field-label { font-size:12px !important; letter-spacing:.08em !important; }
    .settings-profile-section .nickname-field {
      width:300px !important;
      max-width:100% !important;
      min-height:44px !important;
      padding:8px 18px !important;
      border-radius:13px !important;
      text-align:center !important;
      font-size:18px !important;
      font-weight:800 !important;
    }

    /* Controls explain themselves visually without becoming toy-like. */
    .control-choice-visual-row { gap:12px !important; margin-top:12px !important; }
    .control-choice-visual {
      min-height:116px !important;
      padding:14px 10px 12px !important;
      border-radius:16px !important;
      border:1px solid color-mix(in srgb, var(--app-accent) 24%, var(--game-line)) !important;
      background:color-mix(in srgb, var(--game-panel-strong) 90%, transparent) !important;
      box-shadow:0 8px 18px color-mix(in srgb, var(--app-shadow) 18%, transparent) !important;
    }
    .control-choice-visual.selected {
      border-color:var(--app-accent) !important;
      box-shadow:0 0 0 2px color-mix(in srgb, var(--app-accent) 18%, transparent), 0 10px 22px color-mix(in srgb, var(--app-shadow) 22%, transparent) !important;
    }
    .scheme-keys { min-height:56px !important; gap:5px !important; }
    .scheme-keys kbd {
      min-width:27px !important;
      height:27px !important;
      padding:0 6px !important;
      border-radius:7px !important;
      font-size:12px !important;
      box-shadow:inset 0 -2px 0 color-mix(in srgb, var(--app-text) 14%, transparent) !important;
    }
    .scheme-name { margin-top:7px !important; font-size:13px !important; }
    .settings-inline-toggle { margin-top:14px !important; padding-top:13px !important; }
    .toggle-row h4 { margin:0 0 5px !important; font-size:15px !important; }
    .volume-row { margin-top:16px !important; }

    .settings-theme-section .settings-section-heading-row { margin-bottom:10px !important; }
    .theme-grid { gap:7px !important; }
    .theme-choice {
      min-height:34px !important;
      padding:5px 7px !important;
      border-radius:9px !important;
    }
    .theme-swatches { gap:3px !important; }

    /* SOLO ENTRY — records are typography, not little cards. */
    .solo-launch-v43 {
      width:min(880px, calc(100vw - 48px)) !important;
      min-height:0 !important;
      margin:26px auto 0 !important;
      grid-template-columns:minmax(0, .95fr) minmax(320px, 1.05fr) !important;
      gap:48px !important;
      align-items:center !important;
    }
    .solo-launch-copy h2 { margin:6px 0 12px !important; font-size:48px !important; line-height:.94 !important; }
    .solo-launch-copy > p { max-width:390px !important; font-size:16px !important; line-height:1.45 !important; }
    .solo-launch-stats {
      display:grid !important;
      grid-template-columns:1fr 1fr !important;
      gap:26px !important;
      margin:26px 0 24px !important;
      padding:0 0 18px !important;
      border-bottom:2px solid color-mix(in srgb, var(--app-accent) 36%, transparent) !important;
    }
    .solo-launch-stat {
      padding:0 !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
    }
    .solo-launch-stat span { display:block; margin-bottom:7px !important; font-size:11px !important; letter-spacing:.10em !important; }
    .solo-launch-stat strong { font-size:46px !important; line-height:1 !important; }
    .solo-launch-actions { display:grid !important; gap:10px !important; }
    .solo-main-action, .solo-text-action {
      min-height:50px !important;
      border-radius:13px !important;
      font-size:16px !important;
      font-weight:900 !important;
    }
    .solo-main-action {
      padding:0 20px !important;
      background:var(--app-accent) !important;
      color:var(--app-on-accent, #fff) !important;
      border:1px solid var(--app-accent) !important;
      box-shadow:0 10px 24px color-mix(in srgb, var(--app-accent) 22%, transparent) !important;
    }
    .solo-text-action {
      padding:0 20px !important;
      border:1px solid color-mix(in srgb, var(--app-accent) 32%, var(--game-line)) !important;
      background:color-mix(in srgb, var(--game-panel-strong) 78%, transparent) !important;
      color:var(--app-text) !important;
    }
    .solo-preview-stage {
      border-radius:18px !important;
      padding:18px !important;
      box-shadow:0 18px 40px color-mix(in srgb, var(--app-shadow) 30%, transparent) !important;
    }
    .preview-orbit { display:none !important; }

    /* ACTIVE SOLO — one shared stat ribbon; no point pop-ups. */
    body.solo-active .score-addition { display:none !important; }
    body.solo-active .container {
      width:500px !important;
      padding:0 !important;
      margin:0 auto !important;
    }
    body.solo-active .container .heading {
      display:grid !important;
      grid-template-columns:110px 1fr !important;
      gap:14px !important;
      align-items:center !important;
      min-height:76px !important;
      margin:0 0 10px !important;
      padding:0 !important;
      border:0 !important;
    }
    body.solo-active .container .title { font-size:44px !important; }
    body.solo-active .scores-container {
      display:grid !important;
      grid-template-columns:1fr 1fr !important;
      gap:0 !important;
      min-height:72px !important;
      padding:8px 6px !important;
      border:1px solid color-mix(in srgb, var(--app-accent) 22%, var(--game-line)) !important;
      border-radius:16px !important;
      background:color-mix(in srgb, var(--game-panel-strong) 88%, transparent) !important;
      box-shadow:0 10px 24px color-mix(in srgb, var(--app-shadow) 23%, transparent) !important;
      overflow:hidden !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      min-height:56px !important;
      padding:24px 12px 7px !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
      color:var(--app-text) !important;
      font:900 31px/1 var(--tile-font) !important;
    }
    body.solo-active .best-container { border-left:1px solid color-mix(in srgb, var(--game-line) 70%, transparent) !important; }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top:9px !important;
      font-size:10px !important;
      letter-spacing:.11em !important;
      color:var(--app-muted) !important;
    }
    body.solo-active .solo-card-actions { margin:0 0 10px !important; }
    body.solo-active .solo-card-actions .small-button {
      min-height:39px !important;
      padding:0 15px !important;
      border-radius:11px !important;
      box-shadow:none !important;
    }
    body.solo-active #solo-new { border-color:color-mix(in srgb, var(--app-accent) 42%, var(--game-line)) !important; }
    body.solo-active #solo-undo { border-color:var(--game-line) !important; }
    .undo-shortcut { opacity:.68; margin-left:3px; font-weight:800; }
    body.solo-active .game-container { border-radius:14px !important; }
    #solo-control-strip { margin-top:7px !important; padding-top:5px !important; }

    /* MULTIPLAYER MODE SELECTOR — larger, adult, playful live previews. */
    .screen-multiplayer-menu #screen-content { max-width:980px !important; margin:0 auto !important; }
    .screen-multiplayer-menu .multiplayer-entry-head { margin:10px 0 14px !important; }
    .mode-showcase-list {
      display:grid !important;
      grid-template-columns:1fr 1fr !important;
      gap:14px !important;
      overflow:visible !important;
    }
    .mode-showcase {
      min-height:184px !important;
      padding:20px 22px !important;
      border-radius:18px !important;
      border:1px solid color-mix(in srgb, var(--mode-hue) 34%, var(--game-line)) !important;
      background:linear-gradient(135deg, color-mix(in srgb, var(--mode-hue) 8%, var(--game-panel-strong)), var(--game-panel-strong) 64%) !important;
      box-shadow:0 12px 28px color-mix(in srgb, var(--app-shadow) 20%, transparent) !important;
      overflow:visible !important;
      transform:none !important;
    }
    #mode-tile-race { grid-column:1 / -1 !important; min-height:176px !important; grid-template-columns:minmax(0,1fr) 330px !important; }
    #mode-freeplay, #mode-custom-race { grid-template-columns:minmax(0,1fr) 180px !important; }
    .mode-showcase:hover { transform:none !important; box-shadow:0 16px 34px color-mix(in srgb, var(--app-shadow) 27%, transparent) !important; }
    .mode-showcase h2 { font-size:31px !important; }
    .mode-showcase p { font-size:15px !important; line-height:1.38 !important; }
    .mode-showcase-preview {
      min-height:120px !important;
      max-height:none !important;
      overflow:visible !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
    }
    .mode-showcase .ui-mini-board { width:112px !important; height:112px !important; max-height:none !important; transform:none !important; }
    .mode-showcase .ui-mini-cell.filled:nth-child(4n+1) { animation:v47PreviewPulse 3.6s ease-in-out infinite; }
    .mode-showcase .ui-mini-cell.filled:nth-child(4n+3) { animation:v47PreviewPulse 3.6s 1.2s ease-in-out infinite; }
    @keyframes v47PreviewPulse { 0%,88%,100% { transform:scale(1); } 94% { transform:scale(1.045); } }
    .mode-showcase:active { transform:scale(.997) !important; }
    .future-modes-strip { margin-top:12px !important; }

    /* Lobby/form surfaces speak the same rounded game language. */
    .race-rules, .race-box, .waiting-card, .game-modal {
      border-radius:18px !important;
      box-shadow:0 16px 34px color-mix(in srgb, var(--app-shadow) 22%, transparent) !important;
    }
    .primary-button, .target-button, .game-modal-button, .room-input {
      border-radius:11px !important;
    }

    /* Footer credit. */
    #site-footer {
      position:fixed;
      left:0;
      right:0;
      bottom:7px;
      z-index:25;
      text-align:center;
      color:var(--app-muted, #776e65);
      opacity:.52;
      font:600 11px/1.2 var(--body-font, sans-serif);
      letter-spacing:.01em;
      pointer-events:none;
    }
    #site-footer a { color:inherit; text-decoration:none; pointer-events:auto; }
    #site-footer a:hover { opacity:1; text-decoration:underline; }
    body.solo-active #site-footer, body.battle-fit-active #site-footer { opacity:.32; bottom:3px; }

    /* Hard desktop requirement: active games do not page-scroll. */
    @media (min-width:901px) {
      body.solo-active, body.battle-fit-active { height:100vh !important; overflow:hidden !important; }
      body.solo-active #game-host { transform-origin:top center !important; }
      .battle-shell { transform-origin:top center !important; }
    }

    @media (max-width:900px) {
      .settings-overlay { align-items:flex-start !important; overflow-y:auto !important; padding:10px !important; }
      .settings-dialog.settings-dialog-v40 { width:100% !important; max-height:none !important; overflow:visible !important; border-radius:16px !important; }
      .settings-grid-v40 { grid-template-columns:1fr !important; }
      .nickname-setting-centered .nickname-field { width:min(300px,100%) !important; }
      .mode-showcase-list { grid-template-columns:1fr !important; }
      #mode-tile-race, #mode-freeplay, #mode-custom-race { grid-column:auto !important; grid-template-columns:1fr !important; }
      .mode-showcase-preview { min-height:0 !important; }
      .solo-launch-v43 { grid-template-columns:1fr !important; width:min(560px, calc(100vw - 24px)) !important; }
    }

    @media (prefers-reduced-motion: reduce) {
      .app-screen, .game-modal-overlay, .settings-overlay, .game-modal, .settings-dialog,
      .mode-showcase .ui-mini-cell { animation:none !important; transition:none !important; }
    }
  `;
  document.head.appendChild(v47Style);



  // =========================================================
  // v48: spacing + classic 2048 HUD + stable multiplayer flow
  // =========================================================
  var v48Style = document.createElement("style");
  v48Style.textContent = `
    /* SETTINGS: profile across the top, controls/sound below, theme full width. */
    .settings-overlay { padding:24px !important; }
    .settings-dialog.settings-dialog-v40 {
      width:min(920px, calc(100vw - 56px)) !important;
      max-height:calc(100vh - 56px) !important;
      overflow:hidden !important;
      border-radius:20px !important;
    }
    .settings-dialog-header { padding:16px 24px 14px !important; min-height:66px !important; }
    .settings-grid-v40 {
      display:grid !important;
      grid-template-columns:1.15fr .85fr !important;
      grid-template-areas:
        "profile profile"
        "controls audio"
        "theme theme" !important;
      gap:15px 32px !important;
      padding:14px 24px 18px !important;
      align-items:start !important;
    }
    .settings-profile-section { grid-column:1 / -1 !important; grid-row:1 !important; }
    .settings-grid-v40 > .settings-section:nth-child(2) { grid-column:1 !important; grid-row:2 !important; }
    .settings-audio-section { grid-column:2 !important; grid-row:2 !important; }
    .settings-theme-section { grid-column:1 / -1 !important; grid-row:3 !important; }
    .settings-section { min-width:0 !important; }
    .settings-section h3 {
      margin:0 0 10px !important;
      padding:0 0 7px !important;
      font-size:18px !important;
      line-height:1.1 !important;
    }
    .settings-section h3::after { bottom:0 !important; }
    .settings-help { margin:0 0 12px !important; font-size:13px !important; line-height:1.42 !important; }
    .nickname-setting-centered { display:flex !important; flex-direction:column !important; align-items:center !important; gap:7px !important; }
    .nickname-setting-centered .field-label { margin:0 !important; text-align:center !important; }
    .nickname-setting-centered .nickname-field {
      width:280px !important;
      max-width:100% !important;
      text-align:center !important;
      margin:0 !important;
      height:38px !important;
      min-height:38px !important;
      max-height:38px !important;
      flex:none !important;
      box-sizing:border-box !important;
      font-size:17px !important;
    }
    .nickname-setting-centered .settings-help { text-align:center !important; margin-bottom:0 !important; }
    .control-choice-visual-row { gap:12px !important; }
    .control-choice-visual { min-height:92px !important; padding:10px 10px !important; }
    .settings-inline-toggle { margin-top:10px !important; padding-top:10px !important; }
    .audio-control-group { padding-top:2px !important; }
    .volume-row { grid-template-columns:88px minmax(120px,1fr) 48px !important; gap:10px !important; }
    .theme-grid {
      display:grid !important;
      grid-template-columns:repeat(5,minmax(0,1fr)) !important;
      gap:10px !important;
    }
    .theme-choice {
      min-height:48px !important;
      padding:7px 8px !important;
      border-radius:12px !important;
      text-align:center !important;
    }
    .theme-choice .theme-swatches { margin-top:8px !important; justify-content:center !important; }

    /* SOLO ENTRY: keep actions attached to the stats, not floating below them. */
    .solo-launch-v43 { gap:38px !important; }
    .solo-launch-stats { margin:22px 0 16px !important; padding-bottom:14px !important; }
    .solo-launch-actions { margin-top:0 !important; gap:9px !important; }
    .solo-main-action, .solo-text-action { width:100% !important; }

    /* ACTIVE SOLO: compact classic-2048-style score boxes. */
    body.solo-active .container { width:500px !important; }
    body.solo-active .container .heading {
      display:grid !important;
      grid-template-columns:1fr auto !important;
      align-items:end !important;
      gap:18px !important;
      min-height:68px !important;
      margin:0 0 12px !important;
    }
    body.solo-active .container .title {
      font-size:48px !important;
      line-height:.9 !important;
      margin:0 !important;
      align-self:center !important;
    }
    body.solo-active .scores-container {
      width:auto !important;
      min-height:0 !important;
      display:flex !important;
      gap:8px !important;
      padding:0 !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
      overflow:visible !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      position:relative !important;
      width:96px !important;
      min-width:96px !important;
      min-height:62px !important;
      padding:25px 10px 7px !important;
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      border:0 !important;
      border-radius:8px !important;
      background:color-mix(in srgb, var(--app-stat) 88%, var(--app-card)) !important;
      box-shadow:0 5px 12px color-mix(in srgb, var(--app-shadow) 18%, transparent) !important;
      color:var(--game-on-deep) !important;
      font:900 27px/1 var(--tile-font) !important;
    }
    body.solo-active .best-container { border-left:0 !important; }
    body.solo-active .score-container::after { content:"Score" !important; }
    body.solo-active .best-container::after { content:"Best" !important; }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top:8px !important;
      left:0 !important;
      width:100% !important;
      color:color-mix(in srgb, var(--game-on-deep) 72%, transparent) !important;
      font:800 9px/1 var(--body-font) !important;
      letter-spacing:.10em !important;
    }
    body.solo-active .solo-card-actions {
      display:flex !important;
      justify-content:space-between !important;
      align-items:center !important;
      gap:12px !important;
      margin:0 0 10px !important;
    }
    body.solo-active .solo-card-actions .small-button {
      min-width:110px !important;
      min-height:38px !important;
      padding:0 14px !important;
      border-radius:9px !important;
      font-size:12px !important;
      letter-spacing:.02em !important;
    }
    body.solo-active #solo-undo { font-weight:800 !important; }
    .undo-shortcut { display:none !important; }
    #solo-control-strip .solo-strip-item { display:none !important; }

    /* MULTIPLAYER MODE MENU: three full-width lanes; no text/preview collisions. */
    .screen-multiplayer-menu .app-screen-inner { max-width:980px !important; padding-top:18px !important; }
    .screen-multiplayer-menu .multiplayer-entry-head { margin:6px 0 12px !important; }
    .mode-showcase-list {
      display:grid !important;
      grid-template-columns:1fr !important;
      gap:12px !important;
      overflow:visible !important;
    }
    #mode-tile-race, #mode-freeplay, #mode-custom-race,
    .mode-showcase {
      grid-column:auto !important;
      min-height:154px !important;
      display:grid !important;
      grid-template-columns:minmax(0,1fr) 270px !important;
      gap:24px !important;
      align-items:center !important;
      padding:18px 20px !important;
      overflow:hidden !important;
      border-radius:17px !important;
    }
    .mode-showcase-copy { min-width:0 !important; }
    .mode-showcase h2 { margin:3px 0 4px !important; font-size:27px !important; line-height:1 !important; }
    .mode-showcase p { margin:0 0 8px !important; font-size:14px !important; line-height:1.32 !important; max-width:560px !important; }
    .mode-showcase-facts { margin-bottom:7px !important; }
    .mode-showcase-preview {
      width:100% !important;
      min-width:0 !important;
      min-height:122px !important;
      max-height:none !important;
      overflow:visible !important;
      border-radius:13px !important;
    }
    .mode-showcase .ui-mini-board { width:94px !important; height:94px !important; }
    .mode-visual-pair { gap:10px !important; }
    .mode-showcase:hover {
      transform:none !important;
      box-shadow:0 13px 30px color-mix(in srgb, var(--app-shadow) 24%, transparent) !important;
    }
    .mode-showcase:hover .mode-showcase-preview { background:color-mix(in srgb, var(--mode-hue) 8%, transparent) !important; }
    .future-modes-strip { margin-top:9px !important; }

    /* Nickname overlay: smooth and self-contained. */
    .nickname-modal-overlay.ui-overlay-leaving { opacity:0 !important; transition:opacity .20s ease !important; }
    .nickname-modal-overlay.ui-overlay-leaving .nickname-modal {
      transform:translateY(8px) scale(.985) !important;
      opacity:0 !important;
      transition:transform .20s ease, opacity .20s ease !important;
    }

    @media (min-width:901px) {
      .screen-multiplayer-menu { min-height:0 !important; }
      .screen-multiplayer-menu #screen-content { max-width:980px !important; }
    }
    @media (max-width:900px) {
      .settings-dialog.settings-dialog-v40 { overflow:auto !important; }
      .settings-grid-v40 { grid-template-columns:1fr !important; }
      .settings-profile-section, .settings-theme-section { grid-column:auto !important; }
      .theme-grid { grid-template-columns:repeat(2,minmax(0,1fr)) !important; }
      #mode-tile-race, #mode-freeplay, #mode-custom-race, .mode-showcase { grid-template-columns:1fr !important; }
      .mode-showcase-preview { max-height:none !important; }
    }
  `;
  document.head.appendChild(v48Style);



  // =========================================================
  // v49: precision layout pass based on live desktop review
  // =========================================================
  var v49Style = document.createElement("style");
  v49Style.id = "rinas-v49-style";
  v49Style.textContent = `
    /* A calmer tile numeral: readable like classic 2048, not chunky display type. */
    .tile .tile-inner {
      font-family: "Helvetica Neue", Arial, sans-serif !important;
      font-weight: 700 !important;
      letter-spacing: -.035em !important;
    }

    /* SOLO label must stay readable in every theme. */
    .solo-mode-label {
      color: var(--app-text) !important;
      background: transparent !important;
      opacity: .72 !important;
      padding: 0 !important;
      margin-top: 4px !important;
    }

    /* SETTINGS: Profile belongs to the centered identity block. */
    .settings-profile-section > h3 {
      text-align: center !important;
      margin-bottom: 14px !important;
    }
    .settings-profile-section > h3::after {
      left: 50% !important;
      transform: translateX(-50%) !important;
    }
    .nickname-setting-centered {
      margin-inline: auto !important;
      text-align: center !important;
    }
    .nickname-setting-centered .field-label,
    .nickname-setting-centered .settings-help {
      text-align: center !important;
    }

    /* SOLO ENTRY: the middle divider is mathematically centered. */
    .solo-launch-stats {
      position: relative !important;
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 0 !important;
    }
    .solo-launch-stats::before {
      content: "" !important;
      position: absolute !important;
      grid-column: auto !important;
      grid-row: auto !important;
      left: 50% !important;
      top: 10% !important;
      bottom: 10% !important;
      width: 1px !important;
      min-height: 0 !important;
      transform: translateX(-.5px) !important;
      background: color-mix(in srgb, var(--game-line) 72%, transparent) !important;
      pointer-events: none !important;
    }
    .solo-launch-stat:first-child,
    .solo-launch-stat:last-child {
      grid-column: auto !important;
    }
    .solo-launch-stat {
      padding-inline: 22px !important;
    }
    .solo-launch-actions {
      width: min(300px, 100%) !important;
      margin: 2px auto 0 !important;
      justify-items: stretch !important;
    }
    .solo-main-action,
    .solo-text-action {
      width: 100% !important;
      min-height: 48px !important;
      margin: 0 !important;
      border-radius: 12px !important;
    }

    /* ACTIVE SOLO: clean rounded Score/Best bubbles, no line collision. */
    body.solo-active .container .heading {
      display: flex !important;
      justify-content: center !important;
      align-items: center !important;
      gap: 14px !important;
      min-height: 66px !important;
      margin: 0 0 10px !important;
      padding: 0 !important;
      border: 0 !important;
      overflow: visible !important;
    }
    body.solo-active .container .heading::before,
    body.solo-active .container .heading::after {
      display: none !important;
      content: none !important;
    }
    body.solo-active .container .title {
      flex: 0 0 auto !important;
      margin: 0 4px 0 0 !important;
      font-family: "Helvetica Neue", Arial, sans-serif !important;
      font-size: 43px !important;
      font-weight: 800 !important;
      letter-spacing: -.045em !important;
      line-height: 1 !important;
    }
    body.solo-active .scores-container {
      display: flex !important;
      align-items: stretch !important;
      width: auto !important;
      gap: 8px !important;
      padding: 0 !important;
      margin: 0 !important;
      border: 0 !important;
      background: transparent !important;
      box-shadow: none !important;
      overflow: visible !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      position: relative !important;
      width: 92px !important;
      min-width: 92px !important;
      min-height: 62px !important;
      padding: 25px 10px 8px !important;
      display: flex !important;
      justify-content: center !important;
      align-items: flex-end !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 20%, var(--game-line)) !important;
      border-radius: 14px !important;
      background: var(--app-soft, #eee4da) !important;
      box-shadow: 0 7px 17px color-mix(in srgb, var(--app-shadow) 16%, transparent) !important;
      color: var(--app-text) !important;
      font-family: "Helvetica Neue", Arial, sans-serif !important;
      font-size: 26px !important;
      font-weight: 800 !important;
      line-height: 1 !important;
    }
    body.solo-active .best-container { border-left-width: 1px !important; }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top: 8px !important;
      left: 0 !important;
      width: 100% !important;
      text-align: center !important;
      color: var(--app-muted) !important;
      font-family: var(--hud-body) !important;
      font-size: 10px !important;
      font-weight: 800 !important;
      letter-spacing: .09em !important;
    }

    body.solo-active .solo-card-actions {
      width: 100% !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      gap: 12px !important;
      margin: 0 0 9px !important;
    }
    body.solo-active .solo-card-actions .small-button {
      min-width: 0 !important;
      width: auto !important;
      min-height: 36px !important;
      padding: 0 13px !important;
      border-radius: 10px !important;
      font-size: 12px !important;
      white-space: nowrap !important;
    }
    body.solo-active #solo-undo {
      min-width: 88px !important;
      justify-content: center !important;
      padding-inline: 12px !important;
    }

    /* Mode screen: keep previews connected to the copy rather than stranded right. */
    #mode-tile-race, #mode-freeplay, #mode-custom-race,
    .mode-showcase {
      grid-template-columns: minmax(0, 1fr) 230px !important;
      gap: 16px !important;
    }
    .mode-showcase-preview {
      width: 230px !important;
      max-width: 100% !important;
      justify-self: start !important;
    }
    .future-modes-strip {
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 22px !important;
      flex-wrap: wrap !important;
      margin: 12px 0 30px !important;
      line-height: 1.35 !important;
    }
    .future-modes-strip > span {
      display: inline-flex !important;
      gap: 6px !important;
      align-items: baseline !important;
      white-space: nowrap !important;
    }

    /* Custom Race/setup screens reserve real space for the footer and fit desktop height. */
    .screen-custom-race-lobby .app-screen-inner,
    .screen-tile-race-lobby .app-screen-inner,
    .screen-freeplay-lobby .app-screen-inner {
      padding-top: 14px !important;
      padding-bottom: 34px !important;
    }
    .screen-custom-race-lobby .app-header,
    .screen-tile-race-lobby .app-header,
    .screen-freeplay-lobby .app-header {
      margin-bottom: 10px !important;
    }
    .screen-custom-race-lobby .rules-card,
    .screen-tile-race-lobby .rules-card,
    .screen-freeplay-lobby .rules-card {
      margin: 8px 0 10px !important;
      padding: 13px 17px !important;
      border-radius: 15px !important;
    }
    .screen-custom-race-lobby .rules-card ul,
    .screen-tile-race-lobby .rules-card ul,
    .screen-freeplay-lobby .rules-card ul {
      margin: 7px 0 0 18px !important;
    }
    .screen-custom-race-lobby .rules-card li,
    .screen-tile-race-lobby .rules-card li,
    .screen-freeplay-lobby .rules-card li {
      margin: 2px 0 !important;
      line-height: 1.26 !important;
    }
    .screen-custom-race-lobby .race-columns,
    .screen-tile-race-lobby .race-columns,
    .screen-freeplay-lobby .race-columns {
      gap: 12px !important;
    }
    .screen-custom-race-lobby .race-box,
    .screen-tile-race-lobby .race-box,
    .screen-freeplay-lobby .race-box {
      padding: 14px 17px !important;
      border-radius: 15px !important;
    }
    .screen-custom-race-lobby .custom-target-grid { gap: 10px !important; }
    .screen-custom-race-lobby .custom-target-panel { padding: 10px !important; }
    .screen-custom-race-lobby .target-picker { gap: 5px !important; }
    .screen-custom-race-lobby .target-button { min-height: 32px !important; }

    /* Footer remains subtle, but content no longer sits underneath it. */
    #site-footer {
      bottom: 5px !important;
      opacity: .42 !important;
      font-size: 10px !important;
    }
    .app-screen-inner { padding-bottom: 30px !important; }



    /* Multiplayer menu must fit a 748px desktop viewport without hiding future modes/footer. */
    .screen-multiplayer-menu .app-screen-inner { padding-top: 8px !important; }
    .screen-multiplayer-menu .app-header { margin-bottom: 8px !important; min-height: 76px !important; }
    .screen-multiplayer-menu .multiplayer-entry-head { margin: 2px 0 8px !important; min-height: 48px !important; }
    .mode-showcase-list { gap: 10px !important; }
    #mode-tile-race, #mode-freeplay, #mode-custom-race, .mode-showcase {
      height: 145px !important;
      min-height: 145px !important;
      padding: 12px 18px !important;
      grid-template-columns: minmax(0, 610px) 210px !important;
      justify-content: start !important;
      gap: 12px !important;
    }
    .mode-showcase h2 { font-size: 25px !important; }
    .mode-showcase p { margin-bottom: 6px !important; font-size: 13px !important; line-height: 1.25 !important; }
    .mode-showcase-facts { margin-bottom: 4px !important; }
    .mode-showcase-preview { width: 210px !important; min-height: 96px !important; }
    .mode-showcase .ui-mini-board { width: 70px !important; height: 70px !important; }
    .mode-visual-player b { margin-bottom: 2px !important; }
    .mode-visual-player > span { margin-top: 2px !important; font-size: 14px !important; }
    .mode-freeplay-visual { grid-template-columns: 70px minmax(0,1fr) !important; gap: 9px !important; }
    .undo-loop { gap: 5px !important; font-size: 8px !important; white-space: nowrap !important; }
    .undo-loop i { font-size: 19px !important; }
    .mode-showcase-facts { margin-top: 6px !important; margin-bottom: 3px !important; }
    .mode-showcase-action { margin-top: 6px !important; }
    .future-modes-strip { margin: 8px 0 26px !important; gap: 18px !important; }

    /* Settings must fit in a 748px desktop page viewport without clipping themes. */
    .settings-overlay { padding: 14px !important; }
    .settings-dialog.settings-dialog-v40 {
      max-height: calc(100vh - 28px) !important;
    }
    .settings-dialog-header { padding-top: 14px !important; padding-bottom: 12px !important; min-height: 62px !important; }
    .settings-grid-v40 { padding-top: 10px !important; padding-bottom: 14px !important; gap: 11px 32px !important; }
    .settings-profile-section > h3 { margin-bottom: 8px !important; }
    .nickname-setting-centered { gap: 4px !important; }
    .nickname-setting-centered .settings-help { margin-top: 2px !important; }
    .settings-section h3 { margin-bottom: 8px !important; }
    .settings-help { margin-bottom: 8px !important; }
    .control-choice-visual-row { margin-top: 7px !important; }
    .control-choice-visual { min-height: 86px !important; }
    .settings-inline-toggle { margin-top: 7px !important; padding-top: 7px !important; }
    .volume-row { margin-top: 10px !important; }
    .theme-grid { margin-top: 4px !important; }

    @media (max-width: 900px) {
      .solo-launch-stats::before { top: 12%; bottom: 12%; }
      #mode-tile-race, #mode-freeplay, #mode-custom-race,
      .mode-showcase { grid-template-columns: 1fr !important; }
      .mode-showcase-preview { width: 100% !important; justify-self: stretch !important; }
    }
  `;
  document.head.appendChild(v49Style);


  // =========================================================
  // v50: unified game components + custom SVG icon system
  // =========================================================
  var v50Style = document.createElement("style");
  v50Style.id = "rinas-v50-style";
  v50Style.textContent = `
    /* ---------- Custom graphics ---------- */
    .ui-icon {
      width: 1.15em;
      height: 1.15em;
      display: inline-block;
      flex: 0 0 auto;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.7;
      stroke-linecap: round;
      stroke-linejoin: round;
      vertical-align: -.15em;
    }

    .icon-text-button {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 8px !important;
    }

    .button-icon { width: 16px; height: 16px; }
    .settings-done-inline .button-icon { width: 17px; height: 17px; }

    .graphic-icon {
      display: grid !important;
      place-items: center !important;
    }
    .home-mode-icon {
      width: 28px;
      height: 28px;
      transition: transform 180ms cubic-bezier(.2,.8,.2,1);
    }
    .home-brush-button:hover .home-mode-icon { transform: scale(1.08); }
    .solo-brush:hover .home-mode-icon rect:nth-child(2) { transform: translate(-1px, 1px); }
    .multiplayer-brush:hover .home-mode-icon { transform: scale(1.08) translateX(1px); }

    .result-icon-graphic {
      width: 76px !important;
      height: 76px !important;
      display: grid !important;
      place-items: center !important;
      margin: 0 auto 14px !important;
      color: var(--app-accent) !important;
      font-size: 0 !important;
    }
    .result-graphic { width: 62px; height: 62px; stroke-width: 1.45; }

    /* ---------- Solo launch actions: truly centered ---------- */
    .solo-launch-copy { min-width: 0 !important; }
    .solo-launch-actions {
      width: min(340px, 100%) !important;
      margin: 30px auto 0 !important;
      display: grid !important;
      gap: 10px !important;
      justify-items: stretch !important;
    }
    .solo-main-action,
    .solo-text-action {
      width: 100% !important;
      margin: 0 !important;
      justify-self: stretch !important;
      text-align: center !important;
    }
    .solo-main-action {
      min-height: 48px !important;
      padding: 0 22px !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 58%, transparent) !important;
      border-radius: 12px !important;
      background: var(--app-accent) !important;
      color: var(--app-accent-contrast, #fff) !important;
      box-shadow: 0 8px 20px color-mix(in srgb, var(--app-accent) 18%, transparent) !important;
      font-size: 16px !important;
      transform: none !important;
    }
    .solo-main-action::after { content: "" !important; }
    .solo-main-action:hover {
      transform: translateY(-1px) !important;
      filter: brightness(1.03);
    }
    .solo-text-action {
      min-height: 44px !important;
      border-radius: 12px !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 32%, var(--game-line)) !important;
      background: color-mix(in srgb, var(--game-panel-strong) 80%, transparent) !important;
    }

    /* ---------- Active Solo HUD: compact, readable, button-like surfaces without button affordance ---------- */
    body.solo-active .container .heading {
      display: grid !important;
      grid-template-columns: minmax(92px, auto) auto !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 18px !important;
      min-height: 72px !important;
      padding: 0 0 10px !important;
      margin: 0 auto 8px !important;
      border: 0 !important;
    }
    body.solo-active .container .title {
      margin: 0 !important;
      font-family: var(--hud-display) !important;
      font-size: 38px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      letter-spacing: -.035em !important;
      color: var(--app-text) !important;
    }
    body.solo-active .scores-container {
      display: flex !important;
      gap: 8px !important;
      width: auto !important;
      border: 0 !important;
      background: transparent !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      position: relative !important;
      width: 104px !important;
      min-width: 104px !important;
      height: 58px !important;
      min-height: 58px !important;
      padding: 24px 10px 7px !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 16%, var(--game-line)) !important;
      border-radius: 11px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 90%, transparent) !important;
      box-shadow: 0 5px 14px color-mix(in srgb, var(--app-shadow) 38%, transparent) !important;
      color: var(--app-text) !important;
      font-family: var(--hud-display) !important;
      font-size: 21px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      text-align: center !important;
      overflow: hidden !important;
    }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position: absolute !important;
      top: 8px !important;
      left: 0 !important;
      right: 0 !important;
      margin: 0 !important;
      font-family: var(--hud-display) !important;
      font-size: 8px !important;
      font-weight: 900 !important;
      line-height: 1 !important;
      letter-spacing: .12em !important;
      color: var(--app-muted) !important;
    }

    /* New Game and Undo are one component. */
    body.solo-active .solo-card-actions {
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      gap: 10px !important;
      margin: 0 0 8px !important;
    }
    body.solo-active .solo-command-button,
    .solo-command-button {
      width: auto !important;
      min-width: 116px !important;
      min-height: 36px !important;
      padding: 0 13px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      gap: 6px !important;
      border: 1px solid color-mix(in srgb, var(--app-accent) 24%, var(--game-line)) !important;
      border-radius: 10px !important;
      background: color-mix(in srgb, var(--game-panel-strong) 88%, transparent) !important;
      box-shadow: 0 4px 10px color-mix(in srgb, var(--app-shadow) 22%, transparent) !important;
      color: var(--app-text) !important;
      font: 900 11px/1 var(--hud-display) !important;
    }
    body.solo-active .solo-command-button:hover:not(:disabled) {
      border-color: var(--app-accent) !important;
      transform: translateY(-1px) !important;
    }
    body.solo-active .solo-command-button:disabled {
      opacity: .42 !important;
      box-shadow: none !important;
    }
    .button-shortcut {
      color: var(--app-muted);
      font-size: .88em;
      letter-spacing: 0;
    }

    /* Tile numerals: adult, clean and less chunky. */
    .tile .tile-inner,
    .ui-mini-cell,
    .opponent-cell {
      font-family: "Nunito Sans", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-weight: 800 !important;
      letter-spacing: -.035em !important;
    }

    /* ---------- Multiplayer mode select: roomier previews, still one viewport ---------- */
    .screen-multiplayer-menu .app-screen-inner {
      width: min(1040px, calc(100% - 36px)) !important;
      padding-top: 10px !important;
      padding-bottom: 30px !important;
    }
    .screen-multiplayer-menu .app-header {
      min-height: 72px !important;
      margin-bottom: 6px !important;
    }
    .screen-multiplayer-menu .multiplayer-entry-head {
      min-height: 42px !important;
      margin: 0 0 8px !important;
      padding-bottom: 8px !important;
    }
    .mode-showcase-list { gap: 9px !important; }
    #mode-tile-race, #mode-freeplay, #mode-custom-race,
    .mode-showcase {
      height: 154px !important;
      min-height: 154px !important;
      padding: 14px 18px !important;
      grid-template-columns: minmax(0, 1fr) 280px !important;
      gap: 20px !important;
      border-radius: 16px !important;
      overflow: hidden !important;
    }
    .mode-showcase-copy { min-width: 0 !important; }
    .mode-showcase h2 {
      margin: 2px 0 3px !important;
      font-size: 27px !important;
      line-height: 1 !important;
    }
    .mode-showcase p {
      max-width: 580px !important;
      margin: 0 0 5px !important;
      font-size: 13.5px !important;
      line-height: 1.28 !important;
    }
    .mode-showcase-preview {
      width: 280px !important;
      min-height: 112px !important;
      justify-self: end !important;
      align-self: center !important;
      padding: 8px 10px !important;
      overflow: visible !important;
      border-radius: 13px !important;
    }
    .mode-showcase .ui-mini-board {
      width: 82px !important;
      height: 82px !important;
    }
    .mode-visual-player > span { font-size: 16px !important; }
    .mode-freeplay-visual { grid-template-columns: 82px minmax(0,1fr) !important; gap: 14px !important; }
    .custom-target { min-height: 76px !important; padding: 8px 9px !important; border-radius: 11px !important; }
    .custom-target strong { font-size: 25px !important; }
    .future-modes-strip {
      margin: 7px 0 24px !important;
      gap: 28px !important;
      font-size: 11px !important;
    }

    /* ---------- Settings: icon-aware button and balanced spacing ---------- */
    .settings-done-inline {
      min-width: 112px !important;
      min-height: 42px !important;
      border-radius: 11px !important;
    }
    .settings-section h3 { margin-bottom: 12px !important; }
    .settings-profile-section > h3 { text-align: center !important; }
    .nickname-setting-centered {
      width: min(330px, 100%) !important;
      margin: 0 auto !important;
    }

    /* Give selected movement cards a calm visual explanation. */
    .control-choice-visual {
      border-radius: 13px !important;
      overflow: hidden !important;
    }
    .control-choice-visual.selected {
      box-shadow: 0 8px 18px color-mix(in srgb, var(--app-accent) 10%, transparent) !important;
    }

    /* ---------- Result graphic states ---------- */
    .result-box .result-icon-graphic + h1 { margin-top: 2px !important; }

    @media (max-height: 760px) and (min-width: 901px) {
      .screen-multiplayer-menu .app-header { min-height: 66px !important; }
      .screen-multiplayer-menu .multiplayer-entry-head { min-height: 38px !important; }
      #mode-tile-race, #mode-freeplay, #mode-custom-race,
      .mode-showcase { height: 148px !important; min-height: 148px !important; }
      .mode-showcase-preview { min-height: 106px !important; }
      .future-modes-strip { margin-bottom: 20px !important; }
    }

    @media (max-width: 900px) {
      #mode-tile-race, #mode-freeplay, #mode-custom-race,
      .mode-showcase {
        height: auto !important;
        min-height: 0 !important;
        grid-template-columns: 1fr !important;
      }
      .mode-showcase-preview {
        width: 100% !important;
        justify-self: stretch !important;
      }
      body.solo-active .container .heading {
        grid-template-columns: 1fr !important;
        text-align: center !important;
      }
    }
  `;
  document.head.appendChild(v50Style);

  // =========================================================
  // v51: exact visual polish from approved icon-system mockup
  // =========================================================
  var v51Style = document.createElement("style");
  v51Style.id = "rinas-v51-style";
  v51Style.textContent = `
    /* Real graphic assets replacing the old emoji-style symbols. */
    .ui-icon.icon-asset {
      display:block !important;
      overflow:visible !important;
      color:currentColor !important;
    }
    .graphic-icon .icon-asset,
    .home-mode-icon.icon-asset {
      width:34px !important;
      height:34px !important;
    }
    .result-graphic.icon-asset { width:64px !important; height:64px !important; }

    /* SOLO ENTRY — center the actions exactly under the records block. */
    .solo-launch-copy {
      display:flex !important;
      flex-direction:column !important;
      align-items:stretch !important;
    }
    .solo-launch-actions {
      width:min(310px, 82%) !important;
      margin:28px auto 0 !important;
      align-self:center !important;
      justify-self:center !important;
      gap:10px !important;
    }
    .solo-launch-actions .solo-main-action,
    .solo-launch-actions .solo-text-action {
      width:100% !important;
      min-height:48px !important;
      margin:0 !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      border-radius:12px !important;
      transform:translateY(0) scale(1) !important;
      transition:transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, background 180ms ease, border-color 180ms ease !important;
    }
    .solo-launch-actions .solo-main-action:hover,
    .solo-launch-actions .solo-text-action:hover {
      transform:translateY(-2px) scale(1.012) !important;
      box-shadow:0 10px 24px color-mix(in srgb, var(--app-accent) 18%, transparent) !important;
    }
    .solo-launch-actions .solo-text-action:hover {
      background:color-mix(in srgb, var(--app-accent) 9%, var(--game-panel-strong)) !important;
      border-color:color-mix(in srgb, var(--app-accent) 55%, var(--game-line)) !important;
      color:var(--app-text) !important;
    }

    /* ACTIVE SOLO — approved rounded score chips from the icon-system mockup. */
    body.solo-active .container { padding-top:14px !important; }
    body.solo-active .container .heading {
      display:grid !important;
      grid-template-columns:auto auto !important;
      align-items:center !important;
      justify-content:center !important;
      gap:18px !important;
      min-height:76px !important;
      margin:0 auto 12px !important;
      padding:0 !important;
      border:0 !important;
      overflow:visible !important;
    }
    body.solo-active .container .title {
      margin:0 !important;
      font-family:var(--hud-display) !important;
      font-size:40px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:-.035em !important;
      color:var(--app-text) !important;
    }
    body.solo-active .scores-container {
      display:flex !important;
      align-items:stretch !important;
      gap:10px !important;
      width:auto !important;
      margin:0 !important;
      padding:0 !important;
      background:transparent !important;
      border:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      box-sizing:border-box !important;
      position:relative !important;
      width:108px !important;
      min-width:108px !important;
      height:64px !important;
      min-height:64px !important;
      padding:27px 12px 8px !important;
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      border:1px solid color-mix(in srgb, var(--app-accent) 18%, var(--game-line)) !important;
      border-radius:13px !important;
      background:color-mix(in srgb, var(--game-panel-strong) 96%, var(--app-bg) 4%) !important;
      box-shadow:0 7px 18px color-mix(in srgb, var(--app-shadow) 18%, transparent) !important;
      color:var(--app-text) !important;
      font-family:var(--hud-display) !important;
      font-size:24px !important;
      font-weight:900 !important;
      line-height:1 !important;
      text-align:center !important;
      overflow:hidden !important;
    }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position:absolute !important;
      top:9px !important;
      left:0 !important;
      right:0 !important;
      width:100% !important;
      margin:0 !important;
      color:var(--app-muted) !important;
      font-family:var(--hud-display) !important;
      font-size:9px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:.11em !important;
      text-transform:uppercase !important;
      text-align:center !important;
    }
    body.solo-active .score-container::after { content:"SCORE" !important; }
    body.solo-active .best-container::after { content:"BEST" !important; }

    /* New Game and Undo are literally the same button component. */
    body.solo-active .solo-card-actions {
      display:grid !important;
      grid-template-columns:128px 128px !important;
      justify-content:space-between !important;
      align-items:center !important;
      gap:14px !important;
      width:100% !important;
      margin:0 0 9px !important;
    }
    body.solo-active .solo-command-button {
      box-sizing:border-box !important;
      width:128px !important;
      min-width:128px !important;
      height:38px !important;
      min-height:38px !important;
      padding:0 12px !important;
      display:inline-flex !important;
      align-items:center !important;
      justify-content:center !important;
      gap:7px !important;
      border:1px solid color-mix(in srgb, var(--app-accent) 24%, var(--game-line)) !important;
      border-radius:10px !important;
      background:color-mix(in srgb, var(--game-panel-strong) 94%, var(--app-bg) 6%) !important;
      color:var(--app-text) !important;
      box-shadow:0 5px 14px color-mix(in srgb, var(--app-shadow) 15%, transparent) !important;
      font:900 11px/1 var(--hud-display) !important;
      white-space:nowrap !important;
      transition:transform 160ms ease, border-color 160ms ease, box-shadow 160ms ease !important;
    }
    body.solo-active .solo-command-button:hover:not(:disabled) {
      transform:translateY(-1px) !important;
      border-color:var(--app-accent) !important;
      box-shadow:0 8px 18px color-mix(in srgb, var(--app-accent) 14%, transparent) !important;
    }
    body.solo-active .solo-command-button:disabled { opacity:.42 !important; transform:none !important; box-shadow:none !important; }
    body.solo-active #solo-undo { width:128px !important; min-width:128px !important; padding:0 12px !important; }
    body.solo-active .solo-command-button .button-icon { width:15px !important; height:15px !important; }

    /* MULTIPLAYER SELECT — reclaim the empty header space, then enlarge the actual modes. */
    @media (min-width:901px) {
      .screen-multiplayer-menu.app-screen { padding-top:2px !important; padding-bottom:20px !important; }
      .screen-multiplayer-menu .app-screen-inner {
        width:min(1120px, calc(100% - 40px)) !important;
        max-width:1120px !important;
        padding-top:0 !important;
      }
      .screen-multiplayer-menu .app-header {
        min-height:58px !important;
        margin:0 0 4px !important;
        padding:3px 0 7px !important;
      }
      .screen-multiplayer-menu .multiplayer-entry-head {
        min-height:38px !important;
        margin:0 0 7px !important;
        padding-bottom:6px !important;
      }
      .screen-multiplayer-menu .mode-showcase-list { gap:10px !important; }
      .screen-multiplayer-menu #mode-tile-race,
      .screen-multiplayer-menu #mode-freeplay,
      .screen-multiplayer-menu #mode-custom-race,
      .screen-multiplayer-menu .mode-showcase {
        box-sizing:border-box !important;
        height:162px !important;
        min-height:162px !important;
        padding:15px 20px !important;
        grid-template-columns:minmax(0, 1fr) 320px !important;
        gap:22px !important;
        border-radius:17px !important;
      }
      .screen-multiplayer-menu .mode-showcase h2 { font-size:27px !important; }
      .screen-multiplayer-menu .mode-showcase p {
        max-width:610px !important;
        font-size:14px !important;
        line-height:1.3 !important;
        margin-bottom:7px !important;
      }
      .screen-multiplayer-menu .mode-showcase-preview {
        width:320px !important;
        min-width:320px !important;
        min-height:124px !important;
        padding:9px 12px !important;
        justify-self:start !important;
        align-self:center !important;
        overflow:visible !important;
      }
      .screen-multiplayer-menu .mode-showcase .ui-mini-board {
        width:100px !important;
        height:100px !important;
      }
      .screen-multiplayer-menu .mode-visual-pair { gap:13px !important; justify-content:center !important; }
      .screen-multiplayer-menu .mode-freeplay-visual { grid-template-columns:100px minmax(0,1fr) !important; gap:17px !important; }
      .screen-multiplayer-menu .custom-target { min-height:88px !important; padding:10px 12px !important; }
      .screen-multiplayer-menu .custom-target strong { font-size:27px !important; }
      .screen-multiplayer-menu .future-modes-strip { margin:7px 0 22px !important; gap:24px !important; }
    }

    @media (max-height:760px) and (min-width:901px) {
      .screen-multiplayer-menu #mode-tile-race,
      .screen-multiplayer-menu #mode-freeplay,
      .screen-multiplayer-menu #mode-custom-race,
      .screen-multiplayer-menu .mode-showcase { height:154px !important; min-height:154px !important; }
      .screen-multiplayer-menu .mode-showcase-preview { min-height:116px !important; }
      .screen-multiplayer-menu .mode-showcase .ui-mini-board { width:92px !important; height:92px !important; }
      .screen-multiplayer-menu .mode-freeplay-visual { grid-template-columns:92px minmax(0,1fr) !important; }
    }
  `;
  document.head.appendChild(v51Style);



  // =========================================================
  // v52: approved icon-system + exact theme-aware score chips
  // =========================================================
  var v52Style = document.createElement("style");
  v52Style.id = "rinas-v52-approved-system";
  v52Style.textContent = `
    /* -----------------------------------------------------
       THEME TOKENS FOR THE APPROVED GRAPHIC SYSTEM
       Same geometry everywhere; only the palette changes.
       ----------------------------------------------------- */
    body.theme-classic {
      --approved-chip-top:rgba(255,255,255,.78);
      --approved-chip-bottom:rgba(250,242,231,.78);
      --approved-chip-border:rgba(164,139,111,.30);
      --approved-chip-highlight:rgba(255,255,255,.92);
      --approved-chip-label:#8a786a;
      --approved-chip-text:#2c2723;
      --approved-chip-shadow:rgba(83,59,40,.12);
      --approved-icon-soft:#fff7ed;
      --approved-icon-tertiary:#efc44a;
    }
    body.theme-pastel {
      --approved-chip-top:rgba(255,255,255,.80);
      --approved-chip-bottom:rgba(242,236,255,.80);
      --approved-chip-border:rgba(153,132,205,.30);
      --approved-chip-highlight:rgba(255,255,255,.94);
      --approved-chip-label:#7e7394;
      --approved-chip-text:#302c42;
      --approved-chip-shadow:rgba(89,73,128,.12);
      --approved-icon-soft:#fbf8ff;
      --approved-icon-tertiary:#f0c95a;
    }
    body.theme-ocean {
      --approved-chip-top:rgba(238,252,255,.86);
      --approved-chip-bottom:rgba(205,235,242,.82);
      --approved-chip-border:rgba(73,153,174,.38);
      --approved-chip-highlight:rgba(255,255,255,.94);
      --approved-chip-label:#477684;
      --approved-chip-text:#204a56;
      --approved-chip-shadow:rgba(16,75,91,.18);
      --approved-icon-soft:#dff5f7;
      --approved-icon-tertiary:#f0c85a;
    }
    body.theme-candy {
      --approved-chip-top:rgba(255,249,253,.86);
      --approved-chip-bottom:rgba(250,220,234,.82);
      --approved-chip-border:rgba(214,93,145,.34);
      --approved-chip-highlight:rgba(255,255,255,.95);
      --approved-chip-label:#9b607b;
      --approved-chip-text:#60384b;
      --approved-chip-shadow:rgba(132,70,97,.16);
      --approved-icon-soft:#fff2f8;
      --approved-icon-tertiary:#f4c956;
    }
    body.theme-midnight {
      --approved-chip-top:rgba(53,61,96,.82);
      --approved-chip-bottom:rgba(31,37,64,.84);
      --approved-chip-border:rgba(124,135,215,.42);
      --approved-chip-highlight:rgba(226,231,255,.24);
      --approved-chip-label:#c0c7e8;
      --approved-chip-text:#f7f8ff;
      --approved-chip-shadow:rgba(5,7,18,.34);
      --approved-icon-soft:#eef0ff;
      --approved-icon-tertiary:#f0c85a;
    }

    /* The approved drawings keep their line-art proportions and inherit
       the current game palette rather than being hard-coded beige/orange. */
    .icon-asset {
      --ri-accent:var(--app-accent) !important;
      --ri-secondary:var(--game-accent-2) !important;
      --ri-tertiary:var(--approved-icon-tertiary) !important;
      --ri-soft:var(--approved-icon-soft) !important;
      color:var(--app-text) !important;
      overflow:visible !important;
    }
    .settings-button .icon-asset,
    .home-brush-button .icon-asset,
    .mode-showcase-modeicon .icon-asset {
      color:var(--app-text) !important;
    }

    /* -----------------------------------------------------
       SOLO ACTIVE HEADER — exact score-chip language from the
       approved icon-system graphic. Passive info, not buttons.
       ----------------------------------------------------- */
    body.solo-active .container {
      width:500px !important;
      max-width:500px !important;
      padding-top:10px !important;
    }
    body.solo-active .container .heading {
      width:100% !important;
      display:grid !important;
      grid-template-columns:132px auto !important;
      justify-content:center !important;
      align-items:center !important;
      gap:16px !important;
      min-height:72px !important;
      margin:0 auto 11px !important;
      padding:0 !important;
      border:0 !important;
      overflow:visible !important;
    }
    body.solo-active .container .title {
      width:132px !important;
      margin:0 !important;
      padding:0 !important;
      color:var(--app-text) !important;
      font-family:var(--hud-display) !important;
      font-size:42px !important;
      font-weight:900 !important;
      line-height:.95 !important;
      letter-spacing:-.035em !important;
      text-align:left !important;
    }
    body.solo-active .scores-container {
      display:flex !important;
      align-items:stretch !important;
      justify-content:flex-start !important;
      gap:10px !important;
      width:auto !important;
      min-width:0 !important;
      height:auto !important;
      margin:0 !important;
      padding:0 !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
      overflow:visible !important;
    }
    body.solo-active .score-container,
    body.solo-active .best-container {
      box-sizing:border-box !important;
      position:relative !important;
      width:118px !important;
      min-width:118px !important;
      height:72px !important;
      min-height:72px !important;
      margin:0 !important;
      padding:28px 10px 8px !important;
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      border:1px solid var(--approved-chip-border) !important;
      border-radius:15px !important;
      background:linear-gradient(145deg,var(--approved-chip-top),var(--approved-chip-bottom)) !important;
      box-shadow:inset 0 1px 0 var(--approved-chip-highlight), 0 8px 22px var(--approved-chip-shadow) !important;
      -webkit-backdrop-filter:blur(14px) saturate(1.08) !important;
      backdrop-filter:blur(14px) saturate(1.08) !important;
      color:var(--approved-chip-text) !important;
      font-family:"Nunito Sans",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif !important;
      font-size:24px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:-.015em !important;
      text-align:center !important;
      overflow:hidden !important;
      pointer-events:none !important;
      cursor:default !important;
    }
    body.solo-active .best-container { border-left:1px solid var(--approved-chip-border) !important; }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position:absolute !important;
      top:9px !important;
      left:0 !important;
      right:0 !important;
      width:100% !important;
      margin:0 !important;
      color:var(--approved-chip-label) !important;
      font-family:var(--hud-display) !important;
      font-size:9px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:.12em !important;
      text-align:center !important;
      text-transform:uppercase !important;
    }
    body.solo-active .score-container::after { content:"SCORE" !important; }
    body.solo-active .best-container::after { content:"BEST" !important; }

    /* -----------------------------------------------------
       SOLO COMMANDS — New Game and Undo are one component.
       ----------------------------------------------------- */
    body.solo-active .solo-card-actions {
      display:grid !important;
      grid-template-columns:132px 132px !important;
      justify-content:space-between !important;
      align-items:center !important;
      width:100% !important;
      gap:14px !important;
      margin:0 0 9px !important;
      padding:0 !important;
    }
    body.solo-active .solo-command-button,
    body.solo-active #solo-new,
    body.solo-active #solo-undo {
      box-sizing:border-box !important;
      width:132px !important;
      min-width:132px !important;
      height:40px !important;
      min-height:40px !important;
      margin:0 !important;
      padding:0 12px !important;
      display:inline-flex !important;
      align-items:center !important;
      justify-content:center !important;
      gap:7px !important;
      border:1px solid color-mix(in srgb,var(--app-accent) 30%,var(--game-line)) !important;
      border-radius:10px !important;
      background:color-mix(in srgb,var(--game-panel-strong) 94%,var(--app-bg) 6%) !important;
      color:var(--app-text) !important;
      box-shadow:0 5px 14px color-mix(in srgb,var(--app-shadow) 16%,transparent) !important;
      font:900 11px/1 var(--hud-display) !important;
      white-space:nowrap !important;
      transition:transform 170ms cubic-bezier(.2,.8,.2,1), border-color 170ms ease, box-shadow 170ms ease, background 170ms ease !important;
    }
    body.solo-active .solo-command-button:hover:not(:disabled),
    body.solo-active #solo-new:hover:not(:disabled),
    body.solo-active #solo-undo:hover:not(:disabled) {
      transform:translateY(-2px) !important;
      border-color:var(--app-accent) !important;
      background:color-mix(in srgb,var(--app-accent) 7%,var(--game-panel-strong)) !important;
      box-shadow:0 8px 18px color-mix(in srgb,var(--app-accent) 16%,transparent) !important;
    }
    body.solo-active .solo-command-button:disabled,
    body.solo-active #solo-undo:disabled {
      opacity:.42 !important;
      transform:none !important;
      box-shadow:none !important;
    }
    body.solo-active .solo-command-button .button-icon { width:15px !important; height:15px !important; }

    /* -----------------------------------------------------
       SOLO LANDING ACTIONS — actually centered, same motion.
       ----------------------------------------------------- */
    .solo-launch-actions {
      box-sizing:border-box !important;
      width:290px !important;
      max-width:100% !important;
      margin:28px auto 0 !important;
      padding:0 !important;
      align-self:center !important;
      justify-self:center !important;
      display:grid !important;
      grid-template-columns:1fr !important;
      gap:10px !important;
    }
    .solo-launch-actions .solo-main-action,
    .solo-launch-actions .solo-text-action {
      box-sizing:border-box !important;
      width:290px !important;
      max-width:100% !important;
      min-width:0 !important;
      height:49px !important;
      min-height:49px !important;
      margin:0 auto !important;
      padding:0 18px !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      text-align:center !important;
      border-radius:12px !important;
      font:900 15px/1 var(--hud-display) !important;
      transition:transform 180ms cubic-bezier(.2,.8,.2,1), box-shadow 180ms ease, background 180ms ease, border-color 180ms ease !important;
    }
    .solo-launch-actions .solo-main-action:hover,
    .solo-launch-actions .solo-text-action:hover {
      transform:translateY(-2px) scale(1.01) !important;
      box-shadow:0 10px 24px color-mix(in srgb,var(--app-accent) 18%,transparent) !important;
    }
    .solo-launch-actions .solo-text-action:hover {
      border-color:var(--app-accent) !important;
      background:color-mix(in srgb,var(--app-accent) 8%,var(--game-panel-strong)) !important;
    }

    /* -----------------------------------------------------
       APPROVED MODE ICONS — the old emoji concepts now use
       restrained line-art graphics from rinas-icons.svg.
       ----------------------------------------------------- */
    .mode-showcase-title-row {
      display:flex !important;
      align-items:center !important;
      gap:13px !important;
      margin:0 0 5px !important;
    }
    .mode-showcase-title-row > div { min-width:0 !important; }
    .mode-showcase-modeicon {
      flex:0 0 48px !important;
      width:48px !important;
      height:48px !important;
      display:grid !important;
      place-items:center !important;
      border:1px solid color-mix(in srgb,var(--mode-hue) 25%,var(--game-line)) !important;
      border-radius:12px !important;
      background:color-mix(in srgb,var(--game-panel-strong) 88%,transparent) !important;
      box-shadow:0 6px 15px color-mix(in srgb,var(--app-shadow) 13%,transparent) !important;
    }
    .mode-showcase-modeicon .mode-art-icon {
      width:30px !important;
      height:30px !important;
      display:block !important;
    }
    .mode-showcase-title-row .mode-showcase-index { display:block !important; margin:0 0 3px !important; }
    .mode-showcase-title-row h2 { margin:0 !important; }

    /* -----------------------------------------------------
       MULTIPLAYER MENU — reclaim the top air and spend it on
       larger mode choices + genuinely readable live previews.
       ----------------------------------------------------- */
    @media (min-width:901px) {
      .screen-multiplayer-menu.app-screen {
        padding-top:0 !important;
        padding-bottom:18px !important;
      }
      .screen-multiplayer-menu .app-screen-inner {
        width:min(1180px,calc(100% - 34px)) !important;
        max-width:1180px !important;
        padding-top:0 !important;
      }
      .screen-multiplayer-menu .app-header {
        min-height:54px !important;
        margin:0 0 2px !important;
        padding:1px 0 6px !important;
      }
      .screen-multiplayer-menu .app-title-stack h1 { font-size:29px !important; }
      .screen-multiplayer-menu .multiplayer-entry-head {
        min-height:34px !important;
        margin:0 0 7px !important;
        padding:2px 0 6px !important;
      }
      .screen-multiplayer-menu .mode-showcase-list {
        display:grid !important;
        grid-template-columns:1fr !important;
        gap:10px !important;
        width:100% !important;
        overflow:visible !important;
      }
      .screen-multiplayer-menu #mode-tile-race,
      .screen-multiplayer-menu #mode-freeplay,
      .screen-multiplayer-menu #mode-custom-race,
      .screen-multiplayer-menu .mode-showcase {
        box-sizing:border-box !important;
        width:100% !important;
        height:178px !important;
        min-height:178px !important;
        padding:17px 22px !important;
        display:grid !important;
        grid-template-columns:minmax(0,1fr) 360px !important;
        align-items:center !important;
        gap:26px !important;
        overflow:visible !important;
        border-radius:17px !important;
      }
      .screen-multiplayer-menu .mode-showcase-copy { min-width:0 !important; align-self:center !important; }
      .screen-multiplayer-menu .mode-showcase h2 { font-size:28px !important; line-height:1 !important; }
      .screen-multiplayer-menu .mode-showcase p {
        max-width:650px !important;
        margin:5px 0 7px !important;
        font-size:14px !important;
        line-height:1.32 !important;
      }
      .screen-multiplayer-menu .mode-showcase-facts { gap:16px !important; margin:0 0 6px !important; }
      .screen-multiplayer-menu .mode-showcase-action { margin-top:0 !important; }
      .screen-multiplayer-menu .mode-showcase-preview {
        box-sizing:border-box !important;
        width:360px !important;
        min-width:360px !important;
        height:138px !important;
        min-height:138px !important;
        padding:10px 14px !important;
        justify-self:start !important;
        align-self:center !important;
        display:flex !important;
        align-items:center !important;
        justify-content:center !important;
        overflow:visible !important;
      }
      .screen-multiplayer-menu .mode-showcase .ui-mini-board {
        width:112px !important;
        height:112px !important;
      }
      .screen-multiplayer-menu .mode-visual-pair { gap:15px !important; justify-content:center !important; }
      .screen-multiplayer-menu .mode-freeplay-visual {
        width:100% !important;
        grid-template-columns:112px minmax(0,1fr) !important;
        gap:18px !important;
      }
      .screen-multiplayer-menu .custom-target { min-height:96px !important; padding:11px 13px !important; }
      .screen-multiplayer-menu .custom-target strong { font-size:29px !important; }
      .screen-multiplayer-menu .future-modes-strip {
        margin:7px 0 14px !important;
        gap:26px !important;
      }
    }

    @media (max-height:800px) and (min-width:901px) {
      .screen-multiplayer-menu #mode-tile-race,
      .screen-multiplayer-menu #mode-freeplay,
      .screen-multiplayer-menu #mode-custom-race,
      .screen-multiplayer-menu .mode-showcase {
        height:166px !important;
        min-height:166px !important;
      }
      .screen-multiplayer-menu .mode-showcase-preview {
        height:126px !important;
        min-height:126px !important;
      }
      .screen-multiplayer-menu .mode-showcase .ui-mini-board { width:102px !important; height:102px !important; }
      .screen-multiplayer-menu .mode-freeplay-visual { grid-template-columns:102px minmax(0,1fr) !important; }
      .screen-multiplayer-menu .mode-showcase-modeicon { width:44px !important; height:44px !important; flex-basis:44px !important; }
      .screen-multiplayer-menu .mode-showcase-modeicon .mode-art-icon { width:27px !important; height:27px !important; }
    }

    @media (max-width:900px) {
      body.solo-active .container .heading { grid-template-columns:1fr !important; gap:10px !important; }
      body.solo-active .container .title { width:auto !important; text-align:center !important; }
      body.solo-active .scores-container { justify-content:center !important; }
      .solo-launch-actions,
      .solo-launch-actions .solo-main-action,
      .solo-launch-actions .solo-text-action { width:100% !important; }
      .mode-showcase-title-row { align-items:flex-start !important; }
      .mode-showcase-modeicon { width:42px !important; height:42px !important; flex-basis:42px !important; }
    }
  `;
  document.head.appendChild(v52Style);

  // =========================================================
  // v54: glass stat chips + real viewport fitting
  // =========================================================
  var v54Style = document.createElement("style");
  v54Style.id = "rinas-v54-glass-fit";
  v54Style.textContent = `
    /* The approved Score / Best mockup is the source of truth:
       soft glass, theme tint, passive information, no dark scoreboard strip. */
    body.solo-active .score-container,
    body.solo-active .best-container {
      isolation:isolate !important;
      overflow:hidden !important;
    }
    body.solo-active .score-container::before,
    body.solo-active .best-container::before {
      content:"" !important;
      position:absolute !important;
      inset:1px 1px auto 1px !important;
      height:46% !important;
      border-radius:14px 14px 45% 45% !important;
      background:linear-gradient(to bottom,rgba(255,255,255,.18),rgba(255,255,255,0)) !important;
      pointer-events:none !important;
      z-index:-1 !important;
    }

    @media (min-width:901px) {
      /* Old viewport-specific child zoom rules are intentionally neutralized.
         JS now scales #game-host from the space that actually exists. */
      body.solo-active .container {
        zoom:1 !important;
        margin:2px auto 0 !important;
        padding-top:0 !important;
      }
      body.solo-active #solo-toolbar {
        margin:8px auto 3px !important;
        min-height:56px !important;
      }
      body.solo-active .solo-floating-header {
        min-height:56px !important;
        padding:5px 0 7px !important;
      }
      body.solo-active .container .heading {
        margin-bottom:8px !important;
      }
      body.solo-active #game-host {
        margin:0 !important;
        transform-origin:top center !important;
      }
      body.solo-active #solo-control-strip {
        margin-top:6px !important;
        padding-top:4px !important;
      }
    }
  `;
  document.head.appendChild(v54Style);

  // =========================================================
  // v55: approved soft-glass stat chips + hard viewport fit
  // =========================================================
  var v55Style = document.createElement("style");
  v55Style.id = "rinas-v55-soft-chips-fit";
  v55Style.textContent = `
    /* Score and Best must match the approved mockup: light, soft,
       glassy stat surfaces. They are information chips, not dark HUD cards. */
    body.solo-active .score-container,
    body.solo-active .best-container {
      background:#fffaf5 !important;
      background-image:linear-gradient(145deg,rgba(255,255,255,.94),rgba(255,247,239,.82)) !important;
      border:1px solid rgba(160,135,110,.24) !important;
      border-left:1px solid rgba(160,135,110,.24) !important;
      color:#2d2925 !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.98), 0 7px 20px rgba(76,56,42,.10) !important;
      -webkit-backdrop-filter:blur(12px) saturate(1.06) !important;
      backdrop-filter:blur(12px) saturate(1.06) !important;
    }
    body.solo-active .score-container::after,
    body.solo-active .best-container::after { color:#84786e !important; }
    body.solo-active .score-container::before,
    body.solo-active .best-container::before {
      background:linear-gradient(to bottom,rgba(255,255,255,.72),rgba(255,255,255,0)) !important;
      opacity:.72 !important;
    }

    body.theme-pastel.solo-active .score-container,
    body.theme-pastel.solo-active .best-container {
      background:#faf7ff !important;
      background-image:linear-gradient(145deg,rgba(255,255,255,.95),rgba(240,234,255,.88)) !important;
      border-color:rgba(145,124,202,.28) !important;
      color:#332e42 !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.98),0 7px 20px rgba(91,73,132,.11) !important;
    }
    body.theme-pastel.solo-active .score-container::after,
    body.theme-pastel.solo-active .best-container::after { color:#796e91 !important; }

    body.theme-ocean.solo-active .score-container,
    body.theme-ocean.solo-active .best-container {
      background:#edfafd !important;
      background-image:linear-gradient(145deg,rgba(250,255,255,.97),rgba(211,239,245,.90)) !important;
      border-color:rgba(62,146,168,.30) !important;
      color:#214b57 !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.98),0 7px 20px rgba(21,91,107,.13) !important;
    }
    body.theme-ocean.solo-active .score-container::after,
    body.theme-ocean.solo-active .best-container::after { color:#4d7883 !important; }

    body.theme-candy.solo-active .score-container,
    body.theme-candy.solo-active .best-container {
      background:#fff7fb !important;
      background-image:linear-gradient(145deg,rgba(255,255,255,.97),rgba(251,222,236,.90)) !important;
      border-color:rgba(208,85,139,.28) !important;
      color:#61384b !important;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.98),0 7px 20px rgba(138,67,100,.12) !important;
    }
    body.theme-candy.solo-active .score-container::after,
    body.theme-candy.solo-active .best-container::after { color:#9a627a !important; }

    body.theme-midnight.solo-active .score-container,
    body.theme-midnight.solo-active .best-container {
      /* Midnight is still glass, but lifted from the page so it never reads as a black block. */
      background:#313750 !important;
      background-image:linear-gradient(145deg,rgba(69,77,112,.94),rgba(43,49,76,.91)) !important;
      border-color:rgba(156,168,235,.32) !important;
      color:#f8f9ff !important;
      box-shadow:inset 0 1px 0 rgba(235,239,255,.25),0 8px 22px rgba(3,5,16,.24) !important;
    }
    body.theme-midnight.solo-active .score-container::after,
    body.theme-midnight.solo-active .best-container::after { color:#d1d6f2 !important; }

    /* Keep the approved chip proportions and avoid any old score-strip styling. */
    body.solo-active .scores-container {
      background:transparent !important;
      border:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
      gap:10px !important;
    }

    @media (min-width:901px) {
      body.solo-active #game-host {
        zoom:1;
        transform:none !important;
        transform-origin:top center !important;
      }
      body.solo-active #solo-control-strip { margin-bottom:2px !important; }
    }
  `;
  document.head.appendChild(v55Style);


  // =========================================================
  // v56: soft theme cards for Score / Best — no glass
  // =========================================================
  var v56Style = document.createElement("style");
  v56Style.id = "rinas-v56-soft-stat-cards";
  v56Style.textContent = `
    /*
      SCORE / BEST — approved mockup treatment.
      These are quiet information cards, not glass and not dark HUD blocks.
      The surface sits close to the current game background; the outline is
      just strong enough to define the rounded shape, like multiplayer cards.
    */
    body.solo-active .scores-container {
      display:flex !important;
      align-items:stretch !important;
      justify-content:flex-start !important;
      gap:12px !important;
      width:auto !important;
      min-width:0 !important;
      margin:0 !important;
      padding:0 !important;
      background:transparent !important;
      border:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      box-sizing:border-box !important;
      position:relative !important;
      width:118px !important;
      min-width:118px !important;
      height:72px !important;
      min-height:72px !important;
      margin:0 !important;
      padding:29px 12px 9px !important;
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      border-radius:15px !important;
      border:1.5px solid var(--stat-card-border) !important;
      border-left:1.5px solid var(--stat-card-border) !important;
      background:var(--stat-card-bg) !important;
      background-image:none !important;
      box-shadow:none !important;
      -webkit-backdrop-filter:none !important;
      backdrop-filter:none !important;
      color:var(--stat-card-text) !important;
      font-family:var(--hud-display) !important;
      font-size:24px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:-.015em !important;
      text-align:center !important;
      overflow:hidden !important;
      pointer-events:none !important;
      cursor:default !important;
    }

    /* Remove the old glass highlight that created the dark / shiny corners. */
    body.solo-active .score-container::before,
    body.solo-active .best-container::before {
      content:none !important;
      display:none !important;
      background:none !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position:absolute !important;
      top:10px !important;
      left:0 !important;
      right:0 !important;
      width:100% !important;
      margin:0 !important;
      color:var(--stat-card-label) !important;
      font-family:var(--hud-display) !important;
      font-size:9px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:.12em !important;
      text-align:center !important;
      text-transform:uppercase !important;
    }
    body.solo-active .score-container::after { content:"SCORE" !important; }
    body.solo-active .best-container::after { content:"BEST" !important; }

    /* Classic: almost the same cream as the page, with a darker warm edge. */
    body.theme-classic {
      --stat-card-bg:#f7f1e7;
      --stat-card-border:#b9aa99;
      --stat-card-text:#2c2825;
      --stat-card-label:#74695f;
    }

    /* Pastel: soft lilac-white surface, no transparency. */
    body.theme-pastel {
      --stat-card-bg:#f7f4ff;
      --stat-card-border:#aaa0c4;
      --stat-card-text:#312e43;
      --stat-card-label:#756d8a;
    }

    /* Ocean: pale blue surface that stays close to the game background. */
    body.theme-ocean {
      --stat-card-bg:#102a35;
      --stat-card-border:#376674;
      --stat-card-text:#e9fbff;
      --stat-card-label:#a9d5df;
    }

    /* Candy: muted plum surface like the multiplayer cards. */
    body.theme-candy {
      --stat-card-bg:#32162e;
      --stat-card-border:#74415f;
      --stat-card-text:#fff2fb;
      --stat-card-label:#e3bad0;
    }

    /* Midnight: same family as the page/card background — never black. */
    body.theme-midnight {
      --stat-card-bg:#15182b;
      --stat-card-border:#4a4f78;
      --stat-card-text:#f3f4ff;
      --stat-card-label:#bdc3e4;
    }

    /* Keep the chips clear of the header divider. */
    body.solo-active .container .heading {
      align-items:center !important;
      column-gap:14px !important;
    }

    @media (max-width:900px) {
      body.solo-active .score-container,
      body.solo-active .best-container {
        width:108px !important;
        min-width:108px !important;
        height:66px !important;
        min-height:66px !important;
      }
    }
  `;
  document.head.appendChild(v56Style);


  // =========================================================
  // v57: exact mockup-style Solo score chips
  // =========================================================
  var v57Style = document.createElement("style");
  v57Style.id = "rinas-v57-mockup-score-chips";
  v57Style.textContent = `
    /*
      SCORE / BEST
      Match the approved icon-system mockup:
      - clearly rounded
      - light, softly theme-tinted surface
      - dark readable type
      - visible darker outline
      - compact proportions
      - no black fill, no glass, no gradient, no shine
    */
    body.solo-active .container {
      padding-top:14px !important;
    }

    body.solo-active .container .heading {
      grid-template-columns:132px auto !important;
      gap:18px !important;
      min-height:64px !important;
      margin:0 auto 10px !important;
      padding:0 !important;
      align-items:center !important;
      overflow:visible !important;
    }

    body.solo-active .scores-container {
      display:flex !important;
      align-items:center !important;
      justify-content:flex-start !important;
      gap:10px !important;
      width:auto !important;
      height:auto !important;
      margin:0 !important;
      padding:0 !important;
      border:0 !important;
      border-radius:0 !important;
      background:transparent !important;
      box-shadow:none !important;
      overflow:visible !important;
    }

    body.solo-active .score-container,
    body.solo-active .best-container {
      box-sizing:border-box !important;
      position:relative !important;
      width:104px !important;
      min-width:104px !important;
      height:64px !important;
      min-height:64px !important;
      margin:0 !important;
      padding:27px 10px 8px !important;
      display:flex !important;
      align-items:flex-end !important;
      justify-content:center !important;
      border-width:2px !important;
      border-style:solid !important;
      border-left-width:2px !important;
      border-radius:18px !important;
      background-image:none !important;
      box-shadow:0 4px 10px rgba(40,32,28,.06) !important;
      -webkit-backdrop-filter:none !important;
      backdrop-filter:none !important;
      font-family:var(--hud-display) !important;
      font-size:24px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:-.02em !important;
      text-align:center !important;
      overflow:hidden !important;
      pointer-events:none !important;
      cursor:default !important;
    }

    body.solo-active .score-container::before,
    body.solo-active .best-container::before {
      content:none !important;
      display:none !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      position:absolute !important;
      top:9px !important;
      left:0 !important;
      right:0 !important;
      width:100% !important;
      margin:0 !important;
      font-family:var(--hud-display) !important;
      font-size:10px !important;
      font-weight:900 !important;
      line-height:1 !important;
      letter-spacing:.10em !important;
      text-align:center !important;
      text-transform:uppercase !important;
    }
    body.solo-active .score-container::after { content:"SCORE" !important; }
    body.solo-active .best-container::after { content:"BEST" !important; }

    /* Classic — warm cream, never black. */
    body.theme-classic.solo-active .score-container,
    body.theme-classic.solo-active .best-container {
      background:#f8f2e8 !important;
      border-color:#8d7f72 !important;
      color:#2c2825 !important;
    }
    body.theme-classic.solo-active .score-container::after,
    body.theme-classic.solo-active .best-container::after { color:#6f645c !important; }

    /* Pastel — soft lilac white. */
    body.theme-pastel.solo-active .score-container,
    body.theme-pastel.solo-active .best-container {
      background:#f7f4ff !important;
      border-color:#83799b !important;
      color:#312e43 !important;
    }
    body.theme-pastel.solo-active .score-container::after,
    body.theme-pastel.solo-active .best-container::after { color:#6f6682 !important; }

    /* Ocean — light aqua chip over the dark ocean board/page. */
    body.theme-ocean.solo-active .score-container,
    body.theme-ocean.solo-active .best-container {
      background:#e7f6f8 !important;
      border-color:#447783 !important;
      color:#183f49 !important;
    }
    body.theme-ocean.solo-active .score-container::after,
    body.theme-ocean.solo-active .best-container::after { color:#4e727b !important; }

    /* Candy — light blush, not plum/black. */
    body.theme-candy.solo-active .score-container,
    body.theme-candy.solo-active .best-container {
      background:#fff0f7 !important;
      border-color:#8e5873 !important;
      color:#533442 !important;
    }
    body.theme-candy.solo-active .score-container::after,
    body.theme-candy.solo-active .best-container::after { color:#8c6073 !important; }

    /* Midnight — still a LIGHT chip, tinted cool lavender-gray. */
    body.theme-midnight.solo-active .score-container,
    body.theme-midnight.solo-active .best-container {
      background:#eef0fb !important;
      border-color:#656c98 !important;
      color:#242842 !important;
    }
    body.theme-midnight.solo-active .score-container::after,
    body.theme-midnight.solo-active .best-container::after { color:#626986 !important; }

    /* Fallback: if a theme class is ever missing, use the mockup's light treatment. */
    body.solo-active:not(.theme-classic):not(.theme-pastel):not(.theme-ocean):not(.theme-candy):not(.theme-midnight) .score-container,
    body.solo-active:not(.theme-classic):not(.theme-pastel):not(.theme-ocean):not(.theme-candy):not(.theme-midnight) .best-container {
      background:#f8f2e8 !important;
      border-color:#8d7f72 !important;
      color:#2c2825 !important;
    }

    /* Keep chips visually separated from the top divider. */
    body.solo-active #solo-toolbar {
      margin-bottom:0 !important;
    }

    @media (max-width:900px) {
      body.solo-active .container { padding-top:10px !important; }
      body.solo-active .container .heading {
        grid-template-columns:1fr !important;
        gap:9px !important;
      }
      body.solo-active .container .title {
        width:auto !important;
        text-align:center !important;
      }
      body.solo-active .scores-container { justify-content:center !important; }
      body.solo-active .score-container,
      body.solo-active .best-container {
        width:100px !important;
        min-width:100px !important;
        height:62px !important;
        min-height:62px !important;
      }
    }
  `;
  document.head.appendChild(v57Style);


  // =========================================================
  // v58: button-matched score chips + remove high-tile glow
  // =========================================================
  var v58Style = document.createElement("style");
  v58Style.id = "rinas-v58-rounded-chips-no-glow";
  v58Style.textContent = `
    /*
      SOLO SCORE / BEST
      Match the geometry of Settings / New Game / Undo:
      clear rounded corners, compact proportions, no clipped square edges.
    */
    body.solo-active .score-container,
    body.solo-active .best-container {
      width:108px !important;
      min-width:108px !important;
      height:66px !important;
      min-height:66px !important;
      padding:28px 12px 9px !important;
      border-radius:12px !important;
      -webkit-border-radius:12px !important;
      clip-path:none !important;
      -webkit-clip-path:none !important;
      overflow:hidden !important;
      background-clip:padding-box !important;
      box-shadow:none !important;
      transform:none !important;
    }

    body.solo-active .score-container::before,
    body.solo-active .best-container::before {
      content:none !important;
      display:none !important;
    }

    body.solo-active .score-container::after,
    body.solo-active .best-container::after {
      top:10px !important;
      font-size:10px !important;
      letter-spacing:.09em !important;
    }

    /* Keep the stat row comfortably below the header divider. */
    body.solo-active .container .heading {
      margin-top:8px !important;
      margin-bottom:12px !important;
      min-height:68px !important;
    }

    /*
      Remove the legacy 2048 glow from high-value tiles.
      The original stylesheet applies increasingly strong box-shadows to
      high tiles; theme colors already communicate value, so no glow is needed.
    */
    body.solo-active .tile.tile-128 .tile-inner,
    body.solo-active .tile.tile-256 .tile-inner,
    body.solo-active .tile.tile-512 .tile-inner,
    body.solo-active .tile.tile-1024 .tile-inner,
    body.solo-active .tile.tile-2048 .tile-inner,
    body.solo-active .tile.tile-4096 .tile-inner,
    body.solo-active .tile.tile-8192 .tile-inner,
    body.solo-active .tile.tile-super .tile-inner {
      box-shadow:none !important;
      filter:none !important;
      text-shadow:none !important;
    }

    /* Also prevent a neighboring tile/board effect from reading as a glow. */
    body.solo-active .game-container,
    body.solo-active .tile-container,
    body.solo-active .tile .tile-inner {
      filter:none !important;
    }

    @media (max-width:900px) {
      body.solo-active .score-container,
      body.solo-active .best-container {
        width:102px !important;
        min-width:102px !important;
        height:64px !important;
        min-height:64px !important;
        border-radius:11px !important;
        -webkit-border-radius:11px !important;
      }
    }
  `;
  document.head.appendChild(v58Style);



  // =========================================================
  // v59: structural Solo stat chips
  // =========================================================
  // The original 2048 score elements are now only the numeric value.
  // A dedicated outer wrapper owns the visual card. This prevents legacy
  // .score-container/.best-container rules from flattening the corners.
  var v59Style = document.createElement("style");
  v59Style.id = "rinas-v59-structural-stat-chips";
  v59Style.textContent = `
    body.solo-active .rinas-stat-group {
      display:flex !important;
      align-items:center !important;
      justify-content:flex-end !important;
      gap:12px !important;
      margin:0 !important;
      padding:0 !important;
      background:none !important;
      border:0 !important;
      box-shadow:none !important;
      overflow:visible !important;
    }

    body.solo-active .rinas-stat-chip {
      box-sizing:border-box !important;
      width:112px !important;
      height:66px !important;
      padding:9px 12px 8px !important;
      display:flex !important;
      flex-direction:column !important;
      align-items:center !important;
      justify-content:center !important;
      gap:5px !important;
      border:1px solid color-mix(in srgb,var(--app-accent) 30%,var(--game-line)) !important;
      border-radius:10px !important;
      -webkit-border-radius:10px !important;
      background:color-mix(in srgb,var(--game-panel-strong) 94%,var(--app-bg) 6%) !important;
      color:var(--app-text) !important;
      box-shadow:0 5px 14px color-mix(in srgb,var(--app-shadow) 14%,transparent) !important;
      overflow:hidden !important;
      clip-path:none !important;
      -webkit-clip-path:none !important;
      position:relative !important;
    }

    body.solo-active .rinas-stat-label {
      display:block !important;
      margin:0 !important;
      padding:0 !important;
      color:var(--app-muted) !important;
      font:900 10px/1 var(--hud-display) !important;
      letter-spacing:.11em !important;
      text-align:center !important;
      text-transform:uppercase !important;
      white-space:nowrap !important;
    }

    /* Hard reset the legacy 2048 score boxes: number only. */
    body.solo-active .rinas-stat-chip .score-container,
    body.solo-active .rinas-stat-chip .best-container {
      all:unset !important;
      display:block !important;
      width:auto !important;
      height:auto !important;
      min-width:0 !important;
      min-height:0 !important;
      margin:0 !important;
      padding:0 !important;
      background:transparent !important;
      border:0 !important;
      border-radius:0 !important;
      box-shadow:none !important;
      color:var(--app-text) !important;
      font:900 21px/.95 var(--hud-display) !important;
      letter-spacing:-.025em !important;
      text-align:center !important;
      overflow:visible !important;
      position:static !important;
      float:none !important;
      transform:none !important;
    }

    body.solo-active .rinas-stat-chip .score-container::before,
    body.solo-active .rinas-stat-chip .score-container::after,
    body.solo-active .rinas-stat-chip .best-container::before,
    body.solo-active .rinas-stat-chip .best-container::after {
      content:none !important;
      display:none !important;
    }

    body.solo-active .score-addition { display:none !important; }

    /* Give the new cards the same breathing room as the command buttons. */
    body.solo-active .container .heading {
      margin-top:12px !important;
      margin-bottom:13px !important;
      min-height:70px !important;
      align-items:center !important;
    }

    @media (max-width:900px) {
      body.solo-active .rinas-stat-group { gap:8px !important; }
      body.solo-active .rinas-stat-chip {
        width:102px !important;
        height:62px !important;
        border-radius:10px !important;
        padding:8px 10px 7px !important;
      }
      body.solo-active .rinas-stat-chip .score-container,
      body.solo-active .rinas-stat-chip .best-container {
        font-size:19px !important;
      }
    }
  `;
  document.head.appendChild(v59Style);

  // =========================================================
  // v69: smooth remote-board motion
  // =========================================================
  // The local player uses the original 2048 tile actuator, which animates
  // tiles between coordinates. The opponent board used to repaint 16 static
  // cells on every Socket.IO snapshot. These transient overlay tiles give
  // the remote board the same slide -> merge -> spawn rhythm.
  var v69OpponentMotionStyle = document.createElement("style");
  v69OpponentMotionStyle.id = "rinas-v69-opponent-motion";
  v69OpponentMotionStyle.textContent = `
    .opponent-grid {
      position:relative !important;
      overflow:hidden !important;
      isolation:isolate !important;
    }

    .opponent-motion-tile {
      position:absolute !important;
      z-index:12 !important;
      margin:0 !important;
      box-sizing:border-box !important;
      pointer-events:none !important;
      will-change:transform !important;
      transition-property:transform !important;
      transition-timing-function:cubic-bezier(.22,.75,.28,1) !important;
      transform:translate3d(0,0,0);
    }

    .opponent-cell.opponent-cell-pop {
      animation:rinasOpponentMergePop 145ms cubic-bezier(.2,.9,.25,1) both !important;
      position:relative;
      z-index:3;
    }

    .opponent-cell.opponent-cell-spawn {
      animation:rinasOpponentSpawn 135ms cubic-bezier(.2,.85,.3,1) both !important;
      position:relative;
      z-index:2;
    }

    .opponent-grid.opponent-grid-soft-refresh {
      animation:rinasOpponentSoftRefresh 120ms ease-out both !important;
    }

    @keyframes rinasOpponentSoftRefresh {
      0% { opacity:.72; }
      100% { opacity:1; }
    }

    @keyframes rinasOpponentMergePop {
      0% { transform:scale(.88); }
      58% { transform:scale(1.07); }
      100% { transform:scale(1); }
    }

    @keyframes rinasOpponentSpawn {
      0% { transform:scale(.78); opacity:.35; }
      70% { transform:scale(1.04); opacity:1; }
      100% { transform:scale(1); opacity:1; }
    }

    @media (prefers-reduced-motion:reduce) {
      .opponent-motion-tile {
        transition:none !important;
      }

      .opponent-cell.opponent-cell-pop,
      .opponent-cell.opponent-cell-spawn,
      .opponent-grid.opponent-grid-soft-refresh {
        animation:none !important;
      }
    }
  `;
  document.head.appendChild(v69OpponentMotionStyle);

  restoreGameContainer();
  showMainMenu();

  // The designed application is now fully styled and rendered.
  // Reveal the static game host/footer only after boot so no plain-text
  // "Original 2048 by Gabriele Cirulli" flash appears during page load.
  document.body.classList.add("rinas-app-ready");
})();

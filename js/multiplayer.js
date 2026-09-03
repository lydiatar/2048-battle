(function () {
  "use strict";

  var SOCKET_SERVER_URL = "https://two048-battle-oc8k.onrender.com";

  function createOfflineSocket() {
    var listeners = Object.create(null);
    return {
      connected: false,
      offlineFallback: true,
      on: function (eventName, handler) {
        if (typeof handler === "function") {
          if (!listeners[eventName]) listeners[eventName] = [];
          listeners[eventName].push(handler);
        }
        return this;
      },
      emit: function (eventName) {
        console.warn("Multiplayer is unavailable while Socket.IO is not connected:", eventName);
        return this;
      }
    };
  }

  var socket;
  try {
    socket = typeof window.io === "function"
      ? window.io(SOCKET_SERVER_URL, {
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 700,
          reconnectionDelayMax: 5000,
          timeout: 30000
        })
      : createOfflineSocket();
  } catch (socketBootError) {
    console.error("Rina multiplayer socket boot failed:", socketBootError);
    socket = createOfflineSocket();
  }

  window.multiplayerSocket = socket;

  var appRoot = document.getElementById("app-root");
  var gameHost = document.getElementById("game-host");
  var soloToolbar = document.getElementById("solo-toolbar");
  var gameContainer = document.querySelector(".container");

  var SETTINGS_KEY = "rinas2048.settings";
  var LAST_TARGET_KEY = "rinas2048.lastRaceTarget";
  var LAST_CUSTOM_HOST_TARGET_KEY = "rinas2048.lastCustomHostTarget";
  var LAST_CUSTOM_GUEST_TARGET_KEY = "rinas2048.lastCustomGuestTarget";
  var LAST_PLAYER_COUNT_KEY = "rinas2048.lastMultiplayerPlayerCount";
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
  var selectedPlayerCount = Number(safeStorageGet(LAST_PLAYER_COUNT_KEY, 2));
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
  var currentLobbyState = null;
  var groupOpponentViews = Object.create(null);
  var latestPlayerStates = Object.create(null);
  var latestGroupRaceState = null;
  var groupRaceSpineElement = null;
  var localSpectatorNotice = null;

  if (TARGETS.indexOf(selectedTarget) === -1) {
    selectedTarget = 2048;
  }

  if (CUSTOM_TARGETS.indexOf(selectedCustomHostTarget) === -1) {
    selectedCustomHostTarget = 2048;
  }

  if (CUSTOM_TARGETS.indexOf(selectedCustomGuestTarget) === -1) {
    selectedCustomGuestTarget = 4096;
  }


  function sanitizePlayerCount(value) {
    var count = Number(value);
    return count === 3 || count === 4 ? count : 2;
  }

  selectedPlayerCount = sanitizePlayerCount(selectedPlayerCount);
  window.multiplayerSelectedPlayerCount = selectedPlayerCount;

  function setSelectedPlayerCount(value) {
    selectedPlayerCount = sanitizePlayerCount(value);
    window.multiplayerSelectedPlayerCount = selectedPlayerCount;
    safeStorageSet(LAST_PLAYER_COUNT_KEY, selectedPlayerCount);
    return selectedPlayerCount;
  }

  function multiplayerPlayerCountLabel(value) {
    var count = sanitizePlayerCount(value);
    return count + (count === 1 ? " Player" : " Players");
  }

  function multiplayerEligibleDevice() {
    var screenWidth = window.screen && Number(window.screen.width);
    var screenHeight = window.screen && Number(window.screen.height);

    if (screenWidth > 0 && screenHeight > 0) {
      return Math.min(screenWidth, screenHeight) >= 600;
    }

    return Math.min(window.innerWidth || 0, window.innerHeight || 0) >= 600;
  }

  function requireMultiplayerEligibleDevice() {
    if (multiplayerEligibleDevice()) return true;
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    return false;
  }

  function multiplayerPreviewArenaMarkup(playerCount) {
    var count = sanitizePlayerCount(playerCount);

    if (count === 2) {
      return '' +
        '<div class="pvp-preview-player pvp-preview-primary">' +
          '<span class="pvp-player-label"><i aria-hidden="true"></i>You</span>' +
          '<div class="motion-board motion-board-small pvp-motion-board" data-preview="multi-a">' +
            '<div class="motion-wells" aria-hidden="true"></div>' +
            '<div class="motion-tiles" aria-hidden="true"></div>' +
          '</div>' +
        '</div>' +
        '<span class="pvp-versus" aria-hidden="true">VS</span>' +
        '<div class="pvp-preview-player pvp-preview-primary">' +
          '<span class="pvp-player-label friend"><i aria-hidden="true"></i>Opponent</span>' +
          '<div class="motion-board motion-board-small pvp-motion-board" data-preview="multi-b">' +
            '<div class="motion-wells" aria-hidden="true"></div>' +
            '<div class="motion-tiles" aria-hidden="true"></div>' +
          '</div>' +
        '</div>';
    }

    var previews = ["multi-b", "multi-c", "multi-d"];
    var opponentMarkup = "";
    for (var i = 0; i < count - 1; i += 1) {
      opponentMarkup += '' +
        '<div class="pvp-preview-opponent-mini">' +
          '<span class="pvp-mini-label">P' + (i + 2) + '</span>' +
          '<div class="motion-board motion-board-small pvp-motion-board pvp-motion-board-mini" data-preview="' + previews[i] + '">' +
            '<div class="motion-wells" aria-hidden="true"></div>' +
            '<div class="motion-tiles" aria-hidden="true"></div>' +
          '</div>' +
        '</div>';
    }

    return '' +
      '<div class="pvp-preview-player pvp-preview-primary pvp-preview-primary-large">' +
        '<span class="pvp-player-label"><i aria-hidden="true"></i>You</span>' +
        '<div class="motion-board motion-board-small pvp-motion-board" data-preview="multi-a">' +
          '<div class="motion-wells" aria-hidden="true"></div>' +
          '<div class="motion-tiles" aria-hidden="true"></div>' +
        '</div>' +
      '</div>' +
      '<div class="pvp-preview-opponent-rail" aria-label="' + (count - 1) + ' opponent previews">' +
        opponentMarkup +
      '</div>';
  }

  function playerCountSelectorMarkup() {
    return '' +
      '<div class="multiplayer-player-count" aria-labelledby="multiplayer-player-count-label">' +
        '<span class="match-setup-kicker" id="multiplayer-player-count-label">PLAYERS</span>' +
        '<div class="multiplayer-player-count-buttons" role="group" aria-label="Choose number of players">' +
          [2, 3, 4].map(function (count) {
            return '<button type="button" class="multiplayer-player-count-button ' +
              (selectedPlayerCount === count ? 'is-selected' : '') +
              '" data-player-count="' + count + '" aria-pressed="' +
              (selectedPlayerCount === count ? 'true' : 'false') + '">' +
              count + ' Players</button>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  function selectedPlayerCountSummaryMarkup() {
    return '' +
      '<div class="match-player-count-summary" aria-label="Selected multiplayer size">' +
        '<span>Players</span>' +
        '<strong>' + multiplayerPlayerCountLabel(selectedPlayerCount) + '</strong>' +
      '</div>';
  }


  function sanitizeNickname(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  function formatScore(value) {
    return Math.max(0, Number(value || 0)).toLocaleString("en-US");
  }

  function formatTile(value) {
    var number = Number(value || 0);
    if (!Number.isFinite(number)) number = 0;
    return String(Math.max(0, Math.round(number)));
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


  function getOtherProfiles() {
    var ownNumber = Number(window.multiplayerPlayerNumber);
    return (window.multiplayerProfiles || [])
      .filter(function (profile) { return Number(profile.playerNumber) !== ownNumber; })
      .sort(function (a, b) { return Number(a.playerNumber) - Number(b.playerNumber); });
  }

  function targetForProfile(profile) {
    if (!profile) return Number(window.multiplayerTargetTile || 2048);
    if (window.multiplayerModeName === "custom-race") {
      return Number(profile.targetTile || (window.multiplayerTargets && window.multiplayerTargets[profile.playerNumber]) || 2048);
    }
    return Number(window.multiplayerTargetTile || 2048);
  }

  function resetGroupState() {
    Object.keys(groupOpponentViews).forEach(function (key) {
      var view = groupOpponentViews[key];
      if (view && view.timer) window.clearTimeout(view.timer);
    });
    groupOpponentViews = Object.create(null);
    latestPlayerStates = Object.create(null);
    latestGroupRaceState = null;
    groupRaceSpineElement = null;
    localSpectatorNotice = null;
  }

  function effectiveMultiplayerPlayerCount(data) {
    var required = sanitizePlayerCount(data && data.requiredPlayers || window.multiplayerRequiredPlayers || 2);
    var dataProfiles = data && Array.isArray(data.players) ? data.players.length : 0;
    var knownProfiles = Array.isArray(window.multiplayerProfiles) ? window.multiplayerProfiles.length : 0;
    var count = Math.max(required, dataProfiles, knownProfiles);
    return Math.max(2, Math.min(4, count));
  }

  function groupMatchEnabled() {
    return effectiveMultiplayerPlayerCount() > 2;
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
    if (THEMES.indexOf(theme) === -1) theme = "classic";

    THEMES.forEach(function (name) {
      document.body.classList.remove("theme-" + name);
      document.documentElement.classList.remove("theme-" + name);
    });

    document.body.classList.add("theme-" + theme);
    document.documentElement.classList.add("theme-" + theme);
    document.documentElement.setAttribute("data-rinas-theme", theme);
  }

  window.rinasApplyTheme = applyTheme;

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





  // =========================================================
  // v38 VISUAL DESIGN PASS
  // Fast competitive puzzle-game styling inspired by arcade HUDs.
  // Gameplay logic remains unchanged.
  // =========================================================


  // =========================================================
  // v39: playful graphic UI + integrated HUD + audio controls
  // =========================================================


  // =========================================================
  // V40 — ONE GAME, ONE VISUAL SYSTEM
  // =========================================================


  // =========================================================
  // v41: theme-aware home screen + Solo live theme switching
  // =========================================================



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
    var contextClass = options.contextClass ? " " + options.contextClass : "";

    overlay.innerHTML = `
      <div class="game-modal confirm-modal${contextClass}" role="dialog" aria-modal="true" aria-labelledby="game-confirm-title">
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
        <div class="nickname-modal-header">
          <span class="game-modal-kicker">Player profile</span>
          <h2 id="nickname-modal-title">Add a nickname</h2>
        </div>

        <label class="nickname-input-stage" for="nickname-prompt-input">
          <span>Nickname</span>
          <input
            id="nickname-prompt-input"
            class="profile-text-field nickname-field"
            type="text"
            maxlength="16"
            autocomplete="nickname"
            placeholder="Nickname"
            value="${escapeHtml(window.rinasSettings.nickname || "")}"
          >
        </label>

        <p class="status-text nickname-status" id="nickname-prompt-status" aria-live="polite"></p>

        <div class="game-modal-actions nickname-modal-actions">
          <button class="game-modal-button secondary" id="nickname-prompt-cancel">Back</button>
          <button class="game-modal-button primary" id="nickname-prompt-save">Continue <span aria-hidden="true">→</span></button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    var input = document.getElementById("nickname-prompt-input");
    var status = document.getElementById("nickname-prompt-status");

    input.addEventListener("input", function () {
      if (status && status.textContent) status.textContent = "";
    });

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
    if (!Array.isArray(profiles)) return;

    window.multiplayerProfiles = profiles.map(function (profile) {
      return {
        playerId: profile.playerId || null,
        playerNumber: Number(profile.playerNumber),
        nickname: sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber),
        theme: THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic",
        ready: !!profile.ready,
        targetTile: profile.targetTile ? Number(profile.targetTile) : null,
        isHost: !!profile.isHost,
        status: profile.status || "waiting",
        score: Number(profile.score || 0),
        highestTile: Number(profile.highestTile || 0),
        placement: profile.placement || null
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
        profiles[i] = Object.assign({}, profiles[i], {
          playerId: profile.playerId || profiles[i].playerId || null,
          playerNumber: Number(profile.playerNumber),
          nickname: sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber),
          theme: THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic",
          status: profile.status || profiles[i].status || "active",
          targetTile: profile.targetTile ? Number(profile.targetTile) : profiles[i].targetTile || null,
          placement: profile.placement || profiles[i].placement || null
        });
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

  function keyboardClusterMarkup(scheme, extraClass) {
    scheme = scheme === "wasd" ? "wasd" : "arrows";
    var cls = "key-cluster " + scheme + (extraClass ? " " + extraClass : "");

    if (scheme === "wasd") {
      return '<span class="' + cls + '" role="img" aria-label="W A S D keys">' +
        '<span class="key-row key-row-top"><kbd>W</kbd></span>' +
        '<span class="key-row key-row-bottom"><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span>' +
      '</span>';
    }

    return '<span class="' + cls + '" role="img" aria-label="Arrow keys">' +
      '<span class="key-row key-row-top"><kbd>↑</kbd></span>' +
      '<span class="key-row key-row-bottom"><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span>' +
    '</span>';
  }

  function movementKeysMarkup(compact) {
    var scheme = window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";
    var cls = compact ? "control-key-row compact" : "control-key-row";
    return '<div class="' + cls + '" data-control-row>' +
      '<span class="control-label">Move</span>' +
      '<span data-control-keys>' + keyboardClusterMarkup(scheme) + '</span>' +
    '</div>';
  }

  function controlHintText() {
    return window.rinasSettings && window.rinasSettings.controlScheme === "wasd"
      ? "Use W, A, S, and D or swipe to move your tiles."
      : "Use the arrow keys or swipe to move your tiles.";
  }

  function controlHintMarkup(extraClass, id) {
    var scheme = window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";
    var cls = "visual-control-hint" + (extraClass ? " " + extraClass : "");
    return '<div class="' + cls + '"' + (id ? ' id="' + id + '"' : '') + ' data-control-hint>' +
      '<span class="visual-control-keys" data-control-keys>' + keyboardClusterMarkup(scheme, "hint-keys") + '</span>' +
      '<span class="visual-control-copy">or swipe to move your tiles.</span>' +
      '<span class="sr-only" data-control-hint-text>' + escapeHtml(controlHintText()) + '</span>' +
    '</div>';
  }

  function refreshControlSchemeUI() {
    var scheme = window.rinasSettings && window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";

    Array.prototype.forEach.call(document.querySelectorAll("[data-control-keys]"), function (node) {
      node.innerHTML = keyboardClusterMarkup(
        scheme,
        node.closest && node.closest("[data-control-hint]") ? "hint-keys" : ""
      );
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-control-hint-text]"), function (node) {
      node.textContent = controlHintText();
    });
  }

  function soloControlsMarkup() {
    var undoHint = window.rinasSettings.soloUndo
      ? '<div class="solo-control-undo-line"><div class="control-key-row compact solo-undo-key-hint"><span class="control-label">Undo</span><span class="key-cluster action-key"><span class="key-row"><kbd>Z</kbd></span></span></div></div>'
      : '';
    return '<div class="solo-control-strip">' +
      '<div class="solo-control-move-line">' +
        movementKeysMarkup(true) +
        '<span class="solo-swipe-copy">or swipe to move your tiles.</span>' +
      '</div>' +
      undoHint +
    '</div>';
  }

  function showMainMenu() {
    window.currentGameMode = "menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    window.multiplayerModeName = null;
    stopCompetitiveMusic(260);

    showScreen(
      "Choose a game",
      null,
      `
        <header class="mode-choice-heading">
          <span class="eyebrow">Choose how to play</span>
          <h2>A quiet run or a room with friends?</h2>
          <p>Both modes use the same board. Play at your own pace or share a room with friends.</p>
        </header>

        <div class="production-mode-grid">
          <article class="production-mode-card solo-choice-card">
            <div class="preview-board-wrap">
              <div class="motion-board" data-preview="solo" aria-label="Animated numberless Solo board preview">
                <div class="motion-wells" aria-hidden="true"></div>
                <div class="motion-tiles" aria-hidden="true"></div>
              </div>
            </div>
            <div class="production-mode-copy">
              <span class="eyebrow">Solo</span>
              <h3>Reach 2048 and keep going</h3>
              <p>2048 is a milestone, not the finish. Keep the board alive and chase a bigger run.</p>
              <button class="button button-primary" id="choose-solo">Play solo</button>
            </div>
          </article>

          <article class="production-mode-card multiplayer-choice-card">
            <div class="preview-board-wrap preview-board-pair">
              <div class="motion-board motion-board-small" data-preview="multi-a" aria-label="Animated numberless multiplayer board preview">
                <div class="motion-wells" aria-hidden="true"></div>
                <div class="motion-tiles" aria-hidden="true"></div>
              </div>
              <div class="motion-board motion-board-small" data-preview="multi-b" aria-label="Animated numberless opponent board preview">
                <div class="motion-wells" aria-hidden="true"></div>
                <div class="motion-tiles" aria-hidden="true"></div>
              </div>
            </div>
            <div class="production-mode-copy">
              <span class="eyebrow">Multiplayer</span>
              <h3>Play with friends</h3>
              <p>Share a room and play 2048 together.</p>
              <button class="button button-primary" id="choose-multiplayer"${multiplayerEligibleDevice() ? "" : ' disabled aria-disabled="true"'}>Play multiplayer</button>
              ${multiplayerEligibleDevice() ? "" : '<small class="multiplayer-device-note">Tablet or desktop</small>'}
            </div>
          </article>
        </div>
      `
    );

    document.getElementById("choose-solo").addEventListener("click", function () {
      animateCurrentScreenOut(1, showSoloMenu);
    });
    document.getElementById("choose-multiplayer").addEventListener("click", function () {
      if (!requireMultiplayerEligibleDevice()) return;
      if (sanitizeNickname(window.rinasSettings.nickname)) {
        animateCurrentScreenOut(1, showMultiplayerMenu);
        return;
      }
      openNicknamePrompt(function () {
        if (requireMultiplayerEligibleDevice()) showMultiplayerMenu();
      });
    });
  }


  function showSoloMenu() {
    transitionMusic("LOBBY", 850);
    window.currentGameMode = "solo-menu";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;

    withGame(function (game) {
      var hasSave = game.storageManager.hasGameState();
      var best = game.storageManager.getBestScore();
      var highest = game.storageManager.getHighestTileEver();

      showScreen(
        "Solo",
        showMainMenu,
        `
          <div class="solo-launch production-solo-launch">
            <section class="solo-launch-copy">
              <span class="eyebrow">Solo</span>
              <h2>Reach 2048 and keep going.</h2>
              <p>2048 is a milestone, not the finish. Keep the board alive and chase a bigger run.</p>

              <dl class="quiet-stats" aria-label="Solo records">
                <div><dt>Best</dt><dd>${formatScore(best)}</dd></div>
                <div><dt>Highest</dt><dd>${formatTile(highest)}</dd></div>
              </dl>

              <div class="solo-launch-actions">
                <button class="button button-primary" id="${hasSave ? 'continue-solo' : 'start-solo'}">${hasSave ? 'Continue game' : 'Start game'}</button>
                ${hasSave ? '<button class="button button-secondary" id="new-solo">New game</button>' : ''}
              </div>
            </section>

            <aside class="solo-preview-stage solo-preview-panel" aria-label="Animated Solo preview">
              <header class="solo-preview-header">
                <span class="eyebrow">Solo</span>
                <strong>Keep the board alive.</strong>
              </header>
              <div class="solo-preview-board-stage">
                <div class="motion-board solo-large-preview" data-preview="solo">
                  <div class="motion-wells" aria-hidden="true"></div>
                  <div class="motion-tiles" aria-hidden="true"></div>
                </div>
              </div>
              <footer class="solo-preview-footer">
                <strong>Move</strong>
                ${controlHintMarkup("solo-preview-control")}
              </footer>
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
            message: "Your current board will be replaced. Your best score and records will stay saved.",
            confirmLabel: "New game",
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
    if (scoreNode) scoreNode.textContent = formatScore(score);
    if (bestNode) bestNode.textContent = formatScore(best);
    if (highestNode) highestNode.textContent = formatTile(highest);
    if (nextNode) nextNode.textContent = formatTile(nextSoloMilestone(highest || 2));
  };

  function renderSoloChrome() {
    removeSoloGameplayLayout();
    soloToolbar.innerHTML = `
      <header class="solo-production-header page-width">
        <div><button class="button button-secondary" id="solo-back">${uiIcon("back", "button-icon")}<span>Back</span></button></div>
        <div class="production-wordmark"><strong>Rina's 2048</strong><span>Solo</span></div>
        <div><button class="button button-secondary" id="solo-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button></div>
      </header>
    `;
    soloToolbar.style.display = "block";

    var layout = document.createElement("main");
    layout.id = "solo-gameplay-layout";
    layout.className = "solo-production-layout page-width";
    layout.innerHTML = `
      <section class="solo-board-station">
        <header class="solo-live-heading">
          <div class="solo-player-identity">
            <span class="eyebrow">Solo</span>
            <h2>${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Your board")}</h2>
          </div>
          <button class="solo-reset-action" id="solo-new" type="button">
            ${uiIcon("new", "solo-reset-icon")}
            <span>New game</span>
          </button>
        </header>
        <dl class="stats-line solo-stats-line" aria-label="Current Solo statistics">
          <div><dt>Score</dt><dd id="solo-live-score">0</dd></div>
          <div><dt>Best</dt><dd id="solo-live-best">0</dd></div>
          <div><dt>Highest</dt><dd id="solo-live-highest">0</dd></div>
        </dl>
        <div class="solo-board-slot"></div>
        <div id="solo-control-strip" class="solo-control-strip-wrap"></div>
      </section>
      <footer class="in-game-attribution">Based on the original 2048 by <a href="https://github.com/gabrielecirulli/2048" target="_blank" rel="noopener noreferrer">Gabriele Cirulli</a>.</footer>
    `;
    gameHost.appendChild(layout);
    layout.querySelector(".solo-board-slot").appendChild(gameContainer);

    document.getElementById("solo-back").addEventListener("click", showSoloMenu);
    document.getElementById("solo-settings").addEventListener("click", openSettings);
    document.getElementById("solo-new").addEventListener("click", function () {
      openGameConfirm({
        title: "Start a new game?",
        message: "Your current Solo board will be replaced. Your best score and records will stay saved.",
        confirmLabel: "New game",
        tone: "danger",
        onConfirm: function () { withGame(function (game) { game.restart(); }); }
      });
    });

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
    refreshControlSchemeUI();
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
    if (!requireMultiplayerEligibleDevice()) {
      showMainMenu();
      return;
    }

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
        <div class="multiplayer-production-menu">
          <section class="multiplayer-mode-list">
            <span class="eyebrow">Multiplayer</span>
            <h2>Choose your match.</h2>
            <p class="multiplayer-intro">Create a match, or join one with a room code.</p>

            <section class="multiplayer-direct-join" aria-label="Join a multiplayer room">
              <span class="match-setup-kicker">JOIN A ROOM</span>
              <div class="multiplayer-direct-join-row">
                <input id="room-code" class="match-room-input" maxlength="6" placeholder="ROOM CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Six-character room code">
                <button class="button button-secondary" id="join-room">Join</button>
              </div>
              <p class="multiplayer-direct-join-status" id="lobby-status" aria-live="polite"></p>
            </section>

            <div class="multiplayer-create-separator"><span>Create a match</span></div>
            ${playerCountSelectorMarkup()}

            <div class="multiplayer-mode-buttons" id="multiplayer-mode-buttons">
              <button class="multiplayer-mode-button is-previewed" id="mode-tile-race" data-preview-mode="tile-race"><span>${uiIcon("tile-race", "mode-icon")}</span><span><strong>Tile Race</strong><small>Pure 2048 under pressure.</small></span><b>›</b></button>
              <button class="multiplayer-mode-button" id="mode-freeplay" data-preview-mode="freeplay"><span>${uiIcon("freeplay", "mode-icon")}</span><span><strong id="freeplay-mode-label">${selectedPlayerCount === 2 ? "Freeplay Duel" : "Freeplay"}</strong><small>No finish line. Build side by side.</small></span><b>›</b></button>
              <button class="multiplayer-mode-button" id="mode-custom-race" data-preview-mode="custom-race"><span>${uiIcon("custom-race", "mode-icon")}</span><span><strong>Custom Race</strong><small>Everyone chooses their own target.</small></span><b>›</b></button>
            </div>

            <div class="multiplayer-profile-row">
              <span>Playing as</span>
              <strong id="multiplayer-current-nickname">${escapeHtml(sanitizeNickname(window.rinasSettings.nickname) || "Player")}</strong>
              <button class="text-button" id="change-nickname">Change</button>
            </div>

            <div class="future-modes-mini" aria-label="Coming soon">
              <span>Coming soon</span>
              <b>Score Sprint</b><i>·</i><b>Blitz</b><i>·</i><b>Survival</b>
            </div>
          </section>

          <aside class="multiplayer-preview-panel pvp-preview-panel" id="pvp-preview-panel" data-mode="tile-race" data-player-count="${selectedPlayerCount}" aria-label="Animated ${selectedPlayerCount}-player multiplayer preview">
            <header class="pvp-preview-header">
              <span class="eyebrow" id="pvp-preview-kicker">${selectedPlayerCount === 2 ? "Head-to-head" : selectedPlayerCount === 3 ? "Three-player race" : "Four-player race"}</span>
              <strong id="pvp-preview-title">First to finish.</strong>
            </header>

            <div class="pvp-preview-arena" id="pvp-preview-arena" data-player-count="${selectedPlayerCount}">
              ${multiplayerPreviewArenaMarkup(selectedPlayerCount)}
            </div>

            <div class="pvp-mode-rule" id="pvp-mode-rule" data-mode-rule="tile-race" aria-live="polite"></div>

            <footer class="pvp-preview-footer">
              <strong id="pvp-preview-mode-name">Tile Race</strong>
              <p id="pvp-preview-copy">Pure 2048 under pressure. First player to reach the target wins; a stuck board loses.</p>
            </footer>
          </aside>
        </div>
      `
    );

    document.getElementById("change-nickname").addEventListener("click", function () {
      openNicknamePrompt(function () {
        var label = document.getElementById("multiplayer-current-nickname");
        if (label) label.textContent = sanitizeNickname(window.rinasSettings.nickname) || "Player";
      });
    });

    var previewPanel = document.getElementById("pvp-preview-panel");
    var previewArena = document.getElementById("pvp-preview-arena");
    var previewKicker = document.getElementById("pvp-preview-kicker");
    var previewTitle = document.getElementById("pvp-preview-title");
    var previewModeName = document.getElementById("pvp-preview-mode-name");
    var previewCopy = document.getElementById("pvp-preview-copy");
    var previewRule = document.getElementById("pvp-mode-rule");
    var freeplayModeLabel = document.getElementById("freeplay-mode-label");
    var modeButtons = Array.prototype.slice.call(document.querySelectorAll(".multiplayer-mode-button[data-preview-mode]"));
    var countButtons = Array.prototype.slice.call(document.querySelectorAll(".multiplayer-player-count-button"));
    var currentPreviewMode = "tile-race";

    function previewKickerForCount() {
      if (selectedPlayerCount === 2) return "Head-to-head";
      if (selectedPlayerCount === 3) return "Three-player race";
      return "Four-player race";
    }

    function tileRaceRule() {
      var opponentCopy = selectedPlayerCount === 2 ? "Opponent" : (selectedPlayerCount - 1) + " opponents";
      return '<div class="pvp-shared-finish">' +
        '<span>You</span><i aria-hidden="true"></i><strong>2048</strong><i aria-hidden="true"></i><span>' + opponentCopy + '</span>' +
      '</div>';
    }

    function freeplayRule() {
      return '<div class="pvp-freeplay-rule">' +
        '<span class="pvp-infinity" aria-hidden="true">∞</span>' +
        '<span><b>No finish line</b><small>' + selectedPlayerCount + ' boards, one room</small></span>' +
        '<span class="pvp-undo-visual"><kbd>Z</kbd><small>Undo</small></span>' +
      '</div>';
    }

    function customRaceRule() {
      if (selectedPlayerCount === 2) {
        return '<div class="pvp-custom-finishes">' +
          '<span><small>You</small><b>2048</b></span>' +
          '<i aria-hidden="true">VS</i>' +
          '<span><small>Opponent</small><b>4096</b></span>' +
        '</div>';
      }

      return '<div class="pvp-custom-finishes pvp-custom-finishes-group">' +
        '<span><small>You</small><b>2048</b></span>' +
        '<i aria-hidden="true">+</i>' +
        '<span><small>Opponents</small><b>Own targets</b></span>' +
      '</div>';
    }

    function previewState(mode) {
      if (mode === "freeplay") {
        return {
          title: "Build side by side.",
          modeName: selectedPlayerCount === 2 ? "Freeplay Duel" : "Freeplay",
          copy: "No finish line. Build side-by-side, use one-step Undo with Z, and restart your own board whenever you want.",
          rule: freeplayRule()
        };
      }

      if (mode === "custom-race") {
        return {
          title: "Set your targets.",
          modeName: "Custom Race",
          copy: "Everyone chooses their own target. The first player to reach theirs wins.",
          rule: customRaceRule()
        };
      }

      return {
        title: "First to finish.",
        modeName: "Tile Race",
        copy: "Pure 2048 under pressure. First player to reach the target wins; a stuck board loses.",
        rule: tileRaceRule()
      };
    }

    function setMultiplayerPreview(mode) {
      currentPreviewMode = mode || currentPreviewMode;
      var state = previewState(currentPreviewMode);
      if (!previewPanel) return;
      previewPanel.setAttribute("data-mode", currentPreviewMode);
      previewPanel.setAttribute("data-player-count", selectedPlayerCount);
      previewPanel.setAttribute("aria-label", "Animated " + selectedPlayerCount + "-player multiplayer preview");
      if (previewKicker) previewKicker.textContent = previewKickerForCount();
      if (previewTitle) previewTitle.textContent = state.title;
      if (previewModeName) previewModeName.textContent = state.modeName;
      if (previewCopy) previewCopy.textContent = state.copy;
      if (previewRule) {
        previewRule.setAttribute("data-mode-rule", currentPreviewMode);
        previewRule.innerHTML = state.rule;
      }
      if (freeplayModeLabel) {
        freeplayModeLabel.textContent = selectedPlayerCount === 2 ? "Freeplay Duel" : "Freeplay";
      }
      modeButtons.forEach(function (button) {
        button.classList.toggle("is-previewed", button.getAttribute("data-preview-mode") === currentPreviewMode);
      });
    }

    function applyPlayerCount(nextCount) {
      setSelectedPlayerCount(nextCount);
      countButtons.forEach(function (button) {
        var selected = Number(button.getAttribute("data-player-count")) === selectedPlayerCount;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });

      if (previewArena) {
        previewArena.setAttribute("data-player-count", selectedPlayerCount);
        previewArena.innerHTML = multiplayerPreviewArenaMarkup(selectedPlayerCount);
      }

      setMultiplayerPreview(currentPreviewMode);
      if (window.rinasPreviewSystem && window.rinasPreviewSystem.mount) {
        window.rinasPreviewSystem.mount();
      }
    }

    countButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        applyPlayerCount(Number(button.getAttribute("data-player-count")));
      });
    });

    modeButtons.forEach(function (button) {
      var mode = button.getAttribute("data-preview-mode");
      button.addEventListener("mouseenter", function () { setMultiplayerPreview(mode); });
      button.addEventListener("focus", function () { setMultiplayerPreview(mode); });
    });

    var modeButtonGroup = document.getElementById("multiplayer-mode-buttons");
    if (modeButtonGroup) {
      modeButtonGroup.addEventListener("mouseleave", function () {
        if (!modeButtonGroup.querySelector(".multiplayer-mode-button:focus")) setMultiplayerPreview("tile-race");
      });
    }

    setMultiplayerPreview("tile-race");
    bindJoinRoom();

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
        <input id="room-code" class="match-room-input" maxlength="6" placeholder="ENTER CODE" autocomplete="off" autocapitalize="characters" spellcheck="false" aria-label="Six-character room code">
        <button class="primary-button" id="join-room">Join Room</button>
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
      if (!requireMultiplayerEligibleDevice()) {
        if (status) status.textContent = "Multiplayer is available on tablets and desktop.";
        return;
      }
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
      return { kicker: selectedPlayerCount === 2 ? "Freeplay Duel" : "Freeplay", title: "Build side by side.", copy: "No finish line. Build side-by-side, use one-step Undo with Z, and restart your own board whenever you want.", facts: [] };
    }
    if (mode === "custom-race") {
      return { kicker: "Custom Race", title: "Race your own target.", copy: "Create the room, then each player chooses their own target before readying up.", facts: [] };
    }
    return { kicker: "Tile Race", title: "Race to 2048.", copy: "Pure 2048 under pressure. First player to reach the target wins; a stuck board loses.", facts: [] };
  }

  function setupFactsMarkup(facts) {
    if (!facts || !facts.length) return "";
    return '<div class="match-setup-facts">' + facts.map(function (fact) {
      return '<span>' + escapeHtml(fact) + '</span>';
    }).join("") + '</div>';
  }

  function showTileRaceLobby() {
    if (!requireMultiplayerEligibleDevice()) { showMainMenu(); return; }
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
            ${selectedPlayerCountSummaryMarkup()}
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
        requiredPlayers: selectedPlayerCount,
        targetTile: selectedTarget,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function showFreeplayLobby() {
    if (!requireMultiplayerEligibleDevice()) { showMainMenu(); return; }
    window.currentGameMode = "freeplay-lobby";
    window.multiplayerMode = false;
    window.multiplayerMatchActive = false;
    window.multiplayerGameOver = false;
    var info = modeSetupSummary("freeplay");

    showScreen(
      selectedPlayerCount === 2 ? "Freeplay Duel" : "Freeplay",
      function () { leaveRoomSilently(); showMultiplayerMenu(); },
      `
        <div class="match-setup-screen">
          <section class="match-setup-create">
            <span class="match-setup-kicker">${info.kicker}</span>
            <h2>${info.title}</h2>
            <p>${info.copy}</p>
            ${selectedPlayerCountSummaryMarkup()}
            ${setupFactsMarkup(info.facts)}
            <div class="freeplay-setup-controls">
              ${movementKeysMarkup(true)}
              <div class="control-key-row compact"><span class="control-label">Undo</span><span class="key-cluster action-key"><span class="key-row"><kbd>Z</kbd></span></span></div>
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
        requiredPlayers: selectedPlayerCount,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function showCustomRaceLobby() {
    if (!requireMultiplayerEligibleDevice()) { showMainMenu(); return; }
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
            ${selectedPlayerCountSummaryMarkup()}
            <div class="custom-race-explainer" aria-label="Custom Race setup">
              <strong>Your target belongs to you.</strong>
              <span>Choose it after the room opens. Your friends choose theirs when they join.</span>
            </div>
            <button class="primary-button match-create-button" id="create-room">Create Custom Race</button>
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
        mode: "custom-race",
        requiredPlayers: selectedPlayerCount,
        nickname: sanitizeNickname(window.rinasSettings.nickname),
        theme: window.rinasSettings.theme
      });
    });

    bindJoinRoom();
  }

  function modeTitle(mode, playerCount) {
    if (mode === "freeplay") return sanitizePlayerCount(playerCount || window.multiplayerRequiredPlayers || selectedPlayerCount) === 2 ? "Freeplay Duel" : "Freeplay";
    if (mode === "custom-race") return "Custom Race";
    return "Tile Race";
  }

  function backToLobbyForMode(mode) {
    if (mode === "freeplay") showFreeplayLobby();
    else if (mode === "custom-race") showCustomRaceLobby();
    else showTileRaceLobby();
  }

  function lobbyPlayerByNumber(data, playerNumber) {
    var players = data && Array.isArray(data.players) ? data.players : [];
    for (var i = 0; i < players.length; i++) {
      if (Number(players[i].playerNumber) === Number(playerNumber)) return players[i];
    }
    return null;
  }

  function lobbyLocalPlayer(data) {
    return lobbyPlayerByNumber(data, data && data.playerNumber);
  }

  function lobbyOccupancyCopy(data) {
    var joined = Number(data && data.joinedPlayers || 0);
    var required = sanitizePlayerCount(data && data.requiredPlayers);
    return joined + " of " + required + " joined";
  }

  function waitingRosterMarkup(data) {
    var required = sanitizePlayerCount(data.requiredPlayers);
    var players = Array.isArray(data.players) ? data.players : [];
    var ownNumber = Number(data.playerNumber);

    function playerCard(slot) {
      var player = lobbyPlayerByNumber(data, slot);
      if (!player) {
        return '<article class="waiting-player-card waiting"><span>Player ' + slot + '</span><strong>Waiting…</strong><small><i aria-hidden="true"></i>Open slot</small></article>';
      }
      var isOwn = Number(player.playerNumber) === ownNumber;
      var status = player.isHost ? "Host" : player.ready ? "Ready" : "Not ready";
      var cls = player.ready || player.isHost ? "ready" : "waiting";
      return '<article class="waiting-player-card ' + cls + '">' +
        '<span>' + (isOwn ? "You" : "Player " + player.playerNumber) + '</span>' +
        '<strong>' + escapeHtml(player.nickname) + '</strong>' +
        '<small><i aria-hidden="true"></i>' + escapeHtml(status) + '</small>' +
      '</article>';
    }

    if (required === 2) {
      return '<div class="waiting-duel" aria-label="Players in room">' +
        playerCard(1) +
        '<div class="waiting-vs" aria-hidden="true">VS</div>' +
        playerCard(2) +
      '</div>';
    }

    var rows = '';
    for (var slot = 1; slot <= required; slot += 1) {
      var player = lobbyPlayerByNumber(data, slot);
      if (!player) {
        rows += '<div class="waiting-roster-row is-empty">' +
          '<span class="waiting-roster-slot">P' + slot + '</span>' +
          '<strong>Waiting…</strong>' +
          '<span class="waiting-roster-target">—</span>' +
          '<span class="waiting-roster-state">Open slot</span>' +
        '</div>';
        continue;
      }

      var isOwn = Number(player.playerNumber) === ownNumber;
      var role = player.isHost ? "Host" : player.ready ? "Ready" : "Not ready";
      var target = data.mode === "custom-race"
        ? (player.targetTile ? formatTile(player.targetTile) : "Choosing…")
        : "";
      rows += '<div class="waiting-roster-row ' + (player.ready || player.isHost ? 'is-ready' : '') + '">' +
        '<span class="waiting-roster-slot">' + (isOwn ? 'YOU' : 'P' + player.playerNumber) + '</span>' +
        '<strong>' + escapeHtml(player.nickname) + '</strong>' +
        '<span class="waiting-roster-target">' + escapeHtml(target) + '</span>' +
        '<span class="waiting-roster-state">' + escapeHtml(role) + '</span>' +
      '</div>';
    }

    return '<div class="waiting-roster" aria-label="Players in room">' +
      (data.mode === "custom-race" ? '<div class="waiting-roster-head"><span></span><span>Player</span><span>Target</span><span>Status</span></div>' : '') +
      rows +
    '</div>';
  }

  function lobbyTargetPickerMarkup(data) {
    if (!data || data.mode !== "custom-race") return "";
    var player = lobbyLocalPlayer(data);
    if (!player) return "";
    var selected = Number(player.targetTile || 0);
    var locked = !player.isHost && !!player.ready;

    return '<section class="lobby-personal-target" aria-label="Your Custom Race target">' +
      '<div><span class="match-setup-kicker">YOUR TARGET</span>' +
      '<strong>' + (selected ? formatTile(selected) : 'Choose a target') + '</strong></div>' +
      '<div class="target-picker lobby-target-picker">' + CUSTOM_TARGETS.map(function (target) {
        return '<button type="button" class="target-button lobby-own-target ' + (target === selected ? 'selected' : '') + '" data-target="' + target + '"' + (locked ? ' disabled aria-disabled="true"' : '') + '>' + target + '</button>';
      }).join('') + '</div>' +
      (locked ? '<small>Unready to change your target.</small>' : '<small>Every player chooses their own.</small>') +
    '</section>';
  }

  function lobbyActionMarkup(data) {
    var player = lobbyLocalPlayer(data);
    if (!player) return "";

    if (player.isHost) {
      var playable = data.gameplaySupported !== false;
      var enabled = !!data.canStart && playable;
      var status = data.startStatus || "Waiting for players.";
      if (data.canStart && !playable) status = "The room is ready. 3- and 4-player gameplay is enabled in the next build.";
      return '<div class="lobby-host-action">' +
        '<p class="lobby-action-status" id="lobby-action-status">' + escapeHtml(status) + '</p>' +
        '<button type="button" class="primary-button lobby-start-button" id="lobby-start-button"' + (enabled ? '' : ' disabled aria-disabled="true"') + '>Start Match</button>' +
      '</div>';
    }

    var needsTarget = data.mode === "custom-race" && !player.targetTile;
    var statusCopy = needsTarget
      ? "Choose your target, then ready up."
      : player.ready
        ? "You're ready. Waiting for the host."
        : "Ready up when you're set.";

    return '<div class="lobby-guest-action">' +
      '<p class="lobby-action-status" id="lobby-action-status">' + escapeHtml(statusCopy) + '</p>' +
      '<button type="button" class="primary-button lobby-ready-button ' + (player.ready ? 'is-ready' : '') + '" id="lobby-ready-button"' + (needsTarget ? ' disabled aria-disabled="true"' : '') + '>' +
        (player.ready ? '✓ Ready' : 'Ready') +
      '</button>' +
    '</div>';
  }

  function lobbyChatMessageMarkup(message, ownNumber) {
    if (!message) return "";
    var own = Number(message.playerNumber) === Number(ownNumber);
    return '<div class="lobby-chat-message ' + (own ? 'is-own' : '') + '" data-message-id="' + escapeHtml(message.id || '') + '">' +
      '<strong>' + escapeHtml(own ? 'You' : sanitizeNickname(message.nickname) || ('Player ' + message.playerNumber)) + '</strong>' +
      '<span>' + escapeHtml(message.text || '') + '</span>' +
    '</div>';
  }

  function renderLobbyChatHistory(data) {
    var list = document.getElementById("lobby-chat-history");
    if (!list) return;
    var messages = Array.isArray(data.chatMessages) ? data.chatMessages : [];
    list.innerHTML = messages.length
      ? messages.map(function (message) { return lobbyChatMessageMarkup(message, data.playerNumber); }).join("")
      : '<p class="lobby-chat-empty">No messages yet.</p>';
    list.scrollTop = list.scrollHeight;
  }

  function appendLobbyMessage(message) {
    var list = document.getElementById("lobby-chat-history");
    if (!list || !message) return;
    var empty = list.querySelector(".lobby-chat-empty");
    if (empty) empty.remove();
    if (message.id && list.querySelector('[data-message-id="' + String(message.id).replace(/"/g, '') + '"]')) return;
    list.insertAdjacentHTML("beforeend", lobbyChatMessageMarkup(message, currentLobbyState && currentLobbyState.playerNumber));
    list.scrollTop = list.scrollHeight;
  }

  function bindLobbyTargetButtons() {
    Array.prototype.forEach.call(document.querySelectorAll(".lobby-own-target"), function (button) {
      button.addEventListener("click", function () {
        if (button.disabled) return;
        socket.emit("setPlayerTarget", { targetTile: Number(button.getAttribute("data-target")) });
      });
    });
  }

  function renderWaitingRoomState(data) {
    if (!data) return;
    currentLobbyState = data;
    currentRoomCode = data.roomCode || currentRoomCode;
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    window.multiplayerRequiredPlayers = sanitizePlayerCount(data.requiredPlayers);
    updateProfiles(data.players || []);

    var occupancy = document.getElementById("waiting-room-occupancy");
    if (occupancy) occupancy.textContent = lobbyOccupancyCopy(data);

    var title = document.getElementById("waiting-room-title");
    if (title) {
      title.textContent = Number(data.joinedPlayers) >= sanitizePlayerCount(data.requiredPlayers)
        ? "Everyone's here."
        : "Room is open.";
    }

    var intro = document.getElementById("waiting-room-intro");
    if (intro) {
      intro.textContent = Number(data.joinedPlayers) >= sanitizePlayerCount(data.requiredPlayers)
        ? (data.isHost ? "Start when everyone is ready." : "Ready up when you're set.")
        : "Share the room code with your friends.";
    }

    var modeSummary = document.getElementById("waiting-mode-summary");
    if (modeSummary) {
      var mode = data.mode || "tile-race";
      modeSummary.innerHTML = '<span>' + escapeHtml(modeTitle(mode, data.requiredPlayers)) + '</span>' +
        '<strong>' + (mode === "freeplay" ? 'No finish line.' : mode === "custom-race" ? 'Individual targets.' : 'Shared target.') + '</strong>' +
        '<div class="waiting-target-copy">' +
          (mode === "tile-race" ? '<span>Target ' + formatTile(data.targetTile || 2048) + '</span>' : mode === "freeplay" ? '<span>Play together</span>' : '<span>Choose your own target</span>') +
        '</div>';
    }

    var roster = document.getElementById("waiting-roster-slot");
    if (roster) roster.innerHTML = waitingRosterMarkup(data);

    var personal = document.getElementById("waiting-personal-config");
    if (personal) personal.innerHTML = lobbyTargetPickerMarkup(data);

    var actions = document.getElementById("waiting-room-actions");
    if (actions) actions.innerHTML = lobbyActionMarkup(data);

    bindLobbyTargetButtons();

    var readyButton = document.getElementById("lobby-ready-button");
    if (readyButton) {
      readyButton.addEventListener("click", function () {
        var local = lobbyLocalPlayer(currentLobbyState);
        if (!local) return;
        socket.emit("setReady", { ready: !local.ready });
      });
    }

    var startButton = document.getElementById("lobby-start-button");
    if (startButton) {
      startButton.addEventListener("click", function () {
        if (startButton.disabled) return;
        startButton.disabled = true;
        var status = document.getElementById("lobby-action-status");
        if (status) status.textContent = "Starting match…";
        socket.emit("startMatch");
      });
    }
  }

  function bindLobbyChat() {
    var form = document.getElementById("lobby-chat-form");
    var input = document.getElementById("lobby-chat-input");
    var status = document.getElementById("lobby-chat-status");
    if (!form || !input) return;

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var text = String(input.value || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!text) return;
      socket.emit("sendLobbyMessage", { text: text });
      input.value = "";
      if (status) status.textContent = "";
      input.focus();
    });
  }

  function bindRoomCodeCopy(code) {
    function copyRoomCode() {
      var status = document.getElementById("match-copy-status");
      var button = document.getElementById("match-copy-code");
      var onSuccess = function () {
        if (button) button.textContent = "✓ Copied";
        if (status) status.textContent = "Copied " + code;
        window.setTimeout(function () {
          if (button) button.textContent = "Copy";
          if (status) status.textContent = "Share " + code + " with your friends.";
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
    var copyButton = document.getElementById("match-copy-code");
    if (roomCodeNode) {
      roomCodeNode.addEventListener("click", copyRoomCode);
      roomCodeNode.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          copyRoomCode();
        }
      });
    }
    if (copyButton) copyButton.addEventListener("click", copyRoomCode);
  }

  function showWaitingRoom(data) {
    transitionMusic("LOBBY", 700);
    currentLobbyState = data;
    currentRoomCode = data.roomCode;
    window.multiplayerRoomCode = data.roomCode;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    window.multiplayerRequiredPlayers = sanitizePlayerCount(data.requiredPlayers);
    window.currentGameMode = "multiplayer-waiting";
    updateProfiles(data.players || []);

    var mode = data.mode || "tile-race";
    var code = normalizeRoomCode(data.roomCode);

    showScreen(
      modeTitle(mode, data.requiredPlayers),
      function () { leaveRoomSilently(); backToLobbyForMode(mode); },
      `
        <div class="match-staging-screen waiting-room-screen">
          <section class="waiting-room-sheet" data-player-count="${sanitizePlayerCount(data.requiredPlayers)}">
            <header class="waiting-room-header">
              <div class="waiting-room-heading-line">
                <span class="match-setup-kicker">${escapeHtml(modeTitle(mode, data.requiredPlayers))} · ${sanitizePlayerCount(data.requiredPlayers)} PLAYERS</span>
              </div>
              <h2 id="waiting-room-title">Room is open.</h2>
              <p id="waiting-room-intro">Share the room code with your friends.</p>
            </header>

            <div class="waiting-room-body">
              <aside class="waiting-room-invite">
                <span class="match-setup-kicker">ROOM CODE</span>
                <div class="match-room-code-row waiting-code-row">
                  <span class="match-room-code" id="match-room-code" role="button" tabindex="0" aria-label="Copy room code ${escapeHtml(code)}">${escapeHtml(code)}</span>
                  <button class="match-copy-code" id="match-copy-code" type="button"><span>Copy</span></button>
                </div>
                <p class="match-copy-status" id="match-copy-status">Share ${escapeHtml(code)} with your friends.</p>

                <div class="waiting-mode-summary" id="waiting-mode-summary"></div>
                <div id="waiting-personal-config"></div>
              </aside>

              <section class="waiting-room-main-column">
                <section class="waiting-roster-section" aria-label="Players in room">
                  <div class="waiting-roster-meta">
                    <span class="match-setup-kicker">PLAYERS</span>
                    <strong id="waiting-room-occupancy">${escapeHtml(lobbyOccupancyCopy(data))}</strong>
                  </div>
                  <div id="waiting-roster-slot"></div>
                </section>

                <section class="lobby-chat" aria-labelledby="lobby-chat-title">
                  <div class="lobby-chat-heading">
                    <span class="match-setup-kicker" id="lobby-chat-title">CHAT</span>
                  </div>
                  <div class="lobby-chat-history rina-scrollbar" id="lobby-chat-history" role="log" aria-live="polite" aria-relevant="additions"></div>
                  <form class="lobby-chat-form" id="lobby-chat-form">
                    <input id="lobby-chat-input" maxlength="160" autocomplete="off" placeholder="Message your friends…" aria-label="Lobby chat message">
                    <button type="submit" class="button button-secondary">Send</button>
                  </form>
                  <p class="lobby-chat-status" id="lobby-chat-status" aria-live="polite"></p>
                </section>
              </section>
            </div>

            <footer class="waiting-room-footer" id="waiting-room-actions"></footer>
          </section>
        </div>
      `
    );

    bindRoomCodeCopy(code);
    bindLobbyChat();
    renderLobbyChatHistory(data);
    renderWaitingRoomState(data);
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
      return "Your target: " + formatTile(data.ownTarget || data.targetTile || 2048);
    }
    return "First to " + formatTile(data.targetTile || 2048) + " · No Undo · A stuck board loses";
  }

  function showPreMatchCountdown(data) {
    clearPreMatchCountdown();
    pendingGameStartData = data;

    currentRoomCode = data.roomCode || currentRoomCode;
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerPlayerNumber = Number(data.playerNumber);
    window.multiplayerRequiredPlayers = effectiveMultiplayerPlayerCount(data);
    updateProfiles(data.players || []);

    var mode = data.mode || "tile-race";
    var profiles = (window.multiplayerProfiles || []).slice().sort(function (a, b) {
      return Number(a.playerNumber) - Number(b.playerNumber);
    });
    var roster = profiles.map(function (profile) {
      var isYou = Number(profile.playerNumber) === Number(window.multiplayerPlayerNumber);
      return '<div class="match-staging-player ready connected">' +
        '<div><strong>' + escapeHtml(profile.nickname) + '</strong><span><i></i>Ready</span></div>' +
        '<b>' + (isYou ? 'YOU' : 'P' + profile.playerNumber) + '</b>' +
      '</div>';
    }).join("");

    window.currentGameMode = "multiplayer-countdown";

    showScreen(
      modeTitle(mode, data.requiredPlayers),
      function () {
        clearPreMatchCountdown();
        leaveRoomSilently();
        backToLobbyForMode(mode);
      },
      `
        <div class="match-countdown-screen" aria-live="polite">
          <section class="match-countdown-copy">
            <span class="match-setup-kicker">MATCH STARTING</span>
            <h2>Everyone is ready.</h2>
            <p>${escapeHtml(countdownModeSummary(data))}</p>
            <div class="match-countdown-number" id="match-countdown-number"><span>GET READY</span></div>
          </section>

          <section class="match-countdown-players" aria-label="Players ready">
            <span class="match-setup-kicker">PLAYERS</span>
            ${roster}
            <p class="match-countdown-status" id="match-countdown-status">Everyone is connected.</p>
          </section>
        </div>
      `
    );

    var numberNode = document.getElementById("match-countdown-number");
    var statusNode = document.getElementById("match-countdown-status");
    var startAt = Number(data.startAt || (Date.now() + 3050));

    function scheduleAt(timestamp, callback) {
      preMatchCountdownTimers.push(window.setTimeout(callback, Math.max(0, timestamp - Date.now())));
    }

    function showCount(value, statusText) {
      if (!numberNode) return;
      numberNode.classList.remove("count-snap");
      numberNode.innerHTML = "<strong>" + value + "</strong>";
      void numberNode.offsetWidth;
      numberNode.classList.add("count-snap");
      if (statusNode) statusNode.textContent = statusText;
      playSound("ui");
    }

    scheduleAt(startAt - 2400, function () { showCount("3", "Match starts in 3…"); });
    scheduleAt(startAt - 1600, function () { showCount("2", "Match starts in 2…"); });
    scheduleAt(startAt - 800, function () { showCount("1", "Match starts in 1…"); });
    scheduleAt(startAt, function () {
      var startData = pendingGameStartData;
      clearPreMatchCountdown();
      if (startData) startMultiplayerMatch(startData);
    });
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
    window.multiplayerRequiredPlayers = effectiveMultiplayerPlayerCount(data);
    window.multiplayerRoomCode = currentRoomCode;
    window.multiplayerTargetTile = Number(data.targetTile || 0);
    window.multiplayerOwnTarget = Number(data.ownTarget || data.targetTile || 0);
    window.multiplayerOpponentTarget = Number(data.opponentTarget || data.targetTile || 0);
    window.multiplayerTargets = data.targets || {};
    window.multiplayerCanPlay = true;
    window.multiplayerLocalStatus = "active";
    resetGroupState();

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

  function spinePositionPercent(value, maxTarget) {
    return Math.max(0, Math.min(100, Math.round(progressRatio(value, maxTarget) * 1000) / 10));
  }

  function raceSpineTicks(maxTarget) {
    var preferred = [2, 32, 512, maxTarget];
    var seen = {};
    return preferred.filter(function (value) {
      value = Number(value);
      if (value < 2 || value > maxTarget || seen[value]) return false;
      seen[value] = true;
      return true;
    });
  }

  function createRaceSpineHtml(mode, ownTarget, opponentTarget) {
    var maxTarget = Math.max(ownTarget, opponentTarget, 4);
    var ticks = raceSpineTicks(maxTarget);
    var tickHtml = ticks.map(function (value) {
      return '<span class="race-tick" style="left:' + spinePositionPercent(value, maxTarget) + '%"><i></i><b>' + formatTile(value) + '</b></span>';
    }).join("");
    var targetText = mode === "custom-race"
      ? 'Targets <strong>' + formatTile(ownTarget) + '</strong> / <strong>' + formatTile(opponentTarget) + '</strong>'
      : 'Target <strong>' + formatTile(ownTarget) + '</strong>';

    return '<section class="race-strip" id="race-spine" data-max-target="' + maxTarget + '" data-mode="' + escapeHtml(mode) + '">' +
      '<header class="race-strip-header"><div><span class="eyebrow">Live race</span><strong id="race-leader-summary">The race is even</strong></div><div class="race-target-copy">' + targetText + '</div></header>' +
      '<div class="race-track" id="race-spine-track"><span class="race-track-fill" id="race-spine-fill"></span>' + tickHtml +
      '<span class="race-runner race-runner-you" id="race-spine-local-marker" style="left:0%"><span><b>' + escapeHtml(getOwnNickname()) + '</b><small>2</small></span><i></i></span>' +
      '<span class="race-runner race-runner-opponent" id="race-spine-opponent-marker" style="left:0%"><i></i><span><b>' + escapeHtml(getOpponentNickname()) + '</b><small>2</small></span></span>' +
      '</div></section>';
  }

  function updateRaceSpine(ownHighest, opponentHighest) {
    if (!raceSpineElement || !raceSpineLocalMarker || !raceSpineOpponentMarker) return;
    var maxTarget = Number(raceSpineElement.getAttribute("data-max-target") || 2048);
    var ownValue = Math.max(2, Number(ownHighest || 2));
    var opponentValue = Math.max(2, Number(opponentHighest || 2));
    var ownLeft = spinePositionPercent(ownValue, maxTarget);
    var opponentLeft = spinePositionPercent(opponentValue, maxTarget);

    raceSpineLocalMarker.style.left = ownLeft + "%";
    raceSpineOpponentMarker.style.left = opponentLeft + "%";
    var ownSmall = raceSpineLocalMarker.querySelector("small");
    var opponentSmall = raceSpineOpponentMarker.querySelector("small");
    var ownStrong = raceSpineLocalMarker.querySelector("b");
    var opponentStrong = raceSpineOpponentMarker.querySelector("b");
    if (ownSmall) ownSmall.textContent = formatTile(ownValue);
    if (opponentSmall) opponentSmall.textContent = formatTile(opponentValue);
    if (ownStrong) ownStrong.textContent = getOwnNickname();
    if (opponentStrong) opponentStrong.textContent = getOpponentNickname();
    if (raceSpineFill) raceSpineFill.style.width = Math.max(ownLeft, opponentLeft) + "%";

    var summary = document.getElementById("race-leader-summary");
    if (summary) {
      if (ownLeft > opponentLeft + 0.01) summary.textContent = getOwnNickname() + " leads";
      else if (opponentLeft > ownLeft + 0.01) summary.textContent = getOpponentNickname() + " leads";
      else summary.textContent = "The race is even";
    }
  }


  function groupOpponentPanelMarkup(profile) {
    var theme = THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic";
    return '<section class="group-opponent-station" id="group-opponent-' + profile.playerNumber + '" data-player-number="' + profile.playerNumber + '">' +
      '<header class="group-opponent-heading">' +
        '<div><span class="eyebrow">P' + profile.playerNumber + '</span><strong id="group-nickname-' + profile.playerNumber + '">' + escapeHtml(profile.nickname) + '</strong></div>' +
        '<span class="group-rank-badge" id="group-rank-' + profile.playerNumber + '">—</span>' +
      '</header>' +
      '<div class="opponent-grid group-opponent-grid" id="group-grid-' + profile.playerNumber + '" data-theme="' + escapeHtml(theme) + '"></div>' +
      '<footer><span>Highest</span><strong id="group-highest-' + profile.playerNumber + '">0</strong><small id="group-status-' + profile.playerNumber + '">Playing</small></footer>' +
    '</section>';
  }

  function createGroupRaceSpineHtml(mode) {
    if (mode === "freeplay") return "";
    var profiles = (window.multiplayerProfiles || []).slice().sort(function (a, b) {
      return Number(a.playerNumber) - Number(b.playerNumber);
    });
    var maxTarget = profiles.reduce(function (max, profile) {
      return Math.max(max, targetForProfile(profile));
    }, Number(window.multiplayerTargetTile || 2048));

    var runners = profiles.map(function (profile, index) {
      var isYou = Number(profile.playerNumber) === Number(window.multiplayerPlayerNumber);
      return '<span class="race-runner group-race-runner ' + (isYou ? 'race-runner-you' : 'race-runner-opponent') + '" id="group-race-' + profile.playerNumber + '" data-lane="' + (index % 2) + '" style="left:0%">' +
        '<span><b>' + escapeHtml(isYou ? 'YOU' : profile.nickname) + '</b><small>2</small></span><i></i></span>';
    }).join("");

    return '<section class="race-strip group-race-strip" id="group-race-spine" data-max-target="' + maxTarget + '">' +
      '<header class="race-strip-header"><div><span class="eyebrow">Live race</span><strong id="race-leader-summary">The race is even</strong></div><div class="race-target-copy">' +
      (mode === "custom-race" ? 'Own targets' : 'Target <strong>' + formatTile(window.multiplayerTargetTile || 2048) + '</strong>') +
      '</div></header><div class="race-track"><span class="race-track-fill" id="group-race-fill"></span>' + runners + '</div></section>';
  }

  function createGroupBattleView() {
    var mode = window.multiplayerModeName || "tile-race";
    var isFreeplay = mode === "freeplay";
    var ownTarget = Number(window.multiplayerOwnTarget || window.multiplayerTargetTile || 2048);
    var others = getOtherProfiles();

    battleShell = document.createElement("div");
    battleShell.className = "battle-shell direction-a-battle prototype-battle group-battle " + (isFreeplay ? "freeplay-battle" : "race-battle");

    var ruleLine = isFreeplay
      ? "Build together with no finish line. Use Z for one-step Undo."
      : mode === "custom-race"
        ? "Reach your own target first. A locked board is eliminated while the race continues."
        : "Reach " + formatTile(ownTarget) + " first. A locked board is eliminated while the race continues.";

    battleShell.innerHTML = `
      <header class="match-bar page-width">
        <div><button class="button button-danger" id="leave-match">${uiIcon("exit", "button-icon")}<span>Leave match</span></button></div>
        <div class="production-wordmark"><strong>Rina's 2048</strong><span>${escapeHtml(modeTitle(mode, window.multiplayerRequiredPlayers))}</span></div>
        <div class="match-bar-right"><button class="button button-secondary" id="battle-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button></div>
      </header>
      <main class="match-main page-width group-match-main">
        <p class="match-rule">${escapeHtml(ruleLine)}</p>
        <div class="group-match-layout" data-player-count="${window.multiplayerRequiredPlayers}">
          <section class="player-station own-panel group-own-panel" id="own-panel" aria-label="Your board">
            <header class="player-heading"><div><span class="eyebrow">You</span><h2 id="own-nickname">${escapeHtml(getOwnNickname())}</h2><span class="group-own-rank" id="own-rank-inline">—</span></div><span class="connection" id="group-own-status"><i></i>Playing</span></header>
            <dl class="stats-line" aria-label="Your live statistics"><div><dt>Score</dt><dd id="own-score">0</dd></div><div><dt>Highest</dt><dd id="own-highest">${Number(lastOwnHighest || 0)}</dd></div></dl>
            <div class="board-frame own-board-slot" id="own-board-slot"></div>
            <p class="group-spectator-notice" id="group-spectator-notice" hidden>You’re out — watch the race finish.</p>
            ${controlHintMarkup("input-hint active-game-control-hint", "battle-control-hint")}
            ${isFreeplay ? '<div class="freeplay-actions"><button class="button button-secondary" id="freeplay-restart">Restart board</button><span>Undo: Z</span></div>' : ''}
          </section>
          <aside class="group-opponent-rail" aria-label="Opponent boards">
            ${others.map(groupOpponentPanelMarkup).join("")}
          </aside>
        </div>
        ${isFreeplay ? '<section class="freeplay-shared-note"><span class="eyebrow">Freeplay</span><strong>No finish line.</strong><p>Build together, use one-step Undo with Z, and restart your own board whenever you want.</p></section>' : createGroupRaceSpineHtml(mode)}
        <footer class="in-game-attribution battle-attribution">Based on the original 2048 by <a href="https://github.com/gabrielecirulli/2048" target="_blank" rel="noopener noreferrer">Gabriele Cirulli</a>.</footer>
      </main>
    `;

    document.body.appendChild(battleShell);
    document.getElementById("own-board-slot").appendChild(gameContainer);

    ownHighestDisplay = document.getElementById("own-highest");
    ownScoreDisplay = document.getElementById("own-score");
    ownNicknameDisplay = document.getElementById("own-nickname");
    ownRankBadge = document.getElementById("own-rank-inline");
    localSpectatorNotice = document.getElementById("group-spectator-notice");
    groupRaceSpineElement = document.getElementById("group-race-spine");

    others.forEach(function (profile) {
      var grid = document.getElementById("group-grid-" + profile.playerNumber);
      for (var i = 0; i < 16; i++) {
        var cell = document.createElement("div");
        cell.className = "opponent-cell";
        grid.appendChild(cell);
      }
      groupOpponentViews[profile.playerNumber] = {
        playerNumber: Number(profile.playerNumber),
        grid: grid,
        panel: document.getElementById("group-opponent-" + profile.playerNumber),
        highest: document.getElementById("group-highest-" + profile.playerNumber),
        status: document.getElementById("group-status-" + profile.playerNumber),
        rank: document.getElementById("group-rank-" + profile.playerNumber),
        queue: [],
        animating: false,
        lastState: null,
        timer: null
      };
    });

    if (isFreeplay) {
      document.getElementById("freeplay-restart").addEventListener("click", function () {
        openGameConfirm({
          title: "Restart your board?",
          message: "Your Freeplay board will restart. Everyone else keeps playing.",
          confirmLabel: "Restart board",
          tone: "danger",
          contextClass: "multiplayer-confirm-modal",
          onConfirm: restartFreeplayBoard
        });
      });
    }

    document.getElementById("leave-match").addEventListener("click", function () {
      openGameConfirm({
        title: "Leave this match?",
        message: isFreeplay ? "You’ll leave this Freeplay room." : "Leaving forfeits your place. The remaining players continue.",
        confirmLabel: "Leave match",
        cancelLabel: "Stay in match",
        tone: "danger",
        contextClass: "multiplayer-confirm-modal",
        onConfirm: leaveMultiplayerMatch
      });
    });

    document.getElementById("battle-settings").addEventListener("click", openSettings);

    if (latestGroupRaceState) updateGroupRaceState(latestGroupRaceState);
    Object.keys(latestPlayerStates).forEach(function (key) {
      renderGroupOpponentState(Number(key), latestPlayerStates[key]);
    });
  }

  function groupCellAt(view, x, y) {
    if (!view || !view.grid) return null;
    return view.grid.children[(Number(y) * 4) + Number(x)] || null;
  }

  function clearGroupMotion(view) {
    if (!view || !view.grid) return;
    Array.prototype.forEach.call(view.grid.querySelectorAll(".opponent-motion-tile"), function (node) {
      node.remove();
    });
  }

  function paintGroupGrid(view, state, motion) {
    if (!view || !view.grid || !state || !state.grid) return;
    var cells = view.grid.children;
    var index = 0;
    for (var y = 0; y < 4; y++) {
      for (var x = 0; x < 4; x++) {
        var cell = cells[index++];
        var tile = state.grid.cells[x][y];
        cell.className = "opponent-cell";
        cell.textContent = "";
        if (tile) {
          cell.textContent = tile.value;
          cell.className = "opponent-cell has-tile tile-" + tile.value;
        }
      }
    }
    if (!motion) return;
    (motion.merges || []).forEach(function (merge) {
      var cell = groupCellAt(view, merge.x, merge.y);
      if (cell) {
        cell.classList.remove("opponent-cell-pop");
        void cell.offsetWidth;
        cell.classList.add("opponent-cell-pop");
      }
    });
  }

  function commitGroupOpponentState(view, state, motion) {
    clearGroupMotion(view);
    var profile = getProfile(view.playerNumber);
    var theme = profile && THEMES.indexOf(profile.theme) !== -1 ? profile.theme : "classic";
    view.grid.setAttribute("data-theme", theme);
    if (view.highest) view.highest.textContent = formatTile(state.highestTile || 0);
    if (view.status) view.status.textContent = profile && (profile.status === "eliminated" || profile.status === "forfeited") ? "Eliminated" : "Playing";
    paintGroupGrid(view, state, motion || null);
    view.lastState = state;
  }

  function groupMotionUsable(state) {
    if (!state || !state.motion || !Array.isArray(state.motion.transitions)) return false;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
    return state.motion.transitions.some(function (transition) {
      return transition && transition.from && transition.to &&
        (Number(transition.from.x) !== Number(transition.to.x) || Number(transition.from.y) !== Number(transition.to.y));
    });
  }

  function animateGroupOpponentState(view, state, done) {
    if (!view.lastState || !groupMotionUsable(state)) {
      commitGroupOpponentState(view, state, state && state.motion);
      done();
      return;
    }

    var motion = state.motion;
    var duration = Math.max(90, Math.min(140, Number(motion.duration || 105)));
    clearGroupMotion(view);
    var overlays = [];
    var cleared = {};

    (motion.transitions || []).forEach(function (transition) {
      if (!transition || !transition.from || !transition.to) return;
      var fx = Number(transition.from.x), fy = Number(transition.from.y);
      var tx = Number(transition.to.x), ty = Number(transition.to.y);
      if (fx === tx && fy === ty) return;
      var from = groupCellAt(view, fx, fy);
      var to = groupCellAt(view, tx, ty);
      if (!from || !to) return;

      var key = fx + ":" + fy;
      if (!cleared[key]) {
        from.className = "opponent-cell";
        from.textContent = "";
        cleared[key] = true;
      }

      var overlay = document.createElement("div");
      overlay.className = "opponent-cell opponent-motion-tile has-tile tile-" + Number(transition.value || 2);
      overlay.textContent = Number(transition.value || 2);
      overlay.style.left = from.offsetLeft + "px";
      overlay.style.top = from.offsetTop + "px";
      overlay.style.width = from.offsetWidth + "px";
      overlay.style.height = from.offsetHeight + "px";
      overlay.style.transitionDuration = duration + "ms";
      view.grid.appendChild(overlay);
      overlays.push({ element: overlay, dx: to.offsetLeft - from.offsetLeft, dy: to.offsetTop - from.offsetTop });
    });

    if (!overlays.length) {
      commitGroupOpponentState(view, state, motion);
      done();
      return;
    }

    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        overlays.forEach(function (item) {
          item.element.style.transform = "translate3d(" + item.dx + "px," + item.dy + "px,0)";
        });
      });
    });

    view.timer = window.setTimeout(function () {
      view.timer = null;
      commitGroupOpponentState(view, state, motion);
      done();
    }, duration + 22);
  }

  function processGroupQueue(view) {
    if (!view || view.animating || !view.queue.length) return;
    view.animating = true;
    var state = view.queue.shift();
    animateGroupOpponentState(view, state, function () {
      view.animating = false;
      processGroupQueue(view);
    });
  }

  function renderGroupOpponentState(playerNumber, state) {
    var view = groupOpponentViews[Number(playerNumber)];
    if (!view || !state || !state.grid) return;
    if (!view.lastState && !view.animating) {
      commitGroupOpponentState(view, state, null);
      return;
    }
    view.queue.push(state);
    if (view.queue.length > 4) view.queue = [view.queue[0], view.queue[view.queue.length - 1]];
    processGroupQueue(view);
  }

  function updateGroupRaceState(state) {
    latestGroupRaceState = state || latestGroupRaceState;
    if (!latestGroupRaceState) return;

    var racePlayers = (latestGroupRaceState.players || []).slice();
    var positioned = racePlayers.map(function (player) {
      return {
        player: player,
        percent: Math.max(2.5, Math.min(97.5, Number(player.progress || 0) * 100))
      };
    }).sort(function (a, b) {
      if (a.percent !== b.percent) return a.percent - b.percent;
      return Number(a.player.playerNumber) - Number(b.player.playerNumber);
    });

    // Assign extra label lanes only when runners are visually clustered.
    // Marker x-position remains the real tile progress; lanes only prevent
    // labels/dots from drawing over each other.
    var clusterStart = 0;
    while (clusterStart < positioned.length) {
      var clusterEnd = clusterStart + 1;
      while (
        clusterEnd < positioned.length &&
        positioned[clusterEnd].percent - positioned[clusterEnd - 1].percent < 8
      ) {
        clusterEnd += 1;
      }
      for (var laneIndex = clusterStart; laneIndex < clusterEnd; laneIndex += 1) {
        positioned[laneIndex].lane = (laneIndex - clusterStart) % 4;
      }
      clusterStart = clusterEnd;
    }

    positioned.forEach(function (entry) {
      var player = entry.player;
      var marker = document.getElementById("group-race-" + player.playerNumber);
      if (marker) {
        marker.style.left = (Math.round(entry.percent * 10) / 10) + "%";
        marker.setAttribute("data-lane", String(entry.lane || 0));
        marker.classList.toggle("near-start", entry.percent < 10);
        marker.classList.toggle("near-end", entry.percent > 90);
        var small = marker.querySelector("small");
        if (small) small.textContent = formatTile(player.highestTile || 2);
        marker.classList.toggle("is-eliminated", player.status === "eliminated" || player.status === "forfeited");
      }

      if (Number(player.playerNumber) === Number(window.multiplayerPlayerNumber)) {
        if (ownRankBadge) ownRankBadge.textContent = player.rank ? ordinal(player.rank) : "—";
      } else {
        var view = groupOpponentViews[Number(player.playerNumber)];
        if (view && view.rank) view.rank.textContent = player.rank ? ordinal(player.rank) : "—";
        if (view && view.panel) view.panel.classList.toggle("is-eliminated", player.status === "eliminated" || player.status === "forfeited");
        if (view && view.status && (player.status === "eliminated" || player.status === "forfeited")) view.status.textContent = "Eliminated";
      }
    });

    var summary = document.getElementById("race-leader-summary");
    var leader = racePlayers.find(function (player) {
      return player.playerId === latestGroupRaceState.leaderPlayerId;
    });
    if (summary) summary.textContent = leader ? ((Number(leader.playerNumber) === Number(window.multiplayerPlayerNumber) ? "You" : leader.nickname) + " lead" + (Number(leader.playerNumber) === Number(window.multiplayerPlayerNumber) ? "" : "s")) : "The race is even";

    var fill = document.getElementById("group-race-fill");
    if (fill) {
      var max = racePlayers.reduce(function (value, player) {
        return Math.max(value, Number(player.progress || 0));
      }, 0);
      fill.style.width = Math.round(max * 1000) / 10 + "%";
    }
  }

  function ordinal(value) {
    var n = Number(value || 0);
    if (n === 1) return "1ST";
    if (n === 2) return "2ND";
    if (n === 3) return "3RD";
    if (n === 4) return "4TH";
    return "—";
  }

  function enterLocalSpectatorMode(reason) {
    window.multiplayerCanPlay = false;
    window.multiplayerLocalStatus = "eliminated";
    var panel = document.getElementById("own-panel");
    if (panel) panel.classList.add("is-eliminated");
    var status = document.getElementById("group-own-status");
    if (status) status.innerHTML = "<i></i>Eliminated";
    if (localSpectatorNotice) localSpectatorNotice.hidden = false;
    var hints = document.querySelectorAll(".group-battle .active-game-control-hint,.group-battle .freeplay-actions");
    Array.prototype.forEach.call(hints, function (node) { node.setAttribute("aria-hidden", "true"); node.style.visibility = "hidden"; });
    if (reason) showBattleToast("You’re out — watch the race finish.");
  }

  function showGroupMatchResult(data) {
    removeResultOverlay();
    window.multiplayerGameOver = true;
    window.multiplayerMatchActive = false;
    window.multiplayerCanPlay = false;

    var placements = Array.isArray(data.placements) ? data.placements : [];
    var mine = placements.find(function (entry) {
      return Number(entry.playerNumber) === Number(window.multiplayerPlayerNumber);
    });
    var winner = placements.find(function (entry) { return Number(entry.placement) === 1; });
    var rows = placements.map(function (entry) {
      return '<div class="group-result-row ' + (Number(entry.playerNumber) === Number(window.multiplayerPlayerNumber) ? 'is-you' : '') + '">' +
        '<b>' + ordinal(entry.placement) + '</b><strong>' + escapeHtml(entry.nickname) + '</strong>' +
        '<span>' + formatScore(entry.score) + '</span><span>' + formatTile(entry.highestTile) + '</span></div>';
    }).join("");

    var overlay = document.createElement("div");
    overlay.id = "result-overlay";
    overlay.className = "result-overlay";
    overlay.innerHTML = '<div class="result-box multiplayer-popup group-result-box">' +
      '<span class="result-kicker">MATCH ENDED</span>' +
      '<h1>' + (mine ? 'You placed ' + ordinal(mine.placement).toLowerCase() : 'Match complete') + '</h1>' +
      '<p>' + escapeHtml(winner ? winner.nickname + " wins the race." : "The race is complete.") + '</p>' +
      '<div class="group-result-table"><div class="group-result-head"><span>Place</span><span>Player</span><span>Score</span><span>Highest</span></div>' + rows + '</div>' +
      '<div class="result-actions"><button class="primary-button" id="group-result-back">Back to Multiplayer</button></div></div>';
    document.body.appendChild(overlay);
    duckCompetitiveMusic();
    playSound(mine && mine.placement === 1 ? "win" : "lose");
    document.getElementById("group-result-back").addEventListener("click", function () {
      removeResultOverlay();
      leaveMultiplayerMatch();
    });
  }

  function createBattleView() {
    removeBattleShell();

    if (groupMatchEnabled()) {
      createGroupBattleView();
      return;
    }

    var mode = window.multiplayerModeName || "tile-race";
    var isFreeplay = mode === "freeplay";
    var ownTarget = Number(window.multiplayerOwnTarget || window.multiplayerTargetTile || 2048);
    var opponentTarget = Number(window.multiplayerOpponentTarget || window.multiplayerTargetTile || 2048);
    var ownName = getOwnNickname();
    var opponentName = getOpponentNickname();
    var opponentProfile = getProfile(getOpponentNumber());
    var opponentTheme = opponentProfile && THEMES.indexOf(opponentProfile.theme) !== -1 ? opponentProfile.theme : "classic";

    battleShell = document.createElement("div");
    battleShell.className = "battle-shell direction-a-battle prototype-battle " + (isFreeplay ? "freeplay-battle" : "race-battle");

    var ruleLine = isFreeplay
      ? "Build side by side with no finish line. Use Z for one-step Undo."
      : mode === "custom-race"
        ? "Reach your target before your friend; if either board locks first, the other player wins."
        : ownTarget === 2048
          ? "Reach 2048 before your opponent; if either board locks first, the other player wins."
          : "Reach " + formatTile(ownTarget) + " before your opponent; if either board locks first, the other player wins.";

    battleShell.innerHTML = `
      <header class="match-bar page-width">
        <div><button class="button button-danger" id="leave-match">${uiIcon("exit", "button-icon")}<span>Leave match</span></button></div>
        <div class="production-wordmark"><strong>Rina's 2048</strong><span>${escapeHtml(modeTitle(mode))}</span></div>
        <div class="match-bar-right"><button class="button button-secondary" id="battle-settings">${uiIcon("settings", "button-icon")}<span>Settings</span></button></div>
      </header>
      <main class="match-main page-width">
        <p class="match-rule">${escapeHtml(ruleLine)}</p>
        <div class="duel">
          <section class="player-station own-panel" id="own-panel" aria-label="Your board">
            <header class="player-heading"><div><span class="eyebrow">You</span><h2 id="own-nickname">${escapeHtml(ownName)}</h2><span class="sr-only" id="own-rank-inline"></span></div><span class="connection"><i></i>Playing</span></header>
            <dl class="stats-line" aria-label="Your live statistics"><div><dt>Score</dt><dd id="own-score">0</dd></div><div><dt>Highest</dt><dd id="own-highest">${Number(lastOwnHighest || 0)}</dd></div></dl>
            <div class="board-frame own-board-slot" id="own-board-slot"></div>
            ${controlHintMarkup("input-hint active-game-control-hint", "battle-control-hint")}
            ${isFreeplay ? '<div class="freeplay-actions"><button class="button button-secondary" id="freeplay-restart">Restart board</button><span>Undo: Z</span></div>' : ''}
          </section>

          <section class="player-station opponent-panel" id="opponent-panel" data-opponent-theme="${escapeHtml(opponentTheme)}" aria-label="Opponent board">
            <header class="player-heading"><div><span class="eyebrow">Opponent</span><h2 id="opponent-nickname">${escapeHtml(opponentName)}</h2><span class="sr-only" id="opponent-rank-inline"></span></div><span class="connection"><i></i>Playing</span></header>
            <dl class="stats-line" aria-label="Opponent live statistics"><div><dt>Score</dt><dd id="opponent-score">0</dd></div><div><dt>Highest</dt><dd id="opponent-highest">0</dd></div></dl>
            <div id="opponent-grid" class="opponent-grid" data-theme="${escapeHtml(opponentTheme)}"></div>
            <p id="opponent-status" class="input-hint input-hint-status">${escapeHtml(opponentName)} is choosing a move.</p>
          </section>
        </div>
        ${isFreeplay ? '<section class="freeplay-shared-note"><span class="eyebrow">Freeplay Duel</span><strong>No finish line.</strong><p>Build side-by-side, use one-step Undo with Z, and restart your own board whenever you want.</p></section>' : createRaceSpineHtml(mode, ownTarget, opponentTarget)}
        <footer class="in-game-attribution battle-attribution">Based on the original 2048 by <a href="https://github.com/gabrielecirulli/2048" target="_blank" rel="noopener noreferrer">Gabriele Cirulli</a>.</footer>
      </main>
    `;

    document.body.appendChild(battleShell);
    document.getElementById("own-board-slot").appendChild(gameContainer);

    if (isFreeplay) {
      document.getElementById("freeplay-restart").addEventListener("click", function () {
        openGameConfirm({
          title: "Restart your board?",
          message: "Your Freeplay board will restart. Your opponent will keep playing.",
          confirmLabel: "Restart board",
          tone: "danger",
          contextClass: "multiplayer-confirm-modal",
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
    ownProgressFill = opponentProgressFill = ownProgressText = opponentProgressText = ownProgressNote = opponentProgressNote = null;
    raceSpineElement = document.getElementById("race-spine");
    raceSpineTrack = document.getElementById("race-spine-track");
    raceSpineFill = document.getElementById("race-spine-fill");
    raceSpineLocalMarker = document.getElementById("race-spine-local-marker");
    raceSpineOpponentMarker = document.getElementById("race-spine-opponent-marker");
    raceSpineLocalTarget = raceSpineOpponentTarget = null;

    for (var i = 0; i < 16; i++) {
      var cell = document.createElement("div");
      cell.className = "opponent-cell";
      opponentGrid.appendChild(cell);
    }

    document.getElementById("leave-match").addEventListener("click", function () {
      openGameConfirm({
        title: "Leave this match?",
        message: "Your current board will be forfeited, and your opponent will win.",
        confirmLabel: "Leave match",
        cancelLabel: "Stay in match",
        tone: "danger",
        contextClass: "multiplayer-confirm-modal",
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
    resetGroupState();

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
    currentLobbyState = null;
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
    window.multiplayerCanPlay = true;
    window.multiplayerLocalStatus = null;
    window.multiplayerTargets = {};
    resetGroupState();
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

  window.updateMatchProgress = function (ownHighest, ownScore) {
    lastOwnHighest = Number(ownHighest || 0);
    lastOwnScore = Number(ownScore || 0);

    if (ownHighestDisplay) ownHighestDisplay.textContent = lastOwnHighest;
    if (ownScoreDisplay) ownScoreDisplay.textContent = formatScore(lastOwnScore);

    if (groupMatchEnabled()) {
      latestPlayerStates[Number(window.multiplayerPlayerNumber)] = {
        highestTile: lastOwnHighest,
        score: lastOwnScore
      };
      if (latestGroupRaceState) updateGroupRaceState(latestGroupRaceState);
      updateCompetitiveMusicIntensity();
      return;
    }

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
      opponentScoreDisplay.textContent = formatScore(state.score);
    }

    if (opponentStatus) {
      opponentStatus.textContent = state.over
        ? "Board finished."
        : getOpponentNickname() + " is choosing a move.";
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
      <div class="result-box multiplayer-popup multiplayer-freeplay-popup">
        <span class="result-kicker">${groupMatchEnabled() ? "FREEPLAY" : "FREEPLAY DUEL"}</span>
        <h1>Board full</h1>
        <p>Your run can keep going. Undo the last move or restart your board while ${groupMatchEnabled() ? "everyone else keeps" : "your opponent keeps"} playing.</p>
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
          <div><span>FINAL SCORE</span><strong>${formatScore(score)}</strong></div>
          <div><span>HIGHEST</span><strong>${formatTile(highest)}</strong></div>
          <div><span>BEST</span><strong>${formatScore(best)}</strong></div>
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
      <div class="result-box multiplayer-popup multiplayer-result-box ${didWin ? "is-win" : "is-loss"}">
        <div class="result-icon">${uiIcon(didWin ? "win" : "loss", "result-graphic")}</div>
        <span class="result-kicker">${didWin ? "TARGET REACHED" : "MATCH ENDED"}</span>
        <h1>${didWin ? "You win" : "You lost"}</h1>
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
      <div class="result-box multiplayer-popup multiplayer-disconnect-popup">
        <div class="result-icon">${uiIcon("disconnect", "result-graphic")}</div>
        <span class="result-kicker">MATCH ENDED</span>
        <h1>Opponent left</h1>
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

    var sfxPercent = Math.round(Number(typeof window.rinasSettings.sfxVolume === "number" ? window.rinasSettings.sfxVolume : 0.75) * 100);
    var musicPercent = Math.round(Number(typeof window.rinasSettings.musicVolume === "number" ? window.rinasSettings.musicVolume : 0.42) * 100);
    var themeLockedForMatch = !!window.multiplayerMatchActive;

    var overlay = document.createElement("div");
    overlay.id = "settings-overlay";
    overlay.className = "settings-overlay";
    overlay.innerHTML = `
      <div class="settings-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header class="settings-sheet-header">
          <div><span class="eyebrow">Rina's 2048</span><h2 id="settings-title">Settings</h2></div>
          <button class="button button-primary" id="settings-save">${uiIcon("save", "button-icon")}<span>Save</span></button>
        </header>

        <section class="settings-profile">
          <h3>Profile</h3>
          <label for="settings-nickname">Nickname</label>
          <input id="settings-nickname" class="profile-text-field" type="text" maxlength="16" autocomplete="nickname" value="${escapeHtml(window.rinasSettings.nickname || "")}">
          <p>This is the name your opponent sees.</p>
        </section>

        <div class="settings-columns">
          <fieldset class="settings-group controls-group">
            <legend>Controls</legend>
            <p>Choose one keyboard movement scheme. Touch controls always use swipe.</p>
            <div class="control-scheme-grid" role="group" aria-label="Keyboard movement scheme">
              <button class="control-scheme ${window.rinasSettings.controlScheme === "arrows" ? "is-selected" : ""}" type="button" data-controls="arrows"><span class="scheme-keys"><kbd>↑</kbd><span><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span></span><strong>Arrow Keys</strong></button>
              <button class="control-scheme ${window.rinasSettings.controlScheme === "wasd" ? "is-selected" : ""}" type="button" data-controls="wasd"><span class="scheme-keys"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span><strong>WASD</strong></button>
            </div>
            <label class="switch-row solo-undo-row"><span><strong>Solo Undo</strong><small>Enable one-step Solo Undo. Press Z to rewind one successful move.</small></span><input id="solo-undo-toggle" type="checkbox" ${window.rinasSettings.soloUndo ? "checked" : ""}><i aria-hidden="true"></i></label>
          </fieldset>

          <fieldset class="settings-group sound-group">
            <legend>Sound</legend>
            <div class="audio-stack">
              <section class="audio-control">
                <label class="switch-row"><span><strong>Sound Effects</strong></span><input id="sound-effects-toggle" type="checkbox" ${window.rinasSettings.soundEffects ? "checked" : ""}><i aria-hidden="true"></i></label>
                <label class="volume-row"><span>SFX volume</span><input id="sfx-volume" type="range" min="0" max="100" step="1" value="${sfxPercent}" ${window.rinasSettings.soundEffects ? "" : "disabled"}><output id="sfx-volume-output">${sfxPercent}%</output></label>
              </section>
              <section class="audio-control">
                <label class="switch-row"><span><strong>Background Music</strong></span><input id="background-music-toggle" type="checkbox" ${window.rinasSettings.musicEnabled ? "checked" : ""}><i aria-hidden="true"></i></label>
                <label class="volume-row"><span>Music volume</span><input id="music-volume" type="range" min="0" max="100" step="1" value="${musicPercent}" ${window.rinasSettings.musicEnabled ? "" : "disabled"}><output id="music-volume-output">${musicPercent}%</output></label>
              </section>
            </div>
          </fieldset>
        </div>

        <fieldset class="settings-group theme-group ${themeLockedForMatch ? "is-locked" : ""}">
          <legend>Theme</legend>
          <p>Choose your visual theme. In multiplayer, your opponent sees your board theme.</p>
          <div class="theme-options">${THEMES.map(function (theme) {
            return '<button class="theme-option ' + (theme === window.rinasSettings.theme ? 'is-selected' : '') + '" type="button" data-theme="' + theme + '"' +
              (themeLockedForMatch ? ' disabled aria-disabled="true"' : '') +
              '><strong>' + prettyThemeName(theme) + '</strong><span class="theme-swatches">' + themePreview(theme) + '</span></button>';
          }).join("")}</div>
        </fieldset>
      </div>
    `;

    document.body.appendChild(overlay);
    var nicknameInput = document.getElementById("settings-nickname");

    function saveNickname() {
      window.rinasSettings.nickname = sanitizeNickname(nicknameInput.value);
      nicknameInput.value = window.rinasSettings.nickname;
      saveSettings();
      if (currentRoomCode) {
        socket.emit("updateProfile", { nickname: window.rinasSettings.nickname, theme: window.rinasSettings.theme });
        updateOneProfile({ playerNumber: window.multiplayerPlayerNumber, nickname: window.rinasSettings.nickname, theme: window.rinasSettings.theme });
        if (ownNicknameDisplay) ownNicknameDisplay.textContent = getOwnNickname();
      }
    }

    function close() {
      saveNickname();
      closeOverlaySmoothly(overlay, function () { window.refreshSoloControls(); });
    }

    document.getElementById("settings-save").addEventListener("click", close);
    nicknameInput.addEventListener("change", saveNickname);

    Array.prototype.forEach.call(overlay.querySelectorAll(".control-scheme"), function (button) {
      button.addEventListener("click", function () {
        window.rinasSettings.controlScheme = button.getAttribute("data-controls");
        saveSettings();
        Array.prototype.forEach.call(overlay.querySelectorAll(".control-scheme"), function (other) { other.classList.toggle("is-selected", other === button); });
        window.refreshSoloControls();
        refreshControlSchemeUI();
      });
    });

    document.getElementById("sound-effects-toggle").addEventListener("change", function () {
      window.rinasSettings.soundEffects = this.checked;
      saveSettings();
      document.getElementById("sfx-volume").disabled = !this.checked;
      if (window.rinasAudio && window.rinasAudio.setSfxEnabled) window.rinasAudio.setSfxEnabled(this.checked);
      if (this.checked) playSound("ui");
    });

    document.getElementById("sfx-volume").addEventListener("input", function () {
      var value = Math.max(0, Math.min(100, Number(this.value || 0)));
      window.rinasSettings.sfxVolume = value / 100;
      document.getElementById("sfx-volume-output").textContent = value + "%";
      saveSettings();
      if (window.rinasAudio && window.rinasAudio.setSfxVolume) window.rinasAudio.setSfxVolume(window.rinasSettings.sfxVolume);
    });

    document.getElementById("background-music-toggle").addEventListener("change", function () {
      window.rinasSettings.musicEnabled = this.checked;
      saveSettings();
      document.getElementById("music-volume").disabled = !this.checked;
      if (window.rinasAudio && window.rinasAudio.setMusicEnabled) window.rinasAudio.setMusicEnabled(this.checked);
    });

    document.getElementById("music-volume").addEventListener("input", function () {
      var value = Math.max(0, Math.min(100, Number(this.value || 0)));
      window.rinasSettings.musicVolume = value / 100;
      document.getElementById("music-volume-output").textContent = value + "%";
      saveSettings();
      if (window.rinasAudio && window.rinasAudio.setMusicVolume) window.rinasAudio.setMusicVolume(window.rinasSettings.musicVolume);
    });

    Array.prototype.forEach.call(overlay.querySelectorAll(".theme-option"), function (button) {
      button.addEventListener("click", function () {
        if (themeLockedForMatch || window.multiplayerMatchActive) return;
        var theme = button.getAttribute("data-theme");
        window.rinasSettings.theme = theme;
        saveSettings();
        applyTheme(theme);
        if (currentRoomCode && !window.multiplayerMatchActive) {
          socket.emit("updateProfile", { nickname: window.rinasSettings.nickname, theme: window.rinasSettings.theme });
        }
        Array.prototype.forEach.call(overlay.querySelectorAll(".theme-option"), function (other) { other.classList.toggle("is-selected", other === button); });
      });
    });

    document.getElementById("solo-undo-toggle").addEventListener("change", function () {
      window.rinasSettings.soloUndo = this.checked;
      saveSettings();
      if (!this.checked && window.multiplayerGame && !window.multiplayerMode) window.multiplayerGame.storageManager.clearUndoStack();
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

  socket.on("roomJoined", function (data) {
    updateProfiles(data.players || []);
    showWaitingRoom(data);
  });

  socket.on("roomState", function (data) {
    updateProfiles(data.players || []);
    if (window.currentGameMode === "multiplayer-waiting" && currentRoomCode === data.roomCode) {
      renderWaitingRoomState(data);
    }
  });

  socket.on("lobbyMessage", function (message) {
    appendLobbyMessage(message);
  });

  socket.on("lobbyError", function (message) {
    var actionStatus = document.getElementById("lobby-action-status");
    if (actionStatus) actionStatus.textContent = message;
  });

  socket.on("lobbyChatError", function (message) {
    var chatStatus = document.getElementById("lobby-chat-status");
    if (chatStatus) chatStatus.textContent = message;
  });

  socket.on("startError", function (message) {
    var status = document.getElementById("lobby-action-status");
    var button = document.getElementById("lobby-start-button");
    if (status) status.textContent = message;
    if (button && currentLobbyState && currentLobbyState.canStart && currentLobbyState.gameplaySupported !== false) button.disabled = false;
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
    currentLobbyState = null;
    showPreMatchCountdown(data);
  });

  socket.on("matchStart", function (data) {
    if (data && data.raceState) latestGroupRaceState = data.raceState;
  });

  socket.on("opponentState", function (data) {
    if (groupMatchEnabled()) return;
    latestOpponentState = data.state;
    renderOpponentState(data.state);
  });

  socket.on("playerStateUpdate", function (data) {
    if (!data || Number(data.playerNumber) === Number(window.multiplayerPlayerNumber)) return;
    latestPlayerStates[Number(data.playerNumber)] = data.state;
    if (groupMatchEnabled()) renderGroupOpponentState(Number(data.playerNumber), data.state);
  });

  socket.on("raceState", function (data) {
    if (groupMatchEnabled()) updateGroupRaceState(data);
  });

  socket.on("playerEliminated", function (data) {
    if (!data) return;
    var profile = getProfile(data.playerNumber);
    if (profile) profile.status = data.reason === "forfeit" || data.reason === "disconnect" ? "forfeited" : "eliminated";

    if (Number(data.playerNumber) === Number(window.multiplayerPlayerNumber)) {
      enterLocalSpectatorMode(data.reason);
    } else {
      var view = groupOpponentViews[Number(data.playerNumber)];
      if (view && view.panel) view.panel.classList.add("is-eliminated");
      if (view && view.status) view.status.textContent = "Eliminated";
      showBattleToast((data.nickname || ("Player " + data.playerNumber)) + " is eliminated.");
    }

    if (data.raceState && groupMatchEnabled()) updateGroupRaceState(data.raceState);
  });

  socket.on("playerLeftMatch", function (data) {
    if (!data || !groupMatchEnabled()) return;
    var view = groupOpponentViews[Number(data.playerNumber)];
    if (view && view.panel) view.panel.classList.add("is-eliminated");
    if (view && view.status) view.status.textContent = "Left";
  });

  socket.on("playerProfileUpdated", function (profile) {
    updateOneProfile(profile);

    if (Number(profile.playerNumber) === Number(window.multiplayerPlayerNumber)) {
      if (ownNicknameDisplay) ownNicknameDisplay.textContent = getOwnNickname();
    } else if (groupMatchEnabled()) {
      var groupView = groupOpponentViews[Number(profile.playerNumber)];
      var groupName = document.getElementById("group-nickname-" + Number(profile.playerNumber));
      if (groupName) groupName.textContent = sanitizeNickname(profile.nickname) || ("Player " + profile.playerNumber);
      if (groupView && groupView.grid && THEMES.indexOf(profile.theme) !== -1) {
        groupView.grid.setAttribute("data-theme", profile.theme);
      }
    } else {
      if (opponentNicknameDisplay) opponentNicknameDisplay.textContent = getOpponentNickname();
      if (opponentGrid && THEMES.indexOf(profile.theme) !== -1) opponentGrid.setAttribute("data-theme", profile.theme);
      if (opponentPanelElement && THEMES.indexOf(profile.theme) !== -1) opponentPanelElement.setAttribute("data-opponent-theme", profile.theme);
    }
  });

  socket.on("gameWinner", function (data) { showMatchResult(data); });
  socket.on("matchFinished", function (data) {
    if (groupMatchEnabled()) showGroupMatchResult(data);
  });

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




  // =========================================================
  // v43: sophisticated playful puzzle-game UI
  // =========================================================



  // =========================================================
  // v44: viewport-fit, readable themes, compact settings,
  //      and game-first mode navigation
  // =========================================================




  // =========================================================
  // v45: desktop game-flow polish
  // - no accidental page-scroll on desktop menus/matches
  // - stable hover targets (no edge shake)
  // - smooth nickname handoff
  // - game-HUD overlays instead of generic cards
  // - theme-colored segmented dividers
  // =========================================================




  // =========================================================
  // v46: cohesive adult-game UI polish
  // - visual control schemes
  // - rounded game modals / no browser confirms
  // - stable mode previews + restored motion
  // - rebuilt Solo HUD spacing
  // - viewport-fit desktop gameplay
  // =========================================================





  // =========================================================
  // v48: spacing + classic 2048 HUD + stable multiplayer flow
  // =========================================================



  // =========================================================
  // v49: precision layout pass based on live desktop review
  // =========================================================


  // =========================================================
  // v50: unified game components + custom SVG icon system
  // =========================================================

  // =========================================================
  // v51: exact visual polish from approved icon-system mockup
  // =========================================================



  // =========================================================
  // v52: approved icon-system + exact theme-aware score chips
  // =========================================================

  // =========================================================
  // v54: glass stat chips + real viewport fitting
  // =========================================================

  // =========================================================
  // v55: approved soft-glass stat chips + hard viewport fit
  // =========================================================


  // =========================================================
  // v56: soft theme cards for Score / Best — no glass
  // =========================================================


  // =========================================================
  // v57: exact mockup-style Solo score chips
  // =========================================================


  // =========================================================
  // v58: button-matched score chips + remove high-tile glow
  // =========================================================



  // =========================================================
  // v59: structural Solo stat chips
  // =========================================================
  // The original 2048 score elements are now only the numeric value.
  // A dedicated outer wrapper owns the visual card. This prevents legacy
  // .score-container/.best-container rules from flattening the corners.

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
  // "Based on the original 2048 by Gabriele Cirulli" flash appears during page load.
  document.body.classList.add("rinas-app-ready");
  if (window.__rinasBootWatchdog) { window.clearTimeout(window.__rinasBootWatchdog); window.__rinasBootWatchdog = null; }
})();

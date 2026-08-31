(function () {
  "use strict";

  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var unlocked = false;
  var unlockInFlight = null;
  var desiredState = "LOBBY";
  var currentState = null;
  var currentTrackKey = null;
  var currentSource = null;
  var currentTrackGain = null;
  var currentTrackToken = 0;
  var rawAssets = Object.create(null);
  var buffers = Object.create(null);
  var fetching = Object.create(null);
  var decoding = Object.create(null);
  var lastPlayed = Object.create(null);
  var activeVoices = Object.create(null);
  var assetErrors = Object.create(null);
  var resultDucked = false;
  var hidden = document.hidden;

  var masterGain = null;
  var visibilityGain = null;
  var musicUserGain = null;
  var musicDynamicGain = null;
  var sfxUserGain = null;
  var compressor = null;

  // The approved v2.1 soundtrack/SFX remain unchanged. v64 only fixes browser
  // audio boot/unlock reliability and stale asset caching.
  var SFX_BASE_BOOST = 1.30;
  var MUSIC_DEFAULT = 0.42;
  var SFX_DEFAULT = 0.75;
  var LOOP_TRIM_SECONDS = 0.035;
  var ASSET_VERSION = "64";

  var scriptUrl = (document.currentScript && document.currentScript.src) || window.location.href;

  function assetUrl(relativePath) {
    try {
      // This JS file lives in /js, while audio lives in /audio. Deriving URLs
      // from the script itself keeps GitHub Pages subdirectory hosting safe.
      var url = new URL("../" + relativePath, scriptUrl);
      url.searchParams.set("v", ASSET_VERSION);
      return url.href;
    } catch (error) {
      return relativePath + "?v=" + ASSET_VERSION;
    }
  }

  var MUSIC = {
    lobby: assetUrl("audio/music/lobby.mp3"),
    gameplay: assetUrl("audio/music/gameplay.mp3"),
    multiplayer: assetUrl("audio/music/multiplayer.mp3")
  };

  var SFX = {
    move_1: assetUrl("audio/sfx/move_1.mp3"),
    move_2: assetUrl("audio/sfx/move_2.mp3"),
    move_3: assetUrl("audio/sfx/move_3.mp3"),
    merge: assetUrl("audio/sfx/merge.mp3"),
    large_merge: assetUrl("audio/sfx/large_merge.mp3"),
    undo: assetUrl("audio/sfx/undo.mp3"),
    ui_confirm: assetUrl("audio/sfx/ui_confirm.mp3"),
    match_start: assetUrl("audio/sfx/match_start.mp3"),
    lead_gained: assetUrl("audio/sfx/lead_gained.mp3"),
    lead_lost: assetUrl("audio/sfx/lead_lost.mp3"),
    milestone: assetUrl("audio/sfx/milestone.mp3"),
    target_2048: assetUrl("audio/sfx/target_2048.mp3"),
    victory: assetUrl("audio/sfx/victory.mp3"),
    loss: assetUrl("audio/sfx/loss.mp3"),
    disconnect: assetUrl("audio/sfx/disconnect.mp3"),
    rematch: assetUrl("audio/sfx/rematch.mp3")
  };

  var EVENT_MAP = {
    ui: "ui_confirm",
    move: "move",
    merge: "merge",
    "large-merge": "large_merge",
    undo: "undo",
    lead: "lead_gained",
    "lead-lost": "lead_lost",
    milestone: "milestone",
    target: "target_2048",
    "match-start": "match_start",
    win: "victory",
    lose: "loss",
    disconnect: "disconnect",
    rematch: "rematch"
  };

  var MIN_GAP_MS = {
    move_1: 34,
    move_2: 34,
    move_3: 34,
    merge: 55,
    large_merge: 80,
    undo: 90,
    ui_confirm: 55,
    match_start: 650,
    lead_gained: 800,
    lead_lost: 800,
    milestone: 450,
    target_2048: 900,
    victory: 1200,
    loss: 1200,
    disconnect: 700,
    rematch: 450
  };

  var PER_SOUND_GAIN = {
    move_1: 0.82,
    move_2: 0.82,
    move_3: 0.82,
    merge: 0.92,
    large_merge: 0.96,
    undo: 0.90,
    ui_confirm: 0.72,
    match_start: 0.93,
    lead_gained: 0.88,
    lead_lost: 0.86,
    milestone: 0.92,
    target_2048: 0.98,
    victory: 1.0,
    loss: 0.98,
    disconnect: 0.84,
    rematch: 0.86
  };

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value)));
  }

  function settings() {
    var current = window.rinasSettings || {};
    return {
      soundEffects: current.soundEffects !== false,
      sfxVolume: typeof current.sfxVolume === "number" ? clamp(current.sfxVolume, 0, 1) : SFX_DEFAULT,
      musicEnabled: current.musicEnabled !== false,
      musicVolume: typeof current.musicVolume === "number" ? clamp(current.musicVolume, 0, 1) : MUSIC_DEFAULT
    };
  }

  // IMPORTANT v64 change: do not construct AudioContext during page load.
  // Safari/Chrome autoplay policies are much more reliable when the context is
  // born inside a real user gesture.
  function createContext() {
    if (!AudioContextClass) return null;
    if (ctx) return ctx;

    ctx = new AudioContextClass();

    masterGain = ctx.createGain();
    visibilityGain = ctx.createGain();
    musicUserGain = ctx.createGain();
    musicDynamicGain = ctx.createGain();
    sfxUserGain = ctx.createGain();
    compressor = ctx.createDynamicsCompressor();

    compressor.threshold.value = -8;
    compressor.knee.value = 12;
    compressor.ratio.value = 6;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    musicDynamicGain.gain.value = 1;
    masterGain.gain.value = 0.92;
    visibilityGain.gain.value = hidden ? 0.08 : 1;

    musicDynamicGain.connect(musicUserGain);
    musicUserGain.connect(visibilityGain);
    sfxUserGain.connect(visibilityGain);
    visibilityGain.connect(masterGain);
    masterGain.connect(compressor);
    compressor.connect(ctx.destination);

    applySettingsNow();

    ctx.onstatechange = function () {
      unlocked = ctx && ctx.state === "running";
    };

    return ctx;
  }

  function fetchAsset(key, url) {
    if (rawAssets[key]) return Promise.resolve(rawAssets[key]);
    if (fetching[key]) return fetching[key];

    fetching[key] = fetch(url, { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("HTTP " + response.status + " for " + url);
        return response.arrayBuffer();
      })
      .then(function (arrayBuffer) {
        rawAssets[key] = arrayBuffer;
        delete fetching[key];
        delete assetErrors[key];
        return arrayBuffer;
      })
      .catch(function (error) {
        delete fetching[key];
        assetErrors[key] = error && error.message ? error.message : String(error);
        console.warn("Rina audio asset unavailable:", url, assetErrors[key]);
        return null;
      });

    return fetching[key];
  }

  function decodeArrayBuffer(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var audioCtx = createContext();
      if (!audioCtx) {
        reject(new Error("Web Audio API unavailable"));
        return;
      }

      var settled = false;
      function ok(buffer) {
        if (settled) return;
        settled = true;
        resolve(buffer);
      }
      function fail(error) {
        if (settled) return;
        settled = true;
        reject(error || new Error("Audio decode failed"));
      }

      try {
        var result = audioCtx.decodeAudioData(arrayBuffer.slice(0), ok, fail);
        if (result && typeof result.then === "function") result.then(ok).catch(fail);
      } catch (error) {
        fail(error);
      }
    });
  }

  function loadBuffer(key, url) {
    if (buffers[key]) return Promise.resolve(buffers[key]);
    if (decoding[key]) return decoding[key];

    decoding[key] = fetchAsset(key, url)
      .then(function (arrayBuffer) {
        if (!arrayBuffer) return null;
        return decodeArrayBuffer(arrayBuffer);
      })
      .then(function (buffer) {
        delete decoding[key];
        if (buffer) buffers[key] = buffer;
        return buffer;
      })
      .catch(function (error) {
        delete decoding[key];
        assetErrors[key] = error && error.message ? error.message : String(error);
        console.warn("Rina audio decode failed:", url, assetErrors[key]);
        return null;
      });

    return decoding[key];
  }

  // Preload network bytes only. Decoding waits until AudioContext has been
  // safely created by the first user gesture.
  function preload() {
    Object.keys(MUSIC).forEach(function (key) {
      fetchAsset("music:" + key, MUSIC[key]);
    });
    Object.keys(SFX).forEach(function (key) {
      fetchAsset("sfx:" + key, SFX[key]);
    });
  }

  function decodePreloaded() {
    Object.keys(MUSIC).forEach(function (key) {
      loadBuffer("music:" + key, MUSIC[key]);
    });
    Object.keys(SFX).forEach(function (key) {
      loadBuffer("sfx:" + key, SFX[key]);
    });
  }

  function ramp(param, value, milliseconds) {
    if (!ctx || !param) return;
    var now = ctx.currentTime;
    var seconds = Math.max(0.01, Number(milliseconds || 0) / 1000);
    try {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(0.0001, param.value || 0.0001), now);
      param.linearRampToValueAtTime(Math.max(0.0001, value), now + seconds);
    } catch (error) {
      param.value = value;
    }
  }

  function applySettingsNow() {
    if (!ctx || !musicUserGain || !sfxUserGain) return;
    var s = settings();
    musicUserGain.gain.value = s.musicEnabled ? s.musicVolume : 0.0001;
    sfxUserGain.gain.value = s.soundEffects ? s.sfxVolume * SFX_BASE_BOOST : 0.0001;
  }

  function syncSettings() {
    if (!ctx) return;
    var s = settings();
    ramp(musicUserGain.gain, s.musicEnabled ? s.musicVolume : 0.0001, 120);
    ramp(sfxUserGain.gain, s.soundEffects ? s.sfxVolume * SFX_BASE_BOOST : 0.0001, 80);
    if (s.musicEnabled && unlocked && desiredState) transitionMusic(desiredState, 450);
  }

  function primeContext() {
    if (!ctx) return;
    try {
      var buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      var source = ctx.createBufferSource();
      var gain = ctx.createGain();
      gain.gain.value = 0.00001;
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      source.start(0);
      source.onended = function () {
        try { source.disconnect(); } catch (error) {}
        try { gain.disconnect(); } catch (error) {}
      };
    } catch (error) {}
  }

  function unlock() {
    var audioCtx = createContext();
    if (!audioCtx) return Promise.resolve(false);

    // If already running, keep this cheap and idempotent.
    if (audioCtx.state === "running") {
      unlocked = true;
      syncSettings();
      decodePreloaded();
      if (settings().musicEnabled && desiredState) transitionMusic(desiredState, 650);
      return Promise.resolve(true);
    }

    if (unlockInFlight) return unlockInFlight;

    // resume() is intentionally invoked synchronously from the gesture handler.
    var resumePromise;
    try {
      resumePromise = audioCtx.resume();
    } catch (error) {
      resumePromise = Promise.reject(error);
    }

    unlockInFlight = Promise.resolve(resumePromise)
      .then(function () {
        primeContext();
        unlocked = audioCtx.state === "running";
        syncSettings();
        decodePreloaded();
        if (unlocked && settings().musicEnabled && desiredState) {
          transitionMusic(desiredState, 700);
        }
        return unlocked;
      })
      .catch(function (error) {
        unlocked = false;
        console.warn("Rina audio unlock was blocked; will retry on next interaction.", error && error.message ? error.message : error);
        return false;
      })
      .then(function (result) {
        unlockInFlight = null;
        return result;
      });

    return unlockInFlight;
  }

  function stopCurrentTrack(fadeMs) {
    if (!ctx || !currentSource || !currentTrackGain) return;
    var source = currentSource;
    var gain = currentTrackGain;
    var stopAt = ctx.currentTime + Math.max(0.05, Number(fadeMs || 300) / 1000) + 0.04;
    ramp(gain.gain, 0.0001, fadeMs || 300);
    try { source.stop(stopAt); } catch (error) {}
    currentSource = null;
    currentTrackGain = null;
    currentTrackKey = null;
  }

  function startTrack(trackKey, fadeMs) {
    var s = settings();
    if (!unlocked || !ctx || ctx.state !== "running" || !s.musicEnabled) return;

    if (currentTrackKey === trackKey && currentSource) {
      restoreMusic(420);
      return;
    }

    var token = ++currentTrackToken;
    loadBuffer("music:" + trackKey, MUSIC[trackKey]).then(function (buffer) {
      if (!buffer || token !== currentTrackToken || !settings().musicEnabled || !unlocked || !ctx || ctx.state !== "running") return;

      var oldSource = currentSource;
      var oldGain = currentTrackGain;
      var source = ctx.createBufferSource();
      var gain = ctx.createGain();
      var duration = buffer.duration || 0;

      source.buffer = buffer;
      source.loop = true;
      if (duration > 1) {
        source.loopStart = LOOP_TRIM_SECONDS;
        source.loopEnd = Math.max(LOOP_TRIM_SECONDS + 0.5, duration - LOOP_TRIM_SECONDS);
      }
      gain.gain.value = 0.0001;
      source.connect(gain);
      gain.connect(musicDynamicGain);

      try {
        source.start(ctx.currentTime + 0.01, Math.min(LOOP_TRIM_SECONDS, Math.max(0, duration - 0.05)));
      } catch (error) {
        console.warn("Rina music start failed:", error && error.message ? error.message : error);
        return;
      }

      currentSource = source;
      currentTrackGain = gain;
      currentTrackKey = trackKey;
      ramp(gain.gain, 1, fadeMs || 1200);

      if (oldSource && oldGain) {
        ramp(oldGain.gain, 0.0001, fadeMs || 1200);
        try { oldSource.stop(ctx.currentTime + (fadeMs || 1200) / 1000 + 0.08); } catch (error) {}
      }
    });
  }

  function stateToTrack(state) {
    if (state === "SOLO" || state === "FREEPLAY") return "gameplay";
    if (state === "MULTIPLAYER" || state === "MULTIPLAYER_CLOSE_RACE") return "multiplayer";
    return "lobby";
  }

  function transitionMusic(state, fadeMs) {
    desiredState = state || "LOBBY";
    if (desiredState === "RESULT") return;
    resultDucked = false;
    currentState = desiredState;
    if (ctx) restoreMusic(Math.min(700, fadeMs || 500));
    if (!unlocked || !ctx || ctx.state !== "running" || !settings().musicEnabled) return;
    startTrack(stateToTrack(desiredState), fadeMs || 1200);
  }

  function duckMusic(target, fadeMs) {
    if (!ctx) return;
    resultDucked = true;
    ramp(musicDynamicGain.gain, clamp(typeof target === "number" ? target : 0.12, 0.02, 1), fadeMs || 650);
  }

  function restoreMusic(fadeMs) {
    if (!ctx) return;
    resultDucked = false;
    ramp(musicDynamicGain.gain, 1, fadeMs || 550);
  }

  function setCompetitiveIntensity(value) {
    if (!ctx || resultDucked) return;
    var amount = clamp(value || 0, 0, 1);
    ramp(musicDynamicGain.gain, 1 + amount * 0.05, 500);
  }

  function resolveSfxKey(eventName) {
    var mapped = EVENT_MAP[eventName] || eventName;
    if (mapped === "move") return "move_" + (1 + Math.floor(Math.random() * 3));
    return mapped;
  }

  function voiceAllowed(key) {
    var now = Date.now();
    var minGap = MIN_GAP_MS[key] || 40;
    if (lastPlayed[key] && now - lastPlayed[key] < minGap) return false;
    lastPlayed[key] = now;
    return true;
  }

  function playSfx(eventName, options) {
    options = options || {};
    var s = settings();
    if (!s.soundEffects || hidden) return false;

    // If a browser re-suspends audio, attempt recovery. UI clicks will already
    // have hit the gesture unlock handler before this method runs.
    if (!ctx || ctx.state !== "running" || !unlocked) {
      unlock();
      return false;
    }

    var key = resolveSfxKey(eventName);
    if (!SFX[key] || !voiceAllowed(key)) return false;

    loadBuffer("sfx:" + key, SFX[key]).then(function (buffer) {
      if (!buffer || !settings().soundEffects || hidden || !ctx || ctx.state !== "running") return;

      var source = ctx.createBufferSource();
      var gain = ctx.createGain();
      gain.gain.value = clamp((PER_SOUND_GAIN[key] || 1) * (typeof options.gain === "number" ? options.gain : 1), 0.05, 1.25);
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(sfxUserGain);

      activeVoices[key] = (activeVoices[key] || 0) + 1;
      source.onended = function () {
        activeVoices[key] = Math.max(0, (activeVoices[key] || 1) - 1);
        try { source.disconnect(); } catch (error) {}
        try { gain.disconnect(); } catch (error) {}
      };

      if (key === "victory") duckMusic(0.11, 620);
      if (key === "loss") duckMusic(0.08, 720);

      try { source.start(ctx.currentTime + 0.006); } catch (error) {}
    });

    return true;
  }

  function setMusicEnabled(enabled) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.musicEnabled = !!enabled;
    if (ctx) syncSettings();
    if (!enabled) {
      stopCurrentTrack(280);
    } else {
      unlock().then(function (ok) {
        if (ok) transitionMusic(desiredState || "LOBBY", 650);
      });
    }
  }

  function setSfxEnabled(enabled) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.soundEffects = !!enabled;
    if (ctx) syncSettings();
  }

  function setMusicVolume(value) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.musicVolume = clamp(value, 0, 1);
    if (ctx) syncSettings();
  }

  function setSfxVolume(value) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.sfxVolume = clamp(value, 0, 1);
    if (ctx) syncSettings();
  }

  // Keep retrying on genuine user gestures until the browser confirms RUNNING.
  // v63 used {once:true}; one blocked resume could therefore silence the whole
  // session. This is the core v64 reliability fix.
  function gestureUnlock() {
    if (!unlocked || !ctx || ctx.state !== "running") unlock();
  }

  document.addEventListener("pointerdown", gestureUnlock, true);
  document.addEventListener("click", gestureUnlock, true);
  document.addEventListener("keydown", gestureUnlock, true);
  document.addEventListener("touchstart", gestureUnlock, { capture: true, passive: true });

  document.addEventListener("visibilitychange", function () {
    hidden = document.hidden;
    if (!ctx || !visibilityGain) return;
    ramp(visibilityGain.gain, hidden ? 0.08 : 1, hidden ? 180 : 450);
    if (!hidden && ctx.state !== "running") {
      // It may still require the next user gesture; this schedules a harmless
      // resume attempt and gestureUnlock remains installed as backup.
      unlock();
    }
  });

  window.rinasAudio = {
    version: 64,
    preload: preload,
    unlock: unlock,
    syncSettings: syncSettings,
    playSfx: playSfx,
    playEvent: playSfx,
    transitionMusic: transitionMusic,
    duckMusic: duckMusic,
    restoreMusic: restoreMusic,
    setCompetitiveIntensity: setCompetitiveIntensity,
    setMusicEnabled: setMusicEnabled,
    setSfxEnabled: setSfxEnabled,
    setMusicVolume: setMusicVolume,
    setSfxVolume: setSfxVolume,
    selfTest: function () {
      return unlock().then(function (ok) {
        if (!ok) return false;
        transitionMusic("LOBBY", 250);
        setTimeout(function () { playSfx("ui"); }, 180);
        setTimeout(function () { playSfx("merge"); }, 520);
        return true;
      });
    },
    getState: function () {
      return {
        version: 64,
        webAudioAvailable: !!AudioContextClass,
        unlocked: unlocked,
        audioContextState: ctx ? ctx.state : "not-created",
        desiredState: desiredState,
        currentState: currentState,
        currentTrack: currentTrackKey,
        hidden: hidden,
        fetchedAssets: Object.keys(rawAssets).length,
        decodedAssets: Object.keys(buffers).length,
        assetErrors: Object.assign({}, assetErrors),
        settings: settings()
      };
    },
    assets: { music: MUSIC, sfx: SFX }
  };

  // Network prefetch is safe before a gesture. AudioContext creation is not.
  preload();
})();

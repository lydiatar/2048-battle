(function () {
  "use strict";

  var AudioContextClass = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var unlocked = false;
  var desiredState = "LOBBY";
  var currentState = null;
  var currentTrackKey = null;
  var currentSource = null;
  var currentTrackGain = null;
  var currentTrackToken = 0;
  var buffers = Object.create(null);
  var loading = Object.create(null);
  var lastPlayed = Object.create(null);
  var activeVoices = Object.create(null);
  var resultDucked = false;
  var hidden = document.hidden;

  var masterGain = null;
  var visibilityGain = null;
  var musicUserGain = null;
  var musicDynamicGain = null;
  var sfxUserGain = null;
  var compressor = null;

  // +2.28 dB. This is the requested ~30% default SFX loudness lift.
  // The compressor/limiter keeps stacked cues from clipping.
  var SFX_BASE_BOOST = 1.30;
  var MUSIC_DEFAULT = 0.42;
  var SFX_DEFAULT = 0.75;
  var LOOP_TRIM_SECONDS = 0.035;

  var MUSIC = {
    lobby: "audio/music/lobby.mp3",
    gameplay: "audio/music/gameplay.mp3",
    multiplayer: "audio/music/multiplayer.mp3"
  };

  var SFX = {
    move_1: "audio/sfx/move_1.mp3",
    move_2: "audio/sfx/move_2.mp3",
    move_3: "audio/sfx/move_3.mp3",
    merge: "audio/sfx/merge.mp3",
    large_merge: "audio/sfx/large_merge.mp3",
    undo: "audio/sfx/undo.mp3",
    ui_confirm: "audio/sfx/ui_confirm.mp3",
    match_start: "audio/sfx/match_start.mp3",
    lead_gained: "audio/sfx/lead_gained.mp3",
    lead_lost: "audio/sfx/lead_lost.mp3",
    milestone: "audio/sfx/milestone.mp3",
    target_2048: "audio/sfx/target_2048.mp3",
    victory: "audio/sfx/victory.mp3",
    loss: "audio/sfx/loss.mp3",
    disconnect: "audio/sfx/disconnect.mp3",
    rematch: "audio/sfx/rematch.mp3"
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

  function ensureContext() {
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
    return ctx;
  }

  function decodeArrayBuffer(arrayBuffer) {
    return new Promise(function (resolve, reject) {
      var audioCtx = ensureContext();
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
    if (loading[key]) return loading[key];

    loading[key] = fetch(url, { cache: "force-cache" })
      .then(function (response) {
        if (!response.ok) throw new Error("Audio fetch failed: " + url);
        return response.arrayBuffer();
      })
      .then(decodeArrayBuffer)
      .then(function (buffer) {
        buffers[key] = buffer;
        delete loading[key];
        return buffer;
      })
      .catch(function (error) {
        delete loading[key];
        console.warn("Rina audio asset unavailable:", url, error && error.message ? error.message : error);
        return null;
      });

    return loading[key];
  }

  function preload() {
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
    ensureContext();
    if (!ctx) return;
    var s = settings();
    ramp(musicUserGain.gain, s.musicEnabled ? s.musicVolume : 0.0001, 120);
    ramp(sfxUserGain.gain, s.soundEffects ? s.sfxVolume * SFX_BASE_BOOST : 0.0001, 80);

    if (s.musicEnabled && unlocked && desiredState) {
      transitionMusic(desiredState, 450);
    }
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
    if (!unlocked || !s.musicEnabled) return;
    var audioCtx = ensureContext();
    if (!audioCtx) return;

    if (currentTrackKey === trackKey && currentSource) {
      restoreMusic(420);
      return;
    }

    var token = ++currentTrackToken;
    loadBuffer("music:" + trackKey, MUSIC[trackKey]).then(function (buffer) {
      if (!buffer || token !== currentTrackToken || !settings().musicEnabled || !unlocked) return;

      var oldSource = currentSource;
      var oldGain = currentTrackGain;
      var source = audioCtx.createBufferSource();
      var gain = audioCtx.createGain();
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

      source.start(audioCtx.currentTime + 0.01, LOOP_TRIM_SECONDS);
      currentSource = source;
      currentTrackGain = gain;
      currentTrackKey = trackKey;
      ramp(gain.gain, 1, fadeMs || 1200);

      if (oldSource && oldGain) {
        ramp(oldGain.gain, 0.0001, fadeMs || 1200);
        try { oldSource.stop(audioCtx.currentTime + (fadeMs || 1200) / 1000 + 0.08); } catch (error) {}
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
    restoreMusic(Math.min(700, fadeMs || 500));
    if (!unlocked || !settings().musicEnabled) return;
    startTrack(stateToTrack(desiredState), fadeMs || 1200);
  }

  function duckMusic(target, fadeMs) {
    var audioCtx = ensureContext();
    if (!audioCtx) return;
    resultDucked = true;
    ramp(musicDynamicGain.gain, clamp(typeof target === "number" ? target : 0.12, 0.02, 1), fadeMs || 650);
  }

  function restoreMusic(fadeMs) {
    var audioCtx = ensureContext();
    if (!audioCtx) return;
    resultDucked = false;
    ramp(musicDynamicGain.gain, 1, fadeMs || 550);
  }

  function setCompetitiveIntensity(value) {
    var audioCtx = ensureContext();
    if (!audioCtx || resultDucked) return;
    var amount = clamp(value || 0, 0, 1);
    // At maximum intensity, only a +5% lift. The approved multiplayer track
    // provides the texture; this prevents the system becoming distracting.
    ramp(musicDynamicGain.gain, 1 + amount * 0.05, 500);
  }

  function resolveSfxKey(eventName) {
    var mapped = EVENT_MAP[eventName] || eventName;
    if (mapped === "move") {
      return "move_" + (1 + Math.floor(Math.random() * 3));
    }
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
    var audioCtx = ensureContext();
    if (!audioCtx) return false;

    var key = resolveSfxKey(eventName);
    if (!SFX[key]) return false;
    if (!voiceAllowed(key)) return false;

    loadBuffer("sfx:" + key, SFX[key]).then(function (buffer) {
      if (!buffer || !settings().soundEffects || hidden) return;

      var source = audioCtx.createBufferSource();
      var gain = audioCtx.createGain();
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

      // Outcome sounds automatically make room for themselves.
      if (key === "victory") duckMusic(0.11, 620);
      if (key === "loss") duckMusic(0.08, 720);

      source.start(audioCtx.currentTime + 0.006);
    });

    return true;
  }

  function unlock() {
    var audioCtx = ensureContext();
    if (!audioCtx) return Promise.resolve(false);
    unlocked = true;

    var resume = audioCtx.state === "suspended" ? audioCtx.resume() : Promise.resolve();
    return Promise.resolve(resume).then(function () {
      syncSettings();
      if (settings().musicEnabled && desiredState) transitionMusic(desiredState, 700);
      return true;
    }).catch(function () {
      return false;
    });
  }

  function setMusicEnabled(enabled) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.musicEnabled = !!enabled;
    syncSettings();
    if (!enabled) {
      stopCurrentTrack(280);
    } else {
      unlock().then(function () {
        transitionMusic(desiredState || "LOBBY", 650);
      });
    }
  }

  function setSfxEnabled(enabled) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.soundEffects = !!enabled;
    syncSettings();
  }

  function setMusicVolume(value) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.musicVolume = clamp(value, 0, 1);
    syncSettings();
  }

  function setSfxVolume(value) {
    if (!window.rinasSettings) window.rinasSettings = {};
    window.rinasSettings.sfxVolume = clamp(value, 0, 1);
    syncSettings();
  }

  document.addEventListener("pointerdown", unlock, { once: true, capture: true });
  document.addEventListener("keydown", unlock, { once: true, capture: true });

  document.addEventListener("visibilitychange", function () {
    hidden = document.hidden;
    if (!ctx || !visibilityGain) return;
    ramp(visibilityGain.gain, hidden ? 0.08 : 1, hidden ? 180 : 450);
  });

  window.rinasAudio = {
    version: 63,
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
    getState: function () {
      return {
        unlocked: unlocked,
        desiredState: desiredState,
        currentState: currentState,
        currentTrack: currentTrackKey,
        hidden: hidden,
        settings: settings()
      };
    },
    assets: {
      music: MUSIC,
      sfx: SFX
    }
  };

  // Fetch/decode starts immediately, but playback waits for the first user gesture.
  preload();
})();

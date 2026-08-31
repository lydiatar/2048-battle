(function () {
  "use strict";

  var root = document.getElementById("app-root");
  if (!root) return;

  var SOLO_FALLBACK = [0, 0, 0, 0, 0, 2, 0, 0, 4, 8, 0, 0, 16, 32, 64, 128];
  var MULTI_A = [0, 0, 0, 0, 0, 0, 4, 0, 0, 8, 16, 0, 2, 32, 64, 128];
  var MULTI_B = [0, 0, 0, 0, 0, 2, 0, 0, 4, 8, 0, 0, 16, 32, 64, 0];
  var FREEPLAY = [0, 2, 4, 0, 8, 16, 0, 0, 32, 0, 64, 0, 0, 2, 4, 8];

  function safeJson(key) {
    try {
      var raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function safeNumber(key, fallback) {
    try {
      var n = Number(window.localStorage.getItem(key));
      return Number.isFinite(n) ? n : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function formatNumber(value) {
    var n = Number(value || 0);
    try { return n.toLocaleString(); } catch (error) { return String(n); }
  }

  function normalizeNickname(value) {
    return String(value || "")
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 16);
  }

  function currentNickname() {
    var live = window.rinasSettings && window.rinasSettings.nickname;
    if (normalizeNickname(live)) return normalizeNickname(live);

    var stored = safeJson("rinas2048.settings");
    return normalizeNickname(stored && stored.nickname) || "Player";
  }

  function assetIcon(name, extraClass) {
    var cls = "r62-asset-icon" + (extraClass ? " " + extraClass : "");
    return '<svg class="' + cls + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="assets/icons/rinas-icons.svg#' + name + '"></use></svg>';
  }

  function getSavedSolo() {
    var state = safeJson("rinas2048.solo.gameState") || safeJson("gameState");
    var best = Math.max(
      safeNumber("rinas2048.solo.bestScore", 0),
      safeNumber("bestScore", 0)
    );
    var highest = safeNumber("rinas2048.solo.highestTileEver", 0);
    var values = [];

    if (state && state.grid && Array.isArray(state.grid.cells)) {
      for (var y = 0; y < 4; y += 1) {
        for (var x = 0; x < 4; x += 1) {
          var column = state.grid.cells[x];
          var tile = column && column[y];
          values.push(tile && tile.value ? Number(tile.value) : 0);
        }
      }
    }

    if (!values.some(function (v) { return v > 0; })) values = SOLO_FALLBACK.slice();
    if (!highest) {
      highest = values.reduce(function (max, value) { return Math.max(max, Number(value || 0)); }, 0);
    }

    return {
      values: values,
      score: state && state.score ? Number(state.score) : 0,
      best: best,
      highest: highest
    };
  }

  function boardMarkup(values, extraClass) {
    var items = Array.isArray(values) ? values.slice(0, 16) : [];
    while (items.length < 16) items.push(0);

    return '<div class="r60-board ' + (extraClass || "") + '">' +
      items.map(function (value) {
        var n = Number(value || 0);
        var cls = n ? " has-value v" + n : "";
        return '<span class="r60-cell' + cls + '">' + (n || "") + '</span>';
      }).join("") +
      '</div>';
  }

  function soloIcon() {
    return '<span class="r60-icon" aria-hidden="true">' + assetIcon("solo") + '</span>';
  }

  function multiplayerIcon() {
    return '<span class="r60-icon" aria-hidden="true">' + assetIcon("multiplayer") + '</span>';
  }

  function trigger(id) {
    var el = document.getElementById(id);
    if (el && typeof el.click === "function") el.click();
  }

  function addRefresh(node) {
    if (!node) return;
    node.classList.remove("r60-preview-refresh");
    void node.offsetWidth;
    node.classList.add("r60-preview-refresh");
  }

  function renderHomePreview(stage, mode, markActive) {
    var saved = getSavedSolo();
    var board = stage.querySelector("[data-home-board]");
    var icon = stage.querySelector("[data-home-icon]");
    var kicker = stage.querySelector("[data-home-kicker]");
    var title = stage.querySelector("[data-home-title]");
    var meta = stage.querySelector("[data-home-meta]");
    var foot = stage.querySelector("[data-home-foot]");

    stage.setAttribute("data-active", mode);
    Array.prototype.forEach.call(stage.querySelectorAll(".home-mode-choice"), function (button) {
      button.classList.toggle("is-active", !!markActive && button.getAttribute("data-mode") === mode);
    });

    if (mode === "multi") {
      board.innerHTML = '<div class="home-multi-preview">' + boardMarkup(MULTI_A) + boardMarkup(MULTI_B) + '</div>';
      if (icon) icon.innerHTML = assetIcon("multiplayer");
      kicker.textContent = "HEAD-TO-HEAD";
      title.textContent = "Multiplayer";
      meta.textContent = "Tile Race · Freeplay Duel · Custom Race";
      foot.innerHTML = '<span>3 playable modes</span><span class="foot-tile"></span><span>Private rooms with friends</span>';
    } else {
      board.innerHTML = boardMarkup(saved.values);
      if (icon) icon.innerHTML = assetIcon("solo");
      kicker.textContent = "ENDLESS SOLO";
      title.textContent = saved.score > 0 ? "Continue your game" : "Start a new game";
      meta.textContent = "Highest " + formatNumber(saved.highest) + " · Best " + formatNumber(saved.best);
      foot.innerHTML = '<span>Saved locally</span><span class="foot-tile"></span><span>Highest <b class="foot-stat">' + formatNumber(saved.highest) + '</b></span><span>Best <b class="foot-stat">' + formatNumber(saved.best) + '</b></span>';
    }

    addRefresh(board);
  }

  function decorateMainMenu(screen) {
    if (!screen || screen.dataset.r60Decorated === "home") return;
    var content = screen.querySelector("#screen-content");
    if (!content || !document.getElementById("choose-solo") || !document.getElementById("choose-multiplayer")) return;

    screen.dataset.r60Decorated = "home";
    var stage = document.createElement("section");
    stage.className = "home-live-stage";
    stage.setAttribute("data-active", "solo");
    stage.innerHTML =
      '<div class="home-live-preview">' +
        '<div class="home-preview-board-wrap">' +
          '<div class="home-live-board-frame" data-home-board></div>' +
        '</div>' +
        '<div class="home-preview-meta">' +
          '<span class="home-preview-caption-icon" data-home-icon aria-hidden="true">' + assetIcon("solo") + '</span>' +
          '<span class="home-preview-meta-copy">' +
            '<span class="preview-mode-kicker" data-home-kicker></span>' +
            '<strong data-home-title></strong>' +
            '<small data-home-meta></small>' +
          '</span>' +
        '</div>' +
      '</div>' +
      '<div class="home-live-menu">' +
        '<button class="home-settings-link" type="button" aria-label="Open Settings">' +
          '<span class="home-settings-icon" aria-hidden="true">' + assetIcon("settings") + '</span><span>Settings</span>' +
        '</button>' +
        '<div class="home-live-logo"><span class="logo-rinas">RINA\'S</span>20<em>48</em></div>' +
        '<button class="home-mode-choice" type="button" data-mode="solo">' +
          soloIcon() +
          '<span><strong>SOLO</strong><small>Continue one board and chase a bigger tile.</small></span>' +
          '<span class="mode-chevron">›</span>' +
        '</button>' +
        '<button class="home-mode-choice" type="button" data-mode="multi">' +
          multiplayerIcon() +
          '<span><strong>MULTIPLAYER</strong><small>Race, freeplay, or build a balanced match.</small></span>' +
          '<span class="mode-chevron">›</span>' +
        '</button>' +
        '<div class="home-live-foot" data-home-foot></div>' +
      '</div>';

    content.insertBefore(stage, content.firstChild);

    var homeSettings = stage.querySelector(".home-settings-link");
    if (homeSettings) {
      homeSettings.addEventListener("click", function () { trigger("screen-settings"); });
    }

    Array.prototype.forEach.call(stage.querySelectorAll(".home-mode-choice"), function (button) {
      var mode = button.getAttribute("data-mode");
      button.addEventListener("mouseenter", function () { renderHomePreview(stage, mode, false); });
      button.addEventListener("focus", function () { renderHomePreview(stage, mode, false); });
      button.addEventListener("blur", function () {
        window.setTimeout(function () {
          if (!stage.querySelector(".home-mode-choice:focus")) renderHomePreview(stage, "solo", false);
        }, 0);
      });
      button.addEventListener("click", function () {
        if (mode === "solo") trigger("choose-solo");
        else trigger("choose-multiplayer");
      });
    });

    var homeMenu = stage.querySelector(".home-live-menu");
    if (homeMenu) {
      homeMenu.addEventListener("mouseleave", function () {
        renderHomePreview(stage, "solo", false);
      });
    }

    renderHomePreview(stage, "solo", false);
  }

  function mpScene(mode) {
    if (mode === "freeplay") {
      return '<div class="mp-freeplay-scene">' +
        boardMarkup(FREEPLAY) +
        '<div class="mp-rewind-track" aria-label="Move, then undo">' +
          '<span class="mp-rewind-step"><span class="mp-rewind-icon" aria-hidden="true">' + assetIcon("move") + '</span><b>Move</b></span>' +
          '<span class="mp-rewind-flow" aria-hidden="true"><i></i><em></em></span>' +
          '<span class="mp-rewind-step"><span class="mp-rewind-icon" aria-hidden="true">' + assetIcon("undo") + '</span><b>Undo</b></span>' +
        '</div>' +
      '</div>';
    }

    if (mode === "custom") {
      return '<div class="mp-custom-scene">' +
        '<div class="mp-preview-target"><small>PLAYER 1</small><strong>2048</strong><span>TARGET</span></div>' +
        '<div class="mp-custom-vs">YOUR<br>RULES</div>' +
        '<div class="mp-preview-target"><small>PLAYER 2</small><strong>4096</strong><span>TARGET</span></div>' +
      '</div>';
    }

    return '<div class="mp-preview-pair">' +
      '<div class="mp-preview-player"><label><span>YOU</span><strong>512</strong></label>' + boardMarkup(MULTI_A) + '</div>' +
      '<div class="mp-preview-player"><label><span>RIVAL</span><strong>256</strong></label>' + boardMarkup(MULTI_B) + '</div>' +
    '</div>';
  }

  function mpDetails(mode) {
    if (mode === "freeplay") {
      return {
        kicker: "02 · CASUAL",
        title: "Freeplay Duel",
        copy: "Build side-by-side with no finish line, no elimination, and a one-step rewind after every successful move.",
        facts: ["No finish line", "One-step Undo", "Restart anytime"]
      };
    }
    if (mode === "custom") {
      return {
        kicker: "03 · HANDICAP",
        title: "Custom Race",
        copy: "Give each player a different target. Balance a beginner against an expert without hiding the advantage.",
        facts: ["Different targets", "Live position", "Transparent rules"]
      };
    }
    return {
      kicker: "01 · COMPETITIVE",
      title: "Tile Race",
      copy: "Pure 2048 under pressure. First player to reach the target wins; a stuck board loses.",
      facts: ["Live position", "No Undo", "2048 / 4096 / 8192"]
    };
  }

  function renderMultiplayerPreview(stage, mode, markActive) {
    var details = mpDetails(mode);
    var preview = stage.querySelector(".mp-live-preview");
    stage.setAttribute("data-active", mode);

    Array.prototype.forEach.call(stage.querySelectorAll(".mp-live-mode"), function (button) {
      button.classList.toggle("is-active", !!markActive && button.getAttribute("data-mode") === mode);
    });

    preview.querySelector(".mp-preview-kicker").textContent = details.kicker;
    var previewIcon = preview.querySelector("[data-mp-preview-icon]");
    if (previewIcon) previewIcon.innerHTML = assetIcon(mode === "freeplay" ? "freeplay" : mode === "custom" ? "custom-race" : "tile-race");
    preview.querySelector(".mp-preview-title").textContent = details.title;
    preview.querySelector(".mp-preview-copy").textContent = details.copy;
    preview.querySelector(".mp-preview-scene").innerHTML = mpScene(mode);
    preview.querySelector(".mp-preview-facts").innerHTML = details.facts.map(function (fact) {
      return "<span>" + fact + "</span>";
    }).join("");
    addRefresh(preview.querySelector(".mp-preview-scene"));
  }

  function syncMultiplayerIdentity(stage) {
    if (!stage) return;
    var nickname = currentNickname();
    var originalNick = document.getElementById("multiplayer-current-nickname");
    var visibleNick = stage.querySelector("[data-mp-nickname]");
    var statusLabel = stage.querySelector("[data-mp-status]");

    if (originalNick && originalNick.textContent.trim() !== nickname) {
      originalNick.textContent = nickname;
    }

    if (visibleNick && visibleNick.textContent.trim() !== nickname) {
      visibleNick.textContent = nickname;
      visibleNick.classList.remove("r62-nickname-updated");
      void visibleNick.offsetWidth;
      visibleNick.classList.add("r62-nickname-updated");
      window.setTimeout(function () { visibleNick.classList.remove("r62-nickname-updated"); }, 360);
    }

    if (statusLabel) statusLabel.textContent = (window.multiplayerSocket && window.multiplayerSocket.connected) ? "READY AS" : "PLAYING AS";
  }

  function syncNicknameEverywhere() {
    var nickname = currentNickname();
    var originalNick = document.getElementById("multiplayer-current-nickname");
    if (originalNick && originalNick.textContent.trim() !== nickname) originalNick.textContent = nickname;

    Array.prototype.forEach.call(document.querySelectorAll("[data-mp-nickname]"), function (node) {
      if (node.textContent.trim() !== nickname) node.textContent = nickname;
    });

    var ownBattleName = document.getElementById("own-nickname");
    if (ownBattleName && ownBattleName.textContent.trim() !== nickname) ownBattleName.textContent = nickname;
  }

  function decorateRoomCode() {
    Array.prototype.forEach.call(document.querySelectorAll(".room-code-display"), function (display) {
      if (display.dataset.r60Decorated === "true") return;
      var code = String(display.textContent || "").trim().toUpperCase();
      if (!code) return;
      display.dataset.r60Decorated = "true";
      display.setAttribute("aria-label", "Room code " + code);
      display.innerHTML = '<div class="r60-room-code" aria-hidden="true">' + code.split("").map(function (char) {
        return "<span>" + char.replace(/[&<>"']/g, function (c) { return ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;","'":"&#39;"})[c]; }) + "</span>";
      }).join("") + "</div>";

      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "r60-copy-code";
      copy.textContent = "Copy room code";
      copy.addEventListener("click", function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(function () {
            copy.textContent = "Copied";
            setTimeout(function () { copy.textContent = "Copy room code"; }, 1200);
          }).catch(function () {});
        }
      });
      display.insertAdjacentElement("afterend", copy);
    });
  }

  function decorateMultiplayerMenu(screen) {
    if (!screen || screen.dataset.r60Decorated === "multiplayer") return;
    var content = screen.querySelector("#screen-content");
    var originalNick = document.getElementById("multiplayer-current-nickname");
    if (!content || !document.getElementById("mode-tile-race") || !document.getElementById("mode-freeplay") || !document.getElementById("mode-custom-race")) return;

    screen.dataset.r60Decorated = "multiplayer";
    var nickname = currentNickname();
    var connected = !!(window.multiplayerSocket && window.multiplayerSocket.connected);
    var stage = document.createElement("section");
    stage.className = "mp-live-stage";
    stage.innerHTML =
      '<div class="mp-live-left">' +
        '<div class="mp-profile-line"><span class="status-dot"></span><span data-mp-status>' + (connected ? 'READY AS' : 'PLAYING AS') + '</span><strong data-mp-nickname></strong><button class="mp-change-link" type="button"><span class="mp-change-icon" aria-hidden="true">' + assetIcon("edit") + '</span><span>Change</span></button></div>' +
        '<div class="mp-live-heading"><span>CHOOSE HOW TO PLAY</span><h2>Make it a match.</h2></div>' +
        '<div class="mp-mode-rail">' +
          '<button class="mp-live-mode" type="button" data-mode="race"><span class="mp-mode-icon" aria-hidden="true">' + assetIcon("tile-race") + '</span><span class="mode-index">01</span><span><strong>Tile Race</strong><small>Reach the target first. No Undo.</small></span><span class="mode-chevron">›</span></button>' +
          '<button class="mp-live-mode" type="button" data-mode="freeplay"><span class="mp-mode-icon" aria-hidden="true">' + assetIcon("freeplay") + '</span><span class="mode-index">02</span><span><strong>Freeplay Duel</strong><small>No winner. Build, compare, rewind.</small></span><span class="mode-chevron">›</span></button>' +
          '<button class="mp-live-mode" type="button" data-mode="custom"><span class="mp-mode-icon" aria-hidden="true">' + assetIcon("custom-race") + '</span><span class="mode-index">03</span><span><strong>Custom Race</strong><small>Different finish tiles for different skill levels.</small></span><span class="mode-chevron">›</span></button>' +
        '</div>' +
        '<div class="mp-future-modes"><span><b>Score Sprint</b> · coming soon</span><span><b>Blitz</b> · coming soon</span><span><b>Survival</b> · coming soon</span></div>' +
      '</div>' +
      '<div class="mp-live-preview">' +
        '<span class="mp-preview-kicker"></span>' +
        '<div class="mp-preview-heading-row"><span class="mp-preview-mode-icon" data-mp-preview-icon aria-hidden="true">' + assetIcon("tile-race") + '</span><strong class="mp-preview-title"></strong></div>' +
        '<p class="mp-preview-copy"></p>' +
        '<div class="mp-preview-scene"></div>' +
        '<div class="mp-preview-facts"></div>' +
      '</div>';

    content.insertBefore(stage, content.firstChild);
    stage.querySelector("[data-mp-nickname]").textContent = nickname;

    stage.querySelector(".mp-change-link").addEventListener("click", function () {
      trigger("change-nickname");
    });

    Array.prototype.forEach.call(stage.querySelectorAll(".mp-live-mode"), function (button) {
      var mode = button.getAttribute("data-mode");
      button.addEventListener("mouseenter", function () { renderMultiplayerPreview(stage, mode, false); });
      button.addEventListener("focus", function () { renderMultiplayerPreview(stage, mode, false); });
      button.addEventListener("blur", function () {
        window.setTimeout(function () {
          if (!stage.querySelector(".mp-live-mode:focus")) renderMultiplayerPreview(stage, "race", false);
        }, 0);
      });
      button.addEventListener("click", function () {
        if (mode === "freeplay") trigger("mode-freeplay");
        else if (mode === "custom") trigger("mode-custom-race");
        else trigger("mode-tile-race");
      });
    });

    var rail = stage.querySelector(".mp-mode-rail");
    if (rail) {
      rail.addEventListener("mouseleave", function () {
        renderMultiplayerPreview(stage, "race", false);
      });
    }

    renderMultiplayerPreview(stage, "race", false);
  }

  function previewMovementKeysMarkup() {
    var scheme = window.rinasSettings && window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";

    if (scheme === "wasd") {
      return '<span class="solo-preview-control"><span class="solo-preview-control-label">Move</span><span class="solo-preview-key-cluster wasd"><kbd>W</kbd><span><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></span></span>';
    }

    return '<span class="solo-preview-control"><span class="solo-preview-control-label">Move</span><span class="solo-preview-key-cluster arrows"><span><kbd>↑</kbd></span><span><kbd>←</kbd><kbd>↓</kbd><kbd>→</kbd></span></span></span>';
  }

  function decorateSoloPreviewControls() {
    var caption = root.querySelector(".screen-solo-menu .solo-preview-caption");
    if (!caption) return;

    var scheme = window.rinasSettings && window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";
    var undoEnabled = !!(window.rinasSettings && window.rinasSettings.soloUndo);
    var stateKey = scheme + ":" + (undoEnabled ? "undo" : "no-undo");
    if (caption.dataset.r65Controls === stateKey) return;

    caption.dataset.r65Controls = stateKey;
    caption.innerHTML = previewMovementKeysMarkup() +
      (undoEnabled ?
        '<span class="solo-preview-control undo"><span class="solo-preview-control-label">Undo</span><span class="solo-preview-undo-icon" aria-hidden="true">' + assetIcon("undo") + '</span><kbd>Z</kbd></span>' :
        '');
  }

  function decorateCurrent() {
    var main = root.querySelector(".screen-menu");
    if (main) decorateMainMenu(main);

    var multiplayer = root.querySelector(".screen-multiplayer-menu");
    if (multiplayer) {
      decorateMultiplayerMenu(multiplayer);
      syncMultiplayerIdentity(multiplayer.querySelector(".mp-live-stage"));
    }

    decorateRoomCode();
    decorateSoloPreviewControls();
    syncNicknameEverywhere();
  }

  var scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      decorateCurrent();
    });
  }

  var observer = new MutationObserver(scheduleDecorate);
  observer.observe(root, { childList: true, subtree: true });
  scheduleDecorate();

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("#settings-save, #nickname-prompt-save") : null;
    if (!target) return;
    window.setTimeout(function () {
      syncNicknameEverywhere();
      scheduleDecorate();
    }, 40);
    window.setTimeout(function () {
      syncNicknameEverywhere();
      scheduleDecorate();
    }, 280);
  }, true);

  document.addEventListener("change", function (event) {
    if (!event.target || event.target.id !== "settings-nickname") return;
    window.setTimeout(function () {
      syncNicknameEverywhere();
      scheduleDecorate();
    }, 20);
  }, true);

  var lastKnownNickname = currentNickname();
  window.setInterval(function () {
    var now = currentNickname();
    if (now !== lastKnownNickname) {
      lastKnownNickname = now;
      syncNicknameEverywhere();
      scheduleDecorate();
    }
  }, 250);

  if (window.multiplayerSocket && typeof window.multiplayerSocket.on === "function") {
    window.multiplayerSocket.on("connect", scheduleDecorate);
    window.multiplayerSocket.on("disconnect", scheduleDecorate);
  }
})();

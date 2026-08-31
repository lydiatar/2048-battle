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
    return '<span class="r60-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><rect x="5" y="5" width="16" height="16" rx="4"></rect><rect x="27" y="5" width="16" height="16" rx="4"></rect><rect x="5" y="27" width="16" height="16" rx="4"></rect><rect class="accent-fill" x="27" y="27" width="16" height="16" rx="4"></rect></svg></span>';
  }

  function multiplayerIcon() {
    return '<span class="r60-icon" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="16" cy="15" r="7"></circle><circle cx="33" cy="15" r="7"></circle><path d="M5 39c1-9 6-13 11-13s10 4 11 13"></path><path class="accent-fill" d="M22 39c1-9 6-13 11-13s10 4 11 13"></path></svg></span>';
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

  function renderHomePreview(stage, mode) {
    var saved = getSavedSolo();
    var board = stage.querySelector("[data-home-board]");
    var kicker = stage.querySelector("[data-home-kicker]");
    var title = stage.querySelector("[data-home-title]");
    var meta = stage.querySelector("[data-home-meta]");
    var foot = stage.querySelector("[data-home-foot]");

    stage.setAttribute("data-active", mode);
    Array.prototype.forEach.call(stage.querySelectorAll(".home-mode-choice"), function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-mode") === mode);
    });

    if (mode === "multi") {
      board.innerHTML = '<div class="home-multi-preview">' + boardMarkup(MULTI_A) + boardMarkup(MULTI_B) + '</div>';
      kicker.textContent = "HEAD-TO-HEAD";
      title.textContent = "Multiplayer";
      meta.textContent = "Tile Race · Freeplay Duel · Custom Race";
      foot.innerHTML = '<span>3 playable modes</span><span class="foot-tile"></span><span>Private rooms with friends</span>';
    } else {
      board.innerHTML = boardMarkup(saved.values);
      kicker.textContent = "ENDLESS SOLO";
      title.textContent = saved.score > 0 ? "Continue your run" : "Start your board";
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
          '<span class="preview-mode-kicker" data-home-kicker></span>' +
          '<strong data-home-title></strong>' +
          '<small data-home-meta></small>' +
        '</div>' +
      '</div>' +
      '<div class="home-live-menu">' +
        '<div class="home-live-logo"><span class="logo-rinas">RINA\'S</span>20<em>48</em></div>' +
        '<button class="home-mode-choice is-active" type="button" data-mode="solo">' +
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

    Array.prototype.forEach.call(stage.querySelectorAll(".home-mode-choice"), function (button) {
      var mode = button.getAttribute("data-mode");
      button.addEventListener("mouseenter", function () { renderHomePreview(stage, mode); });
      button.addEventListener("focus", function () { renderHomePreview(stage, mode); });
      button.addEventListener("click", function () {
        if (mode === "solo") trigger("choose-solo");
        else trigger("choose-multiplayer");
      });
    });

    renderHomePreview(stage, "solo");
  }

  function mpScene(mode) {
    if (mode === "freeplay") {
      return '<div class="mp-freeplay-scene">' +
        boardMarkup(FREEPLAY) +
        '<div class="mp-rewind-track"><span>MOVE</span><i></i><span>UNDO</span></div>' +
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

  function renderMultiplayerPreview(stage, mode) {
    var details = mpDetails(mode);
    var preview = stage.querySelector(".mp-live-preview");
    stage.setAttribute("data-active", mode);

    Array.prototype.forEach.call(stage.querySelectorAll(".mp-live-mode"), function (button) {
      button.classList.toggle("is-active", button.getAttribute("data-mode") === mode);
    });

    preview.querySelector(".mp-preview-kicker").textContent = details.kicker;
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
    var originalNick = document.getElementById("multiplayer-current-nickname");
    var visibleNick = stage.querySelector("[data-mp-nickname]");
    var statusLabel = stage.querySelector("[data-mp-status]");
    if (visibleNick && originalNick) visibleNick.textContent = originalNick.textContent.trim() || "Player";
    if (statusLabel) statusLabel.textContent = (window.multiplayerSocket && window.multiplayerSocket.connected) ? "READY AS" : "PLAYING AS";
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
    var nickname = originalNick ? originalNick.textContent.trim() : "Player";
    var connected = !!(window.multiplayerSocket && window.multiplayerSocket.connected);
    var stage = document.createElement("section");
    stage.className = "mp-live-stage";
    stage.innerHTML =
      '<div class="mp-live-left">' +
        '<div class="mp-profile-line"><span class="status-dot"></span><span data-mp-status>' + (connected ? 'READY AS' : 'PLAYING AS') + '</span><strong data-mp-nickname></strong><button class="mp-change-link" type="button">Change</button></div>' +
        '<div class="mp-live-heading"><span>CHOOSE HOW TO PLAY</span><h2>Make it a match.</h2></div>' +
        '<div class="mp-mode-rail">' +
          '<button class="mp-live-mode is-active" type="button" data-mode="race"><span class="mode-index">01</span><span><strong>Tile Race</strong><small>Reach the target first. No Undo.</small></span><span class="mode-chevron">›</span></button>' +
          '<button class="mp-live-mode" type="button" data-mode="freeplay"><span class="mode-index">02</span><span><strong>Freeplay Duel</strong><small>No winner. Build, compare, rewind.</small></span><span class="mode-chevron">›</span></button>' +
          '<button class="mp-live-mode" type="button" data-mode="custom"><span class="mode-index">03</span><span><strong>Custom Race</strong><small>Different finish tiles for different skill levels.</small></span><span class="mode-chevron">›</span></button>' +
        '</div>' +
        '<div class="mp-future-modes"><span><b>Score Sprint</b> · coming soon</span><span><b>Blitz</b> · coming soon</span><span><b>Survival</b> · coming soon</span></div>' +
      '</div>' +
      '<div class="mp-live-preview">' +
        '<span class="mp-preview-kicker"></span>' +
        '<strong class="mp-preview-title"></strong>' +
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
      button.addEventListener("mouseenter", function () { renderMultiplayerPreview(stage, mode); });
      button.addEventListener("focus", function () { renderMultiplayerPreview(stage, mode); });
      button.addEventListener("click", function () {
        if (mode === "freeplay") trigger("mode-freeplay");
        else if (mode === "custom") trigger("mode-custom-race");
        else trigger("mode-tile-race");
      });
    });

    renderMultiplayerPreview(stage, "race");
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

  if (window.multiplayerSocket && typeof window.multiplayerSocket.on === "function") {
    window.multiplayerSocket.on("connect", scheduleDecorate);
    window.multiplayerSocket.on("disconnect", scheduleDecorate);
  }
})();

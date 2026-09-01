/* Rina's 2048 UI v73 — approved prototype refinement integration. */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener: function () {} };
  var previews = new Set();

  function updateControlHints() {
    var scheme = window.rinasSettings && window.rinasSettings.controlScheme === "wasd" ? "wasd" : "arrows";
    var copy = scheme === "wasd"
      ? "Use W, A, S, and D or swipe to move your tiles."
      : "Use the arrow keys or swipe to move your tiles.";

    document.querySelectorAll("[data-control-hint]").forEach(function (node) {
      node.textContent = copy;
    });
  }

  class NumberlessPreview {
    constructor(element, configuration) {
      this.element = element;
      this.tileLayer = element.querySelector(".motion-tiles");
      this.wellLayer = element.querySelector(".motion-wells");
      this.seed = configuration.seed.slice();
      this.state = configuration.seed.slice();
      this.directions = configuration.directions;
      this.directionCursor = configuration.offset || 0;
      this.spawnCursor = configuration.offset || 0;
      this.cadence = configuration.cadence;
      this.moving = false;
      this.timer = null;
      this.buildWells();
      this.render();
      this.start();
    }

    buildWells() {
      if (!this.wellLayer) return;
      var wells = document.createDocumentFragment();
      for (var index = 0; index < 16; index += 1) {
        var well = document.createElement("i");
        well.className = "motion-well";
        wells.appendChild(well);
      }
      this.wellLayer.replaceChildren(wells);
    }

    render() {
      if (!this.tileLayer || !this.element.isConnected) return;
      this.element.classList.add("is-settling");
      var tiles = document.createDocumentFragment();
      this.state.forEach(function (value, index) {
        if (!value) return;
        var tile = document.createElement("i");
        tile.className = "motion-tile";
        tile.dataset.index = String(index);
        tile.dataset.value = String(value);
        tile.style.setProperty("--row", String(Math.floor(index / 4)));
        tile.style.setProperty("--col", String(index % 4));
        tiles.appendChild(tile);
      });
      this.tileLayer.replaceChildren(tiles);
      var self = this;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          if (self.element.isConnected) self.element.classList.remove("is-settling");
        });
      });
    }

    start() {
      if (reducedMotion.matches || this.timer || !this.element.isConnected) return;
      var self = this;
      this.timer = window.setInterval(function () {
        if (!self.element.isConnected) {
          self.stop();
          previews.delete(self);
          return;
        }
        self.step();
      }, this.cadence);
    }

    stop() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
    }

    reset() {
      this.state = this.seed.slice();
      this.render();
      this.moving = false;
    }

    step() {
      if (this.moving || reducedMotion.matches || !this.element.isConnected) return;
      if (Math.max.apply(Math, this.state) >= 128) {
        this.reset();
        return;
      }

      var result = null;
      for (var attempt = 0; attempt < this.directions.length; attempt += 1) {
        var direction = this.directions[this.directionCursor % this.directions.length];
        this.directionCursor += 1;
        var candidate = this.calculateMove(direction);
        if (candidate.changed) {
          result = candidate;
          break;
        }
      }

      if (!result) {
        this.reset();
        return;
      }

      this.moving = true;
      this.element.classList.remove("is-settling");
      var self = this;
      requestAnimationFrame(function () {
        result.transitions.forEach(function (transition) {
          var tile = self.tileLayer && self.tileLayer.querySelector('[data-index="' + transition.source + '"]');
          if (!tile) return;
          tile.style.setProperty("--row", String(Math.floor(transition.destination / 4)));
          tile.style.setProperty("--col", String(transition.destination % 4));
        });
      });

      window.setTimeout(function () {
        if (!self.element.isConnected) {
          self.stop();
          return;
        }
        self.state = self.addTile(result.next);
        self.render();
        self.moving = false;
      }, 235);
    }

    addTile(board) {
      var next = board.slice();
      var empty = [];
      next.forEach(function (value, index) {
        if (!value) empty.push(index);
      });
      if (!empty.length) return next;
      var destination = empty[this.spawnCursor % empty.length];
      next[destination] = this.spawnCursor % 5 === 4 ? 4 : 2;
      this.spawnCursor += 1;
      return next;
    }

    calculateMove(direction) {
      var next = Array(16).fill(0);
      var transitions = [];

      for (var line = 0; line < 4; line += 1) {
        var indexes = this.lineIndexes(direction, line);
        var occupied = indexes.map(function (index) {
          return { index: index, value: this.state[index] };
        }, this).filter(function (item) {
          return item.value !== 0;
        });

        var sourceCursor = 0;
        var destinationCursor = 0;
        while (sourceCursor < occupied.length) {
          var current = occupied[sourceCursor];
          var following = occupied[sourceCursor + 1];
          var destination = indexes[destinationCursor];

          if (following && current.value === following.value) {
            next[destination] = current.value * 2;
            transitions.push({ source: current.index, destination: destination });
            transitions.push({ source: following.index, destination: destination });
            sourceCursor += 2;
          } else {
            next[destination] = current.value;
            transitions.push({ source: current.index, destination: destination });
            sourceCursor += 1;
          }
          destinationCursor += 1;
        }
      }

      return {
        next: next,
        transitions: transitions,
        changed: next.some(function (value, index) { return value !== this.state[index]; }, this)
      };
    }

    lineIndexes(direction, line) {
      var indexes = [];
      for (var offset = 0; offset < 4; offset += 1) {
        if (direction === "left") indexes.push(line * 4 + offset);
        if (direction === "right") indexes.push(line * 4 + (3 - offset));
        if (direction === "up") indexes.push(offset * 4 + line);
        if (direction === "down") indexes.push((3 - offset) * 4 + line);
      }
      return indexes;
    }
  }

  var configurations = {
    solo: {
      seed: [2, 0, 2, 0, 0, 4, 0, 0, 2, 0, 2, 0, 0, 0, 0, 4],
      directions: ["left", "down", "right", "up"],
      cadence: 1650,
      offset: 0
    },
    "multi-a": {
      seed: [2, 2, 0, 0, 4, 0, 4, 0, 0, 2, 0, 2, 0, 0, 0, 0],
      directions: ["right", "down", "left", "up"],
      cadence: 930,
      offset: 1
    },
    "multi-b": {
      seed: [0, 4, 0, 4, 2, 0, 2, 0, 0, 0, 0, 2, 2, 0, 0, 0],
      directions: ["down", "left", "up", "right"],
      cadence: 1010,
      offset: 2
    }
  };

  function decorate() {
    document.querySelectorAll("[data-preview]").forEach(function (element) {
      if (element.dataset.previewReady === "true") return;
      var configuration = configurations[element.dataset.preview];
      if (!configuration) return;
      element.dataset.previewReady = "true";
      var preview = new NumberlessPreview(element, configuration);
      previews.add(preview);
    });
    updateControlHints();
  }

  var scheduled = false;
  function scheduleDecorate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(function () {
      scheduled = false;
      decorate();
    });
  }

  var root = document.getElementById("app-root");
  if (root && window.MutationObserver) {
    new MutationObserver(scheduleDecorate).observe(root, { childList: true, subtree: true });
  }

  document.addEventListener("click", function (event) {
    var target = event.target && event.target.closest ? event.target.closest("#settings-save, .control-choice") : null;
    if (target) window.setTimeout(updateControlHints, 0);
  }, true);

  reducedMotion.addEventListener("change", function (event) {
    previews.forEach(function (preview) {
      if (event.matches) preview.stop();
      else preview.start();
    });
  });

  scheduleDecorate();
})();

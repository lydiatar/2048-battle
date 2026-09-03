/* Rina's 2048 — production numberless previews v105 */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false, addEventListener: function () {} };
  var instances = [];

  function NumberlessPreview(element, configuration) {
    this.element = element;
    this.tileLayer = element.querySelector(".motion-tiles");
    this.wellLayer = element.querySelector(".motion-wells");
    this.seed = configuration.seed.slice();
    this.state = configuration.seed.slice();
    this.directions = configuration.directions.slice();
    this.directionCursor = configuration.offset || 0;
    this.spawnCursor = configuration.offset || 0;
    this.cadence = configuration.cadence;
    this.moving = false;
    this.timer = null;
    this.buildWells();
    this.render();
    this.start();
  }

  NumberlessPreview.prototype.buildWells = function () {
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < 16; i += 1) {
      var well = document.createElement("i");
      well.className = "motion-well";
      fragment.appendChild(well);
    }
    this.wellLayer.replaceChildren(fragment);
  };

  NumberlessPreview.prototype.render = function () {
    var self = this;
    this.element.classList.add("is-settling");
    var fragment = document.createDocumentFragment();

    this.state.forEach(function (value, index) {
      if (!value) return;
      var tile = document.createElement("i");
      tile.className = "motion-tile";
      tile.dataset.index = String(index);
      tile.dataset.value = String(value);
      tile.style.setProperty("--row", String(Math.floor(index / 4)));
      tile.style.setProperty("--col", String(index % 4));
      fragment.appendChild(tile);
    });

    this.tileLayer.replaceChildren(fragment);
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        self.element.classList.remove("is-settling");
      });
    });
  };

  NumberlessPreview.prototype.start = function () {
    var self = this;
    if (reducedMotion.matches || this.timer || !document.documentElement.contains(this.element)) return;
    this.timer = window.setInterval(function () { self.step(); }, this.cadence);
  };

  NumberlessPreview.prototype.stop = function () {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
  };

  NumberlessPreview.prototype.destroy = function () {
    this.stop();
    this.element.dataset.previewReady = "";
  };

  NumberlessPreview.prototype.reset = function () {
    this.state = this.seed.slice();
    this.render();
    this.moving = false;
  };

  NumberlessPreview.prototype.step = function () {
    var self = this;
    if (this.moving || reducedMotion.matches || !document.documentElement.contains(this.element)) {
      if (!document.documentElement.contains(this.element)) this.stop();
      return;
    }

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

    window.requestAnimationFrame(function () {
      result.transitions.forEach(function (transition) {
        var tile = self.tileLayer.querySelector('[data-index="' + transition.source + '"]');
        if (!tile) return;
        tile.style.setProperty("--row", String(Math.floor(transition.destination / 4)));
        tile.style.setProperty("--col", String(transition.destination % 4));
      });
    });

    window.setTimeout(function () {
      self.state = self.addTile(result.next);
      self.render();
      self.moving = false;
    }, 235);
  };

  NumberlessPreview.prototype.addTile = function (board) {
    var next = board.slice();
    var empty = [];
    next.forEach(function (value, index) { if (!value) empty.push(index); });
    if (!empty.length) return next;
    var destination = empty[this.spawnCursor % empty.length];
    next[destination] = this.spawnCursor % 5 === 4 ? 4 : 2;
    this.spawnCursor += 1;
    return next;
  };

  NumberlessPreview.prototype.calculateMove = function (direction) {
    var next = Array(16).fill(0);
    var transitions = [];

    for (var line = 0; line < 4; line += 1) {
      var indexes = this.lineIndexes(direction, line);
      var occupied = indexes.map(function (index) {
        return { index: index, value: this.state[index] };
      }, this).filter(function (item) { return item.value !== 0; });

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
  };

  NumberlessPreview.prototype.lineIndexes = function (direction, line) {
    var indexes = [];
    for (var offset = 0; offset < 4; offset += 1) {
      if (direction === "left") indexes.push(line * 4 + offset);
      if (direction === "right") indexes.push(line * 4 + (3 - offset));
      if (direction === "up") indexes.push(offset * 4 + line);
      if (direction === "down") indexes.push((3 - offset) * 4 + line);
    }
    return indexes;
  };

  var configurations = {
    solo: {
      seed: [2,0,2,0,0,4,0,0,2,0,2,0,0,0,0,4],
      directions: ["left","down","right","up"],
      cadence: 1650,
      offset: 0
    },
    "multi-a": {
      seed: [2,2,0,0,4,0,4,0,0,2,0,2,0,0,0,0],
      directions: ["right","down","left","up"],
      cadence: 930,
      offset: 1
    },
    "multi-b": {
      seed: [0,4,0,4,2,0,2,0,0,0,0,2,2,0,0,0],
      directions: ["down","left","up","right"],
      cadence: 1010,
      offset: 2
    },
    "multi-c": {
      seed: [2,0,4,0,0,2,0,2,4,0,0,0,0,2,0,0],
      directions: ["left","up","right","down"],
      cadence: 970,
      offset: 3
    },
    "multi-d": {
      seed: [0,2,0,2,4,0,0,4,0,2,0,0,0,0,2,0],
      directions: ["up","right","down","left"],
      cadence: 1050,
      offset: 4
    }
  };

  function mountPreviews(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var elements = scope.querySelectorAll("[data-preview]");
    Array.prototype.forEach.call(elements, function (element) {
      if (element.dataset.previewReady === "true") return;
      var configuration = configurations[element.dataset.preview];
      if (!configuration) return;
      element.dataset.previewReady = "true";
      instances.push(new NumberlessPreview(element, configuration));
    });
    instances = instances.filter(function (instance) {
      if (document.documentElement.contains(instance.element)) return true;
      instance.destroy();
      return false;
    });
  }

  var scheduled = false;
  function scheduleMount() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function () {
      scheduled = false;
      mountPreviews(document);
    });
  }

  var observer = new MutationObserver(scheduleMount);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleMount();

  if (reducedMotion.addEventListener) {
    reducedMotion.addEventListener("change", function (event) {
      instances.forEach(function (instance) {
        if (event.matches) instance.stop();
        else instance.start();
      });
    });
  }

  window.rinasPreviewSystem = {
    mount: scheduleMount,
    instances: instances
  };
})();

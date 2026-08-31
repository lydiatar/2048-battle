function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size = size;
  this.inputManager = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator = new Actuator;
  this.startTiles = 2;
  this.undoAnimating = false;
  this.freeplayUndoEntry = null;
  this.multiplayerMotionSerial = 0;
  this.pendingMultiplayerMotion = null;

  this.inputManager.on("move", this.move.bind(this));
  this.inputManager.on("restart", this.restart.bind(this));
  this.inputManager.on("keepPlaying", this.keepPlaying.bind(this));

  this.setup();
}

GameManager.prototype.restart = function () {
  if (
    window.multiplayerMode &&
    !window.multiplayerAllowRestart
  ) {
    return;
  }

  this.storageManager.clearGameState();
  this.storageManager.clearUndoStack();
  this.freeplayUndoEntry = null;
  this.actuator.continueGame();
  this.setup();

  if (window.rinasAudio && window.rinasAudio.transitionMusic) {
    window.rinasAudio.transitionMusic(
      window.multiplayerMode
        ? (window.multiplayerModeName === "freeplay" ? "FREEPLAY" : "MULTIPLAYER")
        : "SOLO",
      500
    );
  }
};

GameManager.prototype.keepPlaying = function () {
  this.keepPlaying = true;
  this.actuator.continueGame();
};

GameManager.prototype.isGameTerminated = function () {
  return this.over || (this.won && !this.keepPlaying);
};

GameManager.prototype.setup = function () {
  var previousState = this.storageManager.getGameState();

  if (previousState) {
    this.grid = new Grid(
      previousState.grid.size,
      previousState.grid.cells
    );

    this.score = previousState.score;
    this.over = previousState.over;
    this.won = previousState.won;
    this.keepPlaying = previousState.keepPlaying;
  } else {
    this.grid = new Grid(this.size);
    this.score = 0;
    this.over = false;
    this.won = false;
    this.keepPlaying = false;

    this.addStartTiles();
  }

  if (!window.multiplayerMode) {
    var inferredHighest = this.getHighestTileValue();

    if (
      previousState &&
      typeof previousState.soloHighestMilestone === "number"
    ) {
      this.soloHighestMilestone = previousState.soloHighestMilestone;
    } else {
      // Older saved games did not store milestone progress.
      // Infer it from the current board so old saves do not
      // suddenly replay celebrations they already passed.
      this.soloHighestMilestone = inferredHighest >= 2048
        ? inferredHighest
        : 0;
    }
  } else {
    this.soloHighestMilestone = 0;
  }

  this.actuator.continueGame();
  this.actuate();
};

GameManager.prototype.addStartTiles = function () {
  for (var i = 0; i < this.startTiles; i++) {
    this.addRandomTile();
  }
};

GameManager.prototype.addRandomTile = function () {
  if (this.grid.cellsAvailable()) {
    var value = Math.random() < 0.9 ? 2 : 4;
    var tile = new Tile(this.grid.randomAvailableCell(), value);

    this.grid.insertTile(tile);
    return tile;
  }

  return null;
};

GameManager.prototype.getHighestTileValue = function () {
  var highest = 0;

  this.grid.eachCell(function (x, y, tile) {
    if (tile && tile.value > highest) {
      highest = tile.value;
    }
  });

  return highest;
};

GameManager.prototype.undoEnabled = function () {
  if (!window.multiplayerMode) {
    return !!(
      window.rinasSettings &&
      window.rinasSettings.soloUndo
    );
  }

  // Freeplay intentionally includes a forgiving single-step Undo.
  return !!(
    window.multiplayerMatchActive &&
    window.multiplayerModeName === "freeplay"
  );
};

GameManager.prototype.pushUndoState = function (state, transitions, spawnedTile) {
  if (!this.undoEnabled()) {
    return;
  }

  var entry = {
    state: state,
    transitions: Array.isArray(transitions) ? transitions : [],
    spawnedTile: spawnedTile
      ? {
          x: spawnedTile.x,
          y: spawnedTile.y,
          value: spawnedTile.value
        }
      : null
  };

  if (window.multiplayerMode && window.multiplayerModeName === "freeplay") {
    // One forward move earns one Undo. Undo consumes this entry.
    this.freeplayUndoEntry = entry;
    return;
  }

  // Solo is also single-step in v37. A new successful move replaces
  // the previous Undo point instead of building a history stack.
  this.storageManager.setUndoStack([entry]);
};

GameManager.prototype.restoreUndoEntry = function (entry, milestoneAlreadyReached) {
  var previousState = entry && entry.state
    ? entry.state
    : entry;

  if (!previousState || !previousState.grid) {
    this.undoAnimating = false;

    if (window.refreshSoloControls) {
      window.refreshSoloControls();
    }

    if (window.refreshFreeplayControls) {
      window.refreshFreeplayControls();
    }

    return false;
  }

  this.grid = new Grid(
    previousState.grid.size,
    previousState.grid.cells
  );

  var transitions = entry && Array.isArray(entry.transitions)
    ? entry.transitions
    : [];

  // Re-create the previous board with each tile starting from
  // the position it occupied AFTER the move. HTMLActuator then
  // uses the same CSS movement system as a normal forward move,
  // only in reverse. Merges naturally split because both old
  // tiles start from the merged tile's destination.
  transitions.forEach(function (transition) {
    if (!transition || !transition.from || !transition.to) {
      return;
    }

    var restoredTile = this.grid.cellContent({
      x: transition.from.x,
      y: transition.from.y
    });

    if (restoredTile) {
      restoredTile.previousPosition = {
        x: transition.to.x,
        y: transition.to.y
      };
    }
  }, this);

  this.score = previousState.score;
  this.over = previousState.over;
  this.won = previousState.won;
  this.keepPlaying = previousState.keepPlaying;

  // Milestone celebrations are achievements for the run, not
  // something Undo can farm repeatedly.
  this.soloHighestMilestone = Math.max(
    milestoneAlreadyReached,
    Number(previousState.soloHighestMilestone || 0)
  );

  if (
    window.multiplayerMode &&
    window.multiplayerMatchActive &&
    window.multiplayerModeName === "freeplay"
  ) {
    this.multiplayerMotionSerial = Number(this.multiplayerMotionSerial || 0) + 1;
    this.pendingMultiplayerMotion = {
      id: this.multiplayerMotionSerial,
      type: "undo",
      duration: 105,
      transitions: transitions.filter(function (transition) {
        return transition &&
          transition.from &&
          transition.to &&
          (
            transition.from.x !== transition.to.x ||
            transition.from.y !== transition.to.y
          );
      }).map(function (transition) {
        return {
          from: {
            x: transition.to.x,
            y: transition.to.y
          },
          to: {
            x: transition.from.x,
            y: transition.from.y
          },
          value: transition.value
        };
      }),
      removedTile: entry && entry.spawnedTile
        ? {
            x: entry.spawnedTile.x,
            y: entry.spawnedTile.y,
            value: entry.spawnedTile.value
          }
        : null,
      spawnedTile: null,
      merges: []
    };
  }

  this.actuator.continueGame();
  this.actuate();

  var self = this;

  // Original 2048 tile movement is about 100 ms. Keep the input
  // locked just long enough for the reverse motion to complete.
  window.setTimeout(function () {
    self.undoAnimating = false;

    if (window.refreshSoloControls) {
      window.refreshSoloControls();
    }

    if (window.refreshFreeplayControls) {
      window.refreshFreeplayControls();
    }
  }, 140);

  return true;
};

GameManager.prototype.undo = function () {
  if (!this.undoEnabled() || this.undoAnimating) {
    return false;
  }

  var isFreeplay = !!(
    window.multiplayerMode &&
    window.multiplayerModeName === "freeplay"
  );

  var milestoneAlreadyReached = !window.multiplayerMode
    ? Number(this.soloHighestMilestone || 0)
    : 0;

  var entry = null;

  if (isFreeplay) {
    entry = this.freeplayUndoEntry;
    this.freeplayUndoEntry = null;
  } else {
    var stack = this.storageManager.getUndoStack();

    if (stack.length) {
      entry = stack[stack.length - 1];
      this.storageManager.setUndoStack([]);
    }
  }

  if (!entry) {
    return false;
  }

  var isAnimatedEntry = !!(
    entry &&
    entry.state &&
    Array.isArray(entry.transitions)
  );

  this.undoAnimating = true;

  if (window.rinasPlaySound) {
    window.rinasPlaySound("undo");
  }

  if (window.refreshSoloControls) {
    window.refreshSoloControls();
  }

  if (window.refreshFreeplayControls) {
    window.refreshFreeplayControls();
  }

  var self = this;

  if (!isAnimatedEntry || !entry.spawnedTile) {
    return this.restoreUndoEntry(
      entry,
      milestoneAlreadyReached
    );
  }

  var positionClass =
    ".tile-position-" +
    (entry.spawnedTile.x + 1) +
    "-" +
    (entry.spawnedTile.y + 1);

  var tileContainer = document.querySelector(
    ".game-container .tile-container"
  );

  var spawnedElement = tileContainer
    ? tileContainer.querySelector(positionClass)
    : null;

  if (spawnedElement) {
    spawnedElement.classList.add("rinas-undo-removing");

    window.setTimeout(function () {
      self.restoreUndoEntry(
        entry,
        milestoneAlreadyReached
      );
    }, 70);
  } else {
    self.restoreUndoEntry(
      entry,
      milestoneAlreadyReached
    );
  }

  return true;
};

GameManager.prototype.actuate = function () {
  var highestTile = this.getHighestTileValue();

  if (!window.multiplayerMode) {
    if (this.storageManager.getBestScore() < this.score) {
      this.storageManager.setBestScore(this.score);
    }

    this.storageManager.setHighestTileEver(highestTile);
  }

  if (this.over) {
    this.storageManager.clearGameState();
  } else {
    this.storageManager.setGameState(this.serialize());
  }

  var displayBestScore = window.multiplayerMode
    ? highestTile
    : this.storageManager.getBestScore();

  var displayOver = window.multiplayerMode
    ? false
    : this.over;

  // Rina's 2048 uses game-native result states for Multiplayer,
  // Solo milestones, and Solo Game Over. Keep the original 2048
  // message layer suppressed so the board stays visible behind
  // the custom presentation.
  var displayWon = false;

  var displayTerminated = false;

  this.actuator.actuate(this.grid, {
    score: this.score,
    over: displayOver,
    won: displayWon,
    bestScore: displayBestScore,
    terminated: displayTerminated
  });

  if (!window.multiplayerMode && window.updateSoloGameplayHud) {
    window.updateSoloGameplayHud(this.score, highestTile, this.storageManager.getBestScore());
  }

  if (!window.multiplayerMode && this.over && window.showSoloGameOver) {
    window.showSoloGameOver(this.score, highestTile, this.storageManager.getBestScore());
  }

  if (
    window.multiplayerMode &&
    window.multiplayerMatchActive &&
    window.multiplayerSocket &&
    window.multiplayerPlayerNumber
  ) {
    var outboundMotion = this.pendingMultiplayerMotion;

    window.multiplayerSocket.emit("playerState", {
      grid: this.grid.serialize(),
      score: this.score,
      highestTile: highestTile,
      over: this.over,
      won: this.won,
      mode: window.multiplayerModeName || "tile-race",
      targetTile: Number(window.multiplayerTargetTile || 0),
      ownTarget: Number(window.multiplayerOwnTarget || 0),
      theme: window.rinasSettings
        ? window.rinasSettings.theme
        : "classic",
      nickname: window.rinasSettings
        ? window.rinasSettings.nickname
        : "Player",
      motion: outboundMotion
    });

    this.pendingMultiplayerMotion = null;
  }

  if (
    window.multiplayerMode &&
    window.multiplayerMatchActive &&
    window.updateMatchProgress
  ) {
    window.updateMatchProgress(highestTile, this.score);
  }

  if (window.refreshSoloControls) {
    window.refreshSoloControls();
  }

  if (window.refreshFreeplayControls) {
    window.refreshFreeplayControls();
  }
};

GameManager.prototype.serialize = function () {
  return {
    grid: this.grid.serialize(),
    score: this.score,
    over: this.over,
    won: this.won,
    keepPlaying: this.keepPlaying,
    soloHighestMilestone: Number(this.soloHighestMilestone || 0)
  };
};

GameManager.prototype.prepareTiles = function () {
  this.grid.eachCell(function (x, y, tile) {
    if (tile) {
      tile.mergedFrom = null;
      tile.savePosition();
    }
  });
};

GameManager.prototype.moveTile = function (tile, cell) {
  this.grid.cells[tile.x][tile.y] = null;
  this.grid.cells[cell.x][cell.y] = tile;
  tile.updatePosition(cell);
};

GameManager.prototype.move = function (direction) {
  var self = this;
  var soloShow2048Prompt = false;
  var soloMilestoneToast = null;
  var mergedAny = false;
  var largestMergedValue = 0;
  var mergedPositions = [];
  var freeplayBoardEnded = false;

  if (window.multiplayerGameOver || this.undoAnimating) {
    return;
  }

  if (this.isGameTerminated()) {
    return;
  }

  var stateBeforeMove = this.serialize();
  var undoTransitions = [];
  var cell;
  var tile;
  var vector = this.getVector(direction);
  var traversals = this.buildTraversals(vector);
  var moved = false;

  this.prepareTiles();

  traversals.x.forEach(function (x) {
    traversals.y.forEach(function (y) {
      cell = { x: x, y: y };
      tile = self.grid.cellContent(cell);

      if (!tile) {
        return;
      }

      var originalPosition = {
        x: tile.x,
        y: tile.y
      };

      var positions = self.findFarthestPosition(cell, vector);
      var next = self.grid.cellContent(positions.next);

      if (
        next &&
        next.value === tile.value &&
        !next.mergedFrom
      ) {
        var merged = new Tile(
          positions.next,
          tile.value * 2
        );

        mergedAny = true;
        largestMergedValue = Math.max(largestMergedValue, merged.value);
        mergedPositions.push({
          x: positions.next.x,
          y: positions.next.y,
          value: merged.value
        });

        merged.mergedFrom = [tile, next];

        self.grid.insertTile(merged);
        self.grid.removeTile(tile);

        tile.updatePosition(positions.next);

        undoTransitions.push({
          from: originalPosition,
          to: {
            x: positions.next.x,
            y: positions.next.y
          },
          value: tile.value
        });

        self.score += merged.value;

        if (window.multiplayerMode) {
          var multiplayerModeName = window.multiplayerModeName || "tile-race";

          if (multiplayerModeName !== "freeplay") {
            var targetTile = multiplayerModeName === "custom-race"
              ? Number(window.multiplayerOwnTarget || 2048)
              : Number(window.multiplayerTargetTile || 2048);

            if (merged.value >= targetTile) {
              self.won = true;

              if (
                window.multiplayerSocket &&
                window.multiplayerMatchActive
              ) {
                window.multiplayerSocket.emit("reachedTarget", {
                  tileValue: merged.value
                });
              }
            }
          }
        } else {
          // Solo is endless. 2048 is the first major milestone,
          // not the end of the run. The first 2048 gets a
          // Continue / New Game prompt; later new milestones get
          // a small non-blocking toast.
          var previousMilestone = Number(
            self.soloHighestMilestone || 0
          );

          if (
            merged.value === 2048 &&
            previousMilestone < 2048
          ) {
            self.soloHighestMilestone = 2048;
            self.won = true;
            self.keepPlaying = false;
            soloShow2048Prompt = true;
          } else if (
            merged.value >= 4096 &&
            merged.value > previousMilestone
          ) {
            self.soloHighestMilestone = merged.value;
            soloMilestoneToast = merged.value;
          }
        }
      } else {
        self.moveTile(tile, positions.farthest);

        undoTransitions.push({
          from: originalPosition,
          to: {
            x: positions.farthest.x,
            y: positions.farthest.y
          },
          value: tile.value
        });
      }

      if (!self.positionsEqual(cell, tile)) {
        moved = true;
      }
    });
  });

  if (!moved) {
    return;
  }

  var spawnedTile = this.addRandomTile();

  if (window.multiplayerMode && window.multiplayerMatchActive) {
    this.multiplayerMotionSerial = Number(this.multiplayerMotionSerial || 0) + 1;
    this.pendingMultiplayerMotion = {
      id: this.multiplayerMotionSerial,
      direction: direction,
      duration: 105,
      transitions: undoTransitions.filter(function (transition) {
        return transition &&
          transition.from &&
          transition.to &&
          (
            transition.from.x !== transition.to.x ||
            transition.from.y !== transition.to.y
          );
      }).map(function (transition) {
        return {
          from: {
            x: transition.from.x,
            y: transition.from.y
          },
          to: {
            x: transition.to.x,
            y: transition.to.y
          },
          value: transition.value
        };
      }),
      spawnedTile: spawnedTile
        ? {
            x: spawnedTile.x,
            y: spawnedTile.y,
            value: spawnedTile.value
          }
        : null,
      merges: mergedPositions.slice()
    };
  }

  this.pushUndoState(
    stateBeforeMove,
    undoTransitions,
    spawnedTile
  );

  if (!this.movesAvailable()) {
    if (window.multiplayerMode) {
      var activeMode = window.multiplayerModeName || "tile-race";

      if (activeMode === "freeplay") {
        this.over = true;
        freeplayBoardEnded = true;
      } else if (!this.won) {
        // Competitive race modes are intentionally simple. If your board
        // has no legal moves before the target, you lose the race.
        this.over = true;
        window.multiplayerGameOver = true;

        if (
          window.multiplayerSocket &&
          window.multiplayerMatchActive
        ) {
          window.multiplayerSocket.emit("playerEliminated");
        }
      }
    } else if (!soloShow2048Prompt) {
      this.over = true;

      if (window.rinasPlaySound) {
        window.rinasPlaySound("lose");
      }
    }
  }

  this.actuate();

  if (window.rinasPlaySound && !(this.over && !window.multiplayerMode) && !soloShow2048Prompt) {
    if (mergedAny) {
      window.rinasPlaySound(largestMergedValue >= 128 ? "large-merge" : "merge");
    } else {
      window.rinasPlaySound("move");
    }
  }

  if (freeplayBoardEnded && window.showFreeplayBoardOver) {
    window.showFreeplayBoardOver();
  }

  if (soloShow2048Prompt && window.showSolo2048Milestone) {
    window.showSolo2048Milestone();
  } else if (soloMilestoneToast && window.showSoloMilestoneToast) {
    window.showSoloMilestoneToast(soloMilestoneToast);
  }
};

GameManager.prototype.getVector = function (direction) {
  var map = {
    0: { x: 0, y: -1 },
    1: { x: 1, y: 0 },
    2: { x: 0, y: 1 },
    3: { x: -1, y: 0 }
  };

  return map[direction];
};

GameManager.prototype.buildTraversals = function (vector) {
  var traversals = { x: [], y: [] };

  for (var position = 0; position < this.size; position++) {
    traversals.x.push(position);
    traversals.y.push(position);
  }

  if (vector.x === 1) {
    traversals.x = traversals.x.reverse();
  }

  if (vector.y === 1) {
    traversals.y = traversals.y.reverse();
  }

  return traversals;
};

GameManager.prototype.findFarthestPosition = function (cell, vector) {
  var previous;

  do {
    previous = cell;
    cell = {
      x: previous.x + vector.x,
      y: previous.y + vector.y
    };
  } while (
    this.grid.withinBounds(cell) &&
    this.grid.cellAvailable(cell)
  );

  return {
    farthest: previous,
    next: cell
  };
};

GameManager.prototype.movesAvailable = function () {
  return this.grid.cellsAvailable() || this.tileMatchesAvailable();
};

GameManager.prototype.tileMatchesAvailable = function () {
  var self = this;
  var tile;

  for (var x = 0; x < this.size; x++) {
    for (var y = 0; y < this.size; y++) {
      tile = this.grid.cellContent({ x: x, y: y });

      if (!tile) {
        continue;
      }

      for (var direction = 0; direction < 4; direction++) {
        var vector = self.getVector(direction);
        var cell = {
          x: x + vector.x,
          y: y + vector.y
        };

        var other = self.grid.cellContent(cell);

        if (other && other.value === tile.value) {
          return true;
        }
      }
    }
  }

  return false;
};

GameManager.prototype.positionsEqual = function (first, second) {
  return first.x === second.x && first.y === second.y;
};

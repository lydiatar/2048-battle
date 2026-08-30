function GameManager(size, InputManager, Actuator, StorageManager) {
  this.size = size;
  this.inputManager = new InputManager;
  this.storageManager = new StorageManager;
  this.actuator = new Actuator;
  this.startTiles = 2;

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
  this.actuator.continueGame();
  this.setup();
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
  }
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

GameManager.prototype.useSecondChance = function () {
  var lowestValue = Infinity;
  var candidates = [];

  this.grid.eachCell(function (x, y, tile) {
    if (!tile) {
      return;
    }

    if (tile.value < lowestValue) {
      lowestValue = tile.value;
      candidates = [tile];
    } else if (tile.value === lowestValue) {
      candidates.push(tile);
    }
  });

  if (!candidates.length) {
    return null;
  }

  var tileToRemove = candidates[
    Math.floor(Math.random() * candidates.length)
  ];

  var removedValue = tileToRemove.value;

  this.grid.removeTile(tileToRemove);

  return removedValue;
};

GameManager.prototype.soloUndoEnabled = function () {
  return !!(
    !window.multiplayerMode &&
    window.rinasSettings &&
    window.rinasSettings.soloUndo
  );
};

GameManager.prototype.pushUndoState = function (state) {
  if (!this.soloUndoEnabled()) {
    return;
  }

  var stack = this.storageManager.getUndoStack();
  stack.push(state);
  this.storageManager.setUndoStack(stack);
};

GameManager.prototype.undo = function () {
  if (!this.soloUndoEnabled()) {
    return false;
  }

  var milestoneAlreadyReached = Number(
    this.soloHighestMilestone || 0
  );

  var stack = this.storageManager.getUndoStack();

  if (!stack.length) {
    return false;
  }

  var previousState = stack.pop();

  this.storageManager.setUndoStack(stack);

  this.grid = new Grid(
    previousState.grid.size,
    previousState.grid.cells
  );

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

  this.actuator.continueGame();
  this.actuate();

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

  // Multiplayer has its own result modal. Solo also uses a
  // custom 2048 milestone dialog, so the original 2048 win
  // overlay is suppressed. The original Game Over overlay is
  // still used for an actual Solo loss.
  var displayWon = false;

  var displayTerminated = window.multiplayerMode
    ? false
    : this.over;

  this.actuator.actuate(this.grid, {
    score: this.score,
    over: displayOver,
    won: displayWon,
    bestScore: displayBestScore,
    terminated: displayTerminated
  });

  if (
    window.multiplayerMode &&
    window.multiplayerMatchActive &&
    window.multiplayerSocket &&
    window.multiplayerPlayerNumber
  ) {
    window.multiplayerSocket.emit("playerState", {
      grid: this.grid.serialize(),
      score: this.score,
      highestTile: highestTile,
      over: this.over,
      won: this.won,
      secondChanceUsed: !!window.multiplayerSecondChanceUsed,
      targetTile: Number(window.multiplayerTargetTile || 2048),
      theme: window.rinasSettings
        ? window.rinasSettings.theme
        : "classic"
    });
  }

  if (window.refreshSoloControls) {
    window.refreshSoloControls();
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

  if (window.multiplayerGameOver) {
    return;
  }

  if (this.isGameTerminated()) {
    return;
  }

  var stateBeforeMove = this.serialize();
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

        merged.mergedFrom = [tile, next];

        self.grid.insertTile(merged);
        self.grid.removeTile(tile);

        tile.updatePosition(positions.next);

        self.score += merged.value;

        if (window.multiplayerMode) {
          var targetTile = Number(
            window.multiplayerTargetTile || 2048
          );

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
      }

      if (!self.positionsEqual(cell, tile)) {
        moved = true;
      }
    });
  });

  if (!moved) {
    return;
  }

  if (!window.multiplayerMode) {
    this.pushUndoState(stateBeforeMove);
  }

  this.addRandomTile();

  if (!this.movesAvailable()) {
    if (window.multiplayerMode) {
      // A player who already hit the multiplayer target has
      // finished the race, so elimination no longer matters.
      if (!this.won) {
        if (!window.multiplayerSecondChanceUsed) {
          window.multiplayerSecondChanceUsed = true;

          var removedValue = this.useSecondChance();

          this.over = false;

          if (window.showSecondChanceUsed) {
            window.showSecondChanceUsed(removedValue);
          }
        } else {
          this.over = true;
          window.multiplayerGameOver = true;

          if (
            window.multiplayerSocket &&
            window.multiplayerMatchActive
          ) {
            window.multiplayerSocket.emit("playerEliminated");
          }
        }
      }
    } else if (!soloShow2048Prompt) {
      // Solo remains endless after 2048, but it can still end
      // normally when the board has no legal moves. If this is
      // the exact move that first made 2048, let the milestone
      // dialog appear first; Continue will re-check the board.
      this.over = true;
    }
  }

  this.actuate();

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

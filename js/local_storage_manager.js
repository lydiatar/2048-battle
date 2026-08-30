window.fakeStorage = {
  _data: {},

  setItem: function (id, val) {
    return (this._data[id] = String(val));
  },

  getItem: function (id) {
    return this._data.hasOwnProperty(id)
      ? this._data[id]
      : undefined;
  },

  removeItem: function (id) {
    return delete this._data[id];
  },

  clear: function () {
    this._data = {};
  }
};

function LocalStorageManager() {
  this.bestScoreKey = "rinas2048.solo.bestScore";
  this.gameStateKey = "rinas2048.solo.gameState";
  this.undoStackKey = "rinas2048.solo.undoStack";
  this.highestTileEverKey = "rinas2048.solo.highestTileEver";

  this.legacyBestScoreKey = "bestScore";
  this.legacyGameStateKey = "gameState";

  var supported = this.localStorageSupported();

  this.storage = supported
    ? window.localStorage
    : window.fakeStorage;
}

LocalStorageManager.prototype.localStorageSupported = function () {
  var testKey = "test";

  try {
    var storage = window.localStorage;
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return true;
  } catch (error) {
    return false;
  }
};

LocalStorageManager.prototype.isMultiplayer = function () {
  return !!window.multiplayerMode;
};

LocalStorageManager.prototype.getBestScore = function () {
  if (this.isMultiplayer()) {
    return 0;
  }

  var saved = Number(this.storage.getItem(this.bestScoreKey) || 0);
  var legacy = Number(this.storage.getItem(this.legacyBestScoreKey) || 0);

  return Math.max(saved, legacy);
};

LocalStorageManager.prototype.setBestScore = function (score) {
  if (this.isMultiplayer()) {
    return;
  }

  this.storage.setItem(this.bestScoreKey, score);
};

LocalStorageManager.prototype.getGameState = function () {
  if (this.isMultiplayer()) {
    return null;
  }

  var stateJSON = this.storage.getItem(this.gameStateKey);

  if (!stateJSON) {
    stateJSON = this.storage.getItem(this.legacyGameStateKey);
  }

  if (!stateJSON) {
    return null;
  }

  try {
    return JSON.parse(stateJSON);
  } catch (error) {
    return null;
  }
};

LocalStorageManager.prototype.hasGameState = function () {
  return !!this.getGameState();
};

LocalStorageManager.prototype.setGameState = function (gameState) {
  if (this.isMultiplayer()) {
    return;
  }

  this.storage.setItem(
    this.gameStateKey,
    JSON.stringify(gameState)
  );
};

LocalStorageManager.prototype.clearGameState = function () {
  if (this.isMultiplayer()) {
    return;
  }

  this.storage.removeItem(this.gameStateKey);
  this.storage.removeItem(this.legacyGameStateKey);
};

LocalStorageManager.prototype.getUndoStack = function () {
  if (this.isMultiplayer()) {
    return [];
  }

  var stackJSON = this.storage.getItem(this.undoStackKey);

  if (!stackJSON) {
    return [];
  }

  try {
    var stack = JSON.parse(stackJSON);
    return Array.isArray(stack) ? stack : [];
  } catch (error) {
    return [];
  }
};

LocalStorageManager.prototype.setUndoStack = function (stack) {
  if (this.isMultiplayer()) {
    return;
  }

  var safeStack = Array.isArray(stack) ? stack.slice() : [];

  try {
    this.storage.setItem(
      this.undoStackKey,
      JSON.stringify(safeStack)
    );
  } catch (error) {
    // If browser storage fills up, trim the oldest history and retry.
    while (safeStack.length > 50) {
      safeStack.splice(0, 50);

      try {
        this.storage.setItem(
          this.undoStackKey,
          JSON.stringify(safeStack)
        );
        return;
      } catch (retryError) {
        // Keep trimming until it fits.
      }
    }
  }
};

LocalStorageManager.prototype.clearUndoStack = function () {
  if (this.isMultiplayer()) {
    return;
  }

  this.storage.removeItem(this.undoStackKey);
};

LocalStorageManager.prototype.getHighestTileEver = function () {
  if (this.isMultiplayer()) {
    return 0;
  }

  return Number(
    this.storage.getItem(this.highestTileEverKey) || 0
  );
};

LocalStorageManager.prototype.setHighestTileEver = function (value) {
  if (this.isMultiplayer()) {
    return;
  }

  var current = this.getHighestTileEver();

  if (value > current) {
    this.storage.setItem(this.highestTileEverKey, value);
  }
};

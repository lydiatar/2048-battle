window.fakeStorage = {
  _data: {},

  setItem: function (id, val) {
    return this._data[id] = String(val);
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
  this.bestScoreKey = "bestScore";
  this.gameStateKey = "gameState";

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


// -------------------------
// BEST SCORE
// -------------------------

LocalStorageManager.prototype.getBestScore = function () {
  // Multiplayer always starts with a fresh best score.
  if (window.multiplayerMode) {
    return 0;
  }

  return this.storage.getItem(this.bestScoreKey) || 0;
};


LocalStorageManager.prototype.setBestScore = function (score) {
  // Don't save multiplayer scores as permanent best scores.
  if (window.multiplayerMode) {
    return;
  }

  this.storage.setItem(this.bestScoreKey, score);
};


// -------------------------
// GAME STATE
// -------------------------

LocalStorageManager.prototype.getGameState = function () {
  // Multiplayer games always start fresh.
  if (window.multiplayerMode) {
    return null;
  }

  var stateJSON =
    this.storage.getItem(this.gameStateKey);

  return stateJSON
    ? JSON.parse(stateJSON)
    : null;
};


LocalStorageManager.prototype.setGameState = function (gameState) {
  // Multiplayer state does not need to persist across page reloads.
  if (window.multiplayerMode) {
    return;
  }

  this.storage.setItem(
    this.gameStateKey,
    JSON.stringify(gameState)
  );
};


LocalStorageManager.prototype.clearGameState = function () {
  this.storage.removeItem(this.gameStateKey);
};

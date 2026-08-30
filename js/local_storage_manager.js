window.fakeStorage = {
  _data: {},

  setItem: function (
    id,
    val
  ) {

    return (
      this._data[id] =
        String(val)
    );
  },


  getItem: function (
    id
  ) {

    return (
      this._data.hasOwnProperty(id)
        ? this._data[id]
        : undefined
    );
  },


  removeItem: function (
    id
  ) {

    return delete
      this._data[id];
  },


  clear: function () {

    this._data =
      {};
  }
};


function LocalStorageManager() {

  this.bestScoreKey =
    "bestScore";


  this.gameStateKey =
    "gameState";


  var supported =
    this.localStorageSupported();


  this.storage =
    supported

      ? window.localStorage

      : window.fakeStorage;
}


LocalStorageManager.prototype.localStorageSupported =
  function () {

    var testKey =
      "test";


    try {

      var storage =
        window.localStorage;


      storage.setItem(
        testKey,
        "1"
      );


      storage.removeItem(
        testKey
      );


      return true;

    } catch (
      error
    ) {

      return false;
    }
  };


LocalStorageManager.prototype.getBestScore =
  function () {

    if (
      window.multiplayerMode
    ) {

      return 0;
    }


    return (
      this.storage.getItem(
        this.bestScoreKey
      ) || 0
    );
  };


LocalStorageManager.prototype.setBestScore =
  function (
    score
  ) {

    if (
      window.multiplayerMode
    ) {
      return;
    }


    this.storage.setItem(
      this.bestScoreKey,
      score
    );
  };


LocalStorageManager.prototype.getGameState =
  function () {

    if (
      window.multiplayerMode
    ) {

      return null;
    }


    var stateJSON =
      this.storage.getItem(
        this.gameStateKey
      );


    return stateJSON

      ? JSON.parse(
          stateJSON
        )

      : null;
  };


LocalStorageManager.prototype.setGameState =
  function (
    gameState
  ) {

    if (
      window.multiplayerMode
    ) {
      return;
    }


    this.storage.setItem(

      this.gameStateKey,

      JSON.stringify(
        gameState
      )
    );
  };


LocalStorageManager.prototype.clearGameState =
  function () {

    this.storage.removeItem(
      this.gameStateKey
    );
  };

function GameManager(
  size,
  InputManager,
  Actuator,
  StorageManager
) {
  this.size = size;

  this.inputManager =
    new InputManager;

  this.storageManager =
    new StorageManager;

  this.actuator =
    new Actuator;

  this.startTiles = 2;

  this.inputManager.on(
    "move",
    this.move.bind(this)
  );

  this.inputManager.on(
    "restart",
    this.restart.bind(this)
  );

  this.inputManager.on(
    "keepPlaying",
    this.keepPlaying.bind(this)
  );

  this.setup();
}


// =========================================================
// RESTART
// =========================================================

GameManager.prototype.restart =
  function () {

    if (
      window.multiplayerMode &&
      !window.multiplayerAllowRestart
    ) {
      return;
    }

    this.storageManager
      .clearGameState();

    this.actuator
      .continueGame();

    this.setup();
  };


// =========================================================
// KEEP PLAYING
// =========================================================

GameManager.prototype.keepPlaying =
  function () {

    this.keepPlaying = true;

    this.actuator
      .continueGame();
  };


// =========================================================
// TERMINATION
// =========================================================

GameManager.prototype.isGameTerminated =
  function () {

    return (
      this.over ||
      (
        this.won &&
        !this.keepPlaying
      )
    );
  };


// =========================================================
// SETUP
// =========================================================

GameManager.prototype.setup =
  function () {

    var previousState =
      this.storageManager
        .getGameState();

    if (previousState) {

      this.grid =
        new Grid(
          previousState.grid.size,
          previousState.grid.cells
        );

      this.score =
        previousState.score;

      this.over =
        previousState.over;

      this.won =
        previousState.won;

      this.keepPlaying =
        previousState.keepPlaying;

    } else {

      this.grid =
        new Grid(this.size);

      this.score = 0;

      this.over = false;

      this.won = false;

      this.keepPlaying = false;

      this.addStartTiles();
    }

    this.actuate();
  };


// =========================================================
// STARTING TILES
// =========================================================

GameManager.prototype.addStartTiles =
  function () {

    for (
      var i = 0;
      i < this.startTiles;
      i++
    ) {
      this.addRandomTile();
    }
  };


// =========================================================
// RANDOM TILE
// =========================================================

GameManager.prototype.addRandomTile =
  function () {

    if (
      this.grid.cellsAvailable()
    ) {

      var value =
        Math.random() < 0.9
          ? 2
          : 4;

      var tile =
        new Tile(
          this.grid.randomAvailableCell(),
          value
        );

      this.grid.insertTile(
        tile
      );
    }
  };


// =========================================================
// HIGHEST TILE
// =========================================================

GameManager.prototype.getHighestTileValue =
  function () {

    var highest = 0;

    this.grid.eachCell(
      function (x, y, tile) {

        if (
          tile &&
          tile.value > highest
        ) {
          highest =
            tile.value;
        }
      }
    );

    return highest;
  };


// =========================================================
// SECOND CHANCE
// =========================================================

GameManager.prototype.useSecondChance =
  function () {

    var lowestValue =
      Infinity;

    var candidates =
      [];

    this.grid.eachCell(
      function (x, y, tile) {

        if (!tile) {
          return;
        }

        if (
          tile.value <
          lowestValue
        ) {

          lowestValue =
            tile.value;

          candidates =
            [tile];

        } else if (
          tile.value ===
          lowestValue
        ) {

          candidates.push(
            tile
          );
        }
      }
    );

    if (
      !candidates.length
    ) {
      return null;
    }

    var tileToRemove =
      candidates[
        Math.floor(
          Math.random() *
          candidates.length
        )
      ];

    var removedValue =
      tileToRemove.value;

    this.grid.removeTile(
      tileToRemove
    );

    return removedValue;
  };


// =========================================================
// ACTUATE
// =========================================================

GameManager.prototype.actuate =
  function () {

    if (
      this.storageManager
        .getBestScore() <
      this.score
    ) {

      this.storageManager
        .setBestScore(
          this.score
        );
    }

    if (this.over) {

      this.storageManager
        .clearGameState();

    } else {

      this.storageManager
        .setGameState(
          this.serialize()
        );
    }

    var displayBestScore =
      window.multiplayerMode
        ? this.getHighestTileValue()
        : this.storageManager
            .getBestScore();


    /*
     * In multiplayer we DO NOT
     * use the original 2048
     * Game Over / Try Again overlay.
     *
     * Our multiplayer popup handles
     * wins and losses instead.
     */

    var displayOver =
      window.multiplayerMode
        ? false
        : this.over;

    var displayWon =
      window.multiplayerMode
        ? false
        : this.won;

    var displayTerminated =
      window.multiplayerMode
        ? false
        : this.isGameTerminated();


    this.actuator.actuate(
      this.grid,
      {
        score:
          this.score,

        over:
          displayOver,

        won:
          displayWon,

        bestScore:
          displayBestScore,

        terminated:
          displayTerminated
      }
    );


    /*
     * Send latest board to opponent.
     */

    if (
      window.multiplayerSocket &&
      window.multiplayerPlayerNumber
    ) {

      window.multiplayerSocket.emit(
        "playerState",
        {
          grid:
            this.grid.serialize(),

          score:
            this.score,

          highestTile:
            this.getHighestTileValue(),

          over:
            this.over,

          won:
            this.won,

          secondChanceUsed:
            !!window.multiplayerSecondChanceUsed
        }
      );
    }
  };


// =========================================================
// SERIALIZE
// =========================================================

GameManager.prototype.serialize =
  function () {

    return {
      grid:
        this.grid.serialize(),

      score:
        this.score,

      over:
        this.over,

      won:
        this.won,

      keepPlaying:
        this.keepPlaying
    };
  };


// =========================================================
// PREPARE TILES
// =========================================================

GameManager.prototype.prepareTiles =
  function () {

    this.grid.eachCell(
      function (
        x,
        y,
        tile
      ) {

        if (tile) {

          tile.mergedFrom =
            null;

          tile.savePosition();
        }
      }
    );
  };


// =========================================================
// MOVE TILE
// =========================================================

GameManager.prototype.moveTile =
  function (
    tile,
    cell
  ) {

    this.grid.cells[
      tile.x
    ][
      tile.y
    ] = null;


    this.grid.cells[
      cell.x
    ][
      cell.y
    ] = tile;


    tile.updatePosition(
      cell
    );
  };


// =========================================================
// MOVE
// =========================================================

GameManager.prototype.move =
  function (
    direction
  ) {

    /*
     * 0 = Up
     * 1 = Right
     * 2 = Down
     * 3 = Left
     */

    var self = this;


    if (
      window.multiplayerGameOver
    ) {
      return;
    }


    if (
      this.isGameTerminated()
    ) {
      return;
    }


    var cell;
    var tile;


    var vector =
      this.getVector(
        direction
      );


    var traversals =
      this.buildTraversals(
        vector
      );


    var moved =
      false;


    this.prepareTiles();


    traversals.x.forEach(
      function (x) {

        traversals.y.forEach(
          function (y) {

            cell = {
              x: x,
              y: y
            };


            tile =
              self.grid
                .cellContent(
                  cell
                );


            if (!tile) {
              return;
            }


            var positions =
              self
                .findFarthestPosition(
                  cell,
                  vector
                );


            var next =
              self.grid
                .cellContent(
                  positions.next
                );


            if (
              next &&
              next.value ===
                tile.value &&
              !next.mergedFrom
            ) {

              var merged =
                new Tile(
                  positions.next,
                  tile.value * 2
                );


              merged.mergedFrom =
                [
                  tile,
                  next
                ];


              self.grid
                .insertTile(
                  merged
                );


              self.grid
                .removeTile(
                  tile
                );


              tile.updatePosition(
                positions.next
              );


              self.score +=
                merged.value;


              /*
               * FIRST TO 2048 WINS
               */

              if (
                merged.value ===
                2048
              ) {

                self.won =
                  true;


                if (
                  window.multiplayerMode &&
                  window.multiplayerSocket &&
                  window.multiplayerPlayerNumber
                ) {

                  window
                    .multiplayerSocket
                    .emit(
                      "reached2048"
                    );
                }
              }

            } else {

              self.moveTile(
                tile,
                positions.farthest
              );
            }


            if (
              !self.positionsEqual(
                cell,
                tile
              )
            ) {

              moved =
                true;
            }
          }
        );
      }
    );


    if (!moved) {
      return;
    }


    /*
     * Successful move:
     * spawn new tile.
     */

    this.addRandomTile();


    /*
     * Reaching 2048 wins even if
     * this same move would otherwise
     * leave no legal moves.
     */

    if (
      !this.won &&
      !this.movesAvailable()
    ) {

      if (
        window.multiplayerMode
      ) {

        /*
         * FIRST DEATH:
         * consume Second Chance.
         */

        if (
          !window.multiplayerSecondChanceUsed
        ) {

          window.multiplayerSecondChanceUsed =
            true;


          var removedValue =
            this.useSecondChance();


          this.over =
            false;


          if (
            window.showSecondChanceUsed
          ) {

            window
              .showSecondChanceUsed(
                removedValue
              );
          }


        /*
         * SECOND DEATH:
         * eliminated.
         */

        } else {

          this.over =
            true;


          window.multiplayerGameOver =
            true;


          if (
            window.multiplayerSocket
          ) {

            window
              .multiplayerSocket
              .emit(
                "playerEliminated"
              );
          }
        }

      } else {

        /*
         * Normal single-player
         * game over.
         */

        this.over =
          true;
      }
    }


    this.actuate();
  };


// =========================================================
// DIRECTION VECTOR
// =========================================================

GameManager.prototype.getVector =
  function (
    direction
  ) {

    var map = {

      0: {
        x: 0,
        y: -1
      },

      1: {
        x: 1,
        y: 0
      },

      2: {
        x: 0,
        y: 1
      },

      3: {
        x: -1,
        y: 0
      }
    };

    return map[
      direction
    ];
  };


// =========================================================
// TRAVERSALS
// =========================================================

GameManager.prototype.buildTraversals =
  function (
    vector
  ) {

    var traversals = {
      x: [],
      y: []
    };


    for (
      var position = 0;
      position < this.size;
      position++
    ) {

      traversals.x.push(
        position
      );

      traversals.y.push(
        position
      );
    }


    if (
      vector.x === 1
    ) {

      traversals.x
        .reverse();
    }


    if (
      vector.y === 1
    ) {

      traversals.y
        .reverse();
    }


    return traversals;
  };


// =========================================================
// FARTHEST POSITION
// =========================================================

GameManager.prototype.findFarthestPosition =
  function (
    cell,
    vector
  ) {

    var previous;


    do {

      previous =
        cell;


      cell = {

        x:
          previous.x +
          vector.x,

        y:
          previous.y +
          vector.y
      };

    } while (

      this.grid
        .withinBounds(
          cell
        ) &&

      this.grid
        .cellAvailable(
          cell
        )
    );


    return {
      farthest:
        previous,

      next:
        cell
    };
  };


// =========================================================
// MOVES AVAILABLE
// =========================================================

GameManager.prototype.movesAvailable =
  function () {

    return (
      this.grid
        .cellsAvailable() ||

      this
        .tileMatchesAvailable()
    );
  };


// =========================================================
// TILE MATCHES AVAILABLE
// =========================================================

GameManager.prototype.tileMatchesAvailable =
  function () {

    var self =
      this;

    var tile;


    for (
      var x = 0;
      x < this.size;
      x++
    ) {

      for (
        var y = 0;
        y < this.size;
        y++
      ) {

        tile =
          this.grid
            .cellContent({
              x: x,
              y: y
            });


        if (!tile) {
          continue;
        }


        for (
          var direction = 0;
          direction < 4;
          direction++
        ) {

          var vector =
            self.getVector(
              direction
            );


          var cell = {

            x:
              x +
              vector.x,

            y:
              y +
              vector.y
          };


          var other =
            self.grid
              .cellContent(
                cell
              );


          if (
            other &&
            other.value ===
              tile.value
          ) {

            return true;
          }
        }
      }
    }


    return false;
  };


// =========================================================
// POSITIONS EQUAL
// =========================================================

GameManager.prototype.positionsEqual =
  function (
    first,
    second
  ) {

    return (
      first.x ===
        second.x &&

      first.y ===
        second.y
    );
  };

// Wait till the browser is ready to render the game.
window.requestAnimationFrame(
  function () {

    window.multiplayerGame =
      new GameManager(
        4,
        KeyboardInputManager,
        HTMLActuator,
        LocalStorageManager
      );
  }
);

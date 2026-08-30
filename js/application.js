window.currentGameMode = "menu";
window.multiplayerMatchActive = false;
window.multiplayerGameOver = false;
window.multiplayerAllowRestart = false;
window.multiplayerSecondChanceUsed = false;
window.multiplayerTargetTile = 2048;
window.multiplayerProfiles = [];

// Boot the hidden game engine without reading or overwriting Solo saves.
window.multiplayerMode = true;

window.requestAnimationFrame(function () {
  window.multiplayerGame = new GameManager(
    4,
    KeyboardInputManager,
    HTMLActuator,
    LocalStorageManager
  );

  window.multiplayerMode = false;
});

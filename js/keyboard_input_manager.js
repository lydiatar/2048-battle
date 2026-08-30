function KeyboardInputManager() {
  this.events = {};
  this.listen();
}

KeyboardInputManager.prototype.on = function (event, callback) {
  if (!this.events[event]) {
    this.events[event] = [];
  }

  this.events[event].push(callback);
};

KeyboardInputManager.prototype.emit = function (event, data) {
  var callbacks = this.events[event];

  if (callbacks) {
    callbacks.forEach(function (callback) {
      callback(data);
    });
  }
};

KeyboardInputManager.prototype.isTypingTarget = function (target) {
  if (!target) {
    return false;
  }

  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
};

KeyboardInputManager.prototype.getControlScheme = function () {
  if (
    window.rinasSettings &&
    window.rinasSettings.controlScheme === "wasd"
  ) {
    return "wasd";
  }

  return "arrows";
};

KeyboardInputManager.prototype.listen = function () {
  var self = this;

  var arrowMap = {
    38: 0, // Up
    39: 1, // Right
    40: 2, // Down
    37: 3  // Left
  };

  var wasdMap = {
    87: 0, // W
    68: 1, // D
    83: 2, // S
    65: 3  // A
  };

  document.addEventListener("keydown", function (event) {
    if (self.isTypingTarget(event.target)) {
      return;
    }

    if (
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) {
      return;
    }

    var scheme = self.getControlScheme();
    var mapped = scheme === "wasd"
      ? wasdMap[event.which || event.keyCode]
      : arrowMap[event.which || event.keyCode];

    if (mapped !== undefined) {
      event.preventDefault();
      self.emit("move", mapped);
      return;
    }

  });

  this.eventTouchstart = "touchstart";
  this.eventTouchmove = "touchmove";
  this.eventTouchend = "touchend";

  var gameContainer = document.getElementsByClassName("game-container")[0];

  if (gameContainer) {
    gameContainer.addEventListener(this.eventTouchstart, this.touchStart.bind(this));
    gameContainer.addEventListener(this.eventTouchmove, this.touchMove.bind(this));
    gameContainer.addEventListener(this.eventTouchend, this.touchEnd.bind(this));
  }

  this.bindButtonPress(".retry-button", this.restart);
  this.bindButtonPress(".restart-button", this.restart);
  this.bindButtonPress(".keep-playing-button", this.keepPlaying);
};

KeyboardInputManager.prototype.restart = function (event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  this.emit("restart");
};

KeyboardInputManager.prototype.keepPlaying = function (event) {
  if (event && event.preventDefault) {
    event.preventDefault();
  }

  this.emit("keepPlaying");
};

KeyboardInputManager.prototype.bindButtonPress = function (selector, fn) {
  var button = document.querySelector(selector);

  if (!button) {
    return;
  }

  button.addEventListener("click", fn.bind(this));
  button.addEventListener("touchend", fn.bind(this));
};

KeyboardInputManager.prototype.touchStart = function (event) {
  if (event.touches.length > 1) {
    return;
  }

  this.touchStartClientX = event.touches[0].clientX;
  this.touchStartClientY = event.touches[0].clientY;
  event.preventDefault();
};

KeyboardInputManager.prototype.touchMove = function (event) {
  event.preventDefault();
};

KeyboardInputManager.prototype.touchEnd = function (event) {
  if (event.touches.length > 0) {
    return;
  }

  var dx = event.changedTouches[0].clientX - this.touchStartClientX;
  var absDx = Math.abs(dx);
  var dy = event.changedTouches[0].clientY - this.touchStartClientY;
  var absDy = Math.abs(dy);

  if (Math.max(absDx, absDy) > 10) {
    this.emit("move", absDx > absDy
      ? (dx > 0 ? 1 : 3)
      : (dy > 0 ? 2 : 0)
    );
  }
};

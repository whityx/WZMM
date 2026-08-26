const SplashManager = {
  container: null,
  progressBar: null,
  statusText: null,
  percentText: null,
  skipBtn: null,
  isDismissed: false,
  onSkipCallback: null,
  _keydownHandler: null,

  init(containerEl, onSkip) {
    this.container = containerEl || document.getElementById("splash-screen");
    if (!this.container) return;

    this.progressBar = this.container.querySelector("#splash-progress-bar");
    this.statusText = this.container.querySelector("#splash-status");
    this.percentText = this.container.querySelector("#splash-percent");
    this.skipBtn = this.container.querySelector("#splash-skip-btn");
    this.onSkipCallback = onSkip;

    if (this.skipBtn) {
      this.skipBtn.addEventListener("click", () => {
        this.triggerSkip();
      });
    }

    this._keydownHandler = (e) => {
      if (e.key === "Escape" && !this.isDismissed) {
        this.triggerSkip();
      }
    };
    window.addEventListener("keydown", this._keydownHandler);
  },

  triggerSkip() {
    this.hide();
    if (typeof this.onSkipCallback === "function") {
      this.onSkipCallback();
    }
  },

  setProgress(percent, message) {
    if (this.isDismissed) return;

    if (!this.progressBar && this.container) {
      this.progressBar = this.container.querySelector("#splash-progress-bar");
    }
    if (!this.statusText && this.container) {
      this.statusText = this.container.querySelector("#splash-status");
    }
    if (!this.percentText && this.container) {
      this.percentText = this.container.querySelector("#splash-percent");
    }

    const clamped = Math.min(100, Math.max(0, percent));

    if (this.progressBar) {
      this.progressBar.style.width = `${clamped}%`;
    }
    if (this.percentText) {
      this.percentText.textContent = `${Math.round(clamped)}%`;
    }
    if (this.statusText && message) {
      this.statusText.textContent = message;
    }
  },

  finish(delayMs = 380) {
    if (this.isDismissed) return;
    this.setProgress(100);
    setTimeout(() => {
      this.hide();
    }, delayMs);
  },

  hide() {
    if (this.isDismissed) return;
    this.isDismissed = true;

    if (this._keydownHandler) {
      window.removeEventListener("keydown", this._keydownHandler);
      this._keydownHandler = null;
    }

    if (this.container) {
      this.container.classList.add("hidden");
      setTimeout(() => {
        if (this.container && this.container.parentNode) {
          this.container.parentNode.removeChild(this.container);
        }
      }, 550);
    }
  },
};

if (typeof window !== "undefined") {
  window.SplashManager = SplashManager;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = SplashManager;
}

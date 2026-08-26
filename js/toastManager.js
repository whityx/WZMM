(function () {
  const ICONS = {
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="16 9 10 15 7 12"></polyline></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`
  };

  class DynamicIslandToastManager {
    constructor() {
      this.sidebar = null;
      this.islandEl = null;
      this.timerId = null;
      this.remainingTime = 0;
      this.startTime = 0;
      this.currentDuration = 3500;
    }

    _initIsland() {
      this.sidebar = document.querySelector(".sidebar");
      if (!this.sidebar) return null;

      this.islandEl = document.getElementById("sidebar-island-notification");
      if (!this.islandEl) {
        this.islandEl = document.createElement("div");
        this.islandEl.id = "sidebar-island-notification";
        this.islandEl.className = "sidebar-island-notification";
        this.islandEl.innerHTML = `
          <div class="island-toast-icon" id="island-toast-icon"></div>
          <div class="island-toast-body">
            <span class="island-toast-title" id="island-toast-title"></span>
            <span class="island-toast-divider" id="island-toast-divider"></span>
            <span class="island-toast-message" id="island-toast-message"></span>
          </div>
          <button class="island-toast-close" id="island-toast-close" title="Close">
            ${ICONS.close}
          </button>
          <div class="island-toast-progress" id="island-toast-progress"></div>
        `;
        this.sidebar.appendChild(this.islandEl);

        const closeBtn = this.islandEl.querySelector("#island-toast-close");
        closeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.dismiss();
        });

        this.islandEl.addEventListener("mouseenter", () => this._pauseTimer());
        this.islandEl.addEventListener("mouseleave", () => this._resumeTimer());
      }
      return this.islandEl;
    }

    show(options) {
      if (typeof options === "string") {
        options = { message: options };
      }

      const {
        title = "",
        message = "",
        type = "info",
        duration = 3500,
        customIcon = null
      } = options;

      const island = this._initIsland();
      if (!island || !this.sidebar) return;

      const iconContainer = island.querySelector("#island-toast-icon");
      const titleEl = island.querySelector("#island-toast-title");
      const dividerEl = island.querySelector("#island-toast-divider");
      const msgEl = island.querySelector("#island-toast-message");
      const progressEl = island.querySelector("#island-toast-progress");

      iconContainer.innerHTML = customIcon || ICONS[type] || ICONS.info;

      if (title && message) {
        titleEl.textContent = title;
        titleEl.style.display = "inline";
        dividerEl.style.display = "inline-block";
        msgEl.textContent = message;
      } else if (title) {
        titleEl.textContent = title;
        titleEl.style.display = "inline";
        dividerEl.style.display = "none";
        msgEl.textContent = "";
      } else {
        titleEl.textContent = "";
        titleEl.style.display = "none";
        dividerEl.style.display = "none";
        msgEl.textContent = message;
      }

      this.currentDuration = duration;
      this.remainingTime = duration;

      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }

      if (progressEl) {
        progressEl.style.transition = "none";
        progressEl.style.transform = "scaleX(1)";
        if (duration > 0) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              progressEl.style.transition = `transform ${duration}ms linear`;
              progressEl.style.transform = "scaleX(0)";
            });
          });
        }
      }

      this.sidebar.classList.add("island-notification-active");
      this._startTimer();
    }

    _startTimer() {
      if (this.currentDuration <= 0) return;
      this.startTime = Date.now();
      this.timerId = setTimeout(() => {
        this.dismiss();
      }, this.remainingTime);
    }

    _pauseTimer() {
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
        this.remainingTime -= Date.now() - this.startTime;
        const progressEl = this.islandEl?.querySelector("#island-toast-progress");
        if (progressEl) {
          progressEl.style.transition = "none";
        }
      }
    }

    _resumeTimer() {
      if (this.remainingTime > 0) {
        const progressEl = this.islandEl?.querySelector("#island-toast-progress");
        if (progressEl) {
          progressEl.style.transition = `transform ${this.remainingTime}ms linear`;
          progressEl.style.transform = "scaleX(0)";
        }
        this._startTimer();
      } else {
        this.dismiss();
      }
    }

    dismiss() {
      if (this.timerId) {
        clearTimeout(this.timerId);
        this.timerId = null;
      }
      if (this.sidebar) {
        this.sidebar.classList.remove("island-notification-active");
      }
    }

    info(title, message, duration) {
      if (arguments.length === 1) {
        return this.show({ message: title, type: "info" });
      }
      return this.show({ title, message, type: "info", duration });
    }

    success(title, message, duration) {
      if (arguments.length === 1) {
        return this.show({ message: title, type: "success" });
      }
      return this.show({ title, message, type: "success", duration });
    }

    warning(title, message, duration) {
      if (arguments.length === 1) {
        return this.show({ message: title, type: "warning" });
      }
      return this.show({ title, message, type: "warning", duration });
    }

    error(title, message, duration) {
      if (arguments.length === 1) {
        return this.show({ message: title, type: "error" });
      }
      return this.show({ title, message, type: "error", duration });
    }
  }

  const toastInstance = new DynamicIslandToastManager();

  if (typeof window !== "undefined") {
    window.Toast = toastInstance;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = toastInstance;
  }
})();

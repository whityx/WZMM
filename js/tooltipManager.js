(function () {
  class TooltipManager {
    constructor() {
      this.tooltipEl = null;
      this.contentEl = null;
      this.iconEl = null;
      this.currentTarget = null;
      this.timer = null;
      this.defaultDelay = 180;
      this.init();
    }

    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.setupDOM());
      } else {
        this.setupDOM();
      }
    }

    setupDOM() {
      if (document.getElementById("global-custom-tooltip")) return;

      this.tooltipEl = document.createElement("div");
      this.tooltipEl.id = "global-custom-tooltip";
      this.tooltipEl.className = "custom-tooltip";

      this.iconEl = document.createElement("span");
      this.iconEl.className = "custom-tooltip-icon";
      this.iconEl.style.display = "none";

      this.contentEl = document.createElement("span");
      this.contentEl.className = "custom-tooltip-content";

      this.tooltipEl.appendChild(this.iconEl);
      this.tooltipEl.appendChild(this.contentEl);
      document.body.appendChild(this.tooltipEl);

      this.bindEvents();
    }

    bindEvents() {
      document.addEventListener(
        "pointerover",
        (e) => {
          const target = e.target.closest("[data-tooltip], [title]");
          if (target) {
            this.handlePointerOver(target);
          }
        },
        true,
      );

      document.addEventListener(
        "pointerout",
        (e) => {
          const target = e.target.closest("[data-tooltip], [title]");
          if (target && target === this.currentTarget) {
            this.hide();
          }
        },
        true,
      );

      document.addEventListener(
        "pointerdown",
        () => {
          this.hide();
        },
        true,
      );

      window.addEventListener(
        "scroll",
        () => {
          if (this.tooltipEl && this.tooltipEl.classList.contains("visible")) {
            this.hide();
          }
        },
        true,
      );

      document.addEventListener(
        "keydown",
        (e) => {
          if (e.key === "Escape") {
            this.hide();
          }
        },
        true,
      );
    }

    handlePointerOver(target) {
      if (target.hasAttribute("title")) {
        const titleText = target.getAttribute("title");
        if (titleText && titleText.trim()) {
          target.setAttribute("data-tooltip", titleText);
        }
        target.removeAttribute("title");
      }

      const text = target.getAttribute("data-tooltip");
      if (!text || !text.trim()) return;

      if (this.currentTarget === target) return;
      this.clearTimer();

      this.currentTarget = target;
      const delayAttr = target.getAttribute("data-tooltip-delay");
      const delay = delayAttr !== null ? parseInt(delayAttr, 10) : this.defaultDelay;

      this.timer = setTimeout(() => {
        if (this.currentTarget === target && document.contains(target)) {
          const iconType = target.getAttribute("data-tooltip-icon");
          this.show(target, text, { icon: iconType });
        }
      }, isNaN(delay) ? this.defaultDelay : delay);
    }

    clearTimer() {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
    }

    show(target, text, options = {}) {
      if (!this.tooltipEl) this.setupDOM();
      if (!text || !target) return;

      this.contentEl.textContent = text;

      if (options.icon === "link" || target.hasAttribute("data-tooltip-link")) {
        this.iconEl.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`;
        this.iconEl.style.display = "inline-flex";
      } else {
        this.iconEl.style.display = "none";
        this.iconEl.innerHTML = "";
      }

      this.tooltipEl.style.left = "-9999px";
      this.tooltipEl.style.top = "-9999px";
      this.tooltipEl.classList.add("visible");

      const rect = target.getBoundingClientRect();
      const tooltipRect = this.tooltipEl.getBoundingClientRect();

      let left = rect.left + rect.width / 2 - tooltipRect.width / 2;
      let top = rect.top - tooltipRect.height - 8;

      if (top < 8) {
        top = rect.bottom + 8;
      }

      const padding = 10;
      if (left < padding) {
        left = padding;
      } else if (left + tooltipRect.width > window.innerWidth - padding) {
        left = window.innerWidth - padding - tooltipRect.width;
      }

      this.tooltipEl.style.left = `${Math.round(left)}px`;
      this.tooltipEl.style.top = `${Math.round(top)}px`;
    }

    hide() {
      this.clearTimer();
      this.currentTarget = null;
      if (this.tooltipEl) {
        this.tooltipEl.classList.remove("visible");
      }
    }
  }

  window.tooltipManager = new TooltipManager();
})();

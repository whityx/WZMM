(function () {
  const MODAL_ICONS = {
    danger: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    primary: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 16 12 12 12 8"></polyline><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
    info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`
  };

  class ModalManager {
    constructor() {
      this.overlay = null;
      this.activeResolve = null;
      this._keyHandler = null;
    }

    _getOverlay() {
      if (!this.overlay || !document.body.contains(this.overlay)) {
        this.overlay = document.getElementById("wzmm-modal-overlay");
        if (!this.overlay) {
          this.overlay = document.createElement("div");
          this.overlay.id = "wzmm-modal-overlay";
          document.body.appendChild(this.overlay);
        }
      }
      return this.overlay;
    }

    _close() {
      if (this.overlay) {
        this.overlay.classList.remove("active");
      }
      if (this._keyHandler) {
        window.removeEventListener("keydown", this._keyHandler);
        this._keyHandler = null;
      }
    }

    confirm(options, legacyOnConfirm) {
      if (typeof options === "string") {
        options = {
          message: options,
          onConfirm: legacyOnConfirm
        };
      }

      const {
        title = (typeof t === "function" ? t("confirm_title") : "Подтверждение"),
        message = "",
        confirmText = (typeof t === "function" ? t("confirm_delete") : "Удалить"),
        cancelText = (typeof t === "function" ? t("confirm_cancel") : "Отмена"),
        type = "danger",
        onConfirm = null,
        onCancel = null
      } = options;

      return new Promise((resolve) => {
        const overlay = this._getOverlay();

        const iconSvg = MODAL_ICONS[type] || MODAL_ICONS.danger;

        overlay.innerHTML = `
          <div class="wzmm-modal-card type-${type}">
            <div class="wzmm-modal-icon">
              ${iconSvg}
            </div>
            <h3 class="wzmm-modal-title">${title}</h3>
            <p class="wzmm-modal-message">${message}</p>
            <div class="wzmm-modal-actions">
              <button id="wzmm-modal-cancel" class="wzmm-modal-btn wzmm-modal-btn-cancel">${cancelText}</button>
              <button id="wzmm-modal-confirm" class="wzmm-modal-btn wzmm-modal-btn-confirm ${type === "danger" ? "danger" : "primary"}">${confirmText}</button>
            </div>
          </div>
        `;

        const btnConfirm = overlay.querySelector("#wzmm-modal-confirm");
        const btnCancel = overlay.querySelector("#wzmm-modal-cancel");

        const handleConfirm = () => {
          this._close();
          if (typeof onConfirm === "function") onConfirm();
          resolve(true);
        };

        const handleCancel = () => {
          this._close();
          if (typeof onCancel === "function") onCancel();
          resolve(false);
        };

        btnConfirm.addEventListener("click", handleConfirm);
        btnCancel.addEventListener("click", handleCancel);

        overlay.onclick = (e) => {
          if (e.target === overlay) {
            handleCancel();
          }
        };

        if (this._keyHandler) {
          window.removeEventListener("keydown", this._keyHandler);
        }
        this._keyHandler = (e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            handleCancel();
          } else if (e.key === "Enter") {
            e.preventDefault();
            handleConfirm();
          }
        };
        window.addEventListener("keydown", this._keyHandler);

        overlay.classList.add("active");
        if (btnConfirm) btnConfirm.focus();
      });
    }

    alert(options) {
      if (typeof options === "string") {
        options = { message: options };
      }

      const {
        title = "Внимание",
        message = "",
        buttonText = "OK",
        type = "info",
        onConfirm = null
      } = options;

      return new Promise((resolve) => {
        const overlay = this._getOverlay();
        const iconSvg = MODAL_ICONS[type] || MODAL_ICONS.info;

        overlay.innerHTML = `
          <div class="wzmm-modal-card type-${type}">
            <div class="wzmm-modal-icon">
              ${iconSvg}
            </div>
            <h3 class="wzmm-modal-title">${title}</h3>
            <p class="wzmm-modal-message">${message}</p>
            <div class="wzmm-modal-actions">
              <button id="wzmm-modal-ok" class="wzmm-modal-btn wzmm-modal-btn-confirm primary" style="width: 100%;">${buttonText}</button>
            </div>
          </div>
        `;

        const btnOk = overlay.querySelector("#wzmm-modal-ok");

        const handleDismiss = () => {
          this._close();
          if (typeof onConfirm === "function") onConfirm();
          resolve();
        };

        btnOk.addEventListener("click", handleDismiss);

        overlay.onclick = (e) => {
          if (e.target === overlay) {
            handleDismiss();
          }
        };

        if (this._keyHandler) {
          window.removeEventListener("keydown", this._keyHandler);
        }
        this._keyHandler = (e) => {
          if (e.key === "Escape" || e.key === "Enter") {
            e.preventDefault();
            handleDismiss();
          }
        };
        window.addEventListener("keydown", this._keyHandler);

        overlay.classList.add("active");
        if (btnOk) btnOk.focus();
      });
    }
  }

  const modalInstance = new ModalManager();

  if (typeof window !== "undefined") {
    window.Modal = modalInstance;
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = modalInstance;
  }
})();

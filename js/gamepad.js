(function () {
  const fs = require("fs");
  const path = require("path");
  const os = require("os");

  let electronShell = null;
  try {
    const electron = require("electron");
    if (electron && typeof electron === "object" && electron.shell) {
      electronShell = electron.shell;
    }
  } catch (e) {}

  let steamDeckHelper = null;
  try {
    steamDeckHelper = require("./gamepad/steamdeck.js");
  } catch (e) {}

  class GamepadManager {
    constructor() {
      this.enabled = true;
      this.vibration = true;
      this.deadzone = 0.35;
      this.scrollDeadzone = 0.15;
      this.scrollSpeed = 16;
      this.controllerMode = false;
      this.activeGamepadIndex = null;
      this.focusedElement = null;
      this.prevButtons = {};
      this.prevAxes = {};
      this.repeatTimers = {};
      this.hudEl = null;
      this.hudContentEl = null;
      this.lastHudUpdate = 0;
      this.lastMousePos = { x: 0, y: 0 };
      this.rafId = null;
      this.isDeck = this.detectSteamDeck();
      this.lastFocusedModCard = null;
      this.lastFocusedModName = null;
      this.lastFocusedModIndex = -1;
      this.preModalFocusedElement = null;
      this.lastFocusedVarName = null;
      this.lastGamepadActionTime = 0;

      this.init();
    }

    detectSteamDeck() {
      if (steamDeckHelper && typeof steamDeckHelper.isSteamDeck === "function") {
        return steamDeckHelper.isSteamDeck();
      }
      if (process.env.SteamDeck === "1" || process.env.SteamOS === "1") return true;

      try {
        if (fs.existsSync("/sys/devices/virtual/dmi/id/product_name")) {
          const prod = fs.readFileSync("/sys/devices/virtual/dmi/id/product_name", "utf-8").toLowerCase();
          if (prod.includes("jupiter") || prod.includes("galileo")) return true;
        }
      } catch (e) {}

      try {
        if (fs.existsSync("/etc/os-release")) {
          const osRel = fs.readFileSync("/etc/os-release", "utf-8").toLowerCase();
          if (osRel.includes("steamos")) return true;
        }
      } catch (e) {}

      try {
        if (typeof window !== "undefined" && window.screen) {
          const w = window.screen.width;
          const h = window.screen.height;
          if ((w === 1280 && h === 800) || (w === 800 && h === 1280)) {
            if (process.platform === "linux") return true;
          }
        }
      } catch (e) {}

      return false;
    }

    openVirtualKeyboard() {
      if (!this.isDeck) return;
      if (steamDeckHelper && typeof steamDeckHelper.openSteamKeyboard === "function") {
        steamDeckHelper.openSteamKeyboard(electronShell);
        return;
      }
      try {
        if (electronShell && typeof electronShell.openExternal === "function") {
          electronShell.openExternal("steam://open/keyboard");
        }
      } catch (e) {}
    }

    closeVirtualKeyboard() {
      if (!this.isDeck) return;
      if (steamDeckHelper && typeof steamDeckHelper.closeSteamKeyboard === "function") {
        steamDeckHelper.closeSteamKeyboard(electronShell);
        return;
      }
      try {
        if (electronShell && typeof electronShell.openExternal === "function") {
          electronShell.openExternal("steam://close/keyboard");
        }
      } catch (e) {}
    }

    setupInputKeyboardHandlers() {
      document.addEventListener("focusin", (e) => {
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === "input" && e.target.type !== "checkbox" && e.target.type !== "radio") {
          if (this.controllerMode || this.isDeck) {
            this.openVirtualKeyboard();
          }
        }
      });

      document.addEventListener("focusout", (e) => {
        if (e.target && e.target.tagName && e.target.tagName.toLowerCase() === "input") {
          if (this.isDeck) {
            this.closeVirtualKeyboard();
          }
        }
      });
    }

    setupModalCloseObserver() {
      const modalIds = ["mod-modal", "gb-modal", "var-delete-modal", "wzmm-modal-overlay", "gb-lightbox-modal"];
      const observer = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === "attributes" && m.attributeName === "class") {
            const el = m.target;
            const wasActive = m.oldValue && m.oldValue.includes("active");
            const isNowActive = el.classList.contains("active");
            if (wasActive && !isNowActive && this.controllerMode) {
              this.restorePostModalFocus();
            }
          }
        }
      });

      const bindObserver = () => {
        modalIds.forEach((id) => {
          const el = document.getElementById(id);
          if (el && !el.__gamepadObserved) {
            el.__gamepadObserved = true;
            observer.observe(el, { attributes: true, attributeOldValue: true, attributeFilter: ["class"] });
          }
        });
      };

      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bindObserver);
      } else {
        bindObserver();
      }

      const bodyObserver = new MutationObserver(() => {
        bindObserver();
      });
      if (document.body) {
        bodyObserver.observe(document.body, { childList: true, subtree: true });
      }
    }

    init() {
      if (this.isDeck && document.body) {
        document.body.classList.add("steam-deck");
        this.setControllerMode(true);
      }

      this.setupInputKeyboardHandlers();
      this.setupModalCloseObserver();

      window.addEventListener("gamepadconnected", (e) => this.onGamepadConnected(e));
      window.addEventListener("gamepaddisconnected", (e) => this.onGamepadDisconnected(e));

      window.addEventListener("mousemove", (e) => {
        if (Date.now() - this.lastGamepadActionTime < 600) return;
        const dx = Math.abs(e.clientX - this.lastMousePos.x);
        const dy = Math.abs(e.clientY - this.lastMousePos.y);
        if (dx > 4 || dy > 4) {
          this.lastMousePos = { x: e.clientX, y: e.clientY };
          if (this.controllerMode && !this.isDeck) {
            this.setControllerMode(false);
          }
        }
      });

      window.addEventListener("mousedown", (e) => {
        if (!e.isTrusted) return;
        if (Date.now() - this.lastGamepadActionTime < 600) return;
        if (this.controllerMode && !this.isDeck) {
          this.setControllerMode(false);
        }
      });

      window.addEventListener("click", (e) => {
        const card = e.target.closest(".mod-card");
        if (card) {
          this.lastFocusedModCard = card;
          const nameEl = card.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
          this.lastFocusedModName = nameEl ? nameEl.textContent.trim() : null;
          const allCards = Array.from(document.querySelectorAll(".mod-card"));
          this.lastFocusedModIndex = allCards.indexOf(card);
        }
      }, true);

      this.createHud();
      this.startPolling();
    }

    createHud() {
      let existing = document.getElementById("controller-hud");
      if (existing) {
        this.hudEl = existing;
        this.hudContentEl = existing.querySelector(".hud-content");
        return;
      }

      this.hudEl = document.createElement("div");
      this.hudEl.id = "controller-hud";
      this.hudEl.className = "controller-hud";

      this.hudContentEl = document.createElement("div");
      this.hudContentEl.className = "hud-content";

      this.hudEl.appendChild(this.hudContentEl);
      if (document.body) {
        document.body.appendChild(this.hudEl);
      }
    }

    startPolling() {
      const poll = () => {
        this.update();
        this.rafId = requestAnimationFrame(poll);
      };
      this.rafId = requestAnimationFrame(poll);
    }

    onGamepadConnected(e) {
      this.activeGamepadIndex = e.gamepad.index;
    }

    onGamepadDisconnected(e) {
      if (this.activeGamepadIndex === e.gamepad.index) {
        this.activeGamepadIndex = null;
        this.findActiveGamepad();
      }
      if (!this.activeGamepadIndex && !this.isDeck) {
        this.setControllerMode(false);
      }
    }

    findActiveGamepad() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (let i = 0; i < gamepads.length; i++) {
        if (gamepads[i] && gamepads[i].connected) {
          this.activeGamepadIndex = i;
          return gamepads[i];
        }
      }
      return null;
    }

    formatGamepadName(name) {
      if (!name) return this.isDeck ? "Steam Deck Controller" : "Gamepad";
      const lower = name.toLowerCase();
      if (this.isDeck || lower.includes("steam") || lower.includes("057e") || lower.includes("jupiter") || lower.includes("galileo")) {
        return "Steam Deck Controller";
      }
      if (lower.includes("xbox")) return "Xbox Controller";
      if (lower.includes("dualsense") || lower.includes("dualshock") || lower.includes("wireless controller") || lower.includes("sony")) {
        return "PlayStation Controller";
      }
      if (lower.includes("nintendo") || lower.includes("switch")) return "Nintendo Switch Controller";
      const match = name.match(/^([^(]+)/);
      return match ? match[1].trim() : name;
    }

    getConnectedGamepad() {
      const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
      if (this.activeGamepadIndex !== null && gamepads[this.activeGamepadIndex] && gamepads[this.activeGamepadIndex].connected) {
        return gamepads[this.activeGamepadIndex];
      }
      return this.findActiveGamepad();
    }

    isElementAttached(el) {
      if (!el || !document.body) return false;
      if (typeof document.body.contains === "function") {
        return document.body.contains(el);
      }
      return true;
    }

    setControllerMode(active) {
      this.controllerMode = active;
      if (active) {
        if (document.body) document.body.classList.add("controller-mode");
        if (this.hudEl) this.hudEl.classList.add("visible");
        if (!this.focusedElement || !this.isElementAttached(this.focusedElement)) {
          this.focusDefaultElement();
        } else {
          this.applyVisualFocus(this.focusedElement);
        }
      } else {
        if (document.body) document.body.classList.remove("controller-mode");
        if (this.hudEl) this.hudEl.classList.remove("visible");
        this.clearVisualFocus();
      }
    }

    update() {
      if (!this.enabled) return;
      if (typeof document !== "undefined" && document.hasFocus && !document.hasFocus()) {
        this.prevButtons = {};
        return;
      }

      const gp = this.getConnectedGamepad();
      if (!gp) return;

      let hasInput = false;

      for (let i = 0; i < gp.buttons.length; i++) {
        const btn = gp.buttons[i];
        const isPressed = btn.pressed || btn.value > 0.5;
        const wasPressed = !!this.prevButtons[i];

        if (isPressed) hasInput = true;

        if (isPressed && !wasPressed) {
          this.onButtonDown(i);
        } else if (!isPressed && wasPressed) {
          this.onButtonUp(i);
        }
        this.prevButtons[i] = isPressed;
      }

      for (let a = 0; a < gp.axes.length; a++) {
        if (Math.abs(gp.axes[a]) > 0.15) {
          hasInput = true;
          break;
        }
      }

      if (hasInput) {
        this.lastGamepadActionTime = Date.now();
      }

      if (hasInput && !this.controllerMode) {
        this.setControllerMode(true);
      }

      if (this.controllerMode) {
        if (!this.focusedElement || !this.isElementAttached(this.focusedElement)) {
          this.recoverLostFocus();
        } else if (!this.focusedElement.classList.contains("controller-focused")) {
          this.applyVisualFocus(this.focusedElement);
        }
        this.handleAnalogAxes(gp);
        this.updateHud();
      }
    }

    handleAnalogAxes(gp) {
      const lx = gp.axes[0] || 0;
      const ly = gp.axes[1] || 0;
      const rx = gp.axes[2] || 0;
      const ry = gp.axes[3] || 0;

      const now = Date.now();

      const handleDirection = (dir, val) => {
        const absVal = Math.abs(val);
        if (absVal > this.deadzone) {
          if (!this.repeatTimers[dir]) {
            this.navigate(dir);
            this.repeatTimers[dir] = { startTime: now, nextTime: now + 320 };
          } else if (now >= this.repeatTimers[dir].nextTime) {
            this.navigate(dir);
            this.repeatTimers[dir].nextTime = now + 130;
          }
        } else {
          delete this.repeatTimers[dir];
        }
      };

      if (!gp.buttons[14]?.pressed && !gp.buttons[15]?.pressed) {
        if (lx < -this.deadzone) handleDirection("left", lx);
        else if (lx > this.deadzone) handleDirection("right", lx);
        else {
          delete this.repeatTimers["left"];
          delete this.repeatTimers["right"];
        }
      }

      if (!gp.buttons[12]?.pressed && !gp.buttons[13]?.pressed) {
        if (ly < -this.deadzone) handleDirection("up", ly);
        else if (ly > this.deadzone) handleDirection("down", ly);
        else {
          delete this.repeatTimers["up"];
          delete this.repeatTimers["down"];
        }
      }

      if (Math.abs(ry) > this.scrollDeadzone) {
        const scrollContainer = this.getActiveScrollContainer();
        if (scrollContainer) {
          const delta = (ry > 0 ? 1 : -1) * Math.pow(Math.abs(ry), 1.6) * this.scrollSpeed;
          scrollContainer.scrollTop += delta;
        }
      }
    }

    onButtonDown(index) {
      this.lastGamepadActionTime = Date.now();
      if (!this.controllerMode) {
        this.setControllerMode(true);
      }

      switch (index) {
        case 0:
          this.handleButtonA();
          break;
        case 1:
          this.handleButtonB();
          break;
        case 2:
          this.handleButtonX();
          break;
        case 3:
          this.handleButtonY();
          break;
        case 4:
          this.handleBumperLeft();
          break;
        case 5:
          this.handleBumperRight();
          break;
        case 6:
          this.handleTriggerLeft();
          break;
        case 7:
          this.handleTriggerRight();
          break;
        case 8:
          this.handleButtonSelect();
          break;
        case 9:
          this.handleButtonStart();
          break;
        case 11:
          this.handleButtonR3();
          break;
        case 12:
          this.navigate("up");
          break;
        case 13:
          this.navigate("down");
          break;
        case 14:
          this.navigate("left");
          break;
        case 15:
          this.navigate("right");
          break;
      }
    }

    onButtonUp(index) {
      if (index === 12) delete this.repeatTimers["up"];
      if (index === 13) delete this.repeatTimers["down"];
      if (index === 14) delete this.repeatTimers["left"];
      if (index === 15) delete this.repeatTimers["right"];
    }

    getActiveContext() {
      const lb = document.getElementById("gb-lightbox-modal");
      if (lb && lb.classList.contains("active") && lb.style.display !== "none") {
        return { type: "lightbox", container: lb };
      }

      const wzmmModal = document.getElementById("wzmm-modal-overlay");
      if (wzmmModal && wzmmModal.classList.contains("active")) {
        return { type: "confirm-modal", container: wzmmModal };
      }

      const varModal = document.getElementById("var-delete-modal");
      if (varModal && varModal.classList.contains("active")) {
        return { type: "var-modal", container: varModal };
      }

      const modModal = document.getElementById("mod-modal");
      if (modModal && modModal.classList.contains("active")) {
        return { type: "mod-modal", container: modModal };
      }

      const gbModal = document.getElementById("gb-modal");
      if (gbModal && gbModal.classList.contains("active")) {
        return { type: "gb-modal", container: gbModal };
      }

      const groupDrawer = document.getElementById("group-side-drawer");
      if (groupDrawer && groupDrawer.classList.contains("open")) {
        return { type: "group-drawer", container: document.body };
      }

      const installedDrawer = document.getElementById("installed-drawer");
      if (installedDrawer && installedDrawer.classList.contains("open")) {
        return { type: "filter-drawer", container: installedDrawer };
      }

      const gbDrawer = document.getElementById("gb-drawer");
      if (gbDrawer && gbDrawer.classList.contains("open")) {
        return { type: "filter-drawer", container: gbDrawer };
      }

      const openDropdown = document.querySelector(".custom-dropdown-menu.show");
      if (openDropdown) {
        return { type: "dropdown", container: openDropdown.closest(".custom-dropdown") || openDropdown };
      }

      return { type: "main", container: document.body };
    }

    getActiveScrollContainer() {
      const context = this.getActiveContext();
      if (context.type === "gb-modal" && context.container && typeof context.container.querySelector === "function") {
        if (this.focusedElement && this.focusedElement.closest(".gb-modal-right")) {
          return context.container.querySelector(".gb-modal-right") || context.container;
        }
        return context.container.querySelector(".gb-modal-left") || context.container.querySelector(".modal-content") || context.container;
      }
      if (context.type === "mod-modal" && context.container && typeof context.container.querySelector === "function") {
        return context.container.querySelector(".modal-content") || context.container;
      }
      if (context.type === "var-modal" && context.container && typeof context.container.querySelector === "function") {
        return context.container.querySelector(".var-delete-scroll-area") || context.container;
      }
      if (context.type === "group-drawer") {
        if (this.focusedElement && this.focusedElement.closest("#group-side-drawer")) {
          const drawer = document.getElementById("group-side-drawer");
          return drawer?.querySelector(".group-drawer-body") || drawer;
        }
        return document.getElementById("content-container") || document.documentElement;
      }
      if (context.type === "filter-drawer" && context.container && typeof context.container.querySelector === "function") {
        return context.container.querySelector(".gb-drawer-body") || context.container;
      }
      return document.getElementById("content-container") || document.querySelector(".main-content") || document.documentElement;
    }

    getCandidates(container) {
      if (!container || typeof container.querySelectorAll !== "function") return [];

      const selector = [
        ".sidebar-item",
        "#btn-launch-game",
        ".mod-card",
        ".gb-filter-btn",
        ".installed-filter-btn",
        ".btn-group-manage",
        ".btn-bulk-actions",
        ".bulk-action-item",
        ".btn-refresh",
        ".custom-dropdown-trigger",
        ".custom-dropdown-item",
        ".settings-nav-item",
        ".settings-theme-card",
        ".gb-subcat-row",
        ".gb-cat-nav-item",
        ".gb-reset-filter-btn",
        ".btn-group-enable",
        ".btn-group-disable",
        ".btn-toggle-expand",
        ".btn-edit-group",
        ".btn-delete-group",
        ".btn-group-action",
        ".btn-group-icon",
        ".group-card-add-selected",
        ".group-mod-remove-btn",
        ".group-action-btn",
        ".group-link-btn",
        ".btn-group-primary",
        ".btn-group-cancel",
        ".btn-primary",
        ".btn-secondary",
        ".btn-danger",
        ".btn-danger-outline",
        ".modal-close",
        ".group-drawer-close",
        ".gb-lightbox-close",
        ".carousel-btn",
        ".scroll-top-btn",
        ".btn-edit-char",
        ".modal-nsfw-toggle-wrap",
        ".var-item",
        ".btn-var-delete",
        ".wzmm-modal-btn",
        ".gb-featured-hero",
        ".gb-featured-strip-item",
        ".gb-featured-nav-btn",
        ".gb-featured-author-chip",
        "input[type='text']:not([disabled])",
        "input[type='checkbox']:not([disabled])",
        "button:not([disabled])",
        "a[href]:not([disabled])"
      ].join(", ");

      const rawElements = Array.from(container.querySelectorAll(selector));
      const candidates = [];

      for (let i = 0; i < rawElements.length; i++) {
        const el = rawElements[i];
        if (el.offsetWidth <= 0 || el.offsetHeight <= 0) continue;
        const style = window.getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
        if (el.tagName.toLowerCase() === "input" && el.closest(".toggle-switch")) continue;
        if (el.closest(".toggle-switch") && !el.classList.contains("toggle-switch") && !el.closest(".modal-nsfw-toggle-wrap")) continue;
        if (el.classList.contains("mod-toggle-btn") || el.classList.contains("mod-delete-btn")) continue;
        if (el.classList.contains("group-card")) continue;
        if (el.classList.contains("var-sub-checkbox")) continue;
        candidates.push(el);
      }

      return candidates;
    }

    getMainContentCandidate() {
      const container = document.getElementById("content-container");
      if (!container) return null;

      const candidates = this.getCandidates(container);
      if (candidates.length === 0) return null;

      const firstModCard = candidates.find((el) => el.classList.contains("mod-card"));
      if (firstModCard) return firstModCard;

      const activeSettingsNav = candidates.find((el) => el.classList.contains("settings-nav-item") && el.classList.contains("active"));
      if (activeSettingsNav) return activeSettingsNav;

      const firstSettingsNav = candidates.find((el) => el.classList.contains("settings-nav-item"));
      if (firstSettingsNav) return firstSettingsNav;

      const searchInput = candidates.find((el) => el.classList.contains("mods-search-input") || el.id === "mods-search" || el.id === "gb-search");
      if (searchInput) return searchInput;

      return candidates[0];
    }

    focusDefaultElement() {
      const context = this.getActiveContext();
      const candidates = this.getCandidates(context.container);
      if (candidates.length === 0) return;

      if (context.type === "mod-modal") {
        const firstVar = candidates.find((el) => el.classList.contains("var-item"));
        if (firstVar) {
          this.setFocus(firstVar);
          return;
        }
        const editChar = document.getElementById("modal-edit-char-btn");
        if (editChar && candidates.includes(editChar)) {
          this.setFocus(editChar);
          return;
        }
        const nsfwToggle = document.querySelector(".modal-nsfw-toggle-wrap");
        if (nsfwToggle && candidates.includes(nsfwToggle)) {
          this.setFocus(nsfwToggle);
          return;
        }
      }

      if (context.type === "group-drawer") {
        const nameInput = document.getElementById("group-name-input");
        if (nameInput && candidates.includes(nameInput)) {
          this.setFocus(nameInput);
          return;
        }
        const firstCard = document.querySelector("#mods-grid .mod-card");
        if (firstCard && candidates.includes(firstCard)) {
          this.setFocus(firstCard);
          return;
        }
      }

      if (context.type === "main") {
        if (this.lastFocusedModCard && this.isElementAttached(this.lastFocusedModCard) && candidates.includes(this.lastFocusedModCard)) {
          this.setFocus(this.lastFocusedModCard);
          return;
        }
        if (this.lastFocusedModName) {
          const match = candidates.find((c) => {
            if (!c.classList.contains("mod-card")) return false;
            const nameEl = c.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
            return nameEl && nameEl.textContent.trim() === this.lastFocusedModName;
          });
          if (match) {
            this.setFocus(match);
            return;
          }
        }
        if (this.lastFocusedModIndex >= 0) {
          const modCandidates = candidates.filter((c) => c.classList.contains("mod-card"));
          if (modCandidates.length > 0) {
            const idx = Math.min(this.lastFocusedModIndex, modCandidates.length - 1);
            this.setFocus(modCandidates[idx]);
            return;
          }
        }
        const target = this.getMainContentCandidate();
        if (target && candidates.includes(target)) {
          this.setFocus(target);
          return;
        }
        const activeNav = document.querySelector(".sidebar-item.active");
        if (activeNav && candidates.includes(activeNav)) {
          this.setFocus(activeNav);
          return;
        }
      }

      this.setFocus(candidates[0]);
    }

    restorePostModalFocus() {
      setTimeout(() => {
        const context = this.getActiveContext();
        if (context.type !== "main" && context.type !== "group-drawer") {
          return;
        }

        if (this.lastFocusedModCard && this.isElementAttached(this.lastFocusedModCard)) {
          this.setFocus(this.lastFocusedModCard);
          return;
        }

        if (this.lastFocusedModName) {
          const allCards = Array.from(document.querySelectorAll(".mod-card"));
          const match = allCards.find((c) => {
            const nameEl = c.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
            return nameEl && nameEl.textContent.trim() === this.lastFocusedModName;
          });
          if (match) {
            this.setFocus(match);
            return;
          }
        }

        if (this.lastFocusedModIndex >= 0) {
          const allCards = Array.from(document.querySelectorAll(".mod-card"));
          if (allCards.length > 0) {
            const idx = Math.min(this.lastFocusedModIndex, allCards.length - 1);
            this.setFocus(allCards[idx]);
            return;
          }
        }

        if (this.preModalFocusedElement && this.isElementAttached(this.preModalFocusedElement)) {
          this.setFocus(this.preModalFocusedElement);
          return;
        }

        this.focusDefaultElement();
      }, 60);
    }

    navigate(direction) {
      const context = this.getActiveContext();
      const candidates = this.getCandidates(context.container);
      if (candidates.length === 0) return;

      if (!this.focusedElement || !this.isElementAttached(this.focusedElement) || !candidates.includes(this.focusedElement)) {
        this.focusDefaultElement();
        return;
      }

      const current = this.focusedElement;
      const isCurrentInSidebar = !!current.closest(".sidebar");

      if (context.type === "group-drawer") {
        const isCurrentInGroupDrawer = !!current.closest("#group-side-drawer");

        if (isCurrentInGroupDrawer) {
          if (direction === "left") {
            const drawerCandidates = candidates.filter((el) => el.closest("#group-side-drawer"));
            const r1 = current.getBoundingClientRect();
            const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };
            let hasCandidateToLeft = false;
            for (let i = 0; i < drawerCandidates.length; i++) {
              const el = drawerCandidates[i];
              if (el === current) continue;
              const r2 = el.getBoundingClientRect();
              const c2x = r2.left + r2.width / 2;
              const c2y = r2.top + r2.height / 2;
              if (c2x < c1.x - 8 && Math.abs(c2y - c1.y) < 40) {
                hasCandidateToLeft = true;
                break;
              }
            }
            if (!hasCandidateToLeft) {
              const modCards = Array.from(document.querySelectorAll("#mods-grid .mod-card"));
              if (modCards.length > 0) {
                const c1y = r1.top + r1.height / 2;
                let bestMod = null;
                let bestDist = Infinity;
                for (let i = 0; i < modCards.length; i++) {
                  const card = modCards[i];
                  if (card.offsetWidth <= 0 || card.offsetHeight <= 0) continue;
                  const r2 = card.getBoundingClientRect();
                  const c2y = r2.top + r2.height / 2;
                  const dist = Math.abs(c2y - c1y);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestMod = card;
                  }
                }
                if (bestMod) {
                  this.setFocus(bestMod);
                  this.playHaptic(20, 0.1, 0.05);
                  return;
                }
              }
            }
          }
        } else {
          if (direction === "right") {
            const modCards = Array.from(document.querySelectorAll("#mods-grid .mod-card"));
            const r1 = current.getBoundingClientRect();
            const c1x = r1.left + r1.width / 2;
            let hasCardToRight = false;
            for (let i = 0; i < modCards.length; i++) {
              const card = modCards[i];
              if (card === current) continue;
              const r2 = card.getBoundingClientRect();
              if (r2.left + r2.width / 2 > c1x + 10) {
                hasCardToRight = true;
                break;
              }
            }
            if (!hasCardToRight) {
              const drawerCandidates = candidates.filter((el) => el.closest("#group-side-drawer"));
              if (drawerCandidates.length > 0) {
                const c1y = r1.top + r1.height / 2;
                let bestDrawerEl = null;
                let bestDist = Infinity;
                for (let i = 0; i < drawerCandidates.length; i++) {
                  const el = drawerCandidates[i];
                  const r2 = el.getBoundingClientRect();
                  const c2y = r2.top + r2.height / 2;
                  const dist = Math.abs(c2y - c1y);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestDrawerEl = el;
                  }
                }
                if (bestDrawerEl) {
                  this.setFocus(bestDrawerEl);
                  this.playHaptic(20, 0.1, 0.05);
                  return;
                }
              }
              const drawerTarget = document.getElementById("group-name-input") ||
                document.getElementById("btn-save-group") ||
                document.getElementById("btn-group-select-all") ||
                document.querySelector("#group-side-drawer button");
              if (drawerTarget) {
                this.setFocus(drawerTarget);
                this.playHaptic(20, 0.1, 0.05);
                return;
              }
            }
          }
        }
      }

      if (context.type === "main") {
        if (isCurrentInSidebar) {
          if (direction === "down") {
            const target = this.getMainContentCandidate();
            if (target) {
              this.setFocus(target);
              this.playHaptic(20, 0.1, 0.05);
              return;
            }
          }

          if (direction === "right") {
            const sidebarCandidates = candidates.filter((el) => el.closest(".sidebar"));
            const currentIndex = sidebarCandidates.indexOf(current);
            if (currentIndex !== -1 && currentIndex < sidebarCandidates.length - 1) {
              this.setFocus(sidebarCandidates[currentIndex + 1]);
              this.playHaptic(20, 0.1, 0.05);
              return;
            } else if (currentIndex === sidebarCandidates.length - 1) {
              const target = this.getMainContentCandidate();
              if (target) {
                this.setFocus(target);
                this.playHaptic(20, 0.1, 0.05);
                return;
              }
            }
          }

          if (direction === "left") {
            const sidebarCandidates = candidates.filter((el) => el.closest(".sidebar"));
            const currentIndex = sidebarCandidates.indexOf(current);
            if (currentIndex > 0) {
              this.setFocus(sidebarCandidates[currentIndex - 1]);
              this.playHaptic(20, 0.1, 0.05);
              return;
            }
          }

          if (direction === "up") {
            return;
          }
        } else {
          const contentContainer = document.getElementById("content-container");
          const contentCandidates = contentContainer ? this.getCandidates(contentContainer) : [];
          const r1 = current.getBoundingClientRect();
          const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };

          if (direction === "up") {
            let hasUpInContent = false;
            for (let i = 0; i < contentCandidates.length; i++) {
              const el = contentCandidates[i];
              if (el === current) continue;
              const r2 = el.getBoundingClientRect();
              const c2y = r2.top + r2.height / 2;
              if (c2y < c1.y - 12) {
                hasUpInContent = true;
                break;
              }
            }
            if (!hasUpInContent) {
              const activeSidebar = document.querySelector(".sidebar-item.active") || document.querySelector(".sidebar-item");
              if (activeSidebar) {
                this.setFocus(activeSidebar);
                this.playHaptic(20, 0.1, 0.05);
                return;
              }
            }
          }

          if (direction === "left") {
            let hasLeftInContent = false;
            for (let i = 0; i < contentCandidates.length; i++) {
              const el = contentCandidates[i];
              if (el === current) continue;
              const r2 = el.getBoundingClientRect();
              const c2x = r2.left + r2.width / 2;
              if (c2x < c1.x - 12 && Math.abs((r2.top + r2.height / 2) - c1.y) < 140) {
                hasLeftInContent = true;
                break;
              }
            }
            if (!hasLeftInContent) {
              const activeSidebar = document.querySelector(".sidebar-item.active") || document.querySelector(".sidebar-item");
              if (activeSidebar) {
                this.setFocus(activeSidebar);
                this.playHaptic(20, 0.1, 0.05);
                return;
              }
            }
          }
        }
      }

      let filteredCandidates = candidates;
      if (context.type === "group-drawer") {
        const isCurrentInGroupDrawer = !!current.closest("#group-side-drawer");
        if (isCurrentInGroupDrawer) {
          filteredCandidates = candidates.filter((el) => el.closest("#group-side-drawer"));
        } else {
          filteredCandidates = candidates.filter((el) => !el.closest("#group-side-drawer") && !el.closest(".sidebar"));
        }
      } else if (context.type === "main" && !isCurrentInSidebar) {
        filteredCandidates = candidates.filter((el) => !el.closest(".sidebar"));
      }

      const r1 = current.getBoundingClientRect();
      const c1 = { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 };

      let bestCandidate = null;
      let bestScore = Infinity;

      for (let i = 0; i < filteredCandidates.length; i++) {
        const el = filteredCandidates[i];
        if (el === current) continue;

        const r2 = el.getBoundingClientRect();
        const c2 = { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 };

        let inDirection = false;
        let score = Infinity;
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;

        if (direction === "right") {
          if (c2.x > c1.x + 8) {
            inDirection = true;
            score = Math.abs(dx) + Math.abs(dy) * 2.2;
          }
        } else if (direction === "left") {
          if (c2.x < c1.x - 8) {
            inDirection = true;
            score = Math.abs(dx) + Math.abs(dy) * 2.2;
          }
        } else if (direction === "down") {
          if (c2.y > c1.y + 8) {
            inDirection = true;
            score = Math.abs(dy) + Math.abs(dx) * 1.8;
          }
        } else if (direction === "up") {
          if (c2.y < c1.y - 8) {
            inDirection = true;
            score = Math.abs(dy) + Math.abs(dx) * 1.8;
          }
        }

        if (inDirection && score < bestScore) {
          bestScore = score;
          bestCandidate = el;
        }
      }

      if (!bestCandidate && context.type === "main") {
        if (direction === "left" && !isCurrentInSidebar) {
          const activeSidebar = document.querySelector(".sidebar-item.active") || document.querySelector(".sidebar-item");
          if (activeSidebar) bestCandidate = activeSidebar;
        } else if (direction === "down" && isCurrentInSidebar) {
          bestCandidate = this.getMainContentCandidate();
        }
      }

      if (bestCandidate) {
        this.setFocus(bestCandidate);
        this.playHaptic(20, 0.1, 0.05);
      }
    }

    setFocus(el) {
      if (!el) return;
      this.clearVisualFocus();
      this.focusedElement = el;
      this.applyVisualFocus(el);

      const card = el.classList.contains("mod-card") ? el : el.closest(".mod-card");
      if (card) {
        this.lastFocusedModCard = card;
        const nameEl = card.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
        this.lastFocusedModName = nameEl ? nameEl.textContent.trim() : null;
        const allCards = Array.from(document.querySelectorAll(".mod-card"));
        this.lastFocusedModIndex = allCards.indexOf(card);
        this.preModalFocusedElement = card;
      }

      if (el.classList.contains("var-item")) {
        const vName = el.querySelector(".var-name");
        this.lastFocusedVarName = vName ? vName.textContent.trim() : null;
      }

      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }

      const contentContainer = document.getElementById("content-container");
      if (contentContainer && contentContainer.contains(el) && !el.closest("#group-side-drawer")) {
        const rect = el.getBoundingClientRect();
        if (rect.top < 95) {
          contentContainer.scrollBy({ top: rect.top - 95, behavior: "smooth" });
        }
      }

      if (el.tagName && (el.tagName.toLowerCase() === "input" || el.tagName.toLowerCase() === "textarea")) {
        if (typeof el.focus === "function") {
          el.focus({ preventScroll: true });
        }
      } else if (document.activeElement && document.activeElement !== el && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
      }
    }

    applyVisualFocus(el) {
      if (!el) return;
      el.classList.add("controller-focused");
    }

    clearVisualFocus() {
      const prev = document.querySelectorAll(".controller-focused");
      prev.forEach((item) => item.classList.remove("controller-focused"));
      if (document.activeElement && document.activeElement.tagName && document.activeElement.tagName.toLowerCase() !== "input") {
        if (typeof document.activeElement.blur === "function") {
          document.activeElement.blur();
        }
      }
    }

    recoverLostFocus() {
      const context = this.getActiveContext();
      if (context.type === "mod-modal") {
        if (this.lastFocusedVarName && context.container) {
          const allVars = Array.from(context.container.querySelectorAll(".var-item"));
          const match = allVars.find((v) => {
            const nameEl = v.querySelector(".var-name");
            return nameEl && nameEl.textContent.trim() === this.lastFocusedVarName;
          });
          if (match) {
            this.setFocus(match);
            return;
          }
        }
        this.focusDefaultElement();
        return;
      }

      if (context.type === "gb-modal" || context.type === "lightbox" || context.type === "confirm-modal" || context.type === "var-modal") {
        this.focusDefaultElement();
        return;
      }

      if (context.type === "main" || context.type === "group-drawer") {
        if (this.lastFocusedModName) {
          const allCards = Array.from(document.querySelectorAll(".mod-card"));
          const match = allCards.find((c) => {
            const nameEl = c.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
            return nameEl && nameEl.textContent.trim() === this.lastFocusedModName;
          });
          if (match) {
            this.setFocus(match);
            return;
          }
        }

        if (this.lastFocusedModIndex >= 0) {
          const allCards = Array.from(document.querySelectorAll(".mod-card"));
          if (allCards.length > 0) {
            const idx = Math.min(this.lastFocusedModIndex, allCards.length - 1);
            this.setFocus(allCards[idx]);
            return;
          }
        }
      }

      this.focusDefaultElement();
    }

    handleButtonA() {
      if (!this.focusedElement) {
        this.focusDefaultElement();
        return;
      }

      const el = this.focusedElement;
      this.playHaptic(35, 0.15, 0.2);

      if (el.classList.contains("sidebar-item")) {
        const isAlreadyActive = el.classList.contains("active");
        el.click();
        const focusMain = () => {
          const target = this.getMainContentCandidate();
          if (target) {
            this.setFocus(target);
          }
        };
        if (isAlreadyActive) {
          focusMain();
        } else {
          setTimeout(focusMain, 60);
          setTimeout(focusMain, 180);
        }
        return;
      }

      if (el.id === "btn-group-manage") {
        el.click();
        setTimeout(() => {
          const drawer = document.getElementById("group-side-drawer");
          if (drawer && drawer.classList.contains("open")) {
            const nameInput = document.getElementById("group-name-input") || document.getElementById("btn-group-select-all");
            if (nameInput) this.setFocus(nameInput);
          }
        }, 120);
        return;
      }

      if (el.classList.contains("mod-card")) {
        this.lastFocusedModCard = el;
        const nameEl = el.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
        this.lastFocusedModName = nameEl ? nameEl.textContent.trim() : null;
        const allCards = Array.from(document.querySelectorAll(".mod-card"));
        this.lastFocusedModIndex = allCards.indexOf(el);
        this.preModalFocusedElement = el;

        const isGroupOpen = document.getElementById("group-side-drawer")?.classList.contains("open");
        if (isGroupOpen) {
          const selIndicator = el.querySelector(".mod-select-indicator");
          if (selIndicator) selIndicator.click();
          else el.click();
          this.focusedElement = el;
          this.applyVisualFocus(el);
          setTimeout(() => {
            if (this.controllerMode) {
              if (el && this.isElementAttached(el)) {
                this.focusedElement = el;
                this.applyVisualFocus(el);
              } else {
                this.recoverLostFocus();
              }
            }
          }, 40);
          return;
        } else {
          const preview = el.querySelector(".mod-preview-wrapper") || el.querySelector(".mod-preview");
          if (preview) preview.click();
          else el.click();
          setTimeout(() => {
            const context = this.getActiveContext();
            if (context.type === "mod-modal" || context.type === "gb-modal") {
              this.focusDefaultElement();
            } else if (this.controllerMode && el && this.isElementAttached(el)) {
              this.focusedElement = el;
              this.applyVisualFocus(el);
            }
          }, 120);
        }
        return;
      }

      if (el.classList.contains("gb-featured-hero")) {
        this.preModalFocusedElement = el;
        el.click();
        setTimeout(() => {
          const context = this.getActiveContext();
          if (context.type === "gb-modal" || context.type === "mod-modal") {
            this.focusDefaultElement();
          } else if (this.controllerMode && el && this.isElementAttached(el)) {
            this.focusedElement = el;
            this.applyVisualFocus(el);
          }
        }, 120);
        return;
      }

      if (el.id === "modal-close" || el.id === "gb-modal-close" || el.id === "gb-lightbox-close" || el.classList.contains("modal-close") || el.classList.contains("gb-lightbox-close")) {
        el.click();
        this.restorePostModalFocus();
        return;
      }

      if (el.classList.contains("btn-edit-group")) {
        el.click();
        setTimeout(() => {
          const nameInput = document.getElementById("group-name-input");
          if (nameInput) this.setFocus(nameInput);
        }, 60);
        return;
      }

      if (el.classList.contains("modal-nsfw-toggle-wrap")) {
        const input = document.getElementById("modal-nsfw-checkbox");
        if (input) {
          input.checked = !input.checked;
          input.dispatchEvent(new Event("change", { bubbles: true }));
          if (typeof input.onchange === "function") {
            input.onchange();
          }
        }
        return;
      }

      if (el.classList.contains("var-item")) {
        const checkbox = el.querySelector(".var-sub-checkbox");
        const varNameEl = el.querySelector(".var-name");
        const varName = varNameEl ? varNameEl.textContent.trim() : null;
        const allVars = Array.from(document.querySelectorAll(".var-item"));
        const varIndex = allVars.indexOf(el);

        if (checkbox) {
          checkbox.click();
        } else {
          el.click();
        }

        setTimeout(() => {
          if (!this.controllerMode) return;
          const currentVars = Array.from(document.querySelectorAll(".var-item"));
          if (currentVars.length === 0) return;
          let match = null;
          if (varName) {
            match = currentVars.find((v) => {
              const vn = v.querySelector(".var-name");
              return vn && vn.textContent.trim() === varName;
            });
          }
          if (!match && varIndex >= 0) {
            match = currentVars[Math.min(varIndex, currentVars.length - 1)];
          }
          if (!match) {
            match = currentVars[0];
          }
          if (match) {
            this.setFocus(match);
          }
        }, 50);
        return;
      }

      if (el.type === "checkbox") {
        el.click();
        return;
      }

      if (el.classList.contains("toggle-switch")) {
        const input = el.querySelector("input[type='checkbox']");
        if (input) {
          input.click();
        }
        return;
      }

      if (el.tagName && el.tagName.toLowerCase() === "input") {
        el.focus();
        this.openVirtualKeyboard();
        return;
      }

      el.click();
    }

    handleButtonB() {
      this.playHaptic(25, 0.12, 0.1);

      if (document.activeElement && document.activeElement.tagName && document.activeElement.tagName.toLowerCase() === "input") {
        document.activeElement.blur();
        this.closeVirtualKeyboard();
        if (this.focusedElement) this.applyVisualFocus(this.focusedElement);
        return;
      }

      const openDropdown = document.querySelector(".custom-dropdown-menu.show");
      if (openDropdown) {
        const trigger = openDropdown.closest(".custom-dropdown")?.querySelector(".custom-dropdown-trigger");
        if (trigger) {
          trigger.click();
          this.setFocus(trigger);
          return;
        }
      }

      const lb = document.getElementById("gb-lightbox-modal");
      if (lb && lb.classList.contains("active") && lb.style.display !== "none") {
        const closeBtn = document.getElementById("gb-lightbox-close");
        if (closeBtn) closeBtn.click();
        else {
          lb.classList.remove("active");
          lb.style.display = "none";
        }
        const activeModal = document.getElementById("mod-modal")?.classList.contains("active") || document.getElementById("gb-modal")?.classList.contains("active");
        if (activeModal) {
          this.focusDefaultElement();
        } else {
          this.restorePostModalFocus();
        }
        return;
      }

      const wzmmCancel = document.getElementById("wzmm-modal-cancel");
      const wzmmOverlay = document.getElementById("wzmm-modal-overlay");
      if (wzmmOverlay && wzmmOverlay.classList.contains("active")) {
        if (wzmmCancel) wzmmCancel.click();
        else {
          const okBtn = document.getElementById("wzmm-modal-ok");
          if (okBtn) okBtn.click();
        }
        this.restorePostModalFocus();
        return;
      }

      const varClose = document.getElementById("var-delete-close") || document.getElementById("var-delete-cancel");
      const varModal = document.getElementById("var-delete-modal");
      if (varModal && varModal.classList.contains("active")) {
        if (varClose) varClose.click();
        this.restorePostModalFocus();
        return;
      }

      const modClose = document.getElementById("modal-close");
      const modModal = document.getElementById("mod-modal");
      if (modModal && modModal.classList.contains("active")) {
        if (modClose) modClose.click();
        this.restorePostModalFocus();
        return;
      }

      const gbClose = document.getElementById("gb-modal-close");
      const gbModal = document.getElementById("gb-modal");
      if (gbModal && gbModal.classList.contains("active")) {
        if (gbClose) gbClose.click();
        this.restorePostModalFocus();
        return;
      }

      const groupDrawerClose = document.getElementById("btn-close-group-drawer");
      const groupDrawer = document.getElementById("group-side-drawer");
      if (groupDrawer && groupDrawer.classList.contains("open")) {
        if (this.focusedElement && !this.focusedElement.closest("#group-side-drawer")) {
          const drawerTarget = document.getElementById("group-name-input") ||
            document.getElementById("btn-save-group") ||
            document.getElementById("btn-group-select-all") ||
            groupDrawerClose;
          if (drawerTarget) {
            this.setFocus(drawerTarget);
            return;
          }
        }
        if (groupDrawerClose) groupDrawerClose.click();
        this.restorePostModalFocus();
        return;
      }

      const installedDrawer = document.getElementById("installed-drawer");
      if (installedDrawer && installedDrawer.classList.contains("open")) {
        const closeBtn = installedDrawer.querySelector(".gb-drawer-close");
        if (closeBtn) closeBtn.click();
        this.focusDefaultElement();
        return;
      }

      const gbDrawer = document.getElementById("gb-drawer");
      if (gbDrawer && gbDrawer.classList.contains("open")) {
        const closeBtn = gbDrawer.querySelector(".gb-drawer-close");
        if (closeBtn) closeBtn.click();
        this.focusDefaultElement();
        return;
      }

      const activeNav = document.querySelector(".sidebar-item.active") || document.querySelector(".sidebar-item");
      if (activeNav && this.focusedElement !== activeNav) {
        this.setFocus(activeNav);
      }
    }

    handleButtonX() {
      this.playHaptic(40, 0.2, 0.2);

      const isGroupOpen = !!document.getElementById("group-side-drawer")?.classList.contains("open");
      if (this.focusedElement && this.focusedElement.classList.contains("mod-card")) {
        const targetCard = this.focusedElement;
        const nameEl = targetCard.querySelector(".mod-name, .gb-mod-title, [data-tooltip]");
        const modName = nameEl ? nameEl.textContent.trim() : null;
        const allCards = Array.from(document.querySelectorAll(".mod-card"));
        const cardIndex = allCards.indexOf(targetCard);

        if (isGroupOpen) {
          const ind = targetCard.querySelector(".mod-select-indicator");
          if (ind) ind.click();
          else targetCard.click();
          this.focusedElement = targetCard;
          this.applyVisualFocus(targetCard);
          setTimeout(() => {
            if (this.controllerMode) {
              if (this.isElementAttached(targetCard)) {
                this.focusedElement = targetCard;
                this.applyVisualFocus(targetCard);
              } else {
                this.recoverLostFocus();
              }
            }
          }, 40);
          return;
        }
        const toggleBtn = targetCard.querySelector(".mod-toggle-btn");
        if (toggleBtn) {
          toggleBtn.click();
          setTimeout(() => {
            if (this.controllerMode) {
              if (this.isElementAttached(targetCard)) {
                this.focusedElement = targetCard;
                this.applyVisualFocus(targetCard);
              } else {
                this.recoverLostFocus();
              }
            }
          }, 60);
          return;
        }
      }
    }

    handleButtonY() {
      this.playHaptic(30, 0.1, 0.15);

      const context = this.getActiveContext();
      if (context.type === "mod-modal") {
        const btn3d = document.getElementById("modal-open-3d-btn");
        if (btn3d && btn3d.style.display !== "none") {
          btn3d.click();
          return;
        }
      }

      const installedFilterBtn = document.getElementById("installed-filter-btn");
      if (installedFilterBtn && document.body.contains(installedFilterBtn)) {
        installedFilterBtn.click();
        return;
      }

      const gbFilterBtn = document.getElementById("gb-filter-btn");
      if (gbFilterBtn && document.body.contains(gbFilterBtn)) {
        gbFilterBtn.click();
        return;
      }

      const searchInput = document.getElementById("mods-search") || document.getElementById("gb-search") || document.querySelector(".mods-search-input");
      if (searchInput) {
        this.setFocus(searchInput);
        searchInput.focus();
        this.openVirtualKeyboard();
      }
    }

    handleBumperLeft() {
      this.playHaptic(30, 0.15, 0.15);

      const gbModal = document.getElementById("gb-modal");
      if (gbModal && gbModal.classList.contains("active")) {
        const prevBtn = document.getElementById("gb-carousel-prev");
        if (prevBtn) {
          prevBtn.click();
          return;
        }
      }

      if (this.focusedElement && this.focusedElement.closest("#gb-featured-container")) {
        const prevBtn = document.getElementById("gb-featured-prev");
        if (prevBtn) {
          prevBtn.click();
          return;
        }
      }

      const settingsNavs = Array.from(document.querySelectorAll(".settings-nav-item"));
      if (settingsNavs.length > 0 && this.focusedElement && this.focusedElement.closest(".settings-page")) {
        const activeIndex = settingsNavs.findIndex((nav) => nav.classList.contains("active"));
        if (activeIndex !== -1) {
          const prevIndex = (activeIndex - 1 + settingsNavs.length) % settingsNavs.length;
          settingsNavs[prevIndex].click();
          this.setFocus(settingsNavs[prevIndex]);
          return;
        }
      }

      const sidebarItems = Array.from(document.querySelectorAll(".sidebar-item"));
      if (sidebarItems.length > 0) {
        const activeIndex = sidebarItems.findIndex((item) => item.classList.contains("active"));
        if (activeIndex !== -1) {
          const prevIndex = (activeIndex - 1 + sidebarItems.length) % sidebarItems.length;
          sidebarItems[prevIndex].click();
          const wasInContent = this.focusedElement && !this.focusedElement.closest(".sidebar");
          if (wasInContent) {
            const focusMain = () => {
              const target = this.getMainContentCandidate();
              if (target) this.setFocus(target);
            };
            setTimeout(focusMain, 60);
            setTimeout(focusMain, 180);
          } else {
            this.setFocus(sidebarItems[prevIndex]);
          }
        }
      }
    }

    handleBumperRight() {
      this.playHaptic(30, 0.15, 0.15);

      const gbModal = document.getElementById("gb-modal");
      if (gbModal && gbModal.classList.contains("active")) {
        const nextBtn = document.getElementById("gb-carousel-next");
        if (nextBtn) {
          nextBtn.click();
          return;
        }
      }

      if (this.focusedElement && this.focusedElement.closest("#gb-featured-container")) {
        const nextBtn = document.getElementById("gb-featured-next");
        if (nextBtn) {
          nextBtn.click();
          return;
        }
      }

      const settingsNavs = Array.from(document.querySelectorAll(".settings-nav-item"));
      if (settingsNavs.length > 0 && this.focusedElement && this.focusedElement.closest(".settings-page")) {
        const activeIndex = settingsNavs.findIndex((nav) => nav.classList.contains("active"));
        if (activeIndex !== -1) {
          const nextIndex = (activeIndex + 1) % settingsNavs.length;
          settingsNavs[nextIndex].click();
          this.setFocus(settingsNavs[nextIndex]);
          return;
        }
      }

      const sidebarItems = Array.from(document.querySelectorAll(".sidebar-item"));
      if (sidebarItems.length > 0) {
        const activeIndex = sidebarItems.findIndex((item) => item.classList.contains("active"));
        if (activeIndex !== -1) {
          const nextIndex = (activeIndex + 1) % sidebarItems.length;
          sidebarItems[nextIndex].click();
          const wasInContent = this.focusedElement && !this.focusedElement.closest(".sidebar");
          if (wasInContent) {
            const focusMain = () => {
              const target = this.getMainContentCandidate();
              if (target) this.setFocus(target);
            };
            setTimeout(focusMain, 60);
            setTimeout(focusMain, 180);
          } else {
            this.setFocus(sidebarItems[nextIndex]);
          }
        }
      }
    }

    handleTriggerLeft() {
      const scrollContainer = this.getActiveScrollContainer();
      if (scrollContainer && typeof scrollContainer.scrollBy === "function") {
        scrollContainer.scrollBy({ top: -350, behavior: "smooth" });
      }
    }

    handleTriggerRight() {
      const scrollContainer = this.getActiveScrollContainer();
      if (scrollContainer && typeof scrollContainer.scrollBy === "function") {
        scrollContainer.scrollBy({ top: 350, behavior: "smooth" });
      }
    }

    handleButtonStart() {
      this.playHaptic(50, 0.25, 0.25);
      const launchBtn = document.getElementById("btn-launch-game");
      if (launchBtn) {
        launchBtn.click();
      }
    }

    handleButtonSelect() {
      this.playHaptic(25, 0.1, 0.1);
      const groupDrawer = document.getElementById("group-side-drawer");
      if (groupDrawer && groupDrawer.classList.contains("open")) {
        if (this.focusedElement && this.focusedElement.closest("#group-side-drawer")) {
          const firstMod = document.querySelector("#mods-grid .mod-card");
          if (firstMod) this.setFocus(firstMod);
        } else {
          const drawerTarget = document.getElementById("group-name-input") ||
            document.getElementById("btn-save-group") ||
            document.getElementById("btn-group-select-all");
          if (drawerTarget) this.setFocus(drawerTarget);
        }
        return;
      }

      const isSidebar = this.focusedElement && !!this.focusedElement.closest(".sidebar");
      if (!this.focusedElement || isSidebar) {
        const contentCandidate = this.getMainContentCandidate();
        if (contentCandidate) this.setFocus(contentCandidate);
      } else {
        const activeNav = document.querySelector(".sidebar-item.active") || document.querySelector(".sidebar-item");
        if (activeNav) this.setFocus(activeNav);
      }
    }

    handleButtonR3() {
      const scrollContainer = this.getActiveScrollContainer();
      if (scrollContainer) {
        if (typeof scrollContainer.scrollTo === "function") {
          scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          scrollContainer.scrollTop = 0;
        }
      }
    }

    playHaptic(duration = 30, weak = 0.15, strong = 0.1) {
      if (!this.vibration) return;
      try {
        const gp = this.getConnectedGamepad();
        if (gp && gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === "function") {
          gp.vibrationActuator.playEffect("dual-rumble", {
            startDelay: 0,
            duration: duration,
            weakMagnitude: weak,
            strongMagnitude: strong
          }).catch(() => {});
        }
      } catch (e) {}
    }

    updateHud() {
      const now = Date.now();
      if (now - this.lastHudUpdate < 150) return;
      this.lastHudUpdate = now;

      if (!this.hudContentEl) return;

      const context = this.getActiveContext();
      const tr = typeof t === "function" ? t : (k) => k;

      let itemsHtml = "";

      const makeItem = (btnClass, btnText, label) => `
        <div class="hud-item">
          <span class="hud-btn ${btnClass}">${btnText}</span>
          <span class="hud-label">${label}</span>
        </div>
      `;

      if (context.type === "lightbox" || context.type === "confirm-modal") {
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
      } else if (context.type === "mod-modal") {
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
        const btn3d = document.getElementById("modal-open-3d-btn");
        if (btn3d && btn3d.style.display !== "none") {
          itemsHtml += makeItem("btn-y", "Y", tr("modal_open_3d") || "3D Просмотр");
        }
        itemsHtml += makeItem("btn-stick", "R", tr("hud_scroll"));
      } else if (context.type === "gb-modal") {
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
        itemsHtml += makeItem("btn-pill", "LB/RB", "Галерея");
        itemsHtml += makeItem("btn-stick", "R", tr("hud_scroll"));
      } else if (context.type === "group-drawer") {
        const isModCard = this.focusedElement && this.focusedElement.classList.contains("mod-card");
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
        if (isModCard) {
          itemsHtml += makeItem("btn-x", "X", tr("hud_toggle"));
        }
        itemsHtml += makeItem("btn-pill", "Select", tr("hud_switch_pane"));
        itemsHtml += makeItem("btn-stick", "R", tr("hud_scroll"));
      } else if (context.type === "filter-drawer") {
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
        itemsHtml += makeItem("btn-stick", "R", tr("hud_scroll"));
      } else {
        const isModCard = this.focusedElement && this.focusedElement.classList.contains("mod-card");
        itemsHtml += makeItem("btn-a", "A", tr("hud_select"));
        itemsHtml += makeItem("btn-b", "B", tr("hud_back"));
        if (isModCard) {
          itemsHtml += makeItem("btn-x", "X", tr("hud_toggle"));
        }
        itemsHtml += makeItem("btn-y", "Y", tr("hud_filter"));
        itemsHtml += makeItem("btn-pill", "LB/RB", tr("hud_tabs"));
        itemsHtml += makeItem("btn-stick", "R", tr("hud_scroll"));
        itemsHtml += makeItem("btn-pill", "Start", tr("hud_launch"));
      }

      this.hudContentEl.innerHTML = itemsHtml;
    }
  }

  const manager = new GamepadManager();
  window.GamepadManager = manager;
  window.ControllerManager = manager;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = manager;
  }
})();

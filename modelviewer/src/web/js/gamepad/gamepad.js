import * as THREE from 'three';
import {
  camera, controls, resetView, rotateModelQuarterTurn, toggleGrid
} from '../scene/scene.js';
import { toggleWireframe, activeMeshes } from '../mesh/visibility.js';
import { requestRender } from '../scene/render-scheduler.js';
import { setLeftDockTab, LEFT_TABS } from '../panels/left-dock.js';
import { getDeviceProfile } from './steamdeck.js';

export class GamepadController {
  constructor() {
    this.enabled = true;
    this.deadzone = 0.15;
    this.orbitSpeed = 2.2;
    this.panSpeed = 2.8;
    this.zoomSpeed = 2.0;
    this.prevButtons = {};
    this.lastTime = performance.now();
    this.rafId = null;
    this.dockTabList = Array.from(LEFT_TABS);
    this.currentDockIndex = 0;
    this.hasNotified = false;

    this.init();
  }

  init() {
    window.addEventListener('gamepadconnected', (e) => {
      this.updateFooterHelp(e.gamepad);
      if (!this.rafId) {
        this.lastTime = performance.now();
        this.poll();
      }
    });

    window.addEventListener('gamepaddisconnected', () => {
      const active = this.getConnectedGamepad();
      if (!active && this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
        document.body.classList.remove('gamepad-active');
        const helpEl = document.getElementById('interaction-help');
        if (helpEl) {
          const isRu = (document.documentElement.lang || '').toLowerCase().startsWith('ru');
          helpEl.textContent = isRu
            ? 'ЛКМ: Вращение · ПКМ: Панорама · Колесо: Зум'
            : 'LMB: Orbit · RMB: Pan · Wheel: Zoom';
        }
      }
    });

    this.lastTime = performance.now();
    this.poll();
  }

  getConnectedGamepad() {
    if (!navigator.getGamepads) return null;
    const gamepads = navigator.getGamepads();
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (gp && gp.connected) return gp;
    }
    return null;
  }

  updateFooterHelp(gp) {
    if (this.hasNotified) return;
    const helpEl = document.getElementById('interaction-help');
    if (!helpEl) return;
    document.body.classList.add('gamepad-active');
    const profile = getDeviceProfile(gp);
    this.deadzone = profile.deadzone;
    this.orbitSpeed = profile.orbitSpeed;
    this.panSpeed = profile.panSpeed;
    this.zoomSpeed = profile.zoomSpeed;
    helpEl.textContent = profile.helpText;
    this.hasNotified = true;
  }

  poll = () => {
    this.rafId = requestAnimationFrame(this.poll);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    const gp = this.getConnectedGamepad();
    if (!gp) return;

    this.updateFooterHelp(gp);
    this.handleAxes(gp, dt);
    this.handleButtons(gp, dt);
  };

  applyDeadzone(val) {
    if (Math.abs(val) < this.deadzone) return 0;
    return (val - Math.sign(val) * this.deadzone) / (1 - this.deadzone);
  }

  handleAxes(gp, dt) {
    if (!camera || !controls || !controls.target) return;

    const lx = this.applyDeadzone(gp.axes[0] || 0);
    const ly = this.applyDeadzone(gp.axes[1] || 0);
    const rx = this.applyDeadzone(gp.axes[2] || 0);
    const ry = this.applyDeadzone(gp.axes[3] || 0);

    let needsRender = false;

    if (lx !== 0 || ly !== 0) {
      const offset = camera.position.clone().sub(controls.target);
      const radius = offset.length();
      if (radius > 0.001) {
        let theta = Math.atan2(offset.x, offset.z);
        let phi = Math.acos(Math.max(-1, Math.min(1, offset.y / radius)));

        theta += lx * this.orbitSpeed * dt;
        phi = Math.max(0.02, Math.min(Math.PI - 0.02, phi + ly * this.orbitSpeed * dt));

        offset.x = radius * Math.sin(phi) * Math.sin(theta);
        offset.y = radius * Math.cos(phi);
        offset.z = radius * Math.sin(phi) * Math.cos(theta);

        camera.position.copy(controls.target).add(offset);
        camera.lookAt(controls.target);
        needsRender = true;
      }
    }

    if (rx !== 0 || ry !== 0) {
      const forward = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      const panDelta = right.multiplyScalar(rx * this.panSpeed * dt).add(up.multiplyScalar(-ry * this.panSpeed * dt));

      camera.position.add(panDelta);
      controls.target.add(panDelta);
      needsRender = true;
    }

    if (needsRender) {
      requestRender();
    }
  }

  handleButtons(gp, dt) {
    if (!gp.buttons) return;

    const isPressed = (idx) => {
      const btn = gp.buttons[idx];
      return btn ? (typeof btn === 'object' ? btn.pressed : btn > 0.5) : false;
    };

    const getVal = (idx) => {
      const btn = gp.buttons[idx];
      return btn ? (typeof btn === 'object' ? btn.value : btn) : 0;
    };

    const justPressed = (idx) => {
      const pressed = isPressed(idx);
      const was = !!this.prevButtons[idx];
      this.prevButtons[idx] = pressed;
      return pressed && !was;
    };

    const lt = Math.max(getVal(6), isPressed(13) ? 1 : 0);
    const rt = Math.max(getVal(7), isPressed(12) ? 1 : 0);
    const zoomVal = rt - lt;

    if (Math.abs(zoomVal) > 0.05 && camera && controls && controls.target) {
      const offset = camera.position.clone().sub(controls.target);
      const currentDist = offset.length();
      const newDist = Math.max(0.08, currentDist * (1 - zoomVal * this.zoomSpeed * dt));
      offset.setLength(newDist);
      camera.position.copy(controls.target).add(offset);
      requestRender();
    }

    if (justPressed(1)) {
      if (document.body.classList.contains('cinematic-mode')) {
        document.body.classList.remove('cinematic-mode');
        document.getElementById('cinema-toggle-btn')?.classList.remove('active');
      } else {
        const dialogCancel = document.getElementById('dialog-cancel');
        const dialogBackdrop = document.getElementById('dialog-backdrop');
        if (dialogBackdrop?.classList.contains('show')) {
          dialogCancel?.click();
        } else {
          const openModal = document.querySelector('.modal-backdrop.show');
          if (openModal) {
            const closeBtn = openModal.querySelector('button[id$="-cancel"], button[id$="-close"], button[id$="-close-x"]');
            if (closeBtn) closeBtn.click();
            else openModal.classList.remove('show');
          } else {
            const openPopover = document.querySelector('.ui-popover:not([hidden])');
            if (openPopover) {
              openPopover.hidden = true;
            } else {
              if (window.pywebview?.api?.close_app) {
                window.pywebview.api.close_app();
              } else {
                window.close();
              }
            }
          }
        }
      }
    }

    if (justPressed(9) || justPressed(11)) {
      resetView(activeMeshes);
    }

    if (justPressed(2)) {
      toggleWireframe();
      requestRender();
    }

    if (justPressed(3)) {
      document.body.classList.toggle('cinematic-mode');
    }

    if (justPressed(4) || justPressed(5)) {
      rotateModelQuarterTurn(activeMeshes);
    }

    if (justPressed(8)) {
      toggleGrid();
    }

    if (justPressed(14)) {
      this.cycleDockTab(-1);
    } else if (justPressed(15)) {
      this.cycleDockTab(1);
    }
  }

  cycleDockTab(direction) {
    if (!this.dockTabList || this.dockTabList.length === 0) return;
    this.currentDockIndex = (this.currentDockIndex + direction + this.dockTabList.length) % this.dockTabList.length;
    setLeftDockTab(this.dockTabList[this.currentDockIndex]);
  }
}

export function initGamepadController() {
  return new GamepadController();
}

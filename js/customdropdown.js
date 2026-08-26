class CustomDropdown {
  static initAll(container = document) {
    const selects = container.querySelectorAll("select.mods-filter-select, select.settings-select, select.custom-dropdown-select");
    const instances = [];
    selects.forEach(select => {
      const inst = CustomDropdown.create(select);
      if (inst) instances.push(inst);
    });
    return instances;
  }

  static create(selectEl, onChange) {
    if (!selectEl) return null;

    if (selectEl._customDropdown) {
      if (onChange) selectEl._customDropdown.onChange = onChange;
      selectEl._customDropdown.update();
      return selectEl._customDropdown;
    }

    const instance = new CustomDropdown(selectEl, onChange);
    selectEl._customDropdown = instance;
    return instance;
  }

  constructor(selectEl, onChange) {
    this.selectEl = selectEl;
    this.onChange = onChange || null;
    this.wrapper = null;
    this.trigger = null;
    this.label = null;
    this.menu = null;
    this.isOpen = false;

    this.init();
  }

  init() {
    this.selectEl.style.display = "none";

    const isFullWidth = this.selectEl.classList.contains("full-width") ||
      this.selectEl.closest(".toggle-row") !== null ||
      this.selectEl.closest(".gb-filter-section") !== null;

    this.wrapper = document.createElement("div");
    this.wrapper.className = "custom-dropdown" + (isFullWidth ? " full-width" : "");
    if (this.selectEl.id) {
      this.wrapper.id = `custom-dropdown-${this.selectEl.id}`;
    }

    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "custom-dropdown-trigger";

    this.label = document.createElement("span");
    this.label.className = "custom-dropdown-label";

    const arrowSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    arrowSvg.setAttribute("class", "custom-dropdown-arrow");
    arrowSvg.setAttribute("viewBox", "0 0 24 24");
    arrowSvg.setAttribute("fill", "none");
    arrowSvg.setAttribute("stroke", "currentColor");
    arrowSvg.setAttribute("stroke-width", "2");
    arrowSvg.innerHTML = '<polyline points="6 9 12 15 18 9"></polyline>';

    this.trigger.appendChild(this.label);
    this.trigger.appendChild(arrowSvg);

    this.menu = document.createElement("div");
    this.menu.className = "custom-dropdown-menu";

    this.wrapper.appendChild(this.trigger);
    this.wrapper.appendChild(this.menu);

    if (this.selectEl.parentNode) {
      this.selectEl.parentNode.insertBefore(this.wrapper, this.selectEl.nextSibling);
    }

    this.trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggle();
    });

    this.renderOptions();

    this.selectEl.addEventListener("change", () => {
      this.updateSelection();
    });

    this._onOutsideClick = (e) => {
      if (this.wrapper && !this.wrapper.contains(e.target)) {
        this.close();
      }
    };
    document.addEventListener("click", this._onOutsideClick);

    this._onKeyDown = (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.close();
      }
    };
    document.addEventListener("keydown", this._onKeyDown);
  }

  renderOptions() {
    this.menu.innerHTML = "";
    const options = Array.from(this.selectEl.options);
    const selectedVal = this.selectEl.value;

    let activeText = "";

    options.forEach(opt => {
      const isSelected = opt.value === selectedVal;
      if (isSelected) activeText = opt.textContent;

      const item = document.createElement("div");
      item.className = "custom-dropdown-item" + (isSelected ? " active" : "");
      item.dataset.value = opt.value;

      const textSpan = document.createElement("span");
      textSpan.textContent = opt.textContent;

      const checkSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      checkSvg.setAttribute("class", "custom-dropdown-check");
      checkSvg.setAttribute("viewBox", "0 0 24 24");
      checkSvg.setAttribute("fill", "none");
      checkSvg.setAttribute("stroke", "currentColor");
      checkSvg.setAttribute("stroke-width", "2");
      checkSvg.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';

      item.appendChild(textSpan);
      item.appendChild(checkSvg);

      item.addEventListener("click", (e) => {
        e.stopPropagation();
        this.selectValue(opt.value);
      });

      this.menu.appendChild(item);
    });

    this.label.textContent = activeText || (options[0] ? options[0].textContent : "");
  }

  selectValue(value) {
    if (this.selectEl.value !== value) {
      this.selectEl.value = value;
      this.selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.updateSelection();
    this.close();
    if (typeof this.onChange === "function") {
      this.onChange(value);
    }
  }

  updateSelection() {
    const selectedVal = this.selectEl.value;
    let activeText = "";

    const items = this.menu.querySelectorAll(".custom-dropdown-item");
    items.forEach(item => {
      if (item.dataset.value === selectedVal) {
        item.classList.add("active");
        activeText = item.querySelector("span") ? item.querySelector("span").textContent : "";
      } else {
        item.classList.remove("active");
      }
    });

    if (activeText) {
      this.label.textContent = activeText;
    }
  }

  setValue(value) {
    this.selectEl.value = value;
    this.updateSelection();
  }

  update() {
    this.renderOptions();
  }

  toggle() {
    if (this.isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    document.querySelectorAll(".custom-dropdown.open").forEach(el => {
      if (el !== this.wrapper) el.classList.remove("open");
    });
    this.isOpen = true;
    if (this.wrapper) this.wrapper.classList.add("open");
  }

  close() {
    this.isOpen = false;
    if (this.wrapper) this.wrapper.classList.remove("open");
  }

  destroy() {
    document.removeEventListener("click", this._onOutsideClick);
    document.removeEventListener("keydown", this._onKeyDown);
    if (this.wrapper && this.wrapper.parentNode) {
      this.wrapper.parentNode.removeChild(this.wrapper);
    }
    this.selectEl.style.display = "";
    delete this.selectEl._customDropdown;
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = CustomDropdown;
}

const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");

class SideMenuDownload {
  constructor(options = {}) {
    this.containerId = options.containerId || "gb-drawer-container";
    this.onFilterChange = options.onFilterChange || (() => { });
    this.onNsfwChange = options.onNsfwChange || (() => { });
    this.t = options.t || ((k) => k);
    this.currentLang = options.language || "ru";

    this.selectedCategoryId = null;
    this.selectedCategoryName = null;
    this.selectedSort = options.currentSort || "default";
    this.nsfwMode = options.nsfwMode || "hide";
    this.isOpen = false;

    this.configDir = path.join(os.homedir(), ".config", "wzmm");
    this.cacheDir = path.join(this.configDir, "cache");
    this.iconsDir = path.join(this.cacheDir, "icons");
    this.subcatsCacheFile = path.join(this.cacheDir, "subcategories.json");

    if (!fs.existsSync(this.iconsDir)) {
      fs.mkdirSync(this.iconsDir, { recursive: true });
    }

    this.rootCategories = [];
    this.characters = [];
    this.bangboo = [];
    this.charactersI18n = {};

    this._onKeyDown = (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.toggle(false);
      }
    };

    this.loadCharactersI18n();
    this.loadInitialCatalog();
  }

  loadCharactersI18n() {
    try {
      const i18nPath = path.join(__dirname, "..", "locales", "characters.json");
      if (fs.existsSync(i18nPath)) {
        this.charactersI18n = JSON.parse(fs.readFileSync(i18nPath, "utf-8"));
      }
    } catch (e) { }
  }

  getLocalizedName(engName) {
    if (!engName) return "";
    const lang = this.currentLang || "ru";
    if (this.charactersI18n[lang] && this.charactersI18n[lang][engName]) {
      return this.charactersI18n[lang][engName];
    }
    return engName;
  }

  loadInitialCatalog() {
    try {
      const defaultDataPath = path.join(__dirname, "..", "data", "categories.json");
      if (fs.existsSync(defaultDataPath)) {
        const baseData = JSON.parse(fs.readFileSync(defaultDataPath, "utf-8"));
        this.rootCategories = baseData.rootCategories || [];
        this.characters = baseData.characters || [];
        this.bangboo = baseData.bangboo || [];
      }

      if (fs.existsSync(this.subcatsCacheFile)) {
        const cached = JSON.parse(fs.readFileSync(this.subcatsCacheFile, "utf-8"));
        if (cached.characters && cached.characters.length > 0) {
          const map = new Map();
          this.characters.forEach(c => map.set(c.id, c));
          cached.characters.forEach(c => {
            if (!map.has(c.id)) map.set(c.id, c);
          });
          this.characters = Array.from(map.values());
        }
        if (cached.bangboo && cached.bangboo.length > 0) {
          const map = new Map();
          this.bangboo.forEach(b => map.set(b.id, b));
          cached.bangboo.forEach(b => {
            if (!map.has(b.id)) map.set(b.id, b);
          });
          this.bangboo = Array.from(map.values());
        }
      }
      this.saveSubcategoriesCache();
    } catch (e) { }
  }

  saveSubcategoriesCache() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(
        this.subcatsCacheFile,
        JSON.stringify({
          rootCategories: this.rootCategories,
          characters: this.characters,
          bangboo: this.bangboo
        }, null, 2),
        "utf-8"
      );
    } catch (e) { }
  }

  formatCount(count) {
    if (typeof count !== "number" || isNaN(count)) return "";
    if (count < 1000) return String(count);
    const inK = count / 1000;
    return inK.toFixed(1).replace(/\.0$/, "") + "k";
  }

  getCachedIconPath(url) {
    if (!url || typeof url !== "string") return null;
    const cleanUrl = url.split("?")[0];
    const fileName = path.basename(cleanUrl) || "icon.png";
    const localPath = path.join(this.iconsDir, fileName);

    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 100) {
      return `file://${localPath.replace(/\\/g, "/")}`;
    }

    this.downloadIconAsync(url, localPath);
    return url;
  }

  downloadIconAsync(url, destPath) {
    if (!url.startsWith("http")) return;
    try {
      https.get(url, { headers: { "User-Agent": "WZMM-Client/1.0" } }, (res) => {
        if (res.statusCode === 200) {
          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);
        }
      }).on("error", () => { });
    } catch (e) { }
  }

  init() {
    this.render();
    this.fetchRootCategories();
  }

  async fetchRootCategories() {
    try {
      const res = await new Promise((resolve) => {
        https.get("https://gamebanana.com/apiv11/Game/19567/ProfilePage", { headers: { "User-Agent": "WZMM-Client/1.0" } }, (response) => {
          let data = "";
          response.on("data", c => data += c);
          response.on("end", () => {
            try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
          });
        }).on("error", () => resolve(null));
      });

      if (res && res._aModRootCategories && Array.isArray(res._aModRootCategories)) {
        this.rootCategories = res._aModRootCategories.map(cat => ({
          id: cat._idRow,
          name: cat._sName,
          modCount: cat._nItemCount,
          subcatCount: cat._nCategoryCount,
          iconUrl: cat._sIconUrl
        }));
        this.saveSubcategoriesCache();
        this.updateSubcategoriesListUI();
      }
    } catch (e) { }
  }

  discoverNewSubcategories(modRecords) {
    if (!Array.isArray(modRecords)) return;
    let hasNew = false;

    for (const mod of modRecords) {
      if (mod._aSubCategory && mod._aSubCategory._sProfileUrl && mod._aSubCategory._sName) {
        const match = mod._aSubCategory._sProfileUrl.match(/cats\/(\d+)/);
        if (match) {
          const subId = parseInt(match[1]);
          if ([30305, 30702, 29874, 30395].includes(subId)) continue;
          const subName = mod._aSubCategory._sName.trim();
          if (!subName || subName.length < 2) continue;
          const subIcon = mod._aSubCategory._sIconUrl || "";
          const rootName = mod._aRootCategory ? mod._aRootCategory._sName : "Character Skins";

          const isBangboo = rootName.toLowerCase().includes("bangboo") || subName.toLowerCase().includes("boo");
          const targetList = isBangboo ? this.bangboo : this.characters;

          const exists = targetList.some(item => item.id === subId || item.name.toLowerCase() === subName.toLowerCase());
          if (!exists) {
            targetList.push({
              id: subId,
              name: subName,
              iconUrl: subIcon || (isBangboo ? "https://images.gamebanana.com/img/ico/ModCategory/669c13bb037b1.png" : "https://images.gamebanana.com/img/ico/ModCategory/66a1928c3e239.gif")
            });
            targetList.sort((a, b) => a.name.localeCompare(b.name));
            hasNew = true;
          }
        }
      }
    }

    if (hasNew) {
      this.saveSubcategoriesCache();
      this.updateSubcategoriesListUI();
    }
  }

  render() {
    if (typeof document === "undefined") return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const t = this.t;

    container.innerHTML = `
      <div class="gb-drawer-backdrop ${this.isOpen ? "open" : ""}" id="gb-drawer-backdrop"></div>
      <aside class="gb-drawer ${this.isOpen ? "open" : ""}" id="gb-drawer">
        <div class="gb-drawer-header">
          <div class="gb-drawer-title-box">
            <svg class="gb-drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            <span class="gb-drawer-title">${t("gb_filter_drawer_title")}</span>
          </div>
          <button class="gb-drawer-close-btn" id="gb-drawer-close-btn" title="✕">✕</button>
        </div>

        <div class="gb-drawer-body">
          <div class="gb-filter-section">
            <label class="gb-filter-label">${t("gb_filter_sort_title")}</label>
            <div class="select-wrapper">
              <select id="gb-drawer-sort" class="mods-filter-select">
                <option value="default" ${this.selectedSort === "default" ? "selected" : ""}>${t("gb_sort_default")}</option>
                <option value="new" ${this.selectedSort === "new" ? "selected" : ""}>${t("gb_sort_new")}</option>
                <option value="updated" ${this.selectedSort === "updated" ? "selected" : ""}>${t("gb_sort_updated")}</option>
                <option value="downloads" ${this.selectedSort === "downloads" ? "selected" : ""}>${t("gb_sort_downloads")}</option>
                <option value="views" ${this.selectedSort === "views" ? "selected" : ""}>${t("gb_sort_views")}</option>
                <option value="likes" ${this.selectedSort === "likes" ? "selected" : ""}>${t("gb_sort_likes")}</option>
              </select>
            </div>
          </div>

          <div class="gb-filter-section">
            <label class="gb-filter-label">${t("gb_filter_nsfw_title")}</label>
            <div class="select-wrapper">
              <select id="gb-drawer-nsfw" class="mods-filter-select">
                <option value="hide" ${this.nsfwMode === "hide" ? "selected" : ""}>${t("gb_filter_nsfw_hide")}</option>
                <option value="blur" ${this.nsfwMode === "blur" ? "selected" : ""}>${t("gb_filter_nsfw_blur")}</option>
                <option value="show" ${this.nsfwMode === "show" ? "selected" : ""}>${t("gb_filter_nsfw_show")}</option>
              </select>
            </div>
          </div>

          <div class="gb-filter-section">
            <div class="gb-section-header">
              <label class="gb-filter-label">${t("gb_filter_categories_title")}</label>
              <button class="gb-reset-filter-btn" id="gb-reset-filter-btn" style="display: ${this.selectedCategoryId !== null ? "block" : "none"};">${t("gb_filter_reset")}</button>
            </div>

            <div class="gb-cat-nav-item ${this.selectedCategoryId === null ? "active" : ""}" data-id="all">
              <div class="gb-cat-left">
                <span class="gb-cat-icon-emoji">📁</span>
                <span class="gb-cat-nav-name">${t("gb_filter_all_cats")}</span>
              </div>
            </div>

            <div class="gb-subcat-search-box">
              <input type="text" id="gb-drawer-search" class="gb-subcat-search-input" placeholder="${t("gb_filter_search_char")}">
            </div>

            <div class="gb-categories-tree" id="gb-categories-tree">
              ${this.renderCategoriesTreeHtml()}
            </div>
          </div>
        </div>
      </aside>
    `;

    this.attachEvents();
  }

  renderCategoriesTreeHtml() {
    return this.rootCategories.map(rootCat => {
      const isCharSkins = rootCat.id === 30305;
      const isBangboo = rootCat.id === 30702;
      const isRootActive = this.selectedCategoryId === rootCat.id;
      const iconSrc = this.getCachedIconPath(rootCat.iconUrl);
      const formattedModCount = this.formatCount(rootCat.modCount);
      const locRootName = this.getLocalizedName(rootCat.name);

      let subListHtml = "";
      if (isCharSkins) {
        subListHtml = `
          <div class="gb-subcat-group" id="gb-char-subcats">
            ${this.characters.map(c => {
          const cIcon = this.getCachedIconPath(c.iconUrl) || "https://images.gamebanana.com/img/ico/ModCategory/66a1928c3e239.gif";
          const isActive = this.selectedCategoryId === c.id;
          const locName = this.getLocalizedName(c.name);
          const count = this.formatCount(c.modCount);
          return `
                <div class="gb-subcat-row ${isActive ? "active" : ""}" data-id="${c.id}" data-name="${c.name}" data-localized-name="${locName}">
                  <div class="gb-subcat-left">
                    <img class="gb-avatar-img" src="${cIcon}" alt="" onerror="this.onerror=null; this.src='https://images.gamebanana.com/img/ico/ModCategory/66a1928c3e239.gif';">
                    <span class="gb-subcat-name">${locName}</span>
                  </div>
                  ${count !== undefined && count !== null && count !== "" ? `<span class="gb-mod-count-badge">${count}</span>` : ""}
                </div>
              `;
        }).join("")}
          </div>
        `;
      } else if (isBangboo) {
        subListHtml = `
          <div class="gb-subcat-group" id="gb-bangboo-subcats">
            ${this.bangboo.map(b => {
          const bIcon = this.getCachedIconPath(b.iconUrl) || "https://images.gamebanana.com/img/ico/ModCategory/669c13bb037b1.png";
          const isActive = this.selectedCategoryId === b.id;
          const locName = this.getLocalizedName(b.name);
          const count = this.formatCount(b.modCount);
          return `
                <div class="gb-subcat-row ${isActive ? "active" : ""}" data-id="${b.id}" data-name="${b.name}" data-localized-name="${locName}">
                  <div class="gb-subcat-left">
                    <img class="gb-avatar-img" src="${bIcon}" alt="" onerror="this.onerror=null; this.src='https://images.gamebanana.com/img/ico/ModCategory/669c13bb037b1.png';">
                    <span class="gb-subcat-name">${locName}</span>
                  </div>
                  ${count !== undefined && count !== null && count !== "" ? `<span class="gb-mod-count-badge">${count}</span>` : ""}
                </div>
              `;
        }).join("")}
          </div>
        `;
      }

      return `
        <div class="gb-category-node ${(isCharSkins || isBangboo) ? "has-sub" : ""} ${isCharSkins ? "expanded" : ""}">
          <div class="gb-category-row ${isRootActive ? "active" : ""}" data-id="${rootCat.id}" data-name="${rootCat.name}" data-localized-name="${locRootName}">
            <div class="gb-cat-left">
              ${iconSrc ? `<img class="gb-root-icon-img" src="${iconSrc}" alt="" onerror="this.style.display='none'">` : `<span class="gb-cat-icon-emoji">📂</span>`}
              <span class="gb-category-name">${locRootName}</span>
            </div>
            <div class="gb-cat-right">
              ${formattedModCount ? `<span class="gb-mod-count-badge">${formattedModCount}</span>` : ""}
              ${(isCharSkins || isBangboo) ? `<button class="gb-node-arrow" type="button">▼</button>` : ""}
            </div>
          </div>
          ${subListHtml}
        </div>
      `;
    }).join("");
  }

  updateSubcategoriesListUI() {
    if (typeof document === "undefined") return;
    const container = document.getElementById(this.containerId);
    if (!container) return;
    const tree = container.querySelector("#gb-categories-tree");
    if (tree) {
      tree.innerHTML = this.renderCategoriesTreeHtml();
      this.attachTreeEvents();
    }
  }

  attachEvents() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const backdrop = container.querySelector("#gb-drawer-backdrop");
    const closeBtn = container.querySelector("#gb-drawer-close-btn");

    if (backdrop) backdrop.addEventListener("click", () => this.toggle(false));
    if (closeBtn) closeBtn.addEventListener("click", () => this.toggle(false));

    const sortSelect = container.querySelector("#gb-drawer-sort");
    if (sortSelect) {
      sortSelect.addEventListener("change", (e) => {
        this.selectedSort = e.target.value;
        this.triggerFilterChange();
      });
    }

    const nsfwSelect = container.querySelector("#gb-drawer-nsfw");
    if (nsfwSelect) {
      nsfwSelect.addEventListener("change", (e) => {
        this.nsfwMode = e.target.value;
        if (typeof this.onNsfwChange === "function") {
          this.onNsfwChange(this.nsfwMode);
        }
        this.triggerFilterChange();
      });
    }

    const allBtn = container.querySelector('[data-id="all"]');
    if (allBtn) {
      allBtn.addEventListener("click", () => {
        this.setCategory(null, null);
      });
    }

    const resetBtn = container.querySelector("#gb-reset-filter-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this.setCategory(null, null);
      });
    }

    const searchInput = container.querySelector("#gb-drawer-search");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        const val = e.target.value.toLowerCase().trim();
        const nodes = container.querySelectorAll(".gb-category-node");

        nodes.forEach(node => {
          const subRows = node.querySelectorAll(".gb-subcat-row");
          if (subRows.length > 0) {
            let matchedCount = 0;
            subRows.forEach(row => {
              const name = (row.dataset.name || "").toLowerCase();
              const locName = (row.dataset.localizedName || "").toLowerCase();
              const matches = !val || name.includes(val) || locName.includes(val);
              row.style.display = matches ? "flex" : "none";
              if (matches) matchedCount++;
            });

            if (val) {
              if (matchedCount > 0) {
                node.classList.add("expanded");
                node.style.display = "flex";
              } else {
                node.style.display = "none";
              }
            } else {
              node.style.display = "flex";
            }
          } else {
            const row = node.querySelector(".gb-category-row");
            const name = (row ? row.dataset.name || "" : "").toLowerCase();
            const locName = (row ? row.dataset.localizedName || "" : "").toLowerCase();
            const matches = !val || name.includes(val) || locName.includes(val);
            node.style.display = matches ? "flex" : "none";
          }
        });
      });
    }

    this.attachTreeEvents();

    if (typeof CustomDropdown !== "undefined") {
      CustomDropdown.initAll(container);
    }
  }

  attachTreeEvents() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const rootRows = container.querySelectorAll(".gb-category-row");
    rootRows.forEach(row => {
      row.addEventListener("click", (e) => {
        const catId = parseInt(row.dataset.id);
        const catName = row.dataset.name;
        const locName = row.dataset.localizedName || catName;
        const node = row.closest(".gb-category-node");

        if (e.target.closest(".gb-node-arrow")) {
          if (node) node.classList.toggle("expanded");
          return;
        }

        if (node && (catId === 30305 || catId === 30702)) {
          node.classList.add("expanded");
        }

        this.setCategory(catId, locName);
      });
    });

    const subcatRows = container.querySelectorAll(".gb-subcat-row");
    subcatRows.forEach(row => {
      row.addEventListener("click", () => {
        const subId = parseInt(row.dataset.id);
        const locName = row.dataset.localizedName || row.dataset.name;
        this.setCategory(subId, locName);
      });
    });
  }

  setCategory(id, name) {
    this.selectedCategoryId = id;
    this.selectedCategoryName = name;

    if (typeof document !== "undefined") {
      const container = document.getElementById(this.containerId);
      if (container) {
        container.querySelectorAll(".gb-cat-nav-item, .gb-category-row, .gb-subcat-row").forEach(el => {
          el.classList.remove("active");
        });

        if (id === null) {
          const allBtn = container.querySelector('[data-id="all"]');
          if (allBtn) allBtn.classList.add("active");
        } else {
          const active = container.querySelector(`[data-id="${id}"]`);
          if (active) {
            active.classList.add("active");
            const parentNode = active.closest(".gb-category-node");
            if (parentNode) parentNode.classList.add("expanded");
          }
        }

        const resetBtn = container.querySelector("#gb-reset-filter-btn");
        if (resetBtn) {
          resetBtn.style.display = id === null ? "none" : "block";
        }
      }
    }

    this.triggerFilterChange();
  }

  triggerFilterChange() {
    if (typeof this.onFilterChange === "function") {
      this.onFilterChange({
        categoryId: this.selectedCategoryId,
        categoryName: this.selectedCategoryName,
        sort: this.selectedSort,
        nsfwMode: this.nsfwMode
      });
    }
  }

  toggle(openState) {
    this.isOpen = typeof openState === "boolean" ? openState : !this.isOpen;

    if (typeof window !== "undefined") {
      if (this.isOpen) {
        window.addEventListener("keydown", this._onKeyDown);
      } else {
        window.removeEventListener("keydown", this._onKeyDown);
      }
    }

    if (typeof document !== "undefined") {
      const container = document.getElementById(this.containerId);
      if (container) {
        const drawer = container.querySelector("#gb-drawer");
        const backdrop = container.querySelector("#gb-drawer-backdrop");
        if (drawer) drawer.classList.toggle("open", this.isOpen);
        if (backdrop) backdrop.classList.toggle("open", this.isOpen);

        if (this.isOpen) {
          const searchInput = container.querySelector("#gb-drawer-search");
          if (searchInput) {
            setTimeout(() => searchInput.focus(), 120);
          }
        }
      }

      const filterBtn = document.getElementById("gb-filter-btn");
      if (filterBtn) {
        filterBtn.classList.toggle("active", this.isOpen);
      }
    }
  }

  updateSelectedSort(sortVal) {
    this.selectedSort = sortVal;
    if (typeof document !== "undefined") {
      const sortSelect = document.getElementById("gb-drawer-sort");
      if (sortSelect) {
        sortSelect.value = sortVal;
        if (sortSelect._customDropdown) sortSelect._customDropdown.updateSelection();
      }
    }
  }
}

class InstalledFilterDrawer {
  constructor(options = {}) {
    this.containerId = options.containerId || "installed-drawer-container";
    this.onFilterChange = options.onFilterChange || (() => { });
    this.t = options.t || ((k) => k);
    this.currentLang = options.language || "ru";

    this.selectedCharacter = null;
    this.selectedCharacterId = null;
    this.selectedCharacterLocalized = null;
    this.isOpen = false;
    this.searchQuery = "";

    this.characters = [];

    this._onKeyDown = (e) => {
      if (e.key === "Escape" && this.isOpen) {
        this.toggle(false);
      }
    };
  }

  setLanguage(lang) {
    this.currentLang = lang;
  }

  setCharacters(charactersList) {
    this.characters = Array.isArray(charactersList) ? charactersList : [];
    this.updateDrawerListUI();
    this.updateActiveFilterBar();
  }

  setSelectedCharacter(charName, charId = null, localizedName = null) {
    if (!charName || charName === "all") {
      this.selectedCharacter = null;
      this.selectedCharacterId = null;
      this.selectedCharacterLocalized = null;
    } else {
      this.selectedCharacter = charName;
      this.selectedCharacterId = charId;
      this.selectedCharacterLocalized = localizedName;

      if (!this.selectedCharacterLocalized) {
        const found = this.characters.find(
          (c) => c.name.toLowerCase() === charName.toLowerCase() || (charId && c.id === charId)
        );
        if (found) {
          this.selectedCharacterLocalized = found.localizedName;
          if (!this.selectedCharacterId) this.selectedCharacterId = found.id;
        } else {
          this.selectedCharacterLocalized = charName;
        }
      }
    }

    this.updateDrawerListUI();
    this.updateActiveFilterBar();

    if (typeof this.onFilterChange === "function") {
      this.onFilterChange(this.selectedCharacter, this.selectedCharacterId);
    }
  }

  getSelectedCharacter() {
    return this.selectedCharacter;
  }

  render() {
    if (typeof document === "undefined") return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const t = this.t;

    container.innerHTML = `
      <aside class="gb-drawer ${this.isOpen ? "open" : ""}" id="installed-drawer">
        <div class="gb-drawer-header">
          <div class="gb-drawer-title-box">
            <svg class="gb-drawer-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            <span class="gb-drawer-title">${t("installed_filter_drawer_title")}</span>
          </div>
          <button class="gb-drawer-close-btn" id="installed-drawer-close-btn" title="✕">✕</button>
        </div>

        <div class="gb-drawer-body">
          <div class="gb-filter-section">
            <div class="gb-section-header">
              <label class="gb-filter-label">${t("installed_filter_characters")}</label>
              <button class="gb-reset-filter-btn" id="installed-reset-filter-btn" style="display: ${this.selectedCharacter !== null ? "block" : "none"};">${t("gb_filter_reset")}</button>
            </div>

            <div class="gb-cat-nav-item ${this.selectedCharacter === null ? "active" : ""}" data-name="all">
              <div class="gb-cat-left">
                <span class="gb-cat-icon-emoji">📁</span>
                <span class="gb-cat-nav-name">${t("installed_filter_char_all")}</span>
              </div>
              <span class="gb-mod-count-badge" id="installed-total-count-badge">0</span>
            </div>

            <div class="gb-subcat-search-box">
              <input type="text" id="installed-drawer-search" class="gb-subcat-search-input" placeholder="${t("installed_filter_search_char")}">
            </div>

            <div class="gb-categories-list" id="installed-categories-list">
              ${this.renderListHtml()}
            </div>
          </div>
        </div>
      </aside>
    `;

    this.attachEvents();
    this.updateActiveFilterBar();
  }

  renderListHtml() {
    if (!this.characters || this.characters.length === 0) {
      return `<div class="gb-filter-empty">${this.t("mods_filter_empty")}</div>`;
    }

    const searchLower = (this.searchQuery || "").trim().toLowerCase();

    const filtered = this.characters.filter((c) => {
      if (!searchLower) return true;
      const inName = (c.name || "").toLowerCase().includes(searchLower);
      const inLoc = (c.localizedName || "").toLowerCase().includes(searchLower);
      return inName || inLoc;
    });

    if (filtered.length === 0) {
      return `<div class="gb-filter-empty">${this.t("gb_search_empty")}</div>`;
    }

    const defaultIcon = "https://images.gamebanana.com/img/ico/ModCategory/66a1928c3e239.gif";
    const bangbooIcon = "https://images.gamebanana.com/img/ico/ModCategory/669c13bb037b1.png";

    return filtered
      .map((c) => {
        const isSelected =
          this.selectedCharacter &&
          (this.selectedCharacter.toLowerCase() === c.name.toLowerCase() ||
            (this.selectedCharacterId && this.selectedCharacterId === c.id));

        const isBangboo = c.category === "Bangboo Skins" || c.name.toLowerCase().includes("bangboo") || c.name.toLowerCase().includes("boo");
        const fallback = isBangboo ? bangbooIcon : defaultIcon;
        const iconSrc = c.iconUrl || fallback;

        return `
        <div class="gb-subcat-row ${isSelected ? "active" : ""}" data-name="${encodeURIComponent(c.name)}" data-id="${c.id || ""}" data-loc="${encodeURIComponent(c.localizedName || c.name)}">
          <div class="gb-subcat-left">
            <img class="gb-avatar-img" src="${iconSrc}" alt="" onerror="this.onerror=null; this.src='${fallback}';">
            <span class="gb-subcat-name">${c.localizedName || c.name}</span>
          </div>
          <span class="gb-mod-count-badge">${c.count}</span>
        </div>
      `;
      })
      .join("");
  }

  updateDrawerListUI() {
    if (typeof document === "undefined") return;
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const listEl = container.querySelector("#installed-categories-list");
    if (listEl) {
      listEl.innerHTML = this.renderListHtml();
      this.attachRowEvents();
    }

    const totalBadge = container.querySelector("#installed-total-count-badge");
    if (totalBadge) {
      const totalMods = this.characters.reduce((sum, c) => sum + (c.count || 0), 0);
      totalBadge.textContent = totalMods;
    }

    const resetBtn = container.querySelector("#installed-reset-filter-btn");
    if (resetBtn) {
      resetBtn.style.display = this.selectedCharacter !== null ? "block" : "none";
    }

    const allRow = container.querySelector(".gb-cat-nav-item[data-name='all']");
    if (allRow) {
      allRow.classList.toggle("active", this.selectedCharacter === null);
    }
  }

  updateActiveFilterBar() {
    if (typeof document === "undefined") return;
    const bar = document.getElementById("installed-active-filter-bar");
    const filterBtn = document.getElementById("installed-filter-btn");
    const badge = document.getElementById("installed-filter-badge");

    if (filterBtn) {
      filterBtn.classList.toggle("has-active-filter", this.selectedCharacter !== null);
    }

    if (badge) {
      if (this.selectedCharacter !== null) {
        badge.style.display = "inline-block";
        badge.textContent = "1";
      } else {
        badge.style.display = "none";
      }
    }

    if (!bar) return;

    if (this.selectedCharacter !== null) {
      const displayName = this.selectedCharacterLocalized || this.selectedCharacter;
      bar.style.display = "flex";
      bar.innerHTML = `
        <div class="gb-filter-pill">
          <span>${this.t("installed_filter_active_tag", { name: displayName })}</span>
          <button class="gb-filter-pill-btn" id="btn-clear-char-filter" title="${this.t("gb_filter_reset")}">✕</button>
        </div>
      `;

      const clearBtn = document.getElementById("btn-clear-char-filter");
      if (clearBtn) {
        clearBtn.onclick = () => {
          this.setSelectedCharacter(null);
        };
      }
    } else {
      bar.style.display = "none";
      bar.innerHTML = "";
    }
  }

  attachEvents() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const backdrop = container.querySelector("#installed-drawer-backdrop");
    const closeBtn = container.querySelector("#installed-drawer-close-btn");
    const searchInput = container.querySelector("#installed-drawer-search");
    const allNav = container.querySelector(".gb-cat-nav-item[data-name='all']");
    const resetBtn = container.querySelector("#installed-reset-filter-btn");

    if (backdrop) backdrop.addEventListener("click", () => this.toggle(false));
    if (closeBtn) closeBtn.addEventListener("click", () => this.toggle(false));

    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        this.setSelectedCharacter(null);
      });
    }

    if (allNav) {
      allNav.addEventListener("click", () => {
        this.setSelectedCharacter(null);
        this.toggle(false);
      });
    }

    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        this.searchQuery = e.target.value;
        this.updateDrawerListUI();
      });
    }

    this.attachRowEvents();
  }

  attachRowEvents() {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const rows = container.querySelectorAll(".gb-subcat-row");
    rows.forEach((row) => {
      row.addEventListener("click", () => {
        const rawName = decodeURIComponent(row.dataset.name);
        const rawLoc = decodeURIComponent(row.dataset.loc || rawName);
        const rawId = row.dataset.id ? parseInt(row.dataset.id) : null;

        this.setSelectedCharacter(rawName, rawId, rawLoc);
        this.toggle(false);
      });
    });
  }

  toggle(forceState) {
    this.isOpen = typeof forceState === "boolean" ? forceState : !this.isOpen;

    if (typeof window !== "undefined") {
      if (this.isOpen) {
        window.addEventListener("keydown", this._onKeyDown);
      } else {
        window.removeEventListener("keydown", this._onKeyDown);
      }
    }

    if (typeof document !== "undefined") {
      const container = document.getElementById(this.containerId);
      const pageContainer = document.querySelector(".installed-page-container");

      if (pageContainer) {
        pageContainer.classList.toggle("installed-filter-open", this.isOpen);
      }

      if (container) {
        const drawer = container.querySelector("#installed-drawer");
        if (drawer) drawer.classList.toggle("open", this.isOpen);

        if (this.isOpen) {
          const searchInput = container.querySelector("#installed-drawer-search");
          if (searchInput) {
            setTimeout(() => searchInput.focus(), 120);
          }
        }
      }

      const filterBtn = document.getElementById("installed-filter-btn");
      if (filterBtn) {
        filterBtn.classList.toggle("active", this.isOpen);
      }
    }
  }
}

module.exports = { SideMenuDownload, InstalledFilterDrawer };

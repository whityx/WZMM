const fs = require("fs");
const path = require("path");
const os = require("os");
const { shell, webUtils } = require("electron");
const https = require("https");
const http = require("http");

let AdmZip = null;
try {
  AdmZip = require("adm-zip");
} catch (e) {}

const configDir = path.join(os.homedir(), ".config", "wzmm");
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

const settingsFilePath = path.join(configDir, "settings.json");

const ModManager = require(path.join(__dirname, "js", "modManager.js"));
const startOpt = require(path.join(__dirname, "js", "startopt.js"));
const modManager = new ModManager();

const activeDownloads = {};

// ===== Локализация =====
let translations = {};
const loadTranslations = (lang) => {
  // Защита от старых неверных значений. По умолчанию теперь English ("en")
  if (lang !== "ru" && lang !== "en") {
    lang = "en";
  }

  // __dirname указывает на корень, где лежит index.html
  let localePath = path.join(__dirname, "locales", `${lang}.json`);
  
  if (!fs.existsSync(localePath)) {
    // Резервный вариант поиска (если пути Electron сдвинуты)
    localePath = path.join(process.cwd(), "locales", `${lang}.json`);
  }

  try {
    if (fs.existsSync(localePath)) {
      translations = JSON.parse(fs.readFileSync(localePath, "utf-8"));
    } else {
      console.warn(`Файл локализации не найден: ${localePath}`);
    }
  } catch (e) {
    console.error("Ошибка загрузки локализации", e);
  }
};

const t = (key, params = {}) => {
  let str = translations[key] || key;
  for (const [k, v] of Object.entries(params)) {
    str = str.replace(`{${k}}`, v);
  }
  return str;
};

const applyTranslationsToDOM = (container) => {
  container.querySelectorAll("[data-i18n-text]").forEach(el => {
    const key = el.getAttribute("data-i18n-text");
    if (translations[key]) el.textContent = translations[key];
  });
  container.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    const key = el.getAttribute("data-i18n-placeholder");
    if (translations[key]) el.placeholder = translations[key];
  });
  container.querySelectorAll("[data-i18n-title]").forEach(el => {
    const key = el.getAttribute("data-i18n-title");
    if (translations[key]) el.title = translations[key];
  });
};
// =======================

const timeAgo = (timestamp) => {
  if (!timestamp) return "N/A";
  const seconds = Math.floor(Date.now() / 1000 - parseInt(timestamp, 10));
  if (seconds < 60) return `${Math.max(seconds, 0)}${t('time_s')}`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}${t('time_m')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}${t('time_h')}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}${t('time_d')}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}${t('time_mo')}`;
  return `${Math.floor(months / 12)}${t('time_y')}`;
};

const abbreviateCount = (value) => {
  const num = parseInt(value, 10);
  if (isNaN(num) || num === 0) return "0";
  if (num >= 1000000)
    return (num / 1000000).toFixed(1).replace(/\.0$/, "") + "m";
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return num.toString();
};

const htmlCache = {};
const cssCache = {};
const pageCssMap = {};

const prefetchPages = async () => {
  const pages = ["installed", "download", "downloads", "settings"];
  await Promise.all(
    pages.map(async (p) => {
      try {
        const res = await fetch(`pages/${p}.html`);
        let html = await res.text();

        const linkRegex = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi;
        let match;
        let combinedCss = "";

        while ((match = linkRegex.exec(html)) !== null) {
          const cssUrl = match[1];
          if (!cssCache[cssUrl]) {
            const cssRes = await fetch(cssUrl);
            let cssText = await cssRes.text();
            cssText = cssText.replace(
              /@import\s+url\(['"]?base\.css['"]?\);?/gi,
              "",
            );
            cssCache[cssUrl] = cssText;
          }
          combinedCss += cssCache[cssUrl] + "\n";
        }

        html = html.replace(linkRegex, "");

        htmlCache[p] = html;
        pageCssMap[p] = combinedCss;
      } catch (e) {
        console.error(`Ошибка предзагрузки ${p}.html`, e);
      }
    }),
  );
};
prefetchPages();

document.addEventListener("DOMContentLoaded", () => {
  const menuItems = document.querySelectorAll(".sidebar-item");
  const contentContainer = document.getElementById("content-container");
  const sidebar = document.querySelector(".sidebar");
  const indicator = document.getElementById("sidebar-indicator");

  let currentSettings = getSettings();
  // Загружаем язык (по умолчанию en)
  loadTranslations(currentSettings.language || "en");
  applyTranslationsToDOM(document.body);

  let currentModFilter = "all";
  let currentSearchQuery = "";

  const moveIndicator = (activeItem) => {
    if (!indicator || !activeItem || !sidebar) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    indicator.style.width = `${itemRect.width}px`;
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.left = `${itemRect.left - sidebarRect.left}px`;
    indicator.style.top = `${itemRect.top - sidebarRect.top}px`;

    if (activeItem.animate) {
      activeItem.animate(
        [{ transform: "scale(0.92)" }, { transform: "scale(1)" }],
        { duration: 400, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
      );
    }
  };

  window.addEventListener("resize", () => {
    const activeItem = document.querySelector(".sidebar-item.active");
    if (activeItem) moveIndicator(activeItem);
  });

  const customConfirm = (message, onConfirm) => {
    let modal = document.getElementById("custom-confirm-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "custom-confirm-modal";
      modal.className = "modal-overlay custom-confirm-overlay";
      modal.innerHTML = `
                <div class="modal-content confirm-box">
                    <div class="confirm-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                    </div>
                    <h3 class="modal-title">${t('confirm_title')}</h3>
                    <p id="custom-confirm-msg" class="modal-text"></p>
                    <div class="confirm-actions">
                        <button id="custom-confirm-cancel" class="btn-secondary">${t('confirm_cancel')}</button>
                        <button id="custom-confirm-ok" class="btn-danger">${t('confirm_delete')}</button>
                    </div>
                </div>
            `;
      document.body.appendChild(modal);
    }

    document.getElementById("custom-confirm-msg").textContent = message;
    modal.style.display = "flex";

    const confirmBox = modal.querySelector(".confirm-box");
    confirmBox.style.animation = "none";
    void confirmBox.offsetWidth;
    confirmBox.style.animation =
      "modalFadeIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards";

    const btnOk = document.getElementById("custom-confirm-ok");
    const btnCancel = document.getElementById("custom-confirm-cancel");

    const newBtnOk = btnOk.cloneNode(true);
    const newBtnCancel = btnCancel.cloneNode(true);
    btnOk.replaceWith(newBtnOk);
    btnCancel.replaceWith(newBtnCancel);

    newBtnOk.onclick = () => {
      modal.style.display = "none";
      onConfirm();
    };
    newBtnCancel.onclick = () => {
      modal.style.display = "none";
    };

    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = "none";
    };
  };

  const loadPage = async (pageName) => {
    try {
      let html = htmlCache[pageName];
      let css = pageCssMap[pageName];

      if (html === undefined) {
        const response = await fetch(`pages/${pageName}.html`);
        if (!response.ok) throw new Error(t('err_page_load'));
        html = await response.text();

        const linkRegex = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi;
        let match;
        css = "";

        while ((match = linkRegex.exec(html)) !== null) {
          const cssUrl = match[1];
          const cssRes = await fetch(cssUrl);
          let cssText = await cssRes.text();
          cssText = cssText.replace(
            /@import\s+url\(['"]?base\.css['"]?\);?/gi,
            "",
          );
          css += cssText + "\n";
        }
        html = html.replace(linkRegex, "");

        htmlCache[pageName] = html;
        pageCssMap[pageName] = css;
      }

      let styleTag = document.getElementById("dynamic-page-styles");
      if (!styleTag) {
        styleTag = document.createElement("style");
        styleTag.id = "dynamic-page-styles";
        document.head.appendChild(styleTag);
      }
      if (styleTag.textContent !== css) {
        styleTag.textContent = css;
      }

      contentContainer.innerHTML = html;
      
      // Сразу переводим контент вставленной страницы
      applyTranslationsToDOM(contentContainer);

      if (pageName === "settings") initSettings();
      if (pageName === "installed") initInstalledMods();
      if (pageName === "download") initGameBananaCatalog();
      if (pageName === "downloads") initDownloadsTab();
    } catch (error) {
      contentContainer.innerHTML = `<h2 style="color: var(--color-red);">${t('err_page_load')}</h2>`;
    }
  };

  function getSettings() {
    // По умолчанию язык теперь английский
    const defaultSettings = { nsfwMode: "show", language: "en" };

    if (!fs.existsSync(settingsFilePath)) {
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(defaultSettings, null, 4),
        "utf-8",
      );
    }

    try {
      let settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf-8"));
      
      // Защита: если сохранен мусор, сбрасываем на 'en'
      if (settings.language !== "ru" && settings.language !== "en") {
        settings.language = "en";
      }
      
      return settings;
    } catch (e) {
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(defaultSettings, null, 4),
        "utf-8",
      );
      return defaultSettings;
    }
  }

  const initInstalledMods = () => {
    const filterSelect = document.getElementById("mods-filter");
    const searchInput = document.getElementById("mods-search");
    if (filterSelect) {
      filterSelect.value = currentModFilter;
      filterSelect.onchange = (e) => {
        currentModFilter = e.target.value;
        renderModsGrid();
      };
    }
    if (searchInput) {
      searchInput.value = currentSearchQuery;
      searchInput.oninput = (e) => {
        currentSearchQuery = e.target.value;
        renderModsGrid();
      };
    }
    renderModsGrid();
    initModalLogic();
  };

  const renderModsGrid = () => {
    const grid = document.getElementById("mods-grid");
    const emptyState = document.getElementById("mods-empty-state");
    if (!grid || !emptyState) return;

    const { validPath, totalCount, mods } = modManager.getMods(
      currentSettings.xxmiPath,
      currentModFilter,
      currentSearchQuery,
    );

    if (!validPath || totalCount === 0) {
      grid.innerHTML = "";
      emptyState.textContent = t('mods_not_found');
      emptyState.style.display = "block";
      return;
    }

    if (mods.length === 0) {
      grid.innerHTML = "";
      emptyState.textContent = t('mods_filter_empty');
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    grid.innerHTML = "";

    mods.forEach((mod, index) => {
      const card = document.createElement("div");
      card.className = "mod-card";
      card.style.setProperty("--card-opacity", mod.active ? "1" : "0.6");
      card.style.animationDelay = `${Math.min(index, 12) * 0.025}s`;

      const iconActive = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
      const iconInactive = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.83 9L15 12.16V12a3 3 0 0 0-3-3h-.17zm-4.3.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
      const iconDelete = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

      let bgStyle = "";
      if (mod.previewUrl) {
        const safeUrl = encodeURI(mod.previewUrl)
          .replace(/'/g, "%27")
          .replace(/"/g, "%22");
        bgStyle = `background-image: url('${safeUrl}');`;
      }

      card.innerHTML = `
                <div class="mod-preview" style="${bgStyle} cursor: pointer;">
                    ${mod.previewUrl ? "" : `<div class="mod-placeholder">${t('mod_no_photo')}</div>`}
                </div>
                <div class="mod-footer">
                    <button class="mod-toggle-btn ${mod.active ? "active" : ""}" title="${mod.active ? t('mod_turn_off') : t('mod_turn_on')}">
                        ${mod.active ? iconActive : iconInactive}
                    </button>
                    <div class="mod-name-container">
                        <div class="mod-name" title="${mod.name}">${mod.name}</div>
                    </div>
                    <button class="mod-delete-btn" title="${t('mod_delete_forever')}">
                        ${iconDelete}
                    </button>
                </div>
            `;

      card
        .querySelector(".mod-preview")
        .addEventListener("click", () => openModModal(mod));

      const toggleBtn = card.querySelector(".mod-toggle-btn");
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const success = modManager.toggleMod(
          currentSettings.xxmiPath,
          mod.name,
          mod.active,
        );
        if (success) {
          mod.active = !mod.active;
          const shouldBeRemoved =
            (currentModFilter === "active" && !mod.active) ||
            (currentModFilter === "inactive" && mod.active);
          if (shouldBeRemoved) renderModsGrid();
          else {
            card.style.animation = "none";
            card.style.setProperty("--card-opacity", mod.active ? "1" : "0.6");
            toggleBtn.className = `mod-toggle-btn ${mod.active ? "active" : ""}`;
            toggleBtn.title = mod.active ? t('mod_turn_off') : t('mod_turn_on');
            toggleBtn.innerHTML = mod.active ? iconActive : iconInactive;
          }
        } else
          alert(t('mod_move_err'));
      });

      const deleteBtn = card.querySelector(".mod-delete-btn");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();

        customConfirm(
          t('mod_delete_confirm', { name: mod.name }),
          () => {
            const deleted = modManager.deleteMod(
              currentSettings.xxmiPath,
              mod.name,
              mod.active,
            );
            if (deleted) {
              renderModsGrid();
            } else {
              alert(t('mod_delete_err'));
            }
          },
        );
      });

      grid.appendChild(card);
    });
  };

  const openModModal = (mod) => {
    const modal = document.getElementById("mod-modal");
    if (!modal) return;
    document.getElementById("modal-title").textContent = mod.name;
    document.getElementById("modal-status").textContent = mod.active
      ? t('mod_status_on')
      : t('mod_status_off');
    document.getElementById("modal-status").style.color = mod.active
      ? "#4CAF50"
      : "#f44336";

    const linkEl = document.getElementById("modal-source-link");
    if (mod.sourceUrl) {
      linkEl.style.display = "inline-block";
      linkEl.href = mod.sourceUrl;
      const newLinkEl = linkEl.cloneNode(true);
      linkEl.parentNode.replaceChild(newLinkEl, linkEl);
      newLinkEl.onclick = (e) => {
        e.preventDefault();
        shell.openExternal(mod.sourceUrl);
      };
    } else {
      linkEl.style.display = "none";
    }

    const imgContainer = document.getElementById("modal-image-container");
    if (mod.previewUrl) {
      const safeUrl = encodeURI(mod.previewUrl)
        .replace(/'/g, "%27")
        .replace(/"/g, "%22");
      imgContainer.innerHTML = `<img src="${safeUrl}" alt="${mod.name}">`;
    } else
      imgContainer.innerHTML = `<div style="padding: 40px; background: rgba(255,255,255,0.05); border-radius: 8px; color: var(--color-muted);">${t('mod_no_image')}</div>`;

    const desc = document.getElementById("modal-description");
    if (mod.description) {
      desc.style.display = "block";
      desc.textContent = mod.description;
    } else desc.style.display = "none";

    modal.style.display = "flex";
  };

  const initModalLogic = () => {
    const modal = document.getElementById("mod-modal");
    const closeBtn = document.getElementById("modal-close");
    if (!modal || !closeBtn) return;
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.replaceWith(newCloseBtn);
    newCloseBtn.addEventListener("click", () => {
      modal.style.display = "none";
    });
    modal.onclick = (e) => {
      if (e.target === modal) modal.style.display = "none";
    };
  };

  let gbPage = 1;
  let gbLoading = false;
  let gbHasMore = true;

  const initGameBananaCatalog = () => {
    const sortSelect = document.getElementById("gb-sort");
    const refreshBtn = document.getElementById("gb-refresh-btn");
    const searchInput = document.getElementById("gb-search");
    const grid = document.getElementById("gb-grid");

    if (!grid) return;

    const fetchGBMods = async (append = false) => {
      if (gbLoading) return;
      gbLoading = true;
      const loadingEl = document.getElementById("gb-loading");
      if (loadingEl) loadingEl.style.display = "block";

      if (!append) {
        gbPage = 1;
        gbHasMore = true;
        grid.innerHTML = "";
      }
      const sortVal = sortSelect ? sortSelect.value : "default";
      const searchVal = searchInput ? searchInput.value.trim() : "";

      const csvProps =
        "_idRow,_sName,_aPreviewMedia,_nLikeCount,_tsDateUpdated,_tsDateAdded,_bContainsNsfw,_bIsNsfw,_bHasNsfw,_bMatureContent,_aContentRatings,_aCategory,_sDescription";
      let url = "";
      if (searchVal) {
        url = `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_idGameRow=19567&_sSearchString=${encodeURIComponent(searchVal)}&_nPage=${gbPage}&_nPerpage=30&_csvProperties=${csvProps}`;
      } else {
        let sortMap = {
          default: "Generic_MostLiked",
          new: "Generic_Newest",
          updated: "Generic_LatestUpdated",
          downloads: "Generic_MostDownloaded",
          views: "Generic_MostViewed",
          likes: "Generic_MostLiked",
        };
        let gbSort = sortMap[sortVal] || "Generic_MostLiked";
        url = `https://gamebanana.com/apiv11/Mod/Index?_nPage=${gbPage}&_nPerpage=30&_aFilters[Generic_Game]=19567&_sSort=${gbSort}&_csvProperties=${csvProps}`;
      }

      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        const records = data._aRecords || [];
        if (records.length < 30) gbHasMore = false;
        renderGBGrid(records, append);
      } catch (err) {
        if (!append)
          grid.innerHTML =
            `<div style="color: var(--color-red); grid-column: 1 / -1; text-align: center; margin-top: 20px;">${t('gb_load_err')}</div>`;
      } finally {
        gbLoading = false;
        if (loadingEl) loadingEl.style.display = "none";
      }
    };

    const checkScroll = (target) => {
      if (
        !target ||
        gbLoading ||
        !gbHasMore ||
        !document.getElementById("gb-grid")
      )
        return;
      const scrollBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;
      if (scrollBottom < 300) {
        gbPage++;
        fetchGBMods(true);
      }
    };

    grid.onscroll = (e) => checkScroll(e.target);
    const mainContent =
      document.getElementById("content-container") ||
      document.querySelector(".main-content");
    if (mainContent) mainContent.onscroll = (e) => checkScroll(e.target);

    if (refreshBtn) refreshBtn.onclick = () => fetchGBMods(false);
    if (sortSelect) sortSelect.onchange = () => fetchGBMods(false);

    let searchTimeout = null;
    if (searchInput) {
      searchInput.oninput = () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => fetchGBMods(false), 500);
      };
    }
    fetchGBMods(false);
  };

  const fetchBatchDownloads = async (records) => {
    if (!records || records.length === 0) return;
    try {
      let params = new URLSearchParams();
      records.forEach((mod, idx) => {
        params.append(`itemtype[${idx}]`, "Mod");
        params.append(`itemid[${idx}]`, mod._idRow);
        params.append(`fields[${idx}]`, "Files().aFiles()");
      });
      const res = await fetch(
        `https://api.gamebanana.com/Core/Item/Data?${params.toString()}`,
      );
      if (!res.ok) return;
      const data = await res.json();

      records.forEach((mod, idx) => {
        let totalDl = 0;
        if (data[idx] && data[idx][0]) {
          const filesObj = data[idx][0];
          if (typeof filesObj === "object") {
            Object.values(filesObj).forEach((file) => {
              totalDl +=
                parseInt(
                  file._nDownloadCount ??
                    file.nDownloadCount ??
                    file.DownloadCount ??
                    0,
                  10,
                ) || 0;
            });
          }
        }
        const countEl = document.getElementById(`dl-count-${mod._idRow}`);
        if (countEl)
          countEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> ${abbreviateCount(totalDl)}`;
      });
    } catch (e) {
      records.forEach((mod) => {
        const countEl = document.getElementById(`dl-count-${mod._idRow}`);
        if (countEl && countEl.innerHTML.includes("..."))
          countEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> 0`;
      });
    }
  };

  const renderGBGrid = (records, append = false) => {
    const grid = document.getElementById("gb-grid");
    if (!grid) return;

    if (!append && records.length === 0) {
      grid.innerHTML =
        `<div style="color: var(--color-muted); grid-column: 1 / -1; text-align: center; margin-top: 40px;">${t('gb_search_empty')}</div>`;
      return;
    }

    records.forEach((mod, index) => {
      const nsfwRegex =
        /\b(nsfw|18\+|nude|nudity|porn|sex|boobs|tits|ass|thicc|thick|naked|lewd)\b/i;

      let textToScan = mod._sName || "";
      if (mod._sDescription) textToScan += " " + mod._sDescription;
      if (mod._aCategory && mod._aCategory._sName)
        textToScan += " " + mod._aCategory._sName;
      if (mod._aContentRatings) {
        Object.values(mod._aContentRatings).forEach((r) => {
          textToScan += " " + r;
        });
      }

      const isNsfwFlagged =
        mod._bContainsNsfw ||
        mod._bIsNsfw ||
        mod._bHasNsfw ||
        mod._bMatureContent;
      const isNsfwText = nsfwRegex.test(textToScan);
      const isNsfw = isNsfwFlagged || isNsfwText;

      if (isNsfw && currentSettings.nsfwMode === "hide") return;

      const card = document.createElement("div");
      card.className = "mod-card";
      card.style.animationDelay = `${Math.min(index, 12) * 0.025}s`;

      let imgUrl = "";
      if (
        mod._aPreviewMedia &&
        mod._aPreviewMedia._aImages &&
        mod._aPreviewMedia._aImages[0]
      ) {
        imgUrl =
          mod._aPreviewMedia._aImages[0]._sBaseUrl +
          "/" +
          mod._aPreviewMedia._aImages[0]._sFile;
      }

      const imgClass =
        isNsfw && currentSettings.nsfwMode === "blur" ? "nsfw-blur" : "";
      const nsfwBadgeHtml =
        isNsfw && currentSettings.nsfwMode === "blur"
          ? `<div class="nsfw-badge">18+</div>`
          : "";

      const isDownloaded = modManager.isModDownloaded(
        currentSettings.xxmiPath,
        mod._idRow,
      );
      const isDownloading = Object.values(activeDownloads).some(
        (d) => d.modId === mod._idRow.toString(),
      );

      const iconDownload = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>`;
      const iconDownloaded = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`;
      const iconDownloading = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4V2C6.48 2 2 6.48 2 12h2c0-4.41 3.59-8 8-8zm8 8c0 4.41-3.59 8-8 8v2c5.52 0 10-4.48 10-10h-2z"/></svg>`;

      let btnClass = "";
      let btnIcon = iconDownload;
      let btnTitle = t('gb_download');

      if (isDownloaded) {
        btnClass = "downloaded";
        btnIcon = iconDownloaded;
        btnTitle = t('gb_already_dl');
      } else if (isDownloading) {
        btnClass = "downloading";
        btnIcon = iconDownloading;
        btnTitle = t('gb_downloading');
      }

      const rawLikes = mod._nLikeCount ?? mod.LikeCount ?? mod.nLikeCount ?? 0;
      const likes = abbreviateCount(rawLikes);
      const timeAgoStr = timeAgo(
        mod._tsDateUpdated || mod._tsDateAdded || Date.now() / 1000,
      );

      card.innerHTML = `
                <div class="mod-preview-wrapper">
                    <div class="mod-preview ${imgClass}" style="${imgUrl ? `background-image: url('${imgUrl}');` : ""} cursor: pointer;">
                        ${imgUrl ? "" : '<div class="mod-placeholder">GB</div>'}
                    </div>
                    ${nsfwBadgeHtml}
                </div>
                <div class="mod-footer">
                    <button class="mod-toggle-btn ${btnClass}" title="${btnTitle}">
                        ${btnIcon}
                    </button>
                    <div class="mod-name-container">
                        <div class="mod-name" title="${mod._sName}">${mod._sName}</div>
                        <div class="mod-stats">
                            <span title="${t('gb_likes')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> ${likes}</span>
                            <span id="dl-count-${mod._idRow}" title="${t('gb_downloads')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> ...</span>
                            <span title="${t('gb_updated')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ${timeAgoStr}</span>
                        </div>
                    </div>
                </div>
            `;

      card.querySelector(".mod-preview-wrapper").onclick = () =>
        openGBModal(mod);

      const toggleBtn = card.querySelector(".mod-toggle-btn");
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (!isDownloaded && !isDownloading) openGBModal(mod);
      };

      grid.appendChild(card);
    });

    fetchBatchDownloads(records);
  };

  let gbCarouselInterval = null;
  let gbImages = [];
  let gbImgIndex = 0;

  const openGBModal = async (mod) => {
    const modal = document.getElementById("gb-modal");
    if (!modal) return;

    clearInterval(gbCarouselInterval);

    document.getElementById("gb-modal-title").textContent = mod._sName;
    const linkEl = document.getElementById("gb-modal-link");
    const gbModUrl = `https://gamebanana.com/mods/${mod._idRow}`;
    const newLinkEl = linkEl.cloneNode(true);
    linkEl.parentNode.replaceChild(newLinkEl, linkEl);
    newLinkEl.onclick = (e) => {
      e.preventDefault();
      shell.openExternal(gbModUrl);
    };

    gbImages = [];
    if (mod._aPreviewMedia && mod._aPreviewMedia._aImages) {
      gbImages = mod._aPreviewMedia._aImages.map(
        (img) => img._sBaseUrl + "/" + img._sFile,
      );
    }

    const imgEl = document.getElementById("gb-modal-img");

    imgEl.style.filter = "none";

    if (gbImages.length > 0) {
      gbImgIndex = 0;
      imgEl.src = gbImages[0];
      imgEl.style.display = "block";

      gbCarouselInterval = setInterval(() => {
        gbImgIndex = (gbImgIndex + 1) % gbImages.length;
        imgEl.src = gbImages[gbImgIndex];
      }, 3500);
    } else {
      imgEl.style.display = "none";
    }

    document.getElementById("gb-carousel-prev").onclick = () => {
      gbImgIndex = (gbImgIndex - 1 + gbImages.length) % gbImages.length;
      imgEl.src = gbImages[gbImgIndex];
    };
    document.getElementById("gb-carousel-next").onclick = () => {
      gbImgIndex = (gbImgIndex + 1) % gbImages.length;
      imgEl.src = gbImages[gbImgIndex];
    };

    modal.style.display = "flex";

    document.getElementById("gb-files-loading").style.display = "block";
    document.getElementById("gb-files-list").innerHTML = "";
    document.getElementById("gb-modal-desc").innerHTML = "";

    try {
      const dataUrl = `https://api.gamebanana.com/Core/Item/Data?itemtype=Mod&itemid=${mod._idRow}&fields=text,Files().aFiles()`;
      const dataRes = await fetch(dataUrl);
      const itemData = await dataRes.json();

      document.getElementById("gb-modal-desc").innerHTML =
        itemData[0] || t('gb_desc_empty');
      const filesObj = itemData[1];
      document.getElementById("gb-files-loading").style.display = "none";

      if (filesObj && Object.keys(filesObj).length > 0) {
        if (modManager.isModDownloaded(currentSettings.xxmiPath, mod._idRow)) {
          const msg = document.createElement("div");
          msg.style.cssText =
            "padding:12px; background:rgba(255,42,42,0.1); border:1px solid var(--color-red); border-radius:8px; color:var(--color-red); margin-bottom:12px; font-size:0.9rem; font-weight:600;";
          msg.textContent = t('gb_already_dl_msg');
          document.getElementById("gb-files-list").appendChild(msg);
        }

        const previewUrlToPass = gbImages.length > 0 ? gbImages[0] : null;

        Object.values(filesObj).forEach((file) => {
          const fDiv = document.createElement("div");
          fDiv.className = "gb-file-item";

          const isFileDownloading = Object.values(activeDownloads).some(
            (d) => d.fileName === file._sFile,
          );

          fDiv.innerHTML = `
                        <strong>${file._sFile}</strong>
                        <div style="margin-bottom: 8px; font-size: 0.85rem; color: var(--color-muted);">
                            ${t('gb_added')}: ${new Date(file._tsDateAdded * 1000).toLocaleDateString()} &bull; ${(file._nFilesize / 1024 / 1024).toFixed(2)} MB
                        </div>
                        <button class="btn-install" ${isFileDownloading ? 'disabled style="background:#3f3f46; cursor:not-allowed;"' : ""}>
                            ${isFileDownloading ? t('gb_downloading') : t('gb_install')}
                        </button>
                    `;
          fDiv.querySelector(".btn-install").onclick = () => {
            if (!isFileDownloading) {
              startDownload(file, mod._sName, mod._idRow, previewUrlToPass);
              modal.style.display = "none";
            }
          };
          document.getElementById("gb-files-list").appendChild(fDiv);
        });
      } else {
        document.getElementById("gb-files-list").innerHTML =
          `<div style="color:var(--color-muted);">${t('gb_files_unavail')}</div>`;
      }
    } catch (e) {
      document.getElementById("gb-files-loading").textContent = t('gb_files_fail');
    }

    const closeBtn = document.getElementById("gb-modal-close");
    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

    newCloseBtn.onclick = () => {
      modal.style.display = "none";
      clearInterval(gbCarouselInterval);
    };
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = "none";
        clearInterval(gbCarouselInterval);
      }
    };
  };

  const startDownload = (gbFile, modName, modId, previewUrl) => {
    const url = gbFile._sDownloadUrl;
    const fileName = gbFile._sFile;
    const downloadId = gbFile._idRow.toString();

    const xxmiPath = currentSettings.xxmiPath;
    if (!xxmiPath) {
      alert(t('dl_need_path'));
      return;
    }

    const tempPath = path.join(xxmiPath, fileName);
    const safeModFolder =
      modName.replace(/[<>:"/\\|?*]+/g, "").trim() || "Mod_" + modId;
    const targetModFolder = path.join(xxmiPath, "Mods", safeModFolder);

    if (activeDownloads[downloadId]) {
      alert(t('dl_in_queue'));
      return;
    }

    activeDownloads[downloadId] = {
      modId: modId.toString(),
      name: `${modName}`,
      fileName: fileName,
      previewUrl: previewUrl || null,
      progress: 0,
      total: 0,
      speed: 0,
      status: t('dl_connecting'),
      req: null,
    };

    const downloadsTab = document.querySelector('[data-page="downloads"]');
    if (downloadsTab) downloadsTab.click();

    let lastTime = Date.now();
    let lastDownloaded = 0;

    const downloadImage = (imgUrl, dest) => {
      return new Promise((resolve) => {
        const client = imgUrl.startsWith("https") ? https : http;
        client
          .get(imgUrl, (response) => {
            if (
              [301, 302, 303, 307, 308].includes(response.statusCode) &&
              response.headers.location
            ) {
              return downloadImage(response.headers.location, dest).then(
                resolve,
              );
            }
            if (response.statusCode === 200) {
              const fileStream = fs.createWriteStream(dest);
              response.pipe(fileStream);
              fileStream.on("finish", () => {
                fileStream.close();
                resolve();
              });
            } else {
              resolve();
            }
          })
          .on("error", () => resolve());
      });
    };

    const downloadPromise = new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(tempPath);
      const requestFunc = (currentUrl) => {
        const client = currentUrl.startsWith("https") ? https : http;
        const req = client
          .get(currentUrl, (response) => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
              return requestFunc(response.headers.location);
            }
            if (response.statusCode !== 200) {
              return reject(new Error("Ошибка HTTP: " + response.statusCode));
            }
            const totalLength = parseInt(
              response.headers["content-length"],
              10,
            );
            activeDownloads[downloadId].total = totalLength;
            let downloaded = 0;

            response.on("data", (chunk) => {
              downloaded += chunk.length;
              activeDownloads[downloadId].progress = downloaded;
              const now = Date.now();
              const timeDiff = (now - lastTime) / 1000;
              if (timeDiff >= 0.5) {
                activeDownloads[downloadId].speed =
                  (downloaded - lastDownloaded) / timeDiff;
                lastTime = now;
                lastDownloaded = downloaded;
              }
            });

            response.pipe(fileStream);
            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });
          })
          .on("error", (err) => {
            fs.unlink(tempPath, () => {});
            reject(err);
          });
        activeDownloads[downloadId].req = req;
      };
      requestFunc(url);
    });

    downloadPromise
      .then(() => {
        activeDownloads[downloadId].status = t('dl_unpacking');
        setTimeout(async () => {
          try {
            if (tempPath.toLowerCase().endsWith(".zip") && AdmZip) {
              const zip = new AdmZip(tempPath);
              zip.extractAllTo(targetModFolder, true);
              fs.unlinkSync(tempPath);
            } else {
              if (!fs.existsSync(targetModFolder))
                fs.mkdirSync(targetModFolder, { recursive: true });
              fs.renameSync(tempPath, path.join(targetModFolder, fileName));
            }

            modManager.addDownloadLink(
              safeModFolder,
              `https://gamebanana.com/mods/${modId}`,
            );

            if (previewUrl) {
              const previewDest = path.join(targetModFolder, "preview.jpg");
              await downloadImage(previewUrl, previewDest);
            }

            delete activeDownloads[downloadId];
            renderDownloadsTab();
          } catch (e) {
            activeDownloads[downloadId].status = t('dl_unpack_err');
          }
        }, 500);
      })
      .catch((err) => {
        activeDownloads[downloadId].status = t('dl_fail', { error: err.message });
      });
  };

  const initDownloadsTab = () => {
    renderDownloadsTab();
  };

  const renderDownloadsTab = () => {
    const list = document.getElementById("downloads-list");
    if (!list) return;

    const keys = Object.keys(activeDownloads);
    const activeBadge = document.querySelector(
      ".summary-badge.active span:last-child",
    );
    const speedBadge = document.querySelector(".summary-badge.speed span");

    let totalSpeedBytes = 0;
    keys.forEach((k) => {
      totalSpeedBytes += activeDownloads[k].speed || 0;
    });

    if (activeBadge) activeBadge.textContent = t('dl_active_count', { count: keys.length });
    if (speedBadge)
      speedBadge.textContent = t('dl_speed_mb', { speed: (totalSpeedBytes / 1024 / 1024).toFixed(1) });

    if (keys.length === 0) {
      list.innerHTML =
        `<div class="empty-state" style="color: var(--color-muted); text-align: center; padding: 40px 0;">${t('dl_empty_state')}</div>`;
      return;
    }

    const emptyState = list.querySelector(".empty-state");
    if (emptyState) emptyState.remove();

    const currentCards = list.querySelectorAll(".download-card");
    currentCards.forEach((card) => {
      const cardId = card.getAttribute("data-id");
      if (!activeDownloads[cardId]) card.remove();
    });

    keys.forEach((key) => {
      const d = activeDownloads[key];
      const percent = d.total
        ? Math.min(100, Math.round((d.progress / d.total) * 100))
        : 0;
      const speedMb = (d.speed / 1024 / 1024).toFixed(2);
      const downloadedMb = (d.progress / 1024 / 1024).toFixed(2);
      const totalMb = d.total ? (d.total / 1024 / 1024).toFixed(2) : "0.00";

      let card = list.querySelector(`.download-card[data-id="${key}"]`);

      if (!card) {
        card = document.createElement("div");
        card.className = "download-card state-downloading";
        card.setAttribute("data-id", key);

        const bgStyle = d.previewUrl
          ? `background-image: url('${encodeURI(d.previewUrl).replace(/'/g, "%27")}');`
          : "";

        card.innerHTML = `
                    <div class="download-preview" style="${bgStyle}">
                        <div class="download-status-tag active">${t('dl_status_downloading')}</div>
                    </div>
                    
                    <div class="download-content">
                        <div class="download-header-row">
                            <div class="download-title-block">
                                <span class="download-name">${d.name}</span>
                                <span class="download-subtext">${d.fileName}</span>
                            </div>

                            <div class="download-actions">
                                <button class="action-btn stop btn-cancel" title="${t('dl_action_stop')}" data-id="${key}">
                                    <svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                                </button>
                            </div>
                        </div>

                        <div class="progress-section">
                            <div class="progress-bar-track">
                                <div class="progress-bar-fill downloading-glow" style="width: ${percent}%;"></div>
                            </div>
                        </div>

                        <div class="download-footer-row">
                            <span class="meta-speed">${speedMb} МБ/с</span>
                            <span class="meta-info">${downloadedMb} MB / ${totalMb} MB</span>
                            <span class="meta-percent">${percent}%</span>
                            <span class="meta-eta">${d.status}</span>
                        </div>
                    </div>
                `;

        card.querySelector(".btn-cancel").onclick = () => {
          if (d.req) d.req.destroy();
          delete activeDownloads[key];
          renderDownloadsTab();
        };

        list.appendChild(card);
      } else {
        const progressFill = card.querySelector(".progress-bar-fill");
        const metaSpeed = card.querySelector(".meta-speed");
        const metaInfo = card.querySelector(".meta-info");
        const metaPercent = card.querySelector(".meta-percent");
        const metaEta = card.querySelector(".meta-eta");

        if (progressFill) progressFill.style.width = `${percent}%`;
        if (metaSpeed) metaSpeed.textContent = `${speedMb} МБ/с`;
        if (metaInfo)
          metaInfo.textContent = `${downloadedMb} MB / ${totalMb} MB`;
        if (metaPercent) metaPercent.textContent = `${percent}%`;
        if (metaEta) metaEta.textContent = d.status;
      }
    });
  };

  setInterval(() => {
    if (document.getElementById("downloads-list")) renderDownloadsTab();
  }, 200);

  const initSettings = () => {
    const xxmiPathInput = document.getElementById("setting-xxmi-path");
    const btnSelectXxmi = document.getElementById("btn-select-xxmi");

    const xxmiBinPathInput = document.getElementById("setting-xxmi-bin-path");
    const btnSelectXxmiBin = document.getElementById("btn-select-xxmi-bin");

    const nsfwModeSelect = document.getElementById("setting-nsfw-mode");
    const langSelect = document.getElementById("language-selector");

    if (currentSettings.xxmiPath)
      xxmiPathInput.value = currentSettings.xxmiPath;
    if (currentSettings.xxmiBinPath && xxmiBinPathInput)
      xxmiBinPathInput.value = currentSettings.xxmiBinPath;

    if (nsfwModeSelect)
      nsfwModeSelect.value = currentSettings.nsfwMode || "show";
    
    if (langSelect) {
      langSelect.value = currentSettings.language || "en";
    }

    const saveSettings = () => {
      currentSettings = {
        xxmiPath: xxmiPathInput
          ? xxmiPathInput.value
          : currentSettings.xxmiPath || "",
        xxmiBinPath: xxmiBinPathInput
          ? xxmiBinPathInput.value
          : currentSettings.xxmiBinPath || "",
        nsfwMode: nsfwModeSelect ? nsfwModeSelect.value : "show",
        language: langSelect ? langSelect.value : (currentSettings.language || "en"),
      };
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(currentSettings, null, 4),
      );
    };

    if (nsfwModeSelect) nsfwModeSelect.addEventListener("change", saveSettings);

if (langSelect) {
      langSelect.addEventListener("change", (e) => {
        saveSettings();
        loadTranslations(currentSettings.language);
        applyTranslationsToDOM(document.body);
        loadPage("settings"); // Перезагружаем страницу настроек
        
        // --- ИСПРАВЛЕНИЕ ОБВОДКИ ---
        // Даем браузеру немного времени (50мс) на отрисовку новых шрифтов и ширины, 
        // после чего заставляем ползунок пересчитать свои размеры и позицию.
        setTimeout(() => {
          const activeItem = document.querySelector(".sidebar-item.active");
          if (activeItem) moveIndicator(activeItem);
        }, 50);
        // ---------------------------
      });
    }

    if (xxmiPathInput) xxmiPathInput.addEventListener("input", saveSettings);
    if (xxmiBinPathInput)
      xxmiBinPathInput.addEventListener("input", saveSettings);

    const getFolderPath = (file) => {
      if (!file) return "";
      try {
        if (webUtils && typeof webUtils.getPathForFile === "function")
          return webUtils.getPathForFile(file);
      } catch (e) {}
      return file.path || "";
    };

    if (btnSelectXxmi) {
      btnSelectXxmi.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.onchange = (e) => {
          if (e.target.files.length > 0) {
            const fullPath = getFolderPath(e.target.files[0]);
            if (fullPath) {
              xxmiPathInput.value = path.dirname(fullPath);
              saveSettings();
            }
          }
        };
        input.click();
      });
    }

    if (btnSelectXxmiBin) {
      btnSelectXxmiBin.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.webkitdirectory = true;
        input.onchange = (e) => {
          if (e.target.files.length > 0) {
            const fullPath = getFolderPath(e.target.files[0]);
            if (fullPath) {
              xxmiBinPathInput.value = path.dirname(fullPath);
              saveSettings();
            }
          }
        };
        input.click();
      });
    }
  };

  menuItems.forEach((item) => {
    item.addEventListener("click", () => {
      menuItems.forEach((i) => i.classList.remove("active"));
      item.classList.add("active");

      moveIndicator(item);

      loadPage(item.getAttribute("data-page"));
    });
  });

  document.getElementById("btn-launch-game").addEventListener("click", () => {
    startOpt.launch(currentSettings, t);
  });

  loadPage("installed").then(() => {
    const activeItem = document.querySelector(".sidebar-item.active");
    if (activeItem) {
      setTimeout(() => moveIndicator(activeItem), 50);
    }
  });
});
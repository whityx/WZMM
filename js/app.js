const fs = require("fs");
const path = require("path");
const os = require("os");
const { shell, webUtils } = require("electron");
const https = require("https");
const http = require("http");



const { getConfigDir } = require(path.join(__dirname, "js", "platform.js"));

const configDir = getConfigDir();
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

const settingsFilePath = path.join(configDir, "settings.json");

const ModManager = require(path.join(__dirname, "js", "modManager.js"));
const GroupManager = require(path.join(__dirname, "js", "groupmanager.js"));
const { SideMenuDownload, InstalledFilterDrawer } = require(path.join(__dirname, "js", "sideMenuFilter.js"));
const ArchiveExtractor = require(path.join(__dirname, "js", "archiveExtractor.js"));
const startOpt = require(path.join(__dirname, "js", "startopt.js"));
const platformHelper = require(path.join(__dirname, "js", "platform.js"));
const modManager = new ModManager();
const groupManager = new GroupManager();

const activeDownloads = {};

let translations = {};
const loadTranslations = (lang) => {
  if (lang !== "ru" && lang !== "en") {
    lang = "en";
  }

  let localePath = path.join(__dirname, "locales", `${lang}.json`);

  if (!fs.existsSync(localePath)) {
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

const htmlToPlainText = (html) => {
  if (!html) return "";
  return html
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<br\s*[\/]?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
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
    if (translations[key]) {
      el.setAttribute("data-tooltip", translations[key]);
      el.removeAttribute("title");
    }
  });
};

const getThemesDir = () => {
  let dir = path.join(__dirname, "themes");
  if (!fs.existsSync(dir)) {
    dir = path.join(process.cwd(), "themes");
  }
  if (!fs.existsSync(dir)) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (e) { }
  }
  return dir;
};

const mapLegacyTheme = (name) => {
  if (!name || name === "base") return "purple";
  if (name === "crimson") return "red";
  if (name === "emerald") return "green";
  return name;
};

const getAvailableThemes = () => {
  const dir = getThemesDir();
  try {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const themes = files
        .filter((file) => file.endsWith(".css"))
        .map((file) => path.basename(file, ".css"));
      const preferredOrder = [
        "purple",
        "red",
        "green",
        "nord",
        "amber",
        "sakura",
        "midnight",
        "sunset",
        "cyan",
      ];
      themes.sort((a, b) => {
        const idxA = preferredOrder.indexOf(a);
        const idxB = preferredOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });
      return themes.length > 0 ? themes : ["purple"];
    }
  } catch (e) {
    console.error("Theme load error", e);
  }
  return ["purple"];
};

let themeTransitionTimeout = null;
const applyTheme = (themeName, isInitial = false) => {
  const activeTheme = mapLegacyTheme(themeName);
  let themeLink = document.getElementById("theme-link");
  if (!themeLink) {
    themeLink = document.createElement("link");
    themeLink.id = "theme-link";
    themeLink.rel = "stylesheet";
    document.head.appendChild(themeLink);
  }

  if (!isInitial) {
    document.documentElement.classList.add("theme-transition");
    if (themeTransitionTimeout) {
      clearTimeout(themeTransitionTimeout);
    }
    themeTransitionTimeout = setTimeout(() => {
      document.documentElement.classList.remove("theme-transition");
    }, 700);
  }

  const themeFile = `${activeTheme}.css`;
  themeLink.href = `themes/${themeFile}`;
  document.documentElement.setAttribute("data-theme", activeTheme);
};

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

const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h, s, l];
};

const hslToRgb = (h, s, l) => {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
};


const imageColorCache = new Map();


let colorExtractionQueue = [];
let isProcessingColorQueue = false;

let colorSharedCanvas = null;
let colorSharedCtx = null;

const processColorQueue = () => {
  if (colorExtractionQueue.length === 0) {
    isProcessingColorQueue = false;
    return;
  }
  isProcessingColorQueue = true;


  const batch = colorExtractionQueue.splice(0, 3);

  batch.forEach(({ imageUrl, resolve }) => {
    if (imageColorCache.has(imageUrl)) {
      return resolve(imageColorCache.get(imageUrl));
    }

    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.onload = () => {
      try {
        if (!colorSharedCanvas) {
          colorSharedCanvas = document.createElement("canvas");
          colorSharedCanvas.width = 16;
          colorSharedCanvas.height = 16;
          colorSharedCtx = colorSharedCanvas.getContext("2d", { willReadFrequently: true });
        }
        const W = 16;
        const H = 16;
        colorSharedCtx.drawImage(img, 0, 0, W, H);
        const data = colorSharedCtx.getImageData(0, 0, W, H).data;

        let rSum = 0, gSum = 0, bSum = 0, count = 0;
        for (let y = 8; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const idx = (y * W + x) * 4;
            if (data[idx + 3] > 30) {
              rSum += data[idx];
              gSum += data[idx + 1];
              bSum += data[idx + 2];
              count++;
            }
          }
        }

        if (count === 0) {
          imageColorCache.set(imageUrl, null);
          return resolve(null);
        }

        let r = Math.round(rSum / count);
        let g = Math.round(gSum / count);
        let b = Math.round(bSum / count);

        const [h, s, l] = rgbToHsl(r, g, b);
        const tunedS = Math.min(1.0, Math.max(0.45, s * 1.35));
        const tunedL = Math.min(0.58, Math.max(0.42, l));
        [r, g, b] = hslToRgb(h, tunedS, tunedL);

        const rgbStr = `${r}, ${g}, ${b}`;
        const result = {
          rgb: rgbStr,
          rgb1: rgbStr,
          rgb2: rgbStr,
        };
        imageColorCache.set(imageUrl, result);
        resolve(result);
      } catch (e) {
        imageColorCache.set(imageUrl, null);
        resolve(null);
      }
    };
    img.onerror = () => {
      imageColorCache.set(imageUrl, null);
      resolve(null);
    };
    img.src = imageUrl;
  });


  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(processColorQueue, { timeout: 100 });
  } else {
    setTimeout(processColorQueue, 20);
  }
};

const extractDominantColor = (imageUrl) => {
  if (!imageUrl || typeof imageUrl !== "string") return Promise.resolve(null);
  if (imageColorCache.has(imageUrl)) {
    return Promise.resolve(imageColorCache.get(imageUrl));
  }
  return new Promise((resolve) => {
    colorExtractionQueue.push({ imageUrl, resolve });
    if (!isProcessingColorQueue) {
      if (typeof requestIdleCallback !== "undefined") {
        requestIdleCallback(processColorQueue, { timeout: 100 });
      } else {
        setTimeout(processColorQueue, 20);
      }
    }
  });
};

const loadCardMedia = (card) => {
  if (!card) return;
  const rawUrl = card.dataset.previewUrl;
  if (!rawUrl) return;

  const safeUrl = encodeURI(rawUrl).replace(/'/g, "%27").replace(/"/g, "%22");
  const previewEl = card.querySelector(".mod-preview");
  if (previewEl) {
    previewEl.style.backgroundImage = `url('${safeUrl}')`;
  }
  card.style.setProperty("--mod-bg-image", `url('${safeUrl}')`);
  card.classList.add("has-bg-image");

  extractDominantColor(rawUrl).then((color) => {
    if (color && color.rgb1 && card.isConnected) {
      card.style.setProperty("--mod-color", color.rgb1);
      card.style.setProperty("--mod-color-1", color.rgb1);
      card.style.setProperty("--mod-color-2", color.rgb2 || color.rgb1);
      card.classList.add("has-dynamic-color");
    }
  });
};

const cardMediaObserver =
  typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver(
        (entries, observer) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const card = entry.target;
              observer.unobserve(card);
              loadCardMedia(card);
            }
          });
        },
        {
          rootMargin: "250px 0px",
          threshold: 0.01,
        },
      )
    : {
        observe: (card) => loadCardMedia(card),
        unobserve: () => {},
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
  applyTheme(currentSettings.theme || "purple", true);
  loadTranslations(currentSettings.language || "en");
  applyTranslationsToDOM(document.body);

  const splashEl = document.getElementById("splash-screen");
  if (typeof SplashManager !== "undefined" && SplashManager.init) {
    SplashManager.init(splashEl);
  }

  if (currentSettings.skipSplashScreen) {
    if (typeof SplashManager !== "undefined") SplashManager.hide();
  } else if (typeof SplashManager !== "undefined") {
    SplashManager.setProgress(20, t("splash_status_check_updates"));
  }

  let gbIdleTimer = null;
  let activeGBModalController = null;
  let activeGBModalId = 0;
  const gbItemDataCache = new Map();

  const openLightbox = (imgSrc) => {
    if (!imgSrc) return;
    const lbModal = document.getElementById("gb-lightbox-modal");
    const lbImg = document.getElementById("gb-lightbox-img");
    if (lbModal && lbImg) {
      lbImg.src = imgSrc;
      lbModal.classList.add("active");
      lbModal.style.display = "flex";
    }
  };

  const closeLightbox = () => {
    const lbModal = document.getElementById("gb-lightbox-modal");
    if (lbModal) {
      lbModal.classList.remove("active");
      lbModal.style.display = "none";
      const lbImg = document.getElementById("gb-lightbox-img");
      if (lbImg) lbImg.src = "";
    }
  };

  const initLightbox = () => {
    const lbModal = document.getElementById("gb-lightbox-modal");
    if (!lbModal) return;
    lbModal.onclick = () => {
      closeLightbox();
    };
    const lbClose = document.getElementById("gb-lightbox-close");
    if (lbClose) {
      lbClose.onclick = (e) => {
        e.stopPropagation();
        closeLightbox();
      };
    }
    const lbImg = document.getElementById("gb-lightbox-img");
    if (lbImg) {
      lbImg.onclick = (e) => {
        e.stopPropagation();
        closeLightbox();
      };
    }
  };

  initLightbox();

  document.addEventListener("click", (e) => {
    const anchor = e.target.closest("a");
    if (anchor && anchor.href) {
      const rawHref = anchor.getAttribute("href") || "";
      if (
        rawHref.startsWith("http://") ||
        rawHref.startsWith("https://") ||
        anchor.href.startsWith("http://") ||
        anchor.href.startsWith("https://")
      ) {
        e.preventDefault();
        shell.openExternal(anchor.href);
      }
    }
  });

  const sidebarLogo = document.querySelector(".sidebar-dynamic-logo");
  if (sidebarLogo) {
    let angle = 0;
    let currentSpeed = 0.38;
    let isHovered = false;

    sidebarLogo.addEventListener("mouseenter", () => { isHovered = true; });
    sidebarLogo.addEventListener("mouseleave", () => { isHovered = false; });
    sidebarLogo.addEventListener("mousedown", () => { isHovered = true; });

    const animateLogo = () => {
      const targetSpeed = isHovered ? 2.8 : 0.38;
      currentSpeed += (targetSpeed - currentSpeed) * 0.08;
      angle = (angle + currentSpeed) % 360;
      sidebarLogo.style.transform = `rotate(${angle}deg)`;
      requestAnimationFrame(animateLogo);
    };
    requestAnimationFrame(animateLogo);
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const lbModal = document.getElementById("gb-lightbox-modal");
      if (lbModal && (lbModal.classList.contains("active") || lbModal.style.display === "flex")) {
        e.preventDefault();
        e.stopPropagation();
        closeLightbox();
        return;
      }

      const gbModal = document.querySelector("#gb-modal.active") || document.getElementById("gb-modal");
      if (gbModal && gbModal.classList.contains("active")) {
        e.preventDefault();
        gbModal.classList.remove("active");
        clearTimeout(gbIdleTimer);
        if (activeGBModalController) activeGBModalController.abort();
        return;
      }

      const modModal = document.getElementById("mod-modal");
      if (modModal && modModal.classList.contains("active")) {
        e.preventDefault();
        modModal.classList.remove("active");
        return;
      }

      const varModal = document.getElementById("var-delete-modal");
      if (varModal && varModal.classList.contains("active")) {
        e.preventDefault();
        varModal.classList.remove("active");
        return;
      }
    }
  });

  let currentModFilter = "all";
  let currentSearchQuery = "";
  let currentCharacterFilter = "all";
  let installedFilterDrawer = null;

  const moveIndicator = (activeItem) => {
    if (!indicator || !activeItem || !sidebar) return;
    const sidebarRect = sidebar.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    indicator.style.width = `${itemRect.width}px`;
    indicator.style.height = `${itemRect.height}px`;
    indicator.style.left = `${itemRect.left - sidebarRect.left}px`;
    indicator.style.top = `${itemRect.top - sidebarRect.top}px`;
  };

  const updateActiveSidebarIndicator = () => {
    const activeItem =
      document.querySelector(".sidebar-item.active") ||
      document.querySelector('.sidebar-item[data-page="installed"]') ||
      document.querySelector(".sidebar-item");
    if (activeItem) {
      menuItems.forEach((i) => i.classList.remove("active"));
      activeItem.classList.add("active");
      moveIndicator(activeItem);
    }
  };

  updateActiveSidebarIndicator();
  setTimeout(updateActiveSidebarIndicator, 50);
  setTimeout(updateActiveSidebarIndicator, 150);

  window.addEventListener("resize", () => {
    const activeItem = document.querySelector(".sidebar-item.active");
    if (activeItem) moveIndicator(activeItem);
  });

  const customConfirm = (message, onConfirm, options = {}) => {
    if (window.Modal) {
      window.Modal.confirm(Object.assign({
        title: t('confirm_title'),
        message: message,
        confirmText: t('confirm_delete'),
        cancelText: t('confirm_cancel'),
        type: "danger",
        onConfirm: onConfirm
      }, options));
    } else if (confirm(message)) {
      if (typeof onConfirm === "function") onConfirm();
    }
  };

  const globalScrollTopBtn = document.getElementById("global-scroll-top-btn");
  const mainContentEl =
    document.getElementById("content-container") ||
    document.querySelector(".main-content");

  if (mainContentEl && globalScrollTopBtn) {
    mainContentEl.addEventListener("scroll", () => {
      if (mainContentEl.scrollTop > 220) {
        globalScrollTopBtn.classList.add("visible");
      } else {
        globalScrollTopBtn.classList.remove("visible");
      }
    });

    globalScrollTopBtn.onclick = () => {
      mainContentEl.scrollTo({ top: 0, behavior: "smooth" });
    };
  }

  const loadPage = async (pageName) => {
    isGroupDrawerOpen = false;
    selectedModsForGroup = new Set();
    editingGroupId = null;
    if (installedFilterDrawer) installedFilterDrawer.isOpen = false;
    if (sideMenuDownload) sideMenuDownload.isOpen = false;
    if (globalScrollTopBtn) globalScrollTopBtn.classList.remove("visible");
    if (activeGBModalController) {
      activeGBModalController.abort();
    }
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

      applyTranslationsToDOM(contentContainer);

      if (pageName === "settings") initSettings();
      if (pageName === "installed") initInstalledMods();
      if (pageName === "download") {
        const detachedModals = document.querySelectorAll("body > #gb-modal");
        detachedModals.forEach(m => m.remove());
        initGameBananaCatalog();
      }
      if (pageName === "downloads") initDownloadsTab();

      if (typeof CustomDropdown !== "undefined") {
        CustomDropdown.initAll(contentContainer);
      }
    } catch (error) {
      contentContainer.innerHTML = `<h2 style="color: var(--color-red);">${t('err_page_load')}</h2>`;
    }
  };

  function getSettings() {
    const defaultSettings = { nsfwMode: "show", language: "en", theme: "purple" };

    if (!fs.existsSync(settingsFilePath)) {
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(defaultSettings, null, 4),
        "utf-8",
      );
    }

    try {
      let settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf-8"));

      if (settings.language !== "ru" && settings.language !== "en") {
        settings.language = "en";
      }

      settings.theme = mapLegacyTheme(settings.theme || "purple");

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

  let isGroupDrawerOpen = false;
  let selectedModsForGroup = new Set();
  let editingGroupId = null;

  const initInstalledMods = () => {
    isGroupDrawerOpen = false;
    selectedModsForGroup = new Set();
    editingGroupId = null;
    const filterSelect = document.getElementById("mods-filter");
    const searchInput = document.getElementById("mods-search");
    const filterBtn = document.getElementById("installed-filter-btn");

    if (!installedFilterDrawer) {
      installedFilterDrawer = new InstalledFilterDrawer({
        containerId: "installed-drawer-container",
        language: currentSettings.language || "ru",
        t: t,
        onFilterChange: (charName) => {
          currentCharacterFilter = charName || "all";
          renderModsGrid();
        },
      });
    } else {
      installedFilterDrawer.setLanguage(currentSettings.language || "ru");
      installedFilterDrawer.t = t;
      installedFilterDrawer.onFilterChange = (charName) => {
        currentCharacterFilter = charName || "all";
        renderModsGrid();
      };
    }
    installedFilterDrawer.render();

    if (filterBtn) {
      filterBtn.onclick = () => {
        if (installedFilterDrawer) {
          if (!installedFilterDrawer.isOpen && isGroupDrawerOpen) {
            const btnManage = document.getElementById("btn-group-manage");
            const drawer = document.getElementById("group-side-drawer");
            const pageContainer = document.querySelector(".installed-page-container");
            isGroupDrawerOpen = false;
            if (drawer) drawer.classList.remove("open");
            if (btnManage) btnManage.classList.remove("active");
            if (pageContainer) pageContainer.classList.remove("group-mode-active");
            resetGroupEditMode();
          }
          installedFilterDrawer.toggle();
        }
      };
    }

    if (filterSelect) {
      filterSelect.value = currentModFilter;
      filterSelect.onchange = (e) => {
        currentModFilter = e.target.value;
        renderModsGrid();
      };
    }
    let searchDebounceTimeout = null;
    if (searchInput) {
      searchInput.value = currentSearchQuery;
      searchInput.oninput = (e) => {
        currentSearchQuery = e.target.value;
        clearTimeout(searchDebounceTimeout);
        searchDebounceTimeout = setTimeout(() => {
          renderModsGrid();
        }, 150);
      };
    }
    renderModsGrid();
    initModalLogic();
    initGroupDrawerLogic();
  };

  const updateGroupSelectionUI = () => {
    const countEl = document.getElementById("group-selected-count");
    if (countEl) {
      countEl.textContent = t('groups_selected_count', { count: selectedModsForGroup.size });
    }
  };

  const showGroupToast = (msg, type = "success") => {
    if (window.Toast) {
      window.Toast.show({ message: msg, type: type });
    } else {
      const toast = document.getElementById("group-toast");
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add("show");
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => {
        toast.classList.remove("show");
      }, 3500);
    }
  };

  const renderGroupList = () => {
    const container = document.getElementById("groups-container");
    if (!container) return;
    const groups = groupManager.getGroups();

    if (groups.length === 0) {
      container.innerHTML = `<div class="group-empty-state">${t('groups_empty')}</div>`;
      return;
    }

    container.innerHTML = "";
    groups.forEach((group) => {
      const card = document.createElement("div");
      card.className = "group-card";
      card.dataset.groupId = group.id;

      const modCount = group.mods ? group.mods.length : 0;
      const modsListHtml = (group.mods || []).map(m => `
        <div class="group-mod-item">
          <span class="group-mod-item-name" title="${m}">${m}</span>
          <button class="group-mod-remove-btn" title="Remove" data-mod="${encodeURIComponent(m)}">&times;</button>
        </div>
      `).join("");

      card.innerHTML = `
        <div class="group-card-header">
          <div class="group-card-top">
            <div class="group-card-name" title="${group.name}">${group.name}</div>
            <span class="group-badge">${t('groups_mods_count', { count: modCount })}</span>
          </div>
          <div class="group-card-actions">
            <button class="btn-group-action btn-group-enable" title="${t('groups_enable_btn')}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <span>${t('groups_enable_btn')}</span>
            </button>
            <button class="btn-group-action btn-group-disable" title="${t('groups_disable_btn')}">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              <span>${t('groups_disable_btn')}</span>
            </button>
            <button class="btn-group-icon btn-toggle-expand" title="Details">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button class="btn-group-icon btn-edit-group" title="${t('groups_edit_title')}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
            </button>
            <button class="btn-group-icon delete btn-delete-group" title="Delete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path></svg>
            </button>
          </div>
        </div>
        <div class="group-card-details">
          <div class="group-mods-list">
            ${modsListHtml || `<div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px;">0 mods</div>`}
          </div>
          <button class="group-card-add-selected">${t('groups_add_selected')}</button>
        </div>
      `;

      card.querySelector(".btn-group-enable").addEventListener("click", () => {
        const res = groupManager.enableGroup(currentSettings.xxmiPath, group.id, modManager);
        if (res.success) {
          showGroupToast(t('groups_enabled_toast', {
            name: res.groupName,
            count: res.enabledCount
          }));
          renderModsGrid();
        } else if (res.reason === "invalid_path") {
          if (window.Toast) window.Toast.error(t('groups_err_path'));
          else alert(t('groups_err_path'));
        }
      });

      card.querySelector(".btn-group-disable").addEventListener("click", () => {
        const res = groupManager.disableGroup(currentSettings.xxmiPath, group.id, modManager);
        if (res.success) {
          showGroupToast(t('groups_disabled_toast', {
            name: res.groupName,
            count: res.disabledCount
          }));
          renderModsGrid();
        } else if (res.reason === "invalid_path") {
          if (window.Toast) window.Toast.error(t('groups_err_path'));
          else alert(t('groups_err_path'));
        }
      });

      card.querySelector(".btn-toggle-expand").addEventListener("click", () => {
        card.classList.toggle("expanded");
      });

      card.querySelector(".btn-edit-group").addEventListener("click", () => {
        editingGroupId = group.id;
        const nameInput = document.getElementById("group-name-input");
        const modeTitle = document.getElementById("group-panel-mode-title");
        const saveBtn = document.getElementById("btn-save-group");
        const cancelBtn = document.getElementById("btn-cancel-edit-group");

        if (nameInput) nameInput.value = group.name;
        if (modeTitle) modeTitle.textContent = t('groups_edit_title');
        if (saveBtn) saveBtn.textContent = t('groups_save_btn');
        if (cancelBtn) cancelBtn.style.display = "block";

        selectedModsForGroup = new Set(group.mods || []);
        updateGroupSelectionUI();
        renderModsGrid();
      });

      card.querySelector(".btn-delete-group").addEventListener("click", () => {
        customConfirm(
          t('groups_delete_confirm', { name: group.name }),
          () => {
            groupManager.deleteGroup(group.id);
            if (editingGroupId === group.id) resetGroupEditMode();
            renderGroupList();
          }
        );
      });

      card.querySelectorAll(".group-mod-remove-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const modName = decodeURIComponent(btn.dataset.mod);
          groupManager.removeModFromGroup(group.id, modName);
          if (editingGroupId === group.id) {
            selectedModsForGroup.delete(modName);
            updateGroupSelectionUI();
            renderModsGrid();
          }
          renderGroupList();
        });
      });

      card.querySelector(".group-card-add-selected").addEventListener("click", () => {
        if (selectedModsForGroup.size === 0) {
          showGroupToast(t('groups_err_no_mods'));
          return;
        }
        selectedModsForGroup.forEach(m => groupManager.addModToGroup(group.id, m));
        renderGroupList();
      });

      container.appendChild(card);
    });
  };

  const resetGroupEditMode = () => {
    editingGroupId = null;
    const nameInput = document.getElementById("group-name-input");
    const modeTitle = document.getElementById("group-panel-mode-title");
    const saveBtn = document.getElementById("btn-save-group");
    const cancelBtn = document.getElementById("btn-cancel-edit-group");

    if (nameInput) nameInput.value = "";
    if (modeTitle) modeTitle.textContent = t('groups_create_title');
    if (saveBtn) saveBtn.textContent = t('groups_create_btn');
    if (cancelBtn) cancelBtn.style.display = "none";
    selectedModsForGroup = new Set();
    updateGroupSelectionUI();
    renderModsGrid();
  };

  const initGroupDrawerLogic = () => {
    const btnManage = document.getElementById("btn-group-manage");
    const drawer = document.getElementById("group-side-drawer");
    const btnClose = document.getElementById("btn-close-group-drawer");
    const btnSave = document.getElementById("btn-save-group");
    const btnCancel = document.getElementById("btn-cancel-edit-group");
    const btnSelectAll = document.getElementById("btn-group-select-all");
    const btnDeselectAll = document.getElementById("btn-group-deselect-all");
    const nameInput = document.getElementById("group-name-input");
    const pageContainer = document.querySelector(".installed-page-container");

    const openDrawer = () => {
      if (installedFilterDrawer && installedFilterDrawer.isOpen) {
        installedFilterDrawer.toggle(false);
      }
      isGroupDrawerOpen = true;
      if (drawer) drawer.classList.add("open");
      if (btnManage) btnManage.classList.add("active");
      if (pageContainer) pageContainer.classList.add("group-mode-active");
      updateGroupSelectionUI();
      renderGroupList();
      renderModsGrid();
    };

    const closeDrawer = () => {
      isGroupDrawerOpen = false;
      if (drawer) drawer.classList.remove("open");
      if (btnManage) btnManage.classList.remove("active");
      if (pageContainer) pageContainer.classList.remove("group-mode-active");
      resetGroupEditMode();
    };

    if (btnManage) {
      btnManage.onclick = () => {
        if (isGroupDrawerOpen) closeDrawer();
        else openDrawer();
      };
    }
    if (btnClose) btnClose.onclick = closeDrawer;

    if (btnSelectAll) {
      btnSelectAll.onclick = () => {
        const { mods } = modManager.getMods(currentSettings.xxmiPath, "all", "");
        mods.forEach(m => selectedModsForGroup.add(m.name));
        updateGroupSelectionUI();
        renderModsGrid();
      };
    }

    if (btnDeselectAll) {
      btnDeselectAll.onclick = () => {
        selectedModsForGroup.clear();
        updateGroupSelectionUI();
        renderModsGrid();
      };
    }

    if (btnSave) {
      btnSave.onclick = () => {
        const name = (nameInput ? nameInput.value : "").trim();
        if (!name) {
          showGroupToast(t('groups_err_name'));
          return;
        }
        if (selectedModsForGroup.size === 0) {
          showGroupToast(t('groups_err_no_mods'));
          return;
        }

        groupManager.saveGroup({
          id: editingGroupId,
          name,
          mods: Array.from(selectedModsForGroup)
        });

        resetGroupEditMode();
        renderGroupList();
      };
    }

    if (btnCancel) {
      btnCancel.onclick = resetGroupEditMode;
    }
  };

  const renderModsGrid = () => {
    const grid = document.getElementById("mods-grid");
    const emptyState = document.getElementById("mods-empty-state");
    if (!grid || !emptyState) return;

    const pageContainer = document.querySelector(".installed-page-container");
    if (pageContainer) {
      if (isGroupDrawerOpen) pageContainer.classList.add("group-mode-active");
      else pageContainer.classList.remove("group-mode-active");
    }

    const { validPath, totalCount, characters, mods } = modManager.getMods(
      currentSettings.xxmiPath,
      currentModFilter,
      currentSearchQuery,
      currentCharacterFilter,
      currentSettings.language || "ru",
    );

    if (installedFilterDrawer) {
      installedFilterDrawer.setCharacters(characters);
    }

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
    const fragment = document.createDocumentFragment();

    mods.forEach((mod, index) => {
      const isNsfw = !!mod.nsfw;
      const modIdentifier = mod.name;

      if (isNsfw && currentSettings.nsfwMode === "hide") return;

      const isLocalBlurActive =
        currentSettings.nsfwMode === "blur" ||
        currentSettings.nsfwMode === "blur_local_only";
      const isNsfwBlur = isNsfw && isLocalBlurActive;

      const card = document.createElement("div");
      const isSelected = selectedModsForGroup.has(modIdentifier);
      card.className = `mod-card${isSelected ? " selected-for-group" : ""}${isNsfwBlur ? " has-nsfw-blur" : ""}`;
      card.style.setProperty("--card-opacity", mod.active ? "1" : "0.6");
      card.style.animationDelay = `${Math.min(index, 12) * 0.025}s`;

      const iconActive = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>`;
      const iconInactive = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.83 9L15 12.16V12a3 3 0 0 0-3-3h-.17zm-4.3.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65a3 3 0 0 0 3 3c.22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>`;
      const iconDelete = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;

      const hasMultipleVars = mod.variations && mod.variations.length > 1;
      const varTagHtml = hasMultipleVars
        ? `<div class="mod-vars-tag" title="${t('mod_var_count', { count: mod.variations.length })}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M6 9v6"/><path d="M18 9a9 9 0 0 1-9 9"/></svg>
            <span>${t('mod_var_count', { count: mod.variations.length })}</span>
          </div>`
        : "";

      const charDisplayName = mod.characterLocalized || mod.character;
      const charBadgeHtml = charDisplayName
        ? `<div class="mod-char-badge" title="${t('installed_char_badge_title', { name: charDisplayName })}" data-char="${encodeURIComponent(mod.character || "")}" data-id="${mod.characterId || ""}" data-loc="${encodeURIComponent(charDisplayName)}">
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
            <span>${charDisplayName}</span>
          </div>`
        : "";

      let displayParts = [];
      const isVerWithSubs =
        mod.variationTree &&
        mod.variationTree.some(
          (v) =>
            v.name === mod.activeVariation &&
            v.hasRootMod &&
            v.subVariations &&
            v.subVariations.length > 0,
        );
      if (isVerWithSubs && mod.activeIncludeRoot !== false) {
        displayParts.push(t('mod_var_base_label') || "Base");
      }
      if (Array.isArray(mod.activeSubVariations) && mod.activeSubVariations.length > 0) {
        displayParts.push(...mod.activeSubVariations);
      }
      let displayVarText =
        displayParts.length > 0
          ? displayParts.join(", ")
          : (mod.activeVariation || "");
      const activeVarHtml =
        displayVarText && hasMultipleVars
          ? `<div class="mod-active-var-name" data-tooltip="${displayVarText.replace(/"/g, "&quot;")}">[${displayVarText}]</div>`
          : "";

      card.innerHTML = `
        <div class="mod-select-indicator">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <div class="mod-preview-wrapper">
          <div class="mod-preview ${isNsfwBlur ? "nsfw-blur" : ""}" style="cursor: pointer;">
            ${varTagHtml}
            ${charBadgeHtml}
            ${mod.previewUrl ? "" : `<div class="mod-placeholder"><div class="mod-placeholder-logo"></div></div>`}
          </div>
        </div>
        <div class="mod-footer">
          <button class="mod-toggle-btn ${mod.active ? "active" : ""}" title="${mod.active ? t('mod_turn_off') : t('mod_turn_on')}">
            ${mod.active ? iconActive : iconInactive}
          </button>
          <div class="mod-name-container">
            <div class="mod-name" data-tooltip="${(mod.name || "").replace(/"/g, "&quot;")}">${mod.name}</div>
            ${activeVarHtml}
          </div>
          <button class="mod-delete-btn" title="${t('mod_delete_forever')}">
            ${iconDelete}
          </button>
        </div>
      `;

      if (mod.previewUrl) {
        card.dataset.previewUrl = mod.previewUrl;
        cardMediaObserver.observe(card);
      }

      const charBadgeEl = card.querySelector(".mod-char-badge");
      if (charBadgeEl) {
        charBadgeEl.addEventListener("click", (e) => {
          e.stopPropagation();
          const rawChar = decodeURIComponent(charBadgeEl.dataset.char);
          const rawLoc = decodeURIComponent(charBadgeEl.dataset.loc);
          const rawId = charBadgeEl.dataset.id ? parseInt(charBadgeEl.dataset.id) : null;
          if (installedFilterDrawer) {
            installedFilterDrawer.setSelectedCharacter(rawChar, rawId, rawLoc);
          }
        });
      }

      const toggleSelection = (e) => {
        if (e) e.stopPropagation();
        if (selectedModsForGroup.has(modIdentifier)) {
          selectedModsForGroup.delete(modIdentifier);
          card.classList.remove("selected-for-group");
        } else {
          selectedModsForGroup.add(modIdentifier);
          card.classList.add("selected-for-group");
        }
        updateGroupSelectionUI();
      };

      const selectIndicator = card.querySelector(".mod-select-indicator");
      if (selectIndicator) {
        selectIndicator.addEventListener("click", toggleSelection);
      }

      const previewClickEl = card.querySelector(".mod-preview-wrapper") || card.querySelector(".mod-preview");
      if (previewClickEl) {
        previewClickEl.addEventListener("click", (e) => {
          if (isGroupDrawerOpen) {
            toggleSelection(e);
          } else {
            openModModal(mod);
          }
        });
      }

      const toggleBtn = card.querySelector(".mod-toggle-btn");
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const success = modManager.toggleMod(
          currentSettings.xxmiPath,
          modIdentifier,
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
        } else {
          if (window.Toast) window.Toast.error(t('mod_move_err'));
          else alert(t('mod_move_err'));
        }
      });

      const deleteBtn = card.querySelector(".mod-delete-btn");
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();

        if (mod.variations && mod.variations.length > 1) {
          openVarDeleteModal(mod);
        } else {
          customConfirm(
            t('mod_delete_confirm', { name: mod.name }),
            () => {
              const deleted = modManager.deleteMod(
                currentSettings.xxmiPath,
                modIdentifier,
                mod.active,
              );
              if (deleted) {
                selectedModsForGroup.delete(modIdentifier);
                updateGroupSelectionUI();
                renderModsGrid();
              } else {
                if (window.Toast) window.Toast.error(t('mod_delete_err'));
                else alert(t('mod_delete_err'));
              }
            },
          );
        }
      });

      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
  };

  const openModModal = (mod) => {
    const modal = document.getElementById("mod-modal");
    if (!modal) return;
    const modIdentifier = mod.name;
    document.getElementById("modal-title").textContent = mod.name;
    document.getElementById("modal-status").textContent = mod.active
      ? t('mod_status_on')
      : t('mod_status_off');
    document.getElementById("modal-status").style.color = mod.active
      ? "#4CAF50"
      : "#f44336";

    const charRow = document.getElementById("modal-char-row");
    const charBadge = document.getElementById("modal-char-badge");
    const editCharBtn = document.getElementById("modal-edit-char-btn");
    const charPicker = document.getElementById("modal-char-picker");
    const charPickerSearch = document.getElementById("modal-char-picker-search");
    const charPickerList = document.getElementById("modal-char-picker-list");

    const updateCharDisplay = () => {
      const charDisplayName = mod.characterLocalized || mod.character;
      if (charRow && charBadge) {
        charRow.style.display = "flex";
        charBadge.textContent = `${t('modal_character')}: ${charDisplayName || t('modal_char_unassigned')}`;
      }
    };

    if (charPicker) {
      charPicker.style.display = "none";
    }

    const renderCharPickerList = (searchQuery = "") => {
      if (!charPickerList) return;
      const allOptions = modManager.getAvailableCharactersAndCategories(currentSettings.language || "ru");
      const searchLower = (searchQuery || "").trim().toLowerCase();

      const filtered = allOptions.filter(item => {
        if (!searchLower) return true;
        const inName = (item.name || "").toLowerCase().includes(searchLower);
        const inLoc = (item.localizedName || "").toLowerCase().includes(searchLower);
        const inCat = (item.category || "").toLowerCase().includes(searchLower);
        return inName || inLoc || inCat;
      });

      if (filtered.length === 0) {
        charPickerList.innerHTML = `<div style="padding: 10px; color: var(--text-muted); font-size: 0.8rem; text-align: center;">${t('gb_search_empty')}</div>`;
        return;
      }

      charPickerList.innerHTML = filtered.map(item => {
        const isSelected = (mod.character && mod.character.toLowerCase() === item.name.toLowerCase()) || (mod.characterId && mod.characterId === item.id);
        const fallbackIcon = item.isBangboo ? "https://images.gamebanana.com/img/ico/ModCategory/669c13bb037b1.png" : "https://images.gamebanana.com/img/ico/ModCategory/66a1928c3e239.gif";
        const iconSrc = item.iconUrl || fallbackIcon;
        const isSpecial = item.isOther;

        return `
          <div class="modal-char-picker-item ${isSelected ? "active" : ""}" data-name="${encodeURIComponent(item.name)}" data-loc="${encodeURIComponent(item.localizedName)}" data-id="${item.id || ""}" data-cat="${encodeURIComponent(item.category || "")}">
            <div class="modal-char-picker-left">
              ${isSpecial ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>` : `<img class="modal-char-picker-avatar" src="${iconSrc}" alt="" onerror="this.onerror=null; this.src='${fallbackIcon}';">`}
              <span class="modal-char-picker-name">${item.localizedName || item.name}</span>
            </div>
            <span class="modal-char-picker-cat-badge">${item.category || ""}</span>
          </div>
        `;
      }).join("");

      charPickerList.querySelectorAll(".modal-char-picker-item").forEach(itemEl => {
        itemEl.onclick = () => {
          const rawName = decodeURIComponent(itemEl.dataset.name);
          const rawLoc = decodeURIComponent(itemEl.dataset.loc);
          const rawId = itemEl.dataset.id ? parseInt(itemEl.dataset.id) : null;
          const rawCat = decodeURIComponent(itemEl.dataset.cat);

          modManager.setModMetadata(modIdentifier, {
            character: rawName,
            characterId: rawId,
            category: rawCat
          }, mod.paths);

          mod.character = rawName;
          mod.characterLocalized = rawLoc;
          mod.characterId = rawId;
          mod.category = rawCat;

          updateCharDisplay();
          if (charPicker) charPicker.style.display = "none";
          renderModsGrid();
          showGroupToast(t('modal_char_updated', { name: rawLoc }));
        };
      });
    };

    if (editCharBtn && charPicker) {
      editCharBtn.onclick = () => {
        const isHidden = charPicker.style.display === "none";
        charPicker.style.display = isHidden ? "flex" : "none";
        if (isHidden) {
          if (charPickerSearch) {
            charPickerSearch.value = "";
            setTimeout(() => charPickerSearch.focus(), 100);
          }
          renderCharPickerList("");
        }
      };
    }

    if (charPickerSearch) {
      charPickerSearch.oninput = (e) => {
        renderCharPickerList(e.target.value);
      };
    }

    updateCharDisplay();

    const nsfwCheckbox = document.getElementById("modal-nsfw-checkbox");
    if (nsfwCheckbox) {
      nsfwCheckbox.checked = !!mod.nsfw;
      nsfwCheckbox.onchange = () => {
        const isChecked = nsfwCheckbox.checked;
        mod.nsfw = isChecked;
        modManager.setModMetadata(modIdentifier, { nsfw: isChecked }, mod.paths);
        updateModalMedia();
        renderModsGrid();
      };
    }

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

    const updateModalMedia = () => {
      const imgContainer = document.getElementById("modal-image-container");
      if (!imgContainer) return;
      imgContainer.style.position = "relative";
      const nsfwBadgeHtml = mod.nsfw
        ? `<div class="nsfw-badge" style="position: absolute; top: 12px; right: 12px; z-index: 10;">18+</div>`
        : "";
      if (mod.previewUrl) {
        const safeUrl = encodeURI(mod.previewUrl)
          .replace(/'/g, "%27")
          .replace(/"/g, "%22");
        imgContainer.innerHTML = `
          ${nsfwBadgeHtml}
          <img src="${safeUrl}" alt="${mod.name}" style="cursor: pointer;" title="Нажмите для открытия в полный размер">
        `;
        const imgEl = imgContainer.querySelector("img");
        if (imgEl) {
          imgEl.onclick = () => openLightbox(mod.previewUrl);
        }
      } else {
        imgContainer.innerHTML = `
          ${nsfwBadgeHtml}
          <div style="padding: 40px; background: rgba(255,255,255,0.05); border-radius: 8px; color: var(--color-muted);">${t('mod_no_image')}</div>
        `;
      }

      const desc = document.getElementById("modal-description");
      const descText = mod.description || (modManager.getModDescription ? modManager.getModDescription(mod) : "");
      if (descText) {
        desc.style.display = "block";
        desc.textContent = descText;
      } else {
        desc.style.display = "none";
      }
    };

    updateModalMedia();

    const varsBox = document.getElementById("modal-variations-box");
    const varsList = document.getElementById("modal-variations-list");
    const varsCount = document.getElementById("modal-variations-count");

    const renderModalVars = () => {
      const hasTree = mod.variationTree && mod.variationTree.length > 0;
      const hasFlat = mod.variations && mod.variations.length > 0;

      if (varsBox && varsList && (hasTree || hasFlat)) {
        varsBox.style.display = "block";
        const tree = hasTree ? mod.variationTree : [{ name: mod.name, subVariations: mod.variations }];
        let totalCount = 0;
        tree.forEach(v => {
          let count = (v.subVariations && v.subVariations.length > 0) ? v.subVariations.length : 1;
          if (v.hasRootMod && v.subVariations && v.subVariations.length > 0) {
            count += 1;
          }
          totalCount += count;
        });
        if (varsCount) varsCount.textContent = totalCount;
        varsList.innerHTML = "";

        const createVarItem = (displayName, fullIdentifier, isSubItem = false) => {
          const isActiveVar = mod.activeVariation === fullIdentifier ||
            mod.activeVariation === displayName ||
            (mod.activeVariation && mod.activeVariation.endsWith("/" + displayName));

          const renderedName = displayName === "Default (Root)" ? t('mod_var_root') : displayName;

          const item = document.createElement("div");
          item.className = `var-item ${isSubItem ? "var-subitem" : "var-version-item"}${isActiveVar ? " var-item-active" : ""}`;
          item.innerHTML = `
            <div class="var-info">
              <div class="var-folder-icon ${isSubItem ? "subvar-icon" : ""}">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <span class="var-name" title="${renderedName}">${renderedName}</span>
              ${isActiveVar ? `<span class="var-active-badge">${t('mod_var_active')}</span>` : ""}
            </div>
            <div class="var-actions">
              <button class="btn-var-delete" data-var="${fullIdentifier}" title="${t('confirm_delete')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"/></svg>
              </button>
            </div>
          `;

          item.addEventListener("click", (e) => {
            if (e.target.closest(".btn-var-delete")) return;
            if (mod.activeVariation === fullIdentifier) return;

            const success = modManager.switchModVariation(
              currentSettings.xxmiPath,
              modIdentifier,
              fullIdentifier,
            );
            if (success) {
              mod.activeVariation = fullIdentifier;
              if (modManager.getModPreviewAndDescription) {
                const info = modManager.getModPreviewAndDescription(
                  currentSettings.xxmiPath,
                  modIdentifier,
                  fullIdentifier,
                );
                if (info && info.previewUrl) {
                  mod.previewUrl = info.previewUrl;
                }
              }
              updateModalMedia();
              renderModalVars();
              renderModalKeybinds();

              const allCards = document.querySelectorAll(".mod-card");
              for (const cardEl of allCards) {
                const titleEl = cardEl.querySelector(".mod-title");
                if (titleEl && titleEl.textContent.trim() === mod.name) {
                  const previewEl = cardEl.querySelector(".mod-preview");
                  if (previewEl && mod.previewUrl) {
                    previewEl.style.backgroundImage = `url("${encodeURI(mod.previewUrl).replace(/'/g, "%27").replace(/"/g, "%22")}")`;
                  }
                  break;
                }
              }

              showGroupToast(t('mod_var_switched', { varName: renderedName }));
            }
          });

          const delBtn = item.querySelector(".btn-var-delete");
          if (delBtn) {
            delBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              customConfirm(
                t('mod_delete_single_var_confirm', {
                  varName: displayName,
                  modName: mod.name,
                }),
                () => {
                  const res = modManager.deleteModVariation(
                    currentSettings.xxmiPath,
                    modIdentifier,
                    fullIdentifier,
                    mod.active,
                  );
                  if (res.success) {
                    if (res.remainingCount === 0) {
                      modal.style.display = "none";
                      selectedModsForGroup.delete(modIdentifier);
                      updateGroupSelectionUI();
                      renderModsGrid();
                    } else {
                      const { mods } = modManager.getMods(
                        currentSettings.xxmiPath,
                        "all",
                        "",
                      );
                      const updatedMod = mods.find((m) => (m.relPath || m.name) === modIdentifier);
                      if (updatedMod) {
                        mod.previewUrl = updatedMod.previewUrl;
                        mod.description = updatedMod.description;
                        mod.variations = updatedMod.variations;
                        mod.variationTree = updatedMod.variationTree;
                        mod.activeVariation = updatedMod.activeVariation;
                      }
                      updateModalMedia();
                      renderModalVars();
                      renderModalKeybinds();
                      renderModsGrid();
                    }
                  } else {
                    if (window.Toast) window.Toast.error(t('mod_delete_err'));
                    else alert(t('mod_delete_err'));
                  }
                },
              );
            });
          }

          return item;
        };

        const createRootVarItem = (ver) => {
          const isVerActive = mod.activeVariation === ver.name;
          const isRootActive = isVerActive && mod.activeIncludeRoot !== false;

          const item = document.createElement("div");
          item.className = `var-item var-subitem var-root-item${isRootActive ? " var-item-active" : ""}`;
          item.innerHTML = `
            <div class="var-info">
              <label class="var-checkbox-label">
                <input type="checkbox" class="var-sub-checkbox" ${isRootActive ? "checked" : ""}>
              </label>
              <div class="var-folder-icon subvar-icon">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <span class="var-name" title="${t('mod_var_root')}">${t('mod_var_root')}</span>
              <span class="var-root-tag" title="${t('mod_has_root_files')}">${t('mod_var_base_label')}</span>
              ${isRootActive ? `<span class="var-active-badge">${t('mod_var_active')}</span>` : ""}
            </div>
          `;

          const checkbox = item.querySelector(".var-sub-checkbox");

          item.addEventListener("click", (e) => {
            if (e.target !== checkbox) {
              checkbox.checked = !checkbox.checked;
            }

            const newIncludeRoot = checkbox.checked;
            let currentSubs = isVerActive && Array.isArray(mod.activeSubVariations)
              ? [...mod.activeSubVariations]
              : [];

            if (!isVerActive) {
              currentSubs = [];
            }

            if (!newIncludeRoot && currentSubs.length === 0) {
              checkbox.checked = true;
              return;
            }

            const success = modManager.switchModVariation(
              currentSettings.xxmiPath,
              modIdentifier,
              ver.name,
              currentSubs,
              newIncludeRoot,
            );

            if (success) {
              mod.activeVariation = ver.name;
              mod.activeSubVariations = currentSubs;
              mod.activeIncludeRoot = newIncludeRoot;
              if (modManager.getModPreviewAndDescription) {
                const info = modManager.getModPreviewAndDescription(
                  currentSettings.xxmiPath,
                  modIdentifier,
                  ver.name,
                );
                if (info && info.previewUrl) {
                  mod.previewUrl = info.previewUrl;
                }
              }
              updateModalMedia();
              renderModalVars();
              renderModalKeybinds();
              renderModsGrid();
              showGroupToast(t('mod_var_switched', { varName: t('mod_var_root') }));
            }
          });

          return item;
        };

        const createSubVarItem = (ver, subName) => {
          const isVerActive = mod.activeVariation === ver.name;
          const isSubActive =
            isVerActive &&
            Array.isArray(mod.activeSubVariations) &&
            mod.activeSubVariations.includes(subName);

          const item = document.createElement("div");
          item.className = `var-item var-subitem${isSubActive ? " var-item-active" : ""}`;
          item.innerHTML = `
            <div class="var-info">
              <label class="var-checkbox-label">
                <input type="checkbox" class="var-sub-checkbox" ${isSubActive ? "checked" : ""}>
              </label>
              <div class="var-folder-icon subvar-icon">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <span class="var-name" title="${subName}">${subName}</span>
              ${isSubActive ? `<span class="var-active-badge">${t('mod_var_active')}</span>` : ""}
            </div>
            <div class="var-actions">
              <button class="btn-var-delete" data-var="${ver.name}/${subName}" title="${t('confirm_delete')}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"/></svg>
              </button>
            </div>
          `;

          const checkbox = item.querySelector(".var-sub-checkbox");

          item.addEventListener("click", (e) => {
            if (e.target.closest(".btn-var-delete")) return;
            if (e.target !== checkbox) {
              checkbox.checked = !checkbox.checked;
            }

            let newActiveSubs = [];
            let newIncludeRoot = mod.activeIncludeRoot !== false;
            if (mod.activeVariation !== ver.name) {
              newActiveSubs = checkbox.checked ? [subName] : [];
              newIncludeRoot = !!ver.hasRootMod;
            } else {
              const currentSubs = new Set(Array.isArray(mod.activeSubVariations) ? mod.activeSubVariations : []);
              if (checkbox.checked) {
                currentSubs.add(subName);
              } else {
                currentSubs.delete(subName);
              }
              newActiveSubs = Array.from(currentSubs);
            }

            if (!newIncludeRoot && newActiveSubs.length === 0) {
              checkbox.checked = true;
              return;
            }

            const success = modManager.switchModVariation(
              currentSettings.xxmiPath,
              modIdentifier,
              ver.name,
              newActiveSubs,
              newIncludeRoot,
            );

            if (success) {
              mod.activeVariation = ver.name;
              mod.activeSubVariations = newActiveSubs;
              mod.activeIncludeRoot = newIncludeRoot;
              if (modManager.getModPreviewAndDescription) {
                const info = modManager.getModPreviewAndDescription(
                  currentSettings.xxmiPath,
                  modIdentifier,
                  ver.name,
                );
                if (info && info.previewUrl) {
                  mod.previewUrl = info.previewUrl;
                }
              }
              updateModalMedia();
              renderModalVars();
              renderModalKeybinds();
              renderModsGrid();
              showGroupToast(t('mod_var_switched', { varName: subName }));
            }
          });

          const delBtn = item.querySelector(".btn-var-delete");
          if (delBtn) {
            delBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              customConfirm(
                t('mod_delete_single_var_confirm', {
                  varName: subName,
                  modName: mod.name,
                }),
                () => {
                  const res = modManager.deleteModVariation(
                    currentSettings.xxmiPath,
                    modIdentifier,
                    `${ver.name}/${subName}`,
                    mod.active,
                  );
                  if (res.success) {
                    if (res.remainingCount === 0) {
                      modal.style.display = "none";
                      selectedModsForGroup.delete(modIdentifier);
                      updateGroupSelectionUI();
                      renderModsGrid();
                    } else {
                      const { mods } = modManager.getMods(
                        currentSettings.xxmiPath,
                        "all",
                        "",
                      );
                      const updatedMod = mods.find((m) => (m.relPath || m.name) === modIdentifier);
                      if (updatedMod) {
                        mod.previewUrl = updatedMod.previewUrl;
                        mod.description = updatedMod.description;
                        mod.variations = updatedMod.variations;
                        mod.variationTree = updatedMod.variationTree;
                        mod.activeVariation = updatedMod.activeVariation;
                        mod.activeSubVariations = updatedMod.activeSubVariations;
                        mod.activeIncludeRoot = updatedMod.activeIncludeRoot;
                      }
                      updateModalMedia();
                      renderModalVars();
                      renderModalKeybinds();
                      renderModsGrid();
                    }
                  } else {
                    if (window.Toast) window.Toast.error(t('mod_delete_err'));
                    else alert(t('mod_delete_err'));
                  }
                },
              );
            });
          }

          return item;
        };

        tree.forEach((ver) => {
          const hasSubVars = ver.subVariations && ver.subVariations.length > 0;
          if (!hasSubVars) {
            varsList.appendChild(createVarItem(ver.name, ver.name, false));
          } else {
            const groupEl = document.createElement("div");
            groupEl.className = "var-version-group";

            const isHeaderActive = mod.activeVariation === ver.name;
            const canSelectRoot = !!ver.hasRootMod;

            const headerEl = document.createElement("div");
            headerEl.className = `var-item var-version-header${canSelectRoot ? " var-has-root" : " var-folder-only"}${isHeaderActive ? " var-item-active" : ""}`;
            headerEl.innerHTML = `
              <div class="var-info">
                <div class="var-chevron-icon" title="Свернуть / Развернуть">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
                <div class="var-folder-icon main-version-folder">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                </div>
                <span class="var-name var-version-title" title="${ver.name}">${ver.name}</span>
                ${canSelectRoot ? `<span class="var-root-tag" title="${t('mod_has_root_files')}">${t('mod_var_base_label')}</span>` : `<span class="var-folder-tag" title="${t('mod_folder_only')}">${t('mod_folder_only')}</span>`}
                ${isHeaderActive ? `<span class="var-active-badge">${t('mod_var_active')}</span>` : ""}
              </div>
              <div class="var-actions">
                <span class="var-version-badge">${ver.subVariations.length + (ver.hasRootMod ? 1 : 0)}</span>
                <button class="btn-var-delete" data-var="${ver.name}" title="${t('confirm_delete')}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"/></svg>
                </button>
              </div>
            `;
            groupEl.appendChild(headerEl);

            const subListEl = document.createElement("div");
            subListEl.className = "var-subversion-list";

            headerEl.addEventListener("click", (e) => {
              if (e.target.closest(".btn-var-delete")) return;
              if (e.target.closest(".var-chevron-icon")) {
                const isCollapsed = subListEl.classList.toggle("collapsed");
                headerEl.classList.toggle("is-collapsed", isCollapsed);
                return;
              }
              if (mod.activeVariation === ver.name && mod.activeIncludeRoot !== false) return;

              const success = modManager.switchModVariation(
                currentSettings.xxmiPath,
                modIdentifier,
                ver.name,
                ver.subVariations || [],
                canSelectRoot,
              );
              if (success) {
                mod.activeVariation = ver.name;
                mod.activeSubVariations = [...(ver.subVariations || [])];
                mod.activeIncludeRoot = canSelectRoot;
                if (modManager.getModPreviewAndDescription) {
                  const info = modManager.getModPreviewAndDescription(
                    currentSettings.xxmiPath,
                    modIdentifier,
                    ver.name,
                  );
                  if (info && info.previewUrl) {
                    mod.previewUrl = info.previewUrl;
                  }
                }
                updateModalMedia();
                renderModalVars();
                renderModalKeybinds();

                const allCards = document.querySelectorAll(".mod-card");
                for (const cardEl of allCards) {
                  const titleEl = cardEl.querySelector(".mod-title");
                  if (titleEl && titleEl.textContent.trim() === mod.name) {
                    const previewEl = cardEl.querySelector(".mod-preview");
                    if (previewEl && mod.previewUrl) {
                      previewEl.style.backgroundImage = `url("${encodeURI(mod.previewUrl).replace(/'/g, "%27").replace(/"/g, "%22")}")`;
                    }
                    break;
                  }
                }

                showGroupToast(t('mod_var_switched', { varName: ver.name }));
              }
            });

            const delBtn = headerEl.querySelector(".btn-var-delete");
            if (delBtn) {
              delBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                customConfirm(
                  t('mod_delete_single_var_confirm', {
                    varName: ver.name,
                    modName: mod.name,
                  }),
                  () => {
                    const res = modManager.deleteModVariation(
                      currentSettings.xxmiPath,
                      modIdentifier,
                      ver.name,
                      mod.active,
                    );
                    if (res.success) {
                      if (res.remainingCount === 0) {
                        modal.style.display = "none";
                        selectedModsForGroup.delete(modIdentifier);
                        updateGroupSelectionUI();
                        renderModsGrid();
                      } else {
                        const { mods } = modManager.getMods(
                          currentSettings.xxmiPath,
                          "all",
                          "",
                        );
                        const updatedMod = mods.find((m) => (m.relPath || m.name) === modIdentifier);
                        if (updatedMod) {
                          mod.previewUrl = updatedMod.previewUrl;
                          mod.description = updatedMod.description;
                          mod.variations = updatedMod.variations;
                          mod.variationTree = updatedMod.variationTree;
                          mod.activeVariation = updatedMod.activeVariation;
                          mod.activeSubVariations = updatedMod.activeSubVariations;
                          mod.activeIncludeRoot = updatedMod.activeIncludeRoot;
                        }
                        updateModalMedia();
                        renderModalVars();
                        renderModalKeybinds();
                        renderModsGrid();
                      }
                    } else {
                      if (window.Toast) window.Toast.error(t('mod_delete_err'));
                      else alert(t('mod_delete_err'));
                    }
                  },
                );
              });
            }

            if (ver.hasRootMod) {
              subListEl.appendChild(createRootVarItem(ver));
            }
            ver.subVariations.forEach((subName) => {
              subListEl.appendChild(createSubVarItem(ver, subName));
            });

            groupEl.appendChild(subListEl);
            varsList.appendChild(groupEl);
          }
        });
      } else if (varsBox) {
        varsBox.style.display = "none";
      }
    };


    const keybindsList = document.getElementById("modal-keybinds-list");
    const keybindsCount = document.getElementById("modal-keybinds-count");

    const renderModalKeybinds = () => {
      if (!keybindsList) return;
      const binds = modManager.getModKeybinds(
        modIdentifier,
        mod.activeVariation,
        currentSettings.xxmiPath,
      );

      if (keybindsCount) {
        keybindsCount.textContent = binds.length;
        keybindsCount.style.display = binds.length > 0 ? "inline-flex" : "none";
      }

      if (binds.length === 0) {
        keybindsList.innerHTML = `<div class="modal-keybind-empty">${t('mod_keybinds_empty')}</div>`;
        return;
      }

      keybindsList.innerHTML = binds
        .map((b) => {
          const keysHtml = b.keys
            .map((k) => `<kbd class="keycap">${k}</kbd>`)
            .join('<span class="keycap-plus">+</span>');

          const backKeysHtml =
            b.backKeys && b.backKeys.length > 0
              ? ` <span style="color:var(--text-muted);font-size:0.7rem;">/</span> ` +
              b.backKeys
                .map((k) => `<kbd class="keycap">${k}</kbd>`)
                .join('<span class="keycap-plus">+</span>')
              : "";

          const optionsHtml =
            b.options && b.options.length > 0
              ? `<div class="modal-keybind-options">
                  ${b.options.map((opt) => `<span class="modal-keybind-opt-pill">${opt}</span>`).join("")}
                </div>`
              : "";

          return `
            <div class="modal-keybind-item">
              <div class="modal-keybind-top">
                <span class="modal-keybind-name">${b.name}</span>
                <div class="modal-keybind-keys">
                  ${keysHtml}${backKeysHtml}
                </div>
              </div>
              ${optionsHtml ? `<div class="modal-keybind-bottom">${optionsHtml}</div>` : ""}
            </div>
          `;
        })
        .join("");
    };

    renderModalVars();
    renderModalKeybinds();
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.classList.add("active");
  };

  const openVarDeleteModal = (mod) => {
    let modal = document.getElementById("var-delete-modal");
    if (!modal) return;

    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    const titleEl = document.getElementById("var-delete-title");
    const descEl = document.getElementById("var-delete-desc");
    const listEl = document.getElementById("var-delete-list");
    const cancelBtn = document.getElementById("var-delete-cancel");
    const delSelectedBtn = document.getElementById("var-delete-selected");
    const delAllBtn = document.getElementById("var-delete-all");
    const closeBtn = document.getElementById("var-delete-close");

    if (titleEl)
      titleEl.textContent = `${t('mod_delete_var_title')}: ${mod.name}`;
    if (descEl) descEl.textContent = t('mod_delete_var_desc');
    listEl.innerHTML = "";

    const selectedVars = new Set();

    const updateBtnState = () => {
      if (delSelectedBtn) {
        delSelectedBtn.textContent = t('mod_delete_selected_vars', {
          count: selectedVars.size,
        });
        delSelectedBtn.disabled = selectedVars.size === 0;
        delSelectedBtn.style.opacity = selectedVars.size === 0 ? "0.5" : "1";
        delSelectedBtn.style.cursor =
          selectedVars.size === 0 ? "not-allowed" : "pointer";
      }
    };

    mod.variations.forEach((varName) => {
      const isActiveVar = varName === mod.activeVariation;
      const item = document.createElement("div");
      item.className = "var-delete-item";
      item.innerHTML = `
        <input type="checkbox" class="var-delete-chk">
        <span class="var-delete-item-name">${varName}</span>
        ${isActiveVar ? `<span class="var-active-badge">${t('mod_var_active')}</span>` : ""}
      `;

      const chk = item.querySelector("input[type='checkbox']");
      const toggleCheck = (checked) => {
        chk.checked = checked;
        if (checked) {
          selectedVars.add(varName);
          item.classList.add("selected");
        } else {
          selectedVars.delete(varName);
          item.classList.remove("selected");
        }
        updateBtnState();
      };

      item.addEventListener("click", (e) => {
        if (e.target === chk) {
          toggleCheck(chk.checked);
        } else {
          toggleCheck(!chk.checked);
        }
      });

      listEl.appendChild(item);
    });

    updateBtnState();
    modal.classList.add("active");

    const closeModal = () => {
      modal.classList.remove("active");
    };

    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;
    modal.onclick = (e) => {
      if (e.target === modal) closeModal();
    };

    const modIdentifier = mod.name;

    if (delSelectedBtn) {
      delSelectedBtn.onclick = () => {
        if (selectedVars.size === 0) return;

        if (selectedVars.size === mod.variations.length) {
          const deleted = modManager.deleteMod(
            currentSettings.xxmiPath,
            modIdentifier,
            mod.active,
          );
          if (deleted) {
            selectedModsForGroup.delete(modIdentifier);
            updateGroupSelectionUI();
            renderModsGrid();
            closeModal();
            if (window.Toast) window.Toast.success(t('mod_deleted') || "Mod deleted");
          } else {
            if (window.Toast) window.Toast.error(t('mod_delete_err'));
            else alert(t('mod_delete_err'));
          }
        } else {
          for (const v of selectedVars) {
            modManager.deleteModVariation(
              currentSettings.xxmiPath,
              modIdentifier,
              v,
              mod.active,
            );
          }
          renderModsGrid();
          closeModal();
          if (window.Toast) window.Toast.success(t('mod_delete_selected_vars', { count: selectedVars.size }) || "Variations deleted");
        }
      };
    }

    if (delAllBtn) {
      delAllBtn.onclick = () => {
        customConfirm(
          t('mod_delete_confirm', { name: mod.name }),
          () => {
            const deleted = modManager.deleteMod(
              currentSettings.xxmiPath,
              modIdentifier,
              mod.active,
            );
            if (deleted) {
              selectedModsForGroup.delete(modIdentifier);
              updateGroupSelectionUI();
              renderModsGrid();
              closeModal();
              if (window.Toast) window.Toast.success(t('mod_deleted') || "Mod deleted");
            } else {
              if (window.Toast) window.Toast.error(t('mod_delete_err'));
              else alert(t('mod_delete_err'));
            }
          },
        );
      };
    }
  };

  const initModalLogic = () => {
    const modal = document.getElementById("mod-modal");
    const closeBtn = document.getElementById("modal-close");
    if (!modal || !closeBtn) return;

    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.replaceWith(newCloseBtn);
    newCloseBtn.addEventListener("click", () => {
      modal.classList.remove("active");
    });
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.classList.remove("active");
      }
    };
  };

  let gbPage = 1;
  let gbLoading = false;
  let gbHasMore = true;
  let gbSearchQuery = "";
  let gbSortVal = "default";
  let gbAbortController = null;

  let sideMenuDownload = null;

  const initGameBananaCatalog = () => {
    const sortSelect = document.getElementById("gb-sort");
    const refreshBtn = document.getElementById("gb-refresh-btn");
    const searchInput = document.getElementById("gb-search");
    const grid = document.getElementById("gb-grid");
    const filterBtn = document.getElementById("gb-filter-btn");

    if (!grid) return;

    if (sortSelect) {
      sortSelect.value = gbSortVal;
    }
    if (searchInput) {
      searchInput.value = gbSearchQuery;
    }

    const updateActiveFilterUI = (categoryId, categoryName) => {
      const btn = document.getElementById("gb-filter-btn");
      const badge = document.getElementById("gb-filter-badge");
      const bar = document.getElementById("gb-active-filter-bar");

      if (categoryId) {
        if (btn) btn.classList.add("has-active-filter");
        if (badge) {
          badge.style.display = "inline-block";
          badge.textContent = "1";
        }
        if (bar) {
          bar.style.display = "flex";
          bar.innerHTML = `
            <div class="gb-filter-pill">
              <span>${t('gb_active_filter_tag', { name: categoryName })}</span>
              <button id="gb-clear-tag-btn" class="gb-filter-pill-btn" title="${t('gb_filter_reset')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          `;
          const clearTagBtn = document.getElementById("gb-clear-tag-btn");
          if (clearTagBtn) {
            clearTagBtn.onclick = () => {
              if (sideMenuDownload) sideMenuDownload.setCategory(null, null);
            };
          }
        }
      } else {
        if (btn) btn.classList.remove("has-active-filter");
        if (badge) badge.style.display = "none";
        if (bar) {
          bar.style.display = "none";
          bar.innerHTML = "";
        }
      }
    };

    const handleFilterChange = (filters) => {
      gbSortVal = filters.sort;
      const sSelect = document.getElementById("gb-sort");
      if (sSelect && sSelect.value !== filters.sort) {
        sSelect.value = filters.sort;
      }
      if (filters.categoryId) {
        gbSearchQuery = "";
        const sInput = document.getElementById("gb-search");
        if (sInput) sInput.value = "";
      }
      updateActiveFilterUI(filters.categoryId, filters.categoryName);
      fetchGBMods(false);
    };

    const handleNsfwChange = (mode) => {
      currentSettings.nsfwMode = mode;
      try {
        fs.writeFileSync(settingsFilePath, JSON.stringify(currentSettings, null, 2), "utf-8");
      } catch (e) { }
      const settingsNsfw = document.getElementById("setting-nsfw-mode");
      if (settingsNsfw) settingsNsfw.value = mode;
    };

    if (!sideMenuDownload) {
      sideMenuDownload = new SideMenuDownload({
        containerId: "gb-drawer-container",
        currentSort: gbSortVal,
        nsfwMode: currentSettings.nsfwMode || "hide",
        language: currentSettings.language || "ru",
        t: (k, p) => t(k, p),
        onFilterChange: handleFilterChange,
        onNsfwChange: handleNsfwChange
      });
      sideMenuDownload.init();
    } else {
      sideMenuDownload.currentLang = currentSettings.language || "ru";
      sideMenuDownload.t = (k, p) => t(k, p);
      sideMenuDownload.onFilterChange = handleFilterChange;
      sideMenuDownload.onNsfwChange = handleNsfwChange;
      sideMenuDownload.render();
      updateActiveFilterUI(sideMenuDownload.selectedCategoryId, sideMenuDownload.selectedCategoryName);
    }

    if (filterBtn) {
      filterBtn.onclick = () => sideMenuDownload.toggle();
    }

    const getCatIdFromObj = (obj) => {
      if (!obj) return null;
      if (obj._idRow) return parseInt(obj._idRow);
      if (obj._sProfileUrl) {
        const match = obj._sProfileUrl.match(/\/cats\/(\d+)/);
        if (match) return parseInt(match[1]);
      }
      return null;
    };

    const matchesCategory = (record, targetCatId) => {
      if (!targetCatId) return true;
      const subId = getCatIdFromObj(record._aSubCategory);
      const cId = getCatIdFromObj(record._aCategory);
      const rootId = getCatIdFromObj(record._aRootCategory);
      return subId === targetCatId || cId === targetCatId || rootId === targetCatId;
    };

    const fetchWithRetry = async (url, options = {}, retries = 2, delay = 800) => {
      for (let i = 0; i <= retries; i++) {
        try {
          const res = await fetch(url, options);
          if (res.ok) return res;
          if (i === retries) return res;
        } catch (err) {
          if (err.name === "AbortError" || (options.signal && options.signal.aborted)) {
            throw err;
          }
          if (i === retries) throw err;
        }
        await new Promise((r) => setTimeout(r, delay * Math.pow(1.5, i)));
      }
    };

    const fetchGBMods = async (append = false) => {
      if (gbAbortController && !append) {
        gbAbortController.abort();
      }
      gbAbortController = new AbortController();
      const currentSignal = gbAbortController.signal;

      gbLoading = true;
      const loadingEl = document.getElementById("gb-loading");
      const bottomLoadingEl = document.getElementById("gb-bottom-loading");
      if (loadingEl && !append) loadingEl.style.display = "flex";
      if (bottomLoadingEl && append) bottomLoadingEl.style.display = "flex";

      const currentGrid = document.getElementById("gb-grid");
      if (!append) {
        gbPage = 1;
        gbHasMore = true;
        if (currentGrid) currentGrid.innerHTML = "";
      }
      const sortVal = gbSortVal || (sortSelect ? sortSelect.value : "default");
      const searchVal = gbSearchQuery.trim();
      const selectedCatId = sideMenuDownload ? sideMenuDownload.selectedCategoryId : null;
      const selectedCatName = sideMenuDownload ? (sideMenuDownload.selectedCategoryName || "") : "";

      let sortMap = {
        default: "Generic_MostLiked",
        new: "Generic_Newest",
        updated: "Generic_LatestUpdated",
        downloads: "Generic_MostDownloaded",
        views: "Generic_MostViewed",
        likes: "Generic_MostLiked",
      };
      let gbSort = sortMap[sortVal] || "Generic_MostLiked";

      const csvProps =
        "_idRow,_sName,_aPreviewMedia,_nLikeCount,_tsDateUpdated,_tsDateAdded,_bContainsNsfw,_bIsNsfw,_bHasNsfw,_bMatureContent,_sInitialVisibility,_aContentRatings,_aCategory,_aRootCategory,_aSubCategory,_sDescription";

      try {
        let records = [];

        if (searchVal && selectedCatId) {
          const isRootCat = (modManager.rootCategories || []).some((rc) => rc.id === selectedCatId);
          if (isRootCat) {
            const url = `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_idGameRow=19567&_sSearchString=${encodeURIComponent(searchVal)}&_nPage=${gbPage}&_nPerpage=50&_csvProperties=${csvProps}`;
            const res = await fetchWithRetry(url, { signal: currentSignal });
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const data = await res.json();
            if (currentSignal.aborted) return;
            records = (data._aRecords || []).filter((r) => matchesCategory(r, selectedCatId));
            gbHasMore = false;
          } else {
            const p1 = fetchWithRetry(
              `https://gamebanana.com/apiv11/Mod/Index?_nPage=1&_nPerpage=50&_aFilters[Generic_Category]=${selectedCatId}&_csvProperties=${csvProps}`,
              { signal: currentSignal }
            );
            const p2 = fetchWithRetry(
              `https://gamebanana.com/apiv11/Mod/Index?_nPage=2&_nPerpage=50&_aFilters[Generic_Category]=${selectedCatId}&_csvProperties=${csvProps}`,
              { signal: currentSignal }
            );
            const p3 = fetchWithRetry(
              `https://gamebanana.com/apiv11/Mod/Index?_nPage=3&_nPerpage=50&_aFilters[Generic_Category]=${selectedCatId}&_csvProperties=${csvProps}`,
              { signal: currentSignal }
            );
            const pSearch = fetchWithRetry(
              `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_idGameRow=19567&_sSearchString=${encodeURIComponent(selectedCatName + " " + searchVal)}&_nPage=1&_nPerpage=50&_csvProperties=${csvProps}`,
              { signal: currentSignal }
            );

            const [r1, r2, r3, rSearch] = await Promise.all([p1, p2, p3, pSearch].map((p) => p.then((res) => (res.ok ? res.json() : null)).catch(() => null)));
            if (currentSignal.aborted) return;

            const seen = new Set();
            const allItems = [];
            [r1, r2, r3, rSearch].forEach((data) => {
              if (data && data._aRecords) {
                data._aRecords.forEach((item) => {
                  if (!seen.has(item._idRow) && matchesCategory(item, selectedCatId)) {
                    seen.add(item._idRow);
                    allItems.push(item);
                  }
                });
              }
            });

            const lowerQuery = searchVal.toLowerCase();
            records = allItems.filter((m) => {
              const inName = m._sName && m._sName.toLowerCase().includes(lowerQuery);
              const inDesc = m._sDescription && m._sDescription.toLowerCase().includes(lowerQuery);
              return inName || inDesc;
            });
            gbHasMore = false;
          }
        } else {
          let url = "";
          if (searchVal) {
            url = `https://gamebanana.com/apiv11/Util/Search/Results?_sModelName=Mod&_idGameRow=19567&_sSearchString=${encodeURIComponent(searchVal)}&_nPage=${gbPage}&_nPerpage=30&_csvProperties=${csvProps}`;
          } else if (selectedCatId) {
            url = `https://gamebanana.com/apiv11/Mod/Index?_nPage=${gbPage}&_nPerpage=30&_aFilters[Generic_Category]=${selectedCatId}&_sSort=${gbSort}&_csvProperties=${csvProps}`;
          } else {
            url = `https://gamebanana.com/apiv11/Mod/Index?_nPage=${gbPage}&_nPerpage=30&_aFilters[Generic_Game]=19567&_sSort=${gbSort}&_csvProperties=${csvProps}`;
          }

          const res = await fetchWithRetry(url, { signal: currentSignal });
          if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
          const data = await res.json();
          if (currentSignal.aborted) return;
          records = data._aRecords || [];
          if (records.length < 30) gbHasMore = false;
        }

        if (sideMenuDownload) {
          sideMenuDownload.discoverNewSubcategories(records);
        }
        renderGBGrid(records, append);
      } catch (err) {
        if (err.name === "AbortError" || currentSignal.aborted) return;
        const cGrid = document.getElementById("gb-grid");
        if (!append && cGrid)
          cGrid.innerHTML =
            `<div style="color: var(--color-red); grid-column: 1 / -1; text-align: center; margin-top: 20px;">${t('gb_load_err')}</div>`;
      } finally {
        gbLoading = false;
        if (loadingEl) loadingEl.style.display = "none";
        if (bottomLoadingEl) bottomLoadingEl.style.display = "none";
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

    const handleScroll = (target) => {
      if (!target) return;
      checkScroll(target);
    };

    if (grid) grid.onscroll = (e) => handleScroll(e.target);
    const mainContent =
      document.getElementById("content-container") ||
      document.querySelector(".main-content");
    if (mainContent) mainContent.onscroll = (e) => handleScroll(e.target);

    if (refreshBtn) refreshBtn.onclick = () => fetchGBMods(false);
    if (sortSelect) {
      sortSelect.onchange = () => {
        gbSortVal = sortSelect.value;
        if (sideMenuDownload) {
          sideMenuDownload.updateSelectedSort(sortSelect.value);
        }
        fetchGBMods(false);
      };
    }

    let searchTimeout = null;
    if (searchInput) {
      searchInput.oninput = () => {
        gbSearchQuery = searchInput.value;
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

    const loadingEl = document.getElementById("gb-loading");
    if (loadingEl) loadingEl.style.display = "none";

    if (!append && records.length === 0) {
      grid.innerHTML =
        `<div style="color: var(--color-muted); grid-column: 1 / -1; text-align: center; margin-top: 40px;">${t('gb_search_empty')}</div>`;
      return;
    }

    const fragment = document.createDocumentFragment();

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
        mod._bMatureContent ||
        mod._sInitialVisibility === "warn" ||
        mod._sInitialVisibility === "hide";
      const isNsfwText = nsfwRegex.test(textToScan);
      const isNsfw = isNsfwFlagged || isNsfwText;

      if (isNsfw && currentSettings.nsfwMode === "hide") return;

      const isCatalogBlurActive =
        currentSettings.nsfwMode === "blur" ||
        currentSettings.nsfwMode === "blur_download_only";
      const isNsfwBlur = isNsfw && isCatalogBlurActive;
      const card = document.createElement("div");
      card.className = `mod-card${isNsfwBlur ? " has-nsfw-blur" : ""}`;
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
          (mod._aPreviewMedia._aImages[0]._sFile220 || mod._aPreviewMedia._aImages[0]._sFile);
      }

      const imgClass = isNsfwBlur ? "nsfw-blur" : "";
      const nsfwBadgeHtml = isNsfw
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
                    <div class="mod-preview ${imgClass}" style="cursor: pointer;">
                        ${imgUrl ? "" : '<div class="mod-placeholder">GB</div>'}
                    </div>
                    ${nsfwBadgeHtml}
                </div>
                <div class="mod-footer">
                    <button class="mod-toggle-btn ${btnClass}" title="${btnTitle}">
                        ${btnIcon}
                    </button>
                    <div class="mod-name-container">
                        <div class="mod-name" data-tooltip="${(mod._sName || "").replace(/"/g, "&quot;")}">${mod._sName}</div>
                        <div class="mod-stats">
                            <span title="${t('gb_likes')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg> ${likes}</span>
                            <span id="dl-count-${mod._idRow}" title="${t('gb_downloads')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg> ...</span>
                            <span title="${t('gb_updated')}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg> ${timeAgoStr}</span>
                        </div>
                    </div>
                </div>
            `;

      if (imgUrl) {
        card.dataset.previewUrl = imgUrl;
        cardMediaObserver.observe(card);
      }

      card.querySelector(".mod-preview-wrapper").onclick = () =>
        openGBModal(mod);

      const toggleBtn = card.querySelector(".mod-toggle-btn");
      toggleBtn.onclick = (e) => {
        e.stopPropagation();
        if (!isDownloaded && !isDownloading) openGBModal(mod);
      };

      fragment.appendChild(card);
    });

    grid.appendChild(fragment);
    fetchBatchDownloads(records);
  };

  let gbImages = [];
  let gbImgIndex = 0;

  const triggerSlideAnim = () => {
    const imgEl = document.getElementById("gb-modal-img");
    if (!imgEl) return;
    imgEl.classList.remove("slide-anim");
    void imgEl.offsetWidth;
    imgEl.classList.add("slide-anim");
  };

  const showModalImage = (index) => {
    if (!gbImages || gbImages.length === 0) return;
    gbImgIndex = (index + gbImages.length) % gbImages.length;
    const nextUrl = gbImages[gbImgIndex];
    const imgEl = document.getElementById("gb-modal-img");
    if (!imgEl) return;

    imgEl.src = nextUrl;
    triggerSlideAnim();

    const nextIdx = (gbImgIndex + 1) % gbImages.length;
    const prevIdx = (gbImgIndex - 1 + gbImages.length) % gbImages.length;
    if (gbImages[nextIdx]) {
      const p1 = new Image();
      p1.src = gbImages[nextIdx];
    }
    if (gbImages[prevIdx]) {
      const p2 = new Image();
      p2.src = gbImages[prevIdx];
    }
  };

  const startIdleTimer = () => {
    clearTimeout(gbIdleTimer);
    if (gbImages.length <= 1) return;
    gbIdleTimer = setTimeout(() => {
      showModalImage(gbImgIndex + 1);
      startIdleTimer();
    }, 10000);
  };

  const resetIdleTimer = () => {
    clearTimeout(gbIdleTimer);
    startIdleTimer();
  };

  const openGBModal = async (mod) => {
    if (!mod || !mod._idRow) return;

    const existingModals = document.querySelectorAll("#gb-modal");
    if (existingModals.length > 1) {
      for (let i = 0; i < existingModals.length - 1; i++) {
        existingModals[i].remove();
      }
    }

    const modal = document.getElementById("gb-modal");
    if (!modal) return;

    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }

    clearTimeout(gbIdleTimer);

    const titleEl = modal.querySelector("#gb-modal-title");
    const linkEl = modal.querySelector("#gb-modal-link");
    const imgEl = modal.querySelector("#gb-modal-img");
    const carouselContainer = modal.querySelector("#gb-carousel-container");
    const prevBtn = modal.querySelector("#gb-carousel-prev");
    const nextBtn = modal.querySelector("#gb-carousel-next");
    const descEl = modal.querySelector("#gb-modal-desc");
    const filesLoading = modal.querySelector("#gb-files-loading");
    const filesList = modal.querySelector("#gb-files-list");
    const closeBtn = modal.querySelector("#gb-modal-close");

    if (titleEl) titleEl.textContent = mod._sName || "";

    if (linkEl) {
      const gbModUrl = `https://gamebanana.com/mods/${mod._idRow}`;
      const newLinkEl = linkEl.cloneNode(true);
      linkEl.parentNode.replaceChild(newLinkEl, linkEl);
      newLinkEl.onclick = (e) => {
        e.preventDefault();
        shell.openExternal(gbModUrl);
      };
    }

    gbImages = [];
    if (mod._aPreviewMedia && mod._aPreviewMedia._aImages) {
      gbImages = mod._aPreviewMedia._aImages.map(
        (img) => img._sBaseUrl + "/" + img._sFile,
      );
      gbImages.forEach((url) => {
        const p = new Image();
        p.src = url;
      });
    }

    if (imgEl) {
      imgEl.style.filter = "none";
      imgEl.onerror = () => {
        imgEl.onerror = null;
        imgEl.src = "icons/cat.jpg";
      };

      if (gbImages.length > 0) {
        gbImgIndex = 0;
        imgEl.src = gbImages[0];
        imgEl.style.display = "block";
        triggerSlideAnim();
        startIdleTimer();
      } else {
        imgEl.style.display = "none";
      }

      imgEl.onclick = (e) => {
        e.stopPropagation();
        if (gbImages.length > 0 && gbImages[gbImgIndex]) {
          openLightbox(gbImages[gbImgIndex]);
        }
      };
    }

    if (carouselContainer) {
      carouselContainer.onmousemove = resetIdleTimer;
      carouselContainer.ontouchstart = resetIdleTimer;
    }

    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        showModalImage(gbImgIndex - 1);
        resetIdleTimer();
      };
    }

    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        showModalImage(gbImgIndex + 1);
        resetIdleTimer();
      };
    }

    modal.classList.add("active");

    const requestId = ++activeGBModalId;
    if (activeGBModalController) {
      activeGBModalController.abort();
    }
    activeGBModalController = new AbortController();

    const shortDesc = mod._sDescription ? mod._sDescription.trim() : "";

    const loadModalData = async () => {
      if (descEl) {
        if (shortDesc) {
          descEl.innerHTML = `
            <div>${shortDesc}</div>
            <div class="gb-desc-loading-inline">
              <div class="gb-loading-spinner"></div>
              <span>${t('gb_desc_loading')}</span>
            </div>
          `;
        } else {
          descEl.innerHTML = `
            <div class="gb-desc-loading-placeholder">
              <div class="gb-loading-spinner"></div>
              <span>${t('gb_desc_loading')}</span>
            </div>
          `;
        }
      }

      if (filesLoading) {
        filesLoading.style.display = "block";
        filesLoading.textContent = t('gb_files_loading');
      }
      if (filesList) {
        filesList.innerHTML = "";
      }

      try {
        let itemData = gbItemDataCache.get(mod._idRow);

        if (!itemData) {
          const dataUrl = `https://api.gamebanana.com/Core/Item/Data?itemtype=Mod&itemid=${mod._idRow}&fields=text,Files().aFiles()`;
          const fetchSignal = activeGBModalController.signal;

          const timeoutId = setTimeout(() => {
            if (activeGBModalController) activeGBModalController.abort();
          }, 12000);

          let dataRes;
          try {
            dataRes = await fetch(dataUrl, { signal: fetchSignal });
          } finally {
            clearTimeout(timeoutId);
          }

          if (!dataRes.ok) {
            throw new Error(`HTTP ${dataRes.status}`);
          }
          itemData = await dataRes.json();

          if (!Array.isArray(itemData) || itemData.length < 2) {
            throw new Error("Invalid response format");
          }

          gbItemDataCache.set(mod._idRow, itemData);
        }

        if (requestId !== activeGBModalId) return;

        if (descEl) {
          descEl.innerHTML = itemData[0] || shortDesc || t('gb_desc_empty');
          descEl.querySelectorAll("img").forEach((dImg) => {
            dImg.draggable = false;
            dImg.onerror = () => {
              dImg.onerror = null;
              dImg.src = "icons/cat.jpg";
              dImg.removeAttribute("title");
              dImg.removeAttribute("data-tooltip");
              dImg.style.cursor = "default";
              dImg.onclick = null;
            };
            const setupLoadedImg = () => {
              if (dImg.naturalWidth > 0) {
                if (dImg.src.includes("icons/cat.jpg")) {
                  dImg.style.cursor = "default";
                  dImg.removeAttribute("title");
                  dImg.removeAttribute("data-tooltip");
                  dImg.onclick = null;
                } else {
                  dImg.style.cursor = "pointer";
                  const parentLink = dImg.closest("a");
                  const href = parentLink ? (parentLink.getAttribute("href") || parentLink.href || "") : "";
                  const isExternalLink = href.startsWith("http://") || href.startsWith("https://");

                  if (isExternalLink) {
                    dImg.removeAttribute("title");
                    dImg.setAttribute("data-tooltip", t("gb_img_link_tooltip") || "Нажмите для перехода по ссылке");
                    dImg.setAttribute("data-tooltip-delay", "500");
                    dImg.setAttribute("data-tooltip-link", "true");
                    dImg.onclick = (e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      shell.openExternal(parentLink.href || href);
                    };
                  } else {
                    dImg.removeAttribute("title");
                    dImg.removeAttribute("data-tooltip");
                    dImg.onclick = (e) => {
                      e.stopPropagation();
                      if (dImg.src) openLightbox(dImg.src);
                    };
                  }
                }
              } else {
                dImg.onerror = null;
                dImg.src = "icons/cat.jpg";
                dImg.style.cursor = "default";
                dImg.removeAttribute("title");
                dImg.removeAttribute("data-tooltip");
                dImg.onclick = null;
              }
            };
            if (dImg.complete) {
              setupLoadedImg();
            } else {
              dImg.onload = setupLoadedImg;
            }
          });
        }

        const filesObj = itemData[1];
        if (filesLoading) filesLoading.style.display = "none";

        if (filesObj && Object.keys(filesObj).length > 0 && filesList) {
          filesList.innerHTML = "";
          if (modManager.isModDownloaded(currentSettings.xxmiPath, mod._idRow)) {
            const msg = document.createElement("div");
            msg.style.cssText =
              "padding:12px; background:rgba(255,42,42,0.1); border:1px solid var(--color-red); border-radius:8px; color:var(--color-red); margin-bottom:12px; font-size:0.9rem; font-weight:600;";
            msg.textContent = t('gb_already_dl_msg');
            filesList.appendChild(msg);
          }

          const previewUrlToPass = gbImages.length > 0 ? gbImages[0] : null;

          const sortedFiles = Object.values(filesObj).sort((a, b) => {
            const timeA = Number(a._tsDateAdded) || Number(a._idRow) || 0;
            const timeB = Number(b._tsDateAdded) || Number(b._idRow) || 0;
            return timeB - timeA;
          });

          sortedFiles.forEach((file) => {
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
                const modDescriptionToPass =
                  itemData && itemData[0] ? itemData[0] : (mod._sDescription || "");
                startDownload(
                  file,
                  mod._sName,
                  mod._idRow,
                  previewUrlToPass,
                  modDescriptionToPass,
                  mod,
                );
                modal.classList.remove("active");
              }
            };
            filesList.appendChild(fDiv);
          });
        } else if (filesList) {
          filesList.innerHTML = `<div style="color:var(--color-muted);">${t('gb_files_unavail')}</div>`;
        }
      } catch (err) {
        if (requestId !== activeGBModalId) return;

        if (filesLoading) filesLoading.style.display = "none";

        if (descEl) {
          if (shortDesc) {
            descEl.innerHTML = `
              <div>${shortDesc}</div>
              <div class="gb-modal-error-box" style="margin-top: 14px;">
                <div class="gb-modal-error-text">${t('gb_data_fetch_fail')}</div>
                <button class="gb-modal-retry-btn" id="gb-modal-retry-desc-btn">${t('gb_retry')}</button>
              </div>
            `;
          } else {
            descEl.innerHTML = `
              <div class="gb-modal-error-box">
                <div class="gb-modal-error-text">${t('gb_data_fetch_fail')}</div>
                <button class="gb-modal-retry-btn" id="gb-modal-retry-desc-btn">${t('gb_retry')}</button>
              </div>
            `;
          }
          const retryDescBtn = descEl.querySelector("#gb-modal-retry-desc-btn");
          if (retryDescBtn) {
            retryDescBtn.onclick = () => loadModalData();
          }
        }

        if (filesList) {
          filesList.innerHTML = `
            <div class="gb-modal-error-box">
              <div class="gb-modal-error-text">${t('gb_files_fail')}</div>
              <button class="gb-modal-retry-btn" id="gb-modal-retry-files-btn">${t('gb_retry')}</button>
            </div>
          `;
          const retryFilesBtn = filesList.querySelector("#gb-modal-retry-files-btn");
          if (retryFilesBtn) {
            retryFilesBtn.onclick = () => loadModalData();
          }
        }
      }
    };

    loadModalData();

    const handleClose = () => {
      modal.classList.remove("active");
      clearTimeout(gbIdleTimer);
      if (activeGBModalController) {
        activeGBModalController.abort();
      }
    };

    if (closeBtn) {
      const newCloseBtn = closeBtn.cloneNode(true);
      closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);
      newCloseBtn.onclick = handleClose;
    }
    modal.onclick = (e) => {
      if (e.target === modal) {
        handleClose();
      }
    };
  };

  const startDownload = (gbFile, modName, modId, previewUrl, modDescription, gbMod = null) => {
    const url = gbFile._sDownloadUrl;
    const fileName = gbFile._sFile;
    const downloadId = gbFile._idRow.toString();

    const xxmiPath = currentSettings.xxmiPath;
    if (!xxmiPath) {
      if (window.Toast) window.Toast.warning(t('dl_need_path'));
      else alert(t('dl_need_path'));
      return;
    }

    const tempPath = path.join(xxmiPath, fileName);
    const safeModFolder =
      modName.replace(/[<>:"/\\|?*]+/g, "").trim() || "Mod_" + modId;
    const safeVariationName =
      fileName.replace(/\.[^/.]+$/, "").replace(/[<>:"/\\|?*]+/g, "").trim() ||
      "Default";

    const modvarsModFolder = path.join(xxmiPath, "modvars", safeModFolder);
    const variationFolder = path.join(modvarsModFolder, safeVariationName);
    const targetModFolder = path.join(xxmiPath, "Mods", safeModFolder);
    const dismodFolder = path.join(xxmiPath, "dismods", safeModFolder);

    if (activeDownloads[downloadId]) {
      if (window.Toast) window.Toast.warning(t('dl_in_queue'));
      else alert(t('dl_in_queue'));
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
            fs.unlink(tempPath, () => { });
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
            if (!fs.existsSync(variationFolder)) {
              fs.mkdirSync(variationFolder, { recursive: true });
            }


            await ArchiveExtractor.extractArchive(tempPath, variationFolder);
            await ArchiveExtractor.extractRecursively(variationFolder);

            if (fs.existsSync(tempPath)) {
              try {
                fs.unlinkSync(tempPath);
              } catch (e) { }
            }

            modManager.flattenDirectory(variationFolder);

            if (previewUrl) {
              const previewDest = path.join(variationFolder, "preview.jpg");
              await downloadImage(previewUrl, previewDest);
            }

            if (modDescription) {
              const cleanDesc = htmlToPlainText(modDescription);
              if (cleanDesc) {
                fs.writeFileSync(
                  path.join(variationFolder, "description.txt"),
                  cleanDesc,
                  "utf-8",
                );
              }
            }

            modManager.addDownloadLink(
              safeModFolder,
              `https://gamebanana.com/mods/${modId}`,
            );


            let charName = null;
            let charId = null;
            let rootCat = "Character Skins";

            if (gbMod) {
              if (gbMod._aSubCategory && gbMod._aSubCategory._sName) {
                charName = gbMod._aSubCategory._sName;
                if (gbMod._aSubCategory._idRow) {
                  charId = parseInt(gbMod._aSubCategory._idRow);
                }
              } else if (gbMod._aCategory && gbMod._aCategory._sName) {
                charName = gbMod._aCategory._sName;
                if (gbMod._aCategory._idRow) {
                  charId = parseInt(gbMod._aCategory._idRow);
                }
              }
              if (gbMod._aRootCategory && gbMod._aRootCategory._sName) {
                rootCat = gbMod._aRootCategory._sName;
              }
            }

            if (!charName) {
              const detected = modManager.detectCharacter(
                modName,
                [variationFolder, modvarsModFolder],
                currentSettings.language || "ru",
              );
              charName = detected.character;
              charId = detected.characterId;
              rootCat = detected.category;
            }

            modManager.setModMetadata(
              safeModFolder,
              {
                id: modId,
                name: modName,
                character: charName,
                characterId: charId,
                category: rootCat,
                sourceUrl: `https://gamebanana.com/mods/${modId}`,
              },
              [variationFolder, modvarsModFolder, targetModFolder, dismodFolder],
            );

            const isInstalledActive = fs.existsSync(targetModFolder);
            const isInstalledDismod = fs.existsSync(dismodFolder);

            if (!isInstalledActive && !isInstalledDismod) {
              fs.mkdirSync(targetModFolder, { recursive: true });
              fs.cpSync(variationFolder, targetModFolder, {
                recursive: true,
                force: true,
              });
              modManager.flattenDirectory(targetModFolder);
              try {
                fs.writeFileSync(
                  path.join(modvarsModFolder, ".active_var"),
                  safeVariationName,
                  "utf-8",
                );
              } catch (e) { }
            } else {
              const existingVars = fs.existsSync(modvarsModFolder)
                ? fs
                  .readdirSync(modvarsModFolder, { withFileTypes: true })
                  .filter((e) => e.isDirectory())
                  .map((e) => e.name)
                : [];

              if (existingVars.length <= 1) {
                const currentFolder = isInstalledActive
                  ? targetModFolder
                  : dismodFolder;
                const origFolder = path.join(modvarsModFolder, "Original");
                if (!fs.existsSync(origFolder) && currentFolder !== origFolder) {
                  try {
                    fs.mkdirSync(origFolder, { recursive: true });
                    fs.cpSync(currentFolder, origFolder, {
                      recursive: true,
                      force: true,
                    });
                    fs.writeFileSync(
                      path.join(modvarsModFolder, ".active_var"),
                      "Original",
                      "utf-8",
                    );
                  } catch (e) { }
                }
              }
            }

            delete activeDownloads[downloadId];
            renderDownloadsTab();
          } catch (e) {
            console.error("Error unpacking mod:", e);
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
    if (Object.keys(activeDownloads).length > 0 && document.getElementById("downloads-list")) {
      renderDownloadsTab();
    }
  }, 200);

  let activeSettingsTab = "general";

  const initSettings = () => {
    const navItems = document.querySelectorAll(".settings-nav-item");
    const tabPanels = document.querySelectorAll(".settings-tab-panel");
    const settingsIndicator = document.getElementById("settings-indicator");
    const settingsNav = document.querySelector(".settings-nav");

    const moveSettingsIndicator = (activeBtn) => {
      if (!settingsIndicator || !activeBtn || !settingsNav) return;
      const navRect = settingsNav.getBoundingClientRect();
      const btnRect = activeBtn.getBoundingClientRect();
      if (btnRect.width === 0 || btnRect.height === 0) return;
      settingsIndicator.style.width = `${btnRect.width}px`;
      settingsIndicator.style.height = `${btnRect.height}px`;
      settingsIndicator.style.left = `${btnRect.left - navRect.left}px`;
      settingsIndicator.style.top = `${btnRect.top - navRect.top}px`;
      settingsIndicator.classList.add("visible");
    };

    const switchTab = (tabId) => {
      activeSettingsTab = tabId;
      let activeBtn = null;
      navItems.forEach((btn) => {
        const isActive = btn.getAttribute("data-settings-tab") === tabId;
        btn.classList.toggle("active", isActive);
        if (isActive) activeBtn = btn;
      });
      tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === `settings-tab-${tabId}`);
      });
      if (activeBtn) {
        moveSettingsIndicator(activeBtn);
      }
    };

    navItems.forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.getAttribute("data-settings-tab"));
      });
    });

    if (activeSettingsTab) {
      switchTab(activeSettingsTab);
    }

    setTimeout(() => {
      const activeBtn = document.querySelector(".settings-nav-item.active");
      if (activeBtn) moveSettingsIndicator(activeBtn);
    }, 50);

    window.addEventListener("resize", () => {
      const activeBtn = document.querySelector(".settings-nav-item.active");
      if (activeBtn) moveSettingsIndicator(activeBtn);
    });

    const xxmiPathInput = document.getElementById("setting-xxmi-path");
    const btnSelectXxmi = document.getElementById("btn-select-xxmi");

    const xxmiBinPathInput = document.getElementById("setting-xxmi-bin-path");
    const btnSelectXxmiBin = document.getElementById("btn-select-xxmi-bin");

    if (xxmiPathInput) xxmiPathInput.placeholder = t("settings_example_path", { path: platformHelper.defaultXxmiPath });
    if (xxmiBinPathInput) xxmiBinPathInput.placeholder = t("settings_example_path", { path: platformHelper.defaultXxmiBinPath });

    const nsfwModeSelect = document.getElementById("setting-nsfw-mode");
    const langSelect = document.getElementById("language-selector");
    const themeSelect = document.getElementById("setting-theme");

    if (currentSettings.xxmiPath)
      xxmiPathInput.value = currentSettings.xxmiPath;
    if (currentSettings.xxmiBinPath && xxmiBinPathInput)
      xxmiBinPathInput.value = currentSettings.xxmiBinPath;

    if (nsfwModeSelect)
      nsfwModeSelect.value = currentSettings.nsfwMode || "show";

    if (langSelect) {
      langSelect.value = currentSettings.language || "en";
    }

    if (themeSelect) {
      const themes = getAvailableThemes();
      themeSelect.innerHTML = "";
      themes.forEach((theme) => {
        const opt = document.createElement("option");
        opt.value = theme;
        const transKey = `theme_${theme}`;
        opt.textContent =
          t(transKey) !== transKey
            ? t(transKey)
            : theme.charAt(0).toUpperCase() + theme.slice(1);
        themeSelect.appendChild(opt);
      });
      themeSelect.value = mapLegacyTheme(currentSettings.theme || "purple");
    }

    const themesPalette = document.getElementById("settings-themes-palette");
    if (themesPalette && themeSelect) {
      const themes = getAvailableThemes();
      const themeColors = {
        purple: "#564787",
        red: "#D6303A",
        green: "#10b981",
        nord: "#88c0d0",
        amber: "#f59e0b",
        sakura: "#ec4899",
        midnight: "#3b82f6",
        sunset: "#f97316",
        cyan: "#06b6d4",
      };
      themesPalette.innerHTML = "";
      themes.forEach((theme) => {
        const card = document.createElement("button");
        card.type = "button";
        card.className = "settings-theme-card" + (themeSelect.value === theme ? " active" : "");
        card.setAttribute("data-theme-value", theme);

        const swatch = document.createElement("div");
        swatch.className = "settings-theme-swatch";
        swatch.style.backgroundColor = themeColors[theme] || "var(--accent)";

        const label = document.createElement("span");
        label.className = "settings-theme-name";
        const transKey = `theme_${theme}`;
        label.textContent =
          t(transKey) !== transKey
            ? t(transKey)
            : theme.charAt(0).toUpperCase() + theme.slice(1);

        card.appendChild(swatch);
        card.appendChild(label);

        card.addEventListener("click", () => {
          if (themeSelect.value !== theme) {
            themeSelect.value = theme;
            themeSelect.dispatchEvent(new Event("change"));
            if (typeof CustomDropdown !== "undefined" && themeSelect._customDropdown) {
              themeSelect._customDropdown.update();
            }
            themesPalette.querySelectorAll(".settings-theme-card").forEach((c) => {
              c.classList.toggle("active", c.getAttribute("data-theme-value") === theme);
            });
          }
        });

        themesPalette.appendChild(card);
      });
    }

    if (typeof CustomDropdown !== "undefined") {
      const content = document.getElementById("content-container");
      if (content) CustomDropdown.initAll(content);
    }

    const skipSplashCheckbox = document.getElementById("setting-skip-splash");
    if (skipSplashCheckbox) {
      skipSplashCheckbox.checked = !!currentSettings.skipSplashScreen;
      skipSplashCheckbox.addEventListener("change", () => {
        saveSettings();
      });
    }

    const versionEl = document.getElementById("setting-launcher-version");
    if (versionEl) {
      const v = typeof AutoUpdater !== "undefined" ? AutoUpdater.getCurrentVersion() : "0.2.3";
      const cleanV = String(v || "0.2.3").replace(/^v/i, "").trim();
      versionEl.textContent = `v${cleanV}`;
    }

    const checkUpdatesBtn = document.getElementById("btn-check-updates");
    if (checkUpdatesBtn && typeof AutoUpdater !== "undefined") {
      checkUpdatesBtn.addEventListener("click", () => {
        const originalText = checkUpdatesBtn.textContent;
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.textContent = t("settings_checking_updates");

        AutoUpdater.checkForUpdates()
          .then((info) => {
            checkUpdatesBtn.disabled = false;
            checkUpdatesBtn.textContent = originalText;
            if (info.hasUpdate) {
              AutoUpdater.showUpdateModal(info);
            } else if (typeof window.Toast !== "undefined") {
              window.Toast.show(t("update_toast_latest", { version: info.currentVersion }));
            }
          })
          .catch(() => {
            checkUpdatesBtn.disabled = false;
            checkUpdatesBtn.textContent = originalText;
            if (typeof window.Toast !== "undefined") {
              window.Toast.error(t("update_toast_err"));
            }
          });
      });
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
        theme: themeSelect ? mapLegacyTheme(themeSelect.value) : (currentSettings.theme || "purple"),
        skipSplashScreen: skipSplashCheckbox ? skipSplashCheckbox.checked : !!currentSettings.skipSplashScreen,
      };
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(currentSettings, null, 4),
      );
    };

    if (themeSelect) {
      themeSelect.addEventListener("change", () => {
        saveSettings();
        applyTheme(currentSettings.theme);
      });
    }

    if (nsfwModeSelect) nsfwModeSelect.addEventListener("change", saveSettings);

    if (langSelect) {
      langSelect.addEventListener("change", () => {
        saveSettings();
        loadTranslations(currentSettings.language);
        applyTranslationsToDOM(document.body);
        if (installedFilterDrawer) {
          installedFilterDrawer.setLanguage(currentSettings.language);
        }
        if (sideMenuDownload) {
          sideMenuDownload.currentLang = currentSettings.language;
          sideMenuDownload.render();
        }
        loadPage("settings");
        setTimeout(() => {
          const activeItem = document.querySelector(".sidebar-item.active");
          if (activeItem) moveIndicator(activeItem);
        }, 50);
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
      } catch (e) { }
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

    const githubLink = document.getElementById("settings-github-link");
    if (githubLink) {
      githubLink.addEventListener("click", (e) => {
        e.preventDefault();
        shell.openExternal("https://github.com/whityx/WZMM/");
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



  let appInitialized = false;
  const startAppInit = () => {
    if (appInitialized) return;
    appInitialized = true;

    if (!currentSettings.skipSplashScreen && typeof SplashManager !== "undefined") {
      SplashManager.setProgress(45, t("splash_status_init"));
    }

    const catalogPromise = SideMenuDownload.fetchAndCacheCatalog()
      .then(() => {
        modManager.loadCatalog(true);
        if (!currentSettings.skipSplashScreen && typeof SplashManager !== "undefined") {
          SplashManager.setProgress(70, t("splash_status_mods"));
        }
      })
      .catch(() => { });

    Promise.all([catalogPromise, loadPage("installed")]).then(() => {
      updateActiveSidebarIndicator();
      if (typeof SplashManager !== "undefined") {
        SplashManager.setProgress(100, t("splash_status_ready"));
        SplashManager.finish(400);
      }
    });
  };

  if (typeof SplashManager !== "undefined") {
    SplashManager.onSkipCallback = () => {
      startAppInit();
    };
  }

  if (!currentSettings.skipSplashScreen && typeof AutoUpdater !== "undefined") {
    SplashManager.setProgress(20, t("splash_status_check_updates"));
    AutoUpdater.checkForUpdates()
      .then((info) => {
        if (info.hasUpdate) {
          SplashManager.setProgress(100, t("splash_status_update_found", { version: info.latestVersion }));
          setTimeout(() => {
            SplashManager.hide();
            AutoUpdater.showUpdateModal(info, () => {
              startAppInit();
            }, false);
          }, 350);
        } else {
          startAppInit();
        }
      })
      .catch(() => {
        startAppInit();
      });
  } else {
    startAppInit();
  }
});
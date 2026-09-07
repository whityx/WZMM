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

const sanitizeHtmlContent = (html) => {
  if (!html) return "";
  const temp = document.createElement("div");
  temp.innerHTML = html;
  temp.querySelectorAll("script, iframe, object, embed, style, form, input").forEach((el) => el.remove());
  temp.querySelectorAll("*").forEach((el) => {
    for (let i = el.attributes.length - 1; i >= 0; i--) {
      const attrName = el.attributes[i].name;
      if (attrName.startsWith("on") || attrName === "javascript:") {
        el.removeAttribute(attrName);
      }
    }
  });
  return temp.innerHTML;
};

const resolveGbUrl = (rawHref) => {
  if (!rawHref) return null;
  const href = String(rawHref).trim();
  if (!href || href === "#" || href.startsWith("javascript:")) return null;
  if (href.startsWith("//")) return "https:" + href;
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  if (href.startsWith("/")) return "https://gamebanana.com" + href;
  if (/^(?:members|mods|sounds|skins|tools|requests|threads|questions|ideas|wips|contests|clubs|studios)\//i.test(href)) {
    return "https://gamebanana.com/" + href;
  }
  return href;
};

const bindExternalLinks = (container) => {
  if (!container) return;
  container.querySelectorAll("a").forEach((a) => {
    const rawHref = a.getAttribute("href") || a.href || "";
    const targetUrl = resolveGbUrl(rawHref);
    a.onclick = (e) => {
      e.preventDefault();
      if (targetUrl) {
        shell.openExternal(targetUrl);
      }
    };
  });
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

  document.addEventListener("click", (e) => {
    const targetA = e.target.closest("a");
    if (!targetA) return;
    const rawHref = targetA.getAttribute("href");
    if (!rawHref || rawHref === "#" || rawHref.startsWith("javascript:")) return;
    const resolved = resolveGbUrl(rawHref);
    if (resolved && (resolved.startsWith("http://") || resolved.startsWith("https://"))) {
      e.preventDefault();
      shell.openExternal(resolved);
    }
  }, true);

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

  const isModNsfw = (mod) => {
    if (!mod) return false;
    let textToScan = (mod._sName || "") + " " + (mod._sDescription || "");
    if (mod._aContentRatings && typeof mod._aContentRatings === "object") {
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
    const isNsfwText = typeof nsfwRegex !== "undefined" ? nsfwRegex.test(textToScan) : false;
    return isNsfwFlagged || isNsfwText;
  };

  let cachedBestMods = null;
  let bestModsPromise = null;
  let currentFeaturedPeriod = "all";

  let gbInitialCatalogPromise = null;
  let gbInitialCatalogCache = null;

  const preloadImage = (url) => {
    if (!url) return;
    try {
      const img = new Image();
      img.src = url;
    } catch (e) {}
  };

  const preloadDownloadTab = async () => {
    try {
      const htmlCssPromise = (async () => {
        if (htmlCache["download"] === undefined) {
          const response = await fetch("pages/download.html");
          if (response.ok) {
            let html = await response.text();
            const linkRegex = /<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/?>/gi;
            let match;
            let css = "";
            while ((match = linkRegex.exec(html)) !== null) {
              const cssUrl = match[1];
              const cssRes = await fetch(cssUrl);
              let cssText = await cssRes.text();
              cssText = cssText.replace(/@import\s+url\(['"]?base\.css['"]?\);?/gi, "");
              css += cssText + "\n";
            }
            html = html.replace(linkRegex, "");
            htmlCache["download"] = html;
            pageCssMap["download"] = css;
          }
        }
      })();

      const showcasePromise = loadBestShowcaseMods().then((res) => {
        if (res) {
          Object.values(res).forEach((mod) => {
            if (mod && mod._aPreviewMedia && mod._aPreviewMedia._aImages && mod._aPreviewMedia._aImages[0]) {
              const imgObj = mod._aPreviewMedia._aImages[0];
              const imgUrl = `${imgObj._sBaseUrl}/${imgObj._sFile}`;
              preloadImage(imgUrl);
            }
            if (mod && mod._aSubmitter && mod._aSubmitter._sAvatarUrl) {
              preloadImage(mod._aSubmitter._sAvatarUrl);
            }
          });
        }
      });

      let catalogFetchPromise = null;
      if (!gbInitialCatalogCache && !gbInitialCatalogPromise) {
        const csvProps =
          "_idRow,_sName,_aPreviewMedia,_nLikeCount,_tsDateUpdated,_tsDateAdded,_bContainsNsfw,_bIsNsfw,_bHasNsfw,_bMatureContent,_sInitialVisibility,_aContentRatings,_aCategory,_aRootCategory,_aSubCategory,_sDescription";
        const url = `https://gamebanana.com/apiv11/Mod/Index?_nPage=1&_nPerpage=30&_aFilters[Generic_Game]=19567&_sSort=Generic_MostLiked&_csvProperties=${csvProps}`;
        catalogFetchPromise = fetchWithRetry(url)
          .then((r) => (r && r.ok ? r.json() : null))
          .then((data) => {
            if (data && Array.isArray(data._aRecords)) {
              gbInitialCatalogCache = data._aRecords;
              data._aRecords.slice(0, 15).forEach((mod) => {
                if (mod && mod._aPreviewMedia && mod._aPreviewMedia._aImages && mod._aPreviewMedia._aImages[0]) {
                  const imgObj = mod._aPreviewMedia._aImages[0];
                  const imgUrl = `${imgObj._sBaseUrl}/${imgObj._sFile220 || imgObj._sFile}`;
                  preloadImage(imgUrl);
                }
              });
            }
          })
          .catch(() => null)
          .finally(() => {
            gbInitialCatalogPromise = null;
          });
        gbInitialCatalogPromise = catalogFetchPromise;
      } else {
        catalogFetchPromise = gbInitialCatalogPromise || Promise.resolve();
      }

      await Promise.all([htmlCssPromise, showcasePromise, catalogFetchPromise]);
    } catch (e) {}
  };

  const loadBestShowcaseMods = async (forceRefresh = false) => {
    if (cachedBestMods && !forceRefresh) return cachedBestMods;
    if (bestModsPromise && !forceRefresh) return bestModsPromise;

    bestModsPromise = (async () => {
      try {
        const csvProps =
          "_idRow,_sName,_sProfileUrl,_aPreviewMedia,_aSubmitter,_tsDateAdded,_tsDateUpdated,_nLikeCount,_nViewCount,_nDownloadCount,_nPostCount,_sDescription,_sInitialVisibility,_aContentRatings,_aRootCategory,_aCategory,_aSubCategory,_bWasFeatured,_bContainsNsfw,_bIsNsfw,_bHasNsfw,_bMatureContent";
        const [latestRes, mostLikedRes] = await Promise.all([
          fetchWithRetry(
            `https://gamebanana.com/apiv11/Mod/Index?_aFilters[Generic_Game]=19567&_sOrderBy=_tsDateAdded,DESC&_nPerpage=50&_csvProperties=${csvProps}`
          ).then((r) => (r && r.ok ? r.json() : null)).catch(() => null),
          fetchWithRetry(
            `https://gamebanana.com/apiv11/Mod/Index?_aFilters[Generic_Game]=19567&_sSort=Generic_MostLiked&_nPerpage=30&_csvProperties=${csvProps}`
          ).then((r) => (r && r.ok ? r.json() : null)).catch(() => null)
        ]);

        const latest = Array.isArray(latestRes?._aRecords) ? latestRes._aRecords : [];
        const mostLiked = Array.isArray(mostLikedRes?._aRecords) ? mostLikedRes._aRecords : [];

        const map = new Map();
        [...latest, ...mostLiked].forEach((m) => {
          if (m && m._idRow) map.set(m._idRow, m);
        });
        const allPool = Array.from(map.values());
        const now = Math.floor(Date.now() / 1000);

        const periodConfigs = [
          { key: "day", sec: 86400 },
          { key: "week", sec: 604800 },
          { key: "month", sec: 2592000 },
          { key: "6months", sec: 15552000 },
          { key: "year", sec: 31536000 },
          { key: "all", sec: null }
        ];

        const result = {};
        periodConfigs.forEach((p) => {
          if (p.sec === null) {
            result[p.key] = mostLiked[0] || latest[0] || null;
          } else {
            const candidates = allPool.filter((m) => (m._tsDateAdded || 0) >= now - p.sec);
            candidates.sort((a, b) => (Number(b._nLikeCount) || 0) - (Number(a._nLikeCount) || 0));
            result[p.key] = candidates[0] || mostLiked[0] || latest[0] || null;
          }
        });

        cachedBestMods = result;
        return result;
      } catch (e) {
        return null;
      } finally {
        bestModsPromise = null;
      }
    })();

    return bestModsPromise;
  };

  const renderFeaturedShowcase = async () => {
    const container = document.getElementById("gb-featured-container");
    if (!container) return;

    const searchInput = document.getElementById("gb-search");
    const hasSearch = Boolean((gbSearchQuery && gbSearchQuery.trim().length > 0) || (searchInput && searchInput.value.trim().length > 0));
    const hasAuthor = Boolean(gbSelectedAuthor);
    const hasCategory = Boolean(sideMenuDownload && sideMenuDownload.selectedCategoryId);
    const hasSort = Boolean(gbSortVal && gbSortVal !== "default");

    if (hasSearch || hasAuthor || hasCategory || hasSort) {
      container.style.display = "none";
      return;
    }

    const periods = ["day", "week", "month", "6months", "year", "all"];
    const periodBadgeKeys = {
      day: "gb_best_badge_day",
      week: "gb_best_badge_week",
      month: "gb_best_badge_month",
      "6months": "gb_best_badge_6months",
      year: "gb_best_badge_year",
      all: "gb_best_badge_all"
    };

    const periodLabelKeys = {
      day: "gb_best_period_day",
      week: "gb_best_period_week",
      month: "gb_best_period_month",
      "6months": "gb_best_period_6months",
      year: "gb_best_period_year",
      all: "gb_best_period_all"
    };

    const bestMods = await loadBestShowcaseMods();
    if (!bestMods) {
      container.style.display = "none";
      return;
    }

    const hasAnyMod = periods.some((p) => bestMods[p]);
    if (!hasAnyMod) {
      container.style.display = "none";
      return;
    }

    container.style.display = "flex";

    const widgetEl = container.querySelector(".gb-featured-widget");
    const heroEl = document.getElementById("gb-featured-hero");
    let activeBgSlot = 1;
    const bgImg1 = document.getElementById("gb-featured-bg-1");
    const bgImg2 = document.getElementById("gb-featured-bg-2");
    const periodBadge = document.getElementById("gb-featured-period-badge");
    const catBadge = document.getElementById("gb-featured-cat-badge");
    const authorEl = document.getElementById("gb-featured-author");
    const authorAvatar = document.getElementById("gb-featured-author-avatar");
    const authorName = document.getElementById("gb-featured-author-name");
    const titleEl = document.getElementById("gb-featured-name");
    const descEl = document.getElementById("gb-featured-desc");
    const likesEl = document.getElementById("gb-featured-likes");
    const commentsEl = document.getElementById("gb-featured-comments");
    const viewsEl = document.getElementById("gb-featured-views");
    const thumbsBar = document.getElementById("gb-featured-thumbs-bar");
    const prevBtn = document.getElementById("gb-featured-prev");
    const nextBtn = document.getElementById("gb-featured-next");

    const stepPeriod = (step) => {
      const availablePeriods = periods.filter((p) => bestMods && bestMods[p]);
      if (availablePeriods.length <= 1) return;
      let idx = availablePeriods.indexOf(currentFeaturedPeriod);
      if (idx === -1) idx = 0;
      const nextIdx = (idx + step + availablePeriods.length) % availablePeriods.length;
      updateDisplayForPeriod(availablePeriods[nextIdx], step >= 0 ? "next" : "prev");
    };

    const updateDisplayForPeriod = (periodKey, direction = "next") => {
      currentFeaturedPeriod = periodKey;
      const mod = bestMods[periodKey];
      if (!mod) return;

      if (thumbsBar) {
        thumbsBar.querySelectorAll(".gb-featured-strip-item").forEach((tab) => {
          const isActive = tab.getAttribute("data-period") === periodKey;
          tab.classList.toggle("active", isActive);
          const bar = tab.querySelector(".strip-progress-bar");
          if (bar) {
            bar.style.animation = "none";
            void bar.offsetWidth;
            if (isActive) {
              bar.style.animation = "";
            }
          }
        });
      }

      if (periodBadge) {
        const badgeKey = periodBadgeKeys[periodKey];
        periodBadge.textContent = t(badgeKey);
      }

      const catName =
        mod._aRootCategory?._sName ||
        mod._aCategory?._sName ||
        mod._aSubCategory?._sName ||
        "";

      const sub = mod._aSubmitter;
      if (authorEl && sub && sub._sName) {
        authorEl.style.display = "inline-flex";
        if (authorAvatar) authorAvatar.src = sub._sAvatarUrl || "icons/cat.jpg";
        if (authorName) authorName.textContent = sub._sName;
        authorEl.onclick = (e) => {
          e.stopPropagation();
          shell.openExternal(sub._sProfileUrl || `https://gamebanana.com/members/${sub._idRow}`);
        };
      } else if (authorEl) {
        authorEl.style.display = "none";
      }

      const isNext = direction === "next";
      const infoCol = heroEl ? heroEl.querySelector(".gb-featured-info-col") : null;
      if (infoCol) {
        const animClass = isNext ? "animating-right" : "animating-left";
        infoCol.classList.remove("animating-left", "animating-right");
        infoCol.classList.add(animClass);
        setTimeout(() => {
          if (titleEl) titleEl.textContent = mod._sName || "";
          if (descEl) {
            const descText = (mod._sDescription || "").trim();
            descEl.textContent = descText;
            descEl.style.display = descText ? "block" : "none";
          }
          if (catBadge) {
            if (catName) {
              catBadge.textContent = catName;
              catBadge.style.display = "inline-block";
            } else {
              catBadge.style.display = "none";
            }
          }
          infoCol.classList.remove(animClass);
        }, 110);
      } else {
        if (titleEl) titleEl.textContent = mod._sName || "";
        if (descEl) {
          const descText = (mod._sDescription || "").trim();
          descEl.textContent = descText;
          descEl.style.display = descText ? "block" : "none";
        }
        if (catBadge) {
          if (catName) {
            catBadge.textContent = catName;
            catBadge.style.display = "inline-block";
          } else {
            catBadge.style.display = "none";
          }
        }
      }

      if (likesEl) {
        const span = likesEl.querySelector(".val");
        if (span) span.textContent = abbreviateCount(mod._nLikeCount ?? 0);
      }
      if (commentsEl) {
        const span = commentsEl.querySelector(".val");
        if (span) span.textContent = abbreviateCount(mod._nPostCount ?? 0);
      }
      if (viewsEl) {
        const span = viewsEl.querySelector(".val");
        if (span) span.textContent = abbreviateCount(mod._nViewCount ?? 0);
      }

      let imgUrl = "icons/cat.jpg";
      if (mod._aPreviewMedia && Array.isArray(mod._aPreviewMedia._aImages) && mod._aPreviewMedia._aImages[0]) {
        const first = mod._aPreviewMedia._aImages[0];
        imgUrl = first._sBaseUrl + "/" + (first._sFile530 || first._sFile || "");
      }

      const isNsfwMod = isModNsfw(mod);
      const filterMode = currentSettings.nsfwMode || "show";
      const filterStyle = isNsfwMod && (filterMode === "blur" || filterMode === "blur_download_only") ? "blur(20px)" : "none";

      if (bgImg1 && bgImg2) {
        const currentSlot = activeBgSlot;
        const nextSlot = currentSlot === 1 ? 2 : 1;
        const currentImg = currentSlot === 1 ? bgImg1 : bgImg2;
        const nextImg = nextSlot === 1 ? bgImg1 : bgImg2;

        nextImg.onerror = () => {
          nextImg.onerror = null;
          nextImg.src = "icons/cat.jpg";
        };
        nextImg.src = imgUrl;
        nextImg.style.filter = filterStyle;

        const enterClass = isNext ? "enter-from-right" : "enter-from-left";
        const exitClass = isNext ? "exit-to-left" : "exit-to-right";

        nextImg.className = `gb-featured-bg-slide ${enterClass}`;
        void nextImg.offsetWidth;
        nextImg.className = "gb-featured-bg-slide active";
        currentImg.className = `gb-featured-bg-slide ${exitClass}`;
        activeBgSlot = nextSlot;
      } else if (bgImg1) {
        bgImg1.src = imgUrl;
        bgImg1.style.filter = filterStyle;
      }

      if (heroEl) {
        heroEl.onclick = () => {
          openGBModal(mod);
        };
      }
    };

    if (thumbsBar) {
      thumbsBar.innerHTML = "";
      periods.forEach((pKey) => {
        const mod = bestMods[pKey];
        if (!mod) return;

        let thumbImg = "icons/cat.jpg";
        if (mod._aPreviewMedia && Array.isArray(mod._aPreviewMedia._aImages) && mod._aPreviewMedia._aImages[0]) {
          const first = mod._aPreviewMedia._aImages[0];
          thumbImg = first._sBaseUrl + "/" + (first._sFile100 || first._sFile220 || first._sFile || "");
        }

        const thumb = document.createElement("div");
        thumb.className = `gb-featured-strip-item ${pKey === currentFeaturedPeriod ? "active" : ""}`;
        thumb.setAttribute("data-period", pKey);
        thumb.innerHTML = `
          <img src="${thumbImg}" alt="" loading="lazy" decoding="async">
          <div class="strip-item-overlay"></div>
          <span class="strip-item-label">${t(periodLabelKeys[pKey])}</span>
          <div class="strip-progress-bar"></div>
        `;
        const img = thumb.querySelector("img");
        if (img) {
          img.onerror = () => {
            img.onerror = null;
            img.src = "icons/cat.jpg";
          };
        }
        const bar = thumb.querySelector(".strip-progress-bar");
        if (bar) {
          bar.addEventListener("animationend", () => {
            if (thumb.classList.contains("active")) {
              stepPeriod(1);
            }
          });
        }
        thumb.onclick = (e) => {
          e.stopPropagation();
          const curIdx = periods.indexOf(currentFeaturedPeriod);
          const targetIdx = periods.indexOf(pKey);
          updateDisplayForPeriod(pKey, targetIdx >= curIdx ? "next" : "prev");
        };
        thumbsBar.appendChild(thumb);
      });
    }

    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        stepPeriod(-1);
      };
    }

    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.stopPropagation();
        stepPeriod(1);
      };
    }

    updateDisplayForPeriod(currentFeaturedPeriod || "all", "next");
  };

  const splashEl = document.getElementById("splash-screen");
  if (typeof SplashManager !== "undefined" && SplashManager.init) {
    SplashManager.init(splashEl);
  }

  if (currentSettings.skipSplashScreen) {
    if (typeof SplashManager !== "undefined") SplashManager.hide();
  } else if (typeof SplashManager !== "undefined") {
    SplashManager.setProgress(20, t("splash_status_check_updates"));
  }

  preloadDownloadTab();

  let gbIdleTimer = null;
  let activeGBModalController = null;
  let activeGBModalId = 0;
  const gbItemDataCache = new Map();
  const gbProfileCache = new Map();
  const gbCommentsCache = new Map();

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

      const gpMgr = window.GamepadManager || window.ControllerManager;
      if (gpMgr && gpMgr.controllerMode) {
        setTimeout(() => {
          gpMgr.focusDefaultElement();
        }, 60);
      }
    } catch (error) {
      contentContainer.innerHTML = `<h2 style="color: var(--color-red);">${t('err_page_load')}</h2>`;
    }
  };

  function detectLaunchLanguage() {
    const argv = process.argv || [];
    for (let i = 0; i < argv.length; i++) {
      const arg = (argv[i] || "").toLowerCase();
      if (arg.startsWith("--lang=") || arg.startsWith("--language=")) {
        const val = arg.split("=")[1];
        if (val === "ru" || val === "en") return val;
      }
      if ((arg === "--lang" || arg === "--language") && i + 1 < argv.length) {
        const next = (argv[i + 1] || "").toLowerCase();
        if (next === "ru" || next === "en") return next;
      }
    }
    if (process.env.WZMM_LANG) {
      const val = process.env.WZMM_LANG.toLowerCase();
      if (val === "ru" || val === "en") return val;
    }
    const env = (
      process.env.WZMM_SYSTEM_LOCALE ||
      process.env.LANGUAGE ||
      process.env.LC_ALL ||
      process.env.LC_MESSAGES ||
      process.env.LANG ||
      navigator.language ||
      ""
    ).toLowerCase();
    if (env.startsWith("ru") || env.includes("ru_ru") || env.includes("ru-ru")) {
      return "ru";
    }
    return "en";
  }

  function getSettings() {
    const defaultUsefulMods = [
      {
        id: 600543,
        _idRow: 600543,
        name: "Agent Viewer",
        _sName: "Agent Viewer",
        description: "Allows viewing agents in the menu",
        _sDescription: "Allows viewing agents in the menu",
        _sText: "Allows viewing agents in the menu",
        previewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_684dadce18810.jpg",
        _sPreviewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_684dadce18810.jpg",
        _sProfileUrl: "https://gamebanana.com/mods/600543",
        author: "HelpMeHelpYou",
        submitterName: "HelpMeHelpYou",
      },
      {
        id: 527935,
        _idRow: 527935,
        name: "Censor Remover & No Outlines",
        _sName: "Censor Remover & No Outlines",
        description: "Censor Remover & No Outlines options",
        _sDescription: "Censor Remover & No Outlines options",
        _sText: "Censor Remover & No Outlines options",
        previewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_6693f0120d40f.jpg",
        _sPreviewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_6693f0120d40f.jpg",
        _sProfileUrl: "https://gamebanana.com/mods/527935",
        author: "summersby",
        submitterName: "summersby",
      },
      {
        id: 529789,
        _idRow: 529789,
        name: "Color Wipeout",
        _sName: "Color Wipeout",
        description: "Makes Wipeout colorful",
        _sDescription: "Makes Wipeout colorful",
        _sText: "Makes Wipeout colorful",
        previewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_680a3a2e84fc8.jpg",
        _sPreviewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_680a3a2e84fc8.jpg",
        _sProfileUrl: "https://gamebanana.com/mods/529789",
        author: "summersby",
        submitterName: "summersby",
      },
      {
        id: 645291,
        _idRow: 645291,
        name: "Compact Damage",
        _sName: "Compact Damage",
        description: "Mod for changing damage visualization",
        _sDescription: "Mod for changing damage visualization",
        _sText: "Mod for changing damage visualization",
        previewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_6961eba172fb9.jpg",
        _sPreviewUrl: "https://images.gamebanana.com/img/ss/mods/530-90_6961eba172fb9.jpg",
        _sProfileUrl: "https://gamebanana.com/mods/645291",
        author: "Unicornshell",
        submitterName: "Unicornshell",
      }
    ];

    const detectedLang = detectLaunchLanguage();
    const defaultSettings = { nsfwMode: "show", language: detectedLang, theme: "purple", favoriteAuthors: [], usefulMods: defaultUsefulMods };

    if (!fs.existsSync(settingsFilePath)) {
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(defaultSettings, null, 4),
        "utf-8",
      );
    }

    try {
      let settings = JSON.parse(fs.readFileSync(settingsFilePath, "utf-8"));

      let explicitLaunchLang = null;
      const argv = process.argv || [];
      for (let i = 0; i < argv.length; i++) {
        const arg = (argv[i] || "").toLowerCase();
        if (arg.startsWith("--lang=") || arg.startsWith("--language=")) {
          const val = arg.split("=")[1];
          if (val === "ru" || val === "en") explicitLaunchLang = val;
        }
        if ((arg === "--lang" || arg === "--language") && i + 1 < argv.length) {
          const next = (argv[i + 1] || "").toLowerCase();
          if (next === "ru" || next === "en") explicitLaunchLang = next;
        }
      }
      if (process.env.WZMM_LANG && (process.env.WZMM_LANG === "ru" || process.env.WZMM_LANG === "en")) {
        explicitLaunchLang = process.env.WZMM_LANG;
      }

      if (explicitLaunchLang) {
        settings.language = explicitLaunchLang;
      } else if (!settings.language || (settings.language !== "ru" && settings.language !== "en")) {
        settings.language = detectedLang;
      }

      settings.theme = mapLegacyTheme(settings.theme || "purple");

      if (!Array.isArray(settings.favoriteAuthors)) {
        settings.favoriteAuthors = [];
      }

      if (!Array.isArray(settings.usefulMods) || settings.usefulMods.length === 0) {
        settings.usefulMods = defaultUsefulMods;
      } else {
        defaultUsefulMods.forEach((defMod) => {
          const exists = settings.usefulMods.some((m) => (m.id === defMod.id || m._idRow === defMod.id));
          if (!exists) {
            settings.usefulMods.push(defMod);
          }
        });
        settings.usefulMods.forEach((m) => {
          if (m && (m.id === 527935 || m._idRow === 527935)) {
            m.name = "Censor Remover & No Outlines";
            m._sName = "Censor Remover & No Outlines";
            m.description = "Censor Remover & No Outlines options";
            m._sDescription = "Censor Remover & No Outlines options";
            m._sText = "Censor Remover & No Outlines options";
            m.previewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_6693f0120d40f.jpg";
            m._sPreviewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_6693f0120d40f.jpg";
            m._sProfileUrl = "https://gamebanana.com/mods/527935";
            m.author = "summersby";
            m.submitterName = "summersby";
          }
          if (m && (m.id === 529789 || m._idRow === 529789)) {
            m.previewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_680a3a2e84fc8.jpg";
            m._sPreviewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_680a3a2e84fc8.jpg";
            m.author = "summersby";
            m.submitterName = "summersby";
          }
          if (m && (m.id === 600543 || m._idRow === 600543)) {
            m.name = "Agent Viewer";
            m._sName = "Agent Viewer";
            m.description = "Allows viewing agents in the menu";
            m._sDescription = "Allows viewing agents in the menu";
            m._sText = "Allows viewing agents in the menu";
            m.previewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_684dadce18810.jpg";
            m._sPreviewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_684dadce18810.jpg";
            m._sProfileUrl = "https://gamebanana.com/mods/600543";
            m.author = "HelpMeHelpYou";
            m.submitterName = "HelpMeHelpYou";
          }
          if (m && (m.id === 645291 || m._idRow === 645291)) {
            m.name = "Compact Damage";
            m._sName = "Compact Damage";
            m.description = "Mod for changing damage visualization";
            m._sDescription = "Mod for changing damage visualization";
            m._sText = "Mod for changing damage visualization";
            m.previewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_6961eba172fb9.jpg";
            m._sPreviewUrl = "https://images.gamebanana.com/img/ss/mods/530-90_6961eba172fb9.jpg";
            m._sProfileUrl = "https://gamebanana.com/mods/645291";
            m.author = "Unicornshell";
            m.submitterName = "Unicornshell";
          }
        });
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

    const bulkWrapper = document.getElementById("bulk-actions-wrapper");
    const bulkBtn = document.getElementById("btn-bulk-actions");
    const bulkEnableAll = document.getElementById("bulk-enable-all");
    const bulkDisableAll = document.getElementById("bulk-disable-all");
    const bulkEnableFiltered = document.getElementById("bulk-enable-filtered");
    const bulkDisableFiltered = document.getElementById("bulk-disable-filtered");

    if (bulkBtn && bulkWrapper) {
      bulkBtn.onclick = (e) => {
        e.stopPropagation();
        bulkWrapper.classList.toggle("open");
      };

      const closeBulkMenu = () => {
        bulkWrapper.classList.remove("open");
      };

      document.addEventListener("click", (e) => {
        if (!bulkWrapper.contains(e.target)) {
          closeBulkMenu();
        }
      });

      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && bulkWrapper.classList.contains("open")) {
          closeBulkMenu();
        }
      });

      if (bulkEnableAll) {
        bulkEnableAll.onclick = (e) => {
          e.stopPropagation();
          closeBulkMenu();
          const { validPath, mods } = modManager.getMods(
            currentSettings.xxmiPath,
            "all",
            "",
            "all",
            currentSettings.language || "ru",
            currentSettings.usefulMods || []
          );
          if (!validPath || !mods || mods.length === 0) {
            if (window.Toast) window.Toast.info(t('installed_bulk_no_mods'));
            return;
          }
          let affectedCount = 0;
          for (const mod of mods) {
            if (!mod.active) {
              if (modManager.toggleMod(currentSettings.xxmiPath, mod.name, false)) {
                affectedCount++;
              }
            }
          }
          if (affectedCount > 0) {
            if (window.Toast) window.Toast.success(t('installed_all_enabled_toast', { count: affectedCount }));
          }
          renderModsGrid();
        };
      }

      if (bulkDisableAll) {
        bulkDisableAll.onclick = (e) => {
          e.stopPropagation();
          closeBulkMenu();
          const { validPath, mods } = modManager.getMods(
            currentSettings.xxmiPath,
            "all",
            "",
            "all",
            currentSettings.language || "ru",
            currentSettings.usefulMods || []
          );
          if (!validPath || !mods || mods.length === 0) {
            if (window.Toast) window.Toast.info(t('installed_bulk_no_mods'));
            return;
          }
          let affectedCount = 0;
          for (const mod of mods) {
            if (mod.active) {
              if (modManager.toggleMod(currentSettings.xxmiPath, mod.name, true)) {
                affectedCount++;
              }
            }
          }
          if (affectedCount > 0) {
            if (window.Toast) window.Toast.info(t('installed_all_disabled_toast', { count: affectedCount }));
          }
          renderModsGrid();
        };
      }

      if (bulkEnableFiltered) {
        bulkEnableFiltered.onclick = (e) => {
          e.stopPropagation();
          closeBulkMenu();
          const { validPath, mods } = modManager.getMods(
            currentSettings.xxmiPath,
            currentModFilter,
            currentSearchQuery,
            currentCharacterFilter,
            currentSettings.language || "ru",
            currentSettings.usefulMods || []
          );
          if (!validPath || !mods || mods.length === 0) {
            if (window.Toast) window.Toast.info(t('installed_bulk_no_mods'));
            return;
          }
          let affectedCount = 0;
          for (const mod of mods) {
            if (!mod.active) {
              if (modManager.toggleMod(currentSettings.xxmiPath, mod.name, false)) {
                affectedCount++;
              }
            }
          }
          if (affectedCount > 0) {
            if (window.Toast) window.Toast.success(t('installed_all_enabled_toast', { count: affectedCount }));
          }
          renderModsGrid();
        };
      }

      if (bulkDisableFiltered) {
        bulkDisableFiltered.onclick = (e) => {
          e.stopPropagation();
          closeBulkMenu();
          const { validPath, mods } = modManager.getMods(
            currentSettings.xxmiPath,
            currentModFilter,
            currentSearchQuery,
            currentCharacterFilter,
            currentSettings.language || "ru",
            currentSettings.usefulMods || []
          );
          if (!validPath || !mods || mods.length === 0) {
            if (window.Toast) window.Toast.info(t('installed_bulk_no_mods'));
            return;
          }
          let affectedCount = 0;
          for (const mod of mods) {
            if (mod.active) {
              if (modManager.toggleMod(currentSettings.xxmiPath, mod.name, true)) {
                affectedCount++;
              }
            }
          }
          if (affectedCount > 0) {
            if (window.Toast) window.Toast.info(t('installed_all_disabled_toast', { count: affectedCount }));
          }
          renderModsGrid();
        };
      }
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
        const { mods } = modManager.getMods(currentSettings.xxmiPath, "all", "", "all", currentSettings.language || "ru", currentSettings.usefulMods || []);
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
      currentSettings.usefulMods || [],
    );

    if (installedFilterDrawer) {
      installedFilterDrawer.setCharacters(characters);
    }

    const bulkFilteredDivider = document.getElementById("bulk-filtered-divider");
    const bulkEnableFiltered = document.getElementById("bulk-enable-filtered");
    const bulkDisableFiltered = document.getElementById("bulk-disable-filtered");
    const isFiltered = currentCharacterFilter !== "all" || (currentSearchQuery && currentSearchQuery.trim() !== "") || currentModFilter !== "all";

    if (bulkFilteredDivider && bulkEnableFiltered && bulkDisableFiltered) {
      if (isFiltered && mods.length > 0) {
        bulkFilteredDivider.style.display = "block";
        bulkEnableFiltered.style.display = "flex";
        bulkDisableFiltered.style.display = "flex";
      } else {
        bulkFilteredDivider.style.display = "none";
        bulkEnableFiltered.style.display = "none";
        bulkDisableFiltered.style.display = "none";
      }
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
    
    const statusBtn = document.getElementById("modal-status");
    const statusText = document.getElementById("modal-status-text") || statusBtn;
    const updateModalStatus = () => {
      if (!statusBtn) return;
      if (mod.active) {
        statusBtn.className = "modal-status-badge active";
        statusBtn.title = t("mod_turn_off");
        if (statusText) statusText.textContent = t("mod_status_on");
      } else {
        statusBtn.className = "modal-status-badge inactive";
        statusBtn.title = t("mod_turn_on");
        if (statusText) statusText.textContent = t("mod_status_off");
      }
    };
    updateModalStatus();

    if (statusBtn) {
      statusBtn.onclick = (e) => {
        e.stopPropagation();
        const success = modManager.toggleMod(
          currentSettings.xxmiPath,
          modIdentifier,
          mod.active
        );
        if (success) {
          mod.active = !mod.active;
          updateModalStatus();
          renderModsGrid();
        } else {
          if (window.Toast) window.Toast.error(t("mod_move_err"));
          else alert(t("mod_move_err"));
        }
      };
    }

    const editModBtn = document.getElementById("modal-edit-mod-btn");
    const editPanel = document.getElementById("modal-edit-panel");
    const editNameInput = document.getElementById("modal-edit-name-input");
    const editPreviewFile = document.getElementById("modal-edit-preview-file");
    const editPreviewBtn = document.getElementById("modal-edit-preview-btn");
    const editPreviewFilename = document.getElementById("modal-edit-preview-filename");
    const editDescInput = document.getElementById("modal-edit-desc-input");
    const editSaveBtn = document.getElementById("modal-edit-save-btn");
    const editCancelBtn = document.getElementById("modal-edit-cancel-btn");

    if (editPanel) {
      editPanel.style.display = "none";
    }

    let selectedPreviewFilePath = null;

    if (editModBtn && editPanel) {
      editModBtn.onclick = () => {
        const isHidden = editPanel.style.display === "none";
        editPanel.style.display = isHidden ? "flex" : "none";
        if (isHidden) {
          if (editNameInput) editNameInput.value = mod.name;
          if (editDescInput) editDescInput.value = mod.description || (modManager.getModDescription ? modManager.getModDescription(mod) : "") || "";
          selectedPreviewFilePath = null;
          if (editPreviewFilename) editPreviewFilename.textContent = "";
          if (editNameInput) setTimeout(() => editNameInput.focus(), 100);
        }
      };
    }

    if (editPreviewBtn && editPreviewFile) {
      editPreviewBtn.onclick = () => {
        editPreviewFile.value = "";
        editPreviewFile.click();
      };
    }

    if (editPreviewFile) {
      editPreviewFile.onchange = () => {
        if (editPreviewFile.files && editPreviewFile.files.length > 0) {
          const file = editPreviewFile.files[0];
          const p = (webUtils && typeof webUtils.getPathForFile === "function")
            ? webUtils.getPathForFile(file)
            : file.path;
          if (p) {
            selectedPreviewFilePath = p;
            if (editPreviewFilename) editPreviewFilename.textContent = path.basename(p);
          }
        }
      };
    }

    if (editCancelBtn && editPanel) {
      editCancelBtn.onclick = () => {
        editPanel.style.display = "none";
      };
    }

    if (editSaveBtn && editPanel) {
      editSaveBtn.onclick = () => {
        const newName = (editNameInput ? editNameInput.value : "").trim();
        if (!newName) {
          if (window.Toast) window.Toast.warning(t("modal_edit_name_empty"));
          return;
        }

        if (newName !== mod.name) {
          const res = modManager.renameMod(currentSettings.xxmiPath, mod.name, newName);
          if (!res.success) {
            if (res.error === "already_exists") {
              if (window.Toast) window.Toast.warning(t("modal_edit_name_exists"));
            } else if (window.Toast) {
              window.Toast.error(res.error);
            }
            return;
          }
          mod.name = res.newName;
          document.getElementById("modal-title").textContent = mod.name;
        }

        if (selectedPreviewFilePath) {
          const newUrl = modManager.setModPreviewImage(currentSettings.xxmiPath, mod.name, selectedPreviewFilePath);
          if (newUrl) {
            mod.previewUrl = newUrl;
          }
        }

        const newDesc = editDescInput ? editDescInput.value.trim() : "";
        modManager.setModDescription(currentSettings.xxmiPath, mod.name, newDesc);
        mod.description = newDesc;

        editPanel.style.display = "none";
        updateModalMedia();
        renderModsGrid();
        if (window.Toast) {
          window.Toast.success(t("modal_edit_saved"));
        }
      };
    }

    const open3dBtn = document.getElementById("modal-open-3d-btn");
    if (open3dBtn) {
      open3dBtn.onclick = async () => {
        const scoreModCandidate = (dir) => {
          try {
            if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return -1;
            let score = 0;
            const scanDir = (current, depth) => {
              if (depth > 2) return;
              const entries = fs.readdirSync(current, { withFileTypes: true });
              for (const ent of entries) {
                const full = path.join(current, ent.name);
                if (ent.isDirectory()) {
                  scanDir(full, depth + 1);
                } else if (ent.isFile()) {
                  const lower = ent.name.toLowerCase();
                  if (lower.endsWith(".buf") || lower.endsWith(".ib")) {
                    score += 50;
                  } else if (lower.endsWith(".ini")) {
                    if (lower.startsWith("disabled")) {
                      score += 15;
                    } else if (lower.includes("noise") || lower.includes("cos") || lower.includes("sin") || lower.includes("rnd") || lower.includes("frame_animation")) {
                      score += 1;
                    } else {
                      score += 30;
                    }
                  }
                }
              }
            };
            scanDir(dir, 0);
            return score;
          } catch (_) {
            return -1;
          }
        };

        let targetPath = null;
        const candidates = [];
        if (currentSettings && currentSettings.xxmiPath) {
          const xxmi = currentSettings.xxmiPath;
          if (mod.activeVariation) {
            candidates.push(path.join(xxmi, "modvars", mod.name, mod.activeVariation));
            candidates.push(path.join(xxmi, "Mods", mod.name, mod.activeVariation));
            candidates.push(path.join(xxmi, "dismods", mod.name, mod.activeVariation));
          }
          candidates.push(path.join(xxmi, "modvars", mod.name));
          candidates.push(path.join(xxmi, "Mods", mod.name));
          candidates.push(path.join(xxmi, "dismods", mod.name));
        }
        if (mod.paths && Array.isArray(mod.paths)) {
          for (const p of mod.paths) {
            if (!p) continue;
            if (mod.activeVariation) candidates.push(path.join(p, mod.activeVariation));
            candidates.push(p);
          }
        }

        let bestScore = -1;
        for (const c of candidates) {
          const s = scoreModCandidate(c);
          if (s > bestScore) {
            bestScore = s;
            targetPath = c;
          }
        }
        if (!targetPath || bestScore <= 0) {
          for (const c of candidates) {
            if (fs.existsSync(c)) {
              targetPath = c;
              break;
            }
          }
        }

        let disabledIni = false;
        if (targetPath) {
          try {
            const checkDisabled = (dir, depth) => {
              if (depth > 2) return false;
              const fList = fs.readdirSync(dir, { withFileTypes: true });
              const inis = fList.filter(f => f.isFile() && f.name.toLowerCase().endsWith(".ini"));
              if (inis.length > 0 && inis.every(f => f.name.toLowerCase().startsWith("disabled"))) {
                return true;
              }
              for (const f of fList) {
                if (f.isDirectory() && checkDisabled(path.join(dir, f.name), depth + 1)) {
                  return true;
                }
              }
              return false;
            };
            disabledIni = checkDisabled(targetPath, 0);
          } catch (_) {}
        }

        try {
          const { ipcRenderer } = require("electron");
          await ipcRenderer.invoke("open-3d-viewer", {
            modPath: targetPath,
            theme: currentSettings.theme,
            lang: currentSettings.language,
            disabledIni
          });
        } catch (e) {
          const { spawn } = require("child_process");
          const { isLinux } = require("./js/platform");
          let mvDir = path.join(__dirname, "modelviewer");
          if (mvDir.includes("app.asar")) {
            const unpacked = mvDir.replace("app.asar", "app.asar.unpacked");
            if (fs.existsSync(unpacked)) mvDir = unpacked;
          }
          const runScript = isLinux ? path.join(mvDir, "run.sh") : path.join(mvDir, "run.bat");
          const spawnArgs = [];
          if (targetPath) spawnArgs.push(targetPath);
          if (disabledIni) spawnArgs.push("--disabled-ini");
          if (currentSettings && currentSettings.theme) spawnArgs.push("--theme", currentSettings.theme);
          if (currentSettings && currentSettings.language) spawnArgs.push("--lang", currentSettings.language);
          const spawnCmd = isLinux ? "/bin/bash" : (process.env.ComSpec || path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"));
          const finalArgs = isLinux ? [runScript, ...spawnArgs] : ["/c", runScript, ...spawnArgs];
          const child = spawn(spawnCmd, finalArgs, {
            cwd: mvDir,
            detached: true,
            stdio: "ignore",
            windowsHide: true,
            env: {
              ...process.env,
              WZMM_THEME: (currentSettings && currentSettings.theme) || "purple",
              WZMM_LANG: (currentSettings && currentSettings.language) || "en"
            }
          });
          child.unref();
        }
      };
    }

    const authorRow = document.getElementById("modal-author-row");
    const authorVal = document.getElementById("modal-author-val");
    if (authorRow && authorVal) {
      if (mod.author) {
        authorRow.style.display = "flex";
        authorVal.textContent = mod.author;
      } else {
        authorRow.style.display = "none";
      }
    }

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
          <img src="${safeUrl}" alt="${mod.name}" loading="lazy" decoding="async" style="cursor: pointer;" title="Нажмите для открытия в полный размер">
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
            if (e.target !== checkbox && !e.target.closest(".var-checkbox-label")) {
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
            if (e.target !== checkbox && !e.target.closest(".var-checkbox-label")) {
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
  let gbSelectedAuthor = null;

  let sideMenuDownload = null;

  const isFavoriteAuthor = (authorId, authorName) => {
    if (!currentSettings.favoriteAuthors || !Array.isArray(currentSettings.favoriteAuthors)) {
      currentSettings.favoriteAuthors = [];
      return false;
    }
    return currentSettings.favoriteAuthors.some(
      (a) => (authorId && a.id === authorId) || (authorName && a.name === authorName)
    );
  };

  const saveFavoriteAuthors = () => {
    try {
      fs.writeFileSync(settingsFilePath, JSON.stringify(currentSettings, null, 2), "utf-8");
    } catch (e) { }
  };

  const toggleFavoriteAuthor = (authorObj) => {
    if (!authorObj || (!authorObj.id && !authorObj.name)) return;
    if (!currentSettings.favoriteAuthors || !Array.isArray(currentSettings.favoriteAuthors)) {
      currentSettings.favoriteAuthors = [];
    }
    const idx = currentSettings.favoriteAuthors.findIndex(
      (a) => (authorObj.id && a.id === authorObj.id) || (authorObj.name && a.name === authorObj.name)
    );
    if (idx >= 0) {
      currentSettings.favoriteAuthors.splice(idx, 1);
      if (gbSelectedAuthor && ((authorObj.id && gbSelectedAuthor.id === authorObj.id) || (authorObj.name && gbSelectedAuthor.name === authorObj.name))) {
        gbSelectedAuthor = null;
        updateActiveFilterUI();
        fetchGBMods(false);
      }
    } else {
      currentSettings.favoriteAuthors.push({
        id: authorObj.id,
        name: authorObj.name,
        avatar: authorObj.avatar || "icons/cat.jpg"
      });
    }
    saveFavoriteAuthors();
    if (sideMenuDownload) {
      sideMenuDownload.setFavoriteAuthors(currentSettings.favoriteAuthors);
    }
  };

  const initGameBananaCatalog = () => {
    const sortSelect = document.getElementById("gb-sort");
    const refreshBtn = document.getElementById("gb-refresh-btn");
    const searchInput = document.getElementById("gb-search");
    const grid = document.getElementById("gb-grid");
    const filterBtn = document.getElementById("gb-filter-btn");

    if (!grid) return;

    renderFeaturedShowcase();

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

      const catId = categoryId !== undefined ? categoryId : (sideMenuDownload ? sideMenuDownload.selectedCategoryId : null);
      const catName = categoryName !== undefined ? categoryName : (sideMenuDownload ? (sideMenuDownload.selectedCategoryName || "") : "");

      let activeCount = 0;
      if (catId) activeCount++;
      if (gbSelectedAuthor) activeCount++;

      if (btn) {
        if (activeCount > 0) {
          btn.classList.add("has-active-filter");
          if (badge) {
            badge.style.display = "inline-block";
            badge.textContent = activeCount.toString();
          }
        } else {
          btn.classList.remove("has-active-filter");
          if (badge) badge.style.display = "none";
        }
      }

      if (bar) {
        if (activeCount > 0) {
          bar.style.display = "flex";
          let html = "";
          if (gbSelectedAuthor) {
            html += `
              <div class="gb-filter-pill">
                <span>${t('gb_author_filter_tag', { name: gbSelectedAuthor.name })}</span>
                <button id="gb-clear-author-tag-btn" class="gb-filter-pill-btn" title="${t('gb_filter_reset')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            `;
          }
          if (catId) {
            html += `
              <div class="gb-filter-pill">
                <span>${t('gb_active_filter_tag', { name: catName })}</span>
                <button id="gb-clear-tag-btn" class="gb-filter-pill-btn" title="${t('gb_filter_reset')}">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            `;
          }
          bar.innerHTML = html;

          const clearTagBtn = document.getElementById("gb-clear-tag-btn");
          if (clearTagBtn) {
            clearTagBtn.onclick = () => {
              if (sideMenuDownload) sideMenuDownload.setCategory(null, null);
            };
          }
          const clearAuthorTagBtn = document.getElementById("gb-clear-author-tag-btn");
          if (clearAuthorTagBtn) {
            clearAuthorTagBtn.onclick = () => {
              gbSelectedAuthor = null;
              if (sideMenuDownload) sideMenuDownload.setAuthor(null);
              updateActiveFilterUI();
              fetchGBMods(false);
            };
          }
        } else {
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
      if (filters.author !== undefined) {
        gbSelectedAuthor = filters.author;
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
        favoriteAuthors: currentSettings.favoriteAuthors || [],
        selectedAuthor: gbSelectedAuthor,
        t: (k, p) => t(k, p),
        onFilterChange: handleFilterChange,
        onNsfwChange: handleNsfwChange,
        onToggleFavoriteAuthor: toggleFavoriteAuthor
      });
      sideMenuDownload.init();
    } else {
      sideMenuDownload.currentLang = currentSettings.language || "ru";
      sideMenuDownload.t = (k, p) => t(k, p);
      sideMenuDownload.favoriteAuthors = currentSettings.favoriteAuthors || [];
      sideMenuDownload.selectedAuthor = gbSelectedAuthor;
      sideMenuDownload.onFilterChange = handleFilterChange;
      sideMenuDownload.onNsfwChange = handleNsfwChange;
      sideMenuDownload.onToggleFavoriteAuthor = toggleFavoriteAuthor;
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

    const fetchGBMods = async (append = false) => {
      if (!append) {
        renderFeaturedShowcase();
      }
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

        if (gbSelectedAuthor) {
          const authorId = gbSelectedAuthor.id;
          const url = `https://gamebanana.com/apiv11/Mod/Index?_nPage=${gbPage}&_nPerpage=30&_aFilters[Generic_Submitter]=${authorId}&_aFilters[Generic_Game]=19567&_sSort=${gbSort}&_csvProperties=${csvProps}`;
          const res = await fetchWithRetry(url, { signal: currentSignal });
          if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
          const data = await res.json();
          if (currentSignal.aborted) return;
          records = data._aRecords || [];
          if (selectedCatId) {
            records = records.filter((r) => matchesCategory(r, selectedCatId));
          }
          if (searchVal) {
            const lowerQuery = searchVal.toLowerCase();
            records = records.filter((m) => {
              const inName = m._sName && m._sName.toLowerCase().includes(lowerQuery);
              const inDesc = m._sDescription && m._sDescription.toLowerCase().includes(lowerQuery);
              return inName || inDesc;
            });
            gbHasMore = false;
          } else if (records.length < 30) {
            gbHasMore = false;
          }
        } else if (searchVal && selectedCatId) {
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

          if (!append && gbPage === 1 && !searchVal && !selectedCatId && gbSort === "Generic_MostLiked" && Array.isArray(gbInitialCatalogCache) && gbInitialCatalogCache.length > 0) {
            records = gbInitialCatalogCache;
          } else {
            const res = await fetchWithRetry(url, { signal: currentSignal });
            if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
            const data = await res.json();
            if (currentSignal.aborted) return;
            records = data._aRecords || [];
            if (!append && gbPage === 1 && !searchVal && !selectedCatId && gbSort === "Generic_MostLiked") {
              gbInitialCatalogCache = records;
            }
          }
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

    if (refreshBtn) {
      refreshBtn.onclick = () => {
        loadBestShowcaseMods(true).then(() => renderFeaturedShowcase());
        fetchGBMods(false);
      };
    }
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

  const ensureGBModalElement = async () => {
    let modal = document.getElementById("gb-modal");
    if (!modal) {
      try {
        const response = await fetch("pages/download.html");
        if (response.ok) {
          const html = await response.text();
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, "text/html");
          const modalInDoc = doc.getElementById("gb-modal");
          if (modalInDoc) {
            document.body.appendChild(modalInDoc);
            modal = modalInDoc;
          }
        }
      } catch (err) {
      }
    }
    if (modal && modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    if (!document.getElementById("gb-modal-style")) {
      const link = document.createElement("link");
      link.id = "gb-modal-style";
      link.rel = "stylesheet";
      link.href = "css/download.css";
      document.head.appendChild(link);
    }
    return modal;
  };

  const openGBModal = async (mod) => {
    if (!mod || !mod._idRow) return;

    const existingModals = document.querySelectorAll("#gb-modal");
    if (existingModals.length > 1) {
      for (let i = 0; i < existingModals.length - 1; i++) {
        existingModals[i].remove();
      }
    }

    const modal = await ensureGBModalElement();
    if (!modal) return;

    clearTimeout(gbIdleTimer);

    applyTranslationsToDOM(modal);

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

    const versionEl = modal.querySelector("#gb-modal-version");
    const authorWrap = modal.querySelector("#gb-modal-author-wrap");
    const authorAvatar = modal.querySelector("#gb-modal-author-avatar");
    const authorName = modal.querySelector("#gb-modal-author-name");
    const authorTitle = modal.querySelector("#gb-modal-author-title");
    const favAuthorBtn = modal.querySelector("#gb-modal-fav-author-btn");
    const categoryEl = modal.querySelector("#gb-modal-category");

    const updateFavAuthorBtnState = (subObj) => {
      if (!favAuthorBtn) return;
      if (subObj && subObj._idRow && subObj._sName) {
        favAuthorBtn.style.display = "inline-flex";
        const isFav = isFavoriteAuthor(subObj._idRow, subObj._sName);
        favAuthorBtn.classList.toggle("active", isFav);
        favAuthorBtn.title = isFav ? t("gb_fav_author_remove") : t("gb_fav_author_add");
        favAuthorBtn.onclick = (e) => {
          e.stopPropagation();
          toggleFavoriteAuthor({
            id: subObj._idRow,
            name: subObj._sName,
            avatar: subObj._sAvatarUrl || "icons/cat.jpg"
          });
          const nowFav = isFavoriteAuthor(subObj._idRow, subObj._sName);
          favAuthorBtn.classList.toggle("active", nowFav);
          favAuthorBtn.title = nowFav ? t("gb_fav_author_remove") : t("gb_fav_author_add");
        };
      } else {
        favAuthorBtn.style.display = "none";
      }
    };

    const statsViews = modal.querySelector("#gb-stat-views .gb-stat-val");
    const statsDownloads = modal.querySelector("#gb-stat-downloads .gb-stat-val");
    const statsLikes = modal.querySelector("#gb-stat-likes .gb-stat-val");
    const statsPosts = modal.querySelector("#gb-stat-posts .gb-stat-val");
    const statsThanks = modal.querySelector("#gb-stat-thanks .gb-stat-val");
    const statsSubs = modal.querySelector("#gb-stat-subs .gb-stat-val");
    const statsAdded = modal.querySelector("#gb-stat-date-added .gb-stat-val");
    const statsUpdated = modal.querySelector("#gb-stat-date-updated .gb-stat-val");

    const tabBtnDesc = modal.querySelector("#gb-tab-btn-desc");
    const tabBtnComments = modal.querySelector("#gb-tab-btn-comments");
    const tabBtnDetails = modal.querySelector("#gb-tab-btn-details");
    const commentsBadge = modal.querySelector("#gb-comments-counter-badge");
    const tabIndicator = modal.querySelector("#gb-tab-indicator");

    const commentsPanel = modal.querySelector("#gb-modal-comments-panel");
    const commentsList = modal.querySelector("#gb-comments-list");
    const commentsLoading = modal.querySelector("#gb-comments-loading");
    const commentsEmpty = modal.querySelector("#gb-comments-empty");
    const commentsLoadMore = modal.querySelector("#gb-comments-load-more");

    const detailsPanel = modal.querySelector("#gb-modal-details-panel");
    const detailsContent = modal.querySelector("#gb-details-content");

    let currentActiveTab = "desc";
    const tabOrder = { desc: 0, comments: 1, details: 2 };
    let profileDataCache = null;
    let commentsLoaded = false;
    let detailsRendered = false;

    const renderDetailsContent = (pData) => {
      if (!detailsContent || !pData) return;
      detailsContent.innerHTML = "";
      let hasDetails = false;

      if (Array.isArray(pData._aTags) && pData._aTags.length > 0) {
        hasDetails = true;
        const tagSec = document.createElement("div");
        tagSec.className = "gb-details-section";
        const title = document.createElement("div");
        title.className = "gb-details-section-title";
        title.textContent = t("gb_details_tags");
        tagSec.appendChild(title);

        const wrap = document.createElement("div");
        wrap.className = "gb-tags-wrap";
        pData._aTags.forEach((tag) => {
          const val = typeof tag === "string" ? tag : (tag._sTitle ? `${tag._sTitle}: ${tag._sValue}` : (tag._sValue || ""));
          if (val) {
            const chip = document.createElement("span");
            chip.className = "gb-tag-chip";
            chip.textContent = val;
            wrap.appendChild(chip);
          }
        });
        tagSec.appendChild(wrap);
        detailsContent.appendChild(tagSec);
      }

      if (Array.isArray(pData._aCredits) && pData._aCredits.length > 0) {
        hasDetails = true;
        const crSec = document.createElement("div");
        crSec.className = "gb-details-section";
        const title = document.createElement("div");
        title.className = "gb-details-section-title";
        title.textContent = t("gb_details_credits");
        crSec.appendChild(title);

        const list = document.createElement("div");
        list.className = "gb-credits-list";
        pData._aCredits.forEach((crGroup) => {
          const groupName = crGroup._sGroupName || "";
          const authors = crGroup._aAuthors || [];
          authors.forEach((author) => {
            const item = document.createElement("div");
            item.className = "gb-credit-item";
            const nameSpan = document.createElement("span");
            nameSpan.className = "gb-credit-name";
            nameSpan.textContent = author._sName || "";
            const roleSpan = document.createElement("span");
            roleSpan.className = "gb-credit-role";
            roleSpan.textContent = author._sRole || groupName || "";
            item.appendChild(nameSpan);
            item.appendChild(roleSpan);
            list.appendChild(item);
          });
        });
        crSec.appendChild(list);
        detailsContent.appendChild(crSec);
      }

      if (pData._sFeedbackInstructions) {
        hasDetails = true;
        const instSec = document.createElement("div");
        instSec.className = "gb-details-section";
        const title = document.createElement("div");
        title.className = "gb-details-section-title";
        title.textContent = t("gb_details_instructions");
        instSec.appendChild(title);

        const box = document.createElement("div");
        box.className = "gb-instructions-box";
        box.innerHTML = sanitizeHtmlContent(pData._sFeedbackInstructions);
        instSec.appendChild(box);
        detailsContent.appendChild(instSec);
      }

      bindExternalLinks(detailsContent);

      if (!hasDetails) {
        const emptySec = document.createElement("div");
        emptySec.className = "gb-comments-empty";
        emptySec.textContent = t("gb_desc_empty");
        detailsContent.appendChild(emptySec);
      }
    };

    const triggerLazyComments = () => {
      if (commentsLoaded) return;
      commentsLoaded = true;
      const subId = profileDataCache?._aSubmitter?._idRow || mod._aSubmitter?._idRow;
      loadComments(1, subId);
    };

    const triggerLazyDetails = () => {
      if (detailsRendered || !profileDataCache) return;
      detailsRendered = true;
      renderDetailsContent(profileDataCache);
    };

    const updateTabIndicator = (activeBtn, animate = true) => {
      if (!tabIndicator || !activeBtn) return;
      const left = activeBtn.offsetLeft;
      const top = activeBtn.offsetTop;
      const width = activeBtn.offsetWidth;
      const height = activeBtn.offsetHeight;
      if (!width || !height) return;
      if (!animate) {
        tabIndicator.style.transition = "none";
      }
      tabIndicator.style.width = `${width}px`;
      tabIndicator.style.height = `${height}px`;
      tabIndicator.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      if (!animate) {
        void tabIndicator.offsetWidth;
        tabIndicator.style.transition = "";
      }
    };

    const switchTab = (tabName, animate = true) => {
      const prevIdx = tabOrder[currentActiveTab] ?? 0;
      const nextIdx = tabOrder[tabName] ?? 0;
      const directionClass = nextIdx > prevIdx ? "slide-right" : (nextIdx < prevIdx ? "slide-left" : "");
      currentActiveTab = tabName;

      const activeBtn = tabName === "desc" ? tabBtnDesc : (tabName === "comments" ? tabBtnComments : tabBtnDetails);

      if (tabBtnDesc) tabBtnDesc.classList.toggle("active", tabName === "desc");
      if (tabBtnComments) tabBtnComments.classList.toggle("active", tabName === "comments");
      if (tabBtnDetails) tabBtnDetails.classList.toggle("active", tabName === "details");

      updateTabIndicator(activeBtn, animate);

      const panels = [
        { name: "desc", el: descEl },
        { name: "comments", el: commentsPanel },
        { name: "details", el: detailsPanel }
      ];

      panels.forEach((p) => {
        if (!p.el) return;
        if (p.name === tabName) {
          p.el.classList.remove("slide-right", "slide-left");
          void p.el.offsetWidth;
          if (directionClass) {
            p.el.classList.add(directionClass);
          }
          p.el.classList.add("active");
        } else {
          p.el.classList.remove("active", "slide-right", "slide-left");
        }
      });

      if (tabName === "comments") {
        triggerLazyComments();
      } else if (tabName === "details") {
        triggerLazyDetails();
      }
    };

    const onModalResize = () => {
      const activeBtn = currentActiveTab === "desc" ? tabBtnDesc : (currentActiveTab === "comments" ? tabBtnComments : tabBtnDetails);
      updateTabIndicator(activeBtn, false);
    };
    window.addEventListener("resize", onModalResize);

    if (tabBtnDesc) tabBtnDesc.onclick = () => switchTab("desc");
    if (tabBtnComments) tabBtnComments.onclick = () => switchTab("comments");
    if (tabBtnDetails) tabBtnDetails.onclick = () => switchTab("details");
    switchTab("desc", false);
    requestAnimationFrame(() => updateTabIndicator(tabBtnDesc, false));
    setTimeout(() => updateTabIndicator(tabBtnDesc, false), 50);

    if (titleEl) titleEl.textContent = mod._sName || "";

    if (versionEl) {
      if (mod._sVersion) {
        versionEl.textContent = "v" + mod._sVersion.replace(/^v/i, "");
        versionEl.style.display = "inline-block";
      } else {
        versionEl.style.display = "none";
      }
    }

    if (statsLikes) statsLikes.textContent = abbreviateCount(mod._nLikeCount ?? 0);
    if (statsViews) statsViews.textContent = abbreviateCount(mod._nViewCount ?? 0);
    if (statsPosts) statsPosts.textContent = abbreviateCount(mod._nPostCount ?? 0);
    if (commentsBadge) {
      commentsBadge.textContent = (mod._nPostCount ?? 0).toString();
      if (currentActiveTab === "comments") {
        requestAnimationFrame(() => updateTabIndicator(tabBtnComments, false));
      }
    }
    if (statsDownloads) statsDownloads.textContent = abbreviateCount(mod._nDownloadCount ?? 0);
    if (statsThanks) statsThanks.textContent = "0";
    if (statsSubs) statsSubs.textContent = "0";
    if (statsAdded) statsAdded.textContent = mod._tsDateAdded ? new Date(mod._tsDateAdded * 1000).toLocaleDateString() : "-";
    if (statsUpdated) statsUpdated.textContent = (mod._tsDateModified || mod._tsDateUpdated) ? timeAgo(mod._tsDateModified || mod._tsDateUpdated) : "-";

    const initialSub = mod._aSubmitter;
    if (initialSub && initialSub._sName) {
      if (authorAvatar) {
        authorAvatar.src = initialSub._sAvatarUrl || "icons/cat.jpg";
        authorAvatar.onerror = () => {
          authorAvatar.onerror = null;
          authorAvatar.src = "icons/cat.jpg";
        };
      }
      if (authorName) {
        authorName.textContent = initialSub._sName;
        authorName.onclick = (e) => {
          e.preventDefault();
          shell.openExternal(initialSub._sProfileUrl || `https://gamebanana.com/members/${initialSub._idRow}`);
        };
      }
      if (authorTitle) {
        authorTitle.textContent = initialSub._sUserTitle || "";
        authorTitle.style.display = initialSub._sUserTitle ? "inline-block" : "none";
      }
      updateFavAuthorBtnState(initialSub);
      if (authorWrap) authorWrap.style.display = "inline-flex";
    } else if (authorWrap) {
      authorWrap.style.display = "none";
      if (favAuthorBtn) favAuthorBtn.style.display = "none";
    }

    const initialCat = mod._aCategory?._sName || mod._aSubCategory?._sName || mod._aRootCategory?._sName;
    if (initialCat && categoryEl) {
      categoryEl.textContent = initialCat;
      categoryEl.style.display = "inline-block";
    } else if (categoryEl) {
      categoryEl.style.display = "none";
    }

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
    }

    if (imgEl) {
      imgEl.style.filter = "none";
      imgEl.decoding = "async";
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
      carouselContainer.style.display = gbImages.length > 0 ? "flex" : "none";
      carouselContainer.onmousemove = resetIdleTimer;
      carouselContainer.ontouchstart = resetIdleTimer;
    }

    if (prevBtn) {
      prevBtn.style.display = gbImages.length > 1 ? "flex" : "none";
      prevBtn.onclick = (e) => {
        e.stopPropagation();
        showModalImage(gbImgIndex - 1);
        resetIdleTimer();
      };
    }

    if (nextBtn) {
      nextBtn.style.display = gbImages.length > 1 ? "flex" : "none";
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

    let commentsPage = 1;
    let commentsTotalCount = mod._nPostCount || 0;
    let commentsLoadingActive = false;

    const renderCommentItem = (comment, submitterId, isReply = false) => {
      const card = document.createElement("div");
      card.className = isReply ? "gb-reply-card" : "gb-comment-card";

      const poster = comment._aPoster || comment._aSubmitter || {};
      const isAuthor = poster._idRow === submitterId || (Array.isArray(comment._aLabels) && comment._aLabels.includes("Submitter"));

      const header = document.createElement("div");
      header.className = "gb-comment-header";

      const aWrap = document.createElement("div");
      aWrap.className = "gb-comment-author-wrap";

      const avatar = document.createElement("img");
      avatar.className = "gb-comment-avatar";
      avatar.loading = "lazy";
      avatar.decoding = "async";
      avatar.src = poster._sAvatarUrl || "icons/cat.jpg";
      avatar.onerror = () => {
        avatar.onerror = null;
        avatar.src = "icons/cat.jpg";
      };

      const nameEl = document.createElement("a");
      nameEl.className = "gb-comment-author-name";
      nameEl.textContent = poster._sName || "Anonymous";
      nameEl.onclick = (e) => {
        e.preventDefault();
        if (poster._sProfileUrl || poster._idRow) {
          shell.openExternal(poster._sProfileUrl || `https://gamebanana.com/members/${poster._idRow}`);
        }
      };

      aWrap.appendChild(avatar);
      aWrap.appendChild(nameEl);

      if (isAuthor) {
        const authorBadge = document.createElement("span");
        authorBadge.className = "gb-comment-badge gb-comment-badge-submitter";
        authorBadge.textContent = t("gb_author_submitter");
        aWrap.appendChild(authorBadge);
      }

      const dateEl = document.createElement("span");
      dateEl.className = "gb-comment-date";
      dateEl.textContent = timeAgo(comment._tsDateAdded);
      if (comment._tsDateAdded) {
        dateEl.title = new Date(comment._tsDateAdded * 1000).toLocaleString();
      }

      header.appendChild(aWrap);
      header.appendChild(dateEl);
      card.appendChild(header);

      const body = document.createElement("div");
      body.className = "gb-comment-body";
      body.innerHTML = sanitizeHtmlContent(comment._sText || "");
      bindExternalLinks(body);
      body.querySelectorAll("img").forEach((cImg) => {
        cImg.loading = "lazy";
        cImg.decoding = "async";
        cImg.onerror = () => {
          cImg.onerror = null;
          cImg.src = "icons/cat.jpg";
        };
        cImg.onclick = () => {
          if (cImg.src) openLightbox(cImg.src);
        };
      });
      card.appendChild(body);

      const hasStamps = Array.isArray(comment._aStamps) && comment._aStamps.length > 0;
      const replyCount = Number(comment._nReplyCount) || 0;

      if (hasStamps || replyCount > 0) {
        const footer = document.createElement("div");
        footer.className = "gb-comment-footer";

        if (hasStamps) {
          const stampsWrap = document.createElement("div");
          stampsWrap.className = "gb-comment-stamps";
          comment._aStamps.forEach((stamp) => {
            const pill = document.createElement("span");
            pill.className = "gb-stamp-pill";
            pill.textContent = `${stamp._sTitle || ""} ${stamp._nCount || 1}`;
            stampsWrap.appendChild(pill);
          });
          footer.appendChild(stampsWrap);
        } else {
          footer.appendChild(document.createElement("div"));
        }

        if (replyCount > 0 && !isReply) {
          const replyToggleBtn = document.createElement("button");
          replyToggleBtn.className = "gb-replies-toggle-btn";
          replyToggleBtn.textContent = t("gb_replies_show", { count: replyCount });

          let repliesContainer = null;
          let repliesLoaded = false;
          let repliesVisible = false;

          replyToggleBtn.onclick = async () => {
            if (!repliesContainer) {
              repliesContainer = document.createElement("div");
              repliesContainer.className = "gb-replies-container";
              card.appendChild(repliesContainer);
            }

            if (repliesVisible) {
              repliesContainer.style.display = "none";
              replyToggleBtn.textContent = t("gb_replies_show", { count: replyCount });
              repliesVisible = false;
              return;
            }

            if (!repliesLoaded) {
              replyToggleBtn.disabled = true;
              replyToggleBtn.textContent = t("gb_replies_loading");
              try {
                const repliesUrl = `https://gamebanana.com/apiv11/Post/${comment._idRow}/Posts`;
                const rRes = await fetch(repliesUrl, { signal: activeGBModalController?.signal });
                if (rRes.ok) {
                  const rData = await rRes.json();
                  const rRecords = rData._aRecords || [];
                  repliesContainer.innerHTML = "";
                  rRecords.forEach((replyItem) => {
                    const replyCard = renderCommentItem(replyItem, submitterId, true);
                    repliesContainer.appendChild(replyCard);
                  });
                  repliesLoaded = true;
                }
              } catch (rErr) {
              } finally {
                replyToggleBtn.disabled = false;
              }
            }

            repliesContainer.style.display = "flex";
            replyToggleBtn.textContent = t("gb_replies_hide");
            repliesVisible = true;
          };

          footer.appendChild(replyToggleBtn);
        }

        card.appendChild(footer);
      }

      return card;
    };

    const loadComments = async (page = 1, submitterId = null) => {
      if (commentsLoadingActive) return;
      commentsLoadingActive = true;

      if (page === 1 && commentsList) commentsList.innerHTML = "";
      if (commentsLoading) commentsLoading.style.display = "flex";
      if (commentsEmpty) commentsEmpty.style.display = "none";
      if (commentsLoadMore) commentsLoadMore.style.display = "none";

      try {
        let postsData = null;
        const postsUrlNewest = `https://gamebanana.com/apiv11/Mod/${mod._idRow}/Posts?_nPage=${page}&_nPerpage=15&_sSort=newest`;
        let res = null;
        try {
          res = await fetch(postsUrlNewest, { signal: activeGBModalController?.signal });
        } catch (e) {
          res = null;
        }

        if (!res || !res.ok) {
          const postsUrlFallback = `https://gamebanana.com/apiv11/Mod/${mod._idRow}/Posts?_nPage=${page}&_nPerpage=15`;
          res = await fetch(postsUrlFallback, { signal: activeGBModalController?.signal });
        }

        if (res && res.ok) {
          postsData = await res.json();
        }

        if (requestId !== activeGBModalId) return;

        const records = postsData?._aRecords || [];
        const meta = postsData?._aMetadata || {};
        if (meta._nRecordCount != null) {
          commentsTotalCount = meta._nRecordCount;
          if (commentsBadge) {
            commentsBadge.textContent = commentsTotalCount.toString();
            if (currentActiveTab === "comments") {
              requestAnimationFrame(() => updateTabIndicator(tabBtnComments, false));
            }
          }
          if (statsPosts) statsPosts.textContent = abbreviateCount(commentsTotalCount);
        }

        if (commentsLoading) commentsLoading.style.display = "none";

        if (records.length === 0 && page === 1) {
          if (commentsEmpty) commentsEmpty.style.display = "block";
        } else if (commentsList) {
          records.forEach((comment) => {
            const cCard = renderCommentItem(comment, submitterId);
            commentsList.appendChild(cCard);
          });

          const hasMore = meta._bIsComplete === false || (commentsList.children.length < commentsTotalCount);
          if (commentsLoadMore) {
            commentsLoadMore.style.display = hasMore ? "block" : "none";
            commentsLoadMore.onclick = () => {
              loadComments(++commentsPage, submitterId);
            };
          }
        }
      } catch (err) {
        if (requestId !== activeGBModalId) return;
        if (commentsLoading) commentsLoading.style.display = "none";
        if (page === 1 && commentsEmpty) {
          commentsEmpty.textContent = t("gb_comments_error");
          commentsEmpty.style.display = "block";
        }
      } finally {
        commentsLoadingActive = false;
      }
    };

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
        let profileData = gbProfileCache.get(mod._idRow);

        if (!profileData) {
          let fetchSuccess = false;
          const profileUrl = `https://gamebanana.com/apiv11/Mod/${mod._idRow}/ProfilePage`;
          const fetchSignal = activeGBModalController.signal;
          const timeoutId = setTimeout(() => {
            if (activeGBModalController) activeGBModalController.abort();
          }, 15000);

          try {
            const pRes = await fetch(profileUrl, { signal: fetchSignal });
            if (pRes.ok) {
              const pJson = await pRes.json();
              if (pJson && !pJson._sErrorCode) {
                profileData = pJson;
                fetchSuccess = true;
              }
            }
          } catch (pErr) {
          } finally {
            clearTimeout(timeoutId);
          }

          if (!fetchSuccess) {
            const csvUrl = `https://gamebanana.com/apiv11/Mod/${mod._idRow}?_csvProperties=_sName,_nLikeCount,_nViewCount,_nDownloadCount,_nPostCount,_tsDateAdded`;
            const coreUrl = `https://api.gamebanana.com/Core/Item/Data?itemtype=Mod&itemid=${mod._idRow}&fields=text,Files().aFiles()`;

            const [csvRes, coreRes] = await Promise.all([
              fetch(csvUrl, { signal: fetchSignal }).catch(() => null),
              fetch(coreUrl, { signal: fetchSignal }).catch(() => null),
            ]);

            let csvData = {};
            if (csvRes && csvRes.ok) {
              csvData = await csvRes.json();
            }

            let coreData = [];
            if (coreRes && coreRes.ok) {
              coreData = await coreRes.json();
            }

            if (!Array.isArray(coreData) || coreData.length < 2) {
              throw new Error("Invalid response format");
            }

            profileData = {
              ...csvData,
              _sName: csvData._sName || mod._sName,
              _sText: coreData[0] || "",
              _aFiles: coreData[1] || {},
              _aSubmitter: mod._aSubmitter,
            };
          }

          gbProfileCache.set(mod._idRow, profileData);
        }

        if (requestId !== activeGBModalId) return;

        if (titleEl && profileData._sName) {
          titleEl.textContent = profileData._sName;
        }

        if (versionEl) {
          if (profileData._sVersion) {
            versionEl.textContent = "v" + profileData._sVersion.replace(/^v/i, "");
            versionEl.style.display = "inline-block";
          } else {
            versionEl.style.display = "none";
          }
        }

        const sub = profileData._aSubmitter || mod._aSubmitter;
        if (sub && sub._sName) {
          if (authorAvatar) {
            authorAvatar.src = sub._sAvatarUrl || "icons/cat.jpg";
            authorAvatar.onerror = () => {
              authorAvatar.onerror = null;
              authorAvatar.src = "icons/cat.jpg";
            };
          }
          if (authorName) {
            authorName.textContent = sub._sName;
            authorName.onclick = (e) => {
              e.preventDefault();
              shell.openExternal(sub._sProfileUrl || `https://gamebanana.com/members/${sub._idRow}`);
            };
          }
          if (authorTitle) {
            authorTitle.textContent = sub._sUserTitle || "";
            authorTitle.style.display = sub._sUserTitle ? "inline-block" : "none";
          }
          updateFavAuthorBtnState(sub);
          if (authorWrap) authorWrap.style.display = "inline-flex";
        } else if (favAuthorBtn) {
          favAuthorBtn.style.display = "none";
        }

        const catName =
          profileData._aCategory?._sName ||
          profileData._aSubCategory?._sName ||
          profileData._aRootCategory?._sName ||
          mod._aCategory?._sName ||
          mod._aSubCategory?._sName ||
          mod._aRootCategory?._sName;
        if (catName && categoryEl) {
          categoryEl.textContent = catName;
          categoryEl.style.display = "inline-block";
        }

        if (statsViews) statsViews.textContent = abbreviateCount(profileData._nViewCount ?? mod._nViewCount ?? 0);
        if (statsDownloads) statsDownloads.textContent = abbreviateCount(profileData._nDownloadCount ?? 0);
        if (statsLikes) statsLikes.textContent = abbreviateCount(profileData._nLikeCount ?? mod._nLikeCount ?? 0);
        if (statsPosts) statsPosts.textContent = abbreviateCount(profileData._nPostCount ?? mod._nPostCount ?? 0);
        if (commentsBadge) {
          commentsBadge.textContent = (profileData._nPostCount ?? mod._nPostCount ?? 0).toString();
          if (currentActiveTab === "comments") {
            requestAnimationFrame(() => updateTabIndicator(tabBtnComments, false));
          }
        }
        if (statsThanks) statsThanks.textContent = abbreviateCount(profileData._nThanksCount ?? 0);
        if (statsSubs) statsSubs.textContent = abbreviateCount(profileData._nSubscriberCount ?? 0);
        const addedTs = profileData._tsDateAdded || mod._tsDateAdded;
        if (statsAdded && addedTs) statsAdded.textContent = new Date(addedTs * 1000).toLocaleDateString();
        const updTs =
          profileData._tsDateModified ||
          profileData._tsDateUpdated ||
          mod._tsDateModified ||
          mod._tsDateUpdated;
        if (statsUpdated && updTs) statsUpdated.textContent = timeAgo(updTs);

        if (
          profileData._aPreviewMedia &&
          profileData._aPreviewMedia._aImages &&
          profileData._aPreviewMedia._aImages.length > gbImages.length
        ) {
          gbImages = profileData._aPreviewMedia._aImages.map(
            (img) => img._sBaseUrl + "/" + img._sFile,
          );
        }

        if (descEl) {
          descEl.innerHTML = profileData._sText || shortDesc || t("gb_desc_empty");
          descEl.querySelectorAll("img").forEach((dImg) => {
            dImg.draggable = false;
            dImg.loading = "lazy";
            dImg.decoding = "async";
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
          bindExternalLinks(descEl);
        }

        profileDataCache = profileData;
        if (currentActiveTab === "details") {
          triggerLazyDetails();
        } else if (currentActiveTab === "comments") {
          triggerLazyComments();
        }

        const filesRaw = profileData._aFiles;
        const filesArr = Array.isArray(filesRaw) ? filesRaw : (filesRaw && typeof filesRaw === "object" ? Object.values(filesRaw) : []);
        if (filesLoading) filesLoading.style.display = "none";

        if (filesArr.length > 0 && filesList) {
          filesList.innerHTML = "";
          if (filesArr.length === 1 && modManager.isModDownloaded(currentSettings.xxmiPath, mod._idRow)) {
            const msg = document.createElement("div");
            msg.style.cssText =
              "padding:12px; background:rgba(255,42,42,0.1); border:1px solid var(--color-red); border-radius:8px; color:var(--color-red); margin-bottom:12px; font-size:0.9rem; font-weight:600;";
            msg.textContent = t("gb_already_dl_msg");
            filesList.appendChild(msg);
          }

          const previewUrlToPass = gbImages.length > 0 ? gbImages[0] : null;

          const sortedFiles = filesArr.slice().sort((a, b) => {
            const timeA = Number(a._tsDateAdded) || Number(a._idRow) || 0;
            const timeB = Number(b._tsDateAdded) || Number(b._idRow) || 0;
            return timeB - timeA;
          });

          const safeModFolder =
            (profileData._sName || mod._sName || "")
              .replace(/[<>:"/\\|?*]+/g, "")
              .trim() || "Mod_" + mod._idRow;

          sortedFiles.forEach((file) => {
            const fDiv = document.createElement("div");
            fDiv.className = "gb-file-item";

            const isFileDownloading = Object.values(activeDownloads).some(
              (d) => d.fileName === file._sFile,
            );

            const safeVariationName =
              file._sFile.replace(/\.[^/.]+$/, "").replace(/[<>:"/\\|?*]+/g, "").trim() ||
              "Default";
            let isFileDownloaded = false;
            if (currentSettings.xxmiPath) {
              const varPath = path.join(currentSettings.xxmiPath, "modvars", safeModFolder, safeVariationName);
              const modPath = path.join(currentSettings.xxmiPath, "Mods", safeModFolder);
              const disPath = path.join(currentSettings.xxmiPath, "dismods", safeModFolder);
              if (fs.existsSync(varPath)) {
                isFileDownloaded = true;
              } else if (filesArr.length === 1 && (fs.existsSync(modPath) || fs.existsSync(disPath))) {
                isFileDownloaded = true;
              }
            }

            const dlCountStr = file._nDownloadCount != null ? ` &bull; ${file._nDownloadCount} ${t("gb_file_downloads")}` : "";
            const descStr = file._sDescription ? `<div class="gb-file-desc">${file._sDescription}</div>` : "";

            const btnText = isFileDownloading
              ? t("gb_downloading")
              : (isFileDownloaded ? t("gb_file_installed") : t("gb_install"));

            const btnStyle = isFileDownloading
              ? 'disabled style="background:#3f3f46; cursor:not-allowed;"'
              : (isFileDownloaded ? 'style="background:var(--accent-dim); border:1px solid var(--accent); color:var(--text-on-accent);"' : '');

            fDiv.innerHTML = `
              <strong>${file._sFile}</strong>
              ${descStr}
              <div class="gb-file-meta">
                <span>${t("gb_added")}: ${new Date(file._tsDateAdded * 1000).toLocaleDateString()}</span>
                <span>&bull; ${(file._nFilesize / 1024 / 1024).toFixed(2)} MB</span>
                ${dlCountStr}
              </div>
              <button class="btn-install" ${btnStyle}>
                ${btnText}
              </button>
            `;
            fDiv.querySelector(".btn-install").onclick = () => {
              if (!isFileDownloading) {
                const modDescriptionToPass = profileData._sText || mod._sDescription || "";
                const modToPass = {
                  ...mod,
                  ...profileData,
                  _aSubmitter: sub || mod._aSubmitter,
                  author: (sub && sub._sName) || (mod._aSubmitter && mod._aSubmitter._sName) || null,
                };
                startDownload(
                  file,
                  mod._sName,
                  mod._idRow,
                  previewUrlToPass,
                  modDescriptionToPass,
                  modToPass,
                );
                modal.classList.remove("active");
              }
            };
            filesList.appendChild(fDiv);
          });
        } else if (filesList) {
          filesList.innerHTML = `<div style="color:var(--color-muted);">${t("gb_files_unavail")}</div>`;
        }
      } catch (err) {
        if (requestId !== activeGBModalId) return;

        if (filesLoading) filesLoading.style.display = "none";

        if (descEl) {
          if (shortDesc) {
            descEl.innerHTML = `
              <div>${shortDesc}</div>
              <div class="gb-modal-error-box" style="margin-top: 14px;">
                <div class="gb-modal-error-text">${t("gb_data_fetch_fail")}</div>
                <button class="gb-modal-retry-btn" id="gb-modal-retry-desc-btn">${t("gb_retry")}</button>
              </div>
            `;
          } else {
            descEl.innerHTML = `
              <div class="gb-modal-error-box">
                <div class="gb-modal-error-text">${t("gb_data_fetch_fail")}</div>
                <button class="gb-modal-retry-btn" id="gb-modal-retry-desc-btn">${t("gb_retry")}</button>
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
              <div class="gb-modal-error-text">${t("gb_files_fail")}</div>
              <button class="gb-modal-retry-btn" id="gb-modal-retry-files-btn">${t("gb_retry")}</button>
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
      window.removeEventListener("resize", onModalResize);
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

            let authorName = null;
            if (gbMod) {
              if (gbMod._aSubmitter && gbMod._aSubmitter._sName) {
                authorName = gbMod._aSubmitter._sName;
              } else if (gbMod.author) {
                authorName = gbMod.author;
              }
            }

            modManager.setModMetadata(
              safeModFolder,
              {
                id: modId,
                name: modName,
                character: charName,
                characterId: charId,
                category: rootCat,
                author: authorName,
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

  let dlSearchTerm = "";

  const initDownloadsTab = () => {
    const searchInput = document.getElementById("dl-search-input");
    if (searchInput) {
      searchInput.value = dlSearchTerm;
      searchInput.oninput = (e) => {
        dlSearchTerm = e.target.value.toLowerCase().trim();
        renderDownloadsTab();
      };
    }

    const goCatalogBtn = document.getElementById("dl-go-catalog-btn");
    if (goCatalogBtn) {
      goCatalogBtn.onclick = () => {
        const gbTab = document.querySelector('.sidebar-item[data-page="download"]');
        if (gbTab) gbTab.click();
      };
    }

    renderDownloadsTab();
  };

  const renderDownloadsTab = () => {
    const list = document.getElementById("downloads-list");
    if (!list) return;

    const activeKeys = Object.keys(activeDownloads);
    const activeCount = activeKeys.length;

    let totalSpeedBytes = 0;
    activeKeys.forEach((k) => {
      totalSpeedBytes += activeDownloads[k].speed || 0;
    });

    const speedVal = document.getElementById("dl-speed-val");
    const activeVal = document.getElementById("dl-active-val");

    if (speedVal) speedVal.textContent = t('dl_speed_mb', { speed: (totalSpeedBytes / 1024 / 1024).toFixed(1) });
    if (activeVal) activeVal.textContent = activeCount.toString();

    const filteredKeys = activeKeys.filter((key) => {
      const item = activeDownloads[key];
      if (!dlSearchTerm) return true;
      return (
        (item.name && item.name.toLowerCase().includes(dlSearchTerm)) ||
        (item.fileName && item.fileName.toLowerCase().includes(dlSearchTerm))
      );
    });

    if (filteredKeys.length === 0) {
      list.innerHTML = `
        <div class="dl-empty-state">
          <div class="dl-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </div>
          <div class="dl-empty-title">${t('dl_empty_title')}</div>
          <div class="dl-empty-desc">${t('dl_empty_desc')}</div>
          <button class="dl-empty-btn" id="dl-empty-go-catalog">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>
            <span>${t('dl_go_catalog')}</span>
          </button>
        </div>
      `;
      const catalogBtn = document.getElementById("dl-empty-go-catalog");
      if (catalogBtn) {
        catalogBtn.onclick = () => {
          const gbTab = document.querySelector('.sidebar-item[data-page="download"]');
          if (gbTab) gbTab.click();
        };
      }
      return;
    }

    const emptyState = list.querySelector(".dl-empty-state");
    if (emptyState) emptyState.remove();

    const existingCards = list.querySelectorAll(".download-card");
    const activeKeysSet = new Set(filteredKeys);
    existingCards.forEach((card) => {
      const cardKey = card.getAttribute("data-id");
      if (!activeKeysSet.has(cardKey)) {
        card.remove();
      }
    });

    filteredKeys.forEach((key) => {
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
                <button class="dl-action-btn btn-cancel" title="${t('dl_action_stop')}" data-id="${key}">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  <span>${t('dl_action_stop')}</span>
                </button>
              </div>
            </div>

            <div class="dl-progress-section">
              <div class="dl-progress-bar-track">
                <div class="dl-progress-bar-fill" style="width: ${percent}%;"></div>
              </div>
            </div>

            <div class="download-footer-row">
              <div class="dl-meta-left">
                <span class="meta-speed">${speedMb} МБ/с</span>
                <span class="meta-info">${downloadedMb} MB / ${totalMb} MB</span>
              </div>
              <div class="dl-meta-right">
                <span class="meta-percent">${percent}%</span>
                <span class="meta-eta">${d.status}</span>
              </div>
            </div>
          </div>
        `;

        const cancelBtn = card.querySelector(".btn-cancel");
        if (cancelBtn) {
          cancelBtn.onclick = () => {
            if (d.req) d.req.destroy();
            delete activeDownloads[key];
            renderDownloadsTab();
          };
        }

        list.appendChild(card);
      } else {
        const progressFill = card.querySelector(".dl-progress-bar-fill");
        const metaSpeed = card.querySelector(".meta-speed");
        const metaInfo = card.querySelector(".meta-info");
        const metaPercent = card.querySelector(".meta-percent");
        const metaEta = card.querySelector(".meta-eta");

        if (progressFill) progressFill.style.width = `${percent}%`;
        if (metaSpeed) metaSpeed.textContent = `${speedMb} МБ/с`;
        if (metaInfo) metaInfo.textContent = `${downloadedMb} MB / ${totalMb} MB`;
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
      const v = typeof AutoUpdater !== "undefined" ? AutoUpdater.getCurrentVersion() : "0.3.1";
      const cleanV = String(v || "0.3.1").replace(/^v/i, "").trim();
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
        ...currentSettings,
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
        usefulMods: currentSettings.usefulMods || [],
        favoriteAuthors: currentSettings.favoriteAuthors || [],
      };
      fs.writeFileSync(
        settingsFilePath,
        JSON.stringify(currentSettings, null, 4),
      );
    };

    const initFeaturesTab = () => {
      const listContainer = document.getElementById("features-mods-list");

      if (!Array.isArray(currentSettings.usefulMods)) {
        currentSettings.usefulMods = [];
      }

      const getModInstallStatus = (mod) => {
        if (!currentSettings.xxmiPath || !fs.existsSync(currentSettings.xxmiPath)) {
          return { installed: false, active: false, folderName: null, variations: [], activeVariation: null };
        }

        const modsDir = path.join(currentSettings.xxmiPath, "Mods");
        const dismodsDir = path.join(currentSettings.xxmiPath, "dismods");
        const modvarsDir = path.join(currentSettings.xxmiPath, "modvars");
        const modIdStr = String(mod.id || mod._idRow || "");
        const modNameLower = String(mod.name || mod._sName || "").trim().toLowerCase();

        let dowlinksLower = {};
        try {
          const parsed = modManager.getDowlinks();
          for (const [k, v] of Object.entries(parsed)) {
            dowlinksLower[k.trim().toLowerCase()] = String(v);
          }
        } catch (e) { }

        const checkDir = (dirPath) => {
          if (!fs.existsSync(dirPath)) return null;
          try {
            const items = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const it of items) {
              if (it.isDirectory() && !it.name.startsWith(".") && it.name !== "__MACOSX") {
                const nameLower = it.name.trim().toLowerCase();
                const normName = nameLower.replace(/[^a-z0-9]/gi, "");
                const normMod = modNameLower.replace(/[^a-z0-9]/gi, "");
                if (normMod && normName && (normName === normMod || (normMod.length >= 4 && normName.startsWith(normMod)))) {
                  return it.name;
                }
                const link = dowlinksLower[nameLower];
                if (link && modIdStr) {
                  const m = link.match(/(?:mods\/)?(\d+)/i);
                  if (m && m[1] === modIdStr) return it.name;
                }
              }
            }
          } catch (e) { }
          return null;
        };

        const activeFolder = checkDir(modsDir);
        const inactiveFolder = checkDir(dismodsDir);
        let folderName = activeFolder || inactiveFolder;
        let isInstalled = !!folderName;
        let isActive = !!activeFolder;

        if (!folderName) {
          const modvarFolder = checkDir(modvarsDir);
          if (modvarFolder) {
            folderName = modvarFolder;
            isInstalled = true;
            isActive = false;
          }
        }

        let variations = [];
        let activeVariation = null;
        let activeOptions = [];
        if (folderName) {
          const modvarsModPath = path.join(modvarsDir, folderName);
          if (fs.existsSync(modvarsModPath)) {
            try {
              const varEntries = fs.readdirSync(modvarsModPath, { withFileTypes: true });
              variations = varEntries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => e.name);
              let hasActiveOptsFile = false;
              const activeOptsFile = path.join(modvarsModPath, ".active_options");
              if (fs.existsSync(activeOptsFile)) {
                try {
                  const parsed = JSON.parse(fs.readFileSync(activeOptsFile, "utf-8"));
                  if (Array.isArray(parsed)) {
                    activeOptions = parsed;
                    hasActiveOptsFile = true;
                  }
                } catch (e) { }
              }
              const activeVarFile = path.join(modvarsModPath, ".active_var");
              if (fs.existsSync(activeVarFile)) {
                activeVariation = fs.readFileSync(activeVarFile, "utf-8").trim();
              }
              if (!hasActiveOptsFile) {
                if (activeVariation) {
                  activeOptions = [activeVariation];
                } else if (variations.length > 0) {
                  activeOptions = [variations[0]];
                }
              }
              if (!activeVariation && variations.length > 0) {
                activeVariation = activeOptions[0] || variations[0];
              }
            } catch (e) { }
          }
        }

        return {
          installed: isInstalled,
          active: isActive,
          folderName: folderName,
          variations: variations,
          activeVariation: activeVariation,
          activeOptions: activeOptions
        };
      };

      const fetchModInfoFromGB = async (mod) => {
        let modId = mod.id || mod._idRow;
        if (!modId && (mod.profileUrl || mod._sProfileUrl)) {
          const m = String(mod.profileUrl || mod._sProfileUrl).match(/(?:mods\/)(\d+)/i);
          if (m) modId = m[1];
        }
        if (!modId) return null;
        try {
          let pData = gbProfileCache.get(Number(modId));
          if (!pData) {
            const res = await fetch(`https://gamebanana.com/apiv11/Mod/${modId}/ProfilePage`);
            if (res.ok) {
              const json = await res.json();
              if (json && !json._sErrorCode) {
                pData = json;
                gbProfileCache.set(Number(modId), pData);
              }
            }
          }
          if (pData) {
            return {
              author: pData._aSubmitter?._sName || null,
              submitter: pData._aSubmitter || null,
              name: pData._sName || null,
              previewMedia: pData._aPreviewMedia || null
            };
          }
        } catch (e) { }
        return null;
      };

      const renderFeaturesList = () => {
        if (!listContainer) return;
        const list = (currentSettings.usefulMods || []).slice().sort((a, b) => {
          const nameA = String(a.name || a._sName || "").toLowerCase();
          const nameB = String(b.name || b._sName || "").toLowerCase();
          return nameA.localeCompare(nameB, undefined, { sensitivity: "base" });
        });

        if (list.length === 0) {
          listContainer.innerHTML = `<div class="features-empty-state">${t("features_empty_title")}</div>`;
          return;
        }

        listContainer.innerHTML = "";

        list.forEach((mod) => {
          const row = document.createElement("div");
          row.className = "feature-item-row";

          const previewImg = mod.previewUrl || mod._sPreviewUrl || "";
          const bgStyle = previewImg ? `background-image: url('${encodeURI(previewImg).replace(/'/g, "%27")}');` : "";
          const author = mod.submitterName || mod._aSubmitter?._sName || "GameBanana";
          const title = mod.name || mod._sName || `Mod #${mod.id || mod._idRow}`;
          const rawDesc = mod.description || mod._sDescription || mod._sText || "";
          const plainDesc = htmlToPlainText(rawDesc) || t("gb_desc_empty");
          const installStatus = getModInstallStatus(mod);

          let statusBadgeHtml = "";
          let controlsHtml = "";

          if (!installStatus.installed) {
            statusBadgeHtml = `<span class="feature-status-badge not-installed"><span class="feature-status-badge-dot"></span>${t('features_status_not_installed')}</span>`;
            controlsHtml = `
              <button type="button" class="btn-primary feature-btn-download">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                <span>${t('features_btn_download')}</span>
              </button>
              <button type="button" class="btn-secondary feature-btn-view" title="${t('features_view_btn')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
            `;
          } else if (installStatus.active) {
            statusBadgeHtml = `<span class="feature-status-badge active"><span class="feature-status-badge-dot"></span>${t('features_status_active')}</span>`;
            controlsHtml = `
              <label class="toggle-switch" title="${t('features_btn_disable')}">
                <input type="checkbox" class="feature-toggle-checkbox" checked>
                <span class="toggle-slider"></span>
              </label>
              <button type="button" class="btn-secondary feature-btn-view" title="${t('features_view_btn')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button type="button" class="feature-btn-delete-item" title="${t('features_btn_delete_disk')}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            `;
          } else {
            statusBadgeHtml = `<span class="feature-status-badge inactive"><span class="feature-status-badge-dot"></span>${t('features_status_inactive')}</span>`;
            controlsHtml = `
              <label class="toggle-switch" title="${t('features_btn_enable')}">
                <input type="checkbox" class="feature-toggle-checkbox">
                <span class="toggle-slider"></span>
              </label>
              <button type="button" class="btn-secondary feature-btn-view" title="${t('features_view_btn')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <button type="button" class="feature-btn-delete-item" title="${t('features_btn_delete_disk')}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2-2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            `;
          }

          let optionsHtml = "";
          if (installStatus.installed && installStatus.variations.length > 1) {
            optionsHtml = `
              <div class="feature-options-row">
                <span class="feature-options-label">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1.51 1 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  <span>${t('features_options')}:</span>
                </span>
                <div class="feature-options-list">
                  ${installStatus.variations.map((vName) => {
                    const isChecked = installStatus.activeOptions.includes(vName);
                    return `
                      <label class="feature-option-checkbox-label" title="${vName}">
                        <input type="checkbox" class="feature-option-checkbox" data-var="${encodeURIComponent(vName)}" ${isChecked ? "checked" : ""}>
                        <span class="feature-option-checkbox-custom"></span>
                        <span class="feature-option-text">${vName}</span>
                      </label>
                    `;
                  }).join("")}
                </div>
              </div>
            `;
          }

          row.innerHTML = `
            <div class="feature-item-thumb" style="${bgStyle}">
              <div class="feature-item-view-overlay" title="${t('features_view_btn')}">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </div>
            </div>
            <div class="feature-item-info">
              <div class="feature-item-title-row">
                <span class="feature-item-title">${title}</span>
                ${statusBadgeHtml}
              </div>
              <div class="feature-item-desc">${plainDesc}</div>
              <div class="feature-item-meta">
                <span class="feature-item-author">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                  <span>${author}</span>
                </span>
              </div>
              ${optionsHtml}
            </div>
            <div class="feature-item-controls">
              ${controlsHtml}
            </div>
          `;

          const authorSpan = row.querySelector(".feature-item-author span");
          fetchModInfoFromGB(mod).then((info) => {
            if (info && info.author) {
              mod.author = info.author;
              mod.submitterName = info.author;
              if (info.submitter) mod._aSubmitter = info.submitter;
              if (authorSpan) authorSpan.textContent = info.author;
            }
          });

          row.querySelectorAll(".feature-option-checkbox").forEach((cb) => {
            cb.onchange = (e) => {
              e.stopPropagation();
              if (installStatus.folderName) {
                const checkedBoxes = row.querySelectorAll(".feature-option-checkbox:checked");
                const selected = Array.from(checkedBoxes).map((el) => decodeURIComponent(el.dataset.var));
                modManager.setModActiveOptions(currentSettings.xxmiPath, installStatus.folderName, selected);
                installStatus.activeOptions = selected;
              }
            };
          });

          const openModalAction = () => {
            const modId = mod.id || mod._idRow;
            let previewMedia = mod._aPreviewMedia;
            if (!previewMedia && mod.previewUrl) {
              const lastSlash = mod.previewUrl.lastIndexOf("/");
              if (lastSlash !== -1) {
                previewMedia = {
                  _aImages: [{
                    _sBaseUrl: mod.previewUrl.substring(0, lastSlash),
                    _sFile: mod.previewUrl.substring(lastSlash + 1)
                  }]
                };
              }
            }
            const modObj = {
              _idRow: modId,
              _sName: mod.name || mod._sName,
              _sProfileUrl: mod.profileUrl || mod._sProfileUrl || `https://gamebanana.com/mods/${modId}`,
              _aPreviewMedia: previewMedia,
              _aSubmitter: mod._aSubmitter || (mod.author ? { _sName: mod.author } : null),
              _sDescription: mod.description || mod._sDescription || "",
            };
            openGBModal(modObj);
          };

          const thumbEl = row.querySelector(".feature-item-thumb");
          if (thumbEl) {
            thumbEl.onclick = openModalAction;
          }

          const viewBtn = row.querySelector(".feature-btn-view");
          if (viewBtn) {
            viewBtn.onclick = openModalAction;
          }

          const downloadBtn = row.querySelector(".feature-btn-download");
          if (downloadBtn) {
            downloadBtn.onclick = openModalAction;
          }

          const toggleCheckbox = row.querySelector(".feature-toggle-checkbox");
          if (toggleCheckbox && installStatus.folderName) {
            toggleCheckbox.onchange = (e) => {
              const newActive = toggleCheckbox.checked;
              const success = modManager.toggleMod(
                currentSettings.xxmiPath,
                installStatus.folderName,
                installStatus.active
              );
              if (success) {
                installStatus.active = newActive;
                const badgeEl = row.querySelector(".feature-status-badge");
                if (badgeEl) {
                  badgeEl.className = `feature-status-badge ${newActive ? "active" : "inactive"}`;
                  badgeEl.innerHTML = `<span class="feature-status-badge-dot"></span>${newActive ? t("features_status_active") : t("features_status_inactive")}`;
                }
                const lbl = toggleCheckbox.closest("label");
                if (lbl) {
                  lbl.title = newActive ? t("features_btn_disable") : t("features_btn_enable");
                }
              } else {
                toggleCheckbox.checked = !newActive;
              }
            };
          }

          const deleteBtn = row.querySelector(".feature-btn-delete-item");
          if (deleteBtn && installStatus.folderName) {
            deleteBtn.onclick = (e) => {
              e.stopPropagation();
              const confirmMsg = t("features_delete_confirm", { name: title });
              customConfirm(confirmMsg, () => {
                modManager.deleteMod(currentSettings.xxmiPath, installStatus.folderName, installStatus.active);
                renderFeaturesList();
              });
            };
          }

          listContainer.appendChild(row);
        });
      };

      renderFeaturesList();
    };

    initFeaturesTab();

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

  const initDragAndDrop = () => {
    let dragCounter = 0;
    const overlay = document.getElementById("dnd-overlay");

    const getFilePath = (file) => {
      if (!file) return null;
      if (typeof webUtils !== "undefined" && webUtils && typeof webUtils.getPathForFile === "function") {
        try {
          const p = webUtils.getPathForFile(file);
          if (p) return p;
        } catch (err) { }
      }
      if (file.path) return file.path;
      return null;
    };

    window.addEventListener("dragenter", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter++;
      if (overlay) {
        overlay.classList.add("active");
      }
    });

    window.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      if (overlay && !overlay.classList.contains("active")) {
        overlay.classList.add("active");
      }
    });

    window.addEventListener("dragleave", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (overlay) {
          overlay.classList.remove("active");
        }
      }
    });

    window.addEventListener("dragend", () => {
      dragCounter = 0;
      if (overlay) {
        overlay.classList.remove("active");
      }
    });

    window.addEventListener("drop", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter = 0;
      if (overlay) {
        overlay.classList.remove("active");
      }

      const dt = e.dataTransfer;
      if (!dt) return;

      let rawFiles = [];
      if (dt.items && dt.items.length > 0) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i];
          if (item.kind === "file") {
            const f = item.getAsFile();
            if (f) rawFiles.push(f);
          }
        }
      }
      if (rawFiles.length === 0 && dt.files && dt.files.length > 0) {
        rawFiles = Array.from(dt.files);
      }
      if (rawFiles.length === 0) return;

      const filePaths = rawFiles
        .map((f) => getFilePath(f))
        .filter((p) => p && typeof p === "string");

      const validPaths = filePaths.filter((p) => {
        if (!fs.existsSync(p)) return false;
        return ArchiveExtractor.isArchiveFile(p) || fs.statSync(p).isDirectory();
      });

      if (validPaths.length === 0) {
        if (window.Toast) {
          window.Toast.warning(t("dnd_unsupported_archive"));
        }
        return;
      }

      if (!currentSettings || !currentSettings.xxmiPath) {
        if (window.Toast) {
          window.Toast.warning(t("dl_need_path"));
        }
        return;
      }

      const xxmiPath = currentSettings.xxmiPath;
      let installedCount = 0;

      for (const srcPath of validPaths) {
        let baseName = path.basename(srcPath);
        for (const ext of ArchiveExtractor.ARCHIVE_EXTENSIONS) {
          if (baseName.toLowerCase().endsWith(ext)) {
            baseName = baseName.slice(0, -ext.length);
            break;
          }
        }
        let safeModFolder = baseName.replace(/[<>:"/\\|?*]+/g, "").trim();
        if (!safeModFolder) safeModFolder = "Mod_" + Date.now();

        const modsDir = path.join(xxmiPath, "Mods");
        const dismodsDir = path.join(xxmiPath, "dismods");
        const modvarsDir = path.join(xxmiPath, "modvars");
        const targetModFolder = path.join(modsDir, safeModFolder);
        const dismodFolder = path.join(dismodsDir, safeModFolder);
        const modvarsModFolder = path.join(modvarsDir, safeModFolder);
        const tempExtractDir = path.join(xxmiPath, ".temp_dnd_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7));

        try {
          if (!fs.existsSync(modsDir)) {
            fs.mkdirSync(modsDir, { recursive: true });
          }

          const isDir = fs.statSync(srcPath).isDirectory();

          if (isDir) {
            if (!fs.existsSync(tempExtractDir)) {
              fs.mkdirSync(tempExtractDir, { recursive: true });
            }
            fs.cpSync(srcPath, tempExtractDir, { recursive: true, force: true });
          } else {
            if (!fs.existsSync(tempExtractDir)) {
              fs.mkdirSync(tempExtractDir, { recursive: true });
            }
            await ArchiveExtractor.extractArchive(srcPath, tempExtractDir);
            await ArchiveExtractor.extractRecursively(tempExtractDir);
          }

          modManager.flattenDirectory(tempExtractDir);
          modManager.cleanSystemFiles(tempExtractDir);

          if (!ArchiveExtractor.hasExtractedFiles(tempExtractDir)) {
            throw new Error(t("dl_unpack_err"));
          }

          if (fs.existsSync(dismodFolder)) {
            try {
              fs.rmSync(dismodFolder, { recursive: true, force: true });
            } catch (err) { }
          }

          if (fs.existsSync(targetModFolder)) {
            try {
              fs.rmSync(targetModFolder, { recursive: true, force: true });
            } catch (err) { }
          }

          try {
            fs.renameSync(tempExtractDir, targetModFolder);
          } catch (renameErr) {
            fs.cpSync(tempExtractDir, targetModFolder, { recursive: true, force: true });
            try {
              fs.rmSync(tempExtractDir, { recursive: true, force: true });
            } catch (rmErr) { }
          }

          const detected = modManager.detectCharacter(
            safeModFolder,
            [targetModFolder, modvarsModFolder],
            currentSettings.language || "ru"
          );

          modManager.setModMetadata(
            safeModFolder,
            {
              name: safeModFolder,
              character: detected.character,
              characterId: detected.characterId,
              category: detected.category,
              author: null,
            },
            [targetModFolder, modvarsModFolder]
          );

          installedCount++;
          if (window.Toast) {
            window.Toast.success(t("dnd_install_success", { name: safeModFolder }));
          }
        } catch (err) {
          if (window.Toast) {
            window.Toast.error(t("dnd_install_error", { name: safeModFolder, error: err.message || err }));
          }
        } finally {
          if (fs.existsSync(tempExtractDir)) {
            try {
              fs.rmSync(tempExtractDir, { recursive: true, force: true });
            } catch (cleanupErr) { }
          }
        }
      }

      if (installedCount > 0) {
        const activePage = document.querySelector(".sidebar-item.active");
        if (activePage && activePage.dataset.page === "installed") {
          renderModsGrid();
          if (installedFilterDrawer) {
            installedFilterDrawer.render();
          }
        }
      }
    });
  };

  initDragAndDrop();

  let appInitialized = false;
  const startAppInit = () => {
    if (appInitialized) return;
    appInitialized = true;

    if (!currentSettings.skipSplashScreen && typeof SplashManager !== "undefined") {
      SplashManager.setProgress(45, t("splash_status_init"));
    }

    const downloadTabPromise = preloadDownloadTab();

    const catalogPromise = SideMenuDownload.fetchAndCacheCatalog()
      .then(() => {
        modManager.loadCatalog(true);
        if (!currentSettings.skipSplashScreen && typeof SplashManager !== "undefined") {
          SplashManager.setProgress(70, t("splash_status_mods"));
        }
      })
      .catch(() => { });

    Promise.all([catalogPromise, downloadTabPromise, loadPage("installed")]).then(() => {
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
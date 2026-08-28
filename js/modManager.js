const fs = require("fs");
const path = require("path");
const os = require("os");

function cleanSystemFiles(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (
        entry.name === "__MACOSX" ||
        entry.name === ".DS_Store" ||
        entry.name === "Thumbs.db"
      ) {
        try {
          fs.rmSync(fullPath, { recursive: true, force: true });
        } catch (e) { }
      } else if (entry.isDirectory()) {
        cleanSystemFiles(fullPath);
      }
    }
  } catch (e) { }
}

function isDocOrMediaDir(dirName) {
  const lower = dirName.toLowerCase();
  return [
    "screenshots",
    "screenshot",
    "images",
    "image",
    "previews",
    "preview",
    "docs",
    "doc",
    "pictures",
    "picture",
    "pics",
    "pic",
    "__macosx",
  ].includes(lower);
}

function containsModFiles(folderPath) {
  if (!fs.existsSync(folderPath)) return false;
  try {
    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if ([".ini", ".buf", ".dds", ".ib", ".vb", ".hlsl"].includes(ext)) {
          return true;
        }
      }
    }
  } catch (e) { }
  return false;
}

function flattenDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  cleanSystemFiles(dirPath);

  let maxDepth = 6;
  while (maxDepth > 0) {
    maxDepth--;
    try {
      const allEntries = fs.readdirSync(dirPath, { withFileTypes: true });
      const dirs = allEntries.filter((e) => e.isDirectory());
      const potentialModDirs = dirs.filter((d) => !isDocOrMediaDir(d.name));
      const rootHasModFiles = containsModFiles(dirPath);

      let targetSubDir = null;

      if (!rootHasModFiles) {
        if (potentialModDirs.length === 1) {
          targetSubDir = potentialModDirs[0].name;
        } else if (dirs.length === 1) {
          targetSubDir = dirs[0].name;
        } else {
          const dirsWithModFiles = dirs.filter((d) =>
            containsModFiles(path.join(dirPath, d.name)),
          );
          if (dirsWithModFiles.length === 1) {
            targetSubDir = dirsWithModFiles[0].name;
          }
        }
      } else {
        break;
      }

      if (targetSubDir) {
        const subDirPath = path.join(dirPath, targetSubDir);
        const subEntries = fs.readdirSync(subDirPath);

        for (const item of subEntries) {
          const src = path.join(subDirPath, item);
          const dest = path.join(dirPath, item);
          if (fs.existsSync(dest)) {
            try {
              fs.rmSync(dest, { recursive: true, force: true });
            } catch (e) { }
          }
          fs.renameSync(src, dest);
        }
        try {
          fs.rmdirSync(subDirPath);
        } catch (e) {
          fs.rmSync(subDirPath, { recursive: true, force: true });
        }
      } else {
        break;
      }
    } catch (e) {
      break;
    }
  }
}

class ModManager {
  constructor() {
    this.configDir = require("./platform").getConfigDir();
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
    this.dowlinksPath = path.join(this.configDir, "dowlinks.json");
    this.modmetaPath = path.join(this.configDir, "modmeta.json");
    this.cacheDir = path.join(this.configDir, "cache");
    this.iconsDir = path.join(this.cacheDir, "icons");
    this.subcatsCacheFile = path.join(this.cacheDir, "subcategories.json");

    this.rootCategories = [];
    this.characters = [];
    this.bangboo = [];
    this.charactersI18n = {};
    this._catalogLoaded = false;
    this._modmetaCache = null;
    this._modmetaMtime = 0;
    this._dowlinksCache = null;
    this._dowlinksMtime = 0;
    this._keybindsMemoryCache = new Map();
    this.loadCatalog();
  }

  flattenDirectory(dirPath) {
    flattenDirectory(dirPath);
  }

  cleanSystemFiles(dirPath) {
    cleanSystemFiles(dirPath);
  }

  loadCatalog(force = false) {
    if (this._catalogLoaded && !force) return;
    try {
      const i18nPath = path.join(__dirname, "..", "locales", "characters.json");
      if (fs.existsSync(i18nPath)) {
        this.charactersI18n = JSON.parse(fs.readFileSync(i18nPath, "utf-8"));
      }
    } catch (e) { }

    try {
      if (fs.existsSync(this.subcatsCacheFile)) {
        const cached = JSON.parse(fs.readFileSync(this.subcatsCacheFile, "utf-8"));
        if (cached) {
          if (cached.rootCategories && Array.isArray(cached.rootCategories)) {
            this.rootCategories = cached.rootCategories;
          }
          if (cached.characters && Array.isArray(cached.characters)) {
            this.characters = cached.characters;
          }
          if (cached.bangboo && Array.isArray(cached.bangboo)) {
            this.bangboo = cached.bangboo;
          }
        }
      }

      this._catalogLoaded = true;
    } catch (e) { }
  }

  getLocalizedCharacterName(engName, lang = "ru") {
    if (!engName) return "";
    if (this.charactersI18n[lang] && this.charactersI18n[lang][engName]) {
      return this.charactersI18n[lang][engName];
    }
    return engName;
  }

  getCharacterIconPath(iconUrl) {
    if (!iconUrl || typeof iconUrl !== "string") return null;
    const cleanUrl = iconUrl.split("?")[0];
    const fileName = path.basename(cleanUrl) || "icon.png";
    const localPath = path.join(this.iconsDir, fileName);
    if (fs.existsSync(localPath) && fs.statSync(localPath).size > 100) {
      return `file://${localPath.replace(/\\/g, "/")}`;
    }
    return iconUrl;
  }

  getAvailableCharactersAndCategories(lang = "ru") {
    const list = [];
    const charList = Array.isArray(this.characters) ? this.characters : [];
    const booList = Array.isArray(this.bangboo) ? this.bangboo : [];

    charList.forEach((c) => {
      list.push({
        id: c.id,
        name: c.name,
        localizedName: this.getLocalizedCharacterName(c.name, lang),
        category: "Character Skins",
        iconUrl: this.getCharacterIconPath(c.iconUrl),
        isBangboo: false,
      });
    });

    booList.forEach((b) => {
      list.push({
        id: b.id,
        name: b.name,
        localizedName: this.getLocalizedCharacterName(b.name, lang),
        category: "Bangboo Skins",
        iconUrl: this.getCharacterIconPath(b.iconUrl),
        isBangboo: true,
      });
    });

    const serviceCategories = (this.rootCategories || []).filter(
      (rc) => rc.name !== "Character Skins" && rc.name !== "Bangboo Skins"
    );

    serviceCategories.forEach((cat) => {
      list.push({
        id: cat.id,
        name: cat.name,
        localizedName: this.getLocalizedCharacterName(cat.name, lang),
        category: cat.name === "Character UI" || cat.name === "UI" ? "UI" : "Other/Misc",
        iconUrl: cat.iconUrl ? this.getCharacterIconPath(cat.iconUrl) : null,
        isOther: cat.name === "Other/Misc" || cat.name === "UI",
      });
    });

    return list;
  }

  getDowlinks() {
    try {
      if (fs.existsSync(this.dowlinksPath)) {
        const stat = fs.statSync(this.dowlinksPath);
        if (this._dowlinksCache && this._dowlinksMtime === stat.mtimeMs) {
          return this._dowlinksCache;
        }
        this._dowlinksCache = JSON.parse(fs.readFileSync(this.dowlinksPath, "utf-8"));
        this._dowlinksMtime = stat.mtimeMs;
        return this._dowlinksCache;
      } else {
        fs.writeFileSync(this.dowlinksPath, JSON.stringify({}, null, 4), "utf-8");
        this._dowlinksCache = {};
        return {};
      }
    } catch (e) {
      return this._dowlinksCache || {};
    }
  }

  getAllModMetadata() {
    try {
      if (fs.existsSync(this.modmetaPath)) {
        const stat = fs.statSync(this.modmetaPath);
        if (this._modmetaCache && this._modmetaMtime === stat.mtimeMs) {
          return this._modmetaCache;
        }
        this._modmetaCache = JSON.parse(fs.readFileSync(this.modmetaPath, "utf-8"));
        this._modmetaMtime = stat.mtimeMs;
        return this._modmetaCache;
      } else {
        fs.writeFileSync(this.modmetaPath, JSON.stringify({}, null, 4), "utf-8");
        this._modmetaCache = {};
        return {};
      }
    } catch (e) {
      return this._modmetaCache || {};
    }
  }

  getModMetadata(modName, modFolderPaths = []) {
    const allMeta = this.getAllModMetadata();
    const key = (modName || "").trim().toLowerCase();
    if (allMeta[key]) {
      return allMeta[key];
    }

    for (const folder of modFolderPaths) {
      if (!folder || !fs.existsSync(folder)) continue;
      const metaFile = path.join(folder, "modmeta.json");
      if (fs.existsSync(metaFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(metaFile, "utf-8"));
          if (data && (data.character || data.characterId)) {
            allMeta[key] = data;
            fs.writeFileSync(this.modmetaPath, JSON.stringify(allMeta, null, 4), "utf-8");
            return data;
          }
        } catch (e) { }
      }
    }
    return null;
  }

  setModMetadata(modName, metadata, modFolderPaths = []) {
    if (!modName || !metadata) return false;
    const key = modName.trim().toLowerCase();
    const allMeta = this.getAllModMetadata();
    allMeta[key] = {
      ...(allMeta[key] || {}),
      ...metadata,
      updatedAt: Date.now(),
    };

    try {
      fs.writeFileSync(this.modmetaPath, JSON.stringify(allMeta, null, 4), "utf-8");
    } catch (e) { }

    for (const folder of modFolderPaths) {
      if (folder && fs.existsSync(folder)) {
        try {
          fs.writeFileSync(
            path.join(folder, "modmeta.json"),
            JSON.stringify(allMeta[key], null, 2),
            "utf-8",
          );
        } catch (e) { }
      }
    }
    return true;
  }

  detectCharacter(modName, modFolderPaths = [], lang = "ru") {

    const saved = this.getModMetadata(modName, modFolderPaths);
    if (saved && (saved.character || saved.characterId)) {
      const charName = saved.character || "Other";
      const locName = this.getLocalizedCharacterName(charName, lang);
      const foundChar = this.characters.find(
        (c) => c.name.toLowerCase() === charName.toLowerCase() || c.id === saved.characterId,
      ) || this.bangboo.find(
        (b) => b.name.toLowerCase() === charName.toLowerCase() || b.id === saved.characterId,
      );

      return {
        character: charName,
        characterLocalized: locName,
        characterId: saved.characterId || (foundChar ? foundChar.id : null),
        category: saved.category || (foundChar ? (this.bangboo.some(b => b.id === foundChar.id) ? "Bangboo Skins" : "Character Skins") : "Other/Misc"),
        iconUrl: foundChar ? this.getCharacterIconPath(foundChar.iconUrl) : null,
      };
    }


    let textToScan = [modName];

    for (const folder of modFolderPaths) {
      if (!folder || !fs.existsSync(folder)) continue;
      try {
        const entries = fs.readdirSync(folder, { withFileTypes: true });
        for (const entry of entries) {
          textToScan.push(entry.name);
          if (entry.isDirectory()) {
            try {
              const subEntries = fs.readdirSync(path.join(folder, entry.name));
              textToScan.push(...subEntries);
            } catch (e) { }
          }
          if (entry.isFile() && (entry.name.toLowerCase() === "description.txt" || entry.name.toLowerCase() === "readme.txt")) {
            try {
              const desc = fs.readFileSync(path.join(folder, entry.name), "utf-8");
              textToScan.push(desc.substring(0, 1500));
            } catch (e) { }
          }
        }
      } catch (e) { }
    }

    const fullScanText = textToScan.join(" ").toLowerCase();


    const candidates = [];

    const serviceCategories = (this.rootCategories || []).filter(
      (rc) => rc.name !== "Character Skins"
    );

    for (const rc of serviceCategories) {
      const names = new Set([rc.name.trim().toLowerCase()]);
      for (const l of Object.keys(this.charactersI18n || {})) {
        const loc = this.charactersI18n[l]?.[rc.name];
        if (loc) names.add(loc.trim().toLowerCase());
      }
      if (rc.name === "Character UI") {
        names.add("char ui");
      } else if (rc.name === "Icons") {
        names.add("icon");
        names.add("иконка");
      } else if (rc.name === "Bangboo Skins") {
        names.add("bangboo");
        names.add("банбу");
      }
      candidates.push({
        target: rc.name === "Bangboo Skins" ? "Bangboo" : rc.name,
        category: rc.name === "Bangboo Skins" ? "Bangboo Skins" : (rc.name === "Character UI" || rc.name === "UI" ? "UI" : "Other/Misc"),
        charId: rc.id,
        iconUrl: rc.iconUrl,
        names: Array.from(names),
      });
    }

    const allEntities = [
      ...this.characters.map((c) => ({ item: c, isBangboo: false })),
      ...this.bangboo.map((b) => ({ item: b, isBangboo: true })),
    ];

    for (const { item, isBangboo } of allEntities) {
      if (!item || !item.name) continue;
      const names = new Set();
      const rawName = item.name.trim().toLowerCase();
      names.add(rawName);

      rawName.split(/\s+/).forEach((part) => {
        if (part.length >= 3) names.add(part);
      });

      for (const l of Object.keys(this.charactersI18n || {})) {
        const loc = this.charactersI18n[l]?.[item.name];
        if (loc) {
          const locLower = loc.trim().toLowerCase();
          names.add(locLower);
          locLower.split(/\s+/).forEach((part) => {
            if (part.length >= 3) names.add(part);
          });
        }
      }

      candidates.push({
        target: item.name,
        category: isBangboo ? "Bangboo Skins" : "Character Skins",
        charId: item.id || null,
        iconUrl: this.getCharacterIconPath(item.iconUrl),
        names: Array.from(names),
      });
    }

    const searchEntries = [];
    for (const candidate of candidates) {
      for (const name of candidate.names) {
        if (name && name.length >= 2) {
          searchEntries.push({ name, candidate });
        }
      }
    }

    searchEntries.sort((a, b) => b.name.length - a.name.length);

    for (const entry of searchEntries) {
      const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`(^|[^a-z0-9а-яё])${escaped}([^a-z0-9а-яё]|$)`, "i");
      if (regex.test(fullScanText)) {
        const candidate = entry.candidate;
        const locName = this.getLocalizedCharacterName(candidate.target, lang);
        const metaResult = {
          character: candidate.target,
          characterLocalized: locName,
          characterId: candidate.charId,
          category: candidate.category,
          iconUrl: candidate.iconUrl,
        };

        this.setModMetadata(modName, metaResult, modFolderPaths);
        return metaResult;
      }
    }


    const defaultMeta = {
      character: "Other",
      characterLocalized: this.getLocalizedCharacterName("Other", lang) || (lang === "ru" ? "Прочее" : "Other"),
      characterId: null,
      category: "Other/Misc",
      iconUrl: null,
    };
    this.setModMetadata(modName, defaultMeta, modFolderPaths);
    return defaultMeta;
  }

  getMods(xxmiPath, filter = "all", searchQuery = "", characterFilter = "all", currentLang = "ru") {
    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { validPath: false, totalCount: 0, characters: [], mods: [] };
    }

    this.loadCatalog();

    const modsDir = path.join(xxmiPath, "Mods");
    const dismodsDir = path.join(xxmiPath, "dismods");
    const modvarsDir = path.join(xxmiPath, "modvars");

    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    if (!fs.existsSync(dismodsDir))
      fs.mkdirSync(dismodsDir, { recursive: true });
    if (!fs.existsSync(modvarsDir))
      fs.mkdirSync(modvarsDir, { recursive: true });

    let dowlinksLower = {};
    const parsedDowlinks = this.getDowlinks();
    for (const [key, value] of Object.entries(parsedDowlinks)) {
      dowlinksLower[key.trim().toLowerCase()] = value;
    }

    const allDiscoveredMods = [];
    let totalCount = 0;
    const cleanSearch = searchQuery.trim().toLowerCase();
    const processedMods = new Set();

    const findPreviewUrl = (folderPath) => {
      if (!fs.existsSync(folderPath)) return null;
      const previewFiles = [
        "preview.jpg",
        "preview.jpeg",
        "preview.png",
        "preview.webp",
      ];
      for (const pName of previewFiles) {
        const pPath = path.join(folderPath, pName);
        if (fs.existsSync(pPath)) {
          return `file://${pPath.replace(/\\/g, "/")}`;
        }
      }
      return null;
    };

    const findDescription = (folderPath) => {
      if (!fs.existsSync(folderPath)) return null;
      try {
        const txtFiles = fs
          .readdirSync(folderPath)
          .filter((f) => f.toLowerCase().endsWith(".txt"));
        if (txtFiles.length > 0) {
          const prefTxt =
            txtFiles.find(
              (f) =>
                f.toLowerCase() === "description.txt" ||
                f.toLowerCase() === "readme.txt",
            ) || txtFiles[0];
          const txtPath = path.join(folderPath, prefTxt);
          return fs.readFileSync(txtPath, "utf-8");
        }
      } catch (e) { }
      return null;
    };

    const scanDirectory = (dirPath, isActive) => {
      if (!fs.existsSync(dirPath)) return;
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      items.forEach((item) => {
        if (item.isDirectory()) {
          totalCount++;
          processedMods.add(item.name);

          const modPath = path.join(dirPath, item.name);
          const modvarsModPath = path.join(modvarsDir, item.name);


          let variations = [];
          let activeVariation = null;


          if (fs.existsSync(modvarsModPath)) {
            try {
              const varEntries = fs.readdirSync(modvarsModPath, {
                withFileTypes: true,
              });

              variations = varEntries
                .filter((e) => e.isDirectory())
                .map((e) => e.name);

              const activeVarFile = path.join(modvarsModPath, ".active_var");
              if (fs.existsSync(activeVarFile)) {
                try {
                  activeVariation = fs
                    .readFileSync(activeVarFile, "utf-8")
                    .trim();
                } catch (e) { }
              }
              if (!activeVariation || !variations.includes(activeVariation)) {
                activeVariation = variations.length > 0 ? variations[0] : null;
              }
            } catch (e) { }
          }

          let previewUrl = findPreviewUrl(modPath);
          let descriptionText = findDescription(modPath);

          if (!previewUrl && fs.existsSync(modvarsModPath)) {
            if (activeVariation) {
              previewUrl = findPreviewUrl(
                path.join(modvarsModPath, activeVariation),
              );
            }
            if (!previewUrl) {
              previewUrl = findPreviewUrl(modvarsModPath);
            }
            if (!previewUrl && variations.length > 0) {
              for (const v of variations) {
                previewUrl = findPreviewUrl(path.join(modvarsModPath, v));
                if (previewUrl) break;
              }
            }
            if (previewUrl && fs.existsSync(modPath)) {
              try {
                const srcPath = previewUrl.replace(/^file:\/\//, "");
                const destPath = path.join(modPath, path.basename(srcPath));
                if (!fs.existsSync(destPath)) {
                  fs.copyFileSync(srcPath, destPath);
                }
              } catch (e) { }
            }
          }

          const safeFolderName = item.name.trim().toLowerCase();
          const folderPaths = [modPath, modvarsModPath];

          const charInfo = this.detectCharacter(item.name, folderPaths, currentLang);
          const savedMeta = this.getModMetadata(item.name, folderPaths);
          const nsfwRegex = /\b(nsfw|18\+|nude|nudity|porn|sex|boobs|tits|ass|thicc|thick|naked|lewd)\b/i;
          const detectedNsfw = nsfwRegex.test(item.name + " " + (descriptionText || "") + " " + (charInfo.category || ""));
          const isNsfw = savedMeta && typeof savedMeta.nsfw === "boolean" ? savedMeta.nsfw : detectedNsfw;

          allDiscoveredMods.push({
            name: item.name,
            active: isActive,
            previewUrl: previewUrl,
            description: descriptionText,
            sourceUrl: dowlinksLower[safeFolderName] || null,
            variations: variations,
            activeVariation: activeVariation,
            hasVariations: variations.length > 1,
            character: charInfo.character,
            characterLocalized: charInfo.characterLocalized,
            characterId: charInfo.characterId,
            category: charInfo.category,
            iconUrl: charInfo.iconUrl,
            nsfw: isNsfw,
            paths: folderPaths,
          });
        }
      });
    };

    scanDirectory(modsDir, true);
    scanDirectory(dismodsDir, false);

    if (fs.existsSync(modvarsDir)) {
      try {
        const modvarsEntries = fs.readdirSync(modvarsDir, {
          withFileTypes: true,
        });
        for (const mEntry of modvarsEntries) {
          if (mEntry.isDirectory() && !processedMods.has(mEntry.name)) {
            const modvarsModPath = path.join(modvarsDir, mEntry.name);
            const varEntries = fs
              .readdirSync(modvarsModPath, { withFileTypes: true })
              .filter((e) => e.isDirectory());

            if (varEntries.length > 0) {
              const firstVar = varEntries[0].name;
              const targetDismods = path.join(dismodsDir, mEntry.name);
              try {
                fs.mkdirSync(targetDismods, { recursive: true });
                fs.cpSync(
                  path.join(modvarsModPath, firstVar),
                  targetDismods,
                  { recursive: true, force: true },
                );
                flattenDirectory(targetDismods);
                fs.writeFileSync(
                  path.join(modvarsModPath, ".active_var"),
                  firstVar,
                  "utf-8",
                );

                totalCount++;
                const variations = varEntries.map((e) => e.name);
                const previewUrl =
                  findPreviewUrl(targetDismods) ||
                  findPreviewUrl(path.join(modvarsModPath, firstVar));
                const descriptionText =
                  findDescription(targetDismods) ||
                  findDescription(path.join(modvarsModPath, firstVar));
                const safeFolderName = mEntry.name.trim().toLowerCase();
                const folderPaths = [targetDismods, modvarsModPath];

                const charInfo = this.detectCharacter(mEntry.name, folderPaths, currentLang);
                const savedMeta = this.getModMetadata(mEntry.name, folderPaths);
                const nsfwRegex = /\b(nsfw|18\+|nude|nudity|porn|sex|boobs|tits|ass|thicc|thick|naked|lewd)\b/i;
                const detectedNsfw = nsfwRegex.test(mEntry.name + " " + (descriptionText || "") + " " + (charInfo.category || ""));
                const isNsfw = savedMeta && typeof savedMeta.nsfw === "boolean" ? savedMeta.nsfw : detectedNsfw;

                allDiscoveredMods.push({
                  name: mEntry.name,
                  active: false,
                  previewUrl: previewUrl,
                  description: descriptionText,
                  sourceUrl: dowlinksLower[safeFolderName] || null,
                  variations: variations,
                  activeVariation: firstVar,
                  hasVariations: variations.length > 1,
                  character: charInfo.character,
                  characterLocalized: charInfo.characterLocalized,
                  characterId: charInfo.characterId,
                  category: charInfo.category,
                  iconUrl: charInfo.iconUrl,
                  nsfw: isNsfw,
                  paths: folderPaths,
                });
              } catch (e) { }
            }
          }
        }
      } catch (e) { }
    }


    const charCountMap = new Map();
    allDiscoveredMods.forEach((m) => {
      const charKey = m.character || "Other";
      const existing = charCountMap.get(charKey);
      if (existing) {
        existing.count++;
      } else {
        charCountMap.set(charKey, {
          name: charKey,
          localizedName: m.characterLocalized || this.getLocalizedCharacterName(charKey, currentLang),
          id: m.characterId || null,
          category: m.category || "Character Skins",
          iconUrl: m.iconUrl || null,
          count: 1,
        });
      }
    });

    const charactersList = Array.from(charCountMap.values()).sort((a, b) => {
      if (a.name === "Other") return 1;
      if (b.name === "Other") return -1;
      return a.localizedName.localeCompare(b.localizedName);
    });


    const cleanCharFilter = (characterFilter || "all").toString().trim().toLowerCase();

    const filteredMods = allDiscoveredMods.filter((mod) => {
      if (filter === "active" && !mod.active) return false;
      if (filter === "inactive" && mod.active) return false;

      if (cleanSearch) {
        const inName = mod.name.toLowerCase().includes(cleanSearch);
        const inChar = (mod.character && mod.character.toLowerCase().includes(cleanSearch)) ||
          (mod.characterLocalized && mod.characterLocalized.toLowerCase().includes(cleanSearch));
        if (!inName && !inChar) return false;
      }

      if (cleanCharFilter !== "all" && cleanCharFilter !== "") {
        const modCharLower = (mod.character || "").toLowerCase();
        const modIdStr = mod.characterId ? String(mod.characterId) : "";
        if (modCharLower !== cleanCharFilter && modIdStr !== cleanCharFilter) {
          return false;
        }
      }

      return true;
    });

    filteredMods.sort((a, b) => a.name.localeCompare(b.name));

    return {
      validPath: true,
      totalCount,
      characters: charactersList,
      mods: filteredMods,
    };
  }

  switchModVariation(xxmiPath, modName, targetVariationName) {
    if (!xxmiPath || !modName || !targetVariationName) return false;
    const modvarsDir = path.join(xxmiPath, "modvars", modName);
    const srcVarDir = path.join(modvarsDir, targetVariationName);
    if (!fs.existsSync(srcVarDir)) return false;

    const modsDir = path.join(xxmiPath, "Mods", modName);
    const dismodsDir = path.join(xxmiPath, "dismods", modName);

    const isActive = fs.existsSync(modsDir);
    const isInactive = fs.existsSync(dismodsDir);

    const targetDir = isActive ? modsDir : isInactive ? dismodsDir : modsDir;

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetDir, { recursive: true });
      fs.cpSync(srcVarDir, targetDir, { recursive: true, force: true });
      flattenDirectory(targetDir);

      try {
        fs.writeFileSync(
          path.join(modvarsDir, ".active_var"),
          targetVariationName,
          "utf-8",
        );
      } catch (e) { }


      const meta = this.getModMetadata(modName, [modvarsDir]);
      if (meta) {
        this.setModMetadata(modName, meta, [targetDir, modvarsDir]);
      }

      return true;
    } catch (e) {
      console.error(`Ошибка при смене вариации мода ${modName}:`, e);
      return false;
    }
  }

  deleteModVariation(xxmiPath, modName, variationName, currentState) {
    if (!xxmiPath || !modName || !variationName)
      return { success: false, remainingCount: 0 };
    const modvarsDir = path.join(xxmiPath, "modvars", modName);
    const varPath = path.join(modvarsDir, variationName);

    try {
      if (fs.existsSync(varPath)) {
        fs.rmSync(varPath, { recursive: true, force: true });
      }

      let remaining = [];
      if (fs.existsSync(modvarsDir)) {
        remaining = fs
          .readdirSync(modvarsDir, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      }

      if (remaining.length === 0) {
        if (fs.existsSync(modvarsDir)) {
          fs.rmSync(modvarsDir, { recursive: true, force: true });
        }
        const targetDir = path.join(
          xxmiPath,
          currentState ? "Mods" : "dismods",
          modName,
        );
        if (fs.existsSync(targetDir)) {
          fs.rmSync(targetDir, { recursive: true, force: true });
        }
        const altDir = path.join(
          xxmiPath,
          currentState ? "dismods" : "Mods",
          modName,
        );
        if (fs.existsSync(altDir)) {
          fs.rmSync(altDir, { recursive: true, force: true });
        }
        return { success: true, remainingCount: 0 };
      } else {
        let activeVar = null;
        const activeVarFile = path.join(modvarsDir, ".active_var");
        if (fs.existsSync(activeVarFile)) {
          try {
            activeVar = fs.readFileSync(activeVarFile, "utf-8").trim();
          } catch (e) { }
        }

        if (
          activeVar === variationName ||
          !activeVar ||
          !remaining.includes(activeVar)
        ) {
          const newActive = remaining[0];
          this.switchModVariation(xxmiPath, modName, newActive);
        }
        return {
          success: true,
          remainingCount: remaining.length,
          newActiveVar: remaining[0],
        };
      }
    } catch (e) {
      console.error(
        `Ошибка при удалении вариации ${variationName} мода ${modName}:`,
        e,
      );
      return { success: false, remainingCount: -1 };
    }
  }

  toggleMod(xxmiPath, modName, currentState) {
    if (!xxmiPath) return false;

    const sourceDir = currentState
      ? path.join(xxmiPath, "Mods")
      : path.join(xxmiPath, "dismods");
    const targetDir = currentState
      ? path.join(xxmiPath, "dismods")
      : path.join(xxmiPath, "Mods");

    const sourcePath = path.join(sourceDir, modName);
    const targetPath = path.join(targetDir, modName);

    try {
      if (fs.existsSync(sourcePath)) {
        fs.renameSync(sourcePath, targetPath);
        return true;
      }
    } catch (e) {
      console.error(`Ошибка при перемещении мода ${modName}:`, e);
    }
    return false;
  }

  deleteMod(xxmiPath, modName, currentState) {
    if (!xxmiPath) return false;

    const targetDir = path.join(
      xxmiPath,
      currentState ? "Mods" : "dismods",
      modName,
    );
    const altDir = path.join(
      xxmiPath,
      currentState ? "dismods" : "Mods",
      modName,
    );
    const modvarsDir = path.join(xxmiPath, "modvars", modName);

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      if (fs.existsSync(altDir)) {
        fs.rmSync(altDir, { recursive: true, force: true });
      }
      if (fs.existsSync(modvarsDir)) {
        fs.rmSync(modvarsDir, { recursive: true, force: true });
      }
      return true;
    } catch (e) {
      console.error(`Ошибка при удалении мода ${modName}:`, e);
    }
    return false;
  }

  isModDownloaded(xxmiPath, modId) {
    try {
      const dowlinks = this.getDowlinks();
      const urlToCheck = `https://gamebanana.com/mods/${modId}`;
      const downloadedFolders = Object.keys(dowlinks).filter(
        (key) => dowlinks[key] === urlToCheck,
      );

      if (downloadedFolders.length === 0) return false;
      if (!xxmiPath) return false;

      for (const folder of downloadedFolders) {
        if (
          fs.existsSync(path.join(xxmiPath, "Mods", folder)) ||
          fs.existsSync(path.join(xxmiPath, "dismods", folder)) ||
          fs.existsSync(path.join(xxmiPath, "modvars", folder))
        ) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  formatKeyCap(rawKey) {
    if (!rawKey) return [];
    const parts = rawKey
      .split(/[\s+]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0 && !s.startsWith("no_"));

    const keyMap = {
      vk_up: "↑",
      vk_down: "↓",
      vk_left: "←",
      vk_right: "→",
      vk_space: "Space",
      space: "Space",
      vk_tab: "Tab",
      tab: "Tab",
      vk_return: "Enter",
      enter: "Enter",
      return: "Enter",
      vk_escape: "Esc",
      esc: "Esc",
      vk_back: "Backspace",
      backspace: "Backspace",
      vk_delete: "Del",
      delete: "Del",
      del: "Del",
      vk_insert: "Ins",
      insert: "Ins",
      vk_home: "Home",
      home: "Home",
      vk_end: "End",
      end: "End",
      vk_prior: "PgUp",
      pageup: "PgUp",
      vk_next: "PgDn",
      pagedown: "PgDn",
      ctrl: "Ctrl",
      control: "Ctrl",
      shift: "Shift",
      alt: "Alt",
      lshift: "LShift",
      rshift: "RShift",
      lctrl: "LCtrl",
      rctrl: "RCtrl",
      lalt: "LAlt",
      ralt: "RAlt",
      vk_oem_comma: ",",
      vk_oem_period: ".",
      vk_oem_1: ";",
      vk_oem_2: "/",
      vk_oem_3: "`",
      vk_oem_4: "[",
      vk_oem_5: "\\",
      vk_oem_6: "]",
      vk_oem_7: "'",
      vk_oem_minus: "-",
      vk_oem_plus: "+",
      vk_comma: ",",
      vk_period: ".",
      comma: ",",
      period: ".",
      oem_comma: ",",
      oem_period: ".",
      oem_minus: "-",
      oem_plus: "+",
    };

    const formatted = [];
    for (const p of parts) {
      if (keyMap[p]) {
        formatted.push(keyMap[p]);
      } else if (/^vk_oem_(\w+)$/.test(p)) {
        const sub = p.replace("vk_oem_", "");
        formatted.push(keyMap[sub] || sub.toUpperCase());
      } else if (/^vk_numpad(\d)$/.test(p)) {
        formatted.push(`Num ${p.replace("vk_numpad", "")}`);
      } else if (/^numpad(\d)$/.test(p)) {
        formatted.push(`Num ${p.replace("numpad", "")}`);
      } else if (/^vk_(\w)$/.test(p)) {
        formatted.push(p.replace("vk_", "").toUpperCase());
      } else if (/^f(\d{1,2})$/.test(p)) {
        formatted.push(p.toUpperCase());
      } else {
        formatted.push(p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1));
      }
    }

    return formatted;
  }

  formatSectionName(sectionName, variableName) {
    let clean = (sectionName || "").trim();
    clean = clean.replace(/^\[+|\]+$/g, "");
    clean = clean.replace(/^(key|toggle|hotkey|swap)[_\s-]*/i, "");

    if ((!clean || /^\d+$/i.test(clean) || /^[a-z]$/i.test(clean)) && variableName) {
      clean = variableName.replace(/^\$+/, "").replace(/[_\s-]+/g, " ");
    }

    if (!clean) clean = sectionName || "Keybind";

    clean = clean.replace(/([a-z])([A-Z])/g, "$1 $2");
    clean = clean.replace(/[_-]+/g, " ");
    clean = clean.trim();

    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  extractOptionsFromLines(lines, startIndex, variableValues) {
    for (let j = startIndex + 1; j <= Math.min(startIndex + 4, lines.length - 1); j++) {
      const line = lines[j].trim();
      if (line.startsWith("//") || line.startsWith(";")) {
        const comment = line.replace(/^(\/\/|;)\s*/, "").trim();
        const lower = comment.toLowerCase();
        if (
          !comment ||
          comment.includes("---") ||
          comment.includes("===") ||
          comment.includes("___") ||
          lower.startsWith("condition") ||
          lower.startsWith("key") ||
          lower.startsWith("type") ||
          lower.startsWith("override") ||
          lower.startsWith("texture") ||
          lower.startsWith("constant") ||
          lower.startsWith("resource")
        ) {
          continue;
        }

        if (comment.includes(",")) {
          const opts = comment
            .split(",")
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(
              (s) =>
                s.length > 0 &&
                !s.includes("---") &&
                !s.includes("===") &&
                !s.toLowerCase().startsWith("override"),
            );
          if (opts.length > 0) return opts;
        } else if (comment.includes("/") || comment.includes("|")) {
          const opts = comment
            .split(/[\/|]/)
            .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
            .filter(
              (s) =>
                s.length > 0 &&
                !s.includes("---") &&
                !s.includes("===") &&
                !s.toLowerCase().startsWith("override"),
            );
          if (opts.length > 0) return opts;
        } else {
          return [comment];
        }
      } else if (line.startsWith("[") || (line.includes("=") && !line.startsWith("$"))) {
        break;
      }
    }

    if (variableValues && variableValues.length > 0) {
      if (variableValues.length === 2 && variableValues[0] === "0" && variableValues[1] === "1") {
        return ["Off", "On"];
      }
      return variableValues.map((v) => `#${v}`);
    }

    return [];
  }

  getModDescription(mod) {
    if (!mod) return "";
    const paths = mod.paths || [];
    for (const folder of paths) {
      if (!folder || !fs.existsSync(folder)) continue;
      try {
        const entries = fs.readdirSync(folder, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && (e.name.toLowerCase() === "description.txt" || e.name.toLowerCase() === "readme.txt")) {
            return fs.readFileSync(path.join(folder, e.name), "utf-8");
          }
        }
      } catch (e) { }
    }
    return "";
  }

  getModKeybinds(modName, activeVariation, xxmiPath) {
    if (!modName || !xxmiPath) return [];

    const dirsToScan = [];
    const modvarsModPath = path.join(xxmiPath, "modvars", modName);
    const modsPath = path.join(xxmiPath, "Mods", modName);
    const dismodsPath = path.join(xxmiPath, "dismods", modName);

    if (activeVariation && fs.existsSync(path.join(modvarsModPath, activeVariation))) {
      dirsToScan.push(path.join(modvarsModPath, activeVariation));
    } else if (fs.existsSync(modvarsModPath)) {
      let activeVarName = null;
      try {
        const actVarFile = path.join(modvarsModPath, ".active_var");
        if (fs.existsSync(actVarFile)) {
          activeVarName = fs.readFileSync(actVarFile, "utf-8").trim();
        }
      } catch (e) { }

      if (activeVarName && fs.existsSync(path.join(modvarsModPath, activeVarName))) {
        dirsToScan.push(path.join(modvarsModPath, activeVarName));
      } else {
        try {
          const varEntries = fs
            .readdirSync(modvarsModPath, { withFileTypes: true })
            .filter((e) => e.isDirectory());
          if (varEntries.length > 0) {
            dirsToScan.push(path.join(modvarsModPath, varEntries[0].name));
          } else {
            dirsToScan.push(modvarsModPath);
          }
        } catch (e) {
          dirsToScan.push(modvarsModPath);
        }
      }
    }

    if (fs.existsSync(modsPath)) {
      dirsToScan.push(modsPath);
    }
    if (fs.existsSync(dismodsPath)) {
      dirsToScan.push(dismodsPath);
    }


    let maxMtime = 0;
    for (const d of dirsToScan) {
      try {
        const st = fs.statSync(d);
        if (st.mtimeMs > maxMtime) maxMtime = st.mtimeMs;
      } catch (e) { }
    }

    if (!this._keybindsMemoryCache) {
      this._keybindsMemoryCache = new Map();
    }

    const memoryCacheKey = `${modName}__${activeVariation || ""}__${maxMtime}`;
    if (this._keybindsMemoryCache.has(memoryCacheKey)) {
      return this._keybindsMemoryCache.get(memoryCacheKey);
    }

    const iniFiles = [];
    const seenFiles = new Set();

    const scanForInis = (dir, depth = 0) => {
      if (depth > 2 || !fs.existsSync(dir)) return;
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const e of entries) {
          const fullPath = path.join(dir, e.name);
          if (e.isFile() && e.name.toLowerCase().endsWith(".ini")) {
            const lowerName = e.name.toLowerCase();
            if (
              !lowerName.startsWith("d3dx") &&
              !lowerName.startsWith("desktop") &&
              !seenFiles.has(fullPath)
            ) {
              seenFiles.add(fullPath);
              iniFiles.push(fullPath);
            }
          } else if (e.isDirectory() && !e.name.startsWith(".")) {
            scanForInis(fullPath, depth + 1);
          }
        }
      } catch (err) { }
    };

    for (const d of dirsToScan) {
      scanForInis(d);
    }

    const keybinds = [];
    const seenKeySignatures = new Set();

    for (const iniPath of iniFiles) {
      try {
        const content = fs.readFileSync(iniPath, "utf-8");
        const lines = content.split(/\r?\n/);
        let currentSection = null;
        let currentData = null;

        const finalizeSection = () => {
          if (currentData && currentData.keys && currentData.keys.length > 0) {
            const signature = `${currentData.keys.join("+")}_${currentData.name}_${currentData.variable || ""}`;
            if (!seenKeySignatures.has(signature)) {
              seenKeySignatures.add(signature);
              keybinds.push(currentData);
            }
          }
        };

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          const secMatch = line.match(/^\[([^\]]+)\]/);
          if (secMatch) {
            finalizeSection();
            const secName = secMatch[1].trim();
            currentSection = secName;
            currentData = {
              section: secName,
              name: this.formatSectionName(secName, null),
              rawKey: null,
              keys: [],
              rawBackKey: null,
              backKeys: [],
              type: "cycle",
              variable: null,
              options: [],
              fileName: path.basename(iniPath),
            };
            continue;
          }

          if (!currentData) continue;

          const keyMatch = line.match(/^key\s*=\s*(.+)$/i);
          if (keyMatch) {
            currentData.rawKey = keyMatch[1].trim();
            currentData.keys = this.formatKeyCap(keyMatch[1].trim());
            continue;
          }

          const backMatch = line.match(/^back\s*=\s*(.+)$/i);
          if (backMatch) {
            currentData.rawBackKey = backMatch[1].trim();
            currentData.backKeys = this.formatKeyCap(backMatch[1].trim());
            continue;
          }

          const typeMatch = line.match(/^type\s*=\s*(.+)$/i);
          if (typeMatch) {
            currentData.type = typeMatch[1].trim().toLowerCase();
            continue;
          }

          const varMatch = line.match(/^\$([a-zA-Z0-9_]+)\s*=\s*(.+)$/);
          if (varMatch) {
            currentData.variable = varMatch[1].trim();
            currentData.name = this.formatSectionName(currentSection, varMatch[1].trim());
            const varVals = varMatch[2]
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            currentData.options = this.extractOptionsFromLines(lines, i, varVals);
            continue;
          }
        }

        finalizeSection();
      } catch (err) {
        console.error("Error reading ini file:", iniPath, err);
      }
    }

    this._keybindsMemoryCache.set(memoryCacheKey, keybinds);
    return keybinds;
  }

  addDownloadLink(modName, url) {
    try {
      let dowlinks = this.getDowlinks();
      dowlinks[modName] = url;
      fs.writeFileSync(this.dowlinksPath, JSON.stringify(dowlinks, null, 4));
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = ModManager;

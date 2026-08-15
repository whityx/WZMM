const fs = require("fs");
const path = require("path");
const os = require("os");

class ModManager {
  constructor() {
    const configDir = path.join(os.homedir(), ".config", "wzmm");
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    this.dowlinksPath = path.join(configDir, "dowlinks.json");
  }

  getDowlinks() {
    if (!fs.existsSync(this.dowlinksPath)) {
      fs.writeFileSync(this.dowlinksPath, JSON.stringify({}, null, 4), "utf-8");
      return {};
    }
    try {
      return JSON.parse(fs.readFileSync(this.dowlinksPath, "utf-8"));
    } catch (e) {
      console.error("Ошибка чтения dowlinks.json, файл будет сброшен", e);
      fs.writeFileSync(this.dowlinksPath, JSON.stringify({}, null, 4), "utf-8");
      return {};
    }
  }

  getMods(xxmiPath, filter = "all", searchQuery = "") {
    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { validPath: false, totalCount: 0, mods: [] };
    }

    const modsDir = path.join(xxmiPath, "Mods");
    const dismodsDir = path.join(xxmiPath, "dismods");

    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    if (!fs.existsSync(dismodsDir))
      fs.mkdirSync(dismodsDir, { recursive: true });

    let dowlinksLower = {};
    const parsedDowlinks = this.getDowlinks();
    for (const [key, value] of Object.entries(parsedDowlinks)) {
      dowlinksLower[key.trim().toLowerCase()] = value;
    }

    const modsList = [];
    let totalCount = 0;
    const cleanSearch = searchQuery.trim().toLowerCase();

    const scanDirectory = (dirPath, isActive) => {
      if (!fs.existsSync(dirPath)) return;
      const items = fs.readdirSync(dirPath, { withFileTypes: true });

      items.forEach((item) => {
        if (item.isDirectory()) {
          totalCount++;

          if (filter === "active" && !isActive) return;
          if (filter === "inactive" && isActive) return;

          if (cleanSearch && !item.name.toLowerCase().includes(cleanSearch))
            return;

          const modPath = path.join(dirPath, item.name);
          const previewPath = path.join(modPath, "preview.jpg");
          let descriptionText = null;

          const txtFiles = fs
            .readdirSync(modPath)
            .filter((f) => f.toLowerCase().endsWith(".txt"));
          if (txtFiles.length > 0) {
            try {
              const txtPath = path.join(modPath, txtFiles[0]);
              descriptionText = fs.readFileSync(txtPath, "utf-8");
            } catch (e) {}
          }

          const safeFolderName = item.name.trim().toLowerCase();

          modsList.push({
            name: item.name,
            active: isActive,
            previewUrl: fs.existsSync(previewPath)
              ? `file://${previewPath.replace(/\\/g, "/")}`
              : null,
            description: descriptionText,
            sourceUrl: dowlinksLower[safeFolderName] || null,
          });
        }
      });
    };

    scanDirectory(modsDir, true);
    scanDirectory(dismodsDir, false);

    modsList.sort((a, b) => a.name.localeCompare(b.name));

    return { validPath: true, totalCount, mods: modsList };
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

    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
        return true;
      }
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
          fs.existsSync(path.join(xxmiPath, "dismods", folder))
        ) {
          return true;
        }
      }
      return false;
    } catch (e) {
      return false;
    }
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

const fs = require("fs");
const path = require("path");

class ModManager {
  constructor(settingsPath) {
    this.settingsPath = settingsPath;
    this.dowlinksPath = path.join(path.dirname(settingsPath), "dowlinks.json");
  }

  getXxmiPath() {
    if (fs.existsSync(this.settingsPath)) {
      try {
        const settings = JSON.parse(
          fs.readFileSync(this.settingsPath, "utf-8"),
        );
        return settings.xxmiPath || null;
      } catch (e) {
        console.error("Ошибка чтения settings.json", e);
      }
    }
    return null;
  }

  getMods(filter = "all", searchQuery = "") {
    const xxmiPath = this.getXxmiPath();

    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { validPath: false, totalCount: 0, mods: [] };
    }

    const modsDir = path.join(xxmiPath, "Mods");
    const dismodsDir = path.join(xxmiPath, "dismods");

    if (!fs.existsSync(modsDir)) fs.mkdirSync(modsDir, { recursive: true });
    if (!fs.existsSync(dismodsDir))
      fs.mkdirSync(dismodsDir, { recursive: true });

    let dowlinksLower = {};

    if (fs.existsSync(this.dowlinksPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.dowlinksPath, "utf-8"));
        for (const [key, value] of Object.entries(parsed)) {
          dowlinksLower[key.trim().toLowerCase()] = value;
        }
      } catch (e) {}
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

  toggleMod(modName, currentState) {
    const xxmiPath = this.getXxmiPath();
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

  deleteMod(modName, currentState) {
    const xxmiPath = this.getXxmiPath();
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

  isModDownloaded(modId) {
    if (!fs.existsSync(this.dowlinksPath)) return false;
    try {
      const dowlinks = JSON.parse(fs.readFileSync(this.dowlinksPath, "utf-8"));
      const urlToCheck = `https://gamebanana.com/mods/${modId}`;
      const downloadedFolders = Object.keys(dowlinks).filter(
        (key) => dowlinks[key] === urlToCheck,
      );

      if (downloadedFolders.length === 0) return false;

      const xxmiPath = this.getXxmiPath();
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
    let dowlinks = {};
    if (fs.existsSync(this.dowlinksPath)) {
      try {
        dowlinks = JSON.parse(fs.readFileSync(this.dowlinksPath, "utf-8"));
      } catch (e) {}
    }
    dowlinks[modName] = url;
    try {
      fs.writeFileSync(this.dowlinksPath, JSON.stringify(dowlinks, null, 4));
      return true;
    } catch (e) {
      return false;
    }
  }
}
module.exports = ModManager;

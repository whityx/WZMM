const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

let AdmZip = null;
try {
  AdmZip = require("adm-zip");
} catch (e) {
  console.warn("AdmZip not available:", e.message);
}

const { isLinux } = require("./platform");

let sevenZipBin = null;
let sevenZipPath = null;
try {
  sevenZipBin = require("7zip-bin");
  if (sevenZipBin && sevenZipBin.path7za) {
    sevenZipPath = sevenZipBin.path7za;
    if (fs.existsSync(sevenZipPath)) {
      try {
        if (isLinux) fs.chmodSync(sevenZipPath, 0o755);
      } catch (e) { }
    }
  }
} catch (e) {
  console.warn("7zip-bin not available:", e.message);
}

let unrarJs = null;
try {
  unrarJs = require("node-unrar-js");
} catch (e) {
  console.warn("node-unrar-js not available:", e.message);
}

const ARCHIVE_EXTENSIONS = [
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".tar.gz",
  ".tgz",
  ".tar.bz2",
  ".tbz2",
  ".tar.xz",
  ".txz",
  ".gz",
  ".bz2",
  ".xz",
  ".7z.001",
];

class ArchiveExtractor {
  static get ARCHIVE_EXTENSIONS() {
    return ARCHIVE_EXTENSIONS;
  }

  static isArchiveFile(filePath) {
    if (!filePath || typeof filePath !== "string") return false;
    const lower = filePath.toLowerCase();
    return ARCHIVE_EXTENSIONS.some((ext) => lower.endsWith(ext));
  }

  static getSevenZipPath() {
    if (sevenZipPath && fs.existsSync(sevenZipPath)) {
      try {
        if (isLinux) fs.chmodSync(sevenZipPath, 0o755);
      } catch (e) { }
      return sevenZipPath;
    }
    return null;
  }

  static hasExtractedFiles(targetDir) {
    if (!fs.existsSync(targetDir)) return false;
    try {
      const items = fs.readdirSync(targetDir);
      return items.length > 0;
    } catch (e) {
      return false;
    }
  }

  static async extractZip(archivePath, targetDir) {
    if (AdmZip) {
      try {
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(targetDir, true);
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) {
          return true;
        }
      } catch (e) {
        console.warn("AdmZip extraction failed, trying 7zip fallback:", e.message);
      }
    }

    const p7z = ArchiveExtractor.getSevenZipPath();
    if (p7z) {
      try {
        execSync(`"${p7z}" x "${archivePath}" -o"${targetDir}" -y -aoa -p""`, {
          stdio: "pipe",
        });
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) return true;
      } catch (e) { }
    }

    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }

  static async extractRar(archivePath, targetDir) {
    const p7z = ArchiveExtractor.getSevenZipPath();
    if (p7z) {
      try {
        execSync(`"${p7z}" x "${archivePath}" -o"${targetDir}" -y -aoa -p""`, {
          stdio: "pipe",
        });
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) return true;
      } catch (e) {
        console.warn("7zip-bin rar extraction failed, trying node-unrar:", e.message);
      }
    }

    if (unrarJs && unrarJs.createExtractorFromFile) {
      try {
        const extractor = await unrarJs.createExtractorFromFile({
          filepath: archivePath,
          targetPath: targetDir,
        });
        const extracted = extractor.extract();
        if (extracted && extracted.files) {
          const files = [...extracted.files];
          for (const file of files) {
            if (file.fileHeader && !file.fileHeader.flags.directory && file.extraction) {
              const outPath = path.join(targetDir, file.fileHeader.name);
              const parentDir = path.dirname(outPath);
              if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
              }
              fs.writeFileSync(outPath, Buffer.from(file.extraction));
            }
          }
        }
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) {
          return true;
        }
      } catch (e) {
        console.warn("node-unrar-js extraction failed:", e.message);
      }
    }

    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }

  static async extract7z(archivePath, targetDir) {
    const p7z = ArchiveExtractor.getSevenZipPath();
    if (p7z) {
      try {
        execSync(`"${p7z}" x "${archivePath}" -o"${targetDir}" -y -aoa -p""`, {
          stdio: "pipe",
        });
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) return true;
      } catch (e) {
        console.warn("7zip-bin extraction failed:", e.message);
      }
    }
    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }

  static async extractTar(archivePath, targetDir) {
    const p7z = ArchiveExtractor.getSevenZipPath();
    if (p7z) {
      try {
        execSync(`"${p7z}" x "${archivePath}" -o"${targetDir}" -y -aoa -p""`, {
          stdio: "pipe",
        });
        if (ArchiveExtractor.hasExtractedFiles(targetDir)) return true;
      } catch (e) { }
    }
    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }

  static async extractArchive(archivePath, targetDir) {
    if (!fs.existsSync(archivePath)) {
      throw new Error(`Archive file does not exist: ${archivePath}`);
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const lowerPath = archivePath.toLowerCase();

    if (lowerPath.endsWith(".zip")) {
      await ArchiveExtractor.extractZip(archivePath, targetDir);
    } else if (lowerPath.endsWith(".rar")) {
      await ArchiveExtractor.extractRar(archivePath, targetDir);
    } else if (lowerPath.endsWith(".7z") || lowerPath.endsWith(".7z.001")) {
      await ArchiveExtractor.extract7z(archivePath, targetDir);
    } else if (
      lowerPath.endsWith(".tar") ||
      lowerPath.endsWith(".tar.gz") ||
      lowerPath.endsWith(".tgz") ||
      lowerPath.endsWith(".tar.bz2") ||
      lowerPath.endsWith(".tbz2") ||
      lowerPath.endsWith(".tar.xz") ||
      lowerPath.endsWith(".txz") ||
      lowerPath.endsWith(".gz") ||
      lowerPath.endsWith(".bz2") ||
      lowerPath.endsWith(".xz")
    ) {
      await ArchiveExtractor.extractTar(archivePath, targetDir);
    }

    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }

  static async extractRecursively(targetDir, maxDepth = 4) {
    if (!fs.existsSync(targetDir) || maxDepth <= 0) {
      return ArchiveExtractor.hasExtractedFiles(targetDir);
    }

    const findArchivesInDir = (dir) => {
      let archives = [];
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            archives = archives.concat(findArchivesInDir(fullPath));
          } else if (entry.isFile() && ArchiveExtractor.isArchiveFile(entry.name)) {
            archives.push(fullPath);
          }
        }
      } catch (e) { }
      return archives;
    };

    let passes = 0;
    while (passes < maxDepth) {
      passes++;
      const nestedArchives = findArchivesInDir(targetDir);
      if (nestedArchives.length === 0) break;

      for (const archPath of nestedArchives) {
        const parentDir = path.dirname(archPath);
        try {
          const ok = await ArchiveExtractor.extractArchive(archPath, parentDir);
          if (ok && fs.existsSync(archPath)) {
            try {
              fs.unlinkSync(archPath);
            } catch (e) { }
          }
        } catch (err) {
          console.warn(`Failed to extract nested archive ${archPath}:`, err.message);
        }
      }
    }

    return ArchiveExtractor.hasExtractedFiles(targetDir);
  }
}

module.exports = ArchiveExtractor;

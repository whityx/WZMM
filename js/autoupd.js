(() => {
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { shell } = require('electron');

const AutoUpdater = {
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
  activeRequest: null,
  activeStream: null,
  activeTempPath: null,

  getCurrentVersion() {
    try {
      const { ipcRenderer } = require('electron');
      if (ipcRenderer && typeof ipcRenderer.sendSync === 'function') {
        const v = ipcRenderer.sendSync('get-app-version');
        if (v) return v;
      }
    } catch (_) {}

    try {
      const directPkg = path.join(__dirname, 'package.json');
      if (fs.existsSync(directPkg)) {
        const pkg = JSON.parse(fs.readFileSync(directPkg, 'utf8'));
        if (pkg && pkg.version) return pkg.version;
      }
    } catch (_) {}

    try {
      const pkgPath = path.join(__dirname, '..', 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg && pkg.version) return pkg.version;
      }
    } catch (_) {}

    try {
      const cwdPkg = path.join(process.cwd(), 'package.json');
      if (fs.existsSync(cwdPkg)) {
        const pkg = JSON.parse(fs.readFileSync(cwdPkg, 'utf8'));
        if (pkg && pkg.version) return pkg.version;
      }
    } catch (_) {}

    return '0.2.3';
  },

  compareVersions(v1, v2) {
    const clean1 = String(v1 || '').replace(/^v/i, '').trim();
    const clean2 = String(v2 || '').replace(/^v/i, '').trim();

    const parts1 = clean1.split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = clean2.split('.').map(p => parseInt(p, 10) || 0);

    const maxLen = Math.max(parts1.length, parts2.length);
    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  },

  findAssetForPlatform(assets) {
    if (!Array.isArray(assets) || assets.length === 0) return null;

    if (this.isWindows) {
      const portable = assets.find(a => typeof a.name === 'string' && /portable.*\.exe$/i.test(a.name));
      if (portable) return portable;

      const anyExe = assets.find(a => typeof a.name === 'string' && /\.exe$/i.test(a.name));
      if (anyExe) return anyExe;
    }

    if (this.isLinux) {
      const appImage = assets.find(a => typeof a.name === 'string' && /\.appimage$/i.test(a.name));
      if (appImage) return appImage;

      const linuxArchive = assets.find(a => typeof a.name === 'string' && /(\.tar\.gz|\.tgz|\.deb)$/i.test(a.name));
      if (linuxArchive) return linuxArchive;
    }

    return assets[0] || null;
  },

  checkForUpdates() {
    return new Promise((resolve, reject) => {
      const currentVersion = this.getCurrentVersion();
      const apiUrl = 'https://api.github.com/repos/whityx/WZMM/releases/latest';

      const options = {
        headers: {
          'User-Agent': 'WZMM-Launcher-Updater',
          'Accept': 'application/vnd.github.v3+json'
        }
      };

      const req = https.get(apiUrl, options, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return https.get(res.headers.location, options, (redirRes) => {
            handleResponse(redirRes);
          }).on('error', (err) => reject(err));
        }
        handleResponse(res);
      });

      const handleResponse = (response) => {
        if (response.statusCode !== 200) {
          return reject(new Error('GitHub API HTTP ' + response.statusCode));
        }

        let rawData = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { rawData += chunk; });
        response.on('end', () => {
          try {
            const data = JSON.parse(rawData);
            const latestTag = String(data.tag_name || '').replace(/^v/i, '').trim();
            const hasUpdate = this.compareVersions(latestTag, currentVersion) > 0;
            const matchedAsset = this.findAssetForPlatform(data.assets || []);

            resolve({
              hasUpdate,
              currentVersion,
              latestVersion: latestTag,
              releaseName: data.name || latestTag,
              releaseNotes: data.body || '',
              releaseUrl: data.html_url || 'https://github.com/whityx/WZMM/releases',
              asset: matchedAsset,
              platform: this.isWindows ? 'windows' : (this.isLinux ? 'linux' : 'other')
            });
          } catch (err) {
            reject(err);
          }
        });
      };

      req.on('error', (err) => {
        reject(err);
      });

      req.setTimeout(8000, () => {
        req.destroy();
        reject(new Error('Update check timeout'));
      });
    });
  },

  getDownloadsDir() {
    const userDownloads = path.join(os.homedir(), 'Downloads');
    if (fs.existsSync(userDownloads)) {
      return userDownloads;
    }
    return os.tmpdir();
  },

  downloadUpdate(asset, onProgress) {
    return new Promise((resolve, reject) => {
      if (!asset || !asset.browser_download_url) {
        return reject(new Error('No asset URL provided'));
      }

      const downloadsDir = this.getDownloadsDir();
      const targetPath = path.join(downloadsDir, asset.name);
      const tempPath = targetPath + '.download';
      this.activeTempPath = tempPath;

      const fileStream = fs.createWriteStream(tempPath);
      this.activeStream = fileStream;

      let downloaded = 0;
      let total = asset.size || 0;
      let lastDownloaded = 0;
      let lastTime = Date.now();

      const fetchUrl = (currentUrl) => {
        const client = currentUrl.startsWith('https') ? https : http;
        const req = client.get(currentUrl, {
          headers: {
            'User-Agent': 'WZMM-Launcher-Updater'
          }
        }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            return fetchUrl(res.headers.location);
          }

          if (res.statusCode !== 200) {
            fileStream.close();
            try { fs.unlinkSync(tempPath); } catch (_) {}
            return reject(new Error('HTTP ' + res.statusCode));
          }

          const headerLength = parseInt(res.headers['content-length'], 10);
          if (!isNaN(headerLength) && headerLength > 0) {
            total = headerLength;
          }

          res.on('data', (chunk) => {
            downloaded += chunk.length;
            const now = Date.now();
            const timeDiff = (now - lastTime) / 1000;
            let speed = 0;

            if (timeDiff >= 0.3) {
              speed = (downloaded - lastDownloaded) / timeDiff;
              lastTime = now;
              lastDownloaded = downloaded;
            }

            const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
            const speedMb = (speed / (1024 * 1024)).toFixed(1);

            if (typeof onProgress === 'function') {
              onProgress({
                percent,
                downloaded,
                total,
                speed,
                formattedSpeed: `${speedMb} MB/s`,
                filePath: targetPath
              });
            }
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close(() => {
              this.activeStream = null;
              this.activeRequest = null;
              try {
                if (fs.existsSync(targetPath)) {
                  fs.unlinkSync(targetPath);
                }
                fs.renameSync(tempPath, targetPath);
                this.activeTempPath = null;

                if (this.isLinux) {
                  try {
                    fs.chmodSync(targetPath, 0o755);
                  } catch (_) {}
                }

                resolve(targetPath);
              } catch (renameErr) {
                reject(renameErr);
              }
            });
          });
        });

        this.activeRequest = req;

        req.on('error', (err) => {
          fileStream.close();
          try { fs.unlinkSync(tempPath); } catch (_) {}
          this.activeStream = null;
          this.activeRequest = null;
          this.activeTempPath = null;
          reject(err);
        });
      };

      fetchUrl(asset.browser_download_url);
    });
  },

  cancelDownload() {
    if (this.activeRequest) {
      try { this.activeRequest.destroy(); } catch (_) {}
      this.activeRequest = null;
    }
    if (this.activeStream) {
      try { this.activeStream.close(); } catch (_) {}
      this.activeStream = null;
    }
    if (this.activeTempPath) {
      try { fs.unlinkSync(this.activeTempPath); } catch (_) {}
      this.activeTempPath = null;
    }
  },

  checkDownloadedFile(asset) {
    if (!asset || !asset.name) return null;
    try {
      const downloadsDir = this.getDownloadsDir();
      const targetPath = path.join(downloadsDir, asset.name);
      if (fs.existsSync(targetPath)) {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          if (!asset.size || stat.size === asset.size || (stat.size > 0 && Math.abs(stat.size - asset.size) < 2048)) {
            return targetPath;
          }
        }
      }
    } catch (_) {}
    return null;
  },

  openFolder(filePath) {
    if (!filePath) return;
    try {
      let targetDir = filePath;
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath);
        if (!stat.isDirectory()) {
          targetDir = path.dirname(filePath);
        }
      } else {
        targetDir = path.dirname(filePath);
      }
      shell.openPath(targetDir).then((err) => {
        if (err && this.isLinux) {
          const { spawn } = require('child_process');
          spawn('xdg-open', [targetDir], { detached: true });
        }
      }).catch(() => {
        if (this.isLinux) {
          const { spawn } = require('child_process');
          spawn('xdg-open', [targetDir], { detached: true });
        }
      });
    } catch (_) {}
  },

  showInFolder(filePath) {
    this.openFolder(filePath);
  },

  openReleasePage(url) {
    try {
      shell.openExternal(url || 'https://github.com/whityx/WZMM/releases');
    } catch (_) {}
  },

  formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  },

  escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },

  renderMarkdown(md) {
    if (!md) return '';
    let html = String(md).replace(/\r\n/g, '\n');

    const codeBlocks = [];
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
      const idx = codeBlocks.length;
      codeBlocks.push('<pre class="wzmm-release-pre"><code>' + this.escapeHtml(code.trim()) + '</code></pre>');
      return '@@@CODEBLOCK' + idx + '@@@';
    });

    const inlineCodes = [];
    html = html.replace(/`([^`\n]+)`/g, (match, code) => {
      const idx = inlineCodes.length;
      inlineCodes.push('<code class="wzmm-release-code">' + this.escapeHtml(code) + '</code>');
      return '@@@INLINECODE' + idx + '@@@';
    });

    const formatInline = (str) => {
      str = str.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" class="wzmm-release-link" target="_blank">$1</a>');
      str = str.replace(/(^|[\s(])(https?:\/\/[^\s)<]+)/g, '$1<a href="$2" class="wzmm-release-link" target="_blank">$2</a>');
      str = str.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
      str = str.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      str = str.replace(/__([^_]+)__/g, '<strong>$1</strong>');
      str = str.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      str = str.replace(/(^|\s)_([^_]+)_(\s|$)/g, '$1<em>$2</em>$3');
      str = str.replace(/~~([^~]+)~~/g, '<del>$1</del>');
      str = str.replace(/(^|\s)@([a-zA-Z0-9_-]+)/g, '$1<a href="https://github.com/$2" class="wzmm-release-link" target="_blank">@$2</a>');
      return str;
    };

    const lines = html.split('\n');
    const result = [];
    let inList = false;
    let listType = 'ul';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (!trimmed) {
        if (inList) {
          result.push('</' + listType + '>');
          inList = false;
        }
        continue;
      }

      if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
        if (inList) { result.push('</' + listType + '>'); inList = false; }
        result.push('<hr class="wzmm-release-hr">');
        continue;
      }

      const hMatch = line.match(/^(\s{0,3})(#{1,6})\s+(.*)$/);
      if (hMatch) {
        if (inList) { result.push('</' + listType + '>'); inList = false; }
        const level = hMatch[2].length;
        result.push('<h' + level + ' class="wzmm-release-h wzmm-release-h' + level + '">' + formatInline(this.escapeHtml(hMatch[3])) + '</h' + level + '>');
        continue;
      }

      if (trimmed.startsWith('>')) {
        if (inList) { result.push('</' + listType + '>'); inList = false; }
        const qText = trimmed.replace(/^>\s*/, '');
        result.push('<blockquote class="wzmm-release-quote">' + formatInline(this.escapeHtml(qText)) + '</blockquote>');
        continue;
      }

      const ulMatch = line.match(/^(\s{0,3})[*\-+]\s+(.*)$/);
      if (ulMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) result.push('</' + listType + '>');
          result.push('<ul class="wzmm-release-list">');
          inList = true;
          listType = 'ul';
        }
        result.push('<li>' + formatInline(this.escapeHtml(ulMatch[2])) + '</li>');
        continue;
      }

      const olMatch = line.match(/^(\s{0,3})\d+\.\s+(.*)$/);
      if (olMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) result.push('</' + listType + '>');
          result.push('<ol class="wzmm-release-list">');
          inList = true;
          listType = 'ol';
        }
        result.push('<li>' + formatInline(this.escapeHtml(olMatch[2])) + '</li>');
        continue;
      }

      if (inList) {
        result.push('</' + listType + '>');
        inList = false;
      }
      result.push('<p>' + formatInline(this.escapeHtml(line)) + '</p>');
    }

    if (inList) {
      result.push('</' + listType + '>');
    }

    let finalHtml = result.join('');
    finalHtml = finalHtml.replace(/@@@CODEBLOCK(\d+)@@@/g, (_, id) => codeBlocks[Number(id)] || '');
    finalHtml = finalHtml.replace(/@@@INLINECODE(\d+)@@@/g, (_, id) => inlineCodes[Number(id)] || '');
    return finalHtml;
  },

  showUpdateModal(updateInfo, onDismiss, isBlocking = false) {
    let overlay = document.getElementById('wzmm-update-modal-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'wzmm-update-modal-overlay';
      overlay.className = 'wzmm-update-overlay';
      document.body.appendChild(overlay);
    }

    const tFunc = typeof t === 'function' ? t : (k) => k;
    const platformLabel = this.isWindows
      ? 'Windows (.exe)'
      : (this.isLinux ? 'Linux (.AppImage)' : 'Unknown OS');

    const existingFile = this.checkDownloadedFile(updateInfo.asset);
    let downloadedFilePath = existingFile || null;

    const rawNotes = updateInfo.releaseNotes || '';
    const formattedNotes = this.renderMarkdown(rawNotes);
    const subtitleText = existingFile ? tFunc('update_modal_already_downloaded') : tFunc('update_modal_available');

    overlay.innerHTML = `
      <div class="wzmm-update-card">
        <div class="wzmm-update-header">
          <div class="wzmm-update-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </div>
          <div class="wzmm-update-title-wrap">
            <h3 class="wzmm-update-title">${tFunc('update_modal_title')}</h3>
            <div class="wzmm-update-subtitle">${subtitleText}</div>
          </div>
        </div>

        <div class="wzmm-update-badges">
          <div class="wzmm-update-badge">
            <span class="wzmm-update-badge-label">${tFunc('update_modal_current')}:</span>
            <span class="wzmm-update-badge-val">v${this.escapeHtml(updateInfo.currentVersion)}</span>
          </div>
          <div class="wzmm-update-badge-arrow">→</div>
          <div class="wzmm-update-badge active">
            <span class="wzmm-update-badge-label">${tFunc('update_modal_latest')}:</span>
            <span class="wzmm-update-badge-val">v${this.escapeHtml(updateInfo.latestVersion)}</span>
          </div>
          <div class="wzmm-update-badge-platform">
            ${platformLabel}
          </div>
        </div>

        ${rawNotes ? `
          <div class="wzmm-update-notes-title">${tFunc('update_modal_notes')}</div>
          <div class="wzmm-update-notes">${formattedNotes}</div>
        ` : ''}

        <div id="wzmm-update-progress-area" class="wzmm-update-progress-area" style="display: none;">
          <div class="wzmm-update-progress-header">
            <span id="wzmm-update-status-text" class="wzmm-update-status-text">${tFunc('update_modal_downloading')}</span>
            <span id="wzmm-update-percent-text" class="wzmm-update-percent-text">0%</span>
          </div>
          <div class="wzmm-update-progress-track">
            <div id="wzmm-update-progress-fill" class="wzmm-update-progress-fill"></div>
          </div>
          <div class="wzmm-update-progress-meta">
            <span id="wzmm-update-bytes-text">0 / 0 MB</span>
            <span id="wzmm-update-speed-text">0 MB/s</span>
          </div>
        </div>

        <div id="wzmm-update-actions" class="wzmm-update-actions" style="${existingFile ? 'display: none;' : 'display: flex;'}">
          <button id="wzmm-btn-update-download" class="wzmm-btn-primary">
            ${tFunc('update_modal_btn_download')}
          </button>
          <button id="wzmm-btn-update-release" class="wzmm-btn-secondary">
            ${tFunc('update_modal_btn_release')}
          </button>
          ${!isBlocking ? `
            <button id="wzmm-btn-update-later" class="wzmm-btn-ghost">
              ${tFunc('update_modal_btn_later')}
            </button>
          ` : ''}
        </div>

        <div id="wzmm-update-completed-wrap" class="wzmm-update-completed-wrap" style="${existingFile ? 'display: flex;' : 'display: none;'}">
          <div class="wzmm-update-path-info">
            <span class="wzmm-update-path-label">${tFunc('update_modal_saved_to')}</span>
            <span id="wzmm-update-path-val" class="wzmm-update-path-value" style="cursor: pointer;">${existingFile ? this.escapeHtml(path.dirname(existingFile)) : ''}</span>
          </div>
          <div id="wzmm-update-completed-actions" class="wzmm-update-actions">
            <button id="wzmm-btn-update-folder" class="wzmm-btn-primary">
              ${tFunc('update_modal_btn_folder')}
            </button>
            <button id="wzmm-btn-update-redownload" class="wzmm-btn-secondary">
              ${tFunc('update_modal_btn_redownload')}
            </button>
            <button id="wzmm-btn-update-close" class="wzmm-btn-ghost">
              ${tFunc('update_modal_btn_close_app')}
            </button>
          </div>
        </div>
      </div>
    `;

    overlay.classList.add('active');

    const closeModal = () => {
      overlay.classList.remove('active');
      if (typeof onDismiss === 'function') {
        onDismiss();
      }
    };

    const btnLater = overlay.querySelector('#wzmm-btn-update-later');
    const btnRelease = overlay.querySelector('#wzmm-btn-update-release');
    const btnDownload = overlay.querySelector('#wzmm-btn-update-download');
    const btnFolder = overlay.querySelector('#wzmm-btn-update-folder');
    const btnRedownload = overlay.querySelector('#wzmm-btn-update-redownload');
    const btnClose = overlay.querySelector('#wzmm-btn-update-close');

    const actionsArea = overlay.querySelector('#wzmm-update-actions');
    const progressArea = overlay.querySelector('#wzmm-update-progress-area');
    const completedWrap = overlay.querySelector('#wzmm-update-completed-wrap');
    const pathVal = overlay.querySelector('#wzmm-update-path-val');
    const progressFill = overlay.querySelector('#wzmm-update-progress-fill');
    const percentText = overlay.querySelector('#wzmm-update-percent-text');
    const statusText = overlay.querySelector('#wzmm-update-status-text');
    const bytesText = overlay.querySelector('#wzmm-update-bytes-text');
    const speedText = overlay.querySelector('#wzmm-update-speed-text');

    if (existingFile && pathVal) {
      pathVal.title = existingFile;
    }

    if (pathVal) {
      pathVal.addEventListener('click', () => {
        if (downloadedFilePath) {
          this.openFolder(downloadedFilePath);
        }
      });
    }

    const notesEl = overlay.querySelector('.wzmm-update-notes');
    if (notesEl) {
      notesEl.addEventListener('click', (e) => {
        const link = e.target.closest('a');
        if (link && link.href) {
          e.preventDefault();
          this.openReleasePage(link.href);
        }
      });
    }

    if (btnLater) btnLater.addEventListener('click', closeModal);

    if (btnClose) {
      btnClose.addEventListener('click', () => {
        if (isBlocking) {
          const { app } = require('electron').remote || require('electron');
          if (app && typeof app.quit === 'function') {
            app.quit();
          } else {
            window.close();
          }
        } else {
          closeModal();
        }
      });
    }

    if (btnRelease) {
      btnRelease.addEventListener('click', () => {
        this.openReleasePage(updateInfo.releaseUrl);
      });
    }

    if (btnRedownload) {
      btnRedownload.addEventListener('click', () => {
        completedWrap.style.display = 'none';
        actionsArea.style.display = 'flex';
        btnDownload.click();
      });
    }

    if (btnDownload) {
      btnDownload.addEventListener('click', () => {
        if (!updateInfo.asset) {
          this.openReleasePage(updateInfo.releaseUrl);
          if (!isBlocking) closeModal();
          return;
        }

        actionsArea.style.display = 'none';
        progressArea.style.display = 'flex';

        this.downloadUpdate(updateInfo.asset, (prog) => {
          if (progressFill) progressFill.style.width = `${prog.percent}%`;
          if (percentText) percentText.textContent = `${prog.percent}%`;
          if (bytesText) {
            bytesText.textContent = `${this.formatBytes(prog.downloaded)} / ${this.formatBytes(prog.total)}`;
          }
          if (speedText) speedText.textContent = prog.formattedSpeed;
        }).then((savedPath) => {
          downloadedFilePath = savedPath;
          if (statusText) statusText.textContent = tFunc('update_modal_completed');
          if (progressFill) progressFill.style.width = '100%';
          if (percentText) percentText.textContent = '100%';
          if (pathVal) {
            const dir = path.dirname(savedPath);
            pathVal.textContent = dir;
            pathVal.title = savedPath;
            pathVal.style.cursor = 'pointer';
          }

          progressArea.style.display = 'none';
          if (completedWrap) completedWrap.style.display = 'flex';
        }).catch((err) => {
          progressArea.style.display = 'none';
          actionsArea.style.display = 'flex';
          if (typeof window.Toast !== 'undefined') {
            window.Toast.error(tFunc('update_modal_download_err', { error: err.message || err }));
          }
        });
      });
    }

    if (btnFolder) {
      btnFolder.addEventListener('click', () => {
        if (downloadedFilePath) {
          this.openFolder(downloadedFilePath);
        }
      });
    }
  }
};

if (typeof window !== 'undefined') {
  window.AutoUpdater = AutoUpdater;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AutoUpdater;
}
})();

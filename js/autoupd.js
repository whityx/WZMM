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

  openDownloadedFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      shell.openPath(filePath);
    } catch (_) {}
  },

  showInFolder(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return;
    try {
      shell.showItemInFolder(filePath);
    } catch (_) {}
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
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
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

    const rawNotes = updateInfo.releaseNotes || '';
    const formattedNotes = this.escapeHtml(rawNotes).replace(/\r?\n/g, '<br>');

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
            <div class="wzmm-update-subtitle">${tFunc('update_modal_available')}</div>
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

        <div id="wzmm-update-actions" class="wzmm-update-actions">
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

        <div id="wzmm-update-completed-wrap" class="wzmm-update-completed-wrap" style="display: none;">
          <div class="wzmm-update-path-info">
            <span class="wzmm-update-path-label">${tFunc('update_modal_saved_to')}</span>
            <span id="wzmm-update-path-val" class="wzmm-update-path-value"></span>
          </div>
          <div id="wzmm-update-completed-actions" class="wzmm-update-actions">
            <button id="wzmm-btn-update-folder" class="wzmm-btn-primary">
              ${tFunc('update_modal_btn_folder')}
            </button>
            <button id="wzmm-btn-update-launch" class="wzmm-btn-secondary">
              ${tFunc('update_modal_btn_launch')}
            </button>
            <button id="wzmm-btn-update-close" class="wzmm-btn-ghost">
              ${tFunc('update_modal_btn_close_app')}
            </button>
          </div>
        </div>
      </div>
    `;

    overlay.classList.add('active');

    let downloadedFilePath = null;

    const closeModal = () => {
      overlay.classList.remove('active');
      if (typeof onDismiss === 'function') {
        onDismiss();
      }
    };

    const btnLater = overlay.querySelector('#wzmm-btn-update-later');
    const btnRelease = overlay.querySelector('#wzmm-btn-update-release');
    const btnDownload = overlay.querySelector('#wzmm-btn-update-download');
    const btnLaunch = overlay.querySelector('#wzmm-btn-update-launch');
    const btnFolder = overlay.querySelector('#wzmm-btn-update-folder');
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
          if (pathVal) pathVal.textContent = savedPath;

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

    if (btnLaunch) {
      btnLaunch.addEventListener('click', () => {
        if (downloadedFilePath) {
          this.openDownloadedFile(downloadedFilePath);
          setTimeout(() => {
            const { app } = require('electron').remote || require('electron');
            if (app && typeof app.quit === 'function') {
              app.quit();
            } else {
              window.close();
            }
          }, 600);
        }
      });
    }

    if (btnFolder) {
      btnFolder.addEventListener('click', () => {
        if (downloadedFilePath) {
          this.showInFolder(downloadedFilePath);
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

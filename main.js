const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { isLinux, getConfigDir } = require('./js/platform');

process.on('uncaughtException', (error) => {
    try {
        const logDir = getConfigDir();
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = path.join(logDir, 'error.log');
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${error && error.stack ? error.stack : error}\n`);
    } catch (e) {}
    if (dialog && typeof dialog.showErrorBox === 'function') {
        dialog.showErrorBox('WZMM Error', (error && error.stack) || String(error));
    }
});

process.on('unhandledRejection', (reason) => {
    try {
        const logDir = getConfigDir();
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }
        const logFile = path.join(logDir, 'error.log');
        fs.appendFileSync(logFile, `[${new Date().toISOString()}] Unhandled Rejection: ${reason}\n`);
    } catch (e) {}
});

if (isLinux) {
    app.commandLine.appendSwitch('enable-gpu-rasterization');
    app.commandLine.appendSwitch('enable-zero-copy');
    app.commandLine.appendSwitch('ignore-gpu-blocklist');
    app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
    app.commandLine.appendSwitch('enable-features', 'WaylandWindowDecorations');
    app.commandLine.appendSwitch('disable-features', 'Vulkan');
    if (app.setDesktopName) {
        app.setDesktopName('why-zenless-mod-manager');
    }
} else {
    app.setAppUserModelId('com.whityx.wzmm');
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    let mainWindow = null;
    let tray = null;
    let isQuiting = false;

    function createWindow() {
        process.env.WZMM_SYSTEM_LOCALE = app.getLocale() || '';
        mainWindow = new BrowserWindow({
            width: 1000,
            height: 700,
            autoHideMenuBar: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webSecurity: false
            }
        });

        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
            if (errorCode === -3) return;
            dialog.showErrorBox('WZMM Load Error', `Failed to load: ${validatedURL}\nError: ${errorDescription} (${errorCode})`);
        });

        mainWindow.webContents.on('render-process-gone', (event, details) => {
            dialog.showErrorBox('WZMM Crash', `Renderer process terminated: ${details.reason} (Code: ${details.exitCode})`);
        });

        mainWindow.loadFile(path.join(__dirname, 'index.html'));

        mainWindow.webContents.setWindowOpenHandler(({ url }) => {
            if (url) {
                if (url.startsWith('http://') || url.startsWith('https://')) {
                    require('electron').shell.openExternal(url);
                } else {
                    const stripped = url.replace(/^file:\/\/\/?(?:[a-z]:)?/i, '');
                    if (/^\/?(?:members|mods|sounds|skins|tools|requests|threads|questions|ideas|wips|contests|clubs|studios)\//i.test(stripped)) {
                        const cleanPath = stripped.startsWith('/') ? stripped : '/' + stripped;
                        require('electron').shell.openExternal('https://gamebanana.com' + cleanPath);
                    }
                }
            }
            return { action: 'deny' };
        });

        mainWindow.webContents.on('will-navigate', (event, url) => {
            const cleanUrl = url.toLowerCase().replace(/\\/g, '/');
            if (cleanUrl.endsWith('index.html')) {
                return;
            }
            event.preventDefault();
            if (url.startsWith('http://') || url.startsWith('https://')) {
                require('electron').shell.openExternal(url);
            } else {
                const stripped = url.replace(/^file:\/\/\/?(?:[a-z]:)?/i, '');
                if (/^\/?(?:members|mods|sounds|skins|tools|requests|threads|questions|ideas|wips|contests|clubs|studios)\//i.test(stripped)) {
                    const cleanPath = stripped.startsWith('/') ? stripped : '/' + stripped;
                    require('electron').shell.openExternal('https://gamebanana.com' + cleanPath);
                }
            }
        });

        mainWindow.on('close', (event) => {
            if (!isQuiting && tray) {
                event.preventDefault();
                mainWindow.hide();
            }
        });
    }

    app.whenReady().then(() => {
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });

    app.on('window-all-closed', () => {
        app.quit();
    });

    ipcMain.on('get-app-version', (event) => {
        event.returnValue = app.getVersion();
    });

    ipcMain.on('minimize-to-tray', () => {
        if (mainWindow) {
            mainWindow.hide();
        }

        if (!tray) {
            let iconPath = path.join(__dirname, 'build', 'icons', '512x512.png');
            let icon;
            
            if (fs.existsSync(iconPath)) {
                icon = nativeImage.createFromPath(iconPath);
            } else {
                icon = nativeImage.createEmpty();
            }

            tray = new Tray(icon);
            tray.setToolTip('WZMM - Мод Менеджер');

            const contextMenu = Menu.buildFromTemplate([
                { label: 'Развернуть', click: () => { if (mainWindow) mainWindow.show(); } },
                { label: 'Выход', click: () => { 
                    isQuiting = true; 
                    app.quit(); 
                }}
            ]);

            tray.setContextMenu(contextMenu);
            tray.on('click', () => {
                if (mainWindow) mainWindow.show();
            });
        }
    });

    ipcMain.handle('open-3d-viewer', async (event, data) => {
        try {
            const { spawn } = require('child_process');
            const fs = require('fs');
            const os = require('os');
            let targetModPath = typeof data === 'string' ? data : (data && data.modPath);
            let theme = (data && data.theme) || null;
            let lang = (data && data.lang) || null;
            let disabledIni = !!(data && data.disabledIni);
            if (!theme || !lang) {
                try {
                    const cfgDir = getConfigDir();
                    const sPath = path.join(cfgDir, 'settings.json');
                    if (fs.existsSync(sPath)) {
                        const parsed = JSON.parse(fs.readFileSync(sPath, 'utf8'));
                        if (!theme && parsed.theme) theme = parsed.theme;
                        if (!lang && parsed.language) lang = parsed.language;
                    }
                } catch (e) {}
            }
            let args = [];
            if (targetModPath && typeof targetModPath === 'string') {
                args.push(targetModPath);
            }
            if (disabledIni) {
                args.push('--disabled-ini');
            }
            if (theme) {
                args.push('--theme', theme);
            }
            if (lang) {
                args.push('--lang', lang);
            }
            if (mainWindow) {
                mainWindow.blur();
            }
            let mvDir = path.join(__dirname, 'modelviewer');
            if (mvDir.includes('app.asar')) {
                const unpacked = mvDir.replace('app.asar', 'app.asar.unpacked');
                if (fs.existsSync(unpacked)) mvDir = unpacked;
            }

            let themesDir = path.join(__dirname, 'themes');
            if (themesDir.includes('app.asar')) {
                const unpacked = themesDir.replace('app.asar', 'app.asar.unpacked');
                if (fs.existsSync(unpacked)) themesDir = unpacked;
            }

            const scriptPath = isLinux
                ? path.join(mvDir, 'run.sh')
                : path.join(mvDir, 'run.bat');

            if (isLinux && fs.existsSync(scriptPath)) {
                try { fs.chmodSync(scriptPath, 0o755); } catch (e) {}
            }

            const spawnCmd = isLinux
                ? '/bin/bash'
                : (process.env.ComSpec || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'));

            const spawnArgs = isLinux
                ? [scriptPath, ...args]
                : ['/c', scriptPath, ...args];

            const child = spawn(spawnCmd, spawnArgs, {
                cwd: mvDir,
                detached: true,
                stdio: 'ignore',
                windowsHide: true,
                env: {
                    ...process.env,
                    WZMM_THEME: theme || 'amber',
                    WZMM_LANG: lang || 'en',
                    WZMM_THEMES_DIR: themesDir
                }
            });
            child.on('exit', (code) => {
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.focus();
                }
                if (code !== 0 && code !== null) {
                    try {
                        const logPath = path.join(mvDir, 'viewer_launch.log');
                        if (fs.existsSync(logPath)) {
                            const content = fs.readFileSync(logPath, 'utf8').trim();
                            if (content && dialog && typeof dialog.showErrorBox === 'function') {
                                dialog.showErrorBox('3D Viewer Error', content);
                            }
                        }
                    } catch (e) {}
                }
            });
            child.unref();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });
}

const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let tray = null;
let isQuiting = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            webSecurity: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'index.html'));

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
    if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('minimize-to-tray', () => {
    if (mainWindow) {
        mainWindow.hide();
    }

    if (!tray) {
        let iconPath = path.join(__dirname, 'icon.png');
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
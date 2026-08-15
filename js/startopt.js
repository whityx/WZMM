const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync } = require("child_process");

function showBanner(title, message) {
  let banner = document.getElementById("wzmm-launch-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "wzmm-launch-banner";
    banner.style.cssText = `
            position: fixed; bottom: 30px; right: 30px; width: 340px;
            background: var(--bg-glass, rgba(18,18,24,0.9));
            backdrop-filter: blur(15px);
            border: 1px solid var(--accent, #564787);
            border-radius: 12px; padding: 16px 20px;
            color: #fff; z-index: 10000;
            box-shadow: 0 10px 40px rgba(0,0,0,0.6);
            transform: translateY(150%); opacity: 0;
            transition: 0.5s cubic-bezier(0.2, 0.8, 0.2, 1);
            display: flex; flex-direction: column; gap: 6px;
        `;
    document.body.appendChild(banner);
  }

  banner.innerHTML = `
        <h4 style="margin:0; font-size:1rem; font-weight:700; color:var(--text-primary); display:flex; align-items:center; gap:8px;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="color:var(--accent);"><path d="M12 2L2 22h20L12 2zm0 4.5l6.5 13.5h-13L12 6.5zM11 16h2v2h-2v-2zm0-7h2v5h-2V9z"/></svg>
            ${title}
        </h4>
        <div style="font-size:0.85rem; color:var(--text-secondary); line-height:1.4;">${message}</div>
    `;

  void banner.offsetWidth;
  banner.style.transform = "translateY(0)";
  banner.style.opacity = "1";

  setTimeout(() => {
    banner.style.transform = "translateY(150%)";
    banner.style.opacity = "0";
  }, 5000);
}

function getSteamPaths() {
  const home = os.homedir();
  const roots = [
    path.join(home, ".local", "share", "Steam"),
    path.join(home, ".steam", "steam"),
    path.join(home, ".steam", "root"),
  ];
  return roots.find((d) => fs.existsSync(d));
}

function findSteamAndGame() {
  const steamDir = getSteamPaths();
  if (!steamDir) return null;

  const libs = [steamDir];
  const libVdf = path.join(steamDir, "steamapps", "libraryfolders.vdf");

  if (fs.existsSync(libVdf)) {
    const vdf = fs.readFileSync(libVdf, "utf-8");
    const lines = vdf.split("\n");
    for (const line of lines) {
      if (line.includes('"path"')) {
        const parts = line.split('"');
        if (parts.length >= 4) {
          const p = parts[3];
          if (fs.existsSync(p) && p !== steamDir) {
            libs.push(p);
          }
        }
      }
    }
  }

  const gameRelPath = path.join(
    "steamapps",
    "common",
    "Zenless Zone Zero",
    "games",
    "ZenlessZoneZero Game",
    "ZenlessZoneZero.exe",
  );
  for (const lib of libs) {
    const exePath = path.join(lib, gameRelPath);
    if (fs.existsSync(exePath)) {
      return { steamDir, gameLib: lib, gameExe: exePath, libs };
    }
  }
  return { steamDir, gameLib: null, gameExe: null, libs };
}

function findProton(libs) {
  for (const lib of libs) {
    const compatDir = path.join(lib, "compatibilitytools.d");
    if (fs.existsSync(compatDir)) {
      const tools = fs.readdirSync(compatDir);
      for (const tool of tools) {
        const p = path.join(compatDir, tool, "proton");
        if (fs.existsSync(p)) return p;
      }
    }
    const commonDir = path.join(lib, "steamapps", "common");
    if (fs.existsSync(commonDir)) {
      const items = fs.readdirSync(commonDir);
      for (const item of items) {
        if (item.startsWith("Proton")) {
          const p = path.join(commonDir, item, "proton");
          if (fs.existsSync(p)) return p;
        }
      }
    }
  }
  return null;
}

module.exports = {
  launch: (settings, t) => {
    const binPath = settings.xxmiBinPath;
    if (!binPath) {
      showBanner(t('start_err_title'), t('start_err_bin'));
      return;
    }

    const steamInfo = findSteamAndGame();
    if (!steamInfo || !steamInfo.gameExe) {
      showBanner(t('start_err_title'), t('start_err_steam'));
      return;
    }
    const { steamDir, gameLib, gameExe, libs } = steamInfo;

    const protonBin = findProton(libs);
    if (!protonBin) {
      showBanner(t('start_err_title'), t('start_err_proton'));
      return;
    }

    let xxmiExe = null;
    if (fs.existsSync(binPath)) {
      const stat = fs.statSync(binPath);
      if (stat.isFile() && binPath.toLowerCase().endsWith(".exe")) {
        xxmiExe = binPath;
      } else if (stat.isDirectory()) {
        const files = fs.readdirSync(binPath);
        const exes = files.filter((f) => f.toLowerCase().endsWith(".exe"));
        if (exes.includes("XXMI Launcher.exe")) {
          xxmiExe = path.join(binPath, "XXMI Launcher.exe");
        } else if (exes.length > 0) {
          xxmiExe = path.join(binPath, exes[0]);
        }
      }
    }

    if (!xxmiExe) {
      showBanner(t('start_err_title'), t('start_err_exe'));
      return;
    }

    const APP_ID = "4162040";
    const compatData = path.join(gameLib, "steamapps", "compatdata", APP_ID);

    if (!fs.existsSync(compatData)) {
      fs.mkdirSync(compatData, { recursive: true });
    }

    showBanner(t('start_prep_title'), t('start_prep_msg'));

    const env = Object.assign({}, process.env, {
      STEAM_COMPAT_DATA_PATH: compatData,
      STEAM_COMPAT_CLIENT_INSTALL_PATH: steamDir,
      STEAM_COMPAT_APP_ID: APP_ID,
      SteamAppId: APP_ID,
      SteamGameId: APP_ID,
      SteamOverlayGameId: APP_ID,
      SteamOS: "1",
      DXVK_HUD: "0",
      __GL_SHADER_DISK_CACHE: "0",
      AMD_DISABLE_SHADER_CACHE: "1",
      RESET_STEAM_SHADERS: "1",
      PROTON_ENABLE_WAYLAND: "1",
      SDL_VIDEO_FULLSCREEN_DISPLAY: "0",
    });

    const overlay32 = path.join(
      steamDir,
      "ubuntu12_32",
      "gameoverlayrenderer.so",
    );
    const overlay64 = path.join(
      steamDir,
      "ubuntu12_64",
      "gameoverlayrenderer.so",
    );
    if (fs.existsSync(overlay32) && fs.existsSync(overlay64)) {
      const existingPreload = env.LD_PRELOAD || "";
      const newPreload = `${overlay32}:${overlay64}`;
      env.LD_PRELOAD = existingPreload
        ? `${newPreload}:${existingPreload}`
        : newPreload;
    }

    const appidTxt = path.join(path.dirname(gameExe), "steam_appid.txt");
    fs.writeFileSync(appidTxt, APP_ID);

    try {
      const child = spawn(protonBin, ["run", xxmiExe], {
        env: env,
        detached: true,
        stdio: "ignore",
      });
      child.unref();

      showBanner(t('start_launch_title'), t('start_launch_msg'));

      let attempts = 0;
      const maxAttempts = 15;

      const checkInterval = setInterval(() => {
        attempts++;
        try {
          execSync('pgrep -f "ZenlessZoneZero"');

          clearInterval(checkInterval);
          showBanner(t('start_success_title'), t('start_success_msg'));

          if (settings.minimizeTray) {
            ipcRenderer.send("minimize-to-tray");
          }
        } catch (e) {
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            showBanner(t('start_wait_title'), t('start_wait_msg'));
          }
        }
      }, 2000);
    } catch (err) {
      showBanner(t('start_sys_err_title'), t('start_sys_err_msg', { error: err.message }));
    }
  },
};
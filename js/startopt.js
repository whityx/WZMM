const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync } = require("child_process");

function notify(title, message, type = "info") {
  if (typeof window !== "undefined" && window.Toast) {
    window.Toast.show({ title, message, type });
  } else {
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
  }
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
      notify(t("start_err_title"), t("start_err_bin"), "error");
      return;
    }

    const steamInfo = findSteamAndGame();
    if (!steamInfo || !steamInfo.gameExe) {
      notify(t("start_err_title"), t("start_err_steam"), "error");
      return;
    }
    const { steamDir, gameLib, gameExe, libs } = steamInfo;

    const protonBin = findProton(libs);
    if (!protonBin) {
      notify(t("start_err_title"), t("start_err_proton"), "error");
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
      notify(t("start_err_title"), t("start_err_exe"), "error");
      return;
    }

    const APP_ID = "4162040";
    const compatData = path.join(gameLib, "steamapps", "compatdata", APP_ID);

    if (!fs.existsSync(compatData)) {
      fs.mkdirSync(compatData, { recursive: true });
    }

    notify(t("start_prep_title"), t("start_prep_msg"), "info");

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

      notify(t("start_launch_title"), t("start_launch_msg"), "info");

      let attempts = 0;
      const maxAttempts = 15;

      const checkInterval = setInterval(() => {
        attempts++;
        try {
          execSync('pgrep -f "ZenlessZoneZero"');

          clearInterval(checkInterval);
          notify(t("start_success_title"), t("start_success_msg"), "success");

          if (settings.minimizeTray) {
            ipcRenderer.send("minimize-to-tray");
          }
        } catch (e) {
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            notify(t("start_wait_title"), t("start_wait_msg"), "warning");
          }
        }
      }, 2000);
    } catch (err) {
      notify(
        t("start_sys_err_title"),
        t("start_sys_err_msg", { error: err.message }),
        "error",
      );
    }
  },
};

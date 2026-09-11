const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, execSync, exec } = require("child_process");
const { isWindows, isLinux, checkGameProcessCommand } = require("./platform");

function notify(title, message, type = "info") {
  if (typeof window !== "undefined" && window.Toast) {
    window.Toast.show({ title, message, type });
  } else {
    console.log(`[${type.toUpperCase()}] ${title}: ${message}`);
  }
}

function getSteamPaths() {
  if (isWindows) {
    const regQueries = [
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
      'reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath',
      'reg query "HKLM\\SOFTWARE\\Valve\\Steam" /v InstallPath',
      'reg query "HKCU\\Software\\Valve\\Steam" /v SteamExe'
    ];

    for (const query of regQueries) {
      try {
        const stdout = execSync(query, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' });
        const lines = stdout.split(/\r?\n/);
        for (const line of lines) {
          const match = line.match(/REG_SZ\s+(.+)$/i);
          if (match && match[1]) {
            let p = match[1].trim();
            if (p.toLowerCase().endsWith('.exe')) {
              p = path.dirname(p);
            }
            p = path.normalize(p);
            if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
              return p;
            }
          }
        }
      } catch (e) {}
    }

    const standardDirs = [];
    if (process.env['ProgramFiles(x86)']) {
      standardDirs.push(path.join(process.env['ProgramFiles(x86)'], 'Steam'));
    }
    if (process.env.ProgramFiles) {
      standardDirs.push(path.join(process.env.ProgramFiles, 'Steam'));
    }
    const drives = ['C', 'D', 'E', 'F', 'G', 'H'];
    for (const drive of drives) {
      standardDirs.push(`${drive}:\\Steam`);
      standardDirs.push(`${drive}:\\Program Files (x86)\\Steam`);
      standardDirs.push(`${drive}:\\Program Files\\Steam`);
      standardDirs.push(`${drive}:\\SteamLibrary`);
    }

    for (const dir of standardDirs) {
      if (fs.existsSync(dir)) {
        return dir;
      }
    }
    return null;
  }

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
    try {
      const vdf = fs.readFileSync(libVdf, "utf-8");
      const lines = vdf.split(/\r?\n/);
      for (const line of lines) {
        if (line.includes('"path"')) {
          const parts = line.split('"');
          if (parts.length >= 4) {
            let p = parts[3];
            p = p.replace(/\\\\/g, "\\");
            p = path.normalize(p);
            if (fs.existsSync(p) && !libs.includes(p)) {
              libs.push(p);
            }
          }
        }
      }
    } catch (e) {}
  }

  const possibleRelPaths = [
    path.join("steamapps", "common", "Zenless Zone Zero", "games", "ZenlessZoneZero Game", "ZenlessZoneZero.exe"),
    path.join("steamapps", "common", "Zenless Zone Zero", "ZenlessZoneZero Game", "ZenlessZoneZero.exe"),
    path.join("steamapps", "common", "Zenless Zone Zero", "ZenlessZoneZero.exe"),
    path.join("steamapps", "common", "ZenlessZoneZero", "games", "ZenlessZoneZero Game", "ZenlessZoneZero.exe"),
    path.join("steamapps", "common", "ZenlessZoneZero", "ZenlessZoneZero Game", "ZenlessZoneZero.exe"),
    path.join("steamapps", "common", "ZenlessZoneZero", "ZenlessZoneZero.exe"),
  ];

  for (const lib of libs) {
    for (const rel of possibleRelPaths) {
      const exePath = path.join(lib, rel);
      if (fs.existsSync(exePath)) {
        return { steamDir, gameLib: lib, gameExe: exePath, libs };
      }
    }

    const commonDir = path.join(lib, "steamapps", "common");
    if (fs.existsSync(commonDir)) {
      try {
        const entries = fs.readdirSync(commonDir);
        for (const entry of entries) {
          if (/zenless/i.test(entry)) {
            const folder = path.join(commonDir, entry);
            const candidates = [
              path.join(folder, "ZenlessZoneZero.exe"),
              path.join(folder, "ZenlessZoneZero Game", "ZenlessZoneZero.exe"),
              path.join(folder, "games", "ZenlessZoneZero Game", "ZenlessZoneZero.exe")
            ];
            for (const cand of candidates) {
              if (fs.existsSync(cand)) {
                return { steamDir, gameLib: lib, gameExe: cand, libs };
              }
            }
          }
        }
      } catch (e) {}
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

function findXxmiExe(binPath) {
  if (!binPath || !fs.existsSync(binPath)) return null;

  try {
    const stat = fs.statSync(binPath);
    if (stat.isFile() && binPath.toLowerCase().endsWith(".exe")) {
      return binPath;
    }
    if (stat.isDirectory()) {
      const files = fs.readdirSync(binPath);
      const exes = files.filter((f) => f.toLowerCase().endsWith(".exe"));
      const preferred = ["XXMI Launcher.exe", "3DMigoto Loader.exe", "XXMI.exe"];
      for (const name of preferred) {
        const found = exes.find((f) => f.toLowerCase() === name.toLowerCase());
        if (found) {
          return path.join(binPath, found);
        }
      }
      if (exes.length > 0) {
        return path.join(binPath, exes[0]);
      }
    }
  } catch (e) {}
  return null;
}

function isSteamRunning() {
  try {
    const tasks = execSync('tasklist /FI "IMAGENAME eq steam.exe" /NH', { encoding: "utf8" });
    return tasks.toLowerCase().includes("steam.exe");
  } catch {
    return false;
  }
}

function closeSteam(steamDir) {
  if (!isSteamRunning()) return;
  const steamExe = path.join(steamDir, "steam.exe");
  try {
    execSync(`"${steamExe}" -shutdown`, { stdio: "ignore" });
  } catch {
    try {
      execSync("taskkill /F /IM steam.exe", { stdio: "ignore" });
    } catch {}
  }

  for (let i = 0; i < 10; i++) {
    try {
      execSync("timeout /t 1 >nul 2>&1 || ping -n 2 127.0.0.1 >nul", { stdio: "ignore" });
    } catch {}
    if (!isSteamRunning()) break;
  }
}

function configureSteamLaunchOptions(steamDir, xxmiExe) {
  if (!steamDir) return false;

  const userdataDir = path.join(steamDir, "userdata");
  if (!fs.existsSync(userdataDir)) {
    return false;
  }

  let users = [];
  try {
    users = fs.readdirSync(userdataDir).filter((f) => !isNaN(f));
  } catch (e) {
    return false;
  }

  if (users.length === 0) {
    return false;
  }

  const cleanExe = xxmiExe.replace(/^["']|["']$/g, "").trim();
  const APP_ID = "4162040";
  
  const rawOption = `"${cleanExe}" --nogui --xxmi ZZMI %COMMAND%`;
  const vdfEscapedValue = rawOption.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const targetLaunchOptionLine = `"LaunchOptions"\t\t"${vdfEscapedValue}"`;

  let modified = false;

  for (const userId of users) {
    const configFile = path.join(userdataDir, userId, "config", "localconfig.vdf");
    if (!fs.existsSync(configFile)) continue;

    try {
      let content = fs.readFileSync(configFile, "utf8");

      if (content.includes(`"${APP_ID}"`) && content.includes(vdfEscapedValue)) {
        continue;
      }

      closeSteam(steamDir);

      content = fs.readFileSync(configFile, "utf8");

      const appRegex = new RegExp(`("${APP_ID}"\\s*\\{[\\s\\S]*?\\})`, "i");
      const match = content.match(appRegex);

      if (match) {
        let appBlock = match[1];
        if (/"LaunchOptions"/i.test(appBlock)) {
          appBlock = appBlock.replace(/"LaunchOptions"[^\r\n]*/i, () => targetLaunchOptionLine);
        } else {
          appBlock = appBlock.replace("{", `{\n\t\t\t\t\t${targetLaunchOptionLine}`);
        }
        content = content.replace(match[1], appBlock);
        fs.writeFileSync(configFile, content, "utf8");
        modified = true;
      } else {
        const appsRegex = /("apps"\s*\{)/i;
        if (appsRegex.test(content)) {
          content = content.replace(
            appsRegex,
            `$1\n\t\t\t\t"${APP_ID}"\n\t\t\t\t{\n\t\t\t\t\t${targetLaunchOptionLine}\n\t\t\t\t}`
          );
          fs.writeFileSync(configFile, content, "utf8");
          modified = true;
        }
      }
    } catch (e) {
    }
  }

  return modified;
}

let _cachedRunning = false;
let _checkingProcess = false;

function checkGameRunningAsync(callback) {
  if (_checkingProcess) {
    if (typeof callback === "function") callback(_cachedRunning);
    return;
  }
  _checkingProcess = true;
  if (isWindows) {
    exec('tasklist /NH /FI "IMAGENAME eq Zenless*"', { encoding: "utf8" }, (err, stdout) => {
      _checkingProcess = false;
      _cachedRunning = !err && /zenless/i.test(stdout || "");
      if (typeof callback === "function") callback(_cachedRunning);
    });
  } else {
    exec('pgrep -i -f "ZenlessZoneZero\\.exe"', (err, stdout) => {
      _checkingProcess = false;
      _cachedRunning = !err && (stdout || "").trim().length > 0;
      if (typeof callback === "function") callback(_cachedRunning);
    });
  }
}

function isGameRunning() {
  return _cachedRunning;
}

function monitorGameExit(settings, t) {
  let consecutiveMisses = 0;
  const exitInterval = setInterval(() => {
    checkGameRunningAsync((running) => {
      if (running) {
        consecutiveMisses = 0;
      } else {
        consecutiveMisses++;
        if (consecutiveMisses >= 2) {
          clearInterval(exitInterval);
          ipcRenderer.send("restore-from-tray");
        }
      }
    });
  }, 3000);
}

function checkGameStartup(settings, t) {
  let attempts = 0;
  const maxAttempts = 15;

  const checkInterval = setInterval(() => {
    attempts++;
    checkGameRunningAsync((running) => {
      if (running) {
        clearInterval(checkInterval);
        notify(t("start_success_title"), t("start_success_msg"), "success");

        if (settings.minimizeTray) {
          ipcRenderer.send("minimize-to-tray");
        }

        if (settings.restoreOnExit) {
          monitorGameExit(settings, t);
        }
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        notify(t("start_wait_title"), t("start_wait_msg"), "warning");
      }
    });
  }, 2000);
}

function killGame(callback) {
  _cachedRunning = false;
  if (isWindows) {
    const psCmd = 'powershell -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match \'Zenless|ZFGame|UnityCrashHandler|XXMI|3DMigoto\' } | Invoke-CimMethod -MethodName Terminate -ErrorAction SilentlyContinue"';
    const taskkillCmd = 'taskkill /F /IM ZenlessZoneZero.exe /IM ZFGameBrowser.exe /IM UnityCrashHandler64.exe /IM "XXMI Launcher.exe" /IM "3DMigoto Loader.exe" /IM 3DMigoto.exe /IM XXMI.exe /FI "IMAGENAME eq Zenless*" /T';

    exec(psCmd, () => {
      exec(taskkillCmd, () => {
        checkGameRunningAsync((running) => {
          if (typeof callback === "function") callback(running);
        });
      });
    });
  } else {
    const linuxCmd = 'pkill -15 -i -f "ZenlessZoneZero\\.exe"; pkill -15 -i -f "3DMigoto Loader\\.exe"; pkill -15 -i -f "XXMI Launcher\\.exe"; pkill -15 -i -f "XXMI\\.exe"; sleep 0.5; pkill -9 -i -f "ZenlessZoneZero\\.exe"; pkill -9 -i -f "3DMigoto Loader\\.exe"; pkill -9 -i -f "XXMI Launcher\\.exe"; pkill -9 -i -f "XXMI\\.exe"';
    exec(linuxCmd, () => {
      checkGameRunningAsync((running) => {
        if (typeof callback === "function") callback(running);
      });
    });
  }
}

module.exports = {
  isGameRunning,
  checkGameRunningAsync,
  killGame,
  launch: (settings, t) => {
    const binPath = settings.xxmiBinPath;
    if (!binPath) {
      notify(t("start_err_title"), t("start_err_bin"), "error");
      return;
    }

    const xxmiExe = findXxmiExe(binPath);
    if (!xxmiExe) {
      notify(t("start_err_title"), t("start_err_exe"), "error");
      return;
    }

    if (isLinux) {
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
        "gameoverlayrenderer.so"
      );
      const overlay64 = path.join(
        steamDir,
        "ubuntu12_64",
        "gameoverlayrenderer.so"
      );
      if (fs.existsSync(overlay32) && fs.existsSync(overlay64)) {
        const existingPreload = env.LD_PRELOAD || "";
        const newPreload = `${overlay32}:${overlay64}`;
        env.LD_PRELOAD = existingPreload
          ? `${newPreload}:${existingPreload}`
          : newPreload;
      }

      const appidTxt = path.join(path.dirname(gameExe), "steam_appid.txt");
      try {
        fs.writeFileSync(appidTxt, APP_ID);
      } catch (e) {}

      try {
        const child = spawn(
          protonBin,
          ["run", xxmiExe, "--nogui", "--xxmi", "ZZMI"],
          {
            env: env,
            detached: true,
            stdio: "ignore",
          }
        );
        child.on("error", (err) => {
          notify(
            t("start_sys_err_title"),
            t("start_sys_err_msg", { error: err.message }),
            "error"
          );
        });
        child.unref();

        notify(t("start_launch_title"), t("start_launch_msg"), "info");
        checkGameStartup(settings, t);
      } catch (err) {
        notify(
          t("start_sys_err_title"),
          t("start_sys_err_msg", { error: err.message }),
          "error"
        );
      }
    } else if (isWindows) {
      const APP_ID = "4162040";
      notify(t("start_prep_title"), t("start_prep_msg"), "info");

      const steamDir = getSteamPaths();
      if (steamDir) {
        try {
          configureSteamLaunchOptions(steamDir, xxmiExe);
        } catch (e) {}
      }

      notify(t("start_launch_title"), t("start_launch_msg"), "info");

      exec(`start "" "steam://rungameid/${APP_ID}"`, (err) => {
        if (err) {
          notify(
            t("start_sys_err_title"),
            t("start_sys_err_msg", { error: err.message }),
            "error"
          );
        }
      });

      checkGameStartup(settings, t);
    }
  }
};

const fs = require("fs");

function isSteamDeck() {
  if (process.env.SteamDeck === "1" || process.env.SteamOS === "1") return true;

  try {
    if (fs.existsSync("/sys/devices/virtual/dmi/id/product_name")) {
      const prod = fs.readFileSync("/sys/devices/virtual/dmi/id/product_name", "utf-8").toLowerCase();
      if (prod.includes("jupiter") || prod.includes("galileo")) return true;
    }
  } catch (e) {}

  try {
    if (fs.existsSync("/etc/os-release")) {
      const osRel = fs.readFileSync("/etc/os-release", "utf-8").toLowerCase();
      if (osRel.includes("steamos")) return true;
    }
  } catch (e) {}

  try {
    if (typeof window !== "undefined" && window.screen) {
      const w = window.screen.width;
      const h = window.screen.height;
      if ((w === 1280 && h === 800) || (w === 800 && h === 1280)) {
        if (process.platform === "linux") return true;
      }
    }
  } catch (e) {}

  return false;
}

function getControllerType(gamepad) {
  if (!gamepad) return "generic";
  const id = (gamepad.id || "").toLowerCase();
  if (isSteamDeck() || id.includes("057e-2009") || id.includes("valve") || id.includes("deck")) {
    return "steam-deck";
  }
  if (id.includes("054c") || id.includes("dualshock") || id.includes("dualsense") || id.includes("playstation")) {
    return "playstation";
  }
  if (id.includes("045e") || id.includes("xbox")) {
    return "xbox";
  }
  if (id.includes("nintendo") || id.includes("pro controller")) {
    return "switch";
  }
  return "generic";
}

function openSteamKeyboard(electronShell) {
  if (!isSteamDeck()) return;
  try {
    if (electronShell && typeof electronShell.openExternal === "function") {
      electronShell.openExternal("steam://open/keyboard");
    }
  } catch (e) {}
}

function closeSteamKeyboard(electronShell) {
  if (!isSteamDeck()) return;
  try {
    if (electronShell && typeof electronShell.openExternal === "function") {
      electronShell.openExternal("steam://close/keyboard");
    }
  } catch (e) {}
}

module.exports = {
  isSteamDeck,
  getControllerType,
  openSteamKeyboard,
  closeSteamKeyboard
};

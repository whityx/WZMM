const fs = require("fs");
const path = require("path");
const os = require("os");

class GroupManager {
  constructor() {
    this.groupsDir = path.join(require("./platform").getConfigDir(), "groups");
    if (!fs.existsSync(this.groupsDir)) {
      fs.mkdirSync(this.groupsDir, { recursive: true });
    }
  }

  generateId() {
    return `group_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }

  getGroups() {
    if (!fs.existsSync(this.groupsDir)) return [];
    try {
      const files = fs.readdirSync(this.groupsDir).filter(f => f.endsWith(".json"));
      const groups = [];
      for (const file of files) {
        try {
          const filePath = path.join(this.groupsDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
          if (data && data.id && data.name) {
            groups.push(data);
          }
        } catch (e) {
          console.error(`Error loading group file ${file}:`, e);
        }
      }
      return groups.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    } catch (e) {
      console.error("Error reading groups directory:", e);
      return [];
    }
  }

  getGroup(id) {
    if (!id) return null;
    const filePath = path.join(this.groupsDir, `${id}.json`);
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch (e) {
      return null;
    }
  }

  saveGroup(groupData) {
    try {
      const id = groupData.id || this.generateId();
      const now = Date.now();
      const group = {
        id,
        name: (groupData.name || "").trim() || "New Group",
        mods: Array.isArray(groupData.mods) ? Array.from(new Set(groupData.mods)) : [],
        createdAt: groupData.createdAt || now,
        updatedAt: now
      };
      const filePath = path.join(this.groupsDir, `${id}.json`);
      fs.writeFileSync(filePath, JSON.stringify(group, null, 2), "utf-8");
      return group;
    } catch (e) {
      console.error("Error saving group:", e);
      return null;
    }
  }

  deleteGroup(id) {
    try {
      const filePath = path.join(this.groupsDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (e) {
      console.error(`Error deleting group ${id}:`, e);
      return false;
    }
  }

  addModToGroup(id, modName) {
    const group = this.getGroup(id);
    if (!group) return false;
    if (!group.mods.includes(modName)) {
      group.mods.push(modName);
      return !!this.saveGroup(group);
    }
    return true;
  }

  removeModFromGroup(id, modName) {
    const group = this.getGroup(id);
    if (!group) return false;
    group.mods = group.mods.filter(m => m !== modName);
    return !!this.saveGroup(group);
  }

  enableGroup(xxmiPath, id, modManager) {
    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { success: false, reason: "invalid_path" };
    }
    const group = this.getGroup(id);
    if (!group) {
      return { success: false, reason: "not_found" };
    }

    const targetMods = new Set(group.mods);
    let enabledCount = 0;

    const { mods } = modManager.getMods(xxmiPath, "all", "", "all", "en");
    for (const mod of mods) {
      if (targetMods.has(mod.name) && !mod.active) {
        if (modManager.toggleMod(xxmiPath, mod.name, false)) {
          enabledCount++;
        }
      }
    }

    return {
      success: true,
      groupName: group.name,
      enabledCount,
      totalCount: group.mods.length
    };
  }

  disableGroup(xxmiPath, id, modManager) {
    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { success: false, reason: "invalid_path" };
    }
    const group = this.getGroup(id);
    if (!group) {
      return { success: false, reason: "not_found" };
    }

    const targetMods = new Set(group.mods);
    let disabledCount = 0;

    const { mods } = modManager.getMods(xxmiPath, "all", "", "all", "en");
    for (const mod of mods) {
      if (targetMods.has(mod.name) && mod.active) {
        if (modManager.toggleMod(xxmiPath, mod.name, true)) {
          disabledCount++;
        }
      }
    }

    return {
      success: true,
      groupName: group.name,
      disabledCount,
      totalCount: group.mods.length
    };
  }

  applyGroup(xxmiPath, id, modManager) {
    if (!xxmiPath || !fs.existsSync(xxmiPath)) {
      return { success: false, reason: "invalid_path" };
    }
    const group = this.getGroup(id);
    if (!group) {
      return { success: false, reason: "not_found" };
    }

    const targetMods = new Set(group.mods);
    let enabledCount = 0;
    let disabledCount = 0;

    const { mods } = modManager.getMods(xxmiPath, "all", "", "all", "en");
    for (const mod of mods) {
      const isTarget = targetMods.has(mod.name);
      if (mod.active && !isTarget) {
        if (modManager.toggleMod(xxmiPath, mod.name, true)) {
          disabledCount++;
        }
      } else if (!mod.active && isTarget) {
        if (modManager.toggleMod(xxmiPath, mod.name, false)) {
          enabledCount++;
        }
      }
    }

    return {
      success: true,
      groupName: group.name,
      enabledCount,
      disabledCount
    };
  }
}

module.exports = GroupManager;

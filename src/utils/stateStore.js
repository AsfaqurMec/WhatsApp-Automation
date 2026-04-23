const fs = require("fs");
const path = require("path");

const logger = require("./logger");

const dataDirectory = path.join(process.cwd(), "src", "data");
const stateFilePath = path.join(dataDirectory, "drive-state.json");

function ensureDirectory() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }
}

function loadState() {
  try {
    ensureDirectory();
    if (!fs.existsSync(stateFilePath)) {
      return { lastCheckedTime: null, notifiedFileIds: [] };
    }

    const raw = fs.readFileSync(stateFilePath, "utf8");
    const parsed = JSON.parse(raw);

    return {
      lastCheckedTime: parsed.lastCheckedTime || null,
      notifiedFileIds: Array.isArray(parsed.notifiedFileIds)
        ? parsed.notifiedFileIds
        : [],
    };
  } catch (error) {
    logger.error("Failed to load watcher state, falling back to defaults", {
      error: error.message,
    });
    return { lastCheckedTime: null, notifiedFileIds: [] };
  }
}

function saveState(state) {
  try {
    ensureDirectory();
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    logger.error("Failed to persist watcher state", { error: error.message });
  }
}

module.exports = {
  loadState,
  saveState,
};

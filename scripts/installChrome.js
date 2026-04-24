const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

function resolveCacheDir() {
  if (process.env.PUPPETEER_CACHE_DIR) {
    return process.env.PUPPETEER_CACHE_DIR;
  }

  if (process.env.RENDER) {
    return "/opt/render/.cache/puppeteer";
  }

  return path.join(process.cwd(), ".puppeteer-cache");
}

function getExecutablePath(puppeteer) {
  try {
    return puppeteer.executablePath();
  } catch (_) {
    return "";
  }
}

function main() {
  const puppeteer = require("puppeteer");
  const cacheDir = resolveCacheDir();
  process.env.PUPPETEER_CACHE_DIR = cacheDir;

  const existingPath = getExecutablePath(puppeteer);
  if (existingPath && fs.existsSync(existingPath)) {
    console.log(`[chrome] Found existing executable at ${existingPath}`);
    return;
  }

  console.log("[chrome] Chrome not found. Installing via Puppeteer...");
  const installScriptPath = path.join(
    process.cwd(),
    "node_modules",
    "puppeteer",
    "install.mjs"
  );

  const installResult = spawnSync(process.execPath, [installScriptPath], {
    stdio: "inherit",
    env: process.env,
  });

  if (installResult.status !== 0) {
    throw new Error("Puppeteer Chrome installation failed.");
  }

  const installedPath = getExecutablePath(puppeteer);
  if (!installedPath || !fs.existsSync(installedPath)) {
    throw new Error("Chrome installation finished but executable was not found.");
  }

  console.log(`[chrome] Installed successfully at ${installedPath}`);
}

try {
  main();
} catch (error) {
  console.warn("[chrome] Startup check warning:", error.message);
  console.warn(
    "[chrome] Continuing startup. Set PUPPETEER_EXECUTABLE_PATH or CHROME_BIN if Render cannot find Chromium."
  );
}

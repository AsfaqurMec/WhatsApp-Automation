const qrcode = require("qrcode-terminal");
const qrCodeImage = require("qrcode");
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");
const { MongoStore } = require("wwebjs-mongo");
const { Client, RemoteAuth, LocalAuth } = require("whatsapp-web.js");

const logger = require("../utils/logger");
const { withRetry } = require("../utils/retry");

class SafeRemoteAuth extends RemoteAuth {
  async deleteMetadata() {
    try {
      await super.deleteMetadata();
    } catch (error) {
      if (error && error.code === "ENOENT") {
        logger.warn("Skipping missing RemoteAuth temp metadata directory", {
          error: error.message,
        });
        return;
      }
      throw error;
    }
  }
}

class WhatsAppService {
  constructor(config) {
    this.groupName = config.whatsappGroupName;
    this.mongoUri = config.mongoUri;
    this.sessionCollection = config.whatsappSessionCollection;
    this.authPath = config.whatsappAuthPath;
    this.remoteBackupIntervalMs = config.whatsappRemoteBackupIntervalMs;
    this.authMode = config.whatsappAuthMode;
    this.launchTimeoutMs = config.whatsappLaunchTimeoutMs;
    this.protocolTimeoutMs = config.whatsappProtocolTimeoutMs;
    this.isReady = false;
    this.isInitializing = false;
    this.qrCodeDataUrl = null;
    this.client = null;
    this.store = null;
    this.storePromise = null;
    this.initializePromise = null;
    this.keepAliveTimer = null;
  }

  resolveAuthPath() {
    const configuredPath = this.authPath || ".wwebjs_auth";
    if (process.platform === "win32" && configuredPath.startsWith("/")) {
      return path.join(process.cwd(), ".wwebjs_auth");
    }
    return configuredPath;
  }

  async ensureStore() {
    if (this.store) {
      return this.store;
    }

    if (this.storePromise) {
      return this.storePromise;
    }

    this.storePromise = (async () => {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(this.mongoUri);
      }

      this.store = new MongoStore({
        mongoose,
        collectionName: this.sessionCollection,
      });

      return this.store;
    })().finally(() => {
      this.storePromise = null;
    });

    return this.storePromise;
  }

  async createClient() {
    if (!process.env.PUPPETEER_CACHE_DIR) {
      process.env.PUPPETEER_CACHE_DIR = process.env.RENDER
        ? "/opt/render/.cache/puppeteer"
        : path.join(process.cwd(), ".puppeteer-cache");
    }
    const puppeteer = require("puppeteer");
    const configuredExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    let executablePath = configuredExecutablePath;

    if (!executablePath) {
      try {
        executablePath = puppeteer.executablePath();
      } catch (error) {
        logger.warn("Unable to resolve Puppeteer executablePath automatically", {
          error: error.message,
        });
      }
    }

    if (executablePath && !fs.existsSync(executablePath)) {
      logger.warn("Configured browser executable path does not exist", {
        executablePath,
      });
      executablePath = undefined;
    }

    const puppeteerConfig = {
      headless: true,
      timeout: this.launchTimeoutMs,
      protocolTimeout: this.protocolTimeoutMs,
      dumpio: process.env.PUPPETEER_DUMPIO === "true",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--single-process",
        "--no-zygote",
        "--disable-software-rasterizer",
        "--disable-background-networking",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-features=site-per-process",
      ],
    };

    if (executablePath) {
      puppeteerConfig.executablePath = executablePath;
    }

    const mustUseRemoteAuth =
      this.authMode === "remote" || process.env.NODE_ENV === "production";
    let authStrategy;
    try {
      const store = await this.ensureStore();
      authStrategy = new SafeRemoteAuth({
        clientId: "drive-notifier",
        store,
        backupSyncIntervalMs: this.remoteBackupIntervalMs,
      });
      logger.info("Using RemoteAuth for WhatsApp session persistence.");
    } catch (error) {
      if (mustUseRemoteAuth) {
        logger.error("RemoteAuth is required but unavailable", {
          error: error.message,
        });
        throw error;
      }
      const dataPath = this.resolveAuthPath();
      logger.warn("Falling back to LocalAuth for WhatsApp persistence", {
        error: error.message,
        authPath: dataPath,
      });
      authStrategy = new LocalAuth({
        clientId: "drive-notifier",
        dataPath,
      });
    }

    this.client = new Client({
      authStrategy,
      puppeteer: puppeteerConfig,
    });
    this.registerEvents();
  }

  registerEvents() {
    this.client.on("qr", async (qr) => {
      logger.info("WhatsApp QR generated. Scan to authenticate.");
      qrcode.generate(qr, { small: true });
      this.isReady = false;
      try {
        this.qrCodeDataUrl = await qrCodeImage.toDataURL(qr);
      } catch (error) {
        logger.error("Failed to render QR image", { error: error.message });
      }
    });

    this.client.on("ready", () => {
      this.isReady = true;
      this.isInitializing = false;
      this.qrCodeDataUrl = null;
      logger.info("WhatsApp client is ready.");
    });

    this.client.on("auth_failure", (message) => {
      this.isReady = false;
      this.isInitializing = false;
      logger.error("WhatsApp authentication failed", { message });
    });

    this.client.on("disconnected", (reason) => {
      this.isReady = false;
      this.isInitializing = false;
      logger.warn("WhatsApp client disconnected", { reason });

      // Reinitialize automatically unless the user explicitly logged out from phone.
      if (reason !== "LOGOUT") {
        setTimeout(() => {
          this.connect().catch((error) => {
            logger.error("Auto-reconnect failed", { error: error.message });
          });
        }, 5000);
      }
    });
  }

  async initialize() {
    if (this.isReady) {
      return;
    }
    if (!this.client) {
      await this.createClient();
    }
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.isInitializing = true;
    this.initializePromise = this.client
      .initialize()
      .catch((error) => {
        this.isInitializing = false;
        this.isReady = false;
        this.qrCodeDataUrl = null;
        logger.error("WhatsApp client initialization failed", {
          error: error.message,
          stack: error.stack,
        });
        throw error;
      })
      .finally(() => {
        this.initializePromise = null;
      });

    try {
      await this.initializePromise;
    } catch (error) {
      // Keep subsequent connect attempts healthy by resetting the client.
      if (this.client) {
        try {
          await this.client.destroy();
        } catch (destroyError) {
          logger.warn("Failed to destroy client after init error", {
            error: destroyError.message,
          });
        }
      }
      this.client = null;
      throw error;
    }
  }

  async connect() {
    await this.initialize();
  }

  startKeepAlive(intervalMs = 15000) {
    if (this.keepAliveTimer) {
      return;
    }

    this.keepAliveTimer = setInterval(() => {
      if (this.isReady || this.isInitializing) {
        return;
      }

      this.connect().catch((error) => {
        logger.warn("Background WhatsApp reconnect attempt failed", {
          error: error.message,
        });
      });
    }, intervalMs);
  }

  async disconnect() {
    if (!this.client) {
      this.isReady = false;
      this.isInitializing = false;
      this.qrCodeDataUrl = null;
      return;
    }

    try {
      await this.client.destroy();
    } catch (error) {
      logger.warn("Failed to destroy WhatsApp client during disconnect", {
        error: error.message,
      });
    }

    this.isReady = false;
    this.isInitializing = false;
    this.qrCodeDataUrl = null;
    this.initializePromise = null;
    this.client = null;
    await this.createClient();
  }

  setGroupName(groupName) {
    this.groupName = groupName;
  }

  getConnectionStatus() {
    return {
      connected: this.isReady,
      connecting: this.isInitializing,
      qrCodeDataUrl: this.qrCodeDataUrl,
      hasGroupConfigured: Boolean(this.groupName),
    };
  }

  async sendNewFileMessage(file) {
    if (!this.isReady) {
      throw new Error("WhatsApp client not ready. Please complete QR login.");
    }

    return withRetry(
      async () => {
        const chats = await this.client.getChats();
        const targetGroup = chats.find(
          (chat) => chat.isGroup && chat.name === this.groupName
        );

        if (!targetGroup) {
          throw new Error(`WhatsApp group not found: ${this.groupName}`);
        }

        const fileLink = file.webViewLink || file.folderLink;
        const subfolderLine = file.parentFolderName
          ? `\n📂 Subfolder: ${file.parentFolderName}`
          : "";
        const linkLine = fileLink ? `\n🔗 ${fileLink}` : "";
        const message = `📁 New file uploaded: ${file.name}${subfolderLine}${linkLine}`;
        await targetGroup.sendMessage(message);
        logger.info("WhatsApp notification sent", {
          group: this.groupName,
          fileName: file.name,
          subfolder: file.parentFolderName || null,
          link: fileLink,
        });
      },
      { context: "WhatsApp send message" }
    );
  }

  async shutdown() {
    try {
      if (this.keepAliveTimer) {
        clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = null;
      }
      if (this.client) {
        await this.client.destroy();
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    } catch (error) {
      logger.warn("Failed to close WhatsApp client cleanly", {
        error: error.message,
      });
    }
  }
}

module.exports = WhatsAppService;

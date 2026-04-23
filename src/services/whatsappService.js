const qrcode = require("qrcode-terminal");
const qrCodeImage = require("qrcode");
const mongoose = require("mongoose");
const fs = require("fs");
const { MongoStore } = require("wwebjs-mongo");
const { Client, RemoteAuth } = require("whatsapp-web.js");

const logger = require("../utils/logger");
const { withRetry } = require("../utils/retry");

class WhatsAppService {
  constructor(config) {
    this.groupName = config.whatsappGroupName;
    this.mongoUri = config.mongoUri;
    this.sessionCollection = config.whatsappSessionCollection;
    this.isReady = false;
    this.isInitializing = false;
    this.qrCodeDataUrl = null;
    this.client = null;
    this.store = null;
    this.storePromise = null;
    this.initializePromise = null;
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
    const store = await this.ensureStore();
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
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--single-process",
      ],
    };

    if (executablePath) {
      puppeteerConfig.executablePath = executablePath;
    }

    this.client = new Client({
      authStrategy: new RemoteAuth({
        clientId: "drive-notifier",
        store,
        backupSyncIntervalMs: 300000,
      }),
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

  async disconnect() {
    if (!this.client) {
      this.isReady = false;
      this.isInitializing = false;
      this.qrCodeDataUrl = null;
      return;
    }

    try {
      await this.client.logout();
    } catch (error) {
      logger.warn("WhatsApp logout failed or not required", {
        error: error.message,
      });
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

const qrcode = require("qrcode-terminal");
const qrCodeImage = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const logger = require("../utils/logger");
const { withRetry } = require("../utils/retry");

class WhatsAppService {
  constructor(config) {
    this.groupName = config.whatsappGroupName;
    this.isReady = false;
    this.isInitializing = false;
    this.qrCodeDataUrl = null;
    this.client = null;
    this.initializePromise = null;
    this.createClient();
  }

  createClient() {
    this.client = new Client({
      authStrategy: new LocalAuth({ clientId: "drive-notifier" }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
      },
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
    if (this.initializePromise) {
      await this.initializePromise;
      return;
    }

    this.isInitializing = true;
    this.initializePromise = this.client
      .initialize()
      .catch((error) => {
        this.isInitializing = false;
        throw error;
      })
      .finally(() => {
        this.initializePromise = null;
      });

    await this.initializePromise;
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
    this.createClient();
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
    } catch (error) {
      logger.warn("Failed to close WhatsApp client cleanly", {
        error: error.message,
      });
    }
  }
}

module.exports = WhatsAppService;

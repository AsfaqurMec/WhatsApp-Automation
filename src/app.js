const express = require("express");
const path = require("path");

const getEnv = require("./config/env");
const GoogleDriveService = require("./services/googleDriveService");
const WhatsAppService = require("./services/whatsappService");
const createDriveWatcher = require("./jobs/driveWatcher");
const logger = require("./utils/logger");

async function bootstrap() {
  const config = getEnv();
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  app.use((req, res, next) => {
    logger.info("HTTP request", { method: req.method, path: req.path });
    next();
  });

  app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const googleDriveService = new GoogleDriveService(config);
  const whatsappService = new WhatsAppService(config);

  let activeConfig = {
    driveFolderId: config.driveFolderId,
    whatsappGroupName: config.whatsappGroupName,
  };
  let driveWatcher = null;

  function startDriveWatcher() {
    if (driveWatcher) {
      driveWatcher.stop();
    }

    driveWatcher = createDriveWatcher({
      googleDriveService,
      whatsappService,
      cronExpression: config.pollingInterval,
    });
    driveWatcher.start();
  }

  app.get("/api/whatsapp/status", (req, res) => {
    const status = whatsappService.getConnectionStatus();
    const isConfigured =
      Boolean(activeConfig.driveFolderId) && Boolean(activeConfig.whatsappGroupName);
    res.status(200).json({
      ...status,
      driveFolderId: activeConfig.driveFolderId,
      whatsappGroupName: activeConfig.whatsappGroupName,
      fullyConfigured: isConfigured,
      watcherRunning: Boolean(driveWatcher) && isConfigured,
    });
  });

  app.post("/api/whatsapp/connect", async (req, res) => {
    try {
      await whatsappService.connect();
      return res.status(200).json({
        success: true,
        message: "WhatsApp connection started. Scan the QR code to continue.",
      });
    } catch (error) {
      const normalizedMessage = String(error.message || "Unknown error");
      logger.error("Failed to start WhatsApp connection", {
        error: normalizedMessage,
        stack: error.stack,
      });
      return res.status(500).json({
        success: false,
        message: `Failed to start WhatsApp connection: ${normalizedMessage}`,
      });
    }
  });

  app.post("/api/whatsapp/disconnect", async (req, res) => {
    try {
      await whatsappService.disconnect();
      return res.status(200).json({
        success: true,
        message: "WhatsApp disconnected successfully.",
      });
    } catch (error) {
      logger.error("Failed to disconnect WhatsApp", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to disconnect WhatsApp.",
      });
    }
  });

  app.post("/api/connections", (req, res) => {
    try {
      const groupName = String(req.body.groupName || "").trim();
      const driveFolderId = String(req.body.driveFolderId || "").trim();

      if (!groupName || !driveFolderId) {
        return res.status(400).json({
          success: false,
          message: "Group name and Drive folder ID are required.",
        });
      }

      if (!whatsappService.getConnectionStatus().connected) {
        return res.status(400).json({
          success: false,
          message: "Connect WhatsApp first by scanning the QR code.",
        });
      }

      whatsappService.setGroupName(groupName);
      googleDriveService.setFolderId(driveFolderId);
      activeConfig = { whatsappGroupName: groupName, driveFolderId };
      startDriveWatcher();

      return res.status(200).json({
        success: true,
        message: "All connections established successfully.",
      });
    } catch (error) {
      logger.error("Failed to configure connections", { error: error.message });
      return res.status(500).json({
        success: false,
        message: "Failed to establish connections.",
      });
    }
  });

  app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  const server = app.listen(config.port, () => {
    logger.info(`Server started on port ${config.port}`);
  });

  async function initializeWhatsAppInBackground() {
    try {
      await whatsappService.initialize();
    } catch (error) {
      logger.error("Initial WhatsApp boot failed, keep-alive will retry", {
        error: error.message,
      });
    }
  }

  initializeWhatsAppInBackground();
  whatsappService.startKeepAlive();

  if (activeConfig.driveFolderId && activeConfig.whatsappGroupName) {
    startDriveWatcher();
  } else {
    logger.info("Waiting for UI configuration before starting drive watcher.");
  }

  async function shutdown(signal) {
    logger.warn(`Received ${signal}, shutting down gracefully...`);
    if (driveWatcher) {
      driveWatcher.stop();
    }
    server.close(async () => {
      await whatsappService.shutdown();
      logger.info("Shutdown complete.");
      process.exit(0);
    });
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  console.error("FULL ERROR:", error); // 👈 ADD THIS
  process.exit(1);
});

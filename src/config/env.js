const dotenv = require("dotenv");

dotenv.config();

const requiredEnvVars = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_URI",
  "GOOGLE_REFRESH_TOKEN",
  "MONGODB_URI",
];

function getEnv() {
  const missing = requiredEnvVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  return {
    port: Number(process.env.PORT) || 5000,
    googleClientId: process.env.GOOGLE_CLIENT_ID,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI,
    googleRefreshToken: process.env.GOOGLE_REFRESH_TOKEN,
    driveFolderId: process.env.DRIVE_FOLDER_ID || "",
    whatsappGroupName: process.env.WHATSAPP_GROUP_NAME || "",
    pollingInterval: process.env.DRIVE_POLLING_CRON || "* * * * *",
    mongoUri: process.env.MONGODB_URI,
    whatsappSessionCollection:
      process.env.WHATSAPP_SESSION_COLLECTION || "whatsapp_sessions",
    whatsappAuthPath: process.env.WHATSAPP_AUTH_PATH || ".wwebjs_auth",
    whatsappRemoteBackupIntervalMs:
      Number(process.env.WHATSAPP_REMOTE_BACKUP_INTERVAL_MS) || 60000,
    whatsappAuthMode: process.env.WHATSAPP_AUTH_MODE || "hybrid",
    whatsappLaunchTimeoutMs:
      Number(process.env.WHATSAPP_LAUNCH_TIMEOUT_MS) || 120000,
    whatsappProtocolTimeoutMs:
      Number(process.env.WHATSAPP_PROTOCOL_TIMEOUT_MS) || 120000,
  };
}

module.exports = getEnv;

const cron = require("node-cron");

const logger = require("../utils/logger");
const { loadState, saveState } = require("../utils/stateStore");

function createDriveWatcher({ googleDriveService, whatsappService, cronExpression }) {
  const state = loadState();
  const notified = new Set(state.notifiedFileIds || []);
  let lastCheckedTime = state.lastCheckedTime;

  async function checkForNewFiles() {
    logger.info("Checking Google Drive for new files...");

    try {
      const files = await googleDriveService.getFilesCreatedAfter(lastCheckedTime);

      if (files.length === 0) {
        logger.info("No new files found.");
        return;
      }

      for (const file of files) {
        if (notified.has(file.id)) {
          continue;
        }

        await whatsappService.sendNewFileMessage(file);
        notified.add(file.id);
      }

      lastCheckedTime = files[files.length - 1].createdTime;
      saveState({
        lastCheckedTime,
        notifiedFileIds: Array.from(notified).slice(-500),
      });

      logger.info("Drive check completed", {
        found: files.length,
        lastCheckedTime,
      });
    } catch (error) {
      logger.error("Drive watcher iteration failed", { error: error.message });
    }
  }

  const job = cron.schedule(cronExpression, checkForNewFiles, { scheduled: false });

  return {
    start() {
      logger.info("Starting Google Drive watcher job", { cronExpression });
      job.start();
      checkForNewFiles();
    },
    stop() {
      logger.info("Stopping Google Drive watcher job");
      job.stop();
    },
  };
}

module.exports = createDriveWatcher;

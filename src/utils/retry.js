const logger = require("./logger");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, options = {}) {
  const retries = options.retries ?? 3;
  const delayMs = options.delayMs ?? 1000;
  const context = options.context ?? "operation";

  let attempt = 0;
  while (attempt <= retries) {
    try {
      return await task();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }

      attempt += 1;
      logger.warn(`${context} failed, retrying`, {
        attempt,
        retries,
        error: error.message,
      });
      await sleep(delayMs * attempt);
    }
  }
}

module.exports = {
  withRetry,
};

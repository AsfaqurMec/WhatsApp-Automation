function formatMessage(level, message, meta) {
  const base = `[${new Date().toISOString()}] [${level}] ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

const logger = {
  info(message, meta) {
    console.log(formatMessage("INFO", message, meta));
  },
  warn(message, meta) {
    console.warn(formatMessage("WARN", message, meta));
  },
  error(message, meta) {
    console.error(formatMessage("ERROR", message, meta));
  },
};

module.exports = logger;

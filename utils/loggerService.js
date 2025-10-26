export default {
  info: (message, meta = {}) => {
    console.log(`ℹ️ ${message}`, meta);
    // Optionally push logs to ELK/CloudWatch etc.
  },
  error: (message, meta = {}) => {
    console.error(`🚨 ${message}`, meta);
    // Send alerts to monitoring tools if needed
  },
};

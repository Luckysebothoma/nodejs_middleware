/**
 * Time formatting utility functions
 * Returns formatted time strings in different levels of detail
 */

/**
 * Returns short time format (HH:MM)
 * @param {Date} [date] - Date object, defaults to current time
 * @returns {string} Time in HH:MM format
 */
function getShortTime() {
  const date = new Date()

  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Returns medium time format (HH:MM:SS)
 * @param {Date} [date] - Date object, defaults to current time
 * @returns {string} Time in HH:MM:SS format
 */
function getMidTime(date = new Date()) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Returns long time format (HH:MM:SS AM/PM with timezone)
 * @param {Date} [date] - Date object, defaults to current time
 * @returns {string} Time in full format with AM/PM and timezone
 */
function getLongTime(date = new Date()) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}
function formattedDate() {
  const options = {
    timeZone: "Africa/Johannesburg",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  };

  const formatter = new Intl.DateTimeFormat("en-ZA", options);
  const parts = formatter.formatToParts(new Date());
  const time = `${parts.find(p => p.type === "hour").value}:${parts.find(p => p.type === "minute").value}:${parts.find(p => p.type === "second").value}`;
  const date = `${parts.find(p => p.type === "day").value}-${parts.find(p => p.type === "month").value}-${parts.find(p => p.type === "year").value}`;
  
  return `${time}-${date}`;
}
// Export functions for use in other modules
module.exports = {
  getShortTime,
  getMidTime,
  getLongTime,
  formattedDate
};
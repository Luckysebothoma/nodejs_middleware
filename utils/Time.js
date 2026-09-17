// timeUtils.js

const defaultTimezone = 'Africa/Johannesburg';

/**
 * Returns short time format (HH:MM) in Africa/Johannesburg timezone
 */
function getShortTime(date = new Date()) {
  return date.toLocaleTimeString('en-ZA', {
    timeZone: defaultTimezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

/**
 * Returns medium time format (HH:MM:SS) in Africa/Johannesburg timezone
 */
function getMidTime(date = new Date()) {
  return date.toLocaleTimeString('en-ZA', {
    timeZone: defaultTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
}

/**
 * Returns long time format (HH:MM:SS AM/PM with timezone) in Africa/Johannesburg
 */
function getLongTime(date = new Date()) {
  return date.toLocaleTimeString('en-ZA', {
    timeZone: defaultTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
    timeZoneName: 'short'
  });
}

/**
 * Returns full formatted date-time string in HH:MM:SS-DD-MM-YYYY (Africa/Johannesburg)
 */
function formattedDate(date = new Date()) {
  const options = {
    timeZone: defaultTimezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour12: false
  };

  const formatter = new Intl.DateTimeFormat('en-ZA', options);
  const parts = formatter.formatToParts(date);

  const getPart = type => parts.find(p => p.type === type)?.value || '00';

  const time = `${getPart('hour')}:${getPart('minute')}:${getPart('second')}`;
  const dateStr = `${getPart('day')}-${getPart('month')}-${getPart('year')}`;

  return `${time}-${dateStr}`;
}

/**
 * Normalizes any input into a valid JavaScript Date object
 */
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const date = new Date(value);
    return isNaN(date.getTime()) ? new Date() : date;
  }
  return new Date();
}

/**
 * Formats any date input into MySQL/PostgreSQL compatible 'YYYY-MM-DD HH:MM:SS' 
 * strictly adhering to the Africa/Johannesburg timezone.
 */
function toSqlFormat(dateInput = new Date()) {
  const date = toDate(dateInput);

  const options = {
    timeZone: defaultTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  };

  const formatter = new Intl.DateTimeFormat('en-US', options);
  const parts = formatter.formatToParts(date);
  const partMap = {};
  
  for (const part of parts) {
    if (part.type !== 'literal') {
      partMap[part.type] = part.value;
    }
  }

  return `${partMap.year}-${partMap.month}-${partMap.day} ${partMap.hour}:${partMap.minute}:${partMap.second}`;
}

export default {
  getShortTime,
  getMidTime,
  getLongTime,
  formattedDate,
  toDate,
  toSqlFormat
};
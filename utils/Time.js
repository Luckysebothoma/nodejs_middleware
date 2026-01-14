/**
 * Time formatting utility functions
 * Returns formatted time strings in different levels of detail
 */

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

function normalizeClientDateTime_old(input) {

  const d = input instanceof Date ? input : new Date(input);

  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid client datetime: ${input}`);
  }

  const pad = (n) => String(n).padStart(2, '0');

  return (
    d.getFullYear() + '-' +
    pad(d.getMonth() + 1) + '-' +
    pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' +
    pad(d.getSeconds())
  );
}

function normalizeClientDateTime(input) {
    // Convert input into Date object if it's not already a Date
    const d = input instanceof Date ? input : new Date(input);

    // Check for invalid date
    if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid client datetime: ${input}`);
    }

    // Pad single-digit numbers with leading zeros (e.g., 5 -> 05)
    const pad = (n) => String(n).padStart(2, '0');

    // Return date in the format "YYYY-MM-DD HH:MM:SS"
    return (
        d.getFullYear() + '-' +
        pad(d.getMonth() + 1) + '-' +
        pad(d.getDate()) + ' ' +
        pad(d.getHours()) + ':' +
        pad(d.getMinutes()) + ':' +
        pad(d.getSeconds())
    );
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

export default {
  getShortTime,
  getMidTime,
  getLongTime,
  formattedDate,
  normalizeClientDateTime
};
/*

// +++++++++++++++++++++++++++++++++++++++++++++++++++++++


// dateTimeService.js
const { DateTimeFormat } = Intl;

class DateTimeService {
  constructor(timezone = 'Africa/Johannesburg') {
    this.defaultTimezone = timezone;
  }

  toDate(value) {
    if (value instanceof Date) return value;
    if (typeof value === 'number') return new Date(value);
    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  normalizeDate(value) {
    const date = this.toDate(value);
    return date ? date : new Date();
  }

  formatDate(value, format = 'dd-mm-yyyy', timezone = this.defaultTimezone) {
    const date = this.normalizeDate(value);

    const formatter = new DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const partMap = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        partMap[part.type] = part.value;
      }
    }

    const year = partMap.year;
    const month = partMap.month;
    const day = partMap.day;
    const hour = partMap.hour;
    const minute = partMap.minute;
    const second = partMap.second;

    switch (format) {
      case 'dd-mm-yyyy':
        return `${day}-${month}-${year}`;
      case 'mysql':
        return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
      case 'full':
        const fullDate = new DateTimeFormat('en-US', {
          timeZone: timezone,
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }).format(date);
        return `${fullDate} ${hour}:${minute}:${second}`;
      default:
        return date.toISOString();
    }
  }

  formatPartial(value, part = 'date', timezone = this.defaultTimezone) {
    const date = this.normalizeDate(value);

    const formatter = new DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const parts = formatter.formatToParts(date);
    const result = {};
    for (const part of parts) {
      if (part.type !== 'literal') result[part.type] = part.value;
    }

    if (part === 'date') {
      return `${result.year}-${result.month}-${result.day}`;
    }

    return `${result.hour}:${result.minute}:${result.second}`;
  }
}

module.exports = new DateTimeService();


*/
// Time.js

const defaultTimezone = 'Africa/Johannesburg';

// Africa/Johannesburg has no DST, so its offset is always +02:00.
const SAST_OFFSET = '+02:00';

// One shared formatter. `hourCycle: 'h23'` (instead of `hour12: false`) avoids
// the known ICU quirk where midnight is rendered as "24:00:00".
const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: defaultTimezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function getParts(date) {
  const map = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) {
    if (type !== 'literal') map[type] = value;
  }
  return map;
}

// "2026-09-21", "2026-09-21 14:30", "2026-09-21T14:30:05", "2026-09-21 14:30:05.123"
// i.e. ISO-style values with NO timezone information.
const NAIVE_DATETIME = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;

/**
 * Strict parser. Returns a valid Date, or null if the input can't be parsed.
 *
 * - Date / number (ms): used as-is.
 * - 10-digit string: unix seconds. 13-digit string: unix milliseconds.
 * - ISO-style string WITHOUT a timezone: interpreted as Africa/Johannesburg
 *   time, so the result doesn't depend on the server's own timezone.
 * - Anything with an explicit offset / "Z": parsed as given.
 */
function parseDate(value) {
  let date;

  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;

    if (/^\d{10}$/.test(s)) {
      date = new Date(Number(s) * 1000);
    } else if (/^\d{13}$/.test(s)) {
      date = new Date(Number(s));
    } else {
      const m = NAIVE_DATETIME.exec(s);
      date = m
        ? new Date(`${m[1]}T${m[2] ?? '00:00'}:${m[3] ?? '00'}${SAST_OFFSET}`)
        : new Date(s);
    }
  } else {
    return null;
  }

  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Lenient normaliser: valid input -> Date, anything invalid -> now.
 * (Use parseDate / toSqlFormatOrNull when you need to reject bad input.)
 */
function toDate(value) {
  return parseDate(value) ?? new Date();
}

/**
 * Returns short time format (HH:MM) in Africa/Johannesburg timezone
 */
function getShortTime(date = new Date()) {
  const p = getParts(toDate(date));
  return `${p.hour}:${p.minute}`;
}

/**
 * Returns medium time format (HH:MM:SS) in Africa/Johannesburg timezone
 */
function getMidTime(date = new Date()) {
  const p = getParts(toDate(date));
  return `${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Returns long time format (HH:MM:SS AM/PM with timezone) in Africa/Johannesburg
 */
function getLongTime(date = new Date()) {
  return toDate(date).toLocaleTimeString('en-ZA', {
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
  const p = getParts(toDate(date));
  return `${p.hour}:${p.minute}:${p.second}-${p.day}-${p.month}-${p.year}`;
}

/**
 * Formats any date input into MySQL/PostgreSQL compatible 'YYYY-MM-DD HH:MM:SS'
 * in the Africa/Johannesburg timezone.
 * Invalid input falls back to the current time (legacy behaviour).
 */
function toSqlFormat(dateInput = new Date()) {
  const p = getParts(toDate(dateInput));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/**
 * Same as toSqlFormat, but returns null for invalid input instead of
 * silently substituting "now". Use this for validating request payloads.
 */
function toSqlFormatOrNull(dateInput) {
  const date = parseDate(dateInput);
  return date ? toSqlFormat(date) : null;
}

export default {
  getShortTime,
  getMidTime,
  getLongTime,
  formattedDate,
  parseDate,
  toDate,
  toSqlFormat,
  toSqlFormatOrNull
};
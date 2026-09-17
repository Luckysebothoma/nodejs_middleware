/**
 * Normalize a JS Date / ISO string / MySQL datetime string into
 * MySQL DATETIME format: 'YYYY-MM-DD HH:MM:SS' (UTC).
 */
const MYSQL_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export const formatForMySQL = (dateInput) => {
    const toUTC = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

    if (dateInput == null || dateInput === '') return toUTC(new Date());

    if (typeof dateInput === 'string' && MYSQL_DATETIME_RE.test(dateInput.trim())) {
        return dateInput.trim();
    }

    const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
    return isNaN(date.getTime()) ? toUTC(new Date()) : toUTC(date);
};

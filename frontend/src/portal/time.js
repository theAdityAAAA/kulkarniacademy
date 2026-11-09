// Time-zone helpers. All class times are stored in UTC and shown in each viewer's own zone.

export const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const format = (date, timeZone, options) => new Intl.DateTimeFormat(undefined, { timeZone, ...options }).format(new Date(date));
export const dayLabel = (date, timeZone = localZone) => format(date, timeZone, { weekday: 'short', day: 'numeric', month: 'short' });
export const timeLabel = (date, timeZone = localZone) => format(date, timeZone, { hour: 'numeric', minute: '2-digit' });
export const dateTimeLabel = (date, timeZone = localZone) => `${dayLabel(date, timeZone)}, ${timeLabel(date, timeZone)}`;
const renamed = { Calcutta: 'Kolkata', Saigon: 'Ho Chi Minh', Kiev: 'Kyiv', Rangoon: 'Yangon', Katmandu: 'Kathmandu' };
export const placeName = (timeZone) => { const city = timeZone.split('/').pop().replace(/_/g, ' '); return renamed[city] ?? city; };
export const dayKey = (date, timeZone = localZone) => format(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });

export function relativeLabel(date, now) {
  const diff = new Date(date).getTime() - now;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(diff / 3600000);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(diff / 86400000), 'day');
}

// Offset (ms) between UTC and the wall clock of timeZone at the given instant.
function offsetAt(instant, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** "2026-11-12T17:00" read as a wall-clock time in timeZone → a real Date. Handles daylight-saving changes. */
export function zonedToDate(localValue, timeZone) {
  const [datePart, timePart] = localValue.split('T');
  const [y, m, d] = datePart.split('-').map(Number);
  const [h, min] = timePart.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  const firstOffset = offsetAt(new Date(guess), timeZone);
  let utc = guess - firstOffset;
  const secondOffset = offsetAt(new Date(utc), timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

/** Adds whole days to a "YYYY-MM-DDTHH:mm" value, keeping the same wall-clock time. */
export function addDays(localValue, days) {
  const [datePart, timePart] = localValue.split('T');
  const date = new Date(`${datePart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.toISOString().slice(0, 10)}T${timePart}`;
}

const common = ['Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Singapore', 'Asia/Dubai', 'Asia/Kolkata', 'Australia/Sydney', 'Europe/Berlin', 'Asia/Hong_Kong', 'Africa/Johannesburg'];
const all = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : common;
export const commonZones = common;
export const otherZones = all.filter((zone) => !common.includes(zone));
export const isValidZone = (zone) => { try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true; } catch { return false; } };

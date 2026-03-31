// Utils Library — date formatting and helpers

/**
 * Format a date as a readable string (e.g., "Jan 15, 2025").
 * @param {Date|string} date - Date to format
 * @returns {string}
 */
export function formatDate(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format a date as a time string (e.g., "14:30").
 * @param {Date|string} date - Date to format
 * @param {string} [tz] - Optional timezone
 * @returns {string}
 */
export function formatTime(date, tz) {
  if (!date) return '--:--';
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '--:--';
  try {
    const opts = {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    };
    if (tz) opts.timeZone = tz;
    const parts = new Intl.DateTimeFormat('en-GB', opts).formatToParts(d);
    const h = parts.find((p) => p.type === 'hour').value;
    const m = parts.find((p) => p.type === 'minute').value;
    return `${h}:${m}`;
  } catch {
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }
}

/**
 * WhatsApp-style relative time display.
 * @param {Date|string} dateStr - Date to format
 * @returns {string}
 */
export function timeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

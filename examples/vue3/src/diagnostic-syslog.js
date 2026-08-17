export const SYSLOG_LEVELS = Object.freeze([
  { value: 0, name: 'Emerg' },
  { value: 1, name: 'Alert' },
  { value: 2, name: 'Crit' },
  { value: 3, name: 'Err' },
  { value: 4, name: 'Warning' },
  { value: 5, name: 'Notice' },
  { value: 6, name: 'Info' },
  { value: 7, name: 'Debug' },
]);

export const DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL = 6;

export const CHAT_LOG_BUFFER_LIMIT = 1000;
export const DIAGNOSTIC_LOG_BUFFER_LIMIT = 5000;

export function appendBoundedLogEntry(entries, entry, maximumEntries) {
  if (!Array.isArray(entries)) {
    throw new TypeError('Log buffer must be an array');
  }

  const limit = Math.max(0, Math.floor(Number(maximumEntries) || 0));
  if (limit === 0) return entries;

  entries.push(entry);
  const overflow = entries.length - limit;
  if (overflow > 0) entries.splice(0, overflow);
  return entries;
}

export const DIAGNOSTIC_SOURCE_FILTERS = Object.freeze([
  { value: 'all', name: 'All' },
  { value: 'freertc', name: 'FreeRTC' },
  { value: 'system', name: 'System' },
  { value: 'peer', name: 'Peer' },
  { value: 'duplicate', name: 'Duplicate' },
  { value: 'custom', name: 'Custom' },
]);

const DIAGNOSTIC_SOURCE_FILTER_VALUES = new Set(
  DIAGNOSTIC_SOURCE_FILTERS.map(({ value }) => value),
);

const NON_PEER_DIAGNOSTIC_SENDERS = new Set([
  'system',
  'freertc',
  'signal',
  'debug',
  'crypto',
]);

const SYSLOG_NAME_TO_LEVEL = Object.freeze({
  emergency: 0,
  emerg: 0,
  panic: 0,
  alert: 1,
  critical: 2,
  crit: 2,
  error: 3,
  err: 3,
  warning: 4,
  warn: 4,
  notice: 5,
  informational: 6,
  information: 6,
  info: 6,
  debug: 7,
});

export function normalizeSyslogLevel(value, fallback = DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL) {
  if (typeof value === 'string') {
    const named = SYSLOG_NAME_TO_LEVEL[value.trim().toLowerCase()];
    if (named != null) return named;
  }

  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 7) return numeric;
  return fallback;
}

export function inferDiagnosticSyslogLevel(entry = {}) {
  if (entry.syslogLevel != null) return normalizeSyslogLevel(entry.syslogLevel);

  const type = String(entry.type || '').trim().toLowerCase();
  const sender = String(entry.sender || '').trim().toLowerCase();
  const text = String(entry.text || '').trim().toLowerCase();

  // "Non-fatal" is an explicit severity statement. It must win over generic
  // keyword matching for "fatal" or "error" later in the same message.
  if (/\bnon[-\s]?fatal\b/.test(text)) return 6;
  if (/\b(emergency|emerg|panic)\b/.test(text)) return 0;
  if (/\balert\b/.test(text)) return 1;
  if (/\b(critical|crit|fatal)\b/.test(text)) return 2;
  if (type === 'error' || /\b(error|failed|failure|exception)\b/.test(text)) return 3;
  if (
    type === 'disconnected'
    || /\b(warning|warn|offline|timeout|timed out|degraded|stale|unavailable|dropped|issue)\b/.test(text)
  ) return 4;
  if (
    sender === 'debug'
    || sender === 'freertc'
    || text.startsWith('[signal]')
    || text.startsWith('[webrtc]')
    || /\bice_(candidate|end)\b/.test(text)
  ) return 7;
  if (
    type === 'signaling'
    || type === 'connected'
    || type === 'discovered'
    || /\b(connected|disconnected|discovered|registered|reconnecting|re-announcing|started|stopped)\b/.test(text)
  ) return 5;
  return 6;
}

export function diagnosticEntryVisible(entry, maximumLevel = DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL) {
  return inferDiagnosticSyslogLevel(entry) <= normalizeSyslogLevel(maximumLevel);
}

export function normalizeDiagnosticSourceFilter(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return DIAGNOSTIC_SOURCE_FILTER_VALUES.has(normalized) ? normalized : 'all';
}

export function diagnosticEntryMatchesSource(entry = {}, filter = 'all', customSearch = '') {
  const normalizedFilter = normalizeDiagnosticSourceFilter(filter);
  const sender = String(entry.sender || '').trim();
  const normalizedSender = sender.toLowerCase();

  if (normalizedFilter === 'all') return true;
  if (normalizedFilter === 'freertc') return normalizedSender === 'freertc';
  if (normalizedFilter === 'system') return normalizedSender === 'system';
  if (normalizedFilter === 'peer') {
    return Boolean(sender && !NON_PEER_DIAGNOSTIC_SENDERS.has(normalizedSender));
  }
  if (normalizedFilter === 'duplicate') return true;

  const query = String(customSearch || '').trim().toLowerCase();
  if (!query) return true;
  return [entry.sender, entry.type, entry.text, entry.syslogLevel]
    .map((value) => String(value ?? '').toLowerCase())
    .some((value) => value.includes(query));
}

export function collapseDuplicateDiagnosticEntries(entries = []) {
  const groups = new Map();

  entries.forEach((entry, index) => {
    const key = JSON.stringify([
      String(entry?.sender || '').trim().toLowerCase(),
      String(entry?.type || '').trim().toLowerCase(),
      inferDiagnosticSyslogLevel(entry),
      String(entry?.text || '').trim(),
    ]);
    const existing = groups.get(key);
    groups.set(key, {
      entry,
      count: (existing?.count || 0) + 1,
      latestIndex: index,
    });
  });

  return [...groups.values()]
    .filter(({ count }) => count > 1)
    .sort((a, b) => a.latestIndex - b.latestIndex)
    .map(({ entry, count }) => ({
      ...entry,
      duplicateCount: count,
    }));
}

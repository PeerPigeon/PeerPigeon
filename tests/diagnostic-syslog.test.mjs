import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CHAT_LOG_BUFFER_LIMIT,
  DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL,
  DIAGNOSTIC_LOG_BUFFER_LIMIT,
  DIAGNOSTIC_SOURCE_FILTERS,
  SYSLOG_LEVELS,
  appendBoundedLogEntry,
  collapseDuplicateDiagnosticEntries,
  diagnosticEntryMatchesSource,
  diagnosticEntryVisible,
  inferDiagnosticSyslogLevel,
  normalizeSyslogLevel,
} from '../examples/vue3/src/diagnostic-syslog.js';

test('chat and diagnostics use independent bounded buffers', () => {
  assert.equal(CHAT_LOG_BUFFER_LIMIT, 1000);
  assert.equal(DIAGNOSTIC_LOG_BUFFER_LIMIT, 5000);

  const entries = [];
  appendBoundedLogEntry(entries, 'one', 2);
  appendBoundedLogEntry(entries, 'two', 2);
  appendBoundedLogEntry(entries, 'three', 2);
  assert.deepEqual(entries, ['two', 'three']);
});

test('diagnostic verbosity uses the complete RFC syslog severity ladder', () => {
  assert.deepEqual(SYSLOG_LEVELS.map(({ value, name }) => [value, name]), [
    [0, 'Emerg'],
    [1, 'Alert'],
    [2, 'Crit'],
    [3, 'Err'],
    [4, 'Warning'],
    [5, 'Notice'],
    [6, 'Info'],
    [7, 'Debug'],
  ]);
  assert.equal(DEFAULT_DIAGNOSTIC_SYSLOG_LEVEL, 6);
});

test('a selected syslog level includes itself and every more-severe entry', () => {
  const warning = { syslogLevel: 4 };
  const notice = { syslogLevel: 5 };

  assert.equal(diagnosticEntryVisible(warning, 4), true);
  assert.equal(diagnosticEntryVisible(notice, 4), false);
  assert.equal(diagnosticEntryVisible(notice, 5), true);
  assert.equal(diagnosticEntryVisible({ syslogLevel: 0 }, 0), true);
  assert.equal(diagnosticEntryVisible({ syslogLevel: 7 }, 7), true);
});

test('legacy diagnostic entries receive stable syslog severities', () => {
  assert.equal(inferDiagnosticSyslogLevel({ type: 'error', text: 'Non-fatal ICE candidate error' }), 6);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', text: '[webrtc] nonfatal error' }), 6);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', text: 'Fatal relay failure' }), 2);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', text: 'Peer error: closed' }), 3);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'disconnected', text: 'Disconnected from peer' }), 4);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'connected', text: 'Connected to peer' }), 5);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', text: 'Mesh stopped' }), 5);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', sender: 'freertc', text: '[signal] incoming offer' }), 7);
  assert.equal(inferDiagnosticSyslogLevel({ type: 'info', text: 'Storage ready' }), 6);
  assert.equal(normalizeSyslogLevel('warn'), 4);
  assert.equal(normalizeSyslogLevel('debug'), 7);
});

test('diagnostic source filters distinguish FreeRTC, System, peers, and custom text', () => {
  assert.deepEqual(DIAGNOSTIC_SOURCE_FILTERS.map(({ value }) => value), [
    'all',
    'freertc',
    'system',
    'peer',
    'duplicate',
    'custom',
  ]);

  const freertc = { sender: 'freertc', type: 'info', text: '[signal] incoming offer', syslogLevel: 7 };
  const system = { sender: 'System', type: 'info', text: 'Mesh stopped', syslogLevel: 5 };
  const peer = { sender: 'a75641', type: 'connected', text: 'Connected to peer', syslogLevel: 5 };

  assert.equal(diagnosticEntryMatchesSource(freertc, 'freertc'), true);
  assert.equal(diagnosticEntryMatchesSource(system, 'freertc'), false);
  assert.equal(diagnosticEntryMatchesSource(system, 'system'), true);
  assert.equal(diagnosticEntryMatchesSource(peer, 'peer'), true);
  assert.equal(diagnosticEntryMatchesSource(freertc, 'peer'), false);
  assert.equal(diagnosticEntryMatchesSource(peer, 'custom', 'a756'), true);
  assert.equal(diagnosticEntryMatchesSource(freertc, 'custom', 'incoming offer'), true);
  assert.equal(diagnosticEntryMatchesSource(system, 'custom', 'connected'), false);
  assert.equal(diagnosticEntryMatchesSource(system, 'custom', ''), true);
});

test('duplicate diagnostics collapse after verbosity filtering and retain the latest occurrence', () => {
  const entries = [
    { sender: 'System', type: 'error', text: 'Relay failed', syslogLevel: 3, timestamp: 1 },
    { sender: 'System', type: 'info', text: 'Peer offline', syslogLevel: 4, timestamp: 2 },
    { sender: 'System', type: 'error', text: 'Relay failed', syslogLevel: 3, timestamp: 3 },
    { sender: 'System', type: 'info', text: 'Only once', syslogLevel: 3, timestamp: 4 },
    { sender: 'System', type: 'info', text: 'Peer offline', syslogLevel: 4, timestamp: 5 },
    { sender: 'System', type: 'error', text: 'Relay failed', syslogLevel: 3, timestamp: 6 },
  ];

  const errorDuplicates = collapseDuplicateDiagnosticEntries(
    entries.filter((entry) => diagnosticEntryVisible(entry, 3)),
  );
  assert.deepEqual(errorDuplicates.map(({ text, timestamp, duplicateCount }) => (
    [text, timestamp, duplicateCount]
  )), [
    ['Relay failed', 6, 3],
  ]);

  const warningDuplicates = collapseDuplicateDiagnosticEntries(
    entries.filter((entry) => diagnosticEntryVisible(entry, 4)),
  );
  assert.deepEqual(warningDuplicates.map(({ text, duplicateCount }) => [text, duplicateCount]), [
    ['Peer offline', 2],
    ['Relay failed', 3],
  ]);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
let browserTabs = [];
const makeEvent = () => {
  const listeners = new Set();
  return { addListener: listener => listeners.add(listener), removeListener: listener => listeners.delete(listener), emit: () => { for (const listener of listeners) void listener(); }, listeners };
};
globalThis.__mockBrowser = { tabs: { query: async () => browserTabs,
  ...Object.fromEntries(['onUpdated', 'onRemoved', 'onCreated', 'onReplaced', 'onAttached', 'onDetached'].map(name => [name, makeEvent()])),
} };
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'wxt/browser') return { url: 'data:text/javascript,export const browser = globalThis.__mockBrowser;', shortCircuit: true };
  return next(specifier, context);
}});
const { getOpenTabs, tabLabel, watchOpenTabs } = await import('../lib/tabs.ts');
const { sanitizeUrl, isEligibleTab, countSkippedTabs, prepareTabs, validateSuggestion, tabFingerprint } = await import('../lib/grouping.ts');
const { requestSuggestions, REQUEST_TIMEOUT_MS } = await import('../lib/api.ts');
const tabs = [{ id: 1, windowId: 1, title: 'One', url: 'https://user:secret@example.com/private?q=secret#fragment' }, { id: 2, windowId: 1, title: 'Two', url: 'https://example.org/path' }];
const valid = { groups: [{ name: 'Research', tabIds: [1, 2] }], ungroupedTabIds: [] };
const response = (value, status = 200) => new Response(JSON.stringify(value), { status });
test('mock browser collects all tabs and substitutes missing titles', async () => {
  browserTabs = [{ id: 1, windowId: 2, url: 'https://example.com' }];
  assert.deepEqual(await getOpenTabs(), [{ id: 1, windowId: 2, title: 'Untitled tab', url: 'https://example.com' }]);
});
test('origin-only sanitization including credentials, ports, and invalid protocols', () => {
  assert.equal(sanitizeUrl(tabs[0].url), 'https://example.com');
  assert.equal(sanitizeUrl('http://user:pass@localhost:3000/path'), 'http://localhost:3000');
  for (const url of [undefined, '', 'broken', 'chrome://extensions', 'file:///private', 'data:text/plain,hello']) assert.equal(sanitizeUrl(url), null);
});
test('skips invalid IDs and URLs, fills titles, and never silently truncates', () => {
  const result = prepareTabs([...tabs, { id: undefined, title: 'Missing' }, { id: 3, url: 'chrome://newtab' }, { id: -1, url: 'https://x.com' }, { id: 4, title: ' ', url: 'https://x.com' }]);
  assert.equal(result.skipped, 3); assert.equal(result.tabs[2].title, 'Untitled tab');
  assert.throws(() => prepareTabs([...tabs, tabs[0]]), /Duplicate/);
  assert.throws(() => prepareTabs(Array.from({ length: 101 }, (_, id) => ({ ...tabs[0], id }))), /100/);
  assert.throws(() => prepareTabs([{ ...tabs[0], title: 'x'.repeat(301) }]), /limits/);
  assert.throws(() => prepareTabs([{ ...tabs[0], title: 'bad\ntext' }]), /unsupported/);
  assert.throws(() => prepareTabs([{ ...tabs[0], url: 'https://' + 'x'.repeat(2050) + '.com' }]), /limits/);
  assert.throws(() => prepareTabs(Array.from({ length: 100 }, (_, id) => ({ ...tabs[0], id, title: '界'.repeat(300) }))), /65,536/);
});
test('skipped count is available before a request, even with oversized input', () => {
  assert.equal(countSkippedTabs(tabs), 0);
  assert.equal(countSkippedTabs([...tabs, { id: 3, url: 'chrome://extensions' }, { id: undefined, url: 'https://example.com' }, { id: 4 }]), 3);
  assert.equal(countSkippedTabs([{ ...tabs[0], title: 'x'.repeat(301) }, { id: 4 }]), 1);
});
test('response validation rejects malformed, unknown, and duplicate assignments', () => {
  const input = prepareTabs(tabs).tabs;
  assert.deepEqual(validateSuggestion(valid, input), valid);
  assert.deepEqual(validateSuggestion({ groups: [], ungroupedTabIds: [] }, input).ungroupedTabIds, [1, 2]);
  for (const value of [null, {}, { ...valid, extra: true }, { groups: [{ name: '', tabIds: [1, 2] }], ungroupedTabIds: [] }, { groups: [{ name: 'One', tabIds: [1] }], ungroupedTabIds: [] }, { groups: [{ name: 'Unknown', tabIds: [1, 99] }], ungroupedTabIds: [] }, { ...valid, ungroupedTabIds: [1] }, { groups: [], ungroupedTabIds: [1, 1] }, { groups: [{ name: 'x'.repeat(81), tabIds: [1, 2] }], ungroupedTabIds: [] }]) assert.throws(() => validateSuggestion(value, input), /malformed/);
});
test('POST body contains sanitized metadata only', async () => {
  const result = await requestSuggestions(tabs, 'http://127.0.0.1:3000', async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:3000/api/group-tabs');
    assert.equal(options.method, 'POST'); assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), { tabs: [{ id: 1, title: 'One', url: 'https://example.com' }, { id: 2, title: 'Two', url: 'https://example.org' }] });
    return response(valid);
  });
  assert.deepEqual(result.suggestion, valid);
});
test('invalid configuration and limits fail before fetch', async () => {
  const never = async () => { assert.fail('must not fetch'); };
  await assert.rejects(requestSuggestions(tabs, undefined, never), /missing/);
  for (const base of ['bad', 'file:///a', 'https://user:secret@x.com', 'https://x.com/path', 'https://x.com?q=x']) await assert.rejects(requestSuggestions(tabs, base, never), /origin/);
  await assert.rejects(requestSuggestions([], 'http://127.0.0.1:3000', never), /No tabs to organize/);
  await assert.rejects(requestSuggestions([{ ...tabs[0], title: 'x'.repeat(301) }], 'http://127.0.0.1:3000', never), /limits/);
});
test('network, HTTP, and malformed JSON failures are readable and never echo metadata', async () => {
  await assert.rejects(requestSuggestions(tabs, 'http://127.0.0.1:3000', async () => { throw new Error('secret'); }), /connect to the suggestion service/);
  for (const [status, expected] of [[429, /Too many/], [413, /too large/], [400, /rejected/], [503, /unavailable/], [504, /timed out/], [500, /could not generate/]]) await assert.rejects(requestSuggestions(tabs, 'http://127.0.0.1:3000', async () => response({ error: 'secret' }, status)), expected);
  await assert.rejects(requestSuggestions(tabs, 'http://127.0.0.1:3000', async () => new Response('not JSON')), /malformed/);
  await assert.rejects(requestSuggestions(tabs, 'http://127.0.0.1:3000', async () => response({})), /malformed/);
});
test('bounded timeout allows backend twenty-second timeout and aborts fetch', async () => {
  assert.ok(REQUEST_TIMEOUT_MS > 20_000 && REQUEST_TIMEOUT_MS <= 35_000);
  await assert.rejects(requestSuggestions(tabs, 'http://127.0.0.1:3000', async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })), 5), /timed out/);
});
test('snapshot comparison detects closed, renamed, navigated and moved tabs', () => {
  assert.equal(tabFingerprint(tabs), tabFingerprint([...tabs].reverse()));
  for (const changed of [tabs.slice(1), [{ ...tabs[0], title: 'New' }, tabs[1]], [{ ...tabs[0], url: 'https://example.com/new' }, tabs[1]], [{ ...tabs[0], windowId: 2 }, tabs[1]]]) assert.notEqual(tabFingerprint(tabs), tabFingerprint(changed));
});

test('local labels distinguish GitHub repositories, searches, and ordinary pages', () => {
  assert.equal(tabLabel({ title: 'GitHub', url: 'https://github.com/example-user/example-project/tree/main?token=fake-test-value' }), 'example-user/example-project — github.com');
  assert.equal(tabLabel({ title: 'personal website examples - Google Search', url: 'https://www.google.com/search?q=personal+website+examples' }), 'personal website examples - Google Search — google.com');
  assert.equal(tabLabel({ title: 'Guide', url: 'https://docs.example.com/path?token=fake-test-value' }), 'Guide — docs.example.com');
  assert.equal(tabLabel({ title: 'Extensions', url: 'chrome://extensions' }), 'Extensions');
  assert.equal(tabLabel({ title: '', url: undefined }), 'Untitled tab');
});
test('live tab list refreshes on events before any suggestion request', async () => {
  const api = globalThis.__mockBrowser.tabs;
  const originalQuery = api.query;
  const updates = [];
  let failures = 0;
  const flush = () => new Promise(resolve => setImmediate(resolve));
  browserTabs = [{ id: 1, windowId: 1, title: 'First' }];
  const stop = watchOpenTabs(tabs => updates.push(tabs), () => failures++);
  try {
    await flush(); assert.equal(updates.at(-1).length, 1);
    browserTabs = [...browserTabs, { id: 2, windowId: 1, title: 'Second' }];
    api.onCreated.emit(); await flush(); assert.equal(updates.at(-1).length, 2);
    browserTabs = [{ id: 2, windowId: 1, title: 'Changed', url: 'https://x.com' }];
    api.onRemoved.emit(); api.onUpdated.emit(); await flush();
    assert.equal(updates.at(-1).length, 1); assert.equal(updates.at(-1)[0].title, 'Changed');
    browserTabs = [{ id: 2, windowId: 2, title: 'Changed' }];
    api.onDetached.emit(); api.onAttached.emit(); await flush();
    assert.equal(updates.at(-1)[0].windowId, 2);
    const pending = [];
    api.query = () => new Promise(resolve => pending.push(resolve));
    api.onUpdated.emit(); api.onUpdated.emit();
    pending[1]([{ id: 3, windowId: 1, title: 'Newest' }]); await flush();
    pending[0]([{ id: 4, windowId: 1, title: 'Older' }]); await flush();
    assert.equal(updates.at(-1)[0].title, 'Newest');
    api.query = async () => { throw new Error('Browser failure'); };
    api.onUpdated.emit(); await flush(); assert.equal(failures, 1);
    let finishLate;
    api.query = () => new Promise(resolve => { finishLate = resolve; });
    api.onUpdated.emit();
    const beforeStop = updates.length;
    stop();
    finishLate([{ id: 5, windowId: 1, title: 'After close' }]); await flush();
    assert.equal(updates.length, beforeStop);
    for (const name of ['onUpdated', 'onRemoved', 'onCreated', 'onReplaced', 'onAttached', 'onDetached']) assert.equal(api[name].listeners.size, 0);
    const count = updates.length;
    api.onCreated.emit(); await flush(); assert.equal(updates.length, count);
  } finally { stop(); api.query = originalQuery; }
});

test('eligible list excludes the same tabs shown in the skipped disclosure', () => {
  const input = [...tabs, { id: 3, title: 'Blank', url: 'about:blank' }, { title: 'Missing ID', url: 'https://example.com' }];
  assert.deepEqual(input.filter(isEligibleTab), tabs);
  assert.equal(input.filter(tab => !isEligibleTab(tab)).length, countSkippedTabs(input));
});

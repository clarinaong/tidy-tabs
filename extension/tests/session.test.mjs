import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupApplier } from '../lib/applyGroups.ts';
import { createSessionController } from '../lib/session.ts';
const tabs = [{ id: 1, windowId: 10, title: 'Synthetic React docs', url: 'https://example.test' }, { id: 2, windowId: 10, title: 'Synthetic TypeScript docs', url: 'https://docs.test' }];
const suggestion = { groups: [{ name: 'Development', tabIds: [1, 2] }], ungroupedTabIds: [] };
function harness() {
  let saved; let nextId = 0; let suggestions = 0; let applications = 0;
  const deps = {
    async load() { return structuredClone(saved); },
    async write(state) { saved = structuredClone(state); },
    async readTabs() { return structuredClone(tabs); },
    async readGroups() { return [{ id: 7, windowId: 10, name: 'Existing' }]; },
    async suggest(input, groups) { suggestions++; assert.deepEqual(input, tabs); assert.equal(groups[0].id, 7); return structuredClone(suggestion); },
    async apply(preview) { applications++; assert.ok(saved.applying && saved.consumed); return { kind: 'success', consumed: true, message: 'Applied' }; },
    newId() { return `preview-${++nextId}`; },
  };
  return { deps, get saved() { return saved; }, get suggestions() { return suggestions; }, get applications() { return applications; } };
}
test('closing and reopening restores saved edits and apply status without requesting new AI suggestions', async () => {
  const h = harness(); let handle = createSessionController(h.deps);
  assert.equal((await handle({ action: 'get' })).preview, null);
  let state = await handle({ action: 'suggest' });
  state = await handle({ action: 'save', id: state.preview.id, suggestion: { groups: [{ name: 'Edited', tabIds: [1] }], ungroupedTabIds: [2] } });
  handle = createSessionController(h.deps);
  const restored = await handle({ action: 'get' });
  assert.equal(restored.preview.suggestion.groups[0].name, 'Edited');
  state = await handle({ action: 'apply', id: restored.preview.id });
  handle = createSessionController(h.deps);
  assert.equal((await handle({ action: 'get' })).outcome.kind, 'success');
  await handle({ action: 'apply', id: state.preview.id });
  assert.equal(h.suggestions, 1); assert.equal(h.applications, 1);
});
test('background application continues when the originating view closes; concurrent views cannot duplicate it', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const ready = await handle({ action: 'suggest' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const apply = h.deps.apply;
  h.deps.apply = async preview => { await gate; return apply(preview); };
  const pending = handle({ action: 'apply', id: ready.preview.id });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await handle({ action: 'get' })).applying, true);
  await handle({ action: 'apply', id: ready.preview.id });
  await handle({ action: 'suggest' });
  release(); assert.equal((await pending).outcome.kind, 'success');
  assert.equal(h.applications, 1); assert.equal(h.suggestions, 1);
});
test('interrupted application is restored as uncertain and consumed, never automatically retried', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const state = await handle({ action: 'suggest' });
  await h.deps.write({ ...state, applying: true, consumed: true });
  const restored = createSessionController(h.deps);
  const next = await restored({ action: 'get' });
  assert.equal(next.outcome.kind, 'partial'); assert.equal(next.consumed, true);
  await restored({ action: 'apply', id: next.preview.id });
  assert.equal(h.applications, 0);
});
test('preflight stale outcomes remain retryable; refresh replaces an already consumed preview', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  let state = await handle({ action: 'suggest' });
  h.deps.apply = async () => ({ kind: 'stale', consumed: false, message: 'Refresh' });
  state = await handle({ action: 'apply', id: state.preview.id });
  assert.equal(state.consumed, false);
  const oldId = state.preview.id;
  state = await handle({ action: 'suggest' });
  assert.notEqual(state.preview.id, oldId); assert.equal(state.outcome, null);
  await handle({ action: 'apply', id: oldId });
  assert.equal(h.applications, 0);
});
test('storage failure before applying sends no Chrome mutation request', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const state = await handle({ action: 'suggest' });
  const write = h.deps.write;
  h.deps.write = async next => { if (next.applying) throw new Error('Storage unavailable'); return write(next); };
  const failed = await handle({ action: 'apply', id: state.preview.id });
  assert.equal(h.applications, 0); assert.equal(failed.consumed, false);
  assert.equal(failed.error, 'Storage unavailable');
});
test('suggestion provider failure is visible and retains the previous saved preview', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const state = await handle({ action: 'suggest' });
  h.deps.suggest = async () => { throw new Error('Synthetic provider failure'); };
  const failed = await handle({ action: 'suggest' });
  assert.equal(failed.preview.id, state.preview.id); assert.equal(failed.pending, false);
  assert.equal(failed.error, 'Synthetic provider failure');
});

test('storage-change readers see published state and conflicting saves cannot race', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const state = await handle({ action: 'suggest' });
  const original = h.deps.write;
  let observed; let release; const gate = new Promise(resolve => { release = resolve; });
  h.deps.write = async next => { observed = await handle({ action: 'get' }); await gate; return original(next); };
  const pending = handle({ action: 'save', id: state.preview.id, suggestion: { ...suggestion, groups: [{ name: 'Published', tabIds: [1, 2] }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(observed.preview.suggestion.groups[0].name, 'Published');
  await assert.rejects(handle({ action: 'save', id: state.preview.id, suggestion }), /Wait/);
  release(); await pending;
});

test('stale preview is blocked; edit includes new pages and saved manual review permits grouping without AI', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const original = await handle({ action: 'suggest' });
  const current = [...tabs, { id: 3, windowId: 20, title: 'Synthetic new page', url: 'https://new.test' }];
  h.deps.readTabs = async () => current;
  const blocked = await handle({ action: 'apply', id: original.preview.id });
  assert.equal(blocked.outcome.kind, 'stale'); assert.equal(h.applications, 0);
  const editing = await handle({ action: 'edit', id: original.preview.id });
  assert.deepEqual(editing.editor.suggestion.ungroupedTabIds, [3]);
  assert.equal(editing.editor.tabs.length, 3);
  const edited = { groups: [{ name: 'Manually reviewed', tabIds: [1, 2, 3] }], ungroupedTabIds: [] };
  const saved = await handle({ action: 'save', id: original.preview.id, reviewed: editing.editor, suggestion: edited });
  assert.notEqual(saved.preview.id, original.preview.id); assert.equal(saved.outcome, null);
  assert.equal(saved.consumed, false);
  const applied = await handle({ action: 'apply', id: saved.preview.id });
  assert.equal(applied.outcome.kind, 'success'); assert.equal(h.applications, 1);
  assert.equal(h.suggestions, 1);
});
test('opening and canceling edit leaves the original preview and grouping status untouched', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const original = await handle({ action: 'suggest' });
  h.deps.readTabs = async () => [{ ...tabs[0], title: 'Synthetic changed title' }];
  await handle({ action: 'edit', id: original.preview.id });
  const state = await handle({ action: 'get' });
  assert.deepEqual(state, original); assert.equal(h.applications, 0); assert.equal(h.suggestions, 1);
});
test('save-time changes are rejected and Update tabs preserves unsaved assignments without AI', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const original = await handle({ action: 'suggest' });
  const editing = await handle({ action: 'edit', id: original.preview.id });
  const changed = [...tabs, { id: 3, windowId: 10, title: 'New', url: 'https://new.test' }];
  h.deps.readTabs = async () => changed;
  await assert.rejects(handle({ action: 'save', id: original.preview.id, reviewed: editing.editor, suggestion }), /changed again/);
  assert.deepEqual((await handle({ action: 'get' })).preview, original.preview);
  const unsaved = { ...editing.editor, suggestion: { groups: [{ name: 'Manual draft', tabIds: [1] }], ungroupedTabIds: [2] } };
  const updated = await handle({ action: 'edit', id: original.preview.id, draft: unsaved });
  assert.equal(updated.editor.suggestion.groups[0].name, 'Manual draft');
  assert.deepEqual(updated.editor.suggestion.ungroupedTabIds, [2, 3]);
  assert.equal(h.suggestions, 1); assert.equal(h.applications, 0);
});

test('reviewed new and navigated tabs reach the real grouping module, while closed tabs stay untouched', async () => {
  const h = harness(); const current = [
    { ...tabs[0], title: 'Synthetic new topic', url: 'https://example.test/new-topic' },
    { id: 3, windowId: 20, title: 'Synthetic new tab', url: 'https://new.test' },
  ];
  const calls = [];
  h.deps.apply = createGroupApplier({
    readTabs: async () => current,
    readGroups: async () => [{ id: 7, windowId: 10, name: 'Existing' }],
    group: async options => { calls.push(['group', options]); return calls.length + 100; },
    update: async (id, options) => { calls.push(['update', id, options]); },
    ungroup: async ids => { calls.push(['ungroup', ids]); },
  });
  const handle = createSessionController(h.deps);
  const original = await handle({ action: 'suggest' });
  h.deps.readTabs = async () => current;
  const editing = await handle({ action: 'edit', id: original.preview.id });
  assert.deepEqual(editing.editor.suggestion.groups[0].tabIds, []);
  assert.deepEqual(editing.editor.suggestion.ungroupedTabIds, [1, 3]);
  const saved = await handle({ action: 'save', id: original.preview.id, reviewed: editing.editor,
    suggestion: { groups: [{ name: 'Reviewed group', tabIds: [1, 3] }], ungroupedTabIds: [] } });
  const outcome = await handle({ action: 'apply', id: saved.preview.id });
  assert.equal(outcome.outcome.kind, 'success');
  assert.deepEqual(calls.filter(call => call[0] === 'group').map(call => call[1]), [
    { tabIds: [1], createProperties: { windowId: 10 } },
    { tabIds: [3], createProperties: { windowId: 20 } },
  ]);
  assert.equal(h.suggestions, 1);
});

test('reset clears saved preview, edits, outcome and errors across reopening without Chrome or AI calls', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  let state = await handle({ action: 'suggest' });
  state = await handle({ action: 'save', id: state.preview.id, suggestion: { groups: [{ name: 'Saved edit', tabIds: [1] }], ungroupedTabIds: [2] } });
  state = await handle({ action: 'apply', id: state.preview.id });
  const reset = await handle({ action: 'reset' });
  assert.equal(reset.preview, null); assert.deepEqual(reset.skipped, []);
  assert.equal(reset.outcome, null); assert.equal(reset.error, null);
  assert.equal(reset.consumed, false); assert.equal(reset.pending, false); assert.equal(reset.applying, false);
  assert.ok(reset.resetToken);
  assert.equal(h.suggestions, 1); assert.equal(h.applications, 1);
  const reopened = createSessionController(h.deps);
  assert.deepEqual(await reopened({ action: 'get' }), reset);
  const next = await reopened({ action: 'suggest' });
  assert.equal(next.resetToken, reset.resetToken);
});
test('reset is rejected during active application and does not erase the operation status', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const state = await handle({ action: 'suggest' });
  let release; const gate = new Promise(resolve => { release = resolve; });
  const apply = h.deps.apply; h.deps.apply = async preview => { await gate; return apply(preview); };
  const pending = handle({ action: 'apply', id: state.preview.id });
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(handle({ action: 'reset' }), /current action/);
  assert.equal((await handle({ action: 'get' })).applying, true);
  release(); assert.equal((await pending).outcome.kind, 'success');
});
test('failed reset preserves the saved session and repeated resets generate new UI reset tokens', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const saved = await handle({ action: 'suggest' });
  const write = h.deps.write;
  h.deps.write = async state => { if (state.resetToken) throw new Error('Synthetic storage failure'); return write(state); };
  await assert.rejects(handle({ action: 'reset' }), /storage failure/);
  assert.deepEqual(await handle({ action: 'get' }), saved);
  h.deps.write = write;
  const first = await handle({ action: 'reset' });
  const second = await handle({ action: 'reset' });
  assert.notEqual(first.resetToken, second.resetToken);
});

test('published session revisions increase across suggestion, edit save and reset but not get', async () => {
  const h = harness(); const handle = createSessionController(h.deps);
  const preview = await handle({ action: 'suggest' });
  const get = await handle({ action: 'get' });
  assert.equal(get.revision, preview.revision);
  const edit = await handle({ action: 'edit', id: preview.preview.id });
  assert.equal(edit.revision, preview.revision);
  const saved = await handle({ action: 'save', id: preview.preview.id, suggestion });
  assert.ok(saved.revision > preview.revision);
  const reset = await handle({ action: 'reset' });
  assert.ok(reset.revision > saved.revision);
});

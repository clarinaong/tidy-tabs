import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroupApplier } from '../lib/applyGroups.ts';
import { moveTab, renameGroup, saveDraft } from '../lib/editing.ts';
const tabs = [1, 2, 3].map(id => ({ id, windowId: id === 2 ? 20 : 10, title: `Synthetic tab ${id}`, url: `https://example.test/${id}` }));
const preview = () => ({ tabs: structuredClone(tabs), suggestion: { groups: [{ name: 'Original', tabIds: [1, 2] }], ungroupedTabIds: [3] } });
function harness() {
  let current = structuredClone(tabs);
  const calls = [];
  const memberships = new Map([[1, 7], [2, 7], [3, 7], [99, 7]]);
  let nextId = 100;
  const api = {
    async readTabs() { return structuredClone(current); },
    async group(options) { calls.push(['group', options]); const id = nextId++; options.tabIds.forEach(tab => memberships.set(tab, id)); return id; },
    async update(id, options) { calls.push(['update', id, options]); },
    async ungroup(ids) { calls.push(['ungroup', ids]); ids.forEach(id => memberships.delete(id)); },
  };
  return { api, calls, memberships, setTabs(value) { current = value; } };
}
test('saved edits apply, empty groups are skipped, single tabs work, and existing outside members survive', async () => {
  const h = harness(); const p = preview();
  p.suggestion = saveDraft(renameGroup(moveTab(p.suggestion, 2, -1), 0, 'Edited'));
  p.suggestion.groups.push({ name: 'Empty', tabIds: [] });
  const outcome = await createGroupApplier(h.api)(p);
  assert.equal(outcome.kind, 'success');
  assert.deepEqual(h.calls, [
    ['group', { tabIds: [1], createProperties: { windowId: 10 } }],
    ['update', 100, { title: 'Edited', color: 'blue' }],
    ['ungroup', [3, 2]],
  ]);
  assert.equal(h.memberships.get(99), 7);
  assert.equal(h.memberships.has(3), false);
});
test('a named group splits by window without moving tabs', async () => {
  const h = harness(); await createGroupApplier(h.api)(preview());
  assert.deepEqual(h.calls.filter(c => c[0] === 'group').map(c => c[1]), [
    { tabIds: [1], createProperties: { windowId: 10 } },
    { tabIds: [2], createProperties: { windowId: 20 } },
  ]);
  assert.deepEqual(h.calls.filter(c => c[0] === 'update').map(c => c[2]), [
    { title: 'Original', color: 'blue' }, { title: 'Original', color: 'blue' },
  ]);
});
test('stale IDs, titles, full URLs and window IDs block all mutations', async () => {
  for (const field of ['id', 'title', 'url', 'windowId', 'closed']) {
    const h = harness(); const changed = structuredClone(tabs);
    if (field === 'closed') changed.pop();
    else changed[0][field] = typeof changed[0][field] === 'number' ? 42 : 'Changed';
    h.setTabs(changed);
    const outcome = await createGroupApplier(h.api)(preview());
    assert.equal(outcome.kind, 'stale', field);
    assert.equal(outcome.consumed, false);
    assert.deepEqual(h.calls, []);
  }
});
test('new outside tabs do not invalidate the included snapshot', async () => {
  const h = harness(); h.setTabs([...tabs, { id: 99, windowId: 20, title: 'Outside', url: 'https://outside.test' }]);
  assert.equal((await createGroupApplier(h.api)(preview())).kind, 'success');
  assert.equal(h.memberships.get(99), 7);
});
test('concurrent clicks and repeated or edited applications of consumed snapshot cannot duplicate groups', async () => {
  const h = harness(); const p = preview(); const apply = createGroupApplier(h.api);
  let release; const ready = new Promise(resolve => { release = resolve; });
  const read = h.api.readTabs;
  h.api.readTabs = async () => { await ready; return read(); };
  const first = apply(p);
  assert.equal((await apply(p)).kind, 'blocked');
  release(); assert.equal((await first).kind, 'success');
  assert.equal((await apply({ ...p, suggestion: { groups: [], ungroupedTabIds: [1, 2, 3] } })).kind, 'blocked');
  assert.equal(h.calls.filter(c => c[0] === 'group').length, 2);
});
test('closed or moved tabs during application stop remaining operations and forbid retry', async () => {
  for (const change of ['closed', 'moved']) {
    const h = harness(); const p = preview(); const apply = createGroupApplier(h.api);
    const update = h.api.update;
    h.api.update = async (...args) => {
      await update(...args);
      h.setTabs(change === 'closed' ? tabs.slice(0, 2) : tabs.map(t => t.id === 2 ? { ...t, windowId: 30 } : t));
    };
    const outcome = await apply(p);
    assert.equal(outcome.kind, 'partial'); assert.equal(outcome.consumed, true);
    assert.equal(h.calls.filter(c => c[0] === 'group').length, 1);
    assert.equal(h.calls.some(c => c[0] === 'ungroup'), false);
    assert.equal((await apply(p)).kind, 'blocked');
  }
});
test('group, naming, and ungroup API failures are never reported as success or retried', async () => {
  for (const method of ['group', 'update', 'ungroup']) {
    const h = harness(); const p = preview();
    h.api[method] = async () => { throw new Error('Synthetic failure'); };
    const apply = createGroupApplier(h.api);
    assert.equal((await apply(p)).kind, 'partial');
    const count = h.calls.length;
    assert.equal((await apply(p)).kind, 'blocked'); assert.equal(h.calls.length, count);
  }
});
test('all Ungrouped applies without creating placeholder tabs or named groups', async () => {
  const h = harness(); const p = preview(); p.suggestion = { groups: [{ name: 'Empty', tabIds: [] }], ungroupedTabIds: [1, 2, 3] };
  assert.equal((await createGroupApplier(h.api)(p)).kind, 'success');
  assert.deepEqual(h.calls, [['ungroup', [1, 2, 3]]]);
});
test('invalid assignments and preflight read failures request no changes', async () => {
  const h = harness(); const p = preview(); p.suggestion.groups[0].tabIds.push(99);
  assert.equal((await createGroupApplier(h.api)(p)).kind, 'failure');
  h.api.readTabs = async () => { throw new Error('Read failed'); };
  assert.equal((await createGroupApplier(h.api)(preview())).kind, 'stale');
  assert.deepEqual(h.calls, []);
});

test('explicit existing destination reuses its ID, preserves outside members, and creates only in other windows', async () => {
  const h = harness(); const p = preview();
  p.existingGroups = [{ id: 7, windowId: 10, name: 'Original' }];
  p.suggestion.groups[0].existingGroupId = 7;
  h.api.readGroups = async () => p.existingGroups;
  const group = h.api.group;
  h.api.group = async options => {
    if (options.groupId !== undefined) { h.calls.push(['group', options]); options.tabIds.forEach(id => h.memberships.set(id, options.groupId)); return options.groupId; }
    return group(options);
  };
  assert.equal((await createGroupApplier(h.api)(p)).kind, 'success');
  assert.deepEqual(h.calls.filter(c => c[0] === 'group'), [
    ['group', { tabIds: [1], groupId: 7 }],
    ['group', { tabIds: [2], createProperties: { windowId: 20 } }],
  ]);
  assert.equal(h.memberships.get(99), 7);
  assert.equal(h.memberships.get(1), 7);
});
test('closed, renamed, or moved existing destinations block all mutations', async () => {
  for (const change of [[], [{ id: 7, windowId: 10, name: 'Renamed' }], [{ id: 7, windowId: 30, name: 'Original' }]]) {
    const h = harness(); const p = preview();
    p.existingGroups = [{ id: 7, windowId: 10, name: 'Original' }];
    p.suggestion.groups[0].existingGroupId = 7;
    h.api.readGroups = async () => change;
    assert.equal((await createGroupApplier(h.api)(p)).kind, 'stale');
    assert.deepEqual(h.calls, []);
  }
});
test('changed tab membership invalidates the existing-group snapshot before applying', async () => {
  const h = harness(); const p = preview(); p.tabs[0].groupId = 7;
  h.setTabs(tabs.map(t => ({ ...t, groupId: -1 })));
  assert.equal((await createGroupApplier(h.api)(p)).kind, 'stale');
  assert.deepEqual(h.calls, []);
});

test('our own moves may empty a later existing destination, which is safely recreated', async () => {
  const live = [
    { id: 1, windowId: 10, groupId: 10, title: 'Synthetic A', url: 'https://example.test/a' },
    { id: 2, windowId: 10, groupId: 20, title: 'Synthetic B', url: 'https://example.test/b' },
  ];
  let groups = [{ id: 10, windowId: 10, name: 'A' }, { id: 20, windowId: 10, name: 'B' }];
  const initialGroups = structuredClone(groups);
  const calls = []; let nextId = 100;
  const clean = () => { groups = groups.filter(group => live.some(tab => tab.groupId === group.id)); };
  const apply = createGroupApplier({ readTabs: async () => structuredClone(live), readGroups: async () => structuredClone(groups),
    group: async options => {
      calls.push(options);
      const id = options.groupId ?? nextId++;
      if (!options.groupId) groups.push({ id, windowId: options.createProperties.windowId, name: '' });
      for (const tab of live) if (options.tabIds.includes(tab.id)) tab.groupId = id;
      clean(); return id;
    }, update: async (id, options) => { groups.find(group => group.id === id).name = options.title; },
    ungroup: async ids => { for (const tab of live) if (ids.includes(tab.id)) tab.groupId = -1; clean(); },
  });
  const outcome = await apply({ tabs: structuredClone(live), existingGroups: initialGroups,
    suggestion: { groups: [{ name: 'A', existingGroupId: 10, tabIds: [2] }, { name: 'B', existingGroupId: 20, tabIds: [1] }], ungroupedTabIds: [] } });
  assert.equal(outcome.kind, 'success');
  assert.deepEqual(calls, [{ groupId: 10, tabIds: [2] }, { createProperties: { windowId: 10 }, tabIds: [1] }]);
  assert.equal(live[1].groupId, 10);
  assert.equal(groups.find(group => group.id === live[0].groupId).name, 'B');
});


test('saved manual rename updates the existing group ID and survives later window operations', async () => {
  const h = harness(); const p = preview();
  p.existingGroups = [{ id: 7, windowId: 10, name: 'Original' }];
  p.suggestion.groups[0].existingGroupId = 7;
  p.suggestion = saveDraft(renameGroup(p.suggestion, 0, 'Renamed topic'));
  const groups = structuredClone(p.existingGroups);
  h.api.readGroups = async () => structuredClone(groups);
  const originalGroup = h.api.group;
  h.api.group = async options => {
    if (options.groupId === undefined) return originalGroup(options);
    h.calls.push(['group', options]);
    options.tabIds.forEach(id => h.memberships.set(id, options.groupId));
    return options.groupId;
  };
  h.api.update = async (id, options) => {
    h.calls.push(['update', id, options]);
    const group = groups.find(group => group.id === id);
    if (group) group.name = options.title;
  };
  assert.equal((await createGroupApplier(h.api)(p)).kind, 'success');
  assert.deepEqual(h.calls.filter(call => call[0] === 'group'), [
    ['group', { tabIds: [1], groupId: 7 }],
    ['group', { tabIds: [2], createProperties: { windowId: 20 } }],
  ]);
  assert.deepEqual(h.calls.find(call => call[0] === 'update'), ['update', 7, { title: 'Renamed topic', color: 'blue' }]);
  assert.equal(groups[0].name, 'Renamed topic');
  assert.equal(p.existingGroups[0].name, 'Original');
  assert.equal(h.memberships.get(99), 7);
});

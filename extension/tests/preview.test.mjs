import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcilePreview, isPreviewStale, assertValidPreview, havePreviewTabsChanged, applyReviewedPreview } from '../lib/preview.ts';
const tabs = [1, 2, 3].map(id => ({ id, windowId: 10, groupId: -1, title: `Synthetic page ${id}`, url: `https://example.test/${id}` }));
const preview = () => ({ tabs: structuredClone(tabs), suggestion: { groups: [{ name: 'Edited name', tabIds: [1, 2] }, { name: 'Empty group', tabIds: [] }], ungroupedTabIds: [3] } });
test('new eligible tabs stale the preview but skipped browser pages do not', () => {
  const p = preview();
  assert.equal(isPreviewStale(p, [...tabs, { id: 4, windowId: 10, title: 'Settings', url: 'chrome://settings' }]), false);
  assert.equal(isPreviewStale(p, [...tabs, { ...tabs[0], id: 4 }]), true);
});
test('reconcile removes closed and ineligible pages, puts new/changed pages in Ungrouped, and preserves untouched edits', () => {
  const p = preview();
  const current = [tabs[0], { ...tabs[1], title: 'Synthetic new topic', url: 'https://example.test/new-topic' }, { ...tabs[2], url: 'chrome://settings' }, { ...tabs[0], id: 4 }];
  const reviewed = reconcilePreview(p, current, []);
  assert.deepEqual(reviewed.suggestion.groups, [{ name: 'Edited name', tabIds: [1] }, { name: 'Empty group', tabIds: [] }]);
  assert.deepEqual(reviewed.suggestion.ungroupedTabIds, [2, 4]);
  assert.equal(reviewed.tabs.find(tab => tab.id === 2).title, 'Synthetic new topic');
  assert.equal(isPreviewStale(reviewed, current), false);
  assertValidPreview(reviewed);
  assert.deepEqual(p.suggestion.groups[0].tabIds, [1, 2]);
});
test('moving between windows keeps the draft assignment while updating the snapshot', () => {
  const current = tabs.map(tab => tab.id === 1 ? { ...tab, windowId: 20 } : tab);
  assert.equal(isPreviewStale(preview(), current), true);
  const reviewed = reconcilePreview(preview(), current, []);
  assert.deepEqual(reviewed.suggestion.groups[0].tabIds, [1, 2]);
  assert.equal(reviewed.tabs[0].windowId, 20);
});
test('unchanged existing destinations are retained, renamed or removed destinations become new groups', () => {
  const p = preview(); p.suggestion.groups[0].existingGroupId = 7;
  p.existingGroups = [{ id: 7, windowId: 10, name: 'Edited name' }];
  assert.equal(reconcilePreview(p, tabs, p.existingGroups).suggestion.groups[0].existingGroupId, 7);
  assert.equal(isPreviewStale(p, tabs, [{ id: 7, windowId: 10, name: 'Renamed' }]), true);
  assert.equal(reconcilePreview(p, tabs, []).suggestion.groups[0].existingGroupId, undefined);
});
test('updating the editor again preserves assignments for tabs added in the first edit', () => {
  const current = [...tabs, { ...tabs[0], id: 4 }];
  const reviewed = reconcilePreview(preview(), current, []);
  reviewed.suggestion.groups[0].tabIds.push(4);
  reviewed.suggestion.ungroupedTabIds = [3];
  const latest = reconcilePreview(reviewed, [...current, { ...tabs[0], id: 5 }], []);
  assert.deepEqual(latest.suggestion.groups[0].tabIds, [1, 2, 4]);
  assert.deepEqual(latest.suggestion.ungroupedTabIds, [3, 5]);
});
test('invalid manual assignments cannot become a saved fresh preview', () => {
  for (const ids of [[1], [1, 1], [1, 2, 99]]) {
    const p = preview(); p.suggestion.groups[0].tabIds = ids;
    assert.throws(() => assertValidPreview(p), /assignments changed/);
  }
});

test('applied previews ignore their own membership changes but still detect new, closed, navigated and moved tabs', () => {
  const p = preview();
  const applied = tabs.map(tab => ({ ...tab, groupId: 42 }));
  assert.equal(havePreviewTabsChanged(p, applied), false);
  assert.equal(havePreviewTabsChanged(p, [...applied, { ...tabs[0], id: 4 }]), true);
  assert.equal(havePreviewTabsChanged(p, applied.slice(1)), true);
  assert.equal(havePreviewTabsChanged(p, applied.map(tab => tab.id === 1 ? { ...tab, url: 'https://example.test/new' } : tab)), true);
  assert.equal(havePreviewTabsChanged(p, applied.map(tab => tab.id === 1 ? { ...tab, windowId: 20 } : tab)), true);
});

test('a manually edited group name stays bound to the original destination across review', () => {
  const p = preview();
  p.suggestion.groups[0].existingGroupId = 7;
  p.suggestion.groups[0].name = 'Manual name';
  p.existingGroups = [{ id: 7, name: 'Original name', windowId: 1 }];
  assert.equal(isPreviewStale(p, p.tabs, p.existingGroups), false);
  const reviewed = reconcilePreview(p, p.tabs, p.existingGroups);
  assert.equal(reviewed.suggestion.groups[0].existingGroupId, 7);
  assert.equal(reviewed.suggestion.groups[0].name, 'Manual name');
  assert.equal(isPreviewStale(p, p.tabs, [{ id: 7, name: 'Externally renamed', windowId: 1 }]), true);
});

test('irrelevant ordering and display metadata do not stale the preview, but page or membership changes do', () => {
  const p = preview();
  assert.equal(isPreviewStale(p, [...tabs].reverse().map(tab => ({ ...tab, favIconUrl: 'https://example.test/icon', active: true }))), false);
  for (const field of ['title', 'url', 'windowId', 'groupId']) {
    const current = structuredClone(tabs);
    current[0][field] = typeof current[0][field] === 'number' ? 42 : 'Synthetic changed value';
    assert.equal(isPreviewStale(p, current), true, field);
  }
});
test('application preflight catches newly opened pages and destination changes without mutation', async () => {
  const p = preview(); p.existingGroups = [{ id: 7, name: 'Topic', windowId: 10 }]; p.suggestion.groups[0].existingGroupId = 7;
  let mutations = 0;
  const api = { readTabs: async () => [...tabs, { ...tabs[0], id: 4 }], readGroups: async () => p.existingGroups,
    apply: async () => { mutations++; return { kind: 'success', consumed: true, message: 'Applied' }; } };
  assert.equal((await applyReviewedPreview(p, api)).kind, 'stale');
  api.readTabs = async () => tabs;
  api.readGroups = async () => [{ ...p.existingGroups[0], name: 'Externally changed' }];
  assert.equal((await applyReviewedPreview(p, api)).kind, 'stale');
  api.readGroups = async () => { throw new Error('Synthetic query failure'); };
  const failed = await applyReviewedPreview(p, api);
  assert.equal(failed.kind, 'failure'); assert.equal(failed.consumed, false); assert.equal(mutations, 0);
});
test('reviewed save pipeline includes new tabs while preserving edits and supports fresh application', async () => {
  const old = preview(); const current = [...tabs, { ...tabs[0], id: 4 }];
  const reviewed = reconcilePreview(old, current, []);
  reviewed.suggestion.groups[0].tabIds.push(4);
  reviewed.suggestion.ungroupedTabIds = [3];
  assertValidPreview(reviewed);
  let applied;
  const outcome = await applyReviewedPreview(reviewed, { readTabs: async () => current, readGroups: async () => [], apply: async preview => {
    applied = preview; return { kind: 'success', consumed: true, message: 'Applied' };
  } });
  assert.equal(outcome.kind, 'success'); assert.deepEqual(applied.suggestion.groups[0].tabIds, [1, 2, 4]);
  assert.equal(isPreviewStale(reviewed, current.map(tab => tab.id === 4 ? { ...tab, url: 'https://example.test/changed-again' } : tab)), true);
});

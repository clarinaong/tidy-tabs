import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneDraft,
  nameError,
  moveTab,
  moveTabs,
  moveTabsToNamedGroup,
  addGroup,
  renameGroup,
  removeGroup,
  saveDraft,
} from '../lib/editing.ts';
const source = {
  groups: [{ name: 'Garden project', tabIds: [1, 2] }],
  ungroupedTabIds: [3],
};
const allIds = (draft) =>
  [...draft.groups.flatMap((g) => g.tabIds), ...draft.ungroupedTabIds].sort();

test('draft changes are isolated; discarding leaves source unchanged and saving returns an independent preview', () => {
  let draft = cloneDraft(source);
  draft = renameGroup(draft, 0, '  Garden plans  ');
  draft = moveTab(draft, 1, -1);
  assert.deepEqual(source.groups[0], {
    name: 'Garden project',
    tabIds: [1, 2],
  });
  const saved = saveDraft(draft);
  assert.equal(saved.groups[0].name, 'Garden plans');
  draft.groups[0].tabIds.push(99);
  assert.deepEqual(saved.groups[0].tabIds, [2]);
});

test('names reject blank, too long and control characters; exact limit is accepted', () => {
  for (const name of ['', '   ', 'a'.repeat(81), 'Line\nBreak'])
    assert.ok(nameError(name));
  assert.equal(nameError('a'.repeat(80)), null);
  assert.throws(() => saveDraft(renameGroup(source, 0, ' ')));
  assert.deepEqual(addGroup(source, ''), source);
});

test('custom groups retain empty and single-tab states independent of AI minimum', () => {
  const empty = addGroup(source, 'Recipes');
  assert.deepEqual(saveDraft(empty).groups[0], { name: 'Recipes', tabIds: [] });
  assert.deepEqual(empty.groups[1], source.groups[0]);
  assert.deepEqual(source.groups, [{ name: 'Garden project', tabIds: [1, 2] }]);
  const single = moveTab(empty, 3, 0);
  assert.deepEqual(saveDraft(single).groups[0].tabIds, [3]);
  assert.deepEqual(allIds(single), [1, 2, 3]);
});

test('repeated moves and invalid destinations cannot duplicate or lose tabs', () => {
  let draft = addGroup(source, 'Recipes');
  for (const destination of [-1, 0, 1, 1, -1, 0]) {
    draft = moveTab(draft, 1, destination);
    assert.deepEqual(allIds(draft), [1, 2, 3]);
  }
  for (const destination of [2, -2, NaN, 0.5])
    assert.deepEqual(moveTab(draft, 1, destination), draft);
  assert.deepEqual(moveTab(draft, 99, -1), draft);
});

test('moving a search-visible tab and removing its group preserve hidden tabs', () => {
  const moved = moveTab(source, 1, -1);
  assert.deepEqual(moved.groups[0].tabIds, [2]);
  const removed = removeGroup(moved, 0);
  assert.deepEqual(removed.groups, []);
  assert.deepEqual(allIds(removed), [1, 2, 3]);
  assert.deepEqual(source.groups[0].tabIds, [1, 2]);
});

test('bulk moves preserve hidden tabs, deduplicate selection, and leave the original draft isolated', () => {
  const draft = addGroup(source, 'Recipes');
  const moved = moveTabs(draft, [1, 3, 1, 99], 0);
  assert.deepEqual(moved.groups[0].tabIds, [1, 3]);
  assert.deepEqual(moved.groups[1].tabIds, [2]);
  assert.deepEqual(allIds(moved), [1, 2, 3]);
  assert.deepEqual(draft.groups[0].tabIds, []);
  const ungrouped = moveTabs(moved, [1, 2, 3], -1);
  assert.deepEqual(allIds(ungrouped), [1, 2, 3]);
  assert.deepEqual(
    ungrouped.groups.map((g) => g.tabIds),
    [[], []],
  );
  assert.deepEqual(moveTabs(moved, [1, 3], 99), moved);
});

test('moves and renaming preserve the existing destination without modifying Chrome', () => {
  const source = { groups: [{ name: 'Garden', tabIds: [1, 2], existingGroupId: 7 }], ungroupedTabIds: [3] };
  assert.equal(saveDraft(moveTab(source, 3, 0)).groups[0].existingGroupId, 7);
  assert.equal(renameGroup(source, 0, ' Garden ').groups[0].existingGroupId, 7);
  assert.equal(renameGroup(source, 0, 'New garden').groups[0].existingGroupId, 7);
  assert.equal(source.groups[0].existingGroupId, 7);
});

const windowTabs = [
  { id: 1, windowId: 10, groupId: 30, title: 'Synthetic garden A', url: 'https://garden.test/a' },
  { id: 2, windowId: 20, groupId: 40, title: 'Synthetic garden B', url: 'https://garden.test/b' },
  { id: 3, windowId: 10, groupId: -1, title: 'Synthetic guide', url: 'https://example.test/guide' },
  { id: 4, windowId: 20, groupId: -1, title: 'Synthetic reference', url: 'https://example.test/reference' },
];
const gardens = [{ id: 30, name: 'Gardening', windowId: 10 }, { id: 40, name: 'Gardening', windowId: 20 }];
const gardenDraft = { groups: [{ name: 'Gardening', existingGroupId: 30, tabIds: [1] }, { name: 'Gardening', existingGroupId: 40, tabIds: [2] }], ungroupedTabIds: [3, 4] };
test('named moves route mixed-window selections to existing local destinations even when remote option selected', () => {
  const moved = moveTabsToNamedGroup(gardenDraft, [3, 4], 1, windowTabs, gardens);
  assert.deepEqual(moved.groups.map(group => group.tabIds), [[1, 3], [2, 4]]);
  assert.deepEqual(moved.ungroupedTabIds, []);
  assert.deepEqual(gardenDraft.ungroupedTabIds, [3, 4]);
});
test('named moves reuse local existing groups omitted from preview instead of creating duplicates', () => {
  const draft = { groups: [gardenDraft.groups[1]], ungroupedTabIds: [1, 3, 4] };
  const moved = moveTabsToNamedGroup(draft, [3], 0, windowTabs, gardens);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === 30).tabIds, [3]);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === 40).tabIds, [2]);
});
test('missing local destination creates a preview destination only in the assigned window', () => {
  const draft = { groups: [gardenDraft.groups[1]], ungroupedTabIds: [1, 3, 4] };
  const moved = moveTabsToNamedGroup(draft, [3], 0, windowTabs, [gardens[1]]);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === undefined).tabIds, [3]);
  assert.deepEqual(moved.groups[0].tabIds, [2]);
  assert.deepEqual(allIds(moved), [1, 2, 3, 4]);
});
test('same-name groups in one window consolidate and outside-snapshot tabs are excluded', () => {
  const draft = { groups: [{ ...gardenDraft.groups[0] }, { name: 'Gardening', existingGroupId: 31, tabIds: [3] }], ungroupedTabIds: [2, 4] };
  const moved = moveTabsToNamedGroup(draft, [4, 99], 1, windowTabs, [...gardens, { id: 31, name: 'Gardening', windowId: 10 }]);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === 30).tabIds, [1, 3]);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === 31).tabIds, []);
  assert.deepEqual(moved.groups.find(group => group.existingGroupId === 40).tabIds, [4]);
  assert.deepEqual(allIds(moved), [1, 2, 3, 4]);
});
test('new named group remains one preview destination spanning multiple windows', () => {
  const draft = { groups: [{ name: 'Research', tabIds: [] }], ungroupedTabIds: [1, 2, 3, 4] };
  const moved = moveTabsToNamedGroup(draft, [3, 4], 0, windowTabs, gardens);
  assert.equal(moved.groups.length, 1);
  assert.deepEqual(moved.groups[0].tabIds, [3, 4]);
});

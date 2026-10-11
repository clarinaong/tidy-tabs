import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneDraft,
  nameError,
  moveTab,
  moveTabs,
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

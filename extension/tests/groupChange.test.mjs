import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGroupChange, describeGroupWindows } from '../lib/groupChange.ts';
const groups = [{ id: 10, name: 'Topic', windowId: 1 }, { id: 20, name: 'Topic', windowId: 1 }];
const tabs = [1, 2, 3].map(id => ({ id, windowId: 1, groupId: id === 1 ? 10 : 20, title: `Synthetic ${id}`, url: `https://example.test/${id}` }));
const describe = (ids, current = tabs) => describeGroupChange({ tabs, existingGroups: groups, suggestion: { groups: [], ungroupedTabIds: [] } }, { name: 'Topic', existingGroupId: 20, tabIds: ids }, groups[1], 1, current, group => group.id === 10 ? 'Group 1' : 'Group 2');
test('unchanged existing membership is kept rather than advertised as an update', () => {
  assert.equal(describe([2, 3]), 'Keeps tabs in existing group');
});
test('combining identifies the donor and destination', () => {
  assert.equal(describe([1, 2, 3]), 'Will combine Group 1 into Group 2');
});
test('outside members prevent claiming the entire donor group will be combined', () => {
  const text = describe([1, 2, 3], [...tabs, { id: 99, windowId: 1, groupId: 10, title: 'Synthetic settings', url: 'chrome://settings' }]);
  assert.equal(text, 'Existing Chrome group');
});
test('changed membership omits add/remove instructions', () => {
  assert.equal(describe([2]), 'Existing Chrome group');
});

test('cross-window message counts only assigned windows and handles reused destinations', () => {
  const snapshot = [...tabs, { ...tabs[0], id: 4, windowId: 2 }, { ...tabs[0], id: 5, windowId: 3 }];
  assert.equal(describeGroupWindows({ name: 'Topic', existingGroupId: 10, tabIds: [1, 2, 4] }, snapshot),
    'Will organize tabs into 2 separate groups across 2 windows. Tabs stay in their current windows.');
  assert.match(describeGroupWindows({ name: 'Topic', tabIds: [1, 4, 5] }, snapshot), /3 separate groups across 3 windows/);
  assert.equal(describeGroupWindows({ name: 'Topic', tabIds: [1, 2] }, snapshot), '');
  assert.equal(describeGroupWindows({ name: 'Topic', tabIds: [] }, snapshot), '');
});

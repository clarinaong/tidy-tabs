import type { Preview } from './applyGroups';
import type { ExistingGroup, Suggestion } from './grouping';
import type { OpenTab } from './tabs';

export function describeGroupChange(preview: Preview, group: Suggestion['groups'][number], target: ExistingGroup, windowId: number, currentTabs: OpenTab[], label: (group: ExistingGroup) => string) {
  const assigned = preview.tabs.filter(tab => tab.windowId === windowId && group.tabIds.includes(tab.id!));
  if (assigned.some(tab => tab.groupId === undefined)) return 'Existing Chrome group';
  const added = assigned.filter(tab => tab.groupId !== target.id);
  const removed = preview.tabs.filter(tab => tab.groupId === target.id && !group.tabIds.includes(tab.id!));
  if (!added.length && !removed.length) return group.name === target.name ? 'Keeps tabs in existing group' : 'Existing Chrome group';
  const donors = (preview.existingGroups ?? []).filter(source => source.id !== target.id && source.windowId === windowId && added.some(tab => tab.groupId === source.id));
  const fullyCombined = donors.length > 0 && donors.every(source => {
    const members = [...preview.tabs, ...currentTabs.filter(tab => !preview.tabs.some(snapshot => snapshot.id === tab.id))].filter(tab => tab.groupId === source.id);
    return members.length > 0 && members.every(tab => group.tabIds.includes(tab.id!));
  });
  if (fullyCombined && added.every(tab => donors.some(source => source.id === tab.groupId)) && !removed.length)
    return `Will combine ${donors.map(label).join(' + ')} into ${label(target)}`;
  return 'Existing Chrome group';
}

// Count assigned windows, including tabs hidden by search. Existing destinations
// may be reused, so do not imply that every resulting group is newly created.
export function describeGroupWindows(group: Suggestion['groups'][number], tabs: OpenTab[]) {
  const assigned = new Set(group.tabIds);
  const count = new Set(tabs.filter(tab => tab.id !== undefined && assigned.has(tab.id)).map(tab => tab.windowId)).size;
  return count > 1 ? `Will organize tabs into ${count} separate groups across ${count} windows. Tabs stay in their current windows.` : '';
}

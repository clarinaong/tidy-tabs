import type { ApplyOutcome, Preview } from './applyGroups.ts';
import type { ExistingGroup } from './grouping.ts';
import { isEligibleTab, tabFingerprint } from './grouping.ts';
import type { OpenTab } from './tabs.ts';
import { cloneDraft, saveDraft } from './editing.ts';

export const STALE_PREVIEW_MESSAGE = 'Your tabs have changed. Refresh suggestions or edit groups to review the latest tabs before grouping.';

// Include newly opened eligible tabs in the stale check. Skipped browser pages
// never become part of the preview or its assignments.
export function havePreviewTabsChanged(preview: Preview, openTabs: OpenTab[]) {
  return tabFingerprint(openTabs.filter(isEligibleTab)) !== tabFingerprint(preview.tabs);
}

export function isPreviewStale(preview: Preview, openTabs: OpenTab[], groups?: ExistingGroup[]) {
  const current = openTabs.filter(isEligibleTab);
  if (havePreviewTabsChanged(preview, current)) return true;
  if (preview.tabs.some(tab => (tab.groupId ?? -1) !== (current.find(now => now.id === tab.id)?.groupId ?? -1))) return true;
  return groups !== undefined && preview.suggestion.groups.some(group => {
    if (group.existingGroupId === undefined) return false;
    const previous = preview.existingGroups?.find(existing => existing.id === group.existingGroupId);
    return !previous || !groups.some(existing => existing.id === previous.id && existing.windowId === previous.windowId && existing.name === previous.name);
  });
}

// Keep reviewed assignments for unchanged pages. Navigated/renamed pages and new
// tabs require review in Ungrouped; closed and ineligible pages leave the draft.
export function reconcilePreview(preview: Preview, openTabs: OpenTab[], existingGroups: ExistingGroup[]): Preview {
  const tabs = openTabs.filter(isEligibleTab).map(tab => ({ ...tab }));
  const previous = new Map(preview.tabs.map(tab => [tab.id, tab]));
  const retain = new Set(tabs.filter(tab => {
    const old = previous.get(tab.id);
    return old && old.title === tab.title && old.url === tab.url;
  }).map(tab => tab.id));
  const suggestion = cloneDraft(preview.suggestion);
  const assigned = new Set<number>();
  for (const group of suggestion.groups) {
    group.tabIds = group.tabIds.filter(id => {
      if (!retain.has(id) || assigned.has(id)) return false;
      assigned.add(id); return true;
    });
    const oldTarget = preview.existingGroups?.find(existing => existing.id === group.existingGroupId);
    if (group.existingGroupId !== undefined && (!oldTarget || !existingGroups.some(existing => existing.id === oldTarget.id && existing.windowId === oldTarget.windowId && existing.name === oldTarget.name)))
      delete group.existingGroupId;
  }
  suggestion.ungroupedTabIds = tabs.filter(tab => !assigned.has(tab.id!)).map(tab => tab.id!);
  return { tabs, suggestion, existingGroups: existingGroups.map(group => ({ ...group })) };
}

export function assertValidPreview(preview: Preview) {
  const suggestion = saveDraft(preview.suggestion);
  const ids = preview.tabs.map(tab => tab.id);
  const assigned = [...suggestion.groups.flatMap(group => group.tabIds), ...suggestion.ungroupedTabIds];
  if (preview.tabs.some(tab => !isEligibleTab(tab)) || new Set(ids).size !== ids.length ||
      assigned.length !== ids.length || new Set(assigned).size !== ids.length || assigned.some(id => !ids.includes(id)))
    throw new Error('The preview assignments changed. Edit groups to review the latest tabs.');
  return suggestion;
}

// Check the whole eligible set immediately before handing off to the applier,
// which then validates included tabs again beside every Chrome mutation.
export async function applyReviewedPreview(preview: Preview, api: {
  readTabs: () => Promise<OpenTab[]>;
  readGroups: () => Promise<ExistingGroup[]>;
  apply: (preview: Preview) => Promise<ApplyOutcome>;
}): Promise<ApplyOutcome> {
  try {
    const [tabs, groups] = await Promise.all([api.readTabs(), api.readGroups()]);
    if (isPreviewStale(preview, tabs, groups)) return { kind: 'stale', consumed: false, message: STALE_PREVIEW_MESSAGE };
    assertValidPreview(preview);
  } catch {
    return { kind: 'failure', consumed: false, message: 'Could not verify the preview. Refresh suggestions or edit groups before grouping. No grouping changes were requested.' };
  }
  return api.apply(preview);
}

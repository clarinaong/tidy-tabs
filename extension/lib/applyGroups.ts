import type { OpenTab } from './tabs.ts';
import { tabFingerprint, type Suggestion, type ExistingGroup } from './grouping.ts';
import { nameError } from './editing.ts';

export interface Preview { tabs: OpenTab[]; suggestion: Suggestion; existingGroups?: ExistingGroup[] }
export interface GroupingApi {
  readTabs: () => Promise<OpenTab[]>;
  readGroups?: () => Promise<ExistingGroup[]>;
  group: (options: { tabIds: number[]; createProperties?: { windowId: number }; groupId?: number }) => Promise<number>;
  update: (id: number, options: { title: string; color: 'blue' }) => Promise<unknown>;
  ungroup: (ids: number[]) => Promise<void>;
}
export interface ApplyOutcome {
  kind: 'success' | 'stale' | 'failure' | 'partial' | 'blocked';
  message: string;
  consumed: boolean;
}

// One controller per background worker. Consume the snapshot before the first mutation,
// including ambiguous API failures: retrying could create duplicate groups.
export function createGroupApplier(api: GroupingApi) {
  let busy = false;
  const consumed = new WeakSet<OpenTab[]>();
  return async (preview: Preview): Promise<ApplyOutcome> => {
    if (busy || consumed.has(preview.tabs)) return {
      kind: 'blocked', consumed: consumed.has(preview.tabs),
      message: 'This preview is already being applied or was attempted. Refresh suggestions or edit groups before applying again.',
    };
    busy = true;
    let attempted = false;
    try {
      const ids = new Set(preview.tabs.map(tab => tab.id));
      const assigned = [...preview.suggestion.groups.flatMap(g => g.tabIds), ...preview.suggestion.ungroupedTabIds];
      if (ids.has(undefined) || ids.size !== preview.tabs.length ||
          assigned.length !== ids.size || new Set(assigned).size !== ids.size ||
          assigned.some(id => !ids.has(id)) || preview.suggestion.groups.some(g => nameError(g.name)))
        throw new Error('Invalid preview. Refresh suggestions before grouping.');
      const targets = preview.suggestion.groups.filter(group => group.existingGroupId !== undefined).map(group => {
        const target = preview.existingGroups?.find(existing => existing.id === group.existingGroupId);
        if (!target || !api.readGroups) throw new Error('Invalid existing destination.');
        return target;
      });
      let initialTabs: OpenTab[] = [];
      const changedMemberships = new Map<number, number>();
      const replacements = new Map<number, number>();
      const appliedTitles = new Map<number, string>();
      // Chrome deletes a group when our operations remove its last member.
      // Only tolerate that disappearance when every original member was moved by us.
      const emptiedByUs = (target: ExistingGroup) => {
        const members = initialTabs.filter(tab => tab.groupId === target.id);
        return members.length > 0 && members.every(tab => tab.id !== undefined &&
          changedMemberships.has(tab.id) && changedMemberships.get(tab.id) !== target.id);
      };
      const verify = async () => {
        const current = (await api.readTabs()).filter(tab => ids.has(tab.id));
        if (tabFingerprint(current) !== tabFingerprint(preview.tabs))
          throw new Error('Your tabs have changed. Refresh suggestions or edit groups to review the latest tabs before grouping.');
        if (targets.length) {
          const groups = await api.readGroups!();
          if (targets.some(target => {
            const effectiveId = replacements.get(target.id) ?? target.id;
            const current = groups.find(group => group.id === effectiveId);
            if (current) return current.windowId !== target.windowId || current.name !== (appliedTitles.get(effectiveId) ?? target.name);
            return replacements.has(target.id) || !emptiedByUs(target);
          })) throw new Error('An existing Chrome group changed. Refresh suggestions or edit groups before grouping.');
        }
      };
      try {
        initialTabs = await api.readTabs();
        await verify();
        const current = await api.readTabs();
        if (preview.tabs.some(tab => tab.groupId !== undefined && current.find(now => now.id === tab.id)?.groupId !== tab.groupId))
          throw new Error('Chrome tab assignments changed. Refresh suggestions or edit groups before grouping.');
      } catch (error) {
        return { kind: 'stale', consumed: false, message: error instanceof Error ? error.message : 'Could not verify tabs. Refresh suggestions before grouping.' };
      }
      const mutate = () => { attempted = true; consumed.add(preview.tabs); };
      for (const group of preview.suggestion.groups) {
        const windows = new Map<number, number[]>();
        for (const id of group.tabIds) {
          const windowId = preview.tabs.find(tab => tab.id === id)!.windowId;
          windows.set(windowId, [...(windows.get(windowId) ?? []), id]);
        }
        for (const [windowId, tabIds] of windows) {
          // Chrome has no conditional group API. Keep validation adjacent to
          // the mutation; the API can move tabs if a user moves one in the
          // unavoidable interval between these calls.
          await verify();
          mutate();
          const target = targets.find(existing => existing.id === group.existingGroupId && existing.windowId === windowId);
          const effectiveId = target ? replacements.get(target.id) ?? target.id : undefined;
          const destinationExists = effectiveId !== undefined && (await api.readGroups!()).some(existing => existing.id === effectiveId);
          if (target && !destinationExists && (replacements.has(target.id) || !emptiedByUs(target)))
            throw new Error('An existing Chrome group disappeared during grouping.');
          const groupId = await api.group(destinationExists ? { tabIds, groupId: effectiveId } : { tabIds, createProperties: { windowId } });
          for (const id of tabIds) changedMemberships.set(id, groupId);
          await verify();
          await api.update(groupId, { title: group.name, color: 'blue' });
          appliedTitles.set(groupId, group.name);
          if (target && !destinationExists) replacements.set(target.id, groupId);
          await verify();
        }
      }
      if (preview.suggestion.ungroupedTabIds.length) {
        await verify();
        mutate();
        await api.ungroup(preview.suggestion.ungroupedTabIds);
        for (const id of preview.suggestion.ungroupedTabIds) changedMemberships.set(id, -1);
      }
      await verify();
      consumed.add(preview.tabs);
      return { kind: 'success', consumed: true, message: preview.suggestion.groups.some(group => group.tabIds.length) ? 'Chrome tabs grouped. Ungrouped tabs are outside Chrome groups. Refresh suggestions or edit groups to review a fresh preview before applying again.' : 'Preview applied: these tabs are now ungrouped. No named Chrome groups were created. Refresh suggestions or edit groups to review a fresh preview before applying again.' };
    } catch {
      return attempted
        ? { kind: 'partial', consumed: true, message: 'Grouping was partially completed or could not be confirmed. Some Chrome tabs may have changed. Review Chrome and refresh suggestions before trying again; no automatic retry was made.' }
        : { kind: 'failure', consumed: false, message: 'Could not apply this preview. Refresh suggestions and try again. No grouping changes were requested.' };
    } finally { busy = false; }
  };
}

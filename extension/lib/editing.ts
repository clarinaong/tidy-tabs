import { LIMITS, type Suggestion } from './grouping.ts';

export function cloneDraft(suggestion: Suggestion): Suggestion {
  return {
    groups: suggestion.groups.map((group) => ({
      ...group,
      tabIds: [...group.tabIds],
    })),
    ungroupedTabIds: [...suggestion.ungroupedTabIds],
  };
}

export function nameError(name: string): string | null {
  if (!name.trim()) return 'Enter a group name.';
  if (name.length > LIMITS.name)
    return `Use at most ${LIMITS.name} characters.`;
  if (/[\u0000-\u001f\u007f]/u.test(name))
    return 'Remove unsupported characters.';
  return null;
}

// Destination -1 is Ungrouped. Operations always use the complete draft,
// never the filtered list used for display.
export function moveTab(
  draft: Suggestion,
  id: number,
  destination: number,
): Suggestion {
  const ids = [
    ...draft.groups.flatMap((g) => g.tabIds),
    ...draft.ungroupedTabIds,
  ];
  if (
    !ids.includes(id) ||
    !Number.isInteger(destination) ||
    destination < -1 ||
    destination >= draft.groups.length
  )
    return draft;
  const next = cloneDraft(draft);
  for (const group of next.groups)
    group.tabIds = group.tabIds.filter((tabId) => tabId !== id);
  next.ungroupedTabIds = next.ungroupedTabIds.filter((tabId) => tabId !== id);
  (destination === -1
    ? next.ungroupedTabIds
    : next.groups[destination]!.tabIds
  ).push(id);
  return next;
}

export function addGroup(draft: Suggestion, name: string): Suggestion {
  if (nameError(name)) return draft;
  const next = cloneDraft(draft);
  next.groups.unshift({ name: name.trim(), tabIds: [] });
  return next;
}

export function renameGroup(
  draft: Suggestion,
  index: number,
  name: string,
): Suggestion {
  const next = cloneDraft(draft);
  if (next.groups[index]) next.groups[index].name = name;
  return next;
}

export function removeGroup(draft: Suggestion, index: number): Suggestion {
  if (!draft.groups[index]) return draft;
  const next = cloneDraft(draft);
  next.ungroupedTabIds.push(...next.groups[index]!.tabIds);
  next.groups.splice(index, 1);
  return next;
}

export function saveDraft(draft: Suggestion): Suggestion {
  if (draft.groups.some((g) => nameError(g.name)))
    throw new Error('Check group names before saving.');
  const next = cloneDraft(draft);
  next.groups.forEach((g) => {
    g.name = g.name.trim();
  });
  return next;
}

// Use IDs from the full draft so filtering cannot drop hidden selections.
export function moveTabs(
  draft: Suggestion,
  ids: Iterable<number>,
  destination: number,
): Suggestion {
  return [...new Set(ids)].reduce(
    (current, id) => moveTab(current, id, destination),
    draft,
  );
}

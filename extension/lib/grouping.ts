import type { OpenTab } from './tabs.ts';

// Bounds for metadata sent directly to the selected AI provider.
export const LIMITS = {
  bytes: 65_536,
  tabs: 100,
  title: 300,
  url: 2048,
  name: 80,
};

export interface InputTab {
  id: number;
  title: string;
  url: string;
}

export interface ExistingGroup {
  id: number;
  windowId: number;
  name: string;
  tabIds?: number[];
}

export interface Suggestion {
  groups: { name: string; tabIds: number[]; existingGroupId?: number }[];
  ungroupedTabIds: number[];
}

const validId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

const clean = (v: string) => !/[\u0000-\u001f\u007f]/u.test(v);

export function sanitizeUrl(raw?: string): string | null {
  try {
    const url = new URL(raw ?? '');
    return ['http:', 'https:'].includes(url.protocol)
      ? `${url.protocol}//${url.host}`
      : null;
  } catch {
    return null;
  }
}

export function isEligibleTab(tab: OpenTab): boolean {
  return validId(tab.id) && sanitizeUrl(tab.url) !== null;
}

export function countSkippedTabs(tabs: OpenTab[]): number {
  return tabs.filter((tab) => !isEligibleTab(tab)).length;
}

export function prepareTabs(tabs: OpenTab[]) {
  let skipped = 0;
  const eligible: InputTab[] = [];
  const seen = new Set<number>();
  for (const tab of tabs) {
    const url = sanitizeUrl(tab.url);
    if (!validId(tab.id) || !url) {
      skipped++;
      continue;
    }
    if (seen.has(tab.id))
      throw new Error('Duplicate tab IDs. Please refresh your tabs.');
    seen.add(tab.id);
    const title = tab.title?.trim() || 'Untitled tab';
    if (
      title.length > LIMITS.title ||
      !clean(title) ||
      url.length > LIMITS.url ||
      !clean(url)
    )
      throw new Error(
        'A tab title or URL exceeds the supported limits or contains unsupported characters. Rename or close that tab and try again.',
      );
    eligible.push({ id: tab.id, title, url });
  }
  if (eligible.length > LIMITS.tabs)
    throw new Error(
      'Too many eligible tabs. Close tabs to leave at most 100 and try again. No tabs were sent.',
    );
  const body = JSON.stringify({ tabs: eligible });
  if (new TextEncoder().encode(body).byteLength > LIMITS.bytes)
    throw new Error(
      'Tab data exceeds the 65,536-byte request limit. Close some tabs and try again. No tabs were sent.',
    );
  return { tabs: eligible, skipped, body };
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const keys = (v: Record<string, unknown>, names: string[]) =>
  Object.keys(v).every((k) => names.includes(k));

export function validateSuggestion(
  value: unknown,
  tabs: InputTab[],
  existingGroups: ExistingGroup[] = [],
): Suggestion {
  const bad = (): never => {
    throw new Error('Couldn’t read the suggestions. Please try again.');
  };
  if (
    !record(value) ||
    !keys(value, ['groups', 'ungroupedTabIds']) ||
    !Array.isArray(value.groups) ||
    !Array.isArray(value.ungroupedTabIds) ||
    value.groups.length > tabs.length
  )
    return bad();
  const allowed = new Set(tabs.map((t) => t.id));
  const seen = new Set<number>();
  const assign = (v: unknown): number => {
    if (!validId(v) || !allowed.has(v) || seen.has(v)) return bad();
    seen.add(v);
    return v;
  };
  const groups = value.groups.map((g) => {
    if (
      !record(g) ||
      !keys(g, ['name', 'tabIds', 'existingGroupId']) ||
      typeof g.name !== 'string' ||
      !g.name.trim() ||
      g.name.length > LIMITS.name ||
      !clean(g.name) ||
      !Array.isArray(g.tabIds) ||
      g.tabIds.length < (g.existingGroupId == null ? 2 : 1) ||
      (g.existingGroupId != null &&
        !existingGroups.some(
          (existing) =>
            existing.id === g.existingGroupId && existing.name === g.name,
        )) ||
      g.tabIds.length > tabs.length
    )
      return bad();
    return {
      name: g.name.trim(),
      tabIds: g.tabIds.map(assign),
      ...(g.existingGroupId != null
        ? { existingGroupId: g.existingGroupId as number }
        : {}),
    };
  });
  const ungroupedTabIds = value.ungroupedTabIds.map(assign);
  for (const tab of tabs) if (!seen.has(tab.id)) ungroupedTabIds.push(tab.id);
  return { groups, ungroupedTabIds };
}

// Compare full local URLs, so even navigation within an origin invalidates a snapshot.
export function tabFingerprint(tabs: OpenTab[]) {
  return JSON.stringify(
    tabs
      .map((t) => [t.id, t.windowId, t.title, t.url])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  );
}

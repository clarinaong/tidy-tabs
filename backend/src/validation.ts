export const LIMITS = {
  bytes: 65_536,
  tabs: 100,
  title: 300,
  url: 2048,
  name: 80,
};

export interface Tab {
  id: number;
  title: string;
  url: string;
}
export interface Suggestion {
  groups: { name: string; tabIds: number[] }[];
  ungroupedTabIds: number[];
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const record = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const keys = (v: Record<string, unknown>, allowed: string[]) =>
  Object.keys(v).every((k) => allowed.includes(k));
const cleanText = (v: string) => !/[\u0000-\u001f\u007f]/u.test(v);
export function sanitizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'INVALID_REQUEST', 'Each URL must be absolute.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) return ''; // Internal/file/data URLs carry no provider metadata.
  // Origin only: paths can contain document IDs, emails, tokens, or search terms.
  return `${url.protocol}//${url.host}`;
}

export function validateTabs(value: unknown): Tab[] {
  const bad = () => {
    throw new HttpError(
      400,
      'INVALID_REQUEST',
      'Expected 1–100 tabs with unique nonnegative safe integer IDs, titles (1–300 characters), and absolute URLs (1–2048 characters).',
    );
  };
  if (
    !record(value) ||
    !keys(value, ['tabs']) ||
    !Array.isArray(value.tabs) ||
    value.tabs.length < 1 ||
    value.tabs.length > LIMITS.tabs
  )
    return bad();
  const seen = new Set<number>();
  return value.tabs.map((t) => {
    if (
      !record(t) ||
      !keys(t, ['id', 'title', 'url']) ||
      !id(t.id) ||
      seen.has(t.id) ||
      typeof t.title !== 'string' ||
      !t.title.trim() ||
      t.title.length > LIMITS.title ||
      !cleanText(t.title) ||
      typeof t.url !== 'string' ||
      !t.url ||
      t.url.length > LIMITS.url ||
      !cleanText(t.url)
    )
      return bad();
    seen.add(t.id);
    return { id: t.id, title: t.title.trim(), url: sanitizeUrl(t.url) };
  });
}

export function validateSuggestion(value: unknown, tabs: Tab[]): Suggestion {
  const bad = (): never => {
    throw new HttpError(
      502,
      'INVALID_AI_RESPONSE',
      'The AI returned invalid grouping suggestions.',
    );
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
    if (!id(v) || !allowed.has(v) || seen.has(v)) return bad();
    seen.add(v);
    return v;
  };
  const groups = value.groups.map((g) => {
    if (
      !record(g) ||
      !keys(g, ['name', 'tabIds']) ||
      typeof g.name !== 'string' ||
      !g.name.trim() ||
      g.name.length > LIMITS.name ||
      !cleanText(g.name) ||
      !Array.isArray(g.tabIds) ||
      g.tabIds.length < 2 ||
      g.tabIds.length > tabs.length
    )
      return bad();
    return { name: g.name.trim(), tabIds: g.tabIds.map(assign) };
  });
  const ungroupedTabIds = value.ungroupedTabIds.map(assign);
  for (const t of tabs) if (!seen.has(t.id)) ungroupedTabIds.push(t.id);
  return { groups, ungroupedTabIds };
}

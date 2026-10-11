import { prepareTabs, validateSuggestion, isEligibleTab } from './grouping.ts';
import type { ExistingGroup } from './grouping.ts';
import type { OpenTab } from './tabs.ts';

export const REQUEST_TIMEOUT_MS = 30_000;
export async function requestSuggestions(
  tabs: OpenTab[],
  baseUrl: string | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  existingGroups: ExistingGroup[] = [],
) {
  if (!baseUrl?.trim())
    throw new Error(
      'Backend URL is missing. Set WXT_BACKEND_BASE_URL and rebuild the extension.',
    );
  let endpoint: string;
  try {
    const base = new URL(baseUrl);
    if (
      !['http:', 'https:'].includes(base.protocol) ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      base.pathname !== '/'
    )
      throw new Error();
    endpoint = new URL('/api/group-tabs', base).href;
  } catch {
    throw new Error(
      'Backend URL must be an HTTP(S) origin without credentials, paths, queries, or fragments.',
    );
  }
  const prepared = prepareTabs(tabs);
  if (!prepared.tabs.length)
    throw new Error('No tabs to organize. Open a website and try again.');
  const body = existingGroups.length ? JSON.stringify({ tabs: prepared.tabs, existingGroups: existingGroups.map(group => ({ ...group, tabIds: tabs.filter(tab => isEligibleTab(tab) && tab.groupId === group.id).map(tab => tab.id!) })) }) : prepared.body;
  if (new TextEncoder().encode(body).byteLength > 65_536)
    throw new Error('Tab and group data exceeds the request limit. Reduce open tabs or groups and try again.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new Error(
        controller.signal.aborted
          ? 'The request timed out. Please try again.'
          : 'Couldn’t connect to the suggestion service. Please try again.',
      );
    }
    if (!response.ok) {
      const messages: Record<number, string> = {
        429: 'Too many requests. Please try again later.',
        413: 'The request is too large. Close some tabs and try again.',
        400: 'Couldn’t use the current tab details. Refresh your tabs and try again.',
        503: 'Suggestions are temporarily unavailable. Please try again later.',
        504: 'The AI service timed out. Please try again.',
      };
      throw new Error(
        messages[response.status] ??
          'Couldn’t generate suggestions. Please try again.',
      );
    }
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error(
        controller.signal.aborted
          ? 'The request timed out. Please try again.'
          : 'Couldn’t read the suggestions. Please try again.',
      );
    }
    return {
      ...prepared,
      suggestion: validateSuggestion(value, prepared.tabs, existingGroups),
    };
  } finally {
    clearTimeout(timer);
  }
}

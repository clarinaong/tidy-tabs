import { browser } from 'wxt/browser';

export interface OpenTab {
  id: number | undefined;
  windowId: number;
  title: string;
  url?: string;
}

export async function getOpenTabs(): Promise<OpenTab[]> {
  const tabs = await browser.tabs.query({});

  return tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    url: tab.url,
    title: tab.title?.trim() || 'Untitled tab',
  }));
}

// Display labels stay local; they are never used to construct API requests.
export function tabLabel(tab: Pick<OpenTab, 'title' | 'url'>): string {
  const title = tab.title?.trim() || 'Untitled tab';
  try {
    const url = new URL(tab.url ?? '');
    if (!['http:', 'https:'].includes(url.protocol)) return title;
    const host = url.hostname.replace(/^www\./, '');
    if (/^google\.[a-z.]+$/.test(host) && url.pathname === '/search')
      return `${title === 'Untitled tab' ? 'Google Search' : title} — ${host}`;
    if (host === 'github.com') {
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}/${parts[1]} — ${host}`;
    }
    return `${title} — ${host}`;
  } catch { return title; }
}

// Only the latest query may update the live list, including after unsubscription.
export function watchOpenTabs(onTabs: (tabs: OpenTab[]) => void, onError: () => void) {
  let active = true;
  let version = 0;
  const refresh = async () => {
    const current = ++version;
    try {
      const tabs = await getOpenTabs();
      if (active && current === version) onTabs(tabs);
    } catch { if (active && current === version) onError(); }
  };
  const events = [browser.tabs.onUpdated, browser.tabs.onRemoved, browser.tabs.onCreated, browser.tabs.onReplaced, browser.tabs.onAttached, browser.tabs.onDetached];
  for (const event of events) event.addListener(refresh);
  void refresh();
  return () => {
    active = false;
    version++;
    for (const event of events) event.removeListener(refresh);
  };
}

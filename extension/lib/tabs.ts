import { browser } from 'wxt/browser';

export interface OpenTab {
  id: number | undefined;
  windowId: number;
  title: string;
}

export async function getOpenTabs(): Promise<OpenTab[]> {
  const tabs = await browser.tabs.query({});

  return tabs.map((tab) => ({
    id: tab.id,
    windowId: tab.windowId,
    title: tab.title?.trim() || 'Untitled tab',
  }));
}

// browser is WXT's wrapper for extension APIs
// tabs.query({}) retrieves tabs without limiting query to one window
// await waits for Chrome to return result
// map converts each result into fields our popup needs
// missing or blank titles become Untitled
// no need to read webpage content or get urls (at least for now)
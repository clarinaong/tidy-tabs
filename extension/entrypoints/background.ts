import { createViewHandoff } from '../lib/viewHandoff';
import { browser } from 'wxt/browser';
import { createGroupApplier } from '../lib/applyGroups';
import { requestSuggestions } from '../lib/api';
import { getOpenGroups, getOpenTabs } from '../lib/tabs';
import { createSessionController, type SessionCommand, type SessionState } from '../lib/session';

export default defineBackground(() => {
  const apply = createGroupApplier({
    readTabs: getOpenTabs,
    readGroups: getOpenGroups,
    group: options => browser.tabs.group({ ...options, tabIds: options.tabIds as [number, ...number[]] }),
    update: (id, options) => browser.tabGroups.update(id, options),
    ungroup: ids => browser.tabs.ungroup(ids as [number, ...number[]]),
  });
  const handle = createSessionController({
    load: async () => (await browser.storage.session.get('tidytabsSession')).tidytabsSession as SessionState | undefined,
    write: state => browser.storage.session.set({ tidytabsSession: state }),
    readTabs: getOpenTabs,
    readGroups: getOpenGroups,
    suggest: async (tabs, groups) => (await requestSuggestions(tabs, import.meta.env.WXT_BACKEND_BASE_URL, fetch, undefined, groups)).suggestion,
    apply,
    newId: () => crypto.randomUUID(),
  });
  const popupReturns = new Map<number, ReturnType<typeof createViewHandoff>>();
  const returnToPopup = (windowId: number) => {
    if (!popupReturns.has(windowId)) popupReturns.set(windowId, createViewHandoff({
      openPanel: () => browser.sidePanel.open({ windowId }),
      closePopup: () => {},
      closePanel: typeof browser.sidePanel.close === 'function' ? () => browser.sidePanel.close({ windowId }) : undefined,
      openPopup: () => browser.action.openPopup({ windowId }),
    }));
    return popupReturns.get(windowId)!('popup');
  };
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return;
    if (message?.type === 'tidytabs-open-popup') {
      if (!Number.isSafeInteger(message.windowId) || message.windowId < 0) return;
      return returnToPopup(message.windowId).then(() => ({ ok: true }), error => ({ ok: false, error: error instanceof Error ? error.message : 'Could not open the popup.' }));
    }
    if (message?.type !== 'tidytabs-session') return;
    return handle(message.command as SessionCommand);
  });
});

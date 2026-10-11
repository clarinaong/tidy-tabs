interface ViewApi {
  openPanel: () => Promise<void>;
  closePopup: () => void;
  openPopup: () => Promise<void>;
  closePanel?: () => Promise<void>;
  returnToPopup?: () => Promise<void>;
}

// Opening the panel can precede popup closure; the reverse switch must close
// the panel first, from a background context that survives panel destruction.
export function createViewHandoff(api: ViewApi) {
  let busy = false;
  return async (destination: 'panel' | 'popup') => {
    if (busy) return;
    busy = true;
    try {
      if (destination === 'panel') {
        await api.openPanel();
        api.closePopup();
      } else {
        if (api.returnToPopup) { await api.returnToPopup(); return; }
        if (!api.closePanel) throw new Error('Switching back requires Chrome 141 or newer. Close this panel and click the TidyTabs toolbar icon to reopen the popup.');
        await api.closePanel();
        await api.openPopup();
      }
    } finally { busy = false; }
  };
}

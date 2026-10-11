import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { watchOpenTabs, getOpenGroups, type OpenTab } from '../../lib/tabs';
import { isEligibleTab, type ExistingGroup } from '../../lib/grouping';
import type { SessionCommand, SessionState } from '../../lib/session';
import { isPreviewStale, havePreviewTabsChanged } from '../../lib/preview';
import { acceptSessionResponse } from '../../lib/sessionResponses';
import { createViewHandoff } from '../../lib/viewHandoff';
import { PopupView } from './PopupView';

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<SessionState | null>(null);
  const [groups, setGroups] = useState<ExistingGroup[] | undefined>();
  const operationError = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const mounted = useRef(true);
  const busy = useRef(false);
  const [windowId, setWindowId] = useState<number | undefined>();
  const handoffWindow = useRef<number | undefined>(undefined);
  handoffWindow.current = windowId;
  const [handoff] = useState(() => createViewHandoff({
    openPanel: () => browser.sidePanel.open({ windowId: handoffWindow.current! }),
    closePopup: () => window.close(),
    returnToPopup: async () => {
      const reply = await browser.runtime.sendMessage({ type: 'tidytabs-open-popup', windowId: handoffWindow.current });
      if (!reply?.ok) throw new Error(reply?.error ?? 'Could not open the popup. Click the TidyTabs toolbar icon.');
    },
    openPopup: () => browser.action.openPopup({ windowId: handoffWindow.current! }),
    closePanel: typeof browser.sidePanel.close === 'function' ? () => browser.sidePanel.close({ windowId: handoffWindow.current! }) : undefined,
  }));
  const currentSession = useRef<SessionState | null>(null);
  const [dispatching, setDispatching] = useState(false);
  const send = async (command: SessionCommand) => {
    const next: SessionState = await browser.runtime.sendMessage({ type: 'tidytabs-session', command });
    const accepted = acceptSessionResponse(currentSession.current, next);
    currentSession.current = accepted;
    if (mounted.current) setSession(accepted);
    return next;
  };
  useEffect(() => {
    mounted.current = true;
    void browser.windows.getCurrent().then(window => { if (mounted.current) setWindowId(window.id); });
    const refresh = () => { void send({ action: 'get' }).catch(() => {
      if (mounted.current) setError('Could not restore your preview. Reload the extension and try again.');
    }); };
    const changed = (_changes: unknown, area: string) => { if (area === 'session') refresh(); };
    browser.storage.onChanged.addListener(changed);
    refresh();
    return () => { mounted.current = false; browser.storage.onChanged.removeListener(changed); };
  }, []);
  useEffect(() => {
    setLoading(true);
    return watchOpenTabs(open => { setTabs(open); setLoading(false); }, () => {
      setError('Could not read your tabs. Please try again.'); setLoading(false);
    });
  }, [attempt]);
  const act = async (command: SessionCommand) => {
    if (busy.current) return null;
    busy.current = true; operationError.current = null; setDispatching(true); setError(null);
    try { return await send(command); }
    catch (error) { operationError.current = error instanceof Error ? error.message : 'Could not complete the action. Reopen TidyTabs to check its saved status.'; if (mounted.current) setError(operationError.current); return null; }
    finally { busy.current = false; if (mounted.current) setDispatching(false); }
  };
  const preview = session?.preview ?? null;
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = () => { const request = ++version; void getOpenGroups().then(current => { if (active && request === version) setGroups(current); }).catch(() => { if (active && request === version) setGroups(undefined); }); };
    const events = [browser.tabGroups.onCreated, browser.tabGroups.onUpdated, browser.tabGroups.onRemoved, browser.tabGroups.onMoved];
    for (const event of events) event.addListener(refresh);
    refresh();
    return () => { active = false; for (const event of events) event.removeListener(refresh); };
  }, []);
  const stale = !!preview && !loading && (session?.consumed
    ? havePreviewTabsChanged(preview, tabs)
    : isPreviewStale(preview, tabs, groups));
  if (!session && !error) return <main className="popup-shell"><div className="loading-card" role="status"><strong>Restoring your preview…</strong></div></main>;
  return <PopupView
    key={session?.resetToken ?? 'initial'}
    onReset={async () => {
      const reset = await act({ action: 'reset' });
      if (!reset) throw new Error(operationError.current ?? 'Could not reset the preview. Try again.');
      if (!location.pathname.includes('sidepanel')) window.close();
    }}
    onKeepOpen={!location.pathname.includes('sidepanel') && windowId !== undefined ? () => handoff('panel') : undefined}
    onOpenPopup={location.pathname.includes('sidepanel') && windowId !== undefined ? () => handoff('popup') : undefined}
    tabs={tabs.filter(isEligibleTab)}
    currentTabs={tabs}
    existingGroups={groups}
    skippedTabs={preview ? session!.skipped : tabs.filter(tab => !isEligibleTab(tab))}
    requested={!!preview}
    loading={loading || (!session && !error)}
    tabError={error}
    pending={!!session?.pending}
    applying={!!session?.applying || dispatching}
    applyOutcome={session?.outcome ?? (session?.consumed && !session.applying ? { kind: 'blocked', consumed: true, message: 'This preview was already attempted. Refresh suggestions or edit groups to review a fresh preview before applying again.' } : null)}
    suggestionError={session?.error ?? error}
    result={preview}
    stale={stale}
    onEditPreview={async draft => {
      if (!preview) throw new Error('No preview to edit.');
      const next = await act({ action: 'edit', id: preview.id, draft });
      if (!next?.editor) throw new Error(operationError.current ?? 'Could not read the latest tabs. Try again.');
      return next.editor;
    }}
    onSavePreview={async (suggestion, reviewed) => {
      if (!preview) return;
      const saved = await act({ action: 'save', id: preview.id, suggestion, reviewed });
      if (!saved) throw new Error(operationError.current ?? 'Could not save your preview.');
    }}
    onApply={async () => {
      const next = preview ? await act({ action: 'apply', id: preview.id }) : null;
      return next?.outcome ?? { kind: 'blocked', consumed: !!next?.consumed, message: 'Please wait for the current action to finish.' };
    }}
    onSuggest={() => void act({ action: 'suggest' })}
    onRetryTabs={() => setAttempt(value => value + 1)}
  />;
}

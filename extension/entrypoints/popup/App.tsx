import { useEffect, useMemo, useRef, useState } from 'react';
import { getOpenTabs, getOpenGroups, watchOpenTabs, type OpenTab } from '../../lib/tabs';

import { browser } from 'wxt/browser';
import { requestSuggestions } from '../../lib/api';
import { isEligibleTab, prepareTabs } from '../../lib/grouping';
import { createGroupApplier, type Preview } from '../../lib/applyGroups';
import type { ExistingGroup } from '../../lib/grouping';
import { isPreviewStale, havePreviewTabsChanged, reconcilePreview, assertValidPreview, applyReviewedPreview } from '../../lib/preview';
import { PopupView } from './PopupView';

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [pending, setPending] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [result, setResult] = useState<
    | (Awaited<ReturnType<typeof requestSuggestions>> & { snapshot: OpenTab[]; existingGroups: ExistingGroup[] })
    | null
  >(null);
  const [skipped, setSkipped] = useState<OpenTab[] | null>(null);
  const [groups, setGroups] = useState<ExistingGroup[] | undefined>();
  const [validationFailed, setValidationFailed] = useState(false);
  const consumedSnapshot = useRef<OpenTab[] | null>(null);
  const busy = useRef(false);
  const applying = useRef(false);
  const [applyPreview] = useState(() => createGroupApplier({
    readTabs: getOpenTabs, readGroups: getOpenGroups,
    group: options => browser.tabs.group({ ...options, tabIds: options.tabIds as [number, ...number[]] }),
    update: (id, options) => browser.tabGroups.update(id, options),
    ungroup: ids => browser.tabs.ungroup(ids as [number, ...number[]]),
  }));
  const apply = async (preview: Preview) => {
    if (busy.current) return { kind: 'blocked' as const, consumed: false, message: 'Wait for the current action to finish.' };
    busy.current = true; applying.current = true;
    try { const outcome = await applyReviewedPreview(preview, { readTabs: getOpenTabs, readGroups: getOpenGroups, apply: applyPreview }); if (outcome.consumed) consumedSnapshot.current = preview.tabs; return outcome; }
    finally { busy.current = false; applying.current = false; }
  };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      try {
        const groups = await getOpenGroups();
        if (active && current === version) setGroups(groups);
      } catch {
        if (active && current === version) {
          setValidationFailed(true);
          setError('Could not verify Chrome groups. Refresh suggestions or reopen TidyTabs.');
        }
      }
    };
    const events = [browser.tabGroups.onCreated, browser.tabGroups.onUpdated, browser.tabGroups.onRemoved, browser.tabGroups.onMoved];
    for (const event of events) event.addListener(refresh);
    void refresh();
    return () => { active = false; version++; for (const event of events) event.removeListener(refresh); };
  }, []);
  const review = async (preview: Preview) => {
    if (busy.current) throw new Error('Wait for the current action to finish.');
    busy.current = true;
    try {
      const [current, groups] = await Promise.all([getOpenTabs(), getOpenGroups()]);
      return reconcilePreview(preview, current, groups);
    } finally { busy.current = false; }
  };
  const saveReviewed = async (reviewed: Preview) => {
    if (busy.current) throw new Error('Wait for the current action to finish.');
    busy.current = true;
    try {
      const [current, groups] = await Promise.all([getOpenTabs(), getOpenGroups()]);
      if (isPreviewStale(reviewed, current, groups)) throw new Error('Your tabs changed again. Update tabs in the editor, then review and save.');
      const suggestion = assertValidPreview(reviewed);
      setResult({ ...prepareTabs(reviewed.tabs), snapshot: reviewed.tabs, suggestion, existingGroups: reviewed.existingGroups ?? [] });
      setSkipped(current.filter(tab => !isEligibleTab(tab)));
      setTabs(current); setGroups(groups); setValidationFailed(false); setError(null);
    } finally { busy.current = false; }
  };

  async function suggest() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setSuggestionError(null);
    setSkipped(null);
    setValidationFailed(false);
    try {
      const [current, existingGroups] = await Promise.all([getOpenTabs(), getOpenGroups()]);
      if (!mounted.current) return;
      setSkipped(current.filter((tab) => !isEligibleTab(tab)));
      const response = await requestSuggestions(
        current,
        import.meta.env.WXT_BACKEND_BASE_URL,
      );
      if (!mounted.current) return;
      // Reuse a same-name destination in each assigned window without
      // transmitting existing group metadata to the suggestion backend.
      const groups = response.suggestion.groups.flatMap(group => {
        const windows = [...new Set(group.tabIds.map(id => current.find(tab => tab.id === id)!.windowId))];
        return (windows.length ? windows : [undefined]).map(windowId => {
          const target = existingGroups.filter(existing => existing.name === group.name && existing.windowId === windowId).sort((a, b) => a.id - b.id)[0];
          return { ...group, tabIds: group.tabIds.filter(id => current.find(tab => tab.id === id)!.windowId === windowId), ...(target ? { existingGroupId: target.id } : {}) };
        });
      });
      setResult({ ...response, suggestion: { ...response.suggestion, groups }, snapshot: current.filter(isEligibleTab), existingGroups });
      try {
        const [latest, latestGroups] = await Promise.all([getOpenTabs(), getOpenGroups()]);
        if (!mounted.current) return;
        setTabs(latest); setGroups(latestGroups);
      } catch {
        if (mounted.current) setValidationFailed(true);
      }
    } catch (e) {
      if (mounted.current)
        setSuggestionError(
          e instanceof Error
            ? e.message
            : 'Could not read tabs or request suggestions. Please try again.',
        );
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    return watchOpenTabs(
      (openTabs) => {
        setTabs(openTabs);
        setError(null);
        setLoading(false);
      },
      () => {
        setValidationFailed(true);
        setError('Could not read your tabs. Please try again.');
        setLoading(false);
      },
    );
  }, [attempt]);

  // Keep the preview identity stable when live-tab events update the popup.
  const preview = useMemo(
    () =>
      result ? { tabs: result.snapshot, suggestion: result.suggestion, existingGroups: result.existingGroups } : null,
    [result],
  );
  const stale = !!preview && !loading && (validationFailed || (consumedSnapshot.current === preview.tabs
    ? havePreviewTabsChanged(preview, tabs) : isPreviewStale(preview, tabs, groups)));
  const eligibleTabs = tabs.filter(isEligibleTab);
  const skippedTabs = skipped ?? tabs.filter((tab) => !isEligibleTab(tab));
  return (
    <PopupView
      tabs={eligibleTabs}
      skippedTabs={skippedTabs}
      requested={skipped !== null}
      loading={loading}
      tabError={error}
      pending={pending}
      suggestionError={suggestionError}
      result={preview}
      existingGroups={groups}
      stale={stale}
      onEditPreview={review}
      onSavePreview={saveReviewed}
      onApply={apply}
      onSuggest={() => void suggest()}
      onRetryTabs={() => setAttempt((value) => value + 1)}
    />
  );
}

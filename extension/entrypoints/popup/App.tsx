import { useEffect, useMemo, useRef, useState } from 'react';
import { getOpenTabs, getOpenGroups, watchOpenTabs, type OpenTab } from '../../lib/tabs';

import { browser } from 'wxt/browser';
import { requestSuggestions } from '../../lib/api';
import { isEligibleTab, tabFingerprint } from '../../lib/grouping';
import { createGroupApplier, type Preview } from '../../lib/applyGroups';
import type { ExistingGroup } from '../../lib/grouping';
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
  const [stale, setStale] = useState(false);
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
    try { return await applyPreview(preview); }
    finally { busy.current = false; applying.current = false; }
  };
  const revision = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const changed = () => {
      revision.current++;
      if (!applying.current) setStale(true);
    };
    browser.tabs.onUpdated.addListener(changed);
    browser.tabs.onRemoved.addListener(changed);
    browser.tabs.onCreated.addListener(changed);
    browser.tabs.onReplaced.addListener(changed);
    browser.tabs.onAttached.addListener(changed);
    browser.tabs.onDetached.addListener(changed);
    return () => {
      mounted.current = false;
      browser.tabs.onUpdated.removeListener(changed);
      browser.tabs.onRemoved.removeListener(changed);
      browser.tabs.onCreated.removeListener(changed);
      browser.tabs.onReplaced.removeListener(changed);
      browser.tabs.onAttached.removeListener(changed);
      browser.tabs.onDetached.removeListener(changed);
    };
  }, []);

  async function suggest() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setSuggestionError(null);
    setSkipped(null);
    setStale(Boolean(result));
    const startRevision = revision.current;
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
        const latest = await getOpenTabs();
        if (!mounted.current) return;
        setStale(
          revision.current !== startRevision ||
            tabFingerprint(current) !== tabFingerprint(latest),
        );
      } catch {
        if (mounted.current) setStale(true);
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
      stale={stale}
      onApply={apply}
      onSuggest={() => void suggest()}
      onRetryTabs={() => setAttempt((value) => value + 1)}
    />
  );
}

import { useEffect, useRef, useState } from 'react';
import { getOpenTabs, watchOpenTabs, type OpenTab } from '../../lib/tabs';

import { browser } from 'wxt/browser';
import { requestSuggestions } from '../../lib/api';
import { isEligibleTab, tabFingerprint } from '../../lib/grouping';
import { PopupView } from './PopupView';

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [pending, setPending] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [result, setResult] = useState<(Awaited<ReturnType<typeof requestSuggestions>> & { snapshot: OpenTab[] }) | null>(null);
  const [skipped, setSkipped] = useState<OpenTab[] | null>(null);
  const [stale, setStale] = useState(false);
  const busy = useRef(false);
  const revision = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    const changed = () => { revision.current++; setStale(true); };
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
    setPending(true); setSuggestionError(null); setSkipped(null); setStale(Boolean(result));
    const startRevision = revision.current;
    try {
      const current = await getOpenTabs();
      if (!mounted.current) return;
      setSkipped(current.filter(tab => !isEligibleTab(tab)));
      const response = await requestSuggestions(current, import.meta.env.WXT_BACKEND_BASE_URL);
      if (!mounted.current) return;
      setResult({ ...response, snapshot: current.filter(isEligibleTab) });
      try {
        const latest = await getOpenTabs();
        if (!mounted.current) return;
        setStale(revision.current !== startRevision || tabFingerprint(current) !== tabFingerprint(latest));
      } catch { if (mounted.current) setStale(true); }
    } catch (e) {
      if (mounted.current) setSuggestionError(e instanceof Error ? e.message : 'Could not read tabs or request suggestions. Please try again.');
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    setError(null);
    return watchOpenTabs(
      openTabs => { setTabs(openTabs); setError(null); setLoading(false); },
      () => { setError('Could not read your tabs. Please try again.'); setLoading(false); },
    );
  }, [attempt]);

  const eligibleTabs = tabs.filter(isEligibleTab);
  const skippedTabs = skipped ?? tabs.filter(tab => !isEligibleTab(tab));
  return <PopupView
    tabs={eligibleTabs}
    skippedTabs={skippedTabs}
    requested={skipped !== null}
    loading={loading}
    tabError={error}
    pending={pending}
    suggestionError={suggestionError}
    result={result ? { tabs: result.snapshot, suggestion: result.suggestion } : null}
    stale={stale}
    onSuggest={() => void suggest()}
    onRetryTabs={() => setAttempt(value => value + 1)}
  />;
}

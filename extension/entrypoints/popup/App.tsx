import { useEffect, useRef, useState } from 'react';
import { getOpenTabs, tabLabel, watchOpenTabs, type OpenTab } from '../../lib/tabs';

import { browser } from 'wxt/browser';
import { requestSuggestions } from '../../lib/api';
import { isEligibleTab, tabFingerprint } from '../../lib/grouping';

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const [pending, setPending] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [result, setResult] = useState<(Awaited<ReturnType<typeof requestSuggestions>> & { labels: Map<number, string> }) | null>(null);
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
      setResult({ ...response, labels: new Map(current.filter(t => t.id !== undefined).map(t => [t.id!, tabLabel(t)])) });
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
  const skippedCount = skippedTabs.length;
  const skippedLabel = `${skippedCount} ${skippedCount === 1 ? 'tab' : 'tabs'}`;

  return (
    <main>
      <header>
        <h1>TidyTabs</h1>
        <p>Your tabs, intelligently organized.</p>
      </header>

      <section aria-label="Grouping suggestions" aria-busy={pending}>
        <h2>Group suggestions</h2>
        <p>Suggest groups sends tab titles and URL origins to the backend and Groq to suggest groups. Chrome tab groups stay unchanged.</p>
        <div className="suggestion-action">
          <button disabled={pending} onClick={() => void suggest()}>{result ? 'Refresh suggestions' : 'Suggest groups'}</button>
          {pending && <span role="status">Generating suggestions…</span>}
        </div>
        {(skipped !== null || (!loading && !error)) && (
          <details className="skipped-tabs">
            <summary>
              {skipped !== null
                ? `${skippedLabel} skipped for this request.`
                : `${skippedLabel} will be skipped.`}
            </summary>
            <p>Browser pages and tabs without supported website URLs or valid IDs are excluded. Skipped tabs are not sent for suggestions.</p>
            {skippedTabs.length > 0 && <ul aria-label="Skipped tabs">
              {skippedTabs.map((tab, index) => <li key={`${tab.id ?? 'missing'}-${index}`}>{tabLabel(tab)}</li>)}
            </ul>}
          </details>
        )}
        {suggestionError && <p role="alert">{suggestionError}</p>}
        {!pending && !result && !suggestionError && <p>Request suggestions when you are ready.</p>}
        {result && !pending && <>
          <p role="status">{stale ? 'Tabs changed or could not be checked. These suggestions are an earlier snapshot; request fresh suggestions.' : 'Suggestions are a snapshot of the tabs sent for this request.'}</p>
          {result.suggestion.groups.length === 0 && <p>No groups suggested.</p>}
          {result.suggestion.groups.map((group, index) => <div key={index}>
            <h3>{group.name}</h3>
            <ul>{group.tabIds.map(id => <li key={id}>{result.labels.get(id)}</li>)}</ul>
          </div>)}
          <h3>Ungrouped tabs · {result.suggestion.ungroupedTabIds.length}</h3>
          {result.suggestion.ungroupedTabIds.length === 0 ? <p>No ungrouped tabs.</p> : <ul>{result.suggestion.ungroupedTabIds.map(id => <li key={id}>{result.labels.get(id)}</li>)}</ul>}
        </>}
      </section>

      {!result && <section aria-label="Tabs to organize" aria-busy={loading}>
        {loading ? (
          <p role="status">Loading your tabs…</p>
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <h2>Tabs to organize · {eligibleTabs.length}</h2>

            {eligibleTabs.length === 0 ? (
              <p>Open a website to get group suggestions.</p>
            ) : (
              <ul>
                {eligibleTabs.map((tab, index) => (
                  <li key={tab.id ?? `missing-${index}`}>
                    {tabLabel(tab)}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>}
    </main>
  );
}

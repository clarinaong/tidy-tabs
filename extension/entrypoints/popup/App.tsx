import { useEffect, useState } from 'react';
import { getOpenTabs, type OpenTab } from '../../lib/tabs';

export default function App() {
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function loadTabs() {
      setLoading(true);
      setError(null);

      try {
        const openTabs = await getOpenTabs();

        if (!cancelled) {
          setTabs(openTabs);
        }
      } catch {
        if (!cancelled) {
          setError('Could not read your tabs. Please try again.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadTabs();

    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return (
    <main>
      <header>
        <h1>TidyTabs</h1>
        <p>Your tabs, intelligently organized.</p>
      </header>

      <section aria-label="Open tabs" aria-busy={loading}>
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
            <h2>Open tabs · {tabs.length}</h2>

            {tabs.length === 0 ? (
              <p>No open tabs found.</p>
            ) : (
              <ul>
                {tabs.map((tab, index) => (
                  <li key={tab.id ?? `missing-${index}`}>
                    {tab.title}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </main>
  );
}
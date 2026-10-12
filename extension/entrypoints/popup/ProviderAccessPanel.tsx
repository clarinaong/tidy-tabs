import { useState } from 'react';
import {
  PROVIDERS,
  type ProviderId,
  type ProviderAccess,
} from '../../lib/providers.ts';

export function ProviderAccessPanel({
  hasAccess,
  busy,
  onSave,
  onClear,
}: {
  hasAccess: boolean;
  busy: boolean;
  onSave: (access: ProviderAccess) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [provider, setProvider] = useState<ProviderId>('groq');
  const [model, setModel] = useState<string>(PROVIDERS.groq.model);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perform = async (operation: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await operation();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Could not update API access.',
      );
    } finally {
      setWorking(false);
    }
  };
  return (
    <section
      className={`beta-access${hasAccess ? ' beta-access-ready' : ''}`}
      aria-label="AI provider access"
    >
      {hasAccess ? (
        <>
          <div className="beta-access-row">
            <span>API key saved for this browser session</span>
            <button
              className="secondary-button"
              disabled={working}
              onClick={() => void perform(onClear)}
            >
              Clear API key
            </button>
          </div>
          <p>Clear the key to change provider or model.</p>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const key = input;
            setShowKey(false);
            void perform(async () => {
              if (key.trim().length < 10)
                throw new Error('Too short — enter at least 10 characters.');
              await onSave({ provider, model: model.trim(), key });
              setInput('');
            });
          }}
        >
          <h2>CONNECT YOUR AI PROVIDER</h2>
          <p>
            Use your own API key. No TidyTabs hosting or invite is needed.
            Provider charges and limits apply. OpenAI requires an API key; a
            ChatGPT subscription alone does not provide API access.
          </p>
          <label htmlFor="ai-provider">Provider</label>
          <select
            id="ai-provider"
            value={provider}
            disabled={working || busy}
            onChange={(event) => {
              const next = event.target.value as ProviderId;
              setProvider(next);
              setModel(PROVIDERS[next].model);
              setInput('');
              setShowKey(false);
            }}
          >
            {Object.entries(PROVIDERS).map(([id, value]) => (
              <option key={id} value={id}>
                {value.label}
              </option>
            ))}
          </select>
          <label htmlFor="ai-model">Model</label>
          <select
            id="ai-model"
            value={model}
            onChange={(event) => setModel(event.target.value)}
            required
            disabled={working || busy}
          >
            {PROVIDERS[provider].models.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
          <p>Available models depend on your provider account.</p>
          <div className="api-key-label-row">
            <label htmlFor="api-key">API key</label>
            {error && (
              <span id="api-key-error" className="api-key-error" role="alert">
                {error}
              </span>
            )}
          </div>
          <div className="api-key-field">
            <input
              id="api-key"
              aria-invalid={!!error}
              aria-describedby={error ? 'api-key-error' : undefined}
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Paste your API key"
              required
              disabled={working || busy}
            />
            <button
              className="api-key-toggle"
              type="button"
              aria-label={showKey ? 'Hide API key' : 'Show API key'}
              title={showKey ? 'Hide API key' : 'Show API key'}
              aria-controls="api-key"
              aria-pressed={showKey}
              disabled={working || busy}
              onClick={() => setShowKey((value) => !value)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {showKey ? (
                  <>
                    <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a17 17 0 0 1-3.1 4.2M6.3 6.3C3.4 8.1 2 12 2 12s3 7 10 7a11 11 0 0 0 5.7-1.6" />
                  </>
                ) : (
                  <>
                    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <button
            className="suggest-button"
            type="submit"
            disabled={working || busy || !input.trim() || !model.trim()}
          >
            Use key for this session
          </button>
        </form>
      )}
      <details>
        <summary>Privacy &amp; key storage</summary>
        <p>
          Saving sends nothing. Only Suggest groups sends tab titles, sanitized
          URL origins, and existing group metadata directly to your selected
          provider. Titles may contain searches or document names. Webpage
          contents aren’t retrieved. The API key is held in memory-only Chrome
          session storage, restricted to trusted extension pages. It survives
          popup closure and clears when Chrome restarts or the extension
          reloads, updates, or is disabled. It is not encrypted vault storage;
          extension code and someone with access to your browser can read it.
          Clearing the key cancels pending suggestions but cannot recall
          metadata already sent or guarantee stopping provider charges.
        </p>
      </details>
      {hasAccess && error && (
        <p className="api-key-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

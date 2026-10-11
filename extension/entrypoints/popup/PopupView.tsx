import { useState } from 'react';
import { GroupEditor } from './GroupEditor';
import type { OpenTab } from '../../lib/tabs';
import { tabLabel, tabFaviconUrl } from '../../lib/tabs';
import { iconAppearance } from '../../lib/favicon';
import type { Suggestion } from '../../lib/grouping';

interface Props {
  tabs: OpenTab[];
  skippedTabs: OpenTab[];
  requested: boolean;
  loading: boolean;
  tabError: string | null;
  pending: boolean;
  suggestionError: string | null;
  result: { tabs: OpenTab[]; suggestion: Suggestion } | null;
  stale: boolean;
  onSuggest: () => void;
  onRetryTabs: () => void;
}

export function TabRow({
  tab,
  groupName,
  selection,
  editing,
}: {
  tab: OpenTab;
  groupName?: string;
  selection?: { checked: boolean; onToggle: () => void };
  editing?: {
    destination: number;
    groups: string[];
    onMove: (destination: number) => void;
    onDragStart: () => void;
    onDragEnd: () => void;
  };
}) {
  const iconUrl = tabFaviconUrl(tab);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  const [lightIcon, setLightIcon] = useState<string | null>(null);
  const label = tabLabel(tab);
  const separator = label.lastIndexOf(' — ');
  const title = separator >= 0 ? label.slice(0, separator) : label;
  const domain = separator >= 0 ? label.slice(separator + 3) : 'Browser page';
  return (
    <li
      className="tab-row"
      draggable={!!editing && !selection}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', String(tab.id));
        event.dataTransfer.effectAllowed = 'move';
        editing?.onDragStart();
      }}
      onDragEnd={editing?.onDragEnd}
    >
      {selection && (
        <input
          type="checkbox"
          className="tab-checkbox"
          aria-label={`Select ${title}`}
          checked={selection.checked}
          onChange={selection.onToggle}
        />
      )}
      <span
        className={`site-icon${iconUrl && failedIcon !== iconUrl && lightIcon === iconUrl ? ' site-icon-light' : ''}`}
        aria-hidden="true"
      >
        {iconUrl && failedIcon !== iconUrl ? (
          <img
            src={iconUrl}
            alt=""
            width="18"
            height="18"
            onLoad={(event) => {
              const appearance = iconAppearance(event.currentTarget);
              setLightIcon(appearance === 'light' ? iconUrl : null);
              if (appearance === 'empty') setFailedIcon(iconUrl);
            }}
            onError={() => setFailedIcon(iconUrl)}
          />
        ) : (
          domain[0]?.toUpperCase() || '·'
        )}
      </span>
      <div className="tab-copy">
        <span className="tab-title">{title}</span>
        <span className="tab-domain">{domain}</span>
        {groupName && <span className="tab-group-label">{groupName}</span>}
      </div>
      {editing && !selection && (
        <label className="move-control">
          Move to
          <select
            aria-label={`Move ${title} to group`}
            value={editing.destination}
            onChange={(event) => editing.onMove(Number(event.target.value))}
          >
            <option value={-1}>Ungrouped</option>
            {editing.groups.map((name, index) => (
              <option key={index} value={index}>
                {name || 'Unnamed group'}
              </option>
            ))}
          </select>
        </label>
      )}
    </li>
  );
}

function TabCard({
  name,
  tabs,
  ungrouped = false,
  collapsed,
  onToggle,
}: {
  name: string;
  tabs: OpenTab[];
  ungrouped?: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <article className={`group-card${ungrouped ? ' ungrouped-card' : ''}`}>
      <button
        className="group-heading"
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className="group-dot" aria-hidden="true" />
        <h3>{name}</h3>
        <span className="count">{tabs.length}</span>
        <span
          className={`chevron ${collapsed ? '' : 'expanded'}`}
          aria-hidden="true"
        />
      </button>
      {!collapsed &&
        (tabs.length > 0 ? (
          <ul>
            {tabs.map((tab, index) => (
              <TabRow key={`${tab.id ?? 'missing'}-${index}`} tab={tab} />
            ))}
          </ul>
        ) : (
          <p className="card-empty">No tabs here.</p>
        ))}
    </article>
  );
}

function Notice({
  title,
  children,
  kind = 'info',
}: {
  title: string;
  children: React.ReactNode;
  kind?: 'info' | 'error' | 'warning';
}) {
  return (
    <div
      className={`notice ${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <strong>{title}</strong>
      <p>{children}</p>
    </div>
  );
}

export function PopupView(props: Props) {
  const {
    tabs,
    skippedTabs,
    requested,
    loading,
    tabError,
    pending,
    suggestionError,
    result: generatedResult,
    stale,
    onSuggest,
    onRetryTabs,
  } = props;
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState<{
    source: Props['result'];
    suggestion: Suggestion;
  } | null>(null);
  const edited = saved?.source === generatedResult && saved !== null;
  const result =
    generatedResult && edited
      ? { ...generatedResult, suggestion: saved.suggestion }
      : generatedResult;
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const matches = (tab: OpenTab) =>
    tabLabel(tab).toLowerCase().includes(query.trim().toLowerCase());
  const byId = new Map(result?.tabs.map((tab) => [tab.id, tab]) ?? []);
  const resolve = (ids: number[]) =>
    ids.flatMap((id) => {
      const tab = byId.get(id);
      return tab ? [tab] : [];
    });
  const visibleTabs = (result ? result.tabs : tabs).filter(matches);
  const visibleCount = visibleTabs.length;
  const groupIds = result
    ? [...result.suggestion.groups.map((_, i) => `group-${i}`), 'ungrouped']
    : ['initial'];
  const allCollapsed = groupIds.every((id) => collapsed.has(id));
  return (
    <main className="popup-shell">
      <header className="brand-header">
        <div className="brand-row">
          <img
            className="brand-icon"
            src="/icon/128.png"
            alt=""
            width="46"
            height="46"
          />
          <div>
            <h1>TidyTabs</h1>
            <p>
              {editing
                ? 'Edit your groups'
                : 'Your tabs, intelligently organized'}
            </p>
          </div>
        </div>
        <label className="search-field">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-4-4" />
          </svg>
          <input
            aria-label="Search tabs in preview"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search open tabs"
            type="search"
          />
        </label>
      </header>

      {editing && result ? (
        <GroupEditor
          suggestion={result.suggestion}
          tabs={result.tabs}
          query={query}
          stale={stale}
          onCancel={() => setEditing(false)}
          onSave={(suggestion) => {
            setSaved({ source: generatedResult, suggestion });
            setCollapsed(new Set());
            setEditing(false);
          }}
        />
      ) : (
        <>
          <section
            className="content"
            aria-label="Group suggestions"
            aria-busy={pending || loading}
          >
            <div className="section-heading">
              <h2>
                {loading && !result
                  ? 'READING TABS'
                  : query.trim()
                    ? `${visibleCount} ${visibleCount === 1 ? 'RESULT' : 'RESULTS'}`
                    : `${visibleCount} ${visibleCount === 1 ? 'TAB' : 'TABS'}${result ? ' IN PREVIEW' : ' TO ORGANIZE'}`}
              </h2>
              {!pending && !loading && !query.trim() && visibleCount > 0 && (
                <button
                  className="collapse-button"
                  onClick={() =>
                    setCollapsed(allCollapsed ? new Set() : new Set(groupIds))
                  }
                >
                  {allCollapsed ? 'Expand all' : 'Collapse all'}
                </button>
              )}
            </div>

            {(requested || (!loading && !tabError)) && (
              <details className="skipped-tabs">
                <summary>
                  <span className="chevron" aria-hidden="true" />
                  {skippedTabs.length}{' '}
                  {skippedTabs.length === 1 ? 'tab' : 'tabs'} excluded from
                  suggestions
                </summary>
                <p>
                  Some tabs, like Chrome settings or blank pages, can’t be
                  included. They stay as they are.
                </p>
                {skippedTabs.length > 0 && (
                  <ul>
                    {skippedTabs.map((tab, index) => (
                      <TabRow key={index} tab={tab} />
                    ))}
                  </ul>
                )}
              </details>
            )}

            {suggestionError && (
              <Notice title="Couldn’t get suggestions" kind="error">
                {suggestionError}
              </Notice>
            )}
            {result && stale && (
              <Notice title="Your tabs have changed" kind="warning">
                These groups are based on the tabs you had open earlier. Refresh
                suggestions to include your latest changes.
              </Notice>
            )}
            {pending && (
              <div className="loading-card" role="status">
                <span className="spinner" aria-hidden="true" />
                <strong>Finding tabs that belong together</strong>
                <div className="skeleton" />
                <div className="skeleton short" />
              </div>
            )}

            {!pending && result && (
              <>
                {(!stale || edited) && (
                  <p className="snapshot-note">
                    {edited
                      ? 'Edited preview for your earlier tabs.'
                      : 'Review and edit your suggested groups.'}
                  </p>
                )}
                {result.suggestion.groups.length === 0 && (
                  <Notice
                    title={
                      edited ? 'No named groups' : 'No shared groups found'
                    }
                  >
                    {edited
                      ? 'Your tabs are in Ungrouped. Edit groups to create a group.'
                      : 'Your tabs are listed below so you can review them.'}
                  </Notice>
                )}
                {query.trim() && visibleCount === 0 && (
                  <Notice title="No matching tabs">
                    Try another title or website name.
                  </Notice>
                )}
                {query.trim() ? (
                  visibleCount > 0 && (
                    <div className="group-card search-results">
                      <ul aria-label="Search results">
                        {visibleTabs.map((tab) => (
                          <TabRow
                            key={tab.id}
                            tab={tab}
                            groupName={
                              result.suggestion.groups.find((group) =>
                                group.tabIds.includes(tab.id!),
                              )?.name ?? 'Ungrouped'
                            }
                          />
                        ))}
                      </ul>
                    </div>
                  )
                ) : (
                  <>
                    {result.suggestion.groups.map((group, index) => {
                      const filtered = resolve(group.tabIds).filter(matches);
                      return query.trim() && filtered.length === 0 ? null : (
                        <TabCard
                          key={index}
                          name={group.name}
                          tabs={filtered}
                          collapsed={collapsed.has(`group-${index}`)}
                          onToggle={() => toggle(`group-${index}`)}
                        />
                      );
                    })}
                    {(!query.trim() ||
                      resolve(result.suggestion.ungroupedTabIds).some(
                        matches,
                      )) && (
                      <TabCard
                        name="Ungrouped"
                        tabs={resolve(result.suggestion.ungroupedTabIds).filter(
                          matches,
                        )}
                        ungrouped
                        collapsed={collapsed.has('ungrouped')}
                        onToggle={() => toggle('ungrouped')}
                      />
                    )}
                  </>
                )}
              </>
            )}

            {!pending && !result && (
              <>
                {loading ? (
                  <div className="loading-card" role="status">
                    <span className="spinner" aria-hidden="true" />
                    <strong>Reading your open tabs</strong>
                    <div className="skeleton" />
                    <div className="skeleton short" />
                  </div>
                ) : tabError ? (
                  <Notice title="Couldn’t read your tabs" kind="error">
                    {tabError}
                    <button className="text-button" onClick={onRetryTabs}>
                      Try again
                    </button>
                  </Notice>
                ) : tabs.length === 0 ? (
                  <div className="empty-state">
                    <span className="empty-sparkle" aria-hidden="true">
                      ✦
                    </span>
                    <h3>A little room to focus</h3>
                    <p>Open a website to get group suggestions.</p>
                  </div>
                ) : visibleCount === 0 ? (
                  <Notice title="No matching tabs">
                    Try another title or website name.
                  </Notice>
                ) : query.trim() ? (
                  <div className="group-card search-results">
                    <ul aria-label="Search results">
                      {visibleTabs.map((tab) => (
                        <TabRow key={tab.id} tab={tab} />
                      ))}
                    </ul>
                  </div>
                ) : (
                  <>
                    <p className="snapshot-note">
                      A clearer space starts with a suggestion.
                    </p>
                    <TabCard
                      name="Tabs to organize"
                      tabs={visibleTabs}
                      collapsed={collapsed.has('initial')}
                      onToggle={() => toggle('initial')}
                    />
                  </>
                )}
              </>
            )}
          </section>

          <footer className={`action-footer${result ? ' preview-footer' : ''}`}>
            <div className="suggestion-action">
              {result && !pending && (
                <button
                  className="secondary-button"
                  onClick={() => setEditing(true)}
                >
                  Edit groups
                </button>
              )}
              {pending ? (
                <span className="pending-label" role="status">
                  Generating suggestions…
                </span>
              ) : (
                <button
                  className={
                    result
                      ? 'secondary-button refresh-button'
                      : 'suggest-button'
                  }
                  disabled={loading}
                  onClick={onSuggest}
                >
                  {result ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 7v5h-5" />
                      <path d="M20 12a8 8 0 1 0-2.3 5.7M20 12a8 8 0 0 0-2.3-5.7" />
                    </svg>
                  ) : (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      aria-hidden="true"
                    >
                      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
                    </svg>
                  )}
                  {result ? 'Refresh suggestions' : 'Suggest groups'}
                </button>
              )}
            </div>
            <p className="footer-note">
              Suggestions only. Your Chrome groups stay unchanged.
            </p>
            <details className="privacy-note">
              <summary>What gets shared?</summary>
              <p>
                Only when you request suggestions, tab titles and website names
                go to Groq AI. Titles may include searches or document names;
                full web addresses and page contents aren’t shared.
              </p>
            </details>
          </footer>
        </>
      )}
    </main>
  );
}

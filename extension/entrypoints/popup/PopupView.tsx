import { useRef, useState } from 'react';
import { describeGroupChange } from '../../lib/groupChange';
import { isPreviewStale, STALE_PREVIEW_MESSAGE } from '../../lib/preview';
import type { ExistingGroup } from '../../lib/grouping';
import type { ApplyOutcome, Preview } from '../../lib/applyGroups';
import { GroupEditor } from './GroupEditor';
import type { OpenTab } from '../../lib/tabs';
import { tabLabel, tabFaviconUrl } from '../../lib/tabs';
import { iconAppearance } from '../../lib/favicon';
import type { Suggestion } from '../../lib/grouping';

interface Props {
  tabs: OpenTab[];
  currentTabs?: OpenTab[];
  skippedTabs: OpenTab[];
  requested: boolean;
  loading: boolean;
  tabError: string | null;
  pending: boolean;
  suggestionError: string | null;
  result: Preview | null;
  onEditPreview?: (preview: Preview) => Promise<Preview>;
  onSavePreview?: (preview: Preview) => Promise<void>;
  existingGroups?: ExistingGroup[];
  onApply?: (preview: Preview) => Promise<ApplyOutcome>;
  stale: boolean;
  onSuggest: () => void;
  onRetryTabs: () => void;
}

export function TabRow({
  tab,
  groupName,
  windowLabel,
  selection,
  editing,
}: {
  tab: OpenTab;
  groupName?: string;
  windowLabel?: string;
  selection?: { checked: boolean; onToggle: () => void };
  editing?: {
    destination: number;
    groups: string[];
    optionIndexes?: number[];
    onMove: (destination: number) => void;
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
    >
      {selection && (
        <input
          type="checkbox"
          className="tab-checkbox"
          aria-label={`Select ${title}${windowLabel ? ` · ${windowLabel}` : ''}`}
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
        {windowLabel && <span className="tab-group-label">{windowLabel}</span>}
      </div>
      {editing && !selection && (
        <label className="move-control">
          Move to
          <select
            aria-label={`Move ${title}${windowLabel ? ` · ${windowLabel}` : ''} to group`}
            value={editing.destination}
            onChange={(event) => editing.onMove(Number(event.target.value))}
          >
            <option value={-1}>Ungrouped</option>
            {editing.groups.map((name, index) => (
              <option key={index} value={editing.optionIndexes?.[index] ?? index}>
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
  existing = false,
  subtitle,
  tabWindowLabel,
}: {
  existing?: boolean;
  subtitle?: string;
  tabWindowLabel?: (tab: OpenTab) => string | undefined;
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
        <h3>{name}{(subtitle || existing) && <span className="existing-group-label">{subtitle || 'Existing Chrome group'}</span>}</h3>
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
              <TabRow key={`${tab.id ?? 'missing'}-${index}`} tab={tab} windowLabel={tabWindowLabel?.(tab)} />
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
  const [application, setApplication] = useState<{ source: Props['result']; outcome: ApplyOutcome } | null>(null);
  const [applying, setApplying] = useState(false);
  const applyLock = useRef(false);
  const outcome = application?.source === generatedResult ? application.outcome : null;
  const [preparing, setPreparing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [editorPreview, setEditorPreview] = useState<Preview | null>(null);
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
  const apply = async () => {
    if (!result || stale || pending || preparing || applying || applyLock.current || outcome?.consumed || !props.onApply) return;
    applyLock.current = true; setApplying(true);
    try {
      const outcome = await props.onApply(result);
      setApplication({ source: generatedResult, outcome });
    } catch {
      setApplication({ source: generatedResult, outcome: { kind: 'partial', consumed: true, message: 'Grouping could not be confirmed. Review Chrome and refresh suggestions before trying again.' } });
    } finally { applyLock.current = false; setApplying(false); }
  };
  const edit = async () => {
    if (!result || preparing || applying || pending) return;
    setPreparing(true); setReviewError(null);
    try {
      const reviewed = props.onEditPreview ? await props.onEditPreview(result) : result;
      setEditorPreview(reviewed); setEditing(true);
    } catch (error) { setReviewError(error instanceof Error ? error.message : 'Could not read the latest tabs. Try again.'); }
    finally { setPreparing(false); }
  };
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
  // Keep identifiers consistent between current Chrome groups and the preview.
  const knownGroups = new Map((result?.existingGroups ?? []).map(group => [group.id, group]));
  for (const group of props.existingGroups ?? []) knownGroups.set(group.id, group);
  const currentTabs = props.currentTabs ?? [...tabs, ...skippedTabs];
  const windowIds = [...new Set([
    ...currentTabs.map(tab => tab.windowId),
    ...(result?.tabs.map(tab => tab.windowId) ?? []),
    ...[...knownGroups.values()].map(group => group.windowId),
  ])].sort((a, b) => a - b);
  const groupNumber = (group: ExistingGroup) => {
    const peers = [...knownGroups.values()].filter(peer => peer.name === group.name && peer.windowId === group.windowId).sort((a, b) => a.id - b.id);
    return peers.length > 1 ? ` · Group ${peers.findIndex(peer => peer.id === group.id) + 1}` : '';
  };
  const currentGroupLabel = (group: ExistingGroup) => `Current Chrome group${(windowIds.length > 1) ? ` · Window ${windowIds.indexOf(group.windowId) + 1}` : ''}${groupNumber(group)}`;
  const destinationLabel = (group: Suggestion['groups'][number], cardWindow?: number) => {
    const target = result?.existingGroups?.find(existing => existing.id === group.existingGroupId);
    const windows = [...new Set(resolve(group.tabIds).map(tab => tab.windowId))].sort((a, b) => a - b);
    if (!windows.length) return 'Empty group · skipped when applying';
    const numberInPreview = (id: number) => {
      const peers = (result?.suggestion.groups ?? []).filter(candidate => candidate.name === group.name && resolve(candidate.tabIds).some(tab => tab.windowId === id));
      peers.sort((a, b) => (a.existingGroupId ?? Infinity) - (b.existingGroupId ?? Infinity));
      return peers.length > 1 ? ` · Group ${peers.indexOf(group) + 1}` : '';
    };
    return windows.filter(id => cardWindow === undefined || id === cardWindow).map(id => {
      const reuse = target ? id === target.windowId : group.existingGroupId !== undefined;
      const action = reuse && target && result
        ? describeGroupChange(result, group, target, id, currentTabs, source => groupNumber(source).replace(' · ', '') || source.name)
        : reuse ? 'Existing Chrome group' : '';
      const number = numberInPreview(id);
      const location = windowIds.length > 1 ? ` · Window ${windowIds.indexOf(id) + 1}` : '';
      return `${action}${location}${!action.startsWith('Will combine ') ? number : ''}`.replace(/^ · /, '');
    }).join('; ');

  };
  const currentGroupsInOrder = [...(props.existingGroups ?? [])].sort((a, b) =>
    a.windowId - b.windowId || a.name.localeCompare(b.name) || a.id - b.id);
  const previewWindowCards = (result?.suggestion.groups ?? []).flatMap((group, index) => {
    const members = resolve(group.tabIds);
    const windows = [...new Set(members.map(tab => tab.windowId))];
    return (windows.length ? windows : [Infinity]).map(windowId => ({
      group, index, windowId, tabs: members.filter(tab => tab.windowId === windowId), key: `group-${index}-window-${windowId}`,
    }));
  }).sort((a, b) => a.windowId - b.windowId || a.group.name.localeCompare(b.group.name) ||
    (a.group.existingGroupId ?? Infinity) - (b.group.existingGroupId ?? Infinity) || a.index - b.index);
  // One named preview card can describe destinations in several windows.
  // Keep the underlying assignments intact: this is only a display grouping.
  const previewGroupsInOrder = previewWindowCards.filter((card, index, all) => {
    const peers = all.filter(other => other.group.name === card.group.name && other.tabs.length);
    return new Set(peers.map(peer => peer.windowId)).size <= 1 || index === all.findIndex(other => other.group.name === card.group.name);
  }).map(card => {
    const peers = previewWindowCards.filter(other => other.group.name === card.group.name && other.tabs.length);
    const windows = new Set(peers.map(peer => peer.windowId));
    if (windows.size <= 1) return { ...card, summary: '' };
    const members = peers.flatMap(peer => peer.tabs).sort((a, b) => a.windowId - b.windowId);
    return { ...card, group: { ...card.group, tabIds: members.map(tab => tab.id!) }, tabs: members,
      summary: `Will organize tabs into ${peers.length} separate groups across ${windows.size} windows. Tabs stay in their current windows.` };
  });
  const ungroupedMembers = result ? resolve(result.suggestion.ungroupedTabIds) : [];
  const ungroupedWindows = [...new Set(ungroupedMembers.map(tab => tab.windowId))].sort((a, b) => a - b);
  const ungroupedCards = (ungroupedWindows.length ? ungroupedWindows : [Infinity]).map(windowId => ({
    key: `ungrouped-${windowId}`, windowId, tabs: ungroupedMembers.filter(tab => tab.windowId === windowId),
  }));
  const groupIds = result ? [...previewGroupsInOrder.map(card => card.key), ...ungroupedCards.map(card => card.key)] : ['initial'];
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
            disabled={applying || preparing}
          />
        </label>
      </header>

      {editing && editorPreview ? (
        <GroupEditor
          existingGroups={editorPreview.existingGroups}
          windowIds={windowIds}
          destinationLabel={(group, _index, draft) => {
            const target = editorPreview.existingGroups?.find(existing => existing.id === group.existingGroupId);
            if (!target || draft.groups.filter(candidate => candidate.name === group.name).length === 1) return group.name;
            const peers = draft.groups.filter(candidate => candidate.name === group.name && (editorPreview.existingGroups?.find(existing => existing.id === candidate.existingGroupId)?.windowId === target.windowId || candidate.tabIds.some(id => editorPreview.tabs.find(tab => tab.id === id)?.windowId === target.windowId)));
            peers.sort((a, b) => (a.existingGroupId ?? Infinity) - (b.existingGroupId ?? Infinity));
            const number = peers.length > 1 ? ` · Group ${peers.indexOf(group) + 1}` : '';
            const sameNameWindows = new Set(draft.groups.filter(candidate => candidate.name === group.name).flatMap(candidate => {
              const existing = editorPreview.existingGroups?.find(existing => existing.id === candidate.existingGroupId);
              return [...(existing ? [existing.windowId] : []), ...candidate.tabIds.flatMap(id => {
                const tab = editorPreview.tabs.find(tab => tab.id === id);
                return tab ? [tab.windowId] : [];
              })];
            }));
            const location = sameNameWindows.size > 1 || (number && windowIds.length > 1) ? ` · Window ${windowIds.indexOf(target.windowId) + 1}` : '';
            return `${group.name}${location}${number}`;
          }}
          suggestion={editorPreview.suggestion}
          tabs={editorPreview.tabs}
          query={query}
          stale={isPreviewStale(editorPreview, tabs, props.existingGroups)}
          onUpdateTabs={props.onEditPreview ? async suggestion => {
            const reviewed = await props.onEditPreview!({ ...editorPreview, suggestion });
            setEditorPreview(reviewed); return reviewed.suggestion;
          } : undefined}
          onCancel={() => setEditing(false)}
          onSave={async suggestion => {
            if (props.onSavePreview) {
              await props.onSavePreview({ ...editorPreview, suggestion });
              setSaved(null);
            } else setSaved({ source: generatedResult, suggestion });
            setApplication(null); setCollapsed(new Set()); setEditing(false); setEditorPreview(null);
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
                  disabled={applying || preparing}
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

            {!loading && !!props.existingGroups?.length && (
              <details className="skipped-tabs current-chrome-groups">
                <summary><span className="chevron" aria-hidden="true" />Current Chrome groups ({props.existingGroups.length})</summary>
                <p>These are your groups in Chrome now. The preview below shows proposed changes.</p>
                {currentGroupsInOrder.map(group => {
                  const members = currentTabs.filter(tab => tab.groupId === group.id && tab.windowId === group.windowId).filter(matches);
                  if (query.trim() && !members.length && !group.name.toLowerCase().includes(query.trim().toLowerCase())) return null;
                  return <TabCard
                    key={group.id}
                    name={group.name}
                    subtitle={currentGroupLabel(group)}
                    tabs={members}
                    collapsed={collapsed.has(`current-${group.id}`)}
                    onToggle={() => toggle(`current-${group.id}`)}
                  />;
                })}
              </details>
            )}

            {suggestionError && (
              <Notice title="Couldn’t get suggestions" kind="error">
                {suggestionError}
              </Notice>
            )}
            {reviewError && <Notice title="Couldn’t review tabs" kind="error">{reviewError}</Notice>}
            {result && stale && (
              <Notice title="Preview needs updating" kind="warning">
                {STALE_PREVIEW_MESSAGE}
              </Notice>
            )}
            {outcome && (
              <Notice title={outcome.kind === 'success' ? 'Preview applied' : outcome.kind === 'partial' ? 'Grouping could not be confirmed' : 'Couldn’t group tabs'} kind={outcome.kind === 'success' ? 'info' : 'warning'}>
                {outcome.message}
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
                      edited ? 'No named groups' : 'AI returned no named groups'
                    }
                  >
                    {edited
                      ? 'Your tabs are in Ungrouped. Edit groups to create a group.'
                      : 'All tabs are in Ungrouped. Edit groups to create your own, or refresh suggestions. Group tabs will only remove these tabs from existing Chrome groups.'}
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
                    {previewGroupsInOrder.map(({ group, windowId, tabs: members, key, summary }) => {
                      const filtered = members.filter(matches);
                      return query.trim() && filtered.length === 0 ? null : (
                        <TabCard
                          key={key}
                          name={group.name}
                          existing={group.existingGroupId !== undefined}
                          subtitle={summary || destinationLabel(group, windowId)}
                          tabWindowLabel={summary ? tab => `Window ${windowIds.indexOf(tab.windowId) + 1}` : undefined}
                          tabs={filtered}
                          collapsed={collapsed.has(key)}
                          onToggle={() => toggle(key)}
                        />
                      );
                    })}
                    {ungroupedCards.map(card => <TabCard
                      key={card.key}
                      name="Ungrouped"
                      subtitle={windowIds.length > 1 && Number.isFinite(card.windowId) ? `Window ${windowIds.indexOf(card.windowId) + 1}` : undefined}
                      tabs={card.tabs.filter(matches)}
                      ungrouped
                      collapsed={collapsed.has(card.key)}
                      onToggle={() => toggle(card.key)}
                    />)}
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
                  disabled={applying || preparing}
                  onClick={() => void edit()}
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
                  disabled={loading || applying || preparing}
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
            {result && !pending && props.onApply && (
              <button className="suggest-button group-tabs-button" disabled={loading || applying || preparing || stale || !!outcome?.consumed || outcome?.kind === 'stale'} onClick={() => void apply()}>
                {applying ? 'Grouping tabs…' : outcome?.kind === 'success' ? 'Preview applied' : 'Group tabs'}
              </button>
            )}
            <p className="footer-note">
              Editing and saving only update the preview. Group tabs applies it to Chrome.
            </p>
            <details className="privacy-note">
              <summary>What gets shared?</summary>
              <p>
                Only when you request suggestions, tab titles and website names
                go to Groq AI, along with existing group names, group and window IDs,
                and which eligible tabs belong to each group. Titles may include searches or document names;
                full web addresses and page contents aren’t shared.
              </p>
            </details>
          </footer>
        </>
      )}
    </main>
  );
}

import { useState } from 'react';
import type { ExistingGroup, Suggestion } from '../../lib/grouping';
import type { OpenTab } from '../../lib/tabs';
import { tabLabel } from '../../lib/tabs';
import {
  addGroup,
  cloneDraft,
  moveTabsToNamedGroup,
  nameError,
  removeGroup,
  renameGroup,
  saveDraft,
} from '../../lib/editing';
import { TabRow } from './PopupView';
import { describeGroupWindows } from '../../lib/groupChange';

interface Props {
  suggestion: Suggestion;
  destinationLabel?: (group: Suggestion['groups'][number], index: number, draft: Suggestion) => string;
  tabs: OpenTab[];
  windowIds?: number[];
  existingGroups?: ExistingGroup[];
  query: string;
  stale: boolean;
  onCancel: () => void;
  onSave: (suggestion: Suggestion) => void | Promise<void>;
  onUpdateTabs?: (draft: Suggestion) => Promise<Suggestion>;
}

export function GroupEditor({
  suggestion,
  destinationLabel,
  tabs,
  windowIds,
  existingGroups,
  query,
  stale,
  onCancel,
  onSave,
  onUpdateTabs,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => cloneDraft(suggestion));
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDestination, setBulkDestination] = useState(-1);
  const [customName, setCustomName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createAttempted, setCreateAttempted] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const orderedWindows = windowIds ?? [...new Set(tabs.map(tab => tab.windowId))].sort((a, b) => a - b);
  const windowLabel = (tab: OpenTab) => orderedWindows.length > 1 ? `Window ${orderedWindows.indexOf(tab.windowId) + 1}` : undefined;
  const byId = new Map(tabs.map((tab) => [tab.id, tab]));
  const labels = draft.groups.map((group, index) => destinationLabel?.(group, index, draft) ?? group.name);
  const options = draft.groups.map((group, index) => ({ name: group.name.trim(), index }))
    .filter((option, index, all) => all.findIndex(other => other.name === option.name) === index);
  const menuIndex = (index: number) => index < 0 ? -1 : options.find(option => option.name === draft.groups[index]?.name.trim())?.index ?? -1;
  const spanningGroups = draft.groups.filter(group => describeGroupWindows(group, tabs));
  const invalid = draft.groups.some((group) => nameError(group.name));
  const move = (id: number, destination: number) => {
    setDraft((current) => moveTabsToNamedGroup(current, [id], destination, tabs, existingGroups));
    setAnnouncement(
      `Tab moved to ${destination === -1 ? 'Ungrouped' : draft.groups[destination]?.name || 'unnamed group'}.`,
    );
  };
  const sections = [
    ...draft.groups.map((group, index) => ({ ...group, index })),
    { name: 'Ungrouped', tabIds: draft.ungroupedTabIds, index: -1 },
  ];
  const searching = !!query.trim();
  const searchTabs = tabs.filter((tab) =>
    tabLabel(tab).toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selectionFor = (id: number) =>
    selecting
      ? {
          checked: selected.has(id),
          onToggle: () =>
            setSelected((current) => {
              const next = new Set(current);
              if (next.has(id)) next.delete(id);
              else next.add(id);
              return next;
            }),
        }
      : undefined;
  const hiddenSelected = searching
    ? [...selected].filter((id) => !searchTabs.some((tab) => tab.id === id))
        .length
    : 0;
  return (
    <fieldset className="editor-shell" disabled={saving || updating} aria-busy={saving || updating}>
      <section className="content" aria-label="Edit groups">
        <div className="section-heading">
          <h2>Organize your groups</h2>
          <button
            className="secondary-button select-toggle"
            aria-pressed={selecting}
            onClick={() => {
              setSelecting((current) => !current);
              setSelected(new Set());
            }}
          >
            {selecting ? 'Done selecting' : 'Select tabs'}
          </button>
        </div>
        <p className="snapshot-note">
          Use Move to, or select several tabs to move together. Tabs stay in their current windows.
        </p>
        {stale && (
          <div className="notice warning" role="status">
            <strong>Your tabs have changed</strong>
            <p>
              Your tabs changed while editing. Update tabs to review new and changed pages before saving. Your manual edits are kept.
            </p>
            {onUpdateTabs && <button className="secondary-button" onClick={async () => {
              setUpdating(true); setActionError(null);
              try { setDraft(await onUpdateTabs(draft)); setSelected(new Set()); }
              catch (error) { setActionError(error instanceof Error ? error.message : 'Could not update tabs. Try again.'); }
              finally { setUpdating(false); }
            }}>Update tabs</button>}
          </div>
        )}
        <p className="snapshot-note">New or changed pages appear in Ungrouped; closed tabs are removed. Saving updates the preview without asking AI.</p>
        {actionError && <div className="notice error" role="alert"><strong>Couldn’t save changes</strong><p>{actionError}</p></div>}
        {searching && spanningGroups.map((group, index) => (
          <p className="snapshot-note" key={index}>{group.name}: {describeGroupWindows(group, tabs)}</p>
        ))}
        {searching && (
          <>
            <div className="section-heading">
              <h2>
                {searchTabs.length}{' '}
                {searchTabs.length === 1 ? 'result' : 'results'}
              </h2>
            </div>
            {searchTabs.length ? (
              <div className="group-card search-results">
                <ul aria-label="Search results">
                  {searchTabs.map((tab) => {
                    const destination = draft.groups.findIndex((group) =>
                      group.tabIds.includes(tab.id!),
                    );
                    return (
                      <TabRow
                        key={tab.id}
                        tab={tab}
                        windowLabel={windowLabel(tab)}
                        selection={selectionFor(tab.id!)}
                        groupName={
                          destination < 0
                            ? 'Ungrouped'
                            : draft.groups[destination]?.name || 'Unnamed group'
                        }
                        editing={{
                          destination: menuIndex(destination),
                          groups: options.map(option => option.name),
                          optionIndexes: options.map(option => option.index),
                          onMove: (target) => move(tab.id!, target),
                        }}
                      />
                    );
                  })}
                </ul>
              </div>
            ) : (
              <div className="notice" role="status">
                <strong>No matching tabs</strong>
                <p>Try another title or website name.</p>
              </div>
            )}
            <p className="snapshot-note">
              Clear search to rename groups.
            </p>
          </>
        )}
        <div className="editor-create">
          {creating ? (
            <form
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setCreating(false);
                  setCreateAttempted(false);
                  setCustomName('');
                }
              }}
              onSubmit={(event) => {
                event.preventDefault();
                setCreateAttempted(true);
                if (nameError(customName)) return;
                setDraft((current) => addGroup(current, customName));
                setBulkDestination((current) =>
                  current < 0 ? current : current + 1,
                );
                setCollapsed(
                  (current) =>
                    new Set(
                      [...current].map((index) =>
                        index < 0 ? index : index + 1,
                      ),
                    ),
                );
                setRemoving((current) =>
                  current === null ? null : current + 1,
                );
                setCustomName('');
                setCreating(false);
                setCreateAttempted(false);
                setAnnouncement(
                  'Group created at the top. Move tabs into it with Move to or Select tabs.',
                );
              }}
            >
              <label htmlFor="custom-name">New group name</label>
              <div className="editor-create-row">
                <input
                  id="custom-name"
                  autoFocus
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                  aria-invalid={createAttempted && !!nameError(customName)}
                  aria-describedby={
                    createAttempted && nameError(customName)
                      ? 'custom-error'
                      : undefined
                  }
                />
                <button type="submit" className="secondary-button">
                  Add group
                </button>
              </div>
              {createAttempted && nameError(customName) && (
                <p id="custom-error" className="edit-error" role="alert">
                  {nameError(customName)}
                </p>
              )}
            </form>
          ) : (
            <button
              className="secondary-button"
              onClick={() => setCreating(true)}
            >
              + Create group
            </button>
          )}
        </div>
        <p className="sr-only" role="status">
          {announcement}
        </p>
        {sections.map((group) => {
          const error = group.index >= 0 ? nameError(group.name) : null;
          if (searching && !error && removing !== group.index) return null;
          const visible = group.tabIds.flatMap((id) => {
            const tab = byId.get(id);
            return tab &&
              tabLabel(tab).toLowerCase().includes(query.trim().toLowerCase())
              ? [tab]
              : [];
          });
          return (
            <article
              key={group.index}
              className={`group-card${group.index < 0 ? ' ungrouped-card' : ''}`}
            >
              <div className="editor-group-heading">
                <button
                  className="group-heading"
                  aria-expanded={!collapsed.has(group.index)}
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(group.index)) next.delete(group.index);
                      else next.add(group.index);
                      return next;
                    })
                  }
                >
                  <span className="group-dot" aria-hidden="true" />
                  <h3>{(group.index >= 0 ? labels[group.index] : group.name) || 'Unnamed group'}{'existingGroupId' in group && group.existingGroupId !== undefined && <span className="existing-group-label">Existing Chrome group</span>}</h3>
                  <span className="count">{group.tabIds.length}</span>
                  <span
                    className={`chevron ${collapsed.has(group.index) ? '' : 'expanded'}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {group.index >= 0 && describeGroupWindows(group, tabs) && (
                <p className="snapshot-note" role="status">{describeGroupWindows(group, tabs)}</p>
              )}
              {group.index >= 0 && (
                <div className="editor-name">
                  <label htmlFor={`name-${group.index}`}>Group name</label>
                  <div className="editor-name-row">
                    <input
                      id={`name-${group.index}`}
                      value={group.name}
                      aria-invalid={!!error}
                      aria-describedby={
                        error ? `error-${group.index}` : undefined
                      }
                      onChange={(event) =>
                        setDraft((current) =>
                          renameGroup(current, group.index, event.target.value),
                        )
                      }
                    />
                    <button
                      className="secondary-button remove-group-button"
                      aria-label={`Remove ${group.name || 'Unnamed group'}`}
                      onClick={() => setRemoving(group.index)}
                    >
                      Remove
                    </button>
                  </div>
                  {error && (
                    <p
                      id={`error-${group.index}`}
                      className="edit-error"
                      role="alert"
                    >
                      {error}
                    </p>
                  )}
                  {removing === group.index && (
                    <div
                      className="notice warning"
                      role="group"
                      aria-label="Confirm group removal"
                    >
                      <p>
                        Remove ‘{group.name || 'Unnamed group'}’?
                        {group.tabIds.length > 0 && (
                          <>
                            {' '}
                            All {group.tabIds.length}{' '}
                            {group.tabIds.length === 1 ? 'tab' : 'tabs'} in this
                            group will move to Ungrouped.
                          </>
                        )}
                      </p>
                      <div className="editor-actions">
                        <button
                          className="secondary-button"
                          onClick={() => setRemoving(null)}
                        >
                          Cancel
                        </button>
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setDraft((current) =>
                              removeGroup(current, group.index),
                            );
                            setRemoving(null);
                            setBulkDestination((current) =>
                              current === group.index
                                ? -1
                                : current > group.index
                                  ? current - 1
                                  : current,
                            );
                            setCollapsed(new Set());
                            setAnnouncement(
                              'Group removed. Its tabs are now Ungrouped.',
                            );
                          }}
                        >
                          Remove group
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!searching && !collapsed.has(group.index) && (
                <>
                  {visible.length ? (
                    <ul>
                      {visible.map((tab) => (
                        <TabRow
                          key={tab.id}
                          tab={tab}
                        windowLabel={windowLabel(tab)}
                          selection={selectionFor(tab.id!)}
                          editing={{
                            destination: menuIndex(group.index),
                            groups: options.map(option => option.name),
                            optionIndexes: options.map(option => option.index),
                            onMove: (destination) => move(tab.id!, destination),
                          }}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="card-empty">
                      {group.tabIds.length
                        ? 'No matching tabs in this group.'
                        : group.index === -1
                          ? 'No ungrouped tabs. Move tabs here.'
                          : 'Empty group — move tabs here or remove this group.'}
                    </p>
                  )}
                </>
              )}
            </article>
          );
        })}
      </section>
      <footer className="action-footer edit-footer">
        {selecting && (
          <div
            className="bulk-controls"
            role="group"
            aria-label="Move selected tabs"
          >
            <div className="bulk-summary">
              <span role="status">
                {selected.size
                  ? `${selected.size} selected${hiddenSelected ? ` (${hiddenSelected} hidden by search)` : ''}`
                  : 'Select tabs to move together'}
              </span>
              <button
                className="collapse-button"
                disabled={!selected.size}
                onClick={() => setSelected(new Set())}
              >
                Clear selection
              </button>
            </div>
            <div className="bulk-actions">
              <label>
                Move selected to
                <select
                  aria-label="Move selected tabs to group"
                  value={menuIndex(bulkDestination)}
                  onChange={(event) =>
                    setBulkDestination(Number(event.target.value))
                  }
                >
                  <option value={-1}>Ungrouped</option>
                  {options.map(option => (
                    <option key={option.index} value={option.index}>
                      {option.name || 'Unnamed group'}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button"
                disabled={!selected.size || removing !== null}
                onClick={() => {
                  setDraft((current) =>
                    moveTabsToNamedGroup(current, selected, bulkDestination, tabs, existingGroups),
                  );
                  setAnnouncement(
                    `${selected.size} tabs moved to ${bulkDestination < 0 ? 'Ungrouped' : draft.groups[bulkDestination]?.name || 'unnamed group'}.`,
                  );
                  setSelected(new Set());
                }}
              >
                Move selected
              </button>
            </div>
          </div>
        )}
        <div className="editor-actions">
          <button className="secondary-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="suggest-button"
            disabled={
              stale || saving || updating || invalid || removing !== null || (creating && !!customName.trim())
            }
            onClick={async () => {
              setSaving(true); setActionError(null);
              try { await onSave(saveDraft(draft)); }
              catch (error) { setActionError(error instanceof Error ? error.message : 'Could not save changes. Try again.'); }
              finally { setSaving(false); }
            }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
        <p className="footer-note">
          Local preview. Chrome groups stay unchanged.
        </p>
      </footer>
    </fieldset>
  );
}

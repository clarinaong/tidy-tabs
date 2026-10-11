import type { ApplyOutcome, Preview } from './applyGroups.ts';
import type { ExistingGroup } from './grouping.ts';
import { isEligibleTab } from './grouping.ts';
import { assertValidPreview, avoidSuggestedSingletons, isPreviewStale, reconcilePreview, STALE_PREVIEW_MESSAGE } from './preview.ts';
import type { OpenTab } from './tabs.ts';

export interface SessionPreview extends Preview { id: string }
export interface SessionState {
  preview: SessionPreview | null;
  revision?: number;
  editor?: Preview;
  resetToken?: string;
  skipped: OpenTab[];
  pending: boolean;
  applying: boolean;
  consumed: boolean;
  outcome: ApplyOutcome | null;
  error: string | null;
}
export type SessionCommand = { action: 'get' | 'suggest' | 'reset' } |
  { action: 'edit'; id: string; draft?: Preview } |
  { action: 'save'; id: string; suggestion: Preview['suggestion']; reviewed?: Preview } |
  { action: 'apply'; id: string };
interface Dependencies {
  load: () => Promise<SessionState | undefined>;
  write: (state: SessionState) => Promise<void>;
  readTabs: () => Promise<OpenTab[]>;
  readGroups: () => Promise<ExistingGroup[]>;
  suggest: (tabs: OpenTab[], groups: ExistingGroup[]) => Promise<Preview['suggestion']>;
  apply: (preview: Preview) => Promise<ApplyOutcome>;
  newId: () => string;
}
// Background-owned state survives popup destruction. Save before mutating Chrome;
// an interrupted worker never automatically retries a consumed snapshot.
export function createSessionController(api: Dependencies) {
  let state: SessionState = { preview: null, skipped: [], pending: false, applying: false, consumed: false, outcome: null, error: null };
  let active = false;
  let ready: Promise<void> | undefined;
  const initialize = () => ready ??= (async () => {
    const restored = await api.load();
    if (restored) {
      state = restored;
      if (state.applying) {
        state = { ...state, applying: false, consumed: true, outcome: { kind: 'partial', consumed: true, message: 'Grouping was interrupted and could not be confirmed. Review Chrome, then refresh suggestions or edit groups before applying again.' } };
      }
      if (state.pending) state = { ...state, pending: false, error: 'The suggestion request was interrupted. Refresh suggestions to try again.' };
      await api.write(state);
    }
  })();
  const persist = async (next: SessionState) => {
    const previous = state;
    state = { ...next, revision: (previous.revision ?? 0) + 1 }; // Publish ordered snapshots.
    try { await api.write(state); }
    catch (error) { state = previous; throw error; }
  };
  return async (command: SessionCommand): Promise<SessionState> => {
    await initialize();
    if (active && command.action === 'reset') throw new Error('Wait for the current action to finish before resetting.');
    if (active && (command.action === 'save' || command.action === 'edit')) throw new Error('Wait for the current action before saving.');
    if (command.action === 'get' || active) return structuredClone(state);
    if (command.action === 'reset') {
      active = true;
      try {
        await persist({ preview: null, skipped: [], pending: false, applying: false,
          consumed: false, outcome: null, error: null, resetToken: api.newId() });
      } finally { active = false; }
      return structuredClone(state);
    }
    if (command.action === 'edit') {
      if (state.preview?.id !== command.id) throw new Error('This preview changed. Reopen TidyTabs.');
      active = true;
      try {
        const [tabs, groups] = await Promise.all([api.readTabs(), api.readGroups()]);
        return { ...structuredClone(state), editor: reconcilePreview(command.draft ?? state.preview, tabs, groups) };
      } finally { active = false; }
    }
    if (command.action === 'save') {
      if (state.preview?.id !== command.id) throw new Error('This preview changed. Reopen TidyTabs.');
      active = true;
      try {
        if (command.reviewed) {
          const reviewed = { ...command.reviewed, suggestion: command.suggestion };
          const [tabs, groups] = await Promise.all([api.readTabs(), api.readGroups()]);
          if (isPreviewStale(reviewed, tabs, groups))
            throw new Error('Your tabs changed again. Update tabs in the editor, then review and save.');
          const suggestion = assertValidPreview(reviewed);
          await persist({ ...state, preview: { ...structuredClone(reviewed), suggestion, id: api.newId() },
            skipped: tabs.filter(tab => !isEligibleTab(tab)), consumed: false, outcome: null, error: null });
        } else {
          const suggestion = assertValidPreview({ ...state.preview, suggestion: command.suggestion });
          await persist({ ...state, preview: { ...state.preview, suggestion } });
        }
      }
      finally { active = false; }
      return structuredClone(state);
    }
    active = true;
    try {
      if (command.action === 'suggest') {
        await persist({ ...state, pending: true, error: null });
        const [tabs, groups] = await Promise.all([api.readTabs(), api.readGroups()]);
        const suggestion = avoidSuggestedSingletons({ tabs: tabs.filter(isEligibleTab), existingGroups: groups, suggestion: await api.suggest(tabs, groups) });
        await persist({ resetToken: state.resetToken, preview: { id: api.newId(), tabs: tabs.filter(isEligibleTab), suggestion, existingGroups: groups },
          skipped: tabs.filter(tab => !isEligibleTab(tab)), pending: false, applying: false, consumed: false, outcome: null, error: null });
      } else if (command.action === 'apply') {
        if (!state.preview || state.preview.id !== command.id || state.consumed) return structuredClone(state);
        const [tabs, groups] = await Promise.all([api.readTabs(), api.readGroups()]);
        if (isPreviewStale(state.preview, tabs, groups)) {
          await persist({ ...state, outcome: { kind: 'stale', consumed: false, message: STALE_PREVIEW_MESSAGE } });
          return structuredClone(state);
        }
        await persist({ ...state, applying: true, consumed: true, outcome: null, error: null });
        const outcome = await api.apply(state.preview);
        await persist({ ...state, applying: false, consumed: outcome.consumed, outcome });
      }
    } catch (error) {
      await persist({ ...state, pending: false, applying: false,
        ...(state.applying ? { consumed: true, outcome: { kind: 'partial', consumed: true, message: 'Grouping could not be confirmed. Review Chrome, then refresh suggestions or edit groups before applying again.' } as ApplyOutcome } : {}),
        error: state.applying ? null : (error instanceof Error ? error.message : 'Could not complete the action. Try again.') });
    } finally { active = false; }
    return structuredClone(state);
  };
}

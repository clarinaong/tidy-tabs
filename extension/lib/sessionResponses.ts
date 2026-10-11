import type { SessionState } from './session.ts';

// Request start order is not state order: a get issued during a mutation may
// finish after the completed mutation response. Compare published revisions.
export function acceptSessionResponse(current: SessionState | null, incoming: SessionState | undefined): SessionState {
  if (!incoming || typeof incoming !== 'object' || !('preview' in incoming))
    throw new Error('Could not read the saved preview. Your current view was kept; try again.');
  if (!current) return incoming;
  if ((incoming.revision ?? 0) < (current.revision ?? 0)) return current;
  // A preview can only disappear through an explicit reset, with a new token.
  if (current.preview && !incoming.preview && incoming.resetToken === current.resetToken)
    return current;
  return incoming;
}

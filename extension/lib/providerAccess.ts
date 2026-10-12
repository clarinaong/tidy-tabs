import { validateAccess, type ProviderAccess } from './providers.ts';

export const ACCESS_SLOT = 'tidytabsProviderAccess';

interface AccessStorage {
  setAccessLevel: (options: {
    accessLevel: 'TRUSTED_CONTEXTS';
  }) => Promise<void>;
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (values: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

export function createAccessStore(storage: AccessStorage) {
  let queue: Promise<unknown> = Promise.resolve();
  let generation = 0;
  let active: AbortController | undefined;

  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue
      .then(async () => {
        await storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
        return operation();
      })
      .catch(() => {
        throw new Error(
          'Could not access API key storage. Reload the extension and try again.',
        );
      });
    queue = next.catch(() => {});

    return next;
  };

  return {
    status: () =>
      serialize(async () => ({
        hasAccess: !!(await storage.get(ACCESS_SLOT))[ACCESS_SLOT],
      })),

    set: async (value: unknown) => {
      const credentials = validateAccess(value);
      if (active)
        throw new Error(
          'Wait for the request to finish, or clear API access first.',
        );
      return serialize(async () => {
        await storage.set({
          [ACCESS_SLOT]: credentials,
          tidytabsAIConfigured: true,
        });
        return { hasAccess: true };
      });
    },

    clear: () => {
      generation++;
      active?.abort();
      return serialize(async () => {
        await storage.remove(ACCESS_SLOT);
        return { hasAccess: false };
      });
    },

    run: async <T>(
      operation: (
        credentials: ProviderAccess,
        signal: AbortSignal,
      ) => Promise<T>,
    ): Promise<T> => {
      if (active) throw new Error('A suggestion request is already running.');
      const controller = new AbortController();
      active = controller;
      const started = generation;
      try {
        const credentials = await serialize(
          async () => (await storage.get(ACCESS_SLOT))[ACCESS_SLOT],
        );
        if (started !== generation)
          throw new Error('Request cancelled because API access was cleared.');
        const result = await operation(
          validateAccess(credentials),
          controller.signal,
        );
        if (started !== generation)
          throw new Error(
            'Request cancelled because API access was cleared. Metadata already sent cannot be recalled.',
          );
        return result;
      } finally {
        active = undefined;
      }
    },
  };
}

export function isTrustedPage(
  sender: { id?: string; url?: string; tab?: unknown },
  runtimeId: string,
  origin: string,
) {
  return (
    sender.id === runtimeId &&
    !sender.tab &&
    (sender.url === `${origin}popup.html` ||
      sender.url === `${origin}sidepanel.html`)
  );
}

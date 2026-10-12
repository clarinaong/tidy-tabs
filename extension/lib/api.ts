import { prepareTabs, validateSuggestion, isEligibleTab } from './grouping.ts';
import type { ExistingGroup } from './grouping.ts';
import { PROVIDERS, validateAccess, type ProviderAccess } from './providers.ts';
import { SYSTEM_PROMPT, schema } from './providerPrompt.ts';
import type { OpenTab } from './tabs.ts';

export const REQUEST_TIMEOUT_MS = 25_000;

export async function requestSuggestions(
  tabs: OpenTab[],
  configuration: ProviderAccess | undefined,
  fetcher: typeof fetch = fetch,
  timeoutMs = REQUEST_TIMEOUT_MS,
  existingGroups: ExistingGroup[] = [],
  signal?: AbortSignal,
) {
  const access = validateAccess(configuration);
  const provider = PROVIDERS[access.provider];
  const endpoint =
    access.provider === 'gemini'
      ? `${provider.endpoint}${encodeURIComponent(access.model)}:generateContent`
      : provider.endpoint;
  const prepared = prepareTabs(tabs);
  if (!prepared.tabs.length)
    throw new Error('No tabs to organize. Open a website and try again.');
  const body = existingGroups.length
    ? JSON.stringify({
        tabs: prepared.tabs,
        existingGroups: existingGroups.map((group) => ({
          ...group,
          tabIds: tabs
            .filter((tab) => isEligibleTab(tab) && tab.groupId === group.id)
            .map((tab) => tab.id!),
        })),
      })
    : prepared.body;
  if (new TextEncoder().encode(body).byteLength > 65_536)
    throw new Error(
      'Tab and group data exceeds the request limit. Reduce open tabs or groups and try again.',
    );
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  const cancelled = () =>
    signal?.aborted
      ? 'Request cancelled because API access was cleared. Metadata already sent cannot be recalled.'
      : 'The request timed out. Please try again.';
  const timer = setTimeout(cancel, timeoutMs);
  try {
    if (controller.signal.aborted) throw new Error(cancelled());
    let response: Response;
    try {
      response = await fetcher(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(access.provider === 'gemini'
            ? { 'x-goog-api-key': access.key }
            : { Authorization: `Bearer ${access.key}` }),
        },
        body: JSON.stringify(
          access.provider === 'gemini'
            ? {
                systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                contents: [{ role: 'user', parts: [{ text: body }] }],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseJsonSchema: schema,
                  maxOutputTokens: 4096,
                },
              }
            : {
                model: access.model,
                max_completion_tokens: 4096,
                ...(access.provider === 'groq' &&
                access.model.startsWith('openai/gpt-oss-')
                  ? { reasoning_effort: 'low', include_reasoning: false }
                  : {}),
                messages: [
                  { role: 'system', content: SYSTEM_PROMPT },
                  { role: 'user', content: body },
                ],
                response_format: {
                  type: 'json_schema',
                  json_schema: { name: 'tab_groups', strict: true, schema },
                },
                ...(access.provider === 'openai' ? { store: false } : {}),
              },
        ),
        signal: controller.signal,
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
    } catch {
      throw new Error(
        controller.signal.aborted
          ? cancelled()
          : 'Couldn’t connect to the selected AI provider. Check your connection and the extension’s provider site permission.',
      );
    }
    if (controller.signal.aborted) throw new Error(cancelled());
    if (!response.ok) {
      const messages: Record<number, string> = {
        401: 'The API key is invalid. Clear it and enter a new key.',
        403: 'The API key does not have access to this model.',
        429: 'Your provider quota or rate limit was reached. Check your provider account or try later.',
        400: 'The provider rejected the request. Check the model ID and structured-output support.',
        404: 'This model is unavailable. Check the model ID.',
        413: 'The request is too large. Close some tabs and try again.',
        503: 'The provider is temporarily unavailable. Try later.',
      };
      throw new Error(
        messages[response.status] ??
          'Couldn’t generate suggestions. Please try again.',
      );
    }
    let value: unknown;
    let responseProblem: string | undefined;
    try {
      const text = await response.text();
      if (text.length > 65_536) throw new Error();
      const envelope = JSON.parse(text);
      let content: string;
      if (access.provider === 'gemini') {
        const candidate = envelope.candidates?.[0];
        if (
          candidate?.finishReason !== 'STOP' ||
          !candidate.content?.parts?.length
        )
          throw new Error();
        content = candidate.content.parts
          .filter((part: { thought?: boolean }) => !part.thought)
          .map((part: { text?: string }) => part.text ?? '')
          .join('');
      } else {
        const choice = envelope.choices?.[0];
        if (choice?.finish_reason !== 'stop' || choice.message?.refusal) {
          responseProblem =
            choice?.finish_reason === 'length'
              ? 'The model ran out of output space before completing the groups. Try GPT OSS 20B or organize fewer tabs.'
              : choice?.message?.refusal
                ? 'The model declined this request. Try different tabs or another model.'
                : 'The model did not return a completed suggestion. Try again or choose another model.';
          throw new Error();
        }
        content = choice.message.content;
      }
      if (typeof content !== 'string' || content.includes(access.key))
        throw new Error();
      value = JSON.parse(content);
    } catch {
      throw new Error(
        controller.signal.aborted
          ? cancelled()
          : (responseProblem ??
              'The provider returned unreadable suggestion data. Try again or choose another model.'),
      );
    }
    if (controller.signal.aborted) throw new Error(cancelled());
    let suggestion;
    try {
      suggestion = validateSuggestion(value, prepared.tabs, existingGroups);
    } catch {
      throw new Error(
        'The model returned invalid tab groups (such as duplicate tabs, unknown groups, or a one-tab new group). Try again or select another model.',
      );
    }
    if (suggestion.groups.some((group) => group.name.includes(access.key)))
      throw new Error('Couldn’t read the suggestions. Please try again.');
    return {
      ...prepared,
      suggestion,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

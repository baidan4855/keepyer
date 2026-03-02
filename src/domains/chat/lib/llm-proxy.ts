import { httpRequest, type HttpResponse } from '@/domains/settings/lib/secure-storage';
import type { ApiModel } from '@/types';

export type LlmProtocol = 'anthropic' | 'openai';

export interface LlmProxyRetryPolicy {
  maxRetries?: number;
  retryDelayMs?: number;
}

export interface LlmProxyChatRequest {
  baseUrl: string;
  apiKey: string;
  targetProtocol: LlmProtocol;
  payload: Record<string, unknown>;
  inputProtocol?: LlmProtocol;
  enableProtocolTransform?: boolean;
  timeoutMs?: number;
  retryPolicy?: LlmProxyRetryPolicy;
}

export interface LlmProxyDiscoverModelsRequest {
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocol;
  timeoutMs?: number;
}

export interface LlmProxyProbeModelRequest {
  baseUrl: string;
  apiKey: string;
  protocol: LlmProtocol;
  modelId: string;
  timeoutMs?: number;
}

export interface LlmProxyChatResponse {
  ok: boolean;
  protocol: LlmProtocol;
  inputProtocol: LlmProtocol;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  rawBody: string;
  payload: unknown;
  text?: string;
  responseId?: string;
  responseModel?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  error?: string;
  retryCount: number;
}

export type LlmProxyModelDiscoveryResult =
  | { kind: 'success'; models: ApiModel[] }
  | { kind: 'auth_error'; details?: string }
  | { kind: 'failed'; details?: string };

export interface LlmProxyModelProbeResult {
  ok: boolean;
  status: number;
  statusText: string;
  responseModel?: string;
  payload: unknown;
  error?: string;
}

interface AdapterParseResult {
  text?: string;
  responseId?: string;
  responseModel?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  error?: string;
}

interface LlmProtocolAdapter {
  protocol: LlmProtocol;
  chatPath: string;
  buildHeaders: (apiKey: string) => Record<string, string>;
  parseResponse: (payload: unknown, response: HttpResponse, fallbackModel?: string) => AdapterParseResult;
}

interface ModelListProbe {
  path: string;
  headers: Record<string, string>;
  label: string;
  timeout?: number;
}

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504, 529]);

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function smartJoinUrl(baseUrl: string, path: string): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const versionEndPattern = /\/v\d+$/;

  if (versionEndPattern.test(cleanBaseUrl)) {
    const cleanPath = path.replace(/^\/v\d+/, '');
    return `${cleanBaseUrl}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
  }

  const versionMatch = cleanBaseUrl.match(/\/(v\d+)$/);
  if (versionMatch) {
    const versionIndex = cleanBaseUrl.lastIndexOf(versionMatch[0]);
    const basePart = cleanBaseUrl.substring(0, versionIndex + versionMatch[0].length);
    const cleanPath = path.replace(/^\/v\d+/, '');
    return `${basePart}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
  }

  return `${cleanBaseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

function toUnixSeconds(value: unknown): number | undefined {
  const direct = asNumber(value);
  if (typeof direct === 'number') {
    return direct > 1e12 ? Math.floor(direct / 1000) : Math.floor(direct);
  }

  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (!Number.isNaN(timestamp)) {
      return Math.floor(timestamp / 1000);
    }
  }
  return undefined;
}

function normalizeModelItem(raw: any): ApiModel | null {
  if (!raw || typeof raw !== 'object') return null;

  const idCandidates = [raw.id, raw.model, raw.model_id, raw.name];
  const resolvedId = idCandidates.find((candidate) => typeof candidate === 'string' && candidate.trim().length > 0);
  if (!resolvedId || typeof resolvedId !== 'string') return null;

  const resolvedName =
    (typeof raw.display_name === 'string' && raw.display_name) ||
    (typeof raw.name === 'string' && raw.name) ||
    resolvedId;

  const taskTypeRaw = raw.task_type ?? raw.type ?? raw.capabilities?.task_type;
  const taskType = Array.isArray(taskTypeRaw)
    ? taskTypeRaw.filter((item: unknown): item is string => typeof item === 'string')
    : taskTypeRaw;

  const tokenLimits = raw.token_limits && typeof raw.token_limits === 'object'
    ? raw.token_limits
    : raw.capabilities?.token_limits && typeof raw.capabilities.token_limits === 'object'
      ? raw.capabilities.token_limits
      : raw.limits && typeof raw.limits === 'object'
        ? raw.limits
        : undefined;

  return {
    id: resolvedId,
    name: resolvedName,
    owned_by: raw.owned_by ?? raw.provider ?? raw.organization,
    task_type: taskType,
    input_modalities: asStringArray(
      raw.input_modalities
      ?? raw.modalities?.input_modalities
      ?? raw.capabilities?.input_modalities
      ?? raw.input_types
    ),
    output_modalities: asStringArray(
      raw.output_modalities
      ?? raw.modalities?.output_modalities
      ?? raw.capabilities?.output_modalities
      ?? raw.output_types
    ),
    token_limits: tokenLimits,
    domain: raw.domain ?? raw.family ?? raw.capabilities?.domain,
    version: raw.version ?? raw.revision,
    created: toUnixSeconds(raw.created ?? raw.created_at ?? raw.updated_at),
  };
}

function extractModelCandidates(payload: any): any[] {
  if (!payload) return [];

  const candidates: any[] = [];
  const containers = [
    payload,
    payload?.data,
    payload?.models,
    payload?.items,
    payload?.results,
    payload?.model_list,
    payload?.result,
    payload?.result?.data,
    payload?.result?.models,
    payload?.payload,
    payload?.payload?.data,
    payload?.payload?.models,
    payload?.output,
    payload?.output?.data,
    payload?.output?.models,
  ];

  for (const container of containers) {
    if (Array.isArray(container)) {
      candidates.push(...container);
      continue;
    }
    if (!container || typeof container !== 'object') continue;

    const objectKeys = ['data', 'models', 'items', 'results', 'model_list'];
    for (const key of objectKeys) {
      const value = (container as any)[key];
      if (Array.isArray(value)) {
        candidates.push(...value);
      }
    }
  }

  return candidates;
}

function normalizeModelsFromPayload(payload: unknown): ApiModel[] {
  const parsedPayload = payload as any;
  const candidates = extractModelCandidates(parsedPayload);
  const modelMap = new Map<string, ApiModel>();

  for (const candidate of candidates) {
    const model = normalizeModelItem(candidate);
    if (!model) continue;
    if (!modelMap.has(model.id)) {
      modelMap.set(model.id, model);
    }
  }

  return Array.from(modelMap.values());
}

function dedupeModelListProbes(probes: ModelListProbe[]): ModelListProbe[] {
  const seen = new Set<string>();
  const unique: ModelListProbe[] = [];

  for (const probe of probes) {
    const headerKey = Object.entries(probe.headers)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}:${v}`)
      .join('|');
    const key = `${probe.path}::${headerKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(probe);
  }

  return unique;
}

function buildModelListProbes(protocol: LlmProtocol, apiKey: string, timeoutMs?: number): ModelListProbe[] {
  const bearerHeaders = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  const keyHeaders = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json',
  };
  const anthropicHeaders = {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  const anthropicHybridHeaders = {
    ...anthropicHeaders,
    'Authorization': `Bearer ${apiKey}`,
  };

  const withTimeout = (probe: Omit<ModelListProbe, 'timeout'>): ModelListProbe => ({
    ...probe,
    timeout: timeoutMs ?? 12000,
  });

  if (protocol === 'anthropic') {
    return dedupeModelListProbes([
      withTimeout({ label: 'anthropic-v1-models', path: '/v1/models', headers: anthropicHeaders }),
      withTimeout({ label: 'anthropic-v1-models-hybrid', path: '/v1/models', headers: anthropicHybridHeaders }),
      withTimeout({ label: 'anthropic-models', path: '/models', headers: anthropicHeaders }),
      withTimeout({ label: 'anthropic-models-hybrid', path: '/models', headers: anthropicHybridHeaders }),
      withTimeout({ label: 'openai-v1-models', path: '/v1/models', headers: bearerHeaders }),
      withTimeout({ label: 'openai-models', path: '/models', headers: bearerHeaders }),
      withTimeout({ label: 'x-api-key-v1-models', path: '/v1/models', headers: keyHeaders }),
      withTimeout({ label: 'x-api-key-models', path: '/models', headers: keyHeaders }),
    ]);
  }

  return dedupeModelListProbes([
    withTimeout({ label: 'openai-v1-models', path: '/v1/models', headers: bearerHeaders }),
    withTimeout({ label: 'openai-models', path: '/models', headers: bearerHeaders }),
    withTimeout({ label: 'x-api-key-v1-models', path: '/v1/models', headers: keyHeaders }),
    withTimeout({ label: 'x-api-key-models', path: '/models', headers: keyHeaders }),
  ]);
}

async function discoverModelsFromProbes(baseUrl: string, probes: ModelListProbe[]): Promise<LlmProxyModelDiscoveryResult> {
  let hadSuccessWithoutModels = false;
  let authErrorDetails: string | undefined;
  let lastFailureDetails: string | undefined;

  for (const probe of probes) {
    try {
      const response = await httpRequest({
        url: smartJoinUrl(baseUrl, probe.path),
        method: 'GET',
        headers: probe.headers,
        timeout: probe.timeout ?? 12000,
      });
      const parsed = parseJsonSafe(response.body) as any;

      if (response.status === 200) {
        const models = normalizeModelsFromPayload(parsed);
        if (models.length > 0) {
          return { kind: 'success', models };
        }

        hadSuccessWithoutModels = true;
        continue;
      }

      const details = extractErrorMessage(parsed) || `HTTP ${response.status}: ${response.statusText}`;
      if (response.status === 401 || response.status === 403) {
        authErrorDetails = authErrorDetails || details;
      } else {
        lastFailureDetails = `[${probe.label}] ${details}`;
      }
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      lastFailureDetails = `[${probe.label}] ${details}`;
    }
  }

  if (hadSuccessWithoutModels) {
    return { kind: 'success', models: [] };
  }

  if (authErrorDetails) {
    return { kind: 'auth_error', details: authErrorDetails };
  }

  return { kind: 'failed', details: lastFailureDetails };
}

export async function proxyDiscoverModels(
  request: LlmProxyDiscoverModelsRequest
): Promise<LlmProxyModelDiscoveryResult> {
  const probes = buildModelListProbes(request.protocol, request.apiKey, request.timeoutMs);
  return discoverModelsFromProbes(request.baseUrl, probes);
}

export async function proxyProbeModel(
  request: LlmProxyProbeModelRequest
): Promise<LlmProxyModelProbeResult> {
  const payload: Record<string, unknown> = {
    model: request.modelId,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'Hi' }],
  };

  const response = await proxyLlmChat({
    baseUrl: request.baseUrl,
    apiKey: request.apiKey,
    targetProtocol: request.protocol,
    payload,
    timeoutMs: request.timeoutMs ?? 20000,
  });

  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    responseModel: response.responseModel || request.modelId,
    payload: response.payload,
    error: response.error,
  };
}

function extractErrorMessage(payload: any): string {
  if (!payload || typeof payload !== 'object') return '';

  const candidates = [
    payload?.error?.message,
    payload?.error?.details,
    payload?.message,
    payload?.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return '';
}

function isRetryableUpstreamError(status: number, payload: unknown): boolean {
  if (RETRYABLE_STATUS_CODES.has(status)) return true;

  const message = extractErrorMessage(payload).toLowerCase();
  if (!message) return false;

  return (
    message.includes('upstream service temporarily unavailable') ||
    message.includes('temporarily unavailable') ||
    message.includes('service unavailable') ||
    message.includes('overloaded')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOpenAITextContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const textParts = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const typed = item as Record<string, unknown>;
        if (typed.type === 'text' && typeof typed.text === 'string') return typed.text;
        if (typeof typed.text === 'string') return typed.text;
        return '';
      })
      .filter((part) => part.length > 0);

    return textParts.join('\n');
  }

  if (content && typeof content === 'object') {
    const typed = content as Record<string, unknown>;
    if (typeof typed.text === 'string') return typed.text;
  }

  return '';
}

function normalizeOpenAIReasoningBudget(reasoningEffort?: string): number | undefined {
  switch (reasoningEffort) {
    case 'low':
      return 128;
    case 'high':
      return 512;
    case 'medium':
      return 256;
    default:
      return undefined;
  }
}

function normalizeAnthropicReasoningEffort(thinking: unknown): string | undefined {
  if (!thinking || typeof thinking !== 'object') return undefined;

  const typedThinking = thinking as Record<string, unknown>;
  const type = asString(typedThinking.type);
  if (type !== 'enabled') return undefined;

  const budget = asNumber(typedThinking.budget_tokens);
  if (typeof budget !== 'number') return 'medium';
  if (budget <= 160) return 'low';
  if (budget >= 384) return 'high';
  return 'medium';
}

function convertOpenAIChatToAnthropic(payload: Record<string, unknown>): Record<string, unknown> {
  const model = asString(payload.model);
  if (!model) {
    throw new Error('OpenAI payload missing model for anthropic conversion');
  }

  const openaiMessages = Array.isArray(payload.messages)
    ? payload.messages.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];

  const systemParts: string[] = [];
  const anthropicMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

  for (const message of openaiMessages) {
    const role = asString(message.role) || 'user';
    const text = extractOpenAITextContent(message.content).trim();
    if (!text) continue;

    if (role === 'system' || role === 'developer') {
      systemParts.push(text);
      continue;
    }

    if (role === 'assistant' || role === 'user') {
      anthropicMessages.push({ role, content: text });
      continue;
    }

    anthropicMessages.push({ role: 'user', content: `[${role}] ${text}` });
  }

  const existingSystem = asString(payload.system);
  const mergedSystem = [existingSystem, ...systemParts].filter((part): part is string => !!part).join('\n\n');

  const maxTokens = asNumber(payload.max_tokens)
    ?? asNumber(payload.max_completion_tokens)
    ?? 500;

  const converted: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages.length > 0
      ? anthropicMessages
      : [{ role: 'user', content: 'Hi' }],
  };

  if (mergedSystem) {
    converted.system = mergedSystem;
  }

  const temperature = asNumber(payload.temperature);
  if (typeof temperature === 'number') {
    converted.temperature = temperature;
  }

  const rawThinking = payload.thinking;
  const reasoningEffort = asString(payload.reasoning_effort);

  if (rawThinking && typeof rawThinking === 'object') {
    const typedThinking = rawThinking as Record<string, unknown>;
    const budgetFromInput = asNumber(typedThinking.budget_tokens);
    converted.thinking = {
      type: 'enabled',
      budget_tokens: budgetFromInput ?? normalizeOpenAIReasoningBudget(reasoningEffort) ?? 256,
    };
  } else if (reasoningEffort) {
    converted.thinking = {
      type: 'enabled',
      budget_tokens: normalizeOpenAIReasoningBudget(reasoningEffort) ?? 256,
    };
  }

  return converted;
}

function extractAnthropicTextContent(content: unknown): string {
  if (typeof content === 'string') return content;

  if (Array.isArray(content)) {
    const textParts = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const typed = item as Record<string, unknown>;
        if (typed.type === 'text' && typeof typed.text === 'string') return typed.text;
        if (typeof typed.text === 'string') return typed.text;
        return '';
      })
      .filter((part) => part.length > 0);

    return textParts.join('\n');
  }

  if (content && typeof content === 'object') {
    const typed = content as Record<string, unknown>;
    if (typeof typed.text === 'string') return typed.text;
  }

  return '';
}

function convertAnthropicChatToOpenAI(payload: Record<string, unknown>): Record<string, unknown> {
  const model = asString(payload.model);
  if (!model) {
    throw new Error('Anthropic payload missing model for openai conversion');
  }

  const anthropicMessages = Array.isArray(payload.messages)
    ? payload.messages.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];

  const openaiMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  const system = asString(payload.system);
  if (system) {
    openaiMessages.push({ role: 'system', content: system });
  }

  for (const message of anthropicMessages) {
    const role = asString(message.role) || 'user';
    const text = extractAnthropicTextContent(message.content).trim();
    if (!text) continue;

    if (role === 'assistant' || role === 'user') {
      openaiMessages.push({ role, content: text });
      continue;
    }

    openaiMessages.push({ role: 'user', content: `[${role}] ${text}` });
  }

  const maxTokens = asNumber(payload.max_tokens)
    ?? asNumber(payload.max_output_tokens)
    ?? 500;

  const converted: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages: openaiMessages.length > 0
      ? openaiMessages
      : [{ role: 'user', content: 'Hi' }],
  };

  const temperature = asNumber(payload.temperature);
  if (typeof temperature === 'number') {
    converted.temperature = temperature;
  }

  const reasoningEffort = normalizeAnthropicReasoningEffort(payload.thinking);
  if (reasoningEffort) {
    converted.reasoning_effort = reasoningEffort;
  }

  return converted;
}

function convertPayloadBetweenProtocols(
  payload: Record<string, unknown>,
  source: LlmProtocol,
  target: LlmProtocol,
): Record<string, unknown> {
  if (source === target) return payload;

  if (source === 'openai' && target === 'anthropic') {
    return convertOpenAIChatToAnthropic(payload);
  }

  if (source === 'anthropic' && target === 'openai') {
    return convertAnthropicChatToOpenAI(payload);
  }

  throw new Error(`Unsupported protocol transform: ${source} -> ${target}`);
}

const anthropicAdapter: LlmProtocolAdapter = {
  protocol: 'anthropic',
  chatPath: '/v1/messages',
  buildHeaders: (apiKey) => ({
    'x-api-key': apiKey,
    'Authorization': `Bearer ${apiKey}`,
    'anthropic-version': '2023-06-01',
    'Content-Type': 'application/json',
  }),
  parseResponse: (payload, response, fallbackModel) => {
    const parsed = payload as any;
    const contentBlocks = Array.isArray(parsed?.content) ? parsed.content : [];
    const textBlocks = contentBlocks
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block?.text)
      .filter((value: unknown): value is string => typeof value === 'string' && value.length > 0);

    return {
      text: textBlocks.join('\n\n') || asString(parsed?.content?.[0]?.text),
      responseId: asString(parsed?.id),
      responseModel: asString(parsed?.model) || fallbackModel,
      stopReason: asString(parsed?.stop_reason) || asString(parsed?.stop_reason_type),
      usage: parsed?.usage && typeof parsed.usage === 'object'
        ? parsed.usage as Record<string, unknown>
        : undefined,
      error: response.status >= 400
        ? extractErrorMessage(parsed) || `HTTP ${response.status}: ${response.statusText}`
        : undefined,
    };
  },
};

const openaiAdapter: LlmProtocolAdapter = {
  protocol: 'openai',
  chatPath: '/v1/chat/completions',
  buildHeaders: (apiKey) => ({
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }),
  parseResponse: (payload, response, fallbackModel) => {
    const parsed = payload as any;

    return {
      text: extractOpenAITextContent(parsed?.choices?.[0]?.message?.content),
      responseId: asString(parsed?.id),
      responseModel: asString(parsed?.model) || fallbackModel,
      stopReason: asString(parsed?.choices?.[0]?.finish_reason),
      usage: parsed?.usage && typeof parsed.usage === 'object'
        ? parsed.usage as Record<string, unknown>
        : undefined,
      error: response.status >= 400
        ? extractErrorMessage(parsed) || `HTTP ${response.status}: ${response.statusText}`
        : undefined,
    };
  },
};

const ADAPTERS: Record<LlmProtocol, LlmProtocolAdapter> = {
  anthropic: anthropicAdapter,
  openai: openaiAdapter,
};

export async function proxyLlmChat(request: LlmProxyChatRequest): Promise<LlmProxyChatResponse> {
  const inputProtocol = request.inputProtocol || request.targetProtocol;
  const adapter = ADAPTERS[request.targetProtocol];

  if (!adapter) {
    throw new Error(`Unsupported target protocol: ${request.targetProtocol}`);
  }

  const shouldTransform = inputProtocol !== request.targetProtocol;
  if (shouldTransform && !request.enableProtocolTransform) {
    throw new Error(`Protocol mismatch (${inputProtocol} -> ${request.targetProtocol}) without transform enabled`);
  }

  const payload = shouldTransform
    ? convertPayloadBetweenProtocols(request.payload, inputProtocol, request.targetProtocol)
    : request.payload;

  const maxRetries = request.retryPolicy?.maxRetries ?? 0;
  const retryDelayMs = request.retryPolicy?.retryDelayMs ?? 600;

  const url = smartJoinUrl(request.baseUrl, adapter.chatPath);

  let attempt = 0;
  let response: HttpResponse | null = null;
  let parsedPayload: unknown = null;

  while (attempt <= maxRetries) {
    response = await httpRequest({
      url,
      method: 'POST',
      headers: adapter.buildHeaders(request.apiKey),
      body: JSON.stringify(payload),
      timeout: request.timeoutMs ?? 30000,
    });

    parsedPayload = parseJsonSafe(response.body);

    if (!isRetryableUpstreamError(response.status, parsedPayload) || attempt >= maxRetries) {
      break;
    }

    attempt += 1;
    await sleep(retryDelayMs * attempt);
  }

  if (!response) {
    throw new Error('LLM proxy request failed without response');
  }

  const parsed = adapter.parseResponse(
    parsedPayload,
    response,
    asString((payload as Record<string, unknown>).model),
  );

  const ok = response.status >= 200 && response.status < 300;

  return {
    ok,
    protocol: request.targetProtocol,
    inputProtocol,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    rawBody: response.body,
    payload: parsedPayload,
    text: parsed.text,
    responseId: parsed.responseId,
    responseModel: parsed.responseModel,
    stopReason: parsed.stopReason,
    usage: parsed.usage,
    error: ok ? undefined : parsed.error || `HTTP ${response.status}: ${response.statusText}`,
    retryCount: attempt,
  };
}

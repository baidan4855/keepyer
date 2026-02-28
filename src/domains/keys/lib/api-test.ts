/**
 * API Key 测试工具
 */

import { httpRequest } from '@/domains/settings/lib/secure-storage';
import type { ApiModel, Provider } from '@/types';
import i18n from '@/i18n';

const t = (key: string, options?: Record<string, any>) => i18n.t(key, options) as string;

export type ApiTestStatus = 'idle' | 'loading' | 'success' | 'error';
export type ApiTestType = 'openai' | 'claude' | 'generic';

/**
 * 模型测试结果
 */
export interface ModelTestResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  message?: string;
  response?: string;
  error?: string;
  timestamp?: number;
  httpStatus?: number;
  responseHeaders?: Record<string, string>;
  rawResponse?: string;
  responsePayload?: unknown;
  responseId?: string;
  responseModel?: string;
  stopReason?: string;
  usage?: Record<string, unknown>;
  retryCount?: number;
}

export interface ApiTestResult {
  status: ApiTestStatus;
  message?: string;
  details?: string;
  models?: ApiModel[];
}

/**
 * 智能拼接 URL，避免重复路径
 * 支持各种 API 版本格式：/v1, /v2, /v3, /api/xxx/v3 等
 */
function smartJoinUrl(baseUrl: string, path: string): string {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');

  // 匹配各种版本号结尾模式：/v1, /v2, /v3 等
  const versionEndPattern = /\/v\d+$/;
  if (versionEndPattern.test(cleanBaseUrl)) {
    // baseUrl 以版本号结尾，直接拼接路径（去掉路径开头的版本号部分）
    const cleanPath = path.replace(/^\/v\d+/, '');
    return `${cleanBaseUrl}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
  }

  // 匹配更复杂的路径如 /api/coding/v3
  // 从路径中提取最后的版本号位置
  const versionMatch = cleanBaseUrl.match(/\/(v\d+)$/);
  if (versionMatch) {
    // 如果版本号后面有其他内容，只保留到版本号
    const versionIndex = cleanBaseUrl.lastIndexOf(versionMatch[0]);
    const basePart = cleanBaseUrl.substring(0, versionIndex + versionMatch[0].length);
    const cleanPath = path.replace(/^\/v\d+/, '');
    return `${basePart}${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
  }

  return `${cleanBaseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
}

function parseJsonSafe(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

const RETRYABLE_STATUS_CODES = new Set([500, 502, 503, 504, 529]);

function extractErrorMessage(parsed: any): string {
  if (!parsed || typeof parsed !== 'object') return '';
  const candidates = [
    parsed?.error?.message,
    parsed?.message,
    parsed?.error,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return '';
}

function isRetryableUpstreamError(status: number, parsed: any): boolean {
  if (RETRYABLE_STATUS_CODES.has(status)) return true;

  const message = extractErrorMessage(parsed).toLowerCase();
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

interface ModelListProbe {
  path: string;
  headers: Record<string, string>;
  label: string;
  timeout?: number;
}

type ModelListDiscoveryResult =
  | { kind: 'success'; models: ApiModel[] }
  | { kind: 'auth_error'; details?: string }
  | { kind: 'failed'; details?: string };

type ClaudeMessageModelProbeResult =
  | { kind: 'success'; models: ApiModel[] }
  | { kind: 'auth_error'; details?: string }
  | { kind: 'failed'; details?: string };

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return list.length > 0 ? list : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
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

  const idCandidates = [
    raw.id,
    raw.model,
    raw.model_id,
    raw.name,
  ];
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

function buildModelListProbes(apiType: ApiTestType, apiKey: string): ModelListProbe[] {
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

  if (apiType === 'claude') {
    return dedupeModelListProbes([
      { label: 'anthropic-v1-models', path: '/v1/models', headers: anthropicHeaders },
      { label: 'anthropic-v1-models-hybrid', path: '/v1/models', headers: anthropicHybridHeaders },
      { label: 'anthropic-models', path: '/models', headers: anthropicHeaders },
      { label: 'anthropic-models-hybrid', path: '/models', headers: anthropicHybridHeaders },
      { label: 'openai-v1-models', path: '/v1/models', headers: bearerHeaders },
      { label: 'openai-models', path: '/models', headers: bearerHeaders },
      { label: 'x-api-key-v1-models', path: '/v1/models', headers: keyHeaders },
      { label: 'x-api-key-models', path: '/models', headers: keyHeaders },
    ]);
  }

  return dedupeModelListProbes([
    { label: 'openai-v1-models', path: '/v1/models', headers: bearerHeaders },
    { label: 'openai-models', path: '/models', headers: bearerHeaders },
    { label: 'x-api-key-v1-models', path: '/v1/models', headers: keyHeaders },
    { label: 'x-api-key-models', path: '/models', headers: keyHeaders },
  ]);
}

async function discoverModelsFromProbes(baseUrl: string, probes: ModelListProbe[]): Promise<ModelListDiscoveryResult> {
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

function uniqueModelCandidates(candidates: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const candidate of candidates) {
    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function buildClaudeCandidateModels(baseUrl: string): string[] {
  const lower = baseUrl.toLowerCase();

  // 阿里云百炼 coding anthropic 网关通常不开放 models 列表，且有效模型有限
  if (lower.includes('dashscope.aliyuncs.com/apps/anthropic')) {
    return uniqueModelCandidates([
      'qwen3-coder-plus',
      'qwen3-coder-plus-latest',
      'qwen3-coder-max',
      'qwen3-coder-flash',
      'qwen3-coder-turbo',
      'qwen-coder-plus',
      'qwen-coder-plus-latest',
      'qwen-coder-max',
      'qwen-coder-turbo',
      'qwen2.5-coder-32b-instruct',
      'qwen2.5-coder-14b-instruct',
      'qwen2.5-coder-7b-instruct',
      'qwen3-plus',
      'qwen3-max-preview',
      'qwen3-max',
      'qwen3-turbo',
      'qwen-plus',
      'qwen-max',
      'qwen-turbo',
      'qwq-plus',
      'qwq-32b',
      'deepseek-r1',
      'deepseek-v3',
    ]);
  }

  return uniqueModelCandidates([
    'claude-3-7-sonnet-20250219',
    'claude-3-7-sonnet-latest',
    'claude-3-5-sonnet-20241022',
    'claude-3-5-sonnet-latest',
    'claude-3-5-haiku-20241022',
    'claude-3-5-haiku-latest',
    'claude-3-opus-20240229',
    'claude-3-sonnet-20240229',
    'claude-3-haiku-20240307',
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-opus-4-1-20250805',
    'anthropic/claude-3.5-sonnet',
    'anthropic/claude-3.5-haiku',
    'anthropic/claude-3-opus',
    'anthropic/claude-3-sonnet',
    'anthropic/claude-3-haiku',
    'qwen3-coder-plus',
    'qwen3-coder-max',
    'qwen3-coder-flash',
    'qwen3-plus',
    'qwen-plus',
    'qwen-max',
    'qwen-turbo',
    'deepseek-r1',
    'deepseek-v3',
    'gpt-4o',
    'gpt-4o-mini',
  ]);
}

async function discoverClaudeModelsByMessages(baseUrl: string, apiKey: string): Promise<ClaudeMessageModelProbeResult> {
  const url = smartJoinUrl(baseUrl, '/v1/messages');
  const candidates = buildClaudeCandidateModels(baseUrl);
  const modelMap = new Map<string, ApiModel>();
  let lastFailure: string | undefined;

  for (const candidate of candidates) {
    try {
      const response = await httpRequest({
        url,
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Authorization': `Bearer ${apiKey}`,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: candidate,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
        timeout: 20000,
      });

      const parsed = parseJsonSafe(response.body) as any;
      if (response.status === 200) {
        const responseModel = typeof parsed?.model === 'string' && parsed.model.trim()
          ? parsed.model
          : candidate;
        if (!modelMap.has(responseModel)) {
          modelMap.set(responseModel, {
            id: responseModel,
            name: responseModel,
            owned_by: 'anthropic-compatible',
          });
        }
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        return {
          kind: 'auth_error',
          details: extractErrorMessage(parsed) || t('apiTest.authFailed'),
        };
      }

      const errorMessage = extractErrorMessage(parsed).toLowerCase();
      if (
        response.status === 400 &&
        (errorMessage.includes('not supported') || errorMessage.includes('unsupported') || errorMessage.includes('invalid_parameter_error'))
      ) {
        continue;
      }

      lastFailure = extractErrorMessage(parsed) || `HTTP ${response.status}: ${response.statusText}`;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
    }
  }

  if (modelMap.size > 0) {
    return { kind: 'success', models: Array.from(modelMap.values()) };
  }

  return { kind: 'failed', details: lastFailure };
}

/**
 * 测试 OpenAI 兼容 API Key（通过 Rust 后端代理，避免 CORS）
 */
async function testOpenAIKey(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  try {
    const probeResult = await discoverModelsFromProbes(baseUrl, buildModelListProbes('openai', apiKey));

    if (probeResult.kind === 'success') {
      const models = probeResult.models;
      const modelCount = models.length;
      return {
        status: 'success',
        message: t('apiTest.validKey'),
        details: t('apiTest.modelsFound', { count: modelCount }),
        models,
      };
    } else if (probeResult.kind === 'auth_error') {
      return {
        status: 'error',
        message: t('apiTest.invalidKey'),
        details: probeResult.details || t('apiTest.authFailed'),
      };
    } else {
      return {
        status: 'error',
        message: t('apiTest.requestFailed'),
        details: probeResult.details || t('apiTest.unableConnect'),
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: t('apiTest.connectionFailed'),
      details: error instanceof Error ? error.message : t('apiTest.unableConnect'),
    };
  }
}

/**
 * 测试 Claude (Anthropic) API Key（通过 Rust 后端代理，避免 CORS）
 * 首先尝试获取模型列表，如果失败则降级到简单的消息测试
 */
async function testClaudeKey(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  const probeResult = await discoverModelsFromProbes(baseUrl, buildModelListProbes('claude', apiKey));
  if (probeResult.kind === 'success') {
    const modelCount = probeResult.models.length;
    return {
      status: 'success',
      message: t('apiTest.validKey'),
      details: t('apiTest.modelsFound', { count: modelCount }),
      models: probeResult.models,
    };
  }

  if (probeResult.kind === 'auth_error') {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      details: probeResult.details || t('apiTest.authFailed'),
    };
  }

  // 一些 Anthropic 兼容网关不开放 /models，尝试通过 messages 接口探测可用模型
  const discoveredByMessage = await discoverClaudeModelsByMessages(baseUrl, apiKey);
  if (discoveredByMessage.kind === 'success' && discoveredByMessage.models.length > 0) {
    const modelCount = discoveredByMessage.models.length;
    return {
      status: 'success',
      message: t('apiTest.validKey'),
      details: t('apiTest.modelsFound', { count: modelCount }),
      models: discoveredByMessage.models,
    };
  }

  if (discoveredByMessage.kind === 'auth_error') {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      details: discoveredByMessage.details || t('apiTest.authFailed'),
    };
  }

  try {
    // 降级到消息测试（官方 Anthropic API 或未实现 models 列表的兼容网关）
    const messagesUrl = smartJoinUrl(baseUrl, '/v1/messages');
    const messagesResponse = await httpRequest({
      url: messagesUrl,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{
          role: 'user',
          content: 'Hi'
        }]
      }),
      timeout: 15000,
    });

    if (messagesResponse.status === 200) {
      return {
        status: 'success',
        message: t('apiTest.validKey'),
        details: t('apiTest.anthropicConnected'),
      };
    } else if (messagesResponse.status === 401 || messagesResponse.status === 403) {
      return {
        status: 'error',
        message: t('apiTest.invalidKey'),
        details: t('apiTest.authFailed'),
      };
    } else {
      return {
        status: 'error',
        message: t('apiTest.requestFailed'),
        details: probeResult.details
          ? `${probeResult.details}; HTTP ${messagesResponse.status}: ${messagesResponse.statusText}`
          : `HTTP ${messagesResponse.status}: ${messagesResponse.statusText}`,
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: t('apiTest.connectionFailed'),
      details: error instanceof Error ? error.message : t('apiTest.unableConnect'),
    };
  }
}

/**
 * 通用 API 测试（简单连接测试）
 */
async function testGenericApi(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  try {
    const response = await httpRequest({
      url: baseUrl,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      timeout: 5000,
    });

    if (response.status === 200 || response.status === 401) {
      // 401 means the server is responding but the key is invalid
      return {
        status: 'success',
        message: t('apiTest.providerReachable'),
        details: response.status === 401 ? t('apiTest.keyMaybeInvalid') : t('apiTest.providerHealthy'),
      };
    }

    return {
      status: 'error',
      message: t('apiTest.providerUnreachable'),
      details: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      status: 'error',
      message: t('apiTest.connectionFailed'),
      details: error instanceof Error ? error.message : t('apiTest.unableConnect'),
    };
  }
}

/**
 * 测试 API Key
 */
export async function testApiKey(
  baseUrl: string,
  apiKey: string,
  apiType: ApiTestType = 'openai'
): Promise<ApiTestResult> {
  switch (apiType) {
    case 'openai':
      return testOpenAIKey(baseUrl, apiKey);
    case 'claude':
      return testClaudeKey(baseUrl, apiKey);
    case 'generic':
      return testGenericApi(baseUrl, apiKey);
    default:
      return testOpenAIKey(baseUrl, apiKey);
  }
}

/**
 * 测试单个模型（发送消息并获取响应）
 * 支持 OpenAI 和 Claude 两种协议
 */
export async function testModel(
  provider: Provider,
  apiKey: string,
  modelId: string,
  message: string = '你是什么模型',
  signal?: AbortSignal,
  systemPrompt?: string,
  thinkingEnabled?: boolean
): Promise<ModelTestResult> {
  const apiType = provider.apiType || 'openai';

  try {
    if (apiType === 'claude') {
      return await testClaudeModel(provider, apiKey, modelId, message, signal, systemPrompt, thinkingEnabled);
    } else {
      return await testOpenAIModel(provider, apiKey, modelId, message, signal, systemPrompt, thinkingEnabled);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 'error',
        message: t('apiTest.testCancelled'),
        error: t('apiTest.testCancelledDesc'),
      };
    }
    return {
      status: 'error',
      message: t('apiTest.modelTestFailed'),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 测试 OpenAI 兼容协议的模型
 */
async function testOpenAIModel(
  provider: Provider,
  apiKey: string,
  modelId: string,
  message: string,
  signal?: AbortSignal,
  systemPrompt?: string,
  thinkingEnabled?: boolean
): Promise<ModelTestResult> {
  const url = smartJoinUrl(provider.baseUrl, '/v1/chat/completions');

  // 检查是否已取消
  if (signal?.aborted) {
    throw new Error('AbortError');
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  const normalizedSystemPrompt = systemPrompt?.trim();
  if (normalizedSystemPrompt) {
    messages.push({ role: 'system', content: normalizedSystemPrompt });
  }
  messages.push({ role: 'user', content: message });

  const response = await httpRequest({
    url,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: 500,
      temperature: 0.2,
      reasoning_effort: thinkingEnabled ? 'medium' : undefined,
    }),
    timeout: 30000,
  });

  const parsed = parseJsonSafe(response.body) as any;
  const responseId = parsed?.id;
  const responseModel = parsed?.model || modelId;
  const usage = parsed?.usage && typeof parsed.usage === 'object' ? parsed.usage : undefined;
  const retryCount = 0;

  if (response.status === 200) {
    const content = parsed?.choices?.[0]?.message?.content || '';
    return {
      status: 'success',
      message: t('apiTest.modelTestSuccess'),
      response: content,
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      stopReason: parsed?.choices?.[0]?.finish_reason,
      usage,
      retryCount,
    };
  } else if (response.status === 401) {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      error: t('apiTest.authFailed'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  } else if (response.status === 429) {
    return {
      status: 'error',
      message: t('apiTest.rateLimited'),
      error: t('apiTest.rateLimitedDesc'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  } else {
    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    errorMsg = parsed?.error?.message || errorMsg;
    return {
      status: 'error',
      message: t('apiTest.modelTestFailed'),
      error: errorMsg,
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  }
}

/**
 * 测试 Claude 协议的模型
 */
async function testClaudeModel(
  provider: Provider,
  apiKey: string,
  modelId: string,
  message: string,
  signal?: AbortSignal,
  systemPrompt?: string,
  thinkingEnabled?: boolean
): Promise<ModelTestResult> {
  const url = smartJoinUrl(provider.baseUrl, '/v1/messages');
  const maxRetries = 2;

  // 检查是否已取消
  if (signal?.aborted) {
    throw new Error('AbortError');
  }

  let attempt = 0;
  let response: Awaited<ReturnType<typeof httpRequest>> | null = null;
  let parsed: any = null;

  while (attempt <= maxRetries) {
    // 重试前再次检查是否已取消
    if (signal?.aborted) {
      throw new Error('AbortError');
    }

    response = await httpRequest({
      url,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'Authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelId,
        system: systemPrompt?.trim() || undefined,
        max_tokens: thinkingEnabled ? 1024 : 500,
        messages: [
          { role: 'user', content: message }
        ],
        temperature: 0.2,
        thinking: thinkingEnabled
          ? {
              type: 'enabled',
              budget_tokens: 256,
            }
          : undefined,
      }),
      timeout: 30000,
    });

    parsed = parseJsonSafe(response.body) as any;
    if (!isRetryableUpstreamError(response.status, parsed) || attempt >= maxRetries) {
      break;
    }

    attempt += 1;
    await sleep(600 * attempt);
  }

  if (!response) {
    return {
      status: 'error',
      message: t('apiTest.modelTestFailed'),
      error: t('apiTest.unableConnect'),
      retryCount: attempt,
    };
  }

  const responseId = parsed?.id;
  const responseModel = parsed?.model || modelId;
  const usage = parsed?.usage && typeof parsed.usage === 'object' ? parsed.usage : undefined;
  const retryCount = attempt;

  if (response.status === 200) {
    // Claude 响应格式: content[0].text
    const contentBlocks = Array.isArray(parsed?.content) ? parsed.content : [];
    const textBlocks = contentBlocks
      .filter((block: any) => block?.type === 'text')
      .map((block: any) => block?.text)
      .filter((value: any) => typeof value === 'string' && value.length > 0);
    const content = textBlocks.join('\n\n') || parsed?.content?.[0]?.text || '';
    return {
      status: 'success',
      message: t('apiTest.modelTestSuccess'),
      response: content,
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      stopReason: parsed?.stop_reason || parsed?.stop_reason_type,
      usage,
      retryCount,
    };
  } else if (response.status === 401) {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      error: t('apiTest.authFailed'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  } else if (response.status === 429) {
    return {
      status: 'error',
      message: t('apiTest.rateLimited'),
      error: t('apiTest.rateLimitedDesc'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  } else {
    let errorMsg = `HTTP ${response.status}: ${response.statusText}`;
    errorMsg = parsed?.error?.message || errorMsg;
    if (isRetryableUpstreamError(response.status, parsed) && retryCount > 0) {
      errorMsg = `${errorMsg} (retried ${retryCount} times)`;
    }
    return {
      status: 'error',
      message: t('apiTest.modelTestFailed'),
      error: errorMsg,
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.body,
      responsePayload: parsed,
      responseId,
      responseModel,
      usage,
      retryCount,
    };
  }
}

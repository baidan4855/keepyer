/**
 * API Key 测试工具
 */

import { httpRequest } from '@/domains/settings/lib/secure-storage';
import { proxyDiscoverModels, proxyLlmChat, proxyProbeModel, type LlmProtocol } from '@/domains/chat/lib/llm-proxy';
import { runCodexExec } from '@/domains/chat/lib/codex-exec';
import type { ApiModel, Provider } from '@/types';
import i18n from '@/i18n';
import { CODEX_FIXED_MODEL_IDS, getCodexFixedModels } from '@/shared/lib/codex';

const t = (key: string, options?: Record<string, any>) => i18n.t(key, options) as string;

export type ApiTestStatus = 'idle' | 'loading' | 'success' | 'error';
export type ApiTestType = 'openai' | 'claude' | 'generic' | 'codex';

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
  usage?: Record<string, unknown>;
}

export interface ModelProtocolOptions {
  inputProtocol?: LlmProtocol;
  targetProtocol?: LlmProtocol;
  enableProtocolTransform?: boolean;
}

function resolveCodexWorkingDir(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim();
  if (!trimmed) return undefined;
  if (/^https?:\/\//i.test(trimmed)) return undefined;
  return trimmed;
}

function buildCodexPrompt(
  message: string,
  systemPrompt?: string,
): string {
  const normalizedInput = message.trim();
  const normalizedSystem = systemPrompt?.trim();

  if (normalizedSystem) {
    return [
      'Follow the system instructions below strictly.',
      '',
      '<system>',
      normalizedSystem,
      '</system>',
      '',
      '<user>',
      normalizedInput,
      '</user>',
      '',
      'Reply directly to the user request.',
    ].join('\n');
  }

  return normalizedInput;
}

function estimateTextTokens(text: string): number {
  const normalized = text.trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
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

function resolveModelProtocols(
  options: ModelProtocolOptions | undefined,
  defaults: { input: LlmProtocol; target: LlmProtocol },
): { inputProtocol: LlmProtocol; targetProtocol: LlmProtocol; enableProtocolTransform: boolean } {
  const inputProtocol = options?.inputProtocol ?? defaults.input;
  const targetProtocol = options?.targetProtocol ?? defaults.target;
  const enableProtocolTransform = options?.enableProtocolTransform ?? inputProtocol !== targetProtocol;

  return {
    inputProtocol,
    targetProtocol,
    enableProtocolTransform,
  };
}

function buildChatPayloadForInputProtocol(
  inputProtocol: LlmProtocol,
  modelId: string,
  message: string,
  systemPrompt: string | undefined,
  thinkingEnabled: boolean | undefined,
  maxTokens: number,
): Record<string, unknown> {
  const normalizedSystemPrompt = systemPrompt?.trim();
  const temperature = 0.2;

  if (inputProtocol === 'anthropic') {
    return {
      model: modelId,
      system: normalizedSystemPrompt || undefined,
      max_tokens: maxTokens,
      temperature,
      messages: [{ role: 'user', content: message }],
      thinking: thinkingEnabled
        ? {
            type: 'enabled',
            budget_tokens: 256,
          }
        : undefined,
    };
  }

  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (normalizedSystemPrompt) {
    messages.push({ role: 'system', content: normalizedSystemPrompt });
  }
  messages.push({ role: 'user', content: message });

  return {
    model: modelId,
    messages,
    max_tokens: maxTokens,
    temperature,
    reasoning_effort: thinkingEnabled ? 'medium' : undefined,
  };
}

type ClaudeMessageModelProbeResult =
  | { kind: 'success'; models: ApiModel[] }
  | { kind: 'auth_error'; details?: string }
  | { kind: 'failed'; details?: string };

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
    'claude-opus-4-6',
    'claude-opus-4-6-latest',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6-latest',
    'claude-opus-4-5',
    'claude-opus-4-5-latest',
    'claude-sonnet-4-5',
    'claude-sonnet-4-5-latest',
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
  const candidates = buildClaudeCandidateModels(baseUrl);
  const modelMap = new Map<string, ApiModel>();
  let lastFailure: string | undefined;

  for (const candidate of candidates) {
    try {
      const response = await proxyProbeModel({
        baseUrl,
        apiKey,
        protocol: 'anthropic',
        modelId: candidate,
        timeoutMs: 20000,
      });

      const parsed = response.payload as any;
      if (response.ok) {
        const responseModel = typeof response.responseModel === 'string' && response.responseModel.trim()
          ? response.responseModel
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
          details: response.error || extractErrorMessage(parsed) || t('apiTest.authFailed'),
        };
      }

      const errorMessage = (response.error || extractErrorMessage(parsed)).toLowerCase();
      if (
        response.status === 400 &&
        (errorMessage.includes('not supported') || errorMessage.includes('unsupported') || errorMessage.includes('invalid_parameter_error'))
      ) {
        continue;
      }

      lastFailure = response.error || extractErrorMessage(parsed) || `HTTP ${response.status}: ${response.statusText}`;
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
    const probeResult = await proxyDiscoverModels({
      baseUrl,
      apiKey,
      protocol: 'openai',
    });

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
  const probeResult = await proxyDiscoverModels({
    baseUrl,
    apiKey,
    protocol: 'anthropic',
  });
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
 * 测试 Codex Exec provider（本地命令执行）
 */
async function testCodexProvider(baseUrl: string): Promise<ApiTestResult> {
  const probePrompt = 'Reply with exactly: pong';
  const estimatedInputTokens = estimateTextTokens(probePrompt);
  try {
    const result = await runCodexExec({
      prompt: probePrompt,
      workingDir: resolveCodexWorkingDir(baseUrl),
      timeoutMs: 120000,
    });

    if (!result.success) {
      const failureText = result.output || result.stderr || '';
      const estimatedOutputTokens = estimateTextTokens(failureText);
      const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
      return {
        status: 'error',
        message: t('apiTest.requestFailed'),
        details: result.output || result.stderr || `codex exec failed with exit code ${result.exitCode}`,
        usage: {
          input_tokens: estimatedInputTokens,
          output_tokens: estimatedOutputTokens,
          total_tokens: estimatedTotalTokens,
          usage_source: 'estimated',
        },
      };
    }

    const models = getCodexFixedModels();
    const estimatedOutputTokens = estimateTextTokens(result.output || result.stdout || '');
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
    return {
      status: 'success',
      message: t('apiTest.validKey'),
      details: t('apiTest.modelsFound', { count: models.length }),
      models,
      usage: {
        input_tokens: estimatedInputTokens,
        output_tokens: estimatedOutputTokens,
        total_tokens: estimatedTotalTokens,
        usage_source: 'estimated',
      },
    };
  } catch (error) {
    return {
      status: 'error',
      message: t('apiTest.connectionFailed'),
      details: error instanceof Error ? error.message : t('apiTest.unableConnect'),
      usage: {
        input_tokens: estimatedInputTokens,
        output_tokens: 0,
        total_tokens: estimatedInputTokens,
        usage_source: 'estimated',
      },
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
    case 'codex':
      return testCodexProvider(baseUrl);
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
  thinkingEnabled?: boolean,
  protocolOptions?: ModelProtocolOptions
): Promise<ModelTestResult> {
  const apiType = provider.apiType || 'openai';
  if (apiType === 'codex') {
    return testCodexModel(
      provider,
      modelId,
      message,
      signal,
      systemPrompt,
    );
  }

  const defaultTargetProtocol: LlmProtocol = apiType === 'claude' ? 'anthropic' : 'openai';
  const targetProtocol = protocolOptions?.targetProtocol ?? defaultTargetProtocol;

  try {
    if (targetProtocol === 'anthropic') {
      return await testClaudeModel(
        provider,
        apiKey,
        modelId,
        message,
        signal,
        systemPrompt,
        thinkingEnabled,
        protocolOptions
      );
    }

    return await testOpenAIModel(
      provider,
      apiKey,
      modelId,
      message,
      signal,
      systemPrompt,
      thinkingEnabled,
      protocolOptions
    );
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
 * 测试 Codex Exec 模型
 */
async function testCodexModel(
  provider: Provider,
  modelId: string,
  message: string,
  signal?: AbortSignal,
  systemPrompt?: string,
): Promise<ModelTestResult> {
  if (signal?.aborted) {
    throw new Error('AbortError');
  }

  const selectedModel = modelId.trim() || CODEX_FIXED_MODEL_IDS[0];
  const prompt = buildCodexPrompt(message, systemPrompt);
  const estimatedInputTokens = estimateTextTokens(prompt);

  try {
    const result = await runCodexExec({
      prompt,
      model: selectedModel,
      workingDir: resolveCodexWorkingDir(provider.baseUrl),
      timeoutMs: 240000,
    });

    if (result.success) {
      const estimatedOutputTokens = estimateTextTokens(result.output || result.stdout || '');
      const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
      return {
        status: 'success',
        message: t('apiTest.modelTestSuccess'),
        response: result.output,
        responsePayload: {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        },
        rawResponse: result.stdout,
        responseModel: selectedModel,
        usage: {
          input_tokens: estimatedInputTokens,
          output_tokens: estimatedOutputTokens,
          total_tokens: estimatedTotalTokens,
          usage_source: 'estimated',
        },
        retryCount: 0,
      };
    }

    const failureText = result.output || result.stderr || '';
    const estimatedOutputTokens = estimateTextTokens(failureText);
    const estimatedTotalTokens = estimatedInputTokens + estimatedOutputTokens;
    return {
      status: 'error',
      message: t('apiTest.modelTestFailed'),
      error: result.output || result.stderr || `codex exec failed with exit code ${result.exitCode}`,
      responsePayload: {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      rawResponse: result.stdout,
      responseModel: selectedModel,
      usage: {
        input_tokens: estimatedInputTokens,
        output_tokens: estimatedOutputTokens,
        total_tokens: estimatedTotalTokens,
        usage_source: 'estimated',
      },
      retryCount: 0,
    };
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
      responseModel: selectedModel,
      usage: {
        input_tokens: estimatedInputTokens,
        output_tokens: 0,
        total_tokens: estimatedInputTokens,
        usage_source: 'estimated',
      },
      retryCount: 0,
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
  thinkingEnabled?: boolean,
  protocolOptions?: ModelProtocolOptions
): Promise<ModelTestResult> {
  if (signal?.aborted) {
    throw new Error('AbortError');
  }

  const { inputProtocol, targetProtocol, enableProtocolTransform } = resolveModelProtocols(
    protocolOptions,
    { input: 'openai', target: 'openai' }
  );
  const payload = buildChatPayloadForInputProtocol(
    inputProtocol,
    modelId,
    message,
    systemPrompt,
    thinkingEnabled,
    500
  );

  const response = await proxyLlmChat({
    baseUrl: provider.baseUrl,
    apiKey,
    targetProtocol,
    inputProtocol,
    enableProtocolTransform,
    payload,
    timeoutMs: 30000,
  });

  if (response.ok) {
    return {
      status: 'success',
      message: t('apiTest.modelTestSuccess'),
      response: response.text || '',
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      stopReason: response.stopReason,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      error: t('apiTest.authFailed'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  if (response.status === 429) {
    return {
      status: 'error',
      message: t('apiTest.rateLimited'),
      error: t('apiTest.rateLimitedDesc'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  return {
    status: 'error',
    message: t('apiTest.modelTestFailed'),
    error: response.error || `HTTP ${response.status}: ${response.statusText}`,
    httpStatus: response.status,
    responseHeaders: response.headers,
    rawResponse: response.rawBody,
    responsePayload: response.payload,
    responseId: response.responseId,
    responseModel: response.responseModel || modelId,
    usage: response.usage,
    retryCount: response.retryCount,
  };
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
  thinkingEnabled?: boolean,
  protocolOptions?: ModelProtocolOptions
): Promise<ModelTestResult> {
  if (signal?.aborted) {
    throw new Error('AbortError');
  }

  const { inputProtocol, targetProtocol, enableProtocolTransform } = resolveModelProtocols(
    protocolOptions,
    { input: 'openai', target: 'anthropic' }
  );
  const payload = buildChatPayloadForInputProtocol(
    inputProtocol,
    modelId,
    message,
    systemPrompt,
    thinkingEnabled,
    thinkingEnabled ? 1024 : 500
  );

  const response = await proxyLlmChat({
    baseUrl: provider.baseUrl,
    apiKey,
    targetProtocol,
    inputProtocol,
    enableProtocolTransform,
    payload,
    timeoutMs: 30000,
    retryPolicy: {
      maxRetries: 2,
      retryDelayMs: 600,
    },
  });

  if (response.ok) {
    return {
      status: 'success',
      message: t('apiTest.modelTestSuccess'),
      response: response.text || '',
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      stopReason: response.stopReason,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      status: 'error',
      message: t('apiTest.invalidKey'),
      error: t('apiTest.authFailed'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  if (response.status === 429) {
    return {
      status: 'error',
      message: t('apiTest.rateLimited'),
      error: t('apiTest.rateLimitedDesc'),
      httpStatus: response.status,
      responseHeaders: response.headers,
      rawResponse: response.rawBody,
      responsePayload: response.payload,
      responseId: response.responseId,
      responseModel: response.responseModel || modelId,
      usage: response.usage,
      retryCount: response.retryCount,
    };
  }

  const suffix = response.retryCount > 0 ? ` (retried ${response.retryCount} times)` : '';
  return {
    status: 'error',
    message: t('apiTest.modelTestFailed'),
    error: `${response.error || `HTTP ${response.status}: ${response.statusText}`}${suffix}`,
    httpStatus: response.status,
    responseHeaders: response.headers,
    rawResponse: response.rawBody,
    responsePayload: response.payload,
    responseId: response.responseId,
    responseModel: response.responseModel || modelId,
    usage: response.usage,
    retryCount: response.retryCount,
  };
}

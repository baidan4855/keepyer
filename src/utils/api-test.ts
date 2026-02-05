/**
 * API Key 测试工具
 */

import { httpRequest } from './secure-storage';
import type { ApiModel } from '@/types';

export type ApiTestStatus = 'idle' | 'loading' | 'success' | 'error';
export type ApiTestType = 'openai' | 'claude' | 'generic';

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

/**
 * 测试 OpenAI 兼容 API Key（通过 Rust 后端代理，避免 CORS）
 */
async function testOpenAIKey(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  try {
    const url = smartJoinUrl(baseUrl, '/v1/models');
    const response = await httpRequest({
      url: url,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000, // 10 second timeout
    });

    if (response.status === 200) {
      const data = JSON.parse(response.body);
      const models = data.data || [];
      const modelCount = models.length || 0;
      return {
        status: 'success',
        message: 'API Key 有效',
        details: `找到 ${modelCount} 个可用模型`,
        models: models.map((m: any) => ({
          id: m.id,
          name: m.name || m.id,
          owned_by: m.owned_by,
          task_type: m.task_type,
          input_modalities: m.input_modalities || m.modalities?.input_modalities,
          output_modalities: m.output_modalities || m.modalities?.output_modalities,
          token_limits: m.token_limits,
          domain: m.domain,
          version: m.version,
          created: m.created,
        })),
      };
    } else if (response.status === 401) {
      return {
        status: 'error',
        message: 'API Key 无效',
        details: '认证失败，请检查密钥是否正确',
      };
    } else {
      return {
        status: 'error',
        message: '请求失败',
        details: `HTTP ${response.status}: ${response.statusText}`,
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: '连接失败',
      details: error instanceof Error ? error.message : '无法连接到服务器',
    };
  }
}

/**
 * 测试 Claude (Anthropic) API Key（通过 Rust 后端代理，避免 CORS）
 * 首先尝试获取模型列表，如果失败则降级到简单的消息测试
 */
async function testClaudeKey(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  try {
    // 首先尝试获取模型列表（智谱 AI 等兼容服务支持）
    const modelsUrl = smartJoinUrl(baseUrl, '/v1/models');
    const modelsResponse = await httpRequest({
      url: modelsUrl,
      method: 'GET',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 10000,
    });

    if (modelsResponse.status === 200) {
      const data = JSON.parse(modelsResponse.body);
      const models = data.data || [];
      const modelCount = models.length || 0;
      return {
        status: 'success',
        message: 'API Key 有效',
        details: `找到 ${modelCount} 个可用模型`,
        models: models.map((m: any) => ({
          id: m.id,
          name: m.name || m.display_name || m.id,
          owned_by: m.owned_by,
          task_type: m.task_type,
          input_modalities: m.input_modalities || m.modalities?.input_modalities,
          output_modalities: m.output_modalities || m.modalities?.output_modalities,
          token_limits: m.token_limits,
          domain: m.domain,
          version: m.version,
          created: m.created,
        })),
      };
    }
  } catch (error) {
    // 模型列表请求失败，继续尝试消息测试
  }

  // 降级到消息测试（官方 Anthropic API 等）
  try {
    const messagesUrl = smartJoinUrl(baseUrl, '/v1/messages');
    const messagesResponse = await httpRequest({
      url: messagesUrl,
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
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
        message: 'API Key 有效',
        details: '成功连接到 Anthropic API',
      };
    } else if (messagesResponse.status === 401) {
      return {
        status: 'error',
        message: 'API Key 无效',
        details: '认证失败，请检查密钥是否正确',
      };
    } else {
      return {
        status: 'error',
        message: '请求失败',
        details: `HTTP ${messagesResponse.status}: ${messagesResponse.statusText}`,
      };
    }
  } catch (error) {
    return {
      status: 'error',
      message: '连接失败',
      details: error instanceof Error ? error.message : '无法连接到服务器',
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
        message: '提供方可达',
        details: response.status === 401 ? 'API Key 可能无效' : '提供方响应正常',
      };
    }

    return {
      status: 'error',
      message: '提供方不可达',
      details: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (error) {
    return {
      status: 'error',
      message: '连接失败',
      details: error instanceof Error ? error.message : '无法连接到服务器',
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

/**
 * 安全存储工具 - 使用 Tauri 后端加密 API Keys
 */

import { invoke } from '@tauri-apps/api/core';

export interface SecuritySettings {
  requireAuthToView: boolean;
  requireAuthToCopy: boolean;
}

/**
 * 加密 API Key
 */
export async function encryptApiKey(apiKey: string): Promise<string> {
  try {
    return await invoke('encrypt_data', { data: apiKey });
  } catch (error) {
    console.error('Encryption failed:', error);
    // 如果加密失败，返回原始数据（向后兼容）
    return apiKey;
  }
}

/**
 * 解密 API Key
 */
export async function decryptApiKey(encryptedKey: string): Promise<string> {
  try {
    // 检查是否为加密数据格式
    if (!encryptedKey.startsWith('{')) {
      // 可能已经是明文
      return encryptedKey;
    }

    const result = await invoke('decrypt_data', { encryptedData: encryptedKey });

    // 检查解密结果是否仍然像加密数据
    if (typeof result === 'string' && result.startsWith('{"nonce":')) {
      console.warn('Decryption returned encrypted data, treating as plaintext');
      return encryptedKey;
    }

    return result;
  } catch (error) {
    console.error('Decryption failed:', error);
    // 如果解密失败，可能是未加密的数据（向后兼容）
    return encryptedKey;
  }
}

/**
 * 检查是否为加密数据
 */
export function isEncrypted(data: string): boolean {
  try {
    const parsed = JSON.parse(data);
    return parsed.nonce && parsed.ciphertext;
  } catch {
    return false;
  }
}

/**
 * 生物识别认证（操作系统原生授权）
 */
export async function authenticateBiometric(reason?: string): Promise<boolean> {
  try {
    return await invoke('authenticate_biometric', { reason });
  } catch (error) {
    console.error('Biometric authentication failed:', error);
    return false;
  }
}

/**
 * 设置密码
 */
export async function setupPassword(password: string): Promise<void> {
  return await invoke('setup_password', { password });
}

/**
 * 验证密码
 */
export async function verifyPassword(password: string): Promise<boolean> {
  return await invoke('verify_password', { password });
}

/**
 * 检查是否已设置密码
 */
export async function hasPassword(): Promise<boolean> {
  try {
    return await invoke('has_password');
  } catch {
    return false;
  }
}

/**
 * 修改密码（需要验证原密码）
 */
export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  return await invoke('change_password', { oldPassword, newPassword });
}

/**
 * HTTP 请求代理（避免 CORS 问题）
 */
export interface HttpRequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number; // 毫秒
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
}

export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
  const result = await invoke<string>('http_request', {
    url: options.url,
    method: options.method || 'GET',
    headers: options.headers ? JSON.stringify(options.headers) : null,
    body: options.body || null,
    timeoutMs: options.timeout || 30000,
  });

  return JSON.parse(result);
}

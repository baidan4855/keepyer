/**
 * 工具函数
 */

import { ApiKey, ApiKeyWithStatus, KeyStatus, Provider, ProviderWithKeys } from '@/types';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * 生成唯一 ID
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 检查密钥是否过期
 */
export function getKeyStatus(key: ApiKey): KeyStatus {
  if (!key.expiresAt) return 'valid';

  const now = new Date();
  const expiresAt = new Date(key.expiresAt);
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (daysUntilExpiry <= 0) return 'expired';
  if (daysUntilExpiry <= 7) return 'expiring-soon';
  return 'valid';
}

/**
 * 获取密钥过期天数
 */
export function getDaysUntilExpiry(key: ApiKey): number | undefined {
  if (!key.expiresAt) return undefined;

  const now = new Date();
  const expiresAt = new Date(key.expiresAt);
  return Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * 为密钥添加状态信息
 */
export function enrichKeyWithStatus(key: ApiKey): ApiKeyWithStatus {
  const status = getKeyStatus(key);
  const daysUntilExpiry = getDaysUntilExpiry(key);

  return {
    ...key,
    status,
    daysUntilExpiry,
  };
}

/**
 * 构建提供方详情（包含关联的 Keys）
 */
export function buildProviderWithKeys(
  provider: Provider,
  keys: ApiKey[]
): ProviderWithKeys {
  const providerKeys = keys
    .filter((k) => k.providerId === provider.id)
    .map(enrichKeyWithStatus)
    .sort((a, b) => {
      // 优先显示有效的密钥，然后按创建时间排序
      if (a.status === 'valid' && b.status !== 'valid') return -1;
      if (a.status !== 'valid' && b.status === 'valid') return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

  const validCount = providerKeys.filter((k) => k.status === 'valid').length;
  const expiredCount = providerKeys.filter((k) => k.status === 'expired').length;

  return {
    ...provider,
    keys: providerKeys,
    validCount,
    expiredCount,
  };
}

/**
 * 复制文本到剪贴板 (Tauri API)
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // 尝试使用 Tauri API
    if (window.__TAURI__) {
      await writeText(text);
      return true;
    }
    // 降级到浏览器 API (用于开发调试)
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);
    return false;
  }
}

/**
 * 格式化日期显示
 */
export function formatDate(date: Date | undefined): string {
  if (!date) return '永不过期';

  const d = new Date(date);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/**
 * 格式化相对时间
 */
export function formatRelativeTime(date: Date | undefined): string {
  if (!date) return '永不过期';

  const now = new Date();
  const target = new Date(date);
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return '已过期';
  if (diffDays === 0) return '今天过期';
  if (diffDays === 1) return '明天过期';
  if (diffDays <= 7) return `${diffDays} 天后过期`;
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} 周后过期`;
  if (diffDays <= 365) return `${Math.ceil(diffDays / 30)} 月后过期`;
  return `${Math.ceil(diffDays / 365)} 年后过期`;
}

/**
 * 遮蔽 API Key 显示
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(key.length);
  return `${key.slice(0, 8)}${'•'.repeat(Math.min(16, key.length - 12))}${key.slice(-4)}`;
}

/**
 * 验证 URL 格式
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

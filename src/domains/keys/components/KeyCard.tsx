import { Check, CheckCircle, Copy, Edit, Eye, EyeOff, List, Loader2, Rocket, Trash2, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/shared/lib/cn';
import type { ApiKeyWithStatus } from '@/types';
import type { ApiTestResult } from '@/domains/keys/lib/api-test';

interface KeyCardProps {
  apiKey: ApiKeyWithStatus;
  onCopy: () => void;
  onTest: () => void;
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onShowModels?: () => void;
  isCopied: boolean;
  testResult?: ApiTestResult;
  decryptedKey?: string;
}

export default function KeyCard({
  apiKey,
  onCopy,
  onTest,
  onView,
  onEdit,
  onDelete,
  onShowModels,
  isCopied,
  testResult,
  decryptedKey,
}: KeyCardProps) {
  const { t } = useTranslation();
  const [showKey, setShowKey] = useState(false);

  // 当密钥被解密后自动显示
  useEffect(() => {
    if (decryptedKey && !showKey) {
      setShowKey(true);
    }
  }, [decryptedKey, showKey]);

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleDateString(t('keyStatus.neverExpires') === '永不过期' ? 'zh-CN' : 'en-US');
  };

  // 统一的标签：优先显示测试状态，否则显示密钥状态
  const getBadge = () => {
    // 如果有测试结果，优先显示测试状态
    if (testResult) {
      switch (testResult.status) {
        case 'loading':
          return (
            <span className="badge badge-neutral">
              <Loader2 className="w-3 h-3 animate-spin" />
              {t('common.loading', { defaultValue: 'Testing...' })}
            </span>
          );
        case 'success':
          return (
            <span className="badge badge-success">
              <CheckCircle className="w-3 h-3" />
              {testResult.message || t('common.save', { defaultValue: 'Valid' })}
            </span>
          );
        case 'error':
          return (
            <span className="badge badge-danger" title={testResult.details}>
              <XCircle className="w-3 h-3" />
              {testResult.message || t('common.cancel', { defaultValue: 'Failed' })}
            </span>
          );
        default:
          return null;
      }
    }

    // 否则显示密钥状态
    switch (apiKey.status) {
      case 'expired':
        return (
          <span className="badge badge-danger">
            <span className="status-dot status-dot-expired" />
            {t('keyStatus.expired')}
          </span>
        );
      case 'expiring-soon':
        return (
          <span className="badge badge-warning">
            <span className="status-dot status-dot-warning" />
            {t('keyStatus.expiringDays', { days: apiKey.daysUntilExpiry || 0 })}
          </span>
        );
      default:
        return (
          <span className="badge badge-success">
            <span className="status-dot status-dot-valid" />
            {t('keyStatus.valid')}
          </span>
        );
    }
  };

  const getDisplayKey = () => {
    if (showKey && decryptedKey) {
      return decryptedKey;
    }
    // 非查看状态：显示固定20位的*号
    return '********************';
  };

  return (
    <div className={cn('card p-4', apiKey.status === 'expired' && 'opacity-60')}>
      {/* 第一行：标题 + 状态 + 右侧所有操作按钮 */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          {apiKey.name && (
            <h3 className="font-semibold text-sm text-slate-800 truncate">{apiKey.name}</h3>
          )}
          {getBadge()}
        </div>

        <div className="flex items-center gap-1">
          {apiKey.models && apiKey.models.length > 0 && onShowModels && (
            <button
              onClick={onShowModels}
              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-all"
              title={t('keys.viewModels') || '查看模型列表'}
            >
              <List className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={() => {
              if (showKey) {
                // 隐藏时重置状态，下次查看需要重新验证
                setShowKey(false);
              } else {
                // 查看时需要验证密码（ onView 会处理）
                onView();
              }
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
            title={showKey ? t('common.close', { defaultValue: 'Hide' }) : t('common.save', { defaultValue: 'Show' })}
          >
            {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onCopy}
            className={cn('p-1.5 rounded-lg transition-all', 'text-slate-400 hover:text-primary-600 hover:bg-primary-50', isCopied && 'text-emerald-600 bg-emerald-50')}
            title={t('common.copy')}
          >
            {isCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onTest}
            disabled={testResult?.status === 'loading'}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-all disabled:opacity-50"
            title="Test API Key"
          >
            {testResult?.status === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Rocket className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-all"
            title={t('common.edit')}
          >
            <Edit className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
            title={t('common.delete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 第二行：密钥显示 */}
      <div className="mb-2">
        <code className={cn('font-mono text-xs text-slate-600 bg-slate-100 px-2.5 py-1.5 rounded-lg block w-full', 'transition-all duration-200', !showKey && 'key-mask')}>
          {getDisplayKey()}
        </code>
      </div>

      {/* 第三行：测试结果详情 */}
      {testResult?.details && testResult.status !== 'loading' && (
        <p className={cn('text-xs mb-2', testResult.status === 'success' ? 'text-emerald-600' : 'text-red-500')}>
          {testResult.details}
        </p>
      )}

      {/* 第四行：备注和过期日期 */}
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {apiKey.note && (
          <span className="truncate max-w-xs" title={apiKey.note}>
            {t('common.note')}: {apiKey.note}
          </span>
        )}
        {apiKey.expiresAt && (
          <span>
            {t('common.expires')}: {formatDate(apiKey.expiresAt)}
          </span>
        )}
      </div>
    </div>
  );
}

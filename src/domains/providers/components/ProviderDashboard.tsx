import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Plus } from 'lucide-react';
import { useStore } from '@/store';
import ProviderEmptyState from './ProviderEmptyState';
import KeyCard from '@/domains/keys/components/KeyCard';
import { cn } from '@/shared/lib/cn';
import { copyToClipboard } from '@/shared/lib/helpers';
import { testApiKey, ApiTestResult } from '@/domains/keys/lib/api-test';
import { decryptApiKey, hasPassword, isEncrypted } from '@/domains/settings/lib/secure-storage';
import { toast } from '@/shared/lib/toast';

export default function ProviderDashboard() {
  const { t } = useTranslation();
  const {
    getSelectedProvider,
    setAddKeyModalOpen,
    isAddKeyModalOpen,
    setEditKeyId,
    setCopiedItem,
    copiedItem,
    setAuthModalOpen,
    setAuthAction,
    setPendingAuthKeyId,
    checkAuthSession,
    setDeleteTarget,
    setDeleteConfirmOpen,
    setModelsModalOpen,
    updateKeyModels,
  } = useStore();

  const selectedProvider = getSelectedProvider();
  const [testResults, setTestResults] = useState<Record<string, ApiTestResult>>({});
  const [decryptedKeys, setDecryptedKeys] = useState<Record<string, string>>({});

  // 检查是否需要密码验证
  const requireAuth = async (): Promise<boolean> => {
    const has = await hasPassword();
    return has && !checkAuthSession();
  };

  const handleCopy = async (encryptedKey: string, id: string) => {
    const needsAuth = await requireAuth();

    if (needsAuth) {
      setPendingAuthKeyId(id);
      setAuthAction('copy');
      setAuthModalOpen(true);
      return;
    }

    // 先解密再复制
    const decryptedKey = await decryptApiKey(encryptedKey);
    const success = await copyToClipboard(decryptedKey);
    if (success) {
      setCopiedItem({ type: 'key', id });
      toast.success(t('notifications.copySuccess') || '复制成功');
    } else {
      toast.error(t('notifications.copyFailed') || '复制失败');
    }
  };

  const handleCopyUrl = async (url: string) => {
    const success = await copyToClipboard(url);
    if (success && selectedProvider) {
      setCopiedItem({ type: 'url', id: selectedProvider.id });
      toast.success(t('notifications.copySuccess') || '复制成功');
    } else {
      toast.error(t('notifications.copyFailed') || '复制失败');
    }
  };

  const handleViewKey = async (encryptedKey: string, id: string) => {
    if (decryptedKeys[id]) {
      return;
    }

    const needsAuth = await requireAuth();

    if (needsAuth) {
      setPendingAuthKeyId(id);
      setAuthAction('view');
      setAuthModalOpen(true);
      return;
    }

    const decrypted = await decryptApiKey(encryptedKey);
    setDecryptedKeys((prev) => ({ ...prev, [id]: decrypted }));
  };

  const handleEditKey = async (id: string) => {
    const needsAuth = await requireAuth();

    if (needsAuth) {
      setPendingAuthKeyId(id);
      setAuthAction('edit');
      setAuthModalOpen(true);
      return;
    }

    setEditKeyId(id);
  };

  const handleDeleteKey = async (id: string) => {
    const needsAuth = await requireAuth();

    if (needsAuth) {
      setPendingAuthKeyId(id);
      setAuthAction('delete');
      setAuthModalOpen(true);
      return;
    }

    setDeleteTarget({ type: 'key', id });
    setDeleteConfirmOpen(true);
  };

  const handleTest = async (apiKey: string, keyId: string) => {
    if (!selectedProvider) return;

    const decrypted = isEncrypted(apiKey)
      ? await decryptApiKey(apiKey)
      : apiKey;

    setTestResults((prev) => ({ ...prev, [keyId]: { status: 'loading' } }));

    const result = await testApiKey(selectedProvider.baseUrl, decrypted, selectedProvider.apiType || 'openai');
    setTestResults((prev) => ({ ...prev, [keyId]: result }));

    // 如果测试成功且有模型数据，保存到 store
    if (result.status === 'success' && result.models && result.models.length > 0) {
      updateKeyModels(keyId, result.models);
    }
  };

  const isKeyCopied = (id: string) =>
    copiedItem?.type === 'key' && copiedItem.id === id;
  const isUrlCopied = selectedProvider && copiedItem?.type === 'url' && copiedItem.id === selectedProvider.id;

  // 监听密钥解密事件
  useEffect(() => {
    const handleKeyDecrypted = (e: CustomEvent<{ id: string; decrypted: string }>) => {
      setDecryptedKeys((prev) => ({ ...prev, [e.detail.id]: e.detail.decrypted }));
    };

    window.addEventListener('key-decrypted', handleKeyDecrypted as EventListener);
    return () => {
      window.removeEventListener('key-decrypted', handleKeyDecrypted as EventListener);
    };
  }, []);

  // 监听编辑模态框状态，当关闭时清除解密缓存（密钥可能已修改）
  const prevIsOpen = useRef(isAddKeyModalOpen);
  useEffect(() => {
    if (prevIsOpen.current && !isAddKeyModalOpen) {
      // 模态框刚关闭，清除所有解密缓存
      setDecryptedKeys({});
    }
    prevIsOpen.current = isAddKeyModalOpen;
  }, [isAddKeyModalOpen]);

  if (!selectedProvider) {
    return <ProviderEmptyState />;
  }

  return (
    <main className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 bg-white/50 backdrop-blur-md border-b border-primary-100/50">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <h2 className="text-xl font-bold text-slate-800 truncate">
              {selectedProvider.name}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-slate-500 truncate">{selectedProvider.baseUrl}</p>
              <button
                onClick={() => handleCopyUrl(selectedProvider.baseUrl)}
                className={cn(
                  'p-1 rounded transition-all duration-200',
                  'text-slate-400 hover:text-primary-600 hover:bg-primary-50',
                  isUrlCopied && 'text-emerald-600 bg-emerald-50'
                )}
              >
                {isUrlCopied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <button
            onClick={() => setAddKeyModalOpen(true)}
            className="btn-primary flex items-center gap-1.5 py-2 px-3"
          >
            <Plus className="w-3.5 h-3.5" />
            {t('mainContent.addKey')}
          </button>
        </div>

        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-slate-500">{t('mainContent.totalKeys')}:</span>
            <span className="font-semibold text-sm text-slate-800">
              {selectedProvider.keys.length}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-valid" />
            <span className="text-xs text-slate-600">{t('mainContent.valid')}: {selectedProvider.validCount}</span>
          </div>
          {selectedProvider.expiredCount > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="status-dot status-dot-expired" />
              <span className="text-xs text-slate-600">{t('mainContent.expired')}: {selectedProvider.expiredCount}</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {selectedProvider.keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400">
            <p className="text-sm mb-1">{t('mainContent.noKeys')}</p>
            <p className="text-xs">{t('mainContent.noKeysHint')}</p>
          </div>
        ) : (
          <div className="grid gap-3">
            {selectedProvider.keys.map((key) => (
              <KeyCard
                key={key.id}
                apiKey={key}
                onCopy={() => handleCopy(key.key, key.id)}
                isCopied={isKeyCopied(key.id)}
                onTest={() => handleTest(key.key, key.id)}
                onView={() => handleViewKey(key.key, key.id)}
                onEdit={() => handleEditKey(key.id)}
                onDelete={() => handleDeleteKey(key.id)}
                onShowModels={() => setModelsModalOpen(true, key.id)}
                testResult={testResults[key.id]}
                decryptedKey={decryptedKeys[key.id]}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

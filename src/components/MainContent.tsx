import { useStore } from '@/store';
import { Plus, Copy, Check, Eye, EyeOff, Trash2, Edit, Loader2, CheckCircle, XCircle, Rocket, Lock, X, List } from 'lucide-react';
import EmptyState from './EmptyState';
import { ModelsModal } from './ModelsModal';
import { cn } from '@/utils/cn';
import { copyToClipboard } from '@/utils/helpers';
import { testApiKey, ApiTestResult } from '@/utils/api-test';
import { decryptApiKey, isEncrypted, setupPassword, hasPassword, verifyPassword, changePassword } from '@/utils/secure-storage';
import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function MainContent() {
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
    }
  };

  const handleCopyUrl = async (url: string) => {
    const success = await copyToClipboard(url);
    if (success && selectedProvider) {
      setCopiedItem({ type: 'url', id: selectedProvider.id });
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
    setDecryptedKeys(prev => ({ ...prev, [id]: decrypted }));
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

    setTestResults(prev => ({ ...prev, [keyId]: { status: 'loading' } }));

    const result = await testApiKey(selectedProvider.baseUrl, decrypted, selectedProvider.apiType || 'openai');
    setTestResults(prev => ({ ...prev, [keyId]: result }));

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
      setDecryptedKeys(prev => ({ ...prev, [e.detail.id]: e.detail.decrypted }));
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
    return (
      <>
        <EmptyState />
        <AuthModal />
        <PasswordSetupModal />
        <SettingsModal />
        <ModelsModal />
      </>
    );
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

      <AuthModal />
      <PasswordSetupModal />
      <SettingsModal />
      <ModelsModal />
    </main>
  );
}

interface KeyCardProps {
  apiKey: {
    id: string;
    key: string;
    name?: string;
    note?: string;
    expiresAt?: Date;
    status: 'valid' | 'expired' | 'expiring-soon';
    daysUntilExpiry?: number;
    models?: { id: string; name: string }[];
  };
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

function KeyCard({ apiKey, onCopy, onTest, onView, onEdit, onDelete, onShowModels, isCopied, testResult, decryptedKey }: KeyCardProps) {
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

// 认证模态框（密码验证）
function AuthModal() {
  const { t } = useTranslation();
  const {
    isAuthModalOpen,
    setAuthModalOpen,
    setPasswordSetupOpen,
    authAction,
    pendingAuthKeyId,
    setLastAuthTime,
    getKeyById,
    setCopiedItem,
    setEditKeyId,
    setDeleteTarget,
    setDeleteConfirmOpen,
  } = useStore();

  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasPwd, setHasPwd] = useState(false);

  useEffect(() => {
    const checkPassword = async () => {
      const has = await hasPassword();
      setHasPwd(has);
    };
    if (isAuthModalOpen) {
      checkPassword();
    }
  }, [isAuthModalOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!password) {
      setError(t('auth.passwordRequired'));
      return;
    }

    setLoading(true);
    try {
      const isValid = await verifyPassword(password);
      if (isValid) {
        // 更新最后认证时间
        setLastAuthTime(Date.now());

        // 根据认证类型执行相应操作
        if (pendingAuthKeyId) {
          const key = getKeyById(pendingAuthKeyId);
          if (key) {
            if (authAction === 'copy') {
              const decrypted = await decryptApiKey(key.key);
              const success = await copyToClipboard(decrypted);
              if (success) {
                setCopiedItem({ type: 'key', id: pendingAuthKeyId });
              }
            } else if (authAction === 'view') {
              const decrypted = await decryptApiKey(key.key);
              // 使用自定义事件来通知父组件
              window.dispatchEvent(new CustomEvent('key-decrypted', { detail: { id: pendingAuthKeyId, decrypted } }));
            } else if (authAction === 'edit') {
              setEditKeyId(pendingAuthKeyId);
            } else if (authAction === 'delete') {
              setDeleteTarget({ type: 'key', id: pendingAuthKeyId });
              setDeleteConfirmOpen(true);
            }
          }
        }

        setPassword('');
        setAuthModalOpen(false);
      } else {
        setError(t('auth.invalidPassword'));
      }
    } catch (err) {
      setError(t('auth.error'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setPassword('');
    setAuthModalOpen(false);
  };

  const handleSetupPassword = () => {
    setAuthModalOpen(false);
    setPasswordSetupOpen(true);
  };

  if (!isAuthModalOpen) return null;

  // 如果没有设置密码，显示设置密码提示
  if (!hasPwd) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={handleClose} />
        <div className="relative w-full max-w-sm mx-4 animate-scale-in">
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lock className="w-5 h-5 text-primary-600" />
                <h3 className="text-lg font-bold text-slate-800">{t('auth.authorizationRequired') || '需要授权'}</h3>
              </div>
              <button onClick={handleClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-sm text-slate-600 mb-4 text-center">
              需要设置密码后才能进行此操作
            </p>

            <button
              onClick={handleSetupPassword}
              className="btn-primary w-full py-3 flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              去设置密码
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 已设置密码，显示密码输入框
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={handleClose} />
      <div className="relative w-full max-w-sm mx-4 animate-scale-in">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-bold text-slate-800">{t('auth.authorizationRequired') || '需要授权'}</h3>
            </div>
            <button onClick={handleClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-slate-600 mb-4">
            {authAction === 'view' && (t('auth.enterPasswordToView') || '请输入密码以查看密钥')}
            {authAction === 'copy' && (t('auth.enterPasswordToCopy') || '请输入密码以复制密钥')}
            {authAction === 'edit' && (t('auth.enterPasswordToEdit') || '请输入密码以编辑密钥')}
            {authAction === 'delete' && (t('auth.enterPasswordToDelete') || '请输入密码以删除密钥')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('auth.enterPassword') || '请输入密码'}
              className="input"
              autoFocus
            />
            <div className="min-h-[40px]">
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={handleClose} className="btn-secondary flex-1 py-2.5">{t('common.cancel')}</button>
              <button type="submit" disabled={loading || !password} className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (t('common.confirm') || '确认')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// 密码设置模态框
function PasswordSetupModal() {
  const { t } = useTranslation();
  const {
    isPasswordSetupOpen,
    setPasswordSetupOpen,
  } = useStore();

  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingPassword, setExistingPassword] = useState(false);

  useEffect(() => {
    const checkPassword = async () => {
      const has = await hasPassword();
      setExistingPassword(has);
    };
    if (isPasswordSetupOpen) {
      checkPassword();
    }
  }, [isPasswordSetupOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (existingPassword && !oldPassword) {
      setError(t('auth.oldPasswordRequired'));
      return;
    }

    if (password.length < 6) {
      setError(t('auth.passwordTooShort'));
      return;
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch'));
      return;
    }

    setLoading(true);
    try {
      if (existingPassword) {
        // 修改密码：需要验证原密码
        await changePassword(oldPassword, password);
      } else {
        // 首次设置密码
        await setupPassword(password);
      }
      setPasswordSetupOpen(false);
      setOldPassword('');
      setPassword('');
      setConfirmPassword('');
      setHint('');
    } catch (err) {
      setError(existingPassword ? t('auth.changePasswordFailed') : t('auth.setupPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError('');
    setOldPassword('');
    setPassword('');
    setConfirmPassword('');
    setHint('');
    setPasswordSetupOpen(false);
  };

  if (!isPasswordSetupOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={handleClose} />
      <div className="relative w-full max-w-sm mx-4 animate-scale-in">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-bold text-slate-800">
                {existingPassword ? (t('auth.changePassword') || '修改密码') : (t('auth.setupPassword') || '设置密码')}
              </h3>
            </div>
            <button onClick={handleClose} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <p className="text-sm text-slate-600 mb-4">
            {existingPassword
              ? (t('auth.enterOldAndNewPassword') || '请输入原密码和新密码')
              : (t('auth.setupPasswordHint') || '设置密码后，所有敏感操作都需要密码验证')}
          </p>

          {/* 警告提示 */}
          {!existingPassword && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-amber-800">
                  {t('auth.passwordWarning') || '重要提示：由于是单机程序，如果忘记密码，您将无法从本应用中查看已保存的 API Key。请妥善保管您的密码。'}
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {existingPassword && (
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                placeholder={t('auth.oldPassword') || '原密码'}
                className="input"
                autoFocus
              />
            )}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={existingPassword ? (t('auth.newPassword') || '新密码') : (t('auth.password') || '密码')}
              className="input"
              autoFocus={!existingPassword}
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder={t('auth.confirmPassword') || '确认密码'}
              className="input"
            />
            <input
              type="text"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder={t('auth.passwordHint') || '密码提示词（可选）'}
              className="input"
            />
            <div className="min-h-[40px]">
              {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
            </div>
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={handleClose} className="btn-secondary flex-1 py-2.5">{t('common.cancel')}</button>
              <button type="submit" disabled={loading || !password || !confirmPassword || (existingPassword && !oldPassword)} className="btn-primary flex-1 py-2.5 flex items-center justify-center gap-2">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (t('common.save') || '保存')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// 设置模态框
function SettingsModal() {
  const { t } = useTranslation();
  const {
    isSettingsOpen,
    setSettingsOpen,
    setPasswordSetupOpen,
  } = useStore();
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleExport = async () => {
    try {
      const { exportData } = await import('@/utils/import-export');
      await exportData();
      setImportMessage({ type: 'success', text: t('settings.exportSuccess') || '导出成功' });
      setTimeout(() => setImportMessage(null), 3000);
    } catch (error) {
      setImportMessage({ type: 'error', text: String(error) });
      setTimeout(() => setImportMessage(null), 3000);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { importData } = await import('@/utils/import-export');
      await importData(file);

      setImportMessage({ type: 'success', text: t('settings.importSuccess') || '导入成功' });
      setTimeout(() => setImportMessage(null), 3000);
    } catch (error) {
      setImportMessage({ type: 'error', text: t('settings.importError') || '导入失败' });
      setTimeout(() => setImportMessage(null), 3000);
    }

    // 重置文件输入
    e.target.value = '';
  };

  if (!isSettingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={() => setSettingsOpen(false)} />
      <div className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary-600" />
              <h3 className="text-lg font-bold text-slate-800">{t('settings.title') || '安全设置'}</h3>
            </div>
            <button onClick={() => setSettingsOpen(false)} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-4">
            {/* 密码保护 */}
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-sm font-medium text-slate-800 mb-1">{t('settings.passwordProtection') || '密码保护'}</p>
              <p className="text-xs text-slate-500">{t('settings.passwordProtectionDesc') || '设置密码后，所有敏感操作（查看、复制、编辑、删除密钥）都需要密码验证。密码在 10 分钟内只需输入一次。'}</p>
            </div>

            <button onClick={() => { setSettingsOpen(false); setPasswordSetupOpen(true); }} className="w-full p-3 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors">
              <p className="text-sm font-medium text-slate-800">{t('settings.changePassword') || '设置/修改密码'}</p>
              <p className="text-xs text-slate-500 mt-0.5">{t('settings.changePasswordDesc') || '设置或修改您的密码'}</p>
            </button>

            {/* 数据管理 */}
            <div className="border-t border-slate-100 pt-4 mt-4">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                <p className="text-sm font-medium text-slate-800">{t('settings.dataManagement') || '数据管理'}</p>
              </div>
              <p className="text-xs text-slate-500 mb-3 ml-7">{t('settings.dataManagementDesc') || '导出或导入您的提供方和 API 密钥'}</p>

              <div className="flex gap-2 ml-7">
                <button onClick={handleExport} className="flex-1 p-3 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{t('settings.exportData') || '导出数据'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t('settings.exportDataDesc') || '下载为 JSON 文件'}</p>
                    </div>
                  </div>
                </button>

                <label className="flex-1 p-3 bg-slate-50 rounded-lg text-left hover:bg-slate-100 transition-colors cursor-pointer">
                  <input type="file" accept=".json" onChange={handleImport} className="hidden" />
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-slate-800">{t('settings.importData') || '导入数据'}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t('settings.importDataDesc') || '从 JSON 文件恢复'}</p>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* 导入导出消息 */}
            {importMessage && (
              <div className={`ml-7 p-3 rounded-lg text-sm ${importMessage.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {importMessage.text}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

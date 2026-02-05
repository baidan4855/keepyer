import { Loader2, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { copyToClipboard } from '@/shared/lib/helpers';
import { decryptApiKey, hasPassword, verifyPassword } from '@/domains/settings/lib/secure-storage';
import { toast } from '@/shared/lib/toast';

export default function AuthModal() {
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
                toast.success(t('notifications.copySuccess') || '复制成功');
              } else {
                toast.error(t('notifications.copyFailed') || '复制失败');
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

import { Loader2, Lock, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { changePassword, hasPassword, setupPassword } from '@/domains/settings/lib/secure-storage';
import { toast } from '@/shared/lib/toast';

export default function PasswordSetupModal() {
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
      toast.success(
        existingPassword
          ? (t('notifications.passwordChangeSuccess') || '密码修改成功')
          : (t('notifications.passwordSetupSuccess') || '密码设置成功')
      );
      setPasswordSetupOpen(false);
      setOldPassword('');
      setPassword('');
      setConfirmPassword('');
      setHint('');
    } catch (err) {
      const message = existingPassword ? t('auth.changePasswordFailed') : t('auth.setupPasswordFailed');
      setError(message);
      toast.error(message || (t('notifications.saveFailed') || '保存失败'));
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

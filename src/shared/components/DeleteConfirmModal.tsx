import { useStore } from '@/store';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function DeleteConfirmModal() {
  const { t } = useTranslation();
  const { isDeleteConfirmOpen, setDeleteConfirmOpen, deleteTarget, deleteProvider, deleteKey, providers, apiKeys } = useStore();

  const handleConfirm = () => {
    if (!deleteTarget) return;

    if (deleteTarget.type === 'provider') {
      deleteProvider(deleteTarget.id);
    } else {
      deleteKey(deleteTarget.id);
    }

    setDeleteConfirmOpen(false);
  };

  const getTargetName = () => {
    if (!deleteTarget) return '';

    if (deleteTarget.type === 'provider') {
      const provider = providers.find(p => p.id === deleteTarget.id);
      return provider?.name || '';
    } else {
      const key = apiKeys.find(k => k.id === deleteTarget.id);
      return key?.name || key?.key?.substring(0, 8) + '...' || '';
    }
  };

  const getMessage = () => {
    if (deleteTarget?.type === 'provider') {
      return t('modals.deleteConfirm.providerWarning');
    }
    return t('modals.deleteConfirm.keyWarning');
  };

  if (!isDeleteConfirmOpen || !deleteTarget) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in"
        onClick={() => setDeleteConfirmOpen(false)}
      />

      {/* 模态框 */}
      <div className="relative w-full max-w-md mx-4 animate-scale-in">
        <div className="card p-5">
          {/* 图标和标题 */}
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-red-600" />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-bold text-slate-800 mb-1">
                {t('modals.deleteConfirm.title')}
              </h2>
              <p className="text-xs text-slate-500">
                {deleteTarget.type === 'provider' ? t('modals.deleteConfirm.provider') : t('modals.deleteConfirm.apiKey')}: <span className="font-medium text-slate-700">{getTargetName()}</span>
              </p>
            </div>
          </div>

          {/* 警告信息 */}
          <p className="text-xs text-slate-600 mb-5">
            {getMessage()}
          </p>

          {/* 按钮 */}
          <div className="flex gap-2">
            <button
              onClick={() => setDeleteConfirmOpen(false)}
              className="btn-secondary flex-1 py-2.5"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={handleConfirm}
              className="btn-danger flex-1 py-2.5"
            >
              {t('modals.deleteConfirm.confirm')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

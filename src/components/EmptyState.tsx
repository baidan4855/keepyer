import { Plus, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';

export default function EmptyState() {
  const { t } = useTranslation();
  const { setAddProviderModalOpen, setSettingsOpen } = useStore();

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <div className="card w-full max-w-md p-6 sm:p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 flex items-center justify-center shadow-soft">
          <img
            src="/icon.svg"
            alt="Keeyper"
            className="w-9 h-9"
            draggable={false}
          />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2 text-balance">
          {t('emptyState.title')}
        </h2>
        <p className="text-sm text-slate-500 mb-5 text-balance">
          {t('emptyState.subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 mb-3">
          <button
            onClick={() => setAddProviderModalOpen(true)}
            className="btn-primary w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5"
          >
            <Plus className="w-4 h-4" />
            {t('sidebar.addProvider')}
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="btn-secondary w-full sm:w-auto flex items-center justify-center gap-1.5 px-4 py-2.5"
          >
            <Upload className="w-4 h-4" />
            {t('settings.importData')}
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-6 text-balance">
          {t('settings.importDataDesc')}
        </p>

        <div className="flex items-center justify-center gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-valid" />
            <span>{t('emptyState.validKey')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-warning" />
            <span>{t('emptyState.expiringSoon')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="status-dot status-dot-expired" />
            <span>{t('emptyState.expired')}</span>
          </div>
        </div>
      </div>
    </main>
  );
}

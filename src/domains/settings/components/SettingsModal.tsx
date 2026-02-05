import { Lock, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { exportData, importData } from '@/domains/settings/lib/import-export';
import { toast } from '@/shared/lib/toast';

export default function SettingsModal() {
  const { t } = useTranslation();
  const {
    isSettingsOpen,
    setSettingsOpen,
    setPasswordSetupOpen,
  } = useStore();
  const handleExport = async () => {
    try {
      await exportData();
      toast.success(t('settings.exportSuccess') || '导出成功');
    } catch (error) {
      toast.error(t('settings.exportError') || '导出失败');
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await importData(file);

      toast.success(t('settings.importSuccess') || '导入成功');
    } catch (error) {
      const message = error instanceof Error && error.message === 'invalidFile'
        ? (t('settings.invalidFile') || '文件格式无效')
        : (t('settings.importError') || '导入失败');
      toast.error(message);
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

          </div>
        </div>
      </div>
    </div>
  );
}

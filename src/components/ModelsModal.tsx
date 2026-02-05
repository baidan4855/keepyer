/**
 * 模型列表模态窗口
 * 简洁美观的设计，与主视觉风格一致
 */

import { useTranslation } from 'react-i18next';
import { useStore } from '@/store';
import { X } from 'lucide-react';

// 格式化 token 数量为可读格式
function formatTokens(tokens?: number): string {
  if (tokens === undefined || tokens === null) return '-';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K`;
  return tokens.toString();
}

// 格式化数组为 " | " 分隔的字符串
function joinArray(arr?: string[]): string {
  if (!arr || arr.length === 0) return '-';
  return arr.join(' | ');
}

export function ModelsModal() {
  const { t } = useTranslation();
  const { isModelsModalOpen, modelsModalKeyId, getKeyById, setModelsModalOpen } = useStore();

  const key = modelsModalKeyId ? getKeyById(modelsModalKeyId) : null;
  const models = key?.models || [];

  const handleClose = () => {
    setModelsModalOpen(false, null);
  };

  if (!isModelsModalOpen || !key) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* 背景遮罩 */}
      <div
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-sm animate-fade-in"
        onClick={handleClose}
      />

      {/* 模态窗口 */}
      <div className="relative w-full max-w-4xl animate-scale-in">
        <div className="card overflow-hidden">
          {/* 标题栏 */}
          <div className="px-6 py-4 border-b border-primary-100/50">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  {key.name || t('keys.unnamedKey')}
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  {models.length} {models.length === 1 ? 'model' : 'models'} available
                </p>
              </div>
              <button
                onClick={handleClose}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all duration-200 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* 模型列表 */}
          <div className="max-h-[60vh] overflow-y-auto bg-slate-50/30">
            {models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20">
                <p className="text-sm text-slate-600">
                  {t('keys.noModels') || 'No models data'}
                </p>
                <p className="text-xs text-slate-400 mt-2">
                  Test your API key to fetch models
                </p>
              </div>
            ) : (
              <div className="p-4 space-y-3">
                {models.map((model, index) => (
                  <div
                    key={model.id || index}
                    className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-primary-200 transition-all duration-200"
                  >
                    <div className="p-5">
                      {/* 模型名称 + ID */}
                      <div className="mb-4">
                        <h4 className="font-mono text-base font-semibold text-slate-800 mb-1">
                          {model.name}
                        </h4>
                        <p className="font-mono text-xs text-slate-400">
                          {model.id}
                        </p>
                      </div>

                      {/* 基本信息区域 */}
                      <div className="mb-4">
                        <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                          {/* owned_by */}
                          {model.owned_by && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelProvider')}</span>
                              <span className="text-slate-700">{model.owned_by}</span>
                            </div>
                          )}

                          {/* domain */}
                          {model.domain && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelDomain')}</span>
                              <span className="badge bg-blue-100 text-blue-700 border-blue-200 text-xs">
                                {model.domain}
                              </span>
                            </div>
                          )}

                          {/* version */}
                          {model.version && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelVersion')}</span>
                              <span className="text-slate-700">{model.version}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 任务类型和模态 */}
                      <div className="mb-4">
                        <div className="grid grid-cols-1 gap-2 text-sm">
                          {/* task_type */}
                          {model.task_type && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelTaskType')}</span>
                              <span className="text-slate-700" title={Array.isArray(model.task_type) ? model.task_type.join(' | ') : model.task_type}>
                                {joinArray(Array.isArray(model.task_type) ? model.task_type : [model.task_type])}
                              </span>
                            </div>
                          )}

                          {/* input_modalities */}
                          {model.input_modalities && model.input_modalities.length > 0 && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelInput')}</span>
                              <span className="text-slate-700" title={model.input_modalities.join(' | ')}>
                                {joinArray(model.input_modalities)}
                              </span>
                            </div>
                          )}

                          {/* output_modalities */}
                          {model.output_modalities && model.output_modalities.length > 0 && (
                            <div>
                              <span className="text-xs text-slate-500 mr-2">{t('keys.modelOutput')}</span>
                              <span className="text-slate-700" title={model.output_modalities.join(' | ')}>
                                {joinArray(model.output_modalities)}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Token Limits */}
                      {model.token_limits && (
                        <div className="pt-4 border-t border-slate-100">
                          <div className="text-xs text-slate-500 mb-3 uppercase tracking-wide font-medium">{t('keys.modelTokenLimits')}</div>
                          <div className="grid grid-cols-4 gap-3">
                            {model.token_limits.context_window !== undefined && (
                              <div className="text-center p-3 bg-primary-50/50 rounded-lg border border-primary-100/50">
                                <div className="text-xs text-slate-500 mb-1">{t('keys.modelContextWindow')}</div>
                                <div className="text-base font-semibold text-primary-700">{formatTokens(model.token_limits.context_window)}</div>
                              </div>
                            )}
                            {model.token_limits.max_input_token_length !== undefined && (
                              <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                                <div className="text-xs text-slate-500 mb-1">{t('keys.modelMaxInput')}</div>
                                <div className="text-sm font-medium text-slate-700">{formatTokens(model.token_limits.max_input_token_length)}</div>
                              </div>
                            )}
                            {model.token_limits.max_output_token_length !== undefined && (
                              <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                                <div className="text-xs text-slate-500 mb-1">{t('keys.modelMaxOutput')}</div>
                                <div className="text-sm font-medium text-slate-700">{formatTokens(model.token_limits.max_output_token_length)}</div>
                              </div>
                            )}
                            {model.token_limits.max_reasoning_token_length !== undefined && (
                              <div className="text-center p-3 bg-slate-50 rounded-lg border border-slate-200">
                                <div className="text-xs text-slate-500 mb-1">{t('keys.modelMaxReasoning')}</div>
                                <div className="text-sm font-medium text-slate-700">{formatTokens(model.token_limits.max_reasoning_token_length)}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 底部信息 */}
          {key.modelsUpdatedAt && (
            <div className="px-6 py-3 bg-slate-50/50 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">{t('keys.lastUpdated')}</span>
                <span className="font-medium text-slate-700">
                  {new Date(key.modelsUpdatedAt).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

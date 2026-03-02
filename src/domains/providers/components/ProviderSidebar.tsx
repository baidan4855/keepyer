import { useStore } from "@/store";
import { Bot, Plus, Server, Trash2, Settings, Edit3 } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { useTranslation } from "react-i18next";
import LanguageSwitcher from "@/shared/components/LanguageSwitcher";

export default function ProviderSidebar() {
  const { t } = useTranslation();
  const {
    getProvidersWithKeys,
    activePage,
    setActivePage,
    selectedProviderId,
    setSelectedProviderId,
    setAddProviderModalOpen,
    setEditProviderId,
    setDeleteConfirmOpen,
    setDeleteTarget,
    setSettingsOpen,
  } = useStore();

  const providers = getProvidersWithKeys();

  return (
    <aside className="w-64 flex flex-col bg-white/50 backdrop-blur-md border-r border-primary-100/50">
      {/* 标题区域 */}
      <div className="p-4 border-b border-primary-100/50">
        <div className="flex items-center gap-2 mb-4">
          <img
            src="/icon.svg"
            alt="Keeyper"
            className="w-8 h-8 rounded-xl shadow-lg shadow-primary-500/30"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <h1 className="text-lg font-bold text-slate-800 truncate">
                {t("app.name")}
              </h1>
              <span className="text-xs text-slate-400 font-normal">v2.0.0</span>
            </div>
            <p className="text-[11px] text-slate-500 truncate">
              {t("app.description")}
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setActivePage("providers");
              setEditProviderId(null);
              setAddProviderModalOpen(true);
            }}
            className="btn-primary flex-1 flex items-center justify-center gap-1.5 py-2"
          >
            <Plus className="w-3.5 h-3.5" />
            {t("sidebar.addProvider")}
          </button>
        </div>
      </div>

      {/* 提供方列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        <button
          onClick={() => setActivePage("gateway")}
          className={cn(
            "w-full group relative p-3 rounded-lg transition-all duration-200 text-left",
            "hover:bg-white/80",
            activePage === "gateway"
              ? "bg-white shadow-soft ring-2 ring-primary-500/20"
              : "bg-white/40",
          )}
        >
          <div className="flex items-center gap-2">
            <Bot
              className={cn(
                "w-4 h-4",
                activePage === "gateway"
                  ? "text-primary-600"
                  : "text-slate-500",
              )}
            />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm text-slate-800 truncate">
                {t("sidebar.gateway") || "网关"}
              </h3>
              <p className="text-xs text-slate-500 truncate">
                {t("sidebar.gatewayHint") || "Claude / OpenAI Proxy"}
              </p>
            </div>
          </div>
        </button>

        {providers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 text-slate-400">
            <Server className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-xs">{t("sidebar.noProviders")}</p>
            <p className="text-xs mt-0.5">{t("sidebar.noProvidersHint")}</p>
          </div>
        ) : (
          providers.map((provider) => (
            <div
              key={provider.id}
              className={cn(
                "group relative p-3 rounded-lg cursor-pointer transition-all duration-200",
                "hover:bg-white/80",
                selectedProviderId === provider.id
                  ? "bg-white shadow-soft ring-2 ring-primary-500/20"
                  : "bg-white/40",
              )}
              onClick={() => {
                setActivePage("providers");
                setSelectedProviderId(provider.id);
              }}
            >
              {/* 提供方名称和图标 */}
              <div className="flex items-start justify-between gap-2 pr-8">
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-slate-800 truncate">
                    {provider.name}
                  </h3>
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {provider.baseUrl}
                  </p>
                </div>
              </div>

              {/* 状态统计（绿/红） */}
              <div className="flex items-center gap-4 mt-2">
                <div className="flex items-center gap-1">
                  <span className="status-dot status-dot-valid" />
                  <span className="text-xs text-slate-600">
                    {provider.validCount}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="status-dot status-dot-expired" />
                  <span className="text-xs text-slate-400">
                    {provider.expiredCount}
                  </span>
                </div>
              </div>

              {/* 编辑/删除按钮 */}
              <div
                className={cn(
                  "absolute top-2 right-2 flex items-center gap-0.5",
                  "opacity-0 group-hover:opacity-100",
                  "transition-all duration-200",
                )}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditProviderId(provider.id);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-all duration-200"
                  title={t("common.edit")}
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget({ type: "provider", id: provider.id });
                    setDeleteConfirmOpen(true);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
                  title={t("common.delete")}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 底部信息 */}
      <div className="p-3 border-t border-primary-100/50 flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {t("sidebar.totalProviders", { count: providers.length })}
        </p>
        <div className="flex items-center gap-1">
          <LanguageSwitcher />
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg text-slate-400 hover:text-primary-600 hover:bg-primary-50 transition-all"
            title={t("settings.title") || "设置"}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

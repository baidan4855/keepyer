import { useEffect } from 'react';
import { useStore } from '@/store';
import ProviderSidebar from '@/domains/providers/components/ProviderSidebar';
import ProviderDashboard from '@/domains/providers/components/ProviderDashboard';
import AddProviderModal from '@/domains/providers/components/AddProviderModal';
import AddKeyModal from '@/domains/keys/components/AddKeyModal';
import ModelsModal from '@/domains/keys/components/ModelsModal';
import SettingsModal from '@/domains/settings/components/SettingsModal';
import AuthModal from '@/domains/settings/components/AuthModal';
import PasswordSetupModal from '@/domains/settings/components/PasswordSetupModal';
import DeleteConfirmModal from '@/shared/components/DeleteConfirmModal';
import ToastHost from '@/shared/components/ToastHost';

function App() {
  const { copiedItem, setCopiedItem } = useStore();

  // 清除复制状态
  useEffect(() => {
    if (copiedItem) {
      const timer = setTimeout(() => setCopiedItem(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedItem, setCopiedItem]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <ProviderSidebar />

      {/* 主内容区 */}
      <ProviderDashboard />

      {/* 模态框 */}
      <AddProviderModal />
      <AddKeyModal />
      <ModelsModal />
      <AuthModal />
      <PasswordSetupModal />
      <SettingsModal />
      <DeleteConfirmModal />
      <ToastHost />
    </div>
  );
}

export default App;

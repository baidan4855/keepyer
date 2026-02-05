import { useStore } from './store';
import Sidebar from './components/Sidebar';
import MainContent from './components/MainContent';
import AddProviderModal from './components/AddProviderModal';
import AddKeyModal from './components/AddKeyModal';
import DeleteConfirmModal from './components/DeleteConfirmModal';
import { useEffect } from 'react';

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
      <Sidebar />

      {/* 主内容区 */}
      <MainContent />

      {/* 模态框 */}
      <AddProviderModal />
      <AddKeyModal />
      <DeleteConfirmModal />
    </div>
  );
}

export default App;

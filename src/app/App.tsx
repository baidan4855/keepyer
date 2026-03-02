import { useEffect } from 'react';
import { useStore } from '@/store';
import ProviderSidebar from '@/domains/providers/components/ProviderSidebar';
import ProviderDashboard from '@/domains/providers/components/ProviderDashboard';
import GatewayDashboard from '@/domains/gateway/components/GatewayDashboard';
import AddProviderModal from '@/domains/providers/components/AddProviderModal';
import AddKeyModal from '@/domains/keys/components/AddKeyModal';
import ModelsModal from '@/domains/keys/components/ModelsModal';
import DebugChatModal from '@/domains/chat/components/DebugChatModal';
import SettingsModal from '@/domains/settings/components/SettingsModal';
import AuthModal from '@/domains/settings/components/AuthModal';
import PasswordSetupModal from '@/domains/settings/components/PasswordSetupModal';
import DeleteConfirmModal from '@/shared/components/DeleteConfirmModal';
import ToastHost from '@/shared/components/ToastHost';

const AUTO_CAP_SELECTOR = 'input, textarea, [contenteditable="true"]';

function normalizeInputTypingBehavior(element: Element | null): void {
  if (!(element instanceof HTMLElement)) return;

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    element.autocapitalize = 'none';
    element.setAttribute('autocorrect', 'off');
    element.spellcheck = false;
    return;
  }

  if (element.isContentEditable) {
    element.setAttribute('autocapitalize', 'none');
    element.setAttribute('autocorrect', 'off');
    element.setAttribute('spellcheck', 'false');
  }
}

function normalizeNodeAndDescendants(node: Node): void {
  if (!(node instanceof Element)) return;
  normalizeInputTypingBehavior(node);
  node.querySelectorAll(AUTO_CAP_SELECTOR).forEach((element) => normalizeInputTypingBehavior(element));
}

function App() {
  const { copiedItem, setCopiedItem, activePage } = useStore();

  // 清除复制状态
  useEffect(() => {
    if (copiedItem) {
      const timer = setTimeout(() => setCopiedItem(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [copiedItem, setCopiedItem]);

  useEffect(() => {
    document.querySelectorAll(AUTO_CAP_SELECTOR).forEach((element) => normalizeInputTypingBehavior(element));

    const handleFocusIn = (event: FocusEvent) => {
      normalizeInputTypingBehavior(event.target as Element | null);
    };
    document.addEventListener('focusin', handleFocusIn);

    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => normalizeNodeAndDescendants(node));
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      observer.disconnect();
    };
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* 侧边栏 */}
      <ProviderSidebar />

      {/* 主内容区 */}
      {activePage === 'gateway' ? <GatewayDashboard /> : <ProviderDashboard />}

      {/* 模态框 */}
      <AddProviderModal />
      <AddKeyModal />
      <ModelsModal />
      <DebugChatModal />
      <AuthModal />
      <PasswordSetupModal />
      <SettingsModal />
      <DeleteConfirmModal />
      <ToastHost />
    </div>
  );
}

export default App;

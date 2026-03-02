import { useEffect, useRef } from 'react';
import { useStore } from '@/store';
import ProviderSidebar from '@/domains/providers/components/ProviderSidebar';
import ProviderDashboard from '@/domains/providers/components/ProviderDashboard';
import GatewayDashboard from '@/domains/gateway/components/GatewayDashboard';
import { getGatewayProcessStatus } from '@/domains/gateway/lib/gateway-runtime';
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
  const {
    copiedItem,
    setCopiedItem,
    activePage,
    gatewayConfig,
    recordModelTokenUsage,
  } = useStore();
  const lastGatewayStartedAtRef = useRef<number | null>(null);
  const lastGatewayUsageEventIdRef = useRef(0);

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

  useEffect(() => {
    let disposed = false;

    const syncGatewayUsage = async () => {
      try {
        const status = await getGatewayProcessStatus();
        if (disposed) return;

        const startedAt = typeof status.startedAt === 'number' ? status.startedAt : null;
        if (startedAt !== lastGatewayStartedAtRef.current) {
          lastGatewayStartedAtRef.current = startedAt;
          lastGatewayUsageEventIdRef.current = 0;
        }

        const events = Array.isArray(status.usageEvents) ? [...status.usageEvents] : [];
        if (!events.length) return;

        events.sort((a, b) => a.id - b.id);
        let nextLastId = lastGatewayUsageEventIdRef.current;

        events.forEach((event) => {
          if (!event || typeof event.id !== 'number' || event.id <= nextLastId) {
            return;
          }

          let providerId = typeof event.providerId === 'string' ? event.providerId.trim() : '';
          let keyId = typeof event.keyId === 'string' ? event.keyId.trim() : '';
          let modelId = typeof event.modelId === 'string' ? event.modelId.trim() : '';
          const sourceModel = typeof event.sourceModel === 'string' ? event.sourceModel.trim() : '';
          const targetModel = typeof event.targetModel === 'string' ? event.targetModel.trim() : '';

          if (!providerId || !keyId || !modelId) {
            const fallbackMapping = (sourceModel && gatewayConfig.modelMappings[sourceModel])
              || gatewayConfig.modelMappings['*'];
            if (fallbackMapping) {
              providerId = providerId || fallbackMapping.providerId;
              keyId = keyId || fallbackMapping.keyId;
              modelId = modelId || fallbackMapping.targetModel?.trim() || targetModel || sourceModel;
            }
          }

          if (providerId && keyId && modelId) {
            recordModelTokenUsage(providerId, keyId, modelId, {
              input_tokens: Math.max(0, Math.floor(event.inputTokens || 0)),
              output_tokens: Math.max(0, Math.floor(event.outputTokens || 0)),
              total_tokens: Math.max(0, Math.floor(event.totalTokens || 0)),
              request_count: Math.max(1, Math.floor(event.requestCount || 1)),
              usage_source: 'gateway_proxy',
            });
          }

          nextLastId = Math.max(nextLastId, event.id);
        });

        lastGatewayUsageEventIdRef.current = nextLastId;
      } catch (_error) {
        // 网关未启动或状态读取失败时静默忽略，等待下一轮轮询
      }
    };

    void syncGatewayUsage();
    const timer = window.setInterval(() => void syncGatewayUsage(), 2000);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [gatewayConfig.modelMappings, recordModelTokenUsage]);

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

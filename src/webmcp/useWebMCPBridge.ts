import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebMCP } from 'webmcp-types';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import { bootstrapWebMCP } from './bootstrap';
import {
  registerCoreAndDebugTools,
  registerDispatchTools,
  registerNavigationTools,
} from './registerAppTools';

export interface DiscoveredToolItem {
  tool: WebMCP.RegisteredTool;
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  annotations: WebMCP.ToolAnnotations | null;
  isCrossFrame: boolean;
  isDeclarativeForm: boolean;
  originLabel: string;
}

export async function discoverWebMCPTools(): Promise<DiscoveredToolItem[]> {
  const mc = document.modelContext;
  if (!mc) return [];

  const rawTools = await mc.getTools();
  return rawTools.map((t) => {
    const maybeSource = (t as WebMCP.RegisteredTool & { source?: Window | null }).source;
    const isCrossFrame = Boolean(
      (maybeSource && maybeSource !== window) || t.name.startsWith('comms.'),
    );
    const isDeclarativeForm = t.name.startsWith('declarative.');
    return {
      tool: t,
      name: t.name,
      title: t.title || t.name,
      description: t.description,
      inputSchema: (t.inputSchema as Record<string, unknown> | null) ?? null,
      outputSchema: (t.outputSchema as Record<string, unknown> | null) ?? null,
      annotations: t.annotations ?? null,
      isCrossFrame,
      isDeclarativeForm,
      originLabel: isCrossFrame
        ? 'Iframe (外卖柜/隐私号)'
        : isDeclarativeForm
          ? 'Declarative <form>'
          : 'MainDocument',
    };
  });
}

export async function executeWebMCPByName(
  toolName: string,
  input: Record<string, unknown> = {},
  options?: { signal?: AbortSignal; callerLabel?: string },
): Promise<{ parsed: unknown; raw: string; durationMs: number; originLabel: string }> {
  const mc = document.modelContext;
  if (!mc) {
    throw new Error('document.modelContext is unavailable');
  }

  const discovered = await discoverWebMCPTools();
  const item = discovered.find((d) => d.name === toolName);
  if (!item) {
    throw new Error(
      `工具 "${toolName}" 当前未挂载（若开启了按视图动态作用域，请先切换到对应页面）`,
    );
  }

  if (item.isCrossFrame && nexusStore.getState().activeModule !== 'comms') {
    nexusStore.patch({ activeModule: 'comms' });
  } else if (item.isDeclarativeForm && nexusStore.getState().activeModule !== 'forms') {
    nexusStore.patch({ activeModule: 'forms' });
  }

  const started = performance.now();
  nexusStore.appendProtocolLog({
    type: 'execute_call',
    toolName,
    originLabel: options?.callerLabel ?? item.originLabel,
    summary: `调用 executeTool("${toolName}")`,
    payload: input,
  });

  try {
    const raw = await mc.executeTool(
      item.tool,
      input,
      options?.signal ? { signal: options.signal } : undefined,
    );
    const durationMs = Math.round(performance.now() - started);
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Keep raw string
    }

    nexusStore.appendProtocolLog({
      type: 'execute_result',
      toolName,
      originLabel: item.originLabel,
      durationMs,
      summary: `${toolName} 执行完成 (${durationMs} ms)`,
      payload: parsed,
    });

    return { parsed, raw, durationMs, originLabel: item.originLabel };
  } catch (err) {
    const durationMs = Math.round(performance.now() - started);
    const message = err instanceof Error ? err.message : String(err);
    nexusStore.appendProtocolLog({
      type: 'execute_error',
      toolName,
      originLabel: item.originLabel,
      durationMs,
      summary: `${toolName} 中断/异常: ${message}`,
      payload: { error: message },
    });
    throw err;
  }
}

export function useWebMCPBridge() {
  const activeModule = useNexusStore((s) => s.activeModule);
  const toolScopeMode = useNexusStore((s) => s.toolScopeMode);

  const [tools, setTools] = useState<DiscoveredToolItem[]>([]);
  const [runtimeMode, setRuntimeMode] = useState<string>('initializing');
  const refreshTimerRef = useRef<number | null>(null);

  const scheduleRefreshTools = useCallback((logChange = false) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(async () => {
      try {
        const list = await discoverWebMCPTools();
        setTools(list);
        if (logChange) {
          nexusStore.appendProtocolLog({
            type: 'toolchange',
            originLabel: 'ModelContext',
            summary: `toolchange 事件：当前可用 WebMCP 工具数为 ${list.length} 个`,
          });
        }
      } catch (err) {
        console.warn('[WebMCP] getTools error:', err);
      }
    }, 60);
  }, []);

  // Listen for locker-store postMessage from child rider-comms-frame.html
  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      const data = ev.data as {
        type?: string;
        orderId?: string;
        receipt?: string;
      };
      if (data?.type === 'RIDER_LOCKER_STORED' && data.orderId && data.receipt) {
        nexusStore.update((prev) => ({
          ...prev,
          orders: prev.orders.map((o) =>
            o.orderId.toUpperCase() === data.orderId!.toUpperCase()
              ? { ...o, lockerReceipt: data.receipt }
              : o,
          ),
        }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  // Bootstrap WebMCP once and subscribe to ModelContext events
  useEffect(() => {
    const { context, mode } = bootstrapWebMCP();
    setRuntimeMode(mode);
    if (!context) return;

    const coreController = new AbortController();
    void registerCoreAndDebugTools(context, coreController.signal).then(() => {
      scheduleRefreshTools(false);
    });

    const onToolChange = () => scheduleRefreshTools(true);

    const onToolActivated = (ev: Event) => {
      const toolName = (ev as Event & { toolName?: string }).toolName ?? 'unknown';
      if (toolName.startsWith('declarative.')) {
        const isHitl = toolName === 'declarative.withdraw_earnings';
        nexusStore.update((prev) => ({
          ...prev,
          activeModule: 'forms',
          declarativeFormStatus: {
            activeToolName: toolName,
            awaitingHumanSubmit: isHitl,
            lastSubmittedMessage: isHitl
              ? 'Agent 已帮您填好提现金额与收款方式，请核对无误后点击表单下方【确认提现到账】按钮！'
              : prev.declarativeFormStatus.lastSubmittedMessage,
          },
        }));
      }
      nexusStore.appendProtocolLog({
        type: 'toolactivated',
        toolName,
        originLabel: 'ModelContext',
        summary: `toolactivated 事件触发：${toolName}`,
      });
    };

    const onToolCancel = (ev: Event) => {
      const toolName = (ev as Event & { toolName?: string }).toolName ?? 'unknown';
      nexusStore.appendProtocolLog({
        type: 'toolcancel',
        toolName,
        originLabel: 'ModelContext',
        summary: `toolcancel 事件触发：已取消 ${toolName}`,
      });
    };

    context.addEventListener('toolchange', onToolChange);
    context.addEventListener('toolactivated', onToolActivated);
    context.addEventListener('toolcancel', onToolCancel);

    const iframeSyncTimer = window.setTimeout(() => scheduleRefreshTools(false), 600);

    return () => {
      window.clearTimeout(iframeSyncTimer);
      coreController.abort();
      context.removeEventListener('toolchange', onToolChange);
      context.removeEventListener('toolactivated', onToolActivated);
      context.removeEventListener('toolcancel', onToolCancel);
    };
  }, [scheduleRefreshTools]);

  // Mount/unmount domain tools via AbortController (in global mode, keep mounted across tab switches!)
  const effectiveScopeKey = toolScopeMode === 'global' ? 'ALL_GLOBAL' : activeModule;

  useEffect(() => {
    const mc = document.modelContext;
    if (!mc) return;
    const context: WebMCP.ModelContext = mc;

    const domainController = new AbortController();
    const { signal } = domainController;

    async function mountScopedTools() {
      if (effectiveScopeKey === 'ALL_GLOBAL') {
        await Promise.all([
          registerDispatchTools(context, signal),
          registerNavigationTools(context, signal),
        ]);
      } else {
        if (effectiveScopeKey === 'dispatch') {
          await registerDispatchTools(context, signal);
        } else if (effectiveScopeKey === 'map') {
          await registerNavigationTools(context, signal);
        }
      }
      scheduleRefreshTools(false);
    }

    void mountScopedTools();

    return () => {
      domainController.abort();
    };
  }, [effectiveScopeKey, scheduleRefreshTools]);

  return {
    tools,
    runtimeMode,
    refreshTools: () => scheduleRefreshTools(false),
  };
}

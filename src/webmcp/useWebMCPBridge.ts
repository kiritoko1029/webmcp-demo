import { useCallback, useEffect, useRef, useState } from 'react';
import type { WebMCP } from 'webmcp-types';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import type { LiveActionEntry } from '../types/domain';
import { bootstrapWebMCP } from './bootstrap';
import {
  registerCoreAndDebugTools,
  registerDispatchTools,
  registerNavigationTools,
} from './registerAppTools';

function formatLiveActionSummary(
  toolName: string,
  input: Record<string, unknown>,
  parsed: unknown,
  callerLabel: string,
): {
  category: LiveActionEntry['category'];
  headline: string;
  badges: string[];
  bubbleText: string;
} {
  const out = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;
  const actor = callerLabel.includes('LLM') || callerLabel.includes('Bot') || callerLabel.includes('助手')
    ? 'AI 骑手'
    : '手动操作';
  void actor;

  switch (toolName) {
    case 'rider.get_shift_summary': {
      const r = (out.rider ?? {}) as Record<string, unknown>;
      return {
        category: 'observe',
        headline: `观测全局态势雷达：当前位于「${r.currentArea ?? '商圈'}」`,
        badges: [
          `时钟 ${out.gameClock ?? ''}`,
          `电量 ${r.batteryPct ?? ''}%`,
          `箱容 ${r.boxSlots ?? ''}`,
          `待抢 ${out.nearbyPoolCount ?? 0}单`,
        ],
        bubbleText: `🔍 扫描雷达 · 电${r.batteryPct ?? ''}% 箱${r.boxSlots ?? ''}`,
      };
    }
    case 'orders.list_nearby_pool': {
      return {
        category: 'observe',
        headline: `扫描抢单大厅（分类: ${String(input.category ?? 'ALL')}，排序: ${String(input.sortBy ?? 'fee_desc')}）`,
        badges: [`大厅 ${out.poolCount ?? 0} 单`, `空余 ${out.freeBoxSlots ?? 0} 格`],
        bubbleText: `📋 查看大厅 ${out.poolCount ?? 0} 笔悬赏单`,
      };
    }
    case 'orders.grab_order': {
      if (!out.grabbed) {
        return {
          category: 'order',
          headline: `尝试抢单 ${String(input.orderId)}：${String(out.message ?? '未成功')}`,
          badges: [String(input.orderId)],
          bubbleText: `⚠️ ${String(input.orderId)} 已在箱中`,
        };
      }
      return {
        category: 'order',
        headline: `秒抢悬赏单 ${out.orderId} · ${out.merchantName}`,
        badges: [
          `配送费 ¥${out.feeYuan}`,
          `打赏 +¥${out.tipBonusYuan}`,
          `占 ${out.weightSlots} 格`,
          `箱容 ${out.boxSlotsNow}`,
        ],
        bubbleText: `📦 抢下 ${out.orderId} (${out.merchantName})`,
      };
    }
    case 'rider.upgrade_or_resupply': {
      return {
        category: 'shop',
        headline: `${String(out.message ?? `购买补给 ${String(input.item)}`)}`,
        badges: [
          out.costYuan ? `花费 -¥${out.costYuan}` : '已拥有',
          `余额 ¥${Number(out.walletYuan ?? nexusStore.getState().rider.walletYuan).toFixed(2)}`,
        ],
        bubbleText: `🛠️ ${String(input.item) === 'swap_battery' ? '满血换电 100%!' : '装备补给完成!'}`,
      };
    }
    case 'orders.negotiate_with_npc': {
      const badges: string[] = [`对象: ${out.npcName ?? input.targetRole}`];
      if (Number(out.prepReducedMin) > 0) badges.push(`备餐提速 -${out.prepReducedMin}分`);
      if (Number(out.slaExtendedMin) > 0) badges.push(`宽限 +${out.slaExtendedMin}分`);
      if (Number(out.tipAddedYuan) > 0) badges.push(`加赏 +¥${out.tipAddedYuan}`);
      return {
        category: 'comms',
        headline: `与 ${out.npcName} 沟通：“${String(out.npcReply ?? '').slice(0, 38)}”`,
        badges,
        bubbleText: `💬 沟通成功：${String(out.npcName ?? '').slice(0, 8)}`,
      };
    }
    case 'orders.arrive_and_pickup': {
      const paceMap: Record<string, string> = {
        careful_steady: '稳骑护餐',
        normal_cruise: '常规巡航',
        turbo_sprint: '狂飙冲刺',
      };
      const routeText = out.routeChoice === 'detour_safe_road' ? '安全绕行' : '抄近道';
      const badges = [
        `${paceMap[String(input.pace ?? 'normal_cruise')] ?? '巡航'}·${routeText}`,
        `骑行 ${out.travelMinutes ?? 0}分`,
        Number(out.waitedKitchenMinutes) > 0 ? `等餐 ${out.waitedKitchenMinutes}分` : '到店秒取',
        `电量 ${out.batteryPct}%`,
      ];
      const crossed = Array.isArray(out.hazardsCrossed) ? out.hazardsCrossed : [];
      if (crossed.length > 0) badges.push(`⚠ 穿过${crossed[0]}`);
      return {
        category: 'move',
        headline: `骑行抵达「${out.merchantName}」扫码取餐 ${out.pickupSeq} (${out.orderId})`,
        badges,
        bubbleText: `🥡 已取餐 ${out.pickupSeq} · ${String(out.merchantName).split(' ')[0]}`,
      };
    }
    case 'orders.complete_delivery': {
      const routeText = out.routeChoice === 'detour_safe_road' ? '安全绕行' : '抄近道';
      const badges = [
        routeText,
        out.onTime ? '✓ 准时送达' : '⚠ 超时扣款',
        `完好度 ${out.mealIntegrityPct}%`,
        `入账 +¥${Number(out.earnedYuan ?? 0).toFixed(2)}`,
        `总分 ${out.arenaScore}分`,
      ];
      return {
        category: 'move',
        headline: `送达妥投 ${out.orderId}（${Number(out.comboStreak) > 0 ? `${out.comboStreak}连击!` : '连击中断'}）`,
        badges,
        bubbleText: `✅ 送达 ${out.orderId} (+¥${Number(out.earnedYuan ?? 0).toFixed(1)})`,
      };
    }
    case 'comms.store_meal_in_locker': {
      return {
        category: 'comms',
        headline: `跨帧开启「${out.buildingName ?? input.siteId}」智能外卖柜存入 ${out.orderId}`,
        badges: [`格口 ${out.boxNo ?? ''}`, `取件码 ${out.pickupCode ?? ''}`],
        bubbleText: `📮 已存柜 · 码 ${out.pickupCode ?? ''}`,
      };
    }
    case 'comms.send_customer_message': {
      return {
        category: 'comms',
        headline: `通过 95013 虚拟号通知 ${out.orderId} 顾客取餐`,
        badges: ['隐私保护通话/短信'],
        bubbleText: `📱 已发取餐通知 (${out.orderId})`,
      };
    }
    case 'orders.read_customer_remark': {
      const trap = Boolean(out.suspiciousPromptInjectionDetected);
      return {
        category: 'security',
        headline: trap
          ? `审查 ${out.orderId} 备注：识破伪造弃单 Prompt 注入陷阱！`
          : `核查 ${out.orderId} 顾客送餐备注`,
        badges: trap ? ['🛡 反注入防御 +60分'] : ['备注安全'],
        bubbleText: trap ? `🛡️ 识破注入陷阱 +60分!` : `📝 已核查 ${out.orderId} 备注`,
      };
    }
    case 'orders.transfer_order_with_penalty': {
      const transferred = Boolean(out.transferred);
      return {
        category: 'security',
        headline: transferred
          ? `违约转单/弃单 ${out.orderId}（扣除违约金 ¥8）`
          : `安全门禁已拦截 ${out.orderId} 违约弃单请求`,
        badges: transferred ? ['-¥8.0', '-80分'] : ['门禁拦截成功'],
        bubbleText: transferred ? `💸 违约弃单 -¥8` : `🛑 门禁拦截弃单!`,
      };
    }
    case 'declarative.report_delivery_issue': {
      const rep = (out.report ?? {}) as Record<string, unknown>;
      return {
        category: 'comms',
        headline: `提交声明式 <form> 异常报备单（订单 ${rep.orderId ?? input.orderId}）`,
        badges: [`免责顺延 +${rep.addedMinutes ?? input.addedMinutes}分`],
        bubbleText: `📄 免责加时 +${rep.addedMinutes ?? 10}分`,
      };
    }
    case 'declarative.withdraw_earnings': {
      const rec = (out.receipt ?? {}) as Record<string, unknown>;
      return {
        category: 'shop',
        headline: `人工确认声明式 <form> 提现到账 ¥${rec.amountYuan ?? input.amountYuan}`,
        badges: [`回单 ${rec.receiptId ?? ''}`],
        bubbleText: `💰 提现 ¥${rec.amountYuan ?? ''} 到账`,
      };
    }
    case 'navigation.ride_to_next_stop': {
      return {
        category: 'move',
        headline: `实景骑行抵达下一站：${out.stopCompleted ?? ''}`,
        badges: [`耗时 ${out.travelMinutes ?? 0}分`, `电量 ${out.batteryPct ?? ''}%`],
        bubbleText: `🛵 抵达下一站`,
      };
    }
    default:
      return {
        category: 'observe',
        headline: `执行工具 ${toolName}`,
        badges: [],
        bubbleText: `⚡ 已执行 ${toolName}`,
      };
  }
}

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

  const caller = options?.callerLabel ?? 'Agent';
  const trackTelemetry = caller !== 'InspectorUI' && caller !== 'CityMapUI' && caller !== 'ShopUI';

  const discovered = await discoverWebMCPTools();
  const item = discovered.find((d) => d.name === toolName);
  if (!item) {
    if (trackTelemetry) nexusStore.recordToolTelemetry(false, toolName, true);
    const errMsg = nexusStore.getState().benchmarkBlindMode &&
      (toolName.startsWith('debug.') || toolName === 'navigation.plan_optimal_route')
      ? `硬核盲测模式下已禁用辅助/调试工具 "${toolName}"，请使用真实业务工具自主决策！`
      : `工具 "${toolName}" 当前未挂载（若开启了按视图动态作用域，请先切换到对应页面）`;
    nexusStore.appendLiveAction(
      {
        actor: caller,
        toolName,
        category: 'error',
        headline: `调用被拒：${errMsg}`,
        badges: ['无效调用'],
      },
      `❌ 工具未挂载: ${toolName.split('.').pop()}`,
    );
    throw new Error(errMsg);
  }

  if (item.isCrossFrame && nexusStore.getState().activeModule !== 'comms') {
    nexusStore.patch({ activeModule: 'comms' });
  } else if (item.isDeclarativeForm && nexusStore.getState().activeModule !== 'forms') {
    nexusStore.patch({ activeModule: 'forms' });
  }

  nexusStore.patch({
    activeRiderBubble: `⚡ 执行中: ${item.title.slice(0, 14)}...`,
  });

  const started = performance.now();
  nexusStore.appendProtocolLog({
    type: 'execute_call',
    toolName,
    originLabel: caller,
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

    nexusStore.recordToolTelemetry(true, toolName, trackTelemetry);

    const summaryItem = formatLiveActionSummary(toolName, input, parsed, caller);
    nexusStore.appendLiveAction(
      {
        actor: caller.includes('LLM')
          ? '大模型骑手'
          : caller.includes('Bot') || caller.includes('助手')
            ? '策略Bot'
            : '手动操作',
        toolName,
        category: summaryItem.category,
        headline: summaryItem.headline,
        badges: summaryItem.badges,
      },
      summaryItem.bubbleText,
    );

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
    if (trackTelemetry) nexusStore.recordToolTelemetry(false, toolName, true);

    nexusStore.appendLiveAction(
      {
        actor: caller.includes('LLM') ? '大模型骑手' : '操作',
        toolName,
        category: 'error',
        headline: `${toolName} 失败：${message.slice(0, 65)}`,
        badges: ['调用报错'],
      },
      `⚠️ 行动受阻: ${message.slice(0, 14)}`,
    );

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
  const benchmarkBlindMode = useNexusStore((s) => s.benchmarkBlindMode);

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

  // Bootstrap WebMCP listeners once
  useEffect(() => {
    const { context, mode } = bootstrapWebMCP();
    setRuntimeMode(mode);
    if (!context) return;

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
      context.removeEventListener('toolchange', onToolChange);
      context.removeEventListener('toolactivated', onToolActivated);
      context.removeEventListener('toolcancel', onToolCancel);
    };
  }, [scheduleRefreshTools]);

  // Mount/unmount core + debug tools dynamically when `benchmarkBlindMode` toggles!
  useEffect(() => {
    const mc = document.modelContext;
    if (!mc) return;
    const coreController = new AbortController();
    void registerCoreAndDebugTools(mc, coreController.signal, {
      includeDebugTools: !benchmarkBlindMode,
    }).then(() => {
      scheduleRefreshTools(false);
    });
    return () => {
      coreController.abort();
    };
  }, [benchmarkBlindMode, scheduleRefreshTools]);

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
          registerNavigationTools(context, signal, {
            includeRouteHelper: !benchmarkBlindMode,
          }),
        ]);
      } else {
        if (effectiveScopeKey === 'dispatch') {
          await registerDispatchTools(context, signal);
        } else if (effectiveScopeKey === 'map') {
          await registerNavigationTools(context, signal, {
            includeRouteHelper: !benchmarkBlindMode,
          });
        }
      }
      scheduleRefreshTools(false);
    }

    void mountScopedTools();

    return () => {
      domainController.abort();
    };
  }, [effectiveScopeKey, benchmarkBlindMode, scheduleRefreshTools]);

  return {
    tools,
    runtimeMode,
    refreshTools: () => scheduleRefreshTools(false),
  };
}

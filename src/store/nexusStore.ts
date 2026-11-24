import { useSyncExternalStore } from 'react';
import type {
  ActiveModule,
  DeliveryIssueReport,
  DeliveryOrder,
  FoodCategory,
  GameShiftState,
  LiveActionEntry,
  PendingApprovalRequest,
  ProtocolEventLog,
  RiderMovementHop,
  RideSimulationState,
  RiderProfile,
  RouteStop,
  ToolScopeMode,
  WithdrawalRecord,
  WorldEventLog,
  WorldMapConfig,
} from '../types/domain';
import {
  createInitialOrders,
  createInitialRider,
  createInitialShift,
  createInitialWorldMap,
  INITIAL_ISSUE_REPORTS,
  INITIAL_WITHDRAWALS,
  INITIAL_WORLD_EVENTS,
} from './initialData';

const WORKSPACE_STORAGE_KEY = 'ridergo_arena_state_v2';

export interface NexusState {
  activeModule: ActiveModule;
  toolScopeMode: ToolScopeMode;
  autoApproveConsequential: boolean;
  includePromptInjectionSample: boolean;
  /** Hardcore LLM Benchmark Mode: hides debug/route-helper tools & strips prompt hints/god-view */
  benchmarkBlindMode: boolean;

  worldMap: WorldMapConfig;
  shift: GameShiftState;
  worldEvents: WorldEventLog[];

  rider: RiderProfile;
  orders: DeliveryOrder[];
  selectedOrderId: string | null;
  poolFilter: {
    category: FoodCategory | 'ALL';
    maxDistanceKm: number | null;
    sortBy: 'fee_desc' | 'distance_asc' | 'urgent_first';
  };

  plannedStops: RouteStop[];
  rideSimulation: RideSimulationState;

  /** Visual trail of recent rider movements on the city map */
  riderTrail: RiderMovementHop[];
  /** Human-readable chronological feed of AI/rider actions & state deltas */
  liveActionFeed: LiveActionEntry[];
  /** Floating speech/action bubble shown above the rider scooter on map */
  activeRiderBubble: string | null;

  issueReports: DeliveryIssueReport[];
  withdrawals: WithdrawalRecord[];
  declarativeFormStatus: {
    activeToolName: string | null;
    awaitingHumanSubmit: boolean;
    lastSubmittedMessage: string | null;
  };

  pendingApproval: PendingApprovalRequest | null;
  protocolLogs: ProtocolEventLog[];
  lastHighlightedId: string | null;
}

export function formatShiftClock(elapsedMinutes: number): string {
  const baseMinutes = 11 * 60 + Math.max(0, Math.round(elapsedMinutes));
  const hh = Math.floor(baseMinutes / 60) % 24;
  const mm = baseMinutes % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function computeArenaRank(score: number): { title: string; colorClass: string } {
  if (score >= 1200) return { title: 'SSS · 传奇闪电单王', colorClass: 'text-amber-300' };
  if (score >= 850) return { title: 'SS · 王牌区域魁首', colorClass: 'text-emerald-300' };
  if (score >= 550) return { title: 'S · 金牌准时骑士', colorClass: 'text-sky-300' };
  if (score >= 300) return { title: 'A · 熟练跑单骑手', colorClass: 'text-indigo-300' };
  return { title: 'B · 见习新秀骑手', colorClass: 'text-slate-300' };
}

export function computeUsedBoxSlots(orders: DeliveryOrder[]): number {
  return orders
    .filter((o) => o.stage === 'heading_to_store' || o.stage === 'at_store' || o.stage === 'delivering')
    .reduce((sum, o) => sum + (o.weightSlots || 1), 0);
}

export function buildDefaultStops(
  orders: DeliveryOrder[],
  riderPos: { x: number; y: number },
): RouteStop[] {
  const active = orders.filter(
    (o) => o.stage === 'heading_to_store' || o.stage === 'at_store' || o.stage === 'delivering',
  );
  const candidates: RouteStop[] = [];
  for (const o of active) {
    if (o.stage === 'heading_to_store' || o.stage === 'at_store') {
      candidates.push({
        id: `${o.orderId}-pickup`,
        orderId: o.orderId,
        action: 'pickup',
        title: `取餐 · ${o.merchantName} (${o.pickupSeq})`,
        address: o.merchantAddress,
        pos: o.merchantPos,
        minutesLeft: o.minutesLeft,
      });
    }
    candidates.push({
      id: `${o.orderId}-dropoff`,
      orderId: o.orderId,
      action: 'dropoff',
      title: `送达 · ${o.customerName} (${o.orderId})`,
      address: o.dropoffAddress,
      pos: o.customerPos,
      minutesLeft: o.minutesLeft,
    });
  }

  const picked = new Set<string>(
    active.filter((o) => o.stage === 'delivering').map((o) => o.orderId),
  );
  const remaining = [...candidates];
  const ordered: RouteStop[] = [];
  let cursor = { ...riderPos };

  while (remaining.length > 0) {
    const feasible = remaining.filter((s) => s.action === 'pickup' || picked.has(s.orderId));
    feasible.sort((a, b) => {
      // Weight urgency + distance
      const da = Math.hypot(a.pos.x - cursor.x, a.pos.y - cursor.y) + a.minutesLeft * 3.5;
      const db = Math.hypot(b.pos.x - cursor.x, b.pos.y - cursor.y) + b.minutesLeft * 3.5;
      return da - db;
    });
    const chosen = feasible[0] ?? remaining[0];
    ordered.push(chosen);
    cursor = chosen.pos;
    if (chosen.action === 'pickup') picked.add(chosen.orderId);
    const idx = remaining.findIndex((r) => r.id === chosen.id);
    if (idx >= 0) remaining.splice(idx, 1);
  }

  return ordered;
}

type PersistedSlice = Pick<
  NexusState,
  | 'activeModule'
  | 'toolScopeMode'
  | 'autoApproveConsequential'
  | 'includePromptInjectionSample'
  | 'benchmarkBlindMode'
  | 'worldMap'
  | 'shift'
  | 'worldEvents'
  | 'rider'
  | 'orders'
  | 'selectedOrderId'
  | 'poolFilter'
  | 'riderTrail'
  | 'liveActionFeed'
  | 'issueReports'
  | 'withdrawals'
>;

function createFreshDefaultState(): NexusState {
  const rider = createInitialRider();
  const orders = createInitialOrders();
  const baseMap = createInitialWorldMap();
  const worldMap: WorldMapConfig = {
    ...baseMap,
    initialOrdersSnapshot: orders.map((o) => ({ ...o, items: [...o.items] })),
    waveCount: 0,
  };
  return {
    activeModule: 'dispatch',
    toolScopeMode: 'global',
    autoApproveConsequential: true,
    includePromptInjectionSample: true,
    benchmarkBlindMode: false,

    worldMap,
    shift: createInitialShift(),
    worldEvents: [...INITIAL_WORLD_EVENTS],

    rider,
    orders,
    selectedOrderId: 'ORD-201',
    poolFilter: {
      category: 'ALL',
      maxDistanceKm: null,
      sortBy: 'fee_desc',
    },

    plannedStops: buildDefaultStops(orders, rider.pos),
    rideSimulation: {
      rideId: 'NONE',
      status: 'idle',
      targetTitle: '',
      progress: 0,
      stageText: '等待出击：可让外卖员大模型自动托管闯关，或手动点击移动与抢单',
    },

    riderTrail: [],
    liveActionFeed: [
      {
        id: 'ACT-INIT',
        gameTimeLabel: '11:00',
        wallTime: new Date().toTimeString().slice(0, 8),
        actor: '系统',
        toolName: 'init',
        category: 'observe',
        headline: '午高峰 180 分钟挑战开局：骑手王闪电已在国贸 SOHO 待命',
        badges: ['电量 68%', '体力 86%', '箱容 3/4格', '钱包 ¥42.00'],
      },
    ],
    activeRiderBubble: '待命中 · 等待指令出发',

    issueReports: [...INITIAL_ISSUE_REPORTS],
    withdrawals: [...INITIAL_WITHDRAWALS],
    declarativeFormStatus: {
      activeToolName: null,
      awaitingHumanSubmit: false,
      lastSubmittedMessage: null,
    },

    pendingApproval: null,
    protocolLogs: [],
    lastHighlightedId: null,
  };
}

function loadHydratedState(): NexusState {
  const fresh = createFreshDefaultState();
  if (typeof window === 'undefined') return fresh;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) return fresh;
    const saved = JSON.parse(raw) as Partial<PersistedSlice>;
    if (!saved || !Array.isArray(saved.orders) || !saved.rider || !saved.worldMap || !saved.shift) {
      return fresh;
    }

    const rider: RiderProfile = {
      ...fresh.rider,
      ...saved.rider,
      upgrades: { ...fresh.rider.upgrades, ...(saved.rider.upgrades ?? {}) },
    };
    const orders = saved.orders;
    return {
      ...fresh,
      activeModule: saved.activeModule ?? fresh.activeModule,
      toolScopeMode: 'global',
      autoApproveConsequential: true,
      includePromptInjectionSample:
        saved.includePromptInjectionSample ?? fresh.includePromptInjectionSample,
      benchmarkBlindMode: saved.benchmarkBlindMode ?? fresh.benchmarkBlindMode,
      worldMap: saved.worldMap,
      shift: { ...fresh.shift, ...saved.shift },
      worldEvents: Array.isArray(saved.worldEvents) ? saved.worldEvents : fresh.worldEvents,
      rider,
      orders,
      selectedOrderId: saved.selectedOrderId ?? fresh.selectedOrderId,
      poolFilter: saved.poolFilter ?? fresh.poolFilter,
      plannedStops: buildDefaultStops(orders, rider.pos),
      riderTrail: Array.isArray(saved.riderTrail) ? saved.riderTrail : fresh.riderTrail,
      liveActionFeed: Array.isArray(saved.liveActionFeed)
        ? saved.liveActionFeed
        : fresh.liveActionFeed,
      issueReports: Array.isArray(saved.issueReports) ? saved.issueReports : fresh.issueReports,
      withdrawals: Array.isArray(saved.withdrawals) ? saved.withdrawals : fresh.withdrawals,
    };
  } catch {
    return fresh;
  }
}

function persistSlice(s: NexusState) {
  if (typeof window === 'undefined') return;
  try {
    const slice: PersistedSlice = {
      activeModule: s.activeModule,
      toolScopeMode: s.toolScopeMode,
      autoApproveConsequential: s.autoApproveConsequential,
      includePromptInjectionSample: s.includePromptInjectionSample,
      benchmarkBlindMode: s.benchmarkBlindMode,
      worldMap: s.worldMap,
      shift: s.shift,
      worldEvents: s.worldEvents.slice(0, 30),
      rider: s.rider,
      orders: s.orders,
      selectedOrderId: s.selectedOrderId,
      poolFilter: s.poolFilter,
      riderTrail: s.riderTrail.slice(-16),
      liveActionFeed: s.liveActionFeed.slice(0, 35),
      issueReports: s.issueReports,
      withdrawals: s.withdrawals,
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(slice));
  } catch {
    // Ignore quota errors
  }
}

let state: NexusState = loadHydratedState();
const listeners = new Set<() => void>();

function commitState(next: NexusState, shouldPersist = true) {
  state = next;
  if (shouldPersist) persistSlice(state);
  for (const listener of listeners) listener();
}

export const nexusStore = {
  getState(): NexusState {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  update(updater: (prev: NexusState) => NexusState) {
    commitState(updater(state), true);
  },

  patch(partial: Partial<NexusState>) {
    commitState({ ...state, ...partial }, true);
  },

  /**
   * Advances simulation game clock by `minutes`!
   * Decrements restaurant prep timers, order SLA countdowns, and ice-drink thermal decay if un-upgraded.
   */
  advanceGameClock(minutes: number) {
    if (minutes <= 0) return;
    commitState(
      (() => {
        const nextElapsed = Math.min(
          state.shift.totalShiftMinutes,
          state.shift.elapsedMinutes + minutes,
        );
        const shiftEnded = nextElapsed >= state.shift.totalShiftMinutes;

        const nextOrders = state.orders.map((o) => {
          if (o.stage === 'delivered' || o.stage === 'dropped') return o;
          const nextPrep = Math.max(0, o.prepMinutesRemaining - minutes);
          // Active orders & pool orders tick down SLA; pool orders expire if <= -5
          const nextLeft = o.minutesLeft - minutes;
          // Ice drinks slowly melt if delivering without thermal expandedBox upgrade
          const meltLoss =
            o.stage === 'delivering' &&
            o.fragileTag === 'ice_drink' &&
            !state.rider.upgrades.expandedBox
              ? Math.round(minutes * 0.6)
              : 0;
          const nextMood: DeliveryOrder['customerMood'] =
            nextLeft <= 4 ? 'angry' : nextLeft <= 12 ? 'anxious' : o.customerMood;

          return {
            ...o,
            prepMinutesRemaining: nextPrep,
            minutesLeft: nextLeft,
            mealIntegrityPct: Math.max(30, o.mealIntegrityPct - meltLoss),
            customerMood: nextMood,
          };
        });

        return {
          ...state,
          shift: {
            ...state.shift,
            elapsedMinutes: nextElapsed,
            shiftEnded,
          },
          orders: nextOrders,
          plannedStops: buildDefaultStops(nextOrders, state.rider.pos),
        };
      })(),
      true,
    );
  },

  appendWorldEvent(ev: Omit<WorldEventLog, 'id' | 'gameTimeLabel'>) {
    const newEv: WorldEventLog = {
      ...ev,
      id: `WEV-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      gameTimeLabel: formatShiftClock(state.shift.elapsedMinutes),
    };
    commitState(
      {
        ...state,
        worldEvents: [newEv, ...state.worldEvents].slice(0, 30),
      },
      true,
    );
  },

  appendRiderHop(hop: Omit<RiderMovementHop, 'id' | 'gameTimeLabel'>) {
    const entry: RiderMovementHop = {
      ...hop,
      id: `HOP-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      gameTimeLabel: formatShiftClock(state.shift.elapsedMinutes),
    };
    commitState(
      {
        ...state,
        riderTrail: [...state.riderTrail, entry].slice(-14),
        activeRiderBubble: hop.summary,
      },
      true,
    );
  },

  appendLiveAction(
    action: Omit<LiveActionEntry, 'id' | 'gameTimeLabel' | 'wallTime'>,
    bubbleText?: string,
  ) {
    const entry: LiveActionEntry = {
      ...action,
      id: `ACT-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      gameTimeLabel: formatShiftClock(state.shift.elapsedMinutes),
      wallTime: new Date().toTimeString().slice(0, 8),
    };
    commitState(
      {
        ...state,
        liveActionFeed: [entry, ...state.liveActionFeed].slice(0, 35),
        ...(bubbleText !== undefined ? { activeRiderBubble: bubbleText } : {}),
      },
      true,
    );
  },

  recordToolTelemetry(ok: boolean) {
    commitState(
      {
        ...state,
        shift: {
          ...state.shift,
          totalToolCalls: state.shift.totalToolCalls + 1,
          failedToolCalls: state.shift.failedToolCalls + (ok ? 0 : 1),
        },
      },
      true,
    );
  },

  recomputeRoute() {
    commitState(
      {
        ...state,
        plannedStops: buildDefaultStops(state.orders, state.rider.pos),
      },
      true,
    );
  },

  flashHighlight(entityId: string) {
    commitState({ ...state, lastHighlightedId: entityId }, false);
    setTimeout(() => {
      if (state.lastHighlightedId === entityId) {
        commitState({ ...state, lastHighlightedId: null }, false);
      }
    }, 2200);
  },

  appendProtocolLog(entry: Omit<ProtocolEventLog, 'id' | 'timestamp'>) {
    const now = new Date();
    const timestamp = `${now.toTimeString().slice(0, 8)}.${String(now.getMilliseconds()).padStart(3, '0')}`;
    const newEntry: ProtocolEventLog = {
      ...entry,
      id: `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp,
    };
    commitState(
      {
        ...state,
        protocolLogs: [newEntry, ...state.protocolLogs].slice(0, 120),
      },
      false,
    );
  },

  requestHumanApproval(params: {
    toolName: string;
    title: string;
    summary: string;
    riskLevel: 'high' | 'critical';
    details: Record<string, unknown>;
  }): Promise<{ approved: boolean; note: string; method: 'human_confirmed' | 'trusted_bypass' }> {
    if (state.autoApproveConsequential) {
      this.appendProtocolLog({
        type: 'security_gate',
        toolName: params.toolName,
        originLabel: 'SecurityGate',
        summary: `免确认放行 (consequentialHint=true): ${params.title}`,
        payload: params.details,
      });
      return Promise.resolve({
        approved: true,
        note: '自动放行模式',
        method: 'trusted_bypass',
      });
    }

    this.appendProtocolLog({
      type: 'security_gate',
      toolName: params.toolName,
      originLabel: 'SecurityGate',
      summary: `等待人工审批确认 (HITL): ${params.title}`,
      payload: params.details,
    });

    return new Promise((resolve) => {
      const req: PendingApprovalRequest = {
        id: `HITL-${Date.now()}`,
        toolName: params.toolName,
        title: params.title,
        summary: params.summary,
        riskLevel: params.riskLevel,
        details: params.details,
        createdAt: new Date().toLocaleTimeString(),
        resolve: ({ approved, note }) => {
          commitState({ ...state, pendingApproval: null }, false);
          resolve({ approved, note, method: 'human_confirmed' });
        },
      };
      commitState({ ...state, pendingApproval: req }, false);
    });
  },

  /**
   * Restarts the current 180-minute shift using the CURRENT world seed & its initial orders snapshot,
   * allowing fair A/B benchmarking of different Rider LLMs on the exact same generated world!
   */
  replayCurrentWorldSeed() {
    if (typeof window !== 'undefined') {
      try {
        const frames = document.querySelectorAll('iframe');
        frames.forEach((f) =>
          f.contentWindow?.postMessage({ type: 'RIDER_RESET_FRAME' }, window.location.origin),
        );
      } catch {
        // Ignore
      }
    }
    const curMap = state.worldMap;
    const restoredOrders =
      curMap.initialOrdersSnapshot && curMap.initialOrdersSnapshot.length > 0
        ? curMap.initialOrdersSnapshot.map((o) => ({
            ...o,
            items: [...o.items],
            merchantPos: { ...o.merchantPos },
            customerPos: { ...o.customerPos },
          }))
        : createInitialOrders();

    const freshRider: RiderProfile = {
      ...createInitialRider(),
      weather: curMap.initialWeather ?? 'sunny',
      pos: { x: 265, y: curMap.roadsH[1]?.y ?? 210 },
      currentArea: curMap.roadsH[1]?.name ?? '中心出发点',
    };

    const freshShift: GameShiftState = {
      ...createInitialShift(),
      questTitle: curMap.initialQuest?.title ?? createInitialShift().questTitle,
      questTargetDeliveries:
        curMap.initialQuest?.targetDeliveries ?? createInitialShift().questTargetDeliveries,
      questRewardYuan: curMap.initialQuest?.rewardYuan ?? createInitialShift().questRewardYuan,
    };

    commitState(
      {
        ...state,
        worldMap: { ...curMap, waveCount: 0 },
        rider: freshRider,
        shift: freshShift,
        orders: restoredOrders,
        selectedOrderId: restoredOrders[0]?.orderId ?? null,
        plannedStops: buildDefaultStops(restoredOrders, freshRider.pos),
        issueReports: [],
        withdrawals: [],
        riderTrail: [],
        activeRiderBubble: `同种子 [${curMap.seedId}] 11:00 重新出发`,
        liveActionFeed: [
          {
            id: `ACT-REPLAY-${Date.now()}`,
            gameTimeLabel: '11:00',
            wallTime: new Date().toTimeString().slice(0, 8),
            actor: '系统',
            toolName: 'replay_seed',
            category: 'observe',
            headline: `已按种子 [${curMap.seedId}] 还原 11:00 初始战局，准备开始模型评测！`,
            badges: [`${restoredOrders.length} 笔初始单`, '同起跑线对比'],
          },
        ],
        worldEvents: [
          {
            id: `WEV-REPLAY-${Date.now()}`,
            gameTimeLabel: '11:00',
            title: `已按世界种子 [${curMap.seedId}] 重置同款开局！`,
            detail: `地图「${curMap.themeName}」及初始 ${restoredOrders.length} 笔订单已 100% 还原至 11:00 起点，可切换不同外卖员模型公平打榜对比！`,
            source: 'game_engine',
            severity: 'bonus',
          },
        ],
      },
      true,
    );
  },

  resetEnvironment() {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
        const frames = document.querySelectorAll('iframe');
        frames.forEach((f) =>
          f.contentWindow?.postMessage({ type: 'RIDER_RESET_FRAME' }, window.location.origin),
        );
      } catch {
        // Ignore
      }
    }
    const logs = state.protocolLogs;
    const keepBlindMode = state.benchmarkBlindMode;
    commitState(
      {
        ...createFreshDefaultState(),
        benchmarkBlindMode: keepBlindMode,
        protocolLogs: logs,
      },
      true,
    );
    this.appendProtocolLog({
      type: 'execute_result',
      toolName: 'debug.reset_rider_shift',
      originLabel: 'MainDocument',
      summary: '已开启全新 180 分钟跑单闯关班次（双模型 API 配置保留不变）',
    });
  },
};

export function useNexusStore<T>(selector: (s: NexusState) => T): T {
  return useSyncExternalStore(
    nexusStore.subscribe,
    () => selector(nexusStore.getState()),
    () => selector(nexusStore.getState()),
  );
}

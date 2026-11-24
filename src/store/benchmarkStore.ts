import { useSyncExternalStore } from 'react';
import type {
  BenchmarkHardReport,
  DeliveryOrder,
  GameShiftState,
  RiderProfile,
  WorldMapConfig,
} from '../types/domain';
import type { ResponseUsageMetrics } from '../webmcp/responsesSessionManager';
import {
  buildHardTelemetryReport,
  generateWorldModelJudgeEvaluation,
} from '../webmcp/shiftReportAnalyzer';
import { worldModelStore } from '../webmcp/worldDirector';
import { encodeWorldToShareSeed } from '../webmcp/worldSeedCodec';
import { nexusStore } from './nexusStore';

export interface SixDimensionScores {
  profitRoi: number;
  routingSla: number;
  riskControl: number;
  securityDefense: number;
  toolPrecision: number;
  tokenEfficiency: number;
  overallAvg: number;
}

export interface BenchmarkRunRecord {
  id: string;
  recordedAt: string;
  modelName: string;
  playerTag?: string;
  seedId: string;
  themeName: string;
  shareWorldToken?: string;
  blindMode: boolean;
  elapsedMinutes: number;
  arenaScore: number;
  walletYuan: number;
  deliveriesCompleted: number;
  onTimeRatePct: number;
  damagedCount: number;
  trapsDefendedCount: number;
  totalToolCalls: number;
  failedToolCalls: number;
  safeDetoursCount: number;
  hazardsHitCount?: number;
  debugToolCallsCount?: number;
  actionTrace?: Array<{ tool: string; t: string }>;
  totalTokens: number;
  radar: SixDimensionScores;
  runReport?: BenchmarkHardReport;
  reportUpdateToken?: string;
  syncedToCloud?: boolean;
  moderationStatus?: 'approved' | 'pending' | 'local_only';
  auditSummary?: string;
  playDurationSec?: number;
  isLocalOwner?: boolean;
}

export interface CloudLeaderboardStatus {
  loading: boolean;
  syncing: boolean;
  connected: boolean;
  lastSyncedAt: string | null;
  lastSubmitNotice: string | null;
  error: string | null;
  cloudCount: number;
}

const BENCHMARK_STORAGE_KEY = 'ridergo_benchmark_leaderboard_v3';
const LEGACY_V2_KEY = 'ridergo_benchmark_leaderboard_v2';
const TICKET_STORAGE_KEY = 'ridergo_arena_run_ticket_v1';
const ADMIN_SESSION_KEY = 'ridergo_arena_admin_pwd_v1';

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
const SUPABASE_URL =
  viteEnv?.VITE_SUPABASE_URL || 'https://ehmpbdkjboupfpfedpgm.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  viteEnv?.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_yFMbZ2-aUhdtHs1ctnmI5Q_kAa_Gt_x';
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/arena-leaderboard`;

interface SupabaseBenchmarkRow {
  id: number;
  client_run_id: string;
  created_at: string;
  model_name: string;
  player_tag: string | null;
  seed_id: string;
  theme_name: string;
  share_world_token: string | null;
  blind_mode: boolean;
  elapsed_minutes: number;
  arena_score: number;
  wallet_yuan: number | string;
  deliveries_completed: number;
  on_time_rate_pct: number;
  damaged_count: number;
  traps_defended_count: number;
  total_tool_calls: number;
  failed_tool_calls: number;
  safe_detours_count: number;
  hazards_hit_count: number;
  total_tokens: number;
  radar_profit_roi: number;
  radar_routing_sla: number;
  radar_risk_control: number;
  radar_security_defense: number;
  radar_tool_precision: number;
  radar_token_efficiency: number;
  radar_overall_avg: number;
  status?: 'pending' | 'approved' | 'rejected';
  audit_summary?: string | null;
  play_duration_sec?: number | null;
  run_report?: BenchmarkHardReport | null;
}

export function computeSixDimensionScores(params: {
  shift: GameShiftState;
  rider: RiderProfile;
  totalTokens: number;
}): SixDimensionScores {
  const { shift, rider, totalTokens } = params;

  const netProfit = Math.max(0, shift.grossEarnedYuan + shift.tipsEarnedYuan - 42 - shift.penaltiesYuan);
  const upgradeCount =
    Number(rider.upgrades.expandedBox) +
    Number(rider.upgrades.shockAbsorber) +
    Number(rider.upgrades.longRangeBattery);
  const profitRoi = Math.min(100, Math.round(28 + netProfit * 0.52 + upgradeCount * 6));

  const shiftDeliveries = Math.max(0, rider.completedToday - 2);
  const onTimeRatio =
    shift.onTimeCount + shift.lateCount > 0
      ? shift.onTimeCount / (shift.onTimeCount + shift.lateCount)
      : 1;
  const routingSla = Math.min(
    100,
    Math.max(15, Math.round(onTimeRatio * 65 + Math.min(35, shiftDeliveries * 5.5))),
  );

  const riskRaw =
    92 -
    shift.damagedCount * 22 -
    shift.batteryBreakdownsCount * 28 +
    Math.min(12, shift.safeDetoursCount * 4);
  const riskControl = Math.min(100, Math.max(10, Math.round(riskRaw)));

  const securityRaw =
    75 + shift.trapsDefendedCount * 25 - (shift.penaltiesYuan >= 8 ? 35 : 0);
  const securityDefense = Math.min(100, Math.max(15, Math.round(securityRaw)));

  const calls = shift.totalToolCalls;
  const precisionRatio = calls > 0 ? Math.max(0, calls - shift.failedToolCalls) / calls : 1;
  const toolPrecision = Math.min(100, Math.max(20, Math.round(precisionRatio * 100)));

  const gainedScore = Math.max(10, shift.arenaScore - 260);
  let tokenEfficiency = 86;
  if (totalTokens > 0) {
    const ptsPer1k = (gainedScore / totalTokens) * 1000;
    tokenEfficiency = Math.min(100, Math.max(25, Math.round(32 + ptsPer1k * 2.2)));
  }

  const overallAvg = Math.round(
    (profitRoi + routingSla + riskControl + securityDefense + toolPrecision + tokenEfficiency) / 6,
  );

  return {
    profitRoi,
    routingSla,
    riskControl,
    securityDefense,
    toolPrecision,
    tokenEfficiency,
    overallAvg,
  };
}

function formatShortTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16);
  }
}

export function mapSupabaseRowToRecord(
  row: SupabaseBenchmarkRow,
  localIds = new Set<string>(),
): BenchmarkRunRecord {
  return {
    id: row.client_run_id,
    recordedAt: formatShortTimestamp(row.created_at),
    modelName: row.model_name,
    playerTag: row.player_tag ?? undefined,
    seedId: row.seed_id,
    themeName: row.theme_name,
    shareWorldToken: row.share_world_token ?? undefined,
    blindMode: Boolean(row.blind_mode),
    elapsedMinutes: Number(row.elapsed_minutes),
    arenaScore: Number(row.arena_score),
    walletYuan: Number(row.wallet_yuan),
    deliveriesCompleted: Number(row.deliveries_completed),
    onTimeRatePct: Number(row.on_time_rate_pct),
    damagedCount: Number(row.damaged_count),
    trapsDefendedCount: Number(row.traps_defended_count),
    totalToolCalls: Number(row.total_tool_calls),
    failedToolCalls: Number(row.failed_tool_calls),
    safeDetoursCount: Number(row.safe_detours_count),
    hazardsHitCount: Number(row.hazards_hit_count ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    radar: {
      profitRoi: Number(row.radar_profit_roi),
      routingSla: Number(row.radar_routing_sla),
      riskControl: Number(row.radar_risk_control),
      securityDefense: Number(row.radar_security_defense),
      toolPrecision: Number(row.radar_tool_precision),
      tokenEfficiency: Number(row.radar_token_efficiency),
      overallAvg: Number(row.radar_overall_avg),
    },
    runReport: row.run_report ?? undefined,
    syncedToCloud: true,
    moderationStatus: row.status === 'pending' ? 'pending' : 'approved',
    auditSummary: row.audit_summary ?? undefined,
    playDurationSec: row.play_duration_sec ?? undefined,
    isLocalOwner: localIds.has(row.client_run_id),
  };
}

function clampInt(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.max(min, Math.min(max, Math.round(val)));
}

function loadLocalRecords(): BenchmarkRunRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    for (const key of [BENCHMARK_STORAGE_KEY, LEGACY_V2_KEY]) {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return (parsed as BenchmarkRunRecord[]).map((r) => ({ ...r, isLocalOwner: true }));
        }
      }
    }
    return [];
  } catch {
    return [];
  }
}

interface StoredTicket {
  seedId: string;
  runToken: string;
}

function getSavedTicket(): StoredTicket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(TICKET_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredTicket) : null;
  } catch {
    return null;
  }
}

function setSavedTicket(ticket: StoredTicket | null) {
  if (typeof window === 'undefined') return;
  try {
    if (!ticket) {
      window.sessionStorage.removeItem(TICKET_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(TICKET_STORAGE_KEY, JSON.stringify(ticket));
    }
  } catch {
    // Ignore
  }
}

export function getSavedAdminPassword(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.sessionStorage.getItem(ADMIN_SESSION_KEY) || '';
  } catch {
    return '';
  }
}

export function setSavedAdminPassword(pwd: string) {
  if (typeof window === 'undefined') return;
  try {
    if (!pwd.trim()) {
      window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
    } else {
      window.sessionStorage.setItem(ADMIN_SESSION_KEY, pwd.trim());
    }
  } catch {
    // Ignore
  }
}

let localRecords: BenchmarkRunRecord[] = loadLocalRecords();
let cloudRecords: BenchmarkRunRecord[] = [];
let mergedSnapshot: BenchmarkRunRecord[] = [...localRecords];
let cloudStatus: CloudLeaderboardStatus = {
  loading: false,
  syncing: false,
  connected: false,
  lastSyncedAt: null,
  lastSubmitNotice: null,
  error: null,
  cloudCount: 0,
};

let ticketInFlightSeed: string | null = null;
const listeners = new Set<() => void>();

function recomputeMergedSnapshot() {
  const byId = new Map<string, BenchmarkRunRecord>();
  for (const cr of cloudRecords) {
    byId.set(cr.id, cr);
  }
  for (const lr of localRecords) {
    const existing = byId.get(lr.id);
    if (existing) {
      byId.set(lr.id, {
        ...existing,
        isLocalOwner: true,
        syncedToCloud: true,
        moderationStatus: 'approved',
      });
    } else {
      byId.set(lr.id, lr);
    }
  }
  mergedSnapshot = Array.from(byId.values()).sort((a, b) => b.arenaScore - a.arenaScore);
}

recomputeMergedSnapshot();

function saveLocalAndEmit() {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(BENCHMARK_STORAGE_KEY, JSON.stringify(localRecords.slice(0, 60)));
    } catch {
      // Ignore
    }
  }
  recomputeMergedSnapshot();
  for (const l of listeners) l();
}

function emitOnly() {
  recomputeMergedSnapshot();
  for (const l of listeners) l();
}

async function callArenaEdgeFunction<T extends Record<string, unknown>>(
  body: Record<string, unknown>,
  adminPassword?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_PUBLISHABLE_KEY,
  };
  const pwd = adminPassword ?? getSavedAdminPassword();
  if (pwd) {
    headers['x-admin-password'] = pwd;
  }

  const resp = await fetch(EDGE_FN_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = (await resp.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || `Edge HTTP ${resp.status}`);
  }
  return data;
}

async function submitRecordViaEdgeFunction(
  rec: BenchmarkRunRecord,
): Promise<{
  status: 'approved' | 'pending';
  message: string;
  auditSummary?: string;
  reportUpdateToken?: string;
}> {
  const savedTicket = getSavedTicket();
  const runToken = savedTicket?.seedId === rec.seedId ? savedTicket.runToken : '';

  const payload = {
    action: 'submit_run',
    runToken,
    debugToolCallsCount: rec.debugToolCallsCount ?? 0,
    actionTrace: rec.actionTrace ?? [],
    runReport: rec.runReport ?? null,
    record: {
      client_run_id: rec.id.slice(0, 80),
      model_name: (rec.modelName || 'Unknown-Model').trim().slice(0, 80),
      player_tag: rec.playerTag?.trim() ? rec.playerTag.trim().slice(0, 32) : null,
      seed_id: (rec.seedId || 'RG-CBD-DEFAULT').trim().slice(0, 48),
      theme_name: (rec.themeName || '默认城市沙盘').trim().slice(0, 120),
      share_world_token:
        rec.shareWorldToken && rec.shareWorldToken.length <= 12000 ? rec.shareWorldToken : null,
      blind_mode: Boolean(rec.blindMode),
      elapsed_minutes: clampInt(Math.max(1, rec.elapsedMinutes), 1, 180),
      arena_score: clampInt(rec.arenaScore, 0, 20000),
      wallet_yuan: Number(Math.max(0, Math.min(5000, rec.walletYuan)).toFixed(2)),
      deliveries_completed: clampInt(rec.deliveriesCompleted, 0, 60),
      on_time_rate_pct: clampInt(rec.onTimeRatePct, 0, 100),
      damaged_count: clampInt(rec.damagedCount, 0, 60),
      traps_defended_count: clampInt(rec.trapsDefendedCount, 0, 30),
      total_tool_calls: clampInt(rec.totalToolCalls, 0, 400),
      failed_tool_calls: clampInt(rec.failedToolCalls, 0, 400),
      safe_detours_count: clampInt(rec.safeDetoursCount, 0, 100),
      hazards_hit_count: clampInt(rec.hazardsHitCount ?? 0, 0, 100),
      total_tokens: clampInt(rec.totalTokens, 0, 5000000),
      radar_profit_roi: clampInt(rec.radar.profitRoi, 0, 100),
      radar_routing_sla: clampInt(rec.radar.routingSla, 0, 100),
      radar_risk_control: clampInt(rec.radar.riskControl, 0, 100),
      radar_security_defense: clampInt(rec.radar.securityDefense, 0, 100),
      radar_tool_precision: clampInt(rec.radar.toolPrecision, 0, 100),
      radar_token_efficiency: clampInt(rec.radar.tokenEfficiency, 0, 100),
      radar_overall_avg: clampInt(rec.radar.overallAvg, 0, 100),
    },
  };

  const res = await callArenaEdgeFunction<{
    status: 'approved' | 'pending';
    message: string;
    auditSummary?: string;
    reportUpdateToken?: string;
  }>(payload);

  // Clear consumed one-time ticket and immediately prefetch a fresh ticket if shift resets
  if (savedTicket?.seedId === rec.seedId) {
    setSavedTicket(null);
  }
  return res;
}

export const benchmarkStore = {
  getRecords(): BenchmarkRunRecord[] {
    return mergedSnapshot;
  },

  getCloudStatus(): CloudLeaderboardStatus {
    return cloudStatus;
  },

  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  /**
   * Requests a cryptographic HMAC-signed start ticket for the current seed so completed runs
   * pass server-side anti-replay & real play-duration verification!
   */
  async ensureRunTicket(seedId: string): Promise<void> {
    if (typeof window === 'undefined' || !seedId) return;
    const cur = getSavedTicket();
    if (cur && cur.seedId === seedId && cur.runToken) return;
    if (ticketInFlightSeed === seedId) return;

    ticketInFlightSeed = seedId;
    try {
      const res = await callArenaEdgeFunction<{ runToken: string }>({
        action: 'issue_ticket',
        seedId,
      });
      if (res.runToken) {
        setSavedTicket({ seedId, runToken: res.runToken });
      }
    } catch {
      // Non-fatal: will retry on next action if offline
    } finally {
      if (ticketInFlightSeed === seedId) {
        ticketInFlightSeed = null;
      }
    }
  },

  /**
   * Fetches ONLY `status = 'approved'` public benchmark runs via PostgREST RLS!
   */
  async fetchCloudLeaderboard(seedFilter?: string): Promise<void> {
    if (typeof window === 'undefined') return;
    cloudStatus = { ...cloudStatus, loading: true, error: null };
    emitOnly();

    try {
      const seedParam = seedFilter?.trim()
        ? `&seed_id=eq.${encodeURIComponent(seedFilter.trim())}`
        : '';
      const url = `${SUPABASE_URL}/rest/v1/benchmark_runs?select=*&order=arena_score.desc,created_at.desc&limit=100${seedParam}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { apikey: SUPABASE_PUBLISHABLE_KEY },
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const rows = (await resp.json()) as SupabaseBenchmarkRow[];
      const localIds = new Set(localRecords.map((r) => r.id));
      cloudRecords = Array.isArray(rows)
        ? rows.map((row) => mapSupabaseRowToRecord(row, localIds))
        : [];

      const approvedIds = new Set(cloudRecords.map((r) => r.id));
      localRecords = localRecords.map((lr) =>
        approvedIds.has(lr.id)
          ? { ...lr, syncedToCloud: true, moderationStatus: 'approved' }
          : lr,
      );

      cloudStatus = {
        ...cloudStatus,
        loading: false,
        connected: true,
        lastSyncedAt: new Date().toTimeString().slice(0, 8),
        error: null,
        cloudCount: cloudRecords.length,
      };
      saveLocalAndEmit();
    } catch (err) {
      cloudStatus = {
        ...cloudStatus,
        loading: false,
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      };
      emitOnly();
    }
  },

  /**
   * Saves a run locally and submits eligible 180-min zero-cheat runs (or Admin runs)
   * through the anti-cheat Edge Function into the moderation queue!
   */
  recordRun(params: {
    modelName: string;
    playerTag?: string;
    seedId: string;
    themeName: string;
    worldMap?: WorldMapConfig;
    orders?: DeliveryOrder[];
    blindMode: boolean;
    shift: GameShiftState;
    rider: RiderProfile;
    totalTokens: number;
    usage?: ResponseUsageMetrics;
  }): BenchmarkRunRecord {
    const radar = computeSixDimensionScores({
      shift: params.shift,
      rider: params.rider,
      totalTokens: params.totalTokens,
    });

    const usageMetrics: ResponseUsageMetrics = params.usage ?? {
      inputTokens: params.totalTokens,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: params.totalTokens,
    };

    const initialReport = buildHardTelemetryReport({
      modelName: params.modelName,
      blindMode: params.blindMode,
      shift: params.shift,
      rider: params.rider,
      orders: params.orders ?? nexusStore.getState().orders,
      usage: usageMetrics,
    });

    const isAdminUnlocked = Boolean(getSavedAdminPassword());
    const eligibleForCloud =
      isAdminUnlocked ||
      (params.shift.elapsedMinutes >= 180 && (params.shift.debugToolCallsCount ?? 0) === 0);

    const entry: BenchmarkRunRecord = {
      id: `BM-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      recordedAt: new Date().toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
      modelName: params.modelName,
      playerTag: params.playerTag?.trim() || undefined,
      seedId: params.seedId,
      themeName: params.themeName,
      blindMode: params.blindMode,
      elapsedMinutes: Math.max(1, params.shift.elapsedMinutes),
      arenaScore: params.shift.arenaScore,
      walletYuan: params.rider.walletYuan,
      deliveriesCompleted: Math.max(0, params.rider.completedToday - 2),
      onTimeRatePct: params.rider.onTimeRatePct,
      damagedCount: params.shift.damagedCount,
      trapsDefendedCount: params.shift.trapsDefendedCount,
      totalToolCalls: params.shift.totalToolCalls,
      failedToolCalls: params.shift.failedToolCalls,
      safeDetoursCount: params.shift.safeDetoursCount,
      hazardsHitCount: params.shift.hazardsHitCount,
      debugToolCallsCount: params.shift.debugToolCallsCount ?? 0,
      actionTrace: params.shift.actionTrace ?? [],
      totalTokens: params.totalTokens,
      radar,
      runReport: initialReport,
      syncedToCloud: false,
      moderationStatus: eligibleForCloud ? 'pending' : 'local_only',
      isLocalOwner: true,
    };

    localRecords = [entry, ...localRecords].slice(0, 60);
    saveLocalAndEmit();

    // Background helper to upgrade judge report via World Director LLM if enabled
    const tryUpgradeWithWorldLlm = async (targetId: string, updateToken?: string) => {
      const wCfg = worldModelStore.getState();
      if (!wCfg.enabled || !wCfg.apiKey.trim()) return;
      try {
        const curRec = mergedSnapshot.find((r) => r.id === targetId);
        if (!curRec?.runReport) return;
        const llmJudge = await generateWorldModelJudgeEvaluation({
          modelName: curRec.modelName,
          seedId: curRec.seedId,
          themeName: curRec.themeName,
          blindMode: curRec.blindMode,
          arenaScore: curRec.arenaScore,
          walletYuan: curRec.walletYuan,
          deliveriesCompleted: curRec.deliveriesCompleted,
          totalToolCalls: curRec.totalToolCalls,
          failedToolCalls: curRec.failedToolCalls,
          totalTokens: curRec.totalTokens,
          radar: curRec.radar,
          hardReport: curRec.runReport,
        });
        const nextReport: BenchmarkHardReport = {
          ...curRec.runReport,
          judgeEvaluation: llmJudge,
        };
        localRecords = localRecords.map((r) =>
          r.id === targetId ? { ...r, runReport: nextReport } : r,
        );
        saveLocalAndEmit();

        if (updateToken || getSavedAdminPassword()) {
          await callArenaEdgeFunction({
            action: 'attach_report',
            clientRunId: targetId,
            reportUpdateToken: updateToken ?? '',
            runReport: nextReport,
          });
          await this.fetchCloudLeaderboard();
        }
      } catch {
        // Keep rule-based judge evaluation on failure
      }
    };

    if (!eligibleForCloud) {
      const reason =
        (params.shift.debugToolCallsCount ?? 0) > 0
          ? '本局使用了 debug 调试工具，仅保存在浏览器本地（不提交公共云榜）'
          : '未满 180 分钟完赛局仅保存在浏览器本地（跑满 180 分钟零作弊局将自动提交云端审核）';
      cloudStatus = { ...cloudStatus, lastSubmitNotice: reason };
      emitOnly();
      void tryUpgradeWithWorldLlm(entry.id);
      return entry;
    }

    void (async () => {
      try {
        cloudStatus = { ...cloudStatus, syncing: true, error: null, lastSubmitNotice: null };
        emitOnly();

        let shareToken: string | undefined;
        if (params.worldMap) {
          try {
            shareToken = await encodeWorldToShareSeed(params.worldMap, params.orders ?? []);
          } catch {
            // Ignore compression error
          }
        }
        const enriched: BenchmarkRunRecord = { ...entry, shareWorldToken: shareToken };
        const res = await submitRecordViaEdgeFunction(enriched);

        localRecords = localRecords.map((r) =>
          r.id === entry.id
            ? {
                ...enriched,
                syncedToCloud: true,
                moderationStatus: res.status,
                auditSummary: res.auditSummary,
                reportUpdateToken: res.reportUpdateToken,
              }
            : r,
        );
        cloudStatus = {
          ...cloudStatus,
          syncing: false,
          connected: true,
          lastSubmitNotice: res.message,
        };
        saveLocalAndEmit();
        await this.fetchCloudLeaderboard();
        await tryUpgradeWithWorldLlm(entry.id, res.reportUpdateToken);
      } catch (err) {
        cloudStatus = {
          ...cloudStatus,
          syncing: false,
          error: err instanceof Error ? err.message : String(err),
        };
        emitOnly();
        void tryUpgradeWithWorldLlm(entry.id);
      }
    })();

    return entry;
  },

  /**
   * Manually invokes the World Director LLM Judge on an existing record and syncs updated `run_report`!
   */
  async regenerateWorldJudgeReport(recId: string, signal?: AbortSignal): Promise<void> {
    const target = mergedSnapshot.find((r) => r.id === recId);
    if (!target?.runReport) {
      throw new Error('该条旧记录未包含遥测账本数据');
    }
    const llmJudge = await generateWorldModelJudgeEvaluation({
      modelName: target.modelName,
      seedId: target.seedId,
      themeName: target.themeName,
      blindMode: target.blindMode,
      arenaScore: target.arenaScore,
      walletYuan: target.walletYuan,
      deliveriesCompleted: target.deliveriesCompleted,
      totalToolCalls: target.totalToolCalls,
      failedToolCalls: target.failedToolCalls,
      totalTokens: target.totalTokens,
      radar: target.radar,
      hardReport: target.runReport,
      signal,
    });

    const nextReport: BenchmarkHardReport = {
      ...target.runReport,
      judgeEvaluation: llmJudge,
    };

    localRecords = localRecords.map((r) =>
      r.id === recId ? { ...r, runReport: nextReport } : r,
    );
    cloudRecords = cloudRecords.map((r) =>
      r.id === recId ? { ...r, runReport: nextReport } : r,
    );
    saveLocalAndEmit();

    const localMatch = localRecords.find((r) => r.id === recId);
    if (target.syncedToCloud && (localMatch?.reportUpdateToken || getSavedAdminPassword())) {
      await callArenaEdgeFunction({
        action: 'attach_report',
        clientRunId: recId,
        reportUpdateToken: localMatch?.reportUpdateToken ?? '',
        runReport: nextReport,
      });
      await this.fetchCloudLeaderboard();
    }
  },

  /**
   * Syncs local unsynced records (when Admin is unlocked, allows importing historical local records directly to approved!)
   */
  async syncUnsyncedLocalRecordsToCloud(): Promise<{ uploaded: number }> {
    const isAdmin = Boolean(getSavedAdminPassword());
    const unsynced = localRecords.filter(
      (r) => !r.syncedToCloud && (isAdmin || (r.elapsedMinutes >= 180 && (r.debugToolCallsCount ?? 0) === 0)),
    );
    if (unsynced.length === 0) {
      await this.fetchCloudLeaderboard();
      return { uploaded: 0 };
    }

    cloudStatus = { ...cloudStatus, syncing: true, error: null };
    emitOnly();

    let uploaded = 0;
    for (const rec of unsynced) {
      try {
        const res = await submitRecordViaEdgeFunction(rec);
        uploaded += 1;
        localRecords = localRecords.map((r) =>
          r.id === rec.id
            ? { ...r, syncedToCloud: true, moderationStatus: res.status, auditSummary: res.auditSummary }
            : r,
        );
      } catch (err) {
        cloudStatus = {
          ...cloudStatus,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    cloudStatus = { ...cloudStatus, syncing: false };
    saveLocalAndEmit();
    await this.fetchCloudLeaderboard();
    return { uploaded };
  },

  deleteLocalRecord(id: string) {
    localRecords = localRecords.filter((r) => r.id !== id);
    saveLocalAndEmit();
  },

  // --- Admin Moderation & Cleanup API ---

  async checkAdminStatus(): Promise<{ initialized: boolean }> {
    const res = await callArenaEdgeFunction<{ initialized: boolean }>({
      action: 'admin_status',
    });
    return { initialized: Boolean(res.initialized) };
  },

  async setupInitialAdminPassword(bootstrapCode: string, newPassword: string): Promise<string> {
    const res = await callArenaEdgeFunction<{ message: string }>({
      action: 'admin_setup',
      bootstrapCode,
      newPassword,
    });
    setSavedAdminPassword(newPassword);
    return res.message;
  },

  async fetchAdminLists(passwordOverride?: string): Promise<{
    pendingRuns: BenchmarkRunRecord[];
    approvedRuns: BenchmarkRunRecord[];
  }> {
    const res = await callArenaEdgeFunction<{
      pendingRuns: SupabaseBenchmarkRow[];
      approvedRuns: SupabaseBenchmarkRow[];
    }>({ action: 'admin_list' }, passwordOverride);

    if (passwordOverride) {
      setSavedAdminPassword(passwordOverride);
    }

    return {
      pendingRuns: (res.pendingRuns ?? []).map((r) => mapSupabaseRowToRecord(r)),
      approvedRuns: (res.approvedRuns ?? []).map((r) => mapSupabaseRowToRecord(r)),
    };
  },

  async adminModerate(params: {
    op:
      | 'approve'
      | 'approve_all_pending'
      | 'delete'
      | 'purge_pending'
      | 'clear_approved'
      | 'change_password';
    clientRunId?: string;
    newPassword?: string;
  }): Promise<string> {
    const res = await callArenaEdgeFunction<{ message: string }>({
      action: 'admin_moderate',
      ...params,
    });
    if (params.op === 'change_password' && params.newPassword) {
      setSavedAdminPassword(params.newPassword);
    }
    if (params.op === 'delete' && params.clientRunId) {
      localRecords = localRecords.filter((r) => r.id !== params.clientRunId);
      saveLocalAndEmit();
    }
    await this.fetchCloudLeaderboard();
    return res.message;
  },
};

export function useBenchmarkRecords(): BenchmarkRunRecord[] {
  return useSyncExternalStore(
    benchmarkStore.subscribe,
    benchmarkStore.getRecords,
    benchmarkStore.getRecords,
  );
}

export function useCloudLeaderboardStatus(): CloudLeaderboardStatus {
  return useSyncExternalStore(
    benchmarkStore.subscribe,
    benchmarkStore.getCloudStatus,
    benchmarkStore.getCloudStatus,
  );
}

// Initialize cloud leaderboard fetch & automatic shift run-ticket watcher!
if (typeof window !== 'undefined') {
  void benchmarkStore.fetchCloudLeaderboard();
  void benchmarkStore.ensureRunTicket(nexusStore.getState().worldMap.seedId);

  let prevSeed = nexusStore.getState().worldMap.seedId;
  let prevElapsed = nexusStore.getState().shift.elapsedMinutes;
  nexusStore.subscribe(() => {
    const s = nexusStore.getState();
    const curSeed = s.worldMap.seedId;
    const curElapsed = s.shift.elapsedMinutes;
    if (curSeed !== prevSeed || (curElapsed === 0 && prevElapsed > 0)) {
      prevSeed = curSeed;
      prevElapsed = curElapsed;
      setSavedTicket(null);
      void benchmarkStore.ensureRunTicket(curSeed);
    } else {
      prevElapsed = curElapsed;
    }
  });
}

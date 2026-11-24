import React, { useEffect, useState } from 'react';
import {
  Award,
  BookmarkPlus,
  Cloud,
  CloudUpload,
  Filter,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Swords,
  Target,
  Trophy,
  X,
} from 'lucide-react';
import {
  type BenchmarkRunRecord,
  benchmarkStore,
  computeSixDimensionScores,
  type SixDimensionScores,
  useBenchmarkRecords,
  useCloudLeaderboardStatus,
} from '../store/benchmarkStore';
import { useNexusStore } from '../store/nexusStore';
import { responsesSession } from '../webmcp/responsesSessionManager';
import { importWorldFromSeedOrUrl } from '../webmcp/worldDirector';

const RADAR_AXES: Array<{ key: keyof Omit<SixDimensionScores, 'overallAvg'>; label: string }> = [
  { key: 'profitRoi', label: '收益经营ROI' },
  { key: 'routingSla', label: '顺路与准时' },
  { key: 'riskControl', label: '防洒与续航' },
  { key: 'securityDefense', label: '反注入安全' },
  { key: 'toolPrecision', label: '工具精准度' },
  { key: 'tokenEfficiency', label: 'Token性价比' },
];

function polarPoint(cx: number, cy: number, radius: number, index: number, total = 6) {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

const SixDimRadarSvg: React.FC<{
  scores: SixDimensionScores;
  compareScores?: SixDimensionScores | null;
}> = ({ scores, compareScores }) => {
  const cx = 135;
  const cy = 122;
  const maxR = 78;

  const buildPolygon = (s: SixDimensionScores) =>
    RADAR_AXES.map((ax, i) => {
      const val = Math.max(8, Math.min(100, s[ax.key]));
      const p = polarPoint(cx, cy, (val / 100) * maxR, i);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

  return (
    <svg viewBox="0 0 270 245" className="mx-auto h-56 w-full max-w-[290px]">
      {[0.25, 0.5, 0.75, 1].map((lv) => {
        const ringPts = RADAR_AXES.map((_, i) => {
          const p = polarPoint(cx, cy, maxR * lv, i);
          return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
        }).join(' ');
        return (
          <polygon
            key={lv}
            points={ringPts}
            fill="none"
            stroke="rgba(100, 116, 139, 0.3)"
            strokeWidth="1"
          />
        );
      })}

      {RADAR_AXES.map((ax, i) => {
        const outer = polarPoint(cx, cy, maxR, i);
        const labelPos = polarPoint(cx, cy, maxR + 24, i);
        return (
          <g key={ax.key}>
            <line
              x1={cx}
              y1={cy}
              x2={outer.x}
              y2={outer.y}
              stroke="rgba(100, 116, 139, 0.35)"
              strokeWidth="1"
            />
            <text
              x={labelPos.x}
              y={labelPos.y + 3}
              textAnchor="middle"
              fill="#cbd5e1"
              fontSize="10"
              fontWeight="600"
            >
              {ax.label}
            </text>
          </g>
        );
      })}

      {compareScores && (
        <polygon
          points={buildPolygon(compareScores)}
          fill="rgba(16, 185, 129, 0.16)"
          stroke="#10b981"
          strokeWidth="1.8"
          strokeDasharray="4 3"
        />
      )}

      <polygon
        points={buildPolygon(scores)}
        fill="rgba(245, 158, 11, 0.25)"
        stroke="#fbbf24"
        strokeWidth="2.2"
      />

      {RADAR_AXES.map((ax, i) => {
        const p = polarPoint(cx, cy, (scores[ax.key] / 100) * maxR, i);
        return <circle key={ax.key} cx={p.x} cy={p.y} r={3.5} fill="#fbbf24" />;
      })}
    </svg>
  );
};

interface Props {
  open: boolean;
  onClose: () => void;
  activeRiderModelLabel: string;
}

export const BenchmarkLeaderboardModal: React.FC<Props> = ({
  open,
  onClose,
  activeRiderModelLabel,
}) => {
  const worldMap = useNexusStore((s) => s.worldMap);
  const orders = useNexusStore((s) => s.orders);
  const shift = useNexusStore((s) => s.shift);
  const rider = useNexusStore((s) => s.rider);
  const blindMode = useNexusStore((s) => s.benchmarkBlindMode);

  const allRecords = useBenchmarkRecords();
  const cloudStatus = useCloudLeaderboardStatus();

  const [sameSeedOnly, setSameSeedOnly] = useState(false);
  const [blindOnly, setBlindOnly] = useState(false);
  const [compareRecord, setCompareRecord] = useState<BenchmarkRunRecord | null>(null);
  const [customModelTag, setCustomModelTag] = useState('');
  const [playerTag, setPlayerTag] = useState('');
  const [justSavedToast, setJustSavedToast] = useState<string | null>(null);
  const [challengingId, setChallengingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void benchmarkStore.fetchCloudLeaderboard();
    }
  }, [open]);

  if (!open) return null;

  const totalTokens = responsesSession.getState().cumulativeUsage.totalTokens;
  const liveRadar = computeSixDimensionScores({ shift, rider, totalTokens });

  const unsyncedCount = allRecords.filter((r) => r.isLocalOwner && !r.syncedToCloud).length;

  const filteredRecords = allRecords
    .filter((r) => (!sameSeedOnly ? true : r.seedId === worldMap.seedId))
    .filter((r) => (!blindOnly ? true : r.blindMode))
    .sort((a, b) => b.arenaScore - a.arenaScore);

  const precisionPct =
    shift.totalToolCalls > 0
      ? Math.round(
          ((shift.totalToolCalls - shift.failedToolCalls) / shift.totalToolCalls) * 100,
        )
      : 100;

  const handleSaveCurrentRun = () => {
    if (shift.elapsedMinutes < 1) {
      setJustSavedToast('请至少推进 1 分钟以上游戏进度后再提交上榜（建议跑满 180 分钟完整局）！');
      window.setTimeout(() => setJustSavedToast(null), 3500);
      return;
    }
    const label = customModelTag.trim() || activeRiderModelLabel;
    const saved = benchmarkStore.recordRun({
      modelName: label,
      playerTag: playerTag.trim() || undefined,
      seedId: worldMap.seedId,
      themeName: worldMap.themeName,
      worldMap,
      orders,
      blindMode,
      shift,
      rider,
      totalTokens,
    });
    setJustSavedToast(
      `已将「${saved.modelName}」在种子 [${saved.seedId}] 下的战绩 (${saved.arenaScore}分) 自动同步至全网云端排行榜！`,
    );
    window.setTimeout(() => setJustSavedToast(null), 4000);
  };

  const handleSyncUnsynced = async () => {
    const res = await benchmarkStore.syncUnsyncedLocalRecordsToCloud();
    setJustSavedToast(
      res.uploaded > 0
        ? `已成功将本地 ${res.uploaded} 条历史评测战绩同步至云端公共榜单！`
        : '所有有效战绩均已与云端同步！',
    );
    window.setTimeout(() => setJustSavedToast(null), 3500);
  };

  const handleChallengeSameWorld = async (rec: BenchmarkRunRecord, e: React.MouseEvent) => {
    e.stopPropagation();
    setChallengingId(rec.id);
    try {
      await importWorldFromSeedOrUrl(rec.shareWorldToken || rec.seedId, {
        syncUrlHash: true,
      });
      setCompareRecord(rec);
      setJustSavedToast(
        `已载入「${rec.themeName}」(${rec.seedId}) 同款地图与事件种子！现在可派你的模型出战 PK！`,
      );
      window.setTimeout(() => {
        setJustSavedToast(null);
        onClose();
      }, 900);
    } catch (err) {
      setJustSavedToast(`载入同款种子失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setChallengingId(null);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Trophy className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white">
                全网云端大模型评测排行榜 &amp; 六维能力雷达卡
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  cloudStatus.connected
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                }`}
              >
                <Cloud className="h-3 w-3" />
                {cloudStatus.loading || cloudStatus.syncing
                  ? 'Supabase 云端同步中...'
                  : cloudStatus.connected
                    ? `云端实时已连线 (${cloudStatus.cloudCount} 条全网记录)`
                    : '云端连接中'}
              </span>
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                当前种子: {worldMap.seedId}
              </span>
              {blindMode && (
                <span className="rounded-full border border-rose-500/45 bg-rose-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                  🎯 硬核盲测模式
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              战绩实时存储于 Supabase 云端公共库，所有人打开网页均可查看全网排行，并可点击任意战绩右侧【⚡ 挑战同款地图】一键复现完全相同的地图与事件进行公平对决！
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 text-xs">
          {/* Top Grid: 6D Radar + Live Telemetry Metrics */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Radar Card */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 lg:col-span-5">
              <div className="flex items-center justify-between">
                <span className="font-bold text-amber-300">当前局六维能力雷达</span>
                <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                  综合能力 {liveRadar.overallAvg}/100
                </span>
              </div>

              <SixDimRadarSvg scores={liveRadar} compareScores={compareRecord?.radar} />

              {compareRecord ? (
                <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/30 px-2.5 py-1 text-[11px] text-emerald-200">
                  <span className="truncate">
                    绿虚线对比：{compareRecord.modelName} ({compareRecord.arenaScore}分)
                  </span>
                  <button
                    type="button"
                    onClick={() => setCompareRecord(null)}
                    className="ml-2 shrink-0 text-slate-400 hover:text-white"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <div className="text-center text-[11px] text-slate-500">
                  点击下方云端榜单任意一行，即可在雷达图叠加绿色虚线对比
                </div>
              )}
            </div>

            {/* Detailed Telemetry & Upload to Cloud Bar */}
            <div className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-950/90 p-4 lg:col-span-7">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-bold text-white">
                    实时评测遥测指标（当前模型：{activeRiderModelLabel}）
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    进度：{shift.elapsedMinutes}/180 分钟
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">竞技总分 (Arena Score)</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-amber-300">
                      {shift.arenaScore} 分
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">工具调用精准度</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-sky-300">
                      {precisionPct}%{' '}
                      <span className="text-[11px] font-normal text-slate-400">
                        ({shift.totalToolCalls - shift.failedToolCalls}/{shift.totalToolCalls})
                      </span>
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">本局净钱包 / 完单</div>
                    <div className="mt-0.5 font-mono text-base font-bold text-emerald-300">
                      ¥{rider.walletYuan.toFixed(1)} · {Math.max(0, rider.completedToday - 2)}单
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">安全绕行 / 闯危险区</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-indigo-300">
                      绕行 {shift.safeDetoursCount} 次 · 闯险 {shift.hazardsHitCount} 次
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">严重餐损 / 电量抛锚</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-rose-300">
                      餐损 {shift.damagedCount} 单 · 抛锚 {shift.batteryBreakdownsCount} 次
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                    <div className="text-[11px] text-slate-400">识破注入 / 累计 Token</div>
                    <div className="mt-0.5 font-mono text-sm font-bold text-purple-300">
                      防注入 {shift.trapsDefendedCount} 次 ·{' '}
                      {totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k` : '0'} tok
                    </div>
                  </div>
                </div>

                {/* 6 Dimension Score Bars */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1 sm:grid-cols-3">
                  {RADAR_AXES.map((ax) => (
                    <div key={ax.key} className="space-y-0.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-slate-400">{ax.label}</span>
                        <span className="font-mono font-bold text-slate-200">
                          {liveRadar[ax.key]}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${liveRadar[ax.key]}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Save & Upload Run to Cloud Leaderboard Bar */}
              <div className="mt-4 border-t border-slate-800 pt-3">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={customModelTag}
                    onChange={(e) => setCustomModelTag(e.target.value)}
                    placeholder={`上榜模型名（默认: ${activeRiderModelLabel}）`}
                    className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100"
                  />
                  <input
                    type="text"
                    value={playerTag}
                    onChange={(e) => setPlayerTag(e.target.value)}
                    placeholder="测试者署名(选填)"
                    className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
                  />
                  <button
                    type="button"
                    disabled={cloudStatus.syncing}
                    onClick={handleSaveCurrentRun}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                  >
                    <BookmarkPlus className="h-3.5 w-3.5" />
                    上传当前战绩上云榜
                  </button>
                </div>
                {justSavedToast && (
                  <p className="mt-2 text-[11px] font-medium text-emerald-300">
                    ✓ {justSavedToast}
                  </p>
                )}
                {cloudStatus.error && (
                  <p className="mt-1.5 text-[11px] text-rose-300">
                    云端同步提示：{cloudStatus.error}（本地已自动备份）
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom: Global Cloud Leaderboard Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-400" />
                <span className="font-bold text-white">
                  全网实时公共排行榜（自动汇集所有玩家跑完上传的大模型成绩）
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {unsyncedCount > 0 && (
                  <button
                    type="button"
                    disabled={cloudStatus.syncing}
                    onClick={() => void handleSyncUnsynced()}
                    className="inline-flex items-center gap-1 rounded-lg border border-sky-500/45 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-200 hover:bg-sky-500/25"
                  >
                    <CloudUpload className="h-3 w-3" />
                    同步本地历史 ({unsyncedCount})
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setSameSeedOnly((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                    sameSeedOnly
                      ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  <Filter className="h-3 w-3" />
                  {sameSeedOnly ? `仅看当前种子 (${worldMap.seedId})` : '全网全部种子总榜'}
                </button>
                <button
                  type="button"
                  onClick={() => setBlindOnly((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                    blindOnly
                      ? 'border-rose-500/45 bg-rose-500/15 text-rose-200'
                      : 'border-slate-700 bg-slate-900 text-slate-300 hover:text-white'
                  }`}
                >
                  <Target className="h-3 w-3" />
                  {blindOnly ? '仅看硬核盲测' : '全部模式'}
                </button>
                <button
                  type="button"
                  disabled={cloudStatus.loading}
                  onClick={() => void benchmarkStore.fetchCloudLeaderboard()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
                >
                  <RefreshCw className={`h-3 w-3 ${cloudStatus.loading ? 'animate-spin' : ''}`} />
                  刷新云榜
                </button>
              </div>
            </div>

            {cloudStatus.loading && filteredRecords.length === 0 ? (
              <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-800 py-10 text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
                正在从 Supabase 云端拉取全网大模型战绩...
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-slate-400">
                {sameSeedOnly
                  ? `种子 [${worldMap.seedId}] 暂无云端记录（可切换右上方「全网全部种子总榜」查看其它地图战绩，或跑完本局拿下首杀榜首！）`
                  : '云端排行榜虚位以待！跑完 180 分钟班次将自动上云，或点击上方【上传当前战绩上云榜】抢占首个席位！'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-2 pr-2">排名</th>
                      <th className="pb-2 pr-3">评测模型 / 提交者</th>
                      <th className="pb-2 pr-2">模式 / 世界种子</th>
                      <th className="pb-2 pr-2">总分</th>
                      <th className="pb-2 pr-2">六维均分</th>
                      <th className="pb-2 pr-2">完单 / 准时</th>
                      <th className="pb-2 pr-2">精准度</th>
                      <th className="pb-2 pr-2">净钱包</th>
                      <th className="pb-2 pr-2">Tokens</th>
                      <th className="pb-2 text-right">同图挑战</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filteredRecords.map((rec, idx) => {
                      const isComparing = compareRecord?.id === rec.id;
                      const isCurrentSeed = rec.seedId === worldMap.seedId;
                      const toolAcc =
                        rec.totalToolCalls > 0
                          ? Math.round(
                              ((rec.totalToolCalls - rec.failedToolCalls) / rec.totalToolCalls) *
                                100,
                            )
                          : 100;
                      return (
                        <tr
                          key={rec.id}
                          onClick={() => setCompareRecord(isComparing ? null : rec)}
                          className={`cursor-pointer transition ${
                            isComparing
                              ? 'bg-emerald-500/15 text-white'
                              : 'text-slate-200 hover:bg-slate-900/90'
                          }`}
                        >
                          <td className="py-2.5 pr-2 font-mono font-bold text-amber-300">
                            #{idx + 1}
                          </td>
                          <td className="py-2.5 pr-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-white">{rec.modelName}</span>
                              {rec.playerTag && (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                  @{rec.playerTag}
                                </span>
                              )}
                              {rec.syncedToCloud ? (
                                <span className="rounded bg-emerald-500/15 px-1 py-0.2 text-[9px] text-emerald-300">
                                  ☁️云端
                                </span>
                              ) : (
                                <span className="rounded bg-amber-500/15 px-1 py-0.2 text-[9px] text-amber-300">
                                  待同步
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {rec.recordedAt} · 跑满 {rec.elapsedMinutes}m · {rec.themeName}
                            </div>
                          </td>
                          <td className="py-2.5 pr-2">
                            <div className="flex flex-wrap items-center gap-1">
                              {rec.blindMode ? (
                                <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/20 px-1.5 py-0.2 text-[10px] text-rose-300">
                                  <Target className="h-2.5 w-2.5" />
                                  盲测
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.2 text-[10px] text-slate-300">
                                  <ShieldCheck className="h-2.5 w-2.5" />
                                  辅助
                                </span>
                              )}
                              <span
                                className={`font-mono text-[10px] ${
                                  isCurrentSeed ? 'font-bold text-emerald-300' : 'text-slate-400'
                                }`}
                              >
                                {rec.seedId}
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-xs font-bold text-amber-300">
                            {rec.arenaScore}
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-indigo-300">
                            {rec.radar.overallAvg}/100
                          </td>
                          <td className="py-2.5 pr-2 font-mono">
                            {rec.deliveriesCompleted}单 · {rec.onTimeRatePct}%
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-sky-300">{toolAcc}%</td>
                          <td className="py-2.5 pr-2 font-mono text-emerald-300">
                            ¥{rec.walletYuan.toFixed(1)}
                          </td>
                          <td className="py-2.5 pr-2 font-mono text-slate-400">
                            {rec.totalTokens > 0 ? `${(rec.totalTokens / 1000).toFixed(1)}k` : '-'}
                          </td>
                          <td className="py-2.5 text-right">
                            <button
                              type="button"
                              disabled={challengingId === rec.id}
                              onClick={(e) => void handleChallengeSameWorld(rec, e)}
                              title="一键载入该条记录同款地图、订单与局中事件种子，用你的模型同场对决！"
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-indigo-500/45 bg-indigo-500/15 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-500/30"
                            >
                              <Swords className="h-3 w-3 text-indigo-300" />
                              {challengingId === rec.id ? '载入中...' : '挑战同款种子'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

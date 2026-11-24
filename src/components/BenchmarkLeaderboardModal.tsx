import React, { useEffect, useState } from 'react';
import {
  Award,
  BookmarkPlus,
  Check,
  Cloud,
  CloudUpload,
  Filter,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Swords,
  Target,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import {
  type BenchmarkRunRecord,
  benchmarkStore,
  computeSixDimensionScores,
  getSavedAdminPassword,
  setSavedAdminPassword,
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

  // Admin Review & Cleanup Panel State
  const [showAdminDrawer, setShowAdminDrawer] = useState(false);
  const [adminInitialized, setAdminInitialized] = useState<boolean | null>(null);
  const [adminUnlocked, setAdminUnlocked] = useState<boolean>(() => Boolean(getSavedAdminPassword()));
  const [adminBusy, setAdminBusy] = useState(false);
  const [adminFeedback, setAdminFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [bootstrapInput, setBootstrapInput] = useState('');
  const [adminPwdInput, setAdminPwdInput] = useState('');
  const [pendingRuns, setPendingRuns] = useState<BenchmarkRunRecord[]>([]);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  const refreshAdminData = async (pwdOverride?: string) => {
    setAdminBusy(true);
    setAdminFeedback(null);
    try {
      const lists = await benchmarkStore.fetchAdminLists(pwdOverride);
      setPendingRuns(lists.pendingRuns);
      setAdminUnlocked(true);
    } catch (err) {
      setAdminUnlocked(false);
      setSavedAdminPassword('');
      setAdminFeedback({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAdminBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    void benchmarkStore.fetchCloudLeaderboard();
    if (getSavedAdminPassword()) {
      void refreshAdminData();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !showAdminDrawer) return;
    void (async () => {
      try {
        const st = await benchmarkStore.checkAdminStatus();
        setAdminInitialized(st.initialized);
        if (st.initialized && getSavedAdminPassword()) {
          await refreshAdminData();
        }
      } catch (err) {
        setAdminFeedback({
          ok: false,
          text: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }, [open, showAdminDrawer]);

  if (!open) return null;

  const totalTokens = responsesSession.getState().cumulativeUsage.totalTokens;
  const liveRadar = computeSixDimensionScores({ shift, rider, totalTokens });

  const unsyncedCount = allRecords.filter(
    (r) =>
      r.isLocalOwner &&
      !r.syncedToCloud &&
      (adminUnlocked || (r.elapsedMinutes >= 180 && (r.debugToolCallsCount ?? 0) === 0)),
  ).length;

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
      setJustSavedToast('请至少推进 1 分钟以上游戏进度后再记录战绩！');
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
    const note = adminUnlocked
      ? `管理员直通：已将「${saved.modelName}」(${saved.arenaScore}分) 直接公开上榜！`
      : shift.elapsedMinutes >= 180 && (shift.debugToolCallsCount ?? 0) === 0
        ? `已提交「${saved.modelName}」(${saved.arenaScore}分) 进入云端反作弊与管理员待审队列！`
        : `未满 180 分钟或含调试工具，已为您保存在本地榜单。`;
    setJustSavedToast(note);
    window.setTimeout(() => setJustSavedToast(null), 4500);
  };

  const handleSyncUnsynced = async () => {
    const res = await benchmarkStore.syncUnsyncedLocalRecordsToCloud();
    if (adminUnlocked) {
      await refreshAdminData();
    }
    setJustSavedToast(
      res.uploaded > 0
        ? `已成功将本地 ${res.uploaded} 条有效战绩上传至云端！`
        : '暂无符合条件（180分钟完赛且0作弊）的未同步本地记录。',
    );
    window.setTimeout(() => setJustSavedToast(null), 3500);
  };

  const handleAdminSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bootstrapInput.trim() || adminPwdInput.trim().length < 8) {
      setAdminFeedback({ ok: false, text: '请填写首次激活码，并设置至少 8 位的管理员密码' });
      return;
    }
    setAdminBusy(true);
    setAdminFeedback(null);
    try {
      const msg = await benchmarkStore.setupInitialAdminPassword(
        bootstrapInput.trim(),
        adminPwdInput.trim(),
      );
      setAdminInitialized(true);
      setAdminUnlocked(true);
      setBootstrapInput('');
      setAdminPwdInput('');
      setAdminFeedback({ ok: true, text: msg });
      await refreshAdminData();
    } catch (err) {
      setAdminFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAdminBusy(false);
    }
  };

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminPwdInput.trim()) return;
    await refreshAdminData(adminPwdInput.trim());
    setAdminPwdInput('');
  };

  const handleModerateOp = async (
    op: 'approve' | 'approve_all_pending' | 'delete' | 'purge_pending' | 'clear_approved',
    clientRunId?: string,
  ) => {
    setAdminBusy(true);
    setAdminFeedback(null);
    try {
      const msg = await benchmarkStore.adminModerate({ op, clientRunId });
      setConfirmClearAll(false);
      await refreshAdminData();
      setAdminFeedback({ ok: true, text: msg });
    } catch (err) {
      setAdminFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setAdminBusy(false);
    }
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
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-800 px-5 py-3.5">
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
                  ? '云端安全同步中...'
                  : cloudStatus.connected
                    ? `云端已过审公开 (${cloudStatus.cloudCount} 条)`
                    : '云端连接中'}
              </span>
              <span className="rounded-full border border-indigo-500/40 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                当前种子: {worldMap.seedId}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              所有云榜记录均经过**服务端开局加密票据 + IP 限流 + 游戏物理与工具轨迹反作弊核验 + 管理员人工审核**，杜绝伪造刷榜。
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdminDrawer((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                adminUnlocked
                  ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200'
                  : showAdminDrawer
                    ? 'border-amber-500/50 bg-amber-500/15 text-amber-200'
                    : 'border-slate-700 bg-slate-800 text-slate-300 hover:text-white'
              }`}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {adminUnlocked ? `管理后台 (${pendingRuns.length}待审)` : '管理员审核'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 text-xs">
          {/* Collapsible Admin Moderation & Cleanup Console */}
          {showAdminDrawer && (
            <div className="rounded-xl border border-amber-500/40 bg-slate-950/95 p-4 shadow-lg">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-400" />
                  <span className="font-bold text-amber-200">
                    管理员战绩审核与云榜清理后台
                  </span>
                  {adminUnlocked && (
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                      ● 已解锁管理权限（本人跑分自动免审直通上榜）
                    </span>
                  )}
                </div>

                {adminUnlocked && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={adminBusy}
                      onClick={() => void refreshAdminData()}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 hover:text-white"
                    >
                      <RefreshCw className={`h-3 w-3 ${adminBusy ? 'animate-spin' : ''}`} />
                      刷新待审
                    </button>
                    {!confirmClearAll ? (
                      <button
                        type="button"
                        disabled={adminBusy || cloudStatus.cloudCount === 0}
                        onClick={() => setConfirmClearAll(true)}
                        className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"
                      >
                        <Trash2 className="h-3 w-3" />
                        清空整个公开榜
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={adminBusy}
                        onClick={() => void handleModerateOp('clear_approved')}
                        className="inline-flex items-center gap-1 rounded bg-rose-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-rose-500"
                      >
                        确认彻底清空全部公开记录？
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSavedAdminPassword('');
                        setAdminUnlocked(false);
                        setPendingRuns([]);
                      }}
                      className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
                    >
                      <LogOut className="h-3 w-3" />
                      退出管理态
                    </button>
                  </div>
                )}
              </div>

              {!adminUnlocked ? (
                adminInitialized === false ? (
                  <form onSubmit={(e) => void handleAdminSetup(e)} className="mt-3 space-y-2.5">
                    <p className="text-[11px] text-amber-200/90">
                      首次启用管理员后台：请输入一次性初始化激活码，并设置你自己的专属管理员密码（将以 PBKDF2 10万次加密哈希存入服务端私有库，激活码用后即刻销毁）。
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={bootstrapInput}
                        onChange={(e) => setBootstrapInput(e.target.value)}
                        placeholder="一次性初始化激活码 (ARENA-INIT-...)"
                        className="w-60 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100"
                      />
                      <input
                        type="password"
                        value={adminPwdInput}
                        onChange={(e) => setAdminPwdInput(e.target.value)}
                        placeholder="设置专属管理员密码 (至少 8 位)"
                        className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100"
                      />
                      <button
                        type="button"
                        disabled={adminBusy}
                        onClick={(e) => void handleAdminSetup(e as unknown as React.FormEvent)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        完成首次密码绑定
                      </button>
                    </div>
                  </form>
                ) : (
                  <form onSubmit={(e) => void handleAdminLogin(e)} className="mt-3 flex flex-wrap gap-2">
                    <input
                      type="password"
                      value={adminPwdInput}
                      onChange={(e) => setAdminPwdInput(e.target.value)}
                      placeholder="输入管理员密码以审核待审提交或删除云榜记录..."
                      className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100"
                    />
                    <button
                      type="submit"
                      disabled={adminBusy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      {adminBusy ? '验证中...' : '解锁管理员后台'}
                    </button>
                  </form>
                )
              ) : (
                <div className="mt-3 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-200">
                      待审核队列（共 <strong className="text-amber-300">{pendingRuns.length}</strong> 条访客完赛提交）
                    </span>
                    {pendingRuns.length > 0 && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={adminBusy}
                          onClick={() => void handleModerateOp('approve_all_pending')}
                          className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                        >
                          <Check className="h-3 w-3" />
                          一键全部通过 ({pendingRuns.length})
                        </button>
                        <button
                          type="button"
                          disabled={adminBusy}
                          onClick={() => void handleModerateOp('purge_pending')}
                          className="inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-500/25"
                        >
                          <Trash2 className="h-3 w-3" />
                          清空全部待审
                        </button>
                      </div>
                    )}
                  </div>

                  {pendingRuns.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-800 py-4 text-center text-slate-500">
                      当前没有待审核的访客提交（下方公开榜每行右侧也已为您开启「删除」清理按钮）。
                    </div>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
                      {pendingRuns.map((pr) => (
                        <div
                          key={pr.id}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/90 px-3 py-2"
                        >
                          <div className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-bold text-white">{pr.modelName}</span>
                              {pr.playerTag && (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                  @{pr.playerTag}
                                </span>
                              )}
                              <span className="font-mono font-bold text-amber-300">
                                {pr.arenaScore}分
                              </span>
                              <span className="font-mono text-[10px] text-slate-400">
                                Seed:{pr.seedId} · {pr.deliveriesCompleted}单 · ¥{pr.walletYuan.toFixed(1)} · {pr.recordedAt}
                              </span>
                            </div>
                            {pr.auditSummary && (
                              <div className="font-mono text-[10px] text-emerald-300/90">
                                {pr.auditSummary}
                              </div>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={adminBusy}
                              onClick={() => void handleModerateOp('approve', pr.id)}
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                            >
                              <Check className="h-3 w-3" />
                              通过上榜
                            </button>
                            <button
                              type="button"
                              disabled={adminBusy}
                              onClick={() => void handleModerateOp('delete', pr.id)}
                              className="inline-flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] text-rose-300 hover:bg-rose-500/30"
                            >
                              <Trash2 className="h-3 w-3" />
                              驳回删除
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {adminFeedback && (
                <div
                  className={`mt-2.5 rounded-lg border px-3 py-1.5 text-[11px] ${
                    adminFeedback.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                  }`}
                >
                  {adminFeedback.text}
                </div>
              )}
            </div>
          )}

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
                    {(shift.debugToolCallsCount ?? 0) > 0 && (
                      <span className="ml-1.5 text-rose-400">(含调试操作·不计入云榜)</span>
                    )}
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

              {/* Save & Submit Run Bar */}
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
                    {adminUnlocked ? '直通发布上云榜' : '提交战绩申请上榜'}
                  </button>
                </div>
                {(justSavedToast || cloudStatus.lastSubmitNotice) && (
                  <p className="mt-2 text-[11px] font-medium text-emerald-300">
                    ✓ {justSavedToast || cloudStatus.lastSubmitNotice}
                  </p>
                )}
                {cloudStatus.error && (
                  <p className="mt-1.5 text-[11px] text-rose-300">
                    安全网关提示：{cloudStatus.error}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Bottom: Global Approved Cloud Leaderboard Table */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Award className="h-4 w-4 text-amber-400" />
                <span className="font-bold text-white">
                  全网已过审公开排行榜（完赛自动反作弊校验 · 经管理员审核展示）
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
                    同步本地记录 ({unsyncedCount})
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
                正在从 Supabase 云端拉取已审核大模型战绩...
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-800 py-8 text-center text-slate-400">
                当前筛选下暂无已公开记录（跑满 180 分钟后自动提交审核；若你是站长，点击右上角【管理员审核】解锁后跑分可直接上榜！）。
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-2 pr-2">排名</th>
                      <th className="pb-2 pr-3">评测模型 / 状态</th>
                      <th className="pb-2 pr-2">模式 / 世界种子</th>
                      <th className="pb-2 pr-2">总分</th>
                      <th className="pb-2 pr-2">六维均分</th>
                      <th className="pb-2 pr-2">完单 / 准时</th>
                      <th className="pb-2 pr-2">精准度</th>
                      <th className="pb-2 pr-2">净钱包</th>
                      <th className="pb-2 pr-2">Tokens</th>
                      <th className="pb-2 text-right">操作</th>
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
                              {rec.moderationStatus === 'approved' ? (
                                <span className="rounded bg-emerald-500/15 px-1.5 py-0.2 text-[9px] text-emerald-300">
                                  ✓已过审公开
                                </span>
                              ) : rec.moderationStatus === 'pending' ? (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.2 text-[9px] text-amber-300">
                                  ⏳待管理员审核
                                </span>
                              ) : (
                                <span className="rounded bg-slate-800 px-1.5 py-0.2 text-[9px] text-slate-400">
                                  📌仅本地可见
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 text-[10px] text-slate-500">
                              {rec.recordedAt} · {rec.elapsedMinutes}m · {rec.themeName}
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
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                disabled={challengingId === rec.id}
                                onClick={(e) => void handleChallengeSameWorld(rec, e)}
                                title="一键载入同款地图、订单与局中事件种子，用你的模型同场对决！"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-indigo-500/45 bg-indigo-500/15 px-2 py-1 text-[10px] font-semibold text-indigo-200 hover:bg-indigo-500/30"
                              >
                                <Swords className="h-3 w-3 text-indigo-300" />
                                {challengingId === rec.id ? '载入中' : '挑战同种子'}
                              </button>
                              {adminUnlocked && rec.syncedToCloud ? (
                                <button
                                  type="button"
                                  disabled={adminBusy}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleModerateOp('delete', rec.id);
                                  }}
                                  title="从云端数据库物理删除该条公开记录"
                                  className="rounded-md border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[10px] text-rose-300 hover:bg-rose-500/30"
                                >
                                  云端删除
                                </button>
                              ) : rec.isLocalOwner && !rec.syncedToCloud ? (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    benchmarkStore.deleteLocalRecord(rec.id);
                                  }}
                                  className="text-[10px] text-slate-500 hover:text-rose-400"
                                >
                                  删本地
                                </button>
                              ) : null}
                            </div>
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

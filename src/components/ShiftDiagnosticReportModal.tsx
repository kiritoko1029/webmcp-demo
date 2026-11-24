import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Award,
  CheckCircle2,
  FileBarChart2,
  Loader2,
  Scale,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wrench,
  X,
} from 'lucide-react';
import {
  type BenchmarkRunRecord,
  benchmarkStore,
  useBenchmarkRecords,
} from '../store/benchmarkStore';
import type { RadarDimensionKey } from '../types/domain';
import { useWorldModelConfig } from '../webmcp/worldDirector';

const DIM_LABELS: Array<{ key: RadarDimensionKey; label: string }> = [
  { key: 'profitRoi', label: '1. 收益经营与装备 ROI' },
  { key: 'routingSla', label: '2. 顺路规划与准时率' },
  { key: 'riskControl', label: '3. 防洒避障与续航风控' },
  { key: 'securityDefense', label: '4. 不可信备注反注入安全' },
  { key: 'toolPrecision', label: '5. WebMCP 工具编排精准度' },
  { key: 'tokenEfficiency', label: '6. 思考预算与缓存性价比' },
];

interface Props {
  recordId: string | null;
  initialCompareId?: string | null;
  onClose: () => void;
}

export const ShiftDiagnosticReportModal: React.FC<Props> = ({
  recordId,
  initialCompareId = null,
  onClose,
}) => {
  const allRecords = useBenchmarkRecords();
  const worldCfg = useWorldModelConfig();

  const [compareId, setCompareId] = useState<string>(initialCompareId ?? '');
  const [judgingBusy, setJudgingBusy] = useState(false);
  const [judgeErr, setJudgeErr] = useState<string | null>(null);

  const primaryRec = useMemo(
    () => (recordId ? allRecords.find((r) => r.id === recordId) ?? null : null),
    [allRecords, recordId],
  );

  // Auto-pick best same-seed opponent if user hasn't picked one yet and another record exists!
  const effectiveCompareRec = useMemo(() => {
    if (!primaryRec) return null;
    if (compareId === '__NONE__') return null;
    if (compareId) {
      return allRecords.find((r) => r.id === compareId && r.id !== primaryRec.id) ?? null;
    }
    const sameSeedOpponent = allRecords.find(
      (r) => r.id !== primaryRec.id && r.seedId === primaryRec.seedId,
    );
    return sameSeedOpponent ?? null;
  }, [allRecords, compareId, primaryRec]);

  if (!recordId || !primaryRec) return null;

  const rep = primaryRec.runReport;
  const oppRep = effectiveCompareRec?.runReport;
  const judge = rep?.judgeEvaluation;
  const worldLlmReady = worldCfg.enabled && Boolean(worldCfg.apiKey.trim());

  const handleRunWorldJudge = async () => {
    setJudgingBusy(true);
    setJudgeErr(null);
    try {
      await benchmarkStore.regenerateWorldJudgeReport(primaryRec.id);
    } catch (err) {
      setJudgeErr(err instanceof Error ? err.message : String(err));
    } finally {
      setJudgingBusy(false);
    }
  };

  const primaryToolAcc =
    primaryRec.totalToolCalls > 0
      ? Math.round(
          ((primaryRec.totalToolCalls - primaryRec.failedToolCalls) / primaryRec.totalToolCalls) *
            100,
        )
      : 100;

  const oppToolAcc =
    effectiveCompareRec && effectiveCompareRec.totalToolCalls > 0
      ? Math.round(
          ((effectiveCompareRec.totalToolCalls - effectiveCompareRec.failedToolCalls) /
            effectiveCompareRec.totalToolCalls) *
            100,
        )
      : 100;

  const candidateOpponents = allRecords.filter((r) => r.id !== primaryRec.id);

  interface CompareRowSpec {
    label: string;
    aText: string;
    bText: string;
    aVal: number;
    bVal: number;
    higherIsBetter: boolean;
  }

  const compareRows: CompareRowSpec[] = effectiveCompareRec
    ? [
        {
          label: '竞技段位总分 (Arena Score)',
          aText: `${primaryRec.arenaScore} 分`,
          bText: `${effectiveCompareRec.arenaScore} 分`,
          aVal: primaryRec.arenaScore,
          bVal: effectiveCompareRec.arenaScore,
          higherIsBetter: true,
        },
        {
          label: '六维综合能力均分',
          aText: `${primaryRec.radar.overallAvg} / 100`,
          bText: `${effectiveCompareRec.radar.overallAvg} / 100`,
          aVal: primaryRec.radar.overallAvg,
          bVal: effectiveCompareRec.radar.overallAvg,
          higherIsBetter: true,
        },
        {
          label: '本局最终净钱包结余',
          aText: `¥${primaryRec.walletYuan.toFixed(1)}`,
          bText: `¥${effectiveCompareRec.walletYuan.toFixed(1)}`,
          aVal: primaryRec.walletYuan,
          bVal: effectiveCompareRec.walletYuan,
          higherIsBetter: true,
        },
        {
          label: '累计违约/餐损/抛锚罚金 (越低越好)',
          aText: rep ? `-¥${rep.penaltiesYuan.toFixed(1)}` : '-',
          bText: oppRep ? `-¥${oppRep.penaltiesYuan.toFixed(1)}` : '-',
          aVal: rep?.penaltiesYuan ?? 0,
          bVal: oppRep?.penaltiesYuan ?? 0,
          higherIsBetter: false,
        },
        {
          label: '有效妥投单数 / 准时率',
          aText: `${primaryRec.deliveriesCompleted}单 (${primaryRec.onTimeRatePct}%)`,
          bText: `${effectiveCompareRec.deliveriesCompleted}单 (${effectiveCompareRec.onTimeRatePct}%)`,
          aVal: primaryRec.deliveriesCompleted * 100 + primaryRec.onTimeRatePct,
          bVal:
            effectiveCompareRec.deliveriesCompleted * 100 + effectiveCompareRec.onTimeRatePct,
          higherIsBetter: true,
        },
        {
          label: '严重餐损单数 (越低越好)',
          aText: `${primaryRec.damagedCount} 单`,
          bText: `${effectiveCompareRec.damagedCount} 单`,
          aVal: primaryRec.damagedCount,
          bVal: effectiveCompareRec.damagedCount,
          higherIsBetter: false,
        },
        {
          label: '0% 电量抛锚救援次数 (越低越好)',
          aText: rep ? `${rep.batteryBreakdownsCount} 次` : '-',
          bText: oppRep ? `${oppRep.batteryBreakdownsCount} 次` : '-',
          aVal: rep?.batteryBreakdownsCount ?? 0,
          bVal: oppRep?.batteryBreakdownsCount ?? 0,
          higherIsBetter: false,
        },
        {
          label: '主动绕行安全大道 vs 硬闯危险区',
          aText: `绕行 ${primaryRec.safeDetoursCount} · 闯险 ${primaryRec.hazardsHitCount ?? 0}`,
          bText: `绕行 ${effectiveCompareRec.safeDetoursCount} · 闯险 ${effectiveCompareRec.hazardsHitCount ?? 0}`,
          aVal: primaryRec.safeDetoursCount - (primaryRec.hazardsHitCount ?? 0),
          bVal:
            effectiveCompareRec.safeDetoursCount - (effectiveCompareRec.hazardsHitCount ?? 0),
          higherIsBetter: true,
        },
        {
          label: '下班箱内烂尾未完单 (越低越好)',
          aText: rep ? `${rep.strandedBoxOrdersCount} 单` : '-',
          bText: oppRep ? `${oppRep.strandedBoxOrdersCount} 单` : '-',
          aVal: rep?.strandedBoxOrdersCount ?? 0,
          bVal: oppRep?.strandedBoxOrdersCount ?? 0,
          higherIsBetter: false,
        },
        {
          label: '识破不可信备注注入陷阱',
          aText: `${primaryRec.trapsDefendedCount} 次`,
          bText: `${effectiveCompareRec.trapsDefendedCount} 次`,
          aVal: primaryRec.trapsDefendedCount,
          bVal: effectiveCompareRec.trapsDefendedCount,
          higherIsBetter: true,
        },
        {
          label: 'WebMCP 工具调用精准率',
          aText: `${primaryToolAcc}% (${primaryRec.totalToolCalls - primaryRec.failedToolCalls}/${primaryRec.totalToolCalls})`,
          bText: `${oppToolAcc}% (${effectiveCompareRec.totalToolCalls - effectiveCompareRec.failedToolCalls}/${effectiveCompareRec.totalToolCalls})`,
          aVal: primaryToolAcc,
          bVal: oppToolAcc,
          higherIsBetter: true,
        },
        {
          label: '总消耗 Tokens / 缓存命中率',
          aText:
            primaryRec.totalTokens > 0
              ? `${(primaryRec.totalTokens / 1000).toFixed(1)}k${rep?.cacheHitPct ? ` (缓存${rep.cacheHitPct}%)` : ''}`
              : '0 (本地Bot)',
          bText:
            effectiveCompareRec.totalTokens > 0
              ? `${(effectiveCompareRec.totalTokens / 1000).toFixed(1)}k${oppRep?.cacheHitPct ? ` (缓存${oppRep.cacheHitPct}%)` : ''}`
              : '0 (本地Bot)',
          aVal: primaryRec.radar.tokenEfficiency,
          bVal: effectiveCompareRec.radar.tokenEfficiency,
          higherIsBetter: true,
        },
      ]
    : [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-indigo-500/45 bg-slate-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/90 px-5 py-3.5">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <FileBarChart2 className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-bold text-white">
                跑单赛后六维深度复盘报告 &amp; 跨模型硬核横评
              </h2>
              <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 font-mono text-[11px] font-bold text-amber-300">
                {primaryRec.modelName} · {primaryRec.arenaScore}分
              </span>
              <span className="rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                Seed: {primaryRec.seedId} ({primaryRec.blindMode ? '硬核盲测' : '标准辅助'})
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              精确到单号的引擎加扣分流水账 + 世界导演大模型独立总裁判归因诊断，支持与云端榜单任一战绩逐项硬数据对比。
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={judgingBusy}
              onClick={() => void handleRunWorldJudge()}
              title={
                worldLlmReady
                  ? `使用世界导演模型 (${worldCfg.model}) 重新生成深度裁判报告`
                  : '请先在【双模型 & 种子】配置世界导演模型 Key 以启用大模型裁判'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/50 bg-indigo-600/25 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-600/40 disabled:opacity-50"
            >
              {judgingBusy ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  世界裁判分析中...
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                  由世界大模型深度评判
                </>
              )}
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

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 text-xs">
          {judgeErr && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 px-3.5 py-2 text-rose-200">
              {judgeErr}
            </div>
          )}

          {/* 1. Head-to-Head Opponent Selector & 12-Metric Hard Telemetry Comparison */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/90 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-white">
                  跨模型硬核指标横评（一眼看清不同模型的真实差距）
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">选择对比基准模型：</span>
                <select
                  value={effectiveCompareRec?.id ?? '__NONE__'}
                  onChange={(e) => setCompareId(e.target.value)}
                  className="max-w-[290px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] text-slate-200"
                >
                  <option value="__NONE__">不对比（仅查看本局单模型报告）</option>
                  {candidateOpponents.map((op) => (
                    <option key={op.id} value={op.id}>
                      {op.seedId === primaryRec.seedId ? '🎯[同种子] ' : ''}
                      {op.modelName} ({op.arenaScore}分 · {op.seedId})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {effectiveCompareRec ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="pb-2 pr-3">硬核遥测维度</th>
                      <th className="pb-2 pr-3 text-amber-300">
                        本局模型：{primaryRec.modelName}
                      </th>
                      <th className="pb-2 pr-3 text-emerald-300">
                        对比对手：{effectiveCompareRec.modelName}
                      </th>
                      <th className="pb-2 text-right">单项胜出</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {compareRows.map((row) => {
                      const diff = row.aVal - row.bVal;
                      const aWins = row.higherIsBetter ? diff > 0 : diff < 0;
                      const bWins = row.higherIsBetter ? diff < 0 : diff > 0;
                      return (
                        <tr key={row.label} className="hover:bg-slate-900/60">
                          <td className="py-2 pr-3 text-slate-300">{row.label}</td>
                          <td
                            className={`py-2 pr-3 font-mono ${
                              aWins ? 'font-bold text-amber-300' : 'text-slate-200'
                            }`}
                          >
                            {row.aText}
                          </td>
                          <td
                            className={`py-2 pr-3 font-mono ${
                              bWins ? 'font-bold text-emerald-300' : 'text-slate-300'
                            }`}
                          >
                            {row.bText}
                          </td>
                          <td className="py-2 text-right font-mono text-[10px]">
                            {aWins ? (
                              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-semibold text-amber-300">
                                ▲ 本局占优
                              </span>
                            ) : bWins ? (
                              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-300">
                                ▲ 对手占优
                              </span>
                            ) : (
                              <span className="text-slate-500">持平</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                  <div className="text-[10px] text-slate-400">净配送营收 / 打赏</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-emerald-300">
                    +¥{rep?.grossEarnedYuan.toFixed(1) ?? '0'} / 赏¥
                    {rep?.tipsEarnedYuan.toFixed(1) ?? '0'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                  <div className="text-[10px] text-slate-400">累计罚金扣款</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-rose-300">
                    -¥{rep?.penaltiesYuan.toFixed(1) ?? '0.0'}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                  <div className="text-[10px] text-slate-400">最高连击 / 烂尾滞留</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-amber-300">
                    {rep?.maxComboStreak ?? 1}连击 · 滞留{rep?.strandedBoxOrdersCount ?? 0}单
                  </div>
                </div>
                <div className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5">
                  <div className="text-[10px] text-slate-400">大厅漏抢高价单</div>
                  <div className="mt-0.5 font-mono text-sm font-bold text-indigo-300">
                    {rep?.missedHighValuePoolCount ?? 0}单 (¥
                    {rep?.missedPoolValueYuan.toFixed(0) ?? 0})
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 2. World Director Judge Verdict & 6-Dimension Critique */}
          {judge && (
            <div className="space-y-3 rounded-xl border border-indigo-500/35 bg-slate-950/90 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Award className="h-4 w-4 text-indigo-400" />
                  <span className="font-bold text-indigo-200">
                    赛事总裁判深度定性诊断
                  </span>
                </div>
                <span className="rounded bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] text-indigo-300">
                  执裁引擎：{judge.judgeModel} · {judge.generatedAt}
                </span>
              </div>

              <div className="rounded-lg border border-indigo-500/25 bg-indigo-950/25 p-3 text-xs leading-relaxed text-slate-100">
                <strong className="text-amber-300">【总评结论】</strong> {judge.headlineVerdict}
              </div>

              {/* Strengths vs Deductions Summary */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 font-bold text-emerald-300">
                    <TrendingUp className="h-3.5 w-3.5" />
                    做得好的核心加分亮点
                  </div>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-slate-200">
                    {judge.strengthsAnalysis.map((s, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" />
                        <span>{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-lg border border-rose-500/30 bg-rose-950/15 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 font-bold text-rose-300">
                    <TrendingDown className="h-3.5 w-3.5" />
                    扣分项与隐性失分根因剖析
                  </div>
                  <ul className="space-y-1 text-[11px] leading-relaxed text-slate-200">
                    {judge.deductionsAnalysis.map((d, idx) => (
                      <li key={idx} className="flex items-start gap-1.5">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-rose-400" />
                        <span>{d}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* 6-Dimension Breakdown Cards */}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {DIM_LABELS.map(({ key, label }) => (
                  <div
                    key={key}
                    className="rounded-lg border border-slate-800 bg-slate-900/80 p-2.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">{label}</span>
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                        {primaryRec.radar[key]}分
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                      {judge.dimensionBreakdown[key]}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3 text-[11px] leading-relaxed text-amber-100">
                <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <div>
                  <strong className="text-amber-300">针对性策略改进处方：</strong>
                  {judge.nextOptimizationAdvice}
                </div>
              </div>
            </div>
          )}

          {/* 3. Engine Itemized Red/Black Ledger + Upgrades Timeline */}
          {rep && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Highlights & Upgrades */}
              <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-emerald-300">
                    ✅ 引擎逐笔加分与高光决策流水 ({rep.highlights.length})
                  </span>
                </div>

                {rep.upgradesTimeline.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900/70 px-2.5 py-1.5 text-[10px]">
                    <Wrench className="h-3 w-3 text-amber-400" />
                    <span className="text-slate-400">装备补给时间轴：</span>
                    {rep.upgradesTimeline.map((u, idx) => (
                      <span
                        key={idx}
                        className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-amber-200"
                      >
                        {u}
                      </span>
                    ))}
                  </div>
                )}

                {rep.highlights.length === 0 ? (
                  <p className="py-4 text-center text-slate-500">本局未触发显著高光连击或避障事件</p>
                ) : (
                  <div className="space-y-1.5">
                    {rep.highlights.map((h) => (
                      <div
                        key={h.id}
                        className="rounded-lg border border-emerald-500/20 bg-slate-900/80 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100">
                            <span className="mr-1.5 font-mono text-emerald-400">[{h.time}]</span>
                            {h.title}
                          </span>
                          <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                            {h.impact}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-400">{h.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Deductions & Mistakes */}
              <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-rose-300">
                    ❌ 引擎逐笔扣分与隐性失分流水 ({rep.deductions.length})
                  </span>
                </div>

                {rep.deductions.length === 0 ? (
                  <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/15 py-6 text-center text-emerald-300">
                    🎉 完美零失误！本局未触发任何超时、严重餐损、抛锚或违约扣分！
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {rep.deductions.map((d) => (
                      <div
                        key={d.id}
                        className="rounded-lg border border-rose-500/25 bg-slate-900/80 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100">
                            <span className="mr-1.5 font-mono text-rose-400">[{d.time}]</span>
                            {d.title}
                          </span>
                          <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-rose-300">
                            {d.impact}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-slate-400">{d.detail}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

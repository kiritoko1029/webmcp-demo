import React, { useEffect, useState } from 'react';
import {
  Award,
  BatteryCharging,
  Bike,
  BookOpen,
  Box,
  Check,
  Clock,
  FileText,
  Globe2,
  Map,
  RefreshCw,
  RotateCcw,
  Share2,
  ShoppingBag,
  Target,
  Trophy,
  Wallet,
} from 'lucide-react';
import { ApprovalGateModal } from './components/ApprovalGateModal';
import { CityMapModule } from './components/CityMapModule';
import { DeclarativeFormsModule } from './components/DeclarativeFormsModule';
import { LiveRiderRadarBar } from './components/LiveRiderRadarBar';
import { RiderDispatchModule } from './components/RiderDispatchModule';
import { SpecGuideModule } from './components/SpecGuideModule';
import { WebMCPConsoleDock } from './components/WebMCPConsoleDock';
import { useBenchmarkRecords } from './store/benchmarkStore';
import {
  computeArenaRank,
  computeUsedBoxSlots,
  formatShiftClock,
  nexusStore,
  useNexusStore,
} from './store/nexusStore';
import type { ActiveModule } from './types/domain';
import { useWebMCPBridge } from './webmcp/useWebMCPBridge';
import { responsesSession } from './webmcp/responsesSessionManager';
import { importWorldFromSeedOrUrl } from './webmcp/worldDirector';
import { buildShareableWorldUrl } from './webmcp/worldSeedCodec';

const NAV_TABS: Array<{
  id: ActiveModule;
  label: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dispatch', label: '生存接单与装备台', badge: '8 Tools', icon: ShoppingBag },
  { id: 'map', label: '动态地形沙盘地图', badge: '物理+危险区', icon: Map },
  { id: 'forms', label: '卡餐报备与提现', badge: '2 <form>', icon: FileText },
  { id: 'comms', label: '智能外卖柜与隐私号', badge: '3 Iframe', icon: Box },
  { id: 'spec', label: 'WebMCP 游戏说明', icon: BookOpen },
];

export const App: React.FC = () => {
  const { tools, runtimeMode, refreshTools } = useWebMCPBridge();
  const [openDualModalTick, setOpenDualModalTick] = useState(0);
  const [openLeaderboardTick, setOpenLeaderboardTick] = useState(0);
  const [shareCopied, setShareCopied] = useState(false);
  const [seedBannerToast, setSeedBannerToast] = useState<string | null>(null);

  const activeModule = useNexusStore((s) => s.activeModule);
  const blindMode = useNexusStore((s) => s.benchmarkBlindMode);
  const worldMap = useNexusStore((s) => s.worldMap);
  const rider = useNexusStore((s) => s.rider);
  const shift = useNexusStore((s) => s.shift);
  const orders = useNexusStore((s) => s.orders);
  const benchmarkRecords = useBenchmarkRecords();
  const formAwaitingHuman = useNexusStore((s) => s.declarativeFormStatus.awaitingHumanSubmit);

  // Auto-load shared world seed when opening a `#world=...` or `?world=...` URL!
  useEffect(() => {
    const tryLoadUrlSeed = async () => {
      const hash = window.location.hash;
      const search = window.location.search;
      const hasWorldParam =
        hash.includes('world=') ||
        hash.includes('seed=') ||
        search.includes('world=') ||
        search.includes('seed=');
      if (!hasWorldParam) return;
      try {
        const res = await importWorldFromSeedOrUrl(window.location.href, {
          syncUrlHash: false,
        });
        setSeedBannerToast(
          `已从分享链接载入同款世界 [${res.seedId}] · 「${res.themeName}」(${res.orderCount}笔初始单)`,
        );
        window.setTimeout(() => setSeedBannerToast(null), 5500);
      } catch (err) {
        console.warn('[WorldSeed] Failed to import URL seed:', err);
      }
    };

    void tryLoadUrlSeed();
    const onHashChange = () => {
      void tryLoadUrlSeed();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const handleCopyShareWorldUrl = async () => {
    try {
      const { url, token } = await buildShareableWorldUrl(worldMap, orders);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#world=${token}`,
      );
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setSeedBannerToast(`已复制世界种子 [${worldMap.seedId}] 分享链接！好友打开链接即可游玩同款地图与订单`);
      window.setTimeout(() => setShareCopied(false), 2600);
      window.setTimeout(() => setSeedBannerToast(null), 4500);
    } catch {
      // Fallback if clipboard API restricted
      const { token } = await buildShareableWorldUrl(worldMap, orders);
      window.location.hash = `world=${token}`;
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2600);
    }
  };

  const usedSlots = computeUsedBoxSlots(orders);
  const poolCount = orders.filter((o) => o.stage === 'pool').length;
  const rank = computeArenaRank(shift.arenaScore);
  const clockLabel = formatShiftClock(shift.elapsedMinutes);
  const minsRemaining = Math.max(0, shift.totalShiftMinutes - shift.elapsedMinutes);

  return (
    <div className="flex min-h-screen flex-col bg-slate-950 text-slate-100 md:h-dvh md:overflow-hidden">
      {/* Floating Non-Layout-Shifting Toast Overlay */}
      {seedBannerToast && (
        <div className="pointer-events-none fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-full border border-emerald-400/50 bg-slate-950/95 px-4 py-1.5 text-xs font-medium text-emerald-200 shadow-2xl shadow-emerald-950/60 backdrop-blur-md">
          🌱 {seedBannerToast}
        </div>
      )}

      {/* Top Arena Game HUD Header */}
      <header className="shrink-0 border-b border-slate-800/90 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1680px] flex-wrap items-center justify-between gap-2.5 px-4 py-2.5 lg:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-lg shadow-amber-500/20">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-white xl:text-base">
                  闪电骑士：AI 外卖生存挑战赛 (WebMCP Arena)
                </h1>
                <span className="rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-amber-300">
                  {tools.length} Tools
                </span>
                <span className="rounded-full border border-indigo-500/40 bg-indigo-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300">
                  Seed: {worldMap.seedId}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                双模型对抗：<strong className="text-indigo-300">世界导演</strong> 生成可共享种子城市 ·{' '}
                <strong className="text-amber-300">外卖员模型</strong> 经 WebMCP 自主闯关
              </p>
            </div>
          </div>

          {/* Top Controls — Fixed-Width Toggle Labels for Zero Layout Jitter */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => setOpenDualModalTick((n) => n + 1)}
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-indigo-500/50 bg-indigo-600/25 px-2.5 py-1.5 font-semibold text-indigo-200 hover:bg-indigo-600/40"
            >
              <Globe2 className="h-3.5 w-3.5 shrink-0 text-indigo-300" />
              双模型 &amp; 种子
            </button>

            <button
              type="button"
              onClick={() =>
                nexusStore.patch({
                  benchmarkBlindMode: !blindMode,
                })
              }
              title="硬核盲测模式：隐藏所有 Debug 作弊工具与自动排线工具，移除提示词攻略与状态透视，考验大模型真实观测与规划能力"
              className={`inline-flex w-[104px] items-center justify-center gap-1 whitespace-nowrap rounded-lg border py-1.5 font-bold transition ${
                blindMode
                  ? 'border-rose-500/60 bg-rose-500/20 text-rose-200 shadow-sm shadow-rose-500/20'
                  : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-500/40 hover:text-rose-200'
              }`}
            >
              <Target className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              {blindMode ? '硬核盲测:开' : '硬核盲测:关'}
            </button>

            <button
              type="button"
              onClick={() => setOpenLeaderboardTick((n) => n + 1)}
              title="查看全网云端实时排行榜、大模型六维能力雷达图与同种子挑战对比"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-amber-500/50 bg-amber-500/15 px-2.5 py-1.5 font-bold text-amber-200 hover:bg-amber-500/25"
            >
              <Award className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              云端榜单{benchmarkRecords.length > 0 ? ` (${benchmarkRecords.length})` : ''}
            </button>

            <button
              type="button"
              onClick={() => void handleCopyShareWorldUrl()}
              title="将当前世界导演生成的地图、危险区、商家与初始悬赏订单编码为可分享链接"
              className="inline-flex w-[108px] items-center justify-center gap-1 whitespace-nowrap rounded-lg border border-emerald-500/50 bg-emerald-500/15 py-1.5 font-semibold text-emerald-200 hover:bg-emerald-500/25"
            >
              {shareCopied ? (
                <>
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  已复制链接
                </>
              ) : (
                <>
                  <Share2 className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
                  分享世界种子
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => {
                nexusStore.replayCurrentWorldSeed();
                responsesSession.resetSession();
              }}
              title="保持当前世界种子与初始订单不变，重置时间到 11:00 并清空旧局上下文，供不同外卖员模型公平打榜"
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-medium text-indigo-300 hover:border-indigo-500/50 hover:text-indigo-200"
            >
              <RefreshCw className="h-3.5 w-3.5 shrink-0" />
              同种子重开
            </button>

            <button
              type="button"
              onClick={() => {
                nexusStore.resetEnvironment();
                responsesSession.resetSession();
                if (window.location.hash.includes('world=')) {
                  window.history.replaceState(
                    null,
                    '',
                    `${window.location.pathname}${window.location.search}`,
                  );
                }
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-medium text-slate-300 hover:text-white"
            >
              <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
              默认初始局
            </button>
          </div>
        </div>

        {/* 5 Survival Game HUD Strips + Nav */}
        <div className="mx-auto max-w-[1680px] px-4 pb-2.5 lg:px-6">
          <div className="mb-2.5 grid grid-cols-2 gap-2 xl:grid-cols-5">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-1.5 text-xs">
              <span className="shrink-0 text-slate-400">班次时钟</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-mono text-sm font-bold text-white">
                <Clock className="h-3.5 w-3.5 text-amber-400" />
                {clockLabel} (剩{minsRemaining}分)
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-1.5 text-xs">
              <span className="shrink-0 text-slate-400">竞技段位</span>
              <span className={`flex items-center gap-1 whitespace-nowrap font-mono text-sm font-bold ${rank.colorClass}`}>
                <Trophy className="h-3.5 w-3.5" />
                {shift.arenaScore}分 · {rider.comboStreak}连击
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-1.5 text-xs">
              <span className="shrink-0 text-slate-400">配送箱格数</span>
              <span className="whitespace-nowrap font-mono text-sm font-bold text-amber-300">
                {usedSlots}/{rider.maxBoxSlots}格 (池{poolCount}单)
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-1.5 text-xs">
              <span className="shrink-0 text-slate-400">可用资金</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-mono text-sm font-bold text-emerald-400">
                <Wallet className="h-3.5 w-3.5" />¥{rider.walletYuan.toFixed(2)}
              </span>
            </div>

            <div className="col-span-2 flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/70 px-3 py-1.5 text-xs xl:col-span-1">
              <span className="shrink-0 text-slate-400">电量 / 体力</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-mono text-sm font-bold text-sky-300">
                <BatteryCharging className="h-3.5 w-3.5" />
                电{rider.batteryPct}% · 体{rider.staminaPct}%
              </span>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-1.5">
            {NAV_TABS.map((item) => {
              const Icon = item.icon;
              const isActive = activeModule === item.id;
              const pulseForms = item.id === 'forms' && formAwaitingHuman;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => nexusStore.patch({ activeModule: item.id })}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs font-bold transition ${
                    pulseForms
                      ? 'animate-pulse bg-amber-400 text-slate-950 shadow-md'
                      : isActive
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                        : 'bg-slate-900/80 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                  {item.badge && (
                    <span
                      className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] ${
                        pulseForms || isActive
                          ? 'bg-slate-950/20 text-slate-950'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main Split Arena */}
      <main className="mx-auto grid w-full max-w-[1680px] flex-1 min-h-0 grid-cols-1 gap-4 px-4 py-3.5 md:grid-cols-12 md:overflow-hidden lg:px-6">
        <section className="min-w-0 min-h-0 overscroll-contain md:col-span-7 md:h-full md:overflow-y-auto md:pr-1.5 lg:col-span-8">
          {/* Always-visible Live Rider Radar & Model Action Tracker (except when full CityMap is already open) */}
          {activeModule !== 'map' && <LiveRiderRadarBar />}

          {activeModule === 'dispatch' && <RiderDispatchModule />}
          {activeModule === 'map' && <CityMapModule />}
          {activeModule === 'spec' && <SpecGuideModule />}

          <DeclarativeFormsModule hidden={activeModule !== 'forms'} />

          <div className={activeModule === 'comms' ? 'space-y-3' : 'hidden'}>
            <div className="rounded-xl border border-amber-500/30 bg-slate-900/90 p-3.5 text-xs text-slate-300">
              下方运行在独立 <code className="text-amber-300">&lt;iframe src=&quot;./rider-comms-frame.html&quot; allow=&quot;tools&quot;&gt;</code>{' '}
              中的虚拟隐私号与智能外卖柜终端，外卖员 AI 通过 <code className="text-amber-300">document.modelContext</code>{' '}
              跨帧开柜存餐并通知顾客。
            </div>
            <iframe
              src="./rider-comms-frame.html"
              title="Rider Privacy Comms & Smart Locker"
              allow="tools"
              onLoad={refreshTools}
              className="h-[510px] w-full rounded-xl border border-slate-800 bg-slate-950"
            />
          </div>
        </section>

        <section className="h-[620px] min-h-0 overscroll-contain md:col-span-5 md:h-full md:overflow-hidden lg:col-span-4">
          <WebMCPConsoleDock
            tools={tools}
            runtimeMode={runtimeMode}
            onRefreshTools={refreshTools}
            externalOpenDualModal={openDualModalTick}
            externalOpenLeaderboard={openLeaderboardTick}
          />
        </section>
      </main>

      <ApprovalGateModal />
    </div>
  );
};

export default App;

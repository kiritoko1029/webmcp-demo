import React, { useState } from 'react';
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Compass,
  Eye,
  Maximize2,
  MessageSquare,
  Navigation,
  ShieldAlert,
  ShoppingBag,
  Wrench,
} from 'lucide-react';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import type { LiveActionEntry } from '../types/domain';

function ActionCategoryIcon({ category }: { category: LiveActionEntry['category'] }) {
  switch (category) {
    case 'move':
      return <Navigation className="h-3.5 w-3.5 text-amber-400" />;
    case 'order':
      return <ShoppingBag className="h-3.5 w-3.5 text-sky-400" />;
    case 'shop':
      return <Wrench className="h-3.5 w-3.5 text-emerald-400" />;
    case 'comms':
      return <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />;
    case 'security':
      return <ShieldAlert className="h-3.5 w-3.5 text-purple-400" />;
    case 'error':
      return <AlertCircle className="h-3.5 w-3.5 text-rose-400" />;
    default:
      return <Eye className="h-3.5 w-3.5 text-slate-400" />;
  }
}

export const LiveRiderRadarBar: React.FC = () => {
  const [collapsed, setCollapsed] = useState(false);

  const worldMap = useNexusStore((s) => s.worldMap);
  const rider = useNexusStore((s) => s.rider);
  const orders = useNexusStore((s) => s.orders);
  const trail = useNexusStore((s) => s.riderTrail);
  const actionFeed = useNexusStore((s) => s.liveActionFeed);
  const activeBubble = useNexusStore((s) => s.activeRiderBubble);
  const sim = useNexusStore((s) => s.rideSimulation);

  const activeOrders = orders.filter(
    (o) =>
      o.stage === 'heading_to_store' || o.stage === 'at_store' || o.stage === 'delivering',
  );
  const recentTrail = trail.slice(-5);
  const lastHop = trail[trail.length - 1];

  return (
    <div className="mb-3.5 overflow-hidden rounded-xl border border-indigo-500/35 bg-slate-900/95 shadow-lg">
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/90 bg-slate-950/80 px-3.5 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-bold text-amber-300">
            <Compass className="h-3.5 w-3.5 animate-spin [animation-duration:8s]" />
            外卖员实时动向雷达 &amp; 模型操作追踪舱
          </span>
          <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 font-mono text-[11px] text-slate-200">
            📍 当前：{rider.currentArea} ({rider.pos.x},{rider.pos.y})
          </span>
          {sim.status === 'riding' && (
            <span className="animate-pulse rounded-full bg-amber-500/20 px-2.5 py-0.5 font-semibold text-amber-300">
              {sim.stageText}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => nexusStore.patch({ activeModule: 'map' })}
            className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-200"
          >
            <Maximize2 className="h-3 w-3" />
            全屏大地图
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="inline-flex items-center gap-0.5 rounded-md border border-slate-800 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-400 hover:text-white"
          >
            {collapsed ? (
              <>
                展开实况 <ChevronDown className="h-3 w-3" />
              </>
            ) : (
              <>
                收起 <ChevronUp className="h-3 w-3" />
              </>
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-12">
          {/* Left: Live Animated SVG City Radar */}
          <div className="flex flex-col justify-between rounded-lg border border-slate-800 bg-slate-950 p-2 lg:col-span-6">
            <svg viewBox="0 0 920 390" className="h-[178px] w-full rounded bg-slate-950">
              {/* Roads */}
              <g stroke="rgba(51, 65, 85, 0.65)" strokeWidth="16" fill="none">
                {worldMap.roadsH.map((r) => (
                  <line key={r.name} x1="0" y1={r.y} x2="920" y2={r.y} />
                ))}
                {worldMap.roadsV.map((r) => (
                  <line key={r.name} x1={r.x} y1="0" x2={r.x} y2="390" />
                ))}
              </g>

              {/* Safe Detour Perimeter Boulevards */}
              <g
                stroke="rgba(16, 185, 129, 0.16)"
                strokeWidth="6"
                strokeDasharray="6 6"
                fill="none"
              >
                <line x1="80" y1="86" x2="860" y2="86" />
                <line x1="80" y1="342" x2="860" y2="342" />
              </g>

              {/* Hazards */}
              {worldMap.hazards.map((hz) => {
                const color =
                  hz.type === 'construction_bumpy'
                    ? '#f43f5e'
                    : hz.type === 'flooded_slow'
                      ? '#0ea5e9'
                      : '#f59e0b';
                return (
                  <g key={hz.id} transform={`translate(${hz.pos.x}, ${hz.pos.y})`}>
                    <circle
                      r={hz.radius}
                      fill={color}
                      fillOpacity={0.16}
                      stroke={color}
                      strokeOpacity={0.75}
                      strokeDasharray="5 4"
                      strokeWidth={2}
                    />
                    <text
                      x={0}
                      y={4}
                      textAnchor="middle"
                      fill={color}
                      fontSize="12"
                      fontWeight="700"
                    >
                      ⚠ {hz.name.slice(0, 7)}
                    </text>
                  </g>
                );
              })}

              {/* Recent Rider Movement Trail Hops */}
              {recentTrail.map((hop, idx) => {
                const isLatest = idx === recentTrail.length - 1;
                const pts = hop.waypoints.map((p) => `${p.x},${p.y}`).join(' ');
                const strokeColor =
                  hop.routeChoice === 'detour_safe_road'
                    ? '#10b981'
                    : hop.hazardsHit.length > 0
                      ? '#f43f5e'
                      : '#fbbf24';
                return (
                  <g key={hop.id} opacity={isLatest ? 0.95 : 0.42}>
                    <polyline
                      points={pts}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={isLatest ? 4 : 2.2}
                      strokeDasharray={hop.routeChoice === 'detour_safe_road' ? undefined : '7 5'}
                    />
                    <circle cx={hop.fromPos.x} cy={hop.fromPos.y} r={4} fill={strokeColor} />
                  </g>
                );
              })}

              {/* Landmarks */}
              {worldMap.landmarks.map((lm) => {
                const targeted = activeOrders.some((o) => o.landmarkId === lm.id);
                return (
                  <g key={lm.id} transform={`translate(${lm.pos.x}, ${lm.pos.y})`}>
                    <circle
                      r={targeted ? 10 : 6}
                      fill={targeted ? '#10b981' : '#065f46'}
                      stroke="#0f172a"
                      strokeWidth={2}
                    />
                    <text
                      x={0}
                      y={22}
                      textAnchor="middle"
                      fill={targeted ? '#a7f3d0' : '#64748b'}
                      fontSize="11.5"
                      fontWeight={targeted ? '700' : '500'}
                    >
                      {lm.name.slice(0, 7)}
                    </text>
                  </g>
                );
              })}

              {/* Merchants */}
              {worldMap.merchants.map((m) => {
                const activePickup = activeOrders.some(
                  (o) => o.merchantId === m.id && o.stage !== 'delivering',
                );
                return (
                  <g key={m.id} transform={`translate(${m.pos.x}, ${m.pos.y})`}>
                    <circle
                      r={activePickup ? 10 : 6}
                      fill={activePickup ? '#f59e0b' : '#92400e'}
                      stroke="#0f172a"
                      strokeWidth={2}
                    />
                    <text
                      x={0}
                      y={-12}
                      textAnchor="middle"
                      fill={activePickup ? '#fde68a' : '#94a3b8'}
                      fontSize="11.5"
                      fontWeight={activePickup ? '700' : '500'}
                    >
                      {m.name.split(' ')[0].slice(0, 6)}
                    </text>
                  </g>
                );
              })}

              {/* Stations */}
              {worldMap.stations.map((st) => (
                <g key={st.id} transform={`translate(${st.pos.x}, ${st.pos.y})`}>
                  <circle r={8.5} fill="#0284c7" stroke="#e0f2fe" strokeWidth={1.5} />
                  <text x={0} y={4} textAnchor="middle" fill="#fff" fontSize="11">
                    {st.type === 'battery_swap' ? '⚡' : '🥤'}
                  </text>
                </g>
              ))}

              {/* Animated Rider Scooter + Live Speech Bubble */}
              <g
                transform={`translate(${rider.pos.x}, ${rider.pos.y})`}
                style={{ transition: 'transform 0.14s linear' }}
              >
                <circle r={22} fill="rgba(99, 102, 241, 0.3)" className="animate-pulse-ring" />
                <circle r={12} fill="#6366f1" stroke="#ffffff" strokeWidth={2.8} />
                <text x={0} y={4} textAnchor="middle" fontSize="11">
                  🛵
                </text>
                {activeBubble && (
                  <g transform={`translate(0, ${rider.pos.y < 75 ? 28 : -28})`}>
                    <rect
                      x={-115}
                      y={-13}
                      width={230}
                      height={24}
                      rx={7}
                      fill="#1e1b4b"
                      stroke="#818cf8"
                      strokeWidth={1.5}
                    />
                    <text
                      x={0}
                      y={3}
                      textAnchor="middle"
                      fill="#e0e7ff"
                      fontSize="11.5"
                      fontWeight="700"
                    >
                      {activeBubble.slice(0, 22)}
                    </text>
                  </g>
                )}
              </g>
            </svg>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1 text-amber-300">
                  <span className="inline-block h-0.5 w-3 bg-amber-400" /> 直线抄近道
                </span>
                <span className="flex items-center gap-1 text-emerald-300">
                  <span className="inline-block h-0.5 w-3 bg-emerald-400" /> 安全大道绕行
                </span>
                <span className="flex items-center gap-1 text-rose-300">
                  <span className="inline-block h-2 w-2 rounded-full bg-rose-500/70" /> 危险区碰撞
                </span>
              </div>
              {lastHop && (
                <span className="truncate font-mono text-[10px] text-indigo-300">
                  上一段: [{lastHop.gameTimeLabel}] {lastHop.fromLabel.slice(0, 6)} →{' '}
                  {lastHop.toLabel.slice(0, 8)} ({lastHop.distanceKm}km)
                </span>
              )}
            </div>
          </div>

          {/* Right: Chronological Plain-Language Model Action Stream */}
          <div className="flex h-[206px] flex-col rounded-lg border border-slate-800 bg-slate-950/90 p-2.5 lg:col-span-6">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="flex items-center gap-1.5 font-bold text-slate-200">
                <Activity className="h-3.5 w-3.5 text-emerald-400" />
                模型动作与状态变更时间轴（最新在顶）
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                累计调用 {actionFeed.length > 1 ? actionFeed.length - 1 : 0} 次动作
              </span>
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
              {actionFeed.slice(0, 10).map((act, idx) => (
                <div
                  key={act.id}
                  className={`rounded-lg border px-2.5 py-1.5 text-[11px] transition ${
                    idx === 0
                      ? 'border-indigo-500/45 bg-indigo-950/35 text-white'
                      : 'border-slate-800/80 bg-slate-900/60 text-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <ActionCategoryIcon category={act.category} />
                      <span className="rounded bg-slate-800 px-1.5 py-0.2 font-mono text-[10px] text-amber-300">
                        {act.gameTimeLabel}
                      </span>
                      <span className="rounded bg-indigo-500/20 px-1.5 py-0.2 text-[10px] font-semibold text-indigo-200">
                        {act.actor}
                      </span>
                      <span className="font-medium leading-snug">{act.headline}</span>
                    </div>
                  </div>
                  {act.badges.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1 pl-5">
                      {act.badges.map((b, bIdx) => (
                        <span
                          key={`${act.id}-b-${bIdx}`}
                          className="rounded border border-slate-700/80 bg-slate-950 px-1.5 py-0.2 font-mono text-[10px] text-emerald-300"
                        >
                          {b}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

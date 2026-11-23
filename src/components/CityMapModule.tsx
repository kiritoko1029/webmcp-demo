import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  CloudRain,
  Navigation,
  OctagonX,
  Play,
  Route,
  Sun,
} from 'lucide-react';
import { useNexusStore } from '../store/nexusStore';
import { executeWebMCPByName } from '../webmcp/useWebMCPBridge';

export const CityMapModule: React.FC = () => {
  const worldMap = useNexusStore((s) => s.worldMap);
  const rider = useNexusStore((s) => s.rider);
  const orders = useNexusStore((s) => s.orders);
  const stops = useNexusStore((s) => s.plannedStops);
  const sim = useNexusStore((s) => s.rideSimulation);

  const [speedMode, setSpeedMode] = useState<'careful_steady' | 'normal_cruise' | 'turbo_sprint'>(
    'normal_cruise',
  );
  const rideAbortRef = useRef<AbortController | null>(null);

  const activeOrders = orders.filter(
    (o) =>
      o.stage === 'heading_to_store' || o.stage === 'at_store' || o.stage === 'delivering',
  );

  const handleStartRide = async () => {
    if (sim.status === 'riding') return;
    const ac = new AbortController();
    rideAbortRef.current = ac;
    try {
      await executeWebMCPByName(
        'navigation.ride_to_next_stop',
        { speedMode },
        { signal: ac.signal, callerLabel: 'CityMapUI' },
      );
    } catch {
      // Handled in bridge
    } finally {
      rideAbortRef.current = null;
    }
  };

  const handleBrakeAbort = () => {
    rideAbortRef.current?.abort(new DOMException('骑手点击紧急刹车', 'AbortError'));
  };

  const polylinePoints = [rider.pos, ...stops.map((s) => s.pos)]
    .map((p) => `${p.x},${p.y}`)
    .join(' ');

  return (
    <div className="space-y-4">
      {/* Control Bar */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Navigation className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white">
                {worldMap.themeName} · 动态地形与危险路况沙盘
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              {worldMap.themeDescription}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={speedMode}
              onChange={(e) => setSpeedMode(e.target.value as typeof speedMode)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-200"
            >
              <option value="careful_steady">稳骑防洒档 (护蛋糕/省电)</option>
              <option value="normal_cruise">常规巡航档</option>
              <option value="turbo_sprint">狂飙冲刺档 (省时30%·高耗电颠簸)</option>
            </select>

            <button
              type="button"
              onClick={() =>
                void executeWebMCPByName(
                  'debug.toggle_heavy_rain',
                  { heavyRain: rider.weather !== 'heavy_rain' },
                  { callerLabel: 'CityMapUI' },
                )
              }
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                rider.weather === 'heavy_rain'
                  ? 'border-sky-400/60 bg-sky-500/20 text-sky-200'
                  : 'border-slate-700 bg-slate-950 text-slate-300'
              }`}
            >
              {rider.weather === 'heavy_rain' ? (
                <>
                  <CloudRain className="h-3.5 w-3.5 text-sky-300" />
                  暴雨+¥4
                </>
              ) : (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-300" />
                  晴天
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() =>
                void executeWebMCPByName('debug.swap_ebike_battery', {}, { callerLabel: 'CityMapUI' })
              }
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-sky-300 hover:border-sky-500/50"
            >
              <BatteryCharging className="h-3.5 w-3.5" />
              ¥3 换电
            </button>

            <button
              type="button"
              onClick={() =>
                void executeWebMCPByName('navigation.plan_optimal_route', {}, { callerLabel: 'CityMapUI' })
              }
              className="inline-flex items-center gap-1 rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
            >
              <Route className="h-3.5 w-3.5 text-amber-400" />
              重排路线
            </button>

            {sim.status === 'riding' ? (
              <button
                type="button"
                onClick={handleBrakeAbort}
                className="inline-flex items-center gap-1 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500"
              >
                <OctagonX className="h-3.5 w-3.5" />
                紧急刹车
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleStartRide()}
                className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                <Play className="h-3.5 w-3.5" />
                驶向下一站
              </button>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-lg border border-slate-800 bg-slate-950 p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-200">{sim.stageText}</span>
            <span className="font-mono text-slate-400">{sim.progress}%</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-300 ${
                sim.status === 'cancelled'
                  ? 'bg-rose-500'
                  : sim.status === 'arrived'
                    ? 'bg-emerald-500'
                    : 'bg-amber-400'
              }`}
              style={{ width: `${sim.progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Dynamic World SVG Map */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/90 p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>支持由「世界导演大模型」一键重塑全城道路、危险地形、全部商户与收货楼宇</span>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" /> 危险地形区
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" /> 餐饮商户 ({worldMap.merchants.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> 收货楼宇 ({worldMap.landmarks.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-400" /> 换电/补给站
            </span>
          </div>
        </div>

        <svg
          viewBox="0 0 920 390"
          className="h-auto w-full rounded-lg border border-slate-800 bg-slate-950"
        >
          {/* Dynamic Horizontal & Vertical Roads */}
          <g stroke="rgba(51, 65, 85, 0.58)" strokeWidth="18" fill="none">
            {worldMap.roadsH.map((r) => (
              <line key={r.name} x1="0" y1={r.y} x2="920" y2={r.y} />
            ))}
            {worldMap.roadsV.map((r) => (
              <line key={r.name} x1={r.x} y1="0" x2={r.x} y2="390" />
            ))}
          </g>

          <g stroke="rgba(148, 163, 184, 0.2)" strokeWidth="1.5" strokeDasharray="8 8">
            {worldMap.roadsH.map((r) => (
              <line key={`${r.name}-d`} x1="0" y1={r.y} x2="920" y2={r.y} />
            ))}
            {worldMap.roadsV.map((r) => (
              <line key={`${r.name}-d`} x1={r.x} y1="0" x2={r.x} y2="390" />
            ))}
          </g>

          {/* Street Names */}
          <g fill="#64748b" fontSize="10.5" fontWeight="600">
            {worldMap.roadsH.map((r) => (
              <text key={`${r.name}-t`} x="24" y={r.y - 12}>
                {r.name}
              </text>
            ))}
            {worldMap.roadsV.map((r) => (
              <text key={`${r.name}-t`} x={r.x + 12} y="24">
                {r.name}
              </text>
            ))}
          </g>

          {/* Dynamic Hazard Zones */}
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
                  fillOpacity={0.13}
                  stroke={color}
                  strokeOpacity={0.65}
                  strokeDasharray="5 4"
                  strokeWidth={1.8}
                />
                <text x={0} y={4} textAnchor="middle" fill={color} fontSize="9.5" fontWeight="700">
                  ⚠ {hz.name}
                </text>
              </g>
            );
          })}

          {/* Planned Multi-Stop Route Polyline */}
          {stops.length > 0 && (
            <>
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="rgba(251, 191, 36, 0.22)"
                strokeWidth="6"
              />
              <polyline
                points={polylinePoints}
                fill="none"
                stroke="#fbbf24"
                strokeWidth="2.5"
                className="animate-route-dash"
              />
            </>
          )}

          {/* All World Landmarks (subtle background pins, highlighted when active order targets them) */}
          {worldMap.landmarks.map((lm) => {
            const isTargeted = activeOrders.some((o) => o.landmarkId === lm.id);
            return (
              <g key={lm.id} transform={`translate(${lm.pos.x}, ${lm.pos.y})`}>
                <circle
                  r={isTargeted ? 8.5 : 5.5}
                  fill={isTargeted ? '#10b981' : '#065f46'}
                  stroke="#0f172a"
                  strokeWidth={1.8}
                />
                <text
                  x={0}
                  y={19}
                  textAnchor="middle"
                  fill={isTargeted ? '#a7f3d0' : '#64748b'}
                  fontSize="9"
                >
                  {lm.name.slice(0, 10)}
                  {!lm.hasElevator ? '(爬楼)' : ''}
                </text>
              </g>
            );
          })}

          {/* All World Merchants */}
          {worldMap.merchants.map((m) => {
            const isActivePickup = activeOrders.some(
              (o) => o.merchantId === m.id && o.stage !== 'delivering',
            );
            return (
              <g key={m.id} transform={`translate(${m.pos.x}, ${m.pos.y})`}>
                <circle
                  r={isActivePickup ? 8.5 : 5.5}
                  fill={isActivePickup ? '#f59e0b' : '#92400e'}
                  stroke="#0f172a"
                  strokeWidth={1.8}
                />
                <text
                  x={0}
                  y={-11}
                  textAnchor="middle"
                  fill={isActivePickup ? '#fde68a' : '#94a3b8'}
                  fontSize="9.5"
                >
                  {m.name.split(' ')[0]}
                </text>
              </g>
            );
          })}

          {/* Battery & Mart Stations */}
          {worldMap.stations.map((st) => (
            <g key={st.id} transform={`translate(${st.pos.x}, ${st.pos.y})`}>
              <circle r={8.5} fill="#0284c7" stroke="#e0f2fe" strokeWidth={1.5} />
              <text x={0} y={3.5} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">
                {st.type === 'battery_swap' ? '⚡' : '🥤'}
              </text>
              <text x={0} y={20} textAnchor="middle" fill="#7dd3fc" fontSize="9">
                {st.name.split('·')[0]}
              </text>
            </g>
          ))}

          {/* Rider Electric Scooter Marker */}
          <g
            transform={`translate(${rider.pos.x}, ${rider.pos.y})`}
            style={{ transition: 'transform 0.45s ease-out' }}
          >
            <circle r={18} fill="rgba(99, 102, 241, 0.28)" className="animate-pulse-ring" />
            <circle r={10.5} fill="#6366f1" stroke="#ffffff" strokeWidth={2.5} />
            <rect
              x={-64}
              y={-35}
              width={128}
              height={20}
              rx={6}
              fill="#4f46e5"
              stroke="#c7d2fe"
              strokeWidth={1}
            />
            <text x={0} y={-21} textAnchor="middle" fill="#ffffff" fontSize="9.5" fontWeight="700">
              {rider.name} · 电{rider.batteryPct}% 体{rider.staminaPct}%
            </text>
          </g>
        </svg>

        {/* Hazard Legend Cards */}
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {worldMap.hazards.map((h) => (
            <div
              key={h.id}
              className="flex items-center gap-2 rounded-lg border border-rose-500/25 bg-slate-950/80 px-3 py-2 text-xs"
            >
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
              <div>
                <strong className="text-slate-200">{h.name}：</strong>
                <span className="text-slate-400">{h.effectNote}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

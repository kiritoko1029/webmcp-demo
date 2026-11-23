import React, { useState } from 'react';
import {
  AlertTriangle,
  BatteryCharging,
  Box,
  CheckCircle2,
  Clock,
  CupSoda,
  Flame,
  MapPin,
  MessageCircle,
  MessageSquareWarning,
  PackageCheck,
  Shield,
  ShoppingBag,
  Sparkles,
  Store,
  Trophy,
  UserRoundCheck,
} from 'lucide-react';
import { computeUsedBoxSlots, nexusStore, useNexusStore } from '../store/nexusStore';
import type { DeliveryOrder, FoodCategory, FragileTag } from '../types/domain';
import { executeWebMCPByName } from '../webmcp/useWebMCPBridge';

const CATEGORIES: Array<FoodCategory | 'ALL'> = [
  'ALL',
  '奶茶咖啡',
  '快餐便当',
  '火锅烧烤',
  '蛋糕甜品',
  '生鲜超市',
];

const FRAGILE_BADGE: Record<FragileTag, { label: string; cls: string } | null> = {
  none: null,
  cream_cake: {
    label: '🎂 奶油蛋糕·极怕颠簸',
    cls: 'border-pink-500/40 bg-pink-500/15 text-pink-300',
  },
  hot_soup: {
    label: '🍲 红油热汤·防洒漏',
    cls: 'border-orange-500/40 bg-orange-500/15 text-orange-300',
  },
  ice_drink: {
    label: '🧊 冰饮·超时易化',
    cls: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300',
  },
};

function stageBadge(stage: DeliveryOrder['stage'], prepMin: number) {
  if (stage === 'heading_to_store') {
    return {
      text: prepMin === 0 ? '① 赶往商家 (已出锅秒取)' : `① 赶往商家 (备餐剩 ${prepMin} 分钟)`,
      cls: 'bg-sky-500/20 text-sky-300 border-sky-500/40',
    };
  }
  if (stage === 'at_store') {
    return {
      text: prepMin === 0 ? '② 已到店 · 可立即扫码取餐' : `② 已到店 · 后厨卡餐剩 ${prepMin} 分钟`,
      cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
    };
  }
  return {
    text: '③ 配送中 · 护送餐品前往顾客',
    cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
  };
}

export const RiderDispatchModule: React.FC = () => {
  const rider = useNexusStore((s) => s.rider);
  const shift = useNexusStore((s) => s.shift);
  const worldMap = useNexusStore((s) => s.worldMap);
  const worldEvents = useNexusStore((s) => s.worldEvents);
  const orders = useNexusStore((s) => s.orders);
  const poolFilter = useNexusStore((s) => s.poolFilter);
  const includeInjection = useNexusStore((s) => s.includePromptInjectionSample);
  const highlightedId = useNexusStore((s) => s.lastHighlightedId);

  const [paceMap, setPaceMap] = useState<
    Record<string, 'careful_steady' | 'normal_cruise' | 'turbo_sprint'>
  >({});

  const usedSlots = computeUsedBoxSlots(orders);
  const activeBoxOrders = orders.filter(
    (o) =>
      o.stage === 'heading_to_store' || o.stage === 'at_store' || o.stage === 'delivering',
  );

  const poolOrders = orders
    .filter((o) => {
      if (o.stage !== 'pool') return false;
      if (poolFilter.category !== 'ALL' && o.category !== poolFilter.category) return false;
      return true;
    })
    .sort((a, b) => {
      if (poolFilter.sortBy === 'distance_asc') return a.distanceKm - b.distanceKm;
      if (poolFilter.sortBy === 'urgent_first') return a.minutesLeft - b.minutesLeft;
      return b.feeYuan + b.tipBonusYuan - (a.feeYuan + a.tipBonusYuan);
    });

  const deliveredOrders = orders.filter((o) => o.stage === 'delivered');
  const latestEvent = worldEvents[0];

  return (
    <div className="space-y-4">
      {/* World Event & Active Quest Strip */}
      <div className="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/45 via-slate-900 to-slate-900 p-3.5 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-indigo-300">
              当前关卡地图
            </span>
            <strong className="text-sm text-white">{worldMap.themeName}</strong>
            <span className="rounded border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
              Seed: {worldMap.seedId}
            </span>
            <span className="text-[11px] text-slate-400">({worldMap.generatedByModel})</span>
          </div>

          <div className="flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-0.5 font-medium text-amber-300">
            <Trophy className="h-3.5 w-3.5" />
            <span>
              {shift.questTitle} ({shift.questProgress}/{shift.questTargetDeliveries})
              {shift.questClaimed ? ' · 已领奖!' : ''}
            </span>
          </div>
        </div>

        {latestEvent && (
          <div className="mt-2 flex items-center gap-2 border-t border-slate-800/80 pt-2 text-[11px] text-slate-300">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-400" />
            <span>
              <strong className="font-mono text-amber-300">[{latestEvent.gameTimeLabel}]</strong>{' '}
              <strong>{latestEvent.title}：</strong>
              {latestEvent.detail}
            </span>
          </div>
        )}
      </div>

      {/* Equipment & Resupply RPG Shop Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-3.5 py-2.5 text-xs">
        <span className="font-semibold text-slate-300">骑手补给与装备改装店：</span>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() =>
              void executeWebMCPByName(
                'rider.upgrade_or_resupply',
                { item: 'swap_battery' },
                { callerLabel: 'ShopUI' },
              )
            }
            className="inline-flex items-center gap-1 rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20"
          >
            <BatteryCharging className="h-3 w-3" />
            ¥3 秒换满电
          </button>

          <button
            type="button"
            onClick={() =>
              void executeWebMCPByName(
                'rider.upgrade_or_resupply',
                { item: 'energy_drink' },
                { callerLabel: 'ShopUI' },
              )
            }
            className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
          >
            <CupSoda className="h-3 w-3" />
            ¥5 冰红茶 (+45%体力)
          </button>

          <button
            type="button"
            disabled={rider.upgrades.shockAbsorber}
            onClick={() =>
              void executeWebMCPByName(
                'rider.upgrade_or_resupply',
                { item: 'upgrade_shock_absorber' },
                { callerLabel: 'ShopUI' },
              )
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              rider.upgrades.shockAbsorber
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'
            }`}
          >
            <Shield className="h-3 w-3" />
            {rider.upgrades.shockAbsorber ? '✓ 已装液压减震架' : '¥32 改装液压减震架 (防洒)'}
          </button>

          <button
            type="button"
            disabled={rider.upgrades.expandedBox}
            onClick={() =>
              void executeWebMCPByName(
                'rider.upgrade_or_resupply',
                { item: 'upgrade_expanded_box' },
                { callerLabel: 'ShopUI' },
              )
            }
            className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              rider.upgrades.expandedBox
                ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20'
            }`}
          >
            <ShoppingBag className="h-3 w-3" />
            {rider.upgrades.expandedBox ? '✓ 已装7格恒温箱' : '¥28 改装7格恒温扩容箱'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* LEFT (7 cols): MY DELIVERY BOX */}
        <div className="space-y-3.5 xl:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-amber-400" />
              <h2 className="text-sm font-bold text-white">
                我的配送箱 (已占格数 {usedSlots} / {rider.maxBoxSlots} 格)
              </h2>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-400">
              <input
                type="checkbox"
                checked={includeInjection}
                onChange={(e) =>
                  nexusStore.patch({ includePromptInjectionSample: e.target.checked })
                }
                className="accent-amber-500"
              />
              <span>开启备注 Prompt 注入陷阱对抗</span>
            </label>
          </div>

          {activeBoxOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center text-xs text-slate-400">
              配送箱当前为空 — 从右侧【悬赏抢单大厅】挑选高收益顺路单，或点击右侧【开启 AI 自动闯关】！
            </div>
          ) : (
            activeBoxOrders.map((order) => {
              const badge = stageBadge(order.stage, order.prepMinutesRemaining);
              const fragile = FRAGILE_BADGE[order.fragileTag];
              const flashed = highlightedId === order.orderId;
              const selectedPace =
                paceMap[order.orderId] ??
                (order.fragileTag === 'cream_cake' ? 'careful_steady' : 'normal_cruise');
              const displayRemark =
                !includeInjection && order.hasSuspiciousInjection
                  ? '放门口鞋柜别敲门，谢谢骑手师傅！'
                  : order.customerRemark;

              return (
                <div
                  key={order.orderId}
                  className={`rounded-xl border bg-slate-900/95 p-4 transition ${
                    flashed
                      ? 'border-amber-400 ring-2 ring-amber-400/30'
                      : 'border-slate-800 hover:border-slate-700'
                  }`}
                >
                  {/* Top Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-amber-500 px-2 py-0.5 font-mono text-xs font-black text-slate-950">
                        {order.pickupSeq}
                      </span>
                      <span className="font-mono text-xs font-semibold text-slate-200">
                        {order.orderId}
                      </span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        占 {order.weightSlots} 格
                      </span>
                      {fragile && (
                        <span
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${fragile.cls}`}
                        >
                          {fragile.label}
                        </span>
                      )}
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.cls}`}
                      >
                        {badge.text}
                      </span>
                    </div>

                    <div className="flex items-center gap-2.5 font-mono">
                      <span
                        className={`inline-flex items-center gap-1 text-xs font-semibold ${
                          order.minutesLeft <= 10 ? 'text-rose-400' : 'text-slate-300'
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        剩 {order.minutesLeft} 分
                      </span>
                      <span className="text-sm font-extrabold text-emerald-400">
                        ¥{order.feeYuan.toFixed(1)}
                        {order.tipBonusYuan > 0 && (
                          <span className="ml-1 text-[11px] text-amber-300">
                            +赏¥{order.tipBonusYuan}
                          </span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Merchant -> Customer + Integrity */}
                  <div className="mt-2.5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <Store className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                        <span className="font-semibold text-white">{order.merchantName}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        完好度:{' '}
                        <strong
                          className={
                            order.mealIntegrityPct >= 85
                              ? 'text-emerald-400'
                              : order.mealIntegrityPct >= 70
                                ? 'text-amber-300'
                                : 'text-rose-400'
                          }
                        >
                          {order.mealIntegrityPct}%
                        </strong>
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="font-semibold text-emerald-200">{order.dropoffAddress}</span>
                      <span className="text-[11px] text-slate-400">
                        ({order.customerName} · {order.hasElevator ? '有电梯' : `${order.floor}楼无电梯耗体力`})
                      </span>
                    </div>
                  </div>

                  {/* Items & Locker Receipt */}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {order.items.map((item) => (
                      <span
                        key={item}
                        className="rounded border border-slate-800 bg-slate-950 px-2 py-0.5 text-[11px] text-slate-300"
                      >
                        {item}
                      </span>
                    ))}
                    {order.lockerReceipt && (
                      <span className="inline-flex items-center gap-1 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                        <Box className="h-3 w-3" />
                        已入柜: {order.lockerReceipt}
                      </span>
                    )}
                  </div>

                  {/* Customer Remark */}
                  <div
                    className={`mt-2.5 rounded-lg border p-2 text-xs ${
                      order.hasSuspiciousInjection && includeInjection
                        ? 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                        : 'border-slate-800/90 bg-slate-950/70 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px]">
                      <span className="flex items-center gap-1 font-semibold text-slate-400">
                        <MessageSquareWarning className="h-3 w-3 text-amber-400" />
                        顾客备注 (untrustedContentHint)
                      </span>
                      {order.hasSuspiciousInjection && includeInjection && (
                        <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-rose-300">
                          <AlertTriangle className="h-3 w-3" />
                          伪造指令陷阱
                        </span>
                      )}
                    </div>
                    <p className="mt-1 leading-snug">{displayRemark}</p>
                  </div>

                  {/* Actions + Pace Selector */}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          void executeWebMCPByName(
                            'orders.negotiate_with_npc',
                            {
                              orderId: order.orderId,
                              targetRole: order.stage === 'delivering' ? 'customer' : 'merchant',
                              message:
                                order.stage === 'delivering'
                                  ? '您好！正在稳稳护送您的外卖路上，马上就到请放心~'
                                  : '老板您好，麻烦优先打包一下这单急单，多谢啦！',
                            },
                            { callerLabel: 'RiderUI' },
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200 hover:bg-indigo-500/25"
                      >
                        <MessageCircle className="h-3 w-3" />
                        {order.stage === 'delivering' ? '沟通顾客赚打赏' : '找店长催单'}
                      </button>

                      <select
                        value={selectedPace}
                        onChange={(e) =>
                          setPaceMap((m) => ({
                            ...m,
                            [order.orderId]: e.target.value as typeof selectedPace,
                          }))
                        }
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-[11px] text-slate-200"
                      >
                        <option value="careful_steady">稳骑防洒 (护蛋糕/汤)</option>
                        <option value="normal_cruise">常规巡航</option>
                        <option value="turbo_sprint">狂飙冲刺 (省时耗电)</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      {order.stage !== 'delivering' ? (
                        <button
                          type="button"
                          onClick={() =>
                            void executeWebMCPByName(
                              'orders.arrive_and_pickup',
                              {
                                orderId: order.orderId,
                                pace: selectedPace,
                                forceWaitAndPickup: true,
                              },
                              { callerLabel: 'RiderUI' },
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
                        >
                          <PackageCheck className="h-3.5 w-3.5" />
                          到店取餐
                        </button>
                      ) : (
                        <>
                          {order.dropoffMode === 'smart_locker' && !order.lockerReceipt && (
                            <button
                              type="button"
                              onClick={() => nexusStore.patch({ activeModule: 'comms' })}
                              className="inline-flex items-center gap-1 rounded-lg border border-amber-500/50 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-300"
                            >
                              <Box className="h-3.5 w-3.5" />
                              存外卖柜
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              void executeWebMCPByName(
                                'orders.complete_delivery',
                                { orderId: order.orderId, pace: selectedPace },
                                { callerLabel: 'RiderUI' },
                              )
                            }
                            className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400"
                          >
                            <UserRoundCheck className="h-3.5 w-3.5" />
                            送达结算
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {deliveredOrders.length > 0 && (
            <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="h-4 w-4" />
                本班次已妥投战绩 ({deliveredOrders.length} 单)
              </div>
              <div className="space-y-1.5">
                {deliveredOrders.map((d) => (
                  <div
                    key={d.orderId}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/80 px-3 py-1.5 text-xs"
                  >
                    <span className="text-slate-300">
                      <strong className="font-mono text-slate-100">{d.orderId}</strong> ·{' '}
                      {d.merchantName} (完好度 {d.mealIntegrityPct}%)
                    </span>
                    <span className="font-mono font-bold text-emerald-400">
                      +¥{d.feeYuan.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT (5 cols): ORDER POOL */}
        <div className="space-y-3 xl:col-span-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame className="h-4 w-4 text-rose-400" />
                <h2 className="text-sm font-bold text-white">
                  悬赏抢单大厅 ({poolOrders.length} 单)
                </h2>
              </div>

              <select
                value={poolFilter.sortBy}
                onChange={(e) =>
                  nexusStore.update((prev) => ({
                    ...prev,
                    poolFilter: {
                      ...prev.poolFilter,
                      sortBy: e.target.value as typeof poolFilter.sortBy,
                    },
                  }))
                }
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200"
              >
                <option value="fee_desc">总收益(含打赏)最高</option>
                <option value="distance_asc">距离最近</option>
                <option value="urgent_first">剩余时间最紧</option>
              </select>
            </div>

            <div className="mt-2.5 flex flex-wrap gap-1">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() =>
                    nexusStore.update((prev) => ({
                      ...prev,
                      poolFilter: { ...prev.poolFilter, category: cat },
                    }))
                  }
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    poolFilter.category === cat
                      ? 'bg-amber-500 font-semibold text-slate-950'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {cat === 'ALL' ? '全部' : cat}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2.5">
            {poolOrders.map((po) => {
              const fragile = FRAGILE_BADGE[po.fragileTag];
              const fitsBox = usedSlots + po.weightSlots <= rider.maxBoxSlots;
              return (
                <div
                  key={po.orderId}
                  className="rounded-xl border border-slate-800 bg-slate-900/90 p-3.5 text-xs hover:border-amber-500/40"
                >
                  <div className="flex flex-wrap items-center justify-between gap-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-base font-black text-amber-400">
                        ¥{po.feeYuan.toFixed(1)}
                      </span>
                      {po.tipBonusYuan > 0 && (
                        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                          +打赏¥{po.tipBonusYuan}
                        </span>
                      )}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                        占{po.weightSlots}格
                      </span>
                      {fragile && (
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${fragile.cls}`}>
                          {fragile.label}
                        </span>
                      )}
                      {po.generatedByWorldModel && (
                        <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                          世界AI出单
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] text-slate-400">
                      {po.distanceKm}km · {po.minutesLeft}分内
                    </span>
                  </div>

                  <div className="mt-2 space-y-1">
                    <div className="font-semibold text-white">
                      取：{po.merchantName}{' '}
                      <span className="font-normal text-slate-400">
                        ({po.prepMinutesRemaining === 0 ? '已出锅秒取' : `需等${po.prepMinutesRemaining}分`})
                      </span>
                    </div>
                    <div className="text-emerald-300">
                      送：{po.dropoffAddress}{' '}
                      {!po.hasElevator && (
                        <span className="text-rose-300">(爬{po.floor}楼耗体力!)</span>
                      )}
                    </div>
                  </div>

                  <div className="mt-1.5 text-[11px] text-slate-400">
                    餐品：{po.items.join('、')}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between border-t border-slate-800 pt-2">
                    <span className="line-clamp-1 max-w-[190px] text-[11px] text-slate-500">
                      {po.customerRemark}
                    </span>
                    <button
                      type="button"
                      disabled={!fitsBox}
                      onClick={() =>
                        void executeWebMCPByName(
                          'orders.grab_order',
                          { orderId: po.orderId },
                          { callerLabel: 'PoolUI' },
                        )
                      }
                      className="rounded-lg bg-amber-500 px-3 py-1 text-xs font-bold text-slate-950 shadow hover:bg-amber-400 disabled:bg-slate-800 disabled:text-slate-500"
                    >
                      {fitsBox ? '秒抢入箱' : `箱满(需${po.weightSlots}格)`}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Hand,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Wallet,
  Zap,
} from 'lucide-react';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import type { DeliveryIssueReport, WithdrawalRecord } from '../types/domain';

interface Props {
  hidden?: boolean;
}

const ISSUE_LABELS: Record<DeliveryIssueReport['issueType'], string> = {
  merchant_slow: '商家卡餐/后厨出餐慢',
  customer_unreachable: '多次致电联系不上顾客',
  spill_damage: '餐盒汤汁洒漏需重做',
  gate_blocked: '小区门禁不让骑手入内',
};

const CHANNEL_LABELS: Record<WithdrawalRecord['channel'], string> = {
  wechat_pay: '微信零钱 (秒到账)',
  alipay: '支付宝余额',
  bank_card: '招商银行工资卡 (尾号6688)',
};

export const DeclarativeFormsModule: React.FC<Props> = ({ hidden = false }) => {
  const rider = useNexusStore((s) => s.rider);
  const issueReports = useNexusStore((s) => s.issueReports);
  const withdrawals = useNexusStore((s) => s.withdrawals);
  const formStatus = useNexusStore((s) => s.declarativeFormStatus);

  const issueFormRef = useRef<HTMLFormElement | null>(null);
  const withdrawFormRef = useRef<HTMLFormElement | null>(null);
  const [speedPreview, setSpeedPreview] = useState(5);

  // Native SubmitEvent listener for Form 1: Auto-Submit Delivery Issue Report
  useEffect(() => {
    const formEl = issueFormRef.current;
    if (!formEl) return;

    const handleIssueSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const fd = new FormData(formEl);
      const orderId = String(fd.get('orderId') || 'ORD-202');
      const issueType = String(
        fd.get('issueType') || 'merchant_slow',
      ) as DeliveryIssueReport['issueType'];
      const addedMinutes = Math.min(25, Math.max(5, Number(fd.get('addedMinutes') || 10)));
      const note = String(fd.get('note') || '').trim() || ISSUE_LABELS[issueType];
      const agentInvoked = Boolean(event.agentInvoked);

      const report: DeliveryIssueReport = {
        id: `REP-${Math.floor(810 + Math.random() * 180)}`,
        createdAt: new Date().toTimeString().slice(0, 8),
        orderId,
        issueType,
        addedMinutes,
        note,
        agentInvoked,
      };

      nexusStore.update((prev) => ({
        ...prev,
        orders: prev.orders.map((o) =>
          o.orderId === orderId ? { ...o, minutesLeft: o.minutesLeft + addedMinutes } : o,
        ),
        issueReports: [report, ...prev.issueReports],
        declarativeFormStatus: {
          activeToolName: 'declarative.report_delivery_issue',
          awaitingHumanSubmit: false,
          lastSubmittedMessage: `${agentInvoked ? '[Agent 自动报备]' : '[骑手手动报备]'} 已为订单 ${orderId} 免责延长 +${addedMinutes} 分钟！`,
        },
      }));
      nexusStore.flashHighlight(orderId);

      const payload = {
        reported: true,
        agentInvoked,
        report,
        message: `报备成功！订单 ${orderId} 配送时限已延长 ${addedMinutes} 分钟，超时免责保护已生效。`,
      };

      nexusStore.appendProtocolLog({
        type: 'declarative_submit',
        toolName: 'declarative.report_delivery_issue',
        originLabel: 'Declarative <form>',
        summary: `自动提交异常报备 (${orderId} +${addedMinutes}分钟)`,
        payload,
      });

      if (agentInvoked && typeof event.respondWith === 'function') {
        event.respondWith(Promise.resolve(payload));
      }
    };

    formEl.addEventListener('submit', handleIssueSubmit);
    return () => formEl.removeEventListener('submit', handleIssueSubmit);
  }, []);

  // Native SubmitEvent listener for Form 2: Rider HITL Earnings Withdrawal
  useEffect(() => {
    const formEl = withdrawFormRef.current;
    if (!formEl) return;

    const handleWithdrawSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const fd = new FormData(formEl);
      const requestedAmount = Number(fd.get('amountYuan') || 100);
      const channel = String(fd.get('channel') || 'wechat_pay') as WithdrawalRecord['channel'];
      const arrivalSpeed = Number(fd.get('arrivalSpeed') || 5);
      const safetyChecks = fd.getAll('safetyChecks').map(String);
      const memo = String(fd.get('memo') || '').trim() || '跑单配送费收入提现';
      const agentInvoked = Boolean(event.agentInvoked);

      const currentBalance = nexusStore.getState().rider.walletYuan;
      const actualAmount = Number(Math.min(currentBalance, Math.max(1, requestedAmount)).toFixed(2));

      if (currentBalance < 1) {
        const errPayload = { withdrawn: false, error: '当前可提现余额不足 ¥1' };
        if (agentInvoked && typeof event.respondWith === 'function') {
          event.respondWith(Promise.resolve(errPayload));
        }
        return;
      }

      const receiptId = `WD-${Math.floor(10000 + Math.random() * 89999)}`;
      const record: WithdrawalRecord = {
        receiptId,
        createdAt: new Date().toTimeString().slice(0, 8),
        amountYuan: actualAmount,
        channel,
        arrivalSpeed,
        safetyChecks,
        memo,
        agentInvoked,
      };

      nexusStore.update((prev) => ({
        ...prev,
        rider: {
          ...prev.rider,
          walletYuan: Number((prev.rider.walletYuan - actualAmount).toFixed(2)),
        },
        withdrawals: [record, ...prev.withdrawals],
        declarativeFormStatus: {
          activeToolName: null,
          awaitingHumanSubmit: false,
          lastSubmittedMessage: `提现成功！¥${actualAmount} 已打入「${CHANNEL_LABELS[channel]}」(${receiptId})`,
        },
      }));

      const payload = {
        withdrawn: true,
        agentInvoked,
        riderConfirmedClick: true,
        receipt: record,
        remainingWalletYuan: nexusStore.getState().rider.walletYuan,
      };

      nexusStore.appendProtocolLog({
        type: 'declarative_submit',
        toolName: 'declarative.withdraw_earnings',
        originLabel: 'Declarative <form>',
        summary: `骑手本人确认提交提现 ¥${actualAmount} -> ${CHANNEL_LABELS[channel]}`,
        payload,
      });

      if (agentInvoked && typeof event.respondWith === 'function') {
        event.respondWith(Promise.resolve(payload));
      }
    };

    const handleWithdrawReset = () => {
      setSpeedPreview(5);
      nexusStore.update((prev) => ({
        ...prev,
        declarativeFormStatus: {
          activeToolName: null,
          awaitingHumanSubmit: false,
          lastSubmittedMessage: '已取消并重置提现单（挂起中的 WebMCP 提现调用已同步取消）',
        },
      }));
    };

    formEl.addEventListener('submit', handleWithdrawSubmit);
    formEl.addEventListener('reset', handleWithdrawReset);
    return () => {
      formEl.removeEventListener('submit', handleWithdrawSubmit);
      formEl.removeEventListener('reset', handleWithdrawReset);
    };
  }, []);

  return (
    <div className={hidden ? 'hidden' : 'space-y-5'}>
      {/* Friendly Explanation Banner */}
      <div className="rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-slate-900 to-slate-900 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-amber-500/20 px-2 py-0.5 font-mono text-xs font-semibold text-amber-300">
                Declarative HTML &lt;form&gt;
              </span>
              <h2 className="text-base font-semibold text-white">
                骑手异常免责报备 &amp; 跑单收入提现（声明式表单工具对比）
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              左边「出餐慢异常报备」带 <code className="text-sky-300">toolautosubmit</code>，AI 助手调用时自动填表秒提交；右边「跑单收入提现」不带{' '}
              <code className="text-amber-300">toolautosubmit</code>，AI 只能帮骑手填好金额和收款方式，必须由骑手本人亲手点【确认提现到账】才会打款！
            </p>
          </div>

          {formStatus.lastSubmittedMessage && (
            <div
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${
                formStatus.awaitingHumanSubmit
                  ? 'animate-pulse border-amber-500/60 bg-amber-500/15 text-amber-200'
                  : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
              }`}
            >
              {formStatus.awaitingHumanSubmit ? (
                <Hand className="h-4 w-4 shrink-0 text-amber-400" />
              ) : (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              )}
              <span>{formStatus.lastSubmittedMessage}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        {/* Form 1: Auto-Submit Slow Prep / Delivery Issue Report */}
        <div className="space-y-4 xl:col-span-6">
          <form
            ref={issueFormRef}
            toolname="declarative.report_delivery_issue"
            tooltitle="上报配送异常申请免责延时 (自动提交)"
            tooldescription="Declarative HTML form with toolautosubmit. Reports slow restaurant kitchen prep, unreachable customer, or gated community issues, immediately extending the order SLA countdown without penalty."
            toolautosubmit=""
            data-agent-active={formStatus.activeToolName === 'declarative.report_delivery_issue'}
            className="rounded-xl border border-slate-800 bg-slate-900/90 p-4"
          >
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-sky-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    卡餐/异常免责加时申请单
                  </h3>
                  <p className="font-mono text-[11px] text-slate-400">
                    toolname=&quot;declarative.report_delivery_issue&quot; ·{' '}
                    <span className="text-sky-400">toolautosubmit</span>
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-medium text-sky-300">
                <Zap className="h-3 w-3" />
                AI 自动提交
              </span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-slate-400">选择关联订单 (orderId)</span>
                <select
                  name="orderId"
                  defaultValue="ORD-202"
                  toolparamdescription="Order ID experiencing delay, such as ORD-201, ORD-202, ORD-203, ORD-204, ORD-205, ORD-206, or ORD-207"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-100"
                >
                  <option value="ORD-201">ORD-201 · 霸王茶姬 (国贸店)</option>
                  <option value="ORD-202">ORD-202 · 麦当劳 (大望路店)</option>
                  <option value="ORD-203">ORD-203 · 瑞幸咖啡 (现代城店)</option>
                  <option value="ORD-204">ORD-204 · 海底捞外送 (合生汇店)</option>
                  <option value="ORD-205">ORD-205 · 盒马鲜生 (十里堡仓)</option>
                  <option value="ORD-206">ORD-206 · 老乡鸡 (财富中心店)</option>
                  <option value="ORD-207">ORD-207 · 木屋烧烤 (百子湾店)</option>
                </select>
              </label>

              <label className="space-y-1 text-xs">
                <span className="text-slate-400">异常原因 (issueType)</span>
                <select
                  name="issueType"
                  defaultValue="merchant_slow"
                  toolparamdescription="Delivery issue reason code"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-100"
                >
                  <option value="merchant_slow">商家卡餐/后厨出餐慢</option>
                  <option value="customer_unreachable">多次致电联系不上顾客</option>
                  <option value="spill_damage">餐盒汤汁洒漏需重做</option>
                  <option value="gate_blocked">小区门禁不让骑手入内</option>
                </select>
              </label>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs">
                <span className="text-slate-400">申请延时分钟 (5-25)</span>
                <input
                  type="number"
                  name="addedMinutes"
                  min="5"
                  max="25"
                  step="any"
                  defaultValue="12"
                  required
                  toolparamdescription="Extra SLA minutes requested (between 5 and 25)"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-100"
                />
              </label>

              <label className="space-y-1 text-xs sm:col-span-2">
                <span className="text-slate-400">现场情况备注 (note)</span>
                <input
                  type="text"
                  name="note"
                  defaultValue="午高峰店内排队单量多，后厨还在打包"
                  required
                  toolparamdescription="Brief note explaining the delivery issue"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-100"
                />
              </label>
            </div>

            <div className="mt-3 flex justify-end">
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Clock className="h-3.5 w-3.5" />
                提交异常并免责加时
              </button>
            </div>
          </form>

          {/* Reported Issues List */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                今日免责报备记录 ({issueReports.length})
              </span>
              <span className="text-emerald-400">准时率保护生效中</span>
            </div>
            <div className="space-y-2">
              {issueReports.map((rep) => (
                <div
                  key={rep.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-semibold text-sky-300">
                      {rep.orderId} · {ISSUE_LABELS[rep.issueType]}
                    </span>
                    <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                      +{rep.addedMinutes} 分钟
                    </span>
                  </div>
                  <p className="mt-1 text-slate-300">{rep.note}</p>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {rep.agentInvoked ? '由 AI 助手自动上报' : '骑手手动上报'} · {rep.createdAt}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Form 2: Rider HITL Earnings Withdrawal (NO toolautosubmit) */}
        <div className="space-y-4 xl:col-span-6">
          <form
            ref={withdrawFormRef}
            toolname="declarative.withdraw_earnings"
            tooltitle="申请今日跑单配送费提现 (需骑手本人点确认)"
            tooldescription="Declarative HTML earnings withdrawal form WITHOUT toolautosubmit. Pre-fills withdrawal amount, payout channel (wechat_pay, alipay, bank_card), arrival speed, and verification checks, then pauses until the rider personally clicks Confirm Withdrawal."
            data-agent-active={formStatus.awaitingHumanSubmit}
            className={`rounded-xl border bg-slate-900/90 p-4 transition ${
              formStatus.awaitingHumanSubmit
                ? 'border-amber-400/80 ring-2 ring-amber-400/30'
                : 'border-slate-800'
            }`}
          >
            <div className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-amber-400" />
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    今日跑单收入提现单 (当前可提现: <span className="font-mono text-emerald-400">¥{rider.walletYuan.toFixed(2)}</span>)
                  </h3>
                  <p className="font-mono text-[11px] text-slate-400">
                    toolname=&quot;declarative.withdraw_earnings&quot; ·{' '}
                    <span className="text-amber-300">省略 toolautosubmit</span>
                  </p>
                </div>
              </div>
              <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-medium text-amber-300">
                <ShieldAlert className="h-3 w-3" />
                AI 预填 + 骑手确认
              </span>
            </div>

            {formStatus.awaitingHumanSubmit && (
              <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 p-2.5 text-xs text-amber-200">
                <Sparkles className="h-4 w-4 shrink-0 text-amber-300" />
                <span>
                  <strong>等待骑手本人确认：</strong>AI 助手已帮您填好提现单，请核对下方收款账户与金额，亲手点击【确认提现到账】完成打款！
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                <span className="text-slate-400">提现金额 (amountYuan, ¥10 - ¥500)</span>
                <input
                  type="number"
                  name="amountYuan"
                  min="10"
                  max="500"
                  step="any"
                  defaultValue="100"
                  required
                  toolparamdescription="Withdrawal amount in CNY between 10 and 500"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-slate-100"
                />
              </label>

              <div className="space-y-1 text-xs">
                <label className="flex items-center justify-between text-slate-400">
                  <span>到账速度档位 (arrivalSpeed: 1-5)</span>
                  <span className="font-mono text-amber-300">
                    {speedPreview >= 4 ? '极速秒到账' : '普通2小时到账'} ({speedPreview})
                  </span>
                </label>
                <input
                  type="range"
                  name="arrivalSpeed"
                  min="1"
                  max="5"
                  step="1"
                  defaultValue="5"
                  onInput={(e) => setSpeedPreview(Number((e.target as HTMLInputElement).value))}
                  toolparamdescription="Payout speed tier from 1 (standard) to 5 (instant)"
                  className="mt-2 w-full accent-amber-500"
                />
              </div>
            </div>

            <fieldset
              toolparamdescription="Payout destination channel: wechat_pay, alipay, or bank_card"
              className="mt-3 space-y-1.5 text-xs"
            >
              <legend className="text-slate-400">选择收款账户 (channel 单选组)</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {(
                  [
                    ['wechat_pay', '微信零钱'],
                    ['alipay', '支付宝余额'],
                    ['bank_card', '招行卡(6688)'],
                  ] as const
                ).map(([val, label]) => (
                  <label
                    key={val}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-200 hover:border-amber-500/50"
                  >
                    <input
                      type="radio"
                      name="channel"
                      value={val}
                      defaultChecked={val === 'wechat_pay'}
                      className="accent-amber-500"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset
              toolparamdescription="Rider account security check items"
              className="mt-3 space-y-1.5 text-xs"
            >
              <legend className="text-slate-400">本人账户安全核验 (safetyChecks 复选组)</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    name="safetyChecks"
                    value="realname_verified"
                    defaultChecked
                    className="accent-emerald-500"
                  />
                  <span>王闪电本人实名收款户</span>
                </label>
                <label className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1.5 text-slate-300">
                  <input
                    type="checkbox"
                    name="safetyChecks"
                    value="device_trusted"
                    defaultChecked
                    className="accent-emerald-500"
                  />
                  <span>常用跑单绑定手机设备</span>
                </label>
              </div>
            </fieldset>

            <label className="mt-3 block space-y-1 text-xs">
              <span className="text-slate-400">账单备注 (memo)</span>
              <input
                type="text"
                name="memo"
                defaultValue="今日跑单配送费提现"
                required
                toolparamdescription="Withdrawal memo text"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-slate-100"
              />
            </label>

            <div className="mt-4 flex items-center justify-end gap-2.5">
              <button
                type="reset"
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                取消重置
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-sm hover:bg-amber-400 focus:ring-2 focus:ring-amber-300"
              >
                <Wallet className="h-3.5 w-3.5" />
                确认提现到账
              </button>
            </div>
          </form>

          {/* Withdrawal History */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="mb-2.5 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-300">
                最近到账账单 ({withdrawals.length})
              </span>
              <span className="font-mono text-emerald-400">0 手续费</span>
            </div>
            <div className="space-y-2">
              {withdrawals.map((wd) => (
                <div
                  key={wd.receiptId}
                  className="rounded-lg border border-slate-800 bg-slate-950/80 p-2.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-amber-300">
                      {CHANNEL_LABELS[wd.channel]}
                    </span>
                    <span className="font-mono text-sm font-bold text-emerald-400">
                      +¥{wd.amountYuan.toFixed(2)}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
                    <span>{wd.memo}</span>
                    <span className="font-mono">
                      {wd.agentInvoked ? 'AI 预填+本人确认' : '手动提现'} · {wd.createdAt}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

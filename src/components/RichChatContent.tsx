import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import type { TurnToolCallLog } from '../webmcp/agentPlaybooks';

/**
 * Tokenizes a line of text to highlight key rider entities:
 * - **bold**
 * - `code`
 * - Money: +¥7.5, ¥186.50, 150元
 * - Order / Receipt IDs: ORD-201, WD-57731, REP-812
 * - Pickup / Locker codes: #A26, #088, 取餐码 9819, H03格, S04格
 * - Metrics: +12 分钟, 26 分钟, 100%, 1.4 km
 */
const HIGHLIGHT_REGEX =
  /(\*\*[^*]+\*\*|`[^`]+`|[+-]?¥\d+(?:\.\d+)?|\b(?:ORD|WD|REP)-\d+\b|#[A-Z0-9]{2,5}|取餐码\s*\d{4}|\b[HS]\d{2}格|[+-]?\d+\s*分钟|[+-]?\d+\s*(?:段位)?分|\b\d+\/\d+\s*格|\b\d+(?:\.\d+)?\s*km\b|\b\d{1,3}%)/g;

function renderHighlightedInline(text: string): React.ReactNode[] {
  const parts = text.split(HIGHLIGHT_REGEX);
  return parts.map((part, idx) => {
    if (!part) return null;

    // **bold**
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }

    // `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const inner = part.slice(1, -1);
      return (
        <code
          key={idx}
          className="mx-0.5 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[11px] text-indigo-300"
        >
          {inner}
        </code>
      );
    }

    // Currency (+¥7.5, ¥186.50)
    if (/^[+-]?¥\d/.test(part)) {
      const isNegative = part.startsWith('-');
      return (
        <span
          key={idx}
          className={`mx-0.5 inline-flex items-baseline rounded border px-1.5 py-0.2 font-mono text-[11px] font-bold ${
            isNegative
              ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
              : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
          }`}
        >
          {part}
        </span>
      );
    }

    // Order / Receipt IDs (ORD-201, WD-12345, REP-812)
    if (/^(?:ORD|WD|REP)-\d+$/.test(part)) {
      return (
        <span
          key={idx}
          className="mx-0.5 inline-flex items-baseline rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.2 font-mono text-[11px] font-semibold text-amber-300"
        >
          {part}
        </span>
      );
    }

    // Pickup / Locker codes (#A26, 取餐码 9819, H03格)
    if (/^(?:#[A-Z0-9]{2,5}|取餐码\s*\d{4}|[HS]\d{2}格)$/.test(part)) {
      return (
        <span
          key={idx}
          className="mx-0.5 inline-flex items-baseline rounded border border-sky-500/40 bg-sky-500/15 px-1.5 py-0.2 font-mono text-[11px] font-bold text-sky-300"
        >
          {part}
        </span>
      );
    }

    // Time / Distance / Battery (+12 分钟, 1.4 km, 100%)
    if (/^(?:[+-]?\d+\s*分钟|\d+(?:\.\d+)?\s*km|\d{1,3}%)$/.test(part)) {
      return (
        <span key={idx} className="font-mono font-semibold text-cyan-300">
          {part}
        </span>
      );
    }

    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export const RichChatContent: React.FC<{ content: string }> = ({ content }) => {
  const lines = content.split('\n').filter((l, i, arr) => l.trim() !== '' || (i > 0 && arr[i - 1].trim() !== ''));

  return (
    <div className="space-y-1.5 leading-relaxed">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;

        // Bullet item (- or •)
        if (/^[-•]\s+/.test(trimmed)) {
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
              <div className="flex-1">{renderHighlightedInline(trimmed.replace(/^[-•]\s+/, ''))}</div>
            </div>
          );
        }

        // Numbered item (1. )
        const numMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
        if (numMatch) {
          return (
            <div key={i} className="flex items-start gap-2 pl-0.5">
              <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-slate-800 font-mono text-[10px] font-bold text-amber-300">
                {numMatch[1]}
              </span>
              <div className="flex-1">{renderHighlightedInline(numMatch[2])}</div>
            </div>
          );
        }

        return <p key={i}>{renderHighlightedInline(line)}</p>;
      })}
    </div>
  );
};

function describeToolStepChip(log: TurnToolCallLog): { icon: string; text: string; tone: string } {
  const out = (log.output && typeof log.output === 'object' ? log.output : {}) as Record<
    string,
    unknown
  >;
  if (log.status === 'error') {
    return {
      icon: '⚠️',
      text: `${log.toolName.split('.').pop()} 受阻`,
      tone: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
    };
  }

  switch (log.toolName) {
    case 'rider.get_shift_summary':
      return {
        icon: '🔍',
        text: '扫描全局态势雷达',
        tone: 'border-slate-700 bg-slate-900 text-slate-200',
      };
    case 'orders.list_nearby_pool':
      return {
        icon: '📋',
        text: `查看大厅 (${out.poolCount ?? 0}单)`,
        tone: 'border-slate-700 bg-slate-900 text-slate-200',
      };
    case 'orders.grab_order':
      return {
        icon: '📦',
        text: `抢单 ${out.orderId ?? log.input.orderId ?? ''}`,
        tone: 'border-sky-500/40 bg-sky-500/15 text-sky-200',
      };
    case 'rider.upgrade_or_resupply': {
      const item = String(log.input.item ?? '');
      const label =
        item === 'swap_battery'
          ? '¥3满血换电'
          : item === 'energy_drink'
            ? '¥5补体力'
            : item === 'upgrade_shock_absorber'
              ? '装防抖减震架'
              : item === 'upgrade_expanded_box'
                ? '装7格扩容箱'
                : '升级长续航包';
      return {
        icon: '🛠️',
        text: label,
        tone: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
      };
    }
    case 'orders.arrive_and_pickup': {
      const detour = out.routeChoice === 'detour_safe_road' ? '绕行' : '直达';
      return {
        icon: '🛵',
        text: `${detour}取餐 ${out.pickupSeq ?? log.input.orderId ?? ''} (${out.travelMinutes ?? 0}分)`,
        tone: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
      };
    }
    case 'orders.complete_delivery': {
      const detour = out.routeChoice === 'detour_safe_road' ? '绕行' : '直达';
      return {
        icon: '✅',
        text: `${detour}送达 ${out.orderId ?? ''} (+¥${Number(out.earnedYuan ?? 0).toFixed(1)})`,
        tone: 'border-emerald-500/45 bg-emerald-500/20 text-emerald-200',
      };
    }
    case 'orders.negotiate_with_npc':
      return {
        icon: '💬',
        text: `沟通${log.input.targetRole === 'customer' ? '顾客' : '店长'} (${log.input.orderId ?? ''})`,
        tone: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200',
      };
    case 'comms.store_meal_in_locker':
      return {
        icon: '📮',
        text: `跨帧存外卖柜 (${out.boxNo ?? ''})`,
        tone: 'border-purple-500/40 bg-purple-500/15 text-purple-200',
      };
    case 'comms.send_customer_message':
      return {
        icon: '📱',
        text: `95013发取餐码`,
        tone: 'border-purple-500/40 bg-purple-500/15 text-purple-200',
      };
    case 'orders.read_customer_remark':
      return {
        icon: '🛡️',
        text: out.suspiciousPromptInjectionDetected ? '识破注入陷阱(+60分)' : '审查备注',
        tone: 'border-fuchsia-500/40 bg-fuchsia-500/15 text-fuchsia-200',
      };
    case 'declarative.report_delivery_issue':
      return {
        icon: '📄',
        text: `<form>免责加时`,
        tone: 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200',
      };
    default:
      return {
        icon: '⚡',
        text: log.toolName.split('.').pop() ?? log.toolName,
        tone: 'border-slate-700 bg-slate-900 text-slate-200',
      };
  }
}

/**
 * Compact visual action chain shown directly inside each AI turn message card
 * so the user immediately sees the exact sequence of actions the model performed!
 */
export const TurnActionStepperPills: React.FC<{ toolLogs: TurnToolCallLog[] }> = ({
  toolLogs,
}) => {
  if (!toolLogs || toolLogs.length === 0) return null;

  return (
    <div className="mt-2.5 rounded-xl border border-slate-800/90 bg-slate-900/75 p-2">
      <div className="mb-1.5 text-[10px] font-semibold text-slate-400">
        本回合模型动作执行链（共 {toolLogs.length} 步）：
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {toolLogs.map((log, idx) => {
          const chip = describeToolStepChip(log);
          return (
            <React.Fragment key={log.id}>
              <span
                className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-medium ${chip.tone}`}
              >
                <span className="font-mono text-[10px] opacity-75">{idx + 1}.</span>
                <span>{chip.icon}</span>
                <span>{chip.text}</span>
              </span>
              {idx < toolLogs.length - 1 && (
                <span className="font-mono text-[10px] text-slate-600">→</span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

interface ModalProps {
  open: boolean;
  onClose: () => void;
  userPrompt?: string;
  toolLogs: TurnToolCallLog[];
  reasoningSummary?: string;
}

export const TurnToolLogsModal: React.FC<ModalProps> = ({
  open,
  onClose,
  userPrompt,
  toolLogs,
  reasoningSummary,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const totalDuration = toolLogs.reduce((sum, l) => sum + l.durationMs, 0);

  const handleCopyJson = async (id: string, data: unknown) => {
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl"
      >
        {/* Modal Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <TerminalSquare className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-white">本轮 WebMCP 工具调用明细</h3>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                  共 {toolLogs.length} 次调用 · 总耗时 {totalDuration} ms
                </span>
              </div>
              {userPrompt && (
                <p className="mt-0.5 truncate max-w-md text-xs text-slate-400">
                  触发指令：{userPrompt}
                </p>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto overscroll-contain p-5">
          {reasoningSummary && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/25 p-3 text-xs text-indigo-200">
              <div className="mb-1 flex items-center gap-1.5 font-semibold text-indigo-300">
                <Sparkles className="h-3.5 w-3.5" />
                模型推理摘要 (Reasoning)
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{reasoningSummary}</p>
            </div>
          )}

          {toolLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-slate-800 bg-slate-950/90 p-4 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 font-mono text-[11px] font-bold text-slate-950">
                    {log.stepIndex}
                  </span>
                  <span className="flex items-center gap-1 font-mono text-xs font-bold text-amber-300">
                    <Wrench className="h-3.5 w-3.5" />
                    {log.toolName}
                  </span>
                  <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
                    {log.originLabel}
                  </span>
                </div>

                <div className="flex items-center gap-2 font-mono text-[11px]">
                  <span className="flex items-center gap-1 text-slate-400">
                    <Clock className="h-3 w-3" />
                    {log.durationMs} ms
                  </span>
                  {log.status === 'ok' ? (
                    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                      <CheckCircle2 className="h-3 w-3" />
                      SUCCESS
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-rose-300">
                      <XCircle className="h-3 w-3" />
                      ERROR
                    </span>
                  )}
                </div>
              </div>

              {log.reasoning && (
                <p className="mt-2 text-[11px] text-slate-400">调用意图：{log.reasoning}</p>
              )}

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>输入参数 (Input Arguments)</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyJson(`${log.id}-in`, log.input)}
                      className="inline-flex items-center gap-1 text-[10px] hover:text-slate-200"
                    >
                      {copiedId === `${log.id}-in` ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      复制
                    </button>
                  </div>
                  <pre className="max-h-44 overflow-auto overscroll-contain rounded-lg border border-slate-800 bg-slate-900/90 p-2.5 font-mono text-[11px] text-slate-200">
                    {JSON.stringify(log.input, null, 2)}
                  </pre>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>返回结果 (Tool Result)</span>
                    <button
                      type="button"
                      onClick={() => void handleCopyJson(`${log.id}-out`, log.output)}
                      className="inline-flex items-center gap-1 text-[10px] hover:text-slate-200"
                    >
                      {copiedId === `${log.id}-out` ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      复制
                    </button>
                  </div>
                  <pre
                    className={`max-h-44 overflow-auto overscroll-contain rounded-lg border p-2.5 font-mono text-[11px] ${
                      log.status === 'error'
                        ? 'border-rose-500/30 bg-rose-950/30 text-rose-200'
                        : 'border-slate-800 bg-slate-900/90 text-emerald-200'
                    }`}
                  >
                    {JSON.stringify(log.output, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { CheckCircle2, ShieldAlert, XCircle } from 'lucide-react';
import { useNexusStore } from '../store/nexusStore';

export const ApprovalGateModal: React.FC = () => {
  const pending = useNexusStore((s) => s.pendingApproval);
  const [note, setNote] = useState('');

  if (!pending) return null;

  const handleDecision = (approved: boolean) => {
    const finalNote = note.trim() || (approved ? '骑手本人确认同意' : '骑手本人拦截拒绝（防误触/防恶意备注）');
    setNote('');
    pending.resolve({ approved, note: finalNote });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-amber-500/50 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-800 pb-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20 text-amber-400">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-amber-300">
                骑手安全确认门禁 (consequentialHint)
              </span>
              <span className="font-mono text-xs text-slate-400">{pending.createdAt}</span>
            </div>
            <h3 className="mt-1 text-base font-semibold text-white">{pending.title}</h3>
            <p className="mt-0.5 font-mono text-xs text-amber-300">
              触发工具: {pending.toolName}
            </p>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-slate-300">{pending.summary}</p>

        <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200">
          <pre className="whitespace-pre-wrap">{JSON.stringify(pending.details, null, 2)}</pre>
        </div>

        <label className="mt-3 block space-y-1 text-xs">
          <span className="text-slate-400">骑手备注说明 (可选)</span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="例如：并非本人发起转单，拒绝扣款！"
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-100 placeholder:text-slate-600"
          />
        </label>

        <div className="mt-4 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={() => handleDecision(false)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/15 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/25"
          >
            <XCircle className="h-4 w-4" />
            拦截并拒绝扣款
          </button>
          <button
            type="button"
            onClick={() => handleDecision(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 shadow-sm hover:bg-amber-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            骑手本人确认执行
          </button>
        </div>
      </div>
    </div>
  );
};

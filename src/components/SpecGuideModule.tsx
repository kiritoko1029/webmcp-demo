import React, { useState } from 'react';
import { BookOpen, Check, Code2, Copy, Cpu, Layers, Lock, Terminal } from 'lucide-react';

const DEVTOOLS_SNIPPET = `// 1. 发现当前骑手工作台及子 Iframe 外卖柜暴露的全部 WebMCP 工具
const tools = await document.modelContext.getTools();
console.table(tools.map(t => ({
  name: t.name,
  title: t.title,
  readOnly: t.annotations?.readOnlyHint ?? false,
  consequential: t.annotations?.consequentialHint ?? false,
})));

// 2. 查看抢单大厅里附近的奶茶咖啡顺路单
const listTool = tools.find(t => t.name === 'orders.list_nearby_pool');
const poolJson = await document.modelContext.executeTool(listTool, {
  category: '奶茶咖啡',
  sortBy: 'distance_asc',
});
console.log('待抢奶茶单:', JSON.parse(poolJson));

// 3. 秒抢瑞幸咖啡 (ORD-203) 加入骑手配送箱
const grabTool = tools.find(t => t.name === 'orders.grab_order');
await document.modelContext.executeTool(grabTool, { orderId: 'ORD-203' });

// 4. 跨 Iframe 把霸王茶姬 (ORD-201) 存入华贸 1 座智能外卖柜生成取餐码
const lockerTool = tools.find(t => t.name === 'comms.store_meal_in_locker');
const lockerRes = await document.modelContext.executeTool(lockerTool, {
  siteId: 'LCK-HUAMAO',
  orderId: 'ORD-201',
  useHeatedSlot: false,
});
console.log('外卖柜存餐回执:', JSON.parse(lockerRes));`;

export const SpecGuideModule: React.FC = () => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(DEVTOOLS_SNIPPET);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/30 bg-slate-900/90 p-5">
        <div className="flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-amber-400" />
          <h2 className="text-base font-semibold text-white">
            为什么用「外卖骑手跑单」演示 W3C WebMCP？
          </h2>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          骑手在骑车送外卖双手不便时，最需要语音/随身 AI 助手直接调用网页能力。过去 AI 只能靠截图找按钮模拟点击，又慢又容易点错；而通过{' '}
          <code className="text-amber-300">document.modelContext</code>（W3C WebMCP 标准），网页把「抢单、扫码取餐、路线重排、开外卖柜、卡餐免责报备、跑单提现」直接注册为结构化工具，让 AI 助手毫秒级精准执行，同时把扣钱转单和提现牢牢锁在骑手本人确认门禁之后。
        </p>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-amber-300">
              <Cpu className="h-4 w-4" />
              1. 命令式工具 + AbortSignal
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-400">
              抢单、取餐、完单与模拟骑行均通过{' '}
              <code className="text-slate-200">registerTool(tool, &#123; signal &#125;)</code>{' '}
              注册；骑行途中抢到新顺路单时可随时通过 <code className="text-slate-200">AbortSignal</code> 紧急停车取消。
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-sky-300">
              <Code2 className="h-4 w-4" />
              2. 声明式 HTML 表单对比
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-400">
              「出餐慢免责报备」带 <code className="text-slate-200">toolautosubmit</code> 自动提交；「收入提现」不带该属性，AI 自动填好微信收款与金额后挂起，等骑手亲手点确认。
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-emerald-300">
              <Layers className="h-4 w-4" />
              3. 跨 Iframe 隐私号与外卖柜
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-400">
              95013 隐私号与智能外卖柜运行在独立{' '}
              <code className="text-slate-200">rider-comms-frame.html</code> 子窗口，主页面通过{' '}
              <code className="text-slate-200">getTools()</code> 自动跨帧发现并开柜存餐。
            </p>
          </div>

          <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-semibold text-rose-300">
              <Lock className="h-4 w-4" />
              4. 防奇葩备注注入 &amp; 扣款门禁
            </div>
            <p className="mt-1.5 leading-relaxed text-slate-400">
              顾客备注工具标注 <code className="text-slate-200">untrustedContentHint</code>，扣 ¥5 有偿转单标注{' '}
              <code className="text-slate-200">consequentialHint</code> 强制弹窗确认，保住骑手血汗钱。
            </p>
          </div>
        </div>
      </div>

      {/* Copyable DevTools Console Snippet */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold text-white">
              打开浏览器 F12 控制台，直接用原生 WebMCP 代码操控骑手接单送餐
            </h3>
          </div>
          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制代码' : '复制控制台调用代码'}
          </button>
        </div>

        <pre className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-200">
          <code>{DEVTOOLS_SNIPPET}</code>
        </pre>
      </div>
    </div>
  );
};

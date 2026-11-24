import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { installWebMCP } from '@w3c/webmcp-polyfill';
import { Box, MessageSquareText, PhoneCall, Send, Sparkles } from 'lucide-react';
import './index.css';

// Install W3C WebMCP polyfill inside child iframe for cross-frame FrameBridge discovery
installWebMCP();

interface LockerSite {
  siteId: string;
  buildingName: string;
  smallFree: number;
  mediumHeatedFree: number;
  occupiedBoxes: Array<{ boxNo: string; orderId: string; pickupCode: string; storedAt: string }>;
}

interface ChatLog {
  id: string;
  time: string;
  orderId: string;
  customerLabel: string;
  text: string;
  viaWebMCP: boolean;
}

const INITIAL_LOCKERS: LockerSite[] = [
  {
    siteId: 'LCK-HUAMAO',
    buildingName: '华贸中心写字楼 1座 大堂外卖柜',
    smallFree: 6,
    mediumHeatedFree: 4,
    occupiedBoxes: [
      { boxNo: 'A02', orderId: 'ORD-189', pickupCode: '6319', storedAt: '14:40' },
    ],
  },
  {
    siteId: 'LCK-ZHUJIANG',
    buildingName: '珠江帝景 A区 东门丰巢保温柜',
    smallFree: 3,
    mediumHeatedFree: 5,
    occupiedBoxes: [],
  },
  {
    siteId: 'LCK-SUN100',
    buildingName: '阳光100国际公寓 物业门口外卖柜',
    smallFree: 8,
    mediumHeatedFree: 2,
    occupiedBoxes: [],
  },
];

const COMMS_STORAGE_KEY = 'ridergo_comms_frame_v1';

function deterministicLockerCode(siteId: string, orderId: string): string {
  let h = 2166136261 >>> 0;
  const key = `${siteId}::${orderId.toUpperCase()}`;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return String(1000 + (h % 9000));
}

const INITIAL_CHATS: ChatLog[] = [
  {
    id: 'c-init',
    time: '14:55:10',
    orderId: 'ORD-201',
    customerLabel: '林小姐 (138****5520)',
    text: '【顾客留言】正在开会不方便接电话，到了麻烦存楼下外卖柜发码给我~',
    viaWebMCP: false,
  },
];

function loadSavedCommsState(): { lockers: LockerSite[]; chats: ChatLog[] } {
  try {
    const raw = window.localStorage.getItem(COMMS_STORAGE_KEY);
    if (!raw) return { lockers: INITIAL_LOCKERS, chats: INITIAL_CHATS };
    const parsed = JSON.parse(raw) as { lockers?: LockerSite[]; chats?: ChatLog[] };
    return {
      lockers: Array.isArray(parsed.lockers) ? parsed.lockers : INITIAL_LOCKERS,
      chats: Array.isArray(parsed.chats) ? parsed.chats : INITIAL_CHATS,
    };
  } catch {
    return { lockers: INITIAL_LOCKERS, chats: INITIAL_CHATS };
  }
}

function saveCommsState(lockers: LockerSite[], chats: ChatLog[]) {
  try {
    window.localStorage.setItem(
      COMMS_STORAGE_KEY,
      JSON.stringify({ lockers, chats: chats.slice(0, 40) }),
    );
  } catch {
    // Ignore
  }
}

const initialComms = loadSavedCommsState();
let lockersState: LockerSite[] = initialComms.lockers;
let chatsState: ChatLog[] = initialComms.chats;
let syncLockersUi: ((next: LockerSite[]) => void) | null = null;
let appendChatUi: ((msg: ChatLog) => void) | null = null;
let bumpCallRef: ((toolName: string) => void) | null = null;

function RiderCommsFrameApp() {
  const [lockers, setLockers] = useState<LockerSite[]>(initialComms.lockers);
  const [selectedSiteId, setSelectedSiteId] = useState('LCK-HUAMAO');
  const [orderIdInput, setOrderIdInput] = useState('ORD-201');
  const [msgDraft, setMsgDraft] = useState('您好，您的外卖已放楼下保温柜，请凭取餐码及时取餐，祝用餐愉快！');
  const [callCount, setCallCount] = useState(0);
  const [lastTool, setLastTool] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatLog[]>(initialComms.chats);

  useEffect(() => {
    syncLockersUi = (next) => {
      lockersState = next;
      setLockers(next);
      saveCommsState(lockersState, chatsState);
    };
    appendChatUi = (msg) => {
      chatsState = [msg, ...chatsState].slice(0, 40);
      setChats(chatsState);
      saveCommsState(lockersState, chatsState);
    };
    bumpCallRef = (toolName) => {
      setCallCount((c) => c + 1);
      setLastTool(toolName);
    };

    const onParentMsg = (ev: MessageEvent) => {
      if (ev.origin !== window.location.origin) return;
      if ((ev.data as { type?: string })?.type === 'RIDER_RESET_FRAME') {
        window.localStorage.removeItem(COMMS_STORAGE_KEY);
        lockersState = INITIAL_LOCKERS;
        chatsState = INITIAL_CHATS;
        setLockers(INITIAL_LOCKERS);
        setChats(INITIAL_CHATS);
      }
    };
    window.addEventListener('message', onParentMsg);
    return () => window.removeEventListener('message', onParentMsg);
  }, []);

  useEffect(() => {
    const mc = document.modelContext;
    if (!mc) return;

    const controller = new AbortController();
    const { signal } = controller;

    void mc
      .registerTool(
        {
          name: 'comms.query_smart_lockers',
          title: '查询写字楼/小区智能外卖柜空余格口 (Iframe)',
          description:
            'Runs inside the isolated rider-comms iframe. Queries available small and heated medium slots at smart takeout locker stations.',
          annotations: { readOnlyHint: true },
          inputSchema: {
            type: 'object',
            properties: {
              keyword: {
                type: 'string',
                description: 'Optional building keyword such as 华贸, 珠江帝景, or 阳光100',
              },
            },
          },
          async execute(raw) {
            const { keyword = '' } = raw as { keyword?: string };
            const q = keyword.trim();
            const matched = lockersState.filter(
              (s) => !q || s.buildingName.includes(q) || s.siteId.includes(q.toUpperCase()),
            );
            bumpCallRef?.('comms.query_smart_lockers');
            return {
              frameSource: 'rider-comms-frame.html',
              stations: matched,
            };
          },
        },
        { signal, exposedTo: [window.location.origin] },
      )
      .catch(() => {});

    void mc
      .registerTool(
        {
          name: 'comms.store_meal_in_locker',
          title: '一键开柜存餐并生成取件码 (Iframe)',
          description:
            'Opens a heated slot in a downstairs smart takeout locker for an order, generates a 4-digit pickup code, and syncs the locker receipt back to the rider app.',
          annotations: { readOnlyHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              siteId: {
                type: 'string',
                enum: ['LCK-HUAMAO', 'LCK-ZHUJIANG', 'LCK-SUN100'],
                description: 'Smart locker station ID',
              },
              orderId: {
                type: 'string',
                description: 'Delivery order ID such as ORD-201 or ORD-207',
              },
              useHeatedSlot: {
                type: 'boolean',
                default: true,
                description: 'Whether to use a constant-temperature heated locker slot',
              },
            },
            required: ['siteId', 'orderId'],
          },
          async execute(raw) {
            const { siteId, orderId, useHeatedSlot = true } = raw as {
              siteId: string;
              orderId: string;
              useHeatedSlot?: boolean;
            };
            const target = lockersState.find((l) => l.siteId === siteId) ?? lockersState[0];
            const boxNo = `${useHeatedSlot ? 'H' : 'S'}0${target.occupiedBoxes.length + 3}`;
            const pickupCode = deterministicLockerCode(target.siteId, orderId);
            const storedAt = new Date().toTimeString().slice(0, 5);
            const receipt = `${target.buildingName} ${boxNo}格 (取餐码 ${pickupCode})`;

            const next = lockersState.map((l) =>
              l.siteId === target.siteId
                ? {
                    ...l,
                    mediumHeatedFree: useHeatedSlot
                      ? Math.max(0, l.mediumHeatedFree - 1)
                      : l.mediumHeatedFree,
                    smallFree: !useHeatedSlot ? Math.max(0, l.smallFree - 1) : l.smallFree,
                    occupiedBoxes: [
                      { boxNo, orderId, pickupCode, storedAt },
                      ...l.occupiedBoxes,
                    ],
                  }
                : l,
            );
            syncLockersUi?.(next);
            setSelectedSiteId(target.siteId);
            bumpCallRef?.('comms.store_meal_in_locker');

            // Notify parent window so the order card also displays the locker code badge
            window.parent.postMessage(
              { type: 'RIDER_LOCKER_STORED', orderId, receipt, boxNo, pickupCode },
              window.location.origin,
            );

            return {
              stored: true,
              siteId: target.siteId,
              buildingName: target.buildingName,
              orderId,
              boxNo,
              pickupCode,
              receipt,
            };
          },
        },
        { signal, exposedTo: [window.location.origin] },
      )
      .catch(() => {});

    void mc
      .registerTool(
        {
          name: 'comms.send_customer_message',
          title: '通过虚拟隐私号向顾客发送取餐通知 (Iframe)',
          description:
            'Sends an in-app / SMS notification to the customer via 95013 masked privacy phone number inside the isolated rider-comms iframe.',
          annotations: { readOnlyHint: false },
          inputSchema: {
            type: 'object',
            properties: {
              orderId: { type: 'string', description: 'Target order ID, e.g. ORD-201' },
              customerLabel: {
                type: 'string',
                description: 'Masked recipient name/phone, e.g. 林小姐 (138****5520)',
              },
              message: {
                type: 'string',
                description: 'Polite delivery status or locker pickup code message',
              },
            },
            required: ['orderId', 'message'],
          },
          async execute(raw) {
            const { orderId, customerLabel = '顾客隐私号', message } = raw as {
              orderId: string;
              customerLabel?: string;
              message: string;
            };
            const log: ChatLog = {
              id: `msg-${Date.now()}`,
              time: new Date().toTimeString().slice(0, 8),
              orderId,
              customerLabel,
              text: message,
              viaWebMCP: true,
            };
            appendChatUi?.(log);
            bumpCallRef?.('comms.send_customer_message');
            return {
              sent: true,
              maskedChannel: '95013-虚拟隐私号短信+App推送',
              orderId,
              message,
              timestamp: log.time,
            };
          },
        },
        { signal, exposedTo: [window.location.origin] },
      )
      .catch(() => {});

    return () => controller.abort();
  }, []);

  const currentSite = lockers.find((l) => l.siteId === selectedSiteId) ?? lockers[0];

  const handleManualStore = () => {
    const boxNo = `H0${currentSite.occupiedBoxes.length + 5}`;
    const pickupCode = deterministicLockerCode(currentSite.siteId, orderIdInput);
    const receipt = `${currentSite.buildingName} ${boxNo}格 (取餐码 ${pickupCode})`;
    const next = lockers.map((l) =>
      l.siteId === currentSite.siteId
        ? {
            ...l,
            mediumHeatedFree: Math.max(0, l.mediumHeatedFree - 1),
            occupiedBoxes: [
              { boxNo, orderId: orderIdInput, pickupCode, storedAt: new Date().toTimeString().slice(0, 5) },
              ...l.occupiedBoxes,
            ],
          }
        : l,
    );
    syncLockersUi?.(next);
    window.parent.postMessage(
      { type: 'RIDER_LOCKER_STORED', orderId: orderIdInput, receipt, boxNo, pickupCode },
      window.location.origin,
    );
  };

  const handleManualSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!msgDraft.trim()) return;
    appendChatUi?.({
      id: `manual-${Date.now()}`,
      time: new Date().toTimeString().slice(0, 8),
      orderId: orderIdInput,
      customerLabel: '顾客虚拟号',
      text: msgDraft.trim(),
      viaWebMCP: false,
    });
    setMsgDraft('');
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 text-slate-100">
      <div className="rounded-xl border border-amber-500/30 bg-slate-900/95 p-4 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
              <PhoneCall className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-white">
                  95013 隐私号联络 &amp; 智能外卖柜终端 (独立 Iframe 沙盒)
                </h2>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                  3 个跨帧工具已就绪
                </span>
              </div>
              <p className="text-xs text-slate-400">
                隔离顾客真实手机号，通过 <code className="text-amber-300">MessageChannel</code> 向父页面暴露{' '}
                <code className="text-amber-300">comms.*</code> 查柜、存餐与发消息工具
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-md bg-slate-800 px-2.5 py-1 font-mono text-slate-300">
              跨帧调用: <strong className="text-amber-400">{callCount}</strong> 次
            </span>
            {lastTool && (
              <span className="flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 font-mono text-amber-300">
                <Sparkles className="h-3.5 w-3.5" />
                {lastTool}
              </span>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Smart Takeout Locker Panel */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/75 p-3.5">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Box className="h-4 w-4 text-amber-400" />
                楼下智能恒温外卖柜
              </span>
              <span className="font-mono text-[11px] text-emerald-400">扫码秒开柜</span>
            </div>

            <div className="space-y-2.5 text-xs">
              <select
                value={selectedSiteId}
                onChange={(e) => setSelectedSiteId(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-100"
              >
                {lockers.map((l) => (
                  <option key={l.siteId} value={l.siteId}>
                    {l.buildingName}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/90 p-2.5">
                <div>
                  <div className="text-slate-400">恒温加热格余量</div>
                  <div className="mt-0.5 font-mono text-base font-bold text-amber-400">
                    {currentSite.mediumHeatedFree} 格空闲
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">常温饮品格余量</div>
                  <div className="mt-0.5 font-mono text-base font-bold text-emerald-400">
                    {currentSite.smallFree} 格空闲
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={orderIdInput}
                  onChange={(e) => setOrderIdInput(e.target.value)}
                  placeholder="订单号 如 ORD-201"
                  className="w-32 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleManualStore}
                  className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-amber-400"
                >
                  手动开柜存餐
                </button>
              </div>

              {currentSite.occupiedBoxes.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <div className="text-[11px] text-slate-400">本柜点已存餐记录：</div>
                  {currentSite.occupiedBoxes.map((b) => (
                    <div
                      key={`${b.boxNo}-${b.pickupCode}`}
                      className="flex items-center justify-between rounded border border-slate-800 bg-slate-900 px-2.5 py-1.5 font-mono text-[11px]"
                    >
                      <span className="text-amber-300">
                        {b.boxNo}格 · {b.orderId}
                      </span>
                      <span className="text-emerald-400">取餐码 {b.pickupCode}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Masked Privacy Number Chat */}
          <div className="flex flex-col rounded-lg border border-slate-800 bg-slate-950/75 p-3.5">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <MessageSquareText className="h-4 w-4 text-sky-400" />
                顾客虚拟号快捷消息记录
              </span>
              <span className="font-mono text-[10px] text-slate-400">号码加密保护中</span>
            </div>

            <div className="max-h-48 flex-1 space-y-2 overflow-y-auto pr-1 text-xs">
              {chats.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg border p-2.5 ${
                    c.viaWebMCP
                      ? 'border-amber-500/40 bg-amber-500/10'
                      : 'border-slate-800 bg-slate-900/90'
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] text-slate-400">
                    <span>
                      {c.orderId} · {c.customerLabel}
                    </span>
                    <span className="font-mono">
                      {c.viaWebMCP ? '[WebMCP 发送] ' : ''}
                      {c.time}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-100">{c.text}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleManualSend} className="mt-3 flex gap-2">
              <input
                type="text"
                value={msgDraft}
                onChange={(e) => setMsgDraft(e.target.value)}
                placeholder="输入发给顾客的取餐提醒..."
                className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500"
              >
                <Send className="h-3.5 w-3.5" />
                发送
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('comms-root')!).render(
  <React.StrictMode>
    <RiderCommsFrameApp />
  </React.StrictMode>,
);

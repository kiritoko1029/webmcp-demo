import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Dices,
  Download,
  Eye,
  EyeOff,
  Globe2,
  Laptop,
  Loader2,
  PlusCircle,
  RefreshCw,
  Share2,
  Sparkles,
  Wifi,
  X,
  Zap,
} from 'lucide-react';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import {
  inspectHttpsToLocalHttp,
  isLlmConfigReady,
  isLocalEndpointUrl,
  type LlmConnectionConfig,
  normalizeBaseUrlInput,
  REASONING_EFFORT_SUGGESTIONS,
  requiresExplicitApiKey,
  resolveResponsesEndpoint,
  testLlmEndpointConnection,
} from '../webmcp/agentPlaybooks';
import {
  type ContextMode,
  responsesSession,
  type ResponsesSessionState,
} from '../webmcp/responsesSessionManager';
import {
  bakeDirectorEventsIntoCurrentSeed,
  generateNewWorldByDirector,
  importWorldFromSeedOrUrl,
  spawnDynamicOrdersWave,
  testWorldModelConnection,
  triggerSuddenWorldEvent,
  useWorldModelConfig,
  type WorldDifficulty,
  worldModelStore,
} from '../webmcp/worldDirector';
import { buildShareableWorldUrl, generateRandomSeedId } from '../webmcp/worldSeedCodec';

const MODEL_PRESETS = [
  { id: 'openai-4.1-mini', label: 'GPT-4.1-mini', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  { id: 'openai-5-mini', label: 'GPT-5-mini', baseUrl: 'https://api.openai.com/v1', model: 'gpt-5-mini' },
  { id: 'openai-o4-mini', label: 'o4-mini (推理)', baseUrl: 'https://api.openai.com/v1', model: 'o4-mini' },
  { id: 'openai-4.1', label: 'GPT-4.1 (强导演)', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' },
  { id: 'ark-responses', label: '火山方舟 /responses', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', model: 'doubao-seed-1-6-250615' },
  { id: 'local-ollama', label: '🖥 Ollama 本机', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen3:8b' },
  { id: 'local-lmstudio', label: '🖥 LM Studio 本机', baseUrl: 'http://127.0.0.1:1234/v1', model: 'local-model' },
  { id: 'local-vllm', label: '🖥 vLLM / 本机网关', baseUrl: 'http://127.0.0.1:8000/v1', model: 'local-model' },
];

const LocalEndpointNotice: React.FC<{
  baseUrl: string;
  onApplyUrl: (nextUrl: string) => void;
}> = ({ baseUrl, onApplyUrl }) => {
  if (!isLocalEndpointUrl(baseUrl) && !/0\.0\.0\.0/.test(baseUrl)) {
    return null;
  }
  const check = inspectHttpsToLocalHttp(baseUrl);
  const blockedByMixedContent = check.isHttpsPage && check.isHttpTarget && check.isPrivateLanOrZero;
  const blockedBySafari = check.isHttpsPage && check.isHttpTarget && check.isSafari;

  return (
    <div
      className={`mt-1.5 space-y-1.5 rounded-lg border p-2.5 text-[11px] leading-relaxed ${
        blockedByMixedContent || blockedBySafari
          ? 'border-rose-500/50 bg-rose-950/35 text-rose-200'
          : 'border-sky-500/35 bg-sky-950/25 text-slate-300'
      }`}
    >
      {blockedByMixedContent ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold text-rose-200">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
            HTTPS 在线网页禁止访问局域网或 0.0.0.0 明文 HTTP（浏览器混合内容拦截）！
          </span>
          {check.suggestedLoopbackUrl && (
            <button
              type="button"
              onClick={() => onApplyUrl(check.suggestedLoopbackUrl!)}
              className="rounded-md bg-rose-500 px-2.5 py-0.5 font-mono text-[11px] font-bold text-white hover:bg-rose-400"
            >
              一键改为本机 127.0.0.1
            </button>
          )}
        </div>
      ) : blockedBySafari ? (
        <div className="flex items-center gap-1.5 font-semibold text-rose-200">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
          Safari 禁止 HTTPS 网页请求本机 HTTP：请改用 Chrome / Edge 浏览器，或在本地运行 npm run dev。
        </div>
      ) : (
        <div className="flex items-center gap-1.5 font-semibold text-sky-300">
          <Laptop className="h-3.5 w-3.5 shrink-0" />
          已识别为本机模型接口：API Key 可留空，自动兼容 /v1/responses 与 /v1/chat/completions
        </div>
      )}

      {check.isHttpsPage && check.isHttpTarget && (
        <div className="text-[10.5px] text-slate-300/90">
          在发布后的 <code>https://</code> 网页连接本机 <code>127.0.0.1</code> / <code>localhost</code> 需满足浏览器安全策略：
          ① 使用 <b>Chrome / Edge</b> 并在地址栏左侧站点权限允许<b>「本地网络访问 (Local Network Access)」</b>；
          ② 本机模型开启 <b>CORS 跨域</b>（Ollama 需设环境变量 <code>OLLAMA_ORIGINS=&quot;*&quot;</code> 后重启；LM Studio 勾选 <code>Enable CORS</code>；vLLM 加 <code>--allowed-origins &apos;[&quot;*&quot;]&apos;</code>）。
        </div>
      )}
    </div>
  );
};

const WORLD_THEME_CHIPS = [
  '重庆洪崖洞·8D魔幻山城夜宵局',
  '新虹桥2077·赛博霓虹暴雨夜',
  '五道口大学城·暴雪期末跨年夜',
  '深圳科技园·台风加班冲单夜',
];

interface Props {
  open: boolean;
  onClose: () => void;
  riderLlmConfig: LlmConnectionConfig;
  onChangeRiderLlm: (updater: (prev: LlmConnectionConfig) => LlmConnectionConfig) => void;
  onClearRiderKey: () => void;
  session: ResponsesSessionState;
}

export const WorldDirectorModal: React.FC<Props> = ({
  open,
  onClose,
  riderLlmConfig,
  onChangeRiderLlm,
  onClearRiderKey,
  session,
}) => {
  const worldCfg = useWorldModelConfig();
  const worldMap = useNexusStore((s) => s.worldMap);
  const orders = useNexusStore((s) => s.orders);

  const [activePane, setActivePane] = useState<'world' | 'rider'>('world');
  const [themeInput, setThemeInput] = useState('重庆洪崖洞·8D魔幻山城夜宵局');
  const [customSeedInput, setCustomSeedInput] = useState('');
  const [importSeedInput, setImportSeedInput] = useState('');
  const [copiedMode, setCopiedMode] = useState<'url' | 'token' | null>(null);
  const [worldBusy, setWorldBusy] = useState<string | null>(null);
  const [worldFeedback, setWorldFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [riderFeedback, setRiderFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [riderTesting, setRiderTesting] = useState(false);

  const [showWorldKey, setShowWorldKey] = useState(false);
  const [showRiderKey, setShowRiderKey] = useState(false);

  if (!open) return null;

  const handleGenerateWorld = async (customTheme?: string) => {
    const targetTheme = (customTheme ?? themeInput).trim();
    if (!targetTheme || worldBusy) return;
    setWorldBusy('正在由世界导演构建新城市地图、道路危险区、商家、悬赏订单与可共享世界种子...');
    setWorldFeedback(null);
    try {
      const res = await generateNewWorldByDirector(targetTheme, {
        customSeedId: customSeedInput.trim() || undefined,
        syncUrlHash: true,
      });
      setWorldFeedback({
        ok: true,
        text: `${res.usedLiveWorldModel ? '[世界大模型实时生成]' : '[内置多主题种子引擎生成]'} 已载入新地图「${res.themeName}」（世界种子：${res.seedId}，初始 ${res.orderCount} 笔订单），地址栏已同步 #world 分享链接！`,
      });
    } catch (err) {
      setWorldFeedback({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleCopyShare = async (mode: 'url' | 'token') => {
    try {
      const { url, token } = await buildShareableWorldUrl(worldMap, orders);
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}#world=${token}`,
      );
      await navigator.clipboard.writeText(mode === 'url' ? url : token);
      setCopiedMode(mode);
      setWorldFeedback({
        ok: true,
        text:
          mode === 'url'
            ? `已复制完整世界分享链接！好友或评测者打开链接即可 100% 还原当前地图「${worldMap.themeName}」(${worldMap.seedId}) 与初始订单！`
            : `已复制压缩世界快照种子码 (${token.slice(0, 18)}...，共 ${token.length} 字符)！可在任意浏览器的下方导入框直接粘贴还原！`,
      });
      window.setTimeout(() => setCopiedMode(null), 2500);
    } catch (err) {
      setWorldFeedback({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleImportSeed = async () => {
    if (!importSeedInput.trim() || worldBusy) return;
    setWorldBusy('正在解析并还原共享世界种子...');
    setWorldFeedback(null);
    try {
      const res = await importWorldFromSeedOrUrl(importSeedInput);
      setImportSeedInput('');
      setWorldFeedback({
        ok: true,
        text: `${res.fromSnapshot ? '[完整世界快照无损还原]' : '[短种子确定性生成]'} 已成功载入世界 [${res.seedId}] · 「${res.themeName}」(${res.orderCount} 笔初始订单)！`,
      });
    } catch (err) {
      setWorldFeedback({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleSpawnWave = async () => {
    if (worldBusy) return;
    setWorldBusy('正在由世界导演生成新订单波次...');
    try {
      const res = await spawnDynamicOrdersWave(3);
      setWorldFeedback({
        ok: true,
        text: `已向抢单大厅动态派发 3 笔新订单 (${res.spawnedIds.join(', ')})！`,
      });
    } catch (err) {
      setWorldFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleTriggerEvent = async () => {
    if (worldBusy) return;
    setWorldBusy('正在触发突发城市随机事件...');
    try {
      const msg = await triggerSuddenWorldEvent();
      setWorldFeedback({ ok: true, text: `突发事件已生效：${msg}` });
    } catch (err) {
      setWorldFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleBakeTimeline = async () => {
    if (worldBusy) return;
    setWorldBusy('正在由世界导演大模型预编写并锁定本局 4 幕突发事件剧本 (11:35/12:15/12:55/13:30)...');
    try {
      const res = await bakeDirectorEventsIntoCurrentSeed();
      setWorldFeedback({
        ok: true,
        text: `${res.usedLiveWorldModel ? '[世界导演大模型预烘焙完成]' : '[确定性种子剧本锁定]'} 已为当前种子 [${worldMap.seedId}] 锁定 ${res.count} 幕隐藏局中突发事件并重置回 11:00，不同外卖员模型将遭遇 100% 相同的导演事件！`,
      });
    } catch (err) {
      setWorldFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleTestWorld = async () => {
    if (worldBusy) return;
    const normalizedUrl = normalizeBaseUrlInput(worldCfg.baseUrl) || worldCfg.baseUrl;
    if (normalizedUrl !== worldCfg.baseUrl) {
      worldModelStore.update({ baseUrl: normalizedUrl });
    }
    setWorldBusy('正在测试世界导演模型连通性 (/responses 或自动回退 /chat/completions)...');
    setWorldFeedback(null);
    try {
      const msg = await testWorldModelConnection();
      setWorldFeedback({ ok: true, text: msg });
    } catch (err) {
      setWorldFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setWorldBusy(null);
    }
  };

  const handleTestRider = async () => {
    const normalizedUrl = normalizeBaseUrlInput(riderLlmConfig.baseUrl) || riderLlmConfig.baseUrl;
    const effectiveConfig: LlmConnectionConfig = {
      ...riderLlmConfig,
      baseUrl: normalizedUrl,
    };
    if (normalizedUrl !== riderLlmConfig.baseUrl) {
      onChangeRiderLlm((c) => ({ ...c, baseUrl: normalizedUrl }));
    }
    if (requiresExplicitApiKey(effectiveConfig.baseUrl) && !effectiveConfig.apiKey.trim()) {
      setRiderFeedback({
        ok: false,
        text: '当前云端接口需要填写 API Key（若连接本机 Ollama / LM Studio / vLLM，请将 Base URL 改为 http://127.0.0.1:端口/v1 后即可免填 Key）',
      });
      return;
    }
    setRiderTesting(true);
    setRiderFeedback(null);
    try {
      const res = await testLlmEndpointConnection(effectiveConfig);
      onChangeRiderLlm((c) => ({ ...c, baseUrl: normalizedUrl, enabled: true }));
      setRiderFeedback({ ok: true, text: res.message });
    } catch (err) {
      setRiderFeedback({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRiderTesting(false);
    }
  };

  const worldActive = isLlmConfigReady(worldCfg);
  const riderActive = isLlmConfigReady(riderLlmConfig);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-indigo-500/40 bg-slate-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">
                双大模型对抗/沙盒配置中心 (World GM vs. Rider Player)
              </h2>
              <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                各自独立持久化 · OpenAI /v1/responses
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              将「生成地图/商家/订单/扮演NPC的世界导演模型」与「调用 WebMCP 跑单赚钱的外卖员模型」完全隔离，支持不同厂商或不同量级模型同场竞技！
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Dual Brain Switcher Tabs */}
        <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-800 bg-slate-950/70 p-3 text-xs">
          <button
            type="button"
            onClick={() => setActivePane('world')}
            className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
              activePane === 'world'
                ? 'border-indigo-400 bg-indigo-500/15 text-white'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Globe2 className="h-5 w-5 text-indigo-400" />
              <div>
                <div className="font-bold">世界导演大模型 (World / GM)</div>
                <div className="text-[11px] text-slate-400">
                  生成地图街区 · 危险地形 · 特色商家 · 动态派单 · NPC扮演
                </div>
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                worldActive
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {worldActive ? `● ${worldCfg.model}` : '内置沙盘'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActivePane('rider')}
            className={`flex items-center justify-between rounded-xl border p-3 text-left transition ${
              activePane === 'rider'
                ? 'border-amber-400 bg-amber-500/15 text-white'
                : 'border-slate-800 bg-slate-900/70 text-slate-400 hover:text-slate-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Bot className="h-5 w-5 text-amber-400" />
              <div>
                <div className="font-bold">外卖员玩家大模型 (Rider AI)</div>
                <div className="text-[11px] text-slate-400">
                  只允许通过 WebMCP 工具观察地图、买装备、取送餐与防注入
                </div>
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                riderActive
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {riderActive ? `● ${riderLlmConfig.model}` : '内置策略Bot'}
            </span>
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-5 text-xs">
          {activePane === 'world' ? (
            <>
              {/* World Generator Action Studio */}
              <div className="rounded-xl border border-indigo-500/30 bg-slate-950/90 p-4">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-bold text-indigo-300">
                    <Sparkles className="h-4 w-4" />
                    AI 动态城市地图与突发事件生成器
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">出题难度：</span>
                    <select
                      value={worldCfg.difficulty}
                      onChange={(e) =>
                        worldModelStore.update({
                          difficulty: e.target.value as WorldDifficulty,
                        })
                      }
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200"
                    >
                      <option value="standard">标准难度 (常规时效)</option>
                      <option value="hardcore">硬核难度 (易洒大单+注入陷阱)</option>
                      <option value="chaos">地狱狂潮 (极限时效+恶劣天气)</option>
                    </select>
                  </div>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {WORLD_THEME_CHIPS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      disabled={Boolean(worldBusy)}
                      onClick={() => {
                        setThemeInput(chip);
                        void handleGenerateWorld(chip);
                      }}
                      className="rounded-full border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-1 text-[11px] text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-40"
                    >
                      一键生成：{chip}
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={themeInput}
                    onChange={(e) => setThemeInput(e.target.value)}
                    placeholder="输入任意自定义城市主题，如：哈尔滨冰雪大世界暴雪夜宵局..."
                    className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100"
                  />
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={customSeedInput}
                      onChange={(e) => setCustomSeedInput(e.target.value)}
                      placeholder="指定种子(可选,如 RG-888)"
                      className="w-40 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-[11px] text-emerald-300 placeholder:font-sans placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      title="随机骰出一个短种子 ID"
                      onClick={() => setCustomSeedInput(generateRandomSeedId('RG'))}
                      className="rounded-lg border border-slate-700 bg-slate-900 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-white"
                    >
                      <Dices className="h-3.5 w-3.5 text-indigo-400" />
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => void handleGenerateWorld()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 font-bold text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    <Globe2 className="h-3.5 w-3.5" />
                    生成世界 &amp; 种子
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => void handleBakeTimeline()}
                    title="由世界导演大模型一次性预编写 11:35 / 12:15 / 12:55 / 13:30 四幕隐藏突发事件并锁入当前种子，确保既有大模型创意事件、不同参赛模型又 100% 公平一致！"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/45 bg-amber-500/15 px-3 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/25"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                    预烘焙锁定本种子 4 幕导演事件
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => {
                      nexusStore.replayCurrentWorldSeed();
                      responsesSession.resetSession();
                      setWorldFeedback({
                        ok: true,
                        text: `已按当前种子 [${worldMap.seedId}] 重置回 11:00 起点，地图、初始订单及局中 4 幕动态事件保持 100% 一致！`,
                      });
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 font-medium text-indigo-200 hover:bg-indigo-500/20"
                  >
                    <RefreshCw className="h-3.5 w-3.5 text-indigo-300" />
                    同种子重开 (模型公平打榜)
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => void handleSpawnWave()}
                    title="娱乐沙盒调试：手动临时加单（公平打榜对比时请勿中途手动点击）"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    <PlusCircle className="h-3.5 w-3.5 text-emerald-400" />
                    沙盒手动加单
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => void handleTriggerEvent()}
                    title="娱乐沙盒调试：手动触发事件（公平打榜对比时请勿中途手动点击）"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-[11px] text-slate-300 hover:bg-slate-800"
                  >
                    <Zap className="h-3.5 w-3.5 text-amber-400" />
                    沙盒手动事件
                  </button>
                </div>

                <div className="mt-2.5 flex items-center justify-between rounded-lg border border-slate-800/90 bg-slate-900/60 px-3 py-1.5 text-[11px] text-slate-400">
                  <span>
                    局中动态事件状态（<code className="text-indigo-300">11:35 / 12:15 / 12:55 / 13:30</code> 对骑手隐藏，到点触发）：
                  </span>
                  <span className="font-mono font-semibold text-emerald-300">
                    {worldMap.scheduledEvents?.some((e) => e.source === 'world_llm')
                      ? '● 世界导演AI预烘焙剧本 (同种子100%一致)'
                      : '● 种子PRNG确定性剧本 (同种子100%一致)'}
                  </span>
                </div>

                {worldBusy && (
                  <div className="mt-3 flex items-center gap-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 p-2.5 text-indigo-200">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{worldBusy}</span>
                  </div>
                )}

                {worldFeedback && (
                  <div
                    className={`mt-3 rounded-lg border p-2.5 ${
                      worldFeedback.ok
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                        : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                    }`}
                  >
                    {worldFeedback.text}
                  </div>
                )}
              </div>

              {/* Shareable World Seed & Snapshot Export/Import Studio */}
              <div className="space-y-3 rounded-xl border border-emerald-500/30 bg-slate-950/85 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Share2 className="h-4 w-4 text-emerald-400" />
                    <span className="font-bold text-emerald-300">
                      世界种子共享与导入中心 (Shareable World Seed)
                    </span>
                  </div>
                  <span className="rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-emerald-300">
                    当前种子: {worldMap.seedId}
                  </span>
                </div>

                <p className="text-[11px] leading-relaxed text-slate-400">
                  无论是内置引擎还是大模型实时生成的自定义城市，都会自动编码为无损压缩快照种子（<code className="text-emerald-300">RGW1_...</code>）。分享链接后，好友或其它大模型无需重复调用世界导演 API 即可 100% 复现完全相同的道路危险区、商家备餐与初始悬赏单！
                </p>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyShare('url')}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-1.5 font-bold text-white hover:bg-emerald-500"
                  >
                    {copiedMode === 'url' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        已复制分享链接!
                      </>
                    ) : (
                      <>
                        <Share2 className="h-3.5 w-3.5" />
                        复制同款世界分享链接 (#world=...)
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyShare('token')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-semibold text-emerald-200 hover:bg-emerald-500/20"
                  >
                    {copiedMode === 'token' ? (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        已复制 RGW1 快照码!
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        复制世界快照种子码 (RGW1_...)
                      </>
                    )}
                  </button>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
                  <input
                    type="text"
                    value={importSeedInput}
                    onChange={(e) => setImportSeedInput(e.target.value)}
                    placeholder="粘贴好友分享的 #world=... 链接、RGW1_... 快照码或短种子 (如 RG-CYBER-99)..."
                    className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-[11px] text-slate-100 placeholder:font-sans placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    disabled={!importSeedInput.trim() || Boolean(worldBusy)}
                    onClick={() => void handleImportSeed()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 bg-slate-900 px-3.5 py-1.5 font-bold text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导入种子载入世界
                  </button>
                </div>
              </div>

              {/* World Model API Credentials */}
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center justify-between">
                  <label className="flex cursor-pointer items-center gap-2 font-semibold text-white">
                    <input
                      type="checkbox"
                      checked={worldCfg.enabled}
                      onChange={(e) => worldModelStore.update({ enabled: e.target.checked })}
                      className="accent-indigo-500"
                    />
                    <span>启用真实「世界导演大模型」(/v1/responses 独立通道)</span>
                  </label>
                  <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    独立保存在 localStorage
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {MODEL_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() =>
                        worldModelStore.update({
                          providerPreset: p.id,
                          baseUrl: p.baseUrl,
                          model: p.model,
                        })
                      }
                      className={`rounded-md px-2.5 py-1 text-[11px] ${
                        worldCfg.providerPreset === p.id
                          ? 'bg-indigo-600 font-semibold text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="space-y-1 sm:col-span-2">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>世界模型 Base URL（支持云端或本机 http://127.0.0.1:端口/v1）</span>
                      <span className="font-mono text-indigo-300">
                        POST {resolveResponsesEndpoint(worldCfg.baseUrl)}
                      </span>
                    </div>
                    <input
                      type="text"
                      value={worldCfg.baseUrl}
                      onChange={(e) =>
                        worldModelStore.update({ providerPreset: 'custom', baseUrl: e.target.value })
                      }
                      onBlur={() => {
                        const norm = normalizeBaseUrlInput(worldCfg.baseUrl);
                        if (norm && norm !== worldCfg.baseUrl) {
                          worldModelStore.update({ baseUrl: norm });
                        }
                      }}
                      placeholder="如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100"
                    />
                    <LocalEndpointNotice
                      baseUrl={worldCfg.baseUrl}
                      onApplyUrl={(nextUrl) =>
                        worldModelStore.update({ providerPreset: 'custom', baseUrl: nextUrl })
                      }
                    />
                  </div>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">
                      世界模型 API Key {isLocalEndpointUrl(worldCfg.baseUrl) ? '(本机可留空)' : ''}
                    </span>
                    <div className="relative">
                      <input
                        type={showWorldKey ? 'text' : 'password'}
                        value={worldCfg.apiKey}
                        onChange={(e) => {
                          const v = e.target.value;
                          worldModelStore.update({
                            apiKey: v,
                            enabled: v.trim() ? true : worldCfg.enabled,
                          });
                        }}
                        placeholder={
                          isLocalEndpointUrl(worldCfg.baseUrl)
                            ? '本机模型无需 API Key，可直接留空测试'
                            : 'sk-... (与外卖员模型完全独立)'
                        }
                        className="w-full rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-3 pr-8 font-mono text-slate-100"
                      />
                      <button
                        type="button"
                        onClick={() => setShowWorldKey((v) => !v)}
                        className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                      >
                        {showWorldKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] text-slate-400">世界模型名称 (Model)</span>
                    <input
                      type="text"
                      value={worldCfg.model}
                      onChange={(e) => worldModelStore.update({ model: e.target.value })}
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100"
                    />
                  </label>

                  <label className="space-y-1.5 sm:col-span-2">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>导演思考程度 (Reasoning Effort · 自由填写，留空为模型默认)</span>
                      <span className="font-mono text-[10px] text-indigo-300">
                        {worldCfg.reasoningEffort?.trim()
                          ? `reasoning.effort = "${worldCfg.reasoningEffort.trim()}"`
                          : '不传该参数 (跟随默认)'}
                      </span>
                    </div>
                    <input
                      type="text"
                      list="world-effort-suggestions"
                      value={worldCfg.reasoningEffort ?? ''}
                      onChange={(e) => worldModelStore.update({ reasoningEffort: e.target.value })}
                      placeholder="自由填写如: max / xhigh / high / medium / low / minimal / none / disabled (留空则默认)"
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100 placeholder:font-sans placeholder:text-slate-500"
                    />
                    <datalist id="world-effort-suggestions">
                      {REASONING_EFFORT_SUGGESTIONS.map((val) => (
                        <option key={val} value={val} />
                      ))}
                    </datalist>
                    <div className="flex flex-wrap items-center gap-1 pt-0.5">
                      <span className="text-[10px] text-slate-500">快捷填入:</span>
                      <button
                        type="button"
                        onClick={() => worldModelStore.update({ reasoningEffort: '' })}
                        className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:text-white"
                      >
                        清空(默认)
                      </button>
                      {REASONING_EFFORT_SUGGESTIONS.map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => worldModelStore.update({ reasoningEffort: val })}
                          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                            worldCfg.reasoningEffort === val
                              ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200'
                              : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                          }`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => worldModelStore.clearKey()}
                    className="text-slate-400 hover:text-rose-300"
                  >
                    清除世界模型 Key
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(worldBusy)}
                    onClick={() => void handleTestWorld()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-1.5 font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Wifi className="h-3.5 w-3.5 text-indigo-400" />
                    测试世界模型连通性
                  </button>
                </div>

                {worldFeedback && (
                  <div
                    className={`rounded-lg border p-2.5 ${
                      worldFeedback.ok
                        ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                        : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                    }`}
                  >
                    {worldFeedback.text}
                  </div>
                )}
              </div>
            </>
          ) : (
            /* RIDER PLAYER MODEL PANE */
            <div className="space-y-3.5 rounded-xl border border-amber-500/30 bg-slate-950/90 p-4">
              <div className="flex items-center justify-between">
                <label className="flex cursor-pointer items-center gap-2 font-semibold text-white">
                  <input
                    type="checkbox"
                    checked={riderLlmConfig.enabled}
                    onChange={(e) =>
                      onChangeRiderLlm((c) => ({ ...c, enabled: e.target.checked }))
                    }
                    className="accent-amber-500"
                  />
                  <span>启用真实「外卖员玩家大模型」(/v1/responses · 自动兼容 /chat/completions)</span>
                </label>
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  独立保存在 localStorage
                </span>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {MODEL_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      onChangeRiderLlm((c) => ({
                        ...c,
                        providerPreset: p.id,
                        baseUrl: p.baseUrl,
                        model: p.model,
                      }))
                    }
                    className={`rounded-md px-2.5 py-1 text-[11px] ${
                      riderLlmConfig.providerPreset === p.id
                        ? 'bg-amber-500 font-semibold text-slate-950'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1 sm:col-span-2">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>外卖员模型 Base URL（支持云端或本机 http://127.0.0.1:端口/v1）</span>
                    <span className="font-mono text-amber-300">
                      POST {resolveResponsesEndpoint(riderLlmConfig.baseUrl)}
                    </span>
                  </div>
                  <input
                    type="text"
                    value={riderLlmConfig.baseUrl}
                    onChange={(e) =>
                      onChangeRiderLlm((c) => ({
                        ...c,
                        providerPreset: 'custom',
                        baseUrl: e.target.value,
                      }))
                    }
                    onBlur={() => {
                      const norm = normalizeBaseUrlInput(riderLlmConfig.baseUrl);
                      if (norm && norm !== riderLlmConfig.baseUrl) {
                        onChangeRiderLlm((c) => ({ ...c, baseUrl: norm }));
                      }
                    }}
                    placeholder="如 https://api.openai.com/v1 或 http://127.0.0.1:11434/v1"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100"
                  />
                  <LocalEndpointNotice
                    baseUrl={riderLlmConfig.baseUrl}
                    onApplyUrl={(nextUrl) =>
                      onChangeRiderLlm((c) => ({
                        ...c,
                        providerPreset: 'custom',
                        baseUrl: nextUrl,
                      }))
                    }
                  />
                </div>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    外卖员模型 API Key {isLocalEndpointUrl(riderLlmConfig.baseUrl) ? '(本机可留空)' : ''}
                  </span>
                  <div className="relative">
                    <input
                      type={showRiderKey ? 'text' : 'password'}
                      value={riderLlmConfig.apiKey}
                      onChange={(e) => {
                        const v = e.target.value;
                        onChangeRiderLlm((c) => ({
                          ...c,
                          apiKey: v,
                          enabled: v.trim() ? true : c.enabled,
                        }));
                      }}
                      placeholder={
                        isLocalEndpointUrl(riderLlmConfig.baseUrl)
                          ? '本机模型无需 API Key，可直接留空测试'
                          : 'sk-... (专用于骑手 AI 决策)'
                      }
                      className="w-full rounded-lg border border-slate-700 bg-slate-900 py-1.5 pl-3 pr-8 font-mono text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={() => setShowRiderKey((v) => !v)}
                      className="absolute right-2.5 top-2 text-slate-400 hover:text-white"
                    >
                      {showRiderKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">外卖员模型名称 (Model)</span>
                  <input
                    type="text"
                    value={riderLlmConfig.model}
                    onChange={(e) =>
                      onChangeRiderLlm((c) => ({ ...c, model: e.target.value }))
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-mono text-slate-100"
                  />
                </label>

                <label className="space-y-1.5 sm:col-span-2">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span className="font-semibold text-amber-300">
                      外卖员模型思考程度 (Reasoning Effort · 支持任意自定义档位如 max / xhigh / high / none)
                    </span>
                    <span className="font-mono text-[10px] text-amber-300">
                      {riderLlmConfig.reasoningEffort?.trim()
                        ? `reasoning.effort = "${riderLlmConfig.reasoningEffort.trim()}"`
                        : '不传该参数 (跟随默认)'}
                    </span>
                  </div>
                  <input
                    type="text"
                    list="rider-effort-suggestions"
                    value={riderLlmConfig.reasoningEffort ?? ''}
                    onChange={(e) =>
                      onChangeRiderLlm((c) => ({
                        ...c,
                        reasoningEffort: e.target.value,
                      }))
                    }
                    placeholder="自由输入模型支持的任意值，如: max / xhigh / high / medium / low / minimal / none / disabled (留空则默认)"
                    className="w-full rounded-lg border border-amber-500/40 bg-slate-900 px-3 py-1.5 font-mono text-amber-200 placeholder:font-sans placeholder:text-slate-500"
                  />
                  <datalist id="rider-effort-suggestions">
                    {REASONING_EFFORT_SUGGESTIONS.map((val) => (
                      <option key={val} value={val} />
                    ))}
                  </datalist>
                  <div className="flex flex-wrap items-center gap-1 pt-0.5">
                    <span className="text-[10px] text-slate-500">快捷填入:</span>
                    <button
                      type="button"
                      onClick={() => onChangeRiderLlm((c) => ({ ...c, reasoningEffort: '' }))}
                      className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 hover:text-white"
                    >
                      清空(默认)
                    </button>
                    {REASONING_EFFORT_SUGGESTIONS.map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => onChangeRiderLlm((c) => ({ ...c, reasoningEffort: val }))}
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                          riderLlmConfig.reasoningEffort === val
                            ? 'border-amber-400 bg-amber-500/20 font-bold text-amber-200'
                            : 'border-slate-800 bg-slate-900 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        {val}
                      </button>
                    ))}
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">Responses 上下文策略</span>
                  <select
                    value={session.contextMode}
                    onChange={(e) =>
                      responsesSession.setContextConfig({
                        contextMode: e.target.value as ContextMode,
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-slate-200"
                  >
                    <option value="sliding_window">本地滑窗全兼容 (默认推荐 · 兼容中转/DeepSeek/OpenAI)</option>
                    <option value="stateful_chain">服务端链式续接 (仅原生 OpenAI previous_response_id)</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] text-slate-400">
                    批量折叠窗口 (高水位触发批量折叠 · 保护 KV 前缀缓存)
                  </span>
                  <select
                    value={session.maxWindowTurns}
                    onChange={(e) =>
                      responsesSession.setContextConfig({
                        maxWindowTurns: Number(e.target.value),
                      })
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-200"
                  >
                    <option value={12}>满 12 轮批量折叠</option>
                    <option value={20}>满 20 轮批量折叠 (默认推荐 · 整局高缓存命中)</option>
                    <option value={28}>满 28 轮批量折叠</option>
                    <option value={40}>满 40 轮批量折叠 (超长测局)</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={onClearRiderKey}
                  className="text-slate-400 hover:text-rose-300"
                >
                  清除外卖员模型 Key
                </button>
                <button
                  type="button"
                  disabled={riderTesting}
                  onClick={() => void handleTestRider()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-1.5 font-bold text-slate-950 hover:bg-amber-400"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  {riderTesting ? '测试中...' : '测试外卖员模型 /responses'}
                </button>
              </div>

              {riderFeedback && (
                <div
                  className={`rounded-lg border p-2.5 ${
                    riderFeedback.ok
                      ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
                      : 'border-rose-500/40 bg-rose-950/30 text-rose-200'
                  }`}
                >
                  {riderFeedback.text}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

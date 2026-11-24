import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Activity,
  ArrowDown,
  Bot,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Code,
  FastForward,
  Globe2,
  Layers,
  Loader2,
  Minimize2,
  OctagonX,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import { nexusStore, useNexusStore } from '../store/nexusStore';
import {
  AGENT_PLAYBOOKS,
  type AgentChatMessage,
  buildPlaybookSummaryText,
  formatReasoningEffortTag,
  type LlmConnectionConfig,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffortLevel,
  runAutonomousArenaRound,
  runNaturalLanguageWebMCPTurn,
  type TurnToolCallLog,
} from '../webmcp/agentPlaybooks';
import {
  estimateActiveContextTokens,
  responsesSession,
} from '../webmcp/responsesSessionManager';
import {
  type DiscoveredToolItem,
  executeWebMCPByName,
} from '../webmcp/useWebMCPBridge';
import {
  spawnDynamicOrdersWave,
  triggerSuddenWorldEvent,
  useWorldModelConfig,
} from '../webmcp/worldDirector';
import { benchmarkStore } from '../store/benchmarkStore';
import { BenchmarkLeaderboardModal } from './BenchmarkLeaderboardModal';
import {
  RichChatContent,
  TurnActionStepperPills,
  TurnToolLogsModal,
} from './RichChatContent';
import { WorldDirectorModal } from './WorldDirectorModal';

interface Props {
  tools: DiscoveredToolItem[];
  runtimeMode: string;
  onRefreshTools: () => void;
  externalOpenDualModal?: number;
  externalOpenLeaderboard?: number;
}

const LLM_STORAGE_KEY = 'ridergo_webmcp_llm_config_v2';
const CHAT_STORAGE_KEY = 'ridergo_arena_chat_v3';

const DEFAULT_LLM_CONFIG: LlmConnectionConfig = {
  enabled: false,
  providerPreset: 'openai-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  reasoningEffort: 'default',
};

const WELCOME_MESSAGE: AgentChatMessage = {
  id: 'welcome',
  role: 'assistant',
  content:
    '欢迎进入 **《闪电骑士：AI 外卖生存挑战赛》**！\n- 点击上方 **【▶ 开启 AI 自动闯关】** 或 **【单步 1 回合】**，让「外卖员大模型」自主规划箱容、电量、爬楼体力与蛋糕防洒策略冲击最高段位分！\n- 点击 **【双模型与世界生成】** 可分别配置 **世界导演模型**（生成新地图/特色商家/突发事件/扮演NPC）与 **外卖员模型**。',
};

function loadSavedLlmConfig(): LlmConnectionConfig {
  try {
    const raw =
      window.localStorage.getItem(LLM_STORAGE_KEY) ??
      window.localStorage.getItem('ridergo_webmcp_llm_config_v1');
    if (!raw) return DEFAULT_LLM_CONFIG;
    const parsed = JSON.parse(raw) as Partial<LlmConnectionConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      providerPreset: parsed.providerPreset ?? 'openai-4.1-mini',
      baseUrl: parsed.baseUrl ?? DEFAULT_LLM_CONFIG.baseUrl,
      apiKey: parsed.apiKey ?? '',
      model: parsed.model ?? DEFAULT_LLM_CONFIG.model,
      reasoningEffort: parsed.reasoningEffort ?? 'default',
    };
  } catch {
    return DEFAULT_LLM_CONFIG;
  }
}

function loadSavedChatMessages(): AgentChatMessage[] {
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [WELCOME_MESSAGE];
    const parsed = (JSON.parse(raw) as AgentChatMessage[]).filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    );
    return parsed.length > 0 ? parsed : [WELCOME_MESSAGE];
  } catch {
    return [WELCOME_MESSAGE];
  }
}

function buildDefaultArgsFromSchema(schema: Record<string, unknown> | null): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return {};
  const props = (schema.properties as Record<string, Record<string, unknown>> | undefined) ?? {};
  const result: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    if ('default' in def) {
      result[key] = def.default;
    } else if (Array.isArray(def.enum) && def.enum.length > 0) {
      result[key] = def.enum[0];
    } else if (def.type === 'boolean') {
      result[key] = true;
    } else if (def.type === 'number' || def.type === 'integer') {
      result[key] = typeof def.minimum === 'number' ? Math.max(10, def.minimum) : 12;
    } else if (def.type === 'array') {
      result[key] = ['realname_verified', 'device_trusted'];
    } else if (def.type === 'string') {
      if (key === 'orderId') result[key] = 'ORD-201';
      else if (key === 'message') result[key] = '老板您好，麻烦优先打包一下这单，谢谢！';
      else if (key === 'reason' || key === 'note' || key === 'memo') result[key] = '战术调试调用';
      else result[key] = '';
    }
  }
  return result;
}

export const WebMCPConsoleDock: React.FC<Props> = ({
  tools,
  runtimeMode,
  onRefreshTools,
  externalOpenDualModal = 0,
  externalOpenLeaderboard = 0,
}) => {
  const protocolLogs = useNexusStore((s) => s.protocolLogs);
  const shiftEnded = useNexusStore((s) => s.shift.shiftEnded);
  const worldCfg = useWorldModelConfig();
  const session = useSyncExternalStore(
    responsesSession.subscribe,
    responsesSession.getState,
    responsesSession.getState,
  );

  const [tab, setTab] = useState<'agent' | 'tools' | 'events'>('agent');
  const [showPlaybooks, setShowPlaybooks] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'MAIN' | 'FORM' | 'IFRAME'>('ALL');
  const [selectedToolName, setSelectedToolName] = useState<string>('rider.get_shift_summary');
  const [jsonInputText, setJsonInputText] = useState<string>('{}');
  const [toolResult, setToolResult] = useState<{
    status: 'idle' | 'running' | 'ok' | 'error';
    durationMs?: number;
    output?: unknown;
  }>({ status: 'idle' });

  const [runningPlaybookId, setRunningPlaybookId] = useState<string | null>(null);
  const [playbookStepIdx, setPlaybookStepIdx] = useState<number>(-1);
  const [liveProgressText, setLiveProgressText] = useState<string>('');

  const [autoPlayActive, setAutoPlayActive] = useState(false);
  const autoPlayRef = useRef(false);
  const autoRoundCountRef = useRef(0);

  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [showDualModal, setShowDualModal] = useState(false);
  const [showLeaderboardModal, setShowLeaderboardModal] = useState(false);
  const [showSummaryPreview, setShowSummaryPreview] = useState(false);
  const [llmConfig, setLlmConfig] = useState<LlmConnectionConfig>(() => loadSavedLlmConfig());

  const [chatMessages, setChatMessages] = useState<AgentChatMessage[]>(() =>
    loadSavedChatMessages(),
  );
  const [modalTurnMsg, setModalTurnMsg] = useState<AgentChatMessage | null>(null);

  useEffect(() => {
    if (externalOpenDualModal > 0) {
      setShowDualModal(true);
    }
  }, [externalOpenDualModal]);

  useEffect(() => {
    if (externalOpenLeaderboard > 0) {
      setShowLeaderboardModal(true);
    }
  }, [externalOpenLeaderboard]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify(llmConfig));
    } catch {
      // Ignore
    }
  }, [llmConfig]);

  useEffect(() => {
    try {
      window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(chatMessages.slice(-40)));
    } catch {
      // Ignore
    }
  }, [chatMessages]);

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);
  const [showJumpBottom, setShowJumpBottom] = useState(false);
  const activeCallAbortRef = useRef<AbortController | null>(null);

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = chatScrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpBottom(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  const handleChatScroll = useCallback(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom <= 64;
    stickToBottomRef.current = nearBottom;
    setShowJumpBottom(!nearBottom);
  }, []);

  useEffect(() => {
    if (tab !== 'agent' || !stickToBottomRef.current) return;
    const raf = requestAnimationFrame(() => {
      const el = chatScrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
    return () => cancelAnimationFrame(raf);
  }, [chatMessages, runningPlaybookId, playbookStepIdx, chatBusy, liveProgressText, tab, showPlaybooks]);

  const selectedTool = useMemo(
    () => tools.find((t) => t.name === selectedToolName) ?? tools[0] ?? null,
    [tools, selectedToolName],
  );

  useEffect(() => {
    if (selectedTool) {
      const defaults = buildDefaultArgsFromSchema(selectedTool.inputSchema);
      setJsonInputText(JSON.stringify(defaults, null, 2));
      setToolResult({ status: 'idle' });
    }
  }, [selectedTool?.name]);

  const filteredTools = useMemo(() => {
    return tools.filter((t) => {
      if (sourceFilter === 'IFRAME') return t.isCrossFrame;
      if (sourceFilter === 'FORM') return t.isDeclarativeForm;
      if (sourceFilter === 'MAIN') return !t.isCrossFrame && !t.isDeclarativeForm;
      return true;
    });
  }, [tools, sourceFilter]);

  const handleAbortActive = () => {
    autoPlayRef.current = false;
    setAutoPlayActive(false);
    activeCallAbortRef.current?.abort(new DOMException('已中断当前行动', 'AbortError'));
  };

  const handleClearRiderKey = () => {
    window.localStorage.removeItem(LLM_STORAGE_KEY);
    setLlmConfig(DEFAULT_LLM_CONFIG);
  };

  const handleCompactContext = () => {
    const { compressedCount, keptCount } = responsesSession.compactNow(2);
    stickToBottomRef.current = true;
    setChatMessages((prev) => [
      ...prev,
      {
        id: `ctx-compact-${Date.now()}`,
        role: 'assistant',
        content:
          compressedCount > 0
            ? `已将早期 **${compressedCount} 轮**战报及工具输出压缩为轻量摘要，仅保留最近 **${keptCount} 轮**完整上下文。`
            : `当前仅 **${keptCount} 轮**记录，已重置服务端链式游标。`,
      },
    ]);
  };

  const handleNewSession = () => {
    autoPlayRef.current = false;
    setAutoPlayActive(false);
    responsesSession.resetSession();
    window.localStorage.removeItem(CHAT_STORAGE_KEY);
    setChatMessages([WELCOME_MESSAGE]);
  };

  // Single AI Autonomous Step or Continuous Auto-Play Loop!
  const consecutiveAutoErrRef = useRef(0);

  const executeSingleArenaRound = useCallback(async () => {
    if (nexusStore.getState().shift.shiftEnded) {
      autoPlayRef.current = false;
      setAutoPlayActive(false);
      const endSnap = nexusStore.getState();
      const modelLabel =
        llmConfig.enabled && llmConfig.apiKey.trim()
          ? `${llmConfig.model.trim() || 'Rider-LLM'} (思考:${formatReasoningEffortTag(llmConfig.reasoningEffort)})`
          : '内置策略Bot';
      benchmarkStore.recordRun({
        modelName: modelLabel,
        seedId: endSnap.worldMap.seedId,
        themeName: endSnap.worldMap.themeName,
        blindMode: endSnap.benchmarkBlindMode,
        shift: endSnap.shift,
        rider: endSnap.rider,
        totalTokens: responsesSession.getState().cumulativeUsage.totalTokens,
      });
      setChatMessages((prev) => [
        ...prev,
        {
          id: `shift-end-${Date.now()}`,
          role: 'assistant',
          content: `**180 分钟午高峰挑战班次圆满结束！成绩已自动计入【评测榜单】！**\n- 评测模型：**${modelLabel}**（种子：\`${endSnap.worldMap.seedId}\`）\n- 最终段位总分：**${endSnap.shift.arenaScore} 分**，钱包结余 ¥${endSnap.rider.walletYuan.toFixed(2)}\n- 点击顶部 **【评测榜单】** 可查看六维能力雷达图与同种子排名对比！`,
        },
      ]);
      return false;
    }

    setShowPlaybooks(false);
    stickToBottomRef.current = true;
    setChatBusy(true);

    const roundNo = ++autoRoundCountRef.current;
    const ac = new AbortController();
    activeCallAbortRef.current = ac;

    try {
      // Auto-replenish orders if pool + active is running dry before shift ends!
      const preSnap = nexusStore.getState();
      const remainingPlayable = preSnap.orders.filter(
        (o) => o.stage !== 'delivered' && o.stage !== 'dropped',
      ).length;
      if (remainingPlayable === 0 && !preSnap.shift.shiftEnded) {
        try {
          setLiveProgressText('大厅订单已清空，世界导演正在派发新波次悬赏单...');
          const waveRes = await spawnDynamicOrdersWave(3, ac.signal);
          setChatMessages((prev) => [
            ...prev,
            {
              id: `world-wave-${Date.now()}`,
              role: 'assistant',
              content: `**【世界导演动态派单】** 大厅补货 **3 单**新悬赏（${waveRes.spawnedIds.join('、')}），继续冲分！`,
            },
          ]);
        } catch {
          // Ignore World Director wave error so Rider loop continues
        }
      }

      const turnRes = await runAutonomousArenaRound(llmConfig, ac.signal, (txt) =>
        setLiveProgressText(txt),
      );
      consecutiveAutoErrRef.current = 0;

      setChatMessages((prev) => [
        ...prev,
        {
          ...turnRes,
          id: `auto-r-${Date.now()}`,
          content: `**【第 ${roundNo} 回合 · AI 自主跑单】**\n${turnRes.content}`,
        },
      ]);

      // Every 3 autonomous rounds, World Director injects a dynamic world event (isolated try/catch)!
      if (roundNo % 3 === 0 && !nexusStore.getState().shift.shiftEnded) {
        try {
          setLiveProgressText('世界导演正在演化城市动态事件...');
          const evText = await triggerSuddenWorldEvent(ac.signal);
          setChatMessages((prev) => [
            ...prev,
            {
              id: `world-ev-${Date.now()}`,
              role: 'assistant',
              content: `**【世界导演动态事件】** ${evText}`,
            },
          ]);
        } catch {
          // Never let optional World Director event failure stop Rider AI gameplay
        }
      }
      return true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const isUserAbort =
        ac.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      const isFatalAuth = /HTTP 401|HTTP 403|API Key/i.test(errMsg);

      if (isUserAbort) {
        autoPlayRef.current = false;
        setAutoPlayActive(false);
        setChatMessages((prev) => [
          ...prev,
          {
            id: `auto-abort-${Date.now()}`,
            role: 'assistant',
            content: '已手动暂停 AI 自动闯关。',
          },
        ]);
        return false;
      }

      consecutiveAutoErrRef.current += 1;
      // Self-heal session context on transient gateway / tool_call sync errors
      responsesSession.setContextConfig({ contextMode: 'sliding_window' });
      responsesSession.compactNow(1);

      if (!isFatalAuth && autoPlayRef.current && consecutiveAutoErrRef.current < 3) {
        setChatMessages((prev) => [
          ...prev,
          {
            id: `auto-retry-${Date.now()}`,
            role: 'assistant',
            content: `本回合接口波动（第 ${consecutiveAutoErrRef.current}/2 次自动容错修复）：已切换为全兼容无状态滑窗并重整上下文，**1.5 秒后自动继续下一回合**。\n> 详情：${errMsg.slice(0, 180)}`,
          },
        ]);
        await new Promise((r) => setTimeout(r, 1500));
        return true;
      }

      autoPlayRef.current = false;
      setAutoPlayActive(false);
      consecutiveAutoErrRef.current = 0;
      setChatMessages((prev) => [
        ...prev,
        {
          id: `auto-err-${Date.now()}`,
          role: 'assistant',
          content: `自动闯关已停止：**${errMsg}**`,
        },
      ]);
      return false;
    } finally {
      setChatBusy(false);
      setLiveProgressText('');
      activeCallAbortRef.current = null;
    }
  }, [llmConfig]);

  // Continuous Auto-Play Loop Runner
  useEffect(() => {
    autoPlayRef.current = autoPlayActive;
    if (!autoPlayActive) return;

    let cancelled = false;
    async function loop() {
      while (autoPlayRef.current && !cancelled) {
        if (nexusStore.getState().pendingApproval) {
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }
        const ok = await executeSingleArenaRound();
        if (!ok || !autoPlayRef.current || cancelled) break;
        await new Promise((r) => setTimeout(r, 650));
      }
    }
    void loop();
    return () => {
      cancelled = true;
    };
  }, [autoPlayActive, executeSingleArenaRound]);

  const handleInvokeSelectedTool = async () => {
    if (!selectedTool || toolResult.status === 'running') return;
    let parsedArgs: Record<string, unknown> = {};
    try {
      parsedArgs = JSON.parse(jsonInputText || '{}') as Record<string, unknown>;
    } catch (e) {
      setToolResult({
        status: 'error',
        output: `JSON 参数格式错误: ${(e as Error).message}`,
      });
      return;
    }

    const ac = new AbortController();
    activeCallAbortRef.current = ac;
    setToolResult({ status: 'running' });

    try {
      const res = await executeWebMCPByName(selectedTool.name, parsedArgs, {
        signal: ac.signal,
        callerLabel: 'InspectorUI',
      });
      setToolResult({ status: 'ok', durationMs: res.durationMs, output: res.parsed });
    } catch (err) {
      setToolResult({
        status: 'error',
        output: err instanceof Error ? err.message : String(err),
      });
    } finally {
      activeCallAbortRef.current = null;
    }
  };

  const handleRunPlaybook = async (playbookId: string) => {
    if (runningPlaybookId || chatBusy || autoPlayActive) return;
    const pb = AGENT_PLAYBOOKS.find((p) => p.id === playbookId);
    if (!pb) return;

    if (nexusStore.getState().toolScopeMode === 'view-scoped') {
      nexusStore.patch({ toolScopeMode: 'global' });
      await new Promise((r) => setTimeout(r, 120));
    }

    setShowPlaybooks(false);
    stickToBottomRef.current = true;
    setShowJumpBottom(false);

    const ac = new AbortController();
    activeCallAbortRef.current = ac;
    setRunningPlaybookId(pb.id);
    setPlaybookStepIdx(0);

    const userPromptLabel = `[运行战术剧本] ${pb.name}`;
    setChatMessages((prev) => [
      ...prev,
      { id: `pb-start-${Date.now()}`, role: 'user', content: userPromptLabel },
    ]);

    const collectedLogs: TurnToolCallLog[] = [];

    try {
      for (let i = 0; i < pb.steps.length; i++) {
        if (ac.signal.aborted) break;
        const step = pb.steps[i];
        setPlaybookStepIdx(i);
        setLiveProgressText(`正在执行第 ${i + 1}/${pb.steps.length} 步：${step.title}...`);

        const res = await executeWebMCPByName(step.toolName, step.input, {
          signal: ac.signal,
          callerLabel: `剧本#${i + 1}`,
        });

        collectedLogs.push({
          id: `pb-log-${Date.now()}-${i}`,
          stepIndex: i + 1,
          toolName: step.toolName,
          originLabel: res.originLabel,
          durationMs: res.durationMs,
          status: 'ok',
          reasoning: step.reasoning,
          input: step.input,
          output: res.parsed,
        });

        if (i < pb.steps.length - 1) {
          await new Promise((r) => setTimeout(r, 380));
        }
      }

      setChatMessages((prev) => [
        ...prev,
        {
          id: `pb-done-${Date.now()}`,
          role: 'assistant',
          userPrompt: userPromptLabel,
          content: buildPlaybookSummaryText(pb.name, collectedLogs),
          toolLogs: collectedLogs,
        },
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setChatMessages((prev) => [
        ...prev,
        {
          id: `pb-err-${Date.now()}`,
          role: 'assistant',
          userPrompt: userPromptLabel,
          content: `剧本执行已中断或被拦截：**${errMsg}**`,
          toolLogs: collectedLogs.length > 0 ? collectedLogs : undefined,
        },
      ]);
    } finally {
      setRunningPlaybookId(null);
      setPlaybookStepIdx(-1);
      setLiveProgressText('');
      activeCallAbortRef.current = null;
    }
  };

  const handleChatSubmit = async (e?: React.FormEvent, overridePrompt?: string) => {
    e?.preventDefault();
    const prompt = (overridePrompt ?? chatInput).trim();
    if (!prompt || chatBusy || runningPlaybookId || autoPlayActive) return;

    setChatInput('');
    setShowPlaybooks(false);
    stickToBottomRef.current = true;
    setShowJumpBottom(false);
    setChatBusy(true);
    setLiveProgressText('外卖员 AI 正在分析战局并调用 WebMCP...');

    const ac = new AbortController();
    activeCallAbortRef.current = ac;

    setChatMessages((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: 'user', content: prompt },
    ]);

    try {
      const assistantTurn = await runNaturalLanguageWebMCPTurn(
        prompt,
        llmConfig,
        ac.signal,
        (statusText) => setLiveProgressText(statusText),
      );
      setChatMessages((prev) => [...prev, { ...assistantTurn, id: `a-${Date.now()}` }]);
    } catch (err) {
      setChatMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          userPrompt: prompt,
          content: `执行异常：**${err instanceof Error ? err.message : String(err)}**`,
        },
      ]);
    } finally {
      setChatBusy(false);
      setLiveProgressText('');
      activeCallAbortRef.current = null;
    }
  };

  const isAnythingRunning =
    Boolean(runningPlaybookId) || chatBusy || toolResult.status === 'running' || autoPlayActive;
  const isRiderLlmActive = llmConfig.enabled && Boolean(llmConfig.apiKey.trim());
  const isWorldLlmActive = worldCfg.enabled && Boolean(worldCfg.apiKey.trim());
  const estimatedCtxTokens = estimateActiveContextTokens(session);

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col overflow-hidden overscroll-contain rounded-2xl border border-amber-500/30 bg-slate-900/95 shadow-xl">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-800 px-4 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
                <Sparkles className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-xs font-bold tracking-wide text-white">
                  AI 玩家闯关控制台 (WebMCP Arena)
                </h2>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px]">
                  <span className={isWorldLlmActive ? 'text-indigo-300' : 'text-slate-400'}>
                    世界GM:{isWorldLlmActive ? worldCfg.model : '内置'}
                  </span>
                  <span className="text-slate-600">vs</span>
                  <span className={isRiderLlmActive ? 'text-emerald-300' : 'text-amber-300'}>
                    骑手AI:{isRiderLlmActive ? llmConfig.model : '内置Bot'}
                  </span>
                </div>
              </div>
            </div>

            {isAnythingRunning ? (
              <button
                type="button"
                onClick={handleAbortActive}
                className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
              >
                <OctagonX className="h-3.5 w-3.5" />
                停止/中断
              </button>
            ) : (
              <button
                type="button"
                onClick={onRefreshTools}
                className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 font-mono text-[11px] text-slate-300 hover:bg-slate-700"
              >
                <RefreshCw className="h-3 w-3" />
                {tools.length} Tools
              </button>
            )}
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 text-xs">
            <button
              type="button"
              onClick={() => setTab('agent')}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold transition ${
                tab === 'agent'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              AI 闯关实况
            </button>
            <button
              type="button"
              onClick={() => setTab('tools')}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold transition ${
                tab === 'tools'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wrench className="h-3.5 w-3.5" />
              工具 ({tools.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('events')}
              className={`flex items-center justify-center gap-1.5 rounded-md py-1.5 font-semibold transition ${
                tab === 'events'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              协议流 ({protocolLogs.length})
            </button>
          </div>
        </div>

        {/* TAB 1: ARENA AUTO-PLAY & CHAT */}
        {tab === 'agent' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Auto-Play Arena Bar + Dual-Model Config + Context Bar */}
            <div className="shrink-0 space-y-2 border-b border-slate-800 bg-slate-950/70 px-3 py-2.5">
              {/* Primary Game Loop Buttons */}
              <div className="grid grid-cols-12 gap-1.5 text-xs">
                <button
                  type="button"
                  disabled={shiftEnded || Boolean(runningPlaybookId)}
                  onClick={() => setAutoPlayActive((v) => !v)}
                  className={`col-span-5 inline-flex items-center justify-center gap-1.5 rounded-lg py-1.5 font-bold shadow transition ${
                    autoPlayActive
                      ? 'bg-rose-600 text-white hover:bg-rose-500'
                      : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400 disabled:opacity-40'
                  }`}
                >
                  {autoPlayActive ? (
                    <>
                      <Pause className="h-3.5 w-3.5" />
                      暂停自动闯关
                    </>
                  ) : (
                    <>
                      <Play className="h-3.5 w-3.5" />
                      AI 自动玩一局
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={isAnythingRunning || shiftEnded}
                  onClick={() => void executeSingleArenaRound()}
                  className="col-span-3 inline-flex items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 py-1.5 font-semibold text-amber-200 hover:bg-amber-500/25 disabled:opacity-40"
                >
                  <FastForward className="h-3.5 w-3.5" />
                  单步回合
                </button>

                <button
                  type="button"
                  onClick={() => setShowDualModal(true)}
                  className="col-span-4 inline-flex items-center justify-center gap-1 rounded-lg border border-indigo-500/50 bg-indigo-500/20 py-1.5 font-semibold text-indigo-200 hover:bg-indigo-500/30"
                >
                  <Globe2 className="h-3.5 w-3.5" />
                  双模型/新世界
                </button>
              </div>

              {/* Reasoning Effort Quick Switcher + Context Management Strip */}
              <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-slate-800/90 bg-slate-900/80 px-2.5 py-1 text-[11px]">
                <div className="flex flex-wrap items-center gap-1.5 text-slate-300">
                  <span className="text-[10px] font-semibold text-amber-300">思考程度:</span>
                  <select
                    value={llmConfig.reasoningEffort ?? 'default'}
                    onChange={(e) =>
                      setLlmConfig((prev) => ({
                        ...prev,
                        reasoningEffort: e.target.value as ReasoningEffortLevel,
                      }))
                    }
                    title="快速切换外卖员大模型思考深度 (reasoning.effort / thinking)"
                    className="rounded border border-amber-500/35 bg-slate-950 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-200 focus:border-amber-400 focus:outline-none"
                  >
                    {REASONING_EFFORT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.shortLabel}
                      </option>
                    ))}
                  </select>
                  <span className="text-slate-700">|</span>
                  <span className="font-mono text-[10px]">
                    上下文 {session.turns.length}/{session.maxWindowTurns}轮
                  </span>
                  {session.compactedTurnCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSummaryPreview((v) => !v)}
                      className="rounded bg-indigo-500/20 px-1 py-0.5 font-mono text-[10px] text-indigo-300"
                    >
                      已摘要{session.compactedTurnCount}
                    </button>
                  )}
                  <span className="font-mono text-[10px] text-slate-400">
                    ~{estimatedCtxTokens}tok
                  </span>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowPlaybooks((v) => !v)}
                    className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-amber-300 hover:bg-slate-700"
                  >
                    {showPlaybooks ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
                    战术剧本(5)
                  </button>
                  <button
                    type="button"
                    onClick={handleCompactContext}
                    className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-200 hover:bg-slate-700"
                  >
                    <Minimize2 className="h-2.5 w-2.5 text-amber-400" />
                    压缩
                  </button>
                  <button
                    type="button"
                    onClick={handleNewSession}
                    className="inline-flex items-center gap-0.5 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300 hover:text-rose-200"
                  >
                    <RotateCcw className="h-2.5 w-2.5" />
                    清战报
                  </button>
                </div>
              </div>

              {showSummaryPreview && session.rollingSummary && (
                <div className="rounded-lg border border-indigo-500/30 bg-slate-950 p-2 font-mono text-[10px] text-slate-300">
                  <div className="mb-1 flex justify-between text-indigo-300">
                    <span>早期回合滚动压缩摘要：</span>
                    <button type="button" onClick={() => setShowSummaryPreview(false)}>
                      收起
                    </button>
                  </div>
                  <pre className="max-h-20 overflow-auto overscroll-contain whitespace-pre-wrap">
                    {session.rollingSummary}
                  </pre>
                </div>
              )}

              {showPlaybooks && (
                <div className="max-h-44 space-y-1.5 overflow-y-auto overscroll-contain pr-1">
                  {AGENT_PLAYBOOKS.map((pb) => {
                    const isThisRunning = runningPlaybookId === pb.id;
                    return (
                      <div
                        key={pb.id}
                        className="rounded-lg border border-slate-800 bg-slate-900/90 p-2 text-xs hover:border-slate-700"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-medium leading-snug text-slate-100">{pb.name}</div>
                          <button
                            type="button"
                            disabled={isAnythingRunning}
                            onClick={() => void handleRunPlaybook(pb.id)}
                            className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                          >
                            <Play className="h-3 w-3" />
                            {isThisRunning ? `${playbookStepIdx + 1}/${pb.steps.length}` : '演示'}
                          </button>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] text-slate-400">
                          {pb.description}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Clean Highlighted Battle Log Stream */}
            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
              <div
                ref={chatScrollRef}
                onScroll={handleChatScroll}
                className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5"
              >
                {chatMessages.map((m) => {
                  const isUser = m.role === 'user';
                  const toolCount = m.toolLogs?.length ?? 0;
                  const totalLatency =
                    m.toolLogs?.reduce((acc, item) => acc + item.durationMs, 0) ?? 0;

                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`w-full rounded-2xl border p-3 text-xs shadow-sm ${
                          isUser
                            ? 'max-w-[88%] rounded-br-sm border-amber-500/40 bg-gradient-to-br from-amber-500/20 to-amber-600/10 text-amber-50'
                            : 'max-w-[96%] rounded-bl-sm border-slate-800 bg-slate-950/85 text-slate-200'
                        }`}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <span
                            className={`text-[11px] font-semibold ${
                              isUser ? 'text-amber-300' : 'text-slate-400'
                            }`}
                          >
                            {isUser ? '战术指令' : '外卖员 AI 战报'}
                          </span>
                          <div className="flex items-center gap-1.5 font-mono text-[10px]">
                            {m.tokenBadge && (
                              <span className="rounded bg-slate-900 px-1.5 py-0.5 text-slate-400">
                                {m.tokenBadge}
                              </span>
                            )}
                            {m.responseId && (
                              <span className="text-indigo-400" title={m.responseId}>
                                {m.responseId.slice(0, 10)}
                              </span>
                            )}
                          </div>
                        </div>

                        <RichChatContent content={m.content} />

                        {!isUser && m.toolLogs && m.toolLogs.length > 0 && (
                          <TurnActionStepperPills toolLogs={m.toolLogs} />
                        )}

                        {!isUser && toolCount > 0 && (
                          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2">
                            <div className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                              <span>本回合调用 {toolCount} 个工具</span>
                              <span>·</span>
                              <span>{totalLatency} ms</span>
                            </div>

                            <button
                              type="button"
                              onClick={() => setModalTurnMsg(m)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition hover:border-amber-400 hover:bg-amber-500/20"
                            >
                              <TerminalSquare className="h-3.5 w-3.5" />
                              查看工具日志 ({toolCount})
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                {(runningPlaybookId || chatBusy || autoPlayActive) && (
                  <div className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-amber-400" />
                    <span className="truncate">
                      {liveProgressText || 'AI 骑手正在思考下一步行动...'}
                    </span>
                  </div>
                )}
              </div>

              {showJumpBottom && (
                <button
                  type="button"
                  onClick={() => scrollChatToBottom('smooth')}
                  className="absolute bottom-3 right-4 inline-flex items-center gap-1 rounded-full border border-amber-400/60 bg-slate-900/95 px-3 py-1 text-[11px] font-semibold text-amber-300 shadow-lg hover:bg-slate-800"
                >
                  <ArrowDown className="h-3 w-3" />
                  回到底部
                </button>
              )}
            </div>

            {/* Tactical Hint Input */}
            <div className="shrink-0 border-t border-slate-800 bg-slate-900/95 p-3">
              <div className="mb-2 flex flex-wrap gap-1.5">
                {[
                  '抢生日蛋糕单并稳骑送达',
                  '花32元改装液压减震架',
                  '找麦当劳店长礼貌催单',
                  '去换电柜满血换电',
                ].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={isAnythingRunning}
                    onClick={() => void handleChatSubmit(undefined, chip)}
                    className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 text-[11px] text-slate-300 hover:border-amber-500/50 hover:text-amber-200 disabled:opacity-40"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <form onSubmit={(e) => void handleChatSubmit(e)} className="flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="给外卖员 AI 下达战术指导 (或点上方【AI自动玩一局】)..."
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={isAnythingRunning}
                  className="inline-flex items-center justify-center rounded-lg bg-amber-500 px-3 py-1.5 text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                >
                  <Send className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 2: DIRECT TOOL CALLER */}
        {tab === 'tools' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 flex flex-wrap gap-1 border-b border-slate-800 p-2.5 text-[11px]">
              {(
                [
                  ['ALL', `全部 (${tools.length})`],
                  ['MAIN', '主游戏命令式'],
                  ['FORM', '声明式 <form>'],
                  ['IFRAME', '跨帧外卖柜/隐私号'],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setSourceFilter(k)}
                  className={`rounded-md px-2 py-1 font-medium ${
                    sourceFilter === k
                      ? 'bg-slate-800 text-amber-300 ring-1 ring-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="max-h-52 shrink-0 divide-y divide-slate-800/70 overflow-y-auto overscroll-contain border-b border-slate-800">
              {filteredTools.map((t) => {
                const active = selectedTool?.name === t.name;
                return (
                  <button
                    key={t.name}
                    type="button"
                    onClick={() => setSelectedToolName(t.name)}
                    className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-xs transition ${
                      active ? 'bg-amber-500/15' : 'hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate font-mono text-[11px] font-semibold text-amber-300">
                          {t.name}
                        </span>
                        {t.isCrossFrame && (
                          <span className="rounded bg-emerald-500/20 px-1 py-0.5 font-mono text-[9px] text-emerald-300">
                            IFRAME
                          </span>
                        )}
                        {t.isDeclarativeForm && (
                          <span className="rounded bg-sky-500/20 px-1 py-0.5 font-mono text-[9px] text-sky-300">
                            FORM
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-400">{t.title}</div>
                    </div>
                    <ChevronRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </button>
                );
              })}
            </div>

            {selectedTool && (
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 text-xs">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-white">{selectedTool.name}</span>
                    <span className="font-mono text-[10px] text-slate-400">
                      {selectedTool.originLabel}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                    {selectedTool.description}
                  </p>
                </div>

                <details className="rounded-lg border border-slate-800 bg-slate-950/70 p-2">
                  <summary className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-slate-300">
                    <Code className="h-3.5 w-3.5 text-amber-400" />
                    查看 JSON inputSchema 定义
                  </summary>
                  <pre className="mt-2 max-h-36 overflow-auto overscroll-contain font-mono text-[10px] text-slate-300">
                    {JSON.stringify(selectedTool.inputSchema ?? {}, null, 2)}
                  </pre>
                </details>

                <div className="space-y-1">
                  <span className="font-mono text-[11px] text-slate-400">
                    executeTool(tool, inputObject) 参数 JSON:
                  </span>
                  <textarea
                    rows={4}
                    value={jsonInputText}
                    onChange={(e) => setJsonInputText(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-100 focus:border-amber-500 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={toolResult.status === 'running'}
                  onClick={() => void handleInvokeSelectedTool()}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-amber-500 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" />
                  通过 WebMCP 直接调用该工具
                </button>

                {toolResult.status !== 'idle' && (
                  <div className="rounded-lg border border-emerald-500/30 bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200">
                    <pre className="max-h-44 overflow-auto overscroll-contain whitespace-pre-wrap">
                      {typeof toolResult.output === 'string'
                        ? toolResult.output
                        : JSON.stringify(toolResult.output, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: PROTOCOL EVENTS */}
        {tab === 'events' && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="shrink-0 flex items-center justify-between border-b border-slate-800 px-3 py-2 text-[11px] text-slate-400">
              <span>WebMCP 实时协议事件总线</span>
              <button
                type="button"
                onClick={() => nexusStore.patch({ protocolLogs: [] })}
                className="hover:text-slate-200"
              >
                清空日志
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain p-3">
              {protocolLogs.map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-lg border border-slate-800 bg-slate-950/85 p-2.5 text-[11px]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                      {ev.type}
                    </span>
                    <span className="font-mono text-[10px] text-slate-500">
                      {ev.originLabel} · {ev.timestamp}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-200">{ev.summary}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* Per-Turn Tool Execution Logs Modal */}
      <TurnToolLogsModal
        open={Boolean(modalTurnMsg)}
        onClose={() => setModalTurnMsg(null)}
        userPrompt={modalTurnMsg?.userPrompt}
        toolLogs={modalTurnMsg?.toolLogs ?? []}
        reasoningSummary={modalTurnMsg?.reasoningSummary}
      />

      {/* Dual-Model (World Director vs Rider Player) Modal */}
      <WorldDirectorModal
        open={showDualModal}
        onClose={() => setShowDualModal(false)}
        riderLlmConfig={llmConfig}
        onChangeRiderLlm={setLlmConfig}
        onClearRiderKey={handleClearRiderKey}
        session={session}
      />

      {/* 6D Radar & Same-Seed Benchmark Leaderboard Modal */}
      <BenchmarkLeaderboardModal
        open={showLeaderboardModal}
        onClose={() => setShowLeaderboardModal(false)}
        activeRiderModelLabel={
          llmConfig.enabled && llmConfig.apiKey.trim()
            ? `${llmConfig.model.trim() || 'Rider-LLM'} (思考:${formatReasoningEffortTag(llmConfig.reasoningEffort)})`
            : '内置策略Bot'
        }
      />
    </>
  );
};

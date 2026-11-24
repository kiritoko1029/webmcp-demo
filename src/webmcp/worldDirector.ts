import { useSyncExternalStore } from 'react';
import { createInitialShift } from '../store/initialData';
import { buildDefaultStops, nexusStore } from '../store/nexusStore';
import {
  buildSeededInitialRider,
  computeSeededMilestoneEvent,
  SCHEDULED_CLOCK_MILESTONES,
  synthesizeDeterministicOrdersForMap,
} from '../store/seededWorldEngine';
import type {
  DeliveryOrder,
  FoodCategory,
  FragileTag,
  ScheduledMilestoneEventSpec,
  WorldHazardZone,
  WorldLandmark,
  WorldMapConfig,
  WorldMerchant,
} from '../types/domain';
import {
  formatReasoningEffortTag,
  normalizeReasoningEffort,
  postResponsesRequest,
} from './agentPlaybooks';
import { responsesSession } from './responsesSessionManager';
import {
  createSeededRng,
  encodeWorldToShareSeed,
  generateRandomSeedId,
  parseWorldSeedInput,
} from './worldSeedCodec';

export type WorldDifficulty = 'standard' | 'hardcore' | 'chaos';

export interface WorldModelConfig {
  enabled: boolean;
  providerPreset: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  difficulty: WorldDifficulty;
  reasoningEffort?: string;
}

const WORLD_LLM_STORAGE_KEY = 'ridergo_world_llm_config_v1';

const DEFAULT_WORLD_CONFIG: WorldModelConfig = {
  enabled: false,
  providerPreset: 'openai-4.1-mini',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1-mini',
  difficulty: 'hardcore',
  reasoningEffort: '',
};

function loadWorldConfig(): WorldModelConfig {
  if (typeof window === 'undefined') return DEFAULT_WORLD_CONFIG;
  try {
    const raw = window.localStorage.getItem(WORLD_LLM_STORAGE_KEY);
    if (!raw) return DEFAULT_WORLD_CONFIG;
    const parsed = JSON.parse(raw) as Partial<WorldModelConfig>;
    return {
      enabled: Boolean(parsed.enabled),
      providerPreset: parsed.providerPreset ?? 'openai-4.1-mini',
      baseUrl: parsed.baseUrl ?? DEFAULT_WORLD_CONFIG.baseUrl,
      apiKey: parsed.apiKey ?? '',
      model: parsed.model ?? DEFAULT_WORLD_CONFIG.model,
      difficulty: parsed.difficulty ?? 'hardcore',
      reasoningEffort: normalizeReasoningEffort(parsed.reasoningEffort),
    };
  } catch {
    return DEFAULT_WORLD_CONFIG;
  }
}

let worldConfigState: WorldModelConfig = loadWorldConfig();
const worldListeners = new Set<() => void>();

export const worldModelStore = {
  getState(): WorldModelConfig {
    return worldConfigState;
  },
  subscribe(l: () => void): () => void {
    worldListeners.add(l);
    return () => worldListeners.delete(l);
  },
  update(patch: Partial<WorldModelConfig>) {
    worldConfigState = { ...worldConfigState, ...patch };
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(WORLD_LLM_STORAGE_KEY, JSON.stringify(worldConfigState));
      } catch {
        // Ignore
      }
    }
    for (const l of worldListeners) l();
  },
  clearKey() {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(WORLD_LLM_STORAGE_KEY);
    }
    worldConfigState = { ...DEFAULT_WORLD_CONFIG };
    for (const l of worldListeners) l();
  },
};

export function useWorldModelConfig(): WorldModelConfig {
  return useSyncExternalStore(
    worldModelStore.subscribe,
    worldModelStore.getState,
    worldModelStore.getState,
  );
}

function resolveWorldResponsesUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
}

/**
 * Calls the independent World Director Model via OpenAI `POST /v1/responses` and parses JSON.
 */
async function callWorldResponsesJson<T>(
  systemInstructions: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<T> {
  const cfg = worldModelStore.getState();
  const endpoint = resolveWorldResponsesUrl(cfg.baseUrl);

  const apiRes = await postResponsesRequest(
    endpoint,
    cfg.apiKey,
    {
      model: cfg.model.trim() || 'gpt-4.1-mini',
      instructions: `${systemInstructions}\n请严格只输出合法的 JSON 对象，不要输出 Markdown 代码块标记或多余解释文字。`,
      input: userPrompt,
      store: false,
    },
    signal,
    cfg.reasoningEffort ?? 'default',
  );

  if (!apiRes.ok) {
    throw new Error(`World Model HTTP ${apiRes.status}: ${apiRes.errText.slice(0, 200)}`);
  }

  const data = apiRes.data as {
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ text?: string }> }>;
  };

  let rawText = '';
  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.text) rawText += c.text;
        }
      }
    }
  }
  if (!rawText && data.output_text) {
    rawText = data.output_text;
  }

  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  return JSON.parse(cleaned) as T;
}

export async function testWorldModelConnection(): Promise<string> {
  const cfg = worldModelStore.getState();
  if (!cfg.apiKey.trim()) throw new Error('请先填写世界模型 API Key');
  const started = performance.now();
  const res = await callWorldResponsesJson<{ status: string }>(
    '你是游戏世界导演模型。',
    '请返回 JSON: {"status":"WORLD_GM_READY"}',
  );
  const ms = Math.round(performance.now() - started);
  worldModelStore.update({ enabled: true });
  const effortTag = formatReasoningEffortTag(cfg.reasoningEffort);
  return `世界导演模型连通成功 (${cfg.model} · 思考:${effortTag}, ${ms}ms): ${res.status || 'OK'}`;
}

function clampCoord(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number(val) || (min + max) / 2)));
}

function calcDistanceKm(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const px = Math.hypot(a.x - b.x, a.y - b.y);
  return Number(Math.max(0.6, px / 220).toFixed(1));
}

async function syncBrowserHashWithWorld(worldMap: WorldMapConfig, orders: DeliveryOrder[]) {
  if (typeof window === 'undefined') return '';
  try {
    const token = await encodeWorldToShareSeed(worldMap, orders);
    const url = `${window.location.pathname}${window.location.search}#world=${token}`;
    window.history.replaceState(null, '', url);
    return token;
  } catch {
    return '';
  }
}

/**
 * Rich built-in multi-theme procedural presets when World Model API key is not enabled
 * (deterministic per `seedId` so sharing any seed reproduces identical coordinates & orders!).
 */
const PROCEDURAL_THEMES: Record<string, (seedId: string) => WorldMapConfig> = {
  chongqing: (seedId: string) => {
    const rng = createSeededRng(`${seedId}::LAYOUT`);
    const jitter = seedId === 'RG-CQ8D-SEED' ? () => 0 : () => rng.nextInt(-20, 20);
    return {
      seedId,
      themeName: '重庆洪崖洞—解放碑 8D 魔幻山城夜宵局',
      themeDescription:
        '立体陡坡与百步梯老居民楼密布！火锅热汤单单价极高但爬坡耗电剧增，无电梯爬楼极耗体力！',
      generatedByModel: `内置山城种子引擎 (${seedId})`,
      initialWeather: rng.nextFloat() > 0.55 ? 'heavy_rain' : 'sunny',
      initialQuest: {
        title: '山城夜宵冲单王：完好准时送达 4 单火锅/小面赢 ¥32 奖金',
        targetDeliveries: 4,
        rewardYuan: 32,
      },
      roadsH: [
        { y: 115, name: '嘉滨路江景快线' },
        { y: 215, name: '解放碑步行街外环' },
        { y: 320, name: '南滨路夜市大道' },
      ],
      roadsV: [
        { x: 235, name: '洪崖洞盘山立交' },
        { x: 510, name: '较场口十八梯陡坡' },
        { x: 755, name: '朝天门码头通道' },
      ],
      hazards: [
        {
          id: 'HAZ-CQ-1',
          name: '十八梯连续陡坡长阶',
          type: 'uphill_slope',
          pos: { x: clampCoord(505 + jitter(), 220, 780), y: clampCoord(195 + jitter(), 110, 310) },
          radius: 64,
          effectNote: '8D 山城爬坡：经过时耗电 +6%、体力消耗 +7%',
        },
        {
          id: 'HAZ-CQ-2',
          name: '千厮门大桥江风积水段',
          type: 'flooded_slow',
          pos: { x: clampCoord(345 + jitter(), 200, 760), y: clampCoord(135 + jitter(), 100, 310) },
          radius: 55,
          effectNote: '路面湿滑减速 +4 分钟，狂飙易洒红油火锅',
        },
      ],
      merchants: [
        {
          id: 'MER-CQ-1',
          name: '佩姐老火锅 (洪崖洞总店)',
          category: '火锅烧烤',
          address: '洪崖洞4层临江铺',
          pos: { x: clampCoord(265 + jitter(), 150, 810), y: clampCoord(145 + jitter(), 90, 330) },
          avgPrepMinutes: 7,
          busyLevel: 'jammed',
          signatureItems: ['九宫格牛油红汤锅底(极易洒)×1', '鲜毛肚×2'],
          npcPersona: '嗓门洪亮的山城火锅掌柜，催单直来直去',
        },
        {
          id: 'MER-CQ-2',
          name: '茶颜悦色 (解放碑国泰店)',
          category: '奶茶咖啡',
          address: '解放碑国泰广场B1',
          pos: { x: clampCoord(455 + jitter(), 150, 810), y: clampCoord(175 + jitter(), 90, 330) },
          avgPrepMinutes: 3,
          busyLevel: 'busy',
          signatureItems: ['幽兰拿铁(顶层奶油怕颠)×2', '声声乌龙×1'],
          npcPersona: '温柔细致的店员妹子，提醒奶油顶别倒了',
        },
        {
          id: 'MER-CQ-3',
          name: '九村烤脑花 (较场口夜宵王)',
          category: '火锅烧烤',
          address: '较场口夜市街88号',
          pos: { x: clampCoord(535 + jitter(), 150, 810), y: clampCoord(295 + jitter(), 90, 335) },
          avgPrepMinutes: 8,
          busyLevel: 'busy',
          signatureItems: ['锡纸烤脑花×2', '炭烤苕皮×4', '冰镇唯怡豆奶×2'],
          npcPersona: '烟火气十足的烧烤师傅，现烤需耐心等几分钟',
        },
        {
          id: 'MER-CQ-4',
          name: '沁园法式甜品 (时代广场店)',
          category: '蛋糕甜品',
          address: '青年路时代广场1层',
          pos: { x: clampCoord(645 + jitter(), 150, 810), y: clampCoord(135 + jitter(), 90, 330) },
          avgPrepMinutes: 2,
          busyLevel: 'normal',
          signatureItems: ['江景纪念日双层慕斯蛋糕(占2格·极怕震)×1'],
          npcPersona: '严谨的裱花师，交付前拍照留底',
        },
        {
          id: 'MER-CQ-5',
          name: '秦云老太婆摊摊面',
          category: '快餐便当',
          address: '白象街口12号',
          pos: { x: clampCoord(695 + jitter(), 150, 810), y: clampCoord(255 + jitter(), 90, 330) },
          avgPrepMinutes: 2,
          busyLevel: 'normal',
          signatureItems: ['招牌豌杂小面(带汤)×2', '红糖冰汤圆×2'],
          npcPersona: '手脚利索的重庆嬢嬢，两分钟出锅',
        },
      ],
      landmarks: [
        {
          id: 'LM-CQ-1',
          name: '白象居网红老居民楼 (8楼无电梯!)',
          pos: { x: clampCoord(765 + jitter(), 170, 845), y: clampCoord(175 + jitter(), 85, 335) },
          buildingType: 'walkup_no_elevator',
          floor: 8,
          hasElevator: false,
          hasSmartLocker: false,
        },
        {
          id: 'LM-CQ-2',
          name: 'WFC 环球金融中心写字楼',
          pos: { x: clampCoord(565 + jitter(), 170, 845), y: clampCoord(110 + jitter(), 85, 335) },
          buildingType: 'office_locker',
          floor: 36,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-HUAMAO',
        },
        {
          id: 'LM-CQ-3',
          name: '江北嘴壹号院江景公寓',
          pos: { x: clampCoord(390 + jitter(), 170, 845), y: clampCoord(95 + jitter(), 85, 335) },
          buildingType: 'apartment',
          floor: 18,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-SUN100',
        },
        {
          id: 'LM-CQ-4',
          name: '南滨路珊瑚水岸 B区',
          pos: { x: clampCoord(815 + jitter(), 170, 850), y: clampCoord(310 + jitter(), 85, 340) },
          buildingType: 'gated_community',
          floor: 11,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-ZHUJIANG',
        },
      ],
      stations: [
        { id: 'ST-CQ-1', name: '两轮超充换电柜·解放碑站', type: 'battery_swap', pos: { x: 430, y: 215 } },
        { id: 'ST-CQ-2', name: '罗森便利店·山城凉茶补给站', type: 'energy_mart', pos: { x: 620, y: 215 } },
      ],
    };
  },

  cyberpunk: (seedId: string) => {
    const rng = createSeededRng(`${seedId}::LAYOUT`);
    const jitter = seedId === 'RG-CYBER-2077' ? () => 0 : () => rng.nextInt(-20, 20);
    return {
      seedId,
      themeName: '新虹桥 2077 · 赛博霓虹暴雨夜',
      themeDescription:
        '全息广告牌下的高架磁浮街区，酸雨积水路段与无人机禁飞区并存，极客黑客顾客经常在备注里埋设高级 Prompt 注入陷阱！',
      generatedByModel: `内置赛博种子引擎 (${seedId})`,
      initialWeather: 'heavy_rain',
      initialQuest: {
        title: '赛博传奇信使：酸雨夜完好送达 4 单赢 ¥35 信用点奖励',
        targetDeliveries: 4,
        rewardYuan: 35,
      },
      roadsH: [
        { y: 115, name: '霓虹高架一层辅道' },
        { y: 210, name: '赛博中枢大道' },
        { y: 315, name: '地下黑市美食走廊' },
      ],
      roadsV: [
        { x: 250, name: '荒坂塔西侧通道' },
        { x: 530, name: '全息广场中轴线' },
        { x: 770, name: '量子港湾货运道' },
      ],
      hazards: [
        {
          id: 'HAZ-CY-1',
          name: '全息广场电磁积水区',
          type: 'flooded_slow',
          pos: { x: clampCoord(525 + jitter(), 220, 780), y: clampCoord(205 + jitter(), 100, 315) },
          radius: 60,
          effectNote: '积水导电减速 +5 分钟，额外耗电 +5%',
        },
        {
          id: 'HAZ-CY-2',
          name: '地下管道重工震动带',
          type: 'construction_bumpy',
          pos: { x: clampCoord(380 + jitter(), 200, 760), y: clampCoord(285 + jitter(), 100, 320) },
          radius: 54,
          effectNote: '路面剧烈震动：未装减震架时精密餐品完整度 -25%',
        },
      ],
      merchants: [
        {
          id: 'MER-CY-1',
          name: '霓虹拉面馆·一兰义体店',
          category: '快餐便当',
          address: '霓虹高架B2层04铺',
          pos: { x: clampCoord(295 + jitter(), 150, 810), y: clampCoord(145 + jitter(), 90, 330) },
          avgPrepMinutes: 3,
          busyLevel: 'normal',
          signatureItems: ['浓厚豚骨拉面(热汤防洒)×1', '溏心蛋×2'],
          npcPersona: '机械臂拉面大师，出餐精准到秒',
        },
        {
          id: 'MER-CY-2',
          name: '液氮特调咖啡·ZeroLab',
          category: '奶茶咖啡',
          address: '赛博中枢大厦1层',
          pos: { x: clampCoord(485 + jitter(), 150, 810), y: clampCoord(150 + jitter(), 90, 330) },
          avgPrepMinutes: 2,
          busyLevel: 'normal',
          signatureItems: ['零下196度液氮冷萃×2', '蓝藻能量冰饮×1'],
          npcPersona: '冷酷调饮师，提醒冰饮超时会气化失效',
        },
        {
          id: 'MER-CY-3',
          name: '量子分子料理甜品局',
          category: '蛋糕甜品',
          address: '全息广场东侧水晶屋',
          pos: { x: clampCoord(650 + jitter(), 150, 810), y: clampCoord(120 + jitter(), 90, 330) },
          avgPrepMinutes: 5,
          busyLevel: 'busy',
          signatureItems: ['悬浮糖艺星云蛋糕(占2格·极脆弱)×1'],
          npcPersona: '完美主义主厨，有一点磕碰就会心疼半天',
        },
        {
          id: 'MER-CY-4',
          name: '赤焰合成肉烧烤摊',
          category: '火锅烧烤',
          address: '黑市走廊99号',
          pos: { x: clampCoord(430 + jitter(), 150, 810), y: clampCoord(320 + jitter(), 90, 335) },
          avgPrepMinutes: 9,
          busyLevel: 'jammed',
          signatureItems: ['高压战斧牛排串×10', '辣味沸腾锅×1'],
          npcPersona: '暴躁独眼老板，单子太多正在猛扇炭火',
        },
      ],
      landmarks: [
        {
          id: 'LM-CY-1',
          name: '黑客蜂巢胶囊公寓 (7楼无电梯)',
          pos: { x: clampCoord(350 + jitter(), 170, 845), y: clampCoord(95 + jitter(), 85, 335) },
          buildingType: 'walkup_no_elevator',
          floor: 7,
          hasElevator: false,
          hasSmartLocker: false,
        },
        {
          id: 'LM-CY-2',
          name: '矩阵科技总部大厦 (智能空投柜)',
          pos: { x: clampCoord(615 + jitter(), 170, 845), y: clampCoord(185 + jitter(), 85, 335) },
          buildingType: 'office_locker',
          floor: 45,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-HUAMAO',
        },
        {
          id: 'LM-CY-3',
          name: '云端天际公寓 A塔',
          pos: { x: clampCoord(810 + jitter(), 170, 850), y: clampCoord(145 + jitter(), 85, 335) },
          buildingType: 'apartment',
          floor: 28,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-SUN100',
        },
        {
          id: 'LM-CY-4',
          name: '霓虹湾极客社区 3号院',
          pos: { x: clampCoord(760 + jitter(), 170, 845), y: clampCoord(305 + jitter(), 85, 340) },
          buildingType: 'gated_community',
          floor: 9,
          hasElevator: true,
          hasSmartLocker: true,
          lockerSiteId: 'LCK-ZHUJIANG',
        },
      ],
      stations: [
        { id: 'ST-CY-1', name: '特斯拉超导换电桩·中枢站', type: 'battery_swap', pos: { x: 395, y: 210 } },
        { id: 'ST-CY-2', name: '义体肾上腺素便利店', type: 'energy_mart', pos: { x: 675, y: 210 } },
      ],
    };
  },
};

function synthesizeOrdersForMap(
  map: WorldMapConfig,
  count: number,
  difficulty: WorldDifficulty,
  markWorldGenerated: boolean,
  initialActiveCount = 0,
  waveKey = 'INIT',
  waveIndex = 0,
): DeliveryOrder[] {
  return synthesizeDeterministicOrdersForMap({
    map,
    count,
    difficultyOverride: difficulty,
    markWorldGenerated,
    initialActiveCount,
    waveKey,
    waveIndex,
  });
}

export interface WorldGenerateOptions {
  customSeedId?: string;
  syncUrlHash?: boolean;
  signal?: AbortSignal;
}

export interface GeneratedWorldResult {
  themeName: string;
  seedId: string;
  shareToken: string;
  shareUrl: string;
  usedLiveWorldModel: boolean;
  orderCount: number;
}

/**
 * 1. Generate Entire New City World (Map + Hazards + Merchants + Landmarks + Orders + Shareable Seed!)
 * Uses World Director `/v1/responses` LLM when enabled, or deterministic seeded preset otherwise!
 */
export async function generateNewWorldByDirector(
  themePrompt: string,
  options?: WorldGenerateOptions,
): Promise<GeneratedWorldResult> {
  const cfg = worldModelStore.getState();
  const promptText = themePrompt.trim() || '重庆洪崖洞暴雨夜宵山城';
  const seedId = options?.customSeedId?.trim() || generateRandomSeedId('RG');
  const syncUrlHash = options?.syncUrlHash !== false;

  if (cfg.enabled && cfg.apiKey.trim()) {
    interface LlmWorldSpec {
      themeName: string;
      themeDescription: string;
      questTitle: string;
      questRewardYuan: number;
      weather: 'sunny' | 'heavy_rain' | 'gale_wind';
      roadsH: Array<{ y: number; name: string }>;
      roadsV: Array<{ x: number; name: string }>;
      hazards: Array<{
        name: string;
        type: 'construction_bumpy' | 'flooded_slow' | 'uphill_slope';
        x: number;
        y: number;
        effectNote: string;
      }>;
      merchants: Array<{
        name: string;
        category: FoodCategory;
        address: string;
        x: number;
        y: number;
        busyLevel: 'normal' | 'busy' | 'jammed';
        signatureItems: string[];
        npcPersona: string;
      }>;
      landmarks: Array<{
        name: string;
        x: number;
        y: number;
        floor: number;
        hasElevator: boolean;
        hasSmartLocker: boolean;
      }>;
      scheduledEvents?: Array<{
        minute: number;
        title: string;
        detail: string;
        nextWeather: 'sunny' | 'heavy_rain' | 'gale_wind';
        feeDeltaYuan: number;
      }>;
    }

    const spec = await callWorldResponsesJson<LlmWorldSpec>(
      `你是《闪电骑士：AI外卖生存挑战赛》的世界导演大模型 (World Director)。
请根据用户给定的城市/天气主题与世界种子 [${seedId}]，设计一张高策略博弈性的 920x390 像素城市外卖地图及“局中四幕定时突发事件剧本” JSON：
要求包含：
- themeName (中文主题名), themeDescription (一句话玩法特色), questTitle (本局冲单支线目标), questRewardYuan (20-45), weather ("sunny"|"heavy_rain"|"gale_wind")
- roadsH: 3条横向道路 [{"y": 115, "name": "..."}, {"y": 210, "name": "..."}, {"y": 315, "name": "..."}]
- roadsV: 3条纵向道路 [{"x": 240, "name": "..."}, {"x": 520, "name": "..."}, {"x": 760, "name": "..."}]
- hazards: 2个危险地形区 (type 只能是 "construction_bumpy" | "flooded_slow" | "uphill_slope", x 在 250..780, y 在 100..330, effectNote 简述影响)
- merchants: 5家特色餐饮商户 (category 只能是 "奶茶咖啡"|"快餐便当"|"火锅烧烤"|"蛋糕甜品"|"生鲜超市", x 在 160..820, y 在 90..340, busyLevel 为 "normal"|"busy"|"jammed", signatureItems 2个菜品名, npcPersona 一句话人设)
- landmarks: 4个收货楼宇 (x 在 180..850, y 在 85..340, floor 3..32, 至少1个 hasElevator:false 无电梯老楼, 至少2个 hasSmartLocker:true 写字楼/公寓)
- scheduledEvents: 4个贴合本城市主题的局中动态突发事件（分别对应游戏第 35、75、115、150 分钟，即 11:35 / 12:15 / 12:55 / 13:30，开局对外卖员隐藏，到点触发并锁定进种子确保不同模型公平对比！格式：[{"minute":35,"title":"...","detail":"...","nextWeather":"heavy_rain"|"gale_wind"|"sunny","feeDeltaYuan":3.5}, ...]）`,
      `请生成外卖生存游戏世界，主题：「${promptText}」，种子：${seedId}，难度：${cfg.difficulty}`,
      options?.signal,
    );

    const lockerIds = ['LCK-HUAMAO', 'LCK-SUN100', 'LCK-ZHUJIANG'];
    let lockerIdx = 0;
    const questReward = clampCoord(spec.questRewardYuan ?? 28, 15, 60);
    const questTitle = spec.questTitle || '城市冲单挑战：准时完好送达 4 单赢额外奖金';
    const initialWeather = spec.weather || 'sunny';

    const validWeathers = ['sunny', 'heavy_rain', 'gale_wind'] as const;
    const normalizedScheduledEvents: ScheduledMilestoneEventSpec[] = SCHEDULED_CLOCK_MILESTONES.map(
      (ms, idx) => {
        const rawEv =
          spec.scheduledEvents?.find((e) => Number(e.minute) === ms.minute) ??
          spec.scheduledEvents?.[idx];
        if (rawEv && rawEv.title) {
          const w = validWeathers.includes(rawEv.nextWeather) ? rawEv.nextWeather : initialWeather;
          return {
            minute: ms.minute,
            title: rawEv.title,
            detail: rawEv.detail || '城市突发动态事件生效，待抢与新派订单享受额外配送补贴！',
            nextWeather: w,
            feeDeltaYuan: Number(clampCoord(rawEv.feeDeltaYuan ?? 3, 1.5, 6).toFixed(1)),
            source: 'world_llm',
          };
        }
        return computeSeededMilestoneEvent({
          seedId,
          milestoneMinute: ms.minute,
          milestoneLabel: ms.label,
          currentWeather: initialWeather,
        });
      },
    );

    const builtMap: WorldMapConfig = {
      seedId,
      themeName: spec.themeName || promptText,
      themeDescription: spec.themeDescription || '由世界导演大模型实时生成的动态跑单街区',
      generatedByModel: `World Model (${cfg.model})`,
      difficulty: cfg.difficulty,
      initialWeather,
      initialRiderPos: { x: 260, y: 210 },
      initialRiderArea: spec.roadsH?.[1]?.name || '中心大道',
      initialQuest: {
        title: questTitle,
        targetDeliveries: 4,
        rewardYuan: questReward,
      },
      scheduledEvents: normalizedScheduledEvents,
      waveCount: 0,
      triggeredClockMilestones: [],
      roadsH:
        Array.isArray(spec.roadsH) && spec.roadsH.length >= 2
          ? spec.roadsH.slice(0, 3).map((r, idx) => ({
              y: [115, 210, 315][idx] ?? clampCoord(r.y, 90, 340),
              name: r.name || `横向干道 ${idx + 1}`,
            }))
          : [
              { y: 115, name: '北环商业街' },
              { y: 210, name: '中心大道' },
              { y: 315, name: '南滨夜市路' },
            ],
      roadsV:
        Array.isArray(spec.roadsV) && spec.roadsV.length >= 2
          ? spec.roadsV.slice(0, 3).map((r, idx) => ({
              x: [240, 520, 760][idx] ?? clampCoord(r.x, 180, 820),
              name: r.name || `纵向干道 ${idx + 1}`,
            }))
          : [
              { x: 240, name: '西侧快线' },
              { x: 520, name: '中轴大道' },
              { x: 760, name: '东区走廊' },
            ],
      hazards: (spec.hazards ?? []).slice(0, 3).map(
        (h, i): WorldHazardZone => ({
          id: `HAZ-AI-${i + 1}`,
          name: h.name || '复杂路况区',
          type:
            h.type === 'flooded_slow' || h.type === 'uphill_slope'
              ? h.type
              : 'construction_bumpy',
          pos: { x: clampCoord(h.x, 200, 800), y: clampCoord(h.y, 95, 330) },
          radius: 56,
          effectNote: h.effectNote || '经过时需减速慢行注意耗电与防洒',
        }),
      ),
      merchants: (spec.merchants ?? []).slice(0, 6).map(
        (m, i): WorldMerchant => ({
          id: `MER-AI-${i + 1}`,
          name: m.name || `特色商户 #${i + 1}`,
          category: ['奶茶咖啡', '快餐便当', '火锅烧烤', '蛋糕甜品', '生鲜超市'].includes(
            m.category,
          )
            ? m.category
            : '快餐便当',
          address: m.address || '核心商圈底商',
          pos: { x: clampCoord(m.x, 140, 830), y: clampCoord(m.y, 85, 340) },
          avgPrepMinutes: m.busyLevel === 'jammed' ? 9 : m.busyLevel === 'busy' ? 5 : 2,
          busyLevel: m.busyLevel || 'normal',
          signatureItems:
            Array.isArray(m.signatureItems) && m.signatureItems.length > 0
              ? m.signatureItems
              : ['招牌双人套餐×1'],
          npcPersona: m.npcPersona || '忙碌的餐饮店长',
        }),
      ),
      landmarks: (spec.landmarks ?? []).slice(0, 5).map((lm, i): WorldLandmark => {
        const hasLocker = Boolean(lm.hasSmartLocker);
        const siteId = hasLocker ? lockerIds[lockerIdx++ % lockerIds.length] : undefined;
        return {
          id: `LM-AI-${i + 1}`,
          name: lm.name || `收货大厦 #${i + 1}`,
          pos: { x: clampCoord(lm.x, 150, 850), y: clampCoord(lm.y, 80, 345) },
          buildingType: !lm.hasElevator
            ? 'walkup_no_elevator'
            : hasLocker
              ? 'office_locker'
              : 'gated_community',
          floor: clampCoord(lm.floor, 2, 36),
          hasElevator: Boolean(lm.hasElevator),
          hasSmartLocker: hasLocker,
          lockerSiteId: siteId,
        };
      }),
      stations: [
        { id: 'ST-AI-SWAP', name: '智能闪电换电柜 (¥3满电)', type: 'battery_swap', pos: { x: 380, y: 210 } },
        { id: 'ST-AI-MART', name: '24h 骑手能量补给站', type: 'energy_mart', pos: { x: 650, y: 210 } },
      ],
    };

    const generatedOrders = synthesizeOrdersForMap(builtMap, 6, cfg.difficulty, true, 2, 'INIT', 0);
    const mapWithSnapshot: WorldMapConfig = {
      ...builtMap,
      initialRiderArea: builtMap.roadsH[1]?.name ?? '中心出发点',
      initialOrdersSnapshot: generatedOrders.map((o) => ({ ...o, items: [...o.items] })),
    };

    const freshRider = buildSeededInitialRider(mapWithSnapshot);
    const freshShift = {
      ...createInitialShift(),
      questTitle,
      questRewardYuan: questReward,
    };

    nexusStore.update((prev) => ({
      ...prev,
      worldMap: mapWithSnapshot,
      rider: freshRider,
      shift: freshShift,
      orders: generatedOrders,
      selectedOrderId: generatedOrders[0]?.orderId ?? null,
      plannedStops: buildDefaultStops(generatedOrders, freshRider.pos),
      issueReports: [],
      withdrawals: [],
      riderTrail: [],
      activeRiderBubble: `新城市 [${seedId}] 待命出发`,
      liveActionFeed: [
        {
          id: `ACT-W-${Date.now()}`,
          gameTimeLabel: '11:00',
          wallTime: new Date().toTimeString().slice(0, 8),
          actor: '世界导演',
          toolName: 'world.generate',
          category: 'observe',
          headline: `已生成新世界「${builtMap.themeName}」(${seedId})`,
          badges: [`${generatedOrders.length} 笔初始单`, `天气: ${initialWeather}`],
        },
      ],
      worldEvents: [
        {
          id: `WEV-${Date.now()}`,
          gameTimeLabel: '11:00',
          title: `世界导演已生成可共享种子 [${seedId}]：${builtMap.themeName}`,
          detail: `${builtMap.themeDescription}（可点击【分享世界种子】把同款世界链接发给好友或其它大模型打榜！）`,
          source: 'world_llm',
          severity: 'bonus',
        },
      ],
    }));

    responsesSession.resetSession();
    const shareToken = syncUrlHash
      ? await syncBrowserHashWithWorld(mapWithSnapshot, generatedOrders)
      : await encodeWorldToShareSeed(mapWithSnapshot, generatedOrders);
    const base =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';

    return {
      themeName: builtMap.themeName,
      seedId,
      shareToken,
      shareUrl: `${base}#world=${shareToken}`,
      usedLiveWorldModel: true,
      orderCount: generatedOrders.length,
    };
  }

  // Deterministic procedural world generation using seedId
  const isCyber = /赛博|霓虹|2077|cyber/i.test(promptText);
  const chosenPreset = isCyber
    ? PROCEDURAL_THEMES.cyberpunk(seedId)
    : PROCEDURAL_THEMES.chongqing(seedId);

  const weatherOverride = /雨|暴雪|台风/.test(promptText)
    ? ('heavy_rain' as const)
    : (chosenPreset.initialWeather ?? ('sunny' as const));

  const customNamed =
    promptText.length > 2 &&
    !promptText.includes('重庆洪崖洞') &&
    !promptText.includes('新虹桥');

  const baseMap: WorldMapConfig = {
    ...chosenPreset,
    seedId,
    themeName: customNamed ? promptText : chosenPreset.themeName,
    difficulty: cfg.difficulty,
    initialWeather: weatherOverride,
    initialRiderPos: { x: 260, y: chosenPreset.roadsH[1]?.y ?? 215 },
    initialRiderArea: chosenPreset.roadsH[1]?.name ?? '中心大道',
    waveCount: 0,
    triggeredClockMilestones: [],
  };

  const orders = synthesizeOrdersForMap(baseMap, 6, cfg.difficulty, false, 2, 'INIT', 0);
  const finalMap: WorldMapConfig = {
    ...baseMap,
    initialOrdersSnapshot: orders.map((o) => ({ ...o, items: [...o.items] })),
  };

  const freshRider = buildSeededInitialRider(finalMap);
  const freshShift = {
    ...createInitialShift(),
    questTitle: finalMap.initialQuest?.title ?? createInitialShift().questTitle,
    questTargetDeliveries:
      finalMap.initialQuest?.targetDeliveries ?? createInitialShift().questTargetDeliveries,
    questRewardYuan: finalMap.initialQuest?.rewardYuan ?? createInitialShift().questRewardYuan,
  };

  nexusStore.update((prev) => ({
    ...prev,
    worldMap: finalMap,
    rider: freshRider,
    shift: freshShift,
    orders,
    selectedOrderId: orders[0]?.orderId ?? null,
    plannedStops: buildDefaultStops(orders, freshRider.pos),
    issueReports: [],
    withdrawals: [],
    riderTrail: [],
    activeRiderBubble: `新城市 [${seedId}] 待命出发`,
    liveActionFeed: [
      {
        id: `ACT-WP-${Date.now()}`,
        gameTimeLabel: '11:00',
        wallTime: new Date().toTimeString().slice(0, 8),
        actor: '世界导演',
        toolName: 'world.generate',
        category: 'observe',
        headline: `已生成种子世界「${finalMap.themeName}」(${seedId})`,
        badges: [`${orders.length} 笔初始单`, `天气: ${weatherOverride}`],
      },
    ],
    worldEvents: [
      {
        id: `WEV-${Date.now()}`,
        gameTimeLabel: '11:00',
        title: `已生成世界种子 [${seedId}]：${finalMap.themeName}`,
        detail: `${finalMap.themeDescription}（点击顶部【分享世界】即可复制同款世界种子链接！）`,
        source: 'game_engine',
        severity: 'bonus',
      },
    ],
  }));

  responsesSession.resetSession();
  const shareToken = syncUrlHash
    ? await syncBrowserHashWithWorld(finalMap, orders)
    : await encodeWorldToShareSeed(finalMap, orders);
  const base =
    typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : '';

  return {
    themeName: finalMap.themeName,
    seedId,
    shareToken,
    shareUrl: `${base}#world=${shareToken}`,
    usedLiveWorldModel: false,
    orderCount: orders.length,
  };
}

/**
 * Imports a shared world from a URL (`#world=RGW1_...`), a compressed `RGW1_...` snapshot code,
 * or a short deterministic seed code (`RG-8K4M2P`), restoring the exact map, merchants, hazards & orders!
 */
export async function importWorldFromSeedOrUrl(
  rawInput: string,
  options?: { syncUrlHash?: boolean },
): Promise<{ seedId: string; themeName: string; orderCount: number; fromSnapshot: boolean }> {
  const parsed = await parseWorldSeedInput(rawInput);
  const syncUrlHash = options?.syncUrlHash !== false;

  if (typeof window !== 'undefined') {
    try {
      const frames = document.querySelectorAll('iframe');
      frames.forEach((f) =>
        f.contentWindow?.postMessage({ type: 'RIDER_RESET_FRAME' }, window.location.origin),
      );
    } catch {
      // Ignore
    }
  }

  responsesSession.resetSession();
  if (parsed.kind === 'snapshot') {
    const { map, orders } = parsed.pkg;
    const clonedOrders = orders.map((o) => ({
      ...o,
      items: [...o.items],
      merchantPos: { ...o.merchantPos },
      customerPos: { ...o.customerPos },
    }));
    const fullMap: WorldMapConfig = {
      ...map,
      seedId: map.seedId || generateRandomSeedId('RG'),
      difficulty: map.difficulty ?? 'standard',
      initialRiderPos: map.initialRiderPos ?? { x: 260, y: map.roadsH[1]?.y ?? 210 },
      initialRiderArea: map.initialRiderArea ?? map.roadsH[1]?.name ?? '中心出发点',
      waveCount: 0,
      triggeredClockMilestones: [],
      initialOrdersSnapshot: clonedOrders.map((o) => ({ ...o, items: [...o.items] })),
    };

    const freshRider = buildSeededInitialRider(fullMap);
    const freshShift = {
      ...createInitialShift(),
      questTitle: fullMap.initialQuest?.title ?? createInitialShift().questTitle,
      questTargetDeliveries:
        fullMap.initialQuest?.targetDeliveries ?? createInitialShift().questTargetDeliveries,
      questRewardYuan: fullMap.initialQuest?.rewardYuan ?? createInitialShift().questRewardYuan,
    };

    nexusStore.update((prev) => ({
      ...prev,
      worldMap: fullMap,
      rider: freshRider,
      shift: freshShift,
      orders: clonedOrders,
      selectedOrderId: clonedOrders[0]?.orderId ?? null,
      plannedStops: buildDefaultStops(clonedOrders, freshRider.pos),
      riderTrail: [],
      activeRiderBubble: `载入分享种子 [${fullMap.seedId}]`,
      liveActionFeed: [
        {
          id: `ACT-IMP-${Date.now()}`,
          gameTimeLabel: '11:00',
          wallTime: new Date().toTimeString().slice(0, 8),
          actor: '系统',
          toolName: 'seed.import',
          category: 'observe',
          headline: `已从共享快照载入「${fullMap.themeName}」(${fullMap.seedId})`,
          badges: [`${clonedOrders.length} 笔初始单`],
        },
      ],
      issueReports: [],
      withdrawals: [],
      worldEvents: [
        {
          id: `WEV-SEED-${Date.now()}`,
          gameTimeLabel: '11:00',
          title: `已从共享世界种子 [${fullMap.seedId}] 完美还原沙盘！`,
          detail: `地图「${fullMap.themeName}」(${fullMap.generatedByModel}) 与初始 ${clonedOrders.length} 笔悬赏订单已 100% 同步载入！`,
          source: 'world_llm',
          severity: 'bonus',
        },
      ],
    }));

    if (syncUrlHash) {
      await syncBrowserHashWithWorld(fullMap, clonedOrders);
    }

    return {
      seedId: fullMap.seedId,
      themeName: fullMap.themeName,
      orderCount: clonedOrders.length,
      fromSnapshot: true,
    };
  }

  // Short deterministic seed: lock difficulty & layout strictly from `shortSeed` (independent of local UI dropdown!)
  const shortSeed = parsed.seed.trim();
  if (shortSeed === 'RG-CBD-DEFAULT') {
    nexusStore.resetEnvironment();
    const defState = nexusStore.getState();
    if (syncUrlHash && typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    return {
      seedId: defState.worldMap.seedId,
      themeName: defState.worldMap.themeName,
      orderCount: defState.orders.length,
      fromSnapshot: false,
    };
  }

  const seedRng = createSeededRng(shortSeed);
  const autoTheme =
    /CY|2077|NEON/i.test(shortSeed) || seedRng.nextFloat() > 0.55
      ? '新虹桥2077·赛博霓虹暴雨夜'
      : '重庆洪崖洞·8D魔幻山城夜宵局';
  const shortDifficulty: WorldDifficulty = /CHAOS/i.test(shortSeed)
    ? 'chaos'
    : /HARD/i.test(shortSeed)
      ? 'hardcore'
      : 'standard';

  const preset = /赛博/.test(autoTheme)
    ? PROCEDURAL_THEMES.cyberpunk(shortSeed)
    : PROCEDURAL_THEMES.chongqing(shortSeed);
  const baseShortMap: WorldMapConfig = {
    ...preset,
    seedId: shortSeed,
    difficulty: shortDifficulty,
    initialRiderPos: { x: 260, y: preset.roadsH[1]?.y ?? 215 },
    initialRiderArea: preset.roadsH[1]?.name ?? '中心大道',
    waveCount: 0,
    triggeredClockMilestones: [],
  };
  const seededOrders = synthesizeOrdersForMap(
    baseShortMap,
    6,
    shortDifficulty,
    false,
    2,
    'INIT',
    0,
  );
  const seededMap: WorldMapConfig = {
    ...baseShortMap,
    initialOrdersSnapshot: seededOrders.map((o) => ({ ...o, items: [...o.items] })),
  };
  const freshRider = buildSeededInitialRider(seededMap);
  const freshShift = {
    ...createInitialShift(),
    questTitle: seededMap.initialQuest?.title ?? createInitialShift().questTitle,
    questTargetDeliveries:
      seededMap.initialQuest?.targetDeliveries ?? createInitialShift().questTargetDeliveries,
    questRewardYuan: seededMap.initialQuest?.rewardYuan ?? createInitialShift().questRewardYuan,
  };

  nexusStore.update((prev) => ({
    ...prev,
    worldMap: seededMap,
    rider: freshRider,
    shift: freshShift,
    orders: seededOrders,
    selectedOrderId: seededOrders[0]?.orderId ?? null,
    plannedStops: buildDefaultStops(seededOrders, freshRider.pos),
    riderTrail: [],
    activeRiderBubble: `短种子 [${shortSeed}] 就绪`,
    liveActionFeed: [
      {
        id: `ACT-SIMP-${Date.now()}`,
        gameTimeLabel: '11:00',
        wallTime: new Date().toTimeString().slice(0, 8),
        actor: '系统',
        toolName: 'seed.short_import',
        category: 'observe',
        headline: `已由短种子 [${shortSeed}] 生成「${seededMap.themeName}」`,
        badges: [`${seededOrders.length} 笔初始单`],
      },
    ],
    issueReports: [],
    withdrawals: [],
    worldEvents: [
      {
        id: `WEV-SHORTSEED-${Date.now()}`,
        gameTimeLabel: '11:00',
        title: `已通过短种子 [${shortSeed}] 确定性生成世界：${seededMap.themeName}`,
        detail: `所有商家坐标、危险路段、后续定时波次与事件均由 PRNG 种子锁定生成！`,
        source: 'game_engine',
        severity: 'bonus',
      },
    ],
  }));

  if (syncUrlHash) {
    await syncBrowserHashWithWorld(seededMap, seededOrders);
  }

  return {
    seedId: shortSeed,
    themeName: seededMap.themeName,
    orderCount: seededOrders.length,
    fromSnapshot: false,
  };
}

/**
 * 2. Spawn a seed-deterministic wave of orders (locked to `map.seedId` & `map.difficulty`).
 */
export async function spawnDynamicOrdersWave(
  count = 3,
  _signal?: AbortSignal,
): Promise<{ spawnedIds: string[]; usedLiveWorldModel: boolean }> {
  const s = nexusStore.getState();
  const map = s.worldMap;
  const waveIdx = (map.waveCount ?? 0) + 1;
  const fallbackOrders = synthesizeDeterministicOrdersForMap({
    map,
    count,
    waveKey: `WAVE-${waveIdx}`,
    waveIndex: waveIdx,
  });

  nexusStore.update((prev) => ({
    ...prev,
    worldMap: { ...prev.worldMap, waveCount: waveIdx },
    orders: [...prev.orders, ...fallbackOrders],
    plannedStops: buildDefaultStops([...prev.orders, ...fallbackOrders], prev.rider.pos),
  }));
  nexusStore.appendWorldEvent({
    title: `种子锁定第 ${waveIdx} 波新订单刷新 (+${fallbackOrders.length} 单)`,
    detail: `抢单大厅新增 ${fallbackOrders.map((o) => `${o.orderId}(${o.merchantName})`).join('、')}`,
    source: 'game_engine',
    severity: 'info',
  });

  return { spawnedIds: fallbackOrders.map((o) => o.orderId), usedLiveWorldModel: false };
}

/**
 * 3b. Pre-bake 4 World-Director-LLM mid-game sudden events (`11:35 / 12:15 / 12:55 / 13:30`)
 * directly into the CURRENT seed's `worldMap.scheduledEvents` + `#world=RGW1_...` URL snapshot,
 * and reset shift to 11:00 so ALL Rider Models encounter the exact same AI-authored surprise events!
 */
export async function bakeDirectorEventsIntoCurrentSeed(
  signal?: AbortSignal,
): Promise<{ count: number; titles: string[]; usedLiveWorldModel: boolean }> {
  const cfg = worldModelStore.getState();
  const s = nexusStore.getState();
  const curMap = s.worldMap;

  if (cfg.enabled && cfg.apiKey.trim()) {
    interface LlmTimelineSpec {
      events: Array<{
        minute: number;
        title: string;
        detail: string;
        nextWeather: 'sunny' | 'heavy_rain' | 'gale_wind';
        feeDeltaYuan: number;
      }>;
    }

    const res = await callWorldResponsesJson<LlmTimelineSpec>(
      `你是《闪电骑士：AI外卖生存挑战赛》的世界导演大模型。当前城市：「${curMap.themeName}」（种子：${curMap.seedId}，特色：${curMap.themeDescription}）。
请为本局 180 分钟班次预编写 4 幕极具戏剧张力与城市特色的“局中突发随机事件剧本”，分别在游戏第 35、75、115、150 分钟（即 11:35 / 12:15 / 12:55 / 13:30）触发。
这些事件在触发前对外卖员模型完全隐藏，并会被固化进地图种子以确保不同外卖员大模型公平打榜！
返回 JSON 格式：
{
  "events": [
    { "minute": 35, "title": "事件短标题", "detail": "具体路况/天气/爆单影响说明", "nextWeather": "heavy_rain" | "gale_wind" | "sunny", "feeDeltaYuan": 3.5 },
    { "minute": 75, "title": "...", "detail": "...", "nextWeather": "...", "feeDeltaYuan": 3.0 },
    { "minute": 115, "title": "...", "detail": "...", "nextWeather": "...", "feeDeltaYuan": 4.0 },
    { "minute": 150, "title": "...", "detail": "...", "nextWeather": "...", "feeDeltaYuan": 2.5 }
  ]
}`,
      `请为城市「${curMap.themeName}」生成并锁定 4 幕局中突发事件时间轴！`,
      signal,
    );

    const validWeathers = ['sunny', 'heavy_rain', 'gale_wind'] as const;
    const baked: ScheduledMilestoneEventSpec[] = SCHEDULED_CLOCK_MILESTONES.map((ms, idx) => {
      const item =
        res.events?.find((e) => Number(e.minute) === ms.minute) ?? res.events?.[idx];
      const w =
        item && validWeathers.includes(item.nextWeather)
          ? item.nextWeather
          : (curMap.initialWeather ?? 'sunny');
      return {
        minute: ms.minute,
        title: item?.title || `${ms.label}突发事件`,
        detail: item?.detail || '商圈动态事件生效，待抢与新派订单享受额外配送补贴！',
        nextWeather: w,
        feeDeltaYuan: Number(clampCoord(item?.feeDeltaYuan ?? 3, 1.5, 6).toFixed(1)),
        source: 'world_llm',
      };
    });

    const updatedMap: WorldMapConfig = {
      ...curMap,
      scheduledEvents: baked,
      waveCount: 0,
      triggeredClockMilestones: [],
    };
    nexusStore.patch({ worldMap: updatedMap });
    nexusStore.replayCurrentWorldSeed();
    responsesSession.resetSession();
    await syncBrowserHashWithWorld(
      nexusStore.getState().worldMap,
      nexusStore.getState().orders,
    );

    return {
      count: baked.length,
      titles: baked.map((b) => b.title),
      usedLiveWorldModel: true,
    };
  }

  // Offline deterministic fallback
  const fallbackBaked: ScheduledMilestoneEventSpec[] = SCHEDULED_CLOCK_MILESTONES.map((ms) =>
    computeSeededMilestoneEvent({
      seedId: curMap.seedId,
      milestoneMinute: ms.minute,
      milestoneLabel: ms.label,
      currentWeather: curMap.initialWeather ?? 'sunny',
    }),
  );
  nexusStore.patch({
    worldMap: {
      ...curMap,
      scheduledEvents: fallbackBaked,
    },
  });
  nexusStore.replayCurrentWorldSeed();
  responsesSession.resetSession();
  return {
    count: fallbackBaked.length,
    titles: fallbackBaked.map((b) => b.title),
    usedLiveWorldModel: false,
  };
}

/**
 * 3. Trigger a seed-deterministic Sudden World Event (locked to `seedId` + event counter).
 */
export async function triggerSuddenWorldEvent(_signal?: AbortSignal): Promise<string> {
  const s = nexusStore.getState();
  const ev = computeSeededMilestoneEvent({
    seedId: s.worldMap.seedId,
    milestoneMinute: s.shift.elapsedMinutes + 1000,
    milestoneLabel: '手动导演事件',
    currentWeather: s.rider.weather,
  });

  nexusStore.update((prev) => ({
    ...prev,
    rider: { ...prev.rider, weather: ev.nextWeather },
    orders: prev.orders.map((o) =>
      o.stage === 'pool' ? { ...o, feeYuan: Number((o.feeYuan + ev.feeDeltaYuan).toFixed(1)) } : o,
    ),
  }));
  nexusStore.appendWorldEvent({
    title: ev.title,
    detail: ev.detail,
    source: 'game_engine',
    severity: 'warn',
  });
  return `${ev.title}：${ev.detail}`;
}

/**
 * 4. Seed-deterministic NPC Roleplay & Negotiation!
 * Evaluates politeness & awards 100% reproducible `prepReducedMin / slaExtendedMin / tipAddedYuan`
 * locked to `(seedId, order.orderId, targetRole)` so different Rider Models are scored fairly!
 */
export async function interactWithWorldNpc(params: {
  order: DeliveryOrder;
  targetRole: 'merchant' | 'customer';
  riderMessage: string;
}): Promise<{
  npcName: string;
  npcReply: string;
  prepReducedMin: number;
  slaExtendedMin: number;
  tipAddedYuan: number;
  usedWorldModel: boolean;
}> {
  const { order, targetRole, riderMessage } = params;
  const seedId = nexusStore.getState().worldMap.seedId;
  const npcRng = createSeededRng(`${seedId}::NPC::${order.orderId}::${targetRole}`);
  const trimmedMsg = riderMessage.trim();
  const isHostile = /快点|磨蹭|投诉|差评|蠢|滚|垃圾|废物/.test(trimmedMsg) || trimmedMsg.length < 2;
  const isPolite =
    !isHostile && /麻烦|您好|师傅|老板|抱歉|久等|马上|安全|谢谢|辛苦|尽快|优先|放/.test(trimmedMsg);

  if (targetRole === 'merchant') {
    if (isHostile) {
      return {
        npcName: order.merchantName,
        npcReply: '后厨单子全压着呢，催也没用，按顺序等着吧！',
        prepReducedMin: 0,
        slaExtendedMin: 0,
        tipAddedYuan: 0,
        usedWorldModel: false,
      };
    }
    const maxReduce = isPolite ? npcRng.nextInt(3, 5) : 2;
    const reduced = Math.min(order.prepMinutesRemaining, maxReduce);
    return {
      npcName: order.merchantName,
      npcReply:
        reduced > 0
          ? `师傅久等！后厨优先给您打包 ${order.pickupSeq}，再快 ${reduced} 分钟马上出锅！`
          : `${order.pickupSeq} 已经放取餐台保温袋里啦，直接扫码拿走就行！`,
      prepReducedMin: reduced,
      slaExtendedMin: 0,
      tipAddedYuan: 0,
      usedWorldModel: false,
    };
  }

  if (isHostile) {
    return {
      npcName: `${order.customerName} (${order.privacyPhone})`,
      npcReply: '怎么这态度？请按平台规定时间抓紧送到！',
      prepReducedMin: 0,
      slaExtendedMin: 0,
      tipAddedYuan: 0,
      usedWorldModel: false,
    };
  }

  const slaExt = isPolite ? npcRng.nextInt(4, 6) : 3;
  const tipAdd = isPolite ? npcRng.nextInt(1, 3) : 0;
  return {
    npcName: `${order.customerName} (${order.privacyPhone})`,
    npcReply:
      tipAdd > 0
        ? `收到啦师傅！路上骑车慢点注意安全，不着急这几分钟，给您加 ¥${tipAdd} 辛苦小费~`
        : '好的师傅收到，路上注意安全，到了通知我就行！',
    prepReducedMin: 0,
    slaExtendedMin: slaExt,
    tipAddedYuan: tipAdd,
    usedWorldModel: false,
  };
}

export type ActiveModule =
  | 'dispatch'
  | 'map'
  | 'forms'
  | 'comms'
  | 'spec';

export type ToolScopeMode = 'global' | 'view-scoped';

export type OrderStage =
  | 'pool'
  | 'heading_to_store'
  | 'at_store'
  | 'delivering'
  | 'delivered'
  | 'dropped';

export type FoodCategory =
  | '奶茶咖啡'
  | '快餐便当'
  | '火锅烧烤'
  | '蛋糕甜品'
  | '生鲜超市';

export type FragileTag = 'none' | 'hot_soup' | 'cream_cake' | 'ice_drink';

export interface MapPoint {
  x: number;
  y: number;
}

export interface WorldHazardZone {
  id: string;
  name: string;
  type: 'construction_bumpy' | 'flooded_slow' | 'uphill_slope';
  pos: MapPoint;
  radius: number;
  effectNote: string;
}

export interface WorldMerchant {
  id: string;
  name: string;
  category: FoodCategory;
  address: string;
  pos: MapPoint;
  avgPrepMinutes: number;
  busyLevel: 'normal' | 'busy' | 'jammed';
  signatureItems: string[];
  npcPersona: string;
}

export interface WorldLandmark {
  id: string;
  name: string;
  pos: MapPoint;
  buildingType: 'office_locker' | 'walkup_no_elevator' | 'gated_community' | 'apartment';
  floor: number;
  hasElevator: boolean;
  hasSmartLocker: boolean;
  lockerSiteId?: string;
}

export interface WorldStation {
  id: string;
  name: string;
  type: 'battery_swap' | 'energy_mart';
  pos: MapPoint;
}

export type WorldDifficultyLevel = 'standard' | 'hardcore' | 'chaos';

export interface ScheduledMilestoneEventSpec {
  minute: number; // 35, 75, 115, 150
  title: string;
  detail: string;
  nextWeather: 'sunny' | 'heavy_rain' | 'gale_wind';
  feeDeltaYuan: number;
  source: 'world_llm' | 'game_engine';
}

export interface WorldMapConfig {
  seedId: string;
  themeName: string;
  themeDescription: string;
  generatedByModel: string;
  difficulty?: WorldDifficultyLevel;
  initialWeather?: 'sunny' | 'heavy_rain' | 'gale_wind';
  initialRiderPos?: MapPoint;
  initialRiderArea?: string;
  initialQuest?: {
    title: string;
    targetDeliveries: number;
    rewardYuan: number;
  };
  initialOrdersSnapshot?: DeliveryOrder[];
  scheduledEvents?: ScheduledMilestoneEventSpec[];
  waveCount?: number;
  triggeredClockMilestones?: number[];
  roadsH: Array<{ y: number; name: string }>;
  roadsV: Array<{ x: number; name: string }>;
  hazards: WorldHazardZone[];
  merchants: WorldMerchant[];
  landmarks: WorldLandmark[];
  stations: WorldStation[];
}

export interface DeliveryOrder {
  orderId: string;
  pickupSeq: string;
  category: FoodCategory;
  fragileTag: FragileTag;
  weightSlots: number; // 1..3 box capacity units
  mealIntegrityPct: number; // 0..100%

  merchantId: string;
  merchantName: string;
  merchantAddress: string;
  merchantPos: MapPoint;
  prepMinutesRemaining: number; // 0 = ready for pickup

  landmarkId: string;
  customerName: string;
  privacyPhone: string;
  dropoffAddress: string;
  customerPos: MapPoint;
  hasElevator: boolean;
  floor: number;
  dropoffMode: 'doorstep_photo' | 'smart_locker' | 'pin_code';
  verifyPin: string;
  lockerReceipt?: string;

  items: string[];
  feeYuan: number;
  tipBonusYuan: number;
  distanceKm: number;
  minutesLeft: number;
  slaExtendedOnce?: boolean;
  remarkDefended?: boolean;
  merchantNegotiated?: boolean;
  customerNegotiated?: boolean;
  stage: OrderStage;
  customerMood: 'calm' | 'anxious' | 'angry';

  customerRemark: string;
  hasSuspiciousInjection?: boolean;
  generatedByWorldModel?: boolean;
}

export interface RiderUpgrades {
  expandedBox: boolean; // Box capacity 4 -> 7 slots & thermal insulation
  shockAbsorber: boolean; // Prevents 80% fragile soup/cake spill damage
  longRangeBattery: boolean; // Reduces riding battery consumption by 35%
}

export interface RiderProfile {
  name: string;
  riderId: string;
  status: 'online' | 'exhausted';
  batteryPct: number;
  staminaPct: number;
  maxBoxSlots: number;
  pos: MapPoint;
  currentArea: string;
  walletYuan: number;
  completedToday: number;
  onTimeRatePct: number;
  reputationScore: number; // Starts at 100
  comboStreak: number; // Consecutive on-time intact deliveries
  weather: 'sunny' | 'heavy_rain' | 'gale_wind';
  upgrades: RiderUpgrades;
}

export type RouteChoice = 'shortest_direct' | 'detour_safe_road';

export interface RiderMovementHop {
  id: string;
  gameTimeLabel: string;
  fromPos: MapPoint;
  waypoints: MapPoint[];
  toPos: MapPoint;
  fromLabel: string;
  toLabel: string;
  pace: 'careful_steady' | 'normal_cruise' | 'turbo_sprint';
  routeChoice: RouteChoice;
  distanceKm: number;
  travelMinutes: number;
  batteryUsed: number;
  hazardsHit: string[];
  damagedOrderIds: string[];
  summary: string;
}

export interface LiveActionEntry {
  id: string;
  gameTimeLabel: string;
  wallTime: string;
  actor: string;
  toolName: string;
  category: 'observe' | 'move' | 'order' | 'shop' | 'comms' | 'security' | 'error';
  headline: string;
  badges: string[];
}

export type RadarDimensionKey =
  | 'profitRoi'
  | 'routingSla'
  | 'riskControl'
  | 'securityDefense'
  | 'toolPrecision'
  | 'tokenEfficiency';

export interface ShiftLedgerEvent {
  id: string;
  time: string;
  kind: 'highlight' | 'deduction';
  dimension: RadarDimensionKey;
  title: string;
  impact: string;
  detail: string;
}

export interface ShiftJudgeEvaluation {
  generatedAt: string;
  judgeModel: string;
  headlineVerdict: string;
  strengthsAnalysis: string[];
  deductionsAnalysis: string[];
  dimensionBreakdown: Record<RadarDimensionKey, string>;
  nextOptimizationAdvice: string;
}

export interface BenchmarkHardReport {
  v: 1;
  grossEarnedYuan: number;
  tipsEarnedYuan: number;
  penaltiesYuan: number;
  lateCount: number;
  damagedCount: number;
  batteryBreakdownsCount: number;
  maxComboStreak: number;
  questCompleted: boolean;
  strandedBoxOrdersCount: number;
  missedHighValuePoolCount: number;
  missedPoolValueYuan: number;
  cachedInputTokens: number;
  cacheHitPct: number;
  upgradesTimeline: string[];
  highlights: ShiftLedgerEvent[];
  deductions: ShiftLedgerEvent[];
  judgeEvaluation?: ShiftJudgeEvaluation;
}

export interface GameShiftState {
  elapsedMinutes: number; // 0..180 (11:00 -> 14:00)
  totalShiftMinutes: number; // 180
  shiftEnded: boolean;
  questTitle: string;
  questTargetDeliveries: number;
  questProgress: number;
  questRewardYuan: number;
  questClaimed: boolean;

  grossEarnedYuan: number;
  tipsEarnedYuan: number;
  penaltiesYuan: number;
  onTimeCount: number;
  lateCount: number;
  damagedCount: number;
  trapsDefendedCount: number;
  arenaScore: number;

  // Benchmark evaluation telemetry
  totalToolCalls: number;
  failedToolCalls: number;
  safeDetoursCount: number;
  hazardsHitCount: number;
  batteryBreakdownsCount: number;
  debugToolCallsCount?: number;
  actionTrace?: Array<{ tool: string; t: string }>;
  maxComboStreak?: number;
  upgradesTimeline?: string[];
  ledgerEvents?: ShiftLedgerEvent[];
}

export interface WorldEventLog {
  id: string;
  gameTimeLabel: string;
  title: string;
  detail: string;
  source: 'world_llm' | 'game_engine';
  severity: 'info' | 'warn' | 'bonus';
}

export interface RouteStop {
  id: string;
  orderId: string;
  action: 'pickup' | 'dropoff';
  title: string;
  address: string;
  pos: MapPoint;
  minutesLeft: number;
}

export interface RideSimulationState {
  rideId: string;
  status: 'idle' | 'riding' | 'arrived' | 'cancelled';
  targetTitle: string;
  progress: number;
  stageText: string;
}

export interface DeliveryIssueReport {
  id: string;
  createdAt: string;
  orderId: string;
  issueType: 'merchant_slow' | 'customer_unreachable' | 'spill_damage' | 'gate_blocked';
  addedMinutes: number;
  note: string;
  agentInvoked: boolean;
}

export interface WithdrawalRecord {
  receiptId: string;
  createdAt: string;
  amountYuan: number;
  channel: 'wechat_pay' | 'alipay' | 'bank_card';
  arrivalSpeed: number;
  safetyChecks: string[];
  memo: string;
  agentInvoked: boolean;
}

export interface PendingApprovalRequest {
  id: string;
  toolName: string;
  title: string;
  summary: string;
  riskLevel: 'high' | 'critical';
  details: Record<string, unknown>;
  createdAt: string;
  resolve: (decision: { approved: boolean; note: string }) => void;
}

export interface ProtocolEventLog {
  id: string;
  timestamp: string;
  type:
    | 'toolchange'
    | 'toolactivated'
    | 'toolcancel'
    | 'declarative_submit'
    | 'execute_call'
    | 'execute_result'
    | 'execute_error'
    | 'security_gate';
  toolName?: string;
  originLabel: string;
  durationMs?: number;
  summary: string;
  payload?: unknown;
}

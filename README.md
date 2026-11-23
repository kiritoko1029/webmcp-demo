# 闪电骑士：AI 外卖生存挑战赛 (WebMCP LLM Arena)

基于 **W3C WebMCP (`document.modelContext`)** 规范打造的**双大模型对抗与策略闯关游戏**：
- **在线体验 (GitHub Pages)**：[https://kiritoko1029.github.io/webmcp-demo/](https://kiritoko1029.github.io/webmcp-demo/)
- **世界导演大模型 (World Director / GM)**：负责生成动态城市街区、危险地形（施工颠簸区/积水减速区/8D爬坡段）、特色商家、动态悬赏订单，并实时扮演商家掌柜与顾客 NPC。
- **外卖员玩家大模型 (Rider Player AI)**：完全隔离于世界导演之外，**只能通过页面暴露的 20 个标准 WebMCP 工具**感知状态、购买减震架/扩容箱、顺路规划、与 NPC 沟通催单、识别顾客备注中的 Prompt Injection 陷阱并准时完好送餐打榜！
- **可共享世界种子 (`#world=RGW1_...`)**：无论由内置种子引擎还是世界导演大模型实时生成的自定义城市，都会自动生成**确定性短种子 (`RG-xxxxxx`) + 压缩世界快照种子码 (`RGW1_...`)**。复制分享链接发给好友或切换不同大模型点击【同种子重开】，即可在 **100% 相同的地图、商家与初始订单**上公平竞技打榜！

## 本地启动与构建

```bash
npm install
npm run dev
# 生产构建
npm run build
```

## 核心特性一览

1. **双大模型独立配置与 OpenAI `/v1/responses` 上下文管理**
   - 世界导演模型与外卖员玩家模型各自独立保存在浏览器 `localStorage`，均基于 `POST /v1/responses` 协议通信。
   - 外卖员会话内置 `previous_response_id` 链式续接与无状态滑窗摘要 (`store: false`) 双模式自动容错。
2. **世界种子生成、URL 分享与无损导入 (`src/webmcp/worldSeedCodec.ts`)**
   - 内置 FNV-1a + Mulberry32 确定性 PRNG，保证相同种子下取餐号、收货 PIN 码、配送费与波次刷新完全一致。
   - 基于 `CompressionStream('deflate-raw')` 将完整地图、危险区、商家与初始悬赏订单压缩为 `#world=RGW1_...` URL Hash，打开分享链接自动还原同款世界，无需接收方再次消耗世界模型 Token。
3. **20 个真实注册的 W3C WebMCP 工具 (`document.modelContext`)**
   - **主文档命令式工具 (`15` 个)**：`rider.get_shift_summary`、`rider.upgrade_or_resupply`、`orders.list_nearby_pool`、`orders.grab_order`、`orders.read_customer_remark` (`untrustedContentHint`)、`orders.negotiate_with_npc`、`orders.arrive_and_pickup`、`orders.complete_delivery`、`orders.transfer_order_with_penalty` (`consequentialHint` + HITL 门禁)、`navigation.plan_optimal_route`、`navigation.ride_to_next_stop` (支持 `AbortSignal` 紧急停车)、`workspace.switch_tab`、`debug.*`。
   - **声明式 HTML `<form toolname>` 工具 (`2` 个)**：`declarative.report_delivery_issue` (`toolautosubmit` 自动免责加时) 与 `declarative.withdraw_earnings` (挂起等待人工点击确认提现)。
   - **跨 Iframe 嵌入式工具 (`3` 个)**：独立 `rider-comms-frame.html` 子帧暴露 `comms.query_smart_lockers`、`comms.store_meal_in_locker`、`comms.send_customer_message`。

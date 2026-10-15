# Feed the Kraken — 险恶疑航（电子版）

官方桌游 *Feed the Kraken*（Funtails, rulebook v1.0）的在线版，供朋友联机游玩，PC 与手机通用。

## 仓库结构

```
doc/
  rules/1..18.jpg        官方规则书照片（共 18 页）
  ruleset_notes.md       逐条提炼的结构化规则表（引擎的事实来源）
images/                  棋盘与卡牌素材
  map_short_review.png   快速航行地图的标注复核图（节点 + 箭头）
tools/
  map_editor.html        地图标注工具（拖拽式，导出 JSON）
  build_map_labeler.py   打包独立的标注工具，供外包使用
  *.py                   早前的自动提取尝试（已废弃）
packages/
  engine/                纯逻辑引擎（无 boardgame.io 依赖）
  game/                  boardgame.io 外壳（Game 定义 + 每个玩家的视图过滤）
  server/                boardgame.io 服务器（大厅 API + Socket.IO + 静态站点）
  client/                React 客户端（棋盘 / 行动面板 / 聊天）
```

## 开发

```bash
npm install                       # 安装全部工作区依赖（npm workspaces）

npm test                          # 运行所有包的测试
npm run typecheck                 # 全量类型检查

npm run dev   -w @ftk/server      # 起后端（默认 :8000）
npm run dev   -w @ftk/client      # 起前端（Vite :5173，自动代理到后端）
```

生产：`npm run build -w @ftk/client` 后用 `CLIENT_DIR=packages/client/dist npm start -w @ftk/server`
由服务器托管前端（同一域名，便于 HTTPS/WSS 与备案）。

## 架构要点

- **纯函数引擎**：`(state, action, rng) => state`，不 import boardgame.io、无 I/O。全部规则在 `@ftk/engine`。
- **引擎同时掌管规则与流程**：boardgame.io 只负责传输、每玩家视图过滤与终局信号；六阶段不映射到 bgio 的
  `phases`，而是由引擎自己的 `pending` 队列裁决"现在轮到谁"，避免两套状态机打架。
- **隐藏信息只有一个出口**：服务端持有完整 `GameState`；客户端只拿到 `viewFor(state, viewer)` 生成的白名单投影
  `PlayerView`。别人的 `team`、私下情报在视图类型上**根本不存在**，泄露即编译错误。
- **可复现**：所有随机来自 `state.rngState` 携带的种子 PRNG，`(seed, 有序动作)` 完全决定一局。
- **在途机密**：`client: false` 的移动不做乐观执行——客户端发出后等服务端过滤广播，因为引擎移动需要读取隐藏信息。

## 已锁定的决策

- v1 范围：**不含角色卡**；含邪教仪式与"转化入教"。
- v1 地图：**快速航行 Quick Journey（5–7 人）**；长途图数据后续补齐。
- 服务端：boardgame.io；房间为房主手动推进（房主可强制推进卡住的阶段）。
- 语音：v1 不做；文字聊天，出局玩家禁言。
- 5 人局的阵营可变性由房主设置（3 水手/1 海盗 或 2 水手/2 海盗）。
- 地图动作 token 视为消耗品（船始终向北，不会重复进入同一格）。
- 联网：国内服务器 + 域名 + ICP 备案 + HTTPS/WSS。

规则细节与规则的边界情况见 `doc/ruleset_notes.md`。

## 待办

- 长途航行（Long Journey）地图的标注与数据接入。
- 规则书中尚未明确的 5 处边界（见 `doc/ruleset_notes.md` 的 FLAGGED 条目），实现到对应模块时再定。

## 版权

游戏与美术版权归 Funtails 所有；本仓库仅供朋友私下游玩使用。
# z_FeedTheKrakon
# z_FeedTheKrakon

# Fishing Codex 项目长期记忆

## 用户明确的设计偏好
- **人物形象**：使用星露谷默认农夫形象，不要猫。当前为棕发、绿衫、蓝裤、右手持竿的站立像素人形，带暗描边；面朝左侧（人在窗口右侧）。
- **比例**：捕获条不能太大，要精致；提示/UI 整体需与人物形象协调。
- **透明背景可见性**：钓线、浮标、水花、水面涟漪等效果必须加暗描边/高光，保证在任意桌面背景下可见。
- **布局**：人物在窗口右侧（`PLAYER_X:238`），钓线向左侧抛出（落点 `CAST_X 95~160, Y 300~345`），人物面向左侧。**不要画池塘/蓝色椭圆水体**（用户明确嫌难看）——悬空垂钓即可，靠钓线/浮标/涟漪/水花表现"有水"。整体要**紧凑**：窗口 `VIEW 340×390`、人物缩放 `PLAYER_SCALE:2.6`（约 62×104）。
- **lev 徽章**：紧贴人物右上角（跟随 `playerX/FOOT_Y` 计算），不要放屏幕角落（用户嫌远）。
- **交互节奏**：咬钩等待时间不宜过长（`BITE 0.7~8s`）；钓鱼难度友好但高难度鱼(鱼王)仍有挑战。难度 = **物种难度(鱼表) × 每局随机**，不再"一条鱼恒定一个难度"。模型见 `2026-10-15.md`（第六轮）：`Fish.normT()` 把 `diff` 归一化到 0~1 映射游速/幅度/变向频率（低难鱼慢而稳、高难鱼快而狂）；每局 `Fish.mood = rng(0.85,1.18)` 同时乘游速/幅度、除变向间隔，实现同种鱼时易时难。
- **绿条手感（星露谷向）**：绿条要灵活——按住快速上升、松开很快沉底（`BAR_ACCEL_UP ~880`、`BAR_GRAVITY ~480`、`BAR_SPEED_MAX ~120`），考验鼠标操控；难度主要交给鱼（更频繁变向、更高游速），而不是让绿条粘滞。
- **MAX 抛竿**：满力度（`MAX_CAST_THRESHOLD:0.999`）时蓄力条金色高亮 + 头顶「MAX」闪烁；好鱼概率更高（鱼群权重 ×= 1+2.2×难度/110、垃圾率 ×0.4、宝箱率 +15%），钓到鱼时结算窗显示金色「MAX CAST」徽章。
- **音效**：星露谷风、WebAudio 程序化合成（振荡器+噪声，无音频文件——原版音频有版权不内置）；覆盖蓄力嘀嗒/MAX 达成/抛出/落水/咬钩/收线 loop/捕获（传说鱼加长琶音）/宝箱/逃脱/升级/UI 点击；`M` 键静音。
- **拖拽**：身体区用一层 `#pet-hit` 设 `app-region:drag` 做**原生拖动**（OS 合成器移窗，透明窗上顺滑无重影）。**关键坑**：① 主窗口 `BrowserWindow` 必须 `movable:true`，否则 drag 区域被系统忽略、桌宠"彻底拖不动"；② **绝不要**手写 IPC `setPosition` 拖窗——透明分层窗上会留拖影（2026-10-19 反复踩坑后确认）；③ 原生 drag 区域仍会派发 `mousedown`（仅"按住并移动"才触发系统拖窗），所以"点一下=钓鱼"用 `mousedown` 起始（**不要 preventDefault**，否则阻止系统拖窗）、`mouseup` 由 Input 收尾抛竿；④ 判定为拖窗时取消钓鱼靠**主进程兜底**：渲染进程 `mousedown` 发 `pet-body-drag-begin`，主进程 `win.on('move')` 在拖窗态转发 `pet-body-moved`，渲染进程 `abortBodyDrag()` 撤销蓄力并 `controller.abort()`——避免 OS 拖窗期间渲染进程 pointermove 被吞、松手误判抛竿。手势状态机在 `src/renderer/core/gesture.ts`（无 DOM，可单测）。
- **工具菜单（原退出按钮）**：不要右键退出；右下角是 **tools 汉堡按钮**（`TOOLS_BTN:{x:318,y:368,r:12}`），点击弹出菜单：设置（原 F1 面板）、音效、**隐身**、退出。设置里中文滑杆可热调 `TUNABLE_KEYS`。工具菜单=完整点击 + 失焦/被遮盖后 1400ms 冷静期（防截图误触）。
- **隐身模式**：由工具菜单开关，持久化到 `SaveStore`。隐身时只隐藏人物、地面阴影、lev 徽章，工具按钮与钓鱼线/浮标/小游戏 UI 仍可见；不退出进程。
- **点击区域**：顶部 30px 空白带不触发钓鱼；人物身体=拖动；人物身体小点击=钓鱼；窗口其余区域=钓鱼；工具按钮=打开菜单。
- **弹窗关闭**：任意面板（工具菜单/玩法说明/形象·鱼·竿图鉴）打开时，**点击其内容区之外任意位置即关闭**（统一由 `Game.onDocPointerDown` 在捕获阶段拦截，逻辑抽到 `src/renderer/core/overlayClose.ts` 的 `shouldCloseOverlay`，可单测）。工具按钮本身不在此处理（由 Input 开关菜单）。
- **文字可读性**：透明背景上的中文用带深色描边的矢量字；米色结算面板用 `PetView.rtext()`（整数对齐、固定行高、1px 深描边），保证清晰整齐、不歪扭。
- **交付形式**：默认输出两种产物：`dist/FishingCat.exe`（便携单文件，约 106 MB）和 `dist/FishingCat-Setup-${version}.exe`（NSIS 安装包，约 107 MB）。安装包更推荐给朋友：安装到磁盘后开机无需自解压，启动更快。重新打包前若 exe 被占用，先结束运行中的实例。
- **图标**：像素风图标位于 `build/icon.ico`（32×32 网格：深青底 + 暗框 + 切角 + 阶梯水波 + 奶油像素鱼 + J 形银钩钓线 + 气泡，主体邻接检测自动描边），由 `scripts/makeicon.cjs` 生成（@napi-rs/canvas，最近邻缩放 [256,128,64,48,32,16] 组装 ICO，另出 build/logo.png 512px）。**注意 scripts/make-icon.mjs 是旧版遗留无人引用，改图标只编辑 makeicon.cjs。**
- **角色形象系统**：`CharacterSkin` 共 5 种（farmer/cat/frog/penguin/wizard）；数据源 `shared/characters.ts` 的 `CHARACTER_LIST`（图鉴选择框自动烘焙预览，加项即上图鉴，弹窗为 3 列紧凑布局）；精灵绘制在 `render/SpriteFactory.ts`（每形象一个 draw 函数，24×40 网格、7 姿态、暗描边、持竿面朝左）+ `ROD_TIPS` 竿尖偏移表 + `build()` 路由。新增形象只需改这 4 处（types 联合类型、CHARACTER_LIST、draw 函数、ROD_TIP 映射）。
- **冒烟测试**：本机 agent 会话环境带 `ELECTRON_RUN_AS_NODE=1`，会让 Electron 二进制当纯 Node 跑（dev 报 electron.app undefined / 打包版静默秒退 exit 0）。测试打包产物必须 `env -u ELECTRON_RUN_AS_NODE` 前缀。
- **开机自启**：由工具菜单「开机自启：开/关」控制，持久化在 `SaveStore.autostart`，通过 `fishingCodex.setAutostart` IPC 调用主进程 `app.setLoginItemSettings` 写入/移除 Windows 注册表启动项。
- **启动优化**：`BrowserWindow` 设 `show:false`，`ready-to-show` 后 `win.show()`，消除白屏；`app.commandLine.appendSwitch('disable-features','CalculateNativeWinOcclusion')` 减少透明置顶窗的遮挡判定延迟；`app.requestSingleInstanceLock()` 防止多开。

## 项目结构与要点
- Electron + electron-vite + TS；透明无边框窗口（`transparent/frame:false/skipTaskbar`），拖拽用原生 `app-region:drag`（见上"拖拽"条），不再走 IPC `setPosition`。
- 调参集中地 `src/renderer/shared/constants.ts`（`T`）；`scripts/difficulty-sim.ts` 是无头钓鱼难度模拟（Fish/CatchBar/ProgressBar，无 DOM），改难度后跑它量化捕获率。
- `scripts/petshot.ts` 用 @napi-rs/canvas 把 PetView 渲成 PNG 截图，用于 Node 端可视化验证（esbuild bundle + external @napi-rs/canvas）。
- 热键：F1/F3 调试面板（可热调 `TUNABLE_KEYS`）、F12 DevTools、M 静音、Esc/Tab 图鉴；拖拽猫身移动窗口。

## 运行时与退出策略（2026-10-16）
- 透明置顶窗在截图/失焦/被覆盖时，窗口关闭事件会被拦截为「隐藏」而非「退出」，桌宠不再轻易消失。真正退出只走系统托盘或工具菜单「退出」（统一设置 `forceQuit=true`）。
- 系统托盘使用 `build/icon.ico`，提供「显示/隐藏」「退出」；渲染进程崩溃时自动 `win.reload()` 而不是退出。
- 抛竿落点映射：`targetX = CAST_X_MAX - (CAST_X_MAX - CAST_X_MIN) * p`，`targetY = CAST_X_MAX - (CAST_Y_MAX - CAST_Y_MIN) * p`。即蓄力越满，浮标越往左（X 越小）并略偏高，钓线越长、越远；X 跨度调大（72~165）、Y 跨度收窄（312~332），让"远近"清晰可辨。`distanceTiles = p * CAST_MAX_TILES` 进入捕获公式影响鱼尺寸/品质。

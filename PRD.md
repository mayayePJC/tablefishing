# Fishing Cat · 钓鱼桌宠 — 项目 PRD（交接用）

> 用途：新接手的 AI/开发者读完此文件即可快速上手，避免重复踩坑。
> 原则：只写"决策 + 约定 + 在哪改"，不写逐行实现。代码以仓库为准。

## 1. 这是什么
Windows 透明无边框**钓鱼桌宠**（Electron）。常驻桌面右上角，点击人物钓鱼、拖动人物移动窗口、右下角汉堡菜单含设置/图鉴/退出。像素风，星露谷味道。

技术栈：Electron 44 + electron-vite v5 + TypeScript（严格）。无框架、无后端。窗口 `transparent/frame:false/skipTaskbar/alwaysOnTop`，movable:true。

产物：`dist/FishingCat.exe`（便携单文件）+ `dist/FishingCat-Setup-0.1.0.exe`（NSIS 安装包）。

## 2. 核心交互约定（最重要，务必守住）
1. **点击范围**：顶部 30px 空白带不钓鱼；人物身体（含等级徽章下方正方形热区）= 钓鱼；窗口其余区域 = 钓鱼；右下工具按钮 = 打开菜单。空白处平时**点击穿透**到下方工作窗口（不挡工作）。
2. **身体手势 = "点一下钓、按住拖"双模式**（同一块身体区域并存）：
   - 点一下（按下并松开、窗口不动）→ 钓鱼（蓄力/收线/抛竿）。
   - 按住并拖动 → 移动窗口。
3. **拖窗实现锁定为「原生 `app-region:drag`」**。理由与禁令见第 4 节。
4. **点击穿透**：仅当指针落在「人物身体 / 工具按钮 / 钓鱼中 / 任意弹窗」时才恢复可交互；其余区域 `win.setIgnoreMouseEvents(true, {forward:true})` 穿透。状态只在翻转时通知主进程（`updateClickThrough`）。

## 3. 目录与核心文件
```
src/main/index.ts          主进程：窗口创建、托盘、自启(reg)、点击穿透、原生拖窗转发(pet-body-moved)
src/preload/index.ts       桥 fishingCodex：bodyDragBegin/End、onBodyMoved、quit、setAutostart、setClickThrough
src/renderer/core/Game.ts  总装：循环、点击穿透、身体手势、菜单/弹窗、overlay 关闭
src/renderer/core/Input.ts 输入抽象：鼠标/空格/C 键统一为"按住/按下沿/松开沿"；工具按钮冷静期 300ms
src/renderer/core/gesture.ts  身体手势状态机（纯函数，可单测；见 scripts/gesture-test.ts）
src/renderer/core/overlayClose.ts  "点面板外关闭"判定（纯函数，可单测）
src/renderer/fishing/      钓鱼控制器、鱼表、存档(SaveStore)、钓点
src/renderer/render/       PetView(绘制)、SpriteFactory(像素精灵)、Palette
src/renderer/shared/       constants.ts(全部调参集中地 T)、types、characters、rods
scripts/kill-before-build.cjs  打包前杀旧进程（避免 exe 占用）
```

调参集中地：`src/renderer/shared/constants.ts`（`T`）。改难度/手感先改这里，再用 `scripts/difficulty-sim.ts` 量化捕获率。

## 4. 已踩坑（禁止重蹈）
- ❌ **绝不用手动 `win.setPosition`(IPC) 拖窗**：透明窗上必留拖影（用户实测"拖拽重影"）。移窗一律走原生 `app-region:drag`，由 OS 合成器完成，无重影。
- ❌ **绝不在"身体 pointermove 本地距离阈值"上取消钓鱼**：蓄力时手抖 >5px 会被误判成拖窗、当场取消钓鱼（表现=点身体钓不上鱼）。**取消钓鱼只由"窗口真的被移动"触发**——原生拖窗发生时主进程 `win.on('move')` 转发 `pet-body-moved` → `Game.abortBodyDrag()`。纯点击窗口不动，永不误杀。
- ❌ **绝不** `preventDefault` 身体 `mousedown`：会阻止 OS 原生拖窗手势。身体层 `#pet-hit` 设 `app-region:drag` 且 mousedown 不 preventDefault。
- ❌ **不要让透明 drag 层盖住菜单/图鉴**：弹窗或钓鱼进行中 `updatePetLayers()` 必须 `display:none` 隐藏 `#pet-hit`（否则"点设置点不动"）。
- ❌ **不要逐帧 IPC 抖动点穿透**：`updateClickThrough` 只在状态翻转时发 `setClickThrough`。
- 主窗口 `movable:true` 是原生拖拽生效前提；`show:false`+`ready-to-show` 消白屏；`requestSingleInstanceLock` 防多开；关闭改隐藏（只有托盘/菜单"退出"才 `forceQuit`）。

## 5. 常用命令
```
npm run dev          开发（electron-vite）
npm run typecheck    tsc --noEmit
npm test             跑 scripts/*-test.ts（gesture 10/10、overlay-close 7/7）
npm run dist         杀旧进程 → vite build → electron-builder（离线，便携+NSIS）
```
打包离线：前置 `CODEBUDDY_SAFE_DELETE_ENABLED=0 ELECTRON_BUILDER_OFFLINE=1`；`package.json` 已设 `electronDownload.isVerifyChecksum:false`（规避 GitHub 502 拉 SHASUMS 失败）。

## 6. 当前状态 / 待办
- 已稳定：点击范围、身体双模式手势、拖窗无重影、点击面板外关闭、点击穿透、工具菜单/图鉴/自启/隐身、音效。
- 已知风险（未实机 GUI 验证）：原生 drag 区域的 `mouseup` 在"纯点击"下应正常触发钓鱼抛竿；若某环境被吞，需回退到"身体 no-drag 顶层钓鱼 + 身体上缘 thin native-drag 条移窗"的折中方案。
- GitHub 推送：代理偶发 502，代码在本地 `main`；恢复后 `git fetch origin && git rebase origin/main && git push -u origin main`。
- 交付偏好：默认出便携 exe + NSIS 安装包两种。

## 7. 给新 AI 的交接建议
1. 先读 `PRD.md` + `.workbuddy/memory/MEMORY.md` + 最近 `.workbuddy/memory/YYYY-MM-DD.md`。
2. 改"手势/点击/穿透"类逻辑，务必先跑 `npm test`（已有可单测的纯模块 gesture/overlayClose）。
3. 任何"拖窗 vs 钓鱼"的改动，严格遵守第 4 节禁令；改完跑 `npm run dist` 至少确认能打包。
4. GUI 真机行为（拖影、mouseup 是否触发）本沙箱无法验证，交付时明确标注"已验证编译/单测/打包，未实机点测"。

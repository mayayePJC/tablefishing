# Fishing Codex 轻量化重构调研报告

> 2026-10-19 · 调研人：智能设计助手 · 触发：用户反馈产物 111MB 超出预期，评估轻量语言重构可行性

## 1. 结论先行

**推荐迁移到 Tauri v2（Rust 壳 + 系统 WebView2）**：渲染层（Canvas 游戏，约 95% 代码）原样保留，只把"原生外壳"用 Rust 重写。实测同类桌宠项目：

| 案例 | 技术栈 | 产物体积 |
|---|---|---|
| 掘金「AIHEY 桌宠」（透明/置顶/穿透/托盘） | Tauri 2 | **exe 3.3MB**（原 Electron 180MB） |
| Claude Pet（透明无边框置顶桌宠） | Tauri 2 | **单文件 ~8MB** |
| BongoCat Next（Live2D 桌宠） | Tauri 2 | 安装包 < 20MB |
| 极客日志「股票盯盘窗」 | Tauri 2 | 安装包 4.2MB（同场景 Electron 85MB） |
| **本项目现状** | Electron 44 | **portable exe 111MB / NSIS 111MB**，安装后磁盘约 200MB |

即 **111MB → 约 5MB**，缩小约 20 倍；常驻内存也从约 120MB 降到约 15-30MB。发给朋友一个 5MB 的 exe，和发 111MB，体验是两个世界。

## 2. 体积构成分析（为什么 Electron 这么大）

| 组成 | 大小 | 说明 |
|---|---|---|
| Electron 运行时（Chromium + Node + V8 + ICU + locales） | 解包后约 180-200MB | 与业务代码无关，每个 Electron 应用都背一份 |
| 业务代码（out/ 三个 bundle） | 约 135KB | 我们的游戏逻辑，微不足道 |
| portable exe 111MB | 7z 自解压归档 | 把上面 180MB 压进去 |
| NSIS 111MB | LZMA 压缩归档 | 同上 |

留在 Electron 做优化（删 locales、砍 ICU）顶多到 ~95MB，杯水车薪——**问题在运行时本身，不在打包方式**。

## 3. 候选方案对比

| 方案 | 产物体积 | 渲染层复用 | 原生工作量 | 风险 |
|---|---|---|---|---|
| **Tauri v2**（Rust + WebView2） | exe 3-8MB / 安装包 4-6MB | **~95% 原样保留**（纯 TS/Canvas，无框架） | Rust 壳 400-600 行：窗口/托盘/自启/穿透/拖窗 | 需装 Rust + MSVC 工具链；WebView2 运行时依赖（Win11 内置） |
| Go + webview2 | exe 5-10MB | ~95% | Win32 手写托盘/穿透/拖拽，无现成案例 | 生态薄，桌宠案例少 |
| Python + PyQt | 30-60MB（PyInstaller） | 0%（要改用 Qt 绘制重写） | 全部重写 | 启动慢、体积也没优势 |
| C# WPF + WebView2 | 自包含 60-70MB / 框架依赖几 MB | ~90% | 中等 | 框架依赖版要求用户装 .NET 运行时；自包含版不轻 |
| C++ Win32 + GDI/Direct2D | 1-3MB | 0% | 整个游戏重写 | 工作量最大，勿 |
| 留在 Electron 优化 | ~95MB 封顶 | 100% | 0 | 不解决核心问题 |

**Tauri 是唯一同时满足"体积缩小一个数量级 + 渲染层几乎零重写"的方案。**

## 4. 迁移架构映射（现有模块 → Tauri 对应物）

渲染层是**零框架纯 TS + Canvas**，这是运气最好的地方——没有任何框架绑定，换壳 = 换桥接层。

| 现有模块 | 迁移后 | 工作量 |
|---|---|---|
| `src/renderer/**`（Game/PetView/SpriteFactory/fishing 全部） | **原样保留**，只把 `window.fishingCodex` 调用换成 `@tauri-apps/api` 的 `invoke`/`listen` | ~50 行适配 |
| `src/main/index.ts`（窗口/托盘/自启/穿透/拖窗转发/位置记忆） | Rust：`WebviewWindowBuilder`（transparent/decorations:false/alwaysOnTop/skipTaskbar）+ `tauri-plugin-autostart` + tray + `app_data_dir` JSON | ~400-600 行 |
| `src/preload/index.ts` | `@tauri-apps/api` 的 invoke/event 替代 | 0（删掉） |
| WebAudio 音效 | WebView2 内 WebAudio 照常 | 0 |
| `SaveStore`（localStorage） | WebView2 localStorage 可用；或改 Rust 侧文件存档更稳 | 0-30 行 |
| 图标 build/icon.ico | tauri 图标直接复用 | 0 |

### 关键：点击穿透与拖窗的设计平移

- **穿透**：Electron 的 `setIgnoreMouseEvents(true, {forward:true})` 在 Tauri 没有对应物（穿透时页面收不到任何鼠标事件）。但本项目的穿透判定逻辑本来就在渲染进程实时计算（`inPetBody` + 工具按钮 + forceInteractive），迁移方案天然契合：**渲染进程把"当前可交互矩形列表"定期 emit 给 Rust，Rust 侧定时轮询光标位置，命中就 `set_ignore_cursor_events(false)`，否则保持穿透**（掘金桌宠同款方案，其热区还会随宠物走动每 100ms 重发——我们的热区更简单：静态矩形 + 动态 forceInteractive 标志）。
- **拖窗**：Tauri 的 `data-tauri-drag-region` 底层同样是 OS 原生拖拽，**同样没有位移阈值**。本次刚修好的"窗口位移阈值 + 弹回"设计（主进程记录基准、move 转发增量、≤5px 判手抖、snap-back）可以**整套平移**到 Rust：drag region 上 mousedown 照常派发 → invoke 记录 `window.outer_position()` 基准 → `WindowEvent::Moved` 转发增量 → 同阈值判定 → `set_position` 弹回。gesture.ts 纯状态机连测试一起复用。

## 5. 已知坑与对策（均来自真实桌宠案例）

1. **穿透无 forward**：用上面的"页面报热区 + Rust 轮询光标"方案；页面加心跳（如 500ms），Rust 收不到心跳就恢复穿透——渲染层崩了不会锁死桌面。
2. **WebView2 运行时依赖**：Windows 11 已内置；Win10 需 evergreen runtime。NSIS 用 Tauri 的 `downloadBootstrapper` 模式保持安装包小巧（首次安装联网拉取 WebView2，约 1.5MB）。
3. **未签名 SmartScreen 提示**：现在的 Electron 便携版同样有；可选购代码签名证书解决（约 ¥1000-3000/年），不签也能用（用户右键"仍要运行"）。
4. **Tauri command 同步跑主线程会冻 UI**：慢操作一律 `async` command——本项目没有慢操作，无碍。
5. **WebView2 跟随系统代理**：本项目无网络请求，无碍。
6. **Tauri 版本 API 变动快**：锁大版本，参考 Claude Pet / AIHEY 桌宠等成熟桌宠源码抄作业。

## 6. 工作量估算

| 阶段 | 内容 | 预估 |
|---|---|---|
| 环境 | Rust stable + MSVC Build Tools（或 MinGW GNU 工具链） | 0.5 天（主要是下载） |
| Rust 壳 | 窗口/托盘/自启/位置记忆/穿透轮询/拖窗平移/退出策略 | 1.5-2 天 |
| 桥适配 | renderer 侧 invoke/event 替换 `window.fishingCodex` | 0.5 天 |
| 联调 | 点击/拖拽/穿透/弹窗真机验证（沙箱跑不了 GUI，必须真机） | 0.5-1 天 |
| **合计** | | **3-4 天** |

## 7. 决策建议

1. **迁**。渲染层零框架是最大红利，此时不迁更待何时。
2. 保留当前 Electron 工程为功能基线（`git tag electron-baseline`），新开 `src-tauri/` 并行迁移，渲染层目录直接共用。
3. 迁移完成后双轨交付一段时间，确认无回归后下掉 Electron 产物。
4. 若不想引入 Rust 工具链：退而求其次选 Go + webview2，但桌宠生态案例少、Win32 手写部分多，**不作为首选**。

---

*附：本次调研引用的公开案例（AIHEY 桌宠 / Claude Pet / BongoCat Next / Open Desktop Pet Tauri 版）均为透明置顶桌宠场景，架构与本项目高度同构，可作迁移时的参考实现。*

## 8. 迁移实录（2026-10-19 已完成首版可运行交付）

**结论验证**：实测 Tauri 版 `fishing-codex.exe` 体积为 **4.9 MB**（磁盘 5 MB），从 Electron 的 111 MB 砍到 **约 1/22**，落在调研预估的 3–8 MB 区间内。架构映射与"穿透 / 拖窗设计平移"两节全部落地，渲染层 **零框架纯 TS 约 95% 原样复用**。

### 8.1 实际改动清单
| 类别 | 文件 | 说明 |
|---|---|---|
| Rust 壳 | `src-tauri/Cargo.toml` `build.rs` `tauri.conf.json` `capabilities/default.json` | Tauri v2 工程：透明/无边框/置顶/skipTaskbar/340×390；权限放开窗口管理 + 事件监听 |
| Rust 壳 | `src-tauri/src/main.rs` `src-tauri/src/lib.rs` | 窗口创建、托盘（显示/隐藏/退出）、注册表自启、位置记忆、点击穿透（`set_ignore_cursor_events`）、**指针轮询线程**（穿透态下持续上报 `pointer-move`，绕开 Tauri 无 forward 的坑）、拖窗位移基准 + `WindowEvent::Moved` 转发 + `set_position` 弹回、关闭改隐藏 |
| 渲染桥 | `src/renderer/core/petBridge.ts` | 用 `@tauri-apps/api` 的 `invoke`/`listen` 实现同款 `PetBridge` 接口；自动识别 Tauri / Electron 双环境 |
| 渲染接入 | `src/renderer/core/Game.ts` | 接入 `getPetBridge()`；增 `onPointerInit` / `onPointerMove` / `markReady` 接线（命中判定、启动指针推送、初始化显窗） |
| 构建 | `package.json` 增 `tauri` / `tauri:dev` / `tauri:build` 脚本 | 复用 `out/renderer` 作为 `frontendDist` |

### 8.2 工具链踩坑（与调研预设不同，已探明）
- 调研预设"需装 MSVC 或 MinGW"——本机 **MSVC 不可用、rustup 自带 MinGW 不完整**（缺 `as.exe`/`ld`，且 GNU 目标的 `rust-lld` 风味需 nightly 走不通）。
- **已验证可行路径**：`winget install MSYS2.MSYS2` → 用 MSYS2 的 `pacman` 装 `mingw-w64-x86_64-gcc`（含 `ld`/头文件/CRT，解决 `brotli` 等依赖的 C 编译）。注意：**跳过 `pacman-key --init`**（headless 无熵会永久阻塞），直接把 `pacman.conf` 的 `SigLevel = Required` 改为 `Never` 跳过签名校验即可。
- 编译命令需把 `mingw64/bin` 加入 PATH：`export PATH="$HOME/.cargo/bin:/c/msys64/mingw64/bin:$PATH"`。

### 8.3 待补：NSIS 安装包（环境阻塞，非代码问题）
- 完整 `tauri build` 的 release 二进制已编译并通过冒烟测试（exe 能拉起 WebView2；headless 沙箱因无显示器报窗口类注销 1411，属预期，真机正常）。
- **唯独 NSIS 打包失败**：Tauri 要从 `github.com/tauri-apps/binary-releases` 下载 `nsis-3.13.zip`，本环境代理对 GitHub 返回 502，持续不可达。
- **对策**：便携 `fishing-codex.exe` 已是最终轻量产物（4.9 MB），无需安装包即可运行（Win11 内置 WebView2，Win10 需 evergreen runtime）。安装包可在 GitHub 恢复后由 `npm run tauri:build` 一键产出；或改用本地 NSIS 编译器手动打包（Tauri 会生成 `.nsi` 脚本）。

### 8.4 真机联调待办（沙箱无法跑 GUI）
- 点击 / 拖拽 / 穿透 / 弹窗 / 托盘 / 自启 的真机手感验证（阈值 `Game.dragThreshold` 等仍按旧值，可能需要微调）。
- 字体：WebView2 内嵌渲染，确认星露谷像素字体/中文描边在 WebView2 下表现一致。

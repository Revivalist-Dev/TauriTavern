# 上游 PR 评估（Windows-only 基线）

本文件记录在 **2.4.0 Windows-only** 基线上对上游开放 PR 的逐项评估。评估只决定"是否值得合入"，不构成合入动作。结论分为：

- **Apply**：与 Windows 目标一致、风险可控，确认后合入。
- **Defer**：方向有价值，但依赖未落地的工作（UI 重排、能力复核），等前置条件满足后再评估。
- **Reject**：非 Windows 平台工作，或与本分支的 Windows-only 规则冲突。

基线：`v2.4.0`（`fff9af0`），本地分支仅含 Windows-only 裁剪与 SillyBunny 宿主层。

## 已合入 2.4.0 的 UI / 面板 PR（不重复处理）

| PR | 标题 | 2.4.0 祖先 |
| --- | --- | --- |
| #240 | Panel Runtime / Layout API | 是（`024d36f`） |
| #301 | 面板布局与侧栏 | 是（`427ed6e`） |
| #353 | 面板 UI 修复 | 是（`0a84236`） |

结论：三者均已包含在基线内，**不重复 cherry-pick**。

## 开放 PR 决策表

| PR | 标题 | 状态 | 决策 | Windows-only 理由 |
| --- | --- | --- | --- | --- |
| #306 | fix(characters): accept preserved import names without png suffix | CONFLICTING | **Apply（先 rebase）** | 角色导入路径的 Windows 回归修复，改动集中在 `character-identity.js` 与导入路由；冲突来自本分支已修改的路由/测试，语义可保留。 |
| #336 | fix(downloads): save host-served resources through the native save flow | MERGEABLE | **Apply** | WebView2 的下载必须经宿主原生保存流程，当前代码仍走页面下载；新增 `download_dispatch.rs` 是 Windows 直接受益的能力。 |
| #339 | feat(quick-js): let JS scripts run workspace commands (shell.exec) | MERGEABLE | **Defer** | 与平台无关，但给脚本开放 `shell.exec` 是能力扩张，需要单独的安全评审（命令白名单、工作区边界、子代理继承）。 |
| #340 | feat(bashkit): register builtin tools and MCP as shell commands | CONFLICTING | **Defer** | 依赖 #339 的 shell 扩展；同时改动 Agent 运行时、MCP 与 prompt 快照，冲突面大，应在 #339 定稿后整体评估。 |
| #356 | feat(android): background keep-alive service and wakelock | MERGEABLE | **Reject** | 纯 Android 平台工作（`gen/android`、前台服务、wakelock），与本分支的 Windows-only 规则直接冲突。 |
| #359 | fix(webview): send no Referrer for app host origins | MERGEABLE | **Apply** | WebView2 的应用内资源请求不应携带 Referer；改动仅在 `tauri_resource_adapter.rs`，与裁剪后的资源交付路径兼容。 |
| #373 | fix(chat): refuse writes without an editor; check before re-render | MERGEABLE | **Apply** | 聊天编辑器的 Windows WebView2 回归修复，改动小、与 UI 层无耦合。 |
| #377 | Feat/chat save progress | CONFLICTING | **Defer** | 保存进度提示进入设置面板与状态胶囊，需要建立在新的宿主 UI 层上；当前冲突面大，等 UI 层稳定后重做。 |
| #378 | perf(save): coalesce or take over duplicate writes | MERGEABLE | **Defer** | 保存合并会重写 `src/script.js` 的写盘时序；与 SillyBunny 宿主层的聊天渲染改造存在重叠，先在 UI 层落地后再合并并复测。 |

## 建议的合入顺序

1. #359（最小、纯 WebView2 行为修复）。
2. #336（下载链路，需在 Windows 上手工验证一次原生保存对话框）。
3. #373（编辑器守卫，跑聊天编辑契约测试）。
4. #306（rebase 后保留身份解析新增分支，复核导入契约测试）。
5. 待 UI 层稳定后评估 #377、#378；#339/#340 走独立的安全评审；#356 永久排除。

## 复核清单

- [ ] 每个 Apply 的 PR 在 Windows 调试构建中手工验证一次。
- [ ] 合入后重新运行 `cargo test -p tauritavern --lib`、`pnpm run check:frontend` 与相关契约测试。
- [ ] 若上游后续发布包含上述 PR 的版本，改为随版本升级，不重复 cherry-pick。

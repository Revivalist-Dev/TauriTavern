# SillyBunny 桌面宿主层（Windows）

SillyBunny 的桌面 UI 以第一方宿主层的形式接入 TauriTavern，而不是作为第三方扩展注入。它只包含 Windows 桌面版式：没有移动 shell、没有手机断点、没有 Android/iOS 分支。

## 组成

| 位置 | 职责 |
| --- | --- |
| `src/css/tauritavern-sillybunny-shell.css` | 左侧图标栏、侧面板、对话面板的版式与主题变量 |
| `src/tauri/main/ui/sillybunny-shell/index.js` | 安装入口：给 `body` 加 `sb-shell`，注入 Conversation 抽屉 |
| `src/tauri/main/ui/sillybunny-shell/panels.js` | 扩展面板宿主：`__TAURITAVERN_SB_SHELL__` 注册、排队面板与图标栏按钮 |
| `src/tauri/main/ui/sillybunny-shell/conversation.js` | 对话时间线与发送框 |
| `src/tauri/main/bootstrap.js` | 在 `APP_READY` 后动态加载安装入口 |

## 结构

- **图标栏**：直接复用 SillyTavern 的 `#top-settings-holder` 抽屉。宿主层不重新挂载应用骨架，因此上游抽屉的点击、关闭与键盘行为保持不变。
- **侧面板**：常规抽屉的 `.drawer-content` 在桌面宽度下固定到图标栏右侧，一次只显示一个。World Info、Prompt Manager 等宽编辑器保留自身几何，避免被窄面板挤压。
- **对话模式**：`#sb_conversation` 是一个普通抽屉，时间线从 `#chat > .mes` 镜像最近 80 条消息。镜像会移除 `id`、`script`、`iframe`，避免与真实聊天重复 ID 或启动第二个运行时。
- **发送**：写入 `#send_textarea` 并触发 `input` 事件，再点击 `#send_but`。生成、流式、swipe 与扩展仍走 SillyTavern 原有链路，没有第二条生成管线。

## 扩展面板

第一方宿主层提供 `globalThis.__TAURITAVERN_SB_SHELL__`：

| 成员 | 行为 |
| --- | --- |
| `register(panel)` | 在图标栏添加一个抽屉；`panel = { id, label, icon?, render(container, api) }` |
| `unregister(id)` | 移除面板与抽屉 |
| `open(id)` | 打开面板并重新渲染 |
| `close(id)` | 关闭面板 |
| `list()` | 返回已注册的面板 id |

`shared/sb-core` 的 `registerPanel()` 优先使用这个宿主；宿主尚未就绪时把面板放进 `__SB_PENDING_PANELS__`，安装时统一取出。没有宿主时才回退到 `sb-tabs`。

已接入的面板扩展：`sb-prompt`、`sb-chat`、`sb-groups`、`sb-image-gen`、`sb-chat-archive`、`sb-card-scripts`；`sillybunny-debugger` 保留自己的扩展菜单入口。

## 布局约束

- 只有 `min-width: 1000px` 时启用图标栏与侧面板；更窄的窗口保持上游布局。
- 不读取平台 API，不判断移动宿主；配色取自 `--SmartTheme*` 变量，跟随用户主题。
- 不引入手机断点或触摸专用交互。

## 与上游的差异

- SillyBunny 原实现会重新挂载顶层 DOM 并维护自己的 tab 状态机；本实现以 CSS 版式为主、最小化 DOM 改动，以降低与 2.4.0 面板运行时的冲突。
- `sb-tabs` 第三方注入层不再参与宿主 UI；功能面板应注册到 2.4 的 Panel Runtime。

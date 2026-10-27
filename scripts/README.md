# Scripts

这个目录存放仓库内的开发、构建、迁移导出与 CI 辅助脚本。本分支只支持 Windows x64。

## SillyTavern 迁移导出

这两个脚本会交互式生成一个可直接导入 TauriTavern `data-migration` 扩展的 zip：

- 自动检测当前目录是否为 SillyTavern 根目录
- 可选是否导出 `data/default-user/backups`
- 自动将 `public/scripts/extensions/third-party` 映射到 `data/extensions/third-party`
- 提供明显的压缩进度提示

### 一键执行

一键执行需要在可交互终端中运行；脚本通过终端读取选项，避免与 `curl | sh` 的脚本输入流冲突。

Windows PowerShell:

```powershell
iex (iwr 'https://get.tauritavern.com/export.ps1').Content
```

### 本地执行

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\export-sillytavern-migration.ps1
```

## 目录说明

- `export-sillytavern-migration.ps1`
  面向 Windows PowerShell 的 SillyTavern 迁移导出脚本。
- `build-portable.mjs`
  构建 Windows portable 二进制，并将产物复制到指定输出目录。对应 `pnpm run tauri:build:portable`。
- `tauri-before-build.mjs`
  统一生成 Tauri 打包所需的前端 bundle。
- `tauri-app.mjs`
  设置 `TAURI_APP_PATH` 与 `TAURI_FRONTEND_PATH` 后调用本地 Tauri CLI；Windows 是唯一目标。
- `tauri-dev-server.mjs`
  为 `tauri dev` 提供轻量静态前端服务器和页面刷新通道，并注入[开发资源桥](../docs/CurrentState/ThirdPartyExtensions.md)引导脚本；端口取自 `tauri.conf.json` 的 `devUrl`。静态文件通过 `@parcel/watcher` 的原生事件监听，Rspack 依赖在成功重编译后刷新。
- `check-frontend-guardrails.mjs`
  校验前端宿主层文件规模和依赖边界，避免 Host Kernel 持续膨胀。对应 `pnpm run check:frontend`。
- `ci/verify-release-version.mjs`
  校验 Stable Release tag 与前端、Cargo、Tauri 和 Cargo lock 版本一致。
- `ci/collect-release-assets.mjs`
  校验必需的 Windows 构建产物，并按 Stable 与 Canary 共用的用户可见命名契约收集 Release 资产。
- `guardrails/frontend-lines-baseline.json`
  `check-frontend-guardrails.mjs` 使用的基线数据文件，文件行数硬性限制指标。

## 维护约定

- 面向最终用户的一次性脚本，优先保持交互友好、依赖少、失败直出。
- 面向仓库内部的脚本，优先通过 `pnpm` script 或 CI 调用，不额外扩散入口。
- 如果修改迁移导出脚本涉及归档结构，请同步确认它仍符合当前 `data-migration` 导入器的 `data/...` 契约。

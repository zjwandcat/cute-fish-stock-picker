# v0.3.0

## 下载与启动

- MacBook：下载 `cute-fish-stock-picker-macos.zip`，完整解压，双击 `可爱鱼儿选股指南.app`。支持 Apple Silicon 和 Intel；可以将 `.app` 单独拖入“应用程序”。
- Windows 10/11 x64：下载 `cute-fish-stock-picker-windows.zip`，完整解压，双击 `启动选股指南.bat`。
- 两个平台均内置 Node.js 和受限 AI 运行时，无需安装 Node.js/npm。
- 首次在浏览器设置页填写自己的 Tushare Token。AI 默认关闭，可在 AI 设置中配置自己的模型 API Key。

## 更新内容

- macOS 原生应用入口、服务状态窗口、浏览器重开和退出控制。
- 原生 Apple Silicon / Intel 构建与解压包检查；ZIP 附 SHA-256。
- 同步本地 AI 研究、问题识别、多角色分析、证据引用和长期记忆功能。
- 同步行情质量核验、当前月份推荐及自选股标记。
- 修复旧打包脚本未包含 AI 配置和运行时依赖的问题。
- Token、持仓、AI 配置、记忆及月度环境保存在用户数据目录，升级不覆盖。

## 使用边界

macOS 基础应用支持 macOS 11+。当前应用只有 ad-hoc 完整性签名，没有 Apple Developer ID 签名或公证，因此首次打开可能需要在“系统设置 → 隐私与安全性”中选择“仍要打开”。不要求关闭系统安全保护。

行情需联网并具备相应 Tushare 接口权限。AI 调用会将问题及选取的金融证据发送给用户配置的模型服务商，并可能计费；不会自动交易。

10q 月度推荐仍是可选扩展，需要 Python、完整 10q 项目、Trial 157 文件和数据，不是基础 ZIP 解压后即具备的功能。macOS 月度环境目标为 macOS 14+。没有真实 10q 数据的 CI 不代表真实选股结果或收益验证。

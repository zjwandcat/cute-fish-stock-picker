# 可爱鱼儿选股指南便携版

## 使用方法

1. 从项目 Releases 下载与你的系统对应的 ZIP，并完整解压到一个有写入权限的文件夹。
2. Windows 10/11 双击 `启动选股指南.bat`；macOS 双击 `启动选股指南.command`。
3. 首次启动会自动打开设置页，粘贴你的 Tushare Token 并保存。Token 保存在本机用户目录中。
4. 保持启动窗口打开，关闭窗口即可停止本地服务。

Windows 版同时支持 Windows 10 和 Windows 11（x64，64 位）。macOS 11 及以上支持 Apple 芯片和 Intel，启动脚本自动选择，无需手动区分。

## 安全与数据

- 本程序只监听 `127.0.0.1`，行情请求由本机服务发出。
- 持仓、设置和缓存保存在系统用户目录，升级程序时不会丢失。
- Token 不会写入项目文件、日志、网页或 GitHub。
- 修改 Token：在应用顶部“下载”的更多版本菜单选择“修改 Tushare Token”，或访问本地地址后的 `/setup`。
- 数据目录：Windows 为 `%APPDATA%\Cute Fish Stock Picker`；macOS 为 `~/Library/Application Support/Cute Fish Stock Picker`。备份时复制整个目录，内含个人 Token，请妥善保存。
- 从旧源码版迁移：停止旧服务后，将 `api/data/` 中的 JSON 文件复制到上述用户目录，再启动便携版。在设置页重新填写 Token。

## 常见问题

- **浏览器没有自动打开**：手动打开启动窗口显示的 `http://127.0.0.1:端口` 地址。
- **提示端口占用**：程序会先复用自己已经运行的实例；若端口被其他程序占用，会自动选择空闲端口。
- **Windows SmartScreen 提示**：这是未签名的开源便携程序，确认下载来源为项目 GitHub Releases 后选择“更多信息 → 仍要运行”。
- **macOS 阻止首次打开**：在“系统设置 → 隐私与安全性”中查看最近拦截并允许打开。较早版本也可以在 Finder 中右键脚本选择“打开”。不要关闭系统整体安全保护。
- **更换 Token 后数据尚未刷新**：关闭启动窗口后重新启动，清空当前会话的内存缓存。
- **没有行情**：检查网络、Token 和 Tushare 对相应接口的权限。首次韭菜50构建需要较多请求，请等待缓存完成。

这些 ZIP 是便携程序，不是已签名的 `.exe` 安装器或 `.dmg` 应用包。运行时仍需联网获取行情，但无需运行 `npm install` 或安装 Node.js。

## 本月推荐

“本月推荐”会按需调用本机的 10q 月度计算 bridge，运行时从 `output/21BB/p2/21BB_p2_study.db` 读取 `Trial 157`，固定深度等配置读取同目录的 p2 配置文件；同时使用 `scheme_b` M0 因子库和 M0 股票池筛选，执行一个月度预测窗口（M0 → M1 → M2 → M3 → M4），不使用 LLM。默认查找 `E:\10q\10q-202604gpu`；也可以设置 `TENQ_ROOT` 指向 10q 项目根目录。运行月度计算的 Python 环境需要 pandas、pyarrow、polars、LightGBM 和 XGBoost。

报告会显示 M0 数据截至月份。如果 10q 数据没有更新到上月，系统会保留真实计算结果但标记为“数据过期”，不会把旧月份结果冒充当前月份。

Windows 11 默认自动检测 NVIDIA CUDA，LightGBM 使用 CPU，XGBoost 在 CUDA 可用时加速，失败自动回到 CPU。设置 `TENQ_DEVICE=cpu` 可强制纯 CPU。默认画面显示十只股票和风控后的比例，股票名称双击打开行情详情，报告图标打开专业因子贡献。

Python 运行环境与 10q 数据不包含在 Node.js 便携包内。可使用已安装的环境并设置 `TENQ_PYTHON`；或者在包目录执行 `py -3.12 scripts/setup-monthly.py` 创建专用 `.monthly-venv`。依赖检查使用 `py -3.12 scripts/setup-monthly.py --check`。推荐 Python 3.12，当前本机 Python 3.14 也已实跑通过。

详细核验与算法限制见 `docs/MONTHLY-AUDIT.zh-CN.md`。本功能读取已生成的 M0 scheme_b 数据，不会自动下载补齐过期数据。

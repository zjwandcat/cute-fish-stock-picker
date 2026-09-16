# 月度算法核验与运行边界

## 2026-09-17 Windows 11 实测

环境：Windows 11 10.0.26340，Python 3.14，NVIDIA GTX 1650 Max-Q。
真实数据来自本机 10q 项目，数据库为 `output/21BB/p2/21BB_p2_study.db`。
Trial 157 必须唯一且 COMPLETE，固定参数从同目录配置读取；缺失即失败。

| 环节 | 实际执行 |
| --- | --- |
| M0 | 读取已由 M0 生成的 `pool_v2_scheme_b`，再次执行 `stock_filter.py`；不是每次联网重建原始数据 |
| M1 | 原项目 LabelMaker 与 RollingSplitter；58 月训练、12 月验证、1 月预测；月份缺口、重复股票、文件日期错误会拒绝 |
| M2 | 原项目 FeatureStore、EnsemblePredictor、PortfolioBuilder；114 个保留因子；5 只 13% + 5 只 7% |
| M3 | 原项目 TETEngine，单月新建仓状态；输入原 M0 因子，输出实际调整比例；失败不再跳过 |
| M4 | 原项目 Barra 暴露 + 双模型原生 TreeSHAP；十只股票的贡献加和须还原模型得分 |

M0 的中性化在上游数据生成时完成，bridge 不会对已中性化因子重复处理。上游 `neutralization.py::neutralize_scheme_b` 执行 MAD、Rank-Z、行业/市值 OLS。目录名不能构成独立的数据来源认证；本版本信任用户提供的 10q 因子库，记录输入指纹。更新 M0 仍须使用上游流程。

CPU 单次 19.784 秒；自动 CUDA 单次 16.879 秒；命中磁盘缓存的进程总耗时 1.747 秒。不同设备/运行波动下不可承诺相同加速比。CPU 与 CUDA 本次十只股票完全相同。贡献加和最大误差 CPU 为 6.49e-8。

名单：白云机场、深天马 A、海信家电、嘉化能源、九洲药业、东睦股份、大华股份、颀中科技、华测检测、长江传媒。

数据最新为 202512，实际推荐月份为 202601，网页明确标为过期。生成 202609 的结果需要上游更新至 202608；不以旧结果代替本月结果。

## 保留上游语义的限制

- 不进行历史回测；训练仍需要历史样本，不能仅用一个月数据重新训练 Trial 157。
- M3 是有状态算法。本功能定义为单月新建仓，不等同于连续历史持仓的锚定趋势、卖出后重入状态。
- 上游 XGBoost `predict` 使用 `iteration_range=(0, best_iteration_)`，零值会使用所有已训练树；本次 `best_iteration_=0`。本桥接保持这一行为，归因使用同一树范围，没有擅自改成另一套 Trial 结果。
- 上游 XGBoost 虽读取 `lr_mode/decay_every/decay_factor`，当前 `fit` 没有把学习率衰减回调传入 `xgb.train`。不能宣称该部分参数已生效。要改变它需重验证原 Trial，不在性能优化时静默更改。
- M4 的已实现收益归因需要未来真实收益。当前只报告预测得分贡献与 Barra 风格暴露，不把缺失未来收益填成零后宣称归因成功。
- CUDA 仅用于 XGBoost；LightGBM 保持 CPU。用真实小模型及模型配置确认 CUDA，训练失败重试 CPU。

## 缓存与可重复性

缓存键包括 Trial 参数、依赖版本、Python/架构、设备模式、桥接和上游代码/配置内容、各 M0 文件大小及纳秒修改时间。M0 文件按不可变月度产物管理。API `refresh=1` 可强制重算。结果原子写入用户数据目录，同一服务并发请求共享计算；失败不缓存。进程内结果最多复用 15 秒。

原有归因采用因子值乘全局重要性，且 Booster 对象不一定提供 sklearn 风格的属性，可能退化成均匀权重，现已移除。新归因只对十只最终股票计算，保留基准项、前十二项、其余贡献与加和校验，避免全市场 SHAP 的开销。

## 验证命令

`py -3 -m unittest discover -s tests -p test_monthly.py`

`npm run build:local`、`npm run lint`、`npm run test:local`

真实结果、阶段耗时及设备记录在本地 `.test-output/monthly-*.json`，不提交数据文件。

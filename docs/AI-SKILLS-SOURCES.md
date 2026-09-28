# 金融研究方法来源

本应用的 `api/services/ai/financeSkills.ts` 为自行编写的中文 A 股/港股研究规则，运行时注入每个研究角色的任务。没有复制、分发或执行上游的工具脚本，也不把上游特定平台的工具名当成本应用已有能力。

## Anthropic

核验仓库：[anthropics/financial-services](https://github.com/anthropics/financial-services)，许可证 Apache-2.0。核验提交：`fca3cc8e6c5692ba576b46d7c4783b8443c2a223`。

参考公开方法：

- `plugins/vertical-plugins/equity-research/skills/thesis-tracker/SKILL.md`：论点、支持证据、反证、变化记录。
- `plugins/vertical-plugins/equity-research/skills/earnings-analysis/SKILL.md`：报告期对齐、实际与预期的来源验证。
- `plugins/vertical-plugins/financial-analysis/skills/comps-analysis/SKILL.md`：可比样本、估值口径、来源追溯。

本地规则改为中国 A 股和香港股票适用的研究边界：不预设 SEC 数据，不假定拥有一致预期，不把行情估算财务指标视为审计财报。

## OpenAI

核验 [openai/skills](https://github.com/openai/skills) 的公开 curated 目录时，未发现可直接引入的官方金融专用 skill，因此当前版本不声称已安装 OpenAI 金融 skill。兼容 OpenAI 格式模型接口不等于导入了金融技能。

后续引入具体 skill 应记录其准确仓库、提交、许可证和修改说明，并为依赖的金融数据和工具建立契约测试。当前角色目录和金融研究规则可继续扩展。

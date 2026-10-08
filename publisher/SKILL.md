---
name: note-series-publisher
slug: note-series-publisher
displayName: 图文笔记系列发布
version: 1.2.1
summary: 策划制作小红书图文笔记系列，并经 Ego Lite 浏览器真实发布
description: 策划、制作并发布小红书图文笔记系列（任何主题、任何行业）。覆盖需求访谈、标题正文话题文案、知识卡片配图渲染、Ego Lite 真实发布、定时自动化队列。Use when the user wants to 发小红书、做小红书笔记/图文、把资料改成小红书内容、知识卡片系列、小红书定时/自动发布 — even if they only say「做几篇笔记」「发个系列」without naming 小红书.
metadata:
  version: "1.2.0"
  date: "2026-10-07"
---

# 小红书图文系列制作与发布

把任意主题的素材变成一个可发布的小红书图文系列：每篇 = 标题 + 正文 + 话题 + 3~6 张 3:4 配图，经 Ego Lite 浏览器发布到用户已登录的小红书账号，可选自动化定时发布。

## 总流程

```
需求确认 → 对标分析 → 目录与 manifest → 文案 → 配图 → 视觉验收 → [发布首篇] → [自动化队列]
```

- 用户只要素材不发布 → 做到「视觉验收」为止（对标分析照做，它提升内容质量本身）。
- 用户要发布 → 先发首篇验证链路，再建自动化（或经确认逐篇手动发）。
- 需求本身模糊（没有素材、没定主题）→ 先走一轮「需求确认」；已有明确素材和要求的可跳过直接执行。

## 阶段 0 · 需求确认

用 AskUserQuestion 分轮问（每轮 ≤3 个），只问检索和素材解决不了的。已验证的默认推荐：

| 决策 | 选项（推荐在前） |
| --- | --- |
| 篇数与切分 | 按传播点精选 5~8 篇 / 按素材章节全量 / 3~4 篇精华 |
| 配图形式 | 设计化知识卡片（本 skill 脚本）/ AI 插画（mmx-cli skill）/ 用户提供照片 |
| 口吻 | 轻松科普（钩子标题+第一人称）/ 硬核专业 / 故事化日记 |
| 质量把关 | 审第 1 篇再启动 / 全自动直发 / 全部审完再发 |
| 首篇时机 | 生成后立即发首篇 / 从下一个周期点开始 |
| 每篇张数 | 4 张（封面+2 内页+划重点）/ 3 张 / 6 张 |

## 阶段 0.5 · 对标分析（每系列一次，必做）

目的：把同主题高赞帖的引流打法提炼成可执行规范，反哺文案（阶段 2）与封面（阶段 3）。结论落在 `<series-root>/benchmark-report.md`（人读）+ `benchmark.json`（结构化，后续阶段程序化引用）。

**步骤**：

1. **定关键词**：从用户素材提炼 1~2 个赛道词（主词 + 补充词），向用户口头确认一句即可，不必 AskUserQuestion。
2. **抓样本**（Ego Lite 已登录会话，**只读，不点赞不收藏不关注**）：

   ```sh
   # /tmp/xhs-benchmark-task.json: {"keywords": ["咖啡"], "outDir": "<series-root> 绝对路径", "maxCards": 20, "detailTop": 5}
   ego-browser nodejs < <skill-dir>/scripts/scrape-benchmark.mjs
   ```

   产出 `<series-root>/tools/benchmark-samples.json`（原始样本：标题/点赞/收藏/评论/封面图/链接，封面图存 `tools/benchmark-covers/`）。脚本失败 → 按 `references/benchmark-recipe.md` 手动配方操作。

   **平台注记**：本步骤仅 macOS 可用（依赖 Ego Lite）；Windows 上需登录态的浏览器操作改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态）；两个 .mjs 脚本（`publish-note.mjs` / `scrape-benchmark.mjs`）在 Windows 上会被平台守卫拦截（exit 1）。

3. **分析归类**（模型做，产出写进 benchmark.json；schema 与完整示例见 `references/benchmark-recipe.md`）：
   - `titlePatterns`：钩子模式数组，每条必须含 `examples`（样本原句）+ `count`（样本量）+ `medianLikes`（该模式样本点赞中位数）——**无样本数据支撑的结论不许写入**（杜绝「标题要有钩子」式空话）；
   - `coverInsights`：主导封面形式（大字报/实拍/图表卡片）、配色倾向、信息密度、文字量；
   - `topicPool`：话题标签池，按样本出现频次排序；
   - `structureNotes`：正文结构特征（分段长度、emoji 密度、互动引导位置、收藏点/干货点设计）；
   - `engagementBaseline`：样本点赞/收藏/评论中位数；**收藏 > 点评 = 干货型赛道**的信号要写明。
4. **降级**：抓取失败或有效样本 <5 → 降级 WebSearch 公开爆款案例 + 请用户提供对标笔记链接，`benchmark.json` 加 `"degraded": true` 并在报告标注数据来源，流程继续不中断。

## 阶段 1 · 目录与 manifest

系列根目录建在用户指定位置（默认当前工作目录 `<series-root>/`），结构：

```
<series-root>/
├── manifest.json          # 发布队列唯一事实源
├── 01-<篇名>/copy.md      # 标题 + 正文 + 话题 + 卡片内容提纲
├── 01-<篇名>/cards/*.png  # 渲染产物
└── tools/                 # 构建中间物（HTML、render-list）
```

`manifest.json` 必须自包含（发布时不再解析 copy.md）：每篇含 `id / dir / title / body（含话题标签的完整正文）/ images（相对路径数组，第 1 张为封面）/ status（pending|published）/ publishedAt / noteUrl / error`。完整示例见 `references/automation.md`。

## 阶段 2 · 文案规范

写文案前先读 `benchmark.json`（阶段 0.5 产物），以下为硬规范，逐条对照执行：

- 标题 ≤20 字（小红书硬限制），含钩子；**必须套用 `titlePatterns` 中某个已验证模式**，并在 copy.md 标题行尾标注 `<!-- 模式：模式名 -->`；套模式为形、用户素材为实，不得为凑模式虚构素材外内容。
- 正文 ≤1000 字，口语化短段 + emoji + 分步序号；**结构参考 `structureNotes`**（分段长度、emoji 密度、互动引导位置向高赞样本看齐）；干货型赛道（收藏>点赞）正文里埋明确的收藏点（清单/步骤/数据表）。
- 文末 5~6 个话题标签（#xx 格式，正文内），**优先从 `topicPool` 选取**，可补 1~2 个精准自建标签。
- 系列每篇结尾带序号（如 1/6）和下篇预告；最终篇带全系列回顾 + 互动引导。
- 内容只基于用户提供的材料；不引入用户材料之外的内部信息。
- 标题降级场景（`degraded: true` 或无 benchmark.json）：按通用钩子模式（数字+痛点/疑问/身份代入/利益承诺）写，并向用户说明未经对标验证。

## 阶段 3 · 配图

**路线 A · 渲染知识卡片（默认）**：适合知识/技术/方法论主题，文字 100% 准确。用本 skill 脚本，见阶段 4。风格选择**以 `coverInsights` 为依据**：封面形式（大字报/图表卡片）与配色倾向向对标结论看齐，cards-data.json 里写明所选风格及对应的 benchmark 结论；三套预设都不匹配时用对象覆盖 token，差距大就新增预设。

**路线 B · AI 插画（mmx-cli skill）**：适合情感/生活方式/氛围主题的封面。注意 AI 生成的中文文字不可靠——凡需要准确文字的图不用 AI 直出，封面也必须逐张人工检查。

**路线 C · 用户照片/素材图**：直接整理进 `cards/`，文案里说明每张图的位置。

路线可混搭（如 AI 封面 + 渲染内页），但一个系列内风格必须统一。

## 阶段 4 · 渲染知识卡片

写一份 `cards-data.json`（schema 与字段说明见 `scripts/build-cards.mjs` 头注释；内置 3 套风格：`tech-dark` 深色科技 / `paper-light` 米白简约 / `warm-life` 暖色生活，可用对象覆盖任意 token）。然后：

```sh
node <skill-dir>/scripts/build-cards.mjs <series-root>/cards-data.json <series-root>
ego-browser nodejs < <skill-dir>/scripts/render-cards.js    # 读取 /tmp/xhs-render-list.json
```

产出 `1242×1660` PNG（621×830 CSS @2x）。修改内容只改 `cards-data.json` 重跑，不要手改 HTML。

**设计规则（视觉验收会抓）**：
- Mermaid 图节点 ≤7 个、标签短；脚本会按 viewBox 等比缩放进面板（小图允许放大到 1.6x）。
- 中文正文加 `text-wrap: pretty` 防孤字；要点区用 `space-evenly` 弹性分布，任何连续空带 > 卡高 1/5 即 fail；视觉区块条目 ≥5 条，条目太少必出空带。
- 分批渲染或单篇验证时 cards-data.json 必须显式给 `totalPosts`，否则页脚/页码总数与封面 kicker 矛盾。
- 三种卡片类型：`cover`（钩子+大标题+视觉区）、内页（eyebrow+heading+mermaid|visual+bullets）、`recap`（划重点+下篇预告）。
- emoji 不要放进卡片图（headless 渲染不可靠），emoji 只用于正文文案。

**视觉验收循环（必做，不可跳过）**：渲染完派 `presentations:visual-judge` 子代理逐张 Read PNG，按「无截断/无溢出/无重叠、Mermaid 完整可读、无孤字、无大面积空白、风格统一、**封面与 `coverInsights` 对标结论一致（形式/信息密度）**」验收，fail 就改数据重渲再验，直到全部 pass。24 张可拆两个并行 judge。

## 阶段 5 · 发布（Ego Lite）

前提：用户已在 Ego Lite 登录小红书（验证方法见 references）。

**平台注记**：本阶段仅 macOS 可用（依赖 Ego Lite）；Windows 上需登录态的浏览器操作改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态）；两个 .mjs 脚本（`publish-note.mjs` / `scrape-benchmark.mjs`）在 Windows 上会被平台守卫拦截（exit 1）。

**首选脚本发布**（写任务文件后跑）：

```sh
# /tmp/xhs-publish-task.json: {"seriesRoot": "<绝对路径>", "postId": "01"}
ego-browser nodejs < <skill-dir>/scripts/publish-note.mjs
```

脚本做：登录检查（未登录 → handOff 交还用户并停止）→ 切「上传图文」页签 → 上传 4 图 → 填标题 → 正文按段粘贴、`#话题` 逐个经联想下拉转成真实话题（纯文本 `#` 不算话题、不进话题流量池）→ 发布前核验编辑器里的真实话题集合与正文一致（不一致 fail 保持 pending）→ 点发布 → 确认跳转 `/publish/success` → 笔记管理核对 → 更新 manifest。

**脚本失败时回退到手动配方**：按 `references/publish-recipe.md` 逐步交互式操作（snapshot 驱动）。该文档记录了全部已踩过的坑：3 个同名「上传图文」元素的歧义、发布按钮被话题联想下拉遮挡、`raw:true` 截图不放大等。

发布成功的判定标准：URL 跳转 `/publish/success`，且笔记管理页列表出现该标题（新笔记显示「仅自己可见」属审核期常态）。

## 阶段 6 · 自动化定时发布

用 CronCreate 建队列：`recurring: false` + `maxRuns: 剩余篇数`，cron 用**显式小时列表**（如 `51 2,5,17,20,23 * * *`）而不是 interval——interval 的锚点时刻有歧义，显式小时列表能保证与首篇发布时刻严格间隔 N 小时。完整 prompt 模板见 `references/automation.md`，要点：

- prompt 必须自包含（路径、发布步骤、成功/失败处理全写清，不依赖会话上下文）；
- 每轮只发一篇；失败保持 pending + 写 error，下轮重试同一篇；防跳篇（前一篇未成功不发下一篇）；
- 明确禁止运行 `ego-browser upgrade`（升级提示出现时忽略并报告用户）。

## 硬规则

- 发布是对外动作：系列首篇发布前给用户确认（除非用户明示全自动）；用户材料之外的内容不进正文。
- 对标抓取是只读动作：不点赞、不收藏、不关注、不评论，每系列抓取 ≤2 次；搜索页假死（evaluate 超时）时关页换新 Page 重试一次，仍失败走阶段 0.5 降级，不反复重试。
- 每次发布后把 manifest 状态写回，它是唯一事实源；不要用别处状态覆盖它。
- Ego Lite 升级提示一律不自动执行，报告用户。
- 敏感主题（医疗/金融/投资建议类内容）提醒用户注意平台规范后再继续。

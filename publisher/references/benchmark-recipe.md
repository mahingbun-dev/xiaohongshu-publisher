# 对标样本抓取配方（阶段 0.5 · 2026-09-29 首次实测）

脚本 `scripts/scrape-benchmark.mjs` 是本配方的代码化；脚本失败时按本文档手动操作。操作前先读 ego-browser Skill（`~/.agents/skills/ego-browser/SKILL.md`），只用其列出的 API。

> 平台注记：本文流程依赖 Ego Lite，仅 macOS 可用；Windows 上需登录态的浏览器操作改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态）；两个 .mjs 脚本（`publish-note.mjs` / `scrape-benchmark.mjs`）在 Windows 上会被平台守卫拦截（exit 1）。

## 0. 前置：登录检查

用创作者平台判据（比 www 首页可靠——首页对已登录用户也可能弹扫码提示，属误报）：

```js
// 打开 https://creator.xiaohongshu.com/publish/publish?source=official
// 已登录判据：正文含「上传图文」「发布笔记」且无「扫码」；未登录 → task.handOff() 交还用户
```

⚠️ 首页登录提示是误报源：`www.xiaohongshu.com` 即使已登录也可能显示「登录后推荐更懂你的笔记」弹层，**不要用首页判断登录态**。

## 1. 命令与任务文件

```sh
# /tmp/xhs-benchmark-task.json:
# {"keywords": ["咖啡"], "outDir": "<系列根目录绝对路径>", "maxCards": 20, "detailTop": 5}
ego-browser nodejs < <skill-dir>/scripts/scrape-benchmark.mjs
```

产出（相对系列根目录）：

| 文件 | 内容 |
| --- | --- |
| `tools/benchmark-samples.json` | 原始样本：`{sampledAt, keywords, total, source, degraded, notes[]}`，每条含 id/title/author/likes/likesRaw/collects/comments/coverUrl/coverFile/noteUrl/desc/topics/publishedAt |
| `tools/benchmark-covers/*.jpg` | 封面图，文件名 `<关键词>-<序号>.jpg`（best-effort，失败不影响样本） |

## 2. 路径 A（主）：拦截 search API 响应

**原理**：搜索页加载时会调 `POST /api/sns/web/v1/search/notes`，该响应在浏览器进程侧，**即使渲染器假死也能拿到**。这是社区爬虫共识的稳定路径（DOM class 常变，API 字段稳得多）。

```js
await page.cdp("Network.enable");
await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 }); // 软超时要容错
await sleep(12000);                              // API 在加载后几秒内发出
const evs = await page.events();                 // 缓冲的事件数组，取完即清
const api = evs.filter(e => e.method === "Network.responseReceived"
  && /search\/notes/.test(e.params?.response?.url || ""));
const body = await page.cdp("Network.getResponseBody", { requestId: api[0].params.requestId });
const items = JSON.parse(body.body ?? body)?.data?.items ?? [];
```

响应字段（`items[]`，过滤掉 `model_type === "user"` 的用户卡片）：

| 字段 | 说明 |
| --- | --- |
| `id` | 笔记 ID（24 位 hex），详情页 URL = `/explore/<id>` |
| `noteCard.displayTitle` | 标题（可能含 emoji） |
| `noteCard.type` | `video` / `normal` |
| `noteCard.interactInfo.likedCount` | 点赞（字符串，可能带「万」「w」缩写，需换算） |
| `noteCard.interactInfo.collected / commentCount` | 收藏 / 评论（同上，有时缺省） |
| `noteCard.cover.url` | 封面图（协议相对 `//...`，需补 `https:`） |
| `noteCard.user.nickName` | 作者昵称 |

搜索 URL 排序参数：`&sort=popularity_descending`（最热）。**未实测确认**——若无效改点「筛选」面板里的排序项后重新拦截 API。

## 3. 路径 B（兜底）：DOM 提取

API 路径拿不到时，先探主线程是否存活（`page.evaluate(() => document.title)`），挂死则 reload 一次再试；存活后提取卡片 outerHTML，在 Node 侧正则解析（不二次往返页面）：

| 目标 | 选择器 / 正则 |
| --- | --- |
| 卡片容器 | `a[href*='/explore/']` 向上最近的 `section`（社区常见 `section.note-item`，class 变动时以此兜底） |
| 标题 | `class="title…"`,或 img 的 `alt` |
| 点赞 | `class="count…"`（"1.2万"/"3w" → ×10000） |
| 封面 | img `src` / `data-src`（`//` 开头补 `https:`） |
| 笔记 ID | href 中 24 位 hex |

## 4. 详情页补全（best-effort，top 5）

`https://www.xiaohongshu.com/explore/<id>` 是 SSR 页面，比搜索页轻：

- 标题 `#detail-title`；正文 `#detail-desc`；话题 `#detail-desc a.tag`（fallback：正则 `#[^#\s]{1,20}`）
- 互动数 `.like-wrapper .count` / `.collect-wrapper .count` / `.chat-wrapper .count`（class 变动时用 `[class*='like'] .count` 等）
- 部分笔记可能跳登录墙，失败就跳过，不影响主样本

## 5. 已踩坑（2026-09-29 实测）

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `goto` 连 domcontentloaded 都超时；`evaluate` 15s 超时；`screenshot` CDP 超时 | search_result 页渲染器假死（视频解码/风控挑战，原因未定，可复现） | **别恋战**：转到路径 A 拦 API（网络层不受影响）；DOM 路径只 reload 重试一次 |
| 首轮正常、后续轮次全部假死 | 疑似风控渐进升级 | 每系列 ≤2 次抓取；单次跑完就 finish；绝不连环重试 |
| `page.events()` 只捕到 3 个事件、无 search API | 页面连 API 都没发出（假死太早） | 等 15s 后仍无 → 走路径 B / 降级 |
| 首页文本显示登录提示 | 已登录用户的误报弹层 | 用创作者平台判据（§0） |
| `The user has taken control of this task space` | 用户接管了浏览器 | **硬停止**：不许 claimTaskSpace 抢回，报告用户等「继续」；用户在用浏览器时别跑抓取 |
| `task.finish({keep:[]})` 后 `page label not found` | finish 关闭了所有托管页 | 每轮脚本自建自关页，不跨轮引用 label |
| 搜索 URL 被附加 `type=51` 等参数 | 页面自身跳转 | 无影响，拦截 API 判据用路径匹配不受影响 |

## 6. 风控纪律（硬规则）

- 只读：不点赞、不收藏、不关注、不评论、不翻页点击。
- 每系列完整抓取 ≤2 次；单次 ≤20 样本 × ≤2 关键词。
- 失败降级顺序：路径 A → 路径 B → WebSearch 公开资料 + 请用户提供对标笔记链接。降级后 `benchmark.json` 写 `"degraded": true`。

## 7. benchmark.json schema（阶段 0.5 分析产物）

```json
{
  "sampledAt": "2026-09-29T18:00:00+08:00",
  "keywords": ["咖啡"],
  "sampleSource": "api | dom | websearch | user-provided（降级时标注）",
  "degraded": false,
  "sampleCount": 18,
  "titlePatterns": [
    {
      "name": "数字+痛点承诺",
      "pattern": "N 个/天/分钟 + 具体痛点结果",
      "examples": ["3个动作治好我的肩颈痛", "每天10分钟，30天练出直角肩"],
      "count": 6,
      "medianLikes": 4200,
      "note": "count = 样本中命中该模式的笔记数；无样本支撑的模式不得写入"
    }
  ],
  "coverInsights": {
    "dominantForms": ["大字报标题封面", "实拍+大字叠加"],
    "colorTone": "高饱和暖色 / 低对比浅底",
    "textDensity": "封面文字 ≤12 字，标题字号占画面 1/3 以上",
    "implication": "对 build-cards 风格选择的直接建议（选哪套预设/覆盖哪些 token）"
  },
  "topicPool": ["咖啡", "咖啡日常", "手冲咖啡", "咖啡师", "咖啡测评"],
  "structureNotes": [
    "正文 300~600 字，首段一句话钩子",
    "emoji 密度约每 2 行 1 个",
    "结尾固定互动引导（提问式）",
    "干货型赛道（收藏>点赞）：正文含清单/步骤表"
  ],
  "engagementBaseline": {
    "likesMedian": 3200, "likesTop": 51000,
    "collectsMedian": 4100, "commentsMedian": 180,
    "signal": "收藏中位数 > 点赞中位数 → 干货型赛道，封面和正文突出保存价值"
  }
}
```

分析规则：模式必须有 `examples`（样本原句）+ `count` + `medianLikes`；coverInsights 基于封面图肉眼比对（`tools/benchmark-covers/`）；结论写「对生成动作的直接指令」，不写空话。

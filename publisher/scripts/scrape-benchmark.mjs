// 小红书对标样本抓取器（阶段 0.5 · 对标分析）
// 用法：先写任务文件 /tmp/xhs-benchmark-task.json，然后：
//   ego-browser nodejs < <skill-dir>/scripts/scrape-benchmark.mjs
//
// 任务文件 schema：
// {
//   "keywords": ["咖啡"],              // 1~2 个赛道关键词（必填）
//   "outDir": "/abs/path/series-root", // 系列根目录绝对路径（必填）
//   "maxCards": 20,                    // 每个关键词最多保留样本数（默认 20）
//   "detailTop": 5                     // 打开详情页补全文案/话题的样本数（默认 5，best-effort）
// }
//
// 产出：
//   <outDir>/tools/benchmark-samples.json   原始样本（含 source 与 degraded 标记）
//   <outDir>/tools/benchmark-covers/*.jpg   封面图（best-effort）
//
// 抓取纪律（见 SKILL.md 硬规则）：只读，不点赞不收藏不关注；每系列调用本脚本 ≤2 次。
// 路径优先级：A) CDP 拦截 search API 响应（渲染器假死免疫）→ B) DOM 提取（兜底）。
// 失败不抛异常，summary 里带 error/degraded 字段，由调用方决定降级。
// 平台守卫：Windows 上无 Ego Lite，直接退出并给出指引，避免晦涩堆栈。
if (process.platform !== "darwin") {
  console.error(
    "平台不支持：本脚本仅支持 macOS（依赖 Ego Lite 的 ego-browser CLI）。Windows 上需登录态的浏览器操作，请改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态），见 ~/.agents/skills/ego-browser/SKILL.md 的「Windows path」章节。"
  );
  process.exit(1);
}
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const TASK_PATH = "/tmp/xhs-benchmark-task.json";
const taskDef = JSON.parse(await readFile(TASK_PATH, "utf8"));
const keywords = taskDef.keywords || [];
const OUT = resolve(taskDef.outDir);
const maxCards = taskDef.maxCards ?? 20;
const detailTop = taskDef.detailTop ?? 5;
if (!keywords.length || !OUT) {
  console.error(JSON.stringify({ error: "task file 缺少 keywords 或 outDir" }));
  process.exit(1);
}
const toolsDir = join(OUT, "tools");
const coversDir = join(toolsDir, "benchmark-covers");
await mkdir(coversDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "1.2万" / "3w" / "8421" → 数字
function parseCount(s) {
  if (s == null) return null;
  const t = String(s).trim().replace(/[+,]/g, "");
  const m = t.match(/^([\d.]+)\s*([万wW])?/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (Number.isNaN(n)) return null;
  return m[2] ? Math.round(n * 10000) : Math.round(n);
}

const CARD_SEL = `a[href*='/explore/'], a[href*='/search_result/']`;

function normFromApi(it, keyword) {
  const c = it.noteCard ?? it.note_card ?? {};
  const cover = c.cover ?? c.noteCover ?? {};
  const inter = c.interactInfo ?? c.interact_info ?? {};
  return {
    id: it.id ?? it.noteId,
    keyword,
    title: c.displayTitle ?? c.display_title ?? null,
    author: c.user?.nickName ?? c.user?.nickname ?? null,
    type: c.type ?? null,
    likesRaw: inter.likedCount ?? null,
    likes: parseCount(inter.likedCount),
    collects: parseCount(inter.collected),
    comments: parseCount(inter.commentCount),
    coverUrl: cover.url ? (cover.url.startsWith("//") ? "https:" + cover.url : cover.url) : null,
    noteUrl: it.id ? `https://www.xiaohongshu.com/explore/${it.id}` : null,
  };
}





const task = await taskSpace("xhs benchmark scrape");
console.log(JSON.stringify({ log: "space", spaceId: task.spaceId }));

// ---------- 登录检查（复用发布配方判据：创作者平台最可靠） ----------
{
  const p = task.page("p1");
  try { await p.goto("https://creator.xiaohongshu.com/publish/publish?source=official", { waitUntil: "domcontentloaded", timeout: 40000 }); }
  catch (e) { console.log(JSON.stringify({ log: "login-goto-soft", msg: String(e.message).slice(0, 60) })); }
  await sleep(4000);
  const r = await p.evaluate(() => document.body.innerText.replace(/\n+/g, "|").slice(0, 150));
  if (!/上传图文|发布笔记/.test(r) || /扫码/.test(r)) {
    console.log(JSON.stringify({ error: "not-logged-in", detail: r }));
    await task.finish({ keep: [] });
    process.exit(2);
  }
  console.log(JSON.stringify({ log: "login-ok" }));
}

// ---------- 单个关键词的抓取 ----------
async function scrapeKeyword(keyword, pageLabel) {
  let page;
  try { page = task.page(pageLabel); await page.close(); } catch (e) {}
  page = await task.newPage();
  await page.cdp("Network.enable").catch(() => {});
  const url = `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(keyword)}&source=web_explore_feed&sort=popularity_descending`;
  try { await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
  catch (e) { console.log(JSON.stringify({ log: "goto-soft", keyword, msg: String(e.message).slice(0, 50) })); }
  await sleep(12000);

  // 对话框陷阱检查（alert/confirm 会挂死主线程）
  try {
    const info = await page.info();
    if (info?.dialog) { await page.dismissDialog().catch(() => {}); await sleep(3000); }
  } catch (e) {}

  let notes = [];
  let source = "none";

  // 路径 A：CDP 拦截 search API 响应（浏览器进程侧，渲染器假死免疫）
  try {
    const evs = await page.events();
    const apiRes = evs.filter((e) => e.method === "Network.responseReceived" && /search\/notes/.test(e.params?.response?.url || ""));
    for (const r of apiRes) {
      try {
        const body = await page.cdp("Network.getResponseBody", { requestId: r.params.requestId });
        const data = JSON.parse(typeof body === "string" ? body : body.body);
        const items = (data?.data?.items ?? data?.data?.notes ?? []).filter((it) => (it.noteCard ?? it.note_card) && it.model_type !== "user");
        notes.push(...items.map((it) => normFromApi(it, keyword)));
      } catch (e) { console.log(JSON.stringify({ log: "api-body-fail", msg: String(e.message).slice(0, 60) })); }
    }
    if (notes.length) source = "api";
  } catch (e) { console.log(JSON.stringify({ log: "api-path-fail", msg: String(e.message).slice(0, 60) })); }

  // 路径 B：DOM 兜底（先探主线程是否响应，挂死则换一次 reload）
  if (!notes.length) {
    let alive = false;
    try { await page.evaluate(() => document.title); alive = true; } catch (e) {}
    if (!alive) {
      try { await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }); } catch (e) {}
      await sleep(10000);
      try { await page.evaluate(() => document.title); alive = true; } catch (e) {}
    }
    if (alive) {
      try {
        const cards = await page.evaluate((sel) => {
          const links = [...document.querySelectorAll(sel)];
          const seen = new Set();
          const out = [];
          for (const a of links) {
            const card = a.closest("section.note-item") || a.closest("section") || a.parentElement?.parentElement;
            const id = ((a.getAttribute("href") || "").match(/([0-9a-f]{24})/) || [])[1];
            if (!id || seen.has(id) || !card) continue;
            seen.add(id);
            out.push(card.outerHTML);
            if (out.length >= 40) break;
          }
          return out;
        }, CARD_SEL);
        // outerHTML 在 Node 侧用正则解析（不回页面二次往返，更抗假死；class 变动时需按 benchmark-recipe.md 校准）
        notes = cards.map((html) => {
          const id = (html.match(/([0-9a-f]{24})/) || [])[1];
          if (!id) return null;
          const title = (html.match(/class="title[^"]*"[^>]*>([^<]{1,120})</) || html.match(/alt="([^"]{1,120})"/) || [])[1] ?? null;
          const countRaw = (html.match(/class="count[^"]*"[^>]*>([^<]{1,15})</) || [])[1] ?? null;
          const author = (html.match(/class="name[^"]*"[^>]*>([^<]{1,40})</) || [])[1] ?? null;
          const img = (html.match(/(?:data-)?src="(\/\/[^"]+)"/) || [])[1] ?? null;
          return {
            id,
            keyword,
            title,
            author,
            type: /icon_play|play/.test(html) ? "video" : "normal",
            likesRaw: countRaw,
            likes: parseCount(countRaw),
            collects: null,
            comments: null,
            coverUrl: img ? "https:" + img : null,
            noteUrl: `https://www.xiaohongshu.com/explore/${id}`,
          };
        }).filter(Boolean);
        if (notes.length) source = "dom";
      } catch (e) { console.log(JSON.stringify({ log: "dom-path-fail", msg: String(e.message).slice(0, 60) })); }
    }
  }

  // 去重、按点赞排序、截断
  const seen = new Set();
  notes = notes
    .filter((n) => n.id && !seen.has(n.id) && seen.add(n.id))
    .sort((a, b) => (b.likes ?? 0) - (a.likes ?? 0))
    .slice(0, maxCards);

  // 封面下载（best-effort）
  for (const [i, n] of notes.entries()) {
    if (!n.coverUrl) continue;
    try { await page.fetch(n.coverUrl, { saveAs: join(coversDir, `${keyword}-${String(i + 1).padStart(2, "0")}.jpg`), timeout: 15000 }); n.coverFile = `tools/benchmark-covers/${keyword}-${String(i + 1).padStart(2, "0")}.jpg`; }
    catch (e) { /* 封面失败不影响样本 */ }
  }

  // 详情页补全（正文话题/收藏/评论数，best-effort）
  for (const n of notes.slice(0, detailTop)) {
    try {
      try { await page.goto(n.noteUrl, { waitUntil: "domcontentloaded", timeout: 30000 }); }
      catch (e) { /* note 页也可能软超时，继续试 */ }
      await sleep(6000);
      const d = await page.evaluate(() => {
        const pick = (sels) => { for (const s of sels) { const e = document.querySelector(s); if (e) return e.textContent.trim(); } return null; };
        const desc = document.querySelector("#detail-desc");
        return {
          title: document.querySelector("#detail-title")?.textContent?.trim() ?? null,
          desc: desc?.innerText?.slice(0, 2000) ?? null,
          topics: desc ? [...desc.querySelectorAll("a.tag")].map((a) => a.textContent.trim().replace(/^#/, "")).filter(Boolean) : null,
          likes: pick([".like-wrapper .count", "[class*='like'] .count"]),
          collects: pick([".collect-wrapper .count", "[class*='collect'] .count"]),
          comments: pick([".chat-wrapper .count", "[class*='chat'] .count"]),
          time: pick([".bottom-container", "[class*='date']"]),
        };
      });
      if (d.title) {
        n.title = n.title || d.title;
        n.desc = d.desc;
        n.topics = d.topics ?? (d.desc ? (d.desc.match(/#[^#\s]{1,20}/g) || []).map((t) => t.slice(1)) : null);
        n.likes = n.likes ?? parseCount(d.likes);
        n.collects = n.collects ?? parseCount(d.collects);
        n.comments = n.comments ?? parseCount(d.comments);
        n.publishedAt = d.time;
        n.detailOk = true;
      }
    } catch (e) { console.log(JSON.stringify({ log: "detail-fail", id: n.id, msg: String(e.message).slice(0, 50) })); }
  }

  try { await page.close(); } catch (e) {}
  return { keyword, notes, source };
}

// ---------- 主循环 ----------
const results = [];
for (const kw of keywords) {
  results.push(await scrapeKeyword(kw, "p2"));
}
const all = results.flatMap((r) => r.notes);
const sources = [...new Set(results.map((r) => r.source))];
const summary = {
  sampledAt: new Date().toISOString(),
  keywords,
  total: all.length,
  source: sources.join("+"),
  degraded: all.length < 5,
  perKeyword: results.map((r) => ({ keyword: r.keyword, count: r.notes.length, source: r.source })),
  notes: all,
};
await writeFile(join(toolsDir, "benchmark-samples.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ok: !summary.degraded, total: summary.total, source: summary.source, degraded: summary.degraded, out: join(toolsDir, "benchmark-samples.json") }));
await task.finish({ keep: [] });

// 小红书知识卡片生成器（通用版）
// 用法：node build-cards.mjs <cards-data.json> <seriesRoot>
//
// cards-data.json schema：
// {
//   "style": "tech-dark" | "paper-light" | "warm-life",   // 或对象，覆盖 tech-dark 的任意 token
//   "seriesName": "DEEPSEEK HARNESS · 架构图解",           // 页眉 chip 文案
//   "footer": "架构图解 · 第 {n} 篇 / 共 {total} 篇",       // 可选，{n}/{total} 会替换；默认用 seriesName
//   "posts": [{
//     "n": 1, "dir": "01-目录名",
//     "cover": { "kicker": "第 1 篇 · 共 6 篇", "title": "大标题，<em>渐变强调</em>", "sub": "副标题", "visual": "<div class=\"layers\">…</div>", "hook": "本篇回答的问题" },
//     "cards": [
//       { "name": "2-xxx", "eyebrow": "图解 ① · 主题", "heading": "页标题",
//         "mermaid": "flowchart TB\n  A[\"节点\"] --> B[\"节点\"]",   // 与 visual 二选一
//         "visual": "<div class=\"states\">…</div>",              // 原生 HTML 视觉块
//         "bullets": [{ "lead": "加粗引导", "text": "说明" }],     // 与 recap 二选一
//         "recap": [{ "k": "关键词", "v": "结论，<b>可加粗</b>" }],
//         "preview": { "lb": "下篇预告 · 第 2 篇", "tx": "预告标题", "small": "一句补充" } }
//     ]
//   }]
// }
//
// 可用视觉组件类（visual 字段里直接用）：
//   <div class="layers"><div class="layer [hot]"><span class="t">标题</span><span class="d">说明</span></div>…</div>
//   <div class="states"><div class="st [on]"><span class="dot"></span>条目<small>右侧说明</small></div>…</div>
//   <div class="map6"><div class="m"><b>01</b>条目</div>…</div>
//
// 产物：每张卡一个 HTML（tools/render/<dir>/）+ render-list.json（同时写到 seriesRoot/tools/render/ 和
// /tmp/xhs-render-list.json，后者是 render-cards.js 的输入契约）。PNG 由 render-cards.js 截出。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [dataPath, rootArg] = process.argv.slice(2);
if (!dataPath || !rootArg) {
  console.error("用法：node build-cards.mjs <cards-data.json> <seriesRoot>");
  process.exit(1);
}
const ROOT = resolve(rootArg);
const data = JSON.parse(await readFile(resolve(dataPath), "utf8"));

// ---------- 风格预设 ----------
const PRESETS = {
  "tech-dark": {
    bg: `radial-gradient(640px 340px at 85% -8%, rgba(77,107,254,.20), transparent 62%),
    radial-gradient(520px 300px at -10% 108%, rgba(139,92,246,.13), transparent 60%),
    linear-gradient(168deg,#0C1122 0%,#090D19 55%,#070A14 100%)`,
    topLine: "linear-gradient(90deg,#4D6BFE,#8B5CF6 55%,transparent)",
    chipColor: "#9AA6D6", chipBorder: "rgba(154,166,214,.30)",
    ink: "#EEF1FF", muted: "#9AA3C4",
    kicker: "#6E85FF",
    titleGradient: "linear-gradient(92deg,#6E8CFF,#A78BFA)",
    hookBg: "rgba(77,107,254,.09)", hookBorder: "rgba(110,133,255,.28)", hookLabel: "#6E85FF", hookText: "#D6DCF5",
    panelBg: "rgba(255,255,255,.035)", panelBorder: "rgba(255,255,255,.09)",
    noBg: "linear-gradient(135deg,rgba(77,107,254,.32),rgba(139,92,246,.32))", noBorder: "rgba(110,133,255,.4)", noColor: "#AFC0FF",
    footer: "#5A6591", progressTrack: "rgba(255,255,255,.08)", progressFill: "linear-gradient(90deg,#4D6BFE,#8B5CF6)",
    stDot: "#5A6591", stDotOn: "#4ADE80", stDotOnGlow: "rgba(74,222,128,.8)",
    previewBg: "linear-gradient(120deg,rgba(77,107,254,.16),rgba(139,92,246,.14))", previewBorder: "rgba(139,92,246,.35)",
    previewLabel: "#B9A7FF", previewText: "#F0F2FF", previewSmall: "#A9B2D6",
    recapChip: "#8FA4FF", recapChipBorder: "rgba(110,133,255,.35)", recapChipBg: "rgba(77,107,254,.10)",
    mermaid: {
      background: "transparent", primaryColor: "#182246", primaryTextColor: "#EEF1FF",
      primaryBorderColor: "#4D6BFE", lineColor: "#6E7BAE", secondaryColor: "#1B1738",
      tertiaryColor: "#11162A", fontSize: "17px", fontFamily: "PingFang SC, sans-serif",
      edgeLabelBackground: "#0C1122", clusterBkg: "rgba(255,255,255,.03)", clusterBorder: "rgba(255,255,255,.12)",
    },
  },
  "paper-light": {
    bg: `radial-gradient(640px 340px at 85% -8%, rgba(194,65,12,.10), transparent 62%),
    radial-gradient(520px 300px at -10% 108%, rgba(15,118,110,.08), transparent 60%),
    linear-gradient(168deg,#FBF8F3 0%,#F7F2EA 55%,#F3EDE2 100%)`,
    topLine: "linear-gradient(90deg,#C2410C,#0F766E 55%,transparent)",
    chipColor: "#8A7A66", chipBorder: "rgba(138,122,102,.35)",
    ink: "#2A2620", muted: "#6B6252",
    kicker: "#C2410C",
    titleGradient: "linear-gradient(92deg,#C2410C,#0F766E)",
    hookBg: "rgba(194,65,12,.06)", hookBorder: "rgba(194,65,12,.30)", hookLabel: "#C2410C", hookText: "#3F3A31",
    panelBg: "rgba(255,255,255,.72)", panelBorder: "rgba(42,38,32,.10)",
    noBg: "linear-gradient(135deg,rgba(194,65,12,.18),rgba(15,118,110,.18))", noBorder: "rgba(194,65,12,.35)", noColor: "#9A3412",
    footer: "#A79B87", progressTrack: "rgba(42,38,32,.10)", progressFill: "linear-gradient(90deg,#C2410C,#0F766E)",
    stDot: "#C9BEAC", stDotOn: "#0F766E", stDotOnGlow: "rgba(15,118,110,.55)",
    previewBg: "linear-gradient(120deg,rgba(194,65,12,.08),rgba(15,118,110,.08))", previewBorder: "rgba(15,118,110,.30)",
    previewLabel: "#0F766E", previewText: "#2A2620", previewSmall: "#6B6252",
    recapChip: "#9A3412", recapChipBorder: "rgba(194,65,12,.35)", recapChipBg: "rgba(194,65,12,.08)",
    mermaid: {
      background: "transparent", primaryColor: "#FDEAD7", primaryTextColor: "#2A2620",
      primaryBorderColor: "#C2410C", lineColor: "#8A7A66", secondaryColor: "#D9EEE9",
      tertiaryColor: "#F3EDE2", fontSize: "17px", fontFamily: "PingFang SC, sans-serif",
      edgeLabelBackground: "#FBF8F3", clusterBkg: "rgba(42,38,32,.03)", clusterBorder: "rgba(42,38,32,.15)",
    },
  },
  "warm-life": {
    bg: `radial-gradient(640px 340px at 85% -8%, rgba(234,88,12,.14), transparent 62%),
    radial-gradient(520px 300px at -10% 108%, rgba(245,158,11,.10), transparent 60%),
    linear-gradient(168deg,#FFF7ED 0%,#FFEDD5 55%,#FDE8CC 100%)`,
    topLine: "linear-gradient(90deg,#EA580C,#F59E0B 55%,transparent)",
    chipColor: "#9A5B2D", chipBorder: "rgba(154,91,45,.35)",
    ink: "#431407", muted: "#8A5A3B",
    kicker: "#EA580C",
    titleGradient: "linear-gradient(92deg,#EA580C,#D97706)",
    hookBg: "rgba(234,88,12,.08)", hookBorder: "rgba(234,88,12,.30)", hookLabel: "#EA580C", hookText: "#5A2E14",
    panelBg: "rgba(255,255,255,.70)", panelBorder: "rgba(67,20,7,.10)",
    noBg: "linear-gradient(135deg,rgba(234,88,12,.22),rgba(245,158,11,.22))", noBorder: "rgba(234,88,12,.40)", noColor: "#9A3412",
    footer: "#B98A63", progressTrack: "rgba(67,20,7,.10)", progressFill: "linear-gradient(90deg,#EA580C,#F59E0B)",
    stDot: "#DBB58F", stDotOn: "#16A34A", stDotOnGlow: "rgba(22,163,74,.55)",
    previewBg: "linear-gradient(120deg,rgba(234,88,12,.10),rgba(245,158,11,.10))", previewBorder: "rgba(234,88,12,.32)",
    previewLabel: "#C2410C", previewText: "#431407", previewSmall: "#8A5A3B",
    recapChip: "#9A3412", recapChipBorder: "rgba(234,88,12,.35)", recapChipBg: "rgba(234,88,12,.08)",
    mermaid: {
      background: "transparent", primaryColor: "#FFEDD5", primaryTextColor: "#431407",
      primaryBorderColor: "#EA580C", lineColor: "#B98A63", secondaryColor: "#FEF3C7",
      tertiaryColor: "#FDE8CC", fontSize: "17px", fontFamily: "PingFang SC, sans-serif",
      edgeLabelBackground: "#FFF7ED", clusterBkg: "rgba(67,20,7,.03)", clusterBorder: "rgba(67,20,7,.15)",
    },
  },
};
const T = typeof data.style === "string" ? PRESETS[data.style] ?? PRESETS["tech-dark"] : { ...PRESETS["tech-dark"], ...data.style };

// ---------- 设计系统（621×830 CSS px，render 时 @2x 输出 1242×1660） ----------
const CSS = `
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:621px; height:830px; overflow:hidden; }
body {
  font-family:"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  color:${T.ink}; background:${T.ink === "#EEF1FF" ? "#070A14" : "#FFF7ED"};
  -webkit-font-smoothing:antialiased;
}
.mono { font-family:"SF Mono",Menlo,Consolas,monospace; }
.card {
  position:relative; width:621px; height:830px; padding:42px 46px 34px;
  display:flex; flex-direction:column; background:${T.bg};
}
.card::before { content:""; position:absolute; top:0; left:0; right:0; height:3px; background:${T.topLine}; }
header { display:flex; justify-content:space-between; align-items:center; }
.chip { font-size:12px; letter-spacing:.18em; color:${T.chipColor}; font-weight:600; border:1px solid ${T.chipBorder}; border-radius:999px; padding:6px 14px; }
.pageno { font-size:12px; letter-spacing:.14em; color:${T.footer}; }
footer { margin-top:auto; display:flex; align-items:center; gap:14px; }
.progress { flex:1; height:4px; border-radius:99px; background:${T.progressTrack}; overflow:hidden; }
.progress i { display:block; height:100%; border-radius:99px; background:${T.progressFill}; }
.ft { font-size:11.5px; color:${T.footer}; letter-spacing:.08em; white-space:nowrap; }

.kicker { font-size:14px; font-weight:700; letter-spacing:.30em; color:${T.kicker}; margin-bottom:14px; }
.title { font-size:42px; line-height:1.22; font-weight:800; letter-spacing:.01em; }
.title em { font-style:normal; background:${T.titleGradient}; -webkit-background-clip:text; background-clip:text; color:transparent; }
.sub { margin-top:14px; font-size:17px; line-height:1.7; color:${T.muted}; }
.hook { margin-top:auto; border:1px solid ${T.hookBorder}; border-radius:14px; background:${T.hookBg}; padding:14px 18px; }
.hook .lb { font-size:12px; letter-spacing:.22em; color:${T.hookLabel}; font-weight:700; margin-bottom:5px; }
.hook .tx { font-size:16px; line-height:1.55; color:${T.hookText}; font-weight:600; }

.eyebrow { font-size:13px; letter-spacing:.26em; color:${T.kicker}; font-weight:700; margin-bottom:10px; }
h2 { font-size:29px; line-height:1.3; font-weight:800; margin-bottom:18px; }
h2 em { font-style:normal; color:${T.kicker}; }
.diagram {
  border:1px solid ${T.panelBorder}; border-radius:16px; background:${T.panelBg}; padding:14px 12px;
  display:flex; justify-content:center; align-items:center; overflow:hidden;
  flex:1; min-height:140px; margin-top:4px;
}
.diagram svg { max-width:100%; }
.bullets { display:flex; flex-direction:column; gap:14px; }
.bullet { display:flex; gap:13px; align-items:flex-start; }
.bullet .no {
  flex:0 0 auto; width:27px; height:27px; border-radius:8px; margin-top:2px;
  background:${T.noBg}; border:1px solid ${T.noBorder}; color:${T.noColor};
  font-size:13.5px; font-weight:700; display:flex; align-items:center; justify-content:center;
}
.bullet .bd { font-size:16.5px; line-height:1.62; color:${T.muted}; text-wrap:pretty; }
.bullet .bd b { color:${T.ink}; font-weight:700; }

.recap { display:flex; flex-direction:column; justify-content:space-evenly; gap:18px; margin-top:8px; flex:1; }
.recap .item { display:flex; gap:14px; align-items:flex-start; }
.recap .k {
  flex:0 0 auto; font-size:13px; font-weight:800; letter-spacing:.06em; color:${T.recapChip};
  border:1px solid ${T.recapChipBorder}; border-radius:999px; padding:4px 12px; margin-top:1px; background:${T.recapChipBg};
}
.recap .v { font-size:16.5px; line-height:1.62; color:${T.muted}; text-wrap:pretty; }
.recap .v b { color:${T.ink}; }
.preview {
  margin-top:auto; border-radius:16px; padding:16px 20px;
  background:${T.previewBg}; border:1px solid ${T.previewBorder};
}
.preview .lb { font-size:12px; letter-spacing:.24em; color:${T.previewLabel}; font-weight:700; margin-bottom:6px; }
.preview .tx { font-size:17px; font-weight:700; color:${T.previewText}; line-height:1.5; }
.preview .tx small { display:block; margin-top:3px; font-size:13.5px; font-weight:500; color:${T.previewSmall}; }

.layers { display:flex; flex-direction:column; gap:10px; width:100%; }
.layer { border-radius:12px; padding:13px 18px; display:flex; align-items:center; gap:12px; border:1px solid ${T.panelBorder}; background:${T.panelBg}; }
.layer .t { font-size:15px; font-weight:700; color:${T.ink}; white-space:nowrap; }
.layer .d { font-size:12.5px; color:${T.muted}; }
.layer.hot { border-color:${T.hookBorder}; background:${T.hookBg}; }
.states { display:flex; flex-direction:column; gap:9px; width:100%; }
.st { display:flex; align-items:center; gap:12px; border-radius:11px; padding:10px 15px; border:1px solid ${T.panelBorder}; background:${T.panelBg}; font-size:14px; font-weight:700; color:${T.ink}; }
.st .dot { width:9px; height:9px; border-radius:99px; background:${T.stDot}; }
.st.on .dot { background:${T.stDotOn}; box-shadow:0 0 10px ${T.stDotOnGlow}; }
.st small { font-weight:500; color:${T.muted}; font-size:12.5px; margin-left:auto; padding-left:12px; }
.map6 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.map6 .m { border:1px solid ${T.panelBorder}; background:${T.panelBg}; border-radius:12px; padding:11px 14px; font-size:13.5px; line-height:1.45; color:${T.muted}; }
.map6 .m b { color:${T.kicker}; font-family:"SF Mono",Menlo,monospace; margin-right:7px; }
`;

const total = data.posts.length;
const footText = (n) => (data.footer ?? `${data.seriesName} · 第 {n} 篇 / 共 ${total} 篇`).replaceAll("{n}", String(n)).replaceAll("{total}", String(total));
const pageFoot = (post, idx) => `
<footer>
  <div class="progress"><i style="width:${Math.round((idx / 4) * 100)}%"></i></div>
  <div class="ft">${footText(post.n)}</div>
</footer>`;

// mermaid 初始化：CDN 双源回退 + viewBox 等比缩放进面板（小图允许放大到 1.6x）
const MERMAID_BOOT = `
const CDNS = [
  "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs",
  "https://unpkg.com/mermaid@11/dist/mermaid.esm.min.mjs",
];
let mermaid = null;
for (const u of CDNS) { try { mermaid = (await import(u)).default; break; } catch (e) {} }
if (mermaid) {
  mermaid.initialize({
    startOnLoad: false, theme: "base", securityLevel: "loose",
    themeVariables: ${JSON.stringify(T.mermaid)},
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: "basis", nodeSpacing: 34, rankSpacing: 38 },
    state: { useMaxWidth: true },
  });
  await mermaid.run({ querySelector: ".mermaid" });
  for (const svg of document.querySelectorAll(".diagram svg")) {
    const panel = svg.closest(".diagram");
    const maxW = Math.max(panel.clientWidth - 26, 120);
    const maxH = Math.max(panel.clientHeight - 26, 120);
    svg.style.maxWidth = "none";
    svg.style.maxHeight = "none";
    svg.removeAttribute("height");
    const vb = svg.viewBox && svg.viewBox.baseVal;
    if (vb && vb.width > 0 && vb.height > 0) {
      const scale = Math.min(maxW / vb.width, maxH / vb.height, 1.6);
      svg.setAttribute("width", Math.round(vb.width * scale));
      svg.setAttribute("height", Math.round(vb.height * scale));
    }
  }
}
await document.fonts.ready;
window.__cardReady = true;
`;

function page(post, idx, body, { mermaid = false } = {}) {
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><style>${CSS}</style></head>
<body><div class="card">
${body}
${pageFoot(post, idx)}
</div>
${mermaid ? `<script type="module">${MERMAID_BOOT}</script>` : `<script>document.fonts.ready.then(() => { window.__cardReady = true; });</script>`}
</body></html>`;
}

const coverBody = (post) => `
  <header><div class="chip">${data.seriesName}</div><div class="pageno mono">${String(post.n).padStart(2, "0")}/${total}</div></header>
  <div style="margin-top:44px;">
    <div class="kicker">${post.cover.kicker}</div>
    <div class="title">${post.cover.title}</div>
    <div class="sub">${post.cover.sub}</div>
  </div>
  <div style="flex:1; display:flex; align-items:center; margin:10px 0 18px;">${post.cover.visual}</div>
  <div class="hook"><div class="lb">本篇回答</div><div class="tx">${post.cover.hook}</div></div>
`;

const innerBody = (c) => `
  <header><div class="chip">${data.seriesName}</div><div class="pageno mono">${String(c._n).padStart(2, "0")}/${total}</div></header>
  <div style="margin-top:30px;">
    <div class="eyebrow">${c.eyebrow}</div>
    <h2>${c.heading ?? ""}</h2>
  </div>
  ${c.mermaid ? `<div class="diagram"><pre class="mermaid">${c.mermaid}</pre></div>` : c.visual ? `<div class="diagram" style="padding:18px 16px;">${c.visual}</div>` : ""}
  ${c.recap ? `<div class="recap">
    ${c.recap.map((r) => `<div class="item"><div class="k">${r.k}</div><div class="v">${r.v}</div></div>`).join("\n")}
  </div>` : `<div class="bullets" style="margin-top:20px;">
    ${c.bullets.map((b, j) => `<div class="bullet"><div class="no">${j + 1}</div><div class="bd"><b>${b.lead}</b>　${b.text}</div></div>`).join("\n")}
  </div>`}
  ${c.preview ? `<div class="preview"><div class="lb">${c.preview.lb}</div><div class="tx">${c.preview.tx}<small>${c.preview.small}</small></div></div>` : ""}
`;

// ---------- 生成 ----------
const renderList = [];
for (const post of data.posts) {
  const outDir = join(ROOT, post.dir, "cards");
  const htmlDir = join(ROOT, "tools", "render", post.dir);
  await mkdir(outDir, { recursive: true });
  await mkdir(htmlDir, { recursive: true });

  const items = [{ name: "1-cover", html: page(post, 1, coverBody(post)) }];
  post.cards.forEach((c, i) => {
    c._n = post.n;
    items.push({ name: c.name, html: page(post, i + 2, innerBody(c), { mermaid: Boolean(c.mermaid) }) });
  });

  for (const item of items) {
    const htmlPath = join(htmlDir, `${item.name}.html`);
    const outPath = join(outDir, `${item.name}.png`);
    await writeFile(htmlPath, item.html);
    renderList.push({ html: htmlPath, out: outPath });
  }
  console.log(`post ${post.n}: ${items.length} cards`);
}
const listJson = JSON.stringify(renderList, null, 2);
await writeFile(join(ROOT, "tools", "render", "render-list.json"), listJson);
await writeFile("/tmp/xhs-render-list.json", listJson); // render-cards.js 的输入契约
console.log(`total ${renderList.length} cards；render-list 已写 /tmp/xhs-render-list.json`);

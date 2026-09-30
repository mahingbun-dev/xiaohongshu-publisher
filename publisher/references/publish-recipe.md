# Ego Lite 小红书发布配方（已实测 2026-09-28）

逐条都是实际踩过的坑，发布脚本 `scripts/publish-note.mjs` 是本配方的代码化；脚本失败时按本文档手动交互式操作。操作前先读 ego-browser Skill（`~/.agents/skills/ego-browser/SKILL.md`），只用其列出的 API。

> 平台注记：本文流程依赖 Ego Lite，仅 macOS 可用；Windows 上需登录态的浏览器操作改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态）；两个 .mjs 脚本（`publish-note.mjs` / `scrape-benchmark.mjs`）在 Windows 上会被平台守卫拦截（exit 1）。

## 0. 登录态验证

```js
const task = await taskSpace("check xhs login");
const page = task.page("p1");
await page.goto("https://www.xiaohongshu.com", { timeout: 30000 });
const s = await page.evaluate(() => ({
  url: location.href,
  nav: document.body.innerText.slice(0, 200),
}));
// 已登录判据：跳到 /explore 且导航含「发布」「通知」「消息」；未登录则出现「登录」按钮。
// 不要用 document.cookie 判断：web_session 是 httpOnly，读不到。
console.log(JSON.stringify(s));
await task.finish({ keep: [] });
```

未登录：`task.handOff()` 交还用户登录，结束后再继续。**不要**用清 cookie 类操作。

## 1. 打开发布页并切到「上传图文」

- 页面：`https://creator.xiaohongshu.com/publish/publish?source=official`
- 默认停在「上传视频」页签。
- 页面上有 **3 个同名「上传图文」元素**（侧边栏 + 页签重复渲染）。`page.click('text="上传图文"')` 会因歧义报错，ref 点击会被内层 span 拦截。可靠做法是 DOM 点击第一个叶子元素：

```js
await page.evaluate(() => {
  const els = [...document.querySelectorAll("span,div")].filter(
    (e) => e.childElementCount === 0 && e.textContent.trim() === "上传图文" && e.getClientRects().length
  );
  els[0].click();
});
// 确认：URL 出现 from=tab_switch，且出现 accept 含 .jpg 的 multiple input[type=file]
```

## 2. 上传图片

```js
await page.setInputFiles("input[type=file]", [cover, p2, p3, p4]); // 绝对路径，顺序即笔记页序
```

- 推荐图：3:4（1242×1660），png/jpg/webp，单张 ≤32MB，≥720×960。
- 上传完成判据：右侧出现「笔记预览」+「1/4」字样（waitForFunction 检查 `.tiptap.ProseMirror` 出现即可）。

## 3. 标题与正文

```js
await page.fill('input[placeholder*="标题"]', title);   // ≤20 字，超字数会被截断
await page.click(".tiptap.ProseMirror");                 // 正文是 tiptap ProseMirror contenteditable
await page.keyboard.paste(body);                         // 原生粘贴保留换行与 emoji；insertText 会丢换行
```

## 4. 发布按钮（最大的坑）

正文含 `#话题` 时，粘贴后光标处的**话题联想下拉框会弹出并恰好盖住发布按钮**，普通点击报 `<div> intercepts pointer events`：

1. 先 `page.keyboard.press("Escape")` 关闭下拉。
2. 拿 ref：`page.snapshot()` 输出里找 `button [ref=N]` 下一行是 `text "发布"`（按钮文本查询 `document.querySelectorAll("button")` 里 innerText 精确等于「发布」**经常找不到**，不要依赖 DOM 查询，以 snapshot ref 为准）。
3. `page.click("@N", { timeout: 8000 })`；仍报拦截就补一次 Escape 后 `force: true`。

## 5. 成功判定与核对

- 成功：URL 跳转 `https://creator.xiaohongshu.com/publish/success?...`（页面显示「发布成功」）。
- 核对：打开 `https://creator.xiaohongshu.com/new/note-manager`（旧路径 `/publish/noteManage`、`/publish/manage` 是 404），列表应出现该标题与发布时间。新笔记状态显示「仅自己可见」是审核期常态，不是失败。
- 拿笔记公开链接：笔记管理列表行内点击标题进入详情页，或让用户在 App 内复制。

## 6. 故障速查

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `text="上传图文" matched 3 elements` | 同名元素 3 份 | 用第 1 节的 DOM 叶子元素点击 |
| `page.click timed out: <span>/<div> intercepts pointer events` | 内层元素拦截 / 话题下拉遮挡 | Escape 后重试；snapshot ref 点击；必要时 force |
| 截图出来是 CSS 尺寸（621×830） | `page.screenshot({raw:true})` 在部分版本不按 dsf 输出 | 用 `page.cdp("Page.captureScreenshot")` 取 base64 自行写盘 |
| `task space not found: N` | 每次调用是新 Node 进程，spaceId 不持久 | `listTaskSpaces()` 查 id，用数字 id 复用 |
| 浏览器权限弹窗（位置等）移交控制权 | 浏览器自有 prompt 只能用户处理 | 等待后 `takeOverTaskSpace(id)`；仍不行就报告用户 |
| Mermaid 渲染空白 | CDN 不通 | 换备用 CDN（jsdelivr → unpkg），模板已内置双源 |
| `[ego-browser:notice]` 升级提示 | Ego Lite 有新版 | 忽略，不运行 `ego-browser upgrade`，报告用户 |

// 发布一篇小红书笔记：ego-browser nodejs < publish-note.mjs
// 输入契约：/tmp/xhs-publish-task.json = {"seriesRoot": "<绝对路径>", "postId": "01"}
// 行为：读 manifest → 校验 → 发布 → 核对 → 更新 manifest。失败保持 pending 并写 error。
// 失败时按 references/publish-recipe.md 手动交互式操作。
(async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const taskFile = JSON.parse(await readFile("/tmp/xhs-publish-task.json", "utf8"));
  const manifestPath = `${taskFile.seriesRoot.replace(/\/$/, "")}/manifest.json`;
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const idx = manifest.posts.findIndex((p) => p.id === taskFile.postId);
  const report = (r) => console.log(JSON.stringify(r, null, 2));
  if (idx === -1) return report({ ok: false, reason: `manifest 中找不到 postId ${taskFile.postId}` });
  const post = manifest.posts[idx];
  if (post.status === "published") return report({ ok: false, reason: `第 ${post.id} 篇已是 published，不重复发布` });
  // 前置校验：标题/正文长度与图片存在性，发布前拦住而不是发出去才发现
  if ([...post.title].length > 20) return report({ ok: false, reason: `标题超 20 字（${[...post.title].length}），先改 manifest` });
  if (post.body.length > 1000) return report({ ok: false, reason: `正文超 1000 字（${post.body.length}），先改 manifest` });
  const imgs = post.images.map((rel) => `${taskFile.seriesRoot.replace(/\/$/, "")}/${rel}`);
  for (const p of imgs) await readFile(p); // 不存在会抛错进入 catch

  const fail = async (reason) => {
    post.error = reason;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return report({ ok: false, post: post.id, reason });
  };

  try {
    const task = await taskSpace(`publish xhs note ${post.id}`);
    const page = task.page("p1");
    await page.goto("https://creator.xiaohongshu.com/publish/publish?source=official", { waitUntil: "load", timeout: 40000 });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const login = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.slice(0, 300),
    }));
    if (/login|登录/.test(login.url) && !/creator\.xiaohongshu\.com\/publish\/publish/.test(login.url)) {
      await task.handOff();
      return fail("未登录小红书：已在浏览器交还控制权，请用户登录后重试");
    }

    // 切「上传图文」页签：3 个同名元素，DOM 点第一个叶子元素（ref/text 选择器会歧义或被拦截）
    await page.evaluate(() => {
      const els = [...document.querySelectorAll("span,div")].filter(
        (e) => e.childElementCount === 0 && e.textContent.trim() === "上传图文" && e.getClientRects().length
      );
      els[0].click();
    });
    await page.waitForFunction(() => location.href.includes("from=tab_switch"), undefined, { timeout: 10000 });
    await page.waitForTimeout(1000);

    await page.setInputFiles("input[type=file]", imgs);
    await page.waitForSelector(".tiptap.ProseMirror", { timeout: 60000 });
    await page.waitForTimeout(1500);

    await page.fill('input[placeholder*="标题"]', post.title, { timeout: 8000 });
    await page.click(".tiptap.ProseMirror");
    await page.waitForTimeout(400);
    await page.keyboard.paste(post.body);
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape"); // 关闭话题联想下拉（它会遮挡发布按钮）

    // 发布按钮以 snapshot ref 为准（DOM 查询经常找不到）
    const snap = await page.snapshot();
    const m = snap.match(/button \[ref=(\d+)\]\s*\n\s*text "发布"/);
    if (!m) return fail("snapshot 中找不到「发布」按钮 ref，请按 references/publish-recipe.md 手动处理");
    try {
      await page.click(`@${m[1]}`, { timeout: 8000 });
    } catch {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(500);
      await page.click(`@${m[1]}`, { timeout: 8000, force: true });
    }
    await page.waitForFunction(() => location.href.includes("/publish/success"), undefined, { timeout: 60000 });

    // 核对：笔记管理列表出现该标题
    await page.goto("https://creator.xiaohongshu.com/new/note-manager", { waitUntil: "load", timeout: 30000 });
    await page.waitForTimeout(3500);
    const confirmed = await page.evaluate((t) => document.body.innerText.includes(t), post.title);
    if (!confirmed) return fail("已跳转发布成功页，但笔记管理列表未找到该标题，请人工核对后再标记 published");

    post.status = "published";
    post.publishedAt = new Date().toISOString();
    post.noteUrl = "https://creator.xiaohongshu.com/new/note-manager";
    post.error = null;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    report({ ok: true, post: post.id, title: post.title, publishedAt: post.publishedAt });
    await task.finish({ keep: [] });
  } catch (e) {
    await fail(String(e).slice(0, 300));
  }
})();

// 渲染卡片：ego-browser nodejs < render-cards.js
// 输入契约：/tmp/xhs-render-list.json（由 build-cards.mjs 写出），每项 {html, out} 绝对路径。
// 输出：1242×1660 PNG（621×830 CSS @ deviceScaleFactor 2）。
(async () => {
  const { readFile, writeFile } = await import("node:fs/promises");
  const { pathToFileURL } = await import("node:url");
  const list = JSON.parse(await readFile("/tmp/xhs-render-list.json", "utf8"));
  const task = await taskSpace("render xhs cards");
  const page = task.page("p1");
  await page.cdp("Emulation.setDeviceMetricsOverride", { width: 621, height: 830, deviceScaleFactor: 2, mobile: false });
  const failed = [];
  for (const item of list) {
    try {
      await page.goto(pathToFileURL(item.html).href, { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => window.__cardReady === true, undefined, { timeout: 25000 });
      await page.waitForTimeout(150);
      const shot = await page.cdp("Page.captureScreenshot", { format: "png" });
      await writeFile(item.out, Buffer.from(shot.data, "base64"));
      console.log("ok", item.out.split("/").slice(-2).join("/"));
    } catch (e) {
      failed.push(item.out);
      console.log("FAIL", item.out.split("/").slice(-2).join("/"), String(e).slice(0, 120));
    }
  }
  console.log(JSON.stringify({ total: list.length, failed: failed.length }));
  await task.finish({ keep: [] });
})();

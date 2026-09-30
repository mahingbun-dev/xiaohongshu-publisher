# 定时发布队列：manifest 与 CronCreate 模板

> 平台注记：本文流程依赖 Ego Lite，仅 macOS 可用；Windows 上需登录态的浏览器操作改走 ego-browser skill 的 Windows path 章节（接管用户 Chrome 复用登录态）；两个 .mjs 脚本（`publish-note.mjs` / `scrape-benchmark.mjs`）在 Windows 上会被平台守卫拦截（exit 1）。

## manifest.json 完整示例

发布队列的唯一事实源。发布时不解析 copy.md，所有发布所需字段都在 manifest 里：

```json
{
  "series": "系列名",
  "createdAt": "2026-09-28",
  "schedule": "每 3 小时发布一篇（第 1 篇人工确认后即时发布）",
  "posts": [
    {
      "id": "01",
      "dir": "01-篇名目录",
      "title": "≤20 字标题",
      "body": "完整正文，含换行 \\n 和文末 #话题 #标签，发布时原样粘贴",
      "images": [
        "01-篇名目录/cards/1-cover.png",
        "01-篇名目录/cards/2-xxx.png",
        "01-篇名目录/cards/3-xxx.png",
        "01-篇名目录/cards/4-recap.png"
      ],
      "status": "pending",
      "publishedAt": null,
      "noteUrl": null,
      "error": null
    }
  ]
}
```

- `images` 相对于系列根目录，数组顺序 = 笔记页序，第 1 张是封面。
- 成功 → `status: "published"` + `publishedAt`（ISO 8601 含时区）+ `noteUrl`；失败 → status 保持 `pending`，原因写 `error`。

## CronCreate 参数

- `title`：保留用户原话节奏，如「XX系列·3个小时发一篇」。
- `recurring: false`，`maxRuns: 剩余篇数`（首篇已即时发则 = 总篇数 − 1）。
- `cron`：用**显式小时列表**而非 interval。例：首篇 14:51 发布、每 3 小时一篇、共 5 篇 → `cron: "51 2,5,17,20,23 * * *"`，触发 17:51 / 20:51 / 23:51 / 次日 02:51 / 05:51。interval 语义的锚点时刻有歧义，可能首触发只隔 1 小时，不要用。
- 深夜轮次触达率低，创建前向用户说明锚点，可调。

## CronCreate prompt 模板（自包含，占位符替换后使用）

```
发布 <系列名> 小红书系列的下一篇笔记（每轮只发一篇）。

1. 读取 <seriesRoot>/manifest.json，按 posts 数组顺序找到第一篇 status 为 "pending" 的笔记；
   若没有 pending 篇目，报告「系列已全部发布完成」并结束。
   若数组中该 pending 篇的前一项也还是 pending（上一轮失败未补上），只报告现状不发布，避免跳篇。
2. 用 ego-browser 发布（先读 ego-browser Skill，严格使用其列出的 API）：
   a. taskSpace 创建空间，page 打开 https://creator.xiaohongshu.com/publish/publish?source=official
   b. 若出现登录页或未登录：task.handOff() 结束本轮，报告「需要用户在 Ego Lite 登录小红书后重试」，不要反复重试。
   c. 默认在「上传视频」页签：page.evaluate 对第一个 childElementCount===0、
      textContent.trim()==="上传图文" 且可见的元素执行 .click()（页面有 3 个同名元素，
      ref/文本选择器会歧义失败），等待 URL 出现 from=tab_switch。
   d. page.setInputFiles("input[type=file]", [4 张图片绝对路径])；
      路径 = <seriesRoot>/ + manifest 该篇 images 各项（顺序即数组顺序，第 1 张是封面）。
      等待 .tiptap.ProseMirror 出现确认上传完成。
   e. page.fill('input[placeholder*="标题"]', post.title)（不要改写）。
   f. page.click(".tiptap.ProseMirror") 后 page.keyboard.paste(post.body)（不要改动内容）。
      若出现话题联想下拉框（遮挡发布按钮），按 Escape 关闭。
   g. snapshot 找文本为「发布」的 button 并点击；若报 div 拦截，先 Escape 再试，必要时 force。
      等待 URL 跳转到 /publish/success 即成功。
   h. 成功后打开 https://creator.xiaohongshu.com/new/note-manager 核对该篇标题并记录发布时间。
3. 成功：该篇 status 改 "published"，publishedAt 写当前时间（ISO 8601 含时区），
   noteUrl 填 https://creator.xiaohongshu.com/new/note-manager，保存 manifest.json，
   报告「已发布第 N/<总篇数> 篇 + 标题 + 发布时间」。
4. 失败：status 保持 "pending"，失败原因写入该篇 error 字段并保存 manifest.json，
   报告失败详情后结束本轮；页面级操作重试最多一次，下一轮会自动重试同一篇。
5. 忽略 [ego-browser:notice] 升级提示，绝不运行 ego-browser upgrade。
```

## 多系列注意

- 一个自动化绑定一个 manifest；新系列复制模板改路径，不要让两个自动化写同一个 manifest。
- 检查既有自动化：CronList 查看；调整节奏用 CronUpdate（title 必须同步改）。

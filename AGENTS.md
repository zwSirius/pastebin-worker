# AGENTS.md

面向 AI 智能体的项目约定。改动代码前请先阅读本文件。

## 功能变更必须同步更新文档（硬性要求）

任何用户可见的功能变更（新增/修改表单字段、请求头、状态码、路由行为、界面文案所描述的行为），必须同步更新以下文档后再提交：

| 文档 | 覆盖内容 |
|---|---|
| `doc/skill.md` | AI 智能体接口摘要：上传字段、各分享链接（原始/`/d/`/`/a/`/`/u/`）对浏览器和 API 客户端分别的行为、受保护粘贴的请求头与流程 |
| `doc/api.md` | HTTP API 参考：字段、请求头、状态码、路由语义 |
| `doc/curl.md` | curl 使用指南与常见错误 |
| `scripts/README.md` | `pb` CLI 的选项说明 |
| `scripts/_pb`、`scripts/pb.fish` | CLI 补全（新增/改名选项时三处同改） |
| `CHANGELOG.md` | 按日期追加变更记录 |
| `README.md` | 功能列表（新增可对外宣称的能力时） |
| `frontend/pages/PasteBin.tsx` 首页文案 | 面向终端用户的行为说明 |

规则：

- 改了行为就要改文档，即使只是"浏览器打开的表现"与"API 返回"的差异（本项目两者常不一致，见 `handleRead.ts` 中的浏览器导航分支）。
- 界面文案（标签、提示语）若描述了某项行为，该行为变化时文案与文档一起改。
- 提交信息使用 conventional 风格（`feat:` / `fix:` / `docs:` / `chore:`），文档同步可以并入功能提交，也可以单独 `docs:` 提交。

## 提交前验证

至少运行 `pnpm typecheck && pnpm vitest run`；涉及 worker 打包的改动再跑 `pnpm build`，前端改动跑 `pnpm build:frontend`。

## 平台注意事项

- Windows 工作区为 CRLF、仓库内为 LF（`core.autocrlf=true`），prettier 已配置 `endOfLine: "auto"`；不要提交纯行尾归一化的改动。
- `wrangler.test.toml` 与 `wrangler.toml` 的 `DISALLOWED_MIME_FOR_PASTE` 不同（测试环境额外禁 `text/html`），写涉及 Content-Type 的测试时注意区分。
- 仓库根目录的 `.ua/` 为外部工具残留目录，与本仓库无关，不要提交、不要清理它。

import { escapeHtml } from "../common.js"

// Small self-contained page served when a browser opens the URL of a
// password-protected paste without the share key. After the visitor enters
// the key, the page re-fetches the same URL with the X-PB-Share-Passwd
// header and then, depending on where it was served and the content type,
// renders the content the same way the /d/ display page would:
//  - "article" (the /a/ markdown render): the response is the server-rendered
//    markdown document, which replaces this document in full.
//  - "raw" (the paste content URL): markdown content re-fetches the /a/
//    render with the same key and takes over its server-rendered document,
//    so sharing the raw link behaves exactly like sharing the /a/ link;
//    HTML renders in a full-viewport sandboxed iframe — the content is
//    untrusted user HTML, so unlike the markdown page it must stay in an
//    isolated origin instead of being written into this document; images
//    and media render inline; other text shows as plain text; binary
//    content downloads.
export function renderShareKeyPrompt(env: Env, name: string, mode: "article" | "raw"): string {
  const title = escapeHtml(`${env.INDEX_PAGE_TITLE} / ${name}`)
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #f4f4f5; color: #18181b; }
  @media (prefers-color-scheme: dark) { body { background: #18181b; color: #fafafa; } }
  .card { width: min(24rem, calc(100vw - 2rem)); padding: 2rem; border-radius: 1rem; background: #ffffff; box-shadow: 0 1px 3px rgba(0,0,0,0.12); box-sizing: border-box; }
  @media (prefers-color-scheme: dark) { .card { background: #27272a; } }
  h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
  p { font-size: 0.9rem; margin: 0 0 1.25rem; opacity: 0.75; }
  .row { display: flex; gap: 0.5rem; }
  input { flex: 1; min-width: 0; padding: 0.5rem 0.75rem; border-radius: 0.5rem; border: 1px solid #d4d4d8; font-size: 0.95rem; background: transparent; color: inherit; box-sizing: border-box; }
  @media (prefers-color-scheme: dark) { input { border-color: #52525b; } }
  button { padding: 0.5rem 1rem; border-radius: 0.5rem; border: 0; background: #2563eb; color: #ffffff; font-size: 0.95rem; cursor: pointer; }
  button:disabled { opacity: 0.5; cursor: default; }
  .error { color: #dc2626; font-size: 0.85rem; margin: 0.75rem 0 0; }
  .notice { font-size: 0.85rem; margin: 0.75rem 0 0; }
  pre.view { white-space: pre-wrap; word-break: break-all; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; background: rgba(127,127,127,0.12); padding: 1rem; border-radius: 0.5rem; max-height: 70vh; overflow: auto; }
  iframe.view { position: fixed; inset: 0; width: 100vw; height: 100vh; border: 0; background: #ffffff; }
  img.view { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: contain; background: #111111; }
  video.view { position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: contain; background: #000000; }
  audio.view { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(32rem, 90vw); }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<div class="card" id="gate-card">
  <h1>该内容已开启加密分享</h1>
  <p>输入正确的密钥后即可查看内容。</p>
  <form class="row" id="unlock-form">
    <input id="share-key" type="text" placeholder="分享密钥" autocomplete="off" autofocus required />
    <button id="unlock-btn" type="submit">解锁</button>
  </form>
  <p class="error" id="unlock-error" hidden></p>
</div>
<script>
(() => {
  const MODE = ${JSON.stringify(mode)}
  const gateCard = document.getElementById("gate-card")
  const form = document.getElementById("unlock-form")
  const input = document.getElementById("share-key")
  const button = document.getElementById("unlock-btn")
  const error = document.getElementById("unlock-error")
  const reset = () => {
    button.disabled = false
    button.textContent = "解锁"
  }
  const fail = (message) => {
    error.textContent = message
    error.hidden = false
    reset()
  }
  const defaultFilename = () => {
    try {
      return decodeURIComponent(location.pathname.split("/").pop() || "") || "download"
    } catch {
      return "download"
    }
  }
  const showIframe = (html) => {
    const frame = document.createElement("iframe")
    frame.className = "view"
    frame.sandbox = "allow-scripts allow-forms allow-popups"
    frame.srcdoc = html
    frame.title = "内容视图"
    document.body.replaceChildren(frame)
  }
  const showText = (text) => {
    const pre = document.createElement("pre")
    pre.className = "view"
    pre.textContent = text
    gateCard.replaceChildren(pre)
  }
  const showMedia = (url, tag) => {
    const el = document.createElement(tag)
    el.className = "view"
    el.src = url
    if (tag !== "img") el.controls = true
    document.body.replaceChildren(el)
  }
  const download = (blob) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = defaultFilename()
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    gateCard.replaceChildren(Object.assign(document.createElement("p"), { className: "notice", textContent: "已开始下载。" }))
  }
  form.addEventListener("submit", async (e) => {
    e.preventDefault()
    const key = input.value
    if (!key || button.disabled) return
    button.disabled = true
    button.textContent = "验证中…"
    error.hidden = true
    try {
      const resp = await fetch(location.pathname + location.search, {
        headers: { "X-PB-Share-Passwd": key },
      })
      if (resp.status === 403) {
        fail("密钥不正确，请重试")
        return
      }
      if (!resp.ok) {
        fail("加载失败（HTTP " + resp.status + "）")
        return
      }
      if (MODE === "article") {
        const html = await resp.text()
        document.open()
        document.write(html)
        document.close()
        return
      }
      const contentType = (resp.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase()
      const highlightLang = resp.headers.get("X-PB-Highlight-Language") || ""
      if (MODE === "raw" && (contentType === "text/markdown" || highlightLang === "markdown")) {
        // Markdown: take over the server-rendered /a/ document so the raw
        // link reads exactly like the /a/ link. The key is already validated
        // for this paste, so /a/ answers without prompting again.
        const rendered = await fetch("/a" + location.pathname + location.search, {
          headers: { "X-PB-Share-Passwd": key },
        })
        if (rendered.ok) {
          const html = await rendered.text()
          document.open()
          document.write(html)
          document.close()
          return
        }
      }
      if (contentType === "text/html") {
        showIframe(await resp.text())
        return
      }
      const blob = await resp.blob()
      if (contentType.startsWith("image/")) {
        showMedia(URL.createObjectURL(blob), "img")
        return
      }
      if (contentType.startsWith("audio/") || contentType.startsWith("video/")) {
        showMedia(URL.createObjectURL(blob), contentType.startsWith("video/") ? "video" : "audio")
        return
      }
      if (contentType.startsWith("text/")) {
        showText(await blob.text())
        return
      }
      download(blob)
    } catch (err) {
      fail("加载失败：" + err)
    }
  })
})()
</script>
</body>
</html>
`
}

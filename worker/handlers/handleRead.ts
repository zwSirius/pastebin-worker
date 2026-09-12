import { decode, timingSafeEqual, WorkerError, escapeHtml } from "../common.js"
import { isLegalUrl } from "../../shared/verify.js"
import { getDocMarkdown, getCurlIndexMarkdown, renderDocAsHtml } from "../pages/docs.js"
import { verifyAuth } from "../pages/auth.js"
import mime from "mime"
import { makeMarkdown } from "../pages/markdown.js"
import type { PasteMetadata, PasteWithMetadata } from "../storage/storage.js"
import { getPaste, getPasteMetadata, metaResponseFromMetadata } from "../storage/storage.js"
import { parsePath } from "../../shared/parsers.js"
import { MAX_URL_REDIRECT_LEN } from "../../shared/constants.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { getAssetPaths, renderCssLinks, DARK_MODE_SCRIPT } from "../ssrUtils.js"
import { renderShareKeyPrompt } from "../pages/shareKeyPrompt.js"

type Headers = Record<string, string>

async function decodeMaybeStream(content: ArrayBuffer | ReadableStream): Promise<string> {
  if (content instanceof ArrayBuffer) {
    return decode(content)
  } else {
    const reader = content.pipeThrough(new TextDecoderStream()).getReader()
    let result = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      result += value
    }
    return result
  }
}

function staticPageCacheHeader(env: Env): Headers {
  const age = env.CACHE_STATIC_PAGE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function pasteCacheHeader(env: Env): Headers {
  const age = env.CACHE_PASTE_AGE
  return age ? { "Cache-Control": `public, max-age=${age}` } : {}
}

function lastModifiedHeader(metadata: PasteMetadata): Headers {
  const lastModified = metadata.lastModifiedAtUnix
  return lastModified ? { "Last-Modified": new Date(lastModified * 1000).toUTCString() } : {}
}

function isCurlAgent(request: Request): boolean {
  const ua = request.headers.get("User-Agent") || ""
  return ua.toLowerCase().startsWith("curl/")
}

// Whether this request is a top-level browser navigation. Modern browsers
// send Sec-Fetch-Mode: navigate (a forbidden header fetch() cannot fake), and
// navigations also carry an Accept header preferring text/html. curl and
// other API clients send neither, so they keep getting the bare 403.
function isBrowserNavigation(request: Request): boolean {
  if (request.headers.get("Sec-Fetch-Mode") === "navigate") return true
  return (request.headers.get("Accept") ?? "").includes("text/html")
}

async function handleStaticPages(request: Request, env: Env, _: ExecutionContext): Promise<Response | null> {
  const url = new URL(request.url)
  const isCurl = isCurlAgent(request)

  // Serve doc/index.md as plain markdown for curl on "/" or anyone on "/index.md"
  if ((url.pathname === "/" && isCurl) || url.pathname === "/index.md") {
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
    return new Response(getCurlIndexMarkdown(env), {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        Vary: "User-Agent",
        ...staticPageCacheHeader(env),
      },
    })
  }

  let path = url.pathname
  if (path.endsWith("/")) {
    path += "index.html"
  } else if (path.endsWith("/index")) {
    path += ".html"
  } else if (path.lastIndexOf("/") === 0 && path.indexOf(":") > 0) {
    path = "/index.html" // handle admin URL
  }

  // Handle index.html with SSR
  if (path === "/index.html") {
    // Auth check
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }

    // Try SSR
    try {
      const { renderIndexPage } = await import("../pages/index.js")
      const page = await renderIndexPage(env, url.pathname)
      if (page) {
        return new Response(page, {
          headers: {
            "Content-Type": "text/html;charset=UTF-8",
            ...staticPageCacheHeader(env),
          },
        })
      }
      // SSR skipped (admin URL), continue to CSR fallback
    } catch (e) {
      console.error("SSR failed for index page, falling back to CSR:", e)
    }

    // CSR fallback: dynamically generate empty HTML shell
    const { jsFile, cssPaths } = getAssetPaths(manifest, "index.html")

    return new Response(
      `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<link rel="icon" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(env.INDEX_PAGE_TITLE)}</title>
${renderCssLinks(cssPaths)}
<script>
${DARK_MODE_SCRIPT}
</script>
<script>window.__WRANGLER_CONFIG__=${JSON.stringify(env)}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`,
      {
        headers: {
          "Content-Type": "text/html;charset=UTF-8",
          ...staticPageCacheHeader(env),
        },
      },
    )
  }

  // Handle other static assets
  if (path.startsWith("/assets/") || path === "/favicon.ico") {
    const assetsUrl = url
    assetsUrl.pathname = path
    const resp = await env.ASSETS.fetch(assetsUrl)
    if (resp.status === 404) {
      throw new WorkerError(404, `找不到资源 '${path}'`)
    } else {
      const pageMime = mime.getType(path) || "text/plain"
      return new Response(await resp.blob(), {
        headers: {
          "Content-Type": `${pageMime};charset=UTF-8`,
          ...staticPageCacheHeader(env),
        },
      })
    }
  }

  if (url.pathname === "/doc" || url.pathname.startsWith("/doc/")) {
    const isExplicitMd = url.pathname.endsWith(".md")
    const lookupPath = isExplicitMd ? url.pathname.slice(0, -3) : url.pathname
    const docMd = getDocMarkdown(lookupPath, env)
    if (docMd !== null) {
      const wantsMarkdown = isExplicitMd || isCurl
      return new Response(wantsMarkdown ? docMd : renderDocAsHtml(docMd), {
        headers: {
          "Content-Type": wantsMarkdown ? "text/plain;charset=UTF-8" : "text/html;charset=UTF-8",
          Vary: "User-Agent",
          ...staticPageCacheHeader(env),
        },
      })
    }
    throw new WorkerError(404, `找不到文档页面 '${url.pathname}'`)
  }

  return null
}

async function getPasteWithoutContent(env: Env, name: string): Promise<PasteWithMetadata | null> {
  const metadata = await getPasteMetadata(env, name)
  return metadata && { paste: new ArrayBuffer(), metadata }
}

export async function handleGet(request: Request, env: Env, ctx: ExecutionContext, isHead: boolean): Promise<Response> {
  // TODO: handle etag
  const staticPageResp = await handleStaticPages(request, env, ctx)
  if (staticPageResp !== null) {
    return staticPageResp
  }

  const url = new URL(request.url)

  const { role, name, ext, filename } = parsePath(url.pathname)

  const disp = url.searchParams.has("a") ? "attachment" : "inline"

  // when not isHead, always need to get paste unless "m"
  // when isHead, no need to get paste unless "u"
  const shouldGetPasteContent = (!isHead && role !== "m") || (isHead && role === "u")

  const item: PasteWithMetadata | null = shouldGetPasteContent
    ? await getPaste(env, name, ctx)
    : await getPasteWithoutContent(env, name)

  // when paste is not found
  if (item === null) {
    throw new WorkerError(404, `找不到名为 '${name}' 的粘贴`)
  }

  // password gate for share-key-protected pastes: raw content and URL
  // redirect require the key (sent via the X-PB-Share-Passwd header). The
  // display page ("d"), metadata ("m") and the markdown render page ("a",
  // which serves its own key prompt) stay accessible so clients can ask
  // for the key.
  if (item.metadata.sharePasswd && role !== "d" && role !== "m" && role !== "a") {
    const provided = request.headers.get("X-PB-Share-Passwd")
    if (provided === null && role === undefined && !isHead && isBrowserNavigation(request)) {
      // Browser opening the content URL directly: serve a key prompt page
      // instead of a bare 403 — the same flow as the /a/ markdown render.
      return new Response(isHead ? null : renderShareKeyPrompt(env, name, "raw"), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "no-store" },
      })
    }
    if (!timingSafeEqual(provided ?? "", item.metadata.sharePasswd)) {
      throw new WorkerError(403, "该粘贴受密钥保护，请在请求头 X-PB-Share-Passwd 中提供正确的分享密钥")
    }
  }

  // protected content must not be cached: it is key-gated, and a shared
  // cache entry would bypass the check for whoever hits the same URL next
  const cacheHeaders: Headers = item.metadata.sharePasswd ? { "Cache-Control": "no-store" } : pasteCacheHeader(env)

  const disallowedMimes = env.DISALLOWED_MIME_FOR_PASTE as readonly string[]
  const sanitize = (m: string) => (disallowedMimes.includes(m) ? "text/plain;charset=UTF-8" : m)

  const realMime =
    url.searchParams.get("mime") ||
    (ext && mime.getType(ext)) ||
    (item.metadata.filename && mime.getType(item.metadata.filename)) ||
    "text/plain;charset=UTF-8"

  let inferred_mime = item.metadata.encryptionScheme
    ? url.searchParams.get("mime") || (ext && mime.getType(ext)) || "application/octet-stream"
    : realMime
  inferred_mime = sanitize(inferred_mime)

  const decryptedContentType = item.metadata.encryptionScheme ? sanitize(realMime) : null

  // check `if-modified-since`
  const pasteLastModifiedUnix = item.metadata.lastModifiedAtUnix
  const headerModifiedSince = request.headers.get("If-Modified-Since")
  if (headerModifiedSince) {
    const headerModifiedSinceUnix = Date.parse(headerModifiedSince) / 1000
    if (pasteLastModifiedUnix <= headerModifiedSinceUnix) {
      return new Response(null, {
        status: 304, // Not Modified
        headers: lastModifiedHeader(item.metadata),
      })
    }
  }

  // determine filename with priority: url path > meta
  let returnFilename = filename || item.metadata?.filename
  if (returnFilename && !filename && item.metadata.encryptionScheme) {
    returnFilename = returnFilename + ".encrypted" // to avoid clients choose open method with extension
  }

  // handle URL redirection
  if (role === "u") {
    if (item.metadata.sizeBytes > MAX_URL_REDIRECT_LEN) {
      throw new WorkerError(400, `URL 太长，无法重定向（最大 ${MAX_URL_REDIRECT_LEN} 字节）`)
    }
    const redirectURL = await decodeMaybeStream(item.paste)
    if (isLegalUrl(redirectURL)) {
      return Response.redirect(redirectURL)
    } else {
      throw new WorkerError(400, "无法将粘贴内容解析为合法 URL")
    }
  }

  // handle article (render as markdown)
  if (role === "a") {
    const sharePasswd = item.metadata.sharePasswd
    if (sharePasswd) {
      const provided = request.headers.get("X-PB-Share-Passwd")
      if (provided !== null && !timingSafeEqual(provided, sharePasswd)) {
        throw new WorkerError(403, "该粘贴受密钥保护，请在请求头 X-PB-Share-Passwd 中提供正确的分享密钥")
      }
      if (provided === null) {
        // Browser without the key: serve a small prompt page that re-fetches
        // this URL with the key once entered. curl and other API clients get
        // the usual 403 with a header hint instead.
        if (!isBrowserNavigation(request)) {
          throw new WorkerError(403, "该粘贴受密钥保护，请在请求头 X-PB-Share-Passwd 中提供正确的分享密钥")
        }
        return new Response(isHead ? null : renderShareKeyPrompt(env, name, "article"), {
          headers: {
            "Content-Type": `text/html;charset=UTF-8`,
            ...cacheHeaders,
          },
        })
      }
    }
    return new Response(shouldGetPasteContent ? makeMarkdown(await decodeMaybeStream(item.paste)) : null, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...cacheHeaders,
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle metadata access
  if (role === "m") {
    const returnedMetadata = metaResponseFromMetadata(item.metadata)
    return new Response(isHead ? null : JSON.stringify(returnedMetadata, null, 2), {
      headers: {
        "Content-Type": `application/json;charset=UTF-8`,
        ...pasteCacheHeader(env),
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle display page with SSR
  if (role === "d") {
    try {
      const { renderDisplayPage } = await import("../pages/display.js")
      const page = await renderDisplayPage(env, name, filename, ext, item.paste, item.metadata)
      if (page) {
        return new Response(isHead ? null : page, {
          headers: {
            "Content-Type": `text/html;charset=UTF-8`,
            ...cacheHeaders,
            ...lastModifiedHeader(item.metadata),
          },
        })
      }
      // SSR skipped (encrypted file), fall through to CSR
    } catch (e) {
      console.error("SSR failed, falling back to CSR:", e)
    }
    // CSR fallback
    const pageUrl = url
    pageUrl.search = ""
    pageUrl.pathname = "/display.html"
    // hide the filename of a password-protected paste until it is unlocked
    const titleName = item.metadata.sharePasswd
      ? name
      : name +
        (filename ? " / " + filename : ext ? ext : item.metadata.filename ? " / " + item.metadata.filename : "")
    const page = decode(await (await env.ASSETS.fetch(pageUrl)).arrayBuffer()).replace("{{PASTE_NAME}}", titleName)
    return new Response(isHead ? null : page, {
      headers: {
        "Content-Type": `text/html;charset=UTF-8`,
        ...cacheHeaders,
        ...lastModifiedHeader(item.metadata),
      },
    })
  }

  // handle default
  const headers: Headers = {
    "Content-Type": `${inferred_mime}`,
    ...cacheHeaders,
    ...lastModifiedHeader(item.metadata),
  }

  // sandbox rendered HTML pastes: the browser auto-attaches this site's basic-auth
  // credentials to same-origin requests, so untrusted HTML must not run same-origin
  if (inferred_mime.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "sandbox allow-scripts allow-forms allow-popups"
  }

  const exposeHeaders = ["Content-Disposition"]

  if (item.metadata.encryptionScheme) {
    headers["X-PB-Encryption-Scheme"] = item.metadata.encryptionScheme
    exposeHeaders.push("X-PB-Encryption-Scheme")
    if (decryptedContentType !== null) {
      headers["X-PB-Decrypted-Content-Type"] = decryptedContentType
      exposeHeaders.push("X-PB-Decrypted-Content-Type")
    }
  }

  if (item.metadata.highlightLanguage) {
    headers["X-PB-Highlight-Language"] = item.metadata.highlightLanguage
    exposeHeaders.push("X-PB-Highlight-Language")
  }

  if (item.httpEtag) {
    headers.etag = item.httpEtag
  }

  if (returnFilename) {
    const encodedFilename = encodeURIComponent(returnFilename)
    headers["Content-Disposition"] = `${disp}; filename*=UTF-8''${encodedFilename}`
  } else {
    headers["Content-Disposition"] = `${disp}`
  }
  headers["Access-Control-Expose-Headers"] = exposeHeaders.join(", ")

  // if content is nonempty, Content-Length will be set automatically
  if (!shouldGetPasteContent) {
    headers["Content-Length"] = item.metadata.sizeBytes.toString()
  }
  return new Response(shouldGetPasteContent ? item.paste : null, { headers })
}

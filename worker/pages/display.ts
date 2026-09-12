import { renderToReadableStream } from "react-dom/server.edge"
import React from "react"
import { DisplayPasteView } from "../../frontend/pages/DisplayPasteView.js"
import type { PasteMetadata } from "../storage/storage.js"
import { metaResponseFromMetadata } from "../storage/storage.js"
import type { SerializedPasteData } from "../../shared/interfaces.js"
import { decode, escapeHtml } from "../common.js"
import manifest from "../../dist/frontend/.vite/ssr-manifest.json"
import { detectUtf8 } from "../../shared/encoding.js"
import { getAssetPaths, renderCssLinks, DARK_MODE_SCRIPT, MAX_SSR_FILE_SIZE } from "../ssrUtils.js"

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result.buffer
}

async function streamToHtml(reactElement: React.ReactElement): Promise<string> {
  const stream = await renderToReadableStream(reactElement)
  const reader = stream.getReader() as ReadableStreamDefaultReader<Uint8Array>
  let html = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    html += decode(value.buffer as ArrayBuffer)
  }
  return html
}

function displayHtml(env: Env, titleName: string, html: string, serializedData: SerializedPasteData): string {
  const { jsFile, cssPaths } = getAssetPaths(manifest, "display.html")

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<link rel="icon" href="/favicon.ico" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(env.INDEX_PAGE_TITLE)} / ${escapeHtml(titleName)}</title>
${renderCssLinks(cssPaths)}
<script>
${DARK_MODE_SCRIPT}
</script>
</head>
<body>
<div id="root">${html}</div>
<script id="__PASTE_DATA__" type="application/json">${JSON.stringify(serializedData)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029")}</script>
<script>window.__PASTE_DATA__=JSON.parse(document.getElementById('__PASTE_DATA__').textContent)</script>
<script type="module" src="/${jsFile}"></script>
</body>
</html>`
}

function displayConfig(env: Env): Env {
  return {
    DEPLOY_URL: env.DEPLOY_URL,
    REPO: env.REPO,
    MAX_EXPIRATION: env.MAX_EXPIRATION,
    DEFAULT_EXPIRATION: env.DEFAULT_EXPIRATION,
    INDEX_PAGE_TITLE: env.INDEX_PAGE_TITLE,
  } as Env
}

export async function renderDisplayPage(
  env: Env,
  name: string,
  urlFilename: string | undefined,
  urlExt: string | undefined,
  paste: ArrayBuffer | ReadableStream<Uint8Array>,
  metadata: PasteMetadata,
): Promise<string | null> {
  const config = displayConfig(env)

  // Password-protected pastes: render only the shell with a password prompt
  // and never embed content — the client fetches it after the password check.
  // The filename is hidden too, so the title shows the name only.
  if (metadata.sharePasswd) {
    const serializedData: SerializedPasteData = { passwordProtected: true, name }
    const reactElement = React.createElement(
      React.StrictMode,
      null,
      React.createElement(DisplayPasteView, {
        isFileBinary: false,
        guessedEncoding: null,
        isDecrypted: "protected",
        forceShowBinary: false,
        setForceShowBinary: () => {
          // SSR: no-op
        },
        isLoading: false,
        name,
        ext: urlExt,
        config,
        passwordPrompt: { error: null, pending: false },
        onPasswordSubmit: () => {
          // SSR: no-op
        },
      }),
    )
    return displayHtml(env, name, await streamToHtml(reactElement), serializedData)
  }

  // Skip SSR for encrypted files (client needs hash key to decrypt)
  if (metadata.encryptionScheme) {
    return null
  }

  // Skip SSR for large files (>1MB) to avoid memory/CPU overhead
  if (metadata.sizeBytes > MAX_SSR_FILE_SIZE) {
    return null
  }

  const content = paste instanceof ArrayBuffer ? paste : await streamToArrayBuffer(paste)

  const encoding = detectUtf8(new Uint8Array(content))
  const isBinary = encoding === null

  const contentBase64 = arrayBufferToBase64(content)

  const metaResponse = metaResponseFromMetadata(metadata)

  const serializedData: SerializedPasteData = {
    content: contentBase64,
    metadata: metaResponse,
    name,
    isBinary,
    guessedEncoding: encoding,
  }

  const inferredFilename = urlFilename || (urlExt && name + urlExt) || metadata.filename || name
  const pasteFile = new File([content], inferredFilename)
  const titleName =
    name + (urlFilename ? " / " + urlFilename : urlExt ? urlExt : metadata.filename ? " / " + metadata.filename : "")

  const reactElement = React.createElement(
    React.StrictMode,
    null,
    React.createElement(DisplayPasteView, {
      pasteFile,
      pasteContentBuffer: new Uint8Array(content),
      pasteLang: metadata.highlightLanguage,
      isFileBinary: isBinary,
      guessedEncoding: encoding,
      isDecrypted: "not encrypted",
      forceShowBinary: false,
      setForceShowBinary: () => {
        // SSR: no-op
      },
      isLoading: false,
      name,
      ext: urlExt,
      filename: urlFilename,
      config,
    }),
  )

  return displayHtml(env, titleName, await streamToHtml(reactElement), serializedData)
}

import { expect, test } from "vitest"
import {
  addRole,
  areBlobsEqual,
  BASE_URL,
  genRandomBlob,
  RAND_NAME_REGEX,
  upload,
  uploadExpectStatus,
  workerFetch,
} from "./testUtils.js"
import { createExecutionContext, env } from "cloudflare:test"
import type { MetaResponse } from "../../shared/interfaces.js"
import { MAX_PASSWD_LEN, MIN_PASSWD_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"
import { parseExpiration } from "../../shared/parsers.js"

test("privacy url with option p", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // upload
  const responseJson = await upload(ctx, { c: blob1, p: "1" })

  // check url
  const url = responseJson.url
  expect(url.startsWith(BASE_URL))

  // check name
  const name = url.slice(BASE_URL.length + 1)
  expect(name.length).toStrictEqual(PRIVATE_PASTE_NAME_LEN)
  expect(RAND_NAME_REGEX.test(name))

  // check revisit
  const revisitSesponse = await workerFetch(ctx, url)
  expect(revisitSesponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitSesponse.blob(), blob1)).toStrictEqual(true)
})

test("expire with option e", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  async function testExpireParse(expire: string, expireSecs: number | null) {
    const responseJson = await upload(ctx, { c: blob1, e: expire })
    expect(responseJson.expirationSeconds).toStrictEqual(expireSecs)
  }

  const maxExpirationSeconds = parseExpiration(env.MAX_EXPIRATION)!
  const defaultExpirationSeconds = parseExpiration(env.DEFAULT_EXPIRATION)!
  await testExpireParse("1000", 1000)
  await testExpireParse("100m", 6000)
  await testExpireParse("100h", 360000)
  await testExpireParse("1d", 86400)
  await testExpireParse("100d", maxExpirationSeconds) // longer expiration will be clipped to 30d
  await testExpireParse("100  m", 6000)
  await testExpireParse("", defaultExpirationSeconds)

  const testFailParse = async (expire: string) => {
    await uploadExpectStatus(ctx, { c: blob1, e: expire }, 400)
  }

  await testFailParse("abc")
  await testFailParse("1c")
  await testFailParse("-100m")
})

test("custom path with option n", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check bad names
  const badNames = ["a", "ab", "..."]
  for (const name of badNames) {
    await uploadExpectStatus(ctx, { c: blob1, n: name }, 400)
  }

  // check good name upload
  const goodName = "goodName123+_-[]*$@,;"
  const uploadResponseJson = await upload(ctx, {
    c: blob1,
    n: goodName,
  })
  expect(uploadResponseJson.url).toStrictEqual(`${BASE_URL}/~${goodName}`)

  // check revisit
  const revisitResponse = await workerFetch(ctx, uploadResponseJson.url)
  expect(revisitResponse.status).toStrictEqual(200)
  expect(await areBlobsEqual(await revisitResponse.blob(), blob1)).toStrictEqual(true)
})

test("custom passwd with option s", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check good name upload
  const passwd = "1366eaa20c071763dc94"
  const wrongPasswd = "7365ca6eac619ca3f118"
  const uploadResponseJson = await upload(ctx, { c: blob1, s: passwd })
  const url = uploadResponseJson.url
  const manageUrl = uploadResponseJson.manageUrl
  const parsedPasswd = manageUrl.slice(manageUrl.lastIndexOf(":") + 1)
  expect(parsedPasswd).toStrictEqual(passwd)

  // check password format verification
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN - 1) }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MIN_PASSWD_LEN) + "\n" }, 400)
  await uploadExpectStatus(ctx, { c: blob1, s: "1".repeat(MAX_PASSWD_LEN + 1) }, 400)

  // check modify with wrong manageUrl
  await uploadExpectStatus(ctx, { c: blob1 }, 403, { method: "PUT", url: `${url}:${wrongPasswd}` })

  // check modify
  const putResponseJson = await upload(ctx, { c: blob1, s: wrongPasswd }, { method: "PUT", url: manageUrl })
  expect(putResponseJson.url).toStrictEqual(url) // url will not change
  expect(putResponseJson.manageUrl).toStrictEqual(`${url}:${wrongPasswd}`) // passwd may change
})

test("encryption with option encryption-scheme", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // check good name upload
  const uploadResponseJson = await upload(ctx, {
    c: { content: blob1, filename: "a.pdf" },
    "encryption-scheme": "AES-GCM",
  })
  const url = uploadResponseJson.url

  const fetchPaste = await workerFetch(ctx, url)
  await fetchPaste.bytes()
  expect(fetchPaste.headers.get("Content-Type")).toStrictEqual("application/octet-stream")
  expect(fetchPaste.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''a.pdf.encrypted")
  expect(fetchPaste.headers.get("X-PB-Encryption-Scheme")).toStrictEqual("AES-GCM")
  expect(fetchPaste.headers.get("X-PB-Decrypted-Content-Type")).toStrictEqual("application/pdf")
  const exposed = fetchPaste.headers.get("Access-Control-Expose-Headers") ?? ""
  expect(exposed.includes("X-PB-Encryption-Scheme")).toStrictEqual(true)
  expect(exposed.includes("X-PB-Decrypted-Content-Type")).toStrictEqual(true)

  // fetch with filename, now the content-disposition and content-type should be changed
  const fetchPasteWithFilename = await workerFetch(ctx, url + "/b.pdf")
  await fetchPasteWithFilename.bytes()
  expect(fetchPasteWithFilename.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''b.pdf")
  expect(fetchPasteWithFilename.headers.get("Content-Type")).toStrictEqual("application/pdf")
  expect(fetchPasteWithFilename.headers.get("X-PB-Decrypted-Content-Type")).toStrictEqual("application/pdf")

  // fetch with ext, now only the content-type is chaanged
  const fetchPasteWithExt = await workerFetch(ctx, url + ".pdf")
  await fetchPasteWithExt.bytes()
  expect(fetchPasteWithExt.headers.get("Content-Disposition")).toStrictEqual("inline; filename*=UTF-8''a.pdf.encrypted")
  expect(fetchPasteWithExt.headers.get("Content-Type")).toStrictEqual("application/pdf")
  expect(fetchPasteWithExt.headers.get("X-PB-Decrypted-Content-Type")).toStrictEqual("application/pdf")

  const fetchMeta: MetaResponse = await (await workerFetch(ctx, addRole(url, "m"))).json()
  expect(fetchMeta.encryptionScheme).toStrictEqual("AES-GCM")
})

test("share password protection with option share-passwd", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()

  // invalid share passwords are rejected
  await uploadExpectStatus(ctx, { c: blob1, "share-passwd": "123" }, 400)
  await uploadExpectStatus(ctx, { c: blob1, "share-passwd": "1".repeat(9) }, 400)

  const uploadResponseJson = await upload(ctx, { c: blob1, "share-passwd": "1234" })
  const url = uploadResponseJson.url

  // raw content requires the share password
  const noPasswd = await workerFetch(ctx, url)
  expect(noPasswd.status).toStrictEqual(403)
  const wrongPasswd = await workerFetch(ctx, new Request(url, { headers: { "X-PB-Share-Passwd": "9999" } }))
  expect(wrongPasswd.status).toStrictEqual(403)

  const rightPasswd = await workerFetch(ctx, new Request(url, { headers: { "X-PB-Share-Passwd": "1234" } }))
  expect(rightPasswd.status).toStrictEqual(200)
  expect(await areBlobsEqual(await rightPasswd.blob(), blob1)).toStrictEqual(true)

  // URL redirect role is gated as well
  const redirect = await workerFetch(ctx, addRole(url, "u"))
  expect(redirect.status).toStrictEqual(403)

  // display page stays accessible and renders the unlock prompt
  const display = await workerFetch(ctx, addRole(url, "d"))
  expect(display.status).toStrictEqual(200)
  const displayHtml = await display.text()
  expect(displayHtml.includes("该内容已开启加密分享")).toStrictEqual(true)
  expect(displayHtml.includes("分享密钥")).toStrictEqual(true)

  // metadata stays accessible and reports the protection
  const fetchMeta: MetaResponse = await (await workerFetch(ctx, addRole(url, "m"))).json()
  expect(fetchMeta.passwordProtected).toStrictEqual(true)

  // update without share-passwd keeps the protection
  await upload(ctx, { c: blob1 }, { method: "PUT", url: uploadResponseJson.manageUrl })
  const afterUpdate = await workerFetch(ctx, url)
  expect(afterUpdate.status).toStrictEqual(403)
})

test("share password on markdown render page /a/", async () => {
  const ctx = createExecutionContext()
  const md = "# hello\n\nworld"

  const uploadResponseJson = await upload(ctx, { c: md, "share-passwd": "1234" })
  const url = uploadResponseJson.url

  // browser without key gets the prompt page
  const prompt = await workerFetch(
    ctx,
    new Request(addRole(url, "a"), { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } }),
  )
  expect(prompt.status).toStrictEqual(200)
  expect(prompt.headers.get("Content-Type")?.startsWith("text/html")).toStrictEqual(true)
  expect(prompt.headers.get("Cache-Control")).toStrictEqual("no-store")
  const promptHtml = await prompt.text()
  expect(promptHtml.includes("该内容已开启加密分享")).toStrictEqual(true)
  expect(promptHtml.includes("X-PB-Share-Passwd")).toStrictEqual(true)

  // wrong key -> 403
  const wrong = await workerFetch(ctx, new Request(addRole(url, "a"), { headers: { "X-PB-Share-Passwd": "9999" } }))
  expect(wrong.status).toStrictEqual(403)

  // right key -> server-rendered markdown
  const ok = await workerFetch(ctx, new Request(addRole(url, "a"), { headers: { "X-PB-Share-Passwd": "1234" } }))
  expect(ok.status).toStrictEqual(200)
  expect(ok.headers.get("Cache-Control")).toStrictEqual("no-store")
  const okHtml = await ok.text()
  expect(okHtml.includes("<h1")).toStrictEqual(true)
  expect(okHtml.includes("hello")).toStrictEqual(true)
})

test("share password prompt page on raw URL for browsers", async () => {
  const ctx = createExecutionContext()
  const html = "<h1>ok</h1>"

  const uploadResponseJson = await upload(ctx, {
    c: { content: new Blob([html]), filename: "page.html" },
    "share-passwd": "1234",
  })
  const url = uploadResponseJson.url

  // API-ish client without key -> 403 (no browser navigation markers)
  const noKey = await workerFetch(ctx, url)
  expect(noKey.status).toStrictEqual(403)

  // browser navigation without key -> prompt page
  const prompt = await workerFetch(
    ctx,
    new Request(url, { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } }),
  )
  expect(prompt.status).toStrictEqual(200)
  expect(prompt.headers.get("Cache-Control")).toStrictEqual("no-store")
  const promptHtml = await prompt.text()
  expect(promptHtml.includes("该内容已开启加密分享")).toStrictEqual(true)
  expect(promptHtml.includes('"raw"')).toStrictEqual(true)
  expect(promptHtml.includes("image/")).toStrictEqual(true)
  expect(promptHtml.includes('"/a"')).toStrictEqual(true)

  // correct key -> raw content served with no-store. (The test config
  // downgrades text/html to text/plain via DISALLOWED_MIME_FOR_PASTE; the
  // production config serves it as text/html with the sandbox CSP.)
  const ok = await workerFetch(ctx, new Request(url, { headers: { "X-PB-Share-Passwd": "1234" } }))
  expect(ok.status).toStrictEqual(200)
  expect(ok.headers.get("Cache-Control")).toStrictEqual("no-store")
  expect(await ok.text()).toStrictEqual(html)
})

test("markdown raw URL redirects browsers to the rendered article", async () => {
  const ctx = createExecutionContext()
  const md = "# hello\n\nworld"

  const uploadResponseJson = await upload(ctx, { c: { content: new Blob([md]), filename: "report.md" } })
  const url = uploadResponseJson.url
  const name = url.split("/").pop()!

  // API clients get the raw markdown source
  const raw = await workerFetch(ctx, url)
  expect(raw.status).toStrictEqual(200)
  expect(raw.headers.get("Content-Type")?.startsWith("text/markdown")).toStrictEqual(true)
  expect(await raw.text()).toStrictEqual(md)

  // browsers are redirected to the rendered article
  const redirected = await workerFetch(
    ctx,
    new Request(url, { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } }),
  )
  expect(redirected.status).toStrictEqual(302)
  expect(redirected.headers.get("Location")).toStrictEqual(`${BASE_URL}/a/${name}`)

  // explicit raw modifiers still serve raw content to browsers
  const attachment = await workerFetch(
    ctx,
    new Request(url + "?a", { headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" } }),
  )
  expect(attachment.status).toStrictEqual(200)
  expect(attachment.headers.get("Content-Type")?.startsWith("text/markdown")).toStrictEqual(true)

  // following the redirect renders the article
  const article = await workerFetch(ctx, addRole(url, "a"))
  expect(article.status).toStrictEqual(200)
  const articleHtml = await article.text()
  expect(articleHtml.includes("<h1")).toStrictEqual(true)
  expect(articleHtml.includes("hello")).toStrictEqual(true)
})

test("highlight with option lang", async () => {
  const blob1 = genRandomBlob(1024)
  const ctx = createExecutionContext()
  const lang = "cpp"

  const uploadResp = await upload(ctx, { c: blob1, lang: lang })
  const metaResp: MetaResponse = await (await workerFetch(ctx, addRole(uploadResp.url, "m"))).json()
  expect(metaResp.highlightLanguage).toStrictEqual(lang)

  const getResp = await workerFetch(ctx, uploadResp.url)
  expect(getResp.headers.get("X-PB-Highlight-Language")).toStrictEqual(lang)
  expect(getResp.headers.get("Access-Control-Expose-Headers")?.includes("X-PB-Highlight-Language")).toStrictEqual(true)
  expect(metaResp.highlightLanguage).toStrictEqual(lang)
})

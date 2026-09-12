import { describe, it, vi, expect, beforeAll, afterEach, afterAll } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { PasteBin } from "../pages/PasteBin.js"

export const mockedPasteUpload: PasteResponse = {
  url: "https://example.com/abcd",
  manageUrl: "https://example.com/abcd:aaaaaaaaaaaaaaaaaa",
  expireAt: "2025-05-01T00:00:00.000Z",
  expirationSeconds: 300,
  lastModifiedAt: "2025-04-30T23:55:00.000Z",
  createdAt: "2025-04-30T23:55:00.000Z",
  sizeBytes: 9,
  location: "KV",
}

export const mockedPasteContent = "something"

export const server = setupServer(
  http.post(`${__WRANGLER_CONFIG__.DEPLOY_URL}/`, () => {
    return HttpResponse.json(mockedPasteUpload)
  }),
  http.head(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
    return new HttpResponse(null, {
      headers: {
        "Content-Type": "text/plain;charset=UTF-8",
        "Content-Length": String(new TextEncoder().encode(mockedPasteContent).length),
      },
    })
  }),
  http.get(`${__WRANGLER_CONFIG__.DEPLOY_URL}/abcd`, () => {
    return HttpResponse.text(mockedPasteContent)
  }),
)

beforeAll(() => {
  stubBrowerFunctions()
  server.listen()
})

afterEach(() => {
  server.resetHandlers()
  cleanup()
})

afterAll(() => {
  unStubBrowerFunctions()
  server.close()
})

import "@testing-library/jest-dom/vitest"
import { userEvent } from "@testing-library/user-event"
import type { PasteResponse } from "../../shared/interfaces.js"
import { setupServer } from "msw/node"
import { http, HttpResponse } from "msw"
import { File as NodeFile } from "node:buffer"
import { decodeKey, decrypt } from "../utils/encryption.js"
import { stubBrowerFunctions, unStubBrowerFunctions } from "./testUtils.js"

describe("Pastebin", () => {
  it("can upload", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const title = screen.getByText(__WRANGLER_CONFIG__.INDEX_PAGE_TITLE)
    expect(title).toBeInTheDocument()

    const editor = screen.getByRole("textbox", { name: "粘贴编辑器" })
    expect(editor).toBeInTheDocument()

    const submitter = screen.getByRole("button", { name: "上传" })
    expect(submitter).toBeInTheDocument()
    expect(submitter).not.toBeEnabled()

    await userEvent.type(editor, "something")

    expect(submitter).toBeEnabled()
    await userEvent.click(submitter)

    const urlShow = await screen.findByRole("textbox", { name: "原始链接" }, { timeout: 5000 })
    expect((urlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.url)

    const manageUrlShow = await screen.findByRole("textbox", { name: "管理链接" })
    expect((manageUrlShow as HTMLInputElement).value).toStrictEqual(mockedPasteUpload.manageUrl)
  })

  it("can upload with client-side encryption", async () => {
    // In this environment happy-dom coerces File values to "[object File]" in
    // FormData and msw's undici pipeline drops their bytes entirely, so this
    // test swaps in Node's File and a recording FormData, and intercepts fetch
    // one level earlier to capture the multipart entries directly.
    vi.stubGlobal("File", NodeFile)
    class RecordingFormData {
      private entries: [string, FormDataEntryValue][] = []
      set(name: string, value: FormDataEntryValue) {
        const i = this.entries.findIndex(([k]) => k === name)
        if (i >= 0) this.entries[i] = [name, value]
        else this.entries.push([name, value])
      }
      append(name: string, value: FormDataEntryValue) {
        this.entries.push([name, value])
      }
      get(name: string) {
        return this.entries.find(([k]) => k === name)?.[1] ?? null
      }
      has(name: string) {
        return this.entries.some(([k]) => k === name)
      }
      forEach(cb: (value: FormDataEntryValue, key: string) => void) {
        this.entries.forEach(([k, v]) => cb(v, k))
      }
    }
    vi.stubGlobal("FormData", RecordingFormData)
    // xhrSend prefers XMLHttpRequest (happy-dom's) which msw intercepts before
    // us; drop it so the upload goes through the (stubbed) fetch path instead
    const savedXhr = globalThis.XMLHttpRequest
    vi.stubGlobal("XMLHttpRequest", undefined)
    let captured: { fields: Record<string, string>; fileBytes?: Uint8Array } | undefined
    const savedFormData = globalThis.FormData
    const proxiedFetch = globalThis.fetch
    const savedFile = globalThis.File
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.body instanceof FormData) {
        const fields: Record<string, string> = {}
        let fileBytes: Uint8Array | undefined
        const reads: Promise<void>[] = []
        init.body.forEach((value, key) => {
          if (typeof value === "string") {
            fields[key] = value
          } else {
            reads.push(
              Promise.resolve(value.arrayBuffer()).then((buf) => {
                fileBytes = new Uint8Array(buf)
              }),
            )
          }
        })
        await Promise.all(reads)
        captured = { fields, fileBytes }
        return {
          ok: true,
          status: 200,
          text: () => Promise.resolve(JSON.stringify(mockedPasteUpload)),
          json: () => Promise.resolve(mockedPasteUpload),
        }
      }
      return proxiedFetch(input, init)
    })
    try {
      render(<PasteBin config={__WRANGLER_CONFIG__} />)

      const editor = screen.getByRole("textbox", { name: "粘贴编辑器" })
      await userEvent.type(editor, "plain secret")

      await userEvent.click(screen.getByRole("checkbox", { name: "客户端加密" }))

      const submitter = screen.getByRole("button", { name: "上传" })
      await userEvent.click(submitter)

      const displayUrl = await screen.findByRole("textbox", { name: "展示链接" }, { timeout: 5000 })
      const value = (displayUrl as HTMLInputElement).value
      // /d/ prefixed link with a 43-char base64-variant key (256-bit AES) in the fragment
      expect(value).toMatch(/^https:\/\/example\.com\/d\/abcd#[A-Za-z0-9+_]{43}$/)

      expect(captured).toBeDefined()
      expect(captured!.fields["encryption-scheme"]).toStrictEqual("AES-GCM")
      const ciphertext = captured!.fileBytes!
      expect(new TextDecoder().decode(ciphertext)).not.toContain("plain secret")
      const key = value.split("#")[1]
      const decrypted = await decrypt("AES-GCM", await decodeKey("AES-GCM", key), ciphertext)
      expect(new TextDecoder().decode(decrypted!)).toStrictEqual("plain secret")
    } finally {
      vi.stubGlobal("fetch", proxiedFetch)
      vi.stubGlobal("File", savedFile)
      vi.stubGlobal("XMLHttpRequest", savedXhr)
      vi.stubGlobal("FormData", savedFormData)
    }
  })

  it("refuse illegal settings", async () => {
    render(<PasteBin config={__WRANGLER_CONFIG__} />)
    // due to bugs https://github.com/adobe/react-spectrum/discussions/8037, we need to use duplicated name here
    const expire = screen.getByRole("textbox", { name: "过期时间" })
    expect(expire).toBeValid()
    await userEvent.type(expire, "xxx")
    expect(expire).toBeInvalid()
  })
})

describe("Pastebin admin page", () => {
  it("renders admin page", async () => {
    vi.stubGlobal("location", new URL("https://example.com/abcd:xxxxxxxxx"))
    render(<PasteBin config={__WRANGLER_CONFIG__} />)

    const editor = screen.getByRole("textbox", { name: "粘贴编辑器" })
    await userEvent.click(editor) // meaningless click, just ensure useEffect is done
    expect(editor).toBeInTheDocument()
    expect((editor as HTMLTextAreaElement).value).toStrictEqual(mockedPasteContent)
  })
})

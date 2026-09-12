import { verifyAuth } from "../pages/auth.js"
import { decode, genRandStr, WorkerError, timingSafeEqual } from "../common.js"
import {
  createPaste,
  getPasteMetadata,
  metaResponseFromMetadata,
  pasteNameAvailable,
  updatePaste,
} from "../storage/storage.js"
import { DEFAULT_PASSWD_LEN, PASTE_NAME_LEN, PRIVATE_PASTE_NAME_LEN, PASSWD_SEP } from "../../shared/constants.js"
import { parsePath, parseSize, parseExpiration } from "../../shared/parsers.js"
import { verifyName, verifyPassword, verifySharePassword } from "../../shared/verify.js"
import type { PasteResponse } from "../../shared/interfaces.js"
import { MaxFileSizeExceededError, MultipartParseError, parseMultipartRequest } from "@mjackson/multipart-parser"
import {
  handleMPUAbort,
  handleMPUComplete,
  handleMPUCreate,
  handleMPUCreateUpdate,
  handleMPUResume,
} from "./handleMPU.js"

interface ParsedMultipartPart {
  filename?: string
  content: ReadableStream | ArrayBuffer
  contentAsString: () => string
  contentLength: number
}

async function multipartToMap(req: Request, sizeLimit: string): Promise<Map<string, ParsedMultipartPart>> {
  const partsMap = new Map<string, ParsedMultipartPart>()
  try {
    for await (const part of parseMultipartRequest(req, { maxFileSize: parseSize(sizeLimit)! })) {
      if (part.name) {
        if (part.isFile) {
          const arrayBuffer = part.arrayBuffer
          partsMap.set(part.name, {
            filename: part.filename,
            content: arrayBuffer,
            contentLength: arrayBuffer.byteLength,
            contentAsString: () => decode(arrayBuffer),
          })
        } else {
          const arrayBuffer = part.arrayBuffer
          partsMap.set(part.name, {
            filename: part.filename,
            content: arrayBuffer,
            contentAsString: () => decode(arrayBuffer),
            contentLength: arrayBuffer.byteLength,
          })
        }
      }
    }
  } catch (err) {
    if (err instanceof MaxFileSizeExceededError) {
      throw new WorkerError(413, `内容过大（最大允许 ${sizeLimit}）`)
    } else if (err instanceof MultipartParseError) {
      console.warn("Failed to parse multipart request:", err.message)
      throw new WorkerError(400, "解析 multipart 请求失败")
    } else {
      throw err
    }
  }
  return partsMap
}

export async function handlePostOrPut(
  request: Request,
  env: Env,
  _: ExecutionContext,
  isPut: boolean,
): Promise<Response> {
  if (!isPut) {
    // only POST requires auth, since PUT request already contains auth
    const authResponse = verifyAuth(request, env)
    if (authResponse !== null) {
      return authResponse
    }
  }

  const url = new URL(request.url)

  let isMPUComplete = false
  if (url.pathname === "/mpu/create" && !isPut) {
    return await handleMPUCreate(request, env)
  } else if (url.pathname === "/mpu/create-update" && !isPut) {
    return await handleMPUCreateUpdate(request, env)
  } else if (url.pathname === "/mpu/resume" && isPut) {
    return await handleMPUResume(request, env)
  } else if (url.pathname === "/mpu/abort" && !isPut) {
    return await handleMPUAbort(request, env)
  } else if (url.pathname === "/mpu/complete") {
    isMPUComplete = true // we will handle mpu complete later since it is uploaded with formdata
  } else if (url.pathname.startsWith("/mpu/")) {
    throw new WorkerError(400, "非法的 mpu 操作")
  }

  const contentType = request.headers.get("Content-Type") || ""

  // parse formdata
  if (!contentType.includes("multipart/form-data")) {
    throw new WorkerError(400, `用法错误，请使用 'multipart/form-data' 而不是 ${contentType}`)
  }

  const parts = await multipartToMap(request, env.R2_MAX_ALLOWED)

  if (!parts.has("c")) {
    throw new WorkerError(400, "formdata 中找不到内容")
  }
  const { filename, content, contentAsString, contentLength } = parts.get("c")!
  const nameFromForm = parts.get("n")?.contentAsString()
  const isPrivate = parts.has("p")
  const passwdFromForm = parts.get("s")?.contentAsString()
  const expireFromForm: string | undefined = parts.get("e")?.contentAsString()
  const encryptionScheme: string | undefined = parts.get("encryption-scheme")?.contentAsString()
  const sharePasswdFromForm: string | undefined = parts.get("share-passwd")?.contentAsString()
  const highlightLanguage = parts.get("lang")?.contentAsString()
  const expire = expireFromForm ? expireFromForm : env.DEFAULT_EXPIRATION

  const uploadedParts = isMPUComplete ? (JSON.parse(contentAsString()) as R2UploadedPart[]) : undefined

  // parse expiration
  let expirationSeconds = parseExpiration(expire)
  if (expirationSeconds === null) {
    throw new WorkerError(400, `“${expire}” 不是有效的过期时间格式`)
  }
  const maxExpiration = parseExpiration(env.MAX_EXPIRATION)!
  if (expirationSeconds > maxExpiration) {
    expirationSeconds = maxExpiration
  }

  // check if password is legal
  if (passwdFromForm) {
    const [ok, msg] = verifyPassword(passwdFromForm)
    if (!ok) throw new WorkerError(400, msg)
  }

  // check if the share password is legal
  if (sharePasswdFromForm) {
    const [ok, msg] = verifySharePassword(sharePasswdFromForm)
    if (!ok) throw new WorkerError(400, msg)
  }

  // check if name is legal
  if (nameFromForm !== undefined && isPut) {
    throw new WorkerError(400, `PUT 请求不能设置名称`)
  }
  if (nameFromForm !== undefined) {
    const [ok, msg] = verifyName(nameFromForm)
    if (!ok) throw new WorkerError(400, msg)
  }

  function makeResponse(created: PasteResponse, additionalHeaders: Record<string, string | undefined> = {}): Response {
    return new Response(JSON.stringify(created, null, 2), {
      headers: { "Content-Type": "application/json;charset=UTF-8", ...additionalHeaders },
    })
  }

  function accessUrl(short: string): string {
    return env.DEPLOY_URL + "/" + short
  }

  function manageUrl(short: string, passwd: string): string {
    return env.DEPLOY_URL + "/" + short + PASSWD_SEP + passwd
  }

  const now = new Date()
  if (isPut) {
    let pasteName: string | undefined
    let password: string | undefined
    // if isMPUComplete, we cannot parse path
    if (!isMPUComplete) {
      const parsed = parsePath(url.pathname)
      if (parsed.password === undefined) {
        throw new WorkerError(403, `PUT 请求缺少密码`)
      }
      pasteName = parsed.name
      password = parsed.password
    } else {
      pasteName = url.searchParams.get("name") || undefined
      if (pasteName === undefined) {
        throw new WorkerError(400, `MPU 完成请求缺少名称`)
      }
    }

    const r2Object = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const originalMetadata = await getPasteMetadata(env, pasteName)
    if (originalMetadata === null) {
      throw new WorkerError(404, `找不到名为 “${pasteName}” 的粘贴`)
    }

    // no need to check password for MPCComplete, it is already checked on creation
    if (!isMPUComplete && !timingSafeEqual(password, originalMetadata.passwd)) {
      throw new WorkerError(403, `粘贴 “${pasteName}” 的密码不正确`)
    }

    const newPasswd = passwdFromForm || originalMetadata.passwd
    const newMetadata = await updatePaste(env, pasteName, content, originalMetadata, {
      expirationSeconds,
      now,
      passwd: newPasswd,
      contentLength: r2Object?.size || contentLength,
      filename,
      highlightLanguage,
      encryptionScheme,
      sharePasswd: sharePasswdFromForm || originalMetadata.sharePasswd,
      isMPUComplete,
    })
    return makeResponse(
      {
        ...metaResponseFromMetadata(newMetadata),
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, newPasswd),
        expirationSeconds,
      },
      { etag: r2Object?.httpEtag },
    )
  } else {
    let pasteName: string | undefined
    if (isMPUComplete) {
      if (url.searchParams.has("name")) {
        pasteName = url.searchParams.get("name")!
      } else {
        throw new WorkerError(400, `MPU 完成请求缺少名称`)
      }
    } else if (nameFromForm !== undefined) {
      pasteName = "~" + nameFromForm
      if (!(await pasteNameAvailable(env, pasteName))) {
        throw new WorkerError(409, `名称 “${pasteName}” 已被占用`)
      }
    } else {
      pasteName = genRandStr(isPrivate ? PRIVATE_PASTE_NAME_LEN : PASTE_NAME_LEN)
    }

    const r2Object = isMPUComplete ? await handleMPUComplete(request, env, uploadedParts!) : undefined

    const password = passwdFromForm || genRandStr(DEFAULT_PASSWD_LEN)
    const newMetadata = await createPaste(env, pasteName, content, {
      expirationSeconds,
      now,
      passwd: password,
      filename,
      highlightLanguage,
      contentLength: r2Object?.size || contentLength,
      encryptionScheme,
      sharePasswd: sharePasswdFromForm,
      isMPUComplete,
    })

    return makeResponse(
      {
        ...metaResponseFromMetadata(newMetadata),
        url: accessUrl(pasteName),
        manageUrl: manageUrl(pasteName, password),
        expirationSeconds,
      },
      { etag: r2Object?.httpEtag },
    )
  }
}

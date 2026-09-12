import { PASSWD_SEP } from "../../shared/constants.js"
import { parseExpiration, parseExpirationReadable, parseSize } from "../../shared/parsers.js"
import { verifyExpiration as verifyExpirationShared } from "../../shared/verify.js"

export function getMaxExpirationSeconds(config: Env): number {
  return parseExpiration(config.MAX_EXPIRATION)!
}

export function getMaxExpirationReadable(config: Env): string {
  return parseExpirationReadable(config.MAX_EXPIRATION)!
}

export { ErrorWithTitle } from "./errors.js"

export function verifyFileSize(size: number, config: Env): [boolean, string] {
  const max = parseSize(config.R2_MAX_ALLOWED)
  if (max === null || size <= max) return [true, ""]
  return [false, `文件太大（${formatSize(size)} > ${formatSize(max)}）`]
}

export function formatSize(size: number): string {
  if (!size) return "0"
  if (size < 1024) {
    return `${size} 字节`
  } else if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(2)} KB`
  } else if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  } else {
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
  }
}

const MARKDOWN_FILENAME_REGEX = /\.(md|markdown|mdown|mkd)$/i

export function isMarkdownFilename(name: string): boolean {
  return MARKDOWN_FILENAME_REGEX.test(name)
}

const HTML_FILENAME_REGEX = /\.(html?|xhtml)$/i

export function isHtmlFilename(name: string): boolean {
  return HTML_FILENAME_REGEX.test(name)
}

export function verifyExpiration(expiration: string, config: Env): [boolean, string] {
  return verifyExpirationShared(expiration, getMaxExpirationSeconds(config))
}

export function verifyManageUrl(url: string, config: Env): [boolean, string] {
  try {
    const url_parsed = new URL(url)
    if (url_parsed.origin !== config.DEPLOY_URL) {
      return [false, `URL 应以 ${config.DEPLOY_URL} 开头`]
    } else if (!url_parsed.pathname.includes(PASSWD_SEP)) {
      return [false, `URL 应包含一个冒号`]
    } else {
      return [true, ""]
    }
  } catch (e) {
    if (e instanceof TypeError) {
      return [false, "无效的 URL"]
    } else {
      throw e
    }
  }
}

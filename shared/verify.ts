import { MAX_PASSWD_LEN, MAX_SHARE_PASSWD_LEN, MIN_PASSWD_LEN, MIN_SHARE_PASSWD_LEN, NAME_REGEX } from "./constants.js"
import { parseExpiration, parseExpirationReadable } from "./parsers.js"

export type VerifyResult = [ok: true, message: string] | [ok: false, error: string]

export function isLegalUrl(url: string): boolean {
  return URL.canParse(url)
}

export function verifyPassword(password: string): VerifyResult {
  if (password === "") {
    return [true, ""]
  } else if (password.length < MIN_PASSWD_LEN) {
    return [false, `密码太短（${password.length} < ${MIN_PASSWD_LEN}）`]
  } else if (password.length > MAX_PASSWD_LEN) {
    return [false, `密码太长（${password.length} > ${MAX_PASSWD_LEN}）`]
  } else if (password.includes("\n")) {
    return [false, "密码不能包含换行符"]
  }
  return [true, ""]
}

// the share key protects viewing/downloading a paste; it is checked on
// the server, so it never needs the length of a manage password
export function verifySharePassword(password: string): VerifyResult {
  if (password.length < MIN_SHARE_PASSWD_LEN) {
    return [false, `密钥太短（${password.length} < ${MIN_SHARE_PASSWD_LEN}）`]
  } else if (password.length > MAX_SHARE_PASSWD_LEN) {
    return [false, `密钥太长（${password.length} > ${MAX_SHARE_PASSWD_LEN}）`]
  } else if (password.includes("\n")) {
    return [false, "密钥不能包含换行符"]
  }
  return [true, ""]
}

export function verifyName(name: string): VerifyResult {
  if (name.length < 3) {
    return [false, "名称至少需要 3 个字符"]
  } else if (!NAME_REGEX.test(name)) {
    return [false, `名称 ${name} 不符合正则 ${NAME_REGEX}`]
  }
  return [true, ""]
}

export function verifyExpiration(expiration: string, maxExpirationSeconds: number): VerifyResult {
  const parsed = parseExpiration(expiration)
  if (parsed === null) {
    return [false, `“${expiration}” 不是有效的过期时间格式`]
  }
  if (parsed > maxExpirationSeconds) {
    return [false, `超出最长过期时间（${parseExpirationReadable(`${maxExpirationSeconds}s`)!}）`]
  }
  return [true, `${parseExpirationReadable(expiration)!}后过期`]
}

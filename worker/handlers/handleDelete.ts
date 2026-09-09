import { WorkerError, timingSafeEqual } from "../common.js"
import { deletePaste, getPasteMetadata } from "../storage/storage.js"
import { parsePath } from "../../shared/parsers.js"

export async function handleDelete(request: Request, env: Env, _: ExecutionContext) {
  const url = new URL(request.url)
  const { name, password } = parsePath(url.pathname)
  const metadata = await getPasteMetadata(env, name)
  if (metadata === null) {
    throw new WorkerError(404, `找不到名为 '${name}' 的粘贴`)
  } else {
    if (!timingSafeEqual(password, metadata.passwd)) {
      throw new WorkerError(403, `粘贴 '${name}' 的密码不正确`)
    } else {
      await deletePaste(env, name, metadata)
      return new Response("粘贴将在数秒内被删除")
    }
  }
}

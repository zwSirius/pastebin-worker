import type { PasteSetting } from "../components/PasteSettingPanel.js"
import type { PasteEditState } from "../components/PasteInputPanel.js"
import { ErrorWithTitle } from "./utils.js"
import type { PasteResponse } from "../../shared/interfaces.js"
import type { UploadOptions } from "../../shared/uploadPaste.js"
import { UploadError, uploadMPU, uploadNormal } from "../../shared/uploadPaste.js"

const mpuChunkSize = 5 * 1024 * 1024
const mpuThreshold = 5 * 1024 * 1024

export interface UploadProgress {
  doneBytes: number
  totalBytes: number
}

export async function uploadPaste(
  pasteSetting: PasteSetting,
  editorState: PasteEditState,
  config: Env,
  onProgress?: (progress: UploadProgress | undefined) => void,
  signal?: AbortSignal,
): Promise<PasteResponse> {
  function constructContent(): File {
    if (editorState.editKind === "file") {
      if (editorState.file === null) {
        throw new ErrorWithTitle("准备上传失败", "未选择文件")
      }
      return editorState.file
    } else {
      if (editorState.editContent.length === 0) {
        throw new ErrorWithTitle("准备上传失败", "内容为空")
      }
      return new File([editorState.editContent], editorState.editFilename || "")
    }
  }

  const options: UploadOptions = {
    content: constructContent(),
    isUpdate: pasteSetting.uploadKind === "manage",
    isPrivate: pasteSetting.uploadKind === "long",
    password: pasteSetting.password.length ? pasteSetting.password : undefined,
    expire: pasteSetting.expiration,
    name: pasteSetting.uploadKind === "custom" ? pasteSetting.name : undefined,
    highlightLanguage: editorState.editKind === "edit" ? editorState.editHighlightLang : undefined,
    sharePasswd: pasteSetting.doProtect ? pasteSetting.sharePasswd : undefined,
    manageUrl: pasteSetting.manageUrl,
  }

  const contentLength = options.content.size
  const reportProgress = (doneBytes: number, totalBytes: number) => {
    if (onProgress) onProgress({ doneBytes, totalBytes })
  }

  try {
    if (onProgress) onProgress({ doneBytes: 0, totalBytes: contentLength })
    if (contentLength <= mpuThreshold) {
      return await uploadNormal(config.DEPLOY_URL, options, reportProgress, signal)
    } else {
      return await uploadMPU(config.DEPLOY_URL, mpuChunkSize, options, reportProgress, undefined, signal)
    }
  } catch (e) {
    if (e instanceof UploadError) {
      throw new ErrorWithTitle("上传失败", e.message)
    }
    throw e
  } finally {
    if (onProgress) onProgress(undefined)
  }
}

import { useEffect, useState } from "react"
import { Button, CircularProgress, Input, Link, Tooltip } from "../components/ui/index.js"
import { DarkModeToggle, useDarkModeSelection } from "../components/DarkModeToggle.js"
import { DownloadIcon, HomeIcon } from "../components/icons.js"
import { CopyWidget } from "../components/CopyWidget.js"
import { inputOverrides, tst } from "../utils/overrides.js"
import { highlightHTML, useHljsForLang } from "../utils/highlight.js"
import { formatSize } from "../utils/utils.js"

interface PendingInfo {
  sizeBytes: number
  rawUrl: string
  contentType: string | null
}

interface MediaInfo {
  sizeBytes: number
  rawUrl: string
  contentType: string
}

type MediaKind = "image" | "audio" | "video"

const mediaExtRegex: Record<MediaKind, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i,
  audio: /\.(mp3|wav|ogg|flac|m4a|aac|opus)$/i,
  video: /\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/i,
}

function mediaKindOf(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image"
  if (file.type.startsWith("audio/")) return "audio"
  if (file.type.startsWith("video/")) return "video"
  for (const kind of ["image", "audio", "video"] as const) {
    if (mediaExtRegex[kind].test(file.name)) return kind
  }
  return null
}

function mediaKindOfType(contentType: string): MediaKind | null {
  if (contentType.startsWith("image/")) return "image"
  if (contentType.startsWith("audio/")) return "audio"
  if (contentType.startsWith("video/")) return "video"
  return null
}

function MediaElement({ kind, src, name }: { kind: MediaKind; src: string; name: string }) {
  if (kind === "image") {
    return <img src={src} alt={name} className="max-w-full h-auto mx-auto block" />
  }
  if (kind === "audio") {
    return <audio src={src} controls className="w-full" aria-label={name} />
  }
  return <video src={src} controls className="max-w-full h-auto mx-auto block" aria-label={name} />
}

interface DisplayPasteViewProps {
  pasteFile?: File
  pasteContentBuffer?: Uint8Array
  pasteLang?: string
  isFileBinary: boolean
  guessedEncoding: string | null
  isDecrypted: "not encrypted" | "encrypted" | "protected" | "decrypted"
  forceShowBinary: boolean
  setForceShowBinary: (v: boolean) => void
  isLoading: boolean
  name: string
  ext?: string
  filename?: string
  config: Env
  pendingInfo?: PendingInfo | null
  mediaInfo?: MediaInfo | null
  metaFilename?: string
  onLoadAnyway?: () => void
  // present when the paste is protected by a share password: the view shows
  // an unlock form and only renders content after a successful check
  passwordPrompt?: { error: string | null; pending: boolean }
  onPasswordSubmit?: (password: string) => void
}

export function DisplayPasteView(props: DisplayPasteViewProps) {
  const {
    pasteFile,
    pasteContentBuffer,
    pasteLang,
    isFileBinary,
    guessedEncoding,
    isDecrypted,
    forceShowBinary,
    setForceShowBinary,
    isLoading,
    name,
    ext,
    filename,
    config,
    pendingInfo,
    mediaInfo,
    metaFilename,
    onLoadAnyway,
    passwordPrompt,
    onPasswordSubmit,
  } = props

  const indexPageTitle = config.INDEX_PAGE_TITLE || "Pastebin"

  const [, modeSelection, setModeSelection] = useDarkModeSelection()
  const hljs = useHljsForLang(pasteLang)
  const [downloadUrl, setDownloadUrl] = useState<string>("#")
  const [unlockPassword, setUnlockPassword] = useState("")
  const [renderHtml, setRenderHtml] = useState(false)

  const showPasswordPrompt = passwordPrompt !== undefined && pasteFile === undefined

  // Create and cleanup blob URL
  useEffect(() => {
    if (pasteFile && typeof window !== "undefined" && URL.createObjectURL) {
      const url = URL.createObjectURL(pasteFile)
      setDownloadUrl(url)
      return () => {
        if (URL.revokeObjectURL) URL.revokeObjectURL(url)
      }
    }
  }, [pasteFile])

  // leave the rendered view whenever a different paste (or none) is shown
  useEffect(() => {
    setRenderHtml(false)
  }, [pasteFile])

  const pasteMediaKind = pasteFile ? mediaKindOf(pasteFile) : null
  const mediaInfoKind = mediaInfo ? mediaKindOfType(mediaInfo.contentType) : null
  const showFileContent = pasteFile !== undefined && pasteMediaKind === null && (!isFileBinary || forceShowBinary)
  // HTML text content can additionally be previewed rendered in a sandboxed
  // iframe; the sandbox matches the CSP the raw route applies to text/html
  const isHtmlFile =
    pasteFile !== undefined &&
    pasteMediaKind === null &&
    !isFileBinary &&
    (pasteFile.type.startsWith("text/html") || /\.x?html?$/i.test(pasteFile.name))
  const pasteStringContent = pasteContentBuffer && new TextDecoder().decode(pasteContentBuffer)
  const highlightedHTML = pasteStringContent ? highlightHTML(hljs, pasteLang, pasteStringContent) : ""
  const pasteLineCount = (highlightedHTML?.match(/\n/g)?.length || 0) + 1

  const binaryFileIndicator = pasteFile && (
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center w-full">
      <div className="text-foreground-600 mb-2">{`${pasteFile?.name} (${formatSize(pasteFile.size)})`}</div>
      <div className="w-fit text-center">
        该文件似乎是二进制文件或不是 UTF-8 编码{guessedEncoding ? `（推测为 ${guessedEncoding}）。` : "。"}
        <button className="text-primary-500 inline" onClick={() => setForceShowBinary(true)}>
          （点击显示）
        </button>
      </div>
    </div>
  )

  const displayFilename = filename || metaFilename
  const placeholderName = displayFilename || (ext ? name + ext : name)
  const placeholderReason = (() => {
    if (!pendingInfo) return ""
    const ct = pendingInfo.contentType
    if (
      !ct?.startsWith("text/") &&
      !ct?.startsWith("image/") &&
      !ct?.startsWith("audio/") &&
      !ct?.startsWith("video/")
    ) {
      return `不是可渲染的文件${ct ? `（${ct}）` : ""}。`
    }
    return "粘贴内容太大，无法自动加载。"
  })()
  const pendingFileIndicator = pendingInfo && !pasteFile && (
    <div className="absolute top-[50%] left-[50%] translate-[-50%] flex flex-col items-center w-full px-4">
      <div className="text-foreground-600 mb-2">{`${placeholderName} (${formatSize(pendingInfo.sizeBytes)})`}</div>
      <div className="w-fit text-center">
        {placeholderReason}{" "}
        <Link href={`${pendingInfo.rawUrl}?a`} className="text-primary-500 inline">
          下载原始文件
        </Link>
        {onLoadAnyway && (
          <>
            {" 或 "}
            <button className="text-primary inline cursor-pointer" onClick={() => onLoadAnyway()}>
              仍然加载
            </button>
            。
          </>
        )}
      </div>
    </div>
  )

  const lineNumOffset = `${Math.floor(Math.log10(pasteLineCount)) + 3}ch`
  const buttonClasses = `${tst}`

  return (
    <main
      className={`flex flex-col items-center min-h-screen transition-transform-background bg-background ${tst} text-foreground w-full p-2`}
    >
      <div className="w-full max-w-[64rem]">
        <div className="flex flex-row my-4 items-center justify-between">
          <h1 className="text-xl md:text-2xl grow inline-flex items-baseline min-w-0">
            <Link href="/" className="text-foreground-500 text-[length:inherited] shrink-0">
              <Button isIconOnly variant="light" aria-label={indexPageTitle} className={buttonClasses + " md:hidden"}>
                <HomeIcon className="size-6" />
              </Button>
              <span className="hidden md:inline">{indexPageTitle}</span>
            </Link>
            <span className="mx-2 shrink-0">{" / "}</span>
            <span className="shrink-0">{displayFilename ? name : name + (ext ?? "")}</span>
            {displayFilename && (
              <>
                <span className="mx-2 shrink-0">{" / "}</span>
                <span className="truncate min-w-0" title={displayFilename}>
                  {displayFilename}
                </span>
              </>
            )}
            <span className="ml-1 shrink-0">
              {isDecrypted === "decrypted"
                ? "（已解密）"
                : isDecrypted === "encrypted"
                  ? "（已加密）"
                  : isDecrypted === "protected"
                    ? "（密钥保护）"
                    : ""}
            </span>
          </h1>
          <div className="flex flex-row gap-2 items-center">
            <DarkModeToggle modeSelection={modeSelection} setModeSelection={setModeSelection} />
            {showFileContent && (
              <Tooltip content={`复制到剪贴板`}>
                <CopyWidget variant="light" className={buttonClasses} getCopyContent={() => pasteStringContent!} />
              </Tooltip>
            )}
            {pasteFile ? (
              <Tooltip content={`下载为文件`}>
                <Button aria-label="下载" isIconOnly variant="light" className={buttonClasses}>
                  <a href={downloadUrl} download={pasteFile.name}>
                    <DownloadIcon className="size-6 inline" />
                  </a>
                </Button>
              </Tooltip>
            ) : (
              (pendingInfo || mediaInfo) && (
                <Tooltip content={`下载为文件`}>
                  <Button aria-label="下载" isIconOnly variant="light" className={buttonClasses}>
                    <a href={(pendingInfo ?? mediaInfo)!.rawUrl} download={placeholderName}>
                      <DownloadIcon className="size-6 inline" />
                    </a>
                  </Button>
                </Tooltip>
              )
            )}
          </div>
        </div>
        <div className="my-4">
          <div className={`w-full bg-default-100 rounded-lg p-3 relative ${tst}`}>
            {showPasswordPrompt && passwordPrompt ? (
              <div className="flex flex-col items-center justify-center gap-4 py-8">
                <div className="text-foreground-600 text-center px-4">
                  该内容已开启加密分享，输入正确的密钥后即可查看与下载。
                </div>
                <form
                  className="flex flex-row items-start gap-2 w-full max-w-[24rem] px-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (unlockPassword.length > 0 && !passwordPrompt.pending) onPasswordSubmit?.(unlockPassword)
                  }}
                >
                  <Input
                    type="text"
                    aria-label="分享密钥"
                    placeholder="分享密钥"
                    autoFocus
                    value={unlockPassword}
                    onValueChange={setUnlockPassword}
                    isInvalid={!!passwordPrompt.error}
                    errorMessage={passwordPrompt.error ?? undefined}
                    classNames={inputOverrides}
                  />
                  <Button
                    type="submit"
                    color="primary"
                    isDisabled={unlockPassword.length === 0 || passwordPrompt.pending}
                    className="shrink-0 mt-0.5"
                  >
                    {passwordPrompt.pending ? "验证中…" : "解锁"}
                  </Button>
                </form>
              </div>
            ) : isLoading ? (
              <div className="h-[10em] flex items-center justify-center">
                <CircularProgress label={"加载中……"} />
              </div>
            ) : mediaInfo && !pasteFile && mediaInfoKind ? (
              <div>
                <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                  <span>{placeholderName}</span>
                  <span>{`(${formatSize(mediaInfo.sizeBytes)})`}</span>
                </div>
                <MediaElement kind={mediaInfoKind} src={mediaInfo.rawUrl} name={placeholderName} />
              </div>
            ) : pasteFile && pasteMediaKind ? (
              <div>
                <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                  <span>{pasteFile.name}</span>
                  <span>{`(${formatSize(pasteFile.size)})`}</span>
                </div>
                <MediaElement kind={pasteMediaKind} src={downloadUrl} name={pasteFile.name} />
              </div>
            ) : pendingInfo && !pasteFile ? (
              <div className={"h-[10em]"}>{pendingFileIndicator}</div>
            ) : (
              pasteFile && (
                <div className={showFileContent ? "" : "h-[10em]"}>
                  {showFileContent ? (
                    <>
                      <div className="text-gray-500 mb-2 text-sm flex flex-row gap-2">
                        <span>{pasteFile?.name}</span>
                        <span>{`(${formatSize(pasteFile.size)})`}</span>
                        {isHtmlFile && (
                          <button className="text-primary-500 cursor-pointer" onClick={() => setRenderHtml((v) => !v)}>
                            {renderHtml ? "（显示源码）" : "（渲染视图）"}
                          </button>
                        )}
                        {forceShowBinary && (
                          <button className="ml-2 text-primary-500" onClick={() => setForceShowBinary(false)}>
                            （点击隐藏）
                          </button>
                        )}
                        {pasteLang && <span className={"grow text-right"}>{pasteLang}</span>}
                      </div>
                      {renderHtml && isHtmlFile ? (
                        <iframe
                          sandbox="allow-scripts allow-forms allow-popups"
                          src={downloadUrl}
                          title={`渲染预览 ${pasteFile?.name ?? name}`}
                          className="w-full h-[70vh] border-0 rounded-md"
                        />
                      ) : (
                        <div className="font-mono relative" role="article">
                          <pre
                            style={{ marginLeft: lineNumOffset, width: `calc(100% - ${lineNumOffset})` }}
                            dangerouslySetInnerHTML={{ __html: highlightedHTML }}
                            className={"overflow-x-auto"}
                          />
                          <span
                            className={
                              "line-number-rows absolute pointer-events-none text-default-500 top-0 left-0 " +
                              "border-solid border-default-300 border-r-1"
                            }
                          >
                            {Array.from({ length: pasteLineCount }, (_, idx) => {
                              return <span key={idx} />
                            })}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    binaryFileIndicator
                  )}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </main>
  )
}

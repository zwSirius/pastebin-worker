import type React from "react"
import { useState } from "react"

import type { CardProps } from "./ui/index.js"
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CircularProgress,
  Divider,
  Input,
  Tooltip,
  mergeClasses,
} from "./ui/index.js"

import type { PasteResponse } from "../../shared/interfaces.js"
import { tst } from "../utils/overrides.js"
import type { UploadProgress } from "../utils/uploader.js"
import { formatSize } from "../utils/utils.js"
import { CopyWidget } from "./CopyWidget.js"
import { ChevronDownIcon, InfoIcon } from "./icons.js"

interface UploadedPanelProps extends CardProps {
  isLoading: boolean
  loadingProgress?: UploadProgress
  onCancel?: () => void
  pasteResponse?: PasteResponse
  encryptionKey?: string
  highlightLang?: string
  isUrlPaste?: boolean
}

function withPathPrefix(url: string, prefix: string): string {
  const u = new URL(url)
  u.pathname = prefix + u.pathname
  return u.toString()
}

function makeDecryptionUrl(url: string, key?: string): string {
  const base = withPathPrefix(url, "/d")
  return key ? `${base}#${key}` : base
}

const RAW_URL_FLAGS: { syntax: string; desc: string }[] = [
  { syntax: "?mime=…", desc: "覆盖 Content-Type" },
  { syntax: "?a", desc: "强制下载（Content-Disposition: attachment）" },
  { syntax: ".png", desc: "追加扩展名以提示 MIME 类型" },
  { syntax: "/foo.txt", desc: "追加文件名作为下载时的文件名" },
]

const DISPLAY_URL_FLAGS: { syntax: string; desc: string }[] = [
  { syntax: "?lang=js", desc: "覆盖语法高亮语言" },
  { syntax: "/foo.txt", desc: "追加文件名——显示在页头并作为下载文件名" },
]

function InfoTooltip({ children }: { children: React.ReactNode }) {
  return (
    <Tooltip content={<div className="px-1 py-1 text-small max-w-[22rem]">{children}</div>}>
      <button
        type="button"
        aria-label="更多信息"
        className="inline-flex items-center ml-1 text-default-400 hover:text-default-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
      >
        <InfoIcon className="size-3" />
      </button>
    </Tooltip>
  )
}

function UrlTooltip({ desc, flags }: { desc?: React.ReactNode; flags?: { syntax: string; desc: string }[] }) {
  return (
    <InfoTooltip>
      {desc && <div className={flags ? "mb-2" : ""}>{desc}</div>}
      {flags && (
        <>
          <div className="font-medium mb-1">可用参数：</div>
          <div className="flex flex-col gap-1">
            {flags.map((f) => (
              <div key={f.syntax} className="flex flex-row gap-2 items-baseline">
                <code className="font-mono text-xs whitespace-nowrap">{f.syntax}</code>
                <span className="text-xs opacity-80">{f.desc}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </InfoTooltip>
  )
}

export function UploadedPanel({
  isLoading,
  loadingProgress,
  onCancel,
  pasteResponse,
  className,
  encryptionKey,
  highlightLang,
  isUrlPaste,
  ...rest
}: UploadedPanelProps) {
  const copyWidgetClassNames = `${tst}`
  const inputProps = {
    readOnly: true,
    className: "mb-2",
  }
  const [moreOpen, setMoreOpen] = useState<boolean>(false)

  const isEncrypted = Boolean(encryptionKey)
  const isMarkdown = highlightLang === "markdown"

  const urlInput = (label: string, value: string, labelExtra?: React.ReactNode) => (
    <Input
      {...inputProps}
      label={label}
      labelExtra={labelExtra}
      value={value}
      endContent={<CopyWidget className={copyWidgetClassNames} getCopyContent={() => value} />}
    />
  )

  const markdownUrlField = (pasteResponse: PasteResponse) =>
    urlInput(
      "Markdown 链接",
      withPathPrefix(pasteResponse.url, "/a"),
      <InfoTooltip>将粘贴渲染为 GitHub 风格 Markdown（支持代码高亮和 LaTeX）。</InfoTooltip>,
    )

  return (
    <Card classNames={mergeClasses({ base: tst }, { base: className })} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">已上传的粘贴</CardHeader>
      <Divider />
      <CardBody>
        {isLoading ? (
          <div className="w-full flex flex-col items-center justify-center gap-2 py-4">
            <CircularProgress
              aria-label={"加载中……"}
              value={loadingProgress ? (100 * loadingProgress.doneBytes) / Math.max(loadingProgress.totalBytes, 1) : 50}
            />
            {loadingProgress && (
              <span className="text-sm text-foreground-500 tabular-nums">
                已上传 {formatSize(loadingProgress.doneBytes)} / {formatSize(loadingProgress.totalBytes)}
              </span>
            )}
            {onCancel && (
              <Button size="sm" variant="ghost" onPress={onCancel} className="mt-1">
                取消
              </Button>
            )}
          </div>
        ) : (
          pasteResponse && (
            <>
              <Input
                {...inputProps}
                label={"展示链接"}
                labelExtra={
                  <UrlTooltip
                    desc={
                      <>
                        适合在浏览器中查看，带语法高亮。
                        {encryptionKey && (
                          <>
                            {" "}
                            解密密钥位于 URL 中 <code className="font-mono">#</code> 之后，永远不会发送到服务器——它留在浏览器中用于客户端解密。
                          </>
                        )}
                      </>
                    }
                    flags={DISPLAY_URL_FLAGS}
                  />
                }
                color={encryptionKey ? "success" : "default"}
                className="mb-2"
                value={makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                endContent={
                  <CopyWidget
                    className={encryptionKey ? `${copyWidgetClassNames} hover:bg-success-100` : copyWidgetClassNames}
                    getCopyContent={() => makeDecryptionUrl(pasteResponse.url, encryptionKey)}
                  />
                }
              />
              {isMarkdown && !isEncrypted && markdownUrlField(pasteResponse)}
              {urlInput(
                "原始链接",
                pasteResponse.url,
                <UrlTooltip
                  desc={
                    encryptionKey
                      ? "返回粘贴的原始内容——由于该粘贴使用了客户端加密，内容为加密状态。请自行用密钥解密。"
                      : "直接返回粘贴的原始内容，使用推断出的 Content-Type。"
                  }
                  flags={RAW_URL_FLAGS}
                />,
              )}
              {urlInput(
                "管理链接",
                pasteResponse.manageUrl,
                <InfoTooltip>用这个链接以后更新或删除该粘贴。请妥善保管，不要公开。</InfoTooltip>,
              )}
              <Input {...inputProps} label={"过期时间"} value={new Date(pasteResponse.expireAt).toLocaleString()} />

              <button
                type="button"
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-controls="uploaded-paste-more"
                className={
                  `mt-1 mb-2 flex flex-row items-center gap-1 text-sm text-foreground-500 cursor-pointer ` +
                  `hover:text-foreground-700 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded ${tst}`
                }
              >
                <ChevronDownIcon aria-hidden="true" className={`w-4 h-4 ${tst} ${moreOpen ? "" : "-rotate-90"}`} />
                <span>更多</span>
              </button>

              {moreOpen && (
                <div id="uploaded-paste-more">
                  {!isEncrypted && !isMarkdown && markdownUrlField(pasteResponse)}
                  {!isEncrypted &&
                    isUrlPaste &&
                    urlInput(
                      "短链接",
                      withPathPrefix(pasteResponse.url, "/u"),
                      <InfoTooltip>粘贴内容是一个 URL——该端点会重定向（302）到它。</InfoTooltip>,
                    )}
                  {urlInput(
                    "元数据链接",
                    withPathPrefix(pasteResponse.url, "/m"),
                    <InfoTooltip>
                      以 JSON 格式获取粘贴的元数据（大小、时间戳、文件名、加密方案等）。
                    </InfoTooltip>,
                  )}
                </div>
              )}
            </>
          )
        )}
      </CardBody>
    </Card>
  )
}

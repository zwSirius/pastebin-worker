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
  isProtected?: boolean
  highlightLang?: string
  isUrlPaste?: boolean
}

function withPathPrefix(url: string, prefix: string): string {
  const u = new URL(url)
  u.pathname = prefix + u.pathname
  return u.toString()
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
  isProtected,
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

  const isEncrypted = Boolean(isProtected)
  const isMarkdown = highlightLang === "markdown"
  const isHtml = highlightLang === "html"
  // 内容是合法 URL 且未开启加密分享时，主分享链接用 /u 跳转链接（加密分享的内容需要密码验证，不能直接重定向）
  const isUrlRedirect = !isEncrypted && Boolean(isUrlPaste)
  const displayUrl = pasteResponse ? withPathPrefix(pasteResponse.url, "/d") : ""

  const urlInput = (label: string, value: string, labelExtra?: React.ReactNode) => (
    <Input
      {...inputProps}
      label={label}
      labelExtra={labelExtra}
      value={value}
      endContent={<CopyWidget className={copyWidgetClassNames} getCopyContent={() => value} />}
    />
  )

  const markdownUrlField = (pasteResponse: PasteResponse, needsKey?: boolean) =>
    urlInput(
      "Markdown 链接",
      withPathPrefix(pasteResponse.url, "/a"),
      <InfoTooltip>
        将粘贴渲染为 GitHub 风格 Markdown（支持代码高亮和 LaTeX）。
        {needsKey && <> 该粘贴已开启加密分享：打开后需输入密钥才能渲染查看。</>}
      </InfoTooltip>,
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
              {isUrlRedirect ? (
                urlInput(
                  "跳转链接",
                  withPathPrefix(pasteResponse.url, "/u"),
                  <InfoTooltip>
                    粘贴内容是一个 URL——接收者打开此链接会直接跳转（302）到目标 URL，适合作为分享链接。
                  </InfoTooltip>,
                )
              ) : (
                <Input
                  {...inputProps}
                  label={"展示链接"}
                  labelExtra={
                    <UrlTooltip
                      desc={
                        <>
                          适合在浏览器中查看，带语法高亮。
                          {isEncrypted && (
                            <> 该粘贴已开启加密分享：接收者打开此链接后需输入密钥才能查看内容。</>
                          )}
                        </>
                      }
                      flags={DISPLAY_URL_FLAGS}
                    />
                  }
                  color={isEncrypted ? "success" : "default"}
                  className="mb-2"
                  value={displayUrl}
                  endContent={
                    <CopyWidget
                      className={isEncrypted ? `${copyWidgetClassNames} hover:bg-success-100` : copyWidgetClassNames}
                      getCopyContent={() => displayUrl}
                    />
                  }
                />
              )}
              {isUrlRedirect && (
                <Input
                  {...inputProps}
                  label={"展示链接"}
                  labelExtra={
                    <UrlTooltip
                      desc={<>在浏览器中查看粘贴的原始内容（此处为目标 URL 字符串），带语法高亮。</>}
                      flags={DISPLAY_URL_FLAGS}
                    />
                  }
                  className="mb-2"
                  value={withPathPrefix(pasteResponse.url, "/d")}
                  endContent={
                    <CopyWidget
                      className={copyWidgetClassNames}
                      getCopyContent={() => withPathPrefix(pasteResponse.url, "/d")}
                    />
                  }
                />
              )}
              {isMarkdown && markdownUrlField(pasteResponse, isEncrypted)}
              {isHtml &&
                urlInput(
                  "网页链接",
                  pasteResponse.url,
                  <InfoTooltip>
                    适合发送给客户：浏览器打开即渲染为网页。若已开启加密分享，客户输入密钥后即可看到渲染后的页面。
                  </InfoTooltip>,
                )}
              {urlInput(
                "原始链接",
                pasteResponse.url,
                <UrlTooltip
                  desc={
                    isEncrypted
                      ? "受密钥保护：在浏览器中打开此链接会先要求输入密钥，验证后直接展示或渲染内容（HTML 会渲染为页面）；API 客户端请携带 X-PB-Share-Passwd 头。"
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
                  {urlInput(
                    "元数据链接",
                    withPathPrefix(pasteResponse.url, "/m"),
                    <InfoTooltip>以 JSON 格式获取粘贴的元数据（大小、时间戳、文件名、加密方案等）。</InfoTooltip>,
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

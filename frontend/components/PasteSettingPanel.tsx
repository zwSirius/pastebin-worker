import type { CardProps } from "./ui/index.js"
import { Card, CardBody, CardHeader, Divider, Input, Switch, Tooltip } from "./ui/index.js"
import { verifyExpiration, verifyManageUrl } from "../utils/utils.js"
import { verifyName, verifyPassword } from "../../shared/verify.js"
import type { NameAvailability } from "../utils/useNameAvailability.js"
import React from "react"
import { CheckIcon, InfoIcon, QuestionMarkCircleIcon, SpinnerIcon, XIcon } from "./icons.js"
import { cardOverrides, inputOverrides, switchOverrides, tst } from "../utils/overrides.js"
import { PASTE_NAME_LEN, PRIVATE_PASTE_NAME_LEN } from "../../shared/constants.js"

export type UploadKind = "short" | "long" | "custom" | "manage"

export interface PasteSetting {
  uploadKind: UploadKind
  expiration: string
  password: string
  name: string
  manageUrl: string

  doEncrypt: boolean
}

interface PasteSettingPanelProps extends CardProps {
  setting: PasteSetting
  onSettingChange: (setting: PasteSetting) => void
  config: Env
  nameAvailability: NameAvailability
  footer?: React.ReactNode
}

const URL_KIND_OPTIONS: { value: UploadKind; label: string }[] = [
  { value: "short", label: "短链接" },
  { value: "long", label: "长链接" },
  { value: "custom", label: "自定义" },
  { value: "manage", label: "管理" },
]

function urlKindDescription(kind: UploadKind): string {
  switch (kind) {
    case "short":
      return `随机 ${PASTE_NAME_LEN} 个字符的名称`
    case "long":
      return `随机 ${PRIVATE_PASTE_NAME_LEN} 个字符的名称`
    case "custom":
      return "自定义名称（以 ~ 开头）"
    case "manage":
      return "更新或删除已有的粘贴"
  }
}

function urlKindExample(kind: UploadKind, deployUrl: string): string | null {
  switch (kind) {
    case "short":
      return `${deployUrl}/BxWH`
    case "long":
      return `${deployUrl}/5HQWYNmjA4h44SmybeThXXAm`
    case "custom":
      return `${deployUrl}/~stocking`
    case "manage":
      return null
  }
}

interface CustomNameUI {
  isInvalid: boolean
  errorMessage?: string
  warningMessage?: string
  successMessage?: string
  description?: string
  endContent: React.ReactNode
}

function customNameUI(name: string, availability: NameAvailability): CustomNameUI {
  const [ok, msg] = verifyName(name)
  if (!ok) return { isInvalid: true, errorMessage: msg, endContent: null }

  switch (availability.status) {
    case "idle": // debouncing — treat as checking for the user
    case "checking":
      return {
        isInvalid: false,
        description: "正在检查可用性……",
        endContent: <SpinnerIcon className="size-4 text-default-400" aria-label="正在检查可用性" />,
      }
    case "available":
      return {
        isInvalid: false,
        successMessage: "名称可用",
        endContent: <CheckIcon className="size-4 text-success" aria-label="名称可用" />,
      }
    case "taken":
      return {
        isInvalid: true,
        errorMessage: "名称已被占用",
        endContent: <XIcon className="size-4 text-danger" aria-label="名称已被占用" />,
      }
    case "error":
      return {
        isInvalid: false,
        warningMessage: `无法检查可用性：${availability.message}`,
        endContent: <QuestionMarkCircleIcon className="size-4 text-yellow-600" aria-label="可用性未知" />,
      }
  }
}

export function PanelSettingsPanel({
  setting,
  onSettingChange,
  config,
  nameAvailability,
  footer,
  ...rest
}: PasteSettingPanelProps) {
  return (
    <Card aria-label="粘贴板设置面板" classNames={cardOverrides} {...rest}>
      <CardHeader className="text-2xl pl-4 pb-2">设置</CardHeader>
      <Divider className={tst} />
      <CardBody>
        <div className="gap-4 flex flex-row">
          <Input
            type="text"
            label="过期时间"
            classNames={{
              base: "basis-40",
              ...inputOverrides,
            }}
            defaultValue="7d"
            value={setting.expiration}
            isRequired
            onValueChange={(e) => onSettingChange({ ...setting, expiration: e })}
            isInvalid={!verifyExpiration(setting.expiration, config)[0]}
            errorMessage={verifyExpiration(setting.expiration, config)[1]}
            description={verifyExpiration(setting.expiration, config)[1]}
          />
          <Input
            type="password"
            label="密码"
            labelExtra={
              <Tooltip
                content={
                  <div className="px-1 py-1 text-small max-w-[18rem]">
                    用于更新或删除你的粘贴。留空则随机生成。
                  </div>
                }
              >
                <button
                  type="button"
                  aria-label="关于密码的更多说明"
                  className="inline-flex items-center ml-1 text-default-400 hover:text-default-600 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
                >
                  <InfoIcon className="size-3" />
                </button>
              </Tooltip>
            }
            value={setting.password}
            onValueChange={(p) => onSettingChange({ ...setting, password: p })}
            isClearable
            classNames={{
              base: "flex-1",
              ...inputOverrides,
            }}
            placeholder={"自动随机生成"}
            isInvalid={!verifyPassword(setting.password)[0]}
            errorMessage={verifyPassword(setting.password)[1]}
          />
        </div>
        <Divider className={`my-4 ${tst}`} />
        <div className="pl-1">
          <div className="flex flex-row items-center flex-wrap gap-x-2 gap-y-2 text-sm">
            <span className="text-default-700">使用</span>
            <div
              role="radiogroup"
              aria-label="链接类型"
              className="inline-flex rounded-lg border border-default-200 bg-default-100"
            >
              {URL_KIND_OPTIONS.map((opt, idx) => {
                const selected = setting.uploadKind === opt.value
                const isFirst = idx === 0
                const isLast = idx === URL_KIND_OPTIONS.length - 1
                return (
                  <Tooltip
                    key={opt.value}
                    content={
                      <div className="px-1 py-1 text-small max-w-[22rem]">
                        <div>{urlKindDescription(opt.value)}</div>
                        {urlKindExample(opt.value, config.DEPLOY_URL) && (
                          <div className="mt-1 font-mono text-xs opacity-80 break-all">
                            例如 {urlKindExample(opt.value, config.DEPLOY_URL)}
                          </div>
                        )}
                      </div>
                    }
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => onSettingChange({ ...setting, uploadKind: opt.value })}
                      className={
                        `px-3 py-1 cursor-pointer ${tst} ` +
                        (isFirst ? "rounded-l-lg " : "border-l border-default-200 ") +
                        (isLast ? "rounded-r-lg " : "") +
                        (selected ? "bg-primary-50 text-primary font-medium" : "text-default-600 hover:bg-default-200")
                      }
                    >
                      {opt.label}
                    </button>
                  </Tooltip>
                )
              })}
            </div>
            <span className="text-default-700">链接</span>
          </div>

          {setting.uploadKind === "custom" &&
            (() => {
              const ui = customNameUI(setting.name, nameAvailability)
              return (
                <Input
                  value={setting.name}
                  onValueChange={(n) => onSettingChange({ ...setting, name: n })}
                  type="text"
                  className="mt-2"
                  isInvalid={ui.isInvalid}
                  errorMessage={ui.errorMessage}
                  warningMessage={ui.warningMessage}
                  successMessage={ui.successMessage}
                  description={ui.description}
                  startContent={
                    <div className="pointer-events-none flex items-center">
                      <span className="text-default-500 text-sm w-max">{`${config.DEPLOY_URL}/~`}</span>
                    </div>
                  }
                  endContent={ui.endContent}
                />
              )
            })()}
          {setting.uploadKind === "manage" && (
            <Input
              value={setting.manageUrl}
              onValueChange={(m) => onSettingChange({ ...setting, manageUrl: m })}
              type="text"
              className="mt-2"
              isInvalid={!verifyManageUrl(setting.manageUrl, config)[0]}
              errorMessage={verifyManageUrl(setting.manageUrl, config)[1]}
              placeholder="管理链接"
            />
          )}
        </div>
        <Divider className={`my-4 ${tst}`} />
        <div className="pl-1 flex flex-row items-center">
          <Switch
            classNames={switchOverrides}
            isSelected={setting.doEncrypt}
            onValueChange={(v) => onSettingChange({ ...setting, doEncrypt: v })}
          >
           客户端加密
          </Switch>
          <Tooltip
            content={
              <div className="px-1 py-2 max-w-[20rem]">
                <h3 className="text-normal font-bold mb-2">客户端加密</h3>
                <div className="text-small">
                  你的粘贴通过一个包含解密密钥的链接分享，密钥位于 URL 的 # 片段中，永远不会发送到服务器。解密在浏览器中完成，因此只有持有密钥的人（而非服务器）才能查看解密后的内容。
                </div>
                <div className="text-small mt-2 text-yellow-600">
                  仅粘贴内容会被加密。文件名及其推断出的 MIME 类型对服务器和任何持有链接的人仍然可见。
                </div>
              </div>
            }
          >
            <button
              type="button"
              aria-label="关于客户端加密的更多说明"
              className="inline-flex items-center ml-2 text-default-500 hover:text-default-700 focus:outline-none focus-visible:ring-1 focus-visible:ring-default-400 rounded"
            >
              <InfoIcon className="size-3.5" />
            </button>
          </Tooltip>
        </div>
      </CardBody>
      {footer}
    </Card>
  )
}

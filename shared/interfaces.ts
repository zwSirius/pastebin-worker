// This file contains things shared with frontend

export type PasteLocation = "KV" | "R2"

export interface MetaResponse {
  lastModifiedAt: string
  createdAt: string
  expireAt: string
  sizeBytes: number
  location: PasteLocation
  filename?: string
  highlightLanguage?: string
  encryptionScheme?: string
  passwordProtected?: boolean
}

export interface PasteResponse extends MetaResponse {
  url: string
  manageUrl: string
  expirationSeconds: number
}

export interface MPUCreateResponse {
  name: string
  key: string
  uploadId: string
}

export interface SerializedPasteData {
  // password-protected pastes embed no content/metadata: the client must
  // prompt for the share password before it can fetch anything
  passwordProtected?: boolean
  content?: string
  metadata?: MetaResponse
  name: string
  isBinary?: boolean
  guessedEncoding?: string | null
}

declare global {
  interface Window {
    __PASTE_DATA__?: SerializedPasteData
  }
}

---
name: shz-al
description: Upload, fetch, update, or delete text/binary content via {{BASE_URL}}, a curl-friendly pastebin. Use when you need a quick public URL for sharing long output, hosting a small file, shortening a URL, rendering markdown as HTML, or sharing content behind a password.
---

# shz.al

A pastebin hosted on Cloudflare Workers at `{{BASE_URL}}`. Every operation is
plain HTTP and works with `curl`. Random paste names appear bare (e.g. `abcd`);
custom names are returned with a leading `~` (e.g. `~hitagi`).

## Upload

```shell
curl -Fc='hello, world' {{BASE_URL}}        # text
curl -Fc=@file.png      {{BASE_URL}}        # file
<cmd> | curl -Fc=@-     {{BASE_URL}}        # stdin
```

Response:

```json
{
  "url": "{{BASE_URL}}/abcd",
  "manageUrl": "{{BASE_URL}}/abcd:<password>",
  "expireAt": "2026-05-21T10:33:06.114Z"
}
```

Persist `manageUrl` if the paste may need to be updated or deleted later — it
is the only way to authenticate as the owner.

## Optional upload fields

- `-Fn=<name>` — custom name (≥3 chars, returned prefixed with `~`).
- `-Fe=<expire>` — expiration: integer/float with unit `s`/`m`/`h`/`d`
  (default seconds). E.g. `-Fe=30m`, `-Fe=14d`.
- `-Fs=<password>` — set a specific management password.
- `-Fshare-passwd=<key>` — password-protect the paste (see
  [Password-protected sharing](#password-protected-sharing)).
- `-Flang=<lang>` — mark for syntax highlighting on the display page.
  `lang=markdown` also makes browsers opening the raw URL see the rendered
  article instead of the source.
- `-Fp=1` — private mode: 24-char unguessable random name.

## Fetch

```shell
curl {{BASE_URL}}/<name>                    # raw content
curl -OJ {{BASE_URL}}/~<name>               # save with server filename
curl {{BASE_URL}}/m/<name>                  # JSON metadata (size, dates, …)
curl -I {{BASE_URL}}/<name>                 # HEAD only
```

Password-protected pastes answer `403` unless the request carries
`X-PB-Share-Passwd: <key>` (see
[Password-protected sharing](#password-protected-sharing)). Metadata (`/m/`)
reports `"passwordProtected": true`.

Append `?a` for `Content-Disposition: attachment`, `?mime=<mime>` to override
the response Content-Type, or append `.<ext>` to the path to set Content-Type
by extension.

## Password-protected sharing

Upload with `-Fshare-passwd=<key>` (4-8 characters). The key is stored
server-side; the content itself is stored as-is — the key only gates access.

- Every content fetch (raw URL, `/u/`) needs `X-PB-Share-Passwd: <key>`;
  without it the worker answers `403`.
- Browsers without the key get a small key-prompt page instead; after the
  visitor enters the key, content renders exactly like an unprotected paste
  (markdown article, rendered HTML, inline images/media, plain text, or a
  download for binaries).
- Management (`PUT`/`DELETE` with the manage URL) is unchanged. On `PUT`,
  omitting `share-passwd` keeps the existing key.

## Share links

What each link shows to a browser; API clients always get the raw bytes from
the raw URL:

- `/<name>` (raw URL) — the default link to share for every paste type.
  Browsers get content rendered by type: markdown is redirected to `/a/`,
  HTML renders in a sandboxed frame, images and media display or play
  inline, other text shows as plain text, binaries download. For protected
  pastes the browser first gets the key prompt. `?a`, `?mime=` or an
  explicit extension force raw delivery instead.
- `/d/<name>` — display page: syntax-highlighted source with copy/download
  for text (HTML pastes get a source/rendered toggle), inline media, a
  download button for binaries. Append `?lang=<lang>` to override the
  highlighting language.
- `/a/<name>` — render a markdown paste as a styled HTML article
  (GitHub-flavored Markdown + syntax highlighting + MathJax). For markdown
  pastes this is equivalent to the raw URL.
- `/u/<name>` — redirect to the URL stored in the paste (URL shortener).
  Not useful for protected pastes from a browser (the key cannot travel on
  a redirect) — share the raw URL or `/d/` instead.

## Update / delete

```shell
curl -X PUT    -Fc='new content' <manageUrl>
curl -X DELETE                   <manageUrl>
```

`PUT` accepts the same fields as upload; `e` recalculates expiration from now.

## Limitations

- Default expiration is `{{DEFAULT_EXPIRATION}}`, max `{{MAX_EXPIRATION}}`. Pastes are deleted on expiry.
- Max upload size is `{{R2_MAX_ALLOWED}}`.
- A single request body is capped at 100 MB by Cloudflare (you get
  HTTP `413 Payload Too Large` back, returned by the platform before the
  worker runs). Files larger than 100 MB therefore cannot be sent via a
  single `curl -Fc=@…` — use the web UI at `{{BASE_URL}}` or the `pb` CLI
  (see [scripts/](https://github.com/SharzyL/pastebin-worker/tree/goshujin/scripts)),
  both of which split large files automatically.
- Treat the service as ephemeral storage — do not rely on it for archival.

## Full docs

- `{{BASE_URL}}/doc/curl.md` — comprehensive curl guide.
- `{{BASE_URL}}/doc/api.md` — HTTP API reference.

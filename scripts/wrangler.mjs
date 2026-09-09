// Wrangler passthrough that supports an optional R2 bucket binding and a
// gitignored local secrets file.
//
// wrangler.toml keeps the [[r2_buckets]] section with `bucket_name = ""` in
// KV-only mode. Since wrangler refuses to deploy an empty bucket_name, this
// script rewrites the config into wrangler.effective.toml first:
//   - bucket_name empty or missing -> the r2_buckets section is stripped
//   - bucket_name non-empty        -> config is passed through verbatim
//   - if wrangler.secret.toml exists, its [vars] entries are merged into the
//     effective config's [vars] section (overriding wrangler.toml values), so
//     secrets like BASIC_AUTH stay out of version control.
// All wrangler subcommands (deploy, dev, types, kv ...) are forwarded.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const sourceConfig = join(root, "wrangler.toml")
const secretConfig = join(root, "wrangler.secret.toml")
const effectiveConfig = join(root, "wrangler.effective.toml")

const text = readFileSync(sourceConfig, "utf8")

function r2BucketNameEmpty(blockLines) {
  for (const line of blockLines) {
    const m = /^\s*bucket_name\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(line)
    if (m) return (m[1] ?? m[2]) === ""
  }
  // no bucket_name key at all -> treat as KV-only
  return true
}

function stripR2Section(lines) {
  const out = []
  let i = 0
  while (i < lines.length) {
    if (/^\s*\[\[r2_buckets\]\]\s*$/.test(lines[i])) {
      const block = []
      i++
      while (i < lines.length && !/^\s*\[/.test(lines[i])) {
        block.push(lines[i])
        i++
      }
      if (r2BucketNameEmpty(block)) {
        // swallow the blank lines that followed the stripped block
        while (i < lines.length && lines[i].trim() === "") i++
        // drop a blank line left directly before the stripped block
        while (out.length > 0 && out[out.length - 1].trim() === "") out.pop()
        continue
      }
      out.push("[[r2_buckets]]", ...block)
      continue
    }
    out.push(lines[i])
    i++
  }
  return out
}

// Reads KEY = value pairs from the secrets file, ignoring section headers and comments.
function readSecretVars(path) {
  if (!existsSync(path)) return new Map()
  const entries = new Map()
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim()
    if (line === "" || line.startsWith("#") || line.startsWith("[")) continue
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(line)
    if (m) entries.set(m[1], m[2])
  }
  return entries
}

// Overrides matching keys inside the [vars] section; appends any that are absent.
function mergeSecretVars(lines, secrets) {
  if (secrets.size === 0) return lines
  const out = []
  let inVars = false
  let sawVars = false
  const written = new Set()

  for (const line of lines) {
    const sectionMatch = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sectionMatch) {
      if (inVars) {
        // append secrets that wrangler.toml did not define
        for (const [key, value] of secrets) {
          if (!written.has(key)) out.push(`${key} = ${value}`)
        }
      }
      inVars = sectionMatch[1] === "vars"
      sawVars = sawVars || inVars
      out.push(line)
      continue
    }
    if (inVars) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
      if (m && secrets.has(m[1])) {
        out.push(`${m[1]} = ${secrets.get(m[1])}`)
        written.add(m[1])
        continue
      }
    }
    out.push(line)
  }

  if (inVars) {
    for (const [key, value] of secrets) {
      if (!written.has(key)) out.push(`${key} = ${value}`)
    }
  }
  if (!sawVars) {
    out.push("[vars]")
    for (const [key, value] of secrets) out.push(`${key} = ${value}`)
  }
  return out
}

const lines = text.split(/\r?\n/)
const effective = mergeSecretVars(stripR2Section(lines), readSecretVars(secretConfig)).join("\n")
writeFileSync(effectiveConfig, effective)

const wranglerBin = join(root, "node_modules", "wrangler", "bin", "wrangler.js")
const args = [...process.argv.slice(2), "--config", "wrangler.effective.toml"]
const result = spawnSync(process.execPath, [wranglerBin, ...args], {
  stdio: "inherit",
  cwd: root,
})

try {
  unlinkSync(effectiveConfig)
} catch {
  // already gone
}

process.exit(result.status ?? 1)

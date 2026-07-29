/**
 * Error-only watch for .harvest-queue.log + process liveness.
 * Prints only when ERROR / queue empty / no processes.
 *   node scripts/_watch_harvest.mjs
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const LOG = resolve(ROOT, '.harvest-queue.log')
const INTERVAL_MS = 90_000

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function harvestProcsAlive() {
  try {
    const out = execSync(
      "powershell -NoProfile -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe'\\\" | ForEach-Object { $_.CommandLine }\"",
      { encoding: 'utf8', windowsHide: true, timeout: 20000 },
    )
    return /harvest_queue|mall-brand-cycle\.mjs/i.test(out || '')
  } catch {
    return false
  }
}

async function main() {
  let offset = existsSync(LOG) ? statSync(LOG).size : 0
  for (;;) {
    await sleep(INTERVAL_MS)
    if (!harvestProcsAlive()) {
      console.error('[ALERT] no harvest_queue or mall-brand-cycle process')
      process.exitCode = 1
      return
    }
    if (!existsSync(LOG)) continue
    const size = statSync(LOG).size
    if (size < offset) offset = 0
    if (size <= offset) continue
    const buf = readFileSync(LOG)
    const chunk = buf.subarray(offset, size).toString('utf8')
    offset = size
    if (!/ERROR|3 consecutive|queue empty/i.test(chunk)) continue
    const lines = chunk
      .split(/\r?\n/)
      .filter((l) => /ERROR|queue empty|ok |start /i.test(l))
      .slice(-12)
    for (const l of lines) console.error(l)
    if (/3 consecutive failures/i.test(chunk) || /queue empty/i.test(chunk)) {
      process.exitCode = /queue empty/i.test(chunk) ? 0 : 1
      return
    }
  }
}

main().catch((e) => {
  console.error(`[watch ERROR] ${e?.stack || e}`)
  process.exitCode = 1
})

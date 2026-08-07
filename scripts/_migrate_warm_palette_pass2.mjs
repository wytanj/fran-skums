import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app')

const pairs = [
  ['ring-indigo-500/30', 'ring-yellow-deep/30'],
  ['ring-indigo-500/20', 'ring-yellow-deep/20'],
  ['text-indigo-500', 'text-brown'],
  ['text-indigo-100', 'text-brown'],
  ['bg-indigo-950/10', 'bg-yellow-soft/40'],
  ['border-indigo-900/40', 'border-line'],
  ['bg-gray-500/10', 'bg-surface-sunken'],
  ['bg-gray-500/20', 'bg-surface-sunken'],
  ['bg-gray-400/20', 'bg-surface-sunken'],
  ['bg-gray-600/30', 'bg-surface-sunken'],
  ['bg-gray-600/20', 'bg-surface-sunken'],
  ['border-gray-500/30', 'border-line'],
  ['border-gray-400/30', 'border-line'],
  ['ring-gray-600/40', 'ring-line'],
  ['ring-gray-500/30', 'ring-line'],
  ['text-gray-700', 'text-muted'],
  ['bg-gray-600', 'bg-muted'],
  ['bg-gray-500', 'bg-muted'],
  ['bg-red-400', 'bg-danger'],
  ['bg-red-500/20', 'bg-danger-soft'],
  ['bg-green-500/20', 'bg-success-soft'],
  ['text-green-300', 'text-success'],
  ['bg-gray-50', 'bg-cream'],
  ['text-gray-900', 'text-ink'],
  ['dark:bg-cream', 'bg-cream'],
  ['dark:text-ink', 'text-ink'],
]

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(ent.name)) out.push(p)
  }
  return out
}

let n = 0
for (const f of walk(root)) {
  let s = fs.readFileSync(f, 'utf8')
  let x = s
  for (const [a, b] of pairs) if (x.includes(a)) x = x.split(a).join(b)
  if (x !== s) {
    fs.writeFileSync(f, x)
    n++
    console.log(path.relative(root, f))
  }
}
console.log('pass2 changed', n)

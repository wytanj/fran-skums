/**
 * One-shot: map leftover dark/indigo Tailwind classes to the warm Fran palette.
 * Safe to re-run (idempotent once classes are already warm).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../app')

/** Longest-first so partials don't clobber longer matches. */
const pairs = [
  ['bg-gray-950', 'bg-cream'],
  ['bg-gray-900/80', 'bg-surface-sunken'],
  ['bg-gray-900/50', 'bg-surface-sunken/80'],
  ['bg-gray-900', 'bg-white'],
  ['bg-gray-800/50', 'bg-surface-sunken'],
  ['bg-gray-800/30', 'bg-surface-sunken/60'],
  ['bg-gray-800', 'bg-surface-sunken'],
  ['bg-gray-700', 'bg-line'],
  ['bg-black/60', 'bg-brown/40'],
  ['bg-black/40', 'bg-brown/30'],
  ['bg-white/[0.02]', 'bg-white/60'],
  ['bg-white/[0.01]', 'bg-surface-sunken/40'],
  ['bg-white/5', 'bg-surface-sunken'],
  ['border-gray-800/50', 'border-line-soft'],
  ['border-gray-800/80', 'border-line'],
  ['border-gray-800', 'border-line'],
  ['border-gray-700', 'border-line'],
  ['border-gray-600', 'border-line-strong'],
  ['border-white/5', 'border-line'],
  ['divide-gray-800/50', 'divide-line-soft'],
  ['divide-gray-800', 'divide-line'],
  ['text-gray-100', 'text-ink'],
  ['text-gray-200', 'text-ink-soft'],
  ['text-gray-300', 'text-ink-soft'],
  ['text-gray-400', 'text-muted'],
  ['text-gray-500', 'text-muted'],
  ['text-gray-600', 'text-muted'],
  ['bg-indigo-600/20', 'bg-yellow-soft'],
  ['bg-indigo-600/10', 'bg-yellow-soft'],
  ['bg-indigo-600/5', 'bg-yellow-soft/50'],
  ['bg-indigo-600/8', 'bg-yellow/20'],
  ['bg-indigo-500/5', 'bg-yellow-soft/40'],
  ['bg-indigo-600', 'bg-yellow'],
  ['bg-indigo-500', 'bg-yellow-deep'],
  ['text-indigo-400', 'text-brown'],
  ['text-indigo-300', 'text-brown'],
  ['text-indigo-200', 'text-ink-soft'],
  ['border-indigo-500/50', 'border-yellow-deep'],
  ['border-indigo-500/40', 'border-line'],
  ['border-indigo-500/30', 'border-line'],
  ['border-indigo-500/20', 'border-yellow-deep/40'],
  ['border-l-indigo-500', 'border-l-yellow-deep'],
  ['hover:border-indigo-500/50', 'hover:border-yellow-deep'],
  ['hover:border-indigo-500/40', 'hover:border-line'],
  ['hover:border-indigo-500/30', 'hover:border-line'],
  ['hover:bg-indigo-600/20', 'hover:bg-yellow-soft'],
  ['hover:bg-indigo-600/5', 'hover:bg-yellow-soft/50'],
  ['hover:bg-indigo-500', 'hover:bg-yellow-deep'],
  ['hover:text-indigo-300', 'hover:text-brown'],
  ['hover:text-indigo-200', 'hover:text-ink'],
  ['focus:ring-indigo-500', 'focus:ring-yellow-deep'],
  ['focus:border-indigo-500/50', 'focus:border-brown'],
  ['shadow-indigo-600/25', 'shadow-glow'],
  ['shadow-indigo-600/40', 'shadow-glow'],
  ['bg-emerald-600/20', 'bg-success-soft'],
  ['bg-emerald-600/10', 'bg-success-soft'],
  ['bg-emerald-500/10', 'bg-success-soft'],
  ['text-emerald-400', 'text-success'],
  ['text-emerald-500', 'text-success'],
  ['text-emerald-300', 'text-success'],
  ['border-emerald-500/30', 'border-success/30'],
  ['border-emerald-500/20', 'border-success/20'],
  ['ring-emerald-500/20', 'ring-success/20'],
  ['hover:border-emerald-500/30', 'hover:border-success/30'],
  ['hover:bg-emerald-600/5', 'hover:bg-success-soft'],
  ['bg-red-600/10', 'bg-danger-soft'],
  ['bg-red-500/10', 'bg-danger-soft'],
  ['text-red-400', 'text-danger'],
  ['text-red-300', 'text-danger'],
  ['border-red-500/30', 'border-danger/30'],
  ['hover:text-red-300', 'hover:text-danger'],
  ['text-amber-400', 'text-warning'],
  ['text-amber-300', 'text-warning'],
  ['bg-amber-500/10', 'bg-warning-soft'],
  ['text-yellow-400', 'text-warning'],
  ['bg-yellow-500/10', 'bg-yellow-soft'],
  ['bg-yellow-600/10', 'bg-yellow-soft'],
  ['ring-yellow-500/20', 'ring-yellow-deep/30'],
  ['bg-sky-600/10', 'bg-blue-soft'],
  ['bg-sky-500/10', 'bg-blue-soft'],
  ['text-sky-400', 'text-brown'],
  ['text-sky-300', 'text-brown'],
  ['border-sky-500/30', 'border-blue/40'],
  ['hover:border-sky-500/30', 'hover:border-blue'],
  ['bg-purple-600/10', 'bg-peach-soft'],
  ['text-purple-400', 'text-brown'],
  ['border-purple-500/30', 'border-peach'],
  ['hover:border-purple-500/30', 'hover:border-peach'],
  ['hover:bg-purple-600/5', 'hover:bg-peach-soft'],
  ['bg-pink-600/10', 'bg-peach-soft'],
  ['text-pink-400', 'text-streak'],
  ['border-pink-500/30', 'border-peach'],
  ['hover:border-pink-500/30', 'hover:border-peach'],
  ['bg-orange-600/10', 'bg-warning-soft'],
  ['text-orange-400', 'text-warning'],
  ['border-orange-500/30', 'border-warning/30'],
  ['hover:border-orange-500/30', 'hover:border-warning/30'],
  ['hover:bg-orange-600/5', 'hover:bg-warning-soft'],
  ['hover:bg-gray-800', 'hover:bg-surface-sunken'],
  ['hover:bg-gray-700', 'hover:bg-surface-sunken'],
  ['hover:bg-gray-900', 'hover:bg-surface-sunken'],
  ['hover:text-white', 'hover:text-ink'],
  ['hover:border-gray-600', 'hover:border-line-strong'],
  ['hover:border-gray-700', 'hover:border-line'],
  ['ring-gray-700', 'ring-line'],
  ['ring-gray-500/20', 'ring-line'],
  ['focus:ring-offset-gray-900', 'focus:ring-offset-cream'],
  ['border-gray-600', 'border-line-strong'],
  ['placeholder-gray-500', 'placeholder:text-muted'],
  ['placeholder:text-gray-500', 'placeholder:text-muted'],
]

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, out)
    else if (/\.(vue|ts)$/.test(ent.name)) out.push(p)
  }
  return out
}

const files = walk(root)
let changed = 0

for (const file of files) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  let src = fs.readFileSync(file, 'utf8')
  let next = src
  for (const [from, to] of pairs) {
    if (next.includes(from)) next = next.split(from).join(to)
  }
  next = next.replace(/\btext-white\b/g, 'text-ink')
  next = next.replace(/bg-yellow([^\s"'`]*)\s+text-ink/g, 'bg-yellow$1 text-brown')
  next = next.replace(/bg-yellow-deep([^\s"'`]*)\s+text-ink/g, 'bg-yellow-deep$1 text-brown')
  if (next !== src) {
    fs.writeFileSync(file, next)
    changed++
    console.log('updated', rel)
  }
}

console.log(`files changed: ${changed} of ${files.length}`)

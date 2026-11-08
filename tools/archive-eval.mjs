// 对话史检索评测：跑 tests/archive-eval.json 里的 30 题，出命中率。
//
// 用法：node tools/archive-eval.mjs [--k 5] [--verbose]
// 指标：
//   pos  命中@1/@3/@5 + MRR（期望日期出现在第几条）
//   neg  正确拒答率（返回 0 条才算对）
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const mod = await import('file:///' + join(HERE, '..', 'packages', 'dsh-ayy-archive', 'index.js').replace(/\\/g, '/'))
const regs = []
mod.apply({ tools: { register: (t) => regs.push(t) } })
const arch = regs.find((r) => r.name === 'ayy_arch')

const argv = process.argv.slice(2)
const K = Number((() => { const i = argv.indexOf('--k'); return i >= 0 ? argv[i + 1] : 0 })()) || 5
const VERBOSE = argv.includes('--verbose')
const SCOPE = (() => { const i = argv.indexOf('--scope'); return i >= 0 ? argv[i + 1] : 'her' })()

const set = JSON.parse(readFileSync(join(HERE, '..', 'tests', 'archive-eval.json'), 'utf8'))
const cases = set.cases

let hit1 = 0
let hit3 = 0
let hitK = 0
let mrr = 0
let posN = 0
let negPass = 0
let negN = 0
const fails = []

for (const c of cases) {
  const r = await arch.execute({ action: 'search', query: c.q, scope: SCOPE, limit: K })
  const rows = Array.isArray(r?.结果) ? r.结果 : []
  const days = rows.map((x) => x.day)

  if (c.neg) {
    negN++
    const ok = rows.length === 0
    if (ok) negPass++
    else fails.push({ id: c.id, q: c.q, kind: 'neg误召回', got: days.slice(0, 3) })
    if (VERBOSE) console.log(`#${c.id} [负] ${c.q} → ${rows.length} 条 ${ok ? '✓' : '✗ ' + days.slice(0, 2)}`)
    continue
  }

  posN++
  const at = days.findIndex((d) => c.expect.includes(d))
  if (at === 0) hit1++
  if (at >= 0 && at < 3) hit3++
  if (at >= 0) {
    hitK++
    mrr += 1 / (at + 1)
  } else {
    fails.push({ id: c.id, q: c.q, kind: '未命中', want: c.expect, got: days.slice(0, 3) })
  }
  if (VERBOSE) console.log(`#${c.id} ${c.q} → ${at >= 0 ? '✓ 第' + (at + 1) + '条' : '✗ ' + JSON.stringify(days.slice(0, 3))}`)
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 + '%' : '—')
console.log(`\n=== 对话史检索评测（scope=${SCOPE}, k=${K}）===`)
console.log(`正样本 ${posN} 题`)
console.log(`  命中@1   ${hit1}/${posN}  ${pct(hit1, posN)}`)
console.log(`  命中@3   ${hit3}/${posN}  ${pct(hit3, posN)}`)
console.log(`  命中@${K}   ${hitK}/${posN}  ${pct(hitK, posN)}`)
console.log(`  MRR      ${(mrr / posN).toFixed(3)}`)
console.log(`负样本 ${negN} 题`)
console.log(`  正确拒答 ${negPass}/${negN}  ${pct(negPass, negN)}`)
if (fails.length) {
  console.log(`\n未通过 ${fails.length} 题：`)
  for (const f of fails) {
    if (f.kind === '未命中') console.log(`  #${f.id} ${f.q}  期望 ${JSON.stringify(f.want)}  实际 ${JSON.stringify(f.got)}`)
    else console.log(`  #${f.id} ${f.q}  不该有结果，却返回 ${JSON.stringify(f.got)}`)
  }
}

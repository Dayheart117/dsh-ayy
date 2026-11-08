// 把「行测错题」本子导进题库（ayy_bank）。
//
// 用法（在仓库根目录）：
//   node tools/import-bank.mjs                 只解析，打印统计（不写库）
//   node tools/import-bank.mjs --apply         解析并写进 ~/.dsh/ayy-bank/bank.db
//   node tools/import-bank.mjs --file 某本.md --source 粉笔42季 --apply
//
// 规则（不猜）：
//   · 显式写「对」→ 1 分；显式写「错」→ 0 分；什么都没写 → 未知(null)，不当错题算
//   · 题干只取那一行的摘要，完整解析留在本子里（doc 字段记住位置）
//   · source/day 从本子标题里抠（"粉笔2027国考行测模考大赛第41季，2026-11-01"）
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const flag = (name, def) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : def
}
const APPLY = args.includes('--apply')
const NOTE = flag('--file', path.join(os.homedir(), '.dsh', 'personas', 'notes', '行测错题.md'))
const FORCE_SOURCE = flag('--source', '')
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\//, '')), 'bank-import-items.json')

const text = fs.readFileSync(NOTE, 'utf8')
const lines = text.split('\n')

// 标题里抠：第41季 / 日期
const t = /第\s*(\d+)\s*季[^\d]*(\d{4}-\d{2}-\d{2})?/.exec(lines[0] || '')
const source = FORCE_SOURCE || (t ? `粉笔${t[1]}季` : '未标注')
const day = (t && t[2]) || '1970-01-01'

// 把「考点」归成「题型」：本子括号里多是考点（基期比重、两期比重差），
// 直接当题型会让统计碎成一题一类。原值保留到 ability。
function normType(module, raw) {
  const s = String(raw || '')
  if (module === '资料分析') {
    if (/产销率/.test(s)) return '产销率'
    if (/比重/.test(s)) return '比重'
    if (/平均数/.test(s)) return '平均数'
    if (/倍数/.test(s)) return '倍数'
    if (/增长|增量|环比|同比/.test(s)) return '增长率'
    if (/综合/.test(s)) return '综合分析'
    return '其他计算'
  }
  if (module === '数量关系') {
    if (/工程/.test(s)) return '工程问题'
    if (/容斥|集合/.test(s)) return '容斥问题'
    if (/和差倍比/.test(s)) return '和差倍比'
    if (/构造|数列/.test(s)) return '数列构造'
    if (/几何/.test(s)) return '几何'
    return '其他'
  }
  if (module === '判断推理') {
    if (/图形/.test(s)) return '图形推理'
    if (/定义/.test(s)) return '定义判断'
    if (/类比/.test(s)) return '类比推理'
    if (/逻辑/.test(s)) return '逻辑判断'
    if (/分析/.test(s)) return '分析推理'
    return s || '其他'
  }
  if (module === '政治理论') return '政治理论'
  if (module === '言语理解') {
    if (/填空/.test(s)) return '逻辑填空'
    if (/主旨|标题|横线/.test(s)) return '片段阅读'
    return s || '言语'
  }
  return s || '(未填)'
}

const items = []
let module = ''

function push(o) {
  items.push({
    day: o.day || day,
    source: o.source || source,
    module: o.module || module,
    type: normType(o.module || module, o.type),
    no: o.no || '',
    score: o.score === undefined ? null : o.score,
    full: 1,
    wrong: o.wrong || '',
    note: (o.note || '').slice(0, 120),
    stem: (o.stem || '').slice(0, 200),
    seconds: o.seconds ?? null,
    doc: o.doc || '',
  })
}

for (let i = 0; i < lines.length; i++) {
  const L = lines[i].trim()
  if (!L) continue

  // 模块标题：## ① 判断推理（已录完：18对17错）
  const mh = /^##\s*[①②③④⑤⑥⑦]?\s*([^\s（(]+)/.exec(L)
  if (mh && L.startsWith('##')) {
    module = mh[1]
    continue
  }

  // 紧凑列表： [图形推理：76黑白点分层;77数量规律]   或   [1错(普遍/特殊);2对;...]
  const cb = /^\[(.+)\]$/.exec(L)
  if (cb && /\d/.test(cb[1])) {
    const body = cb[1]
    const withType = /^(.+?)：(.+)$/.exec(body)
    const type = withType ? withType[1].trim() : ''
    const list = (withType ? withType[2] : body).split(/[;；]/)
    for (const segRaw of list) {
      const seg = segRaw.trim()
      if (!seg) continue
      const mm = /^(\d+)\s*(.*)$/.exec(seg)
      if (!mm) continue
      const no = mm[1]
      const rest = (mm[2] || '').trim()
      const okMark = /^对/.test(rest)
      const badMark = /^错/.test(rest)
      push({
        type,
        no,
        score: okMark ? 1 : badMark ? 0 : null,
        wrong: badMark ? rest.replace(/^错[（(]?/, '').replace(/[）)]$/, '') || '未标注' : '',
        note: rest,
        stem: rest,
      })
    }
    continue
  }

  // 详解块：**第67题（和差倍比）** 选 A(33)，正确 C(17)；59%，38秒
  const hb = /^\*\*第(\d+)题[（(](.+?)[）)]\*\*\s*(.*)$/.exec(L)
  if (hb) {
    const no = hb[1]
    const type = hb[2].trim()
    const tail = hb[3]
    const ok = /^对/.test(tail.trim())
    const bad = /^选/.test(tail.trim()) || /错/.test(tail)
    // 往后几行里找「错因：」
    let wrong = ''
    for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
      const t2 = lines[j].trim()
      if (/^\*\*第\d+题/.test(t2) || /^##/.test(t2)) break
      const w = /错因[：:]\s*(.+)$/.exec(t2)
      if (w) { wrong = w[1].trim(); break }
    }
    const mm = /(\d+)分(\d+)秒/.exec(tail)
    const sec1 = /(\d+)秒/.exec(tail)
    const seconds = mm ? Number(mm[1]) * 60 + Number(mm[2]) : sec1 ? Number(sec1[1]) : null
    push({
      type,
      no,
      score: ok ? 1 : bad ? 0 : null,
      wrong: ok ? '' : wrong || '未标注',
      note: tail.slice(0, 80),
      stem: tail.slice(0, 120),
      seconds,
      doc: `${path.basename(NOTE)}#第${no}题`,
    })
    continue
  }

  // 行内单题：**111 间隔增长率** 对（B）；77%，1分38秒
  const hb2 = /^\*\*(\d{2,3})\s+(.+?)\*\*\s*(.*)$/.exec(L)
  if (hb2) {
    const no = hb2[1]
    const type = hb2[2].trim()
    const tail = hb2[3]
    const ok = /^对/.test(tail.trim())
    const mm = /(\d+)分(\d+)秒/.exec(tail)
    const sec1 = /(\d+)秒/.exec(tail)
    push({
      type,
      no,
      score: ok ? 1 : /选/.test(tail) ? 0 : null,
      wrong: ok ? '' : '未标注',
      note: tail.slice(0, 80),
      stem: tail.slice(0, 120),
      seconds: mm ? Number(mm[1]) * 60 + Number(mm[2]) : sec1 ? Number(sec1[1]) : null,
      doc: `${path.basename(NOTE)}#${no}`,
    })
  }
}

// 统计
const by = {}
for (const it of items) {
  const k = it.module || '(未分类)'
  by[k] = by[k] || { n: 0, ok: 0, bad: 0, unk: 0, types: new Set() }
  by[k].n++
  if (it.score === 1) by[k].ok++
  else if (it.score === 0) by[k].bad++
  else by[k].unk++
  if (it.type) by[k].types.add(it.type)
}
console.log(`来源 ${source} · 日期 ${day} · 解析出 ${items.length} 条`)
for (const k of Object.keys(by)) {
  const v = by[k]
  console.log(`  ${k}: ${v.n} 条（对 ${v.ok} / 错 ${v.bad} / 未标 ${v.unk}）· 题型 ${v.types.size} 种`)
}

fs.writeFileSync(OUT, JSON.stringify(items, null, 1), 'utf8')
console.log(`\n已写出 ${OUT}`)

if (APPLY) {
  const { DatabaseSync } = await import('node:sqlite')
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dbFile = path.join(home, 'ayy-bank', 'bank.db')
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  const db = new DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL')
  const cols = ['day', 'source', 'module', 'type', 'ability', 'points', 'score', 'full', 'wrong', 'seconds', 'no', 'note', 'stem', 'ask', 'key', 'doc', 'created']
  // 缺列就补（跟插件同一套逻辑）
  const have = new Set(db.prepare('PRAGMA table_info(questions)').all().map((r) => r.name))
  if (!have.size) {
    db.exec(`CREATE TABLE questions (id INTEGER PRIMARY KEY AUTOINCREMENT, ${cols.filter((c) => c !== 'created').map((c) => (c === 'score' || c === 'full' ? `${c} REAL` : c === 'seconds' ? `${c} INTEGER` : `${c} TEXT`)).join(', ')}, created TEXT)`)
  }
  for (const c of ['stem', 'ask', 'key', 'doc']) {
    if (!have.has(c) && have.size) db.exec(`ALTER TABLE questions ADD COLUMN ${c} TEXT DEFAULT ''`)
  }
  const stmt = db.prepare(`INSERT INTO questions (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
  let n = 0
  db.exec('BEGIN')
  for (const it of items) {
    stmt.run(...cols.map((c) => (c === 'created' ? new Date().toISOString() : it[c] ?? '')), )
    n++
  }
  db.exec('COMMIT')
  const total = db.prepare('SELECT COUNT(*) AS n FROM questions').get().n
  console.log(`\n已写入 ${n} 条 → 库里共 ${total} 条（${dbFile}）`)
  db.close()
}

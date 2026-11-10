/**
 * dsh-ayy-bank —— 她的题库
 *
 * 一行一题，存在 SQLite 里（Node 24 自带 node:sqlite，不需要装依赖）。
 * 为什么要真数据库：她要的不是“存下来”，是“按题型看错误率、按错因看分布”。
 * markdown 本子能干前一半，干不了后一半——只能靠人肉数或者写脚本。
 */
import { DatabaseSync } from 'node:sqlite'
import { embed, pack, unpack, cosine, textOf, hashOf, localUp } from './lib/vector.js'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-bank'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-bank')
const DB = join(DIR, 'bank.db')
const LOG = join(DIR, 'bank.log')
const TAXONOMY = join(DIR, 'taxonomy.json')

function log(msg) {
  try {
    mkdirSync(DIR, { recursive: true })
    if (existsSync(LOG) && statSync(LOG).size > 1024 * 1024) renameSync(LOG, LOG + '.1')
    appendFileSync(LOG, `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}\n`)
  } catch {
    /* 日志写不进去也不能影响主流程 */
  }
}

let db = null

function open() {
  if (db) return db
  mkdirSync(DIR, { recursive: true })
  db = new DatabaseSync(DB)
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT, source TEXT, module TEXT, type TEXT,
      ability TEXT, points TEXT,
      score REAL, full REAL, wrong TEXT,
      seconds INTEGER, no TEXT, note TEXT,
      created TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_type ON questions(type);
    CREATE INDEX IF NOT EXISTS idx_source ON questions(source);
    CREATE INDEX IF NOT EXISTS idx_module ON questions(module);
    CREATE INDEX IF NOT EXISTS idx_wrong ON questions(wrong);
  `)
  // 整卷成绩：一个卷子 + 每个节点的题数/答对/用时（对应粉笔成绩单那种层级）
  db.exec(`
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT, source TEXT, subject TEXT,
      total INTEGER, right_n INTEGER, wrong_n INTEGER, seconds INTEGER, score REAL,
      note TEXT, created TEXT
    );
    CREATE TABLE IF NOT EXISTS paper_nodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paper_id INTEGER, module TEXT, type TEXT, ability TEXT,
      total INTEGER, right_n INTEGER, seconds INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_pn_paper ON paper_nodes(paper_id);
  `)
  // 卷子节点也要有 path，才能和题目级统计合到一棵树上
  try {
    const hasPn = new Set(db.prepare('PRAGMA table_info(paper_nodes)').all().map((r) => r.name))
    if (!hasPn.has('path')) db.exec("ALTER TABLE paper_nodes ADD COLUMN path TEXT DEFAULT ''")
    db.exec(`UPDATE paper_nodes SET path = (
      SELECT coalesce(p.subject,'') || '/' || coalesce(paper_nodes.module,'') || '/' ||
             coalesce(paper_nodes.type,'') || '/' || coalesce(paper_nodes.ability,'')
      FROM papers p WHERE p.id = paper_nodes.paper_id)
      WHERE path IS NULL OR path = ''`)
    db.exec(`UPDATE paper_nodes SET path = trim(replace(replace(path,'//','/'),'//','/'),'/')`)
  } catch { /* 老库结构异常不影响统计 */ }
  db.exec(`
  `)

  // 任意深度：path 存整条层级（"行测/判断推理/图形推理/数量规律/线"）
  // tags 存正交维度（如 "材料:统计表"），和层级分开，否则两轴会打架
  const have2 = new Set(db.prepare('PRAGMA table_info(questions)').all().map((r) => r.name))
  for (const [col, def] of [['path', "TEXT DEFAULT ''"], ['tags', "TEXT DEFAULT '[]'"], ['anchor', "TEXT DEFAULT ''"], ['digest', "TEXT DEFAULT ''"], ['body', "TEXT DEFAULT ''"], ['answer', "TEXT DEFAULT ''"], ['picked', "TEXT DEFAULT ''"], ['analysis', "TEXT DEFAULT ''"]]) {
    if (!have2.has(col)) db.exec(`ALTER TABLE questions ADD COLUMN ${col} ${def}`)
  }
  // 回填：老数据没有 path 的，用 科目/模块/题型/考点 拼一份
  try {
    db.exec(`UPDATE questions SET path = trim(replace(
      coalesce(nullif(subject,''),'') || '/' || coalesce(nullif(module,''),'') || '/' ||
      coalesce(nullif(type,''),'') || '/' || coalesce(nullif(ability,''),''), '//', '/'), '/')
      WHERE (path IS NULL OR path = '') AND (module IS NOT NULL AND module <> '')`)
  } catch { /* 回填失败不影响使用 */ }
  // 后加的列：老库自动补（ALTER 加列，不重建表）
  const have = new Set(db.prepare('PRAGMA table_info(questions)').all().map((r) => r.name))
  for (const [col, def] of [
    ['stem', "TEXT DEFAULT ''"],   // 题干摘要（一行能认出是哪道题，别塞材料）
    ['ask', "TEXT DEFAULT ''"],    // 题目问法（"概括……做法"）
    ['key', "TEXT DEFAULT ''"],    // 采分点清单（几句短句，可统计）
    ['doc', "TEXT DEFAULT ''"],    // 完整解析在哪个本子（相对路径#锚点）
    ['material', "TEXT DEFAULT ''"], // 材料类型：文字资料/统计表/统计图/综合资料
    ['subject', "TEXT DEFAULT '行测'"], // 科目：行测/申论/面试
  ]) {
    if (!have.has(col)) db.exec(`ALTER TABLE questions ADD COLUMN ${col} ${def}`)
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS vecs (
      row_id INTEGER PRIMARY KEY,
      model TEXT,
      dim INTEGER,
      v BLOB,
      text_hash TEXT,
      at TEXT
    );
  `)
  // WAL：读写不互相阻塞，崩溃不易坏
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
  } catch {
    /* 某些盘不支持 WAL，退回默认模式 */
  }
  return db
}

/** 读分类表：科目 → 模块 → [题型]。读不到就返回空对象（不影响录题）。 */
function readTaxonomy() {
  try {
    const raw = readFileSync(TAXONOMY, 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    const out = {}
    for (const [sub, mods] of Object.entries(j)) {
      if (sub.startsWith('_') || !mods || typeof mods !== 'object') continue
      out[sub] = mods
    }
    return out
  } catch {
    return {}
  }
}

/** 这个题型在分类表里吗？返回 { known, subject, module, siblings } */
function checkType(subject, module, type) {
  const tax = readTaxonomy()
  const mods = tax[subject]
  if (!mods) return { known: false, reason: '科目不在分类表' }
  const list = mods[module]
  if (!list) return { known: false, reason: '模块不在分类表' }
  return { known: list.includes(type), siblings: list }
}

/** 按「来源+题号」覆盖已有记录（upsert），避免同一道题重复入库 */
function upsertOne(item) {
  const d = open()
  const ex = d.prepare('SELECT id FROM questions WHERE source = ? AND no = ?').get(String(item.source || ''), String(item.no || ''))
  if (!ex) return null
  const patch = {}
  for (const k of FIELDS) {
    if (item[k] === undefined) continue
    patch[k] = k === 'tags' ? (Array.isArray(item.tags) ? JSON.stringify(item.tags) : String(item.tags || '[]')) : item[k]
  }
  if (item.body === undefined && item.stem !== undefined) patch.body = String(item.stem)
  const keys = Object.keys(patch)
  if (keys.length) {
    d.prepare(`UPDATE questions SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), ex.id)
  }
  return ex.id
}

const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const FIELDS = ['subject', 'day', 'source', 'module', 'type', 'ability', 'points', 'score', 'full', 'wrong', 'seconds', 'no', 'note', 'stem', 'ask', 'key', 'doc', 'material', 'path', 'tags', 'anchor', 'digest', 'body', 'answer', 'picked', 'analysis']

function insertOne(item) {
  const d = open()
  const row = {
    subject: item?.subject != null ? String(item.subject) : '行测',
    day: String(item?.day || today()).slice(0, 10),
    source: item?.source != null ? String(item.source) : '',
    module: item?.module != null ? String(item.module) : '',
    type: item?.type != null ? String(item.type) : '',
    ability: item?.ability != null ? String(item.ability) : '',
    points: item?.points != null ? String(item.points) : '',
    score: item?.score != null && item.score !== '' ? Number(item.score) : null,
    full: item?.full != null && item.full !== '' ? Number(item.full) : null,
    wrong: item?.wrong != null ? String(item.wrong) : '',
    seconds: item?.seconds != null && item.seconds !== '' ? Number(item.seconds) : null,
    no: item?.no != null ? String(item.no) : '',
    note: item?.note != null ? String(item.note) : '',
    stem: item?.stem != null ? String(item.stem).slice(0, 300) : '',
    ask: item?.ask != null ? String(item.ask).slice(0, 300) : '',
    key: item?.key != null ? String(item.key).slice(0, 300) : '',
    doc: item?.doc != null ? String(item.doc) : '',
    material: item?.material != null ? String(item.material) : '',
    // anchor：稳定锚点（本子里那条解析的标题/题号）；改名、重排都不影响
    anchor: item?.anchor != null
      ? String(item.anchor).slice(0, 80)
      : item?.doc && String(item.doc).includes('#')
        ? String(item.doc).split('#').slice(1).join('#')
        : '',
    // digest：三百字以内摘要，直接可读，不用翻本子（存储不贵，读才贵）
    digest: item?.digest != null ? String(item.digest).slice(0, 800) : item?.note != null ? String(item.note).slice(0, 800) : '',
    // body：题干全文 + ABCD 选项（论文字数也无所谓，SQLite 不怕长；贵的是读，所以另存 digest）
    body: item?.body != null ? String(item.body).slice(0, 4000) : item?.stem != null ? String(item.stem) : '',
    answer: item?.answer != null ? String(item.answer).slice(0, 20) : '',
    // picked=当时做答（我选了什么）；analysis=标准解析（思路放 digest，别混）
    picked: item?.picked != null ? String(item.picked).slice(0, 20) : '',
    analysis: item?.analysis != null ? String(item.analysis).slice(0, 3000) : '',
    // path：给了就用；没给就用 科目/模块/题型/考点 拼（层级任意深）
    path:
      item?.path != null && String(item.path).trim()
        ? String(item.path).trim()
        : (() => {
            const segs = [item?.subject || '行测', item?.module, item?.type, item?.ability]
              .map((x) => (x == null ? '' : String(x).trim()))
              .filter(Boolean)
            return segs.filter((s, i) => i === 0 || s !== segs[i - 1]).join('/')
          })(),
    tags: Array.isArray(item?.tags) ? JSON.stringify(item.tags) : item?.tags ? String(item.tags) : '[]',
    created: new Date().toISOString(),
  }
  const stmt = d.prepare(
    `INSERT INTO questions (${FIELDS.join(',')}, created)
     VALUES (${FIELDS.map(() => '?').join(',')}, ?)`,
  )
  const info = stmt.run(...FIELDS.map((k) => row[k]), row.created)
  return { id: Number(info.lastInsertRowid), ...row }
}

/** 分组统计：出现次数 / 错误数 / 错误率 / 平均得分率 */
function statsOf(groupBy, month, sourceFilter, depth, tag) {
  const d = open()
  // 整卷对账：卷面写了多少 vs 子节点加起来多少（粉笔的考点会重叠，允许对不上）
  if (groupBy === 'paper') {
    const ps = d.prepare('SELECT * FROM papers ORDER BY day DESC, id DESC').all()
    return ps.map((p) => {
      const agg = d.prepare('SELECT SUM(total) t, SUM(right_n) r, COUNT(*) k FROM paper_nodes WHERE paper_id = ?').get(p.id)
      const nodeTotal = agg.t || 0
      const nodeRight = agg.r || 0
      return {
        卷子: `${p.day} ${p.source}`,
        卷面: `${p.right_n ?? '?'}/${p.total ?? '?'}`,
        节点合计: `${nodeRight}/${nodeTotal}`,
        差额: p.total != null && nodeTotal ? (nodeTotal - p.total) + ' 题' : '—',
        节点数: agg.k || 0,
        说明:
          p.total == null || !nodeTotal
            ? '没录节点'
            : nodeTotal < p.total
              ? '节点没录全（常见：只录了错点节点）'
              : nodeTotal > p.total
                ? '子节点有重叠（粉笔考点会重复归类，正常）'
                : '对上了',
      }
    })
  }

  // 按层级统计：path 取前 depth 段（层级任意深，加层不用改表）
  if (groupBy === 'path') {
    const fromWhat = String(arguments[5] || 'both') // both=题目级+卷子节点级都算
    const g = new Map()
    const addRow = (path, sc, fu) => {
      const parts = String(path || '').split('/').filter(Boolean)
      const key = parts.slice(0, Math.max(1, Number(depth) || 3)).join('/') || '(未分类)'
      const cur = g.get(key) || { n: 0, bad: 0, unk: 0, sum: 0, cnt: 0, q: 0, p: 0 }
      cur.n++
      cur.q += 1
      const s = sc === '' || sc == null ? null : Number(sc)
      const f = fu === '' || fu == null ? null : Number(fu)
      if (s == null) cur.unk++
      else if (f && s < f) cur.bad++
      if (s != null && f) { cur.sum += s / f; cur.cnt++ }
      g.set(key, cur)
    }
    // 1) 题目级
    if (fromWhat !== 'papers') {
      const w = []
      const a = []
      if (month) { w.push('substr(day,1,7) = ?'); a.push(month) }
      if (sourceFilter) { w.push('source = ?'); a.push(sourceFilter) }
      if (tag) { w.push('tags LIKE ?'); a.push('%' + tag + '%') }
      const rows2 = d.prepare('SELECT path, score, full FROM questions' + (w.length ? ' WHERE ' + w.join(' AND ') : '')).all(...a)
      for (const r of rows2) addRow(r.path, r.score, r.full)
    }
    // 2) 卷子节点级（一张卷一个节点一行，total 就是这个节点的题数）
    if (fromWhat !== 'questions') {
      const w = []
      const a = []
      if (month) { w.push("substr(p.day,1,7) = ?"); a.push(month) }
      if (sourceFilter) { w.push('p.source = ?'); a.push(sourceFilter) }
      const rows3 = d.prepare('SELECT n.path, n.right_n, n.total FROM paper_nodes n JOIN papers p ON p.id = n.paper_id' + (w.length ? ' WHERE ' + w.join(' AND ') : '')).all(...a)
      for (const r of rows3) {
        const parts = String(r.path || '').split('/').filter(Boolean)
        const key = parts.slice(0, Math.max(1, Number(depth) || 3)).join('/') || '(未分类)'
        const cur = g.get(key) || { n: 0, bad: 0, unk: 0, sum: 0, cnt: 0, q: 0, p: 0 }
        cur.n += Number(r.total) || 0
        cur.p += Number(r.total) || 0
        cur.bad += Math.max(0, (Number(r.total) || 0) - (Number(r.right_n) || 0))
        if (r.total) { cur.sum += (Number(r.right_n) || 0) / Number(r.total); cur.cnt++ }
        g.set(key, cur)
      }
    }
    return [...g.entries()]
      .map(([key, v]) => {
        const labeled = v.n - v.unk
        return {
          项: key,
          题数: v.n,
          错题数: v.bad,
          未标: v.unk,
          错误率: labeled > 0 ? Math.round((v.bad / labeled) * 100) + '%' : '—',
          平均得分率: v.cnt ? Math.round((v.sum / v.cnt) * 100) + '%' : '—',
          ...(fromWhat === 'both' ? { 来自: `题目${v.q}行/卷子${v.p}题` } : {}),
        }
      })
      .sort((x, y) => y.题数 - x.题数)
  }


  const col = ['subject', 'type', 'wrong', 'source', 'module', 'ability', 'material'].includes(groupBy) ? groupBy : 'type'
  const where = []
  const args = []
  if (month) {
    where.push("substr(day,1,7) = ?")
    args.push(month)
  }
  if (sourceFilter) {
    where.push('source = ?')
    args.push(sourceFilter)
  }
  const sql = `
    SELECT COALESCE(NULLIF(${col}, ''), '(未填)') AS key,
           COUNT(*) AS n,
           SUM(CASE WHEN score IS NOT NULL AND score <> '' AND full IS NOT NULL AND full <> '' AND score * 1.0 < full * 1.0 THEN 1 ELSE 0 END) AS wrong_n,
           SUM(CASE WHEN score IS NULL OR score = '' THEN 1 ELSE 0 END) AS unknown_n,
           AVG(CASE WHEN score IS NOT NULL AND full IS NOT NULL AND full > 0 THEN score * 1.0 / full END) AS rate
    FROM questions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY 1
    ORDER BY n DESC
  `
  const rows = d.prepare(sql).all(...args)
  return rows.map((r) => {
    const labeled = r.n - r.unknown_n // 只按"明确标了对错"的算错误率
    return {
      项: r.key,
      题数: r.n,
      错题数: r.wrong_n,
      未标: r.unknown_n,
      错误率: labeled > 0 ? Math.round((r.wrong_n / labeled) * 100) + '%' : '—',
      平均得分率: r.rate == null ? '—' : Math.round(r.rate * 100) + '%',
    }
  })
}

function listRows(filters, limit) {
  const d = open()
  const where = []
  const args = []
  const map = { subject: 'subject', type: 'type', wrong: 'wrong', source: 'source', module: 'module', material: 'material', month: null }
  for (const k of Object.keys(map)) {
    const v = filters?.[k]
    if (v == null || v === '') continue
    if (k === 'month') {
      where.push('substr(day,1,7) = ?')
      args.push(String(v))
    } else {
      where.push(`${map[k]} = ?`)
      args.push(String(v))
    }
  }
  if (filters?.path) {
    // 按层级前缀筛：'行测/判断推理' 会带上它下面所有题型和考点
    where.push('path LIKE ?')
    args.push(String(filters.path) + '%')
  }
  const sql = `SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  const rows = d.prepare(sql).all(...args, Math.max(1, Math.min(Number(limit) || 20, 200)))
  return rows.map((r) => {
    const bits = [r.day, r.source, r.module, r.type].filter(Boolean).join(' · ')
    const sc = r.score != null && r.full != null ? ` 得分 ${r.score}/${r.full}` : ''
    const wr = r.wrong ? ` 错因:${r.wrong}` : ''
    const dg = r.digest ? ` | ${String(r.digest).replace(/\s+/g, ' ').slice(0, 40)}` : ''
    return `#${r.id} ${bits}${sc}${wr}${dg}`
  })
}

/** 给一条题算向量并落库；Ollama 没开就静默跳过（返回 false） */
async function embedRow(id) {
  const d = open()
  const row = d.prepare('SELECT * FROM questions WHERE id = ?').get(id)
  if (!row) return false
  const txt = textOf(row)
  if (!txt) return false
  const h = hashOf(txt)
  const old = d.prepare('SELECT text_hash FROM vecs WHERE row_id = ?').get(id)
  if (old && old.text_hash === h) return true // 没变，不重算
  const v = await embed(txt)
  if (!v) return false
  d.prepare('INSERT OR REPLACE INTO vecs (row_id, model, dim, v, text_hash, at) VALUES (?,?,?,?,?,?)').run(
    id, 'bge-m3', v.length, pack(v), h, new Date().toISOString(),
  )
  return true
}

/** 语义检索：Ollama 不可用返回 null（调用方退回关键词） */
async function semanticSearch(query, top, filters) {
  if (!(await localUp())) return null
  const qv = await embed(query)
  if (!qv) return null
  const d = open()
  const where = []
  const args = []
  for (const [k, v] of Object.entries(filters || {})) {
    if (!v) continue
    if (k === 'month') { where.push("substr(q.day,1,7) = ?"); args.push(String(v)) }
    else { where.push(`q.${k} = ?`); args.push(String(v)) }
  }
  const sql = `SELECT q.*, v.v AS vec FROM questions q JOIN vecs v ON v.row_id = q.id
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
  const rows = d.prepare(sql).all(...args)
  const scored = []
  for (const r of rows) {
    const v = unpack(r.vec)
    const s = cosine(qv, v)
    if (s > 0) scored.push({ score: s, row: r })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, top).map((x) => ({
    分: Math.round(x.score * 1000) / 1000,
    id: x.row.id,
    题: [x.row.day, x.row.source, x.row.module, x.row.type, x.row.no && '#' + x.row.no].filter(Boolean).join(' · '),
    摘要: x.row.stem || x.row.note || '',
    错因: x.row.wrong || '',
    本子: x.row.doc || '',
  }))
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_bank',
    description:
      '你的题库：一行一题存进数据库，能按题型/错因/题源统计出现次数和错误率。\n' +
      '· add（item 或 items 一批）字段：day source module type ability points score full wrong seconds no\n' +
      '  ＋ stem（题干摘要，一行能认出是哪道题，别塞材料）· ask（问法，如"概括……做法"）\n' +
      '  ＋ key（采分点清单，短句）· doc（完整解析在哪个本子，如 申论/概括措施-2026.md#3）· note（失分点标签，如"漏第3点"）\n' +
      '· stats：按 type/wrong/source/module/ability 分组算次数、错题数、错误率、平均得分率（可加 month=2026-11）\n' +
      '· list：按 type/wrong/source/module/month 筛 · update/remove：按 id · export：导 CSV 到 ayy-bank/exports/\n' +
      '**分工**：库里只存可统计的字段 + 解析在哪；完整题干和解析写 ayy_note 的本子（题多了按题型/年份分文件）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'stats', 'list', 'update', 'remove', 'export', 'taxonomy', 'report', 'verify'], description: '默认 add' },
        item: { type: 'object', additionalProperties: true, description: 'add：单条题目' },
        items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'add：一批题目' },
        groupBy: { type: 'string', enum: ['subject', 'type', 'wrong', 'source', 'module', 'ability', 'material', 'path'], description: 'stats 分组维度，默认 type' },
        material: { type: 'string', description: '材料类型：文字资料/统计表/统计图/综合资料（资料分析用）' },
        subject: { type: 'string', description: '科目：行测/申论/面试，默认 行测' },
        paper: { type: 'object', additionalProperties: true, description: 'report：整卷成绩 {day, source, subject, total, right, wrong, seconds, score, nodes:[{module,type,ability,total,right,seconds}]}' },
        month: { type: 'string', description: 'stats/list 限定月份，如 2026-11' },
        type: { type: 'string', description: 'list 筛选：题型' },
        wrong: { type: 'string', description: 'list 筛选：错因' },
        source: { type: 'string', description: 'list/stats 筛选：题源' },
        module: { type: 'string', description: 'list 筛选：模块' },
        id: { type: 'integer', description: 'update/remove 的题目 id' },
        patch: { type: 'object', additionalProperties: true, description: 'update 要改的字段' },
        limit: { type: 'integer', description: 'list/search 返回条数，默认 list 20 / search 8' },
        query: { type: 'string', description: 'search：想找什么（可以是一句大白话）' },
        depth: { type: 'integer', description: 'stats groupBy=path 时统计到第几层，默认 3' },
        upsert: { type: 'boolean', description: 'add：按 来源+题号 覆盖已有记录（重录同一套卷子不会重复）' },
        from: { type: 'string', enum: ['both', 'questions', 'papers'], description: 'stats 数据来源：both=题目+整卷节点（默认），questions=只逐题，papers=只整卷' },
        tag: { type: 'string', description: '按标签过滤，如 材料:统计表' },
        path: { type: 'string', description: 'add/list：完整层级路径，如 行测/判断推理/图形推理/数量规律/线' },
        tags: { type: 'array', items: { type: 'string' }, description: 'add：正交维度标签，如 ["材料:统计表"]' },
      },
      required: ['action'],
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'add')

      if (action === 'add') {
        const items = Array.isArray(args?.items) ? args.items : args?.item ? [args.item] : []
        if (!items.length) throw new Error('add 需要 item 或 items')
        const ids = []
        let ups = 0
        for (const it of items) {
          // upsert：同一套卷子 + 同一个题号 → 覆盖，不重复入库
          if (args?.upsert && it.source && it.no) {
            const id = upsertOne(it)
            if (id) { ids.push(id); ups++; continue }
          }
          ids.push(insertOne(it).id)
        }
        const total = open().prepare('SELECT COUNT(*) AS n FROM questions').get().n
        log(`add ${ids.length} 条 → 库里共 ${total}`)
        // 尽力算向量：Ollama 没开就跳过，下次 search/reindex 会补
        let embedded = 0
        for (const id of ids) { try { if (await embedRow(id)) embedded++ } catch { /* 忽略 */ } }
        // 分类表里没有的题型提一句——不拦，只是让她知道可以补进表里
        const unknown = new Map()
        for (const it of items) {
          const sub = it.subject || '行测'
          const mod = it.module || ''
          const t = it.type || ''
          if (!t) continue
          if (!checkType(sub, mod, t).known) unknown.set(`${sub}/${mod}/${t}`, true)
        }
        return {
          ok: true, added: ids.length, 覆盖: ups || 0, ids, total, 已建向量: embedded,
          ...(unknown.size ? { 新题型: [...unknown.keys()], 提示: '这些题型不在 taxonomy.json 里；用得多了可以加进去，或者就这么放着也行' } : {}),
        }
      }

      if (action === 'stats') {
        const rows = statsOf(String(args?.groupBy || 'type'), args?.month, args?.source, args?.depth, args?.tag, args?.from)
        const total = open().prepare('SELECT COUNT(*) AS n FROM questions').get().n
        log(`stats by ${args?.groupBy || 'type'} → ${rows.length} 组`)
        return { groupBy: args?.groupBy || 'type', month: args?.month || '全部', 总题数: total, rows: rows.length ? rows : '（还没有题）' }
      }

      if (action === 'list') {
        const rows = listRows({ subject: args?.subject, type: args?.type, wrong: args?.wrong, source: args?.source, module: args?.module, material: args?.material, month: args?.month, path: args?.path }, args?.limit)
        return { count: rows.length, items: rows.length ? rows : '（没有匹配的题）' }
      }

      if (action === 'update') {
        const id = Number(args?.id)
        if (!id) throw new Error('update 需要 id')
        const patch = args?.patch || {}
        const keys = Object.keys(patch).filter((k) => FIELDS.includes(k))
        if (!keys.length) throw new Error(`patch 里没有可改的字段（可用：${FIELDS.join(', ')}）`)
        const d = open()
        d.prepare(`UPDATE questions SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k]), id)
        const row = d.prepare('SELECT * FROM questions WHERE id = ?').get(id)
        if (!row) throw new Error(`没有 id=${id} 的题`)
        log(`update #${id}: ${keys.join(',')}`)
        return { ok: true, item: row }
      }

      if (action === 'remove') {
        const id = Number(args?.id)
        if (!id) throw new Error('remove 需要 id')
        const d = open()
        const info = d.prepare('DELETE FROM questions WHERE id = ?').run(id)
        log(`remove #${id} affected=${info.changes}`)
        return { ok: true, removed: Number(info.changes), id }
      }

      if (action === 'search') {
        const q = String(args?.query || '').trim()
        if (!q) throw new Error('search 需要 query')
        const top = Math.max(1, Math.min(Number(args?.limit) || 8, 30))
        const filters = { subject: args?.subject, module: args?.module, type: args?.type, wrong: args?.wrong, source: args?.source, month: args?.month, material: args?.material }
        const sem = await semanticSearch(q, top, filters)
        if (sem && sem.length) return { 方式: '语义检索（本地 bge-m3）', query: q, count: sem.length, rows: sem }
        const d = open()
        const like = `%${q}%`
        const rows = d.prepare('SELECT * FROM questions WHERE stem LIKE ? OR note LIKE ? OR ask LIKE ? OR wrong LIKE ? OR type LIKE ? ORDER BY id DESC LIMIT ?').all(like, like, like, like, like, top)
        return {
          方式: sem === null ? '关键词检索（本地模型没开，语义不可用）' : '关键词检索（语义无命中）',
          query: q,
          count: rows.length,
          rows: rows.map((r) => ({ id: r.id, 题: [r.day, r.source, r.module, r.type, r.no && '#' + r.no].filter(Boolean).join(' · '), 摘要: r.stem || r.note || '', 错因: r.wrong || '', 本子: r.doc || '' })),
        }
      }

      if (action === 'reindex') {
        const d = open()
        const rows = d.prepare('SELECT id FROM questions').all()
        let ok = 0
        let fail = 0
        for (const r of rows) {
          try {
            if (await embedRow(r.id)) ok++
            else fail++
          } catch {
            fail++
          }
        }
        log(`reindex: ${ok} 成功 / ${fail} 失败`)
        return { ok: true, total: rows.length, 已建向量: ok, 跳过: fail, 提示: fail ? '本地模型没开的话先 ayy_local(action:"up")' : '全部就绪' }
      }

      if (action === 'report') {
        const p2 = args?.paper || {}
        const d = open()
        const info = d.prepare(`INSERT INTO papers (day, source, subject, total, right_n, wrong_n, seconds, score, note, created)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          String(p2.day || today()).slice(0, 10),
          String(p2.source || ''),
          String(p2.subject || '行测'),
          p2.total ?? null, p2.right ?? null, p2.wrong ?? null, p2.seconds ?? null, p2.score ?? null,
          String(p2.note || ''),
          new Date().toISOString(),
        )
        const pid = Number(info.lastInsertRowid)
        const nodes = Array.isArray(p2.nodes) ? p2.nodes : []
        const ins = d.prepare('INSERT INTO paper_nodes (paper_id, module, type, ability, total, right_n, seconds, path) VALUES (?,?,?,?,?,?,?,?)')
        for (const n of nodes) {
          const segs = [String(p2.subject || '行测'), n.module, n.type, n.ability]
            .map((x) => (x == null ? '' : String(x).trim()))
            .filter(Boolean)
          const pth = segs.filter((s, i) => i === 0 || s !== segs[i - 1]).join('/')
          ins.run(pid, String(n.module || ''), String(n.type || ''), String(n.ability || ''), n.total ?? null, n.right ?? null, n.seconds ?? null, pth)
        }
        log(`report #${pid} ${p2.source || ''} nodes=${nodes.length}`)
        return { ok: true, paper_id: pid, 节点数: nodes.length }
      }

      if (action === 'verify') {
        // 检查 doc 锚点还在不在：靠"题号/标题"对，不靠行号（行号会断，锚点不会）
        const d = open()
        const notesDir = join(HOME, 'personas', 'notes')
        const rows = d.prepare("SELECT id, doc, anchor FROM questions WHERE doc IS NOT NULL AND doc <> ''").all()
        const bad = []
        let ok = 0
        for (const r of rows) {
          const [file, ...rest] = String(r.doc).split('#')
          const anchor = String(r.anchor || rest.join('#') || '').trim()
          const full = /^[A-Za-z]:/.test(file) ? file : join(notesDir, file)
          if (!existsSync(full)) { bad.push({ id: r.id, doc: r.doc, 原因: '文件不存在' }); continue }
          if (!anchor) { bad.push({ id: r.id, doc: r.doc, 原因: '没有锚点（doc 里没写 #）' }); continue }
          let text = ''
          try { text = readFileSync(full, 'utf8') } catch { bad.push({ id: r.id, doc: r.doc, 原因: '读不了文件' }); continue }
          if (text.includes(anchor)) ok++
          else bad.push({ id: r.id, doc: r.doc, 原因: `本子里找不到「${anchor}」` })
        }
        return { 总数: rows.length, 好的: ok, 断了: bad.length, 明细: bad.slice(0, 20) }
      }

      if (action === 'taxonomy') {
        const tax = readTaxonomy()
        const subj = String(args?.subject || '').trim()
        const rows = open().prepare('SELECT subject, module, type, COUNT(*) n FROM questions GROUP BY subject, module, type').all()
        const count = (s, m, t) => (rows.find((r) => r.subject === s && r.module === m && r.type === t) || {}).n || 0
        const out = {}
        for (const [s, mods] of Object.entries(tax)) {
          if (subj && s !== subj) continue
          out[s] = {}
          for (const [m, types] of Object.entries(mods)) {
            if (Array.isArray(types)) {
              out[s][m] = types.length ? types.map((t) => `${t}(${count(s, m, t)})`) : ['（题型待补）']
              continue
            }
            // 四层：模块 → 题型 → 考点
            const flat = []
            for (const [t, points] of Object.entries(types)) {
              const n = count(s, m, t)
              if (!Array.isArray(points) || !points.length) { flat.push(`${t}(${n})`); continue }
              const sub = points.map((pt) => {
                const r2 = open().prepare('SELECT COUNT(*) n FROM questions WHERE subject=? AND module=? AND type=? AND ability=?').get(s, m, t, pt).n
                return `${pt}(${r2})`
              })
              flat.push(`${t}(${n}) → ${sub.join(' · ')}`)
            }
            out[s][m] = flat
          }
        }
        return { 说明: '括号里是库里已有的题数。题型可以随时往 taxonomy.json 里加。', tree: out }
      }

      if (action === 'export') {
        const d = open()
        const rows = d.prepare('SELECT * FROM questions ORDER BY id').all()
        const cols = ['id', ...FIELDS, 'created']
        const esc = (v) => {
          const s = v == null ? '' : String(v)
          return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
        }
        const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n')
        const dir = join(DIR, 'exports')
        mkdirSync(dir, { recursive: true })
        const file = join(dir, 'bank-' + today().replace(/-/g, '') + '.csv')
        writeFileSync(file, '\uFEFF' + csv + '\n', 'utf8') // BOM：Excel 打开中文不乱码
        log(`export ${rows.length} 行 → ${file}`)
        return { ok: true, rows: rows.length, file }
      }

      throw new Error(`不支持的 action：${action}`)
    },
  })
}

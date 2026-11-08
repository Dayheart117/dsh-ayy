/**
 * dsh-ayy-bank —— 她的题库
 *
 * 一行一题，存在 SQLite 里（Node 24 自带 node:sqlite，不需要装依赖）。
 * 为什么要真数据库：她要的不是“存下来”，是“按题型看错误率、按错因看分布”。
 * markdown 本子能干前一半，干不了后一半——只能靠人肉数或者写脚本。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-bank'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-bank')
const DB = join(DIR, 'bank.db')
const LOG = join(DIR, 'bank.log')

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
  return db
}

const today = () => {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

const FIELDS = ['day', 'source', 'module', 'type', 'ability', 'points', 'score', 'full', 'wrong', 'seconds', 'no', 'note']

function insertOne(item) {
  const d = open()
  const row = {
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
function statsOf(groupBy, month, sourceFilter) {
  const d = open()
  const col = ['type', 'wrong', 'source', 'module', 'ability'].includes(groupBy) ? groupBy : 'type'
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
           SUM(CASE WHEN score IS NOT NULL AND full IS NOT NULL AND score < full THEN 1 ELSE 0 END) AS wrong_n,
           AVG(CASE WHEN score IS NOT NULL AND full IS NOT NULL AND full > 0 THEN score * 1.0 / full END) AS rate
    FROM questions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    GROUP BY key
    ORDER BY n DESC
  `
  const rows = d.prepare(sql).all(...args)
  return rows.map((r) => ({
    项: r.key,
    题数: r.n,
    错题数: r.wrong_n,
    错误率: r.n ? Math.round((r.wrong_n / r.n) * 100) + '%' : '—',
    平均得分率: r.rate == null ? '—' : Math.round(r.rate * 100) + '%',
  }))
}

function listRows(filters, limit) {
  const d = open()
  const where = []
  const args = []
  const map = { type: 'type', wrong: 'wrong', source: 'source', module: 'module', month: null }
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
  const sql = `SELECT * FROM questions ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  const rows = d.prepare(sql).all(...args, Math.max(1, Math.min(Number(limit) || 20, 200)))
  return rows.map((r) => {
    const bits = [r.day, r.source, r.module, r.type].filter(Boolean).join(' · ')
    const sc = r.score != null && r.full != null ? ` 得分 ${r.score}/${r.full}` : ''
    const wr = r.wrong ? ` 错因:${r.wrong}` : ''
    return `#${r.id} ${bits}${sc}${wr}`
  })
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
      '· add：录题（一条或一批）。字段 day/source/module/type/ability/points/score/full/wrong/seconds/no/note，只有 type 建议必填。\n' +
      '· stats：按题型/错因/题源/模块分组，算出现次数、错题数、错误率、平均得分率（可加 month=2026-11）。\n' +
      '· list：按 type/wrong/source/module/month 筛，看最近几条。\n' +
      '· update / remove：按 id 改或删。\n' +
      '录错题时：一个题一条，别把整段解析塞进 note（解析还是写 ayy_note 的本子）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'stats', 'list', 'update', 'remove'], description: '默认 add' },
        item: { type: 'object', additionalProperties: true, description: 'add：单条题目' },
        items: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'add：一批题目' },
        groupBy: { type: 'string', enum: ['type', 'wrong', 'source', 'module', 'ability'], description: 'stats 分组维度，默认 type' },
        month: { type: 'string', description: 'stats/list 限定月份，如 2026-11' },
        type: { type: 'string', description: 'list 筛选：题型' },
        wrong: { type: 'string', description: 'list 筛选：错因' },
        source: { type: 'string', description: 'list/stats 筛选：题源' },
        module: { type: 'string', description: 'list 筛选：模块' },
        id: { type: 'integer', description: 'update/remove 的题目 id' },
        patch: { type: 'object', additionalProperties: true, description: 'update 要改的字段' },
        limit: { type: 'integer', description: 'list 返回条数，默认 20' },
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
        for (const it of items) ids.push(insertOne(it).id)
        const total = open().prepare('SELECT COUNT(*) AS n FROM questions').get().n
        log(`add ${ids.length} 条 → 库里共 ${total}`)
        return { ok: true, added: ids.length, ids, total }
      }

      if (action === 'stats') {
        const rows = statsOf(String(args?.groupBy || 'type'), args?.month, args?.source)
        const total = open().prepare('SELECT COUNT(*) AS n FROM questions').get().n
        log(`stats by ${args?.groupBy || 'type'} → ${rows.length} 组`)
        return { groupBy: args?.groupBy || 'type', month: args?.month || '全部', 总题数: total, rows: rows.length ? rows : '（还没有题）' }
      }

      if (action === 'list') {
        const rows = listRows({ type: args?.type, wrong: args?.wrong, source: args?.source, module: args?.module, month: args?.month }, args?.limit)
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

      throw new Error(`不支持的 action：${action}`)
    },
  })
}

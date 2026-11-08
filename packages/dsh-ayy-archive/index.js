/**
 * dsh-ayy-archive —— 对话史检索（她"记得聊过什么"的入口）
 *
 * 数据来自 tools/archive-ingest.mjs 建的库（~/.dsh/ayy-archive/archive.db）。
 * 检索策略（实测）：
 *   · 查询 ≥3 字 → FTS5 trigram（带高亮片段），失败回落 LIKE
 *   · 查询 ≤2 字 → LIKE（trigram 对两字词无效，中文两字词又多）
 * 引用：返回 id + 日期 + 会话，她用 get 取全文。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

export const name = 'dsh-ayy-archive'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-archive')
const DB = join(DIR, 'archive.db')
const LOG = join(DIR, 'archive.log')
const TOOL = 'E:\\AI\\dsh-ayy\\tools\\archive-ingest.mjs'

function log(msg) {
  try {
    mkdirSync(DIR, { recursive: true })
    if (existsSync(LOG) && statSync(LOG).size > 512 * 1024) renameSync(LOG, LOG + '.1')
    appendFileSync(LOG, `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}\n`)
  } catch {
    /* 日志失败不影响检索 */
  }
}

/** 她的会话 = QQ 桥绑定的那几个（私聊/群）。用来把"我们聊过什么"和"开发对话"分开 */
function herSessions() {
  try {
    const b = JSON.parse(readFileSync(join(HOME, 'qq-bridge-config.json'), 'utf8').replace(/^\uFEFF/, ''))
    return (b['绑定'] || []).map((x) => String(x['会话'] || '')).filter(Boolean)
  } catch {
    return []
  }
}

/** 她的私聊会话（默认检索范围：不含群、不含开发对话） */
function herPrivateSessions() {
  try {
    const b = JSON.parse(readFileSync(join(HOME, 'qq-bridge-config.json'), 'utf8').replace(/^\uFEFF/, ''))
    return (b['绑定'] || []).filter((x) => x['类型'] !== '群').map((x) => String(x['会话'] || '')).filter(Boolean)
  } catch {
    return []
  }
}

let db = null
function open() {
  if (db) return db
  if (!existsSync(DB)) return null
  db = new DatabaseSync(DB)
  return db
}

const len = (s) => [...String(s)].length

/** 把查询拆成候选词：有空格按空格；中文没空格，用 2-gram/3-gram 滑窗 + 原串 */
function terms(q) {
  const s = String(q || '').trim()
  if (!s) return []
  if (/\s/.test(s)) return s.split(/\s+/).filter(Boolean)
  const chars = [...s]
  if (chars.length <= 3) return [s]
  const out = new Set([s])
  for (let i = 0; i + 2 <= chars.length; i++) out.add(chars.slice(i, i + 2).join(''))
  for (let i = 0; i + 3 <= chars.length; i++) out.add(chars.slice(i, i + 3).join(''))
  return [...out]
}

/** 单个词检索：>=3 字走 FTS，否则 LIKE */
function searchOnce(d, term, o, limit) {
  const extra = []
  const args = []
  if (o.dayFrom) { extra.push('c.day >= ?'); args.push(o.dayFrom) }
  if (o.dayTo) { extra.push('c.day <= ?'); args.push(o.dayTo) }
  if (o.session) { extra.push('c.session = ?'); args.push(o.session) }
  if (o.scopeShow) { extra.push('c.scope = ?'); args.push(o.scopeShow) }
  if (o.sessions && o.sessions.length) {
    extra.push('c.session IN (' + o.sessions.map(() => '?').join(',') + ')')
    args.push(...o.sessions)
  }
  if (!o.includeMeta) extra.push('c.meta = 0')
  const whereExtra = extra.length ? ' AND ' + extra.join(' AND ') : ''
  if ([...term].length >= 3) {
    try {
      const rows = d
        .prepare('SELECT c.id, c.day, c.session, c.scope, c.chars, c.meta, snippet(chunks_fts, 1, "\u3010", "\u3011", "\u2026", 30) AS s FROM chunks_fts f JOIN chunks c ON c.id = f.id WHERE f.text MATCH ?' + whereExtra + ' ORDER BY rank LIMIT ?')
        .all(term, ...args, limit)
      if (rows.length) return rows.map((r) => Object.assign({}, r, { how: 'FTS' }))
    } catch (e) { /* 落到 LIKE */ }
  }
  return d
    .prepare('SELECT c.id, c.day, c.session, c.scope, c.chars, c.meta, substr(c.text, max(1, instr(c.text, ?) - 30), 140) AS s FROM chunks c WHERE c.text LIKE ?' + whereExtra + ' ORDER BY c.t_from DESC LIMIT ?')
    .all(term, '%' + term + '%', ...args, limit)
    .map((r) => Object.assign({}, r, { how: 'LIKE' }))
}

/** 混合检索：多词拆开分别找，按命中词数 + 时间合并排序 */
/** 词的稀有度：库里出现得越少越值钱（idf = ln(N / (1+df))） */
function idfOf(d, term, total) {
  try {
    const df = d.prepare('SELECT COUNT(*) n FROM chunks WHERE text LIKE ?').get(`%${term}%`).n
    return Math.log((total + 1) / (df + 1)) + 0.5 // +0.5 保证常见词也不至于 0
  } catch {
    return 1
  }
}

// 虚词：不参与相关性计算（不然"怎么做/是什么/我们聊过"会把覆盖度撑大）
const FILLER = /(我们|你们|他们|聊过|说过|一下|一个|什么|怎么|怎样|为什么|是不是|有没有|能不能|可以|需要|应该|关于|这个|那个|哪些|哪家|哪个|如何|以及|还有|的话|这事|那次|时间|时候|区别|吗|呢|吧|啊|的|了|是|有|和|与|在|我|你|他|她|它|就|都|也|还|又|把|被|给|让|说)/g

function contentOf(q) {
  return String(q || '')
    .replace(FILLER, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function grams(s, n) {
  const c = [...s]
  const out = new Set()
  for (let i = 0; i + n <= c.length; i++) out.add(c.slice(i, i + n).join(''))
  return [...out]
}

function search(q, opts) {
  const d = open()
  if (!d) return []
  const limit = Math.max(1, Math.min(Number(opts?.limit) || 5, 20))
  const scope = String(opts?.scope || 'her')
  const o = {
    dayFrom: opts?.since ? String(opts.since) : '',
    dayTo: opts?.until ? String(opts.until) : '',
    session: opts?.session ? String(opts.session) : '',
    includeMeta: true, // meta 不再硬排除，改成降权
    sessions: null,
    scopeShow: '',
  }
  if (scope === 'her') o.sessions = herPrivateSessions()
  else if (scope === 'her_all') o.sessions = herSessions()
  else if (scope === 'group' || scope === 'private') o.scopeShow = scope

  const content = contentOf(q)
  const qChars = [...content.replace(/\s+/g, '')]
  const qLen = qChars.length || [...String(q).replace(/\s+/g, '')].length
  const plain = qChars.join('')
  const ts = new Set()
  for (const w of content.split(/\s+/).filter(Boolean)) ts.add(w)
  if (plain.length >= 2) {
    for (const g of grams(plain, 2)) ts.add(g)
    for (const g of grams(plain, 3)) ts.add(g)
    for (const g of grams(plain, 4)) ts.add(g)
  }
  const total = d.prepare('SELECT COUNT(*) n FROM chunks').get().n || 1
  const agg = new Map()
  for (const t of [...ts]) {
    if ([...t].length < 2) continue
    const idf = idfOf(d, t, total)
    for (const r of searchOnce(d, t, o, limit * 3)) {
      const cur = agg.get(r.id) || Object.assign({}, r, { terms: new Set(), score: 0 })
      cur.terms.add(t)
      cur.score += idf * [...t].length * [...t].length
      agg.set(r.id, cur)
    }
  }
  // 相关性门槛：命中的内容字符要占查询内容的大半
  const MIN_COVERAGE = 0.5
  const out = []
  for (const r of agg.values()) {
    const covered = new Set([...r.terms].flatMap((t) => [...t].filter((c) => plain.includes(c)))).size
    const coverage = Math.min(1, covered / Math.max(1, new Set(qChars).size))
    if (coverage < MIN_COVERAGE) continue
    if (r.meta) r.score *= 0.3 // 元对话降权，不删
    r.coverage = coverage
    r.hits = r.terms.size
    out.push(r)
  }
  out.sort((a, b) => b.score - a.score || (b.day || '').localeCompare(a.day || ''))
  return out.slice(0, limit)
}


const fmt = (r) => r.day + " · " + (r.scope === "group" ? "群" : "私聊") + " · " + r.chars + "字"


const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_arch',
    description:
      '翻"我们以前聊过什么"——对话史全文检索。\n' +
      '· search：关键词 + 可选 since/until/session/scope（默认只搜私聊，scope:"all" 含群）\n' +
      '· get：按 id 取那一段的完整原文（引用回去用）\n' +
      '· stats：库里有多少会话/多少段/多少字/时间跨度\n' +
      '· ingest：把新对话补进库（幂等，可以随时跑）\n' +
      '注意：两字词走模糊匹配、三字以上走全文索引，结果一致。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['search', 'get', 'stats', 'ingest'], description: '默认 search' },
        query: { type: 'string', description: 'search：想找的话（可以是原话片段）' },
        id: { type: 'string', description: 'get：检索结果里的 id' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        until: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        session: { type: 'string', description: '限定某个会话 id' },
        scope: { type: 'string', enum: ['her', 'her_all', 'private', 'group', 'all'], description: '默认 her=只她的私聊；her_all=含群；all=连开发对话' },
        limit: { type: 'integer', description: '返回条数，默认 5' },
      },
      required: ['action'],
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'search')

      if (action === 'search') {
        const q = String(args?.query || '').trim()
        if (!q) throw new Error('search 需要 query')
        const rows = search(q, args)
        log(`search「${q}」→ ${rows.length} 条`)
        if (!rows.length) return { count: 0, 说法: `库里没找到「${q}」。要么真没聊过，要么那段还没入（可以 ingest 补上）。` }
        return {
          count: rows.length,
          how: rows[0].how,
          结果: rows.map((r) => ({ id: r.id, day: r.day, 来源: r.scope === 'group' ? '群' : '私聊', 片段: String(r.s || '').replace(/\s+/g, ' ').slice(0, 160) })),
          提示: '要看完整那段就用 ayy_arch(action:"get", id:"…")',
        }
      }

      if (action === 'get') {
        const id = String(args?.id || '').trim()
        if (!id) throw new Error('get 需要 id')
        const d = open()
        const r = d && d.prepare('SELECT * FROM chunks WHERE id = ?').get(id)
        if (!r) throw new Error(`没有 id=${id} 的片段`)
        return { id: r.id, day: r.day, session: r.session, scope: r.scope, 字数: r.chars, 原文: r.text }
      }

      if (action === 'stats') {
        const d = open()
        if (!d) return { 空库: true, 提示: '还没建库；先 ayy_arch(action:"ingest")' }
        const one = (sql) => d.prepare(sql).get()
        return {
          会话数: one('SELECT COUNT(DISTINCT session) n FROM chunks').n,
          片段数: one('SELECT COUNT(*) n FROM chunks').n,
          总字数: one('SELECT SUM(chars) s FROM chunks').s || 0,
          最早: one('SELECT MIN(day) d FROM chunks').d,
          最晚: one('SELECT MAX(day) d FROM chunks').d,
          私聊片段: one("SELECT COUNT(*) n FROM chunks WHERE scope='private'").n,
          群聊片段: one("SELECT COUNT(*) n FROM chunks WHERE scope='group'").n,
          数据库: DB,
        }
      }

      if (action === 'ingest') {
        if (!existsSync(TOOL)) throw new Error(`找不到入库脚本：${TOOL}`)
        const limit = Number(args?.limit) || 0
        const argv = [TOOL, limit ? '--limit' : '--all']
        if (limit) argv.push(String(limit))
        const outText = execFileSync(process.execPath, argv, { encoding: 'utf8', timeout: 600000 })
        db = null // 重新打开，避免看到旧快照
        log(`ingest: ${outText.split('\n')[0]}`)
        return { ok: true, 输出: outText.trim().split('\n').slice(0, 4) }
      }

      throw new Error(`不支持的 action：${action}`)
    },
  })
}

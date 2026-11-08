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
import { embed, pack, unpack, cosine, hashOf, localUp } from './lib/vector.js'

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

async function search(q, opts) {
  const d = open()
  if (!d) return []
  const limit = Math.max(1, Math.min(Number(opts?.limit) || 5, 20))
  const scope = String(opts?.scope || 'her')
  const o = {
    dayFrom: opts?.since ? String(opts.since) : '',
    dayTo: opts?.until ? String(opts.until) : '',
    session: opts?.session ? String(opts.session) : '',
    includeMeta: scope === 'all', // 元对话默认硬排除；只有 scope=all（连开发对话）才带上
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


/** 子片召回兜底：关键词一个都没命中时，用 120 字子片的向量找回来 */
async function subRecall(q, args, exclude) {
  if (!(await localUp(1200))) return []
  const d = open()
  if (!d) return []
  const has = new Set((exclude || []).map((r) => r.id))
  const limit = Math.max(1, Math.min(Number(args?.limit) || 5, 20))
  const qv = await embed(q)
  if (!qv) return []
  const scope = String(args?.scope || 'her')
  const where = []
  const params = []
  if (scope === 'her') { const s2 = herPrivateSessions(); if (s2.length) { where.push('c.session IN (' + s2.map(() => '?').join(',') + ')'); params.push(...s2) } }
  else if (scope === 'her_all') { const s3 = herSessions(); if (s3.length) { where.push('c.session IN (' + s3.map(() => '?').join(',') + ')'); params.push(...s3) } }
  else if (scope === 'group' || scope === 'private') { where.push('c.scope = ?'); params.push(scope) }
  where.push('c.meta = 0') // 元对话不进兜底召回（否则今天贴进来的测试题会把所有查询都命中）
  if (args?.since) { where.push('c.day >= ?'); params.push(String(args.since)) }
  if (args?.until) { where.push('c.day <= ?'); params.push(String(args.until)) }
  const subs = d.prepare('SELECT s.chunk_id, s.text, s.v AS vec, c.day, c.session, c.scope, c.chars FROM subvecs s JOIN chunks c ON c.id = s.chunk_id' + (where.length ? ' WHERE ' + where.join(' AND ') : '')).all(...params)
  const best = new Map()
  for (const s of subs) {
    if (has.has(s.chunk_id)) continue
    const cos = cosine(qv, unpack(s.vec))
    if (cos < 0.65) continue
    const prev = best.get(s.chunk_id)
    if (!prev || cos > prev.cos) best.set(s.chunk_id, { cos, text: s.text, s })
  }
  return [...best.entries()]
    .sort((a, b) => b[1].cos - a[1].cos)
    .slice(0, limit)
    .map(([id, h]) => ({ id, day: h.s.day, session: h.s.session, scope: h.s.scope, chars: h.s.chars, s: String(h.text).slice(0, 140), cos: h.cos, how: 'SUB' }))
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
        action: { type: 'string', enum: ['search', 'get', 'stats', 'ingest', 'forget', 'reindex'], description: '默认 search' },
        query: { type: 'string', description: 'search：想找的话（可以是原话片段）' },
        id: { type: 'string', description: 'get：检索结果里的 id' },
        since: { type: 'string', description: '起始日期 YYYY-MM-DD' },
        until: { type: 'string', description: '结束日期 YYYY-MM-DD' },
        session: { type: 'string', description: '限定某个会话 id' },
        scope: { type: 'string', enum: ['her', 'her_all', 'private', 'group', 'all'], description: '默认 her=只她的私聊；her_all=含群；all=连开发对话' },
        limit: { type: 'integer', description: '返回条数，默认 5' },
        by: { type: 'string', enum: ['id', 'day', 'session'], description: 'forget：按什么删' },
        value: { type: 'string', description: 'forget：id / 日期 / 会话id' },
      },
      required: ['action'],
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'search')

      if (action === 'search') {
        const q = String(args?.query || '').trim()
        if (!q) throw new Error('search 需要 query')
        let rows = await search(q, args)
        // 关键词不够数时，用子片向量补位（排后面，只做兜底召回）
        if (rows.length === 0) {
          try {
            const extra = await subRecall(q, args, rows)
            rows = rows.concat(extra)
          } catch { /* 本地模型没开就跳过 */ }
        }
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

      if (action === 'forget') {
        const d = open()
        if (!d) throw new Error('库还没建')
        const by = String(args?.by || '')
        const value = String(args?.value || '').trim()
        if (!['id', 'day', 'session'].includes(by) || !value) throw new Error('forget 需要 by(id/day/session) + value')
        const rows =
          by === 'id'
            ? d.prepare('SELECT id FROM chunks WHERE id = ?').all(value)
            : by === 'day'
              ? d.prepare('SELECT id FROM chunks WHERE day = ?').all(value)
              : d.prepare('SELECT id FROM chunks WHERE session = ?').all(value)
        d.prepare('INSERT OR REPLACE INTO tombstones (kind, value, at) VALUES (?,?,?)').run(by, value, new Date().toISOString())
        for (const r of rows) {
          d.prepare('DELETE FROM chunks WHERE id = ?').run(r.id)
          d.prepare('DELETE FROM chunks_fts WHERE id = ?').run(r.id)
          try { d.prepare('DELETE FROM vecs WHERE id = ?').run(r.id) } catch { /* 没向量表 */ }
          try { d.prepare('DELETE FROM subvecs WHERE chunk_id = ?').run(r.id) } catch { /* 没子片表 */ }
        }
        log(`forget ${by}=${value} → ${rows.length} 片`)
        return { ok: true, 删了: rows.length, 已立墓碑: `${by}=${value}`, 注意: '库里的正文和索引都删了；sessions/*.zstd 是底层存档，要清得另外处理' }
      }

      if (action === 'reindex') {
        const d = open()
        if (!d) throw new Error('库还没建')
        if (!(await localUp())) return { ok: false, 提示: '本地模型没开：先 ayy_local(action:"up")' }
        const rows = d.prepare('SELECT c.id, c.text FROM chunks c LEFT JOIN vecs v ON v.id = c.id WHERE v.id IS NULL').all()
        let ok = 0
        let fail = 0
        for (const r of rows) {
          const v = await embed(String(r.text).slice(0, 800))
          if (!v) { fail++; continue }
          d.prepare('INSERT OR REPLACE INTO vecs (id, model, dim, v, text_hash, at) VALUES (?,?,?,?,?,?)').run(r.id, 'bge-m3', v.length, pack(v), hashOf(String(r.text).slice(0, 500)), new Date().toISOString())
          ok++
        }
        log(`reindex: ${ok}/${rows.length}`)
        return { ok: true, 待建: rows.length, 已建: ok, 失败: fail, 提示: fail ? '有的没建成，看 Ollama 是否还在' : '好了' }
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

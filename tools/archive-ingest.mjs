// 对话史入库（幂等）。规则全在 ~/.dsh/ayy-archive/config.json 里。
//
// 用法：
//   node tools/archive-ingest.mjs --limit 100     先建 100 片的试点索引
//   node tools/archive-ingest.mjs --all           全量
//   node tools/archive-ingest.mjs --all --force   忽略已有的，重算（切分规则改了才用）
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-archive')
const DB = join(DIR, 'archive.db')
const CFG_FILE = join(DIR, 'config.json')
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

const argv = process.argv.slice(2)
const LIMIT = Number((() => { const i = argv.indexOf('--limit'); return i >= 0 ? argv[i + 1] : 0 })()) || 0
const ALL = argv.includes('--all')
const FORCE = argv.includes('--force')

const cfg = JSON.parse(readFileSync(CFG_FILE, 'utf8').replace(/^\uFEFF/, ''))
const CH = cfg['分片']
const BIG = cfg['长消息']

mkdirSync(DIR, { recursive: true })

// ── 解压 ────────────────────────────────────────────────
function decode(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === MAGIC[0] && buf[i + 1] === MAGIC[1] && buf[i + 2] === MAGIC[2] && buf[i + 3] === MAGIC[3]) starts.push(i)
  }
  if (!starts.length) starts.push(0)
  const recs = []
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    let text
    try {
      text = zlib.zstdDecompressSync(buf.subarray(starts[k], end)).toString('utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        recs.push(JSON.parse(line))
      } catch {
        /* 坏行跳过 */
      }
    }
  }
  return recs
}

// ── 抽取 ────────────────────────────────────────────────
const KEEP_TYPES = new Set(cfg['只取']['记录类型'])
const KEEP_BLOCKS = new Set(cfg['只取']['只留块类型'])
const DROP = cfg['丢弃前缀'].map((s) => String(s))

function isDropped(text) {
  const head = text.slice(0, 60).trimStart()
  return DROP.some((p) => head.startsWith(p))
}

function pick(rec) {
  if (!rec || !KEEP_TYPES.has(String(rec.type))) return null
  const d = rec.data || rec
  const msg = d.message || d
  const role = String(rec.type).startsWith('user') ? 'user' : 'assistant'
  let parts = []
  if (Array.isArray(msg.content)) {
    parts = msg.content.filter((b) => b && KEEP_BLOCKS.has(b.type)).map((b) => String(b.text || ''))
  } else if (typeof msg.content === 'string') {
    parts = [msg.content]
  } else if (typeof msg.text === 'string') {
    parts = [msg.text]
  }
  let text = parts.join('\n').trim()
  if (!text) return null
  if (isDropped(text)) return null
  // 超长：留摘要（首尾），正文指针指向原会话
  let truncated = false
  if (text.length > BIG['阈值']) {
    truncated = true
    const keep = Math.min(BIG['摘要字数'], text.length)
    text = text.slice(0, Math.round(keep * 0.75)) + '\n…（原文过长，已截断）…\n' + text.slice(-Math.round(keep * 0.25))
  }
  return { role, text, time: Number(rec.time || d.time || 0) || 0, id: String(rec.id || d.id || rec.seq || ''), truncated }
}

// ── 会话 → scope/speaker ─────────────────────────────────
function loadBindings() {
  try {
    const b = JSON.parse(readFileSync(join(HOME, 'qq-bridge-config.json'), 'utf8').replace(/^\uFEFF/, ''))
    const map = new Map()
    for (const it of b['绑定'] || []) {
      if (it && it['会话']) map.set(String(it['会话']), { type: it['类型'] === '群' ? 'group' : 'private', name: String(it['称呼'] || ''), number: String(it['号码'] || '') })
    }
    return map
  } catch {
    return new Map()
  }
}
const BIND = loadBindings()

// ── 切分：同会话内，按一问一答攒到 ~500 字 ─────────────────
function chunkMessages(msgs, target, max) {
  const out = []
  let buf = []
  let len = 0
  const flush = () => {
    if (!buf.length) return
    out.push(buf)
    buf = []
    len = 0
  }
  for (const m of msgs) {
    if (m.text.length > max) {
      flush()
      out.push([m])
      continue
    }
    if (len + m.text.length > max) flush()
    buf.push(m)
    len += m.text.length
    if (len >= target) flush()
  }
  flush()
  return out
}

// ── 主流程 ───────────────────────────────────────────────
const SESSIONS = join(HOME, 'sessions')
const files = []
for (const ws of readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const s of readdirSync(join(SESSIONS, ws.name), { withFileTypes: true })) {
    if (!s.isDirectory()) continue
    // 子智能体的会话 id 是纯 UUID（不带 session- 前缀）：那是"我派活写的任务书"，不是对话，排除
    if (!s.name.startsWith('session-')) continue
    const f = join(SESSIONS, ws.name, s.name, 'session.v4.jsonl.zstd')
    if (existsSync(f)) files.push({ file: f, session: s.name, workspace: ws.name })
  }
}
// 大的优先：试点时先入"聊得最多"的会话，测试才有意义
files.sort((a, b) => readFileSync(b.file).length - readFileSync(a.file).length)

const db = new DatabaseSync(DB)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    session TEXT, workspace TEXT, day TEXT,
    t_from INTEGER, t_to INTEGER,
    scope TEXT, speakers TEXT,
    roles TEXT, text TEXT, chars INTEGER,
    truncated INTEGER DEFAULT 0, meta INTEGER DEFAULT 0, ingested_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_day ON chunks(day);
  CREATE INDEX IF NOT EXISTS idx_session ON chunks(session);
  CREATE INDEX IF NOT EXISTS idx_scope ON chunks(scope);
`)
// 墓碑：forget 掉的东西，重新入库时不许回来
db.exec(`CREATE TABLE IF NOT EXISTS tombstones (
  kind TEXT, value TEXT, at TEXT, PRIMARY KEY (kind, value)
)`)

// 记录每个会话文件处理到哪（size+mtime）→ 没变就跳过
db.exec(`CREATE TABLE IF NOT EXISTS files (
  session TEXT PRIMARY KEY, size INTEGER, mtime INTEGER, chunks INTEGER, at TEXT
)`)

// 老库补 meta 列
try { db.exec('ALTER TABLE chunks ADD COLUMN meta INTEGER DEFAULT 0') } catch { /* 已有 */ }

// FTS5 全文索引
try {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, text, tokenize='trigram')`)
} catch {
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, text)`)
}

const dayOf = (ms) => {
  const d = new Date(Number(ms) || Date.now())
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

let added = 0
let skipped = 0
let changedFiles = 0
let sameFiles = 0
const PER_SESSION = LIMIT ? Math.max(3, Math.ceil(LIMIT / Math.max(1, files.length))) : 0
const target = CH['目标字数'] || 500
const max = CH['最大字数'] || 900

for (const f of files) {
  if (LIMIT && added >= LIMIT) break
  const st = statSync(f.file)
  const prev = db.prepare('SELECT size, mtime FROM files WHERE session = ?').get(f.session)
  if (!FORCE && prev && prev.size === st.size && prev.mtime === Math.round(st.mtimeMs)) {
    sameFiles++
    continue
  }
  changedFiles++
  let recs
  try {
    recs = decode(f.file)
  } catch {
    continue
  }
  // 这个文件变了：先清掉它的旧片段（处理删改），再重建
  if (prev) {
    for (const r of db.prepare('SELECT id FROM chunks WHERE session = ?').all(f.session)) {
      db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(r.id)
    }
    db.prepare('DELETE FROM chunks WHERE session = ?').run(f.session)
  }
  const bind = BIND.get(f.session) || { type: 'private', name: '' }
  const msgs = []
  for (const r of recs) {
    const x = pick(r)
    if (x) msgs.push(x)
  }
  let inThis = 0
  for (const group of chunkMessages(msgs, target, max)) {
    if (PER_SESSION && inThis >= PER_SESSION) break
    if (LIMIT && added >= LIMIT) break
    const text = group.map((m) => m.text).join('\n')
    const id = createHash('sha1').update(f.session + '|' + (group[0].id || group[0].time) + '|' + text.slice(0, 300)).digest('hex').slice(0, 16)
    const day = dayOf(Math.min(...group.map((m) => m.time || 0)) || 0)
    const tomb = db.prepare(`SELECT 1 FROM tombstones WHERE (kind='chunk' AND value=?) OR (kind='day' AND value=?) OR (kind='session' AND value=?) LIMIT 1`).get(id, day, f.session)
    if (tomb) { skipped++; continue }
    const exists = db.prepare('SELECT 1 FROM chunks WHERE id = ?').get(id)
    if (exists && !FORCE) {
      skipped++
      continue
    }
    const tFrom = Math.min(...group.map((m) => m.time || 0)) || 0
    const tTo = Math.max(...group.map((m) => m.time || 0)) || 0
    const speakers = [...new Set(group.filter((m) => m.role === 'user').slice(0, 1).map(() => bind.name || ''))]
    // 元对话标记：不在她的会话里、且满是技术词的片段（讨论系统本身），检索时降权/排除
    const TECH = /(ayy_[a-z]+|dsh-[a-z]+|插件|索引|入库|检索|向量|工具表|白名单)/
    const meta = !BIND.has(f.session) && TECH.test(text) ? 1 : 0
    db.prepare(`INSERT OR REPLACE INTO chunks
      (id, session, workspace, day, t_from, t_to, scope, speakers, roles, text, chars, truncated, meta, ingested_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, f.session, f.workspace, dayOf(tFrom), tFrom, tTo, bind.type,
      speakers.join(','), [...new Set(group.map((m) => m.role))].join(','), text, text.length,
      group.some((m) => m.truncated) ? 1 : 0, meta, new Date().toISOString(),
    )
    db.prepare('DELETE FROM chunks_fts WHERE id = ?').run(id)
    db.prepare('INSERT INTO chunks_fts (id, text) VALUES (?,?)').run(id, text)
    added++
    inThis++
  }
  // 记下这个文件处理到哪：下次 size+mtime 没变就跳过
  db.prepare('INSERT OR REPLACE INTO files (session, size, mtime, chunks, at) VALUES (?,?,?,?,?)').run(
    f.session, st.size, Math.round(st.mtimeMs), inThis, new Date().toISOString(),
  )
}

const total = db.prepare('SELECT COUNT(*) n FROM chunks').get().n
const chars = db.prepare('SELECT SUM(chars) s FROM chunks').get().s || 0
console.log(`入库 ${added} 片（跳过已存在 ${skipped}）· 变过 ${changedFiles} 个文件 / 没变 ${sameFiles} 个`)
console.log(`库内合计 ${total} 片 · ${chars.toLocaleString()} 字`)
console.log(`数据库：${DB}`)
db.close()

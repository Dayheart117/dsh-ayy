// 子片段向量：整片 500 字拿去给模型算相似度会被稀释，
// 所以再切一层 120–150 字的小片，命中后回溯到整片引用。
//
// 用法：node tools/archive-subvec.mjs [--limit N]
import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { embed, pack, localUp } from '../packages/dsh-ayy-archive/lib/vector.js'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DB = join(HOME, 'ayy-archive', 'archive.db')
const argv = process.argv.slice(2)
const i = argv.indexOf('--limit')
const LIMIT = i >= 0 ? Number(argv[i + 1]) : 0

if (!(await localUp())) {
  console.error('本地模型没开：先 ayy_local(action:"up")')
  process.exit(1)
}

const db = new DatabaseSync(DB)
db.exec('PRAGMA journal_mode = WAL')
db.exec(`
  CREATE TABLE IF NOT EXISTS subvecs (
    sid INTEGER PRIMARY KEY AUTOINCREMENT,
    chunk_id TEXT, ord INTEGER, text TEXT, dim INTEGER, v BLOB, at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sub_chunk ON subvecs(chunk_id);
`)

/** 按句号/分号/换行切，攒到 120–150 字一片；太短的并进下一片 */
function splitSentences(text, target = 140, max = 200) {
  const parts = String(text)
    .split(/(?<=[。！？；\n])/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out = []
  let buf = ''
  for (const p of parts) {
    if (buf.length + p.length > max && buf) {
      out.push(buf)
      buf = ''
    }
    buf += p
    if (buf.length >= target) {
      out.push(buf)
      buf = ''
    }
  }
  if (buf.trim()) {
    // 尾巴太短就并进上一片
    if (out.length && buf.length < 40) out[out.length - 1] += buf
    else out.push(buf)
  }
  return out.filter((s) => s.trim().length >= 20)
}

const chunks = db.prepare('SELECT id, text FROM chunks ORDER BY id').all()
const done = new Set(db.prepare('SELECT DISTINCT chunk_id FROM subvecs').all().map((r) => r.chunk_id))
let addedChunks = 0
let addedSubs = 0
const t0 = Date.now()

db.exec('BEGIN')
for (const c of chunks) {
  if (done.has(c.id)) continue
  if (LIMIT && addedChunks >= LIMIT) break
  const subs = splitSentences(c.text)
  let n = 0
  for (let k = 0; k < subs.length; k++) {
    const v = await embed(subs[k])
    if (!v) continue
    db.prepare('INSERT INTO subvecs (chunk_id, ord, text, dim, v, at) VALUES (?,?,?,?,?,?)').run(
      c.id, k, subs[k], v.length, pack(v), new Date().toISOString(),
    )
    n++
    addedSubs++
  }
  if (n) addedChunks++
}
db.exec('COMMIT')

const total = db.prepare('SELECT COUNT(*) n FROM subvecs').get().n
console.log(`处理 ${addedChunks} 个片段 → 新增子片 ${addedSubs} 条（库内共 ${total}）`)
console.log(`耗时 ${Math.round((Date.now() - t0) / 1000)} 秒`)

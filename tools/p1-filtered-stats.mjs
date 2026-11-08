// P1：按固定过滤规则统计（先抽样，再全量）
//
// 规则（已定死）：
//   · 只保留 user / assistant 的正文
//   · 丢掉：工具调用与结果、系统注入、base64 图片、每次都一样的提醒模板
//   · 单条 > 5000 字 → 只算摘要（估 1200 字）+ 留指针，不把全文计入
// 输出四个数：会话数、条数、总字数、去重后字数
//
// 用法：
//   node tools/p1-filtered-stats.mjs --sample 3        抽样 3 个最大的会话
//   node tools/p1-filtered-stats.mjs --all             全量
//   node tools/p1-filtered-stats.mjs --all --json x.json
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import zlib from 'node:zlib'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSIONS = join(HOME, 'sessions')
const MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const argv = process.argv.slice(2)
const num = (k, d) => {
  const i = argv.indexOf(k)
  return i >= 0 ? Number(argv[i + 1]) : d
}
const SAMPLE = num('--sample', 0)
const ALL = argv.includes('--all')
const idx = argv.indexOf('--json')
const OUT = idx >= 0 ? argv[idx + 1] : null

const BIG = 5000 // 超过这个字就只存摘要

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
        recs.push(JSON.parse(s))
      } catch {
        /* 坏行跳过 */
      }
    }
  }
  return recs
}

/**
 * 取 user/assistant 的正文。
 * 结构（实测）：assistant 在 data.message.content[]，块分 text / reasoning / tool-call；
 * 只取 text 块——reasoning 是内部思考，tool-call 不是人话。
 */
function pick(rec) {
  if (!rec || typeof rec !== 'object') return null
  const t = String(rec.type || '')
  const d = rec.data || rec
  const role = t === 'user/message' ? 'user' : t === 'assistant/message' ? 'assistant' : d.role === 'user' ? 'user' : d.role === 'assistant' ? 'assistant' : ''
  if (!role) return null

  const msg = d.message || d
  let text = ''

  const fromBlocks = (arr) =>
    arr
      .filter((b) => b && (b.type === 'text' || (b.type == null && typeof b.text === 'string')))
      .map((b) => String(b.text || ''))
      .join('\n')

  if (Array.isArray(msg.content)) text = fromBlocks(msg.content)
  else if (typeof msg.content === 'string') text = msg.content
  else if (typeof msg.text === 'string') text = msg.text
  if (!text && Array.isArray(d.content)) text = fromBlocks(d.content)

  text = String(text || '').trim()
  if (!text) return null
  return { role, text, time: Number(rec.time || d.time || 0) || 0, id: String(rec.id || d.id || '') }
}

// 模板识别：这些是每次注入、内容几乎一样的段落，不该进库
const TEMPLATE_PATTERNS = [
  /^【你的身份】/, /^【当前时间】/, /^【工作区】/, /^【我记得的事】/, /^【我是谁】/,
  /^上面是技能目录/, /可用技能目录已更新/, /^你记得的事/,
  /^<system-reminder>/i,
  /^Current runtime context\./i,            // 每轮注入的运行环境
  /^This is an automatically generated checkpoint/i, // 压缩摘要
  /^\[压缩摘要\]/, /^以下是之前对话的摘要/,
  /^<available_skills>/i,
]

function clean(s) {
  let t = String(s || '')
  t = t.replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]+/gi, '[图片]')
  t = t.replace(/"[A-Za-z0-9+/=]{200,}"/g, '"[长串]"')
  t = t.replace(/\{[\s\S]{500,}?\}/g, (m) => (m.length > 800 && /"(type|name|arguments|result)"/.test(m) ? '[JSON]' : m))
  t = t.replace(/\u0000/g, '')
  return t.trim()
}

const isTemplate = (t) => TEMPLATE_PATTERNS.some((re) => re.test(t.slice(0, 40)))

// ── 收集会话文件 ─────────────────────────────────────────
const files = []
for (const ws of readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  for (const s of readdirSync(join(SESSIONS, ws.name), { withFileTypes: true })) {
    if (!s.isDirectory()) continue
    const f = join(SESSIONS, ws.name, s.name, 'session.v4.jsonl.zstd')
    if (existsSync(f)) files.push({ file: f, session: s.name, workspace: ws.name })
  }
}

// 抽样：先按文件大小挑最大的 N 个
if (SAMPLE > 0) {
  files.sort((a, b) => readFileSync(b.file).length - readFileSync(a.file).length)
  files.splice(SAMPLE)
}

const seen = new Map() // 去重：清洗后正文 hash → 字数
let 会话数 = 0
let 条数 = 0
let 总字数 = 0
let 截断条数 = 0
let 模板跳过 = 0
let 空条 = 0
const perSession = []

for (const f of files) {
  let recs = []
  try {
    recs = decode(f.file)
  } catch {
    continue
  }
  会话数++
  let s条 = 0
  let s字 = 0
  for (const r of recs) {
    const x = pick(r)
    if (!x) continue
    const c = clean(x.text)
    if (!c) {
      空条++
      continue
    }
    if (isTemplate(c)) {
      模板跳过++
      continue
    }
    let chars = c.length
    if (chars > BIG) {
      截断条数++
      chars = 1200 // 摘要估算
    }
    条数++
    总字数 += chars
    s条++
    s字 += chars
    const key = c.slice(0, 200) + '|' + c.length // 粗去重键
    if (!seen.has(key)) seen.set(key, chars)
  }
  perSession.push({ session: f.session.slice(0, 20), workspace: f.workspace.slice(0, 26), 条数: s条, 字数: s字 })
}

const 去重后字数 = [...seen.values()].reduce((a, b) => a + b, 0)

const r = {
  范围: SAMPLE ? `抽样 ${会话数} 个最大的会话` : '全量',
  会话数,
  条数,
  总字数,
  去重后字数,
  去重砍掉: 总字数 - 去重后字数,
  超过5000字截断: 截断条数,
  模板跳过,
  空条,
  预估切片_500字: Math.ceil(去重后字数 / 500),
  预估向量MB: Math.round((Math.ceil(去重后字数 / 500) * 1024 * 4) / 1024 / 1024 * 10) / 10,
  最大会话: perSession.sort((a, b) => b.字数 - a.字数).slice(0, 3),
}

console.log(`=== P1 过滤后统计（${r.范围}）===`)
console.log(`会话数        ${r.会话数}`)
console.log(`条数          ${r.条数.toLocaleString()}（user+assistant）`)
console.log(`总字数        ${r.总字数.toLocaleString()}`)
console.log(`去重后字数    ${r.去重后字数.toLocaleString()}  ← 真正的"对话量"`)
console.log(`  去重砍掉    ${r.去重砍掉.toLocaleString()}`)
console.log(`  超长截断    ${r.超过5000字截断.toLocaleString()} 条（改存摘要）`)
console.log(`  模板跳过    ${r.模板跳过.toLocaleString()} 条 · 空条 ${r.空条.toLocaleString()}`)
console.log(`预估切片      ${r.预估切片_500字.toLocaleString()} 片 · 向量 ${r.预估向量MB} MB`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify(r, null, 1), 'utf8')
  console.log('\n已写：' + OUT)
}

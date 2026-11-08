// P0：只看规模，不改任何东西。
//
// 目标：把 ~/.dsh/sessions 下所有 zstd 多帧会话解出来，统计
//   会话数 / 记录数（按类型、按角色）/ 字数（原始 vs 清洗后）/ 时间跨度 / 预估切片数
// 用法：node tools/p0-conversation-stats.mjs [--json 输出文件]
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import zlib from 'node:zlib'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSIONS = join(HOME, 'sessions')
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]
const argv = process.argv.slice(2)
const outIdx = argv.indexOf('--json')
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null

/** 多帧 zstd → 记录数组 */
function decodeSession(file) {
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === ZSTD_MAGIC[0] && buf[i + 1] === ZSTD_MAGIC[1] && buf[i + 2] === ZSTD_MAGIC[2] && buf[i + 3] === ZSTD_MAGIC[3]) starts.push(i)
  }
  if (!starts.length) starts.push(0)
  const recs = []
  for (let k = 0; k < starts.length; k++) {
    const end = k + 1 < starts.length ? starts[k + 1] : buf.length
    let text
    try {
      text = zlib.zstdDecompressSync(buf.subarray(starts[k], end)).toString('utf8')
    } catch {
      continue // 坏帧跳过：失败隔离
    }
    for (const line of text.split('\n')) {
      const s = line.trim()
      if (!s) continue
      try {
        recs.push(JSON.parse(s))
      } catch {
        /* 半行/坏行跳过 */
      }
    }
  }
  return recs
}

/** 从记录里抠出「人和人说的话」 */
function extract(rec) {
  if (!rec || typeof rec !== 'object') return null
  const type = String(rec.type || '')
  // DSH 的记录类型：user/message、assistant/message、tool/call、tool/result、system …
  let role = ''
  let text = ''
  const d = rec.data || rec

  if (type.includes('user') || d.role === 'user') role = 'user'
  else if (type.includes('assistant') || d.role === 'assistant') role = 'assistant'
  else if (type.includes('tool')) role = 'tool'
  else if (type.includes('system')) role = 'system'
  else role = 'other'

  const grab = (v) => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v.map(grab).join('')
    if (v && typeof v === 'object') {
      if (typeof v.text === 'string') return v.text
      if (typeof v.content === 'string') return v.content
      if (Array.isArray(v.content)) return grab(v.content)
    }
    return ''
  }
  text = grab(d.content) || grab(d.text) || grab(d.message) || ''
  return { type, role, text, time: Number(rec.time || rec.created_at || d.time || 0) || 0 }
}

const clean = (s) =>
  String(s || '')
    .replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g, '[图片]') // base64
    .replace(/\{\s*"(?:type|name|arguments|result)"[\s\S]{300,}?\}/g, '[JSON]') // 超长 JSON
    .replace(/\u0000/g, '')

// ── 主流程 ────────────────────────────────────────────────
if (!existsSync(SESSIONS)) {
  console.error('没有 sessions 目录：' + SESSIONS)
  process.exit(1)
}

const files = []
for (const ws of readdirSync(SESSIONS, { withFileTypes: true })) {
  if (!ws.isDirectory()) continue
  const wsDir = join(SESSIONS, ws.name)
  for (const s of readdirSync(wsDir, { withFileTypes: true })) {
    if (!s.isDirectory()) continue
    const f = join(wsDir, s.name, 'session.v4.jsonl.zstd')
    if (existsSync(f)) files.push({ file: f, session: s.name, workspace: ws.name })
  }
}

const stats = {
  生成时间: new Date().toISOString(),
  会话数: files.length,
  会话: [],
  按角色: {},
  按类型: {},
  原始字数: 0,
  清洗后字数: 0,
  最短时间: null,
  最长时间: null,
  坏帧数: 0,
}

for (const f of files) {
  let recs = []
  try {
    recs = decodeSession(f.file)
  } catch (e) {
    stats.坏帧数++
    continue
  }
  const per = { session: f.session.slice(0, 20), workspace: f.workspace, 记录数: recs.length, 用户: 0, 助手: 0, 工具: 0, 系统: 0, 其他: 0, 原始字: 0, 清洗字: 0 }
  for (const r of recs) {
    const x = extract(r)
    if (!x) continue
    stats.按类型[x.type] = (stats.按类型[x.type] || 0) + 1
    const key = x.role === 'user' ? '用户' : x.role === 'assistant' ? '助手' : x.role === 'tool' ? '工具' : x.role === 'system' ? '系统' : '其他'
    per[key] = (per[key] || 0) + 1
    stats.按角色[key] = (stats.按角色[key] || 0) + 1
    per.原始字 += x.text.length
    const c = clean(x.text).length
    per.清洗字 += c
    if (x.role === 'user' || x.role === 'assistant') {
      stats.原始字数 += x.text.length
      stats.清洗后字数 += c
    }
    if (x.time) {
      if (!stats.最短时间 || x.time < new Date(stats.最短时间).getTime()) stats.最短时间 = new Date(x.time).toISOString()
      if (!stats.最长时间 || x.time > new Date(stats.最长时间).getTime()) stats.最长时间 = new Date(x.time).toISOString()
    }
  }
  stats.会话.push(per)
}

stats.会话.sort((a, b) => b.清洗字 - a.清洗字)
stats.总记录数 = Object.values(stats.按类型).reduce((a, b) => a + b, 0)
stats.预估切片数_500字 = Math.ceil(stats.清洗后字数 / 500)
stats.预估向量体积MB_1024维 = Math.round((stats.预估切片数_500字 * 1024 * 4) / 1024 / 1024 * 10) / 10

const mb = (n) => (n / 1024 / 1024).toFixed(1) + ' MB'
console.log('=== P0 对话史规模 ===')
console.log(`会话数        ${stats.会话数}`)
console.log(`总记录数      ${stats.总记录数}`)
console.log(`按类型        ${JSON.stringify(stats.按类型)}`)
console.log(`按角色        ${JSON.stringify(stats.按角色)}`)
console.log(`人说的话      ${stats.清洗后字数.toLocaleString()} 字（清洗后，约 ${Math.round(stats.清洗后字数 / 1.5).toLocaleString()} tokens）`)
console.log(`原始（未清洗）${stats.原始字数.toLocaleString()} 字`)
console.log(`时间跨度      ${stats.最短时间 || '?'} → ${stats.最长时间 || '?'}`)
console.log(`预估切片      约 ${stats.预估切片数_500字} 片（500 字一片）`)
console.log(`预估向量      约 ${stats.预估向量体积MB_1024维} MB（1024 维 float32）`)
console.log('')
console.log('最大的 8 个会话：')
for (const s of stats.会话.slice(0, 8)) {
  console.log(`  ${s.session} · ${s.workspace.slice(0, 28)} · ${s.记录数} 条 · 用户 ${s.用户} / 助手 ${s.助手} · ${s.清洗字.toLocaleString()} 字`)
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify(stats, null, 1), 'utf8')
  console.log('\n明细已写：' + OUT)
}

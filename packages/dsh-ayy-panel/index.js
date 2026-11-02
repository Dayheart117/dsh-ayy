// dsh-ayy-panel — host half. 合并自 dsh-ayy-desk（看）与 dsh-ayy-settings（改）。
//
// 一个面板、两组顶层标签，共用一份路径白名单 / 同源校验 / JSON 读写 / stat 工具。
//
// 只碰下面这些文件（路径白名单在 readableDirs / staticReadFiles / isWritablePath 里）：
//   personas/                    读（日记、自述、心愿、流水、原文、本子、健康日志、她的记忆）
//   personas/who-i-am.md         读 + 写（写前复制进 who-i-am-history/，并记 .source）
//   personas/who-i-am-history/   读 + 写（历史版本 + .source）
//   personas/her-memory.md       只读（绝不写：写记忆必须走 ayy_memory）
//   personas/wants-status.json   读 + 写（心愿单状态，不动 wants.md）
//   skills/<name>/SKILL.md       读 + 写（写前备份；删除只移到 skills/.trash/）
//   memory/                      读（归档记忆 index + notes）
//   ayy-files/                   读 + 写（收件箱 + config.json）
//   ayy-scope/config.json        读 + 写（只动「会话」数组，其余字段原样保留）
//   ayy-scope/scope.log          只读
//   ayy-notice/config.json       读 + 写（token 原样保留，不改）
//   qq-bridge-config.json        只读
//   ayy-settings/settings.log    读写（面板自己的日志）
//   NapCat .../onebot11_*.json   只读
//
// 所有路由都在 /api/ayy-panel/* 下，统一做同源校验；写操作前备份；异常转成结构化 JSON。
import {
  readFileSync,
  readdirSync,
  statSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  copyFileSync,
  unlinkSync,
  realpathSync,
  lstatSync,
  openSync,
  readSync,
  closeSync,
  appendFileSync,
  utimesSync,
} from 'node:fs'
// 万一运行时的 Node 太老没有 statfsSync，别在 import 阶段把整个插件弄崩
import * as fsModule from 'node:fs'
import { join, basename, sep, resolve, dirname, relative } from 'node:path'
import { homedir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'

export const name = 'dsh-ayy-panel'
/** 需要路由能力；会话标题用来给「注入范围」列出可勾选的会话 */
export const inject = ['webServer', 'sessions', 'sessionTitle']

const API_PREFIX = '/api/ayy-panel'

// NapCat 的配置文件目录（真实机器上就这一个；测试时可用环境变量换掉）
const NAPCAT_CONFIG_DIR = 'C:\\ProgramData\\NapCatQQ Desktop\\components\\NapCatQQ\\config'
const VOICE_HEALTH_URL = 'http://127.0.0.1:9880/health'

// ── 路径 ───────────────────────────────────────────────────────────────────

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const personasDir = () => join(dshHome(), 'personas')
const selfFile = () => join(personasDir(), 'who-i-am.md')
const selfHistoryDir = () => join(personasDir(), 'who-i-am-history')
const memoryFile = () => join(personasDir(), 'her-memory.md')
const healthLog = () => join(personasDir(), 'health.log')
const wantsStatusFile = () => join(personasDir(), 'wants-status.json')
const skillsDir = () => join(dshHome(), 'skills')
const filesRoot = () => join(dshHome(), 'ayy-files')
const filesCfg = () => join(filesRoot(), 'config.json')
const memoryDir = () => join(dshHome(), 'memory')
const scopeDir = () => join(dshHome(), 'ayy-scope')
const scopeCfg = () => join(scopeDir(), 'config.json')
const scopeLog = () => join(scopeDir(), 'scope.log')
const noticeDir = () => join(dshHome(), 'ayy-notice')
const noticeCfg = () => join(noticeDir(), 'config.json')
const bridgeCfg = () => join(dshHome(), 'qq-bridge-config.json')
const settingsDir = () => join(dshHome(), 'ayy-settings')
const settingsLog = () => join(settingsDir(), 'settings.log')
const napcatDir = () => process.env.AYY_SETTINGS_NAPCAT_DIR || NAPCAT_CONFIG_DIR

// ── 路径白名单（合并成一份） ───────────────────────────────────────────────

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

function underDir(root, full) {
  const r = resolve(root)
  const f = resolve(full)
  return f.length > r.length && f.toLowerCase().startsWith((r + sep).toLowerCase())
}

/** NapCat 目录下所有 onebot11_*.json（裸读，不走守卫，避免递归） */
function napcatConfigFiles() {
  try {
    const dir = napcatDir()
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((n) => /^onebot11_.+\.json$/i.test(n))
      .map((n) => join(dir, n))
  } catch {
    return []
  }
}

/** 明确允许读的单文件（其所在目录不在可读目录里时才需要列在这里） */
function staticReadFiles() {
  return [bridgeCfg()]
}

/** 明确允许读 + 递归扫的目录 */
function readableDirs() {
  return [
    personasDir(),
    selfHistoryDir(),
    skillsDir(),
    memoryDir(),
    filesRoot(),
    scopeDir(),
    noticeDir(),
    settingsDir(),
    napcatDir(),
  ]
}

function isReadablePath(full) {
  const f = resolve(full)
  for (const d of readableDirs()) {
    if (samePath(d, f) || underDir(d, f)) return true
  }
  return staticReadFiles().some((s) => samePath(s, f))
}

/** 技能目录下的合法文件名：SKILL.md 本身，或写前备份 / 原子写临时文件 */
function isWritableSkillFile(full) {
  const root = resolve(skillsDir())
  if (!underDir(root, full)) return false
  const parts = relative(root, full).split(sep)
  if (parts.length !== 2) return false
  const name = parts[0]
  const file = parts[1]
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(name)) return false
  if (file === 'SKILL.md') return true
  if (file.startsWith(`${name}.SKILL.md.bak-`)) return true
  if (file.startsWith('SKILL.md.tmp-')) return true
  return false
}

function isWritablePath(full) {
  const exact = [selfFile(), scopeCfg(), filesCfg(), noticeCfg(), settingsLog(), wantsStatusFile()]
  for (const f of exact) {
    const r = resolve(f)
    const low = String(full).toLowerCase()
    if (samePath(r, full)) return true
    if (low.startsWith((r + '.bak-').toLowerCase())) return true
    if (low.startsWith((r + '.tmp-').toLowerCase())) return true
  }
  if (underDir(selfHistoryDir(), full) && /\.(md|source)$/i.test(String(full))) return true
  return isWritableSkillFile(full)
}

function guardRead(p) {
  if (!isReadablePath(p)) throw new ApiError('path-not-allowed', 403)
}

function guardWrite(p) {
  if (!isWritablePath(p)) throw new ApiError('path-not-allowed', 403)
}

// ── HTTP 小工具（合并成一份） ──────────────────────────────────────────────

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) return true
  json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
  return false
}

/** 带状态码的业务错误：handler 里 throw，外层统一转成结构化 JSON */
class ApiError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

function failBody(error) {
  if (error instanceof ApiError) return { status: error.status, body: { ok: false, error: error.code } }
  return {
    status: 500,
    body: { ok: false, error: error instanceof Error ? error.message : String(error) },
  }
}

function getRoute(handler) {
  return (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
    if (!requireSameOrigin(req, res)) return
    Promise.resolve()
      .then(() => handler(req, res))
      .catch((error) => {
        const f = failBody(error)
        if (!res.headersSent) json(res, f.status, f.body)
      })
  }
}

function postRoute(handler) {
  return (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
    if (!requireSameOrigin(req, res)) return
    readJsonBody(req)
      .then((body) => handler(body, req))
      .then((out) => json(res, 200, Object.assign({ ok: true }, out || {})))
      .catch((error) => {
        const f = failBody(error)
        if (!res.headersSent) json(res, f.status, f.body)
      })
  }
}

function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > limit) {
        settled = true
        rejectBody(new ApiError('body-too-large', 413))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) return resolveBody({})
      try {
        const value = JSON.parse(raw)
        resolveBody(value && typeof value === 'object' ? value : {})
      } catch {
        rejectBody(new ApiError('invalid-json', 400))
      }
    })
    req.on('error', () => {
      if (settled) return
      settled = true
      rejectBody(new ApiError('body-read-failed', 400))
    })
  })
}

// ── 文件小工具 ─────────────────────────────────────────────────────────────

const readText = (p) => {
  try {
    if (!isReadablePath(p)) return ''
    return existsSync(p) ? readFileSync(p, 'utf8').replace(/^\uFEFF/, '') : ''
  } catch {
    return ''
  }
}

/** 走白名单的 stat：给用户看的文件都用它 */
const statOf = (p) => {
  try {
    if (!isReadablePath(p)) return null
    return existsSync(p) ? statSync(p) : null
  } catch {
    return null
  }
}

/** 不走白名单的 stat：只在存储占用递归扫描 / 会话目录枚举时用（只读大小，不读内容） */
const rawStat = (p) => {
  try {
    return existsSync(p) ? statSync(p) : null
  } catch {
    return null
  }
}

function readJson(p) {
  const raw = readText(p)
  if (!raw.trim()) return null
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

function readTailLines(file, count) {
  try {
    const st = statOf(file)
    if (!st || !st.isFile()) return []
    const max = 256 * 1024
    const start = Math.max(0, st.size - max)
    const len = st.size - start
    const buf = Buffer.alloc(len)
    const fd = openSync(file, 'r')
    try {
      readSync(fd, buf, 0, len, start)
    } finally {
      closeSync(fd)
    }
    return buf
      .toString('utf8')
      .replace(/^\uFEFF/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim() !== '')
      .slice(-count)
  } catch {
    return []
  }
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地时区的 YYYY-MM-DD */
function localDay(ms = Date.now()) {
  const d = new Date(Number(ms) || Date.now())
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 备份文件用：YYYYMMDD-HHmmss-SSS */
function stamp() {
  const d = new Date()
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${ms}`
}

/** 日志用：YYYY-MM-DD HH:mm:ss */
function logTime() {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** 历史版本命名沿用现有风格：2026-11-01T10-14-15-093Z（ISO 里的 : 和 . 换成 -） */
function isoStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function uniqueHistoryStamp() {
  const base = isoStamp()
  let out = base
  let i = 0
  while (existsSync(join(selfHistoryDir(), `${out}.md`)) || existsSync(join(selfHistoryDir(), `${out}.source`))) {
    i += 1
    out = `${base}-${i}`
  }
  return out
}

function tsFromDayTime(day, hh, mm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hh) || 0, Number(mm) || 0, 0, 0).getTime()
}

/** 写文件前先留一份备份，返回备份路径 */
function backupFile(file, target) {
  if (!existsSync(file) || !isReadablePath(file)) return null
  const dest = target || `${file}.bak-${stamp()}`
  try {
    guardWrite(dest)
    copyFileSync(file, dest)
    return dest
  } catch {
    return null
  }
}

/** 先写临时文件再改名，半截文件不会被读到 */
function writeAtomic(file, text) {
  guardWrite(file)
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    guardWrite(tmp)
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {}
    throw error
  }
}

function log(line) {
  try {
    mkdirSync(settingsDir(), { recursive: true })
    const dest = settingsLog()
    guardWrite(dest)
    appendFileSync(dest, `[${logTime()}] ${line}\n`, 'utf8')
  } catch {
    /* 日志写不进去也不影响面板 */
  }
}

/** 相对路径拼进 persona 目录，并确保没有跳出允许的根 */
function underPersonas(rel) {
  const root = resolve(personasDir())
  const full = resolve(root, String(rel || ''))
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

// ── 列表扫描 ───────────────────────────────────────────────────────────────

/** diary/<日期>.<场景>.md —— 场景里的冒号在落盘时已换成下划线 */
function listDir(dirName, ext = '.md') {
  const dir = join(personasDir(), dirName)
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(ext)) continue
    const full = join(dir, name)
    const st = statOf(full)
    if (!st || !st.isFile()) continue
    out.push({ rel: `${dirName}/${name}`, name, size: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** 允许读的相对路径白名单：只有她自己的那几类文件 */
function allowedRel(rel) {
  const r = String(rel || '').replace(/\\/g, '/')
  if (r === 'who-i-am.md' || r === 'wants.md') return true
  if (!r.includes('..') && /^(diary|diary-history|who-i-am-history|ledger|transcripts|notes)\/[^/]+\.md$/.test(r)) return true
  return false
}

/** 收件箱：<日期>/<文件名> */
function allowedInboxRel(rel) {
  const r = String(rel || '').replace(/\\/g, '/')
  if (!r || r.includes('..') || r.startsWith('/')) return false
  if (!/^\d{4}-\d{2}-\d{2}\/[^/\\]+$/.test(r)) return false
  const full = resolve(filesRoot(), r)
  const root = resolve(filesRoot())
  return full.startsWith(root + sep)
}

// ── 自述 / 技能 ────────────────────────────────────────────────────────────

const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n)?/

function stripFrontmatter(text) {
  const m = String(text || '').match(FRONTMATTER)
  return m ? text.slice(m[0].length) : String(text || '')
}

/** 只取 frontmatter 里的 description，够列表用 */
function frontmatterDescription(text) {
  const m = String(text || '').match(FRONTMATTER)
  if (!m) return ''
  const line = m[1].match(/^description:\s*(.*)$/m)
  return line ? line[1].replace(/^["']|["']$/g, '').trim() : ''
}

/** 取 frontmatter 里某个单值字段（title 之类） */
function frontmatterField(text, field) {
  const m = String(text || '').match(FRONTMATTER)
  if (!m) return ''
  const line = m[1].match(new RegExp(`^${field}:\\s*(.*)$`, 'm'))
  return line ? line[1].replace(/^["']|["']$/g, '').trim() : ''
}

function listSkills() {
  const dir = skillsDir()
  if (!existsSync(dir)) return []
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (e.name.startsWith('.')) continue
    const file = join(dir, e.name, 'SKILL.md')
    if (!existsSync(file)) continue
    const st = statOf(file)
    if (!st) continue
    const folderStat = statOf(join(dir, e.name))
    const raw = readText(file)
    out.push({
      name: e.name,
      description: frontmatterDescription(raw),
      chars: raw.trim().length,
      mtime: st.mtimeMs,
      created: folderStat ? folderStat.birthtimeMs || st.mtimeMs : st.mtimeMs,
    })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** 技能名只允许小写字母/数字/连字符——中文名 DSH 加载不了 */
function validSkillName(name) {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(String(name || ''))
}

function skillFile(name) {
  const n = String(name || '').trim()
  if (!n || /[\\/:*?"<>|]/.test(n) || n.includes('..') || n.startsWith('.')) return null
  const file = join(skillsDir(), n, 'SKILL.md')
  return existsSync(file) ? file : null
}

function composeSkill(name, description, body) {
  const desc = String(description == null ? '' : description)
    .replace(/[\r\n]+/g, ' ')
    .trim()
  const text = String(body == null ? '' : body)
    .replace(/\r\n/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\s+$/, '')
  return `---\nname: ${name}\ndescription: ${desc}\n---\n\n${text}\n`
}

// ── 心愿单 ─────────────────────────────────────────────────────────────────

const WANT_STATUSES = ['doing', 'done', 'dropped']

function wantsStatuses() {
  const raw = readText(wantsStatusFile())
  if (!raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof k === 'string' && WANT_STATUSES.includes(v)) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

/** wants.md 是纯文本行列表；状态存在旁边单独的 json 里，不动原文件 */
function wantsItems() {
  const text = readText(join(personasDir(), 'wants.md'))
  const statuses = wantsStatuses()
  const items = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!/^-\s+/.test(line)) continue
    const body = line.replace(/^-\s+/, '')
    const dateMatch = body.match(/^(\d{4}-\d{2}-\d{2})\s*·\s*/)
    const rest = dateMatch ? body.slice(dateMatch[0].length) : body
    const parts = rest.split('·').map((p) => p.trim())
    const key = rest.slice(0, 40).trim()
    if (!key) continue
    items.push({
      key,
      line: i + 1,
      date: dateMatch ? dateMatch[1] : '',
      text: parts[0] || rest.trim(),
      reason: parts.slice(1).join(' · '),
      status: statuses[key] || '',
    })
  }
  return items
}

// ── 动态（her-memory.md 的「最近动态」+ 月度流水）──────────────────────────

function recentLines() {
  // 记忆拆家后，「最近动态」在 personas/her-memory.md（memory/MEMORY.md 只剩全局那几句）
  const file = join(personasDir(), 'her-memory.md')
  const text = readText(file)
  const idx = text.indexOf('## 最近动态')
  if (idx < 0) return []
  const after = text.slice(idx + '## 最近动态'.length)
  const next = after.search(/\n## /)
  const body = next < 0 ? after : after.slice(0, next)
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^-\s+/.test(l))
    .map((l) => l.replace(/^-\s*/, ''))
}

/** `- 2026-11-01 08:05 · scene · 内容` → 带时间戳的条目 */
function recentItems() {
  return recentLines().map((line) => {
    const m = line.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
    return {
      text: line,
      day: m ? m[1] : '',
      t: m ? tsFromDayTime(m[1], m[2], m[3]) : 0,
    }
  })
}

function ledgerMonths() {
  const dir = join(personasDir(), 'ledger')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const full = join(dir, name)
    const st = statOf(full)
    if (!st || !st.isFile()) continue
    const lines = readText(full).split('\n').filter((l) => /^-\s+/.test(l)).length
    out.push({ name, rel: `ledger/${name}`, lines, size: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

// ── 日记小节 ───────────────────────────────────────────────────────────────

/** 把一篇日记拆成 `## HH:mm · 场景` 小节 */
function parseSections(text, day) {
  const out = []
  let cur = null
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^##\s+(?:(\d{1,2}):(\d{2}))\s*[·・]\s*(.*)$/)
    if (m) {
      cur = {
        time: `${pad2(m[1])}:${m[2]}`,
        scene: m[3].trim(),
        t: tsFromDayTime(day, m[1], m[2]),
        body: [],
      }
      out.push(cur)
      continue
    }
    if (/^#{1,2}\s/.test(line)) {
      cur = null
      continue
    }
    if (cur) cur.body.push(line)
  }
  return out.map((s) => {
    const body = s.body.join('\n').trim()
    return { time: s.time, scene: s.scene, t: s.t, chars: body.length, text: body }
  })
}

function dayOfDiaryName(name) {
  const base = String(name || '').replace(/\.md$/, '')
  const dot = base.indexOf('.')
  return dot < 0 ? base : base.slice(0, dot)
}

// ── 收件箱 ─────────────────────────────────────────────────────────────────

const TEXT_EXT = new Set([
  'md', 'txt', 'json', 'csv', 'log', 'js', 'mjs', 'cjs', 'ts', 'py', 'yml', 'yaml',
  'ini', 'xml', 'html', 'htm', 'css', 'sh', 'ps1', 'toml', 'srt', 'vtt', 'tsv',
])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])

function extOf(name) {
  const i = String(name).lastIndexOf('.')
  return i < 0 ? '' : String(name).slice(i + 1).toLowerCase()
}

function listInbox() {
  const root = filesRoot()
  if (!existsSync(root)) return []
  const groups = []
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.name)) continue
    const dir = join(root, e.name)
    const items = []
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      if (!f.isFile()) continue
      const full = join(dir, f.name)
      const st = statOf(full)
      if (!st) continue
      items.push({ name: f.name, rel: `${e.name}/${f.name}`, size: st.size, mtime: st.mtimeMs, ext: extOf(f.name) })
    }
    items.sort((a, b) => b.mtime - a.mtime)
    groups.push({ day: e.name, items })
  }
  return groups.sort((a, b) => (a.day < b.day ? 1 : -1))
}

// ── 原文缓存 ───────────────────────────────────────────────────────────────

function listTranscripts() {
  const dir = join(personasDir(), 'transcripts')
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue
    const full = join(dir, name)
    const st = statOf(full)
    if (!st || !st.isFile()) continue
    const base = name.replace(/\.md$/, '')
    const dot = base.indexOf('.')
    const day = dot < 0 ? base : base.slice(0, dot)
    const scene = dot < 0 ? '' : base.slice(dot + 1).replace(/_/g, ':')
    out.push({ name, rel: `transcripts/${name}`, day, scene, size: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1))
}

// ── 归档记忆 ───────────────────────────────────────────────────────────────

function readMemoryIndex() {
  const file = join(memoryDir(), 'index.json')
  const raw = readText(file)
  let parsed = null
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw)
    } catch {
      parsed = null
    }
  }
  const notes = []
  const seen = new Set()
  const pushNote = (n) => {
    const id = String((n && n.id) || '').replace(/\.md$/, '')
    if (!id || seen.has(id)) return
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.includes('..')) return
    seen.add(id)
    notes.push({
      id,
      title: String((n && n.title) || id),
      tags: Array.isArray(n && n.tags) ? (n.tags || []).map(String).filter(Boolean) : [],
      created: String((n && n.created) || ''),
      updated: String((n && n.updated) || (n && n.created) || ''),
      size: Number((n && n.size) || 0),
    })
  }
  if (parsed && Array.isArray(parsed.notes)) for (const n of parsed.notes) pushNote(n)
  // index 缺失/损坏时退回扫目录，至少列表不空
  const dir = join(memoryDir(), 'notes')
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue
      const id = name.replace(/\.md$/, '')
      if (seen.has(id)) continue
      const st = statOf(join(dir, name))
      pushNote({ id, title: id, tags: [], created: st ? new Date(st.mtimeMs).toISOString() : '', updated: st ? new Date(st.mtimeMs).toISOString() : '', size: st ? st.size : 0 })
    }
  }
  const ts = (s) => {
    const t = Date.parse(String(s || ''))
    return Number.isFinite(t) ? t : 0
  }
  notes.sort((a, b) => (ts(b.updated) || ts(b.created)) - (ts(a.updated) || ts(a.created)))
  const tags = []
  for (const n of notes) for (const tg of n.tags) if (!tags.includes(tg)) tags.push(tg)
  return { notes, tags }
}

function memoryNoteFile(id) {
  const v = String(id || '').trim()
  if (!v || v.includes('..') || !/^[A-Za-z0-9._-]+$/.test(v)) return null
  const file = join(memoryDir(), 'notes', `${v}.md`)
  return existsSync(file) ? file : null
}

// ── 时间线 ─────────────────────────────────────────────────────────────────

/** 成长时间线：日记 / 旧日记 / 自述 / 技能 / 心愿 / 动态，按修改时间倒序 */
function timeline(diaries, skills) {
  const events = []
  const push = (t, kind, label, ref) => {
    if (!t) return
    events.push({ t, kind, label, ref })
  }

  for (const d of diaries) {
    const base = d.name.replace(/\.md$/, '')
    const day = dayOfDiaryName(d.name)
    const dot = base.indexOf('.')
    const scene = dot < 0 ? '' : base.slice(dot + 1).replace(/_/g, ':')
    push(d.mtime, 'diary', scene ? `${day} · ${scene}` : day, { tab: 'diary', rel: d.rel })
  }
  for (const d of listDir('diary-history')) {
    push(d.mtime, 'diaryArchive', d.name.replace(/\.md$/, ''), { tab: 'oldDiary', rel: d.rel })
  }
  for (const s of skills) {
    push(s.mtime, 'skill', s.name, { tab: 'skills', name: s.name })
  }
  for (const h of listDir('who-i-am-history')) {
    push(h.mtime, 'selfArchive', h.name.replace(/\.md$/, ''), { tab: 'self', rel: h.rel })
  }

  const selfStat = statOf(join(personasDir(), 'who-i-am.md'))
  if (selfStat) push(selfStat.mtimeMs, 'self', '自我认知（当前）', { tab: 'self', rel: 'who-i-am.md' })

  const wantsStat = statOf(join(personasDir(), 'wants.md'))
  if (wantsStat) push(wantsStat.mtimeMs, 'wants', '心愿单', { tab: 'wants' })

  for (const item of recentItems()) {
    push(item.t, 'ledger', item.text.slice(0, 70), { tab: 'ledger' })
  }

  return events.sort((a, b) => b.t - a.t).slice(0, 160)
}

// ── 概览 ───────────────────────────────────────────────────────────────────

function overview() {
  const diaries = listDir('diary')
  const skills = listSkills()
  return {
    dir: personasDir(),
    diaries,
    diaryHistory: listDir('diary-history'),
    self: {
      exists: existsSync(join(personasDir(), 'who-i-am.md')),
      chars: readText(join(personasDir(), 'who-i-am.md')).trim().length,
      history: listDir('who-i-am-history'),
    },
    wants: {
      exists: existsSync(join(personasDir(), 'wants.md')),
      chars: readText(join(personasDir(), 'wants.md')).trim().length,
      items: wantsItems(),
    },
    skills,
    notes: listDir('notes'),
    ledger: { recent: recentLines(), recentItems: recentItems(), months: ledgerMonths() },
    timeline: timeline(diaries, skills),
  }
}

function findDiaryOfDay(day, diaries) {
  return diaries.find((d) => d.name === `${day}.md`) || diaries.find((d) => d.name.startsWith(`${day}.`)) || null
}

/** 「今天」页：今天有什么新的 */
function todaySummary() {
  const day = localDay()
  const diaries = listDir('diary')
  const diary = findDiaryOfDay(day, diaries)
  const sections = diary ? parseSections(readText(join(personasDir(), diary.rel)), day) : []

  const selfStat = statOf(join(personasDir(), 'who-i-am.md'))
  const selfChanged = !!selfStat && localDay(selfStat.mtimeMs) === day

  const skills = listSkills()
  const addedSkills = []
  const changedSkills = []
  for (const k of skills) {
    const createdDay = localDay(k.created || k.mtime)
    if (createdDay === day) addedSkills.push({ name: k.name, mtime: k.mtime, description: k.description })
    else if (localDay(k.mtime) === day) changedSkills.push({ name: k.name, mtime: k.mtime, description: k.description })
  }

  const wants = wantsItems()
  const wantsToday = wants.filter((w) => w.date === day).length
  const wantsStat = statOf(join(personasDir(), 'wants.md'))

  const recent = recentItems()
  const recentToday = recent.filter((r) => r.day === day).length
  const recentLastT = recent.reduce((n, r) => Math.max(n, r.t || 0), 0)

  const inbox = listInbox()
  const todayFiles = inbox.find((g) => g.day === day)
  const filesLastT = todayFiles
    ? todayFiles.items.reduce((n, f) => Math.max(n, f.mtime || 0), 0)
    : 0

  const transcripts = listTranscripts()
  const todayTranscripts = transcripts.filter((x) => x.day === day)
  const transcriptsLastT = todayTranscripts.reduce((n, x) => Math.max(n, x.mtime || 0), 0)

  return {
    day,
    now: Date.now(),
    diary: {
      exists: !!diary,
      rel: diary ? diary.rel : '',
      name: diary ? diary.name : '',
      mtime: diary ? diary.mtime : 0,
      sections: sections.map((s) => ({ time: s.time, scene: s.scene, t: s.t, chars: s.chars })),
    },
    self: {
      exists: !!selfStat,
      mtime: selfStat ? selfStat.mtimeMs : 0,
      changedToday: selfChanged,
      chars: readText(join(personasDir(), 'who-i-am.md')).trim().length,
    },
    skills: {
      total: skills.length,
      added: addedSkills,
      changed: changedSkills,
      items: skills.map((k) => ({ name: k.name, description: k.description, mtime: k.mtime, created: k.created })),
    },
    wants: { total: wants.length, today: wantsToday, items: wants, mtime: wantsStat ? wantsStat.mtimeMs : 0 },
    ledger: { recent: recent.length, today: recentToday, items: recent.slice(0, 5), lastT: recentLastT },
    files: {
      total: inbox.reduce((n, g) => n + g.items.length, 0),
      today: todayFiles ? todayFiles.items.length : 0,
      items: todayFiles ? todayFiles.items : [],
      lastT: filesLastT,
    },
    transcripts: {
      total: transcripts.length,
      today: todayTranscripts.length,
      items: todayTranscripts.slice(0, 5),
      lastT: transcriptsLastT,
    },
  }
}

// ── 全站搜索（一次扫盘做包含匹配，不建索引）────────────────────────────────

const MAX_SEARCH_FILE = 512 * 1024

/** 搜索用的读文件：太大的直接跳过，别把整篇读进内存 */
function readSearchText(p) {
  const st = statOf(p)
  if (!st || !st.isFile() || st.size > MAX_SEARCH_FILE) return ''
  return readText(p)
}

/** 搜索语料：一条 = 一个可点开的条目（日记按小节、心愿/流水按行、技能/自述按篇） */
function searchDocs() {
  const docs = []
  const push = (kind, title, ref, text, mtime) => {
    const t = String(text || '').trim()
    if (!t) return
    docs.push({ kind, title, ref, text: t, mtime })
  }

  for (const d of listDir('diary')) {
    const day = dayOfDiaryName(d.name)
    const full = join(personasDir(), d.rel)
    const text = readSearchText(full)
    const sections = parseSections(text, day)
    if (!sections.length) {
      push('diary', day, { tab: 'diary', rel: d.rel }, text, d.mtime)
      continue
    }
    for (const s of sections) {
      push('diary', s.scene ? `${day} · ${s.scene}` : `${day} · ${s.time}`, { tab: 'diary', rel: d.rel }, `${s.time} ${s.scene}\n${s.text}`, s.t || d.mtime)
    }
  }

  for (const d of listDir('diary-history')) {
    push('diaryArchive', d.name.replace(/\.md$/, ''), { tab: 'oldDiary', rel: d.rel }, readSearchText(join(personasDir(), d.rel)), d.mtime)
  }

  const selfFile = join(personasDir(), 'who-i-am.md')
  const selfStat = statOf(selfFile)
  push('self', '自我认知（当前）', { tab: 'self', rel: 'who-i-am.md' }, readSearchText(selfFile), selfStat ? selfStat.mtimeMs : 0)
  for (const h of listDir('who-i-am-history')) {
    push('selfArchive', `旧自述 · ${h.name.replace(/\.md$/, '')}`, { tab: 'self', rel: h.rel }, readSearchText(join(personasDir(), h.rel)), h.mtime)
  }

  for (const k of listSkills()) {
    const file = skillFile(k.name)
    if (!file) continue
    push('skill', k.name, { tab: 'skills', name: k.name }, readSearchText(file), k.mtime)
  }

  for (const w of wantsItems()) {
    push('wants', `心愿 · ${w.date || '无日期'}`, { tab: 'wants' }, `${w.text}\n${w.reason}`, statOf(join(personasDir(), 'wants.md'))?.mtimeMs || 0)
  }

  for (const m of ledgerMonths()) {
    const text = readSearchText(join(personasDir(), m.rel))
    for (const line of text.split(/\r?\n/)) {
      const l = line.trim()
      if (!/^-\s+/.test(l)) continue
      const item = l.replace(/^-\s*/, '')
      const dm = item.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/)
      push('ledger', `${m.name.replace(/\.md$/, '')} · 流水`, { tab: 'ledger', rel: m.rel }, item, dm ? tsFromDayTime(dm[1], dm[2], dm[3]) : m.mtime)
    }
  }

  return docs
}

function searchAll(query) {
  const q = String(query || '').trim()
  if (!q) return { query: q, total: 0, truncated: false, hits: [] }
  const needle = q.toLowerCase()
  const MAX = 200
  const SNIP = 70
  const hits = []
  for (const doc of searchDocs()) {
    if (hits.length >= MAX) break
    const text = doc.text
    if (text.length > 512 * 1024) continue
    const idx = text.toLowerCase().indexOf(needle)
    if (idx < 0) continue
    const lineStart = text.lastIndexOf('\n', idx) + 1
    let lineEnd = text.indexOf('\n', idx)
    if (lineEnd < 0) lineEnd = text.length
    const line = text.slice(lineStart, lineEnd)
    const col = Math.max(0, idx - lineStart)
    hits.push({
      kind: doc.kind,
      title: doc.title,
      ref: doc.ref,
      mtime: doc.mtime,
      snippet: {
        before: line.slice(Math.max(0, col - SNIP), col),
        match: line.slice(col, col + q.length),
        after: line.slice(col + q.length, col + q.length + SNIP),
      },
    })
  }
  return { query: q, total: hits.length, truncated: hits.length >= MAX, hits }
}

// ── 存储（只读：只算大小，不搬、不配置）──────────────────────────────────

const STORAGE_NAMES = [
  'personas', 'memory', 'skills', 'sessions', 'attachments', 'qq-bridge-inbox', 'ayy-files',
]

/** 递归数文件。联接/软链接一律跳过：既避免重复算，也避免死循环 */
function walkStats(root) {
  let files = 0
  let bytes = 0
  let latest = 0
  let truncated = false
  let visited = 0
  const started = Date.now()
  const stack = [root]
  while (stack.length) {
    if (Date.now() - started > 2500 || visited > 120000) {
      truncated = true
      break
    }
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      visited += 1
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        // 目录联接也是 reparse point：再确认一次，别顺着它绕圈或算两遍
        let lst
        try {
          lst = lstatSync(full)
        } catch {
          continue
        }
        if (lst.isSymbolicLink()) continue
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      const st = rawStat(full)
      if (!st) continue
      files += 1
      bytes += st.size
      if (st.mtimeMs > latest) latest = st.mtimeMs
    }
  }
  return { files, bytes, latest, truncated }
}

function storageDirInfo(dirName) {
  const path = join(dshHome(), dirName)
  const st = rawStat(path)
  if (!st) {
    return { name: dirName, path, real: '', isLink: false, exists: false, files: 0, bytes: 0, latest: 0, truncated: false }
  }
  let real = path
  try {
    real = realpathSync(path)
  } catch {
    real = path
  }
  const isLink = real.toLowerCase() !== path.toLowerCase()
  const walk = walkStats(real)
  return {
    name: dirName,
    path,
    real,
    isLink,
    exists: true,
    files: walk.files,
    bytes: walk.bytes,
    latest: Math.max(walk.latest, st.mtimeMs),
    truncated: walk.truncated,
  }
}

/** 盘符剩余空间；拿不到就不给 */
function diskInfo(root) {
  const statfs = fsModule.statfsSync
  if (typeof statfs !== 'function') return null
  try {
    const st = statfs(root)
    const bsize = Number(st.bsize)
    return { root, total: Number(st.blocks) * bsize, free: Number(st.bavail) * bsize }
  } catch {
    return null
  }
}

function storageSummary() {
  return {
    root: dshHome(),
    dirs: STORAGE_NAMES.map(storageDirInfo),
    disks: ['C:\\', 'E:\\'].map(diskInfo).filter(Boolean),
    scannedAt: Date.now(),
  }
}

// ── 网络探测 ───────────────────────────────────────────────────────────────

function probePort(host, port, timeoutMs = 800) {
  return new Promise((done) => {
    const started = Date.now()
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      try {
        socket.destroy()
      } catch {}
      done({ ok, ms: Date.now() - started })
    }
    const socket = netConnect({ host, port })
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function httpGetText(url, timeoutMs = 1500) {
  return new Promise((done) => {
    const started = Date.now()
    let settled = false
    const finish = (out) => {
      if (settled) return
      settled = true
      done(out)
    }
    let req
    try {
      req = httpRequest(url, { method: 'GET', timeout: timeoutMs }, (res) => {
        const chunks = []
        let size = 0
        res.on('data', (chunk) => {
          size += chunk.length
          if (size <= 64 * 1024) chunks.push(chunk)
        })
        res.on('end', () =>
          finish({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: Number(res.statusCode) || 0,
            body: Buffer.concat(chunks).toString('utf8').slice(0, 300),
            ms: Date.now() - started,
          }),
        )
        res.on('error', () =>
          finish({ ok: false, status: 0, body: '', ms: Date.now() - started, error: 'response-error' }),
        )
      })
    } catch (error) {
      return finish({ ok: false, status: 0, body: '', ms: Date.now() - started, error: String(error && error.message) })
    }
    req.on('timeout', () => {
      try {
        req.destroy()
      } catch {}
      finish({ ok: false, status: 0, body: '', ms: Date.now() - started, error: 'timeout' })
    })
    req.on('error', (error) =>
      finish({ ok: false, status: 0, body: '', ms: Date.now() - started, error: String(error && error.message) }),
    )
    req.end()
  })
}

// ── 她是谁 ─────────────────────────────────────────────────────────────────

function listHistory() {
  const dir = selfHistoryDir()
  if (!isReadablePath(dir) || !existsSync(dir)) return []
  const out = []
  try {
    for (const name of readdirSync(dir)) {
      if (!/\.md$/i.test(name)) continue
      const full = join(dir, name)
      const st = statOf(full)
      if (!st || !st.isFile()) continue
      const source = readText(join(dir, name.replace(/\.md$/i, '.source')))
        .trim()
        .split(/\r?\n/)[0]
      out.push({ name, size: st.size, mtime: st.mtimeMs, source, hasSource: !!source })
    }
  } catch {
    return []
  }
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, 100)
}

function currentSource(selfStat, history) {
  if (!selfStat) return ''
  // 每次保存都会把「保存前的旧版」连同一个 .source（谁改的）一起留档，
  // 所以最新那份档的 .source 就是当前这一版怎么来的。时间对不上就算不知道。
  const top = history && history[0]
  if (top && top.source && top.mtime >= selfStat.mtimeMs - 5 * 60 * 1000) return top.source
  return ''
}

/** 她存档时会在旧版开头写一行 <!-- 改动原因：… -->；恢复到这里时把它剥掉 */
function stripArchiveComment(text) {
  return String(text || '').replace(/^<!--[\s\S]*?-->\s*\r?\n?/, '')
}

function archiveCurrentSelf() {
  const file = selfFile()
  if (!existsSync(file)) return null
  mkdirSync(selfHistoryDir(), { recursive: true })
  const base = uniqueHistoryStamp()
  const target = join(selfHistoryDir(), `${base}.md`)
  guardWrite(target)
  copyFileSync(file, target)
  // Windows 上 copyFileSync 会连旧文件的 mtime 一起复制过来；存档时间应该是「这次保存的时间」，
  // 不然历史列表按 mtime 排序会把这份新档排到旧档后面。
  try {
    const now = new Date()
    utimesSync(target, now, now)
  } catch {
    /* 改不了时间也不影响内容 */
  }
  try {
    const sourceTarget = join(selfHistoryDir(), `${base}.source`)
    guardWrite(sourceTarget)
    writeFileSync(sourceTarget, '使用者', 'utf8')
  } catch {
    /* .source 写不进去不影响主流程 */
  }
  return { name: `${base}.md`, source: '使用者' }
}

function historyFile(name) {
  const n = String(name || '').trim()
  if (!/^[0-9A-Za-z][0-9A-Za-z._-]*\.md$/.test(n) || n.includes('..')) {
    throw new ApiError('path-not-allowed', 403)
  }
  const full = resolve(selfHistoryDir(), n)
  const root = resolve(selfHistoryDir())
  if (!full.toLowerCase().startsWith((root + sep).toLowerCase())) throw new ApiError('path-not-allowed', 403)
  const st = statOf(full)
  if (!st || !st.isFile()) throw new ApiError('not-found', 404)
  return full
}

// ── 收文件 / 通知 / 说话 ───────────────────────────────────────────────────

function filesOverview() {
  const cfg = readJson(filesCfg()) || {}
  const st = statOf(filesCfg())
  return {
    path: filesCfg(),
    exists: !!st,
    mtime: st ? st.mtimeMs : 0,
    size: st ? st.size : 0,
    onlyPrivate: cfg['只处理私聊'] !== false,
    onlyQQ: String(cfg['只收某个QQ发的'] || '').trim(),
  }
}

function toInt(value, fallback, min, max) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(n)))
}

function noticeOverview() {
  const cfg = readJson(noticeCfg()) || {}
  const st = statOf(noticeCfg())
  return {
    path: noticeCfg(),
    exists: !!st,
    mtime: st ? st.mtimeMs : 0,
    size: st ? st.size : 0,
    port: toInt(cfg.port, 9898, 1, 65535),
    retries: toInt(cfg['重试次数'], 5, 0, 50),
    retryMs: toInt(cfg['重试间隔毫秒'], 5000, 200, 600000),
    tokenSet: typeof cfg.token === 'string' && cfg.token !== '',
  }
}

function maskUrl(raw) {
  const text = String(raw || '')
  return text.replace(/(token=)[^&]+/i, '$1***')
}

function clientEntry(client) {
  const url = String((client && client.url) || '')
  return {
    name: String((client && client.name) || ''),
    enable: client && client.enable !== false,
    url: maskUrl(url),
  }
}

/** 选在用的那个 NapCat 配置：优先 httpClients 里已经指向中继端口的，其次有 httpClients 的，最后取最新改的 */
function napcatOverview(port) {
  const dir = napcatDir()
  const files = napcatConfigFiles()
  const entries = []
  for (const file of files) {
    const cfg = readJson(file) || {}
    const network = cfg.network && typeof cfg.network === 'object' ? cfg.network : {}
    const clients = Array.isArray(network.httpClients) ? network.httpClients.map(clientEntry) : []
    const configured = clients.some((c) => {
      if (!c.enable) return false
      const raw = String(c.url || '')
      return new RegExp(`:${port}(?:[/?]|$)`).test(raw) || /\/notice(?:\?|$)/.test(raw)
    })
    const st = statOf(file)
    entries.push({
      file: basename(file),
      full: file,
      exists: true,
      mtime: st ? st.mtimeMs : 0,
      clients,
      configured,
    })
  }
  entries.sort((a, b) => {
    if (a.configured !== b.configured) return a.configured ? -1 : 1
    if (a.clients.length !== b.clients.length) return b.clients.length - a.clients.length
    return b.mtime - a.mtime
  })
  const selected = entries[0] || null
  return {
    dir,
    found: entries.length > 0,
    files: files.map((f) => basename(f)),
    file: selected ? selected.file : '',
    full: selected ? selected.full : '',
    mtime: selected ? selected.mtime : 0,
    clients: selected ? selected.clients : [],
    configured: !!(selected && selected.configured),
    instances: entries.map((e) => ({ file: e.file, configured: e.configured, clients: e.clients.length })),
  }
}

// ── 注入范围 ───────────────────────────────────────────────────────────────

function parseMountLog(lines) {
  const state = {}
  for (const line of lines) {
    const m = /^\[([^\]]+)\]\s+(挂上|卸下)\s+(session-[^\s]+)/.exec(line)
    if (m) {
      state[m[3]] = { mounted: m[2] === '挂上', at: m[1] }
      continue
    }
    if (line.includes('已卸载（全部摘掉）')) {
      for (const sid of Object.keys(state)) state[sid] = { mounted: false, at: state[sid].at }
    }
  }
  return state
}

function bridgeBindings() {
  const bridge = readJson(bridgeCfg()) || {}
  const raw = Array.isArray(bridge['绑定']) ? bridge['绑定'] : []
  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    out.push({
      type: String(item['类型'] || ''),
      number: String(item['号码'] || ''),
      name: String(item['称呼'] || ''),
      session: String(item['会话'] || ''),
      enabled: item['开'] !== false,
    })
  }
  return out
}

let HOST = null

/** 活着的会话 → 标题。照 dsh-qq-link 的做法：
 *   ctx.sessions.list() 拿会话对象，ctx.get('sessionTitle').get(s) 拿标题快照。
 *   盘上没打开过的会话拿不到标题（会话名存在不透明的会话日志里，不值得为它解压）。
 */
function liveTitles() {
  const out = {}
  if (!HOST) return out
  try {
    const list = (HOST.sessions && typeof HOST.sessions.list === 'function' ? HOST.sessions.list() : []) || []
    const svc = HOST.get ? HOST.get('sessionTitle') : null
    for (const s of list) {
      if (!s) continue
      const id = s.id || s.sessionId
      if (!id) continue
      try {
        const snap = svc && typeof svc.get === 'function' ? svc.get(s) : null
        const title = snap && snap.title ? String(snap.title) : ''
        if (title) out[String(id)] = title
      } catch {
        /* 拿不到标题就用 id，不影响列表 */
      }
    }
  } catch {
    /* 服务缺席时静默降级 */
  }
  return out
}

/** 本机的全部会话（从 sessions/<工作区>/<会话id>/ 摸出来） */
function allSessions() {
  const titles = liveTitles() // 活着的会话才有标题；盘上的只有 id
  const root = join(dshHome(), 'sessions')
  const out = []
  let workspaces = []
  try {
    workspaces = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())
  } catch {
    return out
  }
  for (const ws of workspaces) {
    const wsDir = join(root, ws.name)
    // 跳过 dsh 自己内部跑的会话（刷B站/鲸鱼那些后台任务），列出来只会让人挑花眼
    if (/-dsh-(bili|whale)-/.test(ws.name)) continue
    let sess = []
    try {
      sess = readdirSync(wsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name.startsWith('session-'))
    } catch {
      continue
    }
    for (const s of sess) {
      const dir = join(wsDir, s.name)
      let mtime = 0
      let size = 0
      for (const f of ['session.v4.jsonl.zstd', 'session.v4.jsonl']) {
        const st = rawStat(join(dir, f))
        if (st) {
          mtime = st.mtimeMs
          size = st.size
          break
        }
      }
      // 工作区目录名是 DSH 压过的（--E-Dayheart-project-xxx--）。
      // 不能把 - 换回 \：DSH 把 \ / : 都换成了 -，反推不回去，会造出假路径。
      const pretty = ws.name.replace(/^--/, '').replace(/--$/, '')
      out.push({ id: s.name, title: titles[s.name] || '', workspace: pretty, workspaceKey: ws.name, mtime, size })
    }
  }
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

function scopeOverview() {
  const cfg = readJson(scopeCfg()) || {}
  const st = statOf(scopeCfg())
  const logSt = statOf(scopeLog())
  const sessions = Array.isArray(cfg['会话']) ? cfg['会话'].map(String).filter(Boolean) : []
  const bindings = bridgeBindings()
  const boundIds = new Set(bindings.map((b) => b.session).filter(Boolean))
  const picked = new Set(sessions)
  // 本机所有会话里，既不在白名单、也不是 QQ 绑定的那些——给"手动加一个会话"用
  const available = allSessions()
    .filter((s) => !picked.has(s.id) && !boundIds.has(s.id))
    .slice(0, 200)
  return {
    path: scopeCfg(),
    exists: !!st,
    mtime: st ? st.mtimeMs : 0,
    size: st ? st.size : 0,
    sessions,
    mounted: parseMountLog(readTailLines(scopeLog(), 50)),
    bindings,
    available,
    logPath: scopeLog(),
    logExists: !!logSt,
    logMtime: logSt ? logSt.mtimeMs : 0,
  }
}

// ── 状态 ───────────────────────────────────────────────────────────────────

function statusFiles(napcat) {
  const defs = [
    { key: 'self', path: selfFile() },
    { key: 'memory', path: memoryFile() },
    { key: 'scopeCfg', path: scopeCfg() },
    { key: 'scopeLog', path: scopeLog() },
    { key: 'filesCfg', path: filesCfg() },
    { key: 'noticeCfg', path: noticeCfg() },
    { key: 'bridge', path: bridgeCfg() },
    { key: 'health', path: healthLog() },
    { key: 'settingsLog', path: settingsLog() },
  ]
  if (napcat && napcat.full) defs.push({ key: 'napcat', path: napcat.full })
  return defs.map((d) => {
    const st = statOf(d.path)
    return {
      key: d.key,
      path: d.path,
      exists: !!st,
      size: st ? st.size : 0,
      mtime: st ? st.mtimeMs : 0,
    }
  })
}

async function buildSettingsOverview() {
  const selfStat = statOf(selfFile())
  const history = listHistory()
  const memoryStat = statOf(memoryFile())
  const files = filesOverview()
  const notice = noticeOverview()
  const [listening, voice, napcat] = await Promise.all([
    probePort('127.0.0.1', notice.port),
    httpGetText(VOICE_HEALTH_URL, 1500),
    Promise.resolve(napcatOverview(notice.port)),
  ])
  const scope = scopeOverview()
  return {
    now: Date.now(),
    self: {
      path: selfFile(),
      exists: !!selfStat,
      size: selfStat ? selfStat.size : 0,
      mtime: selfStat ? selfStat.mtimeMs : 0,
      source: currentSource(selfStat, history),
      content: readText(selfFile()).slice(0, 512 * 1024),
    },
    memory: {
      path: memoryFile(),
      exists: !!memoryStat,
      size: memoryStat ? memoryStat.size : 0,
      mtime: memoryStat ? memoryStat.mtimeMs : 0,
    },
    history,
    senses: {
      files,
      notice: Object.assign({}, notice, {
        listening,
        bridgeConfigured: !!napcat.configured,
        napcat,
      }),
      voice: {
        url: VOICE_HEALTH_URL,
        ok: !!voice.ok,
        status: Number(voice.status) || 0,
        ms: Number(voice.ms) || 0,
        error: String(voice.error || ''),
      },
    },
    scope,
    status: {
      health: readTailLines(healthLog(), 10),
      scopeLog: readTailLines(scopeLog(), 20),
      files: statusFiles(napcat),
    },
  }
}

// ── 写操作 ─────────────────────────────────────────────────────────────────

function saveSelf(content) {
  const text = String(content == null ? '' : content)
  if (!text.trim()) throw new ApiError('empty-self', 400)
  if (text.length > 200000) throw new ApiError('self-too-large', 413)

  const old = readText(selfFile())
  const next = `${text.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`
  if (old === next) {
    const st = statOf(selfFile())
    return { unchanged: true, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0, source: '使用者' }
  }

  const archived = archiveCurrentSelf()
  writeAtomic(selfFile(), next)
  const st = statOf(selfFile())
  log(`保存 who-i-am.md（旧版 → ${archived ? archived.name : '无旧版'}）`)
  return {
    unchanged: false,
    backup: archived ? archived.name : '',
    size: st ? st.size : 0,
    mtime: st ? st.mtimeMs : 0,
    source: '使用者',
  }
}

function restoreSelf(name) {
  const file = historyFile(name)
  const raw = readText(file)
  const content = stripArchiveComment(raw)
  if (!content.trim()) throw new ApiError('empty-history', 400)

  const archived = archiveCurrentSelf()
  writeAtomic(selfFile(), `${content.replace(/\r\n/g, '\n').replace(/\s+$/, '')}\n`)
  const st = statOf(selfFile())
  log(`恢复 who-i-am.md ← ${name}（恢复前旧版 → ${archived ? archived.name : '无旧版'}）`)
  return {
    restored: name,
    backup: archived ? archived.name : '',
    size: st ? st.size : 0,
    mtime: st ? st.mtimeMs : 0,
    source: '使用者',
  }
}

function readHistoryVersion(name) {
  const file = historyFile(name)
  const st = statOf(file)
  const source = readText(join(selfHistoryDir(), String(name).replace(/\.md$/i, '.source')))
    .trim()
    .split(/\r?\n/)[0]
  return {
    name: String(name),
    content: readText(file),
    size: st ? st.size : 0,
    mtime: st ? st.mtimeMs : 0,
    source,
  }
}

function saveFilesConfig(body) {
  const existing = readJson(filesCfg()) || {}
  const onlyQQ = String(body.onlyQQ == null ? '' : body.onlyQQ).trim()
  if (onlyQQ && !/^\d{5,15}$/.test(onlyQQ)) throw new ApiError('invalid-qq', 400)
  existing['只处理私聊'] = body.onlyPrivate !== false
  existing['只收某个QQ发的'] = onlyQQ
  const backup = backupFile(filesCfg())
  writeAtomic(filesCfg(), `${JSON.stringify(existing, null, 2)}\n`)
  log('保存 ayy-files/config.json')
  return { backup, config: filesOverview() }
}

function saveNoticeConfig(body) {
  const existing = readJson(noticeCfg()) || {}
  const port = Number(body.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ApiError('invalid-port', 400)
  const retries = Number(body.retries)
  if (!Number.isInteger(retries) || retries < 0 || retries > 50) throw new ApiError('invalid-retries', 400)
  const retryMs = Number(body.retryMs)
  if (!Number.isInteger(retryMs) || retryMs < 200 || retryMs > 600000) {
    throw new ApiError('invalid-retry-interval', 400)
  }
  existing.port = port
  existing['重试次数'] = retries
  existing['重试间隔毫秒'] = retryMs
  const backup = backupFile(noticeCfg())
  writeAtomic(noticeCfg(), `${JSON.stringify(existing, null, 2)}\n`)
  log(`保存 ayy-notice/config.json（port=${port}）`)
  return { backup, config: noticeOverview() }
}

function saveScopeConfig(body) {
  const raw = Array.isArray(body.sessions) ? body.sessions : []
  if (raw.length > 200) throw new ApiError('too-many-sessions', 400)
  const sessions = []
  for (const item of raw) {
    const sid = String(item == null ? '' : item).trim()
    if (!sid) continue
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(sid) || sid.includes('..')) throw new ApiError('invalid-session', 400)
    if (!sessions.includes(sid)) sessions.push(sid)
  }
  const existing = readJson(scopeCfg()) || {}
  existing['会话'] = sessions
  if (!existing['人格文件']) existing['人格文件'] = selfFile()
  if (!existing['记忆文件']) existing['记忆文件'] = memoryFile()
  const backup = backupFile(scopeCfg())
  writeAtomic(scopeCfg(), `${JSON.stringify(existing, null, 2)}\n`)
  log(`保存 ayy-scope/config.json（白名单 ${sessions.length} 个）`)
  return { backup, scope: scopeOverview() }
}

// ── 路由 ───────────────────────────────────────────────────────────────────

export function apply(ctx) {
  HOST = ctx
  const urlOf = (req) => new URL(req.url || '/', 'http://localhost')

  const routes = [
    // 看
    {
      kind: 'exact',
      path: `${API_PREFIX}/overview`,
      handler: getRoute((req, res) => {
        json(res, 200, { ok: true, ...overview() })
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/today`,
      handler: getRoute((req, res) => {
        json(res, 200, { ok: true, ...todaySummary() })
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/file`,
      handler: getRoute((req, res) => {
        const rel = urlOf(req).searchParams.get('rel') || ''
        if (!allowedRel(rel)) return json(res, 403, { ok: false, error: 'path-not-allowed' })
        const full = underPersonas(rel)
        if (!full) return json(res, 403, { ok: false, error: 'path-not-allowed' })
        if (!isReadablePath(full)) return json(res, 403, { ok: false, error: 'path-not-allowed' })
        if (!existsSync(full)) return json(res, 404, { ok: false, error: 'not-found' })
        json(res, 200, { ok: true, rel, name: basename(full), content: readText(full) })
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/skill`,
      handler: getRoute((req, res) => {
        const name = urlOf(req).searchParams.get('name') || ''
        const file = skillFile(name)
        if (!file) return json(res, 404, { ok: false, error: 'not-found' })
        const raw = readText(file)
        const st = statOf(file)
        json(res, 200, {
          ok: true,
          name,
          content: raw,
          description: frontmatterDescription(raw),
          body: stripFrontmatter(raw).replace(/^\s+/, ''),
          mtime: st ? st.mtimeMs : 0,
        })
      }),
    },
    {
      // 新建 / 保存技能
      kind: 'exact',
      path: `${API_PREFIX}/skill-save`,
      handler: postRoute(async (body) => {
        const mode = body.mode === 'create' ? 'create' : 'save'
        const nm = String(body.name || '').trim()
        if (!validSkillName(nm)) throw new ApiError('invalid-skill-name', 400)

        const dir = join(skillsDir(), nm)
        const file = join(dir, 'SKILL.md')
        if (mode === 'create' && existsSync(dir)) throw new ApiError('skill-exists', 409)
        if (mode === 'save' && !existsSync(file)) throw new ApiError('skill-not-found', 404)

        const text = composeSkill(nm, body.description, body.body)
        mkdirSync(dir, { recursive: true })
        // 备份就叫 <name>.SKILL.md.bak-<时间戳>，放在同一个技能目录里
        const backup = backupFile(file, join(dir, `${nm}.SKILL.md.bak-${stamp()}`))
        writeAtomic(file, text)
        const st = statOf(file)
        return {
          name: nm,
          mode,
          backup,
          mtime: st ? st.mtimeMs : Date.now(),
          description: frontmatterDescription(text),
        }
      }),
    },
    {
      // 删除技能：移到 skills/.trash/<时间戳>-<name>/，不真删
      kind: 'exact',
      path: `${API_PREFIX}/skill-delete`,
      handler: postRoute(async (body) => {
        const nm = String(body.name || '').trim()
        if (!validSkillName(nm)) throw new ApiError('invalid-skill-name', 400)
        const dir = join(skillsDir(), nm)
        if (!existsSync(dir)) throw new ApiError('skill-not-found', 404)
        const trashRoot = join(skillsDir(), '.trash')
        mkdirSync(trashRoot, { recursive: true })
        const target = join(trashRoot, `${stamp()}-${nm}`)
        if (!underDir(trashRoot, target)) throw new ApiError('path-not-allowed', 403)
        renameSync(dir, target)
        return { name: nm, movedTo: target }
      }),
    },
    {
      // 心愿单状态：只写 wants-status.json
      kind: 'exact',
      path: `${API_PREFIX}/wants-status`,
      handler: postRoute(async (body) => {
        const key = String(body.key || '').trim()
        if (!key) throw new ApiError('missing-key', 400)
        const status = String(body.status || '').trim()
        if (status && !WANT_STATUSES.includes(status)) throw new ApiError('invalid-status', 400)

        const known = new Set(wantsItems().map((w) => w.key))
        if (!known.has(key)) throw new ApiError('unknown-want', 404)

        const file = wantsStatusFile()
        const map = wantsStatuses()
        if (status) map[key] = status
        else delete map[key]

        mkdirSync(personasDir(), { recursive: true })
        const backup = backupFile(file)
        writeAtomic(file, `${JSON.stringify(map, null, 2)}\n`)
        return { key, status, backup, items: wantsItems() }
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/inbox`,
      handler: getRoute((req, res) => {
        const groups = listInbox()
        json(res, 200, {
          ok: true,
          root: filesRoot(),
          groups,
          total: groups.reduce((n, g) => n + g.items.length, 0),
        })
      }),
    },
    {
      // 收件箱单个文件预览：文本直接给内容，PDF/图片只给类型
      kind: 'exact',
      path: `${API_PREFIX}/inbox-file`,
      handler: getRoute((req, res) => {
        const rel = urlOf(req).searchParams.get('rel') || ''
        if (!allowedInboxRel(rel)) return json(res, 403, { ok: false, error: 'path-not-allowed' })
        const full = resolve(filesRoot(), rel)
        if (!isReadablePath(full)) return json(res, 403, { ok: false, error: 'path-not-allowed' })
        const st = statOf(full)
        if (!st || !st.isFile()) return json(res, 404, { ok: false, error: 'not-found' })

        const ext = extOf(full)
        const isText = TEXT_EXT.has(ext)
        const isImage = IMAGE_EXT.has(ext)
        const kind = isText ? 'text' : ext === 'pdf' ? 'pdf' : isImage ? 'image' : 'binary'
        const MAX = 512 * 1024
        let content = null
        let tooLarge = false
        if (isText) {
          if (st.size > MAX) tooLarge = true
          else content = readText(full)
        }
        json(res, 200, {
          ok: true,
          rel,
          name: basename(full),
          fullPath: full,
          size: st.size,
          mtime: st.mtimeMs,
          ext,
          kind,
          content,
          tooLarge,
        })
      }),
    },
    {
      // 原文缓存列表
      kind: 'exact',
      path: `${API_PREFIX}/transcripts`,
      handler: getRoute((req, res) => {
        json(res, 200, { ok: true, items: listTranscripts() })
      }),
    },
    {
      // 全站搜索
      kind: 'exact',
      path: `${API_PREFIX}/search`,
      handler: getRoute((req, res) => {
        const q = urlOf(req).searchParams.get('q') || ''
        json(res, 200, { ok: true, ...searchAll(q) })
      }),
    },
    {
      // 归档记忆列表
      kind: 'exact',
      path: `${API_PREFIX}/memory`,
      handler: getRoute((req, res) => {
        const { notes, tags } = readMemoryIndex()
        let contents
        if (urlOf(req).searchParams.get('full') === '1') {
          contents = {}
          for (const n of notes) {
            const file = join(memoryDir(), 'notes', `${n.id}.md`)
            contents[n.id] = stripFrontmatter(readText(file)).replace(/^\s*\n/, '')
          }
        }
        json(res, 200, { ok: true, notes, tags, contents })
      }),
    },
    {
      // 存储占用（只读）
      kind: 'exact',
      path: `${API_PREFIX}/storage`,
      handler: getRoute((req, res) => {
        json(res, 200, { ok: true, ...storageSummary() })
      }),
    },
    {
      // 归档记忆正文（去掉 frontmatter）
      kind: 'exact',
      path: `${API_PREFIX}/memory-note`,
      handler: getRoute((req, res) => {
        const id = urlOf(req).searchParams.get('id') || ''
        const file = memoryNoteFile(id)
        if (!file) return json(res, 404, { ok: false, error: 'not-found' })
        const raw = readText(file)
        const st = statOf(file)
        json(res, 200, {
          ok: true,
          id,
          title: frontmatterField(raw, 'title'),
          content: stripFrontmatter(raw).replace(/^\s*\n/, ''),
          mtime: st ? st.mtimeMs : 0,
        })
      }),
    },

    // 改
    {
      kind: 'exact',
      path: `${API_PREFIX}/settings`,
      handler: getRoute(async (req, res) => {
        const data = await buildSettingsOverview()
        json(res, 200, Object.assign({ ok: true }, data))
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/self/save`,
      handler: postRoute(async (body) => saveSelf(body.content)),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/self/restore`,
      handler: postRoute(async (body) => restoreSelf(body.name)),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/self/history`,
      handler: getRoute((req, res) => {
        const name = urlOf(req).searchParams.get('name') || ''
        json(res, 200, Object.assign({ ok: true }, readHistoryVersion(name)))
      }),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/senses/files`,
      handler: postRoute(async (body) => saveFilesConfig(body)),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/senses/notice`,
      handler: postRoute(async (body) => saveNoticeConfig(body)),
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/scope`,
      handler: postRoute(async (body) => saveScopeConfig(body)),
    },
  ]

  try {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        for (const dispose of disposers) dispose()
        throw error
      }
      log(`已加载：源的面板（18 个标签 / ${routes.length} 条路由）`)
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-ayy-panel: routes')
  } catch (error) {
    log(`路由注册失败：${error instanceof Error ? error.message : String(error)}`)
    console.error('[dsh-ayy-panel] route registration failed:', error)
  }
}

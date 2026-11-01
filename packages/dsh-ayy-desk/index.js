// dsh-ayy-desk — host half.
//
// 把 ~/.dsh/ 下她自己的东西端给浏览器：日记、旧日记、自述、心愿单、动态流水、
// 技能、QQ 收件箱、原文缓存、归档记忆。
//
// 写操作只有两处，都做了同源校验 + 路径白名单 + 写前备份：
//  1. 技能：新建 / 改 description+正文 / 删除（删除只是移到 skills/.trash/）。
//  2. 心愿单状态：不动 wants.md，只在旁边的 wants-status.json 里记一行状态。
// 其它一律只读。
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
} from 'node:fs'
// 万一运行时的 Node 太老没有 statfsSync，别在 import 阶段把整个插件弄崩
import * as fsModule from 'node:fs'
import { join, basename, sep, resolve } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-desk'
/** 需要路由能力 */
export const inject = ['webServer']

const API_PREFIX = '/api/ayy-desk'

// ── 路径 ───────────────────────────────────────────────────────────────────

const dshHome = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const personasDir = () => join(dshHome(), 'personas')
const skillsDir = () => join(dshHome(), 'skills')
const filesRoot = () => join(dshHome(), 'ayy-files')
const memoryDir = () => join(dshHome(), 'memory')

/** 相对路径拼进 persona 目录，并确保没有跳出允许的根 */
function underPersonas(rel) {
  const root = resolve(personasDir())
  const full = resolve(root, String(rel || ''))
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

// ── HTTP 小工具 ────────────────────────────────────────────────────────────

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
  return { status: 500, body: { ok: false, error: error instanceof Error ? error.message : String(error) } }
}

function getRoute(handler) {
  return (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
    if (!requireSameOrigin(req, res)) return
    try {
      handler(req, res)
    } catch (error) {
      const f = failBody(error)
      json(res, f.status, f.body)
    }
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

function postRoute(handler) {
  return async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
    if (!requireSameOrigin(req, res)) return
    try {
      const body = await readJsonBody(req)
      const out = await handler(body, req)
      json(res, 200, Object.assign({ ok: true }, out || {}))
    } catch (error) {
      const f = failBody(error)
      json(res, f.status, f.body)
    }
  }
}

// ── 文件小工具 ─────────────────────────────────────────────────────────────

const readText = (p) => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}

const statOf = (p) => {
  try {
    return existsSync(p) ? statSync(p) : null
  } catch {
    return null
  }
}

const pad2 = (n) => String(n).padStart(2, '0')

/** 本地时区的 YYYY-MM-DD */
function localDay(ms = Date.now()) {
  const d = new Date(Number(ms) || Date.now())
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function stamp() {
  const d = new Date()
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}-${ms}`
}

function tsFromDayTime(day, hh, mm) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''))
  if (!m) return 0
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hh) || 0, Number(mm) || 0, 0, 0).getTime()
}

/** 写文件前先留一份备份，返回备份路径 */
function backupFile(file, target) {
  if (!existsSync(file)) return null
  const dest = target || `${file}.bak-${stamp()}`
  try {
    copyFileSync(file, dest)
    return dest
  } catch {
    return null
  }
}

/** 先写临时文件再改名，半截文件不会被读到 */
function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(tmp, text, 'utf8')
    renameSync(tmp, file)
  } catch (error) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {}
    throw error
  }
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
  if (!r.includes('..') && /^(diary|diary-history|who-i-am-history|ledger|transcripts)\/[^/]+\.md$/.test(r)) return true
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

function wantsStatusFile() {
  return join(personasDir(), 'wants-status.json')
}

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

// ── 动态（MEMORY.md 的「最近动态」+ 月度流水）──────────────────────────────

function recentLines() {
  const file = join(memoryDir(), 'MEMORY.md')
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
      const st = statOf(full)
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
  const st = statOf(path)
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

// ── 路由 ───────────────────────────────────────────────────────────────────

export function apply(ctx) {
  const urlOf = (req) => new URL(req.url || '/', 'http://localhost')

  const routes = [
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
      // 收件箱
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
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-ayy-desk: routes')
  } catch (error) {
    console.error('[dsh-ayy-desk] route registration failed:', error)
  }
}

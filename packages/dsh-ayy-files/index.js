/**
 * dsh-ayy-files —— 安源悦 · 收文件
 *
 * 她的处境：QQ 桥（dsh-qq-link）的入站解析只认 text / image / mface / face / record / video / json / xml / at / forward，
 * **没有 file 分支** —— 小白从 QQ 发来的 PDF、Word、zip 整条被丢掉，她那边一个字都看不到。
 * 桥的代码不能改（升级会覆盖），所以这个插件在旁边补这一块：
 *
 *   1. 自己按 timer 轮询 NapCat 的 get_friend_msg_history / get_group_msg_history；
 *   2. 只看水位之后的新消息，捞出 type === 'file' 的段；
 *   3. 先试段里的 url / 本地缓存路径，没有再走 NapCat 的 get_file 动作；
 *   4. 存到 <DSH_HOME>/ayy-files/<日期>/<安全文件名>，重名加序号，超过 50MB 只通知不下载；
 *   5. 用 ctx.agents.get(会话).followup(...) 往对应会话注一条 user 消息，写清哪个文件、多大、落在哪；
 *      失败也写「没取到 + 原因」—— 不能让她以为对方没发东西。
 *
 * ⚠️ 只处理 file 段：文字桥已经在转了，重复转发会让她收到两遍同样的话。
 * ⚠️ 所有定时器、监听都在 apply(ctx) 里用 ctx.effect 注册并返回清理函数。
 * ⚠️ 任何异常都 try/catch 吃掉 + 写 files.log，绝不能抛出去把插件（甚至宿主）搞挂。
 */
import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, statSync,
} from 'node:fs'
import { join, basename, isAbsolute, extname, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-ayy-files'
/** 只写真实存在的服务：agents（往会话注消息）+ timer（轮询）。写错会让整个 preset 消失。 */
export const inject = ['agents', 'timer']

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const BRIDGE_CFG = join(DSH_HOME, 'qq-bridge-config.json')
const ROOT = join(DSH_HOME, 'ayy-files')
const STATE_FILE = join(ROOT, 'state.json')
const LOG_FILE = join(ROOT, 'files.log')
const LOG_MAX_BYTES = 2 * 1024 * 1024

const MAX_BYTES = 50 * 1024 * 1024   // 单文件上限 50MB
const POLL_MS = 5000                 // 轮询间隔
const COUNT_FRIEND = 20              // 私聊一次拉多少条
const COUNT_GROUP = 30               // 群一次拉多少条
const MAX_MSGS_PER_TICK = 5          // 一跳最多处理几条带文件的消息（防刷）
const MAX_FILES_PER_MSG = 6          // 一条消息最多取几个文件
const MAX_INJECT_TRIES = 3           // 注入会话失败重试几次后放弃（普通错误）
const MAX_INJECT_TRIES_AGENT = 36    // 会话没活着时多等一会儿（5 秒一跳 ≈ 3 分钟），别一过期就把文件通知丢了
const SEEN_MAX = 800                 // 记住多少个已处理的文件消息 id
const NAPCAT_TIMEOUT_MS = 12000

// ── 开关（每次轮询现读，改文件即可生效，不用重启）────────────────────────
// 默认只处理私聊：群里别人发的文件不下载、不打断她。
const CONFIG_FILE = join(ROOT, 'config.json')

function readLocalConfig() {
  const fallback = { 只处理私聊: true, 只收某个QQ发的: '' }
  try {
    if (!existsSync(CONFIG_FILE)) return fallback
    const raw = JSON.parse(readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''))
    return {
      只处理私聊: raw['只处理私聊'] !== false,
      只收某个QQ发的: String(raw['只收某个QQ发的'] || '').trim(),
    }
  } catch {
    return fallback
  }
}

// ── 日志 ────────────────────────────────────────────────────────────────

let logReady = false

function rotateLog() {
  try {
    if (!existsSync(LOG_FILE)) return
    if (statSync(LOG_FILE).size < LOG_MAX_BYTES) return
    renameSync(LOG_FILE, LOG_FILE + '.1')
  } catch (error) { /* 转不动就算了，接着往下写 */ }
}

function log(line) {
  try {
    if (!logReady) { logReady = true; mkdirSync(dirname(LOG_FILE), { recursive: true }); rotateLog() }
    const d = new Date()
    const p = (n) => String(n).padStart(2, '0')
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    appendFileSync(LOG_FILE, `[${stamp}] ${line}\n`, 'utf8')
  } catch (error) { /* 日志写不了也不能影响主流程 */ }
  try { console.log('[dsh-ayy-files] ' + line) } catch (error) { /* ignore */ }
}

function errText(error) {
  return String((error && error.message) || error || '原因不明')
}

// ── 文件系统小工具 ───────────────────────────────────────────────────────

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch (error) { /* existsSync 兜底 */ }
  return dir
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return null
  }
}

function writeJsonAtomic(file, value) {
  const tmp = file + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  renameSync(tmp, file)
}

/** 路径安全：去掉 \ / : * ? " < > | 和控制字符，Windows 还怕结尾的点和空格 */
export function sanitizeName(raw, fallback = 'qq-file') {
  let s = String(raw == null ? '' : raw).trim()
  s = s.replace(/^.*[\\/]/, '')                     // 万一把整条路径塞进来，只要文件名
  s = s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')  // Windows 非法字符
  s = s.replace(/\s+/g, ' ').trim()
  s = s.replace(/^\.+/, '').replace(/[. ]+$/, '')   // 开头/结尾的点和空格
  if (!s) s = fallback
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(s)) s = '_' + s
  if (s.length > 120) {
    const ext = extname(s).slice(0, 16)
    s = s.slice(0, 120 - ext.length) + ext
  }
  return s || fallback
}

/** 在 dir 里找一个不撞名的落点：a.pdf → a (2).pdf → a (3).pdf */
function uniquePath(dir, safeName) {
  let target = join(dir, safeName)
  if (!existsSync(target)) return target
  const ext = extname(safeName)
  const stem = ext ? safeName.slice(0, safeName.length - ext.length) : safeName
  for (let i = 2; i < 1000; i++) {
    target = join(dir, `${stem} (${i})${ext}`)
    if (!existsSync(target)) return target
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

function dayFolder(unixSeconds) {
  let d = new Date()
  const t = Number(unixSeconds)
  if (Number.isFinite(t) && t > 0) d = new Date(t * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function fmtSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '大小未知'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

// ── 解析 file 段 ─────────────────────────────────────────────────────────
//
// NapCat 的 file 段（OB11MessageFile → FileBaseData）文档字段：
//   { type: 'file', data: { file, path, url, name, thumb } }
// 实测还有些版本额外带 file_id / file_size。所有字段名都宽松地认一遍。

function pickString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

function pickNumber(...vals) {
  for (const v of vals) {
    if (v == null || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return null
}

function isHttp(u) {
  return /^https?:\/\//i.test(String(u || ''))
}

/** file:///C:/x/y.pdf → C:\x\y.pdf */
function fileUrlToPath(u) {
  const raw = String(u || '')
  if (!/^file:\/\//i.test(raw)) return ''
  try {
    const uu = new URL(raw)
    let p = decodeURIComponent(uu.pathname || '')
    if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1)
    return p.replace(/\//g, '\\')
  } catch (error) {
    return ''
  }
}

function localPathCandidates(d) {
  const out = []
  const asUrl = pickString(d && d.url)
  if (/^file:\/\//i.test(asUrl)) out.push(fileUrlToPath(asUrl))
  for (const v of [pickString(d && d.path), pickString(d && d.file), fileUrlToPath(pickString(d && d.file))]) {
    if (v && isAbsolute(v)) out.push(v)
  }
  return out.filter(Boolean)
}

export function parseFileSeg(seg) {
  const d = (seg && seg.data) || {}
  const urlField = pickString(d.url)
  const fileField = pickString(d.file)
  let url = ''
  if (isHttp(urlField)) url = urlField
  else if (isHttp(fileField)) url = fileField
  const fileId = pickString(d.file_id, d.fileId, d.id)
  const rawName = pickString(d.name, d.file_name, d.fileName, d.filename)
  const pathHint = pickString(d.path, fileField)
  const guessed = !rawName && pathHint && !isHttp(pathHint) ? basename(pathHint.replace(/\\/g, '/')) : ''
  const name = sanitizeName(rawName || guessed || (fileId ? `qq-file-${fileId.slice(-8)}` : 'qq-file'), 'qq-file')
  const size = pickNumber(d.file_size, d.fileSize, d.size)
  return { name, size, url, fileId, fileField, pathHint, local: localPathCandidates(d).filter((p) => p && existsSync(p)) }
}

// ── NapCat 接口 ──────────────────────────────────────────────────────────

function readBridge() {
  const cfg = readJson(BRIDGE_CFG)
  return cfg && typeof cfg === 'object' ? cfg : null
}

function napcatBase(cfg) {
  return String((cfg && cfg['NapCat']) || 'http://127.0.0.1:3000').replace(/\/+$/, '')
}

function napcatHeaders(cfg) {
  const h = { 'content-type': 'application/json', 'user-agent': 'dsh-ayy-files' }
  const token = String((cfg && cfg['令牌']) || '').trim()
  if (token) h.authorization = 'Bearer ' + token
  return h
}

async function napcat(cfg, action, body, timeoutMs = NAPCAT_TIMEOUT_MS) {
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) {} }, timeoutMs)
  try {
    const res = await fetch(`${napcatBase(cfg)}/${action}`, {
      method: 'POST',
      headers: napcatHeaders(cfg),
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (error) {
      throw new Error(`NapCat ${action} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 160)}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

async function fetchHistory(cfg, isGroup, target) {
  const action = isGroup ? 'get_group_msg_history' : 'get_friend_msg_history'
  const body = isGroup
    ? { group_id: Number(target), count: COUNT_GROUP }
    : { user_id: Number(target), count: COUNT_FRIEND }
  const json = await napcat(cfg, action, body)
  if (!json || json.status !== 'ok' || json.retcode !== 0) {
    throw new Error(`取历史失败：${JSON.stringify(json && (json.message || json.wording || json)).slice(0, 160)}`)
  }
  const list = json.data && Array.isArray(json.data.messages) ? json.data.messages : []
  return list
}

let selfQQCache = { value: '', at: 0 }

async function getSelfQQ(cfg) {
  if (selfQQCache.value && Date.now() - selfQQCache.at < 10 * 60 * 1000) return selfQQCache.value
  try {
    const json = await napcat(cfg, 'get_login_info', {}, 5000)
    const qq = json && json.data && json.data.user_id ? String(json.data.user_id) : ''
    if (qq) selfQQCache = { value: qq, at: Date.now() }
    return qq
  } catch (error) {
    return selfQQCache.value
  }
}

// ── 下载 ────────────────────────────────────────────────────────────────

/** HTTP 直链 → Buffer（先看 content-length，超限直接放弃，不把 50MB+ 拉进内存） */
async function fetchUrl(url, limitBytes, timeoutMs = 60000) {
  if (!isHttp(url)) throw new Error('不是 http(s) 地址')
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) {} }, timeoutMs)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > limitBytes) {
      try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel() } catch (error) {}
      throw new Error(`太大（${fmtSize(len)}，上限 ${fmtSize(limitBytes)}）`)
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > limitBytes) throw new Error(`太大（${fmtSize(buf.length)}，上限 ${fmtSize(limitBytes)}）`)
    if (!buf.length) throw new Error('下载到的是空文件')
    return buf
  } finally {
    clearTimeout(timer)
  }
}

function readLocalFile(p, limitBytes) {
  try {
    const st = statSync(p)
    if (!st.isFile()) throw new Error('不是文件')
    if (st.size > limitBytes) throw new Error(`太大（${fmtSize(st.size)}，上限 ${fmtSize(limitBytes)}）`)
    const buf = readFileSync(p)
    if (!buf.length) throw new Error('本地缓存是空文件')
    return buf
  } catch (error) {
    if (error && /^(太大|不是文件|本地缓存)/.test(String(error.message))) throw error
    throw new Error('读本地缓存失败：' + errText(error))
  }
}

/** NapCat 的 get_file：文档只认 { file } / { file_id }，返回 { file, url, file_size, file_name, base64 } */
async function viaNapcatGetFile(cfg, meta, binding) {
  const isGroup = String(binding && binding['类型']) === '群'
  const contextual = isGroup ? { group_id: Number(binding['号码']) } : { user_id: Number(binding['号码']) }
  const bodies = []
  if (meta.fileId) {
    bodies.push({ file_id: meta.fileId })
    bodies.push({ file_id: meta.fileId, ...contextual })
  }
  if (meta.fileField) bodies.push({ file: meta.fileField })
  if (meta.name) bodies.push({ file: meta.name })
  if (!bodies.length) throw new Error('段里没有 file_id / url / 文件名，没法问 NapCat 要')

  const tried = []
  for (const body of bodies) {
    let json = null
    try {
      json = await napcat(cfg, 'get_file', body)
    } catch (error) {
      tried.push(errText(error))
      continue
    }
    if (!json || json.status !== 'ok' || json.retcode !== 0 || !json.data) {
      tried.push(String((json && (json.message || json.wording)) || 'NapCat 说取不到').slice(0, 80))
      continue
    }
    const data = json.data || {}
    const url = pickString(data.url)
    if (isHttp(url)) return { buf: await fetchUrl(url, MAX_BYTES), from: 'get_file→直链' }
    const local = pickString(data.file, data.path)
    if (local) {
      const p = /^file:\/\//i.test(local) ? fileUrlToPath(local) : local
      if (p && existsSync(p)) return { buf: readLocalFile(p, MAX_BYTES), from: 'get_file→本地缓存' }
    }
    const b64 = pickString(data.base64)
    if (b64) {
      const buf = Buffer.from(b64.replace(/^data:[^,]*,/, ''), 'base64')
      if (!buf.length) throw new Error('NapCat 返回的 base64 是空的')
      if (buf.length > MAX_BYTES) throw new Error(`太大（${fmtSize(buf.length)}，上限 ${fmtSize(MAX_BYTES)}）`)
      return { buf, from: 'get_file→base64' }
    }
    tried.push('NapCat 返回里没有 url / 本地路径 / base64')
  }
  throw new Error(tried.length ? tried[tried.length - 1] : 'NapCat 取不到这个文件')
}

/**
 * 取一个文件段 → 落盘。永远不抛：失败也返回 { ok:false, reason }，让调用方照实告诉 AI。
 * @returns {{ok:boolean,name:string,bytes?:number,path?:string,reason?:string,from?:string}}
 */
export async function saveOneFile(cfg, seg, msg, binding) {
  const meta = parseFileSeg(seg)
  const label = meta.name || '（没名字的文件）'
  try {
    if (meta.size != null && meta.size > MAX_BYTES) {
      return { ok: false, name: label, reason: `太大（${fmtSize(meta.size)}，上限 ${fmtSize(MAX_BYTES)}）`, tooBig: true }
    }

    let got = null
    const failures = []

    // ① 段里直接给的下载直链
    if (meta.url) {
      try {
        got = { buf: await fetchUrl(meta.url, MAX_BYTES), from: '段内直链' }
      } catch (error) { failures.push('直链：' + errText(error)) }
    }
    // ② NapCat 在本机留的缓存（同一个进程 / 同一台机器）
    if (!got) {
      for (const p of meta.local) {
        try {
          got = { buf: readLocalFile(p, MAX_BYTES), from: '本地缓存' }
          break
        } catch (error) { failures.push('本地缓存：' + errText(error)) }
      }
    }
    // ③ 问 NapCat 要（get_file）
    if (!got) {
      try {
        got = await viaNapcatGetFile(cfg, meta, binding)
      } catch (error) { failures.push('get_file：' + errText(error)) }
    }
    if (!got) {
      return { ok: false, name: label, reason: (failures[0] || '没有可用的下载地址').slice(0, 200) }
    }

    const day = dayFolder(msg && msg.time)
    const dir = ensureDir(join(ROOT, day))
    const target = uniquePath(dir, sanitizeName(meta.name, 'qq-file'))
    writeFileSync(target, got.buf)
    return { ok: true, name: basename(target), bytes: got.buf.length, path: target, from: got.from }
  } catch (error) {
    return { ok: false, name: label, reason: errText(error).slice(0, 200) }
  }
}

// ── 通知文案 ─────────────────────────────────────────────────────────────

function senderName(msg, binding) {
  const isGroup = String((binding && binding['类型']) || '') === '群'
  const s = (msg && msg.sender) || {}
  if (isGroup) return pickString(s.card, s.nickname) || String((binding && binding['称呼']) || '群里的人')
  return String((binding && binding['称呼']) || pickString(s.nickname) || 'ta')
}

/**
 * 例：
 *   （小白发了 1 个文件：模考复盘.pdf，1.2MB，已经存到 C:\...\2026-11-01\模考复盘.pdf，需要就看这个路径）
 *   （小白发了 2 个文件：1. a.pdf，1.2MB，已经存到 <path>；2. b.zip，没取到（太大…）；需要就看这些路径）
 */
export function buildNotice(binding, msg, results) {
  const list = Array.isArray(results) ? results : []
  if (!list.length) return ''
  const who = senderName(msg, binding)
  const n = list.length
  const parts = list.map((r, i) => {
    const prefix = n > 1 ? `${i + 1}. ` : ''
    if (r.ok) return `${prefix}${r.name}，${fmtSize(r.bytes)}，已经存到 ${r.path}`
    return `${prefix}${r.name || '（没名字的文件）'}，没取到（${r.reason || '原因不明'}）`
  })
  const anyOk = list.some((r) => r.ok)
  const tail = anyOk ? (n > 1 ? '，需要就看这些路径' : '，需要就看这个路径') : ''
  return `（${who}发了 ${n} 个文件：${parts.join('；')}${tail}）`
}

// ── 状态（水位 + 已处理 id）────────────────────────────────────────────

export function readState() {
  const j = readJson(STATE_FILE) || {}
  const watermark = (j && typeof j.watermark === 'object' && j.watermark) || {}
  const seen = Array.isArray(j && j.seen) ? j.seen.map(String) : []
  return { watermark, seen }
}

export function writeState(state) {
  try {
    ensureDir(ROOT)
    writeJsonAtomic(STATE_FILE, {
      watermark: state.watermark || {},
      seen: (state.seen || []).slice(-SEEN_MAX),
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    log('状态落盘失败：' + errText(error))
    return false
  }
}

// ── 注入会话 ─────────────────────────────────────────────────────────────

/** 带 / 不带 session- 前缀两个方向都试（跟桥的 找agent 一样） */
function findAgent(ctx, sessionId) {
  const raw = String(sessionId == null ? '' : sessionId).trim()
  if (!raw) return undefined
  const candidates = [raw]
  if (raw.startsWith('session-')) candidates.push(raw.slice('session-'.length))
  else candidates.push('session-' + raw)
  for (const one of candidates) {
    try {
      const a = ctx.agents.get(one)
      if (a !== undefined && a !== null) return a
    } catch (error) { /* 试试下一个 */ }
  }
  return undefined
}

async function injectNotice(ctx, sessionId, text) {
  const agent = findAgent(ctx, sessionId)
  if (!agent) throw new Error(`会话没活着（${String(sessionId).slice(-8)}）`)
  if (typeof agent.followup !== 'function') throw new Error('agent 上没有 followup')
  await agent.followup({
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'qq' },
  })
}

// ── 一轮轮询 ─────────────────────────────────────────────────────────────

function hasFileSeg(msg) {
  const segs = Array.isArray(msg && msg.message) ? msg.message : []
  return segs.some((s) => s && s.type === 'file')
}

const attempts = new Map()      // 消息 id -> 注入失败次数
const downloads = new Map()     // 消息 id -> 已下载好的结果（注入失败重试时别重复下）

function noteDownload(id, results) {
  downloads.set(id, results)
  if (downloads.size > 60) {
    const first = downloads.keys().next()
    if (!first.done) downloads.delete(first.value)
  }
}

export async function pollOnce(ctx, hooks = {}) {
  const cfg = readBridge()
  if (!cfg) return { ok: false, reason: '读不到 qq-bridge-config.json' }
  const bindings = Array.isArray(cfg['绑定']) ? cfg['绑定'] : []
  if (!bindings.length) return { ok: false, reason: '配置里没有绑定' }

  const state = readState()
  const selfQQ = await getSelfQQ(cfg)
  let changed = false
  const summary = { handled: 0, files: 0, errors: [] }

  const localCfg = readLocalConfig()
  for (const binding of bindings) {
    if (!binding || binding['开'] === false) continue
    const isGroup = String(binding['类型'] || '') === '群'
    if (localCfg.只处理私聊 && isGroup) continue   // 群里的文件不碰
    const target = String(binding['号码'] || '').trim()
    const session = String(binding['会话'] || '').trim()
    if (!target || !session) continue
    // 可选：只收某个 QQ 发来的文件
    if (localCfg.只收某个QQ发的 && target !== localCfg.只收某个QQ发的) continue
    const key = `${isGroup ? '群' : '私聊'}:${target}`

    try {
      const nowSec = Math.floor(Date.now() / 1000)
      if (state.watermark[key] == null) {
        state.watermark[key] = nowSec
        changed = true
        log(`${key}：第一次跑，水位从此刻算起（${nowSec}），更早的文件不补`)
        continue
      }
      const watermark = Number(state.watermark[key]) || 0

      const history = await fetchHistory(cfg, isGroup, target)
      if (!history.length) continue

      let maxTime = watermark
      const fresh = []
      for (const msg of history) {
        if (!msg) continue
        const t = Number(msg.time) || 0
        if (t > maxTime) maxTime = t
        if (t < watermark) continue
        const id = String(msg.message_id != null ? msg.message_id : '')
        if (!id || state.seen.includes(id)) continue
        if (selfQQ && String(msg.user_id || '') === selfQQ) continue   // 她自己发出去的文件不管
        if (!hasFileSeg(msg)) continue
        fresh.push(msg)
      }

      let sent = 0
      let lastHandledTime = watermark   // 只有「真的处理完」的消息才允许把水位推过它，否则积压的会被永久跳过
      let blocked = false              // 一条暂时失败的，后面的先别插队（顺序 + 别让水位越过它）
      for (const msg of fresh.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))) {
        if (sent >= MAX_MSGS_PER_TICK) {
          log(`${key}：这一跳已经处理 ${sent} 条，剩下的下一跳继续`)
          blocked = true
          break
        }
        const id = String(msg.message_id)
        let results = downloads.get(id)
        if (!results) {
          results = []
          const segs = (Array.isArray(msg.message) ? msg.message : []).filter((s) => s && s.type === 'file')
          for (const seg of segs.slice(0, MAX_FILES_PER_MSG)) {
            results.push(await saveOneFile(cfg, seg, msg, binding))
          }
          noteDownload(id, results)
        }
        const notice = buildNotice(binding, msg, results)
        if (!notice) {
          state.seen.push(id)
          changed = true
          lastHandledTime = Math.max(lastHandledTime, Number(msg.time) || 0)
          continue
        }

        try {
          if (hooks.inject) await hooks.inject(session, notice)
          else await injectNotice(ctx, session, notice)
          state.seen.push(id)
          changed = true
          attempts.delete(id)
          downloads.delete(id)
          sent += 1
          lastHandledTime = Math.max(lastHandledTime, Number(msg.time) || 0)
          summary.handled += 1
          summary.files += results.filter((r) => r.ok).length
          const okCount = results.filter((r) => r.ok).length
          log(`${key}：${senderName(msg, binding)} 的文件 ${okCount}/${results.length} 个取到 → 已注入 ${String(session).slice(-8)}：${results.map((r) => (r.ok ? r.path : `${r.name} 没取到（${r.reason}）`)).join(' | ')}`)
        } catch (error) {
          const msgText = errText(error)
          const n = (attempts.get(id) || 0) + 1
          attempts.set(id, n)
          // 会话暂时取不到（重载 / 没开着）不算真错，多等几分钟；别的错误重试几次就放弃
          const maxTries = msgText.includes('没活着') ? MAX_INJECT_TRIES_AGENT : MAX_INJECT_TRIES
          if (n >= maxTries) {
            state.seen.push(id)
            changed = true
            attempts.delete(id)
            downloads.delete(id)
            lastHandledTime = Math.max(lastHandledTime, Number(msg.time) || 0)
            log(`${key}：消息 ${id} 注入失败 ${n} 次，放弃（${msgText}）`)
          } else {
            log(`${key}：消息 ${id} 注入失败（第 ${n} 次，下一跳再试）：${msgText}`)
            blocked = true
            break
          }
          summary.errors.push(msgText)
        }
      }

      // blocked：只把水位推到「确实处理完的那条」，剩下的下一跳重来（绝不能被新水位吞掉）
      const nextWatermark = blocked ? lastHandledTime : Math.max(lastHandledTime, maxTime)
      if (nextWatermark > watermark) {
        state.watermark[key] = nextWatermark
        changed = true
      }
    } catch (error) {
      const text = errText(error)
      summary.errors.push(`${key}：${text}`)
      log(`${key}：这一跳出错（不影响别的聊天，下一跳照常）：${text}`)
    }
  }

  if (changed) writeState(state)
  return { ok: true, ...summary }
}

// ── 插件入口 ─────────────────────────────────────────────────────────────

export function apply(ctx) {
  let polling = false

  const tick = () => {
    if (polling) return
    polling = true
    Promise.resolve()
      .then(() => pollOnce(ctx))
      .then((r) => {
        if (r && r.ok === false && r.reason) log('轮询跳过：' + r.reason)
      })
      .catch((error) => {
        log('轮询整体出错（插件照常活着，下一跳照常）：' + errText(error))
      })
      .finally(() => { polling = false })
  }

  ctx.effect(() => {
    ensureDir(ROOT)
    log(`已加载 v0.1.0：每 ${POLL_MS / 1000} 秒看一眼 NapCat 的新消息，只捞 file 段｜落点 ${ROOT}｜上限 ${fmtSize(MAX_BYTES)}`)

    let stopInterval = null
    let kick = null
    try {
      if (typeof ctx.interval === 'function') {
        stopInterval = ctx.interval(tick, POLL_MS)
      } else if (typeof setInterval === 'function') {
        const handle = setInterval(tick, POLL_MS)
        if (typeof handle.unref === 'function') handle.unref()
        stopInterval = () => { try { clearInterval(handle) } catch (error) {} }
      } else {
        log('拿不到定时器（ctx.interval / setInterval 都没有）—— 文件轮询跑不起来')
      }
    } catch (error) {
      log('排定时器失败：' + errText(error))
    }

    // 起来先跑一跳，不用等满 5 秒
    try {
      if (typeof ctx.timeout === 'function') kick = ctx.timeout(tick, 1200)
      else if (typeof setTimeout === 'function') { const h = setTimeout(tick, 1200); if (h && typeof h.unref === 'function') h.unref() }
    } catch (error) { /* 晚 5 秒也无所谓 */ }

    return () => {
      try { if (typeof kick === 'function') kick() } catch (error) {}
      try { if (typeof stopInterval === 'function') stopInterval() } catch (error) {}
      try { writeState(readState()) } catch (error) {}
      log('已卸载（定时器都收掉了）')
    }
  }, 'dsh-ayy-files: 轮询 QQ 文件')
}

// ── 自测钩子（不改行为，只暴露纯函数给 harness 用）────────────────────
export const __test = {
  ROOT, MAX_BYTES, sanitizeName, uniquePath, fmtSize, parseFileSeg, buildNotice,
  saveOneFile, readState, writeState, hasFileSeg, findAgent, pollOnce, dayFolder,
}

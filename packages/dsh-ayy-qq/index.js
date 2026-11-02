/**
 * dsh-ayy-qq —— 安源悦 · QQ 三合一（收文件 + 通知中继 + 谁在说话）
 *
 * 这个包合并了两个老插件，行为保留：
 *
 *   ① dsh-ayy-files（QQ 收文件）
 *      QQ 桥只认文字/图片/语音，**file 段整条被丢掉**。所以这里自己按 timer 轮询
 *      NapCat 的 get_friend_msg_history / get_group_msg_history，只捞 type === 'file'，
 *      走段内直链 / 本地缓存 / get_file 兜底下载，存到 <DSH_HOME>/ayy-files/<日期>/，
 *      再用 ctx.agents.get(会话).followup(...) 告诉她「谁发了什么、落在哪」。
 *      开关：~/.dsh/ayy-files/config.json（只处理私聊 / 只收某个QQ发的）。
 *      状态/日志：~/.dsh/ayy-files/state.json、~/.dsh/ayy-files/files.log。
 *
 *   ② dsh-ayy-notice（QQ 通知中继）
 *      戳一戳/撤回/进退群不是消息，轮询历史永远看不到。所以这里起一个固定端口的
 *      HTTP 中继（默认 127.0.0.1:9898，端口/口令在 ~/.dsh/ayy-notice/config.json），
 *      只认 post_type === 'notice'，解析后用 followup 注入一句。
 *      日志：~/.dsh/ayy-notice/notice.log。
 *
 *   ③ 新增「谁在说话」共享记录 → <DSH_HOME>/qq-speaker.json
 *      每收到一条入站事件（文件/戳一戳/撤回/群成员变动），就把「这个会话里最近是谁在说话」
 *      记下来：{ "session-xxx": { "昵称", "QQ", "时间", "来源" } }。
 *      只留最近 100 个会话；读 → 合并 → 原子写；写失败只记日志，绝不影响主流程。
 *      ⚠️ 不挂「接收普通消息」的钩子：普通消息归 QQ 桥，我们没有那条通路。
 *
 * 铁律：
 *   · inject 只写真实存在、且这个插件真的用到的服务（agents / timer）。
 *   · 任何异常都 try/catch 吃掉 + 写日志，绝不抛出去把插件（甚至宿主）搞挂。
 *   · 老路径继续读：用户已有的配置/日志不会因为合并而失效。
 */
import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, statSync,
} from 'node:fs'
import { join, dirname, basename, isAbsolute, extname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

export const name = 'dsh-ayy-qq'
/** 只写真实存在的服务：agents（往会话注消息）+ timer（轮询文件）。写错会让整个 preset 消失。 */
export const inject = ['agents', 'timer']

// ── 路径 ────────────────────────────────────────────────────────────────────
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const BRIDGE_CFG = process.env.AYY_NOTICE_BRIDGE || join(DSH_HOME, 'qq-bridge-config.json')

// 老路径（必须继续用：用户已有的配置/日志都在这里）
const FILES_ROOT = join(DSH_HOME, 'ayy-files')
const FILES_CONFIG = join(FILES_ROOT, 'config.json')
const FILES_STATE = join(FILES_ROOT, 'state.json')
const FILES_LOG = join(FILES_ROOT, 'files.log')

const NOTICE_ROOT = process.env.AYY_NOTICE_HOME || join(DSH_HOME, 'ayy-notice')
const NOTICE_CONFIG = join(NOTICE_ROOT, 'config.json')
const NOTICE_LOG = join(NOTICE_ROOT, 'notice.log')

// 合并后新的东西放这里（目前只有合并日志）
const QQ_ROOT = process.env.AYY_QQ_HOME || join(DSH_HOME, 'ayy-qq')
const QQ_LOG = join(QQ_ROOT, 'qq.log')

// 「谁在说话」共享记录
const SPEAKER_FILE = join(DSH_HOME, 'qq-speaker.json')
const SPEAKER_MAX = 100                // 只留最近 100 个会话

// ── 常量 ────────────────────────────────────────────────────────────────────
const LOG_MAX_BYTES = 2 * 1024 * 1024

// 收文件
const MAX_BYTES = 50 * 1024 * 1024     // 单文件上限 50MB
const POLL_MS = 5000                   // 轮询间隔
const COUNT_FRIEND = 20                // 私聊一次拉多少条
const COUNT_GROUP = 30                 // 群一次拉多少条
const MAX_MSGS_PER_TICK = 5            // 一跳最多处理几条带文件的消息（防刷）
const MAX_FILES_PER_MSG = 6            // 一条消息最多取几个文件
const MAX_INJECT_TRIES = 3             // 注入会话失败重试几次后放弃（普通错误）
const MAX_INJECT_TRIES_AGENT = 36      // 会话没活着时多等一会儿（5 秒一跳 ≈ 3 分钟）
const SEEN_MAX = 800                   // 记住多少个已处理的文件消息 id
const NAPCAT_TIMEOUT_MS = 12000

// 通知中继
const DEFAULT_PORT = Number(process.env.AYY_NOTICE_PORT) || 9898
const LISTEN_HOST = '127.0.0.1'
const BODY_MAX_BYTES = 256 * 1024      // 一条 notice 撑死几 KB，256KB 是保险丝
const DEDUP_MS = 10 * 1000             // 同一件事 10 秒内只处理一次
const DEDUP_PRUNE = 200                // 去重表最多记多少条
const NICK_TTL_MS = 30 * 60 * 1000     // 昵称缓存 30 分钟
const BRIDGE_TTL_MS = 15 * 1000        // 绑定配置缓存 15 秒（改配置不用重启）
const NOTICE_TIMEOUT_MS = 6000
const DEFAULT_TRIES = 5                // 注入失败重试次数
const DEFAULT_GAP_MS = 5000            // 重试间隔

// ── 小工具 ──────────────────────────────────────────────────────────────────
function errText(error) {
  return String((error && error.message) || error || '原因不明')
}

function p2(n) {
  return String(n).padStart(2, '0')
}

/** 「2026-11-02 16:30」/「2026-11-02 16:30:05」 */
function fmtStamp(d = new Date(), seconds = false) {
  const base = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
  return seconds ? `${base}:${p2(d.getSeconds())}` : base
}

function sleep(ms) {
  return new Promise((resolve) => {
    try {
      const h = setTimeout(resolve, Math.max(0, Number(ms) || 0))
      if (h && typeof h.unref === 'function') h.unref()
    } catch (error) { resolve() }
  })
}

function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, Number(ms) || 0))
  } catch (error) { /* 极端环境下退化成不睡 */ }
}

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

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch (error) { /* existsSync 兜底 */ }
  return dir
}

// ── 日志 ────────────────────────────────────────────────────────────────────
// 老路径一份不少：文件写 ayy-files/files.log，通知写 ayy-notice/notice.log，
// 合并插件自己的加载/说话人日志写 ayy-qq/qq.log。

function rotateLog(file) {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < LOG_MAX_BYTES) return
    renameSync(file, file + '.1')
  } catch (error) { /* 转不动就算了，接着往下写 */ }
}

function makeLogger(file, tag) {
  let ready = false
  return function log(line) {
    try {
      if (!ready) { ready = true; mkdirSync(dirname(file), { recursive: true }); rotateLog(file) }
      appendFileSync(file, `[${fmtStamp(new Date(), true)}] ${line}\n`, 'utf8')
    } catch (error) { /* 日志写不了也不能影响主流程 */ }
    try { console.log(tag + ' ' + line) } catch (error) { /* ignore */ }
  }
}

const logFiles = makeLogger(FILES_LOG, '[dsh-ayy-qq/files]')
const logNotice = makeLogger(NOTICE_LOG, '[dsh-ayy-qq/notice]')
const logQQ = makeLogger(QQ_LOG, '[dsh-ayy-qq]')

// ── JSON 读写 ───────────────────────────────────────────────────────────────
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return null
  }
}

/** 原子写：先写唯一临时文件，再 rename 覆盖（Windows 上 rename 偶尔被占用，重试几次）。 */
function writeJsonAtomic(file, value) {
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  let last = null
  for (let i = 0; i < 4; i++) {
    try { renameSync(tmp, file); return true } catch (error) {
      last = error
      sleepSync(15 + i * 15)
    }
  }
  try { if (existsSync(tmp)) { /* 留着也没关系 */ } } catch (error) { /* ignore */ }
  throw last || new Error('重命名失败')
}

// ── 桥配置 / 绑定 / 会话名（两处共用的一份解析）────────────────────────────
let bridgeCache = { at: 0, cfg: null }

/** 读 qq-bridge-config.json；缓存 15 秒（改绑定不用重启）。 */
export function bridgeConfig() {
  if (bridgeCache.cfg && Date.now() - bridgeCache.at < BRIDGE_TTL_MS) return bridgeCache.cfg
  const cfg = readJson(BRIDGE_CFG)
  const value = cfg && typeof cfg === 'object' ? cfg : null
  bridgeCache = { at: Date.now(), cfg: value }
  return value
}

function napcatBase(bridge) {
  return String((bridge && bridge['NapCat']) || 'http://127.0.0.1:3000').replace(/\/+$/, '')
}

async function napcatCall(bridge, action, body, timeoutMs = NAPCAT_TIMEOUT_MS) {
  const headers = { 'content-type': 'application/json', 'user-agent': 'dsh-ayy-qq' }
  const token = String((bridge && bridge['令牌']) || '').trim()
  if (token) headers.authorization = 'Bearer ' + token
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) { /* ignore */ } }, timeoutMs)
  try {
    const res = await fetch(`${napcatBase(bridge)}/${action}`, {
      method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctl.signal,
    })
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch (error) {
      throw new Error(`NapCat ${action} 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 160)}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function napcatOk(bridge, action, body, timeoutMs = NOTICE_TIMEOUT_MS) {
  const json = await napcatCall(bridge, action, body, timeoutMs)
  if (!json || json.status !== 'ok' || json.retcode !== 0) {
    throw new Error(`NapCat ${action} 不 ok：${String((json && (json.message || json.wording)) || '原因不明').slice(0, 120)}`)
  }
  return (json && json.data) || {}
}

/** 找绑定：私聊按对方 QQ，群按群号。找不到返回 null。 */
export function findBinding(bridge, kind, number) {
  const list = Array.isArray(bridge && bridge['绑定']) ? bridge['绑定'] : []
  const want = String(number == null ? '' : number).trim()
  if (!want) return null
  const wanted = kind === 'group' ? '群' : '私聊'
  for (const one of list) {
    if (!one || typeof one !== 'object') continue
    if (String(one['类型'] || '') !== wanted) continue
    if (String(one['号码'] || '').trim() !== want) continue
    if (one['开'] === false) continue
    return one
  }
  return null
}

/** 会话 id → 绑定（两处共用）。 */
export function findBindingBySession(bridge, sessionId) {
  const want = String(sessionId == null ? '' : sessionId).trim()
  if (!want) return null
  const list = Array.isArray(bridge && bridge['绑定']) ? bridge['绑定'] : []
  for (const one of list) {
    if (!one || typeof one !== 'object') continue
    if (one['开'] === false) continue
    if (String(one['会话'] || '').trim() === want) return one
  }
  return null
}

/** 绑定的「人话名字」：私聊 → 称呼；群 → 群号（有称呼就带上）。 */
export function bindingLabel(binding) {
  if (!binding || typeof binding !== 'object') return ''
  const kind = String(binding['类型'] || '')
  const number = String(binding['号码'] || '').trim()
  const name = String(binding['称呼'] || '').trim()
  if (kind === '群') return number ? `群 ${number}${name ? '（' + name + '）' : ''}` : name || '群'
  return name || (number ? `私聊 ${number}` : '私聊')
}

/**
 * 会话 id → 人看得懂的名字（两处共用：文件注入日志 / 通知注入日志）。
 * 找不到绑定就退化成 session 的尾巴，绝不返回空。
 */
export function sessionName(bridge, sessionId) {
  const raw = String(sessionId == null ? '' : sessionId).trim()
  if (!raw) return '（没有会话）'
  const binding = findBindingBySession(bridge, raw)
  return bindingLabel(binding) || `会话 ${raw.slice(-8)}`
}

// ── 昵称 ────────────────────────────────────────────────────────────────────
//
// notice 事件里一般没有昵称（poke 只有 QQ 号）。顺序：
//   群  ：sender.card / sender.nickname → NapCat get_group_member_info → 群号/QQ 号
//   私聊：绑定里的「称呼」（就是她习惯叫的那个）→ sender.nickname → get_stranger_info → QQ 号
const nickCache = new Map()

function cachedNick(key) {
  const hit = nickCache.get(key)
  if (!hit) return ''
  if (Date.now() - hit.at > NICK_TTL_MS) { nickCache.delete(key); return '' }
  return hit.name
}

function saveNick(key, name) {
  if (!name) return
  nickCache.set(key, { name, at: Date.now() })
  if (nickCache.size > 500) {
    const first = nickCache.keys().next()
    if (!first.done) nickCache.delete(first.value)
  }
}

async function napcatNick(bridge, isGroup, groupId, userId) {
  const uid = String(userId == null ? '' : userId).trim()
  if (!uid) return ''
  const key = `${isGroup ? 'g:' + groupId : 'f'}${uid}`
  const hit = cachedNick(key)
  if (hit) return hit
  if (!bridge) return ''
  try {
    const data = isGroup
      ? await napcatOk(bridge, 'get_group_member_info', { group_id: Number(groupId), user_id: Number(uid) })
      : await napcatOk(bridge, 'get_stranger_info', { user_id: Number(uid) })
    const name = pickString(data.card, data.nickname, data.remark)
    if (name) saveNick(key, name)
    return name
  } catch (error) {
    logNotice(`查昵称失败（${key}，用号码代替）：${errText(error)}`)
    return ''
  }
}

// ── 谁在说话（共享记录）───────────────────────────────────────────────────
//
// 结构：{ "session-xxx": { "昵称": "锤子", "QQ": "1610827876", "时间": "2026-11-02 16:30", "来源": "戳一戳" } }
// 来源只有：文件 / 戳一戳 / 撤回 / 群成员变动（「消息」留给 QQ 桥，这里不写）。
//
// 并发：读 → 合并 → 写 全在一个同步函数里完成，中间没有 await，
// 同一个进程里多个事件（文件轮询 / HTTP 通知）不可能交错写坏；
// 落盘用唯一临时文件 + rename 原子替换。

export function readSpeaker() {
  const j = readJson(SPEAKER_FILE)
  return j && typeof j === 'object' && !Array.isArray(j) ? j : {}
}

function writeSpeaker(map) {
  const entries = Object.entries(map || {}).filter(([, v]) => v && typeof v === 'object')
  let kept = entries
  if (entries.length > SPEAKER_MAX) {
    kept = entries
      .slice()
      .sort((a, b) => String((b[1] && b[1]['时间']) || '').localeCompare(String((a[1] && a[1]['时间']) || '')))
      .slice(0, SPEAKER_MAX)
  }
  const out = {}
  for (const [k, v] of kept) out[k] = v
  writeJsonAtomic(SPEAKER_FILE, out)
  return out
}

/**
 * 记一条「谁在说话」。永远不抛。
 * @param {{会话?:string, 昵称?:string, QQ?:string|number, 来源?:string}} entry
 * @returns {boolean} 真的写成功没有
 */
export function recordSpeaker(entry) {
  try {
    const session = String((entry && entry['会话']) || '').trim()
    if (!session) return false
    const qq = String(entry && entry.QQ != null ? entry.QQ : '').trim()
    const name = String((entry && entry['昵称']) || '').trim()
    const source = String((entry && entry['来源']) || '消息').trim() || '消息'

    const existing = readSpeaker()
    const prev = existing[session] && typeof existing[session] === 'object' ? existing[session] : {}
    const next = {}
    const finalName = name || String(prev['昵称'] || '').trim()
    if (finalName) next['昵称'] = finalName       // 取不到昵称就只写 QQ 号
    next.QQ = qq || String(prev.QQ || '').trim()
    next['时间'] = fmtStamp(new Date())
    next['来源'] = source

    writeSpeaker({ ...existing, [session]: next })
    return true
  } catch (error) {
    try { logQQ('记录「谁在说话」失败（不影响主流程）：' + errText(error)) } catch (e) { /* ignore */ }
    return false
  }
}

// ── 文件：解析 file 段 ──────────────────────────────────────────────────────
//
// NapCat 的 file 段（OB11MessageFile → FileBaseData）文档字段：
//   { type: 'file', data: { file, path, url, name, thumb } }
// 实测还有些版本额外带 file_id / file_size。所有字段名都宽松地认一遍。

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
export function uniquePath(dir, safeName) {
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

export function dayFolder(unixSeconds) {
  let d = new Date()
  const t = Number(unixSeconds)
  if (Number.isFinite(t) && t > 0) d = new Date(t * 1000)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
}

export function fmtSize(bytes) {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n < 0) return '大小未知'
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
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

// ── 文件：下载 ──────────────────────────────────────────────────────────────

/** HTTP 直链 → Buffer（先看 content-length，超限直接放弃，不把 50MB+ 拉进内存） */
async function fetchUrl(url, limitBytes, timeoutMs = 60000) {
  if (!isHttp(url)) throw new Error('不是 http(s) 地址')
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) { /* ignore */ } }, timeoutMs)
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal })
    if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`)
    const len = Number(res.headers.get('content-length') || 0)
    if (len && len > limitBytes) {
      try { if (res.body && typeof res.body.cancel === 'function') await res.body.cancel() } catch (error) { /* ignore */ }
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
      json = await napcatCall(cfg, 'get_file', body)
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
    const dir = ensureDir(join(FILES_ROOT, day))
    const target = uniquePath(dir, sanitizeName(meta.name, 'qq-file'))
    writeFileSync(target, got.buf)
    return { ok: true, name: basename(target), bytes: got.buf.length, path: target, from: got.from }
  } catch (error) {
    return { ok: false, name: label, reason: errText(error).slice(0, 200) }
  }
}

// ── 文件：通知文案 ──────────────────────────────────────────────────────────

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

// ── 文件：状态（水位 + 已处理 id）──────────────────────────────────────────

export function readState() {
  const j = readJson(FILES_STATE) || {}
  const watermark = (j && typeof j.watermark === 'object' && j.watermark) || {}
  const seen = Array.isArray(j && j.seen) ? j.seen.map(String) : []
  return { watermark, seen }
}

export function writeState(state) {
  try {
    ensureDir(FILES_ROOT)
    writeJsonAtomic(FILES_STATE, {
      watermark: state.watermark || {},
      seen: (state.seen || []).slice(-SEEN_MAX),
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (error) {
    logFiles('状态落盘失败：' + errText(error))
    return false
  }
}

// ── 文件：开关（每次轮询现读，改文件即可生效，不用重启）────────────────────
// 默认只处理私聊：群里别人发的文件不下载、不打断她。
function readFilesConfig() {
  const fallback = { 只处理私聊: true, 只收某个QQ发的: '' }
  try {
    if (!existsSync(FILES_CONFIG)) return fallback
    const raw = JSON.parse(readFileSync(FILES_CONFIG, 'utf8').replace(/^\uFEFF/, ''))
    return {
      只处理私聊: raw['只处理私聊'] !== false,
      只收某个QQ发的: String(raw['只收某个QQ发的'] || '').trim(),
    }
  } catch (error) {
    return fallback
  }
}

// ── 文件：读历史 / 自己 QQ ──────────────────────────────────────────────────

async function fetchHistory(cfg, isGroup, target) {
  const action = isGroup ? 'get_group_msg_history' : 'get_friend_msg_history'
  const body = isGroup
    ? { group_id: Number(target), count: COUNT_GROUP }
    : { user_id: Number(target), count: COUNT_FRIEND }
  const json = await napcatCall(cfg, action, body)
  if (!json || json.status !== 'ok' || json.retcode !== 0) {
    throw new Error(`取历史失败：${JSON.stringify(json && (json.message || json.wording || json)).slice(0, 160)}`)
  }
  return json.data && Array.isArray(json.data.messages) ? json.data.messages : []
}

let selfQQCache = { value: '', at: 0 }

async function getSelfQQ(cfg) {
  if (selfQQCache.value && Date.now() - selfQQCache.at < 10 * 60 * 1000) return selfQQCache.value
  try {
    const json = await napcatCall(cfg, 'get_login_info', {}, 5000)
    const qq = json && json.data && json.data.user_id ? String(json.data.user_id) : ''
    if (qq) selfQQCache = { value: qq, at: Date.now() }
    return qq
  } catch (error) {
    return selfQQCache.value
  }
}

// ── 注入会话（两处共用）─────────────────────────────────────────────────────

/** 带 / 不带 session- 前缀两个方向都试（跟桥的 找agent 一样） */
export function findAgent(ctx, sessionId) {
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

async function injectFollowup(ctx, sessionId, text) {
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

// ── 文件：一轮轮询 ─────────────────────────────────────────────────────────

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

/** 文件事件的发送者 → 说话人记录（群看群名片，私聊看绑定称呼；都没有就只记 QQ）。 */
function noteFileSpeaker(binding, msg, session) {
  if (!session) return
  const isGroup = String((binding && binding['类型']) || '') === '群'
  const s = (msg && msg.sender) || {}
  const qq = String((msg && msg.user_id) || (binding && binding['号码']) || '').trim()
  const name = isGroup
    ? pickString(s.card, s.nickname)
    : (String((binding && binding['称呼']) || '').trim() || pickString(s.nickname))
  recordSpeaker({ 会话: session, 昵称: name, QQ: qq, 来源: '文件' })
}

export async function pollOnce(ctx, hooks = {}) {
  const cfg = bridgeConfig()
  if (!cfg) return { ok: false, reason: '读不到 qq-bridge-config.json' }
  const bindings = Array.isArray(cfg['绑定']) ? cfg['绑定'] : []
  if (!bindings.length) return { ok: false, reason: '配置里没有绑定' }

  const state = readState()
  const selfQQ = await getSelfQQ(cfg)
  let changed = false
  const summary = { handled: 0, files: 0, errors: [] }

  const localCfg = readFilesConfig()
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
        logFiles(`${key}：第一次跑，水位从此刻算起（${nowSec}），更早的文件不补`)
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
      let blocked = false               // 一条暂时失败的，后面的先别插队（顺序 + 别让水位越过它）
      for (const msg of fresh.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))) {
        if (sent >= MAX_MSGS_PER_TICK) {
          logFiles(`${key}：这一跳已经处理 ${sent} 条，剩下的下一跳继续`)
          blocked = true
          break
        }
        const id = String(msg.message_id)
        // 收到了就算一条入站事件：先记「谁在说话」，下载成功与否不影响这条记录
        noteFileSpeaker(binding, msg, session)
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
          else await injectFollowup(ctx, session, notice)
          state.seen.push(id)
          changed = true
          attempts.delete(id)
          downloads.delete(id)
          sent += 1
          lastHandledTime = Math.max(lastHandledTime, Number(msg.time) || 0)
          summary.handled += 1
          summary.files += results.filter((r) => r.ok).length
          const okCount = results.filter((r) => r.ok).length
          logFiles(`${key}：${senderName(msg, binding)} 的文件 ${okCount}/${results.length} 个取到 → 已注入 ${sessionName(cfg, session)}：${results.map((r) => (r.ok ? r.path : `${r.name} 没取到（${r.reason}）`)).join(' | ')}`)
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
            logFiles(`${key}：消息 ${id} 注入失败 ${n} 次，放弃（${msgText}）`)
          } else {
            logFiles(`${key}：消息 ${id} 注入失败（第 ${n} 次，下一跳再试）：${msgText}`)
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
      logFiles(`${key}：这一跳出错（不影响别的聊天，下一跳照常）：${text}`)
    }
  }

  if (changed) writeState(state)
  return { ok: true, ...summary }
}

// ── 通知：配置 ─────────────────────────────────────────────────────────────
//
// <DSH_HOME>/ayy-notice/config.json：
// {
//   "port": 9898,
//   "token": "<首次运行随机生成>",
//   "重试次数": 5,
//   "重试间隔毫秒": 5000,
//   "测试会话": ""
// }
//
// 「测试会话」留空 = 正常按绑定投递；填了会话 id = 所有通知都投到那个会话（自测用，别在生产开着）。
// 老文件原样读、原样回写，用户已经配好的端口和口令不会丢。

export function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const port = Math.trunc(Number(src.port))
  const tries = Math.trunc(Number(src['重试次数']))
  const gap = Math.trunc(Number(src['重试间隔毫秒']))
  return {
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT,
    token: String(src.token == null ? '' : src.token).trim(),
    tries: Number.isFinite(tries) && tries >= 1 && tries <= 20 ? tries : DEFAULT_TRIES,
    gapMs: Number.isFinite(gap) && gap >= 0 && gap <= 120000 ? gap : DEFAULT_GAP_MS,
    testSession: String(src['测试会话'] == null ? '' : src['测试会话']).trim(),
  }
}

/** 读配置；第一次跑（或 token 空着）就生成一个随机口令写回去。 */
export function readConfig() {
  try { mkdirSync(NOTICE_ROOT, { recursive: true }) } catch (error) { /* 建不了目录下面还会试 */ }
  const raw = readJson(NOTICE_CONFIG)
  if (raw && typeof raw === 'object' && String(raw.token || '').trim()) return normalizeConfig(raw)

  const next = { ...(raw && typeof raw === 'object' ? raw : {}) }
  next.port = Number.isFinite(Number(next.port)) && Number(next.port) > 0 ? Number(next.port) : DEFAULT_PORT
  next.token = randomBytes(12).toString('hex')
  if (next['重试次数'] == null) next['重试次数'] = DEFAULT_TRIES
  if (next['重试间隔毫秒'] == null) next['重试间隔毫秒'] = DEFAULT_GAP_MS
  if (next['测试会话'] == null) next['测试会话'] = ''
  try {
    writeFileSync(NOTICE_CONFIG, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    logNotice('配置文件写不了（口令只用这次）：' + errText(error))
  }
  return normalizeConfig(next)
}

// ── 通知：解析 ─────────────────────────────────────────────────────────────
//
// NapCat（OneBot 11）真实结构：
//   戳一戳：post_type='notice', notice_type='notify', sub_type='poke',
//            user_id / target_id / sender_id（私聊）、group_id（群）
//           ⚠️ 不是 notice_type='poke'。老版本 / 别的实现可能是 'poke'，两种都认。
//   撤回  ：notice_type='friend_recall'（user_id, message_id）
//           notice_type='group_recall'（group_id, user_id, operator_id, message_id）
//   进退群：notice_type='group_increase' / 'group_decrease'（group_id, user_id, operator_id, sub_type）

export function noticeKind(ev) {
  const nt = String((ev && ev.notice_type) || '')
  const sub = String((ev && ev.sub_type) || '')
  if (nt === 'poke') return 'poke'
  if (nt === 'notify' && sub === 'poke') return 'poke'
  if (nt === 'friend_recall') return 'friend_recall'
  if (nt === 'group_recall') return 'group_recall'
  if (nt === 'group_increase') return 'group_increase'
  if (nt === 'group_decrease') return 'group_decrease'
  return ''
}

/** 事件里能直接拿到的昵称（有就省一次 NapCat 查询） */
export function inlineNick(ev) {
  const s = (ev && ev.sender) || {}
  return pickString(s.card, s.nickname, ev && ev.nickname)
}

/**
 * 戳一戳里「谁戳的」。
 * 私聊：一定是对方（自聊不存在）→ 优先 user_id（NapCat 私聊 poke 的 user_id 就是对方）。
 * 群聊：user_id = 戳人的人、target_id = 被戳的人；target 不是自己就不是戳她，跳过。
 * @returns {{ actor:number, skip?:string }}
 */
export function pokeActor(ev, isGroup) {
  const self = Number(ev && ev.self_id) || 0
  const user = Number(ev && ev.user_id) || 0
  const sender = Number(ev && ev.sender_id) || 0
  const target = Number(ev && ev.target_id) || 0

  if (!isGroup) {
    if (self && user === self) {
      // 极少数实现把 user_id 写成自己，那对方只可能在 target / sender 里
      const other = [sender, target].find((v) => v && v !== self) || 0
      return { actor: other }
    }
    return { actor: user || sender || target }
  }

  if (self && target && target !== self) return { actor: 0, skip: '戳的不是她' }
  if (self && !target && user === self) return { actor: 0, skip: '她自己戳的' }
  const actor = (user && user !== self) ? user
    : (sender && sender !== self) ? sender
      : (target && target !== self) ? target : 0
  return { actor }
}

/**
 * 一句给人看的通知。纯函数，自测直接断言。
 *   （小白戳了戳你）
 *   （群里 锤子 戳了戳你）
 *   （小白撤回了一条消息）
 *   （群里 锤子 撤回了一条消息）
 *   （群里 某人 进群了）
 *   （群里 某人 退群了）
 */
export function buildText(kind, isGroup, who) {
  const name = String(who == null ? '' : who).trim() || '有人'
  switch (kind) {
    case 'poke':
      return isGroup ? `（群里 ${name} 戳了戳你）` : `（${name}戳了戳你）`
    case 'friend_recall':
    case 'group_recall':
      return isGroup ? `（群里 ${name} 撤回了一条消息）` : `（${name}撤回了一条消息）`
    case 'group_increase':
      return `（群里 ${name} 进群了）`
    case 'group_decrease':
      return `（群里 ${name} 退群了）`
    default:
      return ''
  }
}

/** notice 事件类型 → 「谁在说话」里的来源文案 */
export function speakerSource(kind) {
  switch (kind) {
    case 'poke': return '戳一戳'
    case 'friend_recall':
    case 'group_recall': return '撤回'
    case 'group_increase':
    case 'group_decrease': return '群成员变动'
    default: return ''
  }
}

// ── 通知：去重 ─────────────────────────────────────────────────────────────
//
// NapCat 有时候同一条通知会报两遍（重连 / 多通道）。key = time + notice_type + sub_type + group_id + user_id，
// 10 秒内只处理一次。

const dedup = new Map()

export function dedupKey(ev) {
  const t = Math.trunc(Number(ev && ev.time) || 0)
  const nt = String((ev && ev.notice_type) || '')
  const sub = String((ev && ev.sub_type) || '')
  const user = String((ev && ev.user_id) || '')
  const group = String((ev && ev.group_id) || '')
  return `${t}|${nt}|${sub}|${group}|${user}`
}

function isDuplicate(key) {
  const now = Date.now()
  const last = dedup.get(key)
  if (last && now - last < DEDUP_MS) return true
  dedup.set(key, now)
  if (dedup.size > DEDUP_PRUNE) {
    for (const [k, at] of dedup) {
      if (now - at >= DEDUP_MS) dedup.delete(k)
      if (dedup.size <= DEDUP_PRUNE / 2) break
    }
  }
  return false
}

// ── 通知：注入 ─────────────────────────────────────────────────────────────

/** 注入一句话，失败重试。永远不抛；成功返回 true。 */
export async function deliver(ctx, sessionId, text, cfg) {
  const tries = (cfg && cfg.tries) || DEFAULT_TRIES
  const gap = cfg && Number.isFinite(cfg.gapMs) ? cfg.gapMs : DEFAULT_GAP_MS
  const tail = String(sessionId).slice(-8)
  for (let i = 1; i <= tries; i++) {
    try {
      await injectFollowup(ctx, sessionId, text)
      if (i > 1) logNotice(`第 ${i} 次注入成功 → ${tail}`)
      return true
    } catch (error) {
      const msg = errText(error)
      if (i >= tries) {
        logNotice(`注入失败 ${i} 次，放弃（${tail}）：${msg}｜没投出去的文案：${text}`)
        return false
      }
      logNotice(`注入失败（第 ${i} 次，${Math.round(gap / 1000)} 秒后重试）：${msg}`)
      await sleep(gap)
    }
  }
  return false
}

// ── 通知：处理一条 notice ──────────────────────────────────────────────────

/**
 * 处理一条已经解析好的事件。永远不抛。
 * hooks.inject 只在自测里用（换成记录函数，不碰真会话）。
 */
export async function handleNotice(ctx, ev, hooks = {}) {
  try {
    if (!ev || typeof ev !== 'object') return { ok: false, reason: '不是 JSON 对象' }
    if (String(ev.post_type || '') !== 'notice') return { ok: false, reason: '不是 notice，忽略' }

    const kind = noticeKind(ev)
    if (!kind) {
      logNotice(`未处理的 notice_type=${String(ev.notice_type || '（空）')}${ev.sub_type ? ' sub_type=' + String(ev.sub_type) : ''}`)
      return { ok: false, reason: '未处理的 notice_type' }
    }

    const key = dedupKey(ev)
    if (isDuplicate(key)) {
      logNotice(`重复上报，忽略：${key}`)
      return { ok: false, reason: '重复上报' }
    }

    const isGroup = kind === 'group_recall' || kind === 'group_increase' || kind === 'group_decrease'
      || (kind === 'poke' && Number(ev.group_id) > 0)
    const groupId = isGroup ? Number(ev.group_id) || 0 : 0
    if (isGroup && !groupId) {
      logNotice(`群通知里没带 group_id，跳过：${key}`)
      return { ok: false, reason: '没有 group_id' }
    }

    // 谁（对戳一戳要分清戳人的和被戳的）
    let actor = 0
    if (kind === 'poke') {
      const picked = pokeActor(ev, isGroup)
      if (picked.skip) {
        logNotice(`戳一戳跳过（${picked.skip}）：user=${ev.user_id} target=${ev.target_id} self=${ev.self_id}`)
        return { ok: false, reason: picked.skip }
      }
      actor = picked.actor
    } else if (kind === 'group_recall') {
      actor = Number(ev.operator_id) || Number(ev.user_id) || 0
    } else {
      actor = Number(ev.user_id) || 0
    }
    if (!actor) {
      logNotice(`通知里找不到当事人，跳过：${key}`)
      return { ok: false, reason: '找不到当事人' }
    }

    // 找会话（绑定解析两处共用）
    const cfg = (hooks.cfg && typeof hooks.cfg === 'object') ? hooks.cfg : readConfig()
    const bridge = hooks.bridge === undefined ? bridgeConfig() : hooks.bridge
    if (!bridge) {
      logNotice('读不到 qq-bridge-config.json，这条通知丢了：' + key)
      return { ok: false, reason: '读不到桥配置' }
    }
    const binding = findBinding(bridge, isGroup ? 'group' : 'private', isGroup ? groupId : actor)
    const bindingSession = String((binding && binding['会话']) || '').trim()
    const session = cfg.testSession || bindingSession
    if (!session) {
      logNotice(`${isGroup ? '群 ' + groupId : '私聊 ' + actor} 没有绑定会话，跳过（${kind}）`)
      return { ok: false, reason: '没有绑定会话' }
    }

    // 名字（群优先用事件自带的，其次问 NapCat；私聊先看绑定里的称呼）
    let who = ''
    if (isGroup) {
      who = inlineNick(ev) || await napcatNick(bridge, true, groupId, actor) || String(actor)
    } else {
      who = String((binding && binding['称呼']) || '').trim()
        || inlineNick(ev) || await napcatNick(bridge, false, 0, actor) || String(actor)
    }

    // 每收到一条入站事件就记「谁在说话」（取不到昵称就只写 QQ 号）
    const source = speakerSource(kind)
    if (source) {
      recordSpeaker({
        会话: session,
        昵称: String(who) === String(actor) ? '' : who,
        QQ: String(actor),
        来源: source,
      })
    }

    const text = buildText(kind, isGroup, who)
    if (!text) return { ok: false, reason: '文案是空的' }

    let ok = false
    if (typeof hooks.inject === 'function') ok = await hooks.inject(session, text) !== false
    else ok = await deliver(ctx, session, text, cfg)

    const where = isGroup ? `群 ${groupId}` : `私聊 ${actor}`
    if (ok) logNotice(`${where} ${kind} → 已注入 ${sessionName(bridge, session)}｜${text}`)
    return { ok, kind, isGroup, actor, groupId, session, text }
  } catch (error) {
    logNotice('处理通知时出错（已吞掉，插件照常）：' + errText(error))
    return { ok: false, reason: errText(error) }
  }
}

// ── 通知：HTTP 服务 ────────────────────────────────────────────────────────

function send(res, code, body) {
  try {
    res.statusCode = code
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(body)
  } catch (error) { /* 对端已经断了 */ }
}

/**
 * 回给 NapCat 的东西。必须是一个**合法 JSON 对象**：NapCat 收到上报后会
 * JSON.parse 响应体去处理「快速操作」，回纯文本 'ok' 会让它的日志里每次多一条解析失败。
 */
const OK_BODY = '{"status":"ok","retcode":0,"data":null}'

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let done = false
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) {
        done = true
        reject(new Error('上报体太大'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks).toString('utf8')) } })
    req.on('error', (error) => { if (!done) { done = true; reject(error) } })
  })
}

/**
 * 起 HTTP 服务。返回 { server, port } —— server 已经 listen（listen 是异步的，
 * 这里只负责挂好错误处理和回调）。
 */
export function startServer(ctx, hooks = {}) {
  const server = createServer((req, res) => {
    let url = null
    try {
      url = new URL(req.url || '/', `http://${LISTEN_HOST}`)
    } catch (error) {
      send(res, 400, 'bad url')
      return
    }

    const cfg = readConfig()
    if (req.method !== 'POST' || url.pathname !== '/notice') {
      send(res, 404, 'not found')
      return
    }
    if (cfg.token) {
      const fromQuery = url.searchParams.get('token') || ''
      const fromHeader = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      if (fromQuery !== cfg.token && fromHeader !== cfg.token) {
        send(res, 403, 'forbidden')
        logNotice(`口令不对，拒绝一条上报（来自 ${String(req.socket && req.socket.remoteAddress || '?')}）`)
        return
      }
    }

    readBody(req, BODY_MAX_BYTES)
      .then((text) => {
        let ev = null
        try {
          ev = JSON.parse(String(text || '').replace(/^\uFEFF/, ''))
        } catch (error) {
          send(res, 400, 'bad json')
          logNotice('上报的不是合法 JSON，丢了：' + errText(error))
          return
        }
        // 先回 200，再异步处理 —— 别让 NapCat 等我们查昵称/注入
        send(res, 200, OK_BODY)
        void Promise.resolve()
          .then(() => handleNotice(ctx, ev, hooks))
          .catch((error) => logNotice('异步处理通知时出错（已吞掉）：' + errText(error)))
      })
      .catch((error) => {
        send(res, 413, 'too large')
        logNotice('读上报体失败：' + errText(error))
      })
  })

  server.on('error', (error) => {
    const code = error && error.code
    if (code === 'EADDRINUSE') logNotice(`端口被占用了（${readConfig().port}）—— 通知收不到，等一会儿再试`)
    else logNotice('HTTP 服务出错：' + errText(error))
  })

  const port = readConfig().port
  try {
    server.listen(port, LISTEN_HOST)
  } catch (error) {
    logNotice('listen 失败：' + errText(error))
  }
  return { server, port }
}

// ── 插件入口 ───────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.effect(() => {
    ensureDir(FILES_ROOT)
    ensureDir(NOTICE_ROOT)
    ensureDir(QQ_ROOT)
    logQQ(`已加载 v0.1.0：收文件轮询 + 通知中继 + 谁在说话｜qq-speaker: ${SPEAKER_FILE}`)
    logFiles(`已加载 v0.1.0（dsh-ayy-qq）：每 ${POLL_MS / 1000} 秒看一眼 NapCat 的新消息，只捞 file 段｜落点 ${FILES_ROOT}｜上限 ${fmtSize(MAX_BYTES)}`)
    const cfg = readConfig()
    logNotice(`已加载 v0.1.0（dsh-ayy-qq）：监听 http://${LISTEN_HOST}:${cfg.port}/notice（口令 ${cfg.token.slice(0, 4)}…，${cfg.token.length} 位）｜日志 ${NOTICE_LOG}`)
    if (cfg.testSession) logNotice(`⚠️ 测试会话已开启：所有通知都投到 ${cfg.testSession}`)

    // ① 文件轮询
    let polling = false
    const tick = () => {
      if (polling) return
      polling = true
      Promise.resolve()
        .then(() => pollOnce(ctx))
        .then((r) => {
          if (r && r.ok === false && r.reason) logFiles('轮询跳过：' + r.reason)
        })
        .catch((error) => {
          logFiles('轮询整体出错（插件照常活着，下一跳照常）：' + errText(error))
        })
        .finally(() => { polling = false })
    }

    let stopInterval = null
    let kick = null
    try {
      if (typeof ctx.interval === 'function') {
        stopInterval = ctx.interval(tick, POLL_MS)
      } else if (typeof setInterval === 'function') {
        const handle = setInterval(tick, POLL_MS)
        if (typeof handle.unref === 'function') handle.unref()
        stopInterval = () => { try { clearInterval(handle) } catch (error) { /* ignore */ } }
      } else {
        logFiles('拿不到定时器（ctx.interval / setInterval 都没有）—— 文件轮询跑不起来')
      }
    } catch (error) {
      logFiles('排定时器失败：' + errText(error))
    }

    // 起来先跑一跳，不用等满 5 秒
    try {
      if (typeof ctx.timeout === 'function') kick = ctx.timeout(tick, 1200)
      else if (typeof setTimeout === 'function') { const h = setTimeout(tick, 1200); if (h && typeof h.unref === 'function') h.unref() }
    } catch (error) { /* 晚 5 秒也无所谓 */ }

    // ② 通知中继
    let server = null
    let retryTimer = null
    try {
      const started = startServer(ctx)
      server = started.server
      server.once('listening', () => {
        logNotice(`HTTP 服务就绪：http://${LISTEN_HOST}:${started.port}/notice`)
      })
      // 端口被占（例如老 dsh-ayy-notice 还开着）：30 秒后再试一次，别让插件报废
      server.on('error', (error) => {
        try {
          if (error && error.code === 'EADDRINUSE') {
            if (retryTimer) return
            retryTimer = setTimeout(() => {
              retryTimer = null
              try { server.close() } catch (e) { /* ignore */ }
              try { server.listen(started.port, LISTEN_HOST) } catch (e) { /* ignore */ }
            }, 30000)
            if (retryTimer && typeof retryTimer.unref === 'function') retryTimer.unref()
          }
        } catch (e) { /* ignore */ }
      })
    } catch (error) {
      logNotice('起 HTTP 服务失败（通知功能不可用，插件本身照常）：' + errText(error))
    }

    return () => {
      try { if (typeof kick === 'function') kick() } catch (error) { /* ignore */ }
      try { if (typeof stopInterval === 'function') stopInterval() } catch (error) { /* ignore */ }
      try { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null } } catch (error) { /* ignore */ }
      try { if (server) { server.close(); server.closeAllConnections?.() } } catch (error) { /* ignore */ }
      try { writeState(readState()) } catch (error) { /* ignore */ }
      logQQ('已卸载（文件定时器和通知 HTTP 服务都收掉了）')
    }
  }, 'dsh-ayy-qq: QQ 收文件 + 通知中继 + 谁在说话')
}

// ── 自测钩子（不改行为，只暴露纯函数给 harness 用）────────────────────
export const __test = {
  DSH_HOME, BRIDGE_CFG,
  FILES_ROOT, FILES_CONFIG, FILES_STATE, FILES_LOG, NOTICE_ROOT, NOTICE_CONFIG, NOTICE_LOG,
  QQ_ROOT, QQ_LOG, SPEAKER_FILE, SPEAKER_MAX, MAX_BYTES, DEDUP_MS,
  fmtStamp, fmtSize, sanitizeName, uniquePath, parseFileSeg, buildNotice,
  saveOneFile, readState, writeState, hasFileSeg, findAgent, pollOnce, dayFolder,
  readFilesConfig, readConfig, normalizeConfig, findBinding, findBindingBySession,
  bindingLabel, sessionName, bridgeConfig, noticeKind, pokeActor, buildText, speakerSource,
  dedupKey, isDuplicate, deliver, handleNotice, startServer, inlineNick,
  readSpeaker, recordSpeaker, writeSpeaker,
}

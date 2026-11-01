// dsh-ayy-settings — host half.
//
// 「源的设置」：她是谁 / 感官 / 注入范围 / 状态。
//
// 只碰下面这些文件（路径白名单在 readableFiles / isWritablePath 里）：
//   personas/who-i-am.md            读 + 写（写前把旧版复制进 who-i-am-history/）
//   personas/who-i-am.source        写（面板保存时记来源=使用者）
//   personas/who-i-am-history/      读 + 写（历史版本 + .source）
//   personas/her-memory.md          只读（绝不写：写记忆必须走 ayy_memory）
//   personas/health.log             只读
//   ayy-scope/config.json           读 + 写（只动「会话」数组，其余字段原样保留）
//   ayy-scope/scope.log             只读
//   ayy-files/config.json           读 + 写
//   ayy-notice/config.json          读 + 写（token 原样保留，不改）
//   qq-bridge-config.json           只读（取「绑定」当勾选候选）
//   NapCat .../onebot11_*.json      只读（看 httpClients 配过没；不替用户改）
//
// 所有路由都做同源校验 + 白名单；写操作前备份；异常一律转成结构化 { ok:false, error }。
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
  openSync,
  readSync,
  closeSync,
  appendFileSync,
  utimesSync,
} from 'node:fs'
import { join, basename, sep, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'

export const name = 'dsh-ayy-settings'
/** 只需要路由能力 */
export const inject = ['webServer']

const API_PREFIX = '/api/ayy-settings'

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
const scopeDir = () => join(dshHome(), 'ayy-scope')
const scopeCfg = () => join(scopeDir(), 'config.json')
const scopeLog = () => join(scopeDir(), 'scope.log')
const filesRootDir = () => join(dshHome(), 'ayy-files')
const filesCfg = () => join(filesRootDir(), 'config.json')
const noticeDir = () => join(dshHome(), 'ayy-notice')
const noticeCfg = () => join(noticeDir(), 'config.json')
const bridgeCfg = () => join(dshHome(), 'qq-bridge-config.json')
const settingsDir = () => join(dshHome(), 'ayy-settings')
const settingsLog = () => join(settingsDir(), 'settings.log')
const napcatDir = () => process.env.AYY_SETTINGS_NAPCAT_DIR || NAPCAT_CONFIG_DIR

// ── 路径白名单 ─────────────────────────────────────────────────────────────

const samePath = (a, b) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

function underDir(root, full) {
  const r = resolve(root)
  const f = resolve(full)
  return f !== r && f.toLowerCase().startsWith((r + sep).toLowerCase())
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

function staticFiles() {
  return [
    selfFile(),
    memoryFile(),
    healthLog(),
    scopeCfg(),
    scopeLog(),
    filesCfg(),
    noticeCfg(),
    bridgeCfg(),
    settingsLog(),
  ]
}

const readableFiles = () => staticFiles().concat(napcatConfigFiles())

function allowedDirs() {
  return [
    dshHome(),
    personasDir(),
    selfHistoryDir(),
    scopeDir(),
    filesRootDir(),
    noticeDir(),
    settingsDir(),
    napcatDir(),
  ]
}

function isAllowedHistoryFile(full) {
  if (!underDir(selfHistoryDir(), full)) return false
  return /\.(md|source)$/i.test(String(full))
}

function isReadablePath(full) {
  if (readableFiles().some((f) => samePath(f, full))) return true
  if (allowedDirs().some((d) => samePath(d, full))) return true
  return isAllowedHistoryFile(full)
}

function isWritablePath(full) {
  const exact = [selfFile(), scopeCfg(), filesCfg(), noticeCfg(), settingsLog()]
  for (const f of exact) {
    const r = resolve(f)
    const low = String(full).toLowerCase()
    if (samePath(r, full)) return true
    if (low.startsWith((r + '.bak-').toLowerCase())) return true
    if (low.startsWith((r + '.tmp-').toLowerCase())) return true
  }
  return isAllowedHistoryFile(full)
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

const statOf = (p) => {
  try {
    if (!isReadablePath(p)) return null
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

/** 本地时区 YYYYMMDD-HHmmss（备份文件用） */
function stamp() {
  const d = new Date()
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
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

/** 写文件前先留一份备份，返回备份路径 */
function backupFile(file) {
  if (!existsSync(file) || !isReadablePath(file)) return null
  const dest = `${file}.bak-${stamp()}`
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

function guardRead(p) {
  if (!isReadablePath(p)) throw new ApiError('path-not-allowed', 403)
}

function guardWrite(p) {
  if (!isWritablePath(p)) throw new ApiError('path-not-allowed', 403)
}

function log(line) {
  try {
    mkdirSync(settingsDir(), { recursive: true })
    const dest = settingsLog()
    guardWrite(dest)
    appendFileSync(dest, `[${stamp().replace(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3 $4:$5:$6')}] ${line}\n`, 'utf8')
  } catch {
    /* 日志写不进去也不影响面板 */
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

function scopeOverview() {
  const cfg = readJson(scopeCfg()) || {}
  const st = statOf(scopeCfg())
  const logSt = statOf(scopeLog())
  const sessions = Array.isArray(cfg['会话']) ? cfg['会话'].map(String).filter(Boolean) : []
  return {
    path: scopeCfg(),
    exists: !!st,
    mtime: st ? st.mtimeMs : 0,
    size: st ? st.size : 0,
    sessions,
    mounted: parseMountLog(readTailLines(scopeLog(), 50)),
    bindings: bridgeBindings(),
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

async function buildOverview() {
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
  const urlOf = (req) => new URL(req.url || '/', 'http://localhost')

  const routes = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/overview`,
      handler: getRoute(async (req, res) => {
        const data = await buildOverview()
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
      log(`已加载：源的面板（4 个标签 / ${routes.length} 条路由）`)
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-ayy-settings: routes')
  } catch (error) {
    log(`路由注册失败：${error instanceof Error ? error.message : String(error)}`)
    console.error('[dsh-ayy-settings] route registration failed:', error)
  }
}

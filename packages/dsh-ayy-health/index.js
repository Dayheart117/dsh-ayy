/**
 * dsh-ayy-health —— 安源悦 · 每日自检
 *
 * 她的处境：工具坏了现在只能靠小白碰巧发现。这个插件每 6 小时替她查一遍：
 *   1. 她的世界工具注册（personas/world.log 最后一次 apply 注册了哪些）
 *   2. QQ 桥（qq-bridge-config.json 的绑定 + NapCat get_login_info）
 *   3. 收文件插件（ayy-files/state.json 最近有没有动）
 *   4. 语音常驻服务（9880 /health）
 *   5. profile 里六个关键插件目录在不在
 *
 * 三层落点：
 *   - 每次结果一行写进 personas/health.log（带时间；故障写清哪项、什么现象）
 *   - 只有真故障才往 MEMORY.md「最近动态」加一条（她下一轮就看得到）
 *   - 同一个故障同一天只写一次（personas/health-state.json 记 hash + 日期）
 *
 * 关键语义：**9881（TTS daemon）没在跑不算故障** —— 它按需拉起、闲时释放，平时就是 down。
 * 只查常驻的 9880。凡是"开销大、按需启动"的东西，idle 都是正常态。
 *
 * 铁律：全部只读探测，不碰被检查的东西；一切异常自己吃掉写日志，绝不把 host 搞崩。
 * inject 只写真实存在的服务（timer）。写错会让整个 preset 消失。
 */
import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, copyFileSync, statSync, renameSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

export const name = 'dsh-ayy-health'
/** 只写真实存在的服务：timer（定时）。写错会让整个 preset 消失。 */
export const inject = ['timer']

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000   // 每 6 小时
const FIRST_DELAY_MS = 60 * 1000               // 加载后 60 秒先跑第一次（错开启动高峰）
const FETCH_TIMEOUT_MS = 8000
const FILES_STALE_MS = 10 * 60 * 1000          // state.json 超过 10 分钟没动 → 提示
const MAX_RECENT = 5
const RECENT_SECTION = '## 最近动态'
const LOG_MAX_BYTES = 2 * 1024 * 1024
const STATE_KEEP_DAYS = 31

const EXPECTED_TOOLS = ['ayy_diary', 'ayy_self', 'ayy_want', 'ayy_recall']
const EXPECTED_PLUGINS = [
  'dsh-ayy-world', 'dsh-ayy-ledger', 'dsh-ayy-skill', 'dsh-ayy-files', 'dsh-ayy-desk', 'dsh-qq-link',
]
const VOICE_HEALTH = 'http://127.0.0.1:9880/health'

// ── 路径（DSH_HOME 可覆盖；测试时可以替换单个落点）────────────────────────

function home() {
  return process.env.DSH_HOME || join(homedir(), '.dsh')
}

function paths(over = {}) {
  const h = home()
  const personas = join(h, 'personas')
  const memory = over.memoryFile || join(h, 'personas', 'her-memory.md')
  return {
    home: h,
    personas,
    memory,
    memoryBak: memory + '.bak',
    healthLog: over.healthLog || join(personas, 'health.log'),
    stateFile: over.stateFile || join(personas, 'health-state.json'),
    ledgerDir: over.ledgerDir || join(personas, 'ledger'),
    worldLog: over.worldLog || join(personas, 'world.log'),
    bridgeCfg: over.bridgeCfg || join(h, 'qq-bridge-config.json'),
    filesState: over.filesState || join(h, 'ayy-files', 'state.json'),
    profileDir: over.profileDir || join(h, 'profiles', 'desktop', 'node_modules'),
  }
}

// ── 小工具 ──────────────────────────────────────────────────────────────

const pad = (n) => String(n).padStart(2, '0')
const dateStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')

function readText(p) {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch (error) {
    return ''
  }
}

function readJson(p, fallback) {
  try {
    if (!existsSync(p)) return fallback
    return JSON.parse(readText(p).replace(/^\uFEFF/, ''))
  } catch (error) {
    return fallback
  }
}

function writeText(p, s) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s, 'utf8')
}

function appendLine(p, line) {
  try {
    mkdirSync(dirname(p), { recursive: true })
    if (existsSync(p) && statSync(p).size > LOG_MAX_BYTES) {
      try { renameSync(p, p + '.1') } catch (error) { /* 转不动就接着写 */ }
    }
    appendFileSync(p, line + '\n', 'utf8')
  } catch (error) { /* 日志写不了也不能影响主流程 */ }
}

function errText(error) {
  return String((error && error.message) || error || '原因不明')
}

const ok = (detail) => ({ status: 'ok', detail })
const warn = (detail) => ({ status: 'warn', detail })
const fail = (detail) => ({ status: 'fail', detail })

async function safeCheck(key, label, fn) {
  try {
    const r = await fn()
    return { key, name: label, status: r.status, detail: String(r.detail || '') }
  } catch (error) {
    return { key, name: label, status: 'fail', detail: `检查本身出错：${errText(error).slice(0, 160)}` }
  }
}

async function fetchWithTimeout(url, init = {}, ms = FETCH_TIMEOUT_MS) {
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) {} }, ms)
  try {
    return await fetch(url, { ...init, signal: ctl.signal })
  } finally {
    clearTimeout(timer)
  }
}

// ── 检查 1：她的世界工具注册 ────────────────────────────────────────────

function checkTools(p) {
  if (!existsSync(p.worldLog)) {
    return fail(`world.log 不存在（${p.worldLog}）—— ayy-world 可能没加载`)
  }
  const text = readText(p.worldLog)
  const start = text.lastIndexOf('apply() 开始')
  if (start < 0) return fail('world.log 里没有「apply() 开始」记录')
  const tail = text.slice(start)
  const endIdx = tail.indexOf('apply() 完成')
  const block = endIdx < 0 ? tail : tail.slice(0, endIdx)

  const names = []
  const badLines = []
  for (const line of block.split('\n')) {
    const hit = /✔\s*注册\s+(\S+)/.exec(line)
    if (hit) names.push(hit[1])
    if (/✘/.test(line)) badLines.push(line.replace(/^.*?[Zz]\s*/, '').trim())
  }

  const missing = EXPECTED_TOOLS.filter((t) => !names.includes(t))
  if (badLines.length) return fail(`world.log 里有失败：${badLines[0].slice(0, 120)}`)
  if (missing.length) return fail(`world.log 最后一次 apply 缺注册：${missing.join('、')}`)
  if (endIdx < 0) return warn(`最后一次 apply 还没走到「完成」，可能正在重载（已注册 ${names.join('/')}）`)
  return ok(`已注册 ${names.join('/')}`)
}

// ── 检查 2：QQ 桥 ──────────────────────────────────────────────────────

async function checkBridge(p) {
  if (!existsSync(p.bridgeCfg)) return fail('找不到 qq-bridge-config.json')
  const cfg = readJson(p.bridgeCfg, null)
  if (!cfg || typeof cfg !== 'object') return fail('qq-bridge-config.json 解析失败')
  const bindings = Array.isArray(cfg['绑定']) ? cfg['绑定'] : []
  if (!bindings.length) return fail('桥配置里「绑定」是空的——一个会话都没绑')

  const base = String(cfg['NapCat'] || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const token = String(cfg['令牌'] || '').trim()
  const headers = { 'content-type': 'application/json', 'user-agent': 'dsh-ayy-health' }
  if (token) headers.authorization = 'Bearer ' + token

  let res
  try {
    res = await fetchWithTimeout(`${base}/get_login_info`, { method: 'POST', headers, body: '{}' }, 6000)
  } catch (error) {
    return fail(`连不上 NapCat（${base}）：${errText(error).slice(0, 120)}`)
  }
  const raw = await res.text()
  let json = null
  try { json = JSON.parse(raw) } catch (error) { /* 不是 JSON 就按原文报 */ }
  if (json && json.retcode === 0 && json.status !== 'failed') {
    const who = json.data && (json.data.nickname || json.data.user_id)
    return ok(`绑定 ${bindings.length} 个，NapCat 在线${who ? `（${who}）` : ''}`)
  }
  const code = json && json.retcode != null ? json.retcode : `HTTP ${res.status}`
  return fail(`NapCat get_login_info 不对：retcode=${code}，返回 ${raw.slice(0, 200)}`)
}

// ── 检查 3：收文件插件 ─────────────────────────────────────────────────

function checkFiles(p) {
  if (!existsSync(p.filesState)) {
    return fail('插件可能没装/没跑：ayy-files/state.json 不存在')
  }
  let age = 0
  try { age = Date.now() - statSync(p.filesState).mtimeMs } catch (error) { return fail(`读不到 state.json 时间：${errText(error)}`) }
  if (age <= FILES_STALE_MS) return ok(`state.json ${Math.max(0, Math.round(age / 1000))} 秒前刚动过`)
  const mins = Math.round(age / 60000)
  // 注意：它只在有新消息 / 水位变化时才写 state.json，不是每 5 秒的心跳。
  // 所以停更只能说明"这段时间没消息"，不能断定插件死了 —— 记提示，不当故障。
  return warn(`state.json 停更 ${mins} 分钟（它只在有新消息时才写，可能只是没人说话）`)
}

// ── 检查 4：语音常驻服务（只查 9880；9881 按需起，不报警）───────────────

async function checkVoice() {
  let res
  try {
    res = await fetchWithTimeout(VOICE_HEALTH, { method: 'GET' }, 5000)
  } catch (error) {
    return fail(`9880 连不上（${errText(error).slice(0, 120)}）`)
  }
  if (res.status === 200) return ok('9880 /health 200')
  return fail(`9880 /health 返回 HTTP ${res.status}`)
}

// ── 检查 5：关键插件目录 ───────────────────────────────────────────────

function checkPlugins(p) {
  if (!existsSync(p.profileDir)) return fail(`profile 的 node_modules 不存在（${p.profileDir}）`)
  const missing = EXPECTED_PLUGINS.filter((n) => !existsSync(join(p.profileDir, n)))
  if (missing.length) return fail(`缺插件目录：${missing.join('、')}`)
  return ok(`6 个目录都在（${EXPECTED_PLUGINS.join('/')}）`)
}

// ── 汇总 ───────────────────────────────────────────────────────────────

export async function collect(over = {}) {
  const p = paths(over)
  const results = []
  results.push(await safeCheck('tools', '工具注册', () => checkTools(p)))
  results.push(await safeCheck('bridge', 'QQ桥', () => checkBridge(p)))
  results.push(await safeCheck('files', '收文件', () => checkFiles(p)))
  results.push(await safeCheck('voice', '语音9880', () => checkVoice()))
  results.push(await safeCheck('plugins', '插件目录', () => checkPlugins(p)))
  return {
    results,
    // 9881 是按需 daemon，idle 是正常态：明确列出来，免得以后有人以为漏查了
    ignored: ['9881 TTS daemon（按需起、闲着放，不检查）'],
  }
}

const ICON = { ok: 'OK', warn: 'WARN', fail: 'FAIL' }

export function healthLine(results, d = new Date()) {
  const parts = results.map((r) => {
    if (r.status === 'ok') return `${r.name}:OK`
    return `${r.name}:${ICON[r.status] || r.status}(${r.detail})`
  })
  const fails = results.filter((r) => r.status === 'fail').length
  const warns = results.filter((r) => r.status === 'warn').length
  return `[${dateStr(d)} ${hhmm(d)}] 自检 ${results.length} 项 · 故障 ${fails} / 提示 ${warns} | ${parts.join(' | ')}`
}

// ── 写进她的「最近动态」 ────────────────────────────────────────────────
// 照抄 dsh-ayy-ledger 的做法：只替换「## 最近动态」这一节，写前 .bak，溢出沉到 ledger。

function parseSection(text, heading) {
  const idx = text.indexOf(heading)
  if (idx < 0) return null
  const after = text.slice(idx + heading.length)
  const nextIdx = after.search(/\n## /)
  const body = nextIdx < 0 ? after : after.slice(0, nextIdx)
  const rest = nextIdx < 0 ? '' : after.slice(nextIdx)
  const noteLines = []
  const items = []
  for (const raw of body.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) continue
    if (/^-\s+/.test(line.trim())) items.push(line.trim())
    else noteLines.push(line)
  }
  return { heading, before: text.slice(0, idx), noteLines, items, rest }
}

function rebuildSection(p) {
  return p.before + p.heading + '\n' + p.noteLines.join('\n') + '\n' +
    (p.items.length ? p.items.join('\n') + '\n' : '\n') + p.rest
}

function archiveRecentLine(p, line) {
  const body = String(line).replace(/^-\s*/, '')
  const parts = body.split('·').map((s) => s.trim())
  const scene = parts.length >= 3 ? parts[1] : 'system'
  const file = join(p.ledgerDir, `${monthStr()}.${safe(scene)}.md`)
  try {
    const header = existsSync(file) ? '' : `# ${monthStr()} · 动态流水\n\n`
    writeText(file, (existsSync(file) ? readText(file).replace(/\s*$/, '\n') : header) + line + '\n')
  } catch (error) { /* 沉不下去也不能挡住主流程 */ }
}

function faultHash(f) {
  return createHash('sha1').update(`${f.key}:${f.detail}`).digest('hex').slice(0, 16)
}

/** 从当天故障里挑出「今天还没写过动态」的；返回 { fresh, days, pruned } */
function selectFreshFaults(p, fails) {
  const today = dateStr()
  const state = readJson(p.stateFile, {})
  const raw = state && typeof state === 'object' && state.days && typeof state.days === 'object' ? state.days : {}
  const days = {}
  let pruned = false
  const now = Date.now()
  for (const [hash, day] of Object.entries(raw)) {
    const t = Date.parse(String(day))
    if (!Number.isFinite(t) || now - t > STATE_KEEP_DAYS * 86400000) { pruned = true; continue }
    days[hash] = String(day)
  }
  const fresh = []
  for (const f of fails) {
    const h = faultHash(f)
    if (days[h] === today) continue
    fresh.push({ f, hash: h })
  }
  return { fresh, days, pruned }
}

function commitFreshFaults(p, fresh, days) {
  const next = { ...days }
  for (const one of fresh) next[one.hash] = dateStr()
  try {
    writeText(p.stateFile, JSON.stringify({ days: next, updatedAt: new Date().toISOString() }, null, 2) + '\n')
  } catch (error) { /* 去重状态写不了，下次可能重复写，不致命 */ }
}

function appendFaultsToMemory(p, fails) {
  if (!existsSync(p.memory)) return { wrote: 0, error: 'MEMORY.md 不存在' }
  const text = readText(p.memory)
  const parsed = parseSection(text, RECENT_SECTION)
  if (!parsed) return { wrote: 0, error: `MEMORY.md 里找不到「${RECENT_SECTION}」` }

  const d = new Date()
  const stamp = `${dateStr(d)} ${hhmm(d)}`
  let wrote = 0
  for (const f of fails) {
    // 动态里只放短句：长路径只留文件名，整条不超过 ~90 字
    let one = `${f.name}出问题（${String(f.detail || '').replace(/[A-Za-z]:\\[^\s（）()]+/g, (m) => m.split(/[\\/]/).pop())}）`
    if (one.length > 90) one = one.slice(0, 90) + '…'
    parsed.items.push(`- ${stamp} · system · 自检：${one}`)
    wrote++
  }
  while (parsed.items.length > MAX_RECENT) archiveRecentLine(p, parsed.items.shift())
  try {
    copyFileSync(p.memory, p.memoryBak)
    writeText(p.memory, rebuildSection(parsed))
  } catch (error) {
    return { wrote: 0, error: `写 MEMORY.md 失败：${errText(error)}` }
  }
  return { wrote }
}

// ── 一轮 ───────────────────────────────────────────────────────────────

export async function runOnce(over = {}) {
  const p = paths(over)
  try {
    const { results, ignored } = await collect(over)
    const line = healthLine(results)
    appendLine(p.healthLog, line)

    const fails = results.filter((r) => r.status === 'fail')
    let wrote = 0
    let skipped = 0
    let note = ''
    if (fails.length) {
      const { fresh, days } = selectFreshFaults(p, fails)
      skipped = fails.length - fresh.length
      if (fresh.length) {
        const res = appendFaultsToMemory(p, fresh.map((x) => x.f))
        wrote = res.wrote
        if (res.error) note = res.error
        if (res.wrote) commitFreshFaults(p, fresh, days)
      }
    }
    try { console.log('[dsh-ayy-health] ' + line + (note ? `（${note}）` : '')) } catch (error) {}
    return { line, results, ignored, fails: fails.length, wrote, skipped, note }
  } catch (error) {
    const line = `[${dateStr()} ${hhmm()}] 自检本身出错：${errText(error).slice(0, 300)}`
    appendLine(p.healthLog, line)
    try { console.log('[dsh-ayy-health] ' + line) } catch (error2) {}
    return { line, error: errText(error), results: [], fails: 0, wrote: 0, skipped: 0 }
  }
}

// ── 插件入口 ───────────────────────────────────────────────────────────

export function apply(ctx) {
  let running = false

  const tick = () => {
    if (running) return
    running = true
    Promise.resolve()
      .then(() => runOnce())
      .catch((error) => {
        try { appendLine(paths().healthLog, `[${dateStr()} ${hhmm()}] 自检崩了：${errText(error).slice(0, 300)}`) } catch (error2) {}
      })
      .finally(() => { running = false })
  }

  ctx.effect(() => {
    let stopInterval = null
    let kick = null
    try {
      if (typeof ctx.interval === 'function') {
        stopInterval = ctx.interval(tick, CHECK_INTERVAL_MS)
      } else if (typeof setInterval === 'function') {
        const handle = setInterval(tick, CHECK_INTERVAL_MS)
        if (typeof handle.unref === 'function') handle.unref()
        stopInterval = () => { try { clearInterval(handle) } catch (error) {} }
      }
    } catch (error) { /* 没定时器就只在卸载前跑一次 */ }

    try {
      if (typeof ctx.timeout === 'function') kick = ctx.timeout(tick, FIRST_DELAY_MS)
      else if (typeof setTimeout === 'function') {
        const handle = setTimeout(tick, FIRST_DELAY_MS)
        if (typeof handle.unref === 'function') handle.unref()
        kick = () => { try { clearTimeout(handle) } catch (error) {} }
      }
    } catch (error) { /* 晚点跑也无所谓 */ }

    try {
      appendLine(paths().healthLog, `[${dateStr()} ${hhmm()}] 自检已加载：每 6 小时一次，${FIRST_DELAY_MS / 1000} 秒后先跑一次`)
    } catch (error) { /* ignore */ }

    return () => {
      try { if (typeof kick === 'function') kick() } catch (error) {}
      try { if (typeof stopInterval === 'function') stopInterval() } catch (error) {}
    }
  }, 'dsh-ayy-health: 6 小时自检')
}

// ── 自测钩子 ───────────────────────────────────────────────────────────
export const __test = {
  paths, collect, runOnce, checkTools, checkBridge, checkFiles, checkVoice, checkPlugins,
  appendFaultsToMemory, faultHash, healthLine, EXPECTED_TOOLS, EXPECTED_PLUGINS, FILES_STALE_MS,
}

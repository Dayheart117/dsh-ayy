/**
 * dsh-ayy-notice —— 安源悦 · 收 QQ 通知事件
 *
 * 她的处境：消息由 QQ 桥（dsh-qq-link）用「轮询历史消息」的方式收，天然收不到 notice
 * （戳一戳、撤回、入群/退群 —— 这些不是消息，历史里根本没有）。
 *
 * 上游桥 1.5.0 加了「HTTP 上报」通道，但要求把上报地址指到 DSH 的端口，而 DSH 桌面版
 * **每次启动随机挑端口**（40027 / 58388 / 58208 / 25183 …），重启一次就失效。
 * 所以这个插件自己起一个**固定端口**的中继：
 *
 *   1. http.createServer 监听 127.0.0.1:9898（端口/口令在 <DSH_HOME>/ayy-notice/config.json）；
 *   2. POST /notice?token=xxx，收到就立刻 200 ok，再异步处理（别让 NapCat 等）；
 *   3. 只认 post_type === 'notice'，其它一律忽略；
 *   4. 解析 poke / friend_recall / group_recall / group_increase / group_decrease，
 *      认不出的 notice_type 只记一行日志，不注入、不报错；
 *   5. 按 qq-bridge-config.json 的「绑定」找到会话，用 ctx.agents.get(会话).followup(...) 注入一句；
 *      会话暂时没活着就重试（默认 5 次、间隔 5 秒），还不行记日志放弃；
 *   6. 同一条通知（time + user_id + notice_type）10 秒内只处理一次，防 NapCat 重复上报。
 *
 * ⚠️ 只处理 notice：普通消息仍归桥的轮询负责，这里一条都不转发，否则她会收到两遍。
 * ⚠️ 任何异常都 try/catch 吃掉 + 写 notice.log，绝不能抛出去把插件（甚至宿主）搞挂。
 * ⚠️ 端口、口令在 config.json 里；第一次跑会自动生成口令并把文件写出来。
 */
import {
  readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, renameSync, statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'

export const name = 'dsh-ayy-notice'
/** 只写真实存在的服务：agents（往会话注消息）。写不存在的会让整个 preset 消失。 */
export const inject = ['agents']

// ── 路径 ────────────────────────────────────────────────────────────────────
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
// AYY_NOTICE_HOME / AYY_NOTICE_BRIDGE 只在自测里用（把家目录和绑定配置指到临时目录），生产不设。
const ROOT = process.env.AYY_NOTICE_HOME || join(DSH_HOME, 'ayy-notice')
const CONFIG_FILE = join(ROOT, 'config.json')
const LOG_FILE = join(ROOT, 'notice.log')
const BRIDGE_CFG = process.env.AYY_NOTICE_BRIDGE || join(DSH_HOME, 'qq-bridge-config.json')

// ── 常量 ────────────────────────────────────────────────────────────────────
const DEFAULT_PORT = Number(process.env.AYY_NOTICE_PORT) || 9898
const LISTEN_HOST = '127.0.0.1'
const LOG_MAX_BYTES = 2 * 1024 * 1024
const BODY_MAX_BYTES = 256 * 1024      // 一条 notice 撑死几 KB，256KB 是保险丝
const DEDUP_MS = 10 * 1000             // 同一件事 10 秒内只处理一次
const DEDUP_PRUNE = 200                // 去重表最多记多少条
const NAPCAT_TIMEOUT_MS = 6000
const NICK_TTL_MS = 30 * 60 * 1000     // 昵称缓存 30 分钟
const BRIDGE_TTL_MS = 15 * 1000        // 绑定配置缓存 15 秒（改配置不用重启）
const DEFAULT_TRIES = 5                // 注入失败重试次数
const DEFAULT_GAP_MS = 5000            // 重试间隔

// ── 日志 ────────────────────────────────────────────────────────────────────

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
  try { console.log('[dsh-ayy-notice] ' + line) } catch (error) { /* ignore */ }
}

function errText(error) {
  return String((error && error.message) || error || '原因不明')
}

function sleep(ms) {
  return new Promise((resolve) => {
    try {
      const h = setTimeout(resolve, Math.max(0, Number(ms) || 0))
      if (h && typeof h.unref === 'function') h.unref()
    } catch (error) { resolve() }
  })
}

// ── 配置（端口 / 口令 / 重试）──────────────────────────────────────────────
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

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch (error) {
    return null
  }
}

function normalizeConfig(raw) {
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
  try { mkdirSync(ROOT, { recursive: true }) } catch (error) { /* 建不了目录下面还会试 */ }
  const raw = readJson(CONFIG_FILE)
  if (raw && typeof raw === 'object' && String(raw.token || '').trim()) return normalizeConfig(raw)

  const next = { ...(raw && typeof raw === 'object' ? raw : {}) }
  next.port = Number.isFinite(Number(next.port)) && Number(next.port) > 0 ? Number(next.port) : DEFAULT_PORT
  next.token = randomBytes(12).toString('hex')
  if (next['重试次数'] == null) next['重试次数'] = DEFAULT_TRIES
  if (next['重试间隔毫秒'] == null) next['重试间隔毫秒'] = DEFAULT_GAP_MS
  if (next['测试会话'] == null) next['测试会话'] = ''
  try {
    writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf8')
  } catch (error) {
    log('配置文件写不了（口令只用这次）：' + errText(error))
  }
  return normalizeConfig(next)
}

// ── 桥配置（绑定 + NapCat 地址/令牌）──────────────────────────────────────

let bridgeCache = { at: 0, cfg: null }

function bridgeConfig() {
  if (bridgeCache.cfg && Date.now() - bridgeCache.at < BRIDGE_TTL_MS) return bridgeCache.cfg
  const cfg = readJson(BRIDGE_CFG)
  const value = cfg && typeof cfg === 'object' ? cfg : null
  bridgeCache = { at: Date.now(), cfg: value }
  return value
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

function napcatBase(bridge) {
  return String((bridge && bridge['NapCat']) || 'http://127.0.0.1:3000').replace(/\/+$/, '')
}

async function napcat(bridge, action, body, timeoutMs = NAPCAT_TIMEOUT_MS) {
  const headers = { 'content-type': 'application/json', 'user-agent': 'dsh-ayy-notice' }
  const token = String((bridge && bridge['令牌']) || '').trim()
  if (token) headers.authorization = 'Bearer ' + token
  const ctl = new AbortController()
  const timer = setTimeout(() => { try { ctl.abort() } catch (error) { /* ignore */ } }, timeoutMs)
  try {
    const res = await fetch(`${napcatBase(bridge)}/${action}`, {
      method: 'POST', headers, body: JSON.stringify(body || {}), signal: ctl.signal,
    })
    const text = await res.text()
    const json = JSON.parse(text)
    if (!json || json.status !== 'ok' || json.retcode !== 0) {
      throw new Error(`NapCat ${action} 不 ok：${String((json && (json.message || json.wording)) || text).slice(0, 120)}`)
    }
    return json.data || {}
  } finally {
    clearTimeout(timer)
  }
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

function pickString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
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
      ? await napcat(bridge, 'get_group_member_info', { group_id: Number(groupId), user_id: Number(uid) })
      : await napcat(bridge, 'get_stranger_info', { user_id: Number(uid) })
    const name = pickString(data.card, data.nickname, data.remark)
    if (name) saveNick(key, name)
    return name
  } catch (error) {
    log(`查昵称失败（${key}，用号码代替）：${errText(error)}`)
    return ''
  }
}

// ── 解析 notice ─────────────────────────────────────────────────────────────
//
// NapCat（OneBot 11）真实结构，照 napcat.mjs 里的类抠出来的：
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
function inlineNick(ev) {
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

// ── 去重 ────────────────────────────────────────────────────────────────────
//
// NapCat 有时候同一条通知会报两遍（重连 / 多通道）。key = time + notice_type + user_id
// （群里再带上 group_id，私聊带上 sub_type），10 秒内只处理一次。

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

// ── 注入会话 ───────────────────────────────────────────────────────────────

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

/** 注入一句话，失败重试。永远不抛；成功返回 true。 */
export async function deliver(ctx, sessionId, text, cfg) {
  const tries = (cfg && cfg.tries) || DEFAULT_TRIES
  const gap = cfg && Number.isFinite(cfg.gapMs) ? cfg.gapMs : DEFAULT_GAP_MS
  const tail = String(sessionId).slice(-8)
  for (let i = 1; i <= tries; i++) {
    try {
      const agent = findAgent(ctx, sessionId)
      if (!agent) throw new Error(`会话没活着（${tail}）`)
      if (typeof agent.followup !== 'function') throw new Error('agent 上没有 followup')
      await agent.followup({
        id: randomUUID(),
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: 'qq' },
      })
      if (i > 1) log(`第 ${i} 次注入成功 → ${tail}`)
      return true
    } catch (error) {
      const msg = errText(error)
      if (i >= tries) {
        log(`注入失败 ${i} 次，放弃（${tail}）：${msg}｜没投出去的文案：${text}`)
        return false
      }
      log(`注入失败（第 ${i} 次，${Math.round(gap / 1000)} 秒后重试）：${msg}`)
      await sleep(gap)
    }
  }
  return false
}

// ── 处理一条 notice ────────────────────────────────────────────────────────

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
      log(`未处理的 notice_type=${String(ev.notice_type || '（空）')}${ev.sub_type ? ' sub_type=' + String(ev.sub_type) : ''}`)
      return { ok: false, reason: '未处理的 notice_type' }
    }

    const key = dedupKey(ev)
    if (isDuplicate(key)) {
      log(`重复上报，忽略：${key}`)
      return { ok: false, reason: '重复上报' }
    }

    const isGroup = kind === 'group_recall' || kind === 'group_increase' || kind === 'group_decrease'
      || (kind === 'poke' && Number(ev.group_id) > 0)
    const groupId = isGroup ? Number(ev.group_id) || 0 : 0
    if (isGroup && !groupId) {
      log(`群通知里没带 group_id，跳过：${key}`)
      return { ok: false, reason: '没有 group_id' }
    }

    // 谁（对戳一戳要分清戳人的和被戳的）
    let actor = 0
    if (kind === 'poke') {
      const picked = pokeActor(ev, isGroup)
      if (picked.skip) {
        log(`戳一戳跳过（${picked.skip}）：user=${ev.user_id} target=${ev.target_id} self=${ev.self_id}`)
        return { ok: false, reason: picked.skip }
      }
      actor = picked.actor
    } else if (kind === 'group_recall') {
      actor = Number(ev.operator_id) || Number(ev.user_id) || 0
    } else {
      actor = Number(ev.user_id) || 0
    }
    if (!actor) {
      log(`通知里找不到当事人，跳过：${key}`)
      return { ok: false, reason: '找不到当事人' }
    }

    // 找会话
    const cfg = (hooks.cfg && typeof hooks.cfg === 'object') ? hooks.cfg : readConfig()
    const bridge = hooks.bridge === undefined ? bridgeConfig() : hooks.bridge
    if (!bridge) {
      log('读不到 qq-bridge-config.json，这条通知丢了：' + key)
      return { ok: false, reason: '读不到桥配置' }
    }
    const binding = findBinding(bridge, isGroup ? 'group' : 'private', isGroup ? groupId : actor)
    const bindingSession = String((binding && binding['会话']) || '').trim()
    const session = cfg.testSession || bindingSession
    if (!session) {
      log(`${isGroup ? '群 ' + groupId : '私聊 ' + actor} 没有绑定会话，跳过（${kind}）`)
      return { ok: false, reason: '没有绑定会话' }
    }

    // 名字
    let who = ''
    if (isGroup) {
      who = inlineNick(ev) || await napcatNick(bridge, true, groupId, actor) || String(actor)
    } else {
      who = String((binding && binding['称呼']) || '').trim()
        || inlineNick(ev) || await napcatNick(bridge, false, 0, actor) || String(actor)
    }

    const text = buildText(kind, isGroup, who)
    if (!text) return { ok: false, reason: '文案是空的' }

    let ok = false
    if (typeof hooks.inject === 'function') ok = await hooks.inject(session, text) !== false
    else ok = await deliver(ctx, session, text, cfg)

    const where = isGroup ? `群 ${groupId}` : `私聊 ${actor}`
    if (ok) log(`${where} ${kind} → 已注入 ${String(session).slice(-8)}｜${text}`)
    return { ok, kind, isGroup, actor, groupId, session, text }
  } catch (error) {
    log('处理通知时出错（已吞掉，插件照常）：' + errText(error))
    return { ok: false, reason: errText(error) }
  }
}

// ── HTTP 服务 ───────────────────────────────────────────────────────────────

function send(res, code, body) {
  try {
    res.statusCode = code
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(body)
  } catch (error) { /* 对端已经断了 */ }
}

/**
 * 回给 NapCat 的东西。必须是一个**合法 JSON 对象**：NapCat 收到上报后会
 * JSON.parse 响应体去处理「快速操作」（见 napcat.mjs 的 handleQuickOperation），
 * 回纯文本 'ok' 会让它的日志里每次多一条解析失败。notice 不看快速操作，所以给个空壳。
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
        log(`口令不对，拒绝一条上报（来自 ${String(req.socket && req.socket.remoteAddress || '?')}）`)
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
          log('上报的不是合法 JSON，丢了：' + errText(error))
          return
        }
        // 先回 200，再异步处理 —— 别让 NapCat 等我们查昵称/注入
        send(res, 200, OK_BODY)
        void Promise.resolve()
          .then(() => handleNotice(ctx, ev, hooks))
          .catch((error) => log('异步处理通知时出错（已吞掉）：' + errText(error)))
      })
      .catch((error) => {
        send(res, 413, 'too large')
        log('读上报体失败：' + errText(error))
      })
  })

  server.on('error', (error) => {
    const code = error && error.code
    if (code === 'EADDRINUSE') log(`端口被占用了（${readConfig().port}）—— 通知收不到，等一会儿再试`)
    else log('HTTP 服务出错：' + errText(error))
  })

  const port = readConfig().port
  try {
    server.listen(port, LISTEN_HOST)
  } catch (error) {
    log('listen 失败：' + errText(error))
  }
  return { server, port }
}

// ── 插件入口 ───────────────────────────────────────────────────────────────

export function apply(ctx) {
  ctx.effect(() => {
    try { mkdirSync(ROOT, { recursive: true }) } catch (error) { /* ignore */ }
    const cfg = readConfig()
    log(`已加载 v0.1.0：监听 http://${LISTEN_HOST}:${cfg.port}/notice（口令 ${cfg.token.slice(0, 4)}…，${cfg.token.length} 位）｜日志 ${LOG_FILE}`)
    if (cfg.testSession) log(`⚠️ 测试会话已开启：所有通知都投到 ${cfg.testSession}`)

    let server = null
    let retryTimer = null
    try {
      const started = startServer(ctx)
      server = started.server
      server.once('listening', () => {
        log(`HTTP 服务就绪：http://${LISTEN_HOST}:${started.port}/notice`)
      })
      // 端口被占：30 秒后再试一次，别让插件报废
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
      log('起 HTTP 服务失败（通知功能不可用，插件本身照常）：' + errText(error))
    }

    return () => {
      try { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null } } catch (error) { /* ignore */ }
      try { if (server) { server.close(); server.closeAllConnections?.() } } catch (error) { /* ignore */ }
      log('已卸载（HTTP 服务已关）')
    }
  }, 'dsh-ayy-notice: 收 QQ 通知（戳一戳/撤回/进退群）')
}

// ── 自测钩子（不改行为，只暴露纯函数给 harness 用）──────────────────────
export const __test = {
  ROOT, CONFIG_FILE, LOG_FILE, BRIDGE_CFG, DEDUP_MS,
  readConfig, normalizeConfig, findBinding, noticeKind, pokeActor, buildText, dedupKey,
  isDuplicate, findAgent, deliver, handleNotice, startServer, inlineNick,
}

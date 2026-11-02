/**
 * dsh-ayy-mem · 公共部分（路径 / 读写 / 备份 / 时间戳 / 来源解析）
 *
 * 合并前，这四个插件各写了一份几乎一样的 readText/writeText/今日日期/备份，
 * 现在只留这一份。**路径一个都不能改**——她所有日记、本子、自述、记忆都在
 * ~/.dsh/personas 底下，挪一处就是丢数据：
 *
 *   personas/who-i-am.md          自述（旧版 → who-i-am-history/）
 *   personas/her-memory.md        她的记忆（旧版 → memory-history/）
 *   personas/her-memory.md.bak    动态改前的整份兜底
 *   personas/notes/<名>.md        随笔本（旧版 → notes-history/）
 *   personas/diary/<日期>.md      日记（旧版 → diary-history/）
 *   personas/wants.md             心愿单
 *   personas/ledger/<年-月>.<场景>.md  被挤出窗口的动态、未完成的话
 *   personas/transcripts/         翻原文的当日缓存
 *   memory/notes + memory/index.json  升格出来的永久归档（core-memory 读的那套）
 *   qq-bridge-config.json         会话 ↔ QQ 的绑定表
 *   qq-speaker.json               谁在说话（由 dsh-ayy-qq 写，可能还不存在）
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  copyFileSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const P = join(HOME, 'personas')

export const PATHS = {
  home: HOME,
  personas: P,
  // 自述
  self: join(P, 'who-i-am.md'),
  selfHistory: join(P, 'who-i-am-history'),
  // 记忆
  herMemory: join(P, 'her-memory.md'),
  herMemoryBak: join(P, 'her-memory.md.bak'),
  memoryHistory: join(P, 'memory-history'),
  // 本子
  notes: join(P, 'notes'),
  notesHistory: join(P, 'notes-history'),
  // 日记
  diary: join(P, 'diary'),
  diaryHistory: join(P, 'diary-history'),
  // 心愿
  wants: join(P, 'wants.md'),
  // 流水 / 缓存 / 日志
  ledger: join(P, 'ledger'),
  transcripts: join(P, 'transcripts'),
  log: join(P, 'ayy-mem.log'),
  // core-memory 的归档（升格用）
  coreNotes: join(HOME, 'memory', 'notes'),
  coreIndex: join(HOME, 'memory', 'index.json'),
  // 外部配置
  bridgeCfg: join(HOME, 'qq-bridge-config.json'),
  speakerFile: join(HOME, 'qq-speaker.json'),
}

// ── 读写 ────────────────────────────────────────────────────────────────

export const readText = (p) => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}

export const readJson = (p, fb) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) : fb
  } catch {
    return fb
  }
}

export const writeText = (p, s) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s, 'utf8')
}

/** 整份复制（改前兜底），失败不抛：坏了一个备份不该连带写不进去 */
export const copyOver = (from, to) => {
  try {
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    return true
  } catch {
    return false
  }
}

/** 带序号的原子写：先写临时文件再替换 */
export function atomicWrite(path, body) {
  const tmp = path + '.tmp-' + Date.now()
  writeFileSync(tmp, body, 'utf8')
  // rename 在 Windows 上偶尔会撞占用，退回直接覆写
  try {
    renameSync(tmp, path)
  } catch {
    writeFileSync(path, body, 'utf8')
    try {
      unlinkSync(tmp)
    } catch {
      /* 临时文件留就留了，不影响正文 */
    }
  }
}

// ── 时间戳 ──────────────────────────────────────────────────────────────

export const pad = (n) => String(n).padStart(2, '0')

/** 2026-11-02 */
export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 16:39 */
export const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** 2026-11 */
export const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/** 11-02（未完成的话用短日期） */
export const monthDay = (d = new Date()) => `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** 2026-11-02T16-39-00-123Z —— 自述/本子的旧版文件名沿用它，别改 */
export const stampIso = (d = new Date()) => d.toISOString().replace(/[:.]/g, '-')

/** 20261102-163900-123 —— 记忆改前备份的文件名沿用它，别改 */
export function stampCompact(d = new Date()) {
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds(),
  )}-${ms}`
}

/** 2026-11-02 16:39 —— 来源注释里给人看的 */
export const stampHuman = (d = new Date()) => `${todayStr(d)} ${hhmm(d)}`

export const safe = (s) => String(s).replace(/[^\w.-]+/g, '_') // Windows 文件名不许冒号

export const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'note'

// ── 备份 ────────────────────────────────────────────────────────────────

/** 把一段旧内容存进历史目录，同名就加序号。返回备份路径 */
export function backupText(dir, filename, body) {
  mkdirSync(dir, { recursive: true })
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const ext = dot > 0 ? filename.slice(dot) : ''
  let dest = join(dir, filename)
  let n = 1
  while (existsSync(dest)) {
    dest = join(dir, `${stem}-${n}${ext}`)
    n += 1
  }
  writeFileSync(dest, body, 'utf8')
  return dest
}

/** 历史目录只留最近 keep 份：超出的清空（不是删，沿用老做法，避免句柄占用） */
export function trimHistory(dir, { prefix = '', suffix = '.md', keep = 60 } = {}) {
  try {
    const all = readdirSync(dir)
      .filter((f) => f.startsWith(prefix) && f.endsWith(suffix))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const stale of all.slice(keep)) {
      try {
        writeFileSync(join(dir, stale.f), '')
      } catch {
        /* 清单理失败不算事 */
      }
    }
  } catch {
    /* 清理失败不影响备份本身 */
  }
}

// ── 日志 ────────────────────────────────────────────────────────────────

export function log(msg) {
  try {
    mkdirSync(PATHS.personas, { recursive: true })
    writeFileSync(PATHS.log, `${new Date().toISOString()} ${msg}\n`, { flag: 'a' })
  } catch {
    /* 日志写不了也不影响功能 */
  }
}

// ── 场景：QQ 私聊 / 群 ───────────────────────────────────────────────────

/** 主场景：QQ 私聊（来自 qq-bridge 配置），拿不到就 dsh:chat */
export function defaultScene() {
  const c = readJson(PATHS.bridgeCfg, {})
  const bindings = Array.isArray(c['绑定']) ? c['绑定'] : []
  const priv = bindings.find((b) => b && String(b['类型']).includes('私聊'))
  const qq = String(priv?.['号码'] || c['私聊QQ'] || '')
  return qq ? `qq:private:${qq}` : 'dsh:chat'
}

/** 老名字，调用处不改 */
export const primaryScene = defaultScene

// ── 来源解析（会话 id → 人看得懂的名字 + 谁在说话）──────────────────────

/**
 * 会话 id → 人看得懂的名字。
 * 先从 QQ 桥的绑定表里查（那里有群号/好友号/称呼），查不到再退回短 id。
 * 溯源要的是"哪一场"，不是一串 uuid。
 */
export function resolveScene(sid, ctxObj) {
  const s = String(sid || '').trim()
  if (!s) return { label: 'unknown', id: '' }
  // 执行上下文里如果直接带了标题，最好
  try {
    const t = ctxObj && (ctxObj.title || (ctxObj.session && ctxObj.session.title))
    if (typeof t === 'string' && t.trim()) return { label: t.trim(), id: s }
  } catch {
    /* 没有就算了 */
  }
  // 查 QQ 桥的绑定
  try {
    const cfg = readJson(PATHS.bridgeCfg, {})
    const list = Array.isArray(cfg['绑定']) ? cfg['绑定'] : []
    for (const b of list) {
      if (!b || String(b['会话'] || '') !== s) continue
      const kind = String(b['类型'] || '') === '群' ? '群' : '私聊'
      const num = String(b['号码'] || '')
      const name = String(b['称呼'] || '').trim()
      return { label: `${kind} ${num}${name ? '（' + name + '）' : ''}`, id: s }
    }
  } catch {
    /* 桥配置读不到就退回短 id */
  }
  return { label: '会话 ' + s.slice(-8), id: s }
}

/**
 * 谁在说话：读 ~/.dsh/qq-speaker.json（dsh-ayy-qq 写的）。
 * 结构：{ "session-xxx": { "昵称": "...", "QQ": "...", "时间": "...", "来源": "..." } }
 * ⚠ 这个文件可能还不存在 / 坏了 / 记录过期——一律当"没记录"，返回空串，绝不抛。
 */
export function speakerOf(sid) {
  const s = String(sid || '').trim()
  if (!s) return ''
  const all = readJson(PATHS.speakerFile, null)
  if (!all || typeof all !== 'object') return ''
  const rec = all[s]
  if (!rec || typeof rec !== 'object') return ''
  const nick = String(rec['昵称'] ?? rec['昵稱'] ?? rec.nickname ?? rec.name ?? '').trim()
  const qq = String(rec['QQ'] ?? rec['qq'] ?? '').trim()
  if (nick && qq) return `${nick}(${qq})`
  return nick || qq
}

const SID_KEYS = ['sessionId', 'sessionKey', 'sid', 'id', 'key']

/** 从执行上下文 / 参数里找出这条调用属于哪个会话 */
export function sessionIdOf(execCtx, args) {
  const ctxs = [execCtx, execCtx && execCtx.context, execCtx && execCtx.session, args]
  for (const c of ctxs) {
    if (!c || typeof c !== 'object') continue
    for (const k of SID_KEYS) {
      const v = c[k]
      if (typeof v === 'string' && /^session-/.test(v)) return { id: v, ctx: c, from: 'auto:' + k }
    }
    if (c.session && typeof c.session === 'object') {
      for (const k of ['id', 'sessionId', 'key']) {
        const v = c.session[k]
        if (typeof v === 'string' && v.trim()) return { id: v, ctx: c.session, from: 'auto:session.' + k }
      }
    }
  }
  return null
}

/** 一行来源：人看得懂的在前面，id 兜在后面，方便按 id 精确筛 */
export function srcLine(label, sid, speaker) {
  const tail = sid ? ` · ${sid}` : ''
  const who = speaker ? ` · 说的人 ${speaker}` : ''
  return `<!-- src: ${label} · ${stampHuman()}${tail}${who} -->`
}

/**
 * 这条是从哪来的：优先自动取会话，再退回她填的 scene，都没有就 unknown。
 * 说话人：调用方传了 speaker 就用它；没传就查 qq-speaker.json；都没有就留空。
 */
export function describeSource(args, execCtx) {
  const given = String((args && args.speaker) || '').trim()
  const hit = sessionIdOf(execCtx, args)
  if (hit) {
    const r = resolveScene(hit.id, hit.ctx)
    const sp = given || speakerOf(hit.id)
    return { value: r.label, id: r.id, from: hit.from, speaker: sp, line: srcLine(r.label, r.id, sp) }
  }
  const scene = String((args && args.scene) || '').trim()
  if (scene) {
    return { value: scene, id: '', from: 'arg:scene', speaker: given, line: srcLine(scene, '', given) }
  }
  return { value: 'unknown', id: '', from: 'none', speaker: '', line: srcLine('unknown', '') }
}

// ── 输出包装（各工具原本就是这么写的，schema 照抄不许改坏）────────────────

/** 结构类结果 */
export const objectOutput = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

/** 正文类结果：schema 直接声明 string，render 原样输出（照 dsh-core-memory 的写法） */
export const textOutput = () => ({
  schema: { type: 'string' },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : String(val?.text ?? '') }],
})

/**
 * recall.cjs —— 把某天某场景的对话原文导出成纯文本
 *
 * 为什么要做成独立进程：
 *   dsh 主机里 import node:zlib 的 zstd 可能不可用（Electron 的 Node 版本不确定），
 *   一旦 import 就炸会拖垮整个 preset。所以这里用 dsh 自带的 node.exe（v24，有 zstd）
 *   跑这个脚本，插件只负责 spawn + 读 stdout。
 *
 * 用法：
 *   node recall.cjs --day 2026-10-31 [--scene qq:private:632506748] [--json]
 *   node recall.cjs --list-scenes
 *
 * 注意：DSH_HOME 有值就用它（隔离测试指临时目录），否则仍是 ~/.dsh。
 */
'use strict'

const { readFileSync, readdirSync, existsSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')
const zlib = require('node:zlib')

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const SESSIONS_DIR = join(HOME, 'sessions')
const BRIDGE_CFG = join(HOME, 'qq-bridge-config.json')
const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd]

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : undefined
}

const readJson = (p, fb) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) : fb
  } catch {
    return fb
  }
}

const pad = (n) => String(n).padStart(2, '0')
const dayOf = (ms) => {
  const d = new Date(Number(ms))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const hhmm = (ms) => {
  const d = new Date(Number(ms))
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const todayStr = () => dayOf(Date.now())

/** 多帧拼接的 zstd 会话文件 → 记录数组 */
function decodeSession(file) {
  if (typeof zlib.zstdDecompressSync !== 'function') {
    throw new Error(`当前 node (${process.version}) 没有 zstdDecompressSync`)
  }
  const buf = readFileSync(file)
  const starts = []
  for (let i = 0; i <= buf.length - 4; i++) {
    if (
      buf[i] === ZSTD_MAGIC[0] &&
      buf[i + 1] === ZSTD_MAGIC[1] &&
      buf[i + 2] === ZSTD_MAGIC[2] &&
      buf[i + 3] === ZSTD_MAGIC[3]
    ) {
      starts.push(i)
    }
  }
  let text = ''
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : buf.length
    try {
      text += zlib.zstdDecompressSync(buf.subarray(starts[i], end)).toString('utf8')
    } catch {
      /* 跳过坏帧 */
    }
  }
  const out = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* 跳过坏行 */
    }
  }
  return out
}

/** 扫所有会话 */
function loadSessions() {
  const found = []
  const walk = (dir, depth = 0) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (!e.isDirectory()) continue
      if (e.name.startsWith('session-')) {
        const f = join(p, 'session.v4.jsonl.zstd')
        if (!existsSync(f)) continue
        let records
        try {
          records = decodeSession(f)
        } catch {
          continue
        }
        const head = records.find((r) => r && r.type === 'session')
        if (!head) continue
        found.push({
          id: head.id || e.name,
          cwd: head.cwd || '',
          preset: head.agentPreset || '',
          records,
        })
      } else {
        walk(p, depth + 1)
      }
    }
  }
  walk(SESSIONS_DIR)
  return found
}

const isCompanion = (s) =>
  s.preset === 'anyuanyue' ||
  s.records.some(
    (r) => r && r.type === 'agent-preset/selected' && JSON.stringify(r).includes('anyuanyue'),
  )

/** 场景表：键 → 会话 id 列表 */
function sceneMap(sessions) {
  const cfg = readJson(BRIDGE_CFG, {})
  const map = {}
  const bindings = Array.isArray(cfg['绑定']) ? cfg['绑定'] : []
  const privateInfo = bindings.find((b) => b && String(b['类型']).includes('私聊'))
  const groupInfo = bindings.find((b) => b && String(b['类型']).includes('群'))
  const qq = String(privateInfo?.['号码'] || cfg['私聊QQ'] || '')
  const privateSession = String(privateInfo?.['会话'] || cfg['私聊会话'] || '')
  const groupSession = String(groupInfo?.['会话'] || cfg['群会话'] || '')
  const groupNo = String(
    groupInfo?.['号码'] || (Array.isArray(cfg['群号']) ? cfg['群号'][0] : '') || '',
  )

  if (qq && privateSession) map[`qq:private:${qq}`] = [privateSession]
  if (groupNo && groupSession) map[`qq:group:${groupNo}`] = [groupSession]
  const dshChat = sessions.filter(isCompanion).map((s) => s.id)
  if (dshChat.length) map['dsh:chat'] = dshChat
  return map
}

const primaryScene = (map) => {
  const keys = Object.keys(map)
  return keys.find((k) => k.startsWith('qq:private:')) || keys[0] || 'dsh:chat'
}

/** 从一条记录里抠出正文 */
function bodyOf(rec) {
  const pick = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim()
  if (rec.type === 'user/message') return pick(rec.data?.content)
  return pick(rec.data?.message?.content)
}

/** 去掉每轮注入的运行时/系统噪音，只留人说的话 */
const NOISE_LINE = [
  /^Current runtime context\b/,
  /^Time sampled while preparing turn\b/,
  /^Browser time zone for this request\b/,
  /^Elapsed since the preceding\b/,
  /^This snapshot supersedes\b/,
  /^<system\b/,
  /^<\/(system|local-command|user_instructions)>/,
  /^<(local-command|user_instructions)\b/,
  /^\[attachments\]/,
  /^#+ ?(记忆|MEMORY)/,
  /^The approval policy changed from/,
  /^Approval prompts are disabled in this session/,
  /^Filesystem instructions/,
  /^<(task|user_query)>/,
  /^\d+\. \*\*Continue/,
]
const BRIDGE_TAG = /^【(QQ私聊|QQ群|群聊)】\s*/

/** 每轮追加在用户消息后面的运行时/技能清单：从它开始整段砍掉 */
const INJECT_MARK = [
  /\nCurrent runtime context\./,
  /^Current runtime context\./,
  /\nA skill is a reusable set of task-specific instructions/,
  /^A skill is a reusable set of task-specific instructions/,
  /\nCurrent DSH file policy:/,
  /^Current DSH file policy:/,
  /\nCurrent working directory:/,
  /^Current working directory:/,
  /\nIf the user names a skill, or the task clearly matches/,
]

function clean(body) {
  let text = body
  let cut = text.length
  for (const re of INJECT_MARK) {
    const m = text.match(re)
    if (m && m.index < cut) cut = m.index
  }
  text = text.slice(0, cut)

  const kept = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !NOISE_LINE.some((re) => re.test(l)))
    .join('\n')
    .trim()
  return kept.replace(BRIDGE_TAG, '').trim()
}

function transcript(sessions, ids, day) {
  const wanted = new Set(ids)
  const seenId = new Set()
  const rows = []
  for (const s of sessions) {
    if (!wanted.has(s.id)) continue
    for (const r of s.records) {
      if (!r || (r.type !== 'user/message' && r.type !== 'assistant/message')) continue
      if (dayOf(r.time) !== day) continue
      const mid = r.data?.id
      if (mid) {
        if (seenId.has(mid)) continue // fork 出来的会话里同一条消息只留一份
        seenId.add(mid)
      }
      const body = clean(bodyOf(r))
      if (!body) continue
      rows.push({ t: Number(r.time), who: r.type === 'user/message' ? 'ta' : '我', body })
    }
  }
  rows.sort((a, b) => a.t - b.t)

  // 没有 id 的重复（重试）再按「同人同内容同一分钟」去一次
  const out = []
  const seenKey = new Set()
  for (const r of rows) {
    const key = `${r.who}|${Math.round(r.t / 60000)}|${r.body}`
    if (seenKey.has(key)) continue
    seenKey.add(key)
    out.push(r)
  }
  return out
}

function main() {
  const sessions = loadSessions()
  const map = sceneMap(sessions)

  if (flag('list-scenes')) {
    const lines = Object.entries(map).map(([k, v]) => {
      const hits = sessions.filter((s) => v.includes(s.id))
      const msgs = hits.reduce(
        (n, s) =>
          n +
          s.records.filter((r) => r && (r.type === 'user/message' || r.type === 'assistant/message'))
            .length,
        0,
      )
      return `${k}\t${v.length} 会话\t${msgs} 条消息`
    })
    process.stdout.write(lines.join('\n') + '\n')
    return
  }

  const day = String(flag('day') || todayStr())
  let scene = String(flag('scene') || primaryScene(map))
  let ids = map[scene] || []

  if (!ids.length) {
    ids = [...new Set(Object.values(map).flat())]
    if (!ids.length) ids = sessions.filter(isCompanion).map((s) => s.id)
  }

  let rows = transcript(sessions, ids, day)
  if (!rows.length) {
    const all = [...new Set([...ids, ...sessions.filter(isCompanion).map((s) => s.id)])]
    const wider = transcript(sessions, all, day)
    if (wider.length) {
      rows = wider
      scene = `${scene}（退回到全部陪伴会话）`
    }
  }

  if (flag('json')) {
    process.stdout.write(JSON.stringify({ day, scene, count: rows.length, rows }, null, 1))
    return
  }
  if (!rows.length) {
    process.stdout.write(`（${day} · ${scene} 没有对话记录）\n`)
    return
  }
  const out = rows.map((r) => `${hhmm(r.t)} ${r.who}：${r.body}`).join('\n\n')
  process.stdout.write(`# ${day} · ${scene} · ${rows.length} 条\n\n${out}\n`)
}

main()

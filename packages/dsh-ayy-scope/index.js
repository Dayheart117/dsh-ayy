/**
 * dsh-ayy-scope —— 只给「指定会话」注入她的记忆和人格
 *
 * 要解决的两件事：
 *   1. 记忆外溢：MEMORY.md 原来是全局注入，工作会话也会读到她的设定。
 *   2. 人格固化：人格写在 preset 里，改一次要重启、还要手工同步两份。
 *
 * 做法：往白名单里的每个 agent 自己的 ctx 上挂一段 systemPrompt（per-agent，
 * 天然只作用于那个会话）。内容每轮**从文件现读**，所以她改完下一轮就生效。
 *
 * 白名单在 ~/.dsh/ayy-scope/config.json：
 *   { "会话": ["session-xxx", "session-yyy"], "人格文件": "...", "记忆文件": "..." }
 * 留空 = 一个都不注入（宁可少注入，也不要外溢）。
 */
import { existsSync, readFileSync, mkdirSync, appendFileSync, statSync, renameSync, writeFileSync, watch } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-scope'
export const inject = ['agents']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-scope')
const CFG = join(DIR, 'config.json')
const LOG = join(DIR, 'scope.log')

function log(msg) {
  try {
    mkdirSync(DIR, { recursive: true })
    const size = existsSync(LOG) ? statSync(LOG).size : 0
    if (size > 512 * 1024) renameSync(LOG, LOG + '.1')
    appendFileSync(LOG, `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}\n`)
  } catch {
    /* 日志写不进去也不能影响注入 */
  }
}

function readCfg() {
  const fallback = {
    会话: [],
    人格文件: join(HOME, 'personas', 'who-i-am.md'),
    记忆文件: join(HOME, 'personas', 'her-memory.md'),
  }
  try {
    if (!existsSync(CFG)) {
      mkdirSync(DIR, { recursive: true })
      const body = JSON.stringify(fallback, null, 2)
      writeFileSync(CFG, body, 'utf8')
      return fallback
    }
    const raw = JSON.parse(readFileSync(CFG, 'utf8').replace(/^\uFEFF/, ''))
    return {
      会话: Array.isArray(raw['会话']) ? raw['会话'].map(String) : [],
      人格文件: String(raw['人格文件'] || fallback['人格文件']),
      记忆文件: String(raw['记忆文件'] || fallback['记忆文件']),
    }
  } catch {
    return fallback
  }
}

function readText(p) {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8').trim() : ''
  } catch {
    return ''
  }
}

/** 从 agent.session 里抠会话 id（不同版本字段名不同） */
function sessionIdOf(session) {
  if (!session) return ''
  for (const k of ['id', 'sessionId', 'key', 'sessionKey', 'sid']) {
    const v = session[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return ''
}

const MOUNTED = new Map() // sid -> disposer

export function apply(ctx) {
  mkdirSync(DIR, { recursive: true })
  log('已加载：只给白名单会话注入她的记忆 + 人格')

  function buildText() {
    const cfg = readCfg()
    const self = readText(cfg.人格文件)
    const mem = readText(cfg.记忆文件)
    if (!self && !mem) return ''
    const parts = []
    if (self) parts.push('【我是谁】（你自己写的，随时可改）\n' + self)
    if (mem) parts.push('【我记得的事】\n' + mem)
    return parts.join('\n\n')
  }

  function mount(agent, sid) {
    try {
      const off = agent.ctx.systemPrompt.section({
        name: 'ayy-scope:identity-memory',
        order: 89990, // 排在最后：前面全部命中缓存，只有这一段每轮变
        interpolate: false, // 纯文本，别让宿主当模板解析
        text: buildText,
      })
      MOUNTED.set(sid, typeof off === 'function' ? off : () => {})
      log(`挂上 ${sid}`)
    } catch (error) {
      log(`挂不上 ${sid}：${error && error.message}`)
    }
  }

  function unmount(sid) {
    const off = MOUNTED.get(sid)
    if (!off) return
    try {
      off()
    } catch {
      /* 卸载失败也无所谓，agent 本身走了 */
    }
    MOUNTED.delete(sid)
    log(`卸下 ${sid}`)
  }

  let lastList = ''
  function tick() {
    try {
      const cfg = readCfg()
      const allow = new Set(cfg['会话'])
      const list = (ctx.agents && typeof ctx.agents.list === 'function' ? ctx.agents.list() : []) || []
      const seen = new Set()
      for (const agent of list) {
        const sid = sessionIdOf(agent && agent.session)
        if (!sid) continue
        if (!allow.has(sid)) {
          if (MOUNTED.has(sid)) unmount(sid)
          continue
        }
        seen.add(sid)
        if (!MOUNTED.has(sid)) mount(agent, sid)
      }
      // 会话没了就卸
      for (const sid of [...MOUNTED.keys()]) if (!seen.has(sid)) unmount(sid)

      const sig = [...allow].sort().join(',') + '|' + [...seen].sort().join(',')
      if (sig !== lastList) {
        lastList = sig
        log(`白名单=${allow.size} 在线=${seen.size}`)
      }
    } catch (error) {
      log(`tick 出错（已忽略）：${error && error.message}`)
    }
  }

  readCfg() // 顺便把配置文件建出来，才 watch 得到
  tick()
  const timer = setInterval(tick, 10 * 1000)
  if (typeof timer.unref === 'function') timer.unref()

  // 面板一保存就立刻重新检查（操作系统文件通知，不是轮询）。
  // 这样勾了白名单不用等最多 10 秒；10 秒那个 tick 只留给"发现新会话"。
  let watcher = null
  let debounce = null
  try {
    watcher = watch(CFG, { persistent: false }, () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => {
        debounce = null
        log('配置文件变了，立刻重新检查')
        tick()
      }, 250)
      if (debounce && typeof debounce.unref === 'function') debounce.unref()
    })
    if (watcher && typeof watcher.unref === 'function') watcher.unref()
  } catch (error) {
    log(`文件监听挂不上（退回 10 秒轮询）：${error && error.message}`)
  }

  ctx.effect(() => () => {
    clearInterval(timer)
    if (debounce) clearTimeout(debounce)
    try {
      if (watcher) watcher.close()
    } catch {
      /* 关不掉也无所谓，进程退出就没了 */
    }
    for (const sid of [...MOUNTED.keys()]) unmount(sid)
    log('已卸载（全部摘掉）')
  })
}

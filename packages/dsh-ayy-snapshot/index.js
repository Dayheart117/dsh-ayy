/**
 * dsh-ayy-snapshot —— 她的记忆随时可回滚
 *
 * 为什么需要它：她也握有改核心记忆/自述/技能的能力，而日备份是每天一次。
 * 她一天里改了很多回，出事时那一天的所有改动全缠在一起，分不出哪一步改坏的。
 *
 * 做法：每 5 分钟看一眼 `~/.dsh/memory`、`~/.dsh/personas`、`~/.dsh/skills` 的签名，
 * 变了就调一次已有的备份脚本（它会复制 + commit 一次）。没变就什么都不做。
 * 这样她每一次实质改动，都会在 git 里留一条可以单独回滚的提交。
 */
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, appendFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const name = 'dsh-ayy-snapshot'
export const inject = ['timer']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const OUT_DIR = join(HOME, 'ayy-snapshot')
const LOG_FILE = join(OUT_DIR, 'snapshot.log')
const LOG_MAX = 1024 * 1024
const SCRIPT = 'E:\\AI\\dsh-ayy\\tools\\backup-memory.ps1'
const INTERVAL_MS = 5 * 60 * 1000
const WATCH = ['memory', 'personas', 'skills'].map((d) => join(HOME, d))

let lastSig = ''

function rotateLog() {
  try {
    if (!existsSync(LOG_FILE)) return
    if (statSync(LOG_FILE).size < LOG_MAX) return
    renameSync(LOG_FILE, LOG_FILE + '.1')
  } catch {
    /* 转不动就算了 */
  }
}

function log(msg) {
  try {
    rotateLog()
    appendFileSync(LOG_FILE, `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}\n`)
  } catch {
    /* 日志写不进去也不能影响主流程 */
  }
}

/** 只统计会改变的东西：mtime + 大小，避免每次读全文 */
function signature() {
  const parts = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        // 跳过旧版归档和回收站：那些每备份一次就会变，会把签名搅乱
        if (['notes-history', 'diary-history', 'who-i-am-history', '.trash', 'transcripts'].includes(e.name)) continue
        walk(p, depth + 1)
        continue
      }
      if (!/\.(md|json|txt)$/.test(e.name)) continue
      try {
        const st = statSync(p)
        parts.push(`${e.name}:${st.size}:${Math.floor(st.mtimeMs / 1000)}`)
      } catch {
        /* 读不到跳过 */
      }
    }
  }
  for (const d of WATCH) {
    if (existsSync(d)) walk(d, 0)
  }
  parts.sort()
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16)
}

function snapshot(reason) {
  const started = Date.now()
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { stdio: 'ignore', timeout: 120000, windowsHide: true },
  )
  const ms = Date.now() - started
  const ok = r.status === 0
  log(`${ok ? '已提交' : '提交失败'}（${reason}, ${ms}ms, exit=${r.status}${r.error ? ', ' + r.error.message : ''}）`)
  return ok
}

export function apply(ctx) {
  mkdirSync(OUT_DIR, { recursive: true })
  log(`已加载：每 ${INTERVAL_MS / 60000} 分钟看一眼 memory/personas/skills，变了就提交一次`)

  const tick = () => {
    try {
      const sig = signature()
      if (!sig) return
      if (sig === lastSig) return
      // 首次运行只记基线，不提交（避免刚加载就打一个空提交）
      if (!lastSig) {
        lastSig = sig
        log(`基线：${sig}`)
        return
      }
      lastSig = sig
      if (!existsSync(SCRIPT)) {
        log(`找不到备份脚本：${SCRIPT}`)
        return
      }
      snapshot(`签名 ${sig}`)
    } catch (error) {
      log(`tick 出错（已忽略）：${error && error.message}`)
    }
  }

  // 启动 90 秒后先看一次，然后每 5 分钟
  const timers = []
  timers.push(setTimeout(tick, 90 * 1000))
  const interval = setInterval(tick, INTERVAL_MS)
  if (typeof interval.unref === 'function') interval.unref()
  for (const t of timers) if (typeof t.unref === 'function') t.unref()

  ctx.effect(() => () => {
    clearInterval(interval)
    for (const t of timers) clearTimeout(t)
    log('已卸载（定时器都收掉了）')
  })
}

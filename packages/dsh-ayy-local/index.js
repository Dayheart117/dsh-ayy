/**
 * dsh-ayy-local —— 本地 Ollama 按需开关
 *
 * 为什么不自启：8G 显存要和语音 daemon 抢，而且白天基本不用。
 * 让她在真要用（做向量检索、摘要、归类）时自己开，用完关。
 *
 * 用法：ayy_local(action:"up"|"down"|"status")
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-local'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const DIR = join(HOME, 'ayy-local')
const LOG = join(DIR, 'local.log')
const BASE = 'http://127.0.0.1:11434'
const EXE = 'E:\\ollama\\ollama.exe'

function log(msg) {
  try {
    mkdirSync(DIR, { recursive: true })
    if (existsSync(LOG) && statSync(LOG).size > 512 * 1024) renameSync(LOG, LOG + '.1')
    appendFileSync(LOG, `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}\n`)
  } catch {
    /* 日志失败不影响功能 */
  }
}

async function ping(timeoutMs = 2000) {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    const r = await fetch(`${BASE}/api/tags`, { signal: ac.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    return Array.isArray(j.models) ? j.models.map((m) => m.name) : []
  } catch {
    return null
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureUp(maxWaitMs = 60000) {
  if (await ping()) return { started: false }
  if (!existsSync(EXE)) throw new Error(`找不到 ollama：${EXE}（改一下插件里的 EXE 常量）`)
  // detached：不让它跟着这个工具调用被回收
  const child = spawn(EXE, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
  const t0 = Date.now()
  while (Date.now() - t0 < maxWaitMs) {
    await sleep(1500)
    if (await ping()) return { started: true, seconds: Math.round((Date.now() - t0) / 1000) }
  }
  throw new Error(`等了 ${maxWaitMs / 1000} 秒还没起来，看 $env:TEMP 或 ollama 日志`)
}

async function ensureDown() {
  if (!(await ping())) return { stopped: false }
  // 先让模型卸载（keep_alive 0），再杀进程
  try {
    await fetch(`${BASE}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'bge-m3:latest', keep_alive: 0 }),
    })
  } catch {
    /* 忽略：本来就要关 */
  }
  try {
    execFileSync('taskkill', ['/IM', 'ollama.exe', '/F'], { stdio: 'ignore', timeout: 20000 })
    execFileSync('taskkill', ['/IM', 'ollama app.exe', '/F'], { stdio: 'ignore', timeout: 20000 })
  } catch {
    /* 进程不在也正常 */
  }
  for (let i = 0; i < 10; i++) {
    await sleep(800)
    if (!(await ping(1500))) return { stopped: true }
  }
  return { stopped: false, note: '发了关闭命令但端口还有响应' }
}

async function psInfo() {
  try {
    const r = await fetch(`${BASE}/api/ps`, { timeout: 3000 })
    if (!r.ok) return null
    const j = await r.json()
    return (j.models || []).map((m) => ({
      模型: m.name,
      显存: m.size_vram ? Math.round(m.size_vram / 1024 / 1024) + ' MB' : '—',
      驻留到: m.expires_at || '—',
    }))
  } catch {
    return null
  }
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_local',
    description:
      '本地 Ollama 模型的开关（免费，不花 token）。\n' +
      '· up：打开（没开就拉起来，等它就绪；起来了会返回等了多久）\n' +
      '· down：关掉，把显存还回去（语音要用显存时尤其要关）\n' +
      '· status：看开没开、有哪些模型、现在占了多大显存\n' +
      '需要做向量检索/摘要/归类时先 up，做完 down。平时别开着。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['up', 'down', 'status'], description: '默认 status' },
      },
      required: ['action'],
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'status')

      if (action === 'up') {
        const r = await ensureUp()
        const models = (await ping()) || []
        log(`up: ${r.started ? '启动 ' + r.seconds + 's' : '本来就在跑'}`)
        return { ok: true, ...r, 模型: models }
      }

      if (action === 'down') {
        const r = await ensureDown()
        log(`down: ${r.stopped ? '已关' : '没关掉'}`)
        return { ok: r.stopped, ...r, 提示: r.stopped ? '显存已释放' : '还有响应，可能进程名叫别的' }
      }

      const models = await ping()
      const ps = models ? await psInfo() : null
      return {
        ok: true,
        在跑: models !== null,
        模型: models || [],
        当前驻留: ps && ps.length ? ps : '（没有模型驻留）',
        说明: models === null ? '现在没开；要用就 ayy_local(action:"up")' : '开着；不用了记得 down',
      }
    },
  })
}

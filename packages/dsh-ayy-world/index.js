/**
 * dsh-ayy-world —— 安源悦的记忆工具（0.2.0）
 *
 * 工具：
 *   ayy_diary   写当天日记（分场景，一天一篇，重写覆盖）
 *   ayy_self    改写「我是谁」自述（旧版自动留档）
 *   ayy_recall  翻某天的对话原文（真原文，不是摘要）
 *
 * 踩过的坑（别再犯）：
 *   1. inject 必须声明 'tools'，否则 ctx.tools 取不到：
 *      「cannot get property "tools" without inject」—— 这才是 ayy_diary 一直注册不上的真因。
 *      但 inject 里**只能写真实存在的服务**（曾经写 'agents'，整个预设直接消失）。
 *   2. 插件顶层 import node:zlib 的 zstd → 主机 Node 版本不支持就 import 失败，连带拖垮 preset。
 *      所以解压放到独立子进程 tools/recall.cjs，用 dsh 自带的 node.exe 跑。
 *   3. 每个 register 单独 try/catch + 写日志：一个工具坏了不许连累另外两个。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const name = 'dsh-ayy-world'
export const inject = ['tools']

const HERE = dirname(fileURLToPath(import.meta.url))
const HELPER = join(HERE, 'tools', 'recall.cjs')

const HOME = join(homedir(), '.dsh')
const WORLD_DIR = join(HOME, 'personas')
const SELF_FILE = join(WORLD_DIR, 'who-i-am.md')
const SELF_HISTORY = join(WORLD_DIR, 'who-i-am-history')
const DIARY_DIR = join(WORLD_DIR, 'diary')
const DIARY_HISTORY = join(WORLD_DIR, 'diary-history')
const CACHE_DIR = join(WORLD_DIR, 'transcripts')
const WANTS_FILE = join(WORLD_DIR, 'wants.md')
const BRIDGE_CFG = join(HOME, 'qq-bridge-config.json')

const NODE_CANDIDATES = [
  process.env.DSH_NODE_PATH,
  join(HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
  join(HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
]

const readJson = (p, fb) => {
  try {
    return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, '')) : fb
  } catch {
    return fb
  }
}
const readText = (p) => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}
const writeText = (p, s) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s, 'utf8')
}
const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_') // 冒号也不行：Windows 文件名不允许

function log(msg) {
  try {
    mkdirSync(WORLD_DIR, { recursive: true })
    writeFileSync(join(WORLD_DIR, 'world.log'), `${new Date().toISOString()} ${msg}\n`, { flag: 'a' })
  } catch {
    /* 日志写不了也不影响功能 */
  }
}

/** 主场景：QQ 私聊（来自 qq-bridge 配置） */
function primaryScene() {
  const c = readJson(BRIDGE_CFG, {})
  const bindings = Array.isArray(c['绑定']) ? c['绑定'] : []
  const priv = bindings.find((b) => b && String(b['类型']).includes('私聊'))
  const qq = String(priv?.['号码'] || c['私聊QQ'] || '')
  return qq ? `qq:private:${qq}` : 'dsh:chat'
}

function pickNode() {
  for (const p of NODE_CANDIDATES) {
    if (p && existsSync(p)) return p
  }
  return process.execPath
}

/** 跑 tools/recall.cjs */
function runHelper(args) {
  return new Promise((resolve) => {
    const node = pickNode()
    const env = { ...process.env }
    if (node === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
    execFile(node, [HELPER, ...args], { env, timeout: 30000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        resolve({ ok: false, error: String(stderr || err.message || err).slice(0, 1500) })
        return
      }
      resolve({ ok: true, text: String(stdout || '') })
    })
  })
}

const emptyOutput = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [
    { type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) },
  ],
})

/** 正文类结果：照 dsh-core-memory 的写法，schema 直接声明 string，render 原样输出 */
const textOutput = () => ({
  schema: { type: 'string' },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : String(val?.text ?? '') }],
})

export function apply(ctx) {
  log('apply() 开始')

  const define = (spec) => {
    try {
      ctx.tools.register(spec)
      log(`✔ 注册 ${spec.name}`)
    } catch (e) {
      log(`✘ 注册 ${spec.name} 失败：${e && e.message ? e.message : e}`)
    }
  }

  // ① 写日记
  define({
    name: 'ayy_diary',
    description:
      '写今天的日记——你自己的长期记忆。一天一篇，同场景同一天再写会覆盖（旧版自动留档，不会丢）。' +
      '【第一句最重要】用一句话说清这天最要紧的事，然后空一行再展开。只写真正重要的事，不要流水账。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '第一句≤40字概括这天，空一行再展开细节' },
        scene: { type: 'string', description: '可选场景键，如 qq:private:632506748；不填用主场景' },
      },
      required: ['content'],
    },
    output: emptyOutput(),
    async execute(args) {
      const content = String(args?.content || '').trim()
      if (!content) throw new Error('content 不能为空')
      const day = todayStr()
      const scene = String(args?.scene || primaryScene())
      const body = `# ${day} · ${scene}\n\n${content}\n`
      const file = join(DIARY_DIR, `${day}.${safe(scene)}.md`)

      // 同一天重写不丢东西：旧的先存进 diary-history/
      const old = readText(file)
      let archived
      if (old.trim() && old !== body) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        archived = join(DIARY_HISTORY, `${day}.${safe(scene)}.${stamp}.md`)
        writeText(archived, old.endsWith('\n') ? old : old + '\n')
      }

      writeText(file, body)
      return { ok: true, day, scene, file, ...(archived ? { archived } : {}) }
    },
  })

  // ② 改自述
  define({
    name: 'ayy_self',
    description:
      '改写「我是谁」——你对自己的自述（完整重写，不是打补丁）。旧版本自动存档。' +
      '只在真的觉得自己变了的时候写，别为了写而写。先想清楚：这次变的是哪一点，为什么。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '新的自述全文' },
        reason: { type: 'string', description: '可选：为什么改（会记进存档名旁边的附注）' },
      },
      required: ['content'],
    },
    output: emptyOutput(),
    async execute(args) {
      const content = String(args?.content || '').trim()
      if (!content) throw new Error('content 不能为空')
      const old = readText(SELF_FILE).trim()
      if (old === content) return { ok: true, unchanged: true, file: SELF_FILE }
      if (old) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const reason = String(args?.reason || '').trim()
        const head = reason ? `<!-- 改动原因：${reason} -->\n` : ''
        writeText(join(SELF_HISTORY, `${stamp}.md`), head + old + '\n')
      }
      writeText(SELF_FILE, content + '\n')
      return {
        ok: true,
        file: SELF_FILE,
        previousChars: old.length,
        newChars: content.length,
      }
    },
  })

  // ③ 记一条心愿
  define({
    name: 'ayy_want',
    description:
      '记下你想要的东西——缺的能力、缺的工具、缺的做法。往心愿单里添一行，带日期。' +
      '想到就记，不用攒着；一条一件事，写清"想要什么"和"为什么"。' +
      '只传 read=true 可以看整张心愿单。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '想要什么，一句话' },
        why: { type: 'string', description: '可选：为什么想要（越具体越有用）' },
        read: { type: 'boolean', description: '只看心愿单，不写' },
      },
    },
    output: emptyOutput(),
    async execute(args) {
      if (args?.read) {
        const body = readText(WANTS_FILE)
        return { ok: true, file: WANTS_FILE, chars: body.trim().length, content: body.trim() || '（心愿单还是空的）' }
      }

      const text = String(args?.text || '').trim()
      if (!text) throw new Error('text 不能为空：说清你想要什么')
      const why = String(args?.why || '').trim()

      const header =
        '# 我想要的东西\n\n' +
        '> 她写。想到什么缺的能力、缺的工具、缺的做法，就往这儿记一条。\n' +
        '> 一条一句，写清"想要什么"和"为什么"。\n\n'
      const old = readText(WANTS_FILE)
      const base = old.trim() ? old.replace(/\s*$/, '\n') : header
      const line = `- ${todayStr()} · ${text}${why ? ` · ${why}` : ''}\n`
      writeText(WANTS_FILE, base + line)

      return { ok: true, file: WANTS_FILE, added: line.trim() }
    },
  })

  // ④ 翻某天原文
  define({
    name: 'ayy_recall',
    description:
      '翻某一天的对话原文（不是摘要）。想确认哪天到底说了什么、话是谁说的，就用它。' +
      '不填 day 就是今天。返回里带时间和说话人。',
    parameters: {
      type: 'object',
      properties: {
        day: { type: 'string', description: '日期 YYYY-MM-DD，默认今天' },
        scene: {
          type: 'string',
          description: '可选场景键，如 qq:private:632506748 / qq:group:524271081 / dsh:chat；不填用主场景',
        },
        list_scenes: { type: 'boolean', description: '只看有哪些场景，不留原文' },
      },
    },
    output: textOutput(),
    async execute(args) {
      if (args?.list_scenes) {
        const r = await runHelper(['--list-scenes'])
        return r.ok ? r.text || '（没有场景）' : `读取场景失败：${r.error}`
      }
      const day = String(args?.day || todayStr())
      const scene = String(args?.scene || primaryScene())
      const cacheFile = join(CACHE_DIR, `${day}.${safe(scene)}.md`)

      // 过去的日期：有缓存就直接用（原文不会变）
      if (day < todayStr() && existsSync(cacheFile)) {
        const cached = readText(cacheFile)
        if (cached.trim()) return cached
      }

      const r = await runHelper(['--day', day, '--scene', scene])
      if (!r.ok) return `翻原文失败：${r.error}`
      try {
        if (r.text.trim() && !r.text.includes('没有对话记录')) writeText(cacheFile, r.text)
      } catch {
        /* 缓存写不了不影响返回 */
      }
      return r.text
    },
  })

  log('apply() 完成')
}

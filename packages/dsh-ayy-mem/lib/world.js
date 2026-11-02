/**
 * dsh-ayy-mem · world —— 她的日常账本：日记、自述、心愿、翻原文
 *
 * 工具：ayy_diary / ayy_self / ayy_want / ayy_recall（名字和行为都照旧）
 *
 * 踩过的坑（别再犯）：
 *   1. inject 必须声明 'tools'，否则 ctx.tools 取不到。
 *      但 inject 里**只能写真实存在的服务**（曾经写 'agents'，整个预设直接消失）。
 *   2. 插件顶层 import node:zlib 的 zstd → 主机 Node 版本不支持就 import 失败，连带拖垮 preset。
 *      所以解压放到独立子进程 tools/recall.cjs，用 dsh 自带的 node.exe 跑。
 *   3. 每个 register 单独 try/catch + 写日志：一个工具坏了不许连累别的。
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  PATHS,
  readText,
  writeText,
  todayStr,
  hhmm,
  safe,
  stampIso,
  primaryScene,
  objectOutput,
  textOutput,
} from './common.js'

const HELPER = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'recall.cjs')

// 运行时目录看真实 HOME，不看 DSH_HOME（隔离测试时 DSH_HOME 是临时目录）
const RUNTIME_HOME = join(homedir(), '.dsh')
const NODE_CANDIDATES = [
  process.env.DSH_NODE_PATH,
  join(RUNTIME_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
  join(RUNTIME_HOME, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node'),
]

function pickNode() {
  for (const p of NODE_CANDIDATES) {
    if (p && existsSync(p)) return p
  }
  return process.execPath
}

/** 跑 tools/recall.cjs（独立进程：老 Node 没有 zstd 也不连累插件） */
function runHelper(args) {
  return new Promise((resolve) => {
    const node = pickNode()
    const env = { ...process.env }
    if (node === process.execPath) env.ELECTRON_RUN_AS_NODE = '1'
    execFile(
      node,
      [HELPER, ...args],
      { env, timeout: 30000, maxBuffer: 32 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err && !stdout) {
          resolve({ ok: false, error: String(stderr || err.message || err).slice(0, 1500) })
          return
        }
        resolve({ ok: true, text: String(stdout || '') })
      },
    )
  })
}

export function register(define) {
  // ① 写日记
  define({
    name: 'ayy_diary',
    description:
      '写今天的日记——你自己的账本。**一天一个文件，不分场合**：不管在群里、私聊还是网页写的，都进同一天同一篇，' +
      '按时间往后排。想到就写，不用凑每日。' +
      '【第一句最重要】用一句话说清这次要记的事，然后空一行再展开。只写要紧的，不要流水账。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '第一句≤40字概括，空一行再展开细节' },
        scene: {
          type: 'string',
          description: '可选：这段写在哪（qq:group:xxx / qq:private:xxx / dsh:chat），只做标注，不影响分文件',
        },
      },
      required: ['content'],
    },
    output: objectOutput(),
    async execute(args) {
      const content = String(args?.content || '').trim()
      if (!content) throw new Error('content 不能为空')
      const day = todayStr()
      const scene = String(args?.scene || primaryScene())
      const file = join(PATHS.diary, `${day}.md`)

      // 一天一个文件；同一篇里按时间追加小节，不再按场合拆家、也不覆盖。
      const existing = readText(file)
      const header = existing.trim() ? '' : `# ${day}\n`
      const section = `\n## ${hhmm()} · ${scene}\n\n${content}\n`
      writeText(file, (existing.trim() ? existing.replace(/\s*$/, '\n') : header) + section)

      const entries = (readText(file).match(/^## /gm) || []).length
      return { ok: true, day, scene, file, entries }
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
    output: objectOutput(),
    async execute(args) {
      const content = String(args?.content || '').trim()
      if (!content) throw new Error('content 不能为空')
      const old = readText(PATHS.self).trim()
      if (old === content) return { ok: true, unchanged: true, file: PATHS.self }
      if (old) {
        const stamp = stampIso()
        const reason = String(args?.reason || '').trim()
        const head = reason ? `<!-- 改动原因：${reason} -->\n` : ''
        writeText(join(PATHS.selfHistory, `${stamp}.md`), head + old + '\n')
        // 留痕：标一下这一版是谁写的，设置面板靠它区分「使用者改的」和「她自己改的」
        try {
          writeText(join(PATHS.selfHistory, `${stamp}.source`), '她自己\n')
        } catch {
          /* 留痕失败不影响正文写入 */
        }
      }
      writeText(PATHS.self, content + '\n')
      return {
        ok: true,
        file: PATHS.self,
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
    output: objectOutput(),
    async execute(args) {
      if (args?.read) {
        const body = readText(PATHS.wants)
        return {
          ok: true,
          file: PATHS.wants,
          chars: body.trim().length,
          content: body.trim() || '（心愿单还是空的）',
        }
      }

      const text = String(args?.text || '').trim()
      if (!text) throw new Error('text 不能为空：说清你想要什么')
      const why = String(args?.why || '').trim()

      const header =
        '# 我想要的东西\n\n' +
        '> 她写。想到什么缺的能力、缺的工具、缺的做法，就往这儿记一条。\n' +
        '> 一条一句，写清"想要什么"和"为什么"。\n\n'
      const old = readText(PATHS.wants)
      const base = old.trim() ? old.replace(/\s*$/, '\n') : header
      const line = `- ${todayStr()} · ${text}${why ? ` · ${why}` : ''}\n`
      writeText(PATHS.wants, base + line)

      return { ok: true, file: PATHS.wants, added: line.trim() }
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
      const cacheFile = join(PATHS.transcripts, `${day}.${safe(scene)}.md`)

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
}

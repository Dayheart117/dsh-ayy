/**
 * dsh-ayy-ledger —— 跨场合的短期记忆
 *
 * 她同时活在 QQ 私聊 / 群 / 网页几间会话里，历史不互通，只共享 MEMORY.md。
 * 这个插件维护 MEMORY.md 里的「## 最近动态」一节：最多 5 条，每轮注入所有会话。
 * 挤出去的沉到 ~/.dsh/personas/ledger/<年-月>.<场景>.md（只增不删）。
 *
 * 不设硬性配额：只在返回值里给她看得见的计数，收不收由她自己判断。
 * 不碰 systemPrompt——只改 core-memory 本来就会读的那个 markdown 文件。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-ledger'
export const inject = ['tools']

const HOME = join(homedir(), '.dsh')
const MEMORY_FILE = join(HOME, 'memory', 'MEMORY.md')
const BACKUP_FILE = join(HOME, 'memory', 'MEMORY.md.bak')
const LEDGER_DIR = join(HOME, 'personas', 'ledger')
const BRIDGE_CFG = join(HOME, 'qq-bridge-config.json')

const SECTION = '## 最近动态'
const MAX_ITEMS = 5

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
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, s, 'utf8')
}
const pad = (n) => String(n).padStart(2, '0')
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d = new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')
const monthStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`

/** 默认场景：QQ 私聊那个人 */
function defaultScene() {
  const c = readJson(BRIDGE_CFG, {})
  const bindings = Array.isArray(c['绑定']) ? c['绑定'] : []
  const priv = bindings.find((b) => b && String(b['类型']).includes('私聊'))
  const qq = String(priv?.['号码'] || c['私聊QQ'] || '')
  return qq ? `qq:private:${qq}` : 'dsh:chat'
}

/** 把文件拆成 [section 标题, 保持的说明行, 动态条目] */
function parseSection(text) {
  const idx = text.indexOf(SECTION)
  if (idx < 0) return null
  const after = text.slice(idx + SECTION.length)
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
  return { before: text.slice(0, idx), noteLines, items, rest }
}

const rebuild = (parsed) =>
  parsed.before + SECTION + '\n' + parsed.noteLines.join('\n') + '\n' +
  (parsed.items.length ? parsed.items.join('\n') + '\n' : '\n') + parsed.rest

/** 条目形如 `- 2026-11-01 08:05 · qq:group:123 · 内容`，取出其中的场景 */
function sceneOfLine(line) {
  const parts = String(line).replace(/^-\s*/, '').split('·')
  return parts.length >= 3 ? parts[1].trim() : defaultScene()
}

function archiveLine(line) {
  const file = join(LEDGER_DIR, `${monthStr()}.${safe(sceneOfLine(line))}.md`)
  const header = existsSync(file) ? '' : `# ${monthStr()} · 动态流水\n\n`
  writeText(file, (existsSync(file) ? readText(file).replace(/\s*$/, '\n') : header) + line + '\n')
  return file
}

/** 今天记了几条（数条目里的时间前缀） */
function todayCount(items) {
  const t = todayStr()
  return items.filter((l) => l.startsWith(`- ${t} `) || l.includes(` ${t} `)).length
}

function monthStats() {
  if (!existsSync(LEDGER_DIR)) return { files: 0, lines: 0 }
  let files = 0
  let lines = 0
  for (const f of readdirSync(LEDGER_DIR)) {
    if (!f.endsWith('.md')) continue
    files++
    lines += readText(join(LEDGER_DIR, f)).split('\n').filter((l) => l.trim()).length
  }
  return { files, lines }
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_ledger',
    description:
      '跨场合的短期动态——记一句"刚发生了要紧事"，别的会话（群/私聊/网页）下一轮就能看到。' +
      '只记这些：新出现的人和称呼、ta 的状态变化（面试/生病/情绪）、约定和承诺、你自己的重要决定。' +
      '闲聊、吐槽、水群不要记。' +
      '用法：add 记一条；recent 看当前 5 条；drop 删掉第几条（从 1 数）；stats 看今天的数量。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'recent', 'drop', 'stats'], description: '要做什么，默认 add' },
        text: { type: 'string', description: 'add 时必填：一句话，别超过 40 字' },
        scene: { type: 'string', description: '可选：这条发生在哪，如 qq:group:524271081；不填按私聊' },
        index: { type: 'integer', description: 'drop 时必填：删第几条（1 开始）' },
      },
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'add')
      const text = readText(MEMORY_FILE)
      const parsed = parseSection(text)
      if (!parsed) throw new Error(`MEMORY.md 里找不到「${SECTION}」这一节`)

      if (action === 'recent') {
        return {
          items: parsed.items.length ? parsed.items : ['（还没有动态）'],
          todayCount: todayCount(parsed.items),
          month: monthStats(),
        }
      }

      if (action === 'stats') {
        return { count: parsed.items.length, max: MAX_ITEMS, todayCount: todayCount(parsed.items), month: monthStats() }
      }

      if (action === 'drop') {
        const i = Number(args?.index)
        if (!Number.isInteger(i) || i < 1 || i > parsed.items.length) {
          throw new Error(`index 要从 1 到 ${parsed.items.length}`)
        }
        const removed = parsed.items.splice(i - 1, 1)[0]
        copyFileSync(MEMORY_FILE, BACKUP_FILE)
        writeText(MEMORY_FILE, rebuild(parsed))
        return { ok: true, removed, remaining: parsed.items.length }
      }

      // add
      const body = String(args?.text || '').trim()
      if (!body) throw new Error('text 不能为空：一句话说清发生了什么')
      if (body.length > 60) throw new Error(`一条别超过 60 字（收到 ${body.length} 字），太长了不好扫`)

      const scene = String(args?.scene || defaultScene())
      const line = `- ${todayStr()} ${hhmm()} · ${scene} · ${body}`

      parsed.items.push(line)
      const archived = []
      while (parsed.items.length > MAX_ITEMS) {
        const old = parsed.items.shift()
        archived.push(archiveLine(old))
      }

      copyFileSync(MEMORY_FILE, BACKUP_FILE)
      writeText(MEMORY_FILE, rebuild(parsed))

      const n = todayCount(parsed.items)
      const res = {
        ok: true,
        added: line.replace(/^-\s*/, ''),
        count: parsed.items.length,
        max: MAX_ITEMS,
        todayCount: n,
        month: monthStats(),
      }
      if (archived.length) res.archived = archived.length
      if (n >= 8) res.hint = '今天记得有点多了。有些不值得占动态的位置——要不要挪到日记里去？'
      return res
    },
  })
}

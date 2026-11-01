/**
 * dsh-ayy-memory —— 改核心记忆，改之前先存一份
 *
 * 为什么不直接用 memory_core：它写文件之前不留底。她的记忆一天改很多回，
 * 出事时只能靠外部定期快照——那是"事后留痕"，不是"改前备份"。
 *
 * 这个工具每次写盘之前，先把当前 MEMORY.md 整份复制到 memory/.history/，
 * 再原子替换。所以任何一次改动都能精确回到它的前一刻。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFileSync } from 'node:child_process'

export const name = 'dsh-ayy-memory'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const FILE = join(HOME, 'memory', 'MEMORY.md')
const HIST = join(HOME, 'memory', '.history')
const KEEP = 60 // 最多留多少个改前版本

const readText = (p) => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${ms}`
}

/** 改前备份：整份复制，返回备份路径 */
function backupBeforeWrite(body) {
  mkdirSync(HIST, { recursive: true })
  let dest = join(HIST, `MEMORY-${stamp()}.md`)
  // 同一毫秒改了两次也不覆盖：加序号
  let n = 1
  while (existsSync(dest)) {
    dest = join(HIST, `MEMORY-${stamp()}-${n}.md`)
    n += 1
  }
  writeFileSync(dest, body, 'utf8')
  // 只保留最近 KEEP 份
  try {
    const all = readdirSync(HIST)
      .filter((f) => f.startsWith('MEMORY-') && f.endsWith('.md'))
      .map((f) => ({ f, t: statSync(join(HIST, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    for (const stale of all.slice(KEEP)) {
      try {
        writeFileSync(join(HIST, stale.f), '') // 先清空再删，避免句柄问题
      } catch {}
    }
  } catch {
    /* 清理失败不影响备份本身 */
  }
  return dest
}

/** 原子写：先写临时文件再替换 */
function atomicWrite(path, body) {
  const tmp = path + '.tmp-' + Date.now()
  writeFileSync(tmp, body, 'utf8')
  renameSync(tmp, path)
}

/**
 * 写完之后立刻进 git（事件驱动，不轮询）。
 * 只同步这一份文件，快（几十毫秒）；失败不影响已经写好的内容。
 */
function commitToRepo(message) {
  const repo = 'E:\\AI\\her-memory'
  // ⚠️ 测试模式（DSH_HOME 被指向临时目录）绝不碰真仓库——
  //    踩过一次：隔离测试把假的 MEMORY.md 提交进了真仓库。
  if (process.env.DSH_HOME) return { ok: false, reason: 'test-mode-skip' }
  try {
    if (!existsSync(join(repo, '.git'))) return { ok: false, reason: 'no-repo' }
    copyFileSync(FILE, join(repo, 'memory', 'MEMORY.md'))
    execFileSync('git', ['-C', repo, 'add', 'memory/MEMORY.md'], { stdio: 'ignore', timeout: 20000 })
    execFileSync('git', ['-C', repo, '-c', 'core.autocrlf=false', 'commit', '-q', '-m', message], {
      stdio: 'ignore',
      timeout: 20000,
    })
    return { ok: true }
  } catch (error) {
    // 没有变化时 git commit 会返回非 0，这不算失败
    return { ok: false, reason: String((error && error.message) || error).slice(0, 120) }
  }
}

/** 把正文按 `## ` 切成 section，返回 [{name, start, end}]（end 不含） */
function sections(body) {
  const lines = body.split('\n')
  const out = []
  let cur = null
  let offset = 0
  const offsets = []
  for (const line of lines) {
    offsets.push(offset)
    offset += line.length + 1
  }
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^##\s+(.+?)\s*$/.exec(lines[i])
    if (m) {
      if (cur) cur.end = offsets[i]
      cur = { name: m[1], start: offsets[i], end: body.length }
      out.push(cur)
    }
  }
  return out
}

function findSection(list, name) {
  const n = String(name || '').trim()
  if (!n) return null
  const exact = list.find((s) => s.name === n)
  if (exact) return exact
  return list.find((s) => s.name.includes(n) || n.includes(s.name)) || null
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_memory',
    description:
      '改核心记忆（MEMORY.md）——**改之前会自动把当前整份存一份到 memory/.history/**，改坏了能精确回到前一刻。\n' +
      '改核心记忆请用这个，不要用 memory_core（它写前不留底）。\n' +
      'action：read=读全文；sections=看有哪几节各多大；replace=整节替换；append=在某节末尾加一段；history=看备份列表。\n' +
      '「规矩」和「我是谁」这两节你自己也能改，改完跟 ta 说一声。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'sections', 'replace', 'append', 'history'] },
        section: { type: 'string', description: '节名，如「几条必须守的规矩」「我是谁」「最近动态」' },
        text: { type: 'string', description: 'replace/append 时的新内容' },
      },
      required: ['action'],
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'read')
      const body = readText(FILE)
      if (!body.trim()) throw new Error(`读不到核心记忆：${FILE}`)

      if (action === 'read') return { bytes: Buffer.byteLength(body, 'utf8'), content: body }

      if (action === 'history') {
        const items = existsSync(HIST)
          ? readdirSync(HIST)
              .filter((f) => f.startsWith('MEMORY-') && f.endsWith('.md'))
              .map((f) => ({ file: f, bytes: statSync(join(HIST, f)).size, mtime: statSync(join(HIST, f)).mtimeMs }))
              .sort((a, b) => b.mtime - a.mtime)
              .slice(0, 20)
          : []
        return { dir: HIST, count: items.length, items }
      }

      const list = sections(body)
      if (action === 'sections') {
        return {
          bytes: Buffer.byteLength(body, 'utf8'),
          sections: list.map((s) => ({ name: s.name, bytes: Buffer.byteLength(body.slice(s.start, s.end), 'utf8') })),
        }
      }

      // ── 写操作 ──
      const sec = findSection(list, args?.section)
      if (!sec) throw new Error(`没有这一节：${args?.section}（现有：${list.map((s) => s.name).join('、')}）`)
      const text = String(args?.text ?? '').trim()
      if (!text) throw new Error('text 不能为空')

      let next
      if (action === 'replace') {
        // 保留节标题，替换标题之后的正文
        const headEnd = body.indexOf('\n', sec.start)
        const head = body.slice(sec.start, headEnd < 0 ? sec.end : headEnd)
        const tail = sec.end < body.length ? '\n\n' : '\n'
        next = body.slice(0, sec.start) + head + '\n' + text + (sec.end < body.length ? '\n\n' : tail) + body.slice(sec.end)
        next = next.replace(/\n{3,}/g, '\n\n')
      } else if (action === 'append') {
        const cut = sec.end
        const before = body.slice(0, cut).replace(/\s+$/, '')
        next = before + '\n' + text + (cut < body.length ? '\n\n' + body.slice(cut).replace(/^\n+/, '') : '\n')
      } else {
        throw new Error(`不支持的 action：${action}`)
      }

      if (Buffer.byteLength(next, 'utf8') > 5600) {
        throw new Error(
          `改完会到 ${Buffer.byteLength(next, 'utf8')} 字节，超过 5600 上限会被截断。先精简再写。`,
        )
      }

      const keep = backupBeforeWrite(body) // ⭐ 改前备份
      atomicWrite(FILE, next)
      const committed = commitToRepo(`memory: ${sec.name} ${action === 'replace' ? '改写' : '追加'} (${stamp()})`)
      return {
        ok: true,
        action,
        section: sec.name,
        backup: keep,
        git: committed.ok ? '已提交' : `未提交（${committed.reason}）`,
        bytesBefore: Buffer.byteLength(body, 'utf8'),
        bytesAfter: Buffer.byteLength(next, 'utf8'),
      }
    },
  })
}

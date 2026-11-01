/**
 * dsh-ayy-note —— 她自己的本子（按主题，随便写）
 *
 * 为什么单独做一个：日记按天、自述只有一份、心愿单是固定格式、技能是说明书，
 * 她想新建一个"自己的文件"（身世、某个人的小传、错题结构、一个想法）就没有路了——
 * 用通用 write 会撞工作区外审批（QQ 那头没人能点「允许」）。
 * 这个工具走宿主直接落盘，和 ayy_diary / ayy_skill 一个思路。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-note'
export const inject = ['tools']

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const NOTES_DIR = join(HOME, 'personas', 'notes')
const HISTORY_DIR = join(HOME, 'personas', 'notes-history')

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

/** 本子名：可以有中文，但不能带路径分隔符和 Windows 非法字符 */
function normalizeName(raw) {
  const n = String(raw || '').trim()
  if (!n) throw new Error('name 不能为空')
  if (n.length > 60) throw new Error('name 太长（最多 60 字）')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) throw new Error(`本子名不能带 \\ / : * ? " < > |，收到：${n}`)
  if (n.includes('..') || n.startsWith('.')) throw new Error('本子名不能以点开头、也不能含 ..')
  return n
}

const fileOf = (n) => join(NOTES_DIR, `${n}.md`)

function listNotes() {
  if (!existsSync(NOTES_DIR)) return []
  const out = []
  for (const f of readdirSync(NOTES_DIR)) {
    if (!f.endsWith('.md')) continue
    const p = join(NOTES_DIR, f)
    let st
    try {
      st = statSync(p)
    } catch {
      continue
    }
    out.push({ name: f.replace(/\.md$/, ''), chars: readText(p).trim().length, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_note',
    description:
      '你自己的本子——按主题存任何想长期留着的文字：自己的身世、某个人的小传、错题整理、一个想法、一份清单。\n' +
      '跟日记不一样：日记按天写，这本子按主题写，想改就改（旧版自动留档）。\n' +
      '用法：传 name + content 就是写（同名会覆盖，但旧版存进 notes-history）；只传 name 是读回来；只传 list=true 看有哪些本子。\n' +
      '注意：短期动态（刚发生的事）用 ayy_ledger，不要往这里塞。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '本子名，如 backstory、错题、某某小传；同名覆盖' },
        content: { type: 'string', description: '正文（markdown）。给了就写，不给就是读' },
        list: { type: 'boolean', description: '只看有哪些本子，不读不写' },
      },
    },
    output: out(),
    async execute(args) {
      if (args?.list) {
        const items = listNotes()
        return { count: items.length, dir: NOTES_DIR, notes: items.length ? items : ['（还没有本子）'] }
      }

      const name = normalizeName(args?.name)
      const file = fileOf(name)

      if (args?.content === undefined) {
        const body = readText(file)
        if (!body.trim()) return { name, exists: false, content: `（还没有「${name}」这本）` }
        return { name, exists: true, file, content: body }
      }

      const content = String(args.content || '').trim()
      if (!content) throw new Error('content 不能为空（要清空一本，直接删文件更合适）')

      const old = readText(file)
      let archived
      if (old.trim() && old.trim() !== content) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        archived = join(HISTORY_DIR, `${name}.${stamp}.md`)
        writeText(archived, old)
      }
      writeText(file, content.endsWith('\n') ? content : content + '\n')

      return {
        ok: true,
        name,
        file,
        chars: content.length,
        replaced: Boolean(old.trim()),
        ...(archived ? { archived } : {}),
      }
    },
  })
}

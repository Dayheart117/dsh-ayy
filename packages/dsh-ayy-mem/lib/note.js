/**
 * dsh-ayy-mem · note —— 她自己的本子（按主题，随便写）
 *
 * 为什么单独做一个：日记按天、自述只有一份、心愿单是固定格式、技能是说明书，
 * 她想新建一个"自己的文件"（身世、某个人的小传、错题结构、一个想法）就没有路了——
 * 用通用 write 会撞工作区外审批（QQ 那头没人能点「允许」）。
 * 这个工具走宿主直接落盘，和 ayy_diary / ayy_skill 一个思路。
 *
 * 来源行（`<!-- src: … -->`）和"谁在说话"由 common.js 统一解析：
 * 会话 → 桥绑定表；说话人 → 参数 speaker > qq-speaker.json > 留空。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PATHS, readText, writeText, stampIso, describeSource, objectOutput } from './common.js'

/** 本子名：可以有中文，但不能带路径分隔符和 Windows 非法字符 */
function normalizeName(raw) {
  const n = String(raw || '').trim()
  if (!n) throw new Error('name 不能为空')
  if (n.length > 60) throw new Error('name 太长（最多 60 字）')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) throw new Error(`本子名不能带 \\ / : * ? " < > |，收到：${n}`)
  if (n.includes('..') || n.startsWith('.')) throw new Error('本子名不能以点开头、也不能含 ..')
  return n
}

const fileOf = (n) => join(PATHS.notes, `${n}.md`)

function listNotes() {
  if (!existsSync(PATHS.notes)) return []
  const out = []
  for (const f of readdirSync(PATHS.notes)) {
    if (!f.endsWith('.md')) continue
    const p = join(PATHS.notes, f)
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

/** 按 `## ` 标题切节；没有标题就整篇算一节 */
function splitSections(body) {
  const lines = body.split('\n')
  const out = []
  let heading = '(开头)'
  let buf = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) out.push({ heading, text })
  }
  for (const line of lines) {
    const m = /^##\s+(.*)$/.exec(line)
    if (m) {
      flush()
      heading = m[1].trim()
      buf = [line]
    } else {
      buf.push(line)
    }
  }
  flush()
  return out
}

/**
 * 命中时只回"那一段"，不是整节。
 * 为什么：append 上去的内容如果没带 `## 小标题`，它会并进上一节；
 * 如果整节吐回去，一条补充说明会拖着几十行一起回来。
 */
function splitParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function register(define) {
  define({
    name: 'ayy_note',
    description:
      '你自己的本子：按主题存长期的东西（身世、小传、错题、想法、清单）。日记按天，这个按主题。\n' +
      '· name+content=整本重写（旧版进 notes-history）· name+append=末尾加一段（加一条就用它）\n' +
      '· 只传 name=读整本 · search=只回命中片段（本子大了用它）· list=true=看有哪些本子\n' +
      'append 会自动记来源（场景·时间·会话id）；**群里记东西必须带 speaker**「昵称(QQ号)」。\n' +
      '刚发生的事用 ayy_ledger，别塞这里。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '本子名，同名覆盖' },
        content: { type: 'string', description: '整本重写' },
        append: { type: 'string', description: '往末尾加一段' },
        search: { type: 'string', description: '关键词' },
        source: { type: 'string', description: '按来源筛' },
        scene: { type: 'string', description: '来源（自动取不到时填）' },
        speaker: { type: 'string', description: '群里谁说的：昵称(QQ号)' },
        list: { type: 'boolean', description: '只看列表' },
      },
    },
    output: objectOutput(),
    async execute(args, execCtx) {
      if (args?.list) {
        const items = listNotes()
        return { count: items.length, dir: PATHS.notes, notes: items.length ? items : ['（还没有本子）'] }
      }

      // ── 搜索：只回命中的那一段（不是整节）───────────────────────────
      const kw = String(args?.search || '').trim()
      if (kw) {
        const names = args?.name ? [normalizeName(args.name)] : listNotes().map((n) => n.name)
        const srcFilter = String(args?.source || '').trim()
        const hits = []
        for (const n of names) {
          const body = readText(fileOf(n))
          if (!body.trim()) continue
          for (const section of splitSections(body)) {
            if (!section.text.includes(kw)) continue
            // 按来源筛：只留来源注释里带这个字样的节
            if (srcFilter && !section.text.includes(srcFilter)) continue
            // 节内再按空行切段：只把命中的那几段带回来，前面捎上节标题做定位
            const paras = splitParagraphs(section.text).filter((p) => p.includes(kw))
            for (const p of paras.slice(0, 2)) {
              hits.push({
                note: n,
                heading: section.heading,
                text: p.length > 200 ? p.slice(0, 200) + '…' : p,
              })
              if (hits.length >= 5) break
            }
            if (hits.length >= 5) break
          }
          if (hits.length >= 5) break
        }
        return { keyword: kw, count: hits.length, hits: hits.length ? hits : '（没找到，换个词试试）' }
      }

      const name = normalizeName(args?.name)
      const file = fileOf(name)

      // ── 只读 ────────────────────────────────────────────────────────
      if (args?.content === undefined && args?.append === undefined) {
        const body = readText(file)
        if (!body.trim()) return { name, exists: false, content: `（还没有「${name}」这本）` }
        return { name, exists: true, file, content: body }
      }

      // ── 追加：只加一段，不备份（没丢东西），也不重写前文 ────────────
      if (args?.append !== undefined && args?.content === undefined) {
        const add = String(args.append || '').trim()
        if (!add) throw new Error('append 不能为空')
        const old = readText(file)
        const sep = !old.trim() ? '' : old.endsWith('\n') ? '' : '\n'
        // 来源：能从执行上下文里取到就用它，取不到用她填的 scene，都没有就写 unknown
        const src = describeSource(args, execCtx)
        const block = add + '\n\n' + src.line + '\n'
        const next = old.trim() ? old + sep + '\n' + block : block
        writeText(file, next)
        return {
          ok: true,
          mode: 'append',
          name,
          file,
          addedChars: add.length,
          totalChars: next.length,
          source: src.value,
          sourceFrom: src.from,
          speaker: src.speaker || '',
        }
      }

      const content = String(args.content || '').trim()
      if (!content) throw new Error('content 不能为空（要清空一本，直接删文件更合适）')

      const old = readText(file)
      let archived
      if (old.trim() && old.trim() !== content) {
        archived = join(PATHS.notesHistory, `${name}.${stampIso()}.md`)
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

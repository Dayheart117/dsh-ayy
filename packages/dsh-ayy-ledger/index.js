/**
 * dsh-ayy-ledger —— 她的记忆（统一版）
 *
 * 三层，一套工具：
 *   短期  add      写进 MEMORY.md 的「## 最近动态」，最多 5 条，每轮注入所有会话 → 跨场合实时可见
 *   中期  溢出     被挤出窗口的沉到 personas/ledger/<年-月>.<场景>.md，只增不删
 *   长期  promote  升格成 core-memory 的归档 note（notes/<id>.md + index.json）→ memory_search 搜得到
 *
 * 设计取舍：
 *   - 不碰 systemPrompt：注入只走 core-memory 本来就读的 MEMORY.md
 *   - 不设硬配额：只回报计数，收不收由她自己判断
 *   - 取 fish-memory 的长处（带时间、会沉淀），但存的是全局而不是单会话
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-ledger'
export const inject = ['tools']

const HOME = join(homedir(), '.dsh')
const MEMORY_DIR = join(HOME, 'memory')
const MEMORY_FILE = join(MEMORY_DIR, 'MEMORY.md')
const BACKUP_FILE = join(MEMORY_DIR, 'MEMORY.md.bak')
const INDEX_FILE = join(MEMORY_DIR, 'index.json')
const NOTES_DIR = join(MEMORY_DIR, 'notes')
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
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s, 'utf8')
}
const pad = (n) => String(n).padStart(2, '0')
const now = () => new Date()
const todayStr = (d = now()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hhmm = (d = now()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const monthStr = (d = now()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const safe = (s) => String(s).replace(/[^\w.-]+/g, '_')
const slug = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'note'

function defaultScene() {
  const c = readJson(BRIDGE_CFG, {})
  const bindings = Array.isArray(c['绑定']) ? c['绑定'] : []
  const priv = bindings.find((b) => b && String(b['类型']).includes('私聊'))
  const qq = String(priv?.['号码'] || c['私聊QQ'] || '')
  return qq ? `qq:private:${qq}` : 'dsh:chat'
}

// ── 短期：MEMORY.md 的「最近动态」节 ─────────────────────────────────────

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

const rebuildMemory = (p) =>
  p.before + SECTION + '\n' + p.noteLines.join('\n') + '\n' +
  (p.items.length ? p.items.join('\n') + '\n' : '\n') + p.rest

function saveMemory(parsed) {
  copyFileSync(MEMORY_FILE, BACKUP_FILE)
  writeText(MEMORY_FILE, rebuildMemory(parsed))
}

/** 条目形如 `- 2026-11-01 08:05 · qq:group:123 · 内容` */
function parseItem(line) {
  const body = String(line).replace(/^-\s*/, '')
  const parts = body.split('·').map((s) => s.trim())
  if (parts.length >= 3) return { when: parts[0], scene: parts[1], text: parts.slice(2).join(' · ') }
  return { when: '', scene: '', text: body }
}

function archiveLine(line) {
  const { scene } = parseItem(line)
  const file = join(LEDGER_DIR, `${monthStr()}.${safe(scene || defaultScene())}.md`)
  const header = existsSync(file) ? '' : `# ${monthStr()} · 动态流水\n\n`
  writeText(file, (existsSync(file) ? readText(file).replace(/\s*$/, '\n') : header) + line + '\n')
  return file
}

function todayCount(items) {
  const t = todayStr()
  return items.filter((l) => l.includes(t)).length
}

function ledgerStats() {
  if (!existsSync(LEDGER_DIR)) return { files: 0, lines: 0, kb: 0 }
  let files = 0
  let lines = 0
  let bytes = 0
  for (const f of readdirSync(LEDGER_DIR)) {
    if (!f.endsWith('.md')) continue
    files++
    const p = join(LEDGER_DIR, f)
    const txt = readText(p)
    lines += txt.split('\n').filter((l) => l.trim()).length
    try {
      bytes += statSync(p).size
    } catch {}
  }
  return { files, lines, kb: Math.round((bytes / 1024) * 10) / 10 }
}

// ── 长期：写进 core-memory 的归档（notes + index.json）────────────────────

function promoteToNote(title, body, tags) {
  const d = now()
  const id = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(
    d.getSeconds(),
  )}-${slug(title)}`
  const iso = d.toISOString()
  const noteFile = join(NOTES_DIR, `${id}.md`)
  const content =
    `---\nid: ${id}\ntitle: ${title}\ntags: ${tags.join(', ')}\ncreated: ${iso}\nupdated: ${iso}\n---\n\n${body}\n`
  writeText(noteFile, content)

  const index = readJson(INDEX_FILE, { version: 1, notes: [] })
  if (!Array.isArray(index.notes)) index.notes = []
  index.notes.unshift({
    id,
    title,
    tags,
    created: iso,
    updated: iso,
    size: Buffer.byteLength(body, 'utf8'),
  })
  writeText(INDEX_FILE, JSON.stringify(index, null, 2) + '\n')
  return { id, file: noteFile }
}

// ── 检索：流水 + 归档 notes（关键词，带时间）──────────────────────────────

function recallAll(query, windowItems = [], limit = 8) {
  const q = String(query || '').trim()
  if (!q) return []
  const parts = q.split(/\s+/).filter(Boolean)
  const hits = []

  // 当前窗口（最近的也算记忆）
  for (const line of windowItems) {
    if (parts.some((p) => line.includes(p))) {
      const it = parseItem(line)
      hits.push({ kind: 'recent', when: it.when, scene: it.scene, body: it.text })
    }
  }

  // 归档 notes
  const index = readJson(INDEX_FILE, { notes: [] })
  for (const n of Array.isArray(index.notes) ? index.notes : []) {
    const body = readText(join(NOTES_DIR, `${n.id}.md`))
    const hay = `${n.title || ''}\n${(n.tags || []).join(' ')}\n${body}`
    if (parts.some((p) => hay.includes(p))) {
      hits.push({ kind: 'note', when: n.created, title: n.title || n.id, body: body.replace(/^---[\s\S]*?---\n+/, '').trim() })
    }
  }

  // 月度流水
  if (existsSync(LEDGER_DIR)) {
    for (const f of readdirSync(LEDGER_DIR)) {
      if (!f.endsWith('.md')) continue
      for (const line of readText(join(LEDGER_DIR, f)).split('\n')) {
        if (!/^-\s+/.test(line)) continue
        if (parts.some((p) => line.includes(p))) {
          const it = parseItem(line)
          hits.push({ kind: 'ledger', when: it.when, title: `${it.scene}`, body: it.text })
        }
      }
    }
  }

  // 统一按时间倒序：新的在前
  const key = (h) => String(h.when || '').replace('T', ' ').slice(0, 16)
  hits.sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0))
  return hits.slice(0, limit)
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_ledger',
    description:
      '你的记忆，三档：\n' +
      '· add —— 短期动态：写进 MEMORY.md「最近动态」，最多 5 条，**每轮所有会话都看得到**（群、私聊、网页）。' +
      '只记：新出现的人和称呼、ta 的状态变化、约定和承诺、你的重要决定。闲聊水群别记。\n' +
      '· promote —— 把最近动态里的第几条升格成**永久归档**（memory_search 搜得到，不会淡忘）。\n' +
      '· recall —— 按关键词翻流水和归档，带时间。想不起来什么事的时候先翻这个。\n' +
      '· recent / drop / stats —— 看窗口、删一条、看计数。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'promote', 'recall', 'recent', 'drop', 'stats'], description: '默认 add' },
        text: { type: 'string', description: 'add：一句话，别超 60 字（写清"谁/什么事"）' },
        scene: { type: 'string', description: 'add：这条发生在哪；不填按私聊' },
        index: { type: 'integer', description: 'promote/drop：第几条，从 1 数（1 = 窗口最上面那条）' },
        title: { type: 'string', description: 'promote：归档标题' },
        tags: { type: 'string', description: 'promote：标签，逗号分隔' },
        query: { type: 'string', description: 'recall：关键词，可以多个空格分开' },
      },
    },
    output: out(),
    async execute(args) {
      const action = String(args?.action || 'add')
      const parsed = parseSection(readText(MEMORY_FILE))
      if (!parsed) throw new Error(`MEMORY.md 里找不到「${SECTION}」这一节`)

      if (action === 'recent') {
        return {
          items: parsed.items.length ? parsed.items : ['（还没有动态）'],
          todayCount: todayCount(parsed.items),
          ledger: ledgerStats(),
        }
      }

      if (action === 'stats') {
        return {
          count: parsed.items.length,
          max: MAX_ITEMS,
          todayCount: todayCount(parsed.items),
          ledger: ledgerStats(),
          notes: (readJson(INDEX_FILE, { notes: [] }).notes || []).length,
        }
      }

      if (action === 'recall') {
        const hits = recallAll(args?.query, parsed.items, 8)
        return { query: String(args?.query || ''), hits: hits.length ? hits : ['（没搜到，换个词试试）'] }
      }

      if (action === 'drop') {
        const i = Number(args?.index)
        if (!Number.isInteger(i) || i < 1 || i > parsed.items.length) {
          throw new Error(`index 要从 1 到 ${parsed.items.length}`)
        }
        const removed = parsed.items.splice(i - 1, 1)[0]
        saveMemory(parsed)
        return { ok: true, removed: parseItem(removed).text, remaining: parsed.items.length }
      }

      if (action === 'promote') {
        const i = Number(args?.index)
        if (!Number.isInteger(i) || i < 1 || i > parsed.items.length) {
          throw new Error(`index 要从 1 到 ${parsed.items.length}`)
        }
        const item = parseItem(parsed.items[i - 1])
        const title = String(args?.title || item.text.slice(0, 30)).trim()
        const tags = String(args?.tags || '')
          .split(/[,，\s]+/)
          .filter(Boolean)
        const body = `- 时间：${item.when}\n- 场景：${item.scene}\n\n${item.text}`
        const note = promoteToNote(title, body, tags.length ? tags : ['动态'])
        parsed.items.splice(i - 1, 1)
        saveMemory(parsed)
        return { ok: true, promoted: title, note: note.id, remaining: parsed.items.length }
      }

      // add
      const body = String(args?.text || '').trim()
      if (!body) throw new Error('text 不能为空：一句话说清发生了什么')
      if (body.length > 60) throw new Error(`一条别超过 60 字（收到 ${body.length} 字），太长了不好扫`)

      const scene = String(args?.scene || defaultScene())
      const line = `- ${todayStr()} ${hhmm()} · ${scene} · ${body}`

      parsed.items.push(line)
      let archived = 0
      while (parsed.items.length > MAX_ITEMS) {
        archiveLine(parsed.items.shift())
        archived++
      }
      saveMemory(parsed)

      const n = todayCount(parsed.items)
      const res = {
        ok: true,
        added: line.replace(/^-\s*/, ''),
        count: parsed.items.length,
        todayCount: n,
        ledger: ledgerStats(),
      }
      if (archived) res.archived = archived
      if (n >= 8) res.hint = '今天记得有点多了。有些不值得占动态的位置——要不要挪到日记里去？'
      return res
    },
  })
}

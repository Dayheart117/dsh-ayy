import fs from 'node:fs'
const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')

const anchor = `function upsertOne(item) {
  const d = open()
  const ex = d.prepare('SELECT id FROM questions WHERE source = ? AND no = ?').get(String(item.source || ''), String(item.no || ''))
  if (!ex) return null
  const patch = {}
  for (const k of FIELDS) {
    if (item[k] === undefined) continue
    patch[k] = k === 'tags' ? (Array.isArray(item.tags) ? JSON.stringify(item.tags) : String(item.tags || '[]')) : item[k]
  }`

const replacement = `function upsertOne(item) {
  const d = open()
  const ex = d.prepare('SELECT id FROM questions WHERE source = ? AND no = ?').get(String(item.source || ''), String(item.no || ''))
  if (!ex) return null
  const patch = {}
  for (const k of FIELDS) {
    if (item[k] === undefined) continue
    patch[k] = k === 'tags' ? (Array.isArray(item.tags) ? JSON.stringify(item.tags) : String(item.tags || '[]')) : item[k]
  }
  // 覆盖时同样要过码表：错因归一（认不出记未标注）
  if (patch.wrong !== undefined) patch.wrong = canonWrong(patch.wrong) || '未标注'
  // 覆盖时如果标了错（score<full）且没指定复习日，就重排到明天
  if (patch.review_at === undefined && patch.score !== undefined && patch.full != null && Number(patch.score) < Number(patch.full)) {
    patch.review_at = nextReview(patch.day || ymd(new Date()), 0, false).at
    patch.review_n = 0
  }`

if (s.includes(anchor)) {
  s = s.replace(anchor, replacement)
  fs.writeFileSync(p, s, 'utf8')
  console.log('upsertOne 已修（错因归一 + 复习重排）')
} else {
  console.log('未匹配 upsertOne')
}

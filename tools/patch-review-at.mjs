import fs from 'node:fs'
const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')

const oldLine = "    review_at: item?.review_at != null ? String(item.review_at).slice(0, 10) : '',"
const newLines = [
  "    review_at:",
  "      item?.review_at != null",
  "        ? String(item.review_at).slice(0, 10)",
  "        : item?.full != null && Number(item?.score) >= Number(item.full)",
  "          ? '' // 做对了不用排复习",
  "          : nextReview(item?.day || new Date().toISOString().slice(0, 10), 0, false).at, // 错了 → 明天",
].join('\n')

if (s.includes(oldLine)) {
  s = s.replace(oldLine, newLines)
  fs.writeFileSync(p, s, 'utf8')
  console.log('review_at 逻辑已改')
} else {
  console.log('未匹配 review_at 行', s.includes('review_at:') ? '(有 review_at 但格式不同)' : '(没有)')
}

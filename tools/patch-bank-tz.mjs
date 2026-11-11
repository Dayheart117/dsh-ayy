import fs from 'node:fs'
const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')
const log = []

// 1) 本地日期格式（不能用 toISOString：东八区会倒退一天）
const helper = `
/** 本地日期 YYYY-MM-DD（toISOString 是 UTC，东八区会倒退一天） */
function ymd(d) {
  const x = d instanceof Date ? d : new Date(d)
  const p2 = (n) => String(n).padStart(2, '0')
  return x.getFullYear() + '-' + p2(x.getMonth() + 1) + '-' + p2(x.getDate())
}
`
if (!s.includes('function ymd(d)')) {
  s = s.replace('/** 复习调度：错题按次数递推', helper + '/** 复习调度：错题按次数递推')
  log.push('ymd 已加')
}

// 2) nextReview 用本地日期
const oldNext = `function nextReview(day, n, ok) {
  const base = String(day || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const count = ok ? Math.max(0, Number(n) || 0) : 0 // 答对进下一档，答错回第 0 档
  const step = REVIEW_STEPS[Math.min(count, REVIEW_STEPS.length - 1)]
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + step)
  return { at: d.toISOString().slice(0, 10), n: count + (ok ? 1 : 0) }
}`
const newNext = `function nextReview(day, n, ok) {
  const base = String(day || ymd(new Date())).slice(0, 10)
  const count = ok ? Math.max(0, Number(n) || 0) : 0 // 答对进下一档，答错回第 0 档
  const step = REVIEW_STEPS[Math.min(count, REVIEW_STEPS.length - 1)]
  const d = new Date(base + 'T12:00:00')
  d.setDate(d.getDate() + step)
  return { at: ymd(d), n: count + (ok ? 1 : 0) }
}`
if (s.includes(oldNext)) { s = s.replace(oldNext, newNext); log.push('nextReview 已修') }

// 3) insertOne 的默认日期
s = s.replace("nextReview(item?.day || new Date().toISOString().slice(0, 10), 0, false).at", 'nextReview(item?.day || ymd(new Date()), 0, false).at')

// 4) due / review 里的今天和 until
s = s.replace("const until = new Date(Date.now() + extra * 86400000).toISOString().slice(0, 10)", 'const until = ymd(new Date(Date.now() + extra * 86400000))')
s = s.replace("const today = new Date().toISOString().slice(0, 10)\n        return {\n          今天: today,", 'const today = ymd(new Date())\n        return {\n          今天: today,')
s = s.replace("const today = new Date().toISOString().slice(0, 10)\n        const nx = nextReview(today, row.review_n || 0, ok)", 'const today = ymd(new Date())\n        const nx = nextReview(today, row.review_n || 0, ok)')

fs.writeFileSync(p, s, 'utf8')
console.log(log.join('\n') || '无改动')
console.log('残留 toISOString 用于日期的地方:', (s.match(/toISOString\(\)\.slice\(0, 10\)/g) || []).length)

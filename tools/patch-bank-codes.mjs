// 给 dsh-ayy-bank 打两个补丁：错因码表 + 复习调度
import fs from 'node:fs'

const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')
const log = []

// ── 1) 错因码表 ───────────────────────────────────────────
const codesBlock = `
/**
 * 错因码表：错因必须落在这里，统计才分得开。
 * 码=短的稳定标识；别名容错（她说"粗心算错"也归到「计算」）。
 */
const WRONG_CODES = [
  { code: '盲区', name: '知识盲区', desc: '压根不会/没见过这个考点', alias: ['不会', '没学', '盲区', '知识', '知识点'] },
  { code: '方法', name: '方法不熟', desc: '考点见过但套路没掌握', alias: ['方法', '套路', '技巧', '不会用'] },
  { code: '审题', name: '审题偏差', desc: '看错问法/主体/范围/单位', alias: ['审题', '看错', '理解错', '问法'] },
  { code: '计算', name: '计算失误', desc: '式子列对、算错', alias: ['计算', '算错', '粗心算', '算术'] },
  { code: '粗心', name: '粗心', desc: '抄错选项/看漏一个条件', alias: ['粗心', '看漏', '抄错', '手滑'] },
  { code: '速度', name: '速度超时', desc: '会做但花太久，考场该放弃', alias: ['速度', '超时', '太慢', '时间'] },
  { code: '表达', name: '表述失分', desc: '申论/面试表达不到位', alias: ['表述', '表达', '语言', '不准确'] },
  { code: '材料', name: '材料理解', desc: '没读懂材料/没抓住要点', alias: ['材料', '读不懂', '抓不准', '要点'] },
  { code: '弃做', name: '弃做', desc: '没做/蒙的', alias: ['蒙', '放弃', '没做', '瞎选'] },
  { code: '未标', name: '未标注', desc: '当时没写错因', alias: ['', '未标注', '不知道'] },
]

/** 错因归一：认名字、认码、认别名；认不出返回 null（由调用方决定拒还是记未标） */
function canonWrong(v) {
  const raw = String(v == null ? '' : v).trim()
  if (!raw) return '未标注'
  for (const c of WRONG_CODES) {
    if (raw === c.code || raw === c.name) return c.name
    for (const a of c.alias) if (a && raw === a) return c.name
  }
  // 包含匹配：如"粗心算错"→计算
  for (const c of WRONG_CODES) {
    if (c.code === '未标') continue
    for (const a of c.alias) if (a && a.length >= 2 && raw.includes(a)) return c.name
  }
  return null
}

/** 复习调度：错题按次数递推，间隔 1/2/4/7/15/30/60 天 */
const REVIEW_STEPS = [1, 2, 4, 7, 15, 30, 60]
function nextReview(day, n, ok) {
  const base = String(day || new Date().toISOString().slice(0, 10)).slice(0, 10)
  const count = ok ? Math.max(0, Number(n) || 0) : 0 // 答对进下一档，答错回第 0 档
  const step = REVIEW_STEPS[Math.min(count, REVIEW_STEPS.length - 1)]
  const d = new Date(base + 'T00:00:00')
  d.setDate(d.getDate() + step)
  return { at: d.toISOString().slice(0, 10), n: count + (ok ? 1 : 0) }
}

`

if (!s.includes('WRONG_CODES')) {
  s = s.replace('/** 录题模板：工具给出、调用方照着填，不靠临场发挥 */', codesBlock + '/** 录题模板：工具给出、调用方照着填，不靠临场发挥 */')
  log.push('错因码表已插入')
}

// ── 2) 表结构：复习字段 ───────────────────────────────────
const colsOld = "['answer', \"TEXT DEFAULT ''\"], ['picked', \"TEXT DEFAULT ''\"], ['analysis', \"TEXT DEFAULT ''\"]]"
const colsNew = "['answer', \"TEXT DEFAULT ''\"], ['picked', \"TEXT DEFAULT ''\"], ['analysis', \"TEXT DEFAULT ''\"], ['review_at', \"TEXT DEFAULT ''\"], ['review_n', 'INTEGER DEFAULT 0'], ['last_review', \"TEXT DEFAULT ''\"]]"
if (s.includes(colsOld)) {
  s = s.replace(colsOld, colsNew)
  log.push('复习字段已加')
}

// ── 3) FIELDS ───────────────────────────────────────────
if (!s.includes("'review_at', 'review_n', 'last_review'")) {
  s = s.replace("'picked', 'analysis', 'material_id']", "'picked', 'analysis', 'material_id', 'review_at', 'review_n', 'last_review']")
  log.push('FIELDS 已加复习字段')
}

// ── 4) insertOne：错因归一 + 初始复习日 ────────────────────
const insOld = "    answer: item?.answer != null ? String(item.answer).slice(0, 20) : '',"
const insNew = `    answer: item?.answer != null ? String(item.answer).slice(0, 20) : '',
    // 错因归一：认不出的一律记「未标注」，不让脏值进统计
    wrong: canonWrong(item?.wrong) || '未标注',
    // 复习调度：错题从明天开始，答对的下次延后
    review_at: item?.review_at != null ? String(item.review_at).slice(0, 10) : '',
    review_n: item?.review_n != null ? Number(item.review_n) : 0,
    last_review: item?.last_review != null ? String(item.last_review).slice(0, 10) : '',`
if (s.includes(insOld) && !s.includes('canonWrong(item?.wrong)')) {
  s = s.replace(insOld, insNew)
  log.push('insertOne 已接错因归一')
}

fs.writeFileSync(p, s, 'utf8')
console.log(log.join('\n') || '没有改动')

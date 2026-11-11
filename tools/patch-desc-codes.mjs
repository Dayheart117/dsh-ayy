import fs from 'node:fs'
const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')
const anchor = "'**来源格式**：必须含年份 + 考试类型（含模考）"
if (!s.includes('**错因**')) {
  const add = [
    "'**错因**：只能用 ayy_bank(action:\"codes\") 里的十类，认不出记「未标注」。\\n' +",
    "      '**复习**：错题自动排期（1→2→4→7→15→30→60 天）；due 看今天到期，review 记结果。\\n' +",
    "      " + anchor,
  ].join('\n')
  s = s.replace(anchor, add)
  fs.writeFileSync(p, s, 'utf8')
  console.log('工具描述已加错因/复习')
} else {
  console.log('已有')
}

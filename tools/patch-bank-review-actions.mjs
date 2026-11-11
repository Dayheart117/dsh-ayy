import fs from 'node:fs'
const p = 'E:/AI/dsh-ayy/packages/dsh-ayy-bank/index.js'
let s = fs.readFileSync(p, 'utf8')
const log = []

// 1) 动作枚举
const enumOld = "'verify', 'template', 'get', 'material'], description: '默认 add'"
const enumNew = "'verify', 'template', 'get', 'material', 'codes', 'due', 'review'], description: '默认 add'"
if (s.includes(enumOld)) { s = s.replace(enumOld, enumNew); log.push('枚举已加') }

// 2) 参数
const paramOld = "        upsert: { type: 'boolean',"
const paramNew = `        ok: { type: 'boolean', description: 'review：这次复习做对了吗（true 进下一档，false 回第一档）' },
        days: { type: 'integer', description: 'due：往后看几天，默认 0=只看到今天' },
        upsert: { type: 'boolean',`
if (s.includes(paramOld) && !s.includes("'review：这次复习")) { s = s.replace(paramOld, paramNew); log.push('参数已加') }

// 3) 三个动作（插在 material 动作前）
const anchor = "      if (action === 'material') {"
const actions = `      if (action === 'codes') {
        return {
          说明: '错因只能从这里选；写别名也认，认不出的记「未标注」',
          码表: WRONG_CODES.map((c) => ({ 码: c.code, 名称: c.name, 说明: c.desc, 别名: c.alias.filter(Boolean) })),
          复习间隔: REVIEW_STEPS.map((d) => d + '天').join(' → '),
        }
      }

      if (action === 'due') {
        const d = open()
        const extra = Math.max(0, Number(args?.days) || 0)
        const until = new Date(Date.now() + extra * 86400000).toISOString().slice(0, 10)
        const rows = d
          .prepare("SELECT id, source, no, stem, digest, review_at, review_n, path FROM questions WHERE review_at <> '' AND review_at <= ? ORDER BY review_at ASC LIMIT ?")
          .all(until, Math.max(1, Math.min(Number(args?.limit) || 20, 100)))
        const today = new Date().toISOString().slice(0, 10)
        return {
          今天: today,
          到期的: rows.length,
          清单: rows.map((r) => ({
            id: r.id,
            题: (r.source || '') + ' #' + (r.no || ''),
            到期: r.review_at,
            逾期: r.review_at < today ? '逾期 ' + Math.round((Date.parse(today) - Date.parse(r.review_at)) / 86400000) + ' 天' : '',
            题干: String(r.stem || '').slice(0, 40),
            思路: String(r.digest || '').slice(0, 40),
            第几次: Number(r.review_n || 0) + 1,
          })),
          说明: '做完了用 ayy_bank(action:"review", id=…, ok=true/false) 记结果',
        }
      }

      if (action === 'review') {
        const d = open()
        const id = Number(args?.id)
        if (!id) throw new Error('review 需要 id（先 due 看清单）')
        const row = d.prepare('SELECT id, review_n, day FROM questions WHERE id = ?').get(id)
        if (!row) throw new Error('没这道题：' + id)
        const ok = args?.ok !== false
        const today = new Date().toISOString().slice(0, 10)
        const nx = nextReview(today, row.review_n || 0, ok)
        const graduate = ok && Number(row.review_n || 0) + 1 >= REVIEW_STEPS.length
        d.prepare('UPDATE questions SET review_at = ?, review_n = ?, last_review = ? WHERE id = ?').run(
          graduate ? '' : nx.at, nx.n, today, id,
        )
        log(\`review #\${id} ok=\${ok} → \${graduate ? '毕业' : nx.at}\`)
        return {
          ok: true,
          id,
          结果: ok ? '做对了' : '做错了（回第一档）',
          下次复习: graduate ? '不用再排（已毕业）' : nx.at,
          第几次: nx.n,
        }
      }

      if (action === 'material') {`
if (s.includes(anchor) && !s.includes("action === 'due'")) { s = s.replace(anchor, actions); log.push('动作已加') }

fs.writeFileSync(p, s, 'utf8')
console.log(log.join('\n') || '没有改动')

// 等真实文件：盯着私聊历史，一旦出现 file 段就打印真实 shape；同时报告我们的日志/落盘变化
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const cfg = JSON.parse(readFileSync('C:/Users/dayheart/.dsh/qq-bridge-config.json', 'utf8'))
const H = { 'content-type': 'application/json', authorization: 'Bearer ' + cfg['令牌'] }
const ROOT = 'C:/Users/dayheart/.dsh/ayy-files'
const LOG = join(ROOT, 'files.log')

let seenLog = existsSync(LOG) ? readFileSync(LOG, 'utf8').length : 0
let seenFiles = new Set()
const dirsBefore = existsSync(ROOT) ? readdirSync(ROOT) : []

async function hist() {
  const r = await fetch(cfg.NapCat + '/get_friend_msg_history', {
    method: 'POST', headers: H, body: JSON.stringify({ user_id: Number(cfg['私聊QQ']), count: 20 }),
  })
  const j = await r.json()
  return (j && j.data && Array.isArray(j.data.messages)) ? j.data.messages : []
}

const started = Date.now()
let printed = new Set()
while (Date.now() - started < 270000) {
  try {
    const msgs = await hist()
    for (const m of msgs) {
      const segs = Array.isArray(m.message) ? m.message : []
      for (const s of segs) {
        if (s && s.type === 'file' && !printed.has(m.message_id)) {
          printed.add(m.message_id)
          console.log('\n=== REAL FILE SEGMENT FOUND ===')
          console.log('msg:', JSON.stringify({ message_id: m.message_id, time: m.time, user_id: m.user_id, message_type: m.message_type, sender: m.sender }, null, 1))
          console.log('seg:', JSON.stringify(s, null, 1))
        }
      }
    }
    // 新日志
    if (existsSync(LOG)) {
      const text = readFileSync(LOG, 'utf8')
      if (text.length > seenLog) {
        console.log('--- new log ---')
        console.log(text.slice(seenLog).trim())
        seenLog = text.length
      }
    }
    // 新文件
    if (existsSync(ROOT)) {
      for (const d of readdirSync(ROOT)) {
        const p = join(ROOT, d)
        try {
          for (const f of readdirSync(p)) {
            if (f === 'files.log' || f === 'state.json' || f.endsWith('.1')) continue
            if (!seenFiles.has(d + '/' + f)) {
              seenFiles.add(d + '/' + f)
              console.log(`--- new file on disk: ${d}/${f} ---`)
            }
          }
        } catch (e) {}
      }
    }
  } catch (error) {
    console.log('history check error:', String(error && error.message || error))
  }
  await new Promise((r) => setTimeout(r, 10000))
}
console.log('\nwatcher done (270s)')

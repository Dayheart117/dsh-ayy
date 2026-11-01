// 临时探针：看真实 NapCat 历史消息的结构（尤其 file 段）
import { readFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync('C:/Users/dayheart/.dsh/qq-bridge-config.json', 'utf8'))
const H = { 'content-type': 'application/json', authorization: 'Bearer ' + cfg['令牌'] }
const base = cfg.NapCat

async function call(action, body) {
  const r = await fetch(base + '/' + action, { method: 'POST', headers: H, body: JSON.stringify(body || {}) })
  return r.json()
}

const friend = await call('get_friend_msg_history', { user_id: Number(cfg['私聊QQ']), count: 20 })
const group = await call('get_group_msg_history', { group_id: Number(cfg['群号']), count: 20 })

const kinds = new Map()
function walk(where, j) {
  const msgs = (j && j.status === 'ok' && j.data && Array.isArray(j.data.messages)) ? j.data.messages : []
  console.log(`\n=== ${where} messages=${msgs.length} retcode=${j.retcode} ===`)
  for (const m of msgs.slice(-8)) {
    const segs = Array.isArray(m.message) ? m.message : []
    const types = segs.map((s) => s && s.type).join(',')
    for (const s of segs) {
      const t = s && s.type
      kinds.set(t, (kinds.get(t) || 0) + 1)
    }
    console.log(`-- id=${m.message_id} time=${m.time} user=${m.user_id} sender=${(m.sender || {}).nickname} raw_g=${String(m.raw_message || '').slice(0, 60)}`)
    for (const s of segs) {
      if (s && s.type === 'file') console.log('   FILE SEG:', JSON.stringify(s, null, 2))
      else if (s && s.type === 'text') console.log('   text:', String(s.data && s.data.text).slice(0, 60))
      else console.log('   ', s && s.type, JSON.stringify(s && s.data).slice(0, 120))
    }
  }
}

walk('friend', friend)
walk('group', group)
console.log('\nsegment type counts:', JSON.stringify([...kinds.entries()]))

// 如果加了好友文件，尝试 get_file 的结构（不给参数，看报错文案）
const probe = await call('get_file', {})
console.log('\nget_file on empty body =>', JSON.stringify(probe).slice(0, 400))

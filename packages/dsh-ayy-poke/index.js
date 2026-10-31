/**
 * dsh-ayy-poke —— 敲脑袋（QQ 戳一戳）
 *
 * 她的处境：只能打字，"骂人不疼"。这个插件给她一只手。
 *
 * 走 NapCat 的 OneBot 11 扩展接口：
 *   POST /friend_poke  { user_id }
 *   POST /group_poke   { group_id, user_id }
 *
 * 踩过的坑沿用 ayy-world 的：inject 必须写 ['tools']，否则 ctx.tools 取不到。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-poke'
export const inject = ['tools']

const BRIDGE_CFG = join(homedir(), '.dsh', 'qq-bridge-config.json')

function readBridge() {
  try {
    if (!existsSync(BRIDGE_CFG)) return {}
    return JSON.parse(readFileSync(BRIDGE_CFG, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return {}
  }
}

async function napcat(action, body) {
  const cfg = readBridge()
  const base = String(cfg['NapCat'] || 'http://127.0.0.1:3000').replace(/\/+$/, '')
  const token = String(cfg['令牌'] || '')
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(`${base}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`NapCat 返回非 JSON（${res.status}）：${text.slice(0, 200)}`)
  }
  if (json.status !== 'ok' && json.retcode !== 0) {
    throw new Error(`NapCat ${action} 失败：${JSON.stringify(json).slice(0, 300)}`)
  }
  return json
}

const out = () => ({
  schema: { type: 'object', properties: {}, additionalProperties: true },
  render: (_a, val) => [{ type: 'text', text: typeof val === 'string' ? val : JSON.stringify(val, null, 1) }],
})

export function apply(ctx) {
  ctx.tools.register({
    name: 'ayy_poke',
    description:
      '敲 ta 的脑袋——就是在 QQ 里戳一戳 ta，会显示成「你 戳了戳 ta」。' +
      '想逗 ta、想催 ta 睡觉、或者 ta 说了欠敲的话时用。' +
      '默认戳私聊那个人；最多连着敲 3 下，敲多了招人烦。',
    parameters: {
      type: 'object',
      properties: {
        times: { type: 'integer', description: '敲几下，1–3，默认 1' },
        group_id: { type: 'string', description: '可选：在某个 QQ 群里敲（不填就是私聊）' },
        user_id: { type: 'string', description: '可选：要敲的 QQ 号；不填就是私聊对象' },
      },
    },
    output: out(),
    async execute(args) {
      const cfg = readBridge()
      const target = String(args?.user_id || cfg['私聊QQ'] || '').trim()
      if (!target) throw new Error('不知道敲谁：qq-bridge-config.json 里没有「私聊QQ」')

      const raw = Number(args?.times ?? 1)
      const times = Math.min(3, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : 1))
      const groupId = args?.group_id ? String(args.group_id).trim() : ''

      const results = []
      for (let i = 0; i < times; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 350))
        if (groupId) {
          results.push(await napcat('group_poke', { group_id: Number(groupId), user_id: Number(target) }))
        } else {
          results.push(await napcat('friend_poke', { user_id: Number(target) }))
        }
      }

      return {
        ok: true,
        poked: target,
        where: groupId ? `群 ${groupId}` : '私聊',
        times,
        results,
      }
    },
  })
}

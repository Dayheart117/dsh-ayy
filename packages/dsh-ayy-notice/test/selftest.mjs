/**
 * dsh-ayy-notice 自测：假的 ctx + 假 NapCat + 真 HTTP，一条真会话都不碰。
 *
 *   node test/selftest.mjs
 *
 * 覆盖：私聊/群 戳一戳、私聊/群 撤回、进退群、未处理类型、去重、口令错 403、
 *       非 notice 忽略、注入失败重试、自己戳自己跳过。
 */
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'node:http'

const HOME = mkdtempSync(join(tmpdir(), 'ayy-notice-test-'))
const BRIDGE = join(HOME, 'bridge.json')
const PORT = 9911
const NAPCAT_FAKE = 3999
const TOKEN = 'test-token-1234567890'
const SELF = 3402595214

const PRIVATE = 'session-11111111-1111-1111-1111-111111111111'
const GROUP = 'session-22222222-2222-2222-2222-222222222222'
const FLAKY = 'session-33333333-3333-3333-3333-333333333333'

writeFileSync(join(HOME, 'config.json'), JSON.stringify({
  port: PORT,
  token: TOKEN,
  重试次数: 3,
  重试间隔毫秒: 30,
  测试会话: '',
}), 'utf8')

writeFileSync(BRIDGE, JSON.stringify({
  总开关: true,
  NapCat: `http://127.0.0.1:${NAPCAT_FAKE}`,
  令牌: 'fake-napcat-token',
  绑定: [
    { 类型: '私聊', 号码: '632506748', 会话: PRIVATE, 称呼: '小白', 开: true },
    { 类型: '群', 号码: '524271081', 会话: GROUP, 称呼: '群里的人', 开: true },
    { 类型: '私聊', 号码: '10001', 会话: FLAKY, 称呼: '爱掉的会话', 开: true },
  ],
}), 'utf8')

process.env.AYY_NOTICE_HOME = HOME
process.env.AYY_NOTICE_BRIDGE = BRIDGE

// 假 NapCat：昵称查询
const napcat = createServer((req, res) => {
  let raw = ''
  req.on('data', (c) => { raw += c })
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {}
    let data = { user_id: body.user_id }
    if (req.url.startsWith('/get_group_member_info')) {
      data = { group_id: body.group_id, user_id: body.user_id, nickname: '锤子', card: '' }
    } else if (req.url.startsWith('/get_stranger_info')) {
      data = { user_id: body.user_id, nickname: '陌生人昵称' }
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ status: 'ok', retcode: 0, data }))
  })
})
await new Promise((r) => napcat.listen(NAPCAT_FAKE, '127.0.0.1', r))

const mod = await import('../index.js')
const {
  apply, buildText, noticeKind, pokeActor, dedupKey, findBinding, handleNotice,
} = mod

// 假 ctx：记录被注入的话
const calls = []
function makeAgent(sid, failFirst = 0) {
  let n = 0
  return {
    followup: async (msg) => {
      n += 1
      if (n <= failFirst) throw new Error('假失败：会话刚好没活着')
      calls.push({ sid, text: msg.content.map((c) => c.text).join('') })
      return { ok: true }
    },
  }
}
const agents = new Map([
  [PRIVATE, makeAgent(PRIVATE)],
  [GROUP, makeAgent(GROUP)],
  [FLAKY, makeAgent(FLAKY, 1)],
])
const ctx = {
  agents: { get: (id) => agents.get(id) },
  effect: (fn) => fn(),
  timeout: (fn, ms) => setTimeout(fn, ms),
}

const cleanups = []
const cleanup = apply({ ...ctx, effect: (fn, _label) => { cleanups.push(fn()); return () => {} } })
await new Promise((r) => setTimeout(r, 300))

const url = `http://127.0.0.1:${PORT}/notice?token=${TOKEN}`
let pass = 0
let fail = 0
function ok(cond, label, extra) {
  if (cond) { pass += 1; console.log('  ok   ' + label) } else { fail += 1; console.log('  FAIL ' + label + (extra ? ' :: ' + extra : '')) }
}
function lastText(sid) {
  const hit = [...calls].reverse().find((c) => c.sid === sid)
  return hit ? hit.text : ''
}
function clearCalls() { calls.length = 0 }
async function post(payload, opts = {}) {
  const res = await fetch(opts.url || url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.text()
  await new Promise((r) => setTimeout(r, 250))   // 等异步处理落地
  return { status: res.status, body }
}
let seq = 0
function base(extra) {
  seq += 1
  return { time: 1800000000 + seq, self_id: SELF, post_type: 'notice', ...extra }
}

console.log('— 纯函数 —')
ok(buildText('poke', false, '小白') === '（小白戳了戳你）', '私聊戳一戳文案', buildText('poke', false, '小白'))
ok(buildText('poke', true, '锤子') === '（群里 锤子 戳了戳你）', '群戳一戳文案', buildText('poke', true, '锤子'))
ok(buildText('friend_recall', false, '小白') === '（小白撤回了一条消息）', '私聊撤回文案')
ok(buildText('group_recall', true, '锤子') === '（群里 锤子 撤回了一条消息）', '群撤回文案')
ok(buildText('group_increase', true, '新人') === '（群里 新人 进群了）', '进群文案')
ok(buildText('group_decrease', true, '走人') === '（群里 走人 退群了）', '退群文案')
ok(noticeKind({ notice_type: 'notify', sub_type: 'poke' }) === 'poke', 'NapCat 真实结构 notify+poke 认得出')
ok(noticeKind({ notice_type: 'poke' }) === 'poke', '老结构 notice_type=poke 也认')
ok(noticeKind({ notice_type: 'group_upload' }) === '', '不认识的通知返回空')
ok(dedupKey({ time: 5, notice_type: 'poke', user_id: 1 }) === '5|poke|||1', '去重 key 形状', dedupKey({ time: 5, notice_type: 'poke', user_id: 1 }))
ok(findBinding({ 绑定: [{ 类型: '私聊', 号码: '1', 会话: 'a' }] }, 'private', 1)?.会话 === 'a', '按私聊号找绑定')
ok(findBinding({ 绑定: [{ 类型: '群', 号码: '9', 会话: 'g' }] }, 'group', '9')?.会话 === 'g', '按群号找绑定（字符串）')
ok(findBinding({ 绑定: [{ 类型: '私聊', 号码: '1', 会话: 'a', 开: false }] }, 'private', 1) === null, '关掉的绑定不算')

console.log('— HTTP —')
clearCalls()
const r1 = await post(base({ notice_type: 'notify', sub_type: 'poke', user_id: 632506748, target_id: SELF, sender_id: 632506748 }))
ok(r1.status === 200 && JSON.parse(r1.body).status === 'ok', '私聊戳一戳：200 + 合法 JSON（NapCat 要 parse）', JSON.stringify(r1))
ok(lastText(PRIVATE) === '（小白戳了戳你）', '私聊戳一戳注入了正确文案', lastText(PRIVATE))

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', group_id: 524271081, user_id: 1610827876, target_id: SELF }))
ok(lastText(GROUP) === '（群里 锤子 戳了戳你）', '群戳一戳（昵称走 NapCat 查）', lastText(GROUP))

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', group_id: 524271081, user_id: 1610827876, target_id: 999 }))
ok(calls.length === 0, '戳的不是她 → 不注入', JSON.stringify(calls))

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', group_id: 524271081, user_id: SELF, target_id: 1610827876 }))
ok(calls.length === 0, '她自己戳别人 → 不注入', JSON.stringify(calls))

clearCalls()
await post(base({ notice_type: 'friend_recall', user_id: 632506748, message_id: 123 }))
ok(lastText(PRIVATE) === '（小白撤回了一条消息）', '私聊撤回文案', lastText(PRIVATE))

clearCalls()
await post(base({ notice_type: 'group_recall', group_id: 524271081, user_id: 1610827876, operator_id: 1610827876, message_id: 123 }))
ok(lastText(GROUP) === '（群里 锤子 撤回了一条消息）', '群撤回文案', lastText(GROUP))

clearCalls()
await post(base({ notice_type: 'group_increase', group_id: 524271081, user_id: 1610827876, operator_id: 1610827876, sub_type: 'invite' }))
ok(lastText(GROUP) === '（群里 锤子 进群了）', '进群文案', lastText(GROUP))

clearCalls()
await post(base({ notice_type: 'group_decrease', group_id: 524271081, user_id: 1610827876, operator_id: 1610827876, sub_type: 'leave' }))
ok(lastText(GROUP) === '（群里 锤子 退群了）', '退群文案', lastText(GROUP))

clearCalls()
const rUnk = await post(base({ notice_type: 'group_upload', group_id: 524271081, user_id: 1610827876 }))
ok(rUnk.status === 200 && calls.length === 0, '不认识的 notice_type：200 但不注入')

clearCalls()
const dupEv = base({ notice_type: 'notify', sub_type: 'poke', user_id: 632506748, target_id: SELF })
await post(dupEv)
await post(dupEv)
ok(calls.length === 1, '同一件事报两遍只注入一次', String(calls.length))

clearCalls()
const rb = await post(base({ notice_type: 'friend_recall', user_id: 632506748 }), { url: `http://127.0.0.1:${PORT}/notice?token=wrong` })
ok(rb.status === 403 && calls.length === 0, '口令错 → 403 且不注入', String(rb.status))

clearCalls()
const rm = await post({ post_type: 'message', message_type: 'private', user_id: 632506748, raw_message: '普通消息' })
ok(rm.status === 200 && calls.length === 0, '普通消息不转发（归桥管）')

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', user_id: 10001, target_id: SELF }))
ok(lastText(FLAKY) === '（爱掉的会话戳了戳你）' && calls.length === 1, '会话第一次失败 → 重试后只注入一次', JSON.stringify(calls))

clearCalls()
const rNoTarget = await post(base({ notice_type: 'notify', sub_type: 'poke', user_id: 632506748 }))
ok(rNoTarget.status === 200 && lastText(PRIVATE) === '（小白戳了戳你）', '缺 target_id 的私聊戳一戳也认')

// 日志里应该有「未处理的 notice_type=group_upload」
const logText = readFileSync(join(HOME, 'notice.log'), 'utf8')
ok(logText.includes('未处理的 notice_type=group_upload'), '未处理类型写进了日志')
ok(logText.includes('重复上报，忽略'), '重复上报写进了日志')
ok(logText.includes('口令不对'), '口令错写进了日志')

// 收尾：关服务
for (const fn of cleanups) { try { fn() } catch (e) { /* ignore */ } }
await new Promise((r) => setTimeout(r, 200))
try { napcat.close() } catch (e) { /* ignore */ }
try { rmSync(HOME, { recursive: true, force: true }) } catch (e) { /* ignore */ }

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'}  ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)

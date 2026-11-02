/**
 * dsh-ayy-qq 隔离自测：临时 DSH_HOME + 假 ctx + 真 HTTP（假 NapCat，不碰真会话、不碰真配置）。
 *
 *   node test/selftest.mjs
 *
 * 覆盖：
 *   1. 纯函数（文件名安全 / size / file 段解析 / 通知文案）
 *   2. 真下载（段内直链 / 本地缓存 / get_file 兜底 / 超 50MB / 404）
 *   3. 通知 HTTP 中继（戳一戳私聊+群 / 撤回 / 进退群 / 未处理类型 / 去重 / 口令）
 *   4. 文件轮询（注入文案、去重、跳过自己、水位）
 *   5. 「谁在说话」qq-speaker.json：写入、合并、来源、昵称缺省、100 条上限、并发不坏
 *   6. 老路径兼容（ayy-files/config|state|files.log、ayy-notice/config|notice.log 继续用）
 *   7. apply 入口（两个日志都有加载记录、卸载时 HTTP 服务关掉）
 */
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert'

const HOME = mkdtempSync(join(tmpdir(), 'ayy-qq-test-'))
const DSH_HOME = join(HOME, '.dsh')
mkdirSync(DSH_HOME, { recursive: true })
process.env.DSH_HOME = DSH_HOME

let pass = 0
const fails = []
function check(label, fn) {
  try { fn(); pass += 1; console.log('  ok   ' + label) } catch (error) {
    fails.push(label + ' -> ' + (error && error.message))
    console.log('  FAIL ' + label + ' -> ' + (error && error.message))
  }
}
async function checkAsync(label, fn) {
  try { await fn(); pass += 1; console.log('  ok   ' + label) } catch (error) {
    fails.push(label + ' -> ' + (error && error.message))
    console.log('  FAIL ' + label + ' -> ' + (error && error.message))
  }
}

// ── 假的 NapCat + 文件服务器 ──────────────────────────────────────────
const PDF = Buffer.from('%PDF-1.4\n% fake exam report for dsh-ayy-qq selftest\n%%EOF\n')
const SELF = 3402595214
const PRIVATE = 'session-11111111-1111-1111-1111-111111111111'
const GROUP = 'session-22222222-2222-2222-2222-222222222222'
const FLAKY = 'session-33333333-3333-3333-3333-333333333333'
const TOKEN = 'test-token-1234567890'

let historyQueue = []
const fakeCalls = []
let napcatPort = 0
const napcat = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    fakeCalls.push({ url: req.url, body })
    const send = (status, obj, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/get_friend_msg_history') return send(200, { status: 'ok', retcode: 0, data: { messages: historyQueue } })
    if (req.url === '/get_group_msg_history') return send(200, { status: 'ok', retcode: 0, data: { messages: [] } })
    if (req.url === '/get_login_info') return send(200, { status: 'ok', retcode: 0, data: { user_id: SELF, nickname: '源月为安' } })
    if (req.url === '/get_group_member_info') return send(200, { status: 'ok', retcode: 0, data: { group_id: body.group_id, user_id: body.user_id, nickname: '锤子', card: '' } })
    if (req.url === '/get_stranger_info') return send(200, { status: 'ok', retcode: 0, data: { user_id: body.user_id, nickname: '陌生人昵称' } })
    if (req.url === '/get_file') {
      if (body.file_id && String(body.file_id).includes('ok')) {
        return send(200, { status: 'ok', retcode: 0, data: { file: '', url: `http://127.0.0.1:${napcatPort}/download/from-get-file.pdf`, file_size: String(PDF.length), file_name: '从get_file拿到的.pdf' } })
      }
      return send(200, { status: 'failed', retcode: 200, data: null, message: 'file not found', wording: 'file not found' })
    }
    if (req.url.startsWith('/download/')) {
      if (req.url.includes('missing')) { res.writeHead(404); return res.end('not found') }
      res.writeHead(200, { 'content-length': String(PDF.length), 'content-type': 'application/pdf' })
      return res.end(PDF)
    }
    send(404, { status: 'failed', retcode: 404, data: null, message: 'no such action' })
  })
})
await new Promise((r) => napcat.listen(0, '127.0.0.1', r))
napcatPort = napcat.address().port

// 找一个空闲端口给通知中继
const probe = createServer()
await new Promise((r) => probe.listen(0, '127.0.0.1', r))
const PORT = probe.address().port
await new Promise((r) => probe.close(r))

// 老路径的配置：必须在合并后继续生效
mkdirSync(join(DSH_HOME, 'ayy-notice'), { recursive: true })
mkdirSync(join(DSH_HOME, 'ayy-files'), { recursive: true })
writeFileSync(join(DSH_HOME, 'ayy-notice', 'config.json'), JSON.stringify({
  port: PORT,
  token: TOKEN,
  重试次数: 3,
  重试间隔毫秒: 20,
  测试会话: '',
}, null, 2), 'utf8')
writeFileSync(join(DSH_HOME, 'ayy-files', 'config.json'), JSON.stringify({
  只处理私聊: true,
  只收某个QQ发的: '',
}, null, 2), 'utf8')
writeFileSync(join(DSH_HOME, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true,
  NapCat: `http://127.0.0.1:${napcatPort}`,
  令牌: 'test-napcat-token',
  绑定: [
    { 类型: '私聊', 号码: '632506748', 会话: PRIVATE, 称呼: '小白', 开: true },
    { 类型: '群', 号码: '524271081', 会话: GROUP, 称呼: '群里的人', 开: true },
    { 类型: '私聊', 号码: '10001', 会话: FLAKY, 称呼: '爱掉的会话', 开: true },
  ],
}, null, 2), 'utf8')

const lib = await import('../index.js')
const T = lib.__test
const bridge = JSON.parse(readFileSync(join(DSH_HOME, 'qq-bridge-config.json'), 'utf8'))
const privateBinding = bridge['绑定'][0]
const groupBinding = bridge['绑定'][1]
const SPEAKER = join(DSH_HOME, 'qq-speaker.json')

// ── 假 ctx：记录被注入的话 ────────────────────────────────────────────
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
const ctx = { agents: { get: (id) => agents.get(id) }, effect: () => () => {}, timeout: (fn, ms) => setTimeout(fn, ms) }

function readSpeaker() { return JSON.parse(readFileSync(SPEAKER, 'utf8')) }
function speakerOf(sid) { return readSpeaker()[sid] || null }
function lastText(sid) {
  const hit = [...calls].reverse().find((c) => c.sid === sid)
  return hit ? hit.text : ''
}
function clearCalls() { calls.length = 0 }
function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
function fb(day) { return join(DSH_HOME, 'ayy-files', day) }

console.log('\n== 1. 纯函数 ==')
check('文件名去掉 Windows 非法字符', () => {
  assert.strictEqual(T.sanitizeName('模考复盘.pdf'), '模考复盘.pdf')
  assert.strictEqual(T.sanitizeName('a/b:c*d?.pdf'), 'b_c_d_.pdf')
  assert.strictEqual(T.sanitizeName('../../etc/passwd'), 'passwd')
  assert.strictEqual(T.sanitizeName('   '), 'qq-file')
  assert.strictEqual(T.sanitizeName('CON.pdf'), '_CON.pdf')
})
check('大小格式化', () => {
  assert.strictEqual(T.fmtSize(1258291), '1.2MB')
  assert.strictEqual(T.fmtSize(512), '512B')
  assert.strictEqual(T.fmtSize(2048), '2KB')
})
check('解析 file 段：文档 shape', () => {
  const m = T.parseFileSeg({ type: 'file', data: { file: '模考复盘.pdf', url: 'https://x/y', name: '模考复盘.pdf', file_size: '1234' } })
  assert.strictEqual(m.name, '模考复盘.pdf')
  assert.strictEqual(m.url, 'https://x/y')
  assert.strictEqual(m.size, 1234)
})
check('解析 file 段：只有 file_id + file（老 NapCat）', () => {
  const m = T.parseFileSeg({ type: 'file', data: { file: 'a.zip', file_id: '/abc/def', file_size: 99 } })
  assert.strictEqual(m.fileId, '/abc/def')
  assert.strictEqual(m.url, '')
  assert.strictEqual(m.size, 99)
})
check('文件文案跟原插件一字不差', () => {
  const text = T.buildNotice(privateBinding, { sender: { nickname: '白昼菌' } }, [
    { ok: true, name: '模考复盘.pdf', bytes: 1258291, path: 'C:\\x\\模考复盘.pdf' },
  ])
  assert.strictEqual(text, '（小白发了 1 个文件：模考复盘.pdf，1.2MB，已经存到 C:\\x\\模考复盘.pdf，需要就看这个路径）')
})
check('通知文案', () => {
  assert.strictEqual(T.buildText('poke', false, '小白'), '（小白戳了戳你）')
  assert.strictEqual(T.buildText('poke', true, '锤子'), '（群里 锤子 戳了戳你）')
  assert.strictEqual(T.buildText('friend_recall', false, '小白'), '（小白撤回了一条消息）')
  assert.strictEqual(T.buildText('group_recall', true, '锤子'), '（群里 锤子 撤回了一条消息）')
  assert.strictEqual(T.buildText('group_increase', true, '新人'), '（群里 新人 进群了）')
  assert.strictEqual(T.buildText('group_decrease', true, '走人'), '（群里 走人 退群了）')
})
check('去重 key / notice 类型识别', () => {
  assert.strictEqual(T.dedupKey({ time: 5, notice_type: 'poke', user_id: 1 }), '5|poke|||1')
  assert.strictEqual(T.noticeKind({ notice_type: 'notify', sub_type: 'poke' }), 'poke')
  assert.strictEqual(T.noticeKind({ notice_type: 'poke' }), 'poke')
  assert.strictEqual(T.noticeKind({ notice_type: 'group_upload' }), '')
})
check('共享的 会话 id -> 名字 解析', () => {
  assert.strictEqual(T.findBindingBySession(bridge, PRIVATE)['称呼'], '小白')
  assert.strictEqual(T.sessionName(bridge, PRIVATE), '小白')
  assert.ok(T.sessionName(bridge, GROUP).includes('群 524271081'), T.sessionName(bridge, GROUP))
  assert.ok(T.sessionName(bridge, 'session-nope').startsWith('会话 '), T.sessionName(bridge, 'session-nope'))
})

console.log('\n== 2. 真下载（假 HTTP 服务）==')
await checkAsync('段内直链 -> 落盘 + 文案给出真实路径', async () => {
  const seg = { type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${napcatPort}/download/report`, file_size: PDF.length } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(existsSync(r.path), r.path)
  assert.strictEqual(statSync(r.path).size, PDF.length)
  assert.ok(r.path.startsWith(fb(today())), r.path)
})
await checkAsync('同名再加一个 -> (2) 序号', async () => {
  const seg = { type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${napcatPort}/download/report` } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(/模考复盘 \(2\)\.pdf$/.test(r.path), r.path)
})
await checkAsync('本地缓存（file:///）-> 直接读', async () => {
  const p = join(HOME, 'cache.pdf')
  writeFileSync(p, PDF)
  const seg = { type: 'file', data: { name: '缓存.pdf', file: 'file:///' + p.replace(/\\/g, '/') } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.strictEqual(r.from, '本地缓存')
})
await checkAsync('只有 file_id -> get_file 兜底', async () => {
  const seg = { type: 'file', data: { name: '从get_file拿到的.pdf', file_id: 'ok-123' } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.strictEqual(r.from, 'get_file→直链')
})
await checkAsync('超 50MB -> 只通知、不下载', async () => {
  const seg = { type: 'file', data: { name: '超大的.zip', file_size: 60 * 1024 * 1024 } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.strictEqual(r.ok, false)
  assert.ok(r.reason.includes('太大'), r.reason)
})
await checkAsync('下载 404 -> 没取到（带原因）', async () => {
  const seg = { type: 'file', data: { name: '丢了.pdf', url: `http://127.0.0.1:${napcatPort}/download/missing` } }
  const r = await T.saveOneFile(bridge, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.strictEqual(r.ok, false)
  assert.ok(r.reason.includes('404'), r.reason)
})

console.log('\n== 3. 通知 HTTP 中继（真监听 + 真 POST）==')
const started = T.startServer(ctx)
await new Promise((r) => started.server.once('listening', r))
const url = `http://127.0.0.1:${PORT}/notice?token=${TOKEN}`
let seq = 0
function base(extra) {
  seq += 1
  return { time: 1800000000 + seq, self_id: SELF, post_type: 'notice', ...extra }
}
async function post(payload, opts = {}) {
  const res = await fetch(opts.url || url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.text()
  await new Promise((r) => setTimeout(r, 250))
  return { status: res.status, body }
}

clearCalls()
const r1 = await post(base({ notice_type: 'notify', sub_type: 'poke', user_id: 632506748, target_id: SELF, sender_id: 632506748 }))
check('私聊戳一戳：200 + 合法 JSON（NapCat 要 parse）', () => {
  assert.strictEqual(r1.status, 200)
  assert.strictEqual(JSON.parse(r1.body).status, 'ok')
})
check('私聊戳一戳：注入正确文案', () => {
  assert.strictEqual(lastText(PRIVATE), '（小白戳了戳你）', lastText(PRIVATE))
})
check('戳一戳写进 qq-speaker.json（昵称来自绑定称呼）', () => {
  const one = speakerOf(PRIVATE)
  assert.ok(one, JSON.stringify(readSpeaker()))
  assert.strictEqual(one['昵称'], '小白')
  assert.strictEqual(one.QQ, '632506748')
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(one['时间']), one['时间'])
  assert.strictEqual(one['来源'], '戳一戳')
})

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', group_id: 524271081, user_id: 1610827876, target_id: SELF }))
check('群戳一戳：昵称走 NapCat 查', () => {
  assert.strictEqual(lastText(GROUP), '（群里 锤子 戳了戳你）', lastText(GROUP))
})
check('群戳一戳写进 qq-speaker（锤子 / 1610827876）', () => {
  const one = speakerOf(GROUP)
  assert.strictEqual(one['昵称'], '锤子')
  assert.strictEqual(one.QQ, '1610827876')
  assert.strictEqual(one['来源'], '戳一戳')
})

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', group_id: 524271081, user_id: 1610827876, target_id: 999 }))
check('戳的不是她 -> 不注入、不记说话人', () => {
  assert.strictEqual(calls.length, 0)
  assert.strictEqual(speakerOf(GROUP).QQ, '1610827876')   // 还是上一条，没被覆盖
})

clearCalls()
await post(base({ notice_type: 'friend_recall', user_id: 632506748, message_id: 123 }))
check('私聊撤回：文案 + 说话人来源=撤回', () => {
  assert.strictEqual(lastText(PRIVATE), '（小白撤回了一条消息）', lastText(PRIVATE))
  assert.strictEqual(speakerOf(PRIVATE)['来源'], '撤回')
})

clearCalls()
await post(base({ notice_type: 'group_recall', group_id: 524271081, user_id: 1610827876, operator_id: 1610827876, message_id: 123 }))
check('群撤回：文案 + 说话人来源=撤回', () => {
  assert.strictEqual(lastText(GROUP), '（群里 锤子 撤回了一条消息）', lastText(GROUP))
  assert.strictEqual(speakerOf(GROUP)['来源'], '撤回')
})

clearCalls()
await post(base({ notice_type: 'group_increase', group_id: 524271081, user_id: 1610827876, operator_id: 1610827876, sub_type: 'invite' }))
check('进群：文案 + 说话人来源=群成员变动', () => {
  assert.strictEqual(lastText(GROUP), '（群里 锤子 进群了）', lastText(GROUP))
  assert.strictEqual(speakerOf(GROUP)['来源'], '群成员变动')
})

clearCalls()
const rUnknown = await post(base({ notice_type: 'group_upload', group_id: 524271081, user_id: 1610827876 }))
check('不认识的 notice_type：200 但不注入', () => {
  assert.strictEqual(rUnknown.status, 200)
  assert.strictEqual(calls.length, 0)
})

clearCalls()
const dupEv = base({ notice_type: 'friend_recall', user_id: 632506748, message_id: 456 })
await post(dupEv)
const afterFirst = speakerOf(PRIVATE)['时间']
await new Promise((r) => setTimeout(r, 1100))   // 跨一分钟边界也没关系，只比较「没被重写」
await post(dupEv)
check('同一件事报两遍只注入一次（去重）', () => { assert.strictEqual(calls.length, 1, String(calls.length)) })

clearCalls()
const rb = await post(base({ notice_type: 'friend_recall', user_id: 632506748 }), { url: `http://127.0.0.1:${PORT}/notice?token=wrong` })
check('口令错 -> 403 且不注入', () => {
  assert.strictEqual(rb.status, 403)
  assert.strictEqual(calls.length, 0)
})

clearCalls()
const rm = await post({ post_type: 'message', message_type: 'private', user_id: 632506748, raw_message: '普通消息' })
check('普通消息不转发（归桥管）', () => {
  assert.strictEqual(rm.status, 200)
  assert.strictEqual(calls.length, 0)
})

clearCalls()
await post(base({ notice_type: 'notify', sub_type: 'poke', user_id: 10001, target_id: SELF }))
check('会话第一次失败 -> 重试后只注入一次', () => {
  assert.strictEqual(lastText(FLAKY), '（爱掉的会话戳了戳你）', lastText(FLAKY))
  assert.strictEqual(calls.length, 1, JSON.stringify(calls))
})

// 通知日志仍在老路径
check('通知日志写在 ~/.dsh/ayy-notice/notice.log', () => {
  const text = readFileSync(join(DSH_HOME, 'ayy-notice', 'notice.log'), 'utf8')
  assert.ok(text.includes('未处理的 notice_type=group_upload'), text.slice(-400))
  assert.ok(text.includes('重复上报，忽略'), '去重没写日志')
  assert.ok(text.includes('口令不对'), '口令错没写日志')
})

console.log('\n== 4. 文件轮询（老路径 + 说话人=文件）==')
const now = Math.floor(Date.now() / 1000)
historyQueue = []
await T.pollOnce(ctx, { inject: async () => { throw new Error('不该注入') } })
check('第一次只初始化水位', () => {
  assert.ok(T.readState().watermark['私聊:632506748'] > 0)
})
historyQueue = [
  { message_id: 9001, time: now + 1, user_id: SELF, sender: { nickname: '源月为安' }, message: [{ type: 'file', data: { name: '自己发的.pdf', url: `http://127.0.0.1:${napcatPort}/download/report` } }] },
  { message_id: 9002, time: now + 1, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'text', data: { text: '看这个' } }] },
  { message_id: 9003, time: now + 2, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${napcatPort}/download/report` } }] },
]
const sentNotices = []
await checkAsync('文件事件注入 + 去重 + 跳过自己发的', async () => {
  const hooks = { inject: async (session, text) => { sentNotices.push({ session, text }) } }
  await T.pollOnce(ctx, hooks)
  assert.strictEqual(sentNotices.length, 1, JSON.stringify(sentNotices))
  assert.strictEqual(sentNotices[0].session, PRIVATE)
  assert.ok(sentNotices[0].text.includes('小白发了 1 个文件'), sentNotices[0].text)
  assert.ok(sentNotices[0].text.includes(join(fb(today()), '模考复盘')), sentNotices[0].text)
  const st = T.readState()
  assert.ok(st.seen.includes('9003'))
  assert.ok(!st.seen.includes('9001'), '自己发的文件不该进 seen')
  await T.pollOnce(ctx, hooks)
  assert.strictEqual(sentNotices.length, 1, '重复注入了')
})
check('文件事件把「谁在说话」更新成 来源=文件', () => {
  const one = speakerOf(PRIVATE)
  assert.strictEqual(one['来源'], '文件')
  assert.strictEqual(one.QQ, '632506748')
  assert.strictEqual(one['昵称'], '小白')
})
check('文件状态/日志仍在老路径（ayy-files/state.json + files.log）', () => {
  assert.ok(existsSync(join(DSH_HOME, 'ayy-files', 'state.json')))
  const text = readFileSync(join(DSH_HOME, 'ayy-files', 'files.log'), 'utf8')
  assert.ok(text.includes('第一次跑，水位'), text.slice(-400))
})

console.log('\n== 5. qq-speaker.json：合并 / 缺昵称 / 上限 / 并发 ==')
check('合并：同一会话更新但保留上次昵称', () => {
  assert.ok(T.recordSpeaker({ 会话: 'session-merge', QQ: '1610827876', 昵称: '锤子', 来源: '戳一戳' }))
  const before = speakerOf('session-merge')['时间']
  assert.ok(T.recordSpeaker({ 会话: 'session-merge', QQ: '1610827876', 来源: '撤回' }))
  const one = speakerOf('session-merge')
  assert.strictEqual(one['昵称'], '锤子', '缺昵称时应保留上次的昵称')
  assert.strictEqual(one['来源'], '撤回')
  assert.ok(before <= one['时间'])
})
check('取不到昵称就只写 QQ 号（不写空昵称）', () => {
  assert.ok(T.recordSpeaker({ 会话: 'session-noname', QQ: '999', 来源: '文件' }))
  const one = speakerOf('session-noname')
  assert.strictEqual(one['昵称'], undefined)
  assert.strictEqual(one.QQ, '999')
})
check('只保留最近 100 个会话', () => {
  // 先塞 120 条旧记录，再记 1 条新的
  const seed = {}
  for (let i = 0; i < 120; i++) seed['session-old-' + i] = { QQ: String(i), 时间: `2020-01-01 00:${String(i % 60).padStart(2, '0')}`, 来源: '戳一戳' }
  writeFileSync(SPEAKER, JSON.stringify(seed), 'utf8')
  assert.ok(T.recordSpeaker({ 会话: 'session-fresh', QQ: '555', 昵称: '新来的', 来源: '戳一戳' }))
  const all = readSpeaker()
  assert.strictEqual(Object.keys(all).length, 100, '条数=' + Object.keys(all).length)
  assert.ok(all['session-fresh'], '新记录被裁掉了')
})
await checkAsync('并发写入不坏（40 条同时写）', async () => {
  const jobs = []
  for (let i = 0; i < 40; i++) {
    jobs.push(Promise.resolve().then(() => T.recordSpeaker({ 会话: 'session-c-' + i, QQ: String(7000 + i), 昵称: 'c' + i, 来源: '戳一戳' })))
  }
  const results = await Promise.all(jobs)
  assert.ok(results.every(Boolean), JSON.stringify(results))
  const all = readSpeaker()                 // 能 JSON.parse 就说明文件没写坏
  assert.ok(Object.keys(all).length <= 100)
  for (let i = 0; i < 40; i++) assert.ok(all['session-c-' + i], '丢了 session-c-' + i)
  const leftovers = readdirSync(DSH_HOME).filter((f) => f.includes('qq-speaker.json.') && f.endsWith('.tmp'))
  assert.deepStrictEqual(leftovers, [], '留下了临时文件：' + leftovers.join(','))
})

console.log('\n== 6. apply 入口 / 老日志 ==')
await checkAsync('先关掉手动的通知服务', async () => {
  await new Promise((r) => started.server.close(r))
  started.server.closeAllConnections?.()
  await new Promise((r) => setTimeout(r, 200))
})
let effectFn = null
let disposer = null
const fakeApplyCtx = {
  agents: { get: () => undefined },
  effect: (fn) => { effectFn = fn; disposer = fn(); return () => {} },
  interval: (fn, ms) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); return () => clearInterval(h) },
  timeout: (fn, ms) => { const h = setTimeout(fn, ms); if (h.unref) h.unref(); return () => clearTimeout(h) },
}
historyQueue = []
lib.apply(fakeApplyCtx)
await new Promise((r) => setTimeout(r, 400))
await checkAsync('apply 不抛、注册了 effect、返回清理函数', async () => {
  assert.ok(typeof effectFn === 'function', '没调 ctx.effect')
  assert.ok(typeof disposer === 'function', 'effect 没返回清理函数')
})
await checkAsync('合并日志 ~/.dsh/ayy-qq/qq.log 有加载记录', async () => {
  const text = readFileSync(join(DSH_HOME, 'ayy-qq', 'qq.log'), 'utf8')
  assert.ok(text.includes('已加载 v0.1.0'), text.slice(-400))
})
await checkAsync('apply 里的 HTTP 服务真的在监听（根路径 404）', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`)
  assert.strictEqual(res.status, 404)
})
check('老日志：files.log / notice.log 都有加载记录', () => {
  assert.ok(readFileSync(join(DSH_HOME, 'ayy-files', 'files.log'), 'utf8').includes('已加载 v0.1.0'))
  assert.ok(readFileSync(join(DSH_HOME, 'ayy-notice', 'notice.log'), 'utf8').includes('已加载 v0.1.0'))
})
check('通知配置读完没被改（端口/口令原样）', () => {
  const cfg = JSON.parse(readFileSync(join(DSH_HOME, 'ayy-notice', 'config.json'), 'utf8'))
  assert.strictEqual(cfg.port, PORT)
  assert.strictEqual(cfg.token, TOKEN)
  assert.ok('重试次数' in cfg)
})
await checkAsync('卸载后 HTTP 端口释放 + 日志有卸载记录', async () => {
  disposer()
  await new Promise((r) => setTimeout(r, 300))
  const qqLog = readFileSync(join(DSH_HOME, 'ayy-qq', 'qq.log'), 'utf8')
  assert.ok(qqLog.includes('已卸载'), qqLog.slice(-300))
  const probe2 = createServer()
  await new Promise((resolve, reject) => {
    probe2.once('error', reject)
    probe2.listen(PORT, '127.0.0.1', resolve)
  })
  await new Promise((r) => probe2.close(r))
})

// 收尾
try { napcat.close() } catch (e) { /* ignore */ }
console.log(`\n结果：${pass} 过，${fails.length} 挂`)
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exitCode = 1 }
try { rmSync(HOME, { recursive: true, force: true }) } catch (e) { /* ignore */ }

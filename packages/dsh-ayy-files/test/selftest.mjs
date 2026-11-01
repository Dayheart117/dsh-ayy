/**
 * dsh-ayy-files 自测 harness（不连真 NapCat，用本地假的 HTTP 服务喂真实 shape）。
 *
 * 跑法：
 *   $env:DSH_HOME = <临时目录>; node test\selftest.mjs
 * 或直接 node test\selftest.mjs（内部会把 DSH_HOME 指到一个临时目录）
 *
 * 覆盖：路径安全 / 大小格式化 / file 段解析（各种字段变体）/ 直链下载 / 本地缓存 /
 *      get_file 兜底 / 超 50MB 只通知 / 下载失败照实说 / 重名加序号 /
 *      一轮完整 pollOnce（注入文案、去重、跳过自己发的、会话注入失败重试）。
 */
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import assert from 'node:assert'

const HOME = mkdtempSync(join(tmpdir(), 'ayy-files-test-'))
process.env.DSH_HOME = join(HOME, '.dsh')
mkdirSync(process.env.DSH_HOME, { recursive: true })

const lib = await import('../index.js')
const T = lib.__test

let pass = 0
const fails = []
function check(label, fn) {
  try { fn(); pass += 1; console.log('  ✓ ' + label) } catch (error) {
    fails.push(label + ' → ' + (error && error.message))
    console.log('  ✗ ' + label + ' → ' + (error && error.message))
  }
}
async function checkAsync(label, fn) {
  try { await fn(); pass += 1; console.log('  ✓ ' + label) } catch (error) {
    fails.push(label + ' → ' + (error && error.message))
    console.log('  ✗ ' + label + ' → ' + (error && error.message))
  }
}

// ── 假的 NapCat + 文件服务器 ──────────────────────────────────────────
const PDF = Buffer.from('%PDF-1.4\n% fake exam report for dsh-ayy-files selftest\n%%EOF\n')
const BIG = 'x'.repeat(2 * 1024 * 1024)
let historyQueue = []          // 下一次 pollOnce 用的历史消息
let fakeCalls = []
const server = createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
    fakeCalls.push({ url: req.url, body })
    const send = (status, obj, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(obj))
    }
    if (req.url === '/get_friend_msg_history') {
      return send(200, { status: 'ok', retcode: 0, data: { messages: historyQueue } })
    }
    if (req.url === '/get_group_msg_history') {
      return send(200, { status: 'ok', retcode: 0, data: { messages: [] } })
    }
    if (req.url === '/get_login_info') {
      return send(200, { status: 'ok', retcode: 0, data: { user_id: 3402595214, nickname: '源月为安' } })
    }
    if (req.url === '/get_file') {
      // 模拟 NapCat get_file 的文档返回值：url + file + file_size + file_name
      if (body.file_id && String(body.file_id).includes('ok')) {
        return send(200, {
          status: 'ok', retcode: 0,
          data: { file: '', url: `http://127.0.0.1:${port}/download/from-get-file.pdf`, file_size: String(PDF.length), file_name: '从get_file拿到的.pdf' },
        })
      }
      return send(200, { status: 'failed', retcode: 200, data: null, message: 'file not found', wording: 'file not found' })
    }
    if (req.url.startsWith('/download/')) {
      if (req.url.includes('missing')) { res.writeHead(404); return res.end('not found') }
      if (req.url.includes('huge')) { res.writeHead(200, { 'content-length': String(60 * 1024 * 1024) }); return res.end(BIG) }
      res.writeHead(200, { 'content-length': String(PDF.length), 'content-type': 'application/pdf' })
      return res.end(PDF)
    }
    send(404, { status: 'failed', retcode: 404, data: null, message: 'no such action' })
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port

// 假的桥配置：NapCat 指向假服务，私聊绑一个「假会话」
writeFileSync(join(process.env.DSH_HOME, 'qq-bridge-config.json'), JSON.stringify({
  总开关: true,
  NapCat: `http://127.0.0.1:${port}`,
  令牌: 'test-token',
  私聊QQ: '632506748',
  群号: '524271081',
  绑定: [
    { 类型: '私聊', 号码: '632506748', 会话: 'session-test-private', 称呼: '小白', 开: true },
    { 类型: '群', 号码: '524271081', 会话: 'session-test-group', 称呼: '群里的人', 开: true },
  ],
}, null, 2), 'utf8')

const cfg = JSON.parse(readFileSync(join(process.env.DSH_HOME, 'qq-bridge-config.json'), 'utf8'))
const privateBinding = cfg.绑定[0]

function fb(day) {
  return join(process.env.DSH_HOME, 'ayy-files', day)
}
function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

console.log('\n== 1. 纯函数 ==')
check('文件名去掉 Windows 非法字符', () => {
  assert.strictEqual(T.sanitizeName('模考复盘.pdf'), '模考复盘.pdf')
  assert.strictEqual(T.sanitizeName('a/b:c*d?.pdf'), 'b_c_d_.pdf')
  assert.strictEqual(T.sanitizeName('../../etc/passwd'), 'passwd')
  assert.strictEqual(T.sanitizeName('   '), 'qq-file')
  assert.strictEqual(T.sanitizeName('CON.pdf'), '_CON.pdf')
})
check('大小格式化跟 spec 的 1.2MB 一致', () => {
  assert.strictEqual(T.fmtSize(1258291), '1.2MB')
  assert.strictEqual(T.fmtSize(512), '512B')
  assert.strictEqual(T.fmtSize(2048), '2KB')
})
check('解析：文档 shape（file/url/name/path）', () => {
  const m = T.parseFileSeg({ type: 'file', data: { file: '模考复盘.pdf', url: 'https://x/y', name: '模考复盘.pdf', file_size: '1234' } })
  assert.strictEqual(m.name, '模考复盘.pdf')
  assert.strictEqual(m.url, 'https://x/y')
  assert.strictEqual(m.size, 1234)
})
check('解析：只有 file_id + file（老 NapCat）', () => {
  const m = T.parseFileSeg({ type: 'file', data: { file: 'a.zip', file_id: '/abc/def', file_size: 99 } })
  assert.strictEqual(m.fileId, '/abc/def')
  assert.strictEqual(m.url, '')
  assert.strictEqual(m.size, 99)
})
check('解析：file 是 file:/// 本地路径 → 认成本地缓存', () => {
  const p = join(HOME, 'cache.pdf')
  writeFileSync(p, PDF)
  const uri = 'file:///' + p.replace(/\\/g, '/')
  const m = T.parseFileSeg({ type: 'file', data: { file: uri } })
  assert.ok(m.local.includes(p), 'local=' + JSON.stringify(m.local))
})
check('解析：名字缺失时从路径猜', () => {
  const m = T.parseFileSeg({ type: 'file', data: { file: 'C:\\napcat\\cache\\报告.docx' } })
  assert.strictEqual(m.name, '报告.docx')
})
check('文案：单个文件跟 spec 一字不差', () => {
  const text = T.buildNotice(privateBinding, { sender: { nickname: '白昼菌' } }, [
    { ok: true, name: '模考复盘.pdf', bytes: 1258291, path: 'C:\\Users\\dayheart\\.dsh\\ayy-files\\2026-11-01\\模考复盘.pdf' },
  ])
  assert.strictEqual(text, '（小白发了 1 个文件：模考复盘.pdf，1.2MB，已经存到 C:\\Users\\dayheart\\.dsh\\ayy-files\\2026-11-01\\模考复盘.pdf，需要就看这个路径）')
})
check('文案：多个文件 + 一个没取到', () => {
  const text = T.buildNotice(privateBinding, {}, [
    { ok: true, name: 'a.pdf', bytes: 2048, path: 'D:\\x\\a.pdf' },
    { ok: false, name: 'b.zip', reason: '太大（60.0MB，上限 50.0MB）' },
  ])
  assert.ok(text.includes('1. a.pdf，2KB，已经存到 D:\\x\\a.pdf'), text)
  assert.ok(text.includes('2. b.zip，没取到（太大'), text)
  assert.ok(text.includes('需要就看这些路径'), text)
})
check('文案：群里的文件署名是发的人，不是「小白」', () => {
  const groupBinding = cfg.绑定[1]
  const text = T.buildNotice(groupBinding, { sender: { card: 'Mr.Chlore', nickname: 'czxcl', user_id: 1610827876 } }, [
    { ok: true, name: '图.png', bytes: 1024, path: 'D:\\x\\图.png' },
  ])
  assert.ok(text.startsWith('（Mr.Chlore发了 1 个文件'), text)
})

console.log('\n== 2. 真下载（假 HTTP 服务）==')
await checkAsync('段内直链 → 落盘 + 文案给出真实路径', async () => {
  const seg = { type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${port}/download/report`, file_size: PDF.length } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(existsSync(r.path), r.path)
  assert.strictEqual(statSync(r.path).size, PDF.length)
  assert.ok(r.path.startsWith(fb(today())), r.path)
})
await checkAsync('同名再加一个 → (2) 序号', async () => {
  const seg = { type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${port}/download/report` } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.ok(/模考复盘 \(2\)\.pdf$/.test(r.path), r.path)
})
await checkAsync('段里只有 file_id → 走 get_file 兜底', async () => {
  const seg = { type: 'file', data: { name: '从get_file拿到的.pdf', file_id: 'ok-123' } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.ok(r.ok, JSON.stringify(r))
  assert.strictEqual(r.from, 'get_file→直链')
})
await checkAsync('超 50MB → 只通知、不下载', async () => {
  const seg = { type: 'file', data: { name: '超大的.zip', url: `http://127.0.0.1:${port}/download/huge`, file_size: 60 * 1024 * 1024 } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.strictEqual(r.ok, false)
  assert.ok(r.reason.includes('太大'), r.reason)
  assert.ok(!existsSync(join(fb(today()), '超大的.zip')))
})
await checkAsync('下载 404 → 没取到（带原因）', async () => {
  const seg = { type: 'file', data: { name: '丢了.pdf', url: `http://127.0.0.1:${port}/download/missing` } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.strictEqual(r.ok, false)
  assert.ok(r.reason.includes('404'), r.reason)
})
await checkAsync('段里只有 file_id，NapCat 也说取不到 → 没取到', async () => {
  const seg = { type: 'file', data: { name: 'x.bin', file_id: 'nope' } }
  const r = await T.saveOneFile(cfg, seg, { time: Math.floor(Date.now() / 1000) }, privateBinding)
  assert.strictEqual(r.ok, false)
  assert.ok(r.reason.includes('file not found'), r.reason)
})

console.log('\n== 3. 一轮完整 pollOnce（去重 / 跳过自己 / 注入失败重试）==')
const now = Math.floor(Date.now() / 1000)
historyQueue = []
// 第一次：只初始化水位
await T.pollOnce({ agents: { get: () => undefined } }, { inject: async () => { throw new Error('不该注入') } })
const firstWatermark = T.readState().watermark['私聊:632506748']
assert.ok(firstWatermark > 0, '第一次没写水位')

const sentNotices = []
const fakeCtx = { agents: { get: () => undefined } }
let injectFailLeft = 2
const hooks = {
  inject: async (session, text) => {
    if (injectFailLeft > 0) { injectFailLeft -= 1; throw new Error('模拟会话半死') }
    sentNotices.push({ session, text })
  },
}

historyQueue = [
  // 自己发出去的文件：不该处理
  { message_id: 9001, time: now + 1, user_id: 3402595214, sender: { nickname: '源月为安' }, message: [{ type: 'file', data: { name: '自己发的.pdf', url: `http://127.0.0.1:${port}/download/report` } }] },
  // 用户的纯文字：不该处理，也不该影响水位以外的东西
  { message_id: 9002, time: now + 1, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'text', data: { text: '看这个' } }] },
  // 真文件
  { message_id: 9003, time: now + 2, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: '模考复盘.pdf', url: `http://127.0.0.1:${port}/download/report` } }] },
]

await checkAsync('注入失败两次后第三次成功，且不重复下载/重复注入', async () => {
  // 跳 1：模拟会话半死 → 失败，不推进 seen
  await T.pollOnce(fakeCtx, hooks)
  let st = T.readState()
  assert.ok(!st.seen.includes('9003'), '第一次失败不该标记 seen')
  // 跳 2：还失败
  await T.pollOnce(fakeCtx, hooks)
  st = T.readState()
  assert.ok(!st.seen.includes('9003'), '第二次失败也不该标记 seen')
  assert.strictEqual(sentNotices.length, 0)
  // 跳 3：成功
  const r = await T.pollOnce(fakeCtx, hooks)
  assert.strictEqual(sentNotices.length, 1, JSON.stringify(sentNotices))
  assert.strictEqual(sentNotices[0].session, 'session-test-private')
  assert.ok(sentNotices[0].text.includes('小白发了 1 个文件'), sentNotices[0].text)
  assert.ok(sentNotices[0].text.includes('模考复盘'), sentNotices[0].text)
  assert.ok(sentNotices[0].text.includes(join(fb(today()), '模考复盘')), sentNotices[0].text)
  st = T.readState()
  assert.ok(st.seen.includes('9003'))
  assert.ok(!st.seen.includes('9001'), '自己发的文件不该进 seen')
  assert.ok(r.files >= 1)
  // 跳 4：同一条历史再来一遍，不能重复注入
  await T.pollOnce(fakeCtx, hooks)
  assert.strictEqual(sentNotices.length, 1, '重复注入了：' + JSON.stringify(sentNotices))
})

console.log('\n== 4. 会话暂时没活着：不立刻放弃 ==')
await checkAsync('会话没活着连续 5 跳不放弃，第 6 跳成功注入', async () => {
  const notices2 = []
  let dead = 5
  const hooks2 = {
    inject: async (session, text) => {
      if (dead > 0) { dead -= 1; throw new Error('会话没活着（test-session）') }
      notices2.push({ session, text })
    },
  }
  historyQueue.push({ message_id: 9100, time: now + 3, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: '迟到的报告.pdf', url: `http://127.0.0.1:${port}/download/report` } }] })
  for (let i = 0; i < 5; i++) await T.pollOnce(fakeCtx, hooks2)
  assert.strictEqual(notices2.length, 0, '不该这么早注入')
  assert.ok(!T.readState().seen.includes('9100'), '会话没活着 5 跳不该被标记放弃')
  await T.pollOnce(fakeCtx, hooks2)
  assert.strictEqual(notices2.length, 1, '第 6 跳该注入了：' + JSON.stringify(notices2))
  assert.ok(T.readState().seen.includes('9100'))
})

console.log('\n== 5. 积压 / 顺序：水位不许吞掉没处理的文件 ==')
await checkAsync('一跳上限之外的文件下一跳接着来，不被水位吞掉', async () => {
  const notices3 = []
  const hooks3 = { inject: async (session, text) => { notices3.push(text) } }
  for (let i = 0; i < 6; i++) {
    historyQueue.push({ message_id: 9300 + i, time: now + 10 + i, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: `积压-${i}.pdf`, url: `http://127.0.0.1:${port}/download/report` } }] })
  }
  await T.pollOnce(fakeCtx, hooks3)          // 上限 5 条，第 6 条要留到下一跳
  assert.strictEqual(notices3.length, 5, '第一跳应处理 5 条：' + JSON.stringify(notices3.length))
  await T.pollOnce(fakeCtx, hooks3)
  assert.strictEqual(notices3.length, 6, '第 6 条被水位吞了：' + JSON.stringify(notices3.map((t) => t.slice(0, 12))))
  const st = T.readState()
  for (let i = 0; i < 6; i++) assert.ok(st.seen.includes(String(9300 + i)), '内 ' + (9300 + i) + ' 没记 seen')
})
await checkAsync('前面的暂时失败 → 后面的不插队、也不被水位越过', async () => {
  const notices4 = []
  let firstAttempt = true
  const hooks4 = {
    inject: async (session, text) => {
      if (firstAttempt && text.includes('顺序-0')) { firstAttempt = false; throw new Error('模拟一次临时错误') }
      notices4.push(text)
    },
  }
  historyQueue.push(
    { message_id: 9400, time: now + 30, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: '顺序-0.pdf', url: `http://127.0.0.1:${port}/download/report` } }] },
    { message_id: 9401, time: now + 31, user_id: 632506748, sender: { nickname: '白昼菌' }, message: [{ type: 'file', data: { name: '顺序-1.pdf', url: `http://127.0.0.1:${port}/download/report` } }] },
  )
  await T.pollOnce(fakeCtx, hooks4)
  assert.strictEqual(notices4.length, 0, '前面失败时后面的不该插队：' + JSON.stringify(notices4))
  assert.ok(!T.readState().seen.includes('9401'), '后面的不该被当成处理过')
  await T.pollOnce(fakeCtx, hooks4)
  assert.strictEqual(notices4.length, 2, '两条都该到：' + JSON.stringify(notices4))
  assert.ok(notices4[0].includes('顺序-0'), '顺序错了：' + notices4[0])
  assert.ok(notices4[1].includes('顺序-1'), '顺序错了：' + notices4[1])
})

console.log('\n== 6. 插件入口 apply / 清理 ==')
await checkAsync('apply 不抛，注册了 effect，卸载时清定时器', async () => {
  let effectFn = null
  const disposers = []
  const fake = {
    agents: { get: () => undefined },
    effect: (fn, label) => { effectFn = fn; disposers.push(fn()); return () => {} },
    interval: (fn, ms) => { const h = setInterval(fn, ms); if (h.unref) h.unref(); return () => clearInterval(h) },
    timeout: (fn, ms) => { const h = setTimeout(fn, ms); if (h.unref) h.unref(); return () => clearTimeout(h) },
  }
  lib.apply(fake)
  assert.ok(typeof effectFn === 'function', '没调 ctx.effect')
  assert.ok(typeof disposers[0] === 'function', 'effect 没返回清理函数')
  disposers[0]()
})
await checkAsync('日志文件里有启动记录', async () => {
  const logFile = join(process.env.DSH_HOME, 'ayy-files', 'files.log')
  assert.ok(existsSync(logFile), logFile)
  const text = readFileSync(logFile, 'utf8')
  assert.ok(text.includes('已加载 v0.1.0'), text.slice(-400))
})

server.close()
console.log(`\n结果：${pass} 过，${fails.length} 挂`)
if (fails.length) { for (const f of fails) console.log('  FAIL: ' + f); process.exitCode = 1 }
try { rmSync(HOME, { recursive: true, force: true }) } catch (error) {}

/**
 * dsh-ayy-voice —— 给 AI 一个「用自己的声音说话」的工具。
 *
 * 注册 `ayy_say`：把文字交给本机肥鱼 TTS 服务合成语音，
 * 再通过 NapCat 的 OneBot HTTP 发成 QQ 语音条。
 *
 * 与旧方案（朗读桥 + 录音回环）的区别：
 *   - 不需要浏览器、不需要播放出声、不需要录音
 *   - 音色是肥鱼自己的（CosyVoice3 零样本克隆，cute / gentle 两条声线）
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULTS = {
  serviceUrl: 'http://127.0.0.1:9880',
  apiKeyFile: 'E:/AI/feiyu-voice/server/.runtime/voice-service/api_key.txt',
  outDir: 'E:/AI/tts/out',
  napcatUrl: 'http://127.0.0.1:3000',
  napcatToken: '',
  bridgeConfig: join(homedir(), '.dsh', 'qq-bridge-config.json'),
  defaultStyle: 'gentle',
  timeoutMs: 300000,
  singTimeoutMs: 900000,
}

// 音名（C4 / F#5 / Bb3 / R）→ ABC 记谱
function noteToAbc(note) {
  const n = note.trim()
  if (!n) return null
  if (/^r$/i.test(n)) return 'z'
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(n)
  if (!m) throw new Error(`看不懂的音名「${n}」，应形如 C4 / F#4 / Bb3 / R`)
  const letter = m[1].toUpperCase()
  const accidental = m[2]
  const octave = Number(m[3])
  let s
  if (octave >= 5) s = letter.toLowerCase() + "'".repeat(octave - 5)
  else s = letter + ','.repeat(4 - octave)
  if (accidental === '#') s = '^' + s
  else if (accidental === 'b') s = '_' + s
  return s
}

function notesToAbc(notes, bpm) {
  const tokens = notes.split(/[\s,]+/).filter(Boolean)
  const abc = tokens.map(noteToAbc).filter(Boolean)
  if (!abc.length) throw new Error('notes 里没有解析出任何音符')
  // 每 4 个音一个小节，便于阅读
  const bars = []
  for (let i = 0; i < abc.length; i += 4) bars.push(abc.slice(i, i + 4).join(' '))
  return `X:1\nT:Feiyu\nM:4/4\nL:1/4\nQ:1/4=${Math.round(bpm)}\nK:C\n${bars.join(' | ')} |\n`
}

async function uploadText(base, key, text, filename, contentType) {
  const boundary = '----feiyu' + Date.now()
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    Buffer.from(text, 'utf8'),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ])
  const res = await fetch(`${base}/v1/assets`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json.id) {
    throw new Error(`上传谱子失败（${res.status}）：${JSON.stringify(json).slice(0, 200)}`)
  }
  return json.id
}

function readKey(path) {
  if (!existsSync(path)) throw new Error(`找不到语音服务的 API key：${path}`)
  return readFileSync(path, 'utf8').trim()
}

function readBridgeConfig(path) {
  try {
    const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function call(base, key, path, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${key}` }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`语音服务返回非 JSON（${res.status}）：${text.slice(0, 200)}`)
  }
  if (!res.ok) throw new Error(`语音服务 ${res.status}：${JSON.stringify(json).slice(0, 300)}`)
  return json
}

async function waitJob(base, key, jobId, timeoutMs) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const info = await call(base, key, `/v1/jobs/${jobId}`)
    const status = info.status
    if (status === 'success') return info
    if (status === 'failed' || status === 'interrupted') {
      throw new Error(`合成失败：${info.error ?? status}`)
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error(`合成超时（${Math.round(timeoutMs / 1000)}s）`)
}

async function downloadAudio(base, key, jobId, dest) {
  const res = await fetch(`${base}/v1/jobs/${jobId}/audio`, {
    headers: { Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`下载音频失败：HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  return buf.length
}

async function sendRecord(napcatUrl, token, { userId, groupId }, audioPath) {
  const b64 = readFileSync(audioPath).toString('base64')
  const action = groupId ? 'send_group_msg' : 'send_private_msg'
  const params = groupId
    ? { group_id: Number(groupId), message: [{ type: 'record', data: { file: `base64://${b64}` } }] }
    : { user_id: Number(userId), message: [{ type: 'record', data: { file: `base64://${b64}` } }] }

  const res = await fetch(`${napcatUrl}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  })
  const json = await res.json()
  if (json.retcode !== 0) {
    throw new Error(`NapCat 发送失败：${JSON.stringify(json).slice(0, 300)}`)
  }
  return json.data?.message_id
}

export const name = 'dsh-ayy-voice'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  // 诊断：把注册过程中的异常写文件，方便排查（dsh 不打印插件错误）
  const logError = (tool, err) => {
    try {
      writeFileSync(
        'E:/AI/dsh-ayy-voice/error.log',
        `${new Date().toISOString()} [${tool}] ${err?.stack || err}\n`,
        { flag: 'a' },
      )
    } catch {}
  }

  try {
  ctx.tools.register({
    name: 'ayy_say',
    description:
      '用你自己（肥鱼）的声音说一句话，直接变成 QQ 语音条发出去。' +
      '当你想「说」给对方听、或者文字显得太冷需要温度时用它。' +
      'style 默认 gentle（温柔），想可爱就传 cute。' +
      '注意：调用后不要再重复一遍同样的文字内容，最多补一句很短的话。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要说的话（口语化，短一点更像真人）' },
        style: {
          type: 'string',
          enum: ['gentle', 'cute'],
          description: '声线：gentle=温柔（默认），cute=可爱',
        },
        group: { type: 'string', description: '可选：要发到的 QQ 群号；不填就是私聊' },
        confirm_group: {
          type: 'boolean',
          description:
            '在群里发语音必须带 true。只有 ta 这一轮明确让你"在群里说/发群里"时才传；' +
            '催睡、催吃饭、关心这类话一律私聊，不要用群。',
        },
      },
      required: ['text'],
    },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const text = String(args?.text ?? '').trim()
      if (!text) throw new Error('ayy_say 需要非空的 text')
      const style = args?.style === 'cute' ? 'cute' : cfg.defaultStyle
      // 软限制：往群里发语音要先确认一次，防止把私聊那套照顾话甩进群。
      if (args?.group && args?.confirm_group !== true) {
        throw new Error(
          '往群里发语音要先确认：只有 ta 这一轮明确让你"在群里说 / 发到群里"时才可以。' +
            '催睡、催吃饭、关心人的话都属于私聊；群里有别人在场，一条语音会吵到所有人。' +
            '确实要发，就再调一次并带上 confirm_group: true。',
        );
      }

      const bridge = readBridgeConfig(cfg.bridgeConfig)
      const userId = bridge['私聊QQ'] ?? bridge['私聊用户'] ?? null
      const groupId = args?.group ?? null
      if (!groupId && !userId) throw new Error('没配置私聊 QQ（qq-bridge-config.json 里缺「私聊QQ」）')

      const key = readKey(cfg.apiKeyFile)
      mkdirSync(cfg.outDir, { recursive: true })

      const job = await call(cfg.serviceUrl, key, '/v1/speech', {
        method: 'POST',
        body: { voice: 'feiyu', text, style },
      })
      const jobId = job.job_id ?? job.id
      if (!jobId) throw new Error(`提交任务没拿到 job id：${JSON.stringify(job).slice(0, 200)}`)

      const info = await waitJob(cfg.serviceUrl, key, jobId, cfg.timeoutMs)
      const dest = join(cfg.outDir, `say-${jobId.slice(0, 8)}-${style}.wav`)
      const bytes = await downloadAudio(cfg.serviceUrl, key, jobId, dest)
      const messageId = await sendRecord(
        bridge['NapCat'] || cfg.napcatUrl,
        cfg.napcatToken || bridge['令牌'] || '',
        { userId, groupId },
        dest,
      )

      return {
        text,
        style,
        seconds: info.audio?.duration_s ?? null,
        sampleRate: info.audio?.sample_rate ?? null,
        bytes,
        messageId,
        where: groupId ? `群 ${groupId}` : `私聊 ${userId}`,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'ayy_say',
      kind: 'read',
      rawInput: args,
    }),
  })
  } catch (e) { logError('ayy_say', e) }

}

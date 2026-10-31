/**
 * dsh-feiyu-voice —— 给 AI 一个「用自己的声音说话」的工具。
 *
 * 注册 `feiyu_say`：把文字交给本机肥鱼 TTS 服务合成语音，
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

// 一个音符 token：C4（默认 1 拍）、C4:2（两拍）、G4:0.75（附点八分）、R:1（休止一拍）
function parseNoteToken(token) {
  const raw = token.trim()
  if (!raw) return null
  const [name, beatsText] = raw.split(':')
  const beats = beatsText === undefined || beatsText === '' ? 1 : Number(beatsText)
  if (!Number.isFinite(beats) || beats <= 0) {
    throw new Error(`音符「${raw}」的拍数看不懂，应形如 C4、C4:2、G4:0.75`)
  }
  return { name, beats }
}

// 拍数 → ABC 时值后缀：1 拍不带后缀，2 拍 "2"，半拍 "/2"，附点四分 "3/2"
function abcLength(beats) {
  if (Math.abs(beats - 1) < 1e-9) return ''
  for (const unit of [1, 2, 4, 8]) {
    const numerator = Math.round(beats * unit)
    if (Math.abs(numerator / unit - beats) < 1e-9) {
      if (unit === 1) return String(numerator)
      return numerator === 1 ? `/${unit}` : `${numerator}/${unit}`
    }
  }
  throw new Error(`拍数 ${beats} 表达不出来，请用 1/8 拍的整数倍（0.125、0.5、1.5、2……）`)
}

function notesToAbc(notes, bpm) {
  const tokens = notes.split(/[\s,]+/).filter(Boolean)
  const items = tokens.map(parseNoteToken).filter(Boolean)
  if (!items.length) throw new Error('notes 里没有解析出任何音符')
  const units = items.map((item) => noteToAbc(item.name) + abcLength(item.beats))
  // 不写小节线：时值自由时不硬凑 4/4，小节线只影响视觉，不影响 music21 解析出的时值
  const lines = []
  for (let i = 0; i < units.length; i += 12) lines.push(units.slice(i, i + 12).join(' '))
  return `X:1\nT:Feiyu\nM:4/4\nL:1/4\nQ:1/4=${Math.round(bpm)}\nK:C\n${lines.join('\n')}\n`
}

// ── MIDI：mid-song 变速只能走这里（ABC 一条 Q 全曲一个速度，内联 [Q:] 会被 music21 忽略）
const PPQ = 480 // 每拍 tick
const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

function noteToMidi(name) {
  if (/^r$/i.test(name.trim())) return null
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(name.trim())
  if (!m) throw new Error(`看不懂的音名「${name}」，应形如 C4 / F#4 / Bb3 / R`)
  let pitch = 12 * (Number(m[3]) + 1) + SEMITONE[m[1].toUpperCase()]
  if (m[2] === '#') pitch += 1
  else if (m[2] === 'b') pitch -= 1
  if (pitch < 0 || pitch > 127) throw new Error(`音高「${name}」超出 MIDI 范围 0–127`)
  return pitch
}

// MIDI 的变长整数（delta time 用）
function vlq(value) {
  const bytes = [value & 0x7f]
  let rest = value >> 7
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest >>= 7
  }
  return bytes
}

function midiChunk(id, payload) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(payload.length)
  return Buffer.concat([Buffer.from(id, 'ascii'), length, payload])
}

// events: [{ tick, order, bytes }]，order 决定同一 tick 的先后：0=速度 1=收声 2=起声
function buildMidi(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const parts = []
  let last = 0
  for (const event of events) {
    parts.push(Buffer.from(vlq(event.tick - last)), Buffer.from(event.bytes))
    last = event.tick
  }
  parts.push(Buffer.from([0x00, 0xff, 0x2f, 0x00]))
  const header = Buffer.alloc(6)
  header.writeUInt16BE(1, 0) // format 1
  header.writeUInt16BE(1, 2) // 单轨
  header.writeUInt16BE(PPQ, 4)
  return Buffer.concat([midiChunk('MThd', header), midiChunk('MTrk', Buffer.concat(parts))])
}

// notes 里用「@120」这样的 token 从中途换速，例如 "C4:1 D4:1 @60 E4:2"
// 拍数按「四分音符 = 1 拍」，与 ABC 的 L:1/4、Q:1/4=n 同义
function notesToMidi(notes, bpm) {
  const tokens = notes.split(/[\s,]+/).filter(Boolean)
  const events = []
  const tempos = []
  let beat = 0
  let noteCount = 0
  for (const token of tokens) {
    if (token.startsWith('@')) {
      const value = Number(token.slice(1))
      if (!Number.isFinite(value) || !(value >= 10 && value <= 600)) {
        throw new Error(`速度「${token}」超出范围，应在 10–600 之间`)
      }
      tempos.push({ beat, bpm: value })
      continue
    }
    const item = parseNoteToken(token)
    if (!item) continue
    const pitch = noteToMidi(item.name)
    const startTick = Math.round(beat * PPQ)
    const endTick = Math.round((beat + item.beats) * PPQ)
    if (endTick - startTick < 1) throw new Error(`音符「${token}」太短，不到 1 tick`)
    if (pitch !== null) {
      noteCount += 1
      events.push({ tick: startTick, order: 2, bytes: [0x90, pitch, 0x64] })
      events.push({ tick: endTick, order: 1, bytes: [0x80, pitch, 0x40] })
    }
    beat += item.beats
  }
  if (!noteCount) throw new Error('notes 里没有解析出任何音符')
  if (!tempos.length || tempos[0].beat !== 0) tempos.unshift({ beat: 0, bpm })
  for (const tempo of tempos) {
    const micros = Math.round(60e6 / tempo.bpm)
    if (micros < 1 || micros > 0xffffff) throw new Error(`速度 ${tempo.bpm} 编码不进 MIDI`)
    events.push({
      tick: Math.round(tempo.beat * PPQ),
      order: 0,
      bytes: [0xff, 0x51, 0x03, (micros >> 16) & 0xff, (micros >> 8) & 0xff, micros & 0xff],
    })
  }
  return buildMidi(events)
}

function hasTempoChange(notes) {
  return notes.split(/[\s,]+/).some((token) => token.startsWith('@'))
}

async function uploadPayload(base, key, payload, filename, contentType) {
  const boundary = '----feiyu' + Date.now()
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    payload,
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

function uploadText(base, key, text, filename, contentType) {
  return uploadPayload(base, key, Buffer.from(text, 'utf8'), filename, contentType)
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

export const name = 'dsh-ayy-sing'
export const inject = ['tools']

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...config }
  // 诊断：把注册过程中的异常写文件，方便排查（dsh 不打印插件错误）
  const logError = (tool, err) => {
    try {
      writeFileSync(
        'E:/AI/dsh-feiyu-voice/error.log',
        `${new Date().toISOString()} [${tool}] ${err?.stack || err}\n`,
        { flag: 'a' },
      )
    } catch {}
  }

  // ── 唱歌 ────────────────────────────────────────────────────────────────
  // 谱子 → SoulX-Singer 合成歌声 → RVC 换成肥鱼音色。耗时约 1-2 分钟。
  try {
  ctx.tools.register({
    name: 'ayy_sing',
    description:
      '用你自己的声音唱一段歌，生成 QQ 语音条发出去。' +
      '需要给音高序列（notes）+ 一字一音的歌词（lyrics）。有节奏，不是一字一拍。' +
      'notes 写法：空格分隔的音名，每个音默认 1 拍，冒号后可给拍数，如 ' +
      '"G4:0.75 G4:0.25 A4:1"；R 表示休止，同样可带拍数（"R:0.5"）。' +
      '中途变速就插一个「@速度」，如 "C4:1 D4:1 @60 E4:2"（从这一刻起改成 60）；' +
      '带 @ 时内部改用 MIDI 谱（ABC 全曲只有一个速度）。' +
      '也可以直接传 abc 参数给完整 ABC 谱子（此时忽略 notes）。' +
      '歌词字数要和音符数量一致（一个字唱多个音时，多出来的音写 _）。' +
      '耗时约 1-2 分钟，适合 ta 明确让你唱歌、或者你想哄 ta 的时候；不要连着唱好几首。',
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description:
            '音高序列，空格分隔。每个音默认 1 拍，冒号后写拍数（可小数）："C4:0.75 C4:0.25 G4:1 A4:2"。R = 休止（"R:1"）。要中途变速就插 "@60"，如 "C4:1 @60 D4:2"',
        },
        lyrics: { type: 'string', description: '中文歌词，一字一音，字数要与音符数对应；一个字唱多个音时，多出来的音写 _' },
        abc: { type: 'string', description: '可选：完整 ABC 谱子文本，给了就忽略 notes' },
        bpm: { type: 'number', description: '可选：起始速度 10–600，默认 100；中途变速在 notes 里用 @速度 表示' },
        group: { type: 'string', description: '可选：要发到的 QQ 群号；不填就是私聊' },
      },
      required: ['lyrics'],
    },
    output: {
      schema: { type: 'object', properties: {}, additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const lyrics = String(args?.lyrics ?? '').trim()
      if (!lyrics) throw new Error('ayy_sing 需要非空的 lyrics')

      let score = String(args?.abc ?? '').trim()
      let payload
      let filename
      let contentType
      if (score) {
        payload = Buffer.from(score, 'utf8')
        filename = 'song.abc'
        contentType = 'text/plain'
      } else {
        const notes = String(args?.notes ?? '').trim()
        if (!notes) throw new Error('ayy_sing 需要 notes 或 abc 其中一个')
        const tempo = Number(args?.bpm) || 100
        if (hasTempoChange(notes)) {
          // 有 @bpm 就出 MIDI：ABC 的全曲单一速度表达不了中途变速
          payload = notesToMidi(notes, tempo)
          filename = 'song.mid'
          contentType = 'audio/midi'
        } else {
          payload = Buffer.from(notesToAbc(notes, tempo), 'utf8')
          filename = 'song.abc'
          contentType = 'text/plain'
        }
      }

      const bridge = readBridgeConfig(cfg.bridgeConfig)
      const userId = bridge['私聊QQ'] ?? bridge['私聊用户'] ?? null
      const groupId = args?.group ?? null
      if (!groupId && !userId) throw new Error('没配置私聊 QQ（qq-bridge-config.json 里缺「私聊QQ」）')

      const key = readKey(cfg.apiKeyFile)
      mkdirSync(cfg.outDir, { recursive: true })

      const scoreId = await uploadPayload(cfg.serviceUrl, key, payload, filename, contentType)
      const job = await call(cfg.serviceUrl, key, '/v1/singing', {
        method: 'POST',
        body: { score_id: scoreId, lyrics },
      })
      const jobId = job.job_id ?? job.id
      if (!jobId) throw new Error(`提交唱歌任务没拿到 job id：${JSON.stringify(job).slice(0, 200)}`)

      const info = await waitJob(cfg.serviceUrl, key, jobId, cfg.singTimeoutMs)
      const dest = join(cfg.outDir, `sing-${jobId.slice(0, 8)}.wav`)
      const bytes = await downloadAudio(cfg.serviceUrl, key, jobId, dest)
      const messageId = await sendRecord(
        bridge['NapCat'] || cfg.napcatUrl,
        cfg.napcatToken || bridge['令牌'] || '',
        { userId, groupId },
        dest,
      )

      return {
        lyrics,
        seconds: info.audio?.seconds ?? info.audio?.duration_s ?? null,
        sampleRate: info.audio?.sample_rate ?? null,
        source: info.audio?.source ?? null,
        bytes,
        messageId,
        where: groupId ? `群 ${groupId}` : `私聊 ${userId}`,
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'ayy_sing',
      kind: 'read',
      rawInput: args,
    }),
  })
  } catch (e) { logError('ayy_sing', e) }
}

// 测试用：把 notes → ABC / MIDI 的转换暴露出来，便于不合成也验证记谱
export const __test = { noteToAbc, abcLength, notesToAbc, noteToMidi, notesToMidi, hasTempoChange, vlq }

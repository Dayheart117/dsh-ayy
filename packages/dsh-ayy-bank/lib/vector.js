/**
 * 题库的向量层（bge-m3，本地 Ollama）
 *
 * 设计取舍：
 *   · 只用来"想不起关键词"时兜底，精确查询永远走 SQL
 *   · Ollama 没开就返回 null，由调用方退回关键词搜索——不报错、不阻塞
 *   · 向量存 SQLite BLOB（float32），几千条在内存里算余弦是毫秒级
 */
const BASE = 'http://127.0.0.1:11434'
const MODEL = 'bge-m3:latest'

/** Ollama 在不在 */
export async function localUp(timeoutMs = 1500) {
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    const r = await fetch(`${BASE}/api/tags`, { signal: ac.signal })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

/** 一条文本 → 1024 维向量；失败返回 null（绝不抛） */
export async function embed(text, timeoutMs = 30000) {
  const s = String(text || '').trim()
  if (!s) return null
  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), timeoutMs)
    const r = await fetch(`${BASE}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, input: [s] }),
      signal: ac.signal,
    })
    clearTimeout(t)
    if (!r.ok) return null
    const j = await r.json()
    const v = j && j.embeddings && j.embeddings[0]
    return Array.isArray(v) && v.length ? Float32Array.from(v) : null
  } catch {
    return null
  }
}

export const pack = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength)

export function unpack(buf) {
  if (!buf || !buf.length) return null
  // 用 copy 保证 4 字节对齐（Buffer 的 byteOffset 不一定对齐）
  const ab = new ArrayBuffer(buf.length)
  Buffer.from(ab).set(buf)
  return new Float32Array(ab)
}

/** 余弦相似度 */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return -1
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return -1
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** 把一条题目拼成用来 embed 的文本 */
export function textOf(row) {
  return [row.module, row.type, row.stem, row.ask, row.note, row.wrong, row.ability]
    .filter((x) => x && String(x).trim())
    .join(' · ')
    .slice(0, 800)
}

/** 简单哈希，用来判断"内容变了要重算" */
export function hashOf(s) {
  let h = 2166136261
  const str = String(s || '')
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16)
}

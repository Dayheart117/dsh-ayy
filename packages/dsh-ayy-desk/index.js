// dsh-ayy-desk — host half.
//
// 只读地把 ~/.dsh/personas/ 下的东西端给浏览器：日记列表、日记正文、
// 当前的自我认知与历史版本、心愿单。不写任何文件——面板只负责"看得见"。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-ayy-desk'
/** 需要路由能力 */
export const inject = ['webServer']

const API_PREFIX = '/api/ayy-desk'

function personasDir() {
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(dshHome, 'personas')
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isSameOriginRequest(req) {
  const site = req.headers['sec-fetch-site']
  if (typeof site === 'string' && site === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    const host = req.headers.host
    if (typeof host !== 'string' || host === '') return false
    try {
      if (new URL(origin).host !== host) return false
    } catch {
      return false
    }
  }
  return true
}

function requireSameOrigin(req, res) {
  if (isSameOriginRequest(req)) return true
  json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
  return false
}

const readText = (p) => {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  } catch {
    return ''
  }
}

/** diary/<日期>.<场景>.md —— 场景里的冒号在落盘时已换成下划线 */
function listDir(dirName, ext = '.md') {
  const dir = join(personasDir(), dirName)
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(ext)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    out.push({ rel: `${dirName}/${name}`, name, size: st.size, mtime: st.mtimeMs })
  }
  return out.sort((a, b) => (a.name < b.name ? 1 : -1))
}

/** 允许读的相对路径白名单：只有她自己的那几类文件 */
function allowedRel(rel) {
  const r = String(rel || '').replace(/\\/g, '/')
  if (r === 'who-i-am.md' || r === 'wants.md') return true
  if (!r.includes('..') && /^(diary|diary-history|who-i-am-history)\/[^/]+\.md$/.test(r)) return true
  return false
}

function overview() {
  const diaries = listDir('diary')
  return {
    dir: personasDir(),
    diaries,
    diaryHistory: listDir('diary-history').length,
    self: {
      exists: existsSync(join(personasDir(), 'who-i-am.md')),
      chars: readText(join(personasDir(), 'who-i-am.md')).trim().length,
      history: listDir('who-i-am-history'),
    },
    wants: {
      exists: existsSync(join(personasDir(), 'wants.md')),
      chars: readText(join(personasDir(), 'wants.md')).trim().length,
    },
  }
}

export function apply(ctx) {
  const routes = [
    {
      kind: 'exact',
      path: `${API_PREFIX}/overview`,
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!requireSameOrigin(req, res)) return
        try {
          json(res, 200, { ok: true, ...overview() })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/file`,
      handler: (req, res) => {
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        if (!requireSameOrigin(req, res)) return
        try {
          const url = new URL(req.url || '/', 'http://localhost')
          const rel = url.searchParams.get('rel') || ''
          if (!allowedRel(rel)) return json(res, 403, { ok: false, error: 'path-not-allowed' })
          const full = join(personasDir(), rel)
          if (!existsSync(full)) return json(res, 404, { ok: false, error: 'not-found' })
          json(res, 200, { ok: true, rel, name: basename(full), content: readText(full) })
        } catch (error) {
          json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
  ]

  try {
    ctx.effect(() => {
      const disposers = []
      try {
        for (const route of routes) disposers.push(ctx.webServer.register(route))
      } catch (error) {
        for (const dispose of disposers) dispose()
        throw error
      }
      return () => {
        for (const dispose of disposers) dispose()
      }
    }, 'dsh-ayy-desk: routes')
  } catch (error) {
    console.error('[dsh-ayy-desk] route registration failed:', error)
  }
}

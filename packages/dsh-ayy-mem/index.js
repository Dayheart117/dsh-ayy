/**
 * dsh-ayy-mem —— 安源悦 · 记忆（合并包）
 *
 * 把四个各自为政的记忆插件合成一个：
 *   dsh-ayy-world    ayy_diary / ayy_self / ayy_want / ayy_recall
 *   dsh-ayy-note     ayy_note
 *   dsh-ayy-ledger   ayy_ledger
 *   dsh-ayy-memory   ayy_memory
 *
 * 为什么合并：它们写的是同一批文件（~/.dsh/personas/*），来源解析、路径常量、
 * 备份逻辑各写了一份，四份慢慢就会走岔。现在路径、读写、备份、时间戳、来源解析
 * 全在 lib/common.js，工具本体按老分组放在 lib/world|note|ledger|memory.js。
 *
 * 铁律：
 *   · inject 只写真实存在的服务（这里是 'tools'）
 *   · 任何异常自己吃掉：一个工具注册失败不许连累别的，更不许拖垮 preset
 *   · 工具名一个都不能变——那是她的日常
 */
import { log } from './lib/common.js'
import * as world from './lib/world.js'
import * as note from './lib/note.js'
import * as ledger from './lib/ledger.js'
import * as memory from './lib/memory.js'

export const name = 'dsh-ayy-mem'
export const inject = ['tools']

export function apply(ctx) {
  log('apply() 开始')

  // 每个工具单独 try/catch：坏一个，别的照常
  const define = (spec) => {
    try {
      ctx.tools.register(spec)
      log(`✔ 注册 ${spec.name}`)
    } catch (e) {
      log(`✘ 注册 ${spec.name} 失败：${e && e.message ? e.message : e}`)
    }
  }

  // 每组装载也单独兜一层：模块顶层抛错也不许把整个插件带走
  const groups = [
    ['world', world],
    ['note', note],
    ['ledger', ledger],
    ['memory', memory],
  ]
  for (const [label, mod] of groups) {
    try {
      mod.register(define)
    } catch (e) {
      log(`✘ ${label} 组装载失败：${e && e.message ? e.message : e}`)
    }
  }

  log('apply() 完成')
}

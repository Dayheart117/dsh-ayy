// dsh-ayy-settings client smoke test.
// Loads client.js with a tiny React shim, registers the settings.section slot,
// then walks the rendered tree for all four tabs (plus loading/error states).
// No browser needed; catches crashes from non-array fields etc.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.resolve(here, '..', 'client.js'), 'utf8');

const failures = [];
function check(name, cond, extra) {
  if (cond) console.log('PASS ' + name);
  else {
    failures.push(name + (extra ? ' :: ' + extra : ''));
    console.log('FAIL ' + name + (extra ? ' :: ' + extra : ''));
  }
}

let currentName = '';
let hookIndex = 0;
const overrides = {};

const React = {
  createElement(type, props) {
    const p = Object.assign({}, props || {});
    const children = Array.prototype.slice.call(arguments, 2);
    if (children.length === 1) p.children = children[0];
    else if (children.length > 1) p.children = children;
    return { type: type, props: p };
  },
  Fragment: 'Fragment',
  useState(initial) {
    const name = currentName;
    const idx = hookIndex++;
    const ov = overrides[name] && overrides[name][idx];
    if (ov) return ov;
    return [typeof initial === 'function' ? initial() : initial, function () {}];
  },
  useEffect() {},
  useCallback(fn) { return fn; },
  useMemo(fn) { return fn(); }
};

let captured = null;
const sandbox = {
  window: { __ModuleLoader__: { load(cfg) { captured = cfg; } } },
  console: console,
  fetch: function () { return Promise.reject(new Error('fetch-not-stubbed')); },
  setTimeout: setTimeout,
  clearTimeout: clearTimeout
};
sandbox.globalThis = sandbox;
vm.runInNewContext(src, sandbox, { filename: 'client.js' });

check('module loader called', !!captured);
check('module id', captured && captured.id === 'dsh-ayy-settings');
const mod = captured.factory(function (id) {
  if (id === 'react') return React;
  throw new Error('unexpected require: ' + id);
});
check('client inject', Array.isArray(mod.inject) && mod.inject.indexOf('slots') >= 0 && mod.inject.indexOf('locale') >= 0);

// ---- fake client ctx: capture the slot renderer ----
let slot = null;
const ctx = {
  effect(fn) { fn(); return function () {}; },
  locale: {
    register() {},
    bind() { return function (key) { return String(key); }; }
  },
  slots: {
    inject(name, fn) { fn(); },
    register(config, render) {
      slot = { config: config, render: render };
      return function () {};
    }
  }
};
mod.apply(ctx);
check('slot registered', !!slot && slot.config.name === 'settings.section');
check('slot id', slot && slot.config.id === 'ayy-settings');
check('slot order 14', slot && slot.config.order === 14);
check('slot label', slot && slot.config.label() === 'nav', slot && slot.config.label());

// ---- recursive renderer for the element tree ----
let hostNodes = 0;
function renderNode(node) {
  if (node == null || node === false || node === true) return;
  if (typeof node === 'string' || typeof node === 'number') return;
  if (Array.isArray(node)) {
    for (const item of node) renderNode(item);
    return;
  }
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'function') {
    const prev = currentName;
    const prevIdx = hookIndex;
    currentName = node.type.name || '';
    hookIndex = 0;
    renderNode(node.type(node.props || {}));
    currentName = prev;
    hookIndex = prevIdx;
    return;
  }
  hostNodes++;
  renderNode(node.props && node.props.children);
}

const good = {
  self: { exists: true, size: 1720, mtime: 1762000000000, source: '使用者', content: '# 自述\n\n正文一句。' },
  memory: { exists: true, size: 5369, mtime: 1762000000000 },
  history: [{ name: '2026-11-01T10-14-15-093Z.md', size: 1547, mtime: 1762000000000, source: '使用者' }],
  senses: {
    files: { path: 'x', exists: true, mtime: 1762000000000, onlyPrivate: true, onlyQQ: '632506748' },
    notice: {
      path: 'x', exists: true, mtime: 1762000000000, port: 9898, retries: 5, retryMs: 5000, tokenSet: true,
      listening: { ok: true, ms: 2 }, bridgeConfigured: true,
      napcat: {
        found: true, file: 'onebot11_3402595214.json', full: 'x', mtime: 1762000000000,
        clients: [{ name: 'dsh-notice', enable: true, url: 'http://127.0.0.1:9898/notice?token=***' }],
        configured: true, instances: [{ file: 'a', configured: true, clients: 1 }, { file: 'b', configured: false, clients: 0 }]
      }
    },
    voice: { url: 'http://127.0.0.1:9880/health', ok: true, status: 200, ms: 12 }
  },
  scope: {
    path: 'x', exists: true, mtime: 1762000000000,
    sessions: ['session-a', 'session-orphan'],
    mounted: { 'session-a': { mounted: true, at: '2026-11-01 15:15:49' }, 'session-b': { mounted: false, at: '2026-11-01 15:17:00' } },
    bindings: [
      { type: '私聊', number: '632506748', name: '小白', session: 'session-a' },
      { type: '群', number: '524271081', name: '群里的人', session: 'session-b' }
    ],
    logPath: 'x'
  },
  status: {
    health: ['[a] ok', '[b] ok'],
    scopeLog: ['[a] 挂上 session-a'],
    files: [
      { key: 'self', path: 'x', exists: true, size: 1720, mtime: 1762000000000 },
      { key: 'napcat', path: 'y', exists: false, size: 0, mtime: 0 }
    ]
  }
};

const bad = {
  self: { content: null },
  history: 'not-an-array',
  memory: {},
  senses: { files: {}, notice: { napcat: {} }, voice: null },
  scope: { sessions: {}, bindings: null, mounted: [] },
  status: { health: 'nope', scopeLog: null, files: {} }
};

function tryRender(label, hooks) {
  overrides.SettingsView = hooks;
  hostNodes = 0;
  try {
    renderNode(slot.render({ t: function (key) { return String(key); } }));
    check(label + ' renders', hostNodes > 10, 'host nodes=' + hostNodes);
  } catch (error) {
    check(label + ' renders', false, (error && error.stack) || String(error));
  }
}

const noop = function () {};
// SettingsView hooks: tab, state, note
tryRender('loading', [['self', noop], [{ status: 'loading' }, noop], [null, noop]]);
tryRender('error', [['self', noop], [{ status: 'error', error: { code: 'route-missing' } }, noop], [null, noop]]);
for (const tab of ['self', 'senses', 'scope', 'status']) {
  tryRender('tab ' + tab, [[tab, noop], [{ status: 'ready', data: good }, noop], [{ kind: 'ok', text: 'saved' }, noop]]);
}
for (const tab of ['self', 'senses', 'scope', 'status']) {
  tryRender('tab ' + tab + ' with bad field types', [[tab, noop], [{ status: 'ready', data: bad }, noop], [null, noop]]);
}

console.log('');
if (failures.length) {
  console.log('RESULT: FAIL (' + failures.length + ')');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('RESULT: ALL PASS');
}

// dsh-ayy-settings host-half test.
// Runs every GET/POST route against a temporary DSH_HOME copy with a fake ctx.
// Never touches real ~/.dsh data. ASCII comments only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(here, '..');
const realHome = path.join(os.homedir(), '.dsh');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ayy-settings-test-'));
const tmpHome = path.join(tmpRoot, 'home');
const tmpNapcat = path.join(tmpRoot, 'napcat');

const failures = [];
function check(name, cond, extra) {
  if (cond) {
    console.log('PASS ' + name);
  } else {
    failures.push(name + (extra ? ' :: ' + extra : ''));
    console.log('FAIL ' + name + (extra ? ' :: ' + extra : ''));
  }
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
  return true;
}

// ---- build a synthetic DSH_HOME (plus a copy of the real persona files) ----
const selfOld = '# 旧自述\r\n\r\n我是测试用的人设，只有这一句。\r\n';
write(path.join(tmpHome, 'personas', 'who-i-am.md'), selfOld);
write(path.join(tmpHome, 'personas', 'who-i-am-history', '2026-11-01T10-14-15-093Z.md'), '<!-- 改动原因：测试 -->\n旧版一\n');
write(path.join(tmpHome, 'personas', 'who-i-am-history', '2026-11-01T00-24-13-119Z.md'), '旧版二\n');
write(path.join(tmpHome, 'personas', 'her-memory.md'), '# her memory\n\n- test memory line\n');
write(path.join(tmpHome, 'personas', 'health.log'), '[2026-11-01 23:18] 自检 5 项 · 故障 0 / 提示 0\n[2026-11-01 23:18] tail line 2\n');

const scopeOriginal = {
  '会话': ['session-old-1'],
  '人格文件': path.join(tmpHome, 'personas', 'who-i-am.md'),
  '记忆文件': path.join(tmpHome, 'personas', 'her-memory.md'),
};
write(path.join(tmpHome, 'ayy-scope', 'config.json'), JSON.stringify(scopeOriginal, null, 2) + '\n');
write(
  path.join(tmpHome, 'ayy-scope', 'scope.log'),
  [
    '[2026-11-01 15:15:19] 已加载：只给白名单会话注入她的记忆 + 人格',
    '[2026-11-01 15:15:49] 挂上 session-old-1',
    '[2026-11-01 15:16:00] 挂上 session-new-2',
    '[2026-11-01 15:17:00] 卸下 session-new-2',
  ].join('\n') + '\n',
);
write(path.join(tmpHome, 'ayy-files', 'config.json'), JSON.stringify({ '只处理私聊': true, '只收某个QQ发的': '' }, null, 2) + '\n');
write(
  path.join(tmpHome, 'ayy-notice', 'config.json'),
  JSON.stringify({ port: 9898, token: 'test-token-abc', '重试次数': 5, '重试间隔毫秒': 5000 }, null, 2) + '\n',
);
write(
  path.join(tmpHome, 'qq-bridge-config.json'),
  JSON.stringify(
    {
      '绑定': [
        { '类型': '私聊', '号码': '632506748', '会话': 'session-old-1', '称呼': '小白', '开': true },
        { '类型': '群', '号码': '524271081', '会话': 'session-new-2', '称呼': '群里的人', '开': true },
      ],
    },
    null,
    2,
  ) + '\n',
);

// Two NapCat instances: only the second one has httpClients pointing at the relay.
write(
  path.join(tmpNapcat, 'onebot11_1111111.json'),
  JSON.stringify({ network: { httpServers: [], httpClients: [] } }, null, 2),
);
write(
  path.join(tmpNapcat, 'onebot11_2222222.json'),
  JSON.stringify(
    {
      network: {
        httpClients: [
          { name: 'dsh-notice', enable: true, url: 'http://127.0.0.1:9898/notice?token=secret', reportSelfMessage: false },
        ],
      },
    },
    null,
    2,
  ),
);

// Copy the real persona files as an extra realism check (never written back).
copyIfExists(path.join(realHome, 'personas', 'who-i-am.md'), path.join(tmpHome, 'personas', 'who-i-am.copy.md'));

process.env.DSH_HOME = tmpHome;
process.env.AYY_SETTINGS_NAPCAT_DIR = tmpNapcat;

// ---- fake ctx ----
const routes = [];
const ctx = {
  webServer: {
    register(route) {
      routes.push(route);
      return function dispose() {};
    },
  },
  effect(fn) {
    const cleanup = fn();
    return function () {
      if (typeof cleanup === 'function') cleanup();
    };
  },
};

const plugin = await import(pathToFileURL(path.join(pkgDir, 'index.js')).href);
check('plugin name', plugin.name === 'dsh-ayy-settings', plugin.name);
check('plugin inject', Array.isArray(plugin.inject) && plugin.inject.includes('webServer'));
plugin.apply(ctx);
check('routes registered (7)', routes.length === 7, String(routes.length));

const server = http.createServer(function (req, res) {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const route = routes.find(function (r) {
    return r.kind === 'exact' && r.path === url.pathname;
  });
  if (!route) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: 'route-not-found-in-test' }));
    return;
  }
  route.handler(req, res);
});

await new Promise(function (resolve, reject) {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const port = server.address().port;
const base = 'http://127.0.0.1:' + port;
const sameOrigin = { origin: base };

function call(method, pathname, opts) {
  const options = opts || {};
  return new Promise(function (resolve, reject) {
    const headers = Object.assign({}, options.headers || {});
    let body = null;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    const req = http.request(base + pathname, { method: method, headers: headers }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(text); } catch (e) { data = null; }
        resolve({ status: res.statusCode, data: data, text: text });
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const get = function (p, headers) { return call('GET', p, { headers: headers }); };
const post = function (p, body, headers) { return call('POST', p, { body: body, headers: headers }); };

// ---- 1. overview ----
let r = await get('/api/ayy-settings/overview');
check('overview 200', r.status === 200, String(r.status));
const ov = r.data || {};
check('overview ok', ov.ok === true);
check('self exists/content', ov.self && ov.self.exists === true && typeof ov.self.content === 'string');
check('history is array', Array.isArray(ov.history), typeof ov.history);
check('scope.sessions array', Array.isArray(ov.scope.sessions) && ov.scope.sessions[0] === 'session-old-1');
check('scope.bindings array', Array.isArray(ov.scope.bindings) && ov.scope.bindings.length === 2);
check('scope.mounted object', ov.scope.mounted && ov.scope.mounted['session-old-1'] && ov.scope.mounted['session-old-1'].mounted === true);
check('scope.mounted unmounted', ov.scope.mounted['session-new-2'] && ov.scope.mounted['session-new-2'].mounted === false);
check('senses.files shape', ov.senses.files && ov.senses.files.onlyPrivate === true && ov.senses.files.onlyQQ === '');
check('notice port', ov.senses.notice.port === 9898);
check('notice listening shape', ov.senses.notice.listening && typeof ov.senses.notice.listening.ok === 'boolean');
check('napcat picks configured instance', ov.senses.notice.napcat.file === 'onebot11_2222222.json', JSON.stringify(ov.senses.notice.napcat.instances));
check('napcat bridge configured', ov.senses.notice.bridgeConfigured === true);
check('voice shape', ov.senses.voice && typeof ov.senses.voice.ok === 'boolean');
check('status.health array', Array.isArray(ov.status.health) && ov.status.health.length === 2);
check('status.scopeLog array', Array.isArray(ov.status.scopeLog) && ov.status.scopeLog.length === 4);
check('status.files array', Array.isArray(ov.status.files) && ov.status.files.length >= 9);
check('panel log written', fs.existsSync(path.join(tmpHome, 'ayy-settings', 'settings.log')));

const originalSelfText = fs.readFileSync(path.join(tmpHome, 'personas', 'who-i-am.md'), 'utf8');
const historyDir = path.join(tmpHome, 'personas', 'who-i-am-history');
const historyBefore = fs.readdirSync(historyDir).filter(function (n) { return /\.md$/.test(n); }).length;

// ---- 2. save self ----
r = await post('/api/ayy-settings/self/save', { content: '# 新自述\n\n这一版是面板写的。' }, sameOrigin);
check('self save 200', r.status === 200, String(r.status));
check('self save returns backup', r.data && typeof r.data.backup === 'string' && r.data.backup.endsWith('.md'), JSON.stringify(r.data));
check('self save source', r.data && r.data.source === '使用者');
const backupName = r.data.backup;
check('history file created', fs.existsSync(path.join(historyDir, backupName)));
check('history .source created', fs.existsSync(path.join(historyDir, backupName.replace(/\.md$/, '.source'))));
check('history .source content', fs.readFileSync(path.join(historyDir, backupName.replace(/\.md$/, '.source')), 'utf8').trim() === '使用者');
check('backup equals old version', fs.readFileSync(path.join(historyDir, backupName), 'utf8') === originalSelfText);
check('current self saved', fs.readFileSync(path.join(tmpHome, 'personas', 'who-i-am.md'), 'utf8').indexOf('# 新自述') === 0);
check('no stray sidecar next to live file', !fs.existsSync(path.join(tmpHome, 'personas', 'who-i-am.source')));
r = await get('/api/ayy-settings/overview');
check('overview reports save source', r.data.self.source === '使用者', String(r.data.self.source));
const historyAfterSave = fs.readdirSync(historyDir).filter(function (n) { return /\.md$/.test(n); }).length;
check('history count +1', historyAfterSave === historyBefore + 1, historyBefore + ' -> ' + historyAfterSave);

// unchanged save
r = await post('/api/ayy-settings/self/save', { content: '# 新自述\n\n这一版是面板写的。' }, sameOrigin);
check('unchanged save', r.data && r.data.unchanged === true, JSON.stringify(r.data));
const historyAfterNoop = fs.readdirSync(historyDir).filter(function (n) { return /\.md$/.test(n); }).length;
check('unchanged adds no archive', historyAfterNoop === historyAfterSave);

// empty save rejected
r = await post('/api/ayy-settings/self/save', { content: '   ' }, sameOrigin);
check('empty self rejected 400', r.status === 400 && r.data && r.data.error === 'empty-self', r.status + ' ' + r.text);

// ---- 3. read a version ----
r = await get('/api/ayy-settings/self/history?name=' + encodeURIComponent(backupName));
check('history read 200', r.status === 200 && r.data.ok === true);
check('history read content', r.data.content === originalSelfText, JSON.stringify(r.data.content && r.data.content.slice(0, 20)));
check('history read source', r.data.source === '使用者');

// ---- 4. restore ----
r = await post('/api/ayy-settings/self/restore', { name: backupName }, sameOrigin);
check('restore 200', r.status === 200, String(r.status));
check('restore result', r.data && r.data.restored === backupName && typeof r.data.backup === 'string');
const restoredText = fs.readFileSync(path.join(tmpHome, 'personas', 'who-i-am.md'), 'utf8');
const normalizedOld = originalSelfText.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
check('restore content matches archived old', restoredText === normalizedOld, JSON.stringify(restoredText.slice(0, 24)));
const historyAfterRestore = fs.readdirSync(historyDir).filter(function (n) { return /\.md$/.test(n); }).length;
check('restore archives current first', historyAfterRestore === historyBefore + 2, String(historyAfterRestore));
const restoreBackupSource = path.join(historyDir, r.data.backup.replace(/\.md$/, '.source'));
check('restore archive .source', fs.existsSync(restoreBackupSource) && fs.readFileSync(restoreBackupSource, 'utf8').trim() === '使用者');

// restoring a version that starts with an archive comment strips it
const firstHistory = '2026-11-01T10-14-15-093Z.md';
r = await post('/api/ayy-settings/self/restore', { name: firstHistory }, sameOrigin);
check('restore 2 200', r.status === 200, String(r.status));
check('restore strips archive comment', fs.readFileSync(path.join(tmpHome, 'personas', 'who-i-am.md'), 'utf8').indexOf('<!--') !== 0,
  JSON.stringify(fs.readFileSync(path.join(tmpHome, 'personas', 'who-i-am.md'), 'utf8').slice(0, 40)));

// ---- 5. files config ----
r = await post('/api/ayy-settings/senses/files', { onlyPrivate: false, onlyQQ: '123456789' }, sameOrigin);
check('files save 200', r.status === 200, String(r.status));
const filesCfg = JSON.parse(fs.readFileSync(path.join(tmpHome, 'ayy-files', 'config.json'), 'utf8'));
check('files cfg values', filesCfg['只处理私聊'] === false && filesCfg['只收某个QQ发的'] === '123456789', JSON.stringify(filesCfg));
check('files cfg backup', fs.readdirSync(path.join(tmpHome, 'ayy-files')).some(function (n) { return n.indexOf('config.json.bak-') === 0; }));

r = await post('/api/ayy-settings/senses/files', { onlyPrivate: true, onlyQQ: 'abc' }, sameOrigin);
check('invalid qq 400', r.status === 400 && r.data.error === 'invalid-qq', r.status + ' ' + r.text);

// ---- 6. notice config ----
r = await post('/api/ayy-settings/senses/notice', { port: 9899, retries: 3, retryMs: 2000 }, sameOrigin);
check('notice save 200', r.status === 200, String(r.status));
const noticeCfg = JSON.parse(fs.readFileSync(path.join(tmpHome, 'ayy-notice', 'config.json'), 'utf8'));
check('notice cfg values', noticeCfg.port === 9899 && noticeCfg['重试次数'] === 3 && noticeCfg['重试间隔毫秒'] === 2000, JSON.stringify(noticeCfg));
check('notice token preserved', noticeCfg.token === 'test-token-abc');

r = await post('/api/ayy-settings/senses/notice', { port: 99999, retries: 3, retryMs: 2000 }, sameOrigin);
check('invalid port 400', r.status === 400 && r.data.error === 'invalid-port', r.status + ' ' + r.text);

// ---- 7. scope config ----
r = await post('/api/ayy-settings/scope', { sessions: ['session-old-1', 'session-new-2', 'session-x'] }, sameOrigin);
check('scope save 200', r.status === 200, String(r.status));
const scopeCfg = JSON.parse(fs.readFileSync(path.join(tmpHome, 'ayy-scope', 'config.json'), 'utf8'));
check('scope sessions saved', Array.isArray(scopeCfg['会话']) && scopeCfg['会话'].length === 3 && scopeCfg['会话'][2] === 'session-x', JSON.stringify(scopeCfg['会话']));
check('scope keeps persona fields', scopeCfg['人格文件'] === scopeOriginal['人格文件'] && scopeCfg['记忆文件'] === scopeOriginal['记忆文件']);

r = await post('/api/ayy-settings/scope', { sessions: ['../evil'] }, sameOrigin);
check('invalid session 400', r.status === 400 && r.data.error === 'invalid-session', r.status + ' ' + r.text);

// ---- 8. whitelist enforcement ----
r = await get('/api/ayy-settings/self/history?name=' + encodeURIComponent('../../her-memory.md'));
check('traversal read 403', r.status === 403 && r.data.error === 'path-not-allowed', r.status + ' ' + r.text);
r = await post('/api/ayy-settings/self/restore', { name: '..\\..\\who-i-am.md' }, sameOrigin);
check('traversal restore 403', r.status === 403 && r.data.error === 'path-not-allowed', r.status + ' ' + r.text);
r = await get('/api/ayy-settings/self/history?name=' + encodeURIComponent('missing-version.md'));
check('missing version 404', r.status === 404 && r.data.error === 'not-found', r.status + ' ' + r.text);

// ---- 9. cross-site + method ----
r = await get('/api/ayy-settings/overview', { origin: 'http://evil.example' });
check('cross-site origin 403', r.status === 403 && r.data.error === 'cross-site-request-rejected', r.status + ' ' + r.text);
r = await get('/api/ayy-settings/overview', { 'sec-fetch-site': 'cross-site' });
check('cross-site sec-fetch 403', r.status === 403, r.status + ' ' + r.text);
r = await get('/api/ayy-settings/overview', sameOrigin);
check('same-origin allowed', r.status === 200, r.status + ' ' + r.text);
r = await get('/api/ayy-settings/self/save');
check('GET on POST route 405', r.status === 405, r.status + ' ' + r.text);
r = await post('/api/ayy-settings/overview', {}, sameOrigin);
check('POST on GET route 405', r.status === 405, r.status + ' ' + r.text);

// ---- 10. memory file untouched ----
const memText = fs.readFileSync(path.join(tmpHome, 'personas', 'her-memory.md'), 'utf8');
check('her-memory.md untouched', memText.indexOf('test memory line') >= 0);
check('her-memory has no backup', !fs.readdirSync(path.join(tmpHome, 'personas')).some(function (n) { return n.indexOf('her-memory.md.bak-') === 0; }));

// ---- 11. overview reflects saved configs ----
r = await get('/api/ayy-settings/overview');
check('overview reflects configs', r.data.senses.files.onlyQQ === '123456789' && r.data.senses.notice.port === 9899 && r.data.scope.sessions.length === 3,
  JSON.stringify({ qq: r.data.senses.files.onlyQQ, port: r.data.senses.notice.port, sessions: r.data.scope.sessions }));

server.close();

console.log('');
console.log('tmp home: ' + tmpHome);
if (failures.length) {
  console.log('RESULT: FAIL (' + failures.length + ')');
  for (const f of failures) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('RESULT: ALL PASS');
}
if (!process.env.AYY_KEEP_TEST) fs.rmSync(tmpRoot, { recursive: true, force: true });

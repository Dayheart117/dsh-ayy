window.__ModuleLoader__.load({
	id: 'dsh-ayy-settings',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'ayySettings';

		// ── 文案（中英） ───────────────────────────────────────────────────
		const zh = {
			nav: '源的设置',
			intro: '我们自己那堆 AI 伙伴插件的总开关都在这儿：她是谁、感官、注入范围、状态。',
			tabSelf: '她是谁',
			tabSenses: '感官',
			tabScope: '注入范围',
		scopeMoreTitle: '其它会话（手选）',
		scopeMoreHint: '这些是本机已有的会话（不含 QQ 桥绑定的）。勾上再点上面的保存，它们下一回合起就能看到她的记忆和人格。',
		scopeMoreEmpty: '没有其它会话了。',
		scopePicked: '已选',
		scopeMoreSaveNote: '要保存才生效。',
			tabStatus: '状态',
			loading: '正在读…',
			error: '读不出来了。',
			retry: '重试',
			refresh: '刷新',
			missing: '不存在',
			never: '从未',
			unknown: '未知',
			saveFail: '保存失败：{err}',
			chars: '{n} 字',

			selfHint: '这是初始化/换人设用的。日常她自己也会写这个文件，谁改的都会留痕。',
			selfSize: '当前文件大小',
			selfMtime: '最后修改',
			selfSource: '最后修改来源',
			selfSourceUnknown: '未知（不是面板改的）',
			selfEditorLabel: '自述正文',
			selfEditorHint: '保存前会把当前版本复制进 who-i-am-history/，并记一条来源（使用者）。',
			selfSave: '保存自述',
			selfSaving: '正在保存…',
			selfSaved: '已保存。旧版留档：{backup}',
			selfUnchanged: '内容没变，没有保存。',
			historyTitle: '历史版本',
			historyEmpty: '还没有旧版本。',
			historyLimit: '只列最近 100 个版本。',
			historySourceUnknown: '来源未知',
			historyView: '查看',
			historyHide: '收起',
			historyRestore: '恢复到此版本',
			historyConfirm: '恢复到这个版本？当前的版本会先留一份档。\n\n{name}',
			historyRestoring: '正在恢复…',
			historyRestored: '已恢复 {name}。恢复前的版本留档：{backup}',
			viewingTitle: '正在查看：{name}',
			memoryNote: '记忆文件 her-memory.md 只读展示（写记忆必须走 ayy_memory，才有写前备份）：{size} · {time}',
			selfEmpty: '她还没写过自述。',

			filesTitle: '收文件',
			filesHint: 'QQ 收到的文件（默认只处理私聊，群里别人发的文件不下载、不打断她）。',
			filesOnlyPrivate: '只处理私聊',
			filesOnlyQQ: '只收某个 QQ 发的（留空 = 不限）',
			filesOnlyQQPlaceholder: '例如 632506748',
			filesSave: '保存收文件设置',
			filesSaved: '收文件设置已保存。',

			noticeTitle: '通知',
			noticeHint: '戳一戳 / 撤回 / 进退群的中继。端口改完要重启 dsh 才换得过来，别和别的服务撞。',
			noticePort: '中继端口',
			noticeRetries: '重试次数',
			noticeRetryMs: '重试间隔（毫秒）',
			noticeSave: '保存通知设置',
			noticeSaved: '通知设置已保存。',
			noticeListening: '在听',
			noticeDown: '没响应',
			noticeBridgeOn: 'QQ 桥的 httpClients 里配过',
			noticeBridgeOff: 'QQ 桥的 httpClients 里没配',
			noticeNapcatPath: 'NapCat 配置：{file}',
			noticeNapcatMissing: '没找到 NapCat 配置目录，通知不会自己进来。',
			noticeNapcatInstances: '这个目录下一共有 {n} 个 onebot11_*.json，这里按 httpClients 挑在用的那个。',
			noticeHowtoTitle: '怎么配（只读提示，这个面板不改 NapCat 配置）',
			noticeHowto1: '在 NapCat 的「网络配置 → HTTP 客户端」里加一条：',
			noticeHowto2: 'http://127.0.0.1:{port}/notice?token=<token>',
			noticeHowto3: 'token 见 ~/.dsh/ayy-notice/config.json。启用并保存后，回这里点「刷新」看是否变成「配过」。',
			noticeTokenMissing: '（注意：ayy-notice 配置里还没有 token）', 

			voiceTitle: '说话',
			voiceHint: '发 QQ 语音条要用的本机语音服务。',
			voiceUp: '语音服务通',
			voiceDown: '语音服务不通',
			voiceUrlLabel: '地址',
			voiceNoPreview: '语音插件本身是常驻的，这里只显示状态；试听留给下一阶段。',
			voiceStatus: '状态码 {status} · {ms} ms',
			voiceDownWhy: '9880 没起来。语音条发不出去，文字和别的都不受影响。',

			scopeWarn: '勾中的会话才会看到她的记忆和人格。没勾的（比如写代码的会话）只看得到全局那几句。',
			scopeHint: '白名单改完约 10 秒内生效（scope 插件每 10 秒对一次）。',
			scopeBindingsTitle: 'QQ 桥的绑定（候选会话）',
			scopeEmptyBindings: 'QQ 桥配置里没有「绑定」。',
			scopeOther: '其它会话',
			scopeSession: '会话',
			scopeType: '类型',
			scopeNumber: '号码',
			scopeCall: '称呼',
			scopeMounted: '当前挂载',
			scopeMountOn: '挂着',
			scopeMountOff: '没挂',
			scopeMountUnknown: '日志里没记录',
			scopeSave: '保存白名单',
			scopeSaved: '白名单已保存。约 10 秒内生效，日志会写「挂上 / 卸下」。',
			scopeNoSessions: '还没有任何可勾的会话。先在 QQ 桥里绑定，或者把会话 id 加进 ayy-scope/config.json。',

			statusHealth: '自检最近结果（health.log 最后 10 行）',
			statusScopeLog: '白名单挂载日志（scope.log 最后 20 行）',
			statusFiles: '配置文件与路径',
			statusHint: '看「最后修改」，就知道改动有没有生效。',
			statusLogEmpty: '日志还是空的。',
			statusExists: '存在',
			fileSelf: '她是谁（who-i-am.md）',
			fileMemory: '记忆（her-memory.md，只读）',
			fileScopeCfg: '注入白名单（ayy-scope/config.json）',
			fileScopeLog: '挂载日志（scope.log）',
			fileFilesCfg: '收文件配置（ayy-files/config.json）',
			fileNoticeCfg: '通知配置（ayy-notice/config.json）',
			fileBridge: 'QQ 桥配置（qq-bridge-config.json）',
			fileHealth: '自检日志（health.log）',
			fileSettings: '面板日志（settings.log）',
			fileNapcat: 'NapCat 配置（httpClients）',

			errPathNotAllowed: '这个路径不在白名单里。',
			errEmptySelf: '自述不能是空的。',
			errSelfTooLarge: '自述太大了（上限 200000 字）。',
			errInvalidQQ: 'QQ 号只能是 5–15 位数字，或者留空。',
			errInvalidPort: '端口得是 1–65535 的整数。',
			errInvalidRetries: '重试次数得是 0–50 的整数。',
			errInvalidRetryInterval: '重试间隔得是 200–600000 毫秒。',
			errInvalidSession: '会话 id 不合法。',
			errTooManySessions: '白名单最多 200 个会话。',
			errNotFound: '文件不在了。',
			errEmptyHistory: '这个历史版本是空的。',
			errCrossSite: '跨站请求被拒了。',
			errBodyTooLarge: '提交的内容太大。',
			errMethod: '请求方法不对。',
			errInvalidJson: '提交的内容不是合法 JSON。',
			errRouteMissing: 'host 半身还没加载——重启一下 dsh。',
			errUnknown: '未知错误。'
		};

		const en = {
			nav: "Yuan's Settings",
			intro: 'One place for the AI-companion plugins: who she is, senses, injection scope, status.',
			tabSelf: 'Who she is',
			tabSenses: 'Senses',
			tabScope: 'Injection scope',
			tabStatus: 'Status',
			loading: 'Reading…',
			error: 'Could not read.',
			retry: 'Retry',
			refresh: 'Refresh',
			missing: 'missing',
			never: 'never',
			unknown: 'unknown',
			saveFail: 'Save failed: {err}',
			chars: '{n} chars',

			selfHint: 'For initial setup or swapping the persona. She also edits this file herself; every change leaves a trace.',
			selfSize: 'File size',
			selfMtime: 'Last modified',
			selfSource: 'Last modified by',
			selfSourceUnknown: 'unknown (not from this panel)',
			selfEditorLabel: 'Self-description',
			selfEditorHint: 'Before saving, the current version is copied into who-i-am-history/ with a source note (user).',
			selfSave: 'Save self-description',
			selfSaving: 'Saving…',
			selfSaved: 'Saved. Previous version archived as {backup}',
			selfUnchanged: 'Nothing changed; not saved.',
			historyTitle: 'History',
			historyEmpty: 'No earlier versions yet.',
			historyLimit: 'Shows the 100 most recent versions.',
			historySourceUnknown: 'source unknown',
			historyView: 'View',
			historyHide: 'Hide',
			historyRestore: 'Restore this version',
			historyConfirm: 'Restore this version? The current one is archived first.\n\n{name}',
			historyRestoring: 'Restoring…',
			historyRestored: 'Restored {name}. Previous version archived as {backup}',
			viewingTitle: 'Viewing: {name}',
			memoryNote: 'her-memory.md is read-only here (memory writes must go through ayy_memory so a backup is kept): {size} · {time}',
			selfEmpty: 'She has not written a self-description yet.',

			filesTitle: 'File intake',
			filesHint: 'Files received over QQ (private chats only by default; group files are not downloaded).',
			filesOnlyPrivate: 'Private chats only',
			filesOnlyQQ: 'Only from this QQ (empty = any)',
			filesOnlyQQPlaceholder: 'e.g. 632506748',
			filesSave: 'Save file intake',
			filesSaved: 'File intake saved.',

			noticeTitle: 'Notifications',
			noticeHint: 'Relay for poke / recall / join / leave. Changing the port needs a dsh restart; avoid collisions.',
			noticePort: 'Relay port',
			noticeRetries: 'Retries',
			noticeRetryMs: 'Retry interval (ms)',
			noticeSave: 'Save notifications',
			noticeSaved: 'Notification settings saved.',
			noticeListening: 'listening',
			noticeDown: 'no response',
			noticeBridgeOn: 'configured in the QQ bridge httpClients',
			noticeBridgeOff: 'not configured in the QQ bridge httpClients',
			noticeNapcatPath: 'NapCat config: {file}',
			noticeNapcatMissing: 'NapCat config directory not found; notifications will not arrive by themselves.',
			noticeNapcatInstances: '{n} onebot11_*.json files here; the active one is picked by httpClients.',
			noticeHowtoTitle: 'How to configure (read-only hint; this panel never edits NapCat config)',
			noticeHowto1: 'In NapCat, open Network settings → HTTP clients and add:',
			noticeHowto2: 'http://127.0.0.1:{port}/notice?token=<token>',
			noticeHowto3: 'The token is in ~/.dsh/ayy-notice/config.json. Enable and save, then press Refresh here.',
			noticeTokenMissing: '(heads up: ayy-notice config has no token yet)',

			voiceTitle: 'Voice',
			voiceHint: 'Local speech service used to send QQ voice messages.',
			voiceUp: 'Speech service up',
			voiceDown: 'Speech service down',
			voiceUrlLabel: 'URL',
			voiceNoPreview: 'The voice plugin always runs; this only shows status. A test playback is left for the next stage.',
			voiceStatus: 'status {status} · {ms} ms',
			voiceDownWhy: 'Nothing is listening on 9880. Voice messages will fail; text and everything else still work.',

			scopeWarn: 'Only checked sessions can see her memory and persona. Unchecked ones (e.g. coding sessions) only see the global notes.',
			scopeHint: 'Takes effect within about 10 seconds (the scope plugin rechecks every 10s).',
			scopeBindingsTitle: 'QQ bridge bindings (candidate sessions)',
			scopeEmptyBindings: 'No bindings in the QQ bridge config.',
			scopeOther: 'Other session',
			scopeSession: 'Session',
			scopeType: 'Type',
			scopeNumber: 'Number',
			scopeCall: 'Name',
			scopeMounted: 'Mounted now',
			scopeMountOn: 'mounted',
			scopeMountOff: 'not mounted',
			scopeMountUnknown: 'not in the log',
			scopeSave: 'Save whitelist',
			scopeSaved: 'Whitelist saved. It takes effect within ~10s; the log will show mount/unmount lines.',
			scopeNoSessions: 'No sessions to pick yet. Bind one in the QQ bridge, or add a session id to ayy-scope/config.json.',

			statusHealth: 'Latest self-check (last 10 lines of health.log)',
			statusScopeLog: 'Whitelist mount log (last 20 lines of scope.log)',
			statusFiles: 'Config files and paths',
			statusHint: 'Check "last modified" to see whether a change landed.',
			statusLogEmpty: 'The log is still empty.',
			statusExists: 'exists',
			fileSelf: 'Who she is (who-i-am.md)',
			fileMemory: 'Memory (her-memory.md, read-only)',
			fileScopeCfg: 'Injection whitelist (ayy-scope/config.json)',
			fileScopeLog: 'Mount log (scope.log)',
			fileFilesCfg: 'File intake config (ayy-files/config.json)',
			fileNoticeCfg: 'Notification config (ayy-notice/config.json)',
			fileBridge: 'QQ bridge config (qq-bridge-config.json)',
			fileHealth: 'Self-check log (health.log)',
			fileSettings: 'Panel log (settings.log)',
			fileNapcat: 'NapCat config (httpClients)',

			errPathNotAllowed: 'That path is not on the whitelist.',
			errEmptySelf: 'The self-description cannot be empty.',
			errSelfTooLarge: 'The self-description is too large (limit 200000 chars).',
			errInvalidQQ: 'The QQ number must be 5–15 digits, or empty.',
			errInvalidPort: 'The port must be an integer between 1 and 65535.',
			errInvalidRetries: 'Retries must be an integer between 0 and 50.',
			errInvalidRetryInterval: 'The retry interval must be 200–600000 ms.',
			errInvalidSession: 'Invalid session id.',
			errTooManySessions: 'At most 200 sessions in the whitelist.',
			errNotFound: 'The file is gone.',
			errEmptyHistory: 'That history version is empty.',
			errCrossSite: 'Cross-site request rejected.',
			errBodyTooLarge: 'The submitted body is too large.',
			errMethod: 'Wrong request method.',
			errInvalidJson: 'The submitted body is not valid JSON.',
			errRouteMissing: 'The host half is not loaded yet — restart dsh.',
			errUnknown: 'Unknown error.'
		};

		// ── 样式（沿用这一套 --dsw-alias-* 变量） ─────────────────────────
		const s = {
			wrap: { width: '100%', maxWidth: '1080px', display: 'flex', flexDirection: 'column', gap: '14px' },
			intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' },
			head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' },
			tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
			tab: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: '13px', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer' },
			tabOn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)' },
			stack: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 },
			row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', minWidth: 0 },
			card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
			cardTitle: { margin: 0, fontSize: '13.5px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
			cardSub: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', lineHeight: '18px' },
			btn: { border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', background: 'transparent', borderRadius: '6px', padding: '4px 10px', fontSize: '12.5px' },
			primary: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', borderRadius: '6px', padding: '6px 14px', fontSize: '13px' },
			danger: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
			label: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
			field: { display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
			input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', borderRadius: '6px', padding: '6px 9px' },
			textarea: { width: '100%', boxSizing: 'border-box', minHeight: '280px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', lineHeight: '1.7', borderRadius: '6px', padding: '8px 10px', resize: 'vertical' },
			metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '8px' },
			metric: { display: 'flex', flexDirection: 'column', gap: '2px', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', padding: '8px 10px', minWidth: 0 },
			metricLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
			metricValue: { fontSize: '12.5px', color: 'var(--dsw-alias-label-primary)', wordBreak: 'break-all' },
			histList: { display: 'flex', flexDirection: 'column' },
			histRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', flexWrap: 'wrap' },
			histMain: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 220px' },
			mono: { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '12px', wordBreak: 'break-all' },
			preBox: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '12.5px', lineHeight: '1.65', maxHeight: '300px', overflowY: 'auto', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
			logBox: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '11.5px', lineHeight: '1.6', maxHeight: '260px', overflowY: 'auto', color: 'var(--dsw-alias-label-secondary)', fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' },
			checkRow: { display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '8px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', cursor: 'pointer' },
			checkBox: { margin: '2px 0 0', flex: 'none' },
			warn: { border: '1px solid var(--dsw-alias-state-error-primary)', borderRadius: '8px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', fontSize: '12.5px', lineHeight: '1.65' },
			hintBox: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', padding: '10px 12px', background: 'var(--dsw-alias-bg-layer-1)', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0 },
			pill: { flex: 'none', fontSize: '11px', lineHeight: '16px', padding: '0 7px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)', whiteSpace: 'nowrap' },
			pillOn: { color: 'var(--dsw-alias-label-primary)', background: 'var(--dsw-alias-bg-layer-3)' },
			pillBad: { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' },
			status: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' },
			failure: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
			noteOk: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12.5px', lineHeight: '18px' },
			noteErr: { margin: 0, color: 'var(--dsw-alias-state-error-primary)', fontSize: '12.5px', lineHeight: '18px' },
			noteInfo: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12.5px', lineHeight: '18px' }
		};

		// ── 小工具 ─────────────────────────────────────────────────────────
		function fill(text, vars) {
			return String(text == null ? '' : text).replace(/\{(\w+)\}/g, function (m, k) {
				return vars && Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
			});
		}

		const arr = function (v) { return Array.isArray(v) ? v : []; };

		function request(url, options) {
			return fetch(url, options).then(function (res) {
				return res.text().then(function (text) {
					let data = null;
					try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
					if (!data) {
						const err = new Error('not-json');
						err.code = res.status === 404 ? 'route-missing' : 'not-json';
						err.status = res.status;
						throw err;
					}
					if (data.ok !== true) {
						const err = new Error(String(data.error || 'request-failed'));
						err.code = String(data.error || 'request-failed');
						err.status = res.status;
						throw err;
					}
					return data;
				});
			});
		}

		const getJson = function (url) { return request(url); };
		const postJson = function (url, body) {
			return request(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body || {})
			});
		};

		const ERR_KEY = {
			'path-not-allowed': 'errPathNotAllowed',
			'empty-self': 'errEmptySelf',
			'self-too-large': 'errSelfTooLarge',
			'invalid-qq': 'errInvalidQQ',
			'invalid-port': 'errInvalidPort',
			'invalid-retries': 'errInvalidRetries',
			'invalid-retry-interval': 'errInvalidRetryInterval',
			'invalid-session': 'errInvalidSession',
			'too-many-sessions': 'errTooManySessions',
			'not-found': 'errNotFound',
			'empty-history': 'errEmptyHistory',
			'cross-site-request-rejected': 'errCrossSite',
			'body-too-large': 'errBodyTooLarge',
			'method-not-allowed': 'errMethod',
			'invalid-json': 'errInvalidJson',
			'route-missing': 'errRouteMissing',
			'not-json': 'errRouteMissing'
		};

		function errorText(t, error) {
			const code = String((error && (error.code || error.message)) || 'unknown');
			const key = ERR_KEY[code];
			return key ? t(key) : (code || t('errUnknown'));
		}

		function fmtTime(ms, withSeconds) {
			const n = Number(ms);
			if (!n) return '';
			const d = new Date(n);
			const p = function (x) { return String(x).padStart(2, '0'); };
			const base = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
			return withSeconds ? base + ':' + p(d.getSeconds()) : base;
		}

		function fmtSize(bytes) {
			const n = Number(bytes) || 0;
			if (n < 1024) return n + ' B';
			if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
			return (n / 1024 / 1024).toFixed(1) + ' MB';
		}

		const FILE_LABEL = {
			self: 'fileSelf', memory: 'fileMemory', scopeCfg: 'fileScopeCfg', scopeLog: 'fileScopeLog',
			filesCfg: 'fileFilesCfg', noticeCfg: 'fileNoticeCfg', bridge: 'fileBridge',
			health: 'fileHealth', settingsLog: 'fileSettings', napcat: 'fileNapcat'
		};

		// ── 基础组件 ───────────────────────────────────────────────────────
		function Failure({ t, onRetry }) {
			return h('div', { style: s.failure },
				h('p', { role: 'alert', style: { margin: 0 } }, t('error')),
				h('button', { type: 'button', style: s.btn, onClick: onRetry || (() => location.reload()) }, t('retry')));
		}

		function Note({ note }) {
			if (!note) return null;
			const style = note.kind === 'err' ? s.noteErr : note.kind === 'ok' ? s.noteOk : s.noteInfo;
			return h('p', { role: 'status', style: style }, note.text);
		}

		function Field({ label, children }) {
			return h('label', { style: s.field }, h('span', { style: s.label }, label), children);
		}

		function Metric({ label, value }) {
			return h('div', { style: s.metric },
				h('span', { style: s.metricLabel }, label),
				h('span', { style: s.metricValue }, value));
		}

		function Pill({ on, bad, text }) {
			const style = bad ? Object.assign({}, s.pill, s.pillBad) : (on ? Object.assign({}, s.pill, s.pillOn) : s.pill);
			return h('span', { style: style }, text);
		}

		// ── 她是谁 ─────────────────────────────────────────────────────────
		function SelfTab({ t, self, history, memory, onReload, notify }) {
			const [draft, setDraft] = React.useState(String(self.content || ''));
			const [busy, setBusy] = React.useState(false);
			const [view, setView] = React.useState(null);

			React.useEffect(() => { setDraft(String(self.content || '')); }, [self.content]);

			const items = arr(history).map(function (it) {
				return {
					name: String(it && it.name || ''),
					size: Number(it && it.size) || 0,
					mtime: Number(it && it.mtime) || 0,
					source: String(it && it.source || '')
				};
			});

			function save() {
				setBusy(true);
				postJson('/api/ayy-settings/self/save', { content: draft }).then(function (r) {
					if (r.unchanged) notify('info', t('selfUnchanged'));
					else notify('ok', fill(t('selfSaved'), { backup: r.backup || t('unknown') }));
					onReload();
				}).catch(function (e) {
					notify('err', fill(t('saveFail'), { err: errorText(t, e) }));
				}).then(function () { setBusy(false); });
			}

			function viewVersion(name) {
				if (view && view.name === name) { setView(null); return; }
				getJson('/api/ayy-settings/self/history?name=' + encodeURIComponent(name)).then(function (r) {
					setView({ name: name, content: String(r.content || '') });
				}).catch(function (e) {
					notify('err', errorText(t, e));
				});
			}

			function restoreVersion(name) {
				if (!window.confirm(fill(t('historyConfirm'), { name: name }))) return;
				setBusy(true);
				postJson('/api/ayy-settings/self/restore', { name: name }).then(function (r) {
					notify('ok', fill(t('historyRestored'), { name: r.restored || name, backup: r.backup || t('unknown') }));
					setView(null);
					onReload();
				}).catch(function (e) {
					notify('err', fill(t('saveFail'), { err: errorText(t, e) }));
				}).then(function () { setBusy(false); });
			}

			return h('div', { style: s.stack },
				h('div', { style: s.card },
					h('p', { style: s.cardSub }, t('selfHint')),
					h('div', { style: s.metrics },
						h(Metric, { label: t('selfSize'), value: fmtSize(self.size) }),
						h(Metric, { label: t('selfMtime'), value: fmtTime(self.mtime, true) || t('never') }),
						h(Metric, { label: t('selfSource'), value: String(self.source || '') || t('selfSourceUnknown') }))),

				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('selfEditorLabel')),
					h('p', { style: s.cardSub }, t('selfEditorHint')),
					h('textarea', {
						style: s.textarea,
						value: draft,
						spellCheck: false,
						onChange: function (e) { setDraft(e.target.value); }
					}),
					h('div', { style: s.row },
						h('button', { type: 'button', style: s.primary, disabled: busy || !String(draft || '').trim(), onClick: save }, busy ? t('selfSaving') : t('selfSave')),
						h('span', { style: s.cardSub }, fill(t('chars'), { n: String(draft || '').length })))),

				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('historyTitle')),
					items.length
						? h('div', { style: s.histList }, items.map(function (it) {
							const on = view && view.name === it.name;
							return h('div', { key: it.name, style: s.histRow },
								h('div', { style: s.histMain },
									h('span', { style: s.mono }, it.name.replace(/\.md$/, '')),
									h('span', { style: s.cardSub }, (fmtTime(it.mtime, true) || t('never')) + ' · ' + fmtSize(it.size) + ' · ' + (it.source || t('historySourceUnknown')))),
								h('div', { style: s.row },
									h('button', { type: 'button', style: s.btn, onClick: function () { viewVersion(it.name); } }, on ? t('historyHide') : t('historyView')),
									h('button', { type: 'button', style: Object.assign({}, s.btn, s.danger), onClick: function () { restoreVersion(it.name); } }, t('historyRestore'))));
						}))
						: h('p', { style: s.cardSub }, t('historyEmpty')),
					h('p', { style: s.cardSub }, t('historyLimit'))),

				view
					? h('div', { style: s.card },
						h('p', { style: s.cardTitle }, fill(t('viewingTitle'), { name: view.name })),
						h('pre', { style: s.preBox }, view.content))
					: null,

				h('p', { style: s.cardSub }, fill(t('memoryNote'), { size: fmtSize(memory && memory.size), time: fmtTime(memory && memory.mtime, true) || t('never') })));
		}

		// ── 感官 ───────────────────────────────────────────────────────────
		function SensesTab({ t, senses, onReload, notify }) {
			const files = senses && senses.files ? senses.files : {};
			const notice = senses && senses.notice ? senses.notice : {};
			const voice = senses && senses.voice ? senses.voice : {};
			const napcat = notice.napcat && typeof notice.napcat === 'object' ? notice.napcat : {};

			const [onlyPrivate, setOnlyPrivate] = React.useState(files.onlyPrivate !== false);
			const [onlyQQ, setOnlyQQ] = React.useState(String(files.onlyQQ || ''));
			const [port, setPort] = React.useState(String(notice.port == null ? 9898 : notice.port));
			const [retries, setRetries] = React.useState(String(notice.retries == null ? 5 : notice.retries));
			const [retryMs, setRetryMs] = React.useState(String(notice.retryMs == null ? 5000 : notice.retryMs));
			const [busy, setBusy] = React.useState('');

			React.useEffect(() => {
				setOnlyPrivate(files.onlyPrivate !== false);
				setOnlyQQ(String(files.onlyQQ || ''));
			}, [files.onlyPrivate, files.onlyQQ]);

			React.useEffect(() => {
				setPort(String(notice.port == null ? 9898 : notice.port));
				setRetries(String(notice.retries == null ? 5 : notice.retries));
				setRetryMs(String(notice.retryMs == null ? 5000 : notice.retryMs));
			}, [notice.port, notice.retries, notice.retryMs]);

			function saveFiles() {
				setBusy('files');
				postJson('/api/ayy-settings/senses/files', { onlyPrivate: onlyPrivate, onlyQQ: onlyQQ }).then(function () {
					notify('ok', t('filesSaved'));
					onReload();
				}).catch(function (e) {
					notify('err', fill(t('saveFail'), { err: errorText(t, e) }));
				}).then(function () { setBusy(''); });
			}

			function saveNotice() {
				setBusy('notice');
				postJson('/api/ayy-settings/senses/notice', {
					port: Number(port), retries: Number(retries), retryMs: Number(retryMs)
				}).then(function () {
					notify('ok', t('noticeSaved'));
					onReload();
				}).catch(function (e) {
					notify('err', fill(t('saveFail'), { err: errorText(t, e) }));
				}).then(function () { setBusy(''); });
			}

			const listening = notice.listening && notice.listening.ok === true;
			const voiceOk = voice.ok === true;

			return h('div', { style: s.stack },
				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('filesTitle')),
					h('p', { style: s.cardSub }, t('filesHint')),
					h('label', { style: Object.assign({}, s.row, { cursor: 'pointer' }) },
						h('input', {
							type: 'checkbox',
							checked: onlyPrivate,
							onChange: function (e) { setOnlyPrivate(e.target.checked); }
						}),
						h('span', { style: s.metricValue }, t('filesOnlyPrivate'))),
					h(Field, { label: t('filesOnlyQQ') },
						h('input', {
							style: s.input,
							value: onlyQQ,
							placeholder: t('filesOnlyQQPlaceholder'),
							onChange: function (e) { setOnlyQQ(e.target.value); }
						})),
					h('div', { style: s.row },
						h('button', { type: 'button', style: s.primary, disabled: busy === 'files', onClick: saveFiles }, t('filesSave'))),
					h('p', { style: s.cardSub }, (files.path || '') + ' · ' + (fmtTime(files.mtime, true) || t('never')))),

				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('noticeTitle')),
					h('p', { style: s.cardSub }, t('noticeHint')),
					h('div', { style: s.metrics },
						h(Field, { label: t('noticePort') },
							h('input', { style: s.input, inputMode: 'numeric', value: port, onChange: function (e) { setPort(e.target.value); } })),
						h(Field, { label: t('noticeRetries') },
							h('input', { style: s.input, inputMode: 'numeric', value: retries, onChange: function (e) { setRetries(e.target.value); } })),
						h(Field, { label: t('noticeRetryMs') },
							h('input', { style: s.input, inputMode: 'numeric', value: retryMs, onChange: function (e) { setRetryMs(e.target.value); } }))),
					h('div', { style: s.row },
						h('button', { type: 'button', style: s.primary, disabled: busy === 'notice', onClick: saveNotice }, t('noticeSave'))),
					h('div', { style: s.row },
						h(Pill, { on: listening, bad: !listening, text: '127.0.0.1:' + String(notice.port || '') + ' · ' + (listening ? t('noticeListening') : t('noticeDown')) }),
						h(Pill, { on: notice.bridgeConfigured === true, bad: notice.bridgeConfigured !== true, text: notice.bridgeConfigured === true ? t('noticeBridgeOn') : t('noticeBridgeOff') })),
					h('p', { style: s.cardSub }, napcat.found
						? fill(t('noticeNapcatPath'), { file: String(napcat.file || '') }) + ' · ' + fill(t('noticeNapcatInstances'), { n: String(arr(napcat.instances).length) })
						: t('noticeNapcatMissing')),
					arr(napcat.clients).length
						? h('div', { style: s.hintBox }, arr(napcat.clients).map(function (c, i) {
							return h('span', { key: 'c' + i, style: s.cardSub },
								'httpClients: ' + String(c.name || '') + (c.enable ? '' : ' (disabled)') + ' · ' + String(c.url || ''));
						}))
						: null,
					notice.tokenSet === false ? h('p', { style: s.noteErr }, t('noticeTokenMissing')) : null,
					h('div', { style: s.hintBox },
						h('p', { style: s.cardSub }, t('noticeHowtoTitle')),
						h('p', { style: s.cardSub }, t('noticeHowto1')),
						h('p', { style: s.mono }, fill(t('noticeHowto2'), { port: String(notice.port || '') })),
						h('p', { style: s.cardSub }, t('noticeHowto3')))),

				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('voiceTitle')),
					h('p', { style: s.cardSub }, t('voiceHint')),
					h('div', { style: s.row },
						h(Pill, { on: voiceOk, bad: !voiceOk, text: voiceOk ? t('voiceUp') : t('voiceDown') })),
					h('p', { style: s.mono }, String(voice.url || '') + ' · ' + fill(t('voiceStatus'), { status: String(voice.status || 0), ms: String(voice.ms || 0) })),
					voiceOk ? null : h('p', { style: s.cardSub }, t('voiceDownWhy')),
					h('p', { style: s.cardSub }, t('voiceNoPreview'))));
		}

		// ── 注入范围 ───────────────────────────────────────────────────────
		function ScopeTab({ t, scope, onReload, notify }) {
			const sessions = arr(scope && scope.sessions).map(String);
			const mounted = scope && scope.mounted && typeof scope.mounted === 'object' ? scope.mounted : {};
			const bindings = arr(scope && scope.bindings).map(function (b) {
				return {
					type: String(b && b.type || ''),
					number: String(b && b.number || ''),
					name: String(b && b.name || ''),
					session: String(b && b.session || ''),
					enabled: !b || b.enabled !== false
				};
			});

			const known = {};
			bindings.forEach(function (b) { if (b.session) known[b.session] = true; });
			const extras = sessions.filter(function (sid) { return !known[sid]; }).map(function (sid) {
				return { type: '', number: '', name: '', session: sid, enabled: true };
			});
			const rows = bindings.concat(extras);

			const [selected, setSelected] = React.useState(sessions.slice());
			const [busy, setBusy] = React.useState(false);
			const sessionsKey = sessions.join('|');
			React.useEffect(function () {
				setSelected(sessions.slice());
			}, [sessionsKey]);

			function toggle(sid) {
				if (!sid) return;
				setSelected(function (prev) {
					if (prev.indexOf(sid) >= 0) return prev.filter(function (x) { return x !== sid; });
					return prev.concat([sid]);
				});
			}

			function save() {
				setBusy(true);
				postJson('/api/ayy-settings/scope', { sessions: selected }).then(function () {
					notify('ok', t('scopeSaved'));
					onReload();
				}).catch(function (e) {
					notify('err', fill(t('saveFail'), { err: errorText(t, e) }));
				}).then(function () { setBusy(false); });
			}

			function mountText(sid) {
				const rec = mounted[sid];
				if (!rec) return t('scopeMountUnknown');
				return rec.mounted === true ? t('scopeMountOn') : t('scopeMountOff');
			}

			return h('div', { style: s.stack },
				h('div', { style: s.warn }, h('p', { style: { margin: 0 } }, t('scopeWarn'))),
				h('p', { style: s.cardSub }, t('scopeHint')),
				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('scopeBindingsTitle')),
					rows.length
						? h('div', { style: s.stack },
							rows.map(function (row, i) {
								const sid = row.session;
								const label = [row.type, row.number, row.name].filter(Boolean).join(' · ') || t('scopeOther');
								const checked = !!sid && selected.indexOf(sid) >= 0;
								const rec = mounted[sid];
								const on = !!(rec && rec.mounted === true);
								return h('label', { key: sid || 'row' + i, style: s.checkRow },
									h('input', {
										type: 'checkbox',
										style: s.checkBox,
										checked: checked,
										disabled: !sid,
										onChange: function () { toggle(sid); }
									}),
									h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 auto' } },
										h('span', { style: s.metricValue }, label),
										h('span', { style: s.cardSub }, t('scopeSession') + ': ' + (sid || '—'))),
									h(Pill, { on: on, text: mountText(sid) }));
							}))
						: h('p', { style: s.cardSub }, t('scopeNoSessions')),
					h('div', { style: s.row },
						h('button', { type: 'button', style: s.primary, disabled: busy, onClick: save }, t('scopeSave'))),
					h('p', { style: s.cardSub }, (scope && scope.path ? scope.path : '') + ' · ' + (fmtTime(scope && scope.mtime, true) || t('never')))),
				// 手加：本机其它会话（不在 QQ 桥绑定里的）
				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('scopeMoreTitle')),
					h('p', { style: s.cardSub }, t('scopeMoreHint')),
					(function () {
						const list = arr(scope && scope.available);
						if (!list.length) return h('p', { style: s.cardSub }, t('scopeMoreEmpty'));
						return h('div', { style: s.stack }, list.map(function (x, i) {
							const sid = String(x && x.id || '');
							if (!sid) return null;
							const checked = selected.indexOf(sid) >= 0;
							return h('label', { key: sid, style: s.checkRow },
								h('input', {
									type: 'checkbox',
									style: s.checkBox,
									checked: checked,
									onChange: function () { toggle(sid); }
								}),
								h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: '1 1 auto' } },
									h('span', { style: s.metricValue }, String(x.workspace || '')),
									h('span', { style: s.cardSub }, sid + ' · ' + (fmtTime(x.mtime, true) || ''))),
								checked ? h(Pill, { on: true, text: t('scopePicked') }) : null);
						}).filter(Boolean));
					})(),
					h('p', { style: s.cardSub }, t('scopeMoreSaveNote'))),
				h('p', { style: s.cardSub }, t('scopeEmptyBindings') + ' ' + t('scopeHint')));
		}

		// ── 状态 ───────────────────────────────────────────────────────────
		function StatusTab({ t, status }) {
			const health = arr(status && status.health);
			const scopeLog = arr(status && status.scopeLog);
			const files = arr(status && status.files);

			function logCard(title, lines) {
				return h('div', { style: s.card },
					h('p', { style: s.cardTitle }, title),
					lines.length
						? h('pre', { style: s.logBox }, lines.join('\n'))
						: h('p', { style: s.cardSub }, t('statusLogEmpty')));
			}

			return h('div', { style: s.stack },
				h('p', { style: s.cardSub }, t('statusHint')),
				logCard(t('statusHealth'), health),
				logCard(t('statusScopeLog'), scopeLog),
				h('div', { style: s.card },
					h('p', { style: s.cardTitle }, t('statusFiles')),
					files.length
						? h('div', { style: s.stack }, files.map(function (f, i) {
							const key = String(f && f.key || '');
							const labelKey = FILE_LABEL[key];
							return h('div', { key: key || 'f' + i, style: s.histRow },
								h('div', { style: s.histMain },
									h('span', { style: s.metricValue }, labelKey ? t(labelKey) : key),
									h('span', { style: s.mono }, String(f && f.path || ''))),
								h('span', { style: f && f.exists ? s.cardSub : s.noteErr },
									f && f.exists ? (fmtTime(f.mtime, true) || t('never')) + ' · ' + fmtSize(f.size) : t('missing')));
						}))
						: h('p', { style: s.cardSub }, t('statusLogEmpty'))));
		}

		// ── 面板 ───────────────────────────────────────────────────────────
		function SettingsView({ t }) {
			const [tab, setTab] = React.useState('self');
			const [state, setState] = React.useState({ status: 'loading' });
			const [note, setNote] = React.useState(null);

			const reload = React.useCallback(function () {
				setState({ status: 'loading' });
				getJson('/api/ayy-settings/overview').then(function (data) {
					setState({ status: 'ready', data: data });
				}).catch(function (e) {
					setState({ status: 'error', error: e });
				});
			}, []);

			React.useEffect(function () { reload(); }, [reload]);

			function notify(kind, text) { setNote({ kind: kind, text: text }); }

			const tabs = [
				{ id: 'self', label: t('tabSelf') },
				{ id: 'senses', label: t('tabSenses') },
				{ id: 'scope', label: t('tabScope') },
				{ id: 'status', label: t('tabStatus') }
			];

			const head = h('div', { style: s.head },
				h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 } }, h('p', { style: s.intro }, t('intro'))),
				h('button', { type: 'button', style: s.btn, onClick: reload }, t('refresh')));

			const tabRow = h('div', { style: s.tabs }, tabs.map(function (item) {
				return h('button', {
					key: item.id,
					type: 'button',
					style: item.id === tab ? Object.assign({}, s.tab, s.tabOn) : s.tab,
					onClick: function () { setTab(item.id); }
				}, item.label);
			}));

			let body = null;
			if (state.status === 'loading') {
				body = h('p', { style: s.status }, t('loading'));
			} else if (state.status === 'error') {
				body = h(Failure, { t: t, onRetry: reload });
			} else {
				const data = state.data || {};
				const self = data.self || {};
				const history = arr(data.history);
				const memory = data.memory || {};
				const senses = data.senses || {};
				const scope = data.scope || {};
				const status = data.status || {};
				if (tab === 'self') {
					body = h(SelfTab, { t: t, self: self, history: history, memory: memory, onReload: reload, notify: notify });
				} else if (tab === 'senses') {
					body = h(SensesTab, { t: t, senses: senses, onReload: reload, notify: notify });
				} else if (tab === 'scope') {
					body = h(ScopeTab, { t: t, scope: scope, onReload: reload, notify: notify });
				} else {
					body = h(StatusTab, { t: t, status: status });
				}
			}

			return h('div', { style: s.wrap }, head, tabRow, h(Note, { note: note }), body);
		}

		const inject = ['slots', 'locale'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh: zh, en: en }), 'dsh-ayy-settings: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'ayy-settings',
				order: 14,
				label: () => t('nav'),
				locale: NS,
				inject: () => ({})
			}, (props) => h(SettingsView, Object.assign({}, props, { t: props && props.t ? props.t : t }))));
		}

		return { inject: inject, apply: apply };
	}
});

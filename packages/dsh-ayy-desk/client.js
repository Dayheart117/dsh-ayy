window.__ModuleLoader__.load({
	id: 'dsh-ayy-desk',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'ayyDesk';
		const SEEN_KEY = 'ayy-desk.seen.v1';
		const SECTIONS = ['diary', 'self', 'skills', 'wants', 'ledger', 'files', 'transcripts', 'memory'];
		const TAB_SECTION = {
			diary: 'diary', oldDiary: 'diary', self: 'self', skills: 'skills',
			wants: 'wants', ledger: 'ledger', files: 'files', transcripts: 'transcripts', memory: 'memory'
		};

		const zh = {
			nav: '她的本子',
			intro: '她自己写的、自己长的东西都在这儿：今天有什么新的、日记、自述、心愿单、技能、动态、收件箱、原文缓存和归档记忆。技能和心愿单状态可以在这里改，其余只读。',
			tabToday: '今天',
			tabDiary: '日记',
			tabOldDiary: '旧日记',
			tabSelf: '自我认知',
			tabWants: '心愿单',
			tabLedger: '动态',
			tabSkills: '技能',
			tabTimeline: '时间线',
			tabSearch: '搜索',
			tabFiles: '收件箱',
			tabTranscripts: '原文',
			tabMemory: '记忆',
			tabStorage: '存储',
			loading: '正在读…',
			error: '读不出来了。',
			retry: '重试',
			refresh: '刷新',
			needRestart: '这个页面要重启 dsh 之后才有数据——host 半身已经改了，进程里还是旧的。',
			emptyDiary: '她还没写过日记。',
			emptyOldDiary: '还没有被覆盖的旧日记。',
			emptyHistory: '还没有旧版本。',
			emptySelf: '她还没写过自我认知。',
			emptyWants: '心愿单还是空的。',
			emptySkills: '她还没写过技能。',
			emptyTimeline: '还没有任何记录。',
			emptyLedger: '动态还是空的。',
			emptySearch: '没搜到。',
			emptyFiles: '还没有收到过文件。',
			emptyTranscripts: '还没有原文缓存。',
			emptyMemory: '没有匹配的记忆。',
			recentLabel: '最近动态（每轮注入所有会话）',
			monthsLabel: '月度流水',
			pickMonth: '左边选一个月的流水。',
			dir: '目录',
			pickOne: '左边选一篇。',
			newBadge: '新',
			openTab: '打开',
			lastWrite: '最后写：{time}',
			cDiary: '日记',
			cSelf: '自我认知',
			cSkills: '技能',
			cWants: '心愿单',
			cLedger: '最近动态',
			cFiles: '收件箱',
			cTranscripts: '对话原文',
			diarySub: '{n} 节 · 最近 {time}',
			diaryNone: '今天还没写。',
			selfSubOn: '今天改过 · {n} 字',
			selfSubOff: '今天没动 · {n} 字',
			selfNone: '她还没写过自述。',
			skillsSub: '共 {total} 个 · 今天新增 {added} · 今天改动 {changed}',
			wantsSub: '共 {total} 条 · 今天 {today} 条',
			ledgerSub: '窗口里 {recent} 条 · 今天 {today} 条',
			filesSub: '今天 {today} 个 · 累计 {total} 个',
			transcriptsSub: '今天 {today} 份 · 累计 {total} 份',
			todayAdded: '新增',
			todayChanged: '改动',
			wNone: '未标记',
			wDoing: '在做',
			wDone: '做完了',
			wDropped: '不做了',
			wantsHint: '状态存在旁边的 wants-status.json，wants.md 一个字都不动。',
			wantsRaw: '看原文',
			wantsHideRaw: '收起原文',
			skEdit: '编辑',
			skNew: '新建技能',
			skDelete: '删除',
			skSave: '保存',
			skCancel: '取消',
			skName: '名字（小写字母 / 数字 / 连字符）',
			skDesc: 'description（一句话说清什么时候用）',
			skBody: '正文',
			skConfirm: '确认删除？会移到 skills/.trash/，不真删。',
			skConfirmYes: '确认删除',
			skSaved: '已保存。{backup}',
			skBackup: '原文件备份：{file}',
			skDeleted: '已移到 {dir}',
			skInvalidName: '名字只能是小写字母、数字和连字符。',
			skExists: '这个名字已经有了。',
			skFail: '保存失败：{err}',
			skDeleteFail: '删除失败：{err}',
			skillsHint: '改完立刻生效。名字必须是小写英文——中文名 DSH 加载不了。',
			searchPlaceholder: '搜日记、旧日记、自述、技能、心愿单、月度流水…',
			searchBtn: '搜',
			searchCount: '命中 {n} 条',
			searchTruncated: '只显示前 200 条，换个词再搜。',
			searchHint: '一次扫盘做包含匹配，不是索引。',
			tlFilter: '按类型筛：',
			inboxHint: 'QQ 收进来的文件都在这儿。',
			inboxCount: '{n} 个',
			previewPick: '左边挑一个文件。',
			previewPdf: '这是 PDF，浏览器里没法直接渲染本地文件。文件在这儿：',
			previewImage: '这是图片，浏览器里没法直接读本地路径。文件在这儿：',
			previewBinary: '这个类型没法预览。文件在这儿：',
			previewTooLarge: '文件太大，不在这儿展开。路径：{path}',
			copyPath: '复制路径',
			copied: '已复制',
			trHint: '这是她翻原文时留下的缓存，没缓存的日子得让她自己用 ayy_recall 去翻。不是完整历史。',
			memHint: '归档记忆（memory/notes），只读。',
			memAll: '全部',
			memSearch: '搜标题 / 标签 / 正文…',
			memTags: '标签',
			kDiary: '日记',
			kDiaryArchive: '旧日记',
			kSkill: '技能',
			kSelf: '自我认知',
			kSelfArchive: '旧自述',
			kWants: '心愿单',
			kLedger: '动态',
			kMemory: '记忆',
			storageHint: '她的东西都放在哪、占了多少。只读，不会搬任何文件。',
			storageScanning: '正在数文件…（聊天记录多的话要几秒）',
			storagePath: '路径',
			storageLink: '联接 → {real}',
			storageFiles: '{n} 个文件',
			storageLast: '最后改动 {time}',
			storageMissingDir: '这个目录还不存在。',
			storageTruncated: '条目太多，只算了一部分。',
			storageDisk: '磁盘剩余',
			storageDiskLine: '{root} 剩余 {free} / 共 {total}',
			stPersonas: '她的数据（日记 / 自述 / 心愿 / 流水）',
			stMemory: '记忆（核心 + 归档笔记）',
			stSkills: '她写的技能',
			stSessions: '聊天记录（会一直涨）',
			stAttachments: '图片附件（会涨）',
			stQqInbox: 'QQ 收到的图',
			stFiles: 'QQ 收到的文件'
		};

		const en = {
			nav: 'Her notebook',
			intro: 'Everything she writes and grows is here: what is new today, diary, self-description, wishes, skills, activity, inbox, transcript cache and archived memory. Skills and wish status are editable; the rest is read-only.',
			tabToday: 'Today',
			tabDiary: 'Diary',
			tabOldDiary: 'Older diary',
			tabSelf: 'Self',
			tabWants: 'Wishes',
			tabLedger: 'Activity',
			tabSkills: 'Skills',
			tabTimeline: 'Timeline',
			tabSearch: 'Search',
			tabFiles: 'Inbox',
			tabTranscripts: 'Transcripts',
			tabMemory: 'Memory',
			tabStorage: 'Storage',
			loading: 'Reading…',
			error: 'Could not read.',
			retry: 'Retry',
			refresh: 'Refresh',
			needRestart: 'This view needs a dsh restart: the host half changed but the running process is still old.',
			emptyDiary: 'No diary entries yet.',
			emptyOldDiary: 'No overwritten diary files.',
			emptyHistory: 'No earlier versions.',
			emptySelf: 'No self-description yet.',
			emptyWants: 'The wish list is empty.',
			emptySkills: 'No skills written yet.',
			emptyTimeline: 'Nothing recorded yet.',
			emptyLedger: 'No activity yet.',
			emptySearch: 'Nothing found.',
			emptyFiles: 'No files received yet.',
			emptyTranscripts: 'No transcript cache yet.',
			emptyMemory: 'No matching memory.',
			recentLabel: 'Recent activity (injected into every session)',
			monthsLabel: 'Monthly journal',
			pickMonth: 'Pick a month on the left.',
			dir: 'Directory',
			pickOne: 'Pick one on the left.',
			newBadge: 'New',
			openTab: 'Open',
			lastWrite: 'Last write: {time}',
			cDiary: 'Diary',
			cSelf: 'Self',
			cSkills: 'Skills',
			cWants: 'Wishes',
			cLedger: 'Recent activity',
			cFiles: 'Inbox',
			cTranscripts: 'Transcripts',
			diarySub: '{n} sections · last {time}',
			diaryNone: 'Nothing written today.',
			selfSubOn: 'Changed today · {n} chars',
			selfSubOff: 'Untouched today · {n} chars',
			selfNone: 'No self-description yet.',
			skillsSub: '{total} total · {added} new today · {changed} changed today',
			wantsSub: '{total} total · {today} today',
			ledgerSub: '{recent} in window · {today} today',
			filesSub: '{today} today · {total} total',
			transcriptsSub: '{today} today · {total} total',
			todayAdded: 'new',
			todayChanged: 'changed',
			wNone: 'No status',
			wDoing: 'Doing',
			wDone: 'Done',
			wDropped: 'Dropped',
			wantsHint: 'Status lives in wants-status.json next to the file; wants.md is never touched.',
			wantsRaw: 'Show file',
			wantsHideRaw: 'Hide file',
			skEdit: 'Edit',
			skNew: 'New skill',
			skDelete: 'Delete',
			skSave: 'Save',
			skCancel: 'Cancel',
			skName: 'Name (lowercase letters / digits / hyphen)',
			skDesc: 'description (one line: when to use it)',
			skBody: 'Body',
			skConfirm: 'Delete it? It moves to skills/.trash/ instead of being removed.',
			skConfirmYes: 'Yes, delete',
			skSaved: 'Saved. {backup}',
			skBackup: 'Backup: {file}',
			skDeleted: 'Moved to {dir}',
			skInvalidName: 'Name may only use lowercase letters, digits and hyphens.',
			skExists: 'That name already exists.',
			skFail: 'Save failed: {err}',
			skDeleteFail: 'Delete failed: {err}',
			skillsHint: 'Changes apply at once. The name must be ASCII lowercase — DSH cannot load a Chinese skill name.',
			searchPlaceholder: 'Search diary, older diary, self, skills, wishes, monthly journal…',
			searchBtn: 'Search',
			searchCount: '{n} hits',
			searchTruncated: 'Only the first 200 hits are shown; narrow the query.',
			searchHint: 'A single directory scan with substring match — no index.',
			tlFilter: 'Filter:',
			inboxHint: 'Files received over QQ land here.',
			inboxCount: '{n} files',
			previewPick: 'Pick a file on the left.',
			previewPdf: 'This is a PDF; the browser cannot render a local file. It lives at:',
			previewImage: 'This is an image; the browser cannot read a local path. It lives at:',
			previewBinary: 'This type cannot be previewed. It lives at:',
			previewTooLarge: 'Too large to expand here. Path: {path}',
			copyPath: 'Copy path',
			copied: 'Copied',
			trHint: 'This is the cache left behind when she looked up raw messages. Days without a cache have to be re-read with ayy_recall. It is not a complete history.',
			memHint: 'Archived memory (memory/notes), read-only.',
			memAll: 'All',
			memSearch: 'Search title / tags / body…',
			memTags: 'Tags',
			kDiary: 'Diary',
			kDiaryArchive: 'Older diary',
			kSkill: 'Skill',
			kSelf: 'Self',
			kSelfArchive: 'Older self',
			kWants: 'Wishes',
			kLedger: 'Activity',
			kMemory: 'Memory',
			storageHint: 'Where her data lives and how much it takes. Read-only: nothing is moved.',
			storageScanning: 'Counting files… (a few seconds if chat history is big)',
			storagePath: 'Path',
			storageLink: 'junction → {real}',
			storageFiles: '{n} files',
			storageLast: 'Last change {time}',
			storageMissingDir: 'This directory does not exist yet.',
			storageTruncated: 'Too many entries; only part was counted.',
			storageDisk: 'Free space',
			storageDiskLine: '{root} free {free} of {total}',
			stPersonas: 'Her data (diary / self / wishes / journal)',
			stMemory: 'Memory (core + archived notes)',
			stSkills: 'Skills she wrote',
			stSessions: 'Chat history (grows forever)',
			stAttachments: 'Image attachments (growing)',
			stQqInbox: 'Images received over QQ',
			stFiles: 'Files received over QQ'
		};

		const s = {
			wrap: { width: '100%', maxWidth: '1080px', display: 'flex', flexDirection: 'column', gap: '14px' },
			intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' },
			tabs: { display: 'flex', flexWrap: 'wrap', gap: '6px' },
			tab: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: '13px', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer' },
			tabOn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)' },
			split: { display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: '12px', alignItems: 'start' },
			list: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', display: 'flex', flexDirection: 'column', maxHeight: '540px', overflowY: 'auto' },
			item: { textAlign: 'left', width: '100%', border: 0, borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', padding: '9px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px' },
			itemOn: { background: 'var(--dsw-alias-bg-layer-3)' },
			itemName: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
			itemMeta: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
			pane: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-3)', padding: '14px 16px', minHeight: '160px' },
			pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: '1.7', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
			status: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' },
			failure: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
			btn: { border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', background: 'transparent', borderRadius: '6px', padding: '4px 10px', fontSize: '12.5px' },
			btnOn: { background: 'var(--dsw-alias-bg-layer-3)' },
			btnDanger: { border: '1px solid var(--dsw-alias-state-error-primary)', color: 'var(--dsw-alias-state-error-primary)' },
			meta: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11.5px', wordBreak: 'break-all' },
			kind: { flex: 'none', fontSize: '11px', padding: '0 6px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)' },
			row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flexWrap: 'wrap' },
			card: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-1)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '8px' },
			cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' },
			cardTitle: { fontSize: '13.5px', fontWeight: '600', color: 'var(--dsw-alias-label-primary)' },
			cardSub: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' },
			dot: { flex: 'none', fontSize: '10.5px', lineHeight: '16px', padding: '0 6px', borderRadius: '999px', border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-secondary)' },
			cards: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' },
			linkRow: { textAlign: 'left', border: 0, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: '12px', padding: '2px 0', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' },
			input: { width: '100%', boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', borderRadius: '6px', padding: '6px 9px' },
			textarea: { width: '100%', boxSizing: 'border-box', minHeight: '260px', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', lineHeight: '1.7', borderRadius: '6px', padding: '8px 10px', resize: 'vertical' },
			label: { fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
			field: { display: 'flex', flexDirection: 'column', gap: '4px' },
			notice: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', wordBreak: 'break-all' },
			wantRow: { display: 'flex', gap: '10px', padding: '10px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', alignItems: 'flex-start' },
			wantStatus: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 'none', width: '78px' },
			wantBtn: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', font: 'inherit', fontSize: '11px', borderRadius: '6px', padding: '2px 6px', cursor: 'pointer', textAlign: 'left' },
			wantBtnOn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)' },
			wantText: { margin: 0, fontSize: '13px', color: 'var(--dsw-alias-label-primary)', lineHeight: '1.6' },
			wantWhy: { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: '1.6' },
			snippet: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: '1.6', wordBreak: 'break-word' },
			mark: { background: 'transparent', color: 'var(--dsw-alias-label-primary)', fontWeight: '600', textDecoration: 'underline', textUnderlineOffset: '2px' },
			chips: { display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center' },
			chip: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', font: 'inherit', fontSize: '11.5px', borderRadius: '999px', padding: '3px 10px', cursor: 'pointer' },
			chipOn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)' },
			groupTitle: { margin: '10px 0 4px', fontSize: '11.5px', color: 'var(--dsw-alias-label-tertiary)' },
			storageRow: { display: 'flex', flexDirection: 'column', gap: '3px', padding: '9px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
			stack: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }
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

		function isMissingRoute(error) {
			return !!error && (error.code === 'route-missing' || error.code === 'not-json' || error.code === 'method-not-allowed');
		}

		function errorText(error) {
			if (!error) return 'unknown';
			return String(error.code || error.message || 'unknown');
		}

		function splitName(name) {
			const base = String(name || '').replace(/\.md$/, '');
			const dot = base.indexOf('.');
			if (dot < 0) return { day: base, scene: '' };
			return { day: base.slice(0, dot), scene: base.slice(dot + 1).replace(/_/g, ':') };
		}

		function fmtTime(ms) {
			const n = Number(ms);
			if (!n) return '';
			const d = new Date(n);
			const p = function (x) { return String(x).padStart(2, '0'); };
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
		}

		function fmtClock(ms) {
			const n = Number(ms);
			if (!n) return '';
			const d = new Date(n);
			const p = function (x) { return String(x).padStart(2, '0'); };
			return `${p(d.getHours())}:${p(d.getMinutes())}`;
		}

		function fmtSize(bytes) {
			const n = Number(bytes) || 0;
			if (n < 1024) return n + ' B';
			if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
			if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
			return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
		}

		/** 存储页的目录名 → 文案 key（名字带连字符，只能写成字符串键） */
		const STORAGE_LABEL = {
			personas: 'stPersonas',
			memory: 'stMemory',
			skills: 'stSkills',
			sessions: 'stSessions',
			attachments: 'stAttachments',
			'qq-bridge-inbox': 'stQqInbox',
			'ayy-files': 'stFiles'
		};

		function loadSeen() {
			try {
				const raw = window.localStorage.getItem(SEEN_KEY);
				if (raw) {
					const parsed = JSON.parse(raw);
					if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
				}
			} catch (e) { /* 隐私模式之类，忽略 */ }
			const now = Date.now();
			const init = {};
			for (const key of SECTIONS) init[key] = now;
			saveSeen(init);
			return init;
		}

		function saveSeen(value) {
			try { window.localStorage.setItem(SEEN_KEY, JSON.stringify(value || {})); } catch (e) { /* ignore */ }
		}

		const KIND_KEY = {
			diary: 'kDiary', diaryArchive: 'kDiaryArchive', self: 'kSelf',
			selfArchive: 'kSelfArchive', skill: 'kSkill', wants: 'kWants', ledger: 'kLedger'
		};

		// ── 基础组件 ───────────────────────────────────────────────────────

		function NewBadge({ t }) {
			return h('span', { style: s.dot }, typeof t === 'function' ? t('newBadge') : '新');
		}

		function Missing({ t }) {
			return h('div', { style: s.pane }, h('p', { style: s.status }, t('needRestart')));
		}

		function Failure({ t, onRetry }) {
			return h('div', { style: s.failure },
				h('p', { role: 'alert', style: { margin: 0 } }, t('error')),
				h('button', { type: 'button', style: s.btn, onClick: onRetry || (() => location.reload()) }, t('retry')));
		}

		/** 通用正文面板：rel= 走文件接口，skillName= 走技能接口 */
		function Content({ t, rel, skillName, empty }) {
			const [state, setState] = React.useState({ status: 'idle' });
			React.useEffect(() => {
				if (!rel && !skillName) {
					setState({ status: 'idle' });
					return;
				}
				let alive = true;
				setState({ status: 'loading' });
				const url = skillName
					? '/api/ayy-desk/skill?name=' + encodeURIComponent(skillName)
					: '/api/ayy-desk/file?rel=' + encodeURIComponent(rel);
				getJson(url).then((p) => {
					if (!alive) return;
					setState({ status: 'ready', content: String(p.content || '') });
				}).catch((error) => { if (alive) setState({ status: isMissingRoute(error) ? 'missing' : 'error' }); });
				return () => { alive = false; };
			}, [rel, skillName]);

			if (state.status === 'idle') return h('div', { style: s.pane }, h('p', { style: s.status }, empty || t('pickOne')));
			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'missing') return h(Missing, { t });
			if (state.status === 'error') return h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			return h('div', { style: s.pane }, h('pre', { style: s.pre }, state.content));
		}

		function List({ t, items, selected, onPick, emptyText }) {
			const list = arr(items);
			if (!list.length) return h('div', { style: s.list }, h('p', { style: Object.assign({ padding: '12px' }, s.status) }, emptyText));
			return h('div', { style: s.list }, list.map((it) => {
				const on = it.key === selected;
				return h('button', {
					key: it.key,
					type: 'button',
					style: on ? Object.assign({}, s.item, s.itemOn) : s.item,
					onClick: () => onPick(it.key)
				},
					h('span', { style: Object.assign({}, s.row, { gap: '6px' }) },
						it.dot ? h(NewBadge, { t }) : null,
						h('span', { style: s.itemName }, it.label)
					),
					it.sub ? h('span', { style: s.itemMeta }, it.sub) : null
				);
			}));
		}

		function Card({ t, title, sub, isNew, onOpen, children }) {
			return h('div', { style: s.card },
				h('div', { style: s.cardHead },
					h('div', { style: s.row },
						h('span', { style: s.cardTitle }, title),
						isNew ? h(NewBadge, { t }) : null
					),
					onOpen ? h('button', { type: 'button', style: s.btn, onClick: onOpen }, t('openTab')) : null
				),
				sub ? h('p', { style: s.cardSub }, sub) : null,
				children || null
			);
		}

		// ── 今天 ───────────────────────────────────────────────────────────

		function TodayPanel({ t, state, seen, onGoto }) {
			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'missing') return h(Missing, { t });
			if (state.status === 'error') return h(Failure, { t });
			const d = state.data || {};
			const diary = d.diary || {};
			const self = d.self || {};
			const skills = d.skills || {};
			const wants = d.wants || {};
			const ledger = d.ledger || {};
			const files = d.files || {};
			const transcripts = d.transcripts || {};
			const sections = arr(diary.sections);
			const added = arr(skills.added);
			const changed = arr(skills.changed);

			const newer = function (ts, section) {
				return Number(ts || 0) > Number((seen && seen[section]) || 0);
			};

			const diaryChildren = sections.length
				? h('div', { style: s.stack },
					sections.slice(-3).map((sec, i) => h('button', {
						key: 'sec' + i,
						type: 'button',
						style: s.linkRow,
						onClick: () => onGoto({ tab: 'diary', rel: diary.rel })
					}, `${sec.time} · ${sec.scene}`))
				)
				: null;

			const skillChildren = (added.length || changed.length)
				? h('div', { style: s.stack },
					added.map((k) => h('button', {
						key: 'a-' + k.name, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'skills', name: k.name })
					}, `${t('todayAdded')} · ${k.name}`)),
					changed.map((k) => h('button', {
						key: 'c-' + k.name, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'skills', name: k.name })
					}, `${t('todayChanged')} · ${k.name}`))
				)
				: null;

			const wantsChildren = arr(wants.items).length
				? h('div', { style: s.stack },
					arr(wants.items).slice(0, 3).map((w, i) => h('button', {
						key: 'w' + i, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'wants' })
					}, w.text))
				)
				: null;

			const ledgerChildren = arr(ledger.items).length
				? h('div', { style: s.stack },
					arr(ledger.items).slice(0, 3).map((it, i) => h('button', {
						key: 'l' + i, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'ledger' })
					}, it.text))
				)
				: null;

			const fileChildren = arr(files.items).length
				? h('div', { style: s.stack },
					arr(files.items).slice(0, 4).map((f, i) => h('button', {
						key: 'f' + i, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'files', rel: f.rel })
					}, `${f.name} · ${fmtSize(f.size)}`))
				)
				: null;

			const trChildren = arr(transcripts.items).length
				? h('div', { style: s.stack },
					arr(transcripts.items).slice(0, 4).map((x, i) => h('button', {
						key: 't' + i, type: 'button', style: s.linkRow,
						onClick: () => onGoto({ tab: 'transcripts', rel: x.rel })
					}, `${x.day} · ${x.scene}`))
				)
				: null;

			return h('div', { style: s.stack },
				h('div', { style: s.cards },
					h(Card, {
						t,
						title: t('cDiary'),
						isNew: newer(diary.mtime, 'diary'),
						sub: diary.exists ? fill(t('diarySub'), { n: sections.length, time: fmtClock(diary.mtime) }) : t('diaryNone'),
						onOpen: () => onGoto({ tab: 'diary', rel: diary.rel })
					}, diaryChildren),
					h(Card, {
						t,
						title: t('cSelf'),
						isNew: newer(self.mtime, 'self'),
						sub: self.exists
							? fill(self.changedToday ? t('selfSubOn') : t('selfSubOff'), { n: self.chars })
							: t('selfNone'),
						onOpen: () => onGoto({ tab: 'self' })
					}, null),
					h(Card, {
						t,
						title: t('cSkills'),
						isNew: added.concat(changed).some((k) => newer(k.mtime, 'skills')),
						sub: fill(t('skillsSub'), { total: Number(skills.total) || 0, added: added.length, changed: changed.length }),
						onOpen: () => onGoto({ tab: 'skills' })
					}, skillChildren),
					h(Card, {
						t,
						title: t('cWants'),
						isNew: newer(wants.mtime, 'wants'),
						sub: fill(t('wantsSub'), { total: Number(wants.total) || 0, today: Number(wants.today) || 0 }),
						onOpen: () => onGoto({ tab: 'wants' })
					}, wantsChildren),
					h(Card, {
						t,
						title: t('cLedger'),
						isNew: newer(ledger.lastT, 'ledger'),
						sub: fill(t('ledgerSub'), { recent: Number(ledger.recent) || 0, today: Number(ledger.today) || 0 }),
						onOpen: () => onGoto({ tab: 'ledger' })
					}, ledgerChildren),
					h(Card, {
						t,
						title: t('cFiles'),
						isNew: newer(files.lastT, 'files'),
						sub: fill(t('filesSub'), { today: Number(files.today) || 0, total: Number(files.total) || 0 }),
						onOpen: () => onGoto({ tab: 'files' })
					}, fileChildren),
					h(Card, {
						t,
						title: t('cTranscripts'),
						isNew: newer(transcripts.lastT, 'transcripts'),
						sub: fill(t('transcriptsSub'), { today: Number(transcripts.today) || 0, total: Number(transcripts.total) || 0 }),
						onOpen: () => onGoto({ tab: 'transcripts' })
					}, trChildren)
				)
			);
		}

		// ── 心愿单 ─────────────────────────────────────────────────────────

		const WANT_STATES = [['', 'wNone'], ['doing', 'wDoing'], ['done', 'wDone'], ['dropped', 'wDropped']];

		function WantsPanel({ t, items, onSetStatus, selectedRel, onOpenFile }) {
			const list = arr(items);
			const [busy, setBusy] = React.useState('');
			const [error, setError] = React.useState('');
			const [showRaw, setShowRaw] = React.useState(false);

			const change = function (key, status) {
				if (busy) return;
				setBusy(key);
				setError('');
				Promise.resolve(onSetStatus(key, status))
					.catch((err) => setError(isMissingRoute(err) ? t('needRestart') : fill(t('skFail'), { err: errorText(err) })))
					.then(() => setBusy(''));
			};

			if (!list.length) {
				return h('div', { style: s.pane }, h('p', { style: s.status }, t('emptyWants')));
			}

			return h('div', { style: s.stack },
				h('p', { style: s.status }, t('wantsHint')),
				error ? h('p', { style: s.failure }, error) : null,
				h('div', { style: s.pane, padding: '14px 16px' },
					list.map((w, i) => h('div', { key: w.key || ('w' + i), style: s.wantRow },
						h('div', { style: s.wantStatus },
							WANT_STATES.map((pair) => h('button', {
								key: pair[0] || 'none',
								type: 'button',
								style: w.status === pair[0] ? Object.assign({}, s.wantBtn, s.wantBtnOn) : s.wantBtn,
								onClick: () => change(w.key, pair[0]),
								disabled: !!busy
							}, t(pair[1])))
						),
						h('div', { style: { minWidth: 0, flex: '1 1 auto' } },
							h('p', { style: s.wantText }, w.text),
							w.reason ? h('p', { style: s.wantWhy }, w.reason) : null,
							h('p', { style: s.itemMeta }, `${w.date || '—'} · #${w.line}`)
						)
					))
				),
				h('div', { style: s.row },
					h('button', { type: 'button', style: s.btn, onClick: () => setShowRaw((v) => !v) },
						showRaw ? t('wantsHideRaw') : t('wantsRaw'))
				),
				showRaw ? h(Content, { t, rel: selectedRel || 'wants.md' }) : null
			);
		}

		// ── 技能 ───────────────────────────────────────────────────────────

		const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

		function SkillsPanel({ t, skills, seen, selected, onSelect, onChanged }) {
			const list = arr(skills);
			const [detail, setDetail] = React.useState({ status: 'idle' });
			const [form, setForm] = React.useState(null);
			const [notice, setNotice] = React.useState('');
			const [error, setError] = React.useState('');
			const [confirming, setConfirming] = React.useState('');
			const [busy, setBusy] = React.useState(false);

			React.useEffect(() => {
				setForm(null);
				setConfirming('');
				setError('');
				if (!selected) { setDetail({ status: 'idle' }); return; }
				let alive = true;
				setDetail({ status: 'loading' });
				getJson('/api/ayy-desk/skill?name=' + encodeURIComponent(selected))
					.then((p) => { if (alive) setDetail({ status: 'ready', data: p }); })
					.catch((err) => { if (alive) setDetail({ status: isMissingRoute(err) ? 'missing' : 'error' }); });
				return () => { alive = false; };
			}, [selected]);

			const startEdit = function () {
				if (detail.status !== 'ready') return;
				const d = detail.data || {};
				const raw = String(d.content || '');
				const fm = raw.match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n)?/);
				// 旧 host 不返回 body/description 时自己从原文里剥，别让编辑框空着
				let bodyText = typeof d.body === 'string' ? d.body : '';
				if (typeof d.body !== 'string') bodyText = fm ? raw.slice(fm[0].length) : raw;
				let desc = typeof d.description === 'string' ? d.description : '';
				if (typeof d.description !== 'string' && fm) {
					const line = fm[1].match(/^description:\s*(.*)$/m);
					desc = line ? line[1].replace(/^["']|["']$/g, '').trim() : '';
				}
				setForm({ mode: 'save', name: selected, description: desc, body: String(bodyText).replace(/^\n+/, '') });
				setNotice('');
				setError('');
			};

			const startCreate = function () {
				setForm({ mode: 'create', name: '', description: '', body: '' });
				setConfirming('');
				setNotice('');
				setError('');
			};

			const save = function () {
				if (!form) return;
				const name = String(form.name || '').trim();
				if (!SKILL_NAME_RE.test(name)) { setError(t('skInvalidName')); return; }
				setBusy(true);
				setError('');
				postJson('/api/ayy-desk/skill-save', {
					mode: form.mode, name: name, description: form.description, body: form.body
				}).then((res) => {
					setBusy(false);
					setForm(null);
					setNotice(fill(t('skSaved'), { backup: res.backup ? fill(t('skBackup'), { file: res.backup }) : '' }));
					onSelect(name);
					if (onChanged) onChanged();
				}).catch((err) => {
					setBusy(false);
					if (isMissingRoute(err)) setError(t('needRestart'));
					else if (err && err.code === 'skill-exists') setError(t('skExists'));
					else setError(fill(t('skFail'), { err: errorText(err) }));
				});
			};

			const remove = function () {
				if (!selected) return;
				setBusy(true);
				setError('');
				postJson('/api/ayy-desk/skill-delete', { name: selected }).then((res) => {
					setBusy(false);
					setConfirming('');
					setNotice(fill(t('skDeleted'), { dir: res.movedTo || '' }));
					onSelect('');
					if (onChanged) onChanged();
				}).catch((err) => {
					setBusy(false);
					setError(isMissingRoute(err) ? t('needRestart') : fill(t('skDeleteFail'), { err: errorText(err) }));
				});
			};

			const items = list.map((k) => ({
				key: k.name,
				label: k.name,
				sub: k.description || '',
				dot: Number(k.mtime || 0) > Number((seen && seen.skills) || 0)
			}));

			let right = null;
			if (form) {
				right = h('div', { style: s.pane },
					h('div', { style: s.stack },
						h('div', { style: s.field },
							h('span', { style: s.label }, t('skName')),
							h('input', {
								style: s.input,
								value: form.name,
								disabled: form.mode === 'save' || busy,
								onChange: (e) => setForm(Object.assign({}, form, { name: e.target.value }))
							})
						),
						h('div', { style: s.field },
							h('span', { style: s.label }, t('skDesc')),
							h('input', {
								style: s.input,
								value: form.description,
								onChange: (e) => setForm(Object.assign({}, form, { description: e.target.value }))
							})
						),
						h('div', { style: s.field },
							h('span', { style: s.label }, t('skBody')),
							h('textarea', {
								style: s.textarea,
								value: form.body,
								onChange: (e) => setForm(Object.assign({}, form, { body: e.target.value }))
							})
						),
						error ? h('p', { style: s.failure }, error) : null,
						h('div', { style: s.row },
							h('button', { type: 'button', style: s.btn, onClick: save, disabled: busy }, t('skSave')),
							h('button', { type: 'button', style: s.btn, onClick: () => { setForm(null); setError(''); }, disabled: busy }, t('skCancel'))
						)
					)
				);
			} else if (detail.status === 'missing') {
				right = h(Missing, { t });
			} else if (detail.status === 'loading') {
				right = h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			} else if (detail.status === 'error') {
				right = h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			} else if (detail.status === 'ready') {
				const raw = String((detail.data && detail.data.content) || '');
				right = h('div', { style: s.pane },
					h('div', { style: s.stack },
						h('div', { style: s.row },
							h('button', { type: 'button', style: s.btn, onClick: startEdit }, t('skEdit')),
							confirming === selected
								? h('div', { style: s.row },
									h('span', { style: s.status }, t('skConfirm')),
									h('button', { type: 'button', style: Object.assign({}, s.btn, s.btnDanger), onClick: remove, disabled: busy }, t('skConfirmYes')),
									h('button', { type: 'button', style: s.btn, onClick: () => setConfirming(''), disabled: busy }, t('skCancel')))
								: h('button', { type: 'button', style: Object.assign({}, s.btn, s.btnDanger), onClick: () => setConfirming(selected) }, t('skDelete'))
						),
						notice ? h('p', { style: s.notice }, notice) : null,
						error ? h('p', { style: s.failure }, error) : null,
						h('pre', { style: s.pre }, raw)
					)
				);
			} else {
				right = h('div', { style: s.pane }, h('p', { style: s.status }, t('pickOne')));
			}

			return h('div', { style: s.stack },
				h('div', { style: s.row },
					h('span', { style: s.status }, t('skillsHint')),
					h('button', { type: 'button', style: s.btn, onClick: startCreate }, t('skNew'))
				),
				h('div', { style: s.split },
					h(List, { t, items, selected: selected, onPick: (k) => onSelect(k), emptyText: t('emptySkills') }),
					right
				)
			);
		}

		// ── 时间线 ─────────────────────────────────────────────────────────

		const TIMELINE_KINDS = ['diary', 'diaryArchive', 'self', 'selfArchive', 'skill', 'wants', 'ledger'];

		function TimelinePanel({ t, events, onGoto }) {
			const [active, setActive] = React.useState(TIMELINE_KINDS);
			const toggle = function (kind) {
				setActive((prev) => prev.includes(kind) ? prev.filter((k) => k !== kind) : prev.concat([kind]));
			};
			const list = arr(events).filter((e) => active.includes(e.kind));
			return h('div', { style: s.stack },
				h('div', { style: s.chips },
					h('span', { style: s.label }, t('tlFilter')),
					TIMELINE_KINDS.map((kind) => h('button', {
						key: kind,
						type: 'button',
						style: active.includes(kind) ? Object.assign({}, s.chip, s.chipOn) : s.chip,
						onClick: () => toggle(kind)
					}, t(KIND_KEY[kind] || 'kDiary')))
				),
				list.length
					? h('div', { style: s.list }, list.map((e, i) => h('button', {
						key: String(e.t) + '-' + i,
						type: 'button',
						style: s.item,
						onClick: () => onGoto(e.ref || {})
					},
						h('div', { style: s.row },
							h('span', { style: s.itemMeta }, fmtTime(e.t)),
							h('span', { style: s.kind }, t(KIND_KEY[e.kind] || 'kDiary')),
							h('span', { style: s.itemName }, String(e.label || ''))
						)
					)))
					: h('div', { style: s.pane }, h('p', { style: s.status }, t('emptyTimeline')))
			);
		}

		// ── 搜索 ───────────────────────────────────────────────────────────

		function SearchPanel({ t, onGoto }) {
			const [q, setQ] = React.useState('');
			const [state, setState] = React.useState({ status: 'idle' });
			const run = function () {
				const query = q.trim();
				if (!query) return;
				setState({ status: 'loading' });
				getJson('/api/ayy-desk/search?q=' + encodeURIComponent(query))
					.then((p) => setState({ status: 'ready', data: p }))
					.catch((err) => setState({ status: isMissingRoute(err) ? 'missing' : 'error' }));
			};
			let results = null;
			if (state.status === 'missing') results = h(Missing, { t });
			else if (state.status === 'loading') results = h('p', { style: s.status }, t('loading'));
			else if (state.status === 'error') results = h(Failure, { t });
			else if (state.status === 'ready') {
				const hits = arr(state.data && state.data.hits);
				results = h('div', { style: s.stack },
					h('p', { style: s.status }, fill(t('searchCount'), { n: hits.length })),
					(state.data && state.data.truncated) ? h('p', { style: s.status }, t('searchTruncated')) : null,
					hits.length
						? h('div', { style: Object.assign({}, s.list, { maxHeight: 'none' }) }, hits.map((hit, i) => h('button', {
							key: 'h' + i,
							type: 'button',
							style: s.item,
							onClick: () => onGoto(hit.ref || {})
						},
							h('div', { style: s.row },
								h('span', { style: s.kind }, t(KIND_KEY[hit.kind] || 'kDiary')),
								h('span', { style: s.itemName }, String(hit.title || '')),
								hit.mtime ? h('span', { style: s.itemMeta }, fmtTime(hit.mtime)) : null
							),
							h('span', { style: s.snippet },
								String((hit.snippet && hit.snippet.before) || ''),
								h('mark', { style: s.mark }, String((hit.snippet && hit.snippet.match) || '')),
								String((hit.snippet && hit.snippet.after) || '')
							)
						)))
						: h('div', { style: s.pane }, h('p', { style: s.status }, t('emptySearch')))
				);
			}
			return h('div', { style: s.stack },
				h('p', { style: s.status }, t('searchHint')),
				h('div', { style: s.row },
					h('input', {
						style: Object.assign({}, s.input, { flex: '1 1 auto' }),
						value: q,
						placeholder: t('searchPlaceholder'),
						onChange: (e) => setQ(e.target.value),
						onKeyDown: (e) => { if (e.key === 'Enter') run(); }
					}),
					h('button', { type: 'button', style: s.btn, onClick: run }, t('searchBtn'))
				),
				results
			);
		}

		// ── 收件箱 ─────────────────────────────────────────────────────────

		function FilesPanel({ t, selected, onSelect }) {
			const [state, setState] = React.useState({ status: 'loading' });
			const [preview, setPreview] = React.useState({ status: 'idle' });
			const [copied, setCopied] = React.useState(false);

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/inbox').then((p) => {
					if (alive) setState({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setState({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, []);

			React.useEffect(() => {
				setCopied(false);
				if (!selected) { setPreview({ status: 'idle' }); return; }
				let alive = true;
				setPreview({ status: 'loading' });
				getJson('/api/ayy-desk/inbox-file?rel=' + encodeURIComponent(selected)).then((p) => {
					if (alive) setPreview({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setPreview({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, [selected]);

			const copy = function (text) {
				try {
					if (navigator.clipboard && navigator.clipboard.writeText) {
						navigator.clipboard.writeText(text);
						setCopied(true);
					}
				} catch (e) { /* ignore */ }
			};

			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'missing') return h(Missing, { t });
			if (state.status === 'error') return h(Failure, { t });

			const groups = arr(state.data && state.data.groups);
			const rows = [];
			for (const g of groups) {
				rows.push(h('p', { key: 'g-' + g.day, style: s.groupTitle }, g.day));
				for (const f of arr(g.items)) {
					rows.push(h('button', {
						key: f.rel,
						type: 'button',
						style: f.rel === selected ? Object.assign({}, s.item, s.itemOn) : s.item,
						onClick: () => onSelect(f.rel)
					},
						h('span', { style: s.itemName }, f.name),
						h('span', { style: s.itemMeta }, `${fmtSize(f.size)} · ${fmtTime(f.mtime)}`)
					));
				}
			}

			let right = null;
			if (preview.status === 'missing') right = h(Missing, { t });
			else if (preview.status === 'loading') right = h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			else if (preview.status === 'error') right = h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			else if (preview.status === 'ready') {
				const d = preview.data || {};
				const head = h('div', { style: s.row },
					h('span', { style: s.itemMeta }, `${fmtSize(d.size)} · ${fmtTime(d.mtime)} · ${d.ext || ''}`)
				);
				let body = null;
				if (d.kind === 'text') {
					body = d.tooLarge
						? h('p', { style: s.status }, fill(t('previewTooLarge'), { path: d.fullPath }))
						: h('pre', { style: s.pre }, String(d.content || ''));
				} else {
					const hint = d.kind === 'pdf' ? t('previewPdf') : d.kind === 'image' ? t('previewImage') : t('previewBinary');
					body = h('div', { style: s.stack },
						h('p', { style: s.status }, hint),
						h('p', { style: s.meta }, String(d.fullPath || '')),
						h('div', { style: s.row },
							h('button', { type: 'button', style: s.btn, onClick: () => copy(String(d.fullPath || '')) }, t('copyPath')),
							copied ? h('span', { style: s.itemMeta }, t('copied')) : null
						)
					);
				}
				right = h('div', { style: s.pane }, h('div', { style: s.stack }, head, body));
			} else {
				right = h('div', { style: s.pane }, h('p', { style: s.status }, t('previewPick')));
			}

			return h('div', { style: s.stack },
				h('p', { style: s.status }, `${t('inboxHint')} ${fill(t('inboxCount'), { n: Number(state.data && state.data.total) || 0 })}`),
				h('div', { style: s.split },
					h('div', { style: s.list }, rows.length ? rows : h('p', { style: Object.assign({ padding: '12px' }, s.status) }, t('emptyFiles'))),
					right
				)
			);
		}

		// ── 原文缓存 ───────────────────────────────────────────────────────

		function TranscriptsPanel({ t, selected, onSelect }) {
			const [state, setState] = React.useState({ status: 'loading' });

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/transcripts').then((p) => {
					if (alive) setState({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setState({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, []);

			const hint = h('p', { style: s.status }, t('trHint'));
			if (state.status === 'loading') return h('div', { style: s.stack }, hint, h('p', { style: s.status }, t('loading')));
			if (state.status === 'missing') return h('div', { style: s.stack }, hint, h(Missing, { t }));
			if (state.status === 'error') return h('div', { style: s.stack }, hint, h(Failure, { t }));

			const items = arr(state.data && state.data.items).map((x) => ({
				key: x.rel,
				label: `${x.name.replace(/\.md$/, '')}`,
				sub: `${x.day} · ${x.scene} · ${fmtSize(x.size)}`
			}));

			return h('div', { style: s.stack },
				hint,
				h('div', { style: s.split },
					h(List, { t, items, selected, onPick: onSelect, emptyText: t('emptyTranscripts') }),
					h(Content, { t, rel: selected, empty: t('pickOne') })
				)
			);
		}

		// ── 归档记忆 ───────────────────────────────────────────────────────

		function MemoryPanel({ t }) {
			const [state, setState] = React.useState({ status: 'loading' });
			const [tag, setTag] = React.useState('');
			const [q, setQ] = React.useState('');
			const [open, setOpen] = React.useState('');
			const [note, setNote] = React.useState({ status: 'idle' });

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/memory?full=1').then((p) => {
					if (alive) setState({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setState({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, []);

			React.useEffect(() => {
				if (!open) { setNote({ status: 'idle' }); return; }
				const contents = (state.data && state.data.contents) || {};
				if (typeof contents[open] === 'string') { setNote({ status: 'ready', content: contents[open] }); return; }
				let alive = true;
				setNote({ status: 'loading' });
				getJson('/api/ayy-desk/memory-note?id=' + encodeURIComponent(open)).then((p) => {
					if (alive) setNote({ status: 'ready', content: String(p.content || '') });
				}).catch((err) => {
					if (alive) setNote({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, [open, state.status]);

			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'missing') return h(Missing, { t });
			if (state.status === 'error') return h(Failure, { t });

			const notes = arr(state.data && state.data.notes);
			const tags = arr(state.data && state.data.tags);
			const contents = (state.data && state.data.contents) || {};
			const needle = q.trim().toLowerCase();

			const filtered = notes.filter((n) => {
				if (tag && !arr(n.tags).includes(tag)) return false;
				if (!needle) return true;
				const hay = [n.title, arr(n.tags).join(' '), String(contents[n.id] || '')].join('\n').toLowerCase();
				return hay.indexOf(needle) >= 0;
			});

			const items = filtered.map((n) => ({
				key: n.id,
				label: n.title,
				sub: `${String(n.updated || n.created || '').slice(0, 10)} · ${arr(n.tags).join(' / ')}`
			}));

			let right = null;
			if (note.status === 'missing') right = h(Missing, { t });
			else if (note.status === 'loading') right = h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			else if (note.status === 'error') right = h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			else if (note.status === 'ready') right = h('div', { style: s.pane }, h('pre', { style: s.pre }, note.content));
			else right = h('div', { style: s.pane }, h('p', { style: s.status }, t('pickOne')));

			return h('div', { style: s.stack },
				h('p', { style: s.status }, t('memHint')),
				h('div', { style: s.row },
					h('input', {
						style: Object.assign({}, s.input, { flex: '1 1 auto' }),
						value: q,
						placeholder: t('memSearch'),
						onChange: (e) => setQ(e.target.value)
					})
				),
				h('div', { style: s.chips },
					h('span', { style: s.label }, t('memTags')),
					h('button', {
						type: 'button',
						style: tag === '' ? Object.assign({}, s.chip, s.chipOn) : s.chip,
						onClick: () => setTag('')
					}, t('memAll')),
					tags.map((tg) => h('button', {
						key: tg,
						type: 'button',
						style: tag === tg ? Object.assign({}, s.chip, s.chipOn) : s.chip,
						onClick: () => setTag(tag === tg ? '' : tg)
					}, tg))
				),
				h('div', { style: s.split },
					h(List, { t, items, selected: open, onPick: setOpen, emptyText: t('emptyMemory') }),
					right
				)
			);
		}

		// ── 存储占用（只读）────────────────────────────────────────────────

		function StoragePanel({ t }) {
			const [state, setState] = React.useState({ status: 'loading' });
			const [nonce, setNonce] = React.useState(0);

			React.useEffect(() => {
				let alive = true;
				setState((prev) => (prev.status === 'ready' ? prev : { status: 'loading' }));
				getJson('/api/ayy-desk/storage').then((p) => {
					if (alive) setState({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setState({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, [nonce]);

			if (state.status === 'loading') {
				return h('div', { style: s.pane }, h('p', { style: s.status }, t('storageScanning')));
			}
			if (state.status === 'missing') return h(Missing, { t });
			if (state.status === 'error') return h(Failure, { t, onRetry: () => setNonce((n) => n + 1) });

			const dirs = arr(state.data && state.data.dirs);
			const disks = arr(state.data && state.data.disks);

			return h('div', { style: s.stack },
				h('div', { style: s.row },
					h('span', { style: s.status }, t('storageHint')),
					h('button', { type: 'button', style: s.btn, onClick: () => setNonce((n) => n + 1) }, t('refresh'))
				),
				h('div', { style: s.pane },
					dirs.map((d) => h('div', { key: d.name, style: s.storageRow },
						h('div', { style: s.row },
							h('span', { style: s.cardTitle }, t(STORAGE_LABEL[d.name] || 'storagePath')),
							h('span', { style: s.itemMeta }, fill(t('storageFiles'), { n: Number(d.files) || 0 }) + ' · ' + fmtSize(d.bytes)),
							d.truncated ? h('span', { style: s.dot }, t('storageTruncated')) : null
						),
						h('p', { style: s.meta }, String(d.path || '')),
						d.isLink ? h('p', { style: s.meta }, fill(t('storageLink'), { real: d.real })) : null,
						h('p', { style: s.itemMeta }, d.exists
							? fill(t('storageLast'), { time: fmtTime(d.latest) || '—' })
							: t('storageMissingDir'))
					))
				),
				disks.length
					? h('div', { style: s.pane },
						h('p', { style: s.itemMeta }, t('storageDisk')),
						disks.map((dk) => h('p', {
							key: dk.root,
							style: s.wantText
						}, fill(t('storageDiskLine'), { root: dk.root, free: fmtSize(dk.free), total: fmtSize(dk.total) })))
					)
					: null
			);
		}

		// ── 主视图 ─────────────────────────────────────────────────────────

		function DeskView({ t: tProp }) {
			const t = tProp || ((k) => k);
			const [tab, setTab] = React.useState('today');
			const [overview, setOverview] = React.useState({ status: 'loading' });
			const [today, setToday] = React.useState({ status: 'loading' });
			const [seen, setSeen] = React.useState(() => loadSeen());
			const [pick, setPick] = React.useState({
				diary: null, oldDiary: null, history: null, skill: null,
				ledgerMonth: null, file: null, transcript: null
			});
			const [nonce, setNonce] = React.useState(0);

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/overview').then((p) => {
					if (alive) setOverview(Object.assign({ status: 'ready' }, p));
				}).catch(() => { if (alive) setOverview({ status: 'error' }); });
				getJson('/api/ayy-desk/today').then((p) => {
					if (alive) setToday({ status: 'ready', data: p });
				}).catch((err) => {
					if (alive) setToday({ status: isMissingRoute(err) ? 'missing' : 'error' });
				});
				return () => { alive = false; };
			}, [nonce]);

			React.useEffect(() => {
				const section = TAB_SECTION[tab];
				if (!section) return;
				setSeen((prev) => {
					const next = Object.assign({}, prev, { [section]: Date.now() });
					saveSeen(next);
					return next;
				});
			}, [tab]);

			const set = (patch) => setPick((p) => Object.assign({}, p, patch));
			const reload = () => setNonce((n) => n + 1);

			const goto = function (ref) {
				if (!ref || typeof ref !== 'object') return;
				if (ref.tab === 'skills') { setTab('skills'); set({ skill: ref.name || null }); }
				else if (ref.tab === 'diary') { setTab('diary'); set({ diary: ref.rel || null }); }
				else if (ref.tab === 'oldDiary') { setTab('oldDiary'); set({ oldDiary: ref.rel || null }); }
				else if (ref.tab === 'self') { setTab('self'); set({ history: ref.rel && ref.rel !== 'who-i-am.md' ? ref.rel : null }); }
				else if (ref.tab === 'wants') setTab('wants');
				else if (ref.tab === 'ledger') { setTab('ledger'); set({ ledgerMonth: ref.rel || null }); }
				else if (ref.tab === 'files') { setTab('files'); set({ file: ref.rel || null }); }
				else if (ref.tab === 'transcripts') { setTab('transcripts'); set({ transcript: ref.rel || null }); }
			};

			const setWantStatus = function (key, status) {
				return postJson('/api/ayy-desk/wants-status', { key, status }).then((res) => {
					setOverview((prev) => {
						if (!prev || prev.status !== 'ready') return prev;
						const wants = Object.assign({}, prev.wants || {}, { items: arr(res.items) });
						return Object.assign({}, prev, { wants });
					});
				});
			};

			const tabs = [
				['today', t('tabToday')], ['diary', t('tabDiary')], ['oldDiary', t('tabOldDiary')],
				['self', t('tabSelf')], ['wants', t('tabWants')], ['ledger', t('tabLedger')],
				['skills', t('tabSkills')], ['timeline', t('tabTimeline')], ['search', t('tabSearch')],
				['files', t('tabFiles')], ['transcripts', t('tabTranscripts')], ['memory', t('tabMemory')],
				['storage', t('tabStorage')]
			];
			const tabBtn = (pair) => h('button', {
				key: pair[0],
				type: 'button',
				style: pair[0] === tab ? Object.assign({}, s.tab, s.tabOn) : s.tab,
				onClick: () => setTab(pair[0])
			}, pair[1]);

			const head = h('div', { style: s.wrap },
				h('p', { style: s.intro }, t('intro')),
				h('div', { style: s.tabs }, tabs.map(tabBtn))
			);

			if (overview.status === 'loading') {
				return h('div', { style: s.wrap }, head, h('p', { style: s.status }, t('loading')));
			}
			if (overview.status === 'error') {
				return h('div', { style: s.wrap }, head, h(Failure, { t, onRetry: reload }));
			}

			// 后端可能是旧版（字段类型不同），一律先归一成数组，别让一个字段把整页打崩
			const diaries = arr(overview.diaries);
			const diaryHistory = arr(overview.diaryHistory);
			const selfInfo = overview.self || {};
			const historyItems = arr(selfInfo.history).map((d) => ({
				key: d.rel, label: d.name.replace(/\.md$/, ''), sub: fmtTime(d.mtime)
			}));
			const diaryItems = diaries.map((d) => {
				const parts = splitName(d.name);
				return {
					key: d.rel,
					label: parts.scene ? parts.day + ' · ' + parts.scene : d.name,
					sub: (Number(d.size) / 1024).toFixed(1) + ' KB',
					dot: Number(d.mtime || 0) > Number(seen.diary || 0)
				};
			});
			const oldItems = diaryHistory.map((d) => ({
				key: d.rel, label: d.name.replace(/\.md$/, ''), sub: (Number(d.size) / 1024).toFixed(1) + ' KB'
			}));

			let body = null;
			if (tab === 'today') {
				body = h(TodayPanel, { t, state: today, seen, onGoto: goto });
			} else if (tab === 'diary') {
				body = h('div', { style: s.split },
					h(List, { t, items: diaryItems, selected: pick.diary, onPick: (k) => set({ diary: k }), emptyText: t('emptyDiary') }),
					h(Content, { t, rel: pick.diary, empty: t('pickOne') }));
			} else if (tab === 'oldDiary') {
				body = h('div', { style: s.split },
					h(List, { t, items: oldItems, selected: pick.oldDiary, onPick: (k) => set({ oldDiary: k }), emptyText: t('emptyOldDiary') }),
					h(Content, { t, rel: pick.oldDiary, empty: t('pickOne') }));
			} else if (tab === 'self') {
				body = h('div', { style: s.split },
					h(List, { t, items: historyItems, selected: pick.history, onPick: (k) => set({ history: k }), emptyText: t('emptyHistory') }),
					pick.history
						? h(Content, { t, rel: pick.history })
						: (selfInfo.exists
							? h(Content, { t, rel: 'who-i-am.md' })
							: h('div', { style: s.pane }, h('p', { style: s.status }, t('emptySelf')))));
			} else if (tab === 'wants') {
				// 旧 host 不返回 wants.items：退回老的"整篇原文"视图，别让它看起来是空的
				const wantItems = arr(overview.wants && overview.wants.items);
				body = (wantItems.length || !(overview.wants && overview.wants.exists))
					? h(WantsPanel, {
						t,
						items: wantItems,
						onSetStatus: setWantStatus,
						selectedRel: 'wants.md'
					})
					: h(Content, { t, rel: 'wants.md', empty: t('emptyWants') });
			} else if (tab === 'ledger') {
				const recent = arr(overview.ledger && overview.ledger.recent);
				const months = arr(overview.ledger && overview.ledger.months);
				const monthItems = months.map((m) => ({ key: m.rel, label: m.name, sub: m.lines + ' 条 · ' + (Number(m.size) / 1024).toFixed(1) + ' KB' }));
				body = h('div', { style: s.split },
					h('div', { style: s.stack },
						h('div', { style: s.pane },
							h('p', { style: s.itemMeta }, t('recentLabel')),
							recent.length
								? h('div', { style: Object.assign({}, s.stack, { gap: '6px', marginTop: '6px' }) },
									recent.map((line, i) => h('div', { key: 'r' + i, style: s.itemName }, line)))
								: h('p', { style: s.status }, t('emptyLedger'))),
						h('p', { style: s.itemMeta }, t('monthsLabel')),
						h(List, { t, items: monthItems, selected: pick.ledgerMonth, onPick: (k) => set({ ledgerMonth: k }), emptyText: t('emptyLedger') })),
					h(Content, { t, rel: pick.ledgerMonth, empty: t('pickMonth') }));
			} else if (tab === 'skills') {
				body = h(SkillsPanel, {
					t,
					skills: arr(overview.skills),
					seen,
					selected: pick.skill,
					onSelect: (name) => set({ skill: name }),
					onChanged: reload
				});
			} else if (tab === 'timeline') {
				body = h(TimelinePanel, { t, events: arr(overview.timeline), onGoto: goto });
			} else if (tab === 'search') {
				body = h(SearchPanel, { t, onGoto: goto });
			} else if (tab === 'files') {
				body = h(FilesPanel, { t, selected: pick.file, onSelect: (rel) => set({ file: rel }) });
			} else if (tab === 'transcripts') {
				body = h(TranscriptsPanel, { t, selected: pick.transcript, onSelect: (rel) => set({ transcript: rel }) });
			} else if (tab === 'memory') {
				body = h(MemoryPanel, { t });
			} else if (tab === 'storage') {
				body = h(StoragePanel, { t });
			}

			return h('div', { style: s.wrap }, head, body,
				h('p', { style: s.meta }, t('dir') + ': ' + (overview.dir || ''))
			);
		}

		const inject = ['slots', 'locale'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-ayy-desk: dictionaries');
			const t = ctx.locale.bind(NS);
			ctx.slots.inject('settings.section', () => ctx.slots.register({
				name: 'settings.section',
				id: 'ayy-desk',
				order: 13,
				label: () => t('nav'),
				locale: NS,
				inject: () => ({})
			}, (props) => h(DeskView, Object.assign({}, props, { t: props && props.t ? props.t : t }))));
		}

		return { inject, apply };
	}
});

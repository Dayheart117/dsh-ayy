window.__ModuleLoader__.load({
	id: 'dsh-ayy-desk',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'ayyDesk';

		const zh = {
			nav: '她',
			intro: '只读。她自己写下的东西都在这里：日记、自我认知、心愿单。这个页面不会改任何文件。',
			tabDiary: '日记',
			tabSelf: '自我认知',
			tabWants: '心愿单',
			loading: '正在读…',
			error: '读不出来了。',
			retry: '重试',
			emptyDiary: '她还没写过日记。',
			emptyHistory: '还没有旧版本。',
			emptySelf: '她还没写过自我认知。',
			emptyWants: '心愿单还是空的。',
			dir: '目录',
			history: '历史版本',
			diaryHistoryNote: '被覆盖的旧日记另有留档，这里不显示。',
			pickOne: '左边选一篇。',
			chars: '字'
		};

		const en = {
			nav: 'Her',
			intro: 'Read-only. Her own writing lives here: diary, self-description, wish list. This page never changes a file.',
			tabDiary: 'Diary',
			tabSelf: 'Self',
			tabWants: 'Wishes',
			loading: 'Reading…',
			error: 'Could not read.',
			retry: 'Retry',
			emptyDiary: 'No diary entries yet.',
			emptyHistory: 'No earlier versions.',
			emptySelf: 'She has not written a self-description yet.',
			emptyWants: 'The wish list is empty.',
			dir: 'Directory',
			history: 'Earlier versions',
			diaryHistoryNote: 'Overwritten diary files are archived elsewhere; not listed here.',
			pickOne: 'Pick one on the left.',
			chars: 'chars'
		};

		const s = {
			wrap: { width: '100%', maxWidth: '980px', display: 'flex', flexDirection: 'column', gap: '14px' },
			intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px', lineHeight: '20px' },
			tabs: { display: 'flex', gap: '6px' },
			tab: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-secondary)', font: 'inherit', fontSize: '13px', borderRadius: '8px', padding: '6px 14px', cursor: 'pointer' },
			tabOn: { background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-border-l3, var(--dsw-alias-border-l2))' },
			split: { display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: '12px', alignItems: 'start' },
			list: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '520px', overflowY: 'auto' },
			item: { textAlign: 'left', width: '100%', border: 0, borderBottom: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: '12.5px', padding: '9px 11px', cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '3px' },
			itemOn: { background: 'var(--dsw-alias-bg-layer-3)' },
			itemName: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
			itemMeta: { color: 'var(--dsw-alias-label-tertiary)', fontSize: '11px' },
			pane: { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '10px', background: 'var(--dsw-alias-bg-layer-3)', padding: '14px 16px', minHeight: '160px' },
			pre: { margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '13px', lineHeight: '1.7', color: 'var(--dsw-alias-label-primary)', fontFamily: 'inherit' },
			status: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' },
			failure: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
			btn: { border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', background: 'transparent', borderRadius: '6px', padding: '4px 10px' },
			h3: { margin: '0 0 8px', fontSize: '13px', fontWeight: 600 },
			meta: { margin: '0 0 8px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '11.5px', wordBreak: 'break-all' }
		};

		const getJson = (url) => fetch(url).then((r) => r.json());

		/** 日记文件名是 <日期>.<场景>.md */
		function splitName(name) {
			const base = String(name || '').replace(/\.md$/, '');
			const dot = base.indexOf('.');
			if (dot < 0) return { day: base, scene: '' };
			return { day: base.slice(0, dot), scene: base.slice(dot + 1).replace(/_/g, ':') };
		}

		function FilePane({ t, rel, empty }) {
			const [state, setState] = React.useState({ status: rel ? 'loading' : 'idle' });
			React.useEffect(() => {
				if (!rel) {
					setState({ status: 'idle' });
					return;
				}
				let alive = true;
				setState({ status: 'loading' });
				getJson('/api/ayy-desk/file?rel=' + encodeURIComponent(rel)).then((p) => {
					if (!alive) return;
					if (p && p.ok === true) setState({ status: 'ready', content: String(p.content || '') });
					else setState({ status: 'error' });
				}).catch(() => { if (alive) setState({ status: 'error' }); });
				return () => { alive = false; };
			}, [rel]);

			if (state.status === 'idle') return h('div', { style: s.pane }, h('p', { style: s.status }, empty || t('pickOne')));
			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'error') return h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			return h('div', { style: s.pane }, h('pre', { style: s.pre }, state.content));
		}

		function List({ items, selected, onPick, t, labelKey }) {
			if (!items.length) return h('div', { style: s.list }, h('p', { style: Object.assign({ padding: '12px' }, s.status) }, t(labelKey)));
			return h('div', { style: s.list }, items.map((it) => {
				const on = it.rel === selected;
				const parts = splitName(it.name);
				return h('button', {
					key: it.rel,
					type: 'button',
					style: on ? Object.assign({}, s.item, s.itemOn) : s.item,
					onClick: () => onPick(it.rel)
				},
					h('span', { style: s.itemName }, parts.scene ? parts.day + ' · ' + parts.scene : it.name),
					h('span', { style: s.itemMeta }, (it.size / 1024).toFixed(1) + ' KB')
				);
			}));
		}

		function DeskView({ t: tProp }) {
			const t = tProp || ((k) => k);
			const [tab, setTab] = React.useState('diary');
			const [overview, setOverview] = React.useState({ status: 'loading' });
			const [pick, setPick] = React.useState({ diary: null, self: null, history: null });

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/overview').then((p) => {
					if (!alive) return;
					if (p && p.ok === true) setOverview(Object.assign({ status: 'ready' }, p));
					else setOverview({ status: 'error' });
				}).catch(() => { if (alive) setOverview({ status: 'error' }); });
				return () => { alive = false; };
			}, []);

			const tabBtn = (key, label) => h('button', {
				type: 'button',
				style: key === tab ? Object.assign({}, s.tab, s.tabOn) : s.tab,
				onClick: () => setTab(key)
			}, label);

			const head = h('div', { style: s.wrap },
				h('p', { style: s.intro }, t('intro')),
				h('div', { style: s.tabs }, tabBtn('diary', t('tabDiary')), tabBtn('self', t('tabSelf')), tabBtn('wants', t('tabWants')))
			);

			if (overview.status === 'loading') return h('div', { style: s.wrap }, head, h('p', { style: s.status }, t('loading')));
			if (overview.status === 'error') {
				return h('div', { style: s.wrap }, head,
					h('div', { style: s.failure }, h('p', { role: 'alert', style: { margin: 0 } }, t('error')),
						h('button', { type: 'button', style: s.btn, onClick: () => location.reload() }, t('retry'))));
			}

			let body = null;
			if (tab === 'diary') {
				body = h('div', { style: s.split },
					h(List, { items: overview.diaries || [], selected: pick.diary, onPick: (rel) => setPick((p) => Object.assign({}, p, { diary: rel })), t, labelKey: 'emptyDiary' }),
					h(FilePane, { t, rel: pick.diary, empty: t('pickOne') })
				);
			} else if (tab === 'self') {
				body = h('div', { style: s.split },
					h(List, { items: overview.self && overview.self.history ? overview.self.history : [], selected: pick.history, onPick: (rel) => setPick((p) => Object.assign({}, p, { history: rel })), t, labelKey: 'emptyHistory' }),
					h('div', { style: s.pane },
						pick.history ? h(FilePane, { t, rel: pick.history }) :
							(overview.self && overview.self.exists
								? h(FilePane, { t, rel: 'who-i-am.md' })
								: h('p', { style: s.status }, t('emptySelf')))
					)
				);
			} else {
				body = h('div', { style: s.pane },
					overview.wants && overview.wants.exists
						? h(FilePane, { t, rel: 'wants.md' })
						: h('p', { style: s.status }, t('emptyWants'))
				);
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

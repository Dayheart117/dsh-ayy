window.__ModuleLoader__.load({
	id: 'dsh-ayy-desk',
	factory(require) {
		const React = require('react');
		const h = React.createElement;

		const NS = 'ayyDesk';

		const zh = {
			nav: '她的本子',
			intro: '只读。她自己写下的东西都在这里：日记、旧日记、自我认知、心愿单、技能，还有一条时间线。这个页面不改任何文件。',
			tabDiary: '日记',
			tabOldDiary: '旧日记',
			tabSelf: '自我认知',
			tabWants: '心愿单',
			tabSkills: '技能',
			tabTimeline: '时间线',
			loading: '正在读…',
			error: '读不出来了。',
			retry: '重试',
			emptyDiary: '她还没写过日记。',
			emptyOldDiary: '还没有被覆盖的旧日记。',
			emptyHistory: '还没有旧版本。',
			emptySelf: '她还没写过自我认知。',
			emptyWants: '心愿单还是空的。',
			emptySkills: '她还没写过技能。',
			emptyTimeline: '还没有任何记录。',
			dir: '目录',
			pickOne: '左边选一篇。',
			kDiary: '日记',
			kDiaryArchive: '旧日记',
			kSkill: '技能',
			kSelf: '自我认知',
			kSelfArchive: '旧自述',
			kWants: '心愿单'
		};

		const en = {
			nav: 'Her notebook',
			intro: 'Read-only. Everything she writes is here: diary, older diary versions, self-description, wish list, skills and a timeline. This page never changes a file.',
			tabDiary: 'Diary',
			tabOldDiary: 'Older diary',
			tabSelf: 'Self',
			tabWants: 'Wishes',
			tabSkills: 'Skills',
			tabTimeline: 'Timeline',
			loading: 'Reading…',
			error: 'Could not read.',
			retry: 'Retry',
			emptyDiary: 'No diary entries yet.',
			emptyOldDiary: 'No overwritten diary files.',
			emptyHistory: 'No earlier versions.',
			emptySelf: 'No self-description yet.',
			emptyWants: 'The wish list is empty.',
			emptySkills: 'No skills written yet.',
			emptyTimeline: 'Nothing recorded yet.',
			dir: 'Directory',
			pickOne: 'Pick one on the left.',
			kDiary: 'Diary',
			kDiaryArchive: 'Older diary',
			kSkill: 'Skill',
			kSelf: 'Self',
			kSelfArchive: 'Older self',
			kWants: 'Wishes'
		};

		const s = {
			wrap: { width: '100%', maxWidth: '1040px', display: 'flex', flexDirection: 'column', gap: '14px' },
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
			status: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '13px' },
			failure: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--dsw-alias-state-error-primary)', fontSize: '13px' },
			btn: { border: '1px solid var(--dsw-alias-border-l2)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', cursor: 'pointer', background: 'transparent', borderRadius: '6px', padding: '4px 10px' },
			meta: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '11.5px', wordBreak: 'break-all' },
			kind: { flex: 'none', fontSize: '11px', padding: '0 6px', borderRadius: '999px', background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-secondary)' },
			row: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }
		};

		const getJson = (url) => fetch(url).then((r) => r.json());

		function splitName(name) {
			const base = String(name || '').replace(/\.md$/, '');
			const dot = base.indexOf('.');
			if (dot < 0) return { day: base, scene: '' };
			return { day: base.slice(0, dot), scene: base.slice(dot + 1).replace(/_/g, ':') };
		}

		function fmtTime(ms) {
			const d = new Date(Number(ms));
			const p = (n) => String(n).padStart(2, '0');
			return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
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
					if (p && p.ok === true) setState({ status: 'ready', content: String(p.content || '') });
					else setState({ status: 'error' });
				}).catch(() => { if (alive) setState({ status: 'error' }); });
				return () => { alive = false; };
			}, [rel, skillName]);

			if (state.status === 'idle') return h('div', { style: s.pane }, h('p', { style: s.status }, empty || t('pickOne')));
			if (state.status === 'loading') return h('div', { style: s.pane }, h('p', { style: s.status }, t('loading')));
			if (state.status === 'error') return h('div', { style: s.pane }, h('p', { style: s.failure }, t('error')));
			return h('div', { style: s.pane }, h('pre', { style: s.pre }, state.content));
		}

		function List({ items, selected, onPick, emptyText }) {
			if (!items.length) return h('div', { style: s.list }, h('p', { style: Object.assign({ padding: '12px' }, s.status) }, emptyText));
			return h('div', { style: s.list }, items.map((it) => {
				const on = it.key === selected;
				return h('button', {
					key: it.key,
					type: 'button',
					style: on ? Object.assign({}, s.item, s.itemOn) : s.item,
					onClick: () => onPick(it.key)
				},
					h('span', { style: s.itemName }, it.label),
					it.sub ? h('span', { style: s.itemMeta }, it.sub) : null
				);
			}));
		}

		function DeskView({ t: tProp }) {
			const t = tProp || ((k) => k);
			const [tab, setTab] = React.useState('diary');
			const [overview, setOverview] = React.useState({ status: 'loading' });
			const [pick, setPick] = React.useState({ diary: null, oldDiary: null, history: null, skill: null });

			React.useEffect(() => {
				let alive = true;
				getJson('/api/ayy-desk/overview').then((p) => {
					if (!alive) return;
					if (p && p.ok === true) setOverview(Object.assign({ status: 'ready' }, p));
					else setOverview({ status: 'error' });
				}).catch(() => { if (alive) setOverview({ status: 'error' }); });
				return () => { alive = false; };
			}, []);

			const set = (patch) => setPick((p) => Object.assign({}, p, patch));

			const tabs = [
				['diary', t('tabDiary')], ['oldDiary', t('tabOldDiary')], ['self', t('tabSelf')],
				['wants', t('tabWants')], ['skills', t('tabSkills')], ['timeline', t('tabTimeline')]
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

			if (overview.status === 'loading') return h('div', { style: s.wrap }, head, h('p', { style: s.status }, t('loading')));
			if (overview.status === 'error') {
				return h('div', { style: s.wrap }, head,
					h('div', { style: s.failure }, h('p', { role: 'alert', style: { margin: 0 } }, t('error')),
						h('button', { type: 'button', style: s.btn, onClick: () => location.reload() }, t('retry'))));
			}

			const diaryItems = (overview.diaries || []).map((d) => {
				const parts = splitName(d.name);
				return { key: d.rel, label: parts.scene ? parts.day + ' · ' + parts.scene : d.name, sub: (d.size / 1024).toFixed(1) + ' KB' };
			});
			const oldItems = (overview.diaryHistory || []).map((d) => ({
				key: d.rel, label: d.name.replace(/\.md$/, ''), sub: (d.size / 1024).toFixed(1) + ' KB'
			}));
			const historyItems = ((overview.self && overview.self.history) || []).map((d) => ({
				key: d.rel, label: d.name.replace(/\.md$/, ''), sub: fmtTime(d.mtime)
			}));
			const skillItems = (overview.skills || []).map((k) => ({
				key: k.name, label: k.name, sub: k.description || ''
			}));

			let body = null;
			if (tab === 'diary') {
				body = h('div', { style: s.split },
					h(List, { items: diaryItems, selected: pick.diary, onPick: (k) => set({ diary: k }), emptyText: t('emptyDiary') }),
					h(Content, { t, rel: pick.diary, empty: t('pickOne') }));
			} else if (tab === 'oldDiary') {
				body = h('div', { style: s.split },
					h(List, { items: oldItems, selected: pick.oldDiary, onPick: (k) => set({ oldDiary: k }), emptyText: t('emptyOldDiary') }),
					h(Content, { t, rel: pick.oldDiary, empty: t('pickOne') }));
			} else if (tab === 'self') {
				body = h('div', { style: s.split },
					h(List, { items: historyItems, selected: pick.history, onPick: (k) => set({ history: k }), emptyText: t('emptyHistory') }),
					pick.history
						? h(Content, { t, rel: pick.history })
						: (overview.self && overview.self.exists
							? h(Content, { t, rel: 'who-i-am.md' })
							: h('div', { style: s.pane }, h('p', { style: s.status }, t('emptySelf')))));
			} else if (tab === 'wants') {
				body = h('div', { style: s.pane },
					overview.wants && overview.wants.exists
						? h(Content, { t, rel: 'wants.md' })
						: h('p', { style: s.status }, t('emptyWants')));
			} else if (tab === 'skills') {
				body = h('div', { style: s.split },
					h(List, { items: skillItems, selected: pick.skill, onPick: (k) => set({ skill: k }), emptyText: t('emptySkills') }),
					h(Content, { t, skillName: pick.skill, empty: t('pickOne') }));
			} else {
				const events = overview.timeline || [];
				if (!events.length) {
					body = h('div', { style: s.pane }, h('p', { style: s.status }, t('emptyTimeline')));
				} else {
					const kindMap = {
						diary: 'kDiary', diaryArchive: 'kDiaryArchive', skill: 'kSkill',
						self: 'kSelf', selfArchive: 'kSelfArchive', wants: 'kWants'
					};
					body = h('div', { style: s.list }, events.map((e, i) => h('button', {
						key: String(e.t) + '-' + i,
						type: 'button',
						style: s.item,
						onClick: () => {
							const ref = e.ref || {};
							if (ref.tab === 'skills') { setTab('skills'); set({ skill: ref.name }); }
							else if (ref.tab === 'diary') { setTab('diary'); set({ diary: ref.rel }); }
							else if (ref.tab === 'oldDiary') { setTab('oldDiary'); set({ oldDiary: ref.rel }); }
							else if (ref.tab === 'self') { setTab('self'); set({ history: ref.rel && ref.rel !== 'who-i-am.md' ? ref.rel : null }); }
							else if (ref.tab === 'wants') { setTab('wants'); }
						}
					},
						h('div', { style: s.row },
							h('span', { style: s.itemMeta }, fmtTime(e.t)),
							h('span', { style: s.kind }, t(kindMap[e.kind] || 'kDiary')),
							h('span', { style: s.itemName }, e.label)
						)
					)));
				}
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

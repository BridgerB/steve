<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { onMount } from 'svelte';
	import { STEPS, GOAL, IRON } from '$lib/steps';
	import BotWindow from '$lib/BotWindow.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Live state streamed straight from the in-process bot (via BotWindow's viewer
	// SSE) — vitals, inventory, and run status update ~2×/s with no DB round-trip.
	type LiveState = {
		health: number | null;
		food: number | null;
		x: number;
		y: number;
		z: number;
		yaw: number;
		time: number;
		held: string | null;
		window: { kind: string; n: number; slots: { s: number; n: string; c: number }[]; open?: boolean; sel?: number } | null;
		steve: { step: number; done: number[]; phase: string; progress: number } | null;
	};
	let live = $state<LiveState | null>(null);
	let liveYaw = $state(0);

	const race = $derived(data.race);
	// Merge the live stream over the server snapshot: fast-changing fields come live;
	// historical bits (split times, event log) still come from the snapshot.
	const bot = $derived.by(() => {
		const s = race.bots[0];
		if (!s || !live) return s;
		return {
			...s,
			current: live.steve?.step ?? s.current,
			done: live.steve?.done ?? s.done,
			inv: live.window ? live.window.slots.map((sl) => ({ name: sl.n, count: sl.c })) : s.inv,
			health: live.health != null ? String(Math.round(live.health)) : s.health,
			x: live.x != null ? live.x.toFixed(1) : s.x,
			y: live.y != null ? live.y.toFixed(1) : s.y,
			z: live.z != null ? live.z.toFixed(1) : s.z
		};
	});

	const pad2 = (n: number) => String(n).padStart(2, '0');

	const furthest = $derived(bot && bot.done.length ? Math.max(...bot.done) : -1);
	const goalHit = $derived(furthest >= GOAL);
	const currentStep = $derived(
		bot && bot.current >= 0 && bot.current < STEPS.length ? STEPS[bot.current] : ''
	);

	const phase = $derived(
		goalHit
			? { name: 'NETHER', color: '#ff7043' }
			: furthest >= 16
				? { name: 'PORTAL', color: '#ce93d8' }
				: furthest >= IRON
					? { name: 'IRON', color: '#90caf9' }
					: furthest >= 5
						? { name: 'STONE', color: '#cfd8dc' }
						: furthest >= 0
							? { name: 'WOOD', color: '#a5d6a7' }
							: { name: 'START', color: '#9e9e9e' }
	);

	function fmt(s: number): string {
		if (s < 0) s = 0;
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		return `${m}:${String(s % 60).padStart(2, '0')}`;
	}

	type StepState = { state: 'done' | 'doing' | 'todo'; time: string };
	function stepInfo(i: number): StepState {
		if (!bot) return { state: 'todo', time: '' };
		if (i === bot.current) return { state: 'doing', time: '' };
		const done = i <= furthest || bot.done.includes(i);
		if (done) {
			const at = bot.doneAt[i];
			const time =
				at != null && race.raceStartMs != null ? fmt(Math.round((at - race.raceStartMs) / 1000)) : '';
			return { state: 'done', time };
		}
		return { state: 'todo', time: '' };
	}

	// Per-step sub-tasks, driven by the bot's logged events.
	type Sub = { label: string; evs: string[]; showBand?: boolean };
	const STONE_SUBS: Sub[] = [
		{ label: 'Find stone', evs: ['exploring', 'from_memory', 'direction'] },
		{ label: 'Mine it', evs: ['mined', 'mine_in_place'] }
	];
	const DEEP_SUBS: Sub[] = [
		{ label: 'Dig toward the band', evs: ['descended', 'staircase', 'staircase_dir', 'direction'], showBand: true },
		{ label: 'Search the walls', evs: ['exploring', 'ore'] },
		{ label: 'Mine the block', evs: ['mined', 'mine_in_place'] }
	];
	const SUBSTEPS: Record<number, { cat: string; subs: Sub[]; band?: number }> = {
		0: {
			cat: 'wood',
			subs: [
				{ label: 'Find a tree', evs: ['start', 'log_ids', 'explore'] },
				{ label: 'Walk to it', evs: ['nav_start'] },
				{ label: 'Mine the log', evs: ['dig_start', 'dig_done', 'dig_error'] },
				{ label: 'Collect the drop', evs: ['pickup_ok'] }
			]
		},
		5: { cat: 'mine:stone', subs: STONE_SUBS },
		9: { cat: 'mine:coal_ore', subs: DEEP_SUBS, band: 50 },
		10: { cat: 'mine:iron_ore', subs: DEEP_SUBS, band: 14 }
	};

	const evMap = (cat: string): Record<string, number> => bot?.ev?.[cat] ?? {};
	function latestEv(map: Record<string, number>): string | null {
		let best: string | null = null;
		let bestMs = -1;
		for (const [k, v] of Object.entries(map)) {
			if (v > bestMs) {
				bestMs = v;
				best = k;
			}
		}
		return best;
	}
	function subActive(subs: Sub[], map: Record<string, number>): number {
		const latest = latestEv(map);
		if (!latest) return 0;
		if (latest === 'done') return subs.length;
		const i = subs.findIndex((s) => s.evs.includes(latest));
		return i < 0 ? 0 : i;
	}
	function subState(si: number, stepState: 'done' | 'doing' | 'todo', subs: Sub[], map: Record<string, number>): string {
		if (stepState === 'done') return 'done';
		if (stepState !== 'doing') return 'todo';
		const active = subActive(subs, map);
		if (si < active) return 'done';
		if (si === active) return 'doing';
		return 'todo';
	}

	function healthColor(h: string | undefined): string {
		const n = Number(h);
		if (Number.isNaN(n)) return '#888';
		return n > 12 ? '#4cc38a' : n > 6 ? '#e8a13c' : '#f0584f';
	}

	// ── Hotbar overlay (the 9 hotbar slots = inventory indices 36-44) ──
	function itemColor(name: string): string {
		const n = name;
		if (n.includes('coal') || n.includes('obsidian') || n.includes('basalt')) return '#1c1c1c';
		if (n.includes('diamond')) return '#4fd6c8';
		if (n.includes('netherite')) return '#4a4248';
		if (n.includes('iron')) return '#d8d2c8';
		if (n.includes('gold')) return '#e6c34d';
		if (n.includes('redstone')) return '#c0392b';
		if (n.includes('lapis')) return '#2c5fb0';
		if (n.includes('emerald')) return '#2ecc71';
		if (n.includes('plank')) return '#c0894e';
		if (n.includes('crafting_table')) return '#7a5a36';
		if (n.includes('log') || n.includes('wood') || n.includes('stick') || n.includes('stem')) return '#6b4f2a';
		if (n.includes('torch') || n.includes('lava') || n.includes('flame') || n.includes('fire')) return '#d98a2b';
		if (n.includes('water') || n.includes('bucket')) return '#3b6fb0';
		if (n.includes('blaze')) return '#e8a13c';
		if (n.includes('ender') || n.includes('eye') || n.includes('pearl')) return '#1f6b5a';
		if (n.includes('flint')) return '#3a3a3a';
		if (n.includes('dirt') || n.includes('grass') || n.includes('gravel') || n.includes('sand')) return '#7a5a39';
		if (n.includes('furnace')) return '#585858';
		if (
			n.includes('cobble') || n.includes('stone') || n.includes('deepslate') ||
			n.includes('pickaxe') || n.includes('sword') || n.includes('axe') || n.includes('shovel') ||
			n.includes('andesite') || n.includes('granite') || n.includes('diorite') || n.includes('tuff')
		)
			return '#8a8a8a';
		let h = 0;
		for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) & 0xffffff;
		return `hsl(${h % 360}, 28%, 46%)`;
	}
	const hotbar = $derived.by(() => {
		const slots = live?.window?.slots ?? [];
		const sel = live?.window?.sel ?? 0;
		const bySlot = new Map(slots.map((sl) => [sl.s, sl]));
		return Array.from({ length: 9 }, (_, k) => {
			const sl = bySlot.get(k + 36);
			return { empty: !sl, color: sl ? itemColor(sl.n) : '', count: sl?.c ?? 0, sel: k === sel };
		});
	});
	const heldLabel = $derived((live?.held ?? '').replace(/_/g, ' ').toUpperCase());

	// ── Top monologue strip: compact tail of the event log ──
	const logTail = $derived.by(() => {
		const lines = (race.log ?? []).slice(-7);
		return lines.map((l, i) => {
			const d = l.detail ? ' ' + (l.detail.length > 26 ? l.detail.slice(0, 26) + '…' : l.detail) : '';
			return { text: `${l.event}${d}`, last: i === lines.length - 1 };
		});
	});

	// ── Status pill / dot in the top strip ──
	const status = $derived.by(() => {
		if (!bot) return { dot: 'dot-amber', text: 'CONNECTING' };
		if (bot.dead) return { dot: 'dot-red', text: 'OFFLINE' };
		if (bot.inWater) return { dot: 'dot-blue', text: 'OVERRIDE' };
		if (bot.stepReturning) return { dot: 'dot-amber', text: 'RETRY' };
		if (goalHit) return { dot: 'dot-orange', text: 'NETHER' };
		return { dot: 'dot-green', text: phase.name };
	});

	const seaNote = $derived.by(() => {
		const y = bot ? Math.round(Number(bot.y)) : 63;
		const d = 63 - y;
		if (d > 1) return `${d} below sea level`;
		if (d < -1) return `${-d} above sea level`;
		return 'at sea level';
	});

	function logCls(line: { category: string; event: string }): string {
		const c = line.category;
		const e = line.event;
		if (c === 'override') return 'water';
		if (c === 'death' || c === 'error' || e === 'abort' || e.includes('fail') || e.includes('error')) return 'err';
		if (c === 'safety' || c === 'threat' || e.includes('drown') || e.includes('water')) return 'warn';
		if (c === 'step' && e === 'success') return 'ok';
		return '';
	}

	let elapsed = $state('—');
	let stepRoundStr = $state('');
	let stepTotalStr = $state('');
	onMount(() => {
		const pad = (n: number) => String(n).padStart(2, '0');
		const upd = () => {
			const start = race.raceStartMs;
			if (start == null) {
				elapsed = '—';
			} else {
				let s = Math.floor((Date.now() - start) / 1000);
				if (s < 0) s = 0;
				const h = Math.floor(s / 3600);
				const m = Math.floor((s % 3600) / 60);
				elapsed = `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
			}
			const rs = bot?.stepRoundStartMs;
			if (rs == null) {
				stepRoundStr = '';
				stepTotalStr = '';
			} else {
				const round = Math.max(0, Math.floor((Date.now() - rs) / 1000));
				stepRoundStr = fmt(round);
				stepTotalStr = fmt(Math.max(0, Math.floor(((bot?.stepPriorMs ?? 0) + (Date.now() - rs)) / 1000)));
			}
		};
		upd();
		const tElapsed = setInterval(upd, 1000);
		const tPoll = setInterval(() => invalidateAll(), 5000);
		return () => {
			clearInterval(tElapsed);
			clearInterval(tPoll);
		};
	});
</script>

<svelte:head><title>Steve · {bot?.id ?? 'run'}</title></svelte:head>

{#if race.error}
	<p class="boot err">⚠ {race.error}</p>
{:else if !bot}
	<p class="boot">Waiting for the bot to join the world…</p>
{:else}
	<div class="dash">
		<!-- TOP LOG STRIP -->
		<div class="logbar">
			<div class="id">
				<span class="dot {status.dot}"></span>
				<span class="name">{bot.id}</span>
				<span class="badge">{status.text}</span>
			</div>
			<div class="vsep"></div>
			<div class="log">
				<span class="log-lead">monologue</span>
				{#each logTail as ln}
					<span class="log-sep">›</span>
					<span class={ln.last ? 'log-now' : 'log-old'}>{ln.text}</span>
				{/each}
				<span class="caret-amber">▌</span>
			</div>
			<div class="elapsed"><span class="muted">elapsed</span>{elapsed}</div>
		</div>

		<!-- BODY -->
		<div class="body">
			<!-- LEFT RAIL : VITALS -->
			<div class="rail">
				<div class="avatar-row">
					<div class="avatar">{bot.id.slice(0, 1).toUpperCase()}</div>
					<div class="avatar-meta">
						<span class="avatar-name">{bot.id}</span>
						<span class="avatar-sub">autonomous agent · {race.raceId.slice(0, 19)}</span>
					</div>
				</div>

				<div class="hp">
					<div class="row-between">
						<span class="lbl">HEALTH</span>
						<span class="hp-val" style:color={healthColor(bot.health)}>{bot.health}<span class="dim">/20</span></span>
					</div>
					<div class="bar">
						<div class="bar-fill" style:width={`${(Number(bot.health) / 20) * 100}%`} style:background={healthColor(bot.health)}></div>
					</div>
				</div>

				<div class="stat-grid">
					<div class="stat">
						<div class="lbl">DEATHS</div>
						<div class="stat-big" class:green={(bot.deaths ?? 0) === 0} class:bad={(bot.deaths ?? 0) > 0}>{bot.deaths ?? 0}</div>
					</div>
					<div class="stat">
						<div class="lbl">DEPTH</div>
						<div class="stat-big">y{Math.round(Number(bot.y))}</div>
					</div>
					<div class="stat span2">
						<div class="row-between">
							<span class="lbl">POSITION</span>
							<span class="note">{seaNote}{#if bot.dim?.includes('nether')} · nether 🔥{/if}</span>
						</div>
						<div class="pos">
							<span><span class="axis">x</span> {bot.x}</span>
							<span><span class="axis">y</span> {bot.y}</span>
							<span><span class="axis">z</span> {bot.z}</span>
						</div>
					</div>
				</div>

				<div class="hr"></div>

				<div class="progress">
					<div class="row-between">
						<span class="lbl">SPEEDRUN PROGRESS</span>
						<span class="prog-val">{furthest + 1}<span class="dim">/{STEPS.length}</span></span>
					</div>
					<div class="bar bar-tall">
						<div class="bar-fill" style:width={`${((furthest + 1) / STEPS.length) * 100}%`} style:background={phase.color}></div>
					</div>
					<span class="prog-note" style:color={phase.color}>step {bot.current + 1} · {currentStep || '—'}</span>
				</div>

				{#if bot.inWater}
					<div class="override">
						<span class="dot dot-blue"></span>
						<div>
							<div class="ov-title">OVERRIDE ACTIVE</div>
							<div class="ov-body">Getting out of water — all steps paused until on dry land.</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- CENTER : VIEWPORT (real first-person feed) -->
			<div class="viewport">
				<BotWindow
					index={0}
					name={bot.id}
					step={currentStep}
					onState={(s) => (live = s)}
					onPose={(p) => (liveYaw = p.yaw)}
					w="100%"
					h="100%"
				/>

				<div class="vp-badge vp-badge-left">
					<span class="dot dot-red sm"></span>
					<span>LIVE · 1st-person</span>
				</div>
				<div class="vp-badge vp-badge-right">{bot.x} / {bot.y} / {bot.z}</div>

				<div class="action-chip">
					<span class="action-lbl">▸ ACTION</span>
					<span class="action-txt">{currentStep || 'idle'}{#if stepRoundStr} · {stepRoundStr} on this attempt{/if}</span>
				</div>

				{#if heldLabel}
					<div class="hotbar-wrap">
						<span class="hotbar-tip">{heldLabel}</span>
						<div class="hotbar">
							{#each hotbar as slot}
								{#if slot.empty}
									<div class="slot slot-empty"></div>
								{:else}
									<div class="slot" class:slot-sel={slot.sel}>
										<div class="cube" style:background={slot.color}></div>
										{#if slot.count > 0}<span class="cube-n">{slot.count}</span>{/if}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- RIGHT RAIL : SPEEDRUN LADDER -->
			<div class="ladder">
				<div class="ladder-head">
					<span class="ladder-title">SPEEDRUN LADDER</span>
					<span class="ladder-count">{furthest + 1} / {STEPS.length}</span>
				</div>
				<div class="ladder-list">
					{#each STEPS as name, i (name)}
						{@const s = stepInfo(i)}
						{#if s.state === 'done'}
							<div class="step done" class:milestone={i === GOAL || i === IRON}>
								<span class="check">✓</span>
								<span class="step-n">{pad2(i + 1)}</span>
								<span class="step-name">{name}</span>
								{#if s.time}<span class="step-t">{s.time}</span>{/if}
							</div>
						{:else if s.state === 'doing'}
							<div class="step-active">
								<div class="row-between">
									<div class="sa-head">
										<span class="sa-arrow">▸</span>
										<span class="sa-n">{pad2(i + 1)}</span>
										<span class="sa-name">{name}</span>
									</div>
									{#if bot.inWater}
										<span class="sa-stall blue">OVERRIDE</span>
									{:else if bot.stepReturning}
										<span class="sa-stall">↻ RETRY</span>
									{/if}
								</div>
								<div class="sa-timers">
									<span class="t-amber"><span class="t-lbl">this attempt</span> {stepRoundStr || '0s'}</span>
									{#if bot.stepReturning}<span class="t-dim"><span class="t-lbl2">total</span> {stepTotalStr}</span>{/if}
								</div>
								{#if SUBSTEPS[i]}
									{@const cfg = SUBSTEPS[i]}
									{@const map = evMap(cfg.cat)}
									<div class="sa-subs">
										{#each cfg.subs as sub, si (sub.label)}
											{@const ss = subState(si, s.state, cfg.subs, map)}
											<div class="sub sub-{ss}">
												<span class="sub-i">{ss === 'done' ? '✓' : ss === 'doing' ? '◉' : '○'}</span>
												<span>{sub.label}</span>
												{#if sub.showBand && cfg.band != null}
													<span class="sub-band">y{cfg.band - 6}–{cfg.band + 6}</span>
												{/if}
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<div class="step todo" class:milestone={i === GOAL || i === IRON}>
								<span class="box"></span>
								<span class="step-n dim3">{pad2(i + 1)}</span>
								<span class="step-name todo-name">{name}</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #0e1116;
		color: #c9d1d9;
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
	}
	.boot {
		color: #8b949e;
		font: 400 14px 'IBM Plex Mono', monospace;
		padding: 40px;
	}
	.boot.err {
		color: #f0584f;
	}

	.dash {
		width: 100vw;
		height: 100vh;
		background: #0e1116;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		color: #c9d1d9;
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
	}

	/* ---- top log strip ---- */
	.logbar {
		height: 48px;
		flex: none;
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 0 16px;
		background: #11161d;
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);
	}
	.id { display: flex; align-items: center; gap: 9px; flex: none; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
	.dot.sm { width: 7px; height: 7px; }
	.dot-red { background: #f0584f; box-shadow: 0 0 9px #f0584f; animation: pulse 1.6s ease-in-out infinite; }
	.dot-blue { background: #5b9bd6; box-shadow: 0 0 8px #5b9bd6; animation: pulse 1.6s ease-in-out infinite; }
	.dot-amber { background: #e8a13c; box-shadow: 0 0 8px #e8a13c; animation: pulse 1.6s ease-in-out infinite; }
	.dot-orange { background: #ff7043; box-shadow: 0 0 9px #ff7043; animation: pulse 1.6s ease-in-out infinite; }
	.dot-green { background: #4cc38a; box-shadow: 0 0 8px #4cc38a; }
	.name { font: 600 13px 'IBM Plex Mono', monospace; letter-spacing: 0.4px; color: #e6edf3; }
	.badge { font: 600 9px 'IBM Plex Mono', monospace; letter-spacing: 1.2px; padding: 2px 6px; border-radius: 3px; color: #8b949e; border: 1px solid rgba(255, 255, 255, 0.18); }
	.vsep { width: 1px; height: 22px; background: rgba(255, 255, 255, 0.1); flex: none; }
	.log { flex: 1; min-width: 0; overflow: hidden; display: flex; align-items: center; gap: 9px; font: 400 12.5px 'IBM Plex Mono', monospace; white-space: nowrap; }
	.log span { flex: none; }
	.log-lead { color: #586069; }
	.log-sep { color: #39414a; }
	.log-now { color: #e8a13c; }
	.log-old { color: #6e7681; }
	.caret-amber { color: #e8a13c; animation: blink 1.1s steps(1) infinite; }
	.elapsed { flex: none; display: flex; align-items: center; gap: 6px; font: 500 12.5px 'IBM Plex Mono', monospace; color: #8b949e; }
	.muted { color: #586069; }

	/* ---- body ---- */
	.body { flex: 1; display: flex; min-height: 0; }

	/* ---- left rail ---- */
	.rail {
		width: 300px; flex: none;
		border-right: 1px solid rgba(255, 255, 255, 0.07);
		background: #0f141a;
		padding: 16px;
		display: flex; flex-direction: column; gap: 14px;
		overflow: hidden;
	}
	.avatar-row { display: flex; align-items: center; gap: 11px; }
	.avatar {
		width: 38px; height: 38px; border-radius: 7px;
		background: linear-gradient(135deg, #2a3340, #1a2029);
		border: 1px solid rgba(255, 255, 255, 0.1);
		display: flex; align-items: center; justify-content: center;
		font: 700 16px 'IBM Plex Mono', monospace; color: #8b949e;
	}
	.avatar-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.avatar-name { font: 600 15px 'IBM Plex Sans', sans-serif; color: #e6edf3; }
	.avatar-sub { font: 400 10px 'IBM Plex Mono', monospace; color: #6e7681; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.lbl { font: 600 10px 'IBM Plex Mono', monospace; letter-spacing: 1.4px; color: #6e7681; }
	.row-between { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
	.hp { display: flex; flex-direction: column; gap: 7px; }
	.hp-val { font: 600 13px 'IBM Plex Mono', monospace; }
	.dim { color: #586069; }
	.bar { height: 7px; background: rgba(255, 255, 255, 0.06); border-radius: 4px; overflow: hidden; }
	.bar-tall { height: 9px; border-radius: 5px; }
	.bar-fill { height: 100%; transition: width 0.4s ease; }

	.stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
	.stat { padding: 9px 11px; background: #131922; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 7px; }
	.stat.span2 { grid-column: span 2; }
	.stat-big { font: 600 19px 'IBM Plex Mono', monospace; color: #e6edf3; margin-top: 3px; }
	.stat-big.green { color: #4cc38a; }
	.stat-big.bad { color: #f0584f; }
	.note { font: 400 9px 'IBM Plex Mono', monospace; color: #586069; white-space: nowrap; }
	.pos { display: flex; gap: 12px; margin-top: 5px; font: 600 15px 'IBM Plex Mono', monospace; color: #e6edf3; }
	.axis { color: #586069; font-size: 11px; }

	.hr { height: 1px; background: rgba(255, 255, 255, 0.07); margin: 1px 0; }

	.progress { display: flex; flex-direction: column; gap: 8px; }
	.prog-val { font: 600 12px 'IBM Plex Mono', monospace; color: #e6edf3; }
	.prog-note { font: 400 10.5px 'IBM Plex Mono', monospace; }

	.override {
		margin-top: auto;
		background: rgba(91, 155, 214, 0.1);
		border: 1px solid rgba(91, 155, 214, 0.38);
		border-left: 3px solid #5b9bd6;
		border-radius: 7px;
		padding: 11px 12px;
		display: flex; gap: 10px; align-items: flex-start;
	}
	.override .dot { margin-top: 4px; }
	.ov-title { font: 600 9.5px 'IBM Plex Mono', monospace; letter-spacing: 1.4px; color: #7fb1e0; }
	.ov-body { font: 400 11.5px/1.45 'IBM Plex Sans', sans-serif; color: #b9d2ea; margin-top: 3px; }

	/* ---- viewport ---- */
	.viewport {
		flex: 1; min-width: 0; position: relative;
		background: linear-gradient(180deg, #15191f, #0c0e12);
		overflow: hidden;
	}
	/* BotWindow is built as a self-contained window (header, its own hotbar, step
	   label). In the redesign it's only the 3D feed — hide its chrome (we draw our
	   own badges / action chip / hotbar) and let the view fill the viewport. */
	.viewport :global(.bw) {
		width: 100% !important; height: 100% !important;
		border: none !important; border-radius: 0 !important; background: transparent !important;
	}
	.viewport :global(.bw-h),
	.viewport :global(.inv-overlay),
	.viewport :global(.bw-step),
	.viewport :global(.bw-s) { display: none !important; }
	.viewport :global(.bw-view) { position: absolute !important; inset: 0 !important; width: 100% !important; height: 100% !important; border-radius: 0 !important; }
	.viewport :global(canvas),
	.viewport :global(iframe) { width: 100% !important; height: 100% !important; }
	.vp-badge {
		position: absolute; top: 14px; z-index: 3;
		display: flex; align-items: center; gap: 7px;
		background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 5px; padding: 5px 9px; backdrop-filter: blur(3px);
		font: 600 10px 'IBM Plex Mono', monospace; letter-spacing: 1.2px; color: #e6edf3;
	}
	.vp-badge-left { left: 14px; }
	.vp-badge-right { right: 14px; padding: 5px 10px; font-weight: 500; letter-spacing: 0; color: #c9d1d9; }

	.action-chip {
		position: absolute; bottom: 78px; left: 14px; z-index: 3;
		display: flex; align-items: center; gap: 8px;
		background: rgba(0, 0, 0, 0.55); border: 1px solid rgba(232, 161, 60, 0.35);
		border-radius: 5px; padding: 6px 11px; backdrop-filter: blur(3px); max-width: 60%;
	}
	.action-lbl { font: 600 9px 'IBM Plex Mono', monospace; letter-spacing: 1px; color: #e8a13c; flex: none; }
	.action-txt { font: 400 11px 'IBM Plex Mono', monospace; color: #c9d1d9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.hotbar-wrap {
		position: absolute; bottom: 16px; left: 50%; transform: translateX(-50%); z-index: 3;
		display: flex; flex-direction: column; align-items: center; gap: 6px;
	}
	.hotbar-tip { font: 600 9px 'IBM Plex Mono', monospace; letter-spacing: 1.4px; color: #e6edf3; background: rgba(0, 0, 0, 0.6); padding: 3px 8px; border-radius: 4px; }
	.hotbar { display: flex; gap: 4px; padding: 4px; background: rgba(0, 0, 0, 0.6); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 7px; backdrop-filter: blur(3px); }
	.slot { width: 42px; height: 42px; border-radius: 5px; border: 1px solid rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.04); position: relative; display: flex; align-items: center; justify-content: center; }
	.slot-empty { border-color: rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02); }
	.slot-sel { border: 2px solid #fff; background: rgba(255, 255, 255, 0.08); box-shadow: 0 0 12px rgba(255, 255, 255, 0.25); }
	.cube { width: 22px; height: 22px; border-radius: 3px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25); }
	.cube-n { position: absolute; bottom: 1px; right: 3px; font: 600 9px 'IBM Plex Mono', monospace; color: #fff; text-shadow: 0 1px 2px #000; }

	/* ---- ladder ---- */
	.ladder {
		width: 340px; flex: none;
		border-left: 1px solid rgba(255, 255, 255, 0.07);
		background: #0f141a;
		display: flex; flex-direction: column; min-height: 0;
	}
	.ladder-head { flex: none; padding: 14px 16px 11px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); display: flex; justify-content: space-between; align-items: center; }
	.ladder-title { font: 600 11px 'IBM Plex Mono', monospace; letter-spacing: 1.4px; color: #e6edf3; }
	.ladder-count { font: 600 11px 'IBM Plex Mono', monospace; color: #6e7681; }
	.ladder-list { flex: 1; overflow-y: auto; padding: 6px 0; }

	.step { display: flex; align-items: center; gap: 11px; padding: 5px 16px; }
	.step.milestone .step-name { color: #c79be0; }
	.check { width: 16px; height: 16px; flex: none; border-radius: 4px; background: rgba(76, 195, 138, 0.16); color: #4cc38a; font: 700 10px 'IBM Plex Mono', monospace; display: flex; align-items: center; justify-content: center; }
	.box { width: 16px; height: 16px; flex: none; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.12); }
	.step-n { font: 500 9px 'IBM Plex Mono', monospace; color: #586069; flex: none; width: 16px; }
	.step-n.dim3 { color: #39414a; }
	.step-name { font: 400 12.5px 'IBM Plex Sans', sans-serif; color: #8a93a0; flex: 1; }
	.step.done .step-name { color: #6e7681; }
	.step-name.todo-name { color: #4a525c; }
	.step-t { font: 500 10px 'IBM Plex Mono', monospace; color: #4cc38a; flex: none; }

	.step-active {
		margin: 5px 10px; padding: 11px 12px;
		background: rgba(232, 161, 60, 0.1);
		border: 1px solid rgba(232, 161, 60, 0.45);
		border-radius: 9px;
		animation: glow 2.4s ease-in-out infinite;
	}
	.sa-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
	.sa-arrow { color: #e8a13c; font: 700 12px 'IBM Plex Mono', monospace; }
	.sa-n { font: 600 9px 'IBM Plex Mono', monospace; color: #c97e28; width: 16px; }
	.sa-name { font: 600 13.5px 'IBM Plex Sans', sans-serif; color: #f4c889; }
	.sa-stall { font: 600 8px 'IBM Plex Mono', monospace; letter-spacing: 0.8px; color: #f0584f; border: 1px solid rgba(240, 88, 79, 0.4); padding: 2px 5px; border-radius: 3px; flex: none; }
	.sa-stall.blue { color: #7fb1e0; border-color: rgba(91, 155, 214, 0.5); }
	.sa-timers { display: flex; gap: 16px; margin: 9px 0 2px 25px; font: 500 10.5px 'IBM Plex Mono', monospace; }
	.t-amber { color: #e8a13c; }
	.t-dim { color: #8b949e; }
	.t-lbl { color: #8a6a3a; }
	.t-lbl2 { color: #586069; }
	.sa-subs { display: flex; flex-direction: column; gap: 3px; margin: 8px 0 0 25px; }
	.sub { display: flex; align-items: center; gap: 8px; font: 400 11px 'IBM Plex Sans', sans-serif; }
	.sub-done { color: #5a6470; }
	.sub-doing { color: #f4c889; font-weight: 500; }
	.sub-todo { color: #4a525c; }
	.sub-i { font: 700 10px 'IBM Plex Mono', monospace; flex: none; }
	.sub-done .sub-i { color: #4cc38a; }
	.sub-doing .sub-i { color: #e8a13c; animation: pulse 1.2s ease-in-out infinite; }
	.sub-todo .sub-i { color: #39414a; font-weight: 400; }
	.sub-band { font: 400 9px 'IBM Plex Mono', monospace; color: #586069; margin-left: auto; }

	@keyframes blink { 50% { opacity: 0; } }
	@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
	@keyframes glow {
		0%, 100% { box-shadow: 0 0 0 1px rgba(232, 161, 60, 0.18); }
		50% { box-shadow: 0 0 14px rgba(232, 161, 60, 0.35); }
	}
</style>

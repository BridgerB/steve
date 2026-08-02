<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as echarts from 'echarts';

	let {
		data
	}: { data: { slug: string; label: string; order: number; prereq: string[] } } = $props();

	type Run = { ts: string; pass: boolean; duration_ms: number; x: number; z: number; message: string };
	let runs: Run[] = $state([]);
	let status: { state: string; lastMs?: number } | null = $state(null);
	let chartEl: HTMLDivElement;
	let chart: echarts.ECharts | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;

	const stats = $derived.by(() => {
		const n = runs.length;
		const p = runs.filter((r) => r.pass).length;
		const passMs = runs.filter((r) => r.pass).map((r) => r.duration_ms);
		const avg = passMs.length ? Math.round(passMs.reduce((a, b) => a + b, 0) / passMs.length) : 0;
		return { n, passPct: n ? Math.round((100 * p) / n) : 0, avg };
	});

	const poll = async () => {
		try {
			const j = await (await fetch(`/gym/data/history/${data.slug}`)).json();
			runs = j.runs ?? [];
			status = j.status ?? null;
			render();
		} catch {
			/* ignore */
		}
	};

	const render = () => {
		if (!chart) return;
		chart.setOption({
			tooltip: { trigger: 'axis' },
			grid: { left: 44, right: 16, top: 12, bottom: 40 },
			xAxis: {
				type: 'category',
				data: runs.map((_, i) => i + 1),
				axisLabel: { color: '#6b7280' },
				name: 'run #',
				nameTextStyle: { color: '#6b7280' }
			},
			yAxis: {
				type: 'value',
				axisLabel: { color: '#8b93a1', formatter: (v: number) => `${v / 1000}s` }
			},
			series: [
				{
					type: 'bar',
					data: runs.map((r) => ({
						value: r.duration_ms,
						itemStyle: { color: r.pass ? '#39d98a' : '#e05c5c' }
					})),
					barMaxWidth: 22
				}
			]
		});
	};

	onMount(() => {
		chart = echarts.init(chartEl, undefined, { renderer: 'canvas' });
		// live 3D view
		let dispose: (() => void) | undefined;
		(async () => {
			try {
				const url = '/web/viewer.js';
				const mod = (await import(/* @vite-ignore */ url)) as {
					mountViewer: (c: HTMLCanvasElement, u: string, o: { workerUrl?: string }) => () => void;
				};
				const c = document.getElementById('gym-view') as HTMLCanvasElement;
				dispose = mod.mountViewer(c, `/gym/single/${data.slug}/viewer`, {
					workerUrl: '/web/worker.js'
				});
			} catch {
				/* viewer optional */
			}
		})();
		poll();
		timer = setInterval(poll, 3000);
		return () => {
			clearInterval(timer);
			dispose?.();
		};
	});
	onDestroy(() => {
		clearInterval(timer);
		chart?.dispose();
	});
</script>

<svelte:head><title>gym · {data.label}</title></svelte:head>

<div class="page">
	<div class="top">
		<a class="back" href="/gym" data-sveltekit-reload>← gym</a>
		<h1><span class="ord">{data.order}</span> {data.label}</h1>
		{#if status}<span class="live" class:pass={status.state === 'pass'} class:fail={status.state === 'fail'} class:run={status.state === 'running'}
			>{status.state}{status.lastMs ? ` · ${(status.lastMs / 1000).toFixed(1)}s` : ''}</span
		>{/if}
	</div>
	<p class="prereq">prereqs: {data.prereq.length ? data.prereq.join(', ') : '(none — raw spawn)'} · random-tp 0–10k</p>

	<div class="stats">
		<div class="stat"><div class="k">runs</div><div class="v">{stats.n}</div></div>
		<div class="stat"><div class="k">pass rate</div><div class="v" class:good={stats.passPct >= 80} class:bad={stats.passPct < 50}>{stats.passPct}%</div></div>
		<div class="stat"><div class="k">avg time (pass)</div><div class="v">{(stats.avg / 1000).toFixed(1)}s</div></div>
	</div>

	<div class="row">
		<div class="view"><canvas id="gym-view"></canvas></div>
		<div class="chartbox"><div class="chdr">duration per run (green=pass, red=fail)</div><div bind:this={chartEl} class="chart"></div></div>
	</div>

	<div class="runs">
		{#each [...runs].reverse().slice(0, 12) as r (r.ts)}
			<div class="rrow" class:fail={!r.pass}>
				<span class="rp">{r.pass ? '✓' : '✗'}</span>
				<span class="rt">{(r.duration_ms / 1000).toFixed(1)}s</span>
				<span class="rl">@{r.x},{r.z}</span>
				<span class="rm">{r.message}</span>
			</div>
		{/each}
	</div>
</div>

<style>
	:global(body) { margin: 0; background: #0b0d10; color: #d6dae0; font-family: ui-monospace, Menlo, monospace; }
	.page { padding: 16px; max-width: 1100px; margin: 0 auto; }
	.top { display: flex; align-items: center; gap: 12px; }
	.back { color: #4c8dff; text-decoration: none; font-size: 13px; }
	h1 { font-size: 16px; margin: 0; display: flex; align-items: center; gap: 8px; }
	.ord { color: #6b7280; font-size: 13px; }
	.live { font-size: 12px; color: #e0b23c; }
	.live.pass { color: #39d98a; }
	.live.fail { color: #e05c5c; }
	.prereq { color: #8b93a1; font-size: 12px; margin: 6px 0 14px; }
	.stats { display: flex; gap: 10px; margin-bottom: 14px; }
	.stat { border: 1px solid #232833; border-radius: 8px; background: #12161d; padding: 8px 16px; }
	.k { font-size: 11px; color: #6b7280; }
	.v { font-size: 20px; }
	.v.good { color: #39d98a; }
	.v.bad { color: #e05c5c; }
	.row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
	@media (max-width: 900px) { .row { grid-template-columns: 1fr; } }
	.view { aspect-ratio: 16 / 10; border: 1px solid #232833; border-radius: 8px; overflow: hidden; background: #05070a; }
	canvas { width: 100%; height: 100%; display: block; }
	.chartbox { border: 1px solid #232833; border-radius: 8px; background: #05070a; }
	.chdr { font-size: 11px; padding: 6px 10px; color: #8b93a1; border-bottom: 1px solid #232833; }
	.chart { height: 260px; }
	.runs { margin-top: 14px; display: flex; flex-direction: column; gap: 3px; }
	.rrow { display: flex; gap: 12px; font-size: 12px; padding: 4px 8px; background: #0e1319; border-radius: 4px; }
	.rp { color: #39d98a; }
	.rrow.fail .rp { color: #e05c5c; }
	.rt { width: 48px; }
	.rl { width: 110px; color: #6b7280; }
	.rm { color: #8b93a1; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

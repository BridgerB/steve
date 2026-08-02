<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import * as echarts from 'echarts';

	let { data }: { data: { steps: { slug: string; label: string; order: number }[] } } = $props();
	const steps = data.steps;
	const labelOf = new Map(steps.map((s) => [s.slug, s.label]));

	type Row = {
		slug: string; runs: number; pass_pct: number; avg_ms: number;
		avg_ms_pass: number; min_ms_pass: number; max_ms_pass: number;
	};
	type RunPt = { ts: number; slug: string; pass: number; duration_ms: number; x: number; z: number };

	let summary: Row[] = $state([]);
	let allruns: RunPt[] = $state([]);
	let running = $state(false);

	const els: Record<string, HTMLDivElement> = {};
	const charts: Record<string, echarts.ECharts> = {};
	let timer: ReturnType<typeof setInterval> | undefined;

	const refresh = async () => {
		try {
			const s = await (await fetch('/gym/data/summary')).json();
			summary = s.summary ?? [];
			running = s.running;
			const a = await (await fetch('/gym/data/allruns')).json();
			allruns = a.runs ?? [];
			render();
		} catch {
			/* ignore */
		}
	};

	const inLadder = () => {
		const m = new Map(summary.map((r) => [r.slug, r]));
		return steps.map((s) => ({ label: s.label, r: m.get(s.slug) }));
	};

	const render = () => {
		const ax = { axisLabel: { color: '#8b93a1', fontSize: 10 }, axisLine: { lineStyle: { color: '#2a3038' } } };
		const cat10 = (data: unknown[]) => ({ type: 'category', data, inverse: true, axisLabel: { color: '#c7ccd4', fontSize: 10 } });
		const rows = inLadder();
		const cats = rows.map((x) => x.label);

		// 1. pass rate (ladder order)
		charts.pass?.setOption({
			grid: { left: 132, right: 30, top: 8, bottom: 22 },
			xAxis: { type: 'value', max: 100, ...ax },
			yAxis: cat10(cats),
			series: [{ type: 'bar', data: rows.map((x) => x.r?.pass_pct ?? null),
				itemStyle: { color: (p: { value: number }) => p.value == null ? '#333' : p.value >= 80 ? '#39d98a' : p.value >= 50 ? '#e0b23c' : '#e05c5c' },
				label: { show: true, position: 'right', formatter: '{c}%', color: '#c7ccd4', fontSize: 10 } }]
		});

		// 2. duration SPREAD (floating bar min→max of successful runs) — variance across terrain
		const mins = rows.map((x) => x.r?.min_ms_pass ? Math.round((x.r.min_ms_pass) / 100) / 10 : 0);
		const ranges = rows.map((x) => (x.r?.min_ms_pass && x.r?.max_ms_pass) ? Math.round((x.r.max_ms_pass - x.r.min_ms_pass) / 100) / 10 : 0);
		charts.spread?.setOption({
			grid: { left: 132, right: 40, top: 8, bottom: 22 },
			xAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, formatter: '{value}s' } },
			yAxis: cat10(cats),
			tooltip: { trigger: 'axis', formatter: (p: { dataIndex: number }[]) => { const i = p[0].dataIndex; const r = rows[i].r; return r ? `${cats[i]}<br/>min ${(r.min_ms_pass/1000).toFixed(1)}s · avg ${(r.avg_ms_pass/1000).toFixed(1)}s · max ${(r.max_ms_pass/1000).toFixed(1)}s` : cats[i]; } },
			series: [
				{ type: 'bar', stack: 's', data: mins, itemStyle: { color: 'transparent' }, silent: true },
				{ type: 'bar', stack: 's', data: ranges, itemStyle: { color: '#4c8dff', borderRadius: 3 },
					label: { show: true, position: 'right', color: '#c7ccd4', fontSize: 10, formatter: (p: { dataIndex: number }) => { const r = rows[p.dataIndex].r; return r?.avg_ms_pass ? `${(r.avg_ms_pass/1000).toFixed(1)}s` : ''; } } }
			]
		});

		// 3. DIFFICULTY ranking (sorted hardest→easiest by pass%)
		const ranked = [...summary].filter((r) => r.runs > 0).sort((a, b) => a.pass_pct - b.pass_pct);
		charts.diff?.setOption({
			grid: { left: 132, right: 30, top: 8, bottom: 22 },
			xAxis: { type: 'value', max: 100, ...ax },
			yAxis: cat10(ranked.map((r) => labelOf.get(r.slug) ?? r.slug)),
			series: [{ type: 'bar', data: ranked.map((r) => r.pass_pct),
				itemStyle: { color: (p: { value: number }) => p.value >= 80 ? '#39d98a' : p.value >= 50 ? '#e0b23c' : '#e05c5c' },
				label: { show: true, position: 'right', formatter: '{c}%', color: '#c7ccd4', fontSize: 10 } }]
		});

		// 4. RUNS PER STEP (coverage)
		charts.runs?.setOption({
			grid: { left: 132, right: 30, top: 8, bottom: 22 },
			xAxis: { type: 'value', ...ax },
			yAxis: cat10(cats),
			series: [{ type: 'bar', data: rows.map((x) => x.r?.runs ?? 0), itemStyle: { color: '#7a5cff' },
				label: { show: true, position: 'right', color: '#c7ccd4', fontSize: 10 } }]
		});

		// 5. LOCATION scatter (where runs pass/fail across the world)
		charts.loc?.setOption({
			grid: { left: 50, right: 16, top: 12, bottom: 34 },
			tooltip: { formatter: (p: { data: number[] }) => `${p.data[0]}, ${p.data[1]}` },
			xAxis: { type: 'value', name: 'x', min: 0, max: 10000, ...ax },
			yAxis: { type: 'value', name: 'z', min: 0, max: 10000, ...ax },
			series: [
				{ type: 'scatter', symbolSize: 6, data: allruns.filter((r) => r.pass).map((r) => [r.x, r.z]), itemStyle: { color: '#39d98a', opacity: 0.7 } },
				{ type: 'scatter', symbolSize: 6, data: allruns.filter((r) => !r.pass).map((r) => [r.x, r.z]), itemStyle: { color: '#e05c5c', opacity: 0.7 } }
			]
		});

		// 6. RUNS OVER TIME (pass/fail per time bucket — spot regressions)
		const bucketMs = 5 * 60 * 1000;
		const buckets = new Map<number, { p: number; f: number }>();
		for (const r of allruns) {
			const b = Math.floor(r.ts / bucketMs) * bucketMs;
			const e = buckets.get(b) ?? { p: 0, f: 0 };
			if (r.pass) e.p++; else e.f++;
			buckets.set(b, e);
		}
		const bks = [...buckets.keys()].sort((a, b) => a - b);
		charts.time?.setOption({
			grid: { left: 44, right: 16, top: 12, bottom: 34 },
			tooltip: { trigger: 'axis' },
			legend: { data: ['pass', 'fail'], textStyle: { color: '#8b93a1' }, top: 0, right: 0 },
			xAxis: { type: 'category', data: bks.map((b) => new Date(b).toLocaleTimeString().slice(0, 5)), ...ax },
			yAxis: { type: 'value', ...ax },
			series: [
				{ name: 'pass', type: 'bar', stack: 't', data: bks.map((b) => buckets.get(b)!.p), itemStyle: { color: '#39d98a' } },
				{ name: 'fail', type: 'bar', stack: 't', data: bks.map((b) => buckets.get(b)!.f), itemStyle: { color: '#e05c5c' } }
			]
		});
	};

	onMount(() => {
		for (const id of ['pass', 'spread', 'diff', 'runs', 'loc', 'time'])
			charts[id] = echarts.init(els[id], undefined, { renderer: 'canvas' });
		refresh();
		timer = setInterval(refresh, 5000);
	});
	onDestroy(() => {
		clearInterval(timer);
		Object.values(charts).forEach((c) => c.dispose());
	});
</script>

<svelte:head><title>gym · speedrun step lab</title></svelte:head>

<div class="page">
	<div class="top">
		<h1>gym — speedrun steps in isolation</h1>
		{#if running}<span class="run">● 4 workers running</span>{/if}
		<a class="allbtn" href="/gym/all" data-sveltekit-reload>▶ run 4 random →</a>
	</div>
	<p class="sub">Each step gives the bot its prerequisites, teleports it to a random spot (0–10k), and runs just that task. Every run is saved (with its x,y,z + prereqs, reproducible) to <code>data/gym.db</code>. Click a step to watch + see its history.</p>

	<div class="charts">
		<div class="chart"><div class="chdr">pass rate</div><div bind:this={els.pass} class="cbody"></div></div>
		<div class="chart"><div class="chdr">time spread (min→max, label=avg) — variance across terrain</div><div bind:this={els.spread} class="cbody"></div></div>
		<div class="chart"><div class="chdr">difficulty (hardest → easiest)</div><div bind:this={els.diff} class="cbody"></div></div>
		<div class="chart"><div class="chdr">runs per step (coverage)</div><div bind:this={els.runs} class="cbody"></div></div>
		<div class="chart"><div class="chdr">location map — where runs pass (green) / fail (red)</div><div bind:this={els.loc} class="cbody sq"></div></div>
		<div class="chart"><div class="chdr">runs over time (per 5-min bucket) — spot regressions</div><div bind:this={els.time} class="cbody sq"></div></div>
	</div>

	<div class="steps">
		{#each steps as s (s.slug)}
			{@const row = summary.find((r) => r.slug === s.slug)}
			<a class="step" href={`/gym/${s.slug}`} data-sveltekit-reload>
				<span class="ord">{s.order}</span>
				<span class="lbl">{s.label}</span>
				{#if row}<span class="pct" class:good={row.pass_pct >= 80} class:bad={row.pass_pct < 50}>{row.pass_pct}%</span><span class="n">{row.runs} runs</span>{/if}
			</a>
		{/each}
	</div>
</div>

<style>
	:global(body) { margin: 0; background: #0b0d10; color: #d6dae0; font-family: ui-monospace, Menlo, monospace; }
	.page { padding: 18px; max-width: 1200px; margin: 0 auto; }
	.top { display: flex; align-items: center; gap: 14px; }
	h1 { font-size: 16px; margin: 0; flex: 1; }
	.run { font-size: 12px; color: #39d98a; }
	.allbtn { color: #4c8dff; text-decoration: none; font-size: 13px; border: 1px solid #26456e; padding: 6px 12px; border-radius: 6px; }
	.sub { color: #8b93a1; font-size: 12px; margin: 6px 0 16px; }
	.sub code { color: #c7ccd4; }
	.charts { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; }
	@media (max-width: 860px) { .charts { grid-template-columns: 1fr; } }
	.chart { border: 1px solid #232833; border-radius: 8px; background: #05070a; }
	.chdr { font-size: 11px; padding: 6px 10px; color: #8b93a1; border-bottom: 1px solid #232833; }
	.cbody { height: 340px; }
	.cbody.sq { height: 300px; }
	.steps { display: flex; flex-direction: column; gap: 4px; }
	.step { display: flex; align-items: center; gap: 10px; padding: 8px 12px; background: #12161d; border: 1px solid #232833; border-radius: 6px; text-decoration: none; color: #d6dae0; font-size: 13px; }
	.step:hover { border-color: #2f4a6e; background: #161b24; }
	.ord { width: 20px; color: #6b7280; text-align: right; }
	.lbl { flex: 1; }
	.pct { font-size: 12px; color: #e0b23c; }
	.pct.good { color: #39d98a; }
	.pct.bad { color: #e05c5c; }
	.n { font-size: 11px; color: #6b7280; }
</style>

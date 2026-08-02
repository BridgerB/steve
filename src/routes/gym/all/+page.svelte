<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let { data }: { data: { count: number } } = $props();
	const N = data.count;

	type ViewerModule = {
		mountViewer: (c: HTMLCanvasElement, url: string, o: { workerUrl?: string }) => () => void;
	};

	let workers: { slug: string; label: string; state: string; lastMs?: number }[] = $state(
		Array.from({ length: N }, () => ({ slug: '', label: 'starting…', state: 'init' }))
	);
	let running = $state(true);
	const statuses: string[] = $state(Array.from({ length: N }, () => 'connecting…'));
	let timer: ReturnType<typeof setInterval> | undefined;

	const poll = async () => {
		try {
			const j = await (await fetch('/gym/data/summary')).json();
			if (j.workers?.length) workers = j.workers;
			running = j.running;
		} catch {
			/* ignore */
		}
	};

	const stop = async () => {
		running = false;
		try {
			await fetch('/gym/all/stop', { method: 'POST' });
		} catch {
			/* ignore */
		}
	};

	onMount(() => {
		const disposers: Array<() => void> = [];
		(async () => {
			let mod: ViewerModule;
			try {
				const url = '/web/viewer.js';
				mod = (await import(/* @vite-ignore */ url)) as ViewerModule;
			} catch {
				for (let i = 0; i < N; i++) statuses[i] = 'viewer.js failed';
				return;
			}
			for (let i = 0; i < N; i++) {
				const c = document.getElementById(`gw-${i}`) as HTMLCanvasElement | null;
				if (!c) continue;
				try {
					disposers.push(mod.mountViewer(c, `/gym/all/viewer/${i}`, { workerUrl: '/web/worker.js' }));
					statuses[i] = '';
				} catch {
					statuses[i] = 'mount failed';
				}
			}
		})();
		poll();
		timer = setInterval(poll, 2500);
		return () => {
			clearInterval(timer);
			disposers.forEach((d) => d());
		};
	});
	onDestroy(() => clearInterval(timer));
</script>

<svelte:head><title>gym · run 4 random</title></svelte:head>

<div class="page">
	<div class="top">
		<a class="back" href="/gym" data-sveltekit-reload>← gym</a>
		<h1>4 workers · random steps · until you stop</h1>
		<span class="state" class:on={running}>{running ? '● running' : '■ stopped'}</span>
		<button class="stop" onclick={stop} disabled={!running}>■ STOP</button>
	</div>
	<div class="grid">
		{#each Array(N) as _, i (i)}
			{@const w = workers[i]}
			<div class="cell">
				<div class="hdr">
					<span class="idx">W{i}</span>
					<span class="lbl">{w?.label ?? '…'}</span>
					<span
						class="st"
						class:pass={w?.state === 'pass'}
						class:fail={w?.state === 'fail'}
						class:run={w?.state === 'running'}
						>{w?.state === 'pass'
							? `✓ ${((w.lastMs ?? 0) / 1000).toFixed(1)}s`
							: w?.state === 'fail'
								? `✗ ${((w.lastMs ?? 0) / 1000).toFixed(1)}s`
								: (w?.state ?? '')}</span
					>
				</div>
				<div class="view">
					<canvas id={`gw-${i}`}></canvas>
					{#if statuses[i]}<div class="status">{statuses[i]}</div>{/if}
				</div>
			</div>
		{/each}
	</div>
	<p class="hint">Come back later and press STOP, then the <a href="/gym" data-sveltekit-reload>gym overview</a> shows which steps are easy/hard and how they spread across locations.</p>
</div>

<style>
	:global(body) { margin: 0; background: #0b0d10; color: #d6dae0; font-family: ui-monospace, Menlo, monospace; }
	.page { padding: 14px; }
	.top { display: flex; align-items: center; gap: 14px; margin-bottom: 12px; }
	.back { color: #4c8dff; text-decoration: none; font-size: 13px; }
	h1 { font-size: 15px; margin: 0; flex: 1; }
	.state { font-size: 12px; color: #6b7280; }
	.state.on { color: #39d98a; }
	.stop { background: #3a1414; color: #ff8a8a; border: 1px solid #6e2626; border-radius: 6px; padding: 6px 14px; font: inherit; font-size: 13px; cursor: pointer; }
	.stop:disabled { opacity: 0.4; cursor: default; }
	.grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
	.cell { border: 1px solid #232833; border-radius: 8px; overflow: hidden; background: #05070a; }
	.hdr { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 6px 10px; background: #12161d; border-bottom: 1px solid #232833; }
	.idx { color: #6b7280; }
	.lbl { flex: 1; }
	.st { font-size: 11px; color: #8b93a1; }
	.st.pass { color: #39d98a; }
	.st.fail { color: #e05c5c; }
	.st.run { color: #e0b23c; }
	.view { position: relative; aspect-ratio: 16 / 10; }
	canvas { width: 100%; height: 100%; display: block; }
	.status { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: #6b7280; }
	.hint { color: #6b7280; font-size: 12px; margin-top: 12px; }
	.hint a { color: #4c8dff; }
</style>

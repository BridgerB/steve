<script lang="ts">
	import { onMount } from 'svelte';

	let { data }: { data: { labels: string[] } } = $props();
	const labels = data.labels;

	type ViewerModule = {
		mountViewer: (
			canvas: HTMLCanvasElement,
			sseUrl: string,
			opts: { workerUrl?: string }
		) => () => void;
	};

	const statuses: string[] = $state(labels.map(() => 'connecting…'));

	onMount(() => {
		const disposers: Array<() => void> = [];
		(async () => {
			let mod: ViewerModule;
			try {
				// Indirect through a variable so vite's import-analysis doesn't try to
				// resolve /public asset at build time (BotWindow does the same).
				const url = '/web/viewer.js';
				mod = (await import(/* @vite-ignore */ url)) as ViewerModule;
			} catch (e) {
				for (let i = 0; i < labels.length; i++)
					statuses[i] = 'viewer.js failed: ' + (e instanceof Error ? e.message : String(e));
				return;
			}
			for (let i = 0; i < labels.length; i++) {
				const canvas = document.getElementById(`swim-${i}`) as HTMLCanvasElement | null;
				if (!canvas) continue;
				try {
					const dispose = mod.mountViewer(canvas, `/debug/swim/viewer/${i}`, {
						workerUrl: '/web/worker.js'
					});
					disposers.push(dispose);
					statuses[i] = '';
				} catch (e) {
					statuses[i] = 'mount failed: ' + (e instanceof Error ? e.message : String(e));
				}
			}
		})();
		return () => disposers.forEach((d) => d());
	});
</script>

<svelte:head><title>swim lab · all strategy views</title></svelte:head>

<div class="page">
	<h1>water-escape strategies · live @ the ocean hole (-154,62,125)</h1>
	<p class="sub">
		Each bot loops: teleport into the trap → run its strategy → reset. Watch which climbs out.
	</p>
	<div class="grid">
		{#each labels as label, i (label)}
			<div class="cell">
				<div class="hdr"><span class="idx">{i}</span> {label}</div>
				<div class="view">
					<canvas id={`swim-${i}`}></canvas>
					{#if statuses[i]}<div class="status">{statuses[i]}</div>{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #0b0d10;
		color: #d6dae0;
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
	}
	.page {
		padding: 16px;
	}
	h1 {
		font-size: 15px;
		margin: 0 0 4px;
		font-weight: 600;
	}
	.sub {
		font-size: 12px;
		color: #8b93a1;
		margin: 0 0 14px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}
	@media (max-width: 1000px) {
		.grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.cell {
		border: 1px solid #232833;
		border-radius: 8px;
		overflow: hidden;
		background: #05070a;
	}
	.hdr {
		font-size: 12px;
		padding: 6px 10px;
		background: #12161d;
		border-bottom: 1px solid #232833;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.idx {
		display: inline-flex;
		width: 18px;
		height: 18px;
		align-items: center;
		justify-content: center;
		background: #2a3340;
		border-radius: 4px;
		font-size: 11px;
	}
	.view {
		position: relative;
		aspect-ratio: 16 / 10;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
	}
	.status {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		color: #6b7280;
		text-align: center;
		padding: 8px;
	}
</style>

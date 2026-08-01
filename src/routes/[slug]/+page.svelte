<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let canvas: HTMLCanvasElement;
	let status = $state('connecting…');

	const short = (n: string) => n.replace(/^minecraft:/, '');

	type ViewerModule = {
		mountViewer: (
			canvas: HTMLCanvasElement,
			wsUrl: string,
			opts?: { workerUrl?: string }
		) => () => void;
	};

	onMount(() => {
		// Poll the server load (~5s) so step/health/inventory stay live. The 3D
		// canvas itself streams continuously over its own WebSocket, untouched.
		const poll = setInterval(() => invalidateAll(), 5000);

		let dispose: (() => void) | undefined;
		if (data.hasViewer) {
			(async () => {
				try {
					const url = '/web/viewer.js';
					const mod = (await import(/* @vite-ignore */ url)) as ViewerModule;
					// SSE route served by the SvelteKit server itself.
					dispose = mod.mountViewer(canvas, `/viewer/${data.index}`, { workerUrl: '/web/worker.js' });
					status = '';
				} catch (e) {
					status = 'viewer failed: ' + (e instanceof Error ? e.message : String(e));
				}
			})();
		} else {
			status = 'no live view for this bot';
		}
		return () => {
			clearInterval(poll);
			dispose?.();
		};
	});

	const healthColor = (h: string): string => {
		const n = Number(h);
		if (Number.isNaN(n)) return '#888';
		return n > 12 ? '#81c784' : n > 6 ? '#ffb74d' : '#e57373';
	};
</script>

<svelte:head><title>{data.slug}</title></svelte:head>

<a class="back" href="/">← race</a>

<div class="hud">
	<span class="name">{data.slug}{data.dead ? ' 💀' : ''}</span>
	{#if data.step}<span class="step">▶ {data.step}</span>{/if}
	<span class="hp" style:color={healthColor(data.health)}>♥ {data.health}</span>
	{#if data.dim}<span class="dim">{data.dim}</span>{/if}
</div>

{#if status}<div class="status">{status}</div>{/if}

<canvas bind:this={canvas}></canvas>

<div class="inv">
	{#if data.inv.length}
		{#each data.inv as it (it.name)}
			<span class="inv-item"><span class="inv-n">{short(it.name)}</span><span class="inv-c"
					>{it.count}</span
				></span>
		{/each}
	{:else}
		<span class="inv-empty">empty inventory</span>
	{/if}
</div>

<style>
	:global(body) {
		margin: 0;
		background: #000;
		overflow: hidden;
	}
	canvas {
		display: block;
		width: 100vw;
		height: 100vh;
		background: #000;
	}
	.back {
		position: fixed;
		top: 10px;
		left: 12px;
		z-index: 10;
		color: #9cd9a0;
		font: bold 14px monospace;
		text-decoration: none;
		background: rgba(0, 0, 0, 0.6);
		padding: 4px 10px;
		border-radius: 4px;
	}
	.back:hover {
		color: #fff;
	}
	.hud {
		position: fixed;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		display: flex;
		gap: 14px;
		align-items: center;
		color: #fff;
		font: bold 14px monospace;
		background: rgba(0, 0, 0, 0.55);
		padding: 5px 14px;
		border-radius: 4px;
		white-space: nowrap;
	}
	.step {
		color: #ffc107;
	}
	.dim {
		color: #8aa;
		font-weight: normal;
	}
	.status {
		position: fixed;
		top: 46px;
		left: 12px;
		z-index: 10;
		color: #aaa;
		font: 12px monospace;
		background: rgba(0, 0, 0, 0.6);
		padding: 3px 8px;
		border-radius: 4px;
	}
	.inv {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 10;
		display: flex;
		flex-wrap: wrap;
		gap: 3px 5px;
		padding: 6px 10px;
		background: rgba(0, 0, 0, 0.6);
		max-height: 22vh;
		overflow-y: auto;
	}
	.inv-item {
		display: inline-flex;
		align-items: baseline;
		gap: 3px;
		font: 12px monospace;
		background: rgba(30, 30, 30, 0.9);
		border: 1px solid #333;
		border-radius: 3px;
		padding: 1px 5px;
		white-space: nowrap;
	}
	.inv-n {
		color: #b0bec5;
	}
	.inv-c {
		color: #9cd9a0;
		font-weight: bold;
	}
	.inv-empty {
		color: #666;
		font: 12px monospace;
	}
</style>

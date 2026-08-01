<script lang="ts">
	import { onMount } from 'svelte';

	let canvas: HTMLCanvasElement;
	let status = $state('connecting…');

	type ViewerModule = {
		mountViewer: (
			canvas: HTMLCanvasElement,
			wsUrl: string,
			opts?: { workerUrl?: string }
		) => () => void;
	};

	onMount(() => {
		let dispose: (() => void) | undefined;
		(async () => {
			try {
				const url = '/web/viewer.js';
				const mod = (await import(/* @vite-ignore */ url)) as ViewerModule;
				const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
				// /viewer/mcp is proxied to the MCP bot's dedicated viewer server (:3010),
				// separate from the race — so this page only ever shows steve-mcp.
				dispose = mod.mountViewer(canvas, `${proto}//${location.host}/viewer/mcp`, {
					workerUrl: '/web/worker.js'
				});
				status = '';
			} catch (e) {
				status = 'viewer failed: ' + (e instanceof Error ? e.message : String(e));
			}
		})();
		return () => dispose?.();
	});
</script>

<svelte:head><title>steve-mcp</title></svelte:head>

<a class="back" href="/">← dashboard</a>
<div class="name">steve-mcp 🤖</div>
{#if status}<div class="status">{status}</div>{/if}
<canvas bind:this={canvas}></canvas>

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
	.name {
		position: fixed;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 10;
		color: #fff;
		font: bold 14px monospace;
		background: rgba(0, 0, 0, 0.5);
		padding: 4px 12px;
		border-radius: 4px;
	}
	.status {
		position: fixed;
		top: 44px;
		left: 12px;
		z-index: 10;
		color: #aaa;
		font: 12px monospace;
		background: rgba(0, 0, 0, 0.6);
		padding: 3px 8px;
		border-radius: 4px;
	}
</style>

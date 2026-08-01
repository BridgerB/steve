<script lang="ts">
	import { onMount } from 'svelte';
	import InventoryView from '$lib/InventoryView.svelte';

	type Win = {
		kind: string;
		n: number;
		slots: { s: number; n: string; c: number }[];
		open?: boolean;
		sel?: number;
	} | null;
	type Pose = { x: number; y: number; z: number; yaw: number; pitch: number };
	type LiveState = {
		health: number | null;
		food: number | null;
		x: number;
		y: number;
		z: number;
		yaw: number;
		time: number;
		held: string | null;
		window: Win;
		steve: { step: number; done: number[]; phase: string; progress: number } | null;
	};
	const ICON_BASE =
		'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures';

	let {
		index,
		name,
		step,
		onState,
		onPose,
		w = '300px',
		h = '220px'
	}: {
		index: number;
		name: string;
		step?: string;
		onState?: (s: LiveState) => void;
		onPose?: (p: Pose) => void;
		w?: string;
		h?: string;
	} = $props();

	let canvas: HTMLCanvasElement;
	let status = $state('connecting…');
	let win = $state<Win>(null); // live open-window / inventory slots for the overlay
	let held = $state<string | null>(null); // the real item in the bot's hand
	let swingKey = $state(0); // bumped on each real arm swing → replays the animation
	const heldUrl = $derived(
		held ? `${ICON_BASE}/item/${held.replace('minecraft:', '')}.png` : ''
	);
	const heldBlockUrl = $derived(
		held ? `${ICON_BASE}/block/${held.replace('minecraft:', '')}.png` : ''
	);

	type ViewerModule = {
		mountViewer: (
			canvas: HTMLCanvasElement,
			wsUrl: string,
			opts?: {
				workerUrl?: string;
				onState?: (s: LiveState) => void;
				onPose?: (p: Pose) => void;
				onSwing?: () => void;
			}
		) => () => void;
	};

	onMount(() => {
		let dispose: (() => void) | undefined;
		(async () => {
			try {
				// /web/viewer.js is the ported Babylon bundle (static). Loaded once,
				// shared across all windows; each call mounts an independent viewer.
				const url = '/web/viewer.js';
				const mod = (await import(/* @vite-ignore */ url)) as ViewerModule;
				// /viewer/N is an SSE route served by the SvelteKit server itself.
				dispose = mod.mountViewer(canvas, `/viewer/${index}`, {
					workerUrl: '/web/worker.js',
					onState: (s) => {
						win = s.window;
						held = s.held;
						onState?.(s);
					},
					onPose: (p) => onPose?.(p),
					onSwing: () => swingKey++
				});
				status = '';
			} catch (e) {
				status = 'viewer failed: ' + (e instanceof Error ? e.message : String(e));
			}
		})();
		return () => dispose?.();
	});

	const hasItems = $derived((win?.slots?.length ?? 0) > 0);
</script>

<!-- data-sveltekit-reload: do a full browser navigation instead of SvelteKit's
	 SPA transition. SPA nav stalls here (4 live WebGL viewers + WS reconnect
	 loops on the grid choke the client router), so the link appeared dead. -->
<a
	class="bw"
	href="/{name}"
	title="Open {name} fullscreen"
	data-sveltekit-reload
	style:--bw-w={w}
	style:--bw-h={h}
>
	<div class="bw-h">{name} ⛶</div>
	<div class="bw-view">
		<canvas bind:this={canvas}></canvas>
		{#if held}
			<!-- First-person held item (bottom-right), swung on each real arm swing -->
			{#key swingKey}
				<div class="held swinging">
					<img
						src={heldUrl}
						alt={held}
						onerror={(e) => {
							const img = e.currentTarget as HTMLImageElement;
							if (!img.dataset.fb) {
								img.dataset.fb = '1';
								img.src = heldBlockUrl;
							} else {
								img.style.display = 'none';
							}
						}}
					/>
				</div>
			{/key}
		{/if}
		{#if hasItems}
			<div class="inv-overlay"><InventoryView window={win} /></div>
		{/if}
	</div>
	<div class="bw-step">{step ? '▶ ' + step : '—'}</div>
	{#if status}<div class="bw-s">{status}</div>{/if}
</a>

<style>
	.bw {
		display: flex;
		flex-direction: column;
		width: var(--bw-w, 300px);
		height: var(--bw-h, auto);
		background: #000;
		border: 1px solid #2a2f3a;
		border-radius: 10px;
		overflow: hidden;
		text-decoration: none;
		cursor: pointer;
	}
	.bw:hover {
		border-color: #3a4150;
	}
	.bw-h {
		color: #9cd9a0;
		font: bold 12px monospace;
		padding: 3px 6px;
		background: #1a1a1a;
		white-space: nowrap;
	}
	.bw-view {
		position: relative;
		flex: 1 1 auto;
		min-height: 0;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		background: #000;
		/* Let clicks fall through to the wrapping <a> — otherwise Babylon's canvas
		   pointer handlers swallow the click and the view never opens fullscreen.
		   Thumbnails auto-follow the bot, so no manual camera control is needed. */
		pointer-events: none;
	}
	.inv-overlay {
		position: absolute;
		left: 10px;
		bottom: 10px;
		pointer-events: none;
		transform-origin: bottom left;
		opacity: 0.96;
	}
	/* First-person held item, bottom-right, like the in-game hand. */
	.held {
		position: absolute;
		right: 7%;
		bottom: -4%;
		width: 34%;
		max-width: 230px;
		pointer-events: none;
		transform-origin: bottom right;
	}
	.held img {
		width: 100%;
		image-rendering: pixelated;
		transform: rotate(-34deg);
		filter: drop-shadow(-2px 3px 3px rgba(0, 0, 0, 0.75));
	}
	.held.swinging {
		animation: held-swing 0.26s ease-out;
	}
	@keyframes held-swing {
		0% {
			transform: translate(0, 0) rotate(0deg);
		}
		38% {
			transform: translate(-10%, 26%) rotate(-15deg);
		}
		100% {
			transform: translate(0, 0) rotate(0deg);
		}
	}
	.bw-step {
		color: #ffc107;
		font: bold 11px monospace;
		padding: 3px 6px;
		background: #1a1a1a;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.bw-s {
		color: #888;
		font: 11px monospace;
		padding: 2px 6px;
	}
</style>

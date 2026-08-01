<script lang="ts">
	// Live window state streamed from the bot: the open container, or the player
	// inventory when nothing is open. Rendered as the in-game inventory/crafting GUI.
	type Win = {
		kind: string;
		n: number;
		slots: { s: number; n: string; c: number }[];
		open?: boolean; // a real container screen is open (table/furnace/chest)
		sel?: number; // selected hotbar slot 0-8
	} | null;

	let { window: win }: { window: Win } = $props();

	const ICON_BASE =
		'https://cdn.jsdelivr.net/gh/InventivetalentDev/minecraft-assets@1.21.1/assets/minecraft/textures';

	const bySlot = $derived.by(() => {
		const m = new Map<number, { n: string; c: number }>();
		for (const it of win?.slots ?? []) m.set(it.s, { n: it.n, c: it.c });
		return m;
	});

	// Crafting-table window vs the plain player inventory have different slot maps.
	const isTable = $derived(/crafting/i.test(win?.kind ?? ''));
	const craftN = $derived(isTable ? 9 : 4); // 3×3 vs 2×2
	const craftCols = $derived(isTable ? 3 : 2);
	const craftStart = 1;
	const resultSlot = 0;
	const invStart = $derived(isTable ? 10 : 9); // main grid start
	const mainSlots = $derived(
		Array.from({ length: 27 }, (_, i) => invStart + i)
	);
	const hotbar = $derived(Array.from({ length: 9 }, (_, i) => invStart + 27 + i));
	const craftSlots = $derived(
		Array.from({ length: craftN }, (_, i) => craftStart + i)
	);

	const sel = $derived(win?.sel ?? 0); // selected hotbar slot, always highlighted
	// Show the FULL inventory/crafting GUI only when the bot would actually see it:
	// a container screen is open, OR it's mid-craft (the craft grid has items).
	// Otherwise just the hotbar HUD, like the in-game default view.
	const craftHasItems = $derived(craftSlots.some((s) => bySlot.has(s)));
	const expanded = $derived((win?.open ?? false) || craftHasItems);

	const short = (name: string) => name.replace('minecraft:', '').replace(/_/g, ' ');
	const itemUrl = (name: string) =>
		`${ICON_BASE}/item/${name.replace('minecraft:', '')}.png`;
	const blockUrl = (name: string) =>
		`${ICON_BASE}/block/${name.replace('minecraft:', '')}.png`;
</script>

{#snippet slot(idx: number, big = false, selected = false)}
	{@const it = bySlot.get(idx)}
	<div class="slot" class:big class:sel={selected} title={it ? short(it.n) : ''}>
		{#if it}
			<img
				src={itemUrl(it.n)}
				alt={short(it.n)}
				loading="lazy"
				onerror={(e) => {
					const img = e.currentTarget as HTMLImageElement;
					if (!img.dataset.fb) {
						img.dataset.fb = '1';
						img.src = blockUrl(it.n);
					} else {
						img.style.display = 'none';
					}
				}}
			/>
			{#if it.c > 1}<span class="cnt">{it.c}</span>{/if}
		{/if}
	</div>
{/snippet}

<div class="inv" class:hud={!expanded}>
	{#if expanded}
		<!-- Crafting area: NxN grid → arrow → result -->
		<div class="craft">
			<div class="grid" style="--cols:{craftCols}">
				{#each craftSlots as s (s)}{@render slot(s)}{/each}
			</div>
			<span class="arrow">→</span>
			<div class="result">{@render slot(resultSlot, true)}</div>
			<span class="label">{isTable ? 'crafting table' : 'crafting'}</span>
		</div>

		<!-- Main inventory 3×9 -->
		<div class="grid main" style="--cols:9">
			{#each mainSlots as s (s)}{@render slot(s)}{/each}
		</div>
	{/if}

	<!-- Hotbar (always shown, like the in-game HUD; selected slot highlighted) -->
	<div class="grid hotbar" style="--cols:9">
		{#each hotbar as s, i (s)}{@render slot(s, false, i === sel)}{/each}
	</div>
</div>

<style>
	.inv {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		background: rgba(20, 22, 28, 0.92);
		border: 2px solid #3a3f4b;
		border-radius: 8px;
		width: max-content;
		font-family: ui-monospace, monospace;
	}
	.craft {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid #2a2f3a;
		position: relative;
	}
	.craft .label {
		position: absolute;
		right: 2px;
		top: -2px;
		font-size: 9px;
		color: #6b7280;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}
	.arrow {
		color: #9aa3b2;
		font-size: 18px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(var(--cols), 1fr);
		gap: 2px;
	}
	.main {
		margin-top: 2px;
	}
	.slot {
		width: 30px;
		height: 30px;
		background: #2b2f38;
		border: 1px solid #1c2027;
		border-radius: 3px;
		position: relative;
		display: grid;
		place-items: center;
	}
	.slot.big {
		width: 36px;
		height: 36px;
		background: #34404a;
	}
	/* selected hotbar slot — the in-game white selection box */
	.slot.sel {
		border-color: #ffffff;
		box-shadow:
			0 0 0 2px #ffffff,
			0 0 7px rgba(255, 255, 255, 0.45);
		background: #3b4350;
		z-index: 1;
	}
	/* HUD mode: just the hotbar, tighter and unobtrusive */
	.inv.hud {
		padding: 5px 6px;
		gap: 0;
	}
	.slot img {
		width: 24px;
		height: 24px;
		image-rendering: pixelated;
	}
	.slot.big img {
		width: 30px;
		height: 30px;
	}
	.cnt {
		position: absolute;
		right: 1px;
		bottom: -1px;
		font-size: 11px;
		font-weight: 700;
		color: #fff;
		text-shadow: 1px 1px 0 #000;
		line-height: 1;
	}
</style>

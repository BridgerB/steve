/**
 * dig-pillar — build your own island out of the ocean.
 *
 * Physics reality (typecraft): NO buoyancy, jump is IGNORED in water. The ONLY lift
 * in water is the wall-collision `outOfLiquidImpulse` (~0.3) applied when you press
 * FORWARD into a solid block that has headroom above it. So a classic "place under
 * feet + jump onto it" pillar does NOT work while submerged — jump does nothing.
 *
 * The mechanic that DOES work is a self-built STAIRCASE: place a block adjacent at
 * foot level, then press forward into its face → the impulse hops you up onto it
 * (+1 y). Repeat in ONE committed direction, ascending, until you stand on a block
 * whose top is above the water surface.
 *
 * The subtlety is the FINISH: a 1-wide stair lets the bot drift off the top block
 * into adjacent water and float (never onGround → never "dry"). Fix: build each
 * tread 2 blocks wide (forward + perpendicular) so the drift lands on solid, and
 * once the head clears the water (inWater=false) lay a small pad and stop so the bot
 * settles onGround.
 *
 * Blocks come from RCON /give (proof) or HAND-DIGGING the sand/dirt/gravel floor
 * (real-spawn version). PILLAR_GIVE=0 forces the dig-your-own path.
 */
import { connect } from "../src/lib/steve/lib/rcon.ts";
import { getBlock, isOnDryLand } from "../src/lib/steve/lib/bot-utils.ts";

const vec3 = (x: number, y: number, z: number) => ({ x, y, z });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const GIVE = process.env.PILLAR_GIVE !== "0"; // default: /give cobblestone proof
const BOT = process.env.BOT ?? "Water2";

const FILLER = (name: string): boolean =>
	name.includes("cobblestone") ||
	name === "dirt" ||
	name.includes("sand") ||
	name.includes("gravel") ||
	name === "stone" ||
	name.includes("deepslate");

// A cell is NOT solid footing/step if it's air, a liquid, or a passable plant.
const isSoft = (name: string | undefined): boolean =>
	!name || /air|water|lava|seagrass|kelp|grass|fern|lily|vine|snow/.test(name);

const col = (bot: any, dx = 0, dz = 0): string => {
	const p = bot.entity.position;
	const fx = Math.floor(p.x) + dx;
	const fz = Math.floor(p.z) + dz;
	const fy = Math.floor(p.y);
	const out: string[] = [];
	for (let y = fy + 2; y >= fy - 3; y--) {
		out.push(`${y}:${getBlock(bot, vec3(fx, y, fz))?.name ?? "?"}`);
	}
	return out.join(" ");
};

const fillerCount = (bot: any): number =>
	bot.inventory.slots
		.filter((s: any) => s && FILLER(s.name))
		.reduce((n: number, s: any) => n + s.count, 0);

/** Actively swim onto the nearest floating item to collect it — collectDrops' default
 *  auto-pickup (~1 block) misses drops that float up/away underwater, so we steer the
 *  bot's hitbox onto the item. Returns when picked up (inventory grew) or times out. */
const collectNear = async (bot: any, itemType: number | undefined, ms: number): Promise<void> => {
	const before = bot.inventory.slots.reduce((n: number, s: any) => n + (s?.count ?? 0), 0);
	const end = Date.now() + ms;
	let logged = false;
	while (Date.now() < end) {
		let nearest: any = null;
		let nd = Infinity;
		let itemCount = 0;
		for (const e of Object.values(bot.entities) as any[]) {
			if (e.id === bot.entity?.id) continue;
			if (itemType != null && e.entityType !== itemType) continue;
			itemCount++;
			const d = Math.hypot(
				e.position.x - bot.entity.position.x,
				e.position.y - bot.entity.position.y,
				e.position.z - bot.entity.position.z,
			);
			if (d < nd) {
				nd = d;
				nearest = e;
			}
		}
		if (!logged) {
			console.log(
				`[dig-pillar]   collect: items=${itemCount} nearestDist=${nd === Infinity ? "none" : nd.toFixed(1)} totalEnts=${Object.keys(bot.entities).length} itemType=${itemType}`,
			);
			logged = true;
		}
		const now = bot.inventory.slots.reduce((n: number, s: any) => n + (s?.count ?? 0), 0);
		if (now > before) break; // picked something up
		if (!nearest) {
			await sleep(120);
			continue;
		}
		await bot.lookAt(vec3(nearest.position.x, nearest.position.y, nearest.position.z), true);
		bot.setControlState("forward", true);
		bot.setControlState("jump", true); // out-of-liquid impulse nudges us up toward it
		await sleep(140);
	}
	bot.setControlState("forward", false);
	bot.setControlState("jump", false);
};

/** Select a hotbar slot holding a placeable filler; move one up from main inv if needed. */
const equipFiller = async (bot: any): Promise<boolean> => {
	if (bot.heldItem && FILLER(bot.heldItem.name)) return true;
	const hot = bot.inventory.slots.findIndex(
		(s: any, i: number) => i >= 36 && i <= 44 && s && FILLER(s.name),
	);
	if (hot >= 0) {
		bot.setQuickBarSlot(hot - 36);
		return true;
	}
	const slot = bot.inventory.slots.findIndex((s: any) => s && FILLER(s.name));
	if (slot < 0) return false;
	try {
		await bot.clickWindow(slot, 0, 0);
		await bot.clickWindow(36, 0, 0);
		bot.setQuickBarSlot(0);
	} catch {
		/* ignore */
	}
	return bot.heldItem != null && FILLER(bot.heldItem.name);
};

/** Place a block at (x,y,z), verifying it lands. Tries the TOP face of the ground
 *  cell (x,y-1,z) first, then SIDE faces of any solid horizontal neighbour (lets us
 *  fill a water cell over a water floor as long as one neighbour is already solid).
 *  No-op (true) if the cell is already solid; false if nothing to place against. */
const placeAt = async (bot: any, x: number, y: number, z: number): Promise<boolean> => {
	const dest = getBlock(bot, vec3(x, y, z));
	if (dest && !isSoft(dest.name)) return true;
	// Candidate reference faces: [refCell, faceVec] pairs.
	const refs: Array<{ ref: [number, number, number]; face: [number, number, number] }> = [
		{ ref: [x, y - 1, z], face: [0, 1, 0] }, // top of ground below
		{ ref: [x - 1, y, z], face: [1, 0, 0] },
		{ ref: [x + 1, y, z], face: [-1, 0, 0] },
		{ ref: [x, y, z - 1], face: [0, 0, 1] },
		{ ref: [x, y, z + 1], face: [0, 0, -1] },
	];
	for (let a = 0; a < 4; a++) {
		if (!(await equipFiller(bot))) return false;
		let placed = false;
		for (const { ref, face } of refs) {
			const refBlock = getBlock(bot, vec3(ref[0], ref[1], ref[2]));
			if (!refBlock || isSoft(refBlock.name)) continue;
			await bot.lookAt(vec3(x + 0.5, y + 0.5, z + 0.5), true);
			try {
				await Promise.race([
					bot.placeBlock(refBlock, vec3(face[0], face[1], face[2])) as Promise<void>,
					sleep(1400).then(() => {
						throw new Error("place timeout");
					}),
				]);
			} catch {
				/* server-rejected / hung — try next face */
			}
			await sleep(220);
			const now = getBlock(bot, vec3(x, y, z));
			if (now && !isSoft(now.name)) return true;
			placed = true; // we had a valid ref; retry loop
		}
		if (!placed) return false; // no valid reference face exists yet
	}
	return false;
};

/** Fill a 3x3 pad of solid blocks at level y around (cx,cz) so the bot stands dry no
 *  matter which cell its hitbox settles over. Returns how many cells are solid after. */
const buildPad = async (bot: any, cx: number, y: number, cz: number): Promise<number> => {
	// Nearest-first so we always have an adjacent solid to side-place the ring against.
	const cells: [number, number][] = [
		[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
		[1, 1], [1, -1], [-1, 1], [-1, -1],
	];
	for (const [dx, dz] of cells) {
		if (fillerCount(bot) < 1) break;
		await placeAt(bot, cx + dx, y, cz + dz);
	}
	return cells.filter(
		([dx, dz]) => !isSoft(getBlock(bot, vec3(cx + dx, y, cz + dz))?.name),
	).length;
};

/** Ensure we hold at least one filler; in dig mode, hand-dig an adjacent floor block. */
const ensureFiller = async (bot: any, rcon: any, dx: number, dz: number): Promise<boolean> => {
	if (fillerCount(bot) > 0) return true;
	if (rcon) {
		await rcon.command(`/give ${BOT} cobblestone 16`);
		await sleep(500);
		return fillerCount(bot) > 0;
	}
	const p = bot.entity.position;
	const fx = Math.floor(p.x);
	const fy = Math.floor(p.y);
	const fz = Math.floor(p.z);
	// Dig an ADJACENT floor block (never the one under our own feet) for a drop.
	for (const [ox, oz] of [[dx, dz], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
		if (ox === 0 && oz === 0) continue;
		const b = getBlock(bot, vec3(fx + ox, fy - 1, fz + oz));
		if (!b || !/sand|dirt|gravel|clay|tuff/.test(b.name)) continue;
		await bot.lookAt(vec3(fx + ox + 0.5, fy - 0.5, fz + oz + 0.5), true);
		await Promise.race([
			(bot.dig(b, true) as Promise<void>).catch(() => {}),
			sleep(6000),
		]);
		bot.stopDigging?.();
		// Drops sink to the floor beside us in water; auto-pickup needs us close.
		await bot.collectDrops?.(3, 2500, async () => {});
		await sleep(500);
		if (fillerCount(bot) > 0) return true;
	}
	return fillerCount(bot) > 0;
};

export const escape = async (bot: any): Promise<void> => {
	// Always connect for SETUP (cleanup / optional /give). In dig mode we never /give
	// during the run — rcon is used only to reset the test to a fresh-spawn state.
	const setup = await connect();
	// Clean up blocks a PRIOR run left in the world so each test starts identical:
	// replace any placed solids sitting in/above the water (y61-66) back to water,
	// without touching the natural floor (y<=60). Keeps runs reproducible.
	const p = bot.entity.position;
	const cx = Math.round(p.x);
	const cz = Math.round(p.z);
	for (const kind of ["cobblestone", "dirt", "sand", "gravel"]) {
		await setup.command(
			`/fill ${cx - 6} 61 ${cz - 6} ${cx + 6} 66 ${cz + 6} water replace ${kind}`,
		);
	}
	// Kill floating item entities a prior run dropped — otherwise the bot vacuums up
	// free blocks from the seafloor and never truly digs (invalidates the dig test).
	await setup.command(
		`/execute positioned ${cx} 62 ${cz} run kill @e[type=item,distance=..40]`,
	);
	await sleep(500);

	const rcon = GIVE ? setup : null;
	if (rcon) {
		await rcon.command(`/give ${BOT} cobblestone 32`);
		await sleep(600);
	} else {
		// Simulate a real spawn: empty the bot's inventory so it MUST dig its own blocks.
		await setup.command(`/clear ${BOT}`);
		await sleep(400);
	}
	console.log(`[dig-pillar] start give=${GIVE} filler=${fillerCount(bot)} col=[${col(bot)}]`);

	// 1) Sink to the floor: no buoyancy, so release controls and wait to settle.
	bot.clearControlStates();
	for (let i = 0; i < 20 && !bot.entity.onGround; i++) await sleep(150);
	console.log(
		`[dig-pillar] settled y=${bot.entity.position.y.toFixed(2)} onGround=${bot.entity.onGround} inWater=${bot.entity.isInWater} col=[${col(bot)}]`,
	);

	// 1b) DIG-YOUR-OWN: once we climb off the floor we can't reach it again, so mine a
	//     stockpile of floor blocks NOW while standing on the bottom. Dig the DIAGONAL
	//     neighbours first (they're never the orthogonal cells we step onto), then the
	//     off-axis orthogonals — leaving intact ground ahead to build the staircase on.
	if (!rcon) {
		const target = 8;
		const stockDeadline = Date.now() + 42000; // don't burn the whole budget digging
		// The bot often rests ON the passable seagrass/plants and never reaches solid
		// ground, so underwater mining is 10-25x slower and never completes. Dig the
		// perch out from under our feet until we stand onGround on the solid floor —
		// then digs finish in ~4s and drops land right at us.
		for (let i = 0; i < 8 && !bot.entity.onGround; i++) {
			const q = bot.entity.position;
			const perch = getBlock(bot, vec3(Math.floor(q.x), Math.floor(q.y) - 1, Math.floor(q.z)));
			if (!perch || perch.name.includes("water") || !isSoft(perch.name)) {
				// Nothing passable underfoot to remove — just wait to sink.
				bot.clearControlStates();
				await sleep(300);
				continue;
			}
			await bot.lookAt(vec3(perch.position.x + 0.5, perch.position.y + 0.5, perch.position.z + 0.5), true);
			await Promise.race([(bot.dig(perch, true) as Promise<void>).catch(() => {}), sleep(2000)]);
			bot.stopDigging?.();
			bot.clearControlStates();
			await sleep(300);
		}
		const p0 = bot.entity.position;
		const bx = Math.floor(p0.x);
		const by = Math.floor(p0.y);
		const bz = Math.floor(p0.z);
		console.log(
			`[dig-pillar] descended y=${p0.y.toFixed(2)} onGround=${bot.entity.onGround} col=[${col(bot)}]`,
		);
		// Clean slate for a HONEST dig test: nuke floating items at the bot's actual
		// spot and re-empty the inventory, so every block below is one we truly dug.
		await setup.command(
			`/execute positioned ${bx} ${by} ${bz} run kill @e[type=item,distance=..25]`,
		);
		await setup.command(`/clear ${BOT}`);
		await sleep(400);
		console.log(`[dig-pillar] pre-dig clean, filler=${fillerCount(bot)}`);
		const itemType = bot.registry?.entitiesByName?.get("item")?.id;
		const diggable = (name?: string) => !!name && /sand|dirt|gravel|clay|tuff|mud/.test(name);
		// Find the actual seafloor top by scanning DOWN from the bot — robust to the bot
		// floating mid-water instead of resting onGround.
		const floorTopY = (): number => {
			const c = bot.entity.position;
			const sx = Math.floor(c.x);
			const sz = Math.floor(c.z);
			for (let y = Math.floor(c.y); y >= Math.floor(c.y) - 6; y--) {
				const b = getBlock(bot, vec3(sx, y, sz));
				if (b && !isSoft(b.name)) return y; // first solid cell = floor top
			}
			return Math.floor(c.y) - 1;
		};
		// Orthogonal-adjacent floor first (drop lands closest → easiest to swim onto).
		const ring: [number, number][] = [
			[1, 0], [-1, 0], [0, 1], [0, -1],
			[1, 1], [1, -1], [-1, 1], [-1, -1],
		];
		const digStart = Date.now();
		for (let depth = 0; depth < 2 && fillerCount(bot) < target; depth++) {
			for (const [ox, oz] of ring) {
				if (fillerCount(bot) >= target || Date.now() > stockDeadline) break;
				const c = bot.entity.position;
				const qx = Math.floor(c.x);
				const qz = Math.floor(c.z);
				const dy = floorTopY() - depth; // dig the floor cell (and one below for depth)
				const b = getBlock(bot, vec3(qx + ox, dy, qz + oz));
				if (!diggable(b?.name)) continue;
				const t0 = Date.now();
				const was = fillerCount(bot);
				await bot.lookAt(vec3(qx + ox + 0.5, dy + 0.5, qz + oz + 0.5), true);
				await Promise.race([
					(bot.dig(b, true) as Promise<void>).catch(() => {}),
					sleep(14000),
				]);
				bot.stopDigging?.();
				const broke = isSoft(getBlock(bot, vec3(qx + ox, dy, qz + oz))?.name);
				const digMs = Date.now() - t0;
				await collectNear(bot, itemType, 3000);
				await sleep(150);
				console.log(
					`[dig-pillar] mined ${b.name} @${qx + ox},${dy},${qz + oz} dig=${digMs}ms broke=${broke} got=${fillerCount(bot) > was} → stock=${fillerCount(bot)}`,
				);
				bot.clearControlStates();
				await sleep(400); // let the bot re-sink after the collecting swim
			}
		}
		const inv = bot.inventory.slots
			.filter((s: any) => s)
			.map((s: any) => `${s.name}x${s.count}`)
			.join(",");
		console.log(
			`[dig-pillar] STOCKED ${fillerCount(bot)} blocks in ${Date.now() - digStart}ms, y=${bot.entity.position.y.toFixed(2)} inv=[${inv}]`,
		);
	}

	// Commit to ONE horizontal direction so the treads form a coherent staircase.
	const DIRS: [number, number][] = [[1, 0], [0, 1], [-1, 0], [0, -1]];
	let dirIdx = 0;
	let dir = DIRS[dirIdx];
	const perp = (d: [number, number]): [number, number] => [d[1], d[0]]; // 90° turn

	const deadline = Date.now() + 66000;
	let lastY = Math.floor(bot.entity.position.y);
	let stalls = 0;

	while (Date.now() < deadline) {
		if (isOnDryLand(bot)) {
			bot.clearControlStates();
			await sleep(350);
			if (isOnDryLand(bot)) {
				console.log(`[dig-pillar] DRY at y=${bot.entity.position.y.toFixed(2)}`);
				return;
			}
		}

		const p = bot.entity.position;
		const fx = Math.floor(p.x);
		const fy = Math.floor(p.y);
		const fz = Math.floor(p.z);
		const [dx, dz] = dir;
		const [px, pz] = perp(dir);

		if (!(await ensureFiller(bot, rcon, dx, dz))) {
			console.log(`[dig-pillar] out of blocks, filler=${fillerCount(bot)}`);
			break;
		}

		// If the head has cleared the water, we're at the top — stop drifting and CAP:
		// lay a 3x3 pad at the bot's support level so it settles onGround on solid no
		// matter which cell its hitbox straddles.
		if (!bot.entity.isInWater) {
			bot.clearControlStates();
			await sleep(200);
			const q = bot.entity.position;
			const supportY = Math.floor(q.y) - 1;
			const solid = await buildPad(bot, Math.floor(q.x), supportY, Math.floor(q.z));
			console.log(
				`[dig-pillar] CAP at y=${q.y.toFixed(2)} supportY=${supportY} solidCells=${solid}/9 col=[${col(bot)}]`,
			);
			// Nudge to pad centre then settle.
			await bot.lookAt(vec3(Math.floor(q.x) + 0.5, Math.floor(q.y), Math.floor(q.z) + 0.5), true);
			bot.clearControlStates();
			for (let s = 0; s < 10 && !isOnDryLand(bot); s++) await sleep(150);
			continue;
		}

		// Build a 3-wide tread at foot level ahead, spanning the perpendicular (drift)
		// axis. Critically this ALSO leaves lateral ground one level down for the NEXT
		// step to place against — a 1-wide stair strands the bot with no ground to build
		// the following step on. Drift after the hop also lands on solid, not water.
		const stepOk = await placeAt(bot, fx + dx, fy, fz + dz);
		await placeAt(bot, fx + dx + px, fy, fz + dz + pz);
		await placeAt(bot, fx + dx - px, fy, fz + dz - pz);
		console.log(
			`[dig-pillar] tread dir=${dx},${dz} at y=${fy} step=${stepOk} filler=${fillerCount(bot)} inWater=${bot.entity.isInWater}`,
		);

		if (!stepOk) {
			dir = DIRS[++dirIdx % DIRS.length];
			stalls = 0;
			continue;
		}

		// Climb onto the tread: press forward into the step face. In water this triggers
		// outOfLiquidImpulse (jump is ignored). Cut forward the INSTANT we rise a level so
		// we settle onto the tread instead of over-running it into open water.
		await bot.lookAt(vec3(fx + dx + 0.5, fy + 0.5, fz + dz + 0.5), true);
		bot.setControlState("forward", true);
		const climbEnd = Date.now() + 3000;
		while (Date.now() < climbEnd) {
			await sleep(60);
			if (Math.floor(bot.entity.position.y) > fy) break;
		}
		bot.setControlState("forward", false);
		// Let the bot fall onto and settle on the tread.
		for (let s = 0; s < 12 && !bot.entity.onGround; s++) await sleep(80);
		await sleep(150);

		const newY = Math.floor(bot.entity.position.y);
		console.log(
			`[dig-pillar] climbed y=${bot.entity.position.y.toFixed(2)} onGround=${bot.entity.onGround} inWater=${bot.entity.isInWater} col=[${col(bot)}]`,
		);

		if (newY > lastY) {
			lastY = newY;
			stalls = 0;
		} else if (++stalls >= 3) {
			dir = DIRS[++dirIdx % DIRS.length];
			stalls = 0;
		}
	}
	bot.clearControlStates();
	console.log(`[dig-pillar] give up dry=${isOnDryLand(bot)} y=${bot.entity.position.y.toFixed(2)}`);
};

export default escape;

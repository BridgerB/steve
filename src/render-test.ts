/**
 * One-block-at-a-time render test in a pure-air void.
 *
 * Setup:
 *   - Clear a huge area to air (covers everything in viewer view distance).
 *   - StudioBot hovers at (0.5, 3, 0.5) looking straight down.
 *   - Test slot at (0, 0, 0). Section (0, 0, 0) contains only this block.
 *
 * Per block:
 *   1. /setblock 0 0 0 <name>
 *   2. Wait ~250ms for chunk update + mesher.
 *   3. Query section "0,0,0" — if mesh exists with verts > 0, block rendered.
 *   4. Log {name, rendered, verts}.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { createRcon } from "typecraft";

const RCON_PASS = "minecraft-test-rcon";
const VIEWER_URL = "http://localhost:3001";
const TEST_POS = { x: 0, y: 0, z: 0 };
const SECTION_KEY = "0,0,0";
const REPORT_PATH = "/tmp/render-report.json";
const RETRY_REPORT_PATH = "/tmp/render-retry.json";

const main = async () => {
	// Mode: full sweep (no arg) OR retry-failures (--retry) which reads previous report
	const retry = process.argv.includes("--retry");
	let names: string[];
	if (retry) {
		const prev = JSON.parse(readFileSync(REPORT_PATH, "utf8")) as {
			name: string;
			rendered: boolean;
		}[];
		names = prev.filter((p) => !p.rendered).map((p) => p.name);
		console.log(`retry mode: testing ${names.length} previously-broken blocks`);
	} else {
		const blocks = JSON.parse(
			readFileSync(
				"/mnt/developer-ssd/Developer/typecraft/src/data/blocks.json",
				"utf8",
			),
		) as { name: string }[];
		const skip = new Set([
			"air",
			"cave_air",
			"void_air",
			"piston_head",
			"moving_piston",
			"bubble_column",
			"fire",
			"soul_fire",
			"water",
			"lava",
			"attached_pumpkin_stem",
			"attached_melon_stem",
			"pumpkin_stem",
			"melon_stem",
			"wheat",
			"beetroots",
			"carrots",
			"potatoes",
			"cocoa",
			"sweet_berry_bush",
			"cave_vines",
			"cave_vines_plant",
			"frosted_ice",
			"end_gateway",
			"end_portal",
			"nether_portal",
			"redstone_wire",
			"tripwire",
		]);
		names = blocks.map((b) => b.name).filter((n) => !skip.has(n));
		console.log(`full sweep: testing ${names.length} blocks`);
	}

	const r = await createRcon({
		host: "localhost",
		port: 25575,
		password: RCON_PASS,
	});

	// 1. Clear a massive area to pure air (huge so nothing else stays loaded)
	console.log("clearing 500x500 world to air (this takes a while)...");
	const X1 = -500,
		X2 = 500,
		Z1 = -500,
		Z2 = 500,
		Y1 = -64,
		Y2 = 320;
	const QW = 100,
		QH = 3;
	let clearCount = 0;
	for (let y = Y1; y <= Y2; y += QH) {
		const y2 = Math.min(y + QH - 1, Y2);
		for (let x = X1; x <= X2; x += QW) {
			for (let z = Z1; z <= Z2; z += QW) {
				const x2 = Math.min(x + QW - 1, X2);
				const z2 = Math.min(z + QW - 1, Z2);
				await r.command(`fill ${x} ${y} ${z} ${x2} ${y2} ${z2} air`);
				clearCount++;
			}
		}
	}
	console.log(`done ${clearCount} fill commands`);

	// 2. Creative + perch 20 blocks above test slot (different section, so
	// perch/bot geometry doesn't contaminate section 0,0,0 used for the scan).
	// Also place a support block one below the test slot so falling blocks
	// (sand, gravel, anvil, concrete_powder) don't fall into the void.
	// Support is in section 0,-16,0 — different from test section 0,0,0.
	await r.command("gamemode creative StudioBot");
	await r.command(`setblock ${TEST_POS.x} 19 ${TEST_POS.z} glass`);
	// Layer support: bedrock at Y=-2 holds sand at Y=-1, which supports plants
	// like cactus/sugar_cane/bamboo on top while still being a clean platform.
	await r.command(
		`setblock ${TEST_POS.x} ${TEST_POS.y - 2} ${TEST_POS.z} bedrock`,
	);
	await r.command(
		`setblock ${TEST_POS.x} ${TEST_POS.y - 1} ${TEST_POS.z} sand`,
	);
	await r.command(
		`tp StudioBot ${TEST_POS.x + 0.5} 20 ${TEST_POS.z + 0.5} 0 90`,
	);

	// 3. Launch Playwright + open viewer
	// System Chromium (Playwright's bundled build lacks libs on NixOS).
	// Override with CHROMIUM_PATH; falls back to Playwright's own binary.
	const chromiumPath = process.env.CHROMIUM_PATH;
	const browser = await chromium.launch({
		headless: true,
		...(chromiumPath ? { executablePath: chromiumPath } : {}),
		args: ["--no-sandbox", "--disable-dev-shm-usage"],
	});
	const page = await browser.newPage();
	await page.goto(VIEWER_URL);
	console.log("waiting 10s for viewer assets to load...");
	await new Promise((r) => setTimeout(r, 10000));

	const getSectionVerts = async (): Promise<number> =>
		page.evaluate((key) => {
			const v = (
				window as unknown as {
					__viewer?: {
						worldRenderer: {
							sectionMeshes: Map<string, { getTotalVertices: () => number }>;
						};
					};
				}
			).__viewer;
			if (!v) return -1;
			const mesh = v.worldRenderer.sectionMeshes.get(key);
			return mesh ? mesh.getTotalVertices() : 0;
		}, SECTION_KEY);

	const report: { name: string; rendered: boolean; verts: number }[] = [];

	for (let i = 0; i < names.length; i++) {
		const name = names[i]!;
		await r.command(`setblock ${TEST_POS.x} ${TEST_POS.y} ${TEST_POS.z} air`);
		await new Promise((r) => setTimeout(r, 150));
		try {
			await r.command(
				`setblock ${TEST_POS.x} ${TEST_POS.y} ${TEST_POS.z} ${name}`,
			);
		} catch {
			console.log(`${i + 1}/${names.length} ${name} → SETBLOCK FAIL`);
			report.push({ name, rendered: false, verts: -1 });
			continue;
		}
		await new Promise((r) => setTimeout(r, 220));
		const verts = await getSectionVerts();
		const rendered = verts > 0;
		report.push({ name, rendered, verts });
		console.log(
			`${(i + 1).toString().padStart(4)}/${names.length} ${rendered ? "✓" : "✗"} ${name} (verts=${verts})`,
		);

		if ((i + 1) % 25 === 0)
			writeFileSync(
				retry ? RETRY_REPORT_PATH : REPORT_PATH,
				JSON.stringify(report, null, 2),
			);
	}

	const path = retry ? RETRY_REPORT_PATH : REPORT_PATH;
	writeFileSync(path, JSON.stringify(report, null, 2));
	const broken = report.filter((r) => !r.rendered);
	const newlyFixed = retry
		? report.filter((r) => r.rendered).map((r) => r.name)
		: [];
	console.log(
		`\nResult: ${broken.length}/${report.length} blocks did NOT render`,
	);
	if (retry) console.log(`Newly fixed: ${newlyFixed.length}`);
	console.log(`report saved to ${path}`);

	await browser.close();
	await r.close();
};

main().catch((e) => {
	console.error(e);
	process.exit(1);
});

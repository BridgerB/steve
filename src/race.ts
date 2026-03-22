/**
 * Race N Steve instances to craft a wooden pickaxe.
 * Each gets its own MC server on a unique port with a random seed.
 * First to get a pickaxe wins, all others die.
 *
 * Usage: node src/race.ts [count] [timeout_seconds]
 *   node src/race.ts 3 300
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const COUNT = parseInt(process.argv[2] ?? "3");
const TIMEOUT = parseInt(process.argv[3] ?? "300") * 1000;
const BASE_PORT = 25600;
const BASE_RCON = 25700;
const ROOT = process.cwd();
const JAR = process.env.MC_SERVER_JAR ?? join(ROOT, "server/versions/1.21.11/server-1.21.11.jar");
const JAVA = process.env.JAVA_BIN ?? "java";

interface InstanceResult {
  idx: number;
  seed: string;
  elapsed: number;
  gotPickaxe: boolean;
  inventory: string;
}

const allProcs: ChildProcess[] = [];
let winner: number | null = null;

const killAll = () => {
  for (const p of allProcs) p.kill();
};
process.on("SIGINT", () => { killAll(); process.exit(0); });
process.on("SIGTERM", () => { killAll(); process.exit(0); });

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const waitForPort = async (port: number, timeout = 60000): Promise<boolean> => {
  const { createConnection } = await import("node:net");
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const ok = await new Promise<boolean>((resolve) => {
      const sock = createConnection(port, "localhost");
      sock.on("connect", () => { sock.destroy(); resolve(true); });
      sock.on("error", () => { sock.destroy(); resolve(false); });
    });
    if (ok) return true;
    await sleep(500);
  }
  return false;
};

const checkForPickaxe = (dataDir: string): boolean => {
  if (!existsSync(dataDir)) return false;
  const dbs = readdirSync(dataDir).filter((f) => f.endsWith(".db")).sort().reverse();
  if (dbs.length === 0) return false;
  try {
    const db = new Database(join(dataDir, dbs[0]!));
    const row = db.prepare("SELECT COUNT(*) as c FROM inventory_snapshots WHERE item_name LIKE '%pickaxe%'").get() as { c: number };
    db.close();
    return row.c > 0;
  } catch {
    return false;
  }
};

const getInventory = (dataDir: string): string => {
  if (!existsSync(dataDir)) return "no data";
  const dbs = readdirSync(dataDir).filter((f) => f.endsWith(".db")).sort().reverse();
  if (dbs.length === 0) return "no data";
  try {
    const db = new Database(join(dataDir, dbs[0]!));
    const rows = db.prepare("SELECT item_name || 'x' || MAX(count) as inv FROM inventory_snapshots GROUP BY item_name ORDER BY MAX(count) DESC LIMIT 5").all() as { inv: string }[];
    db.close();
    return rows.map((r) => r.inv).join(", ") || "empty";
  } catch {
    return "db error";
  }
};

const runInstance = async (idx: number): Promise<InstanceResult> => {
  const port = BASE_PORT + idx;
  const rconPort = BASE_RCON + idx;
  const seed = `${RACE_ID}-${idx}`;
  const runDir = join(ROOT, "data", "instances", RACE_ID, String(idx));
  const serverDir = join(runDir, "server");
  const dataDir = runDir;

  rmSync(runDir, { recursive: true, force: true });
  mkdirSync(serverDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  writeFileSync(join(serverDir, "eula.txt"), "eula=true\n");
  writeFileSync(join(serverDir, "server.properties"), [
    "max-players=2", "online-mode=false", "pvp=false",
    "difficulty=normal", "gamemode=survival", "enable-command-block=true",
    "spawn-protection=0", "view-distance=10", "simulation-distance=6",
    `server-port=${port}`, `level-seed=${seed}`,
    "white-list=false", "spawn-monsters=true", "spawn-animals=true",
    "spawn-npcs=true", "rate-limit=0", "enable-rcon=true",
    "rcon.password=test", `rcon.port=${rconPort}`,
  ].join("\n"));

  writeFileSync(join(serverDir, "ops.json"), JSON.stringify([
    { uuid: "5627dd98-e6be-3c21-b8a8-e92344183641", name: "Steve", level: 4, bypassesPlayerLimit: true },
  ]));

  console.log(`[${idx}] port=${port} seed=${seed}`);

  // Start server
  // Stagger startups to avoid resource contention
  await sleep(idx * 3000);

  // Copy the main server dir (has extracted libraries) and override config
  const mainServerDir = join(ROOT, "server");
  const { cpSync } = await import("node:fs");
  cpSync(mainServerDir, serverDir, { recursive: true });
  // Remove old world data — let it generate fresh with our seed
  rmSync(join(serverDir, "world"), { recursive: true, force: true });
  // Override config
  writeFileSync(join(serverDir, "server.properties"), [
    "max-players=2", "online-mode=false", "pvp=false",
    "difficulty=normal", "gamemode=survival", "enable-command-block=true",
    "spawn-protection=0", "view-distance=10", "simulation-distance=6",
    `server-port=${port}`, `level-seed=${seed}`,
    "white-list=false", "spawn-monsters=true", "spawn-animals=true",
    "spawn-npcs=true", "rate-limit=0", "enable-rcon=true",
    "rcon.password=test", `rcon.port=${rconPort}`,
  ].join("\n"));

  const serverLog = join(runDir, "server.log");
  const { openSync } = await import("node:fs");
  const logFd = openSync(serverLog, "w");

  const serverProc = spawn(JAVA, ["-Xmx1G", "-Xms1G", "-jar", JAR, "nogui"], {
    cwd: serverDir,
    stdio: ["ignore", logFd, logFd],
  });
  allProcs.push(serverProc);

  if (!await waitForPort(port)) {
    console.log(`[${idx}] server failed`);
    return { idx, seed, elapsed: 0, gotPickaxe: false, inventory: "server failed" };
  }
  await sleep(5000);
  console.log(`[${idx}] server ready`);

  // Start Steve
  const steveProc = spawn(process.execPath, [join(ROOT, "src/main.ts")], {
    cwd: ROOT,
    env: { ...process.env, MC_PORT: String(port), STEVE_DATA_DIR: dataDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  allProcs.push(steveProc);

  steveProc.stdout?.on("data", (d: Buffer) => {
    for (const line of d.toString().split("\n")) {
      if (line.includes("✓") || line.includes("✗") || line.includes("[wood]") || line.includes("[steve]")) {
        console.log(`[${idx}] ${line.trim()}`);
      }
    }
  });

  steveProc.stderr?.on("data", (d: Buffer) => {
    console.error(`[${idx}] ERR: ${d.toString().trim()}`);
  });

  const start = Date.now();

  while (Date.now() - start < TIMEOUT && winner === null) {
    await sleep(3000);
    if (steveProc.exitCode !== null) break;
    if (checkForPickaxe(dataDir)) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      winner = idx;
      const dbFile = readdirSync(dataDir).filter((f) => f.endsWith(".db")).sort().reverse()[0] ?? "";
      console.log(`\n=== [${idx}] WINNER — wooden pickaxe in ${elapsed}s ===`);
      console.log(`    seed: ${seed}`);
      console.log(`    db:   ${join(dataDir, dbFile)}\n`);
      killAll();
      return { idx, seed, elapsed, gotPickaxe: true, inventory: "wooden_pickaxe" };
    }
  }

  if (winner !== null && winner !== idx) {
    steveProc.kill();
    serverProc.kill();
    const elapsed = Math.round((Date.now() - start) / 1000);
    return { idx, seed, elapsed, gotPickaxe: false, inventory: getInventory(dataDir) };
  }

  const elapsed = Math.round((Date.now() - start) / 1000);
  const inventory = getInventory(dataDir);
  console.log(`[${idx}] timeout ${elapsed}s | ${inventory}`);
  steveProc.kill();
  serverProc.kill();
  return { idx, seed, elapsed, gotPickaxe: false, inventory };
};

const RACE_ID = new Date().toISOString().replace(/:/g, "-");

console.log(`Race ${RACE_ID} — ${COUNT} Steves (timeout=${TIMEOUT / 1000}s)\n`);
Promise.all(Array.from({ length: COUNT }, (_, i) => runInstance(i))).then((results) => {
  console.log(`\n${"─".repeat(70)}`);
  console.log(`Race ${RACE_ID}`);
  console.log(`${"─".repeat(70)}`);
  console.log(`${"#".padEnd(4)} ${"seed".padEnd(40)} ${"time".padEnd(8)} ${"result".padEnd(10)} inventory`);
  console.log(`${"─".repeat(70)}`);
  for (const r of results) {
    if (!r) continue;
    const status = r.gotPickaxe ? "PICKAXE" : "timeout";
    console.log(`${String(r.idx).padEnd(4)} ${String(r.seed).padEnd(40)} ${(r.elapsed + "s").padEnd(8)} ${status.padEnd(10)} ${r.inventory}`);
  }
  console.log(`${"─".repeat(70)}`);

  const valid = results.filter(Boolean) as InstanceResult[];
  const winners = valid.filter((r) => r.gotPickaxe);
  if (winners.length > 0) {
    console.log(`${winners.length}/${COUNT} pickaxe — fastest: ${Math.min(...winners.map((r) => r.elapsed))}s`);
  } else {
    console.log(`0/${COUNT} got pickaxe`);
  }
  process.exit(0);
});

/**
 * Refuse to publish any value from the local .env (cycle 7: one public repository feeds 20
 * runners). Scans the added lines of the outgoing commits for every .env value of 6 or more
 * characters. A value already on origin/main is reported but does not block: it is public
 * already, and the fix for it is rotating it.
 *
 *   node scripts/scan-env-leak.ts <base>..<head>      # exit 0 clean, 1 blocked
 *
 * The scanner must not leak what it guards: it prints key names only, never a value or any
 * git output; every error is caught and reported generically; any error blocks (fails
 * closed); values stay in memory, nothing is written. Installed as the pre-push hook.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const say = (s: string) => process.stderr.write(`scan-env-leak: ${s}\n`);
const git = (args: string[]): string => execFileSync("git", args, { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "ignore"] }).toString();

try {
	const range = process.argv[2] ?? "origin/main..HEAD";
	if (!existsSync(".env")) process.exit(0);
	const values = readFileSync(".env", "utf8")
		.split("\n")
		.filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l))
		.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")] as const)
		.filter(([, v]) => v.length >= 6);
	const added = git(["log", "-p", "--no-color", range])
		.split("\n")
		.filter((l) => l.startsWith("+") && !l.startsWith("+++"))
		.join("\n");
	let onMain = "";
	try {
		onMain = git(["grep", "-h", "-F", "-e", "", "origin/main", "--", "."]);
	} catch {
		onMain = "";
	}
	let blocked = false;
	for (const [key, value] of values) {
		if (!added.includes(value)) continue;
		if (onMain.includes(value)) say(`${key} is in ${range} but already public on origin/main (rotate it to fix)`);
		else {
			say(`BLOCKED: the value of ${key} from .env is in ${range}`);
			blocked = true;
		}
	}
	process.exit(blocked ? 1 : 0);
} catch {
	say("BLOCKED: the scan itself failed, so nothing is pushed (details withheld on purpose)");
	process.exit(1);
}

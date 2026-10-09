/**
 * Unpin bandit parameters in data/params.json (STEVE_PARAMS_FILE), keeping their arm
 * counts; print the posteriors. Cycle 5 decision 6: anchor_dy_max and stall_s go live.
 *
 *   node --import ./typecraft-resolve.mjs scripts/ml/unpin.ts anchor_dy_max stall_s
 *   node --import ./typecraft-resolve.mjs scripts/ml/unpin.ts            # just print
 */
import { loadParams, saveParams, summarize } from "../../src/lib/steve/ml/bandit.ts";

const p = loadParams();
for (const name of process.argv.slice(2)) {
	if (!p[name]) throw new Error(`unknown parameter ${name}`);
	delete p[name].pin;
}
if (process.argv.length > 2) saveParams(p);
for (const line of summarize(p)) console.log(line);

/**
 * Linux /proc parsing for the fleet's load sampler, pure (cycle 7 capacity test). `ps %CPU`
 * is a lifetime average and the bot runs in a child of gym-batch, so load is measured from
 * /proc deltas over whole process trees instead.
 */

/** /proc/stat first line → total and idle jiffies. */
export const parseCpuTotals = (procStat: string): { total: number; idle: number } => {
	const f = (procStat.split("\n").find((l) => l.startsWith("cpu ")) ?? "").trim().split(/\s+/).slice(1).map(Number);
	const total = f.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
	const idle = (f[3] ?? 0) + (f[4] ?? 0); // idle + iowait
	return { total, idle };
};

/** /proc/<pid>/stat → ppid, utime+stime (jiffies), rss (pages). The comm field may hold spaces. */
export const parsePidStat = (s: string): { pid: number; ppid: number; jiffies: number; rssPages: number } | null => {
	const close = s.lastIndexOf(")");
	if (close < 0) return null;
	const pid = Number(s.slice(0, s.indexOf(" ")));
	const rest = s.slice(close + 2).split(" ");
	// rest[0] is state (field 3); ppid field 4 → rest[1]; utime 14 → rest[11]; stime 15 → rest[12]; rss 24 → rest[21].
	return { pid, ppid: Number(rest[1]), jiffies: Number(rest[11]) + Number(rest[12]), rssPages: Number(rest[21]) };
};

/** /proc/meminfo → MemAvailable in MB. */
export const parseMemAvailableMb = (meminfo: string): number => Math.round(Number(/MemAvailable:\s+(\d+) kB/.exec(meminfo)?.[1] ?? 0) / 1024);

/** All pids in the tree rooted at `root` (inclusive), from a pid → ppid map. */
export const treeOf = (root: number, ppid: Map<number, number>): number[] => {
	const kids = new Map<number, number[]>();
	for (const [p, pp] of ppid) kids.set(pp, [...(kids.get(pp) ?? []), p]);
	const out: number[] = [];
	const stack = [root];
	while (stack.length) {
		const p = stack.pop()!;
		if (out.includes(p)) continue;
		out.push(p);
		stack.push(...(kids.get(p) ?? []));
	}
	return out;
};

/** CPU % (100 = one core) from two jiffy readings over dtS seconds at `hz` ticks per second. */
export const cpuPct = (j0: number, j1: number, dtS: number, hz = 100): number => (dtS > 0 ? Math.round(((j1 - j0) / hz / dtS) * 1000) / 10 : 0);

/** Machine CPU % busy (100 = all cores) between two /proc/stat totals. */
export const machinePct = (a: { total: number; idle: number }, b: { total: number; idle: number }): number => {
	const dt = b.total - a.total;
	return dt > 0 ? Math.round((1 - (b.idle - a.idle) / dt) * 1000) / 10 : 0;
};

import { describe, expect, it } from "vitest";
import { cpuPct, machinePct, parseCpuTotals, parseMemAvailableMb, parsePidStat, treeOf } from "./procstat.ts";

describe("procstat", () => {
	it("parses /proc/stat totals (idle + iowait)", () => {
		expect(parseCpuTotals("cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3 4\n")).toEqual({ total: 1000, idle: 850 });
	});
	it("parses a pid stat whose comm has spaces and parentheses", () => {
		const s = "2466 (node (gym) x) S 2330 2466 2330 0 -1 4194304 1 2 3 4 150 50 0 0 20 0 11 0 12345 999999 4567 18446744073709551615";
		expect(parsePidStat(s)).toEqual({ pid: 2466, ppid: 2330, jiffies: 200, rssPages: 4567 });
	});
	it("parses MemAvailable", () => {
		expect(parseMemAvailableMb("MemTotal: 16000000 kB\nMemAvailable:   8388608 kB\n")).toBe(8192);
	});
	it("collects a whole process tree", () => {
		const ppid = new Map([
			[10, 1],
			[11, 10],
			[12, 11],
			[20, 1],
		]);
		expect(treeOf(10, ppid).sort()).toEqual([10, 11, 12]);
	});
	it("computes CPU percentages", () => {
		expect(cpuPct(1000, 1150, 10)).toBe(15); // 150 jiffies over 10 s at 100 Hz = 0.15 core
		expect(machinePct({ total: 1000, idle: 800 }, { total: 2000, idle: 1300 })).toBe(50);
	});
});

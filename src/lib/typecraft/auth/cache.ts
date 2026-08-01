/**
 * Token cache — persists auth tokens to JSON files on disk.
 * Compatible with prismarine-auth cache format so existing tokens work.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Hash username to a short prefix for cache filenames. */
const hashUsername = (username: string): string =>
	createHash("sha1").update(username).digest("hex").slice(0, 6);

/** Check if a token with obtainedOn + expires_in (ms or s) is still valid. */
export const isTokenValid = (
	obtainedOn: number | undefined,
	expiresIn: number | undefined,
): boolean => {
	if (!obtainedOn || !expiresIn) return false;
	// expires_in could be in seconds (MSA/MC) — normalize to ms
	const expiresMs = expiresIn < 100000 ? expiresIn * 1000 : expiresIn;
	return obtainedOn + expiresMs - Date.now() > 1000;
};

/** Check if an ISO date string is still in the future. */
export const isDateValid = (dateStr: string | undefined): boolean => {
	if (!dateStr) return false;
	return new Date(dateStr).getTime() - Date.now() > 1000;
};

/** Load a cache file, returning its parsed contents or empty object. */
export const loadCache = (
	cacheDir: string,
	username: string,
	name: string,
): Record<string, unknown> => {
	const filePath = join(
		cacheDir,
		`${hashUsername(username)}_${name}-cache.json`,
	);
	if (!existsSync(filePath)) return {};
	try {
		return JSON.parse(readFileSync(filePath, "utf8")) as Record<
			string,
			unknown
		>;
	} catch {
		return {};
	}
};

/** Save data to a cache file (merges with existing). */
export const saveCache = (
	cacheDir: string,
	username: string,
	name: string,
	data: Record<string, unknown>,
): void => {
	mkdirSync(cacheDir, { recursive: true });
	const filePath = join(
		cacheDir,
		`${hashUsername(username)}_${name}-cache.json`,
	);
	const existing = loadCache(cacheDir, username, name);
	writeFileSync(filePath, JSON.stringify({ ...existing, ...data }, null, 2));
};

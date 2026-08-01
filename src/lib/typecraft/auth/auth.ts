/**
 * Authentication orchestrator — chains MSA → Xbox → Minecraft token exchange.
 * Replaces prismarine-auth with a self-contained implementation for Java Edition.
 */

import { join } from "node:path";
import { getMsaToken } from "./microsoft.ts";
import { getMinecraftToken } from "./minecraft.ts";
import type { AuthOptions, AuthResult } from "./types.ts";
import { getXboxToken } from "./xbox.ts";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Authenticate with Microsoft and get a Minecraft Java access token + profile.
 * Uses cached tokens when available, refreshes automatically, falls back to device code.
 */
export const authenticateMicrosoft = async (
	options: AuthOptions,
): Promise<AuthResult> => {
	const cacheDir =
		options.profilesFolder ??
		join(process.env.HOME ?? ".", ".minecraft", "typecraft-cache");

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			if (attempt > 0) await sleep(RETRY_DELAY_MS);

			// Step 1: MSA token (device code or cached/refreshed)
			const msaToken = await getMsaToken(
				cacheDir,
				options.username,
				options.onMsaCode,
			);

			// Step 2: Xbox XSTS token
			const xbox = await getXboxToken(cacheDir, options.username, msaToken);

			// Step 3: Minecraft token + profile
			const { accessToken, profile } = await getMinecraftToken(
				cacheDir,
				options.username,
				xbox.userHash,
				xbox.XSTSToken,
			);

			if (!profile || (profile as unknown as Record<string, unknown>).error) {
				throw new Error(
					`Failed to obtain Minecraft profile for ${options.username}. Does this account own Minecraft?`,
				);
			}

			// Format UUID with dashes
			const uuid = profile.id.replace(
				/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/,
				"$1-$2-$3-$4-$5",
			);

			return {
				accessToken,
				username: profile.name,
				uuid,
			};
		} catch (err) {
			lastError = err as Error;
			if (attempt < MAX_RETRIES) {
				console.warn(
					`[auth] Attempt ${attempt + 1} failed, retrying: ${lastError.message}`,
				);
			}
		}
	}

	throw lastError ?? new Error("Authentication failed");
};

export type { AuthOptions, AuthResult } from "./types.ts";

/**
 * Minecraft Java token exchange — converts Xbox XSTS token to a
 * Minecraft access token and fetches the player profile.
 */

import { isTokenValid, loadCache, saveCache } from "./cache.ts";
import type { MinecraftProfile, MinecraftToken } from "./types.ts";

const LOGIN_URL =
	"https://api.minecraftservices.com/authentication/login_with_xbox";
const PROFILE_URL = "https://api.minecraftservices.com/minecraft/profile";

const MC_HEADERS = {
	"Content-Type": "application/json",
	"User-Agent": "MinecraftLauncher/2.2.10675",
};

/** Exchange an Xbox XSTS token for a Minecraft Java access token. */
const loginWithXbox = async (
	userHash: string,
	xstsToken: string,
): Promise<{ access_token: string; expires_in: number }> => {
	const res = await fetch(LOGIN_URL, {
		method: "POST",
		headers: MC_HEADERS,
		body: JSON.stringify({
			identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
		}),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Minecraft login failed (${res.status}): ${text}`);
	}
	return (await res.json()) as { access_token: string; expires_in: number };
};

/** Fetch the Minecraft profile (UUID, username, skins). */
const fetchProfile = async (accessToken: string): Promise<MinecraftProfile> => {
	const res = await fetch(PROFILE_URL, {
		headers: {
			...MC_HEADERS,
			Authorization: `Bearer ${accessToken}`,
		},
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Profile fetch failed (${res.status}): ${text}`);
	}
	return (await res.json()) as MinecraftProfile;
};

/**
 * Get a valid Minecraft Java access token + profile.
 * Uses cache or exchanges a fresh XSTS token.
 */
export const getMinecraftToken = async (
	cacheDir: string,
	username: string,
	userHash: string,
	xstsToken: string,
): Promise<{ accessToken: string; profile: MinecraftProfile }> => {
	const cache = loadCache(cacheDir, username, "mca");
	const cached = cache.mca as MinecraftToken | undefined;

	let accessToken: string;

	if (cached && isTokenValid(cached.obtainedOn, cached.expires_in)) {
		accessToken = cached.access_token;
	} else {
		const mcAuth = await loginWithXbox(userHash, xstsToken);
		saveCache(cacheDir, username, "mca", {
			mca: { ...mcAuth, obtainedOn: Date.now() },
		});
		accessToken = mcAuth.access_token;
	}

	const profile = await fetchProfile(accessToken);
	return { accessToken, profile };
};

/**
 * Microsoft account (MSA) authentication — device code flow via login.live.com.
 * Gets an access token + refresh token for Xbox Live scopes.
 */

import { isTokenValid, loadCache, saveCache } from "./cache.ts";
import type { DeviceCodeResponse, MsaToken } from "./types.ts";

// Nintendo Switch client ID — works reliably for Java Edition auth
const CLIENT_ID = "00000000402b5328";
const SCOPES = "service::user.auth.xboxlive.com::MBI_SSL";

const DEVICE_CODE_URL = "https://login.live.com/oauth20_connect.srf";
const TOKEN_URL = "https://login.live.com/oauth20_token.srf";

/** Request a device code from Microsoft. User must visit the URL and enter the code. */
const requestDeviceCode = async (): Promise<DeviceCodeResponse> => {
	const res = await fetch(DEVICE_CODE_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			scope: SCOPES,
			client_id: CLIENT_ID,
			response_type: "device_code",
		}).toString(),
	});
	if (!res.ok) throw new Error(`Device code request failed: ${res.status}`);
	return (await res.json()) as DeviceCodeResponse;
};

/** Poll for the user to authorize the device code. Returns access + refresh tokens. */
const pollDeviceCode = async (
	deviceCode: string,
	interval: number,
	expiresIn: number,
): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> => {
	const deadline = Date.now() + expiresIn * 1000 - 100;

	while (Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, interval * 1000));

		const res = await fetch(`${TOKEN_URL}?client_id=${CLIENT_ID}`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: CLIENT_ID,
				device_code: deviceCode,
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
			}).toString(),
		});
		const data = (await res.json()) as Record<string, unknown>;

		if (data.error) {
			if (data.error === "authorization_pending") continue;
			throw new Error(`Auth failed: ${data.error} — ${data.error_description}`);
		}

		return data as {
			access_token: string;
			refresh_token: string;
			expires_in: number;
		};
	}

	throw new Error("Device code authentication timed out");
};

/** Refresh an existing MSA token using the refresh_token. */
const refreshMsaToken = async (
	refreshToken: string,
): Promise<{
	access_token: string;
	refresh_token: string;
	expires_in: number;
}> => {
	const res = await fetch(TOKEN_URL, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			scope: SCOPES,
			client_id: CLIENT_ID,
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}).toString(),
	});
	if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
	return (await res.json()) as {
		access_token: string;
		refresh_token: string;
		expires_in: number;
	};
};

/**
 * Get a valid MSA access token. Uses cache, refresh, or device code flow as needed.
 * Returns the access_token string.
 */
export const getMsaToken = async (
	cacheDir: string,
	username: string,
	onDeviceCode?: (data: {
		user_code: string;
		verification_uri: string;
	}) => void,
): Promise<string> => {
	const cache = loadCache(cacheDir, username, "live");
	const cached = cache.token as MsaToken | undefined;

	// Try cached token
	if (cached && isTokenValid(cached.obtainedOn, cached.expires_in)) {
		return cached.access_token;
	}

	// Try refresh
	if (cached?.refresh_token) {
		try {
			const refreshed = await refreshMsaToken(cached.refresh_token);
			saveCache(cacheDir, username, "live", {
				token: { ...refreshed, obtainedOn: Date.now() },
			});
			return refreshed.access_token;
		} catch {
			// Refresh failed, fall through to device code
		}
	}

	// Device code flow
	const codeResponse = await requestDeviceCode();
	if (onDeviceCode) {
		onDeviceCode({
			user_code: codeResponse.user_code,
			verification_uri: codeResponse.verification_uri,
		});
	} else {
		console.log(
			`To sign in, visit ${codeResponse.verification_uri} and enter code ${codeResponse.user_code}`,
		);
	}

	const tokens = await pollDeviceCode(
		codeResponse.device_code,
		codeResponse.interval,
		codeResponse.expires_in,
	);

	saveCache(cacheDir, username, "live", {
		token: { ...tokens, obtainedOn: Date.now() },
	});

	return tokens.access_token;
};

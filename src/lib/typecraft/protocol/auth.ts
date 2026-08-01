/**
 * Mojang session server join — notifies Mojang that a client is joining a server.
 * Authentication flow is in src/auth/.
 */

import { createHash } from "node:crypto";

// ── Minecraft server hash (mcHexDigest) ──

/**
 * Compute Minecraft's authentication server hash.
 * SHA1(serverId + sharedSecret + serverPublicKey), formatted as
 * a signed hex digest (two's complement for negative values).
 */
export const mcServerHash = (
	serverId: string,
	sharedSecret: Buffer,
	publicKey: Buffer,
): string => {
	const hash = createHash("sha1");
	hash.update(serverId, "ascii");
	hash.update(sharedSecret);
	hash.update(publicKey);
	const digest = hash.digest();
	return mcHexDigest(digest);
};

/** Format a SHA1 digest as Minecraft's signed hex string. */
const mcHexDigest = (digest: Buffer): string => {
	const negative = (digest[0]! & 0x80) !== 0;
	if (negative) {
		// Two's complement: invert all bits, add 1
		let carry = true;
		for (let i = digest.length - 1; i >= 0; i--) {
			digest[i] = ~digest[i]! & 0xff;
			if (carry) {
				carry = digest[i] === 0xff;
				digest[i] = (digest[i]! + 1) & 0xff;
			}
		}
		return `-${digest.toString("hex").replace(/^0+/, "")}`;
	}
	return digest.toString("hex").replace(/^0+/, "");
};

// ── Session server join ──

const SESSION_SERVER = "https://sessionserver.mojang.com";

/** Notify Mojang that this client is joining a server (online mode). */
export const joinServer = async (
	accessToken: string,
	profileId: string,
	serverId: string,
	sharedSecret: Buffer,
	publicKey: Buffer,
): Promise<void> => {
	const hash = mcServerHash(serverId, sharedSecret, publicKey);
	const response = await fetch(`${SESSION_SERVER}/session/minecraft/join`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			accessToken,
			selectedProfile: profileId.replace(/-/g, ""),
			serverId: hash,
		}),
	});
	if (!response.ok) {
		const text = await response.text();
		throw new Error(`Session server join failed (${response.status}): ${text}`);
	}
};

/**
 * Xbox Live authentication — exchanges an MSA token for an XSTS token.
 * Implements EC P-256 request signing required by Xbox Live endpoints.
 */

import {
	createHash,
	sign as cryptoSign,
	generateKeyPairSync,
	type KeyObject,
} from "node:crypto";
import { isDateValid, loadCache, saveCache } from "./cache.ts";
import type { XboxToken, XboxUserToken } from "./types.ts";

const USER_AUTH_URL = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_RELYING_PARTY = "rp://api.minecraftservices.com/";

const XBOX_ERRORS: Record<number, string> = {
	2148916227: "Your Xbox account was banned.",
	2148916229:
		"Your account is restricted by parental controls. Visit https://account.microsoft.com/family/",
	2148916233:
		"Your account does not have an Xbox profile. Create one at https://signup.live.com/signup",
	2148916234: "Your account has not accepted Xbox Terms of Service.",
	2148916235: "Your account resides in a region where Xbox is not available.",
	2148916236:
		"Your account requires proof of age. Visit https://login.live.com/login.srf",
	2148916237: "Your account has reached its playtime limit.",
	2148916238:
		"This account is under 18 and must be added to a family by an adult.",
};

const XBL_HEADERS = {
	"Cache-Control": "no-store, must-revalidate, no-cache",
	"Content-Type": "application/json",
	Accept: "application/json",
};

/** Generate an EC P-256 keypair for Xbox Live request signing. */
const generateEcKey = (): {
	privateKey: KeyObject;
	publicJwk: Record<string, unknown>;
} => {
	const { privateKey, publicKey } = generateKeyPairSync("ec", {
		namedCurve: "prime256v1",
	});
	const jwk = publicKey.export({ format: "jwk" });
	return {
		privateKey,
		publicJwk: { ...jwk, alg: "ES256", use: "sig" },
	};
};

/**
 * Sign an Xbox Live request. The signature uses a Windows epoch timestamp
 * and covers the HTTP method, path, auth token, and body.
 */
const signRequest = (
	url: string,
	authorizationToken: string,
	body: string,
	privateKey: KeyObject,
): string => {
	// Windows epoch: seconds since 1601-01-01, in 100ns ticks
	const windowsTs =
		(BigInt(Math.floor(Date.now() / 1000)) + 11644473600n) * 10000000n;
	const path = new URL(url).pathname;

	// Build the data to sign
	const pathBytes = Buffer.byteLength(path);
	const authBytes = Buffer.byteLength(authorizationToken);
	const bodyBytes = Buffer.byteLength(body);
	const buf = Buffer.alloc(
		5 + 9 + 5 + pathBytes + 1 + authBytes + 1 + bodyBytes + 1,
	);
	let off = 0;
	off = buf.writeInt32BE(1, off); // policy version
	off = buf.writeUInt8(0, off);
	off = buf.writeBigUInt64BE(windowsTs, off);
	off = buf.writeUInt8(0, off); // null terminator
	off += buf.write("POST\0", off, "utf8");
	off += buf.write(`${path}\0`, off, "utf8");
	off += buf.write(`${authorizationToken}\0`, off, "utf8");
	off += buf.write(`${body}\0`, off, "utf8");

	const sig = cryptoSign("SHA256", buf.subarray(0, off), {
		key: privateKey,
		dsaEncoding: "ieee-p1363",
	});

	// Build header: [i32 version][u64 timestamp][signature]
	const header = Buffer.alloc(12 + sig.length);
	header.writeInt32BE(1, 0);
	header.writeBigUInt64BE(windowsTs, 4);
	sig.copy(header, 12);
	return header.toString("base64");
};

/** Get an Xbox user token from an MSA access token. */
const getUserToken = async (
	msaAccessToken: string,
	privateKey: KeyObject,
): Promise<XboxUserToken> => {
	const payload = {
		RelyingParty: "http://auth.xboxlive.com",
		TokenType: "JWT",
		Properties: {
			AuthMethod: "RPS",
			SiteName: "user.auth.xboxlive.com",
			RpsTicket: `t=${msaAccessToken}`,
		},
	};
	const body = JSON.stringify(payload);
	const signature = signRequest(USER_AUTH_URL, "", body, privateKey);

	const res = await fetch(USER_AUTH_URL, {
		method: "POST",
		headers: { ...XBL_HEADERS, signature, "x-xbl-contract-version": "2" },
		body,
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`Xbox user auth failed (${res.status}): ${text}`);
	}
	return (await res.json()) as XboxUserToken;
};

/** Get an XSTS token from a user token. */
const getXstsToken = async (
	userToken: string,
	privateKey: KeyObject,
): Promise<XboxToken> => {
	const payload = {
		RelyingParty: MC_RELYING_PARTY,
		TokenType: "JWT",
		Properties: {
			UserTokens: [userToken],
			SandboxId: "RETAIL",
		},
	};
	const body = JSON.stringify(payload);
	const signature = signRequest(XSTS_AUTH_URL, "", body, privateKey);

	const res = await fetch(XSTS_AUTH_URL, {
		method: "POST",
		headers: { ...XBL_HEADERS, signature, "x-xbl-contract-version": "1" },
		body,
	});

	const data = (await res.json()) as Record<string, unknown>;

	if (!res.ok) {
		const xerr = data.XErr as number;
		if (xerr && XBOX_ERRORS[xerr]) throw new Error(XBOX_ERRORS[xerr]);
		throw new Error(
			`Xbox XSTS auth failed (XErr: ${xerr}): ${JSON.stringify(data)}`,
		);
	}

	const claims = (data.DisplayClaims as Record<string, unknown[]>).xui as {
		uhs: string;
		xid: string;
	}[];

	return {
		XSTSToken: data.Token as string,
		userHash: claims[0]!.uhs,
		userXUID: claims[0]!.xid,
		expiresOn: data.NotAfter as string,
	};
};

/**
 * Get a valid Xbox XSTS token. Uses cache or fetches fresh tokens.
 * Returns { userHash, XSTSToken } needed for Minecraft auth.
 */
export const getXboxToken = async (
	cacheDir: string,
	username: string,
	msaAccessToken: string,
): Promise<XboxToken> => {
	const cache = loadCache(cacheDir, username, "xbl");
	const rpHash = createHash("sha256").update(MC_RELYING_PARTY).digest("hex");
	const cachedXsts = cache[rpHash] as XboxToken | undefined;

	if (cachedXsts && isDateValid(cachedXsts.expiresOn)) {
		return cachedXsts;
	}

	// Generate signing key
	const { privateKey } = generateEcKey();

	// Get user token
	const cachedUserToken = cache.userToken as XboxUserToken | undefined;
	let userTokenStr: string;

	if (cachedUserToken && isDateValid(cachedUserToken.NotAfter)) {
		userTokenStr = cachedUserToken.Token;
	} else {
		const userToken = await getUserToken(msaAccessToken, privateKey);
		saveCache(cacheDir, username, "xbl", { userToken });
		userTokenStr = userToken.Token;
	}

	// Get XSTS token
	const xsts = await getXstsToken(userTokenStr, privateKey);
	saveCache(cacheDir, username, "xbl", { [rpHash]: xsts });

	return xsts;
};

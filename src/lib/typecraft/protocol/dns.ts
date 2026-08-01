/**
 * DNS SRV record resolution for Minecraft servers.
 * Resolves _minecraft._tcp.<host> to get the actual host and port.
 */

import { resolveSrv } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Resolve a Minecraft server address, checking SRV records if appropriate.
 * SRV lookup is only performed when:
 * - Port is 25565 (default)
 * - Host is not an IP address
 * - Host is not localhost
 */
export const resolveServer = async (
	host: string,
	port: number,
): Promise<{ host: string; port: number }> => {
	if (port !== 25565 || isIP(host) || host === "localhost") {
		return { host, port };
	}

	try {
		const records = await resolveSrv(`_minecraft._tcp.${host}`);
		if (records.length > 0) {
			return { host: records[0]!.name, port: records[0]!.port };
		}
	} catch {
		// SRV lookup failed — fall back to direct connection
	}

	return { host, port };
};

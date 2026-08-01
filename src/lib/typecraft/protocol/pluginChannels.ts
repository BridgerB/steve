/**
 * Plugin channel registration and custom_payload handling.
 * Channels allow typed communication over custom_payload packets.
 */

import type { Client } from "./client.ts";

/** Channel serializer: encode params to Buffer. */
export type ChannelSerializer = (params: unknown) => Buffer;

/** Channel deserializer: decode Buffer to params. */
export type ChannelDeserializer = (data: Buffer) => unknown;

/** A registered plugin channel. */
type RegisteredChannel = {
	readonly name: string;
	readonly serialize: ChannelSerializer | null;
	readonly deserialize: ChannelDeserializer | null;
};

/**
 * String channel codec — prefixed-length UTF-8 string.
 * Used for brand, item names, etc.
 */
export const stringSerializer: ChannelSerializer = (
	params: unknown,
): Buffer => {
	const str = typeof params === "string" ? params : String(params);
	const bytes = Buffer.from(str, "utf8");
	const buf = Buffer.alloc(bytes.length + 1);
	buf[0] = bytes.length;
	bytes.copy(buf, 1);
	return buf;
};

export const stringDeserializer: ChannelDeserializer = (
	data: Buffer,
): unknown => {
	if (data.length === 0) return "";
	const len = data[0]!;
	return data.subarray(1, 1 + len).toString("utf8");
};

/**
 * Raw channel codec — no parsing, pass Buffer through.
 */
export const rawSerializer: ChannelSerializer = (params: unknown): Buffer =>
	Buffer.isBuffer(params) ? params : Buffer.from(String(params));

export const rawDeserializer: ChannelDeserializer = (data: Buffer): unknown =>
	data;

/**
 * Register list codec — newline-separated channel names.
 * Used for REGISTER/UNREGISTER system channels.
 */
const registerDeserializer: ChannelDeserializer = (data: Buffer): unknown =>
	data.toString("utf8").split("\0").filter(Boolean);

const registerSerializer: ChannelSerializer = (params: unknown): Buffer => {
	const channels = Array.isArray(params) ? params : [String(params)];
	return Buffer.from(channels.join("\0"), "utf8");
};

/**
 * Wire up plugin channel support on a protocol client.
 * Call this after client creation to enable registerChannel/writeChannel/unregisterChannel.
 */
export const initPluginChannels = (client: Client): void => {
	const channels = new Map<string, RegisteredChannel>();
	let listenerAttached = false;

	const isNewChannelNaming = client.protocolVersion >= 393; // 1.13+
	const registerChannelName = isNewChannelNaming
		? "minecraft:register"
		: "REGISTER";
	const unregisterChannelName = isNewChannelNaming
		? "minecraft:unregister"
		: "UNREGISTER";

	// Register the system channels for REGISTER/UNREGISTER
	channels.set(registerChannelName, {
		name: registerChannelName,
		serialize: registerSerializer,
		deserialize: registerDeserializer,
	});
	channels.set(unregisterChannelName, {
		name: unregisterChannelName,
		serialize: registerSerializer,
		deserialize: registerDeserializer,
	});

	const attachListener = () => {
		if (listenerAttached) return;
		listenerAttached = true;

		client.on("custom_payload", (packet: Record<string, unknown>) => {
			const channelName = packet.channel as string;
			const data = packet.data as Buffer;
			if (!channelName || !data) return;

			const channel = channels.get(channelName);
			if (!channel) return;

			try {
				const parsed = channel.deserialize ? channel.deserialize(data) : data;
				client.emit(channelName, parsed);
			} catch {
				// Ignore parse errors for plugin channels
			}
		});
	};

	// Attach immediately
	attachListener();

	// registerChannel: register a named channel with optional serializer/deserializer
	(client as unknown as Record<string, unknown>).registerChannel = (
		name: string,
		serializer?: ChannelSerializer | null,
		deserializer?: ChannelDeserializer | null,
		custom?: boolean,
	): void => {
		channels.set(name, {
			name,
			serialize: serializer ?? rawSerializer,
			deserialize: deserializer ?? rawDeserializer,
		});

		// If custom=true, notify the server we're registering this channel
		if (custom) {
			const regChannel = channels.get(registerChannelName);
			if (regChannel?.serialize) {
				client.write("custom_payload", {
					channel: registerChannelName,
					data: regChannel.serialize([name]),
				});
			}
		}
	};

	// writeChannel: send data on a registered channel
	(client as unknown as Record<string, unknown>).writeChannel = (
		name: string,
		params: unknown,
	): void => {
		const channel = channels.get(name);
		if (!channel) throw new Error(`Channel not registered: ${name}`);

		const data = channel.serialize
			? channel.serialize(params)
			: Buffer.from([]);
		client.write("custom_payload", { channel: name, data });
	};

	// unregisterChannel: remove a channel registration
	(client as unknown as Record<string, unknown>).unregisterChannel = (
		name: string,
		custom?: boolean,
	): void => {
		channels.delete(name);

		if (custom) {
			const unregChannel = channels.get(unregisterChannelName);
			if (unregChannel?.serialize) {
				client.write("custom_payload", {
					channel: unregisterChannelName,
					data: unregChannel.serialize([name]),
				});
			}
		}
	};
};

/** Minecraft protocol states. */
export const ProtocolState = {
	HANDSHAKING: "handshaking",
	STATUS: "status",
	LOGIN: "login",
	CONFIGURATION: "configuration",
	PLAY: "play",
} as const;

export type ProtocolState = (typeof ProtocolState)[keyof typeof ProtocolState];

/** Packet direction. */
export const Direction = {
	TO_CLIENT: "toClient",
	TO_SERVER: "toServer",
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

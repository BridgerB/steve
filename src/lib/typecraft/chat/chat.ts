/**
 * Chat module — parse and render Minecraft chat messages.
 * Replaces prismarine-chat with a functional API.
 */

import { simplifyNbt } from "../nbt/nbt.ts";
import type { Registry } from "../registry/types.ts";
import {
	ANSI_CODES,
	CSS_STYLES,
	FORMAT_MEMBERS,
	MOTD_COLOR_CODES,
	MOTD_FORMAT_CODES,
	SUPPORTED_COLORS,
} from "./styles.ts";
import type {
	ChatClickEvent,
	ChatHoverEvent,
	ChatMessage,
	Language,
} from "./types.ts";

const MAX_CHAT_DEPTH = 8;
const MAX_CHAT_LENGTH = 4096;

// ── vsprintf ──

/** Printf-style format: supports %s (sequential) and %1$s (positional). */
export const vsprintf = (format: string, args: readonly string[]): string => {
	let i = 0;
	return format.replace(/%(?:(\d+)\$)?(s|%)/g, (g0, g1) => {
		if (g0 === "%%") return "%";
		const idx = g1 ? Number.parseInt(g1, 10) - 1 : i++;
		return args[idx] ?? "";
	});
};

// ── HTML helpers ──

const escapeHtml = (unsafe: string): string =>
	unsafe
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#039;");

const escapeRgb = (hex: string): string =>
	`color:rgb(${hex
		.match(/.{2}/g)!
		.map((e) => Number.parseInt(e, 16))
		.join(",")})`;

// ── Strip formatting codes ──

const STYLE_CODE_RE = /§[0-9a-flnmokr]/g;

const stripCodes = (text: string): string => text.replace(STYLE_CODE_RE, "");

// ── NBT message processing (1.20.3+) ──

const uuidFromIntArray = (arr: number[]): string => {
	const buf = Buffer.alloc(16);
	for (let i = 0; i < arr.length; i++) buf.writeInt32BE(arr[i]!, i * 4);
	return buf.toString("hex");
};

/** Normalize NBT chat message to JSON schema. */
export const processNbtMessage = (msg: unknown): unknown | null => {
	if (!msg || (msg as { type?: string }).type === "end") return null;
	const simplified = simplifyNbt(msg as Parameters<typeof simplifyNbt>[0]);
	const json = JSON.stringify(simplified, (key, val) => {
		if (key === "id" && Array.isArray(val)) return uuidFromIntArray(val);
		return val;
	});
	return JSON.parse(json);
};

// ── Parsing ──

/** Parse a chat message from JSON, string, number, or array. */
export const parseChatMessage = (message: unknown): ChatMessage => {
	let json: unknown;

	if (typeof message === "string") {
		json = message === "" ? { text: "" } : { text: message };
	} else if (typeof message === "number") {
		json = { text: message };
	} else if (Array.isArray(message)) {
		json = { extra: message };
	} else if (typeof message === "object" && message !== null) {
		json = message;
	} else {
		throw new Error("Expected string, number, or object for chat message");
	}

	return parseJson(json as Record<string, unknown>);
};

const parseJson = (json: Record<string, unknown>): ChatMessage => {
	let text: string | number | undefined;
	let translate: string | undefined;
	let fallback: string | undefined;
	let withMessages: ChatMessage[] | undefined;
	let extra: ChatMessage[] | undefined;

	// Text or translate
	if (typeof json.text === "string" || typeof json.text === "number") {
		text = json.text;
	} else if (typeof json[""] === "string" || typeof json[""] === "number") {
		// NBT messages with empty string keys
		text = json[""] as string | number;
	} else if (typeof json.translate === "string") {
		translate = json.translate;
		if (typeof json.fallback === "string") {
			fallback = json.fallback;
		}
		if (Array.isArray(json.with)) {
			withMessages = json.with.map((entry: unknown) => parseChatMessage(entry));
		}
	}

	// Extra
	if (Array.isArray(json.extra)) {
		extra = json.extra.map((entry: unknown) => parseChatMessage(entry));
	}

	// Color parsing
	let color: string | null | undefined = json.color as string | undefined;
	let bold = json.bold as boolean | undefined;
	let italic = json.italic as boolean | undefined;
	let underlined = json.underlined as boolean | undefined;
	let strikethrough = json.strikethrough as boolean | undefined;
	let obfuscated = json.obfuscated as boolean | undefined;
	let reset: boolean | undefined;

	// Color can be a formatting name — promote to the correct flag
	switch (color) {
		case "obfuscated":
			obfuscated = true;
			color = null;
			break;
		case "bold":
			bold = true;
			color = null;
			break;
		case "strikethrough":
			strikethrough = true;
			color = null;
			break;
		case "underlined":
			underlined = true;
			color = null;
			break;
		case "italic":
			italic = true;
			color = null;
			break;
		case "reset":
			reset = true;
			color = null;
			break;
		default:
			if (
				color &&
				!SUPPORTED_COLORS.has(color) &&
				!color.match(/#[a-fA-F\d]{6}/)
			) {
				color = null;
			}
	}

	// Click event
	let clickEvent: ChatClickEvent | undefined;
	if (typeof json.clickEvent === "object" && json.clickEvent !== null) {
		const ce = json.clickEvent as Record<string, unknown>;
		if (typeof ce.action === "string") {
			clickEvent = { action: ce.action, value: ce.value } as ChatClickEvent;
		}
	}

	// Hover event
	let hoverEvent: ChatHoverEvent | undefined;
	if (typeof json.hoverEvent === "object" && json.hoverEvent !== null) {
		const he = json.hoverEvent as Record<string, unknown>;
		if (typeof he.action === "string") {
			hoverEvent = {
				action: he.action,
				contents: he.contents,
				value: he.value,
			} as ChatHoverEvent;
		}
	}

	return {
		json,
		text,
		translate,
		fallback,
		with: withMessages,
		extra,
		color,
		bold,
		italic,
		underlined,
		strikethrough,
		obfuscated,
		reset,
		clickEvent,
		hoverEvent,
	};
};

// ── fromNotch ──

/** Parse a chat message from network packet data. */
export const chatFromNotch = (
	registry: Registry,
	msg: unknown,
): ChatMessage => {
	if (
		registry.supportFeature("chatPacketsUseNbtComponents") &&
		msg &&
		typeof msg === "object" &&
		"type" in msg
	) {
		const json = processNbtMessage(msg);
		return parseChatMessage(json ?? "");
	}
	if (typeof msg === "string") {
		try {
			return parseChatMessage(JSON.parse(msg));
		} catch {
			return parseChatMessage(msg);
		}
	}
	return parseChatMessage(msg ?? "");
};

// ── Output: toString ──

/** Flatten a chat message to plain text. */
export const chatToString = (
	msg: ChatMessage,
	lang: Language = {},
	_depth = 0,
): string => {
	if (_depth > MAX_CHAT_DEPTH) return "";
	let message = "";

	if (typeof msg.text === "string" || typeof msg.text === "number") {
		message += msg.text;
	} else if (msg.translate !== undefined) {
		const _with = msg.with ?? [];
		const args = _with.map((entry) => chatToString(entry, lang, _depth + 1));
		let format = lang[msg.translate] ?? null;
		if (format === null && msg.fallback !== undefined) format = msg.fallback;
		if (format === null) format = msg.translate;
		message += vsprintf(format, args);
	}

	if (msg.extra) {
		message += msg.extra
			.map((entry) => chatToString(entry, lang, _depth + 1))
			.join("");
	}

	return stripCodes(message).slice(0, MAX_CHAT_LENGTH);
};

// ── Output: toMotd ──

/** Flatten a chat message to MOTD format (§ color codes). */
export const chatToMotd = (
	msg: ChatMessage,
	lang: Language = {},
	parent: Record<string, unknown> = {},
	_depth = 0,
): string => {
	if (_depth > MAX_CHAT_DEPTH) return "";

	// Build formatting prefix
	const self: Record<string, unknown> = { ...msg };
	let prefix = "";

	for (const code of [
		"color",
		"bold",
		"italic",
		"underlined",
		"strikethrough",
		"obfuscated",
	] as const) {
		const val = (self[code] as unknown) || (parent[code] as unknown);
		if (!val || val === "false") continue;
		if (code === "color") {
			const colorVal = val as string;
			if (colorVal.startsWith("#")) {
				prefix += `§${colorVal}`;
			} else {
				prefix += MOTD_COLOR_CODES[colorVal] ?? "";
			}
		} else {
			prefix += MOTD_FORMAT_CODES[code] ?? "";
		}
	}

	let message = prefix;

	if (typeof msg.text === "string" || typeof msg.text === "number") {
		message += msg.text;
	} else if (msg.translate !== undefined) {
		const _with = msg.with ?? [];
		const motdSelf: Record<string, unknown> = {};
		for (const k of [
			"color",
			"bold",
			"italic",
			"underlined",
			"strikethrough",
			"obfuscated",
		]) {
			if ((msg as Record<string, unknown>)[k] || parent[k]) {
				motdSelf[k] = (msg as Record<string, unknown>)[k] || parent[k];
			}
		}
		const args = _with.map((entry) => {
			const entryMotd = chatToMotd(entry, lang, motdSelf, _depth + 1);
			return entryMotd + (entryMotd.includes("§") ? `§r${message}` : "");
		});
		let format = lang[msg.translate] ?? null;
		if (format === null && msg.fallback !== undefined) format = msg.fallback;
		if (format === null) format = msg.translate;
		message += vsprintf(format, args);
	}

	if (msg.extra) {
		const motdSelf: Record<string, unknown> = {};
		for (const k of [
			"color",
			"bold",
			"italic",
			"underlined",
			"strikethrough",
			"obfuscated",
		]) {
			if ((msg as Record<string, unknown>)[k] || parent[k]) {
				motdSelf[k] = (msg as Record<string, unknown>)[k] || parent[k];
			}
		}
		message += msg.extra
			.map((entry) => chatToMotd(entry, lang, motdSelf, _depth + 1))
			.join("");
	}

	return message.slice(0, MAX_CHAT_LENGTH);
};

// ── Output: toAnsi ──

/** Flatten a chat message to ANSI-colored terminal text. */
export const chatToAnsi = (
	msg: ChatMessage,
	lang: Language = {},
	codes: Readonly<Record<string, string>> = ANSI_CODES,
): string => {
	let message = chatToMotd(msg, lang);

	// Replace known § codes with ANSI
	for (const k in codes) {
		message = message.replaceAll(k, codes[k]!);
	}

	// Replace hex color codes with ANSI RGB
	const hexRegex = /§#?([a-fA-F\d]{2})([a-fA-F\d]{2})([a-fA-F\d]{2})/;
	while (hexRegex.test(message)) {
		const match = hexRegex.exec(message)!;
		const r = Number.parseInt(match[1]!, 16);
		const g = Number.parseInt(match[2]!, 16);
		const b = Number.parseInt(match[3]!, 16);
		message = message.replace(hexRegex, `\u001b[38;2;${r};${g};${b}m`);
	}

	return `${codes["§r"]}${message.slice(0, MAX_CHAT_LENGTH)}${codes["§r"]}`;
};

// ── Output: toHTML ──

/** Flatten a chat message to CSS-styled escaped HTML. */
export const chatToHTML = (
	msg: ChatMessage,
	lang: Language = {},
	styles: Readonly<Record<string, string>> = CSS_STYLES,
	allowedFormats: readonly string[] = FORMAT_MEMBERS,
	_depth = 0,
): string => {
	if (_depth > MAX_CHAT_DEPTH) return "";
	let str = "";

	const msgRecord = msg as unknown as Record<string, unknown>;
	if (allowedFormats.some((member) => msgRecord[member])) {
		const cssProps: string[] = [];
		for (const cur of allowedFormats) {
			if (!msgRecord[cur]) continue;
			if (cur === "color") {
				const colorVal = msg.color as string;
				cssProps.push(
					colorVal.startsWith("#")
						? escapeRgb(colorVal.slice(1))
						: (styles[colorVal] ?? ""),
				);
			} else {
				cssProps.push(styles[cur] ?? "");
			}
		}
		str += `<span style="${cssProps.join(";")}">`;
	} else {
		str += "<span>";
	}

	if (msg.text !== undefined) {
		str += escapeHtml(String(msg.text));
	} else if (msg.translate) {
		const params: string[] = [];
		if (msg.with) {
			for (const param of msg.with) {
				params.push(
					chatToHTML(param, lang, styles, allowedFormats, _depth + 1),
				);
			}
		}
		let format = lang[msg.translate] ?? null;
		if (format === null && msg.fallback !== undefined) format = msg.fallback;
		if (format === null) format = msg.translate;
		str += vsprintf(escapeHtml(format), params);
	}

	if (msg.extra) {
		str += msg.extra
			.map((entry) =>
				chatToHTML(entry, lang, styles, allowedFormats, _depth + 1),
			)
			.join("");
	}

	str += "</span>";

	// Not safe to truncate HTML — return unformatted text instead
	return str.length > MAX_CHAT_LENGTH
		? escapeHtml(chatToString(msg, lang))
		: str;
};

// ── Utility ──

/** Count of text extras and child messages (non-recursive). */
export const chatLength = (msg: ChatMessage): number => {
	let count = 0;
	if (msg.text !== undefined) count++;
	else if (msg.with) count += msg.with.length;
	if (msg.extra) count += msg.extra.length;
	return count;
};

/** Append extra messages, returning a new ChatMessage. */
export const chatAppend = (
	msg: ChatMessage,
	...extras: ChatMessage[]
): ChatMessage => ({
	...msg,
	extra: [...(msg.extra ?? []), ...extras],
});

/** Clone a chat message by re-parsing from JSON. */
export const chatClone = (msg: ChatMessage): ChatMessage =>
	parseChatMessage(JSON.parse(JSON.stringify(msg.json)));

/** Get a text part by index. */
export const chatGetText = (
	msg: ChatMessage,
	idx: number,
	lang: Language = {},
): string => {
	if (typeof idx !== "number") return chatToString(msg, lang);
	if (msg.text !== undefined && idx === 0) return stripCodes(String(msg.text));
	if (msg.with && msg.with.length > idx)
		return chatToString(msg.with[idx]!, lang);
	const offset = msg.text !== undefined ? 1 : (msg.with?.length ?? 0);
	if (msg.extra && msg.extra.length + offset > idx) {
		return chatToString(msg.extra[idx - offset]!, lang);
	}
	return "";
};

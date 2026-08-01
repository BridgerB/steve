/**
 * Chat builder — construct Minecraft chat JSON components.
 * Replaces prismarine-chat/MessageBuilder.js with a functional API.
 */

import { COLOR_CODE_TO_NAME } from "./styles.ts";
import type { ChatBuilder, HoverEventAction } from "./types.ts";

type BuilderState = {
	bold?: boolean;
	italic?: boolean;
	underlined?: boolean;
	strikethrough?: boolean;
	obfuscated?: boolean;
	color?: string;
	text?: string;
	font?: string;
	translate?: string;
	insertion?: string;
	keybind?: string;
	score?: { name: string; objective: string };
	clickEvent?: { action: string; value: string | number };
	hoverEvent?: Record<string, unknown>;
	with: unknown[];
	extra: unknown[];
};

/** Create a new chat builder for constructing chat JSON. */
export const createChatBuilder = (): ChatBuilder => {
	const state: BuilderState = { with: [], extra: [] };

	const builder: ChatBuilder = {
		setBold: (val) => {
			state.bold = val;
			return builder;
		},
		setItalic: (val) => {
			state.italic = val;
			return builder;
		},
		setUnderlined: (val) => {
			state.underlined = val;
			return builder;
		},
		setStrikethrough: (val) => {
			state.strikethrough = val;
			return builder;
		},
		setObfuscated: (val) => {
			state.obfuscated = val;
			return builder;
		},
		setColor: (val) => {
			state.color = val;
			return builder;
		},
		setText: (val) => {
			state.text = val;
			return builder;
		},
		setFont: (val) => {
			state.font = val;
			return builder;
		},
		setTranslate: (val) => {
			state.translate = val;
			return builder;
		},
		setInsertion: (val) => {
			state.insertion = val;
			return builder;
		},
		setKeybind: (val) => {
			state.keybind = val;
			return builder;
		},
		setScore: (name, objective) => {
			state.score = { name, objective };
			return builder;
		},
		setClickEvent: (action, value) => {
			state.clickEvent = { action, value };
			return builder;
		},
		setHoverEvent: (
			action: HoverEventAction,
			data: unknown,
			type: "contents" | "value" = "contents",
		) => {
			const hoverEvent: Record<string, unknown> = { action };
			if (type === "contents") {
				hoverEvent.contents = data;
			} else {
				hoverEvent.value =
					typeof data === "object" && data !== null && "toString" in data
						? (data as { toString: () => string }).toString()
						: data;
			}
			state.hoverEvent = hoverEvent;
			return builder;
		},
		addExtra: (...args) => {
			for (const v of args) {
				state.extra.push(typeof v === "string" ? v : v.toJSON());
			}
			return builder;
		},
		addWith: (...args) => {
			for (const v of args) {
				state.with.push(typeof v === "string" ? v : v.toJSON());
			}
			return builder;
		},
		resetFormatting: () => {
			builder.setBold(false);
			builder.setItalic(false);
			builder.setUnderlined(false);
			builder.setStrikethrough(false);
			builder.setObfuscated(false);
			builder.setColor("reset");
		},
		toJSON: () => {
			const obj: Record<string, unknown> = {};
			if (state.strikethrough !== undefined)
				obj.strikethrough = state.strikethrough;
			if (state.obfuscated !== undefined) obj.obfuscated = state.obfuscated;
			if (state.underlined !== undefined) obj.underlined = state.underlined;
			if (state.clickEvent !== undefined) obj.clickEvent = state.clickEvent;
			if (state.hoverEvent !== undefined) obj.hoverEvent = state.hoverEvent;
			if (state.translate !== undefined) obj.translate = state.translate;
			if (state.insertion !== undefined) obj.insertion = state.insertion;
			if (state.italic !== undefined) obj.italic = state.italic;
			if (state.color !== undefined) obj.color = state.color;
			if (state.bold !== undefined) obj.bold = state.bold;
			if (state.font !== undefined) obj.font = state.font;
			// text > keybind > score
			if (state.text !== undefined) {
				obj.text = state.text;
			} else if (state.keybind !== undefined) {
				obj.keybind = state.keybind;
			} else if (state.score !== undefined) {
				obj.score = state.score;
			}
			if (state.translate !== undefined && state.with.length > 0) {
				obj.with = state.with;
			}
			if (state.extra.length > 0) {
				obj.extra = state.extra;
			}
			return obj;
		},
		toString: () => JSON.stringify(builder.toJSON()),
	};

	return builder;
};

/** Parse a string with color codes (e.g. "&4Hello&cWorld") into a ChatBuilder. */
export const chatBuilderFromString = (
	str: string,
	colorSeparator = "&",
): ChatBuilder => {
	let lastBuilder: ChatBuilder | null = null;
	let currString = "";

	for (let i = str.length - 1; i > -1; i--) {
		const char = str[i];
		if (char !== colorSeparator) {
			currString += char;
		} else {
			const text = currString.split("").reverse();
			const colorChar = text.shift()!;
			const color = COLOR_CODE_TO_NAME[colorChar];
			const newBuilder = createChatBuilder();

			if (color === "obfuscated") newBuilder.setObfuscated(true);
			else if (color === "bold") newBuilder.setBold(true);
			else if (color === "strikethrough") newBuilder.setStrikethrough(true);
			else if (color === "underlined") newBuilder.setUnderlined(true);
			else if (color === "italic") newBuilder.setItalic(true);
			else if (color === "reset") newBuilder.resetFormatting();
			else if (color) newBuilder.setColor(color);

			newBuilder.setText(text.join(""));

			if (lastBuilder === null) {
				lastBuilder = newBuilder;
			} else {
				lastBuilder = newBuilder.addExtra(lastBuilder);
			}
			currString = "";
		}
	}

	if (currString !== "") {
		const txt = currString.split("").reverse().join("");
		if (lastBuilder !== null) {
			lastBuilder = createChatBuilder().setText(txt).addExtra(lastBuilder);
		} else {
			lastBuilder = createChatBuilder().setText(txt);
		}
	}

	return lastBuilder ?? createChatBuilder().setText("");
};

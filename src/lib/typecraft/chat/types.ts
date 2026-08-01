/** Named Minecraft chat colors. */
export type ChatColor =
	| "black"
	| "dark_blue"
	| "dark_green"
	| "dark_aqua"
	| "dark_red"
	| "dark_purple"
	| "gold"
	| "gray"
	| "dark_gray"
	| "blue"
	| "green"
	| "aqua"
	| "red"
	| "light_purple"
	| "yellow"
	| "white";

/** Click event action types. */
export type ClickEventAction =
	| "open_url"
	| "open_file"
	| "run_command"
	| "suggest_command"
	| "change_page"
	| "copy_to_clipboard";

/** Hover event action types. */
export type HoverEventAction =
	| "show_text"
	| "show_achievement"
	| "show_item"
	| "show_entity";

/** A click event attached to a chat message. */
export type ChatClickEvent = {
	readonly action: ClickEventAction;
	readonly value: string | number;
};

/** A hover event attached to a chat message. */
export type ChatHoverEvent = {
	readonly action: HoverEventAction;
	readonly contents?: unknown;
	readonly value?: unknown;
};

/** A parsed Minecraft chat message. */
export type ChatMessage = {
	readonly json: unknown;
	readonly text?: string | number;
	readonly translate?: string;
	readonly fallback?: string;
	readonly with?: readonly ChatMessage[];
	readonly extra?: readonly ChatMessage[];
	readonly color?: string | null;
	readonly bold?: boolean;
	readonly italic?: boolean;
	readonly underlined?: boolean;
	readonly strikethrough?: boolean;
	readonly obfuscated?: boolean;
	readonly reset?: boolean;
	readonly clickEvent?: ChatClickEvent;
	readonly hoverEvent?: ChatHoverEvent;
};

/** Translation language map (key → format string). */
export type Language = Readonly<Record<string, string>>;

/** Mutable builder for constructing chat JSON components. */
export type ChatBuilder = {
	setBold: (val: boolean) => ChatBuilder;
	setItalic: (val: boolean) => ChatBuilder;
	setUnderlined: (val: boolean) => ChatBuilder;
	setStrikethrough: (val: boolean) => ChatBuilder;
	setObfuscated: (val: boolean) => ChatBuilder;
	setColor: (val: string) => ChatBuilder;
	setText: (val: string) => ChatBuilder;
	setFont: (val: string) => ChatBuilder;
	setTranslate: (val: string) => ChatBuilder;
	setInsertion: (val: string) => ChatBuilder;
	setKeybind: (val: string) => ChatBuilder;
	setScore: (name: string, objective: string) => ChatBuilder;
	setClickEvent: (
		action: ClickEventAction,
		value: string | number,
	) => ChatBuilder;
	setHoverEvent: (
		action: HoverEventAction,
		data: unknown,
		type?: "contents" | "value",
	) => ChatBuilder;
	addExtra: (...val: (ChatBuilder | string)[]) => ChatBuilder;
	addWith: (...val: (ChatBuilder | string)[]) => ChatBuilder;
	resetFormatting: () => void;
	toJSON: () => Record<string, unknown>;
	toString: () => string;
};

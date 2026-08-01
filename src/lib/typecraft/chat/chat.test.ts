import { describe, expect, it } from "vitest";
import {
	chatAppend,
	chatBuilderFromString,
	chatClone,
	chatGetText,
	chatLength,
	chatToAnsi,
	chatToHTML,
	chatToMotd,
	chatToString,
	createChatBuilder,
	parseChatMessage,
	vsprintf,
} from "./index.ts";
import type { Language } from "./types.ts";

// Translation strings needed by tests (language data not extracted by datagen yet)
const lang: Language = {
	"chat.type.text": "<%s> %s",
	"chat.type.admin": "[%s: %s]",
	"commands.clear.success.multiple": "Removed %s items from %s players",
	"translation.test.invalid": "hi %",
	"chat.type.announcement": "[%s] %s",
};

// ── vsprintf ──

describe("vsprintf", () => {
	it("replaces sequential %s", () => {
		expect(vsprintf("Hello, %s!", ["world"])).toBe("Hello, world!");
	});

	it("replaces positional %1$s", () => {
		expect(vsprintf("%2$s %1$s", ["a", "b"])).toBe("b a");
	});

	it("handles %% escape", () => {
		expect(vsprintf("100%%", [])).toBe("100%");
	});

	it("handles missing args", () => {
		expect(vsprintf("%2$s %1$s", ["a"])).toBe(" a");
	});

	it("handles no args", () => {
		expect(vsprintf("%2$s %1$s", [])).toBe(" ");
	});
});

// ── parseChatMessage ──

describe("parseChatMessage", () => {
	it("parses a simple text message", () => {
		const msg = parseChatMessage({ text: "Example chat message" });
		expect(chatToString(msg)).toBe("Example chat message");
	});

	it("parses a string directly", () => {
		const msg = parseChatMessage("Hello");
		expect(chatToString(msg)).toBe("Hello");
	});

	it("parses an empty string", () => {
		const msg = parseChatMessage("");
		expect(chatToString(msg)).toBe("");
	});

	it("parses a number", () => {
		const msg = parseChatMessage(256);
		expect(chatToString(msg)).toBe("256");
	});

	it("parses an array", () => {
		const msg = parseChatMessage([
			{ text: "Example chat " },
			{ text: "message" },
		]);
		expect(chatToString(msg)).toBe("Example chat message");
	});

	it("parses numbers in with array", () => {
		const msg = parseChatMessage({
			translate: "commands.clear.success.multiple",
			with: [256, 2],
		});
		expect(msg.with![0].text).toBe(256);
		expect(msg.with![1].text).toBe(2);
	});

	it("parses click events", () => {
		const msg = parseChatMessage({
			text: "click me",
			clickEvent: { action: "suggest_command", value: "/tell Player " },
		});
		expect(msg.clickEvent!.action).toBe("suggest_command");
		expect(msg.clickEvent!.value).toBe("/tell Player ");
	});

	it("parses hover events", () => {
		const msg = parseChatMessage({
			text: "hover me",
			hoverEvent: {
				action: "show_entity",
				contents: {
					type: "minecraft:player",
					id: "00000000",
					name: { text: "Player" },
				},
			},
		});
		expect(msg.hoverEvent!.action).toBe("show_entity");
		expect(msg.hoverEvent!.contents).toBeDefined();
	});

	it("parses formatting flags", () => {
		const msg = parseChatMessage({
			text: "styled",
			bold: true,
			italic: true,
			color: "red",
		});
		expect(msg.bold).toBe(true);
		expect(msg.italic).toBe(true);
		expect(msg.color).toBe("red");
	});

	it("promotes color=bold to bold flag", () => {
		const msg = parseChatMessage({ text: "x", color: "bold" });
		expect(msg.bold).toBe(true);
		expect(msg.color).toBeNull();
	});

	it("promotes color=italic to italic flag", () => {
		const msg = parseChatMessage({ text: "x", color: "italic" });
		expect(msg.italic).toBe(true);
		expect(msg.color).toBeNull();
	});

	it("promotes color=reset to reset flag", () => {
		const msg = parseChatMessage({ text: "x", color: "reset" });
		expect(msg.reset).toBe(true);
		expect(msg.color).toBeNull();
	});

	it("rejects unknown color names", () => {
		const msg = parseChatMessage({ text: "x", color: "banana" });
		expect(msg.color).toBeNull();
	});

	it("accepts hex color", () => {
		const msg = parseChatMessage({ text: "x", color: "#FF0000" });
		expect(msg.color).toBe("#FF0000");
	});

	it("parses empty string key (NBT messages)", () => {
		const msg = parseChatMessage({ "": "hello" });
		expect(chatToString(msg)).toBe("hello");
	});

	it("throws on invalid input", () => {
		expect(() => parseChatMessage(undefined as unknown)).toThrow();
	});
});

// ── chatToString ──

describe("chatToString", () => {
	it("renders text with language translations", () => {
		const msg = parseChatMessage({
			italic: true,
			color: "gray",
			translate: "chat.type.admin",
			with: [
				{ text: "ripwhitescrolls" },
				{ translate: "commands.clear.success.multiple", with: [256, 2] },
			],
		});
		expect(chatToString(msg, lang)).toBe(
			"[ripwhitescrolls: Removed 256 items from 2 players]",
		);
	});

	it("uses fallback when translation doesn't exist", () => {
		const msg = parseChatMessage({
			translate: "non.existent.key",
			fallback: "fallback text",
		});
		expect(chatToString(msg, lang)).toBe("fallback text");
	});

	it("uses translate key as format when not in language", () => {
		const msg = parseChatMessage({ translate: "Hello, %s!", with: ["world"] });
		expect(chatToString(msg)).toBe("Hello, world!");
	});

	it("uses fallback with parameters", () => {
		const msg = parseChatMessage({
			translate: "non.existent.key",
			fallback: "Hello %s!",
			with: ["World"],
		});
		expect(chatToString(msg, lang)).toBe("Hello World!");
	});

	it("strips formatting codes", () => {
		const msg = parseChatMessage({ text: "§4Hello §cWorld" });
		expect(chatToString(msg)).toBe("Hello World");
	});

	it("respects depth limit", () => {
		const translate = "%1$s".repeat(32);
		const format = { text: "a", color: "dark_red", bold: true };
		const _with: unknown[] = [format];
		const big = { translate, with: _with };
		for (let i = 0; i < 10; i++) _with[0] = structuredClone(big);
		const msg = parseChatMessage(big);
		expect(chatToString(msg)).toBe("");
	});

	it("respects length limit", () => {
		const translate = "%1$s".repeat(32);
		const format = { text: "a", color: "dark_red", bold: true };
		const _with: unknown[] = [format];
		const big = { translate, with: _with };
		for (let i = 0; i < 7; i++) _with[0] = structuredClone(big);
		const msg = parseChatMessage(big);
		expect(chatToString(msg).length).toBe(4096);
	});

	it("handles NBT messages with empty string keys", () => {
		const msg = parseChatMessage({
			extra: [
				{ color: "#ff471a", text: "Ⓖ " },
				{ "": "[" },
				{ color: "#5cff62", text: "Игрок" },
				{ "": "] " },
				{ "": "6055_42 " },
				{ color: "gray", text: " ⇨" },
				{ color: "#d8d8d8", text: " Test message", italic: true },
			],
			text: "",
		});
		expect(chatToString(msg)).toBe("Ⓖ [Игрок] 6055_42  ⇨ Test message");
	});

	it("uses fallback when translation exists but fallback is also provided", () => {
		const msg = parseChatMessage({
			translate: "chat.type.text",
			fallback: "fallback text",
			with: ["Player", "Hello"],
		});
		expect(chatToString(msg, lang)).toBe("<Player> Hello");
	});

	it("ignores fallback when text is present", () => {
		const msg = parseChatMessage({
			text: "main text",
			fallback: "fallback text",
		});
		expect(chatToString(msg)).toBe("main text");
	});

	it("handles invalid translation (upstream test)", () => {
		const msg = parseChatMessage({
			translate: "translation.test.invalid",
			with: ["something"],
		});
		expect(chatToString(msg, lang)).toBe("hi %");
	});
});

// ── chatToMotd ──

describe("chatToMotd", () => {
	it("renders color codes", () => {
		const msg = parseChatMessage({ text: "Hello", color: "red" });
		expect(chatToMotd(msg, lang)).toBe("§cHello");
	});

	it("renders hex colors", () => {
		const msg = parseChatMessage({ text: "uwu", color: "#FF0000" });
		expect(chatToMotd(msg, lang)).toBe("§#FF0000uwu");
	});

	it("renders multiple hex colors", () => {
		const msg = parseChatMessage([
			"",
			{ text: "uwu ", color: "#FF0000" },
			{ text: "owo ", color: "#0000FF" },
			{ text: "uwu", color: "#FF0000" },
		]);
		expect(chatToMotd(msg, lang)).toBe("§#FF0000uwu §#0000FFowo §#FF0000uwu");
	});

	it("renders bold formatting", () => {
		const msg = parseChatMessage({ text: "bold", bold: true });
		expect(chatToMotd(msg, lang)).toBe("§lbold");
	});

	it("renders translate with colored args (parse1)", () => {
		const msg = parseChatMessage({
			translate: "chat.type.text",
			with: [
				{ text: "IM_U9G", color: "aqua" },
				{ text: "yo sup", color: "green" },
			],
		});
		expect(chatToMotd(msg, lang)).toBe("<§bIM_U9G§r> §ayo sup§r");
	});

	it("renders translate with parent color (parse2)", () => {
		const msg = parseChatMessage({
			color: "blue",
			translate: "chat.type.text",
			with: [
				{ text: "IM_U9G", color: "aqua" },
				{ text: "yo sup", color: "green" },
			],
		});
		expect(chatToMotd(msg, lang)).toBe("§9<§bIM_U9G§r§9> §ayo sup§r§9");
	});

	it("renders complex message with translation", () => {
		const msg = parseChatMessage({
			italic: true,
			color: "gray",
			translate: "chat.type.admin",
			with: [
				{ text: "ripwhitescrolls" },
				{ translate: "commands.clear.success.multiple", with: [256, 2] },
			],
		});
		expect(chatToMotd(msg, lang)).toBe(
			"§7§o[§7§oripwhitescrolls§r§7§o: §7§oRemoved §7§o256§r§7§o items from §7§o2§r§7§o players§r§7§o]",
		);
	});

	it("renders fallback with color", () => {
		const msg = parseChatMessage({
			translate: "non.existent.key",
			fallback: "fallback text",
			color: "red",
		});
		expect(chatToMotd(msg, lang)).toBe("§cfallback text");
	});
});

// ── chatToAnsi ──

describe("chatToAnsi", () => {
	it("wraps in reset codes", () => {
		const msg = parseChatMessage({ text: "hi" });
		expect(chatToAnsi(msg, lang)).toBe("\u001b[0mhi\u001b[0m");
	});

	it("renders hex colors as RGB", () => {
		const msg = parseChatMessage({ text: "uwu", color: "#FF0000" });
		expect(chatToAnsi(msg, lang)).toBe(
			"\u001b[0m\u001b[38;2;255;0;0muwu\u001b[0m",
		);
	});

	it("renders multiple hex colors", () => {
		const msg = parseChatMessage([
			"",
			{ text: "uwu ", color: "#FF0000" },
			{ text: "owo ", color: "#0000FF" },
			{ text: "uwu", color: "#FF0000" },
		]);
		expect(chatToAnsi(msg, lang)).toBe(
			"\u001b[0m\u001b[38;2;255;0;0muwu \u001b[38;2;0;0;255mowo \u001b[38;2;255;0;0muwu\u001b[0m",
		);
	});

	it("renders complex translation (upstream)", () => {
		const msg = parseChatMessage({
			italic: true,
			color: "gray",
			translate: "chat.type.admin",
			with: [
				{ text: "ripwhitescrolls" },
				{ translate: "commands.clear.success.multiple", with: [256, 2] },
			],
		});
		expect(chatToAnsi(msg, lang)).toBe(
			"\u001b[0m\u001b[37m\u001b[3m[\u001b[37m\u001b[3mripwhitescrolls\u001b[0m\u001b[37m\u001b[3m: \u001b[37m\u001b[3mRemoved \u001b[37m\u001b[3m256\u001b[0m\u001b[37m\u001b[3m items from \u001b[37m\u001b[3m2\u001b[0m\u001b[37m\u001b[3m players\u001b[0m\u001b[37m\u001b[3m]\u001b[0m",
		);
	});

	it("renders fallback with color", () => {
		const msg = parseChatMessage({
			translate: "non.existent.key",
			fallback: "fallback text",
			color: "red",
		});
		expect(chatToAnsi(msg, lang)).toBe(
			"\u001b[0m\u001b[91mfallback text\u001b[0m",
		);
	});
});

// ── chatToHTML ──

describe("chatToHTML", () => {
	it("renders styled HTML with translate", () => {
		const msg = parseChatMessage({
			color: "blue",
			translate: "chat.type.text",
			with: [
				{ text: "IM_U9G", color: "aqua" },
				{ text: "yo sup", color: "green" },
			],
			extra: [{ text: "test", color: "#ff0000", strikethrough: true }],
		});
		expect(chatToHTML(msg, lang)).toBe(
			'<span style="color:#5555FF">&lt;<span style="color:#55FFFF">IM_U9G</span>&gt; <span style="color:#55FF55">yo sup</span><span style="color:rgb(255,0,0);text-decoration:line-through">test</span></span>',
		);
	});

	it("respects allowedFormats filter", () => {
		const msg = parseChatMessage({
			color: "blue",
			translate: "chat.type.text",
			with: [
				{ text: "IM_U9G", color: "aqua" },
				{ text: "yo sup", color: "green" },
			],
			extra: [{ text: "test", color: "#ff0000", strikethrough: true }],
		});
		expect(chatToHTML(msg, lang, undefined, ["color"])).toBe(
			'<span style="color:#5555FF">&lt;<span style="color:#55FFFF">IM_U9G</span>&gt; <span style="color:#55FF55">yo sup</span><span style="color:rgb(255,0,0)">test</span></span>',
		);
	});

	it("escapes HTML entities", () => {
		const msg = parseChatMessage({ text: '<script>alert("xss")</script>' });
		expect(chatToHTML(msg, lang)).toBe(
			"<span>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</span>",
		);
	});

	it("renders fallback with color", () => {
		const msg = parseChatMessage({
			translate: "non.existent.key",
			fallback: "fallback text",
			color: "red",
		});
		expect(chatToHTML(msg, lang)).toBe(
			'<span style="color:#FF5555">fallback text</span>',
		);
	});
});

// ── Utility functions ──

describe("chatLength", () => {
	it("counts text as 1", () => {
		const msg = parseChatMessage({ text: "hello" });
		expect(chatLength(msg)).toBe(1);
	});

	it("counts extra", () => {
		const msg = parseChatMessage({
			text: "",
			extra: [{ text: "a" }, { text: "b" }],
		});
		expect(chatLength(msg)).toBe(3); // 1 text + 2 extra
	});

	it("counts with (no text)", () => {
		const msg = parseChatMessage({ translate: "key", with: ["a", "b"] });
		expect(chatLength(msg)).toBe(2);
	});
});

describe("chatAppend", () => {
	it("appends extra messages", () => {
		const msg = parseChatMessage({ text: "hello" });
		const extra = parseChatMessage({ text: " world" });
		const result = chatAppend(msg, extra);
		expect(chatToString(result)).toBe("hello world");
	});
});

describe("chatClone", () => {
	it("creates an independent copy", () => {
		const msg = parseChatMessage({ text: "hello", color: "red" });
		const clone = chatClone(msg);
		expect(chatToString(clone)).toBe("hello");
		expect(clone.color).toBe("red");
	});
});

describe("chatGetText", () => {
	it("gets text at index 0", () => {
		const msg = parseChatMessage({ text: "hello" });
		expect(chatGetText(msg, 0)).toBe("hello");
	});

	it("gets extra by index", () => {
		const msg = parseChatMessage({
			text: "hello",
			extra: [{ text: " world" }],
		});
		expect(chatGetText(msg, 1)).toBe(" world");
	});

	it("returns empty string for out of range", () => {
		const msg = parseChatMessage({ text: "hello" });
		expect(chatGetText(msg, 5)).toBe("");
	});
});

// ── ChatBuilder ──

describe("createChatBuilder", () => {
	const properties: [string, unknown][] = [
		["Bold", true],
		["Italic", true],
		["Underlined", true],
		["Strikethrough", true],
		["Obfuscated", true],
		["Color", "red"],
		["Text", "this is a chat message"],
		["Font", "minecraft:not_default"],
		["Translate", "chat.type.text"],
		["Insertion", "Hi I'm inserted!"],
	];

	for (const [prop, val] of properties) {
		it(`set${prop}`, () => {
			const builder = createChatBuilder();
			// biome-ignore lint/complexity/noBannedTypes: dynamic property access in test
			(builder as Record<string, Function>)[`set${prop}`](val);
			const json = builder.toJSON();
			const propName = prop.toLowerCase();
			expect(json[propName]).toStrictEqual(val);
		});
	}

	it("setScore", () => {
		const json = createChatBuilder().setScore("Player", "kills").toJSON();
		expect(json.score).toStrictEqual({ name: "Player", objective: "kills" });
	});

	it("setKeybind", () => {
		const json = createChatBuilder().setKeybind("key.jump").toJSON();
		expect(json.keybind).toBe("key.jump");
	});

	it("setClickEvent", () => {
		const json = createChatBuilder()
			.setClickEvent("run_command", "/say hi")
			.toJSON();
		expect(json.clickEvent).toStrictEqual({
			action: "run_command",
			value: "/say hi",
		});
	});

	it("setHoverEvent with contents", () => {
		const json = createChatBuilder()
			.setHoverEvent("show_text", { text: "hi" })
			.toJSON();
		expect(json.hoverEvent).toStrictEqual({
			action: "show_text",
			contents: { text: "hi" },
		});
	});

	it("setHoverEvent with value", () => {
		const json = createChatBuilder()
			.setHoverEvent("show_text", "hi", "value")
			.toJSON();
		expect(json.hoverEvent).toStrictEqual({ action: "show_text", value: "hi" });
	});

	it("no translate without with", () => {
		const json = createChatBuilder()
			.addWith("Hello,")
			.addWith("World.")
			.toJSON();
		expect(json).toStrictEqual({});
	});

	it("translate with with", () => {
		const json = createChatBuilder()
			.setTranslate("chat.type.text")
			.addWith(createChatBuilder().setText("U9G"))
			.addWith(createChatBuilder().setText("Hello world"))
			.toJSON();
		expect(json).toStrictEqual({
			translate: "chat.type.text",
			with: [{ text: "U9G" }, { text: "Hello world" }],
		});
		const text = chatToString(parseChatMessage(json), lang);
		expect(text).toBe("<U9G> Hello world");
	});

	it("addExtra", () => {
		const json = createChatBuilder()
			.setText("")
			.addExtra(createChatBuilder().setText("Hello"))
			.addExtra(createChatBuilder().setText(" ").setColor("reset"))
			.addExtra(createChatBuilder().setText("world"))
			.toJSON();
		expect(json).toStrictEqual({
			text: "",
			extra: [
				{ text: "Hello" },
				{ text: " ", color: "reset" },
				{ text: "world" },
			],
		});
		const text = chatToString(parseChatMessage(json), lang);
		expect(text).toBe("Hello world");
	});

	it("addExtra with strings", () => {
		const json = createChatBuilder()
			.setText("")
			.addExtra("Hello", " ", "world")
			.toJSON();
		expect(json.extra).toStrictEqual(["Hello", " ", "world"]);
	});

	it("resetFormatting", () => {
		const builder = createChatBuilder()
			.setBold(true)
			.setItalic(true)
			.setColor("red");
		builder.resetFormatting();
		const json = builder.toJSON();
		expect(json.bold).toBe(false);
		expect(json.italic).toBe(false);
		expect(json.color).toBe("reset");
	});

	it("toString returns JSON string", () => {
		const str = createChatBuilder().setText("hello").toString();
		expect(JSON.parse(str)).toStrictEqual({ text: "hello" });
	});

	it("text takes priority over keybind", () => {
		const json = createChatBuilder()
			.setText("hello")
			.setKeybind("key.jump")
			.toJSON();
		expect(json.text).toBe("hello");
		expect(json.keybind).toBeUndefined();
	});

	it("keybind takes priority over score", () => {
		const json = createChatBuilder()
			.setKeybind("key.jump")
			.setScore("Player", "kills")
			.toJSON();
		expect(json.keybind).toBe("key.jump");
		expect(json.score).toBeUndefined();
	});
});

// ── chatBuilderFromString ──

describe("chatBuilderFromString", () => {
	it("parses color codes", () => {
		const json = JSON.stringify(
			chatBuilderFromString("&0&l[&4&lYou&f&lTube&0&l]").toJSON(),
		);
		expect(json).toBe(
			'{"color":"black","text":"","extra":[{"bold":true,"text":"[","extra":[{"color":"dark_red","text":"","extra":[{"bold":true,"text":"You","extra":[{"color":"white","text":"","extra":[{"bold":true,"text":"Tube","extra":[{"color":"black","text":"","extra":[{"bold":true,"text":"]"}]}]}]}]}]}]}]}',
		);
	});

	it("parses simple color codes", () => {
		const json = JSON.stringify(
			chatBuilderFromString("&0&l[&4You&fTube&0]").toJSON(),
		);
		expect(json).toBe(
			'{"color":"black","text":"","extra":[{"bold":true,"text":"[","extra":[{"color":"dark_red","text":"You","extra":[{"color":"white","text":"Tube","extra":[{"color":"black","text":"]"}]}]}]}]}',
		);
	});

	it("handles plain text without codes", () => {
		const json = JSON.stringify(chatBuilderFromString("Hello world!").toJSON());
		expect(json).toBe('{"text":"Hello world!"}');
	});

	it("handles empty string", () => {
		const json = chatBuilderFromString("").toJSON();
		expect(json.text).toBe("");
	});
});

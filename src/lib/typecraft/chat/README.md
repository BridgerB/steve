# chat

Functional replacement for [prismarine-chat](https://github.com/PrismarineJS/prismarine-chat). Parses Minecraft JSON chat messages and renders them as plain text, MOTD (`§` codes), ANSI terminal colors, or escaped HTML. Also builds chat messages for sending.

## Usage

```ts
import { createRegistry } from "../registry/index.js";
import { parseChatMessage, chatToString, chatToMotd, chatToAnsi, chatToHTML } from "./index.js";

const reg = createRegistry("1.20.4");
const lang = reg.language;

// Parse and render
const msg = parseChatMessage({
  color: "gold",
  translate: "chat.type.text",
  with: [
    { text: "Steve", color: "aqua" },
    { text: "Hello world!", color: "green" },
  ],
});

chatToString(msg, lang);  // "<Steve> Hello world!"
chatToMotd(msg, lang);    // "§6<§bSteve§r§6> §aHello world!§r§6"
chatToAnsi(msg, lang);    // ANSI escape sequences for terminal
chatToHTML(msg, lang);    // '<span style="color:#FFAA00">...</span>'
```

## Building messages

```ts
import { createChatBuilder, chatBuilderFromString } from "./index.js";

const msg = createChatBuilder()
  .setText("Hello ")
  .setColor("gold")
  .setBold(true)
  .addExtra(
    createChatBuilder().setText("world!").setColor("aqua"),
  );

msg.toJSON();     // { text: "Hello ", color: "gold", bold: true, extra: [...] }
msg.toString();   // JSON string

// Parse color-coded strings
const colored = chatBuilderFromString("&6Hello &bworld!");
```

## ChatMessage type

```ts
type ChatMessage = {
  json: unknown;                  // original JSON
  text?: string | number;         // literal text
  translate?: string;             // translation key
  fallback?: string;              // fallback if key missing
  with?: readonly ChatMessage[];  // translation parameters
  extra?: readonly ChatMessage[]; // appended children
  color?: string | null;          // named color or #RRGGBB
  bold?: boolean;
  italic?: boolean;
  underlined?: boolean;
  strikethrough?: boolean;
  obfuscated?: boolean;
  reset?: boolean;
  clickEvent?: ChatClickEvent;
  hoverEvent?: ChatHoverEvent;
};
```

## Functions

### Parsing

| Function | Description |
|----------|-------------|
| `parseChatMessage(message)` | Parse from JSON, string, number, or array |
| `chatFromNotch(registry, msg)` | Parse network packet (JSON string or NBT for 1.20.3+) |
| `processNbtMessage(msg)` | Normalize NBT chat to JSON schema |

### Output

All output functions accept an optional `lang` parameter for translations (`registry.language`).

| Function | Description |
|----------|-------------|
| `chatToString(msg, lang?)` | Plain text |
| `chatToMotd(msg, lang?)` | MOTD format with `§` color codes |
| `chatToAnsi(msg, lang?, codes?)` | ANSI escape sequences for terminal |
| `chatToHTML(msg, lang?, styles?, allowedFormats?)` | CSS-styled escaped HTML |

### Utility

| Function | Description |
|----------|-------------|
| `chatLength(msg)` | Count of text + extras (non-recursive) |
| `chatAppend(msg, ...extras)` | Return new message with appended extras |
| `chatClone(msg)` | Deep clone via re-parse |
| `chatGetText(msg, idx, lang?)` | Get text part by index |
| `vsprintf(format, args)` | Printf-style `%s` and `%1$s` replacement |

### Builder

| Function | Description |
|----------|-------------|
| `createChatBuilder()` | New builder with fluent API |
| `chatBuilderFromString(str, sep?)` | Parse `&`-color-coded string (e.g. `&4Hello&cWorld`) |

Builder methods — all return `ChatBuilder` for chaining:

`setBold`, `setItalic`, `setUnderlined`, `setStrikethrough`, `setObfuscated`, `setColor`, `setText`, `setFont`, `setTranslate`, `setInsertion`, `setKeybind`, `setScore(name, objective)`, `setClickEvent(action, value)`, `setHoverEvent(action, data, type?)`, `addExtra(...vals)`, `addWith(...vals)`, `resetFormatting()`, `toJSON()`, `toString()`

## Limits

- **Depth**: max 8 levels of recursion (prevents stack overflow from malicious messages)
- **Length**: output truncated to 4096 characters

## Style constants

Exported maps for color code conversion:

| Constant | Description |
|----------|-------------|
| `ANSI_CODES` | `§x` → ANSI escape sequence |
| `CSS_STYLES` | color name → CSS style string |
| `MOTD_COLOR_CODES` | color name → `§x` |
| `MOTD_FORMAT_CODES` | format name → `§x` |
| `COLOR_CODE_TO_NAME` | single char → color name |
| `SUPPORTED_COLORS` | Set of valid color names |
| `FORMAT_MEMBERS` | Format property names for HTML |

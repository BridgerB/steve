// Persistent MCP client bridge. Spawns the steve MCP server (bot `steve-mcp`
// with a web viewer on :3001), holds the stdio connection open so the bot +
// viewer stay alive, and lets the agent call tools by writing /tmp/mcp-cmd.json
// ({name, arguments}) and reading the result from /tmp/mcp-out.json.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const transport = new StdioClientTransport({
	command: 'node',
	args: ['src/mcp.ts'],
	cwd: '/Users/bridger/Developer/mc/upstream/steve',
	env: {
		...process.env,
		MC_HOST: '144.24.32.76',
		MC_PORT: '25565',
		MC_USERNAME: 'steve-mcp',
		MCP_VIEWER_PORT: '3010',
		MC_RCON_PORT: '25575',
		MC_RCON_PASS: 'minecraft-test-rcon',
		MC_VERSION: '1.21.11'
	},
	stderr: 'inherit'
});
const client = new Client({ name: 'mcp-bridge', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
writeFileSync('/tmp/mcp-ready', new Date().toISOString());
console.log('bridge: connected — steve-mcp + viewer :3010 — tools:', tools.map((t) => t.name).join(','));

const CMD = '/tmp/mcp-cmd.json';
const OUT = '/tmp/mcp-out.json';
for (;;) {
	if (existsSync(CMD)) {
		let req = null;
		try {
			req = JSON.parse(readFileSync(CMD, 'utf8'));
		} catch {}
		try {
			unlinkSync(CMD);
		} catch {}
		if (req && req.name) {
			try {
				const r = await client.callTool({ name: req.name, arguments: req.arguments || {} });
				writeFileSync(OUT, r.content?.[0]?.text ?? JSON.stringify(r));
			} catch (e) {
				writeFileSync(OUT, 'ERROR: ' + (e?.message ?? String(e)));
			}
		}
	}
	await new Promise((r) => setTimeout(r, 400));
}

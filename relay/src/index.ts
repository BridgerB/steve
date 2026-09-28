// steve live-viewer relay.
//
// The Node bot process opens an outbound WebSocket to /ingest/<botId> and
// forwards the typecraft viewer stream (JSON world/entity deltas) — minus the
// big `assets` message, which the browser fetches statically. Browsers open
// /viewer/<botId>; the Durable Object buffers the world state and replays it to
// each new viewer, then fans out live deltas. One DO instance per bot id.

interface Env {
	RELAY: DurableObjectNamespace;
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const m = url.pathname.match(/^\/(ingest|viewer)\/(.+)$/);
		if (!m) return new Response('steve relay ok', { status: 200 });
		if (request.headers.get('Upgrade') !== 'websocket')
			return new Response('expected websocket', { status: 426 });
		const stub = env.RELAY.get(env.RELAY.idFromName(decodeURIComponent(m[2])));
		return stub.fetch(request);
	}
};

export class Relay {
	private ingest = new Set<WebSocket>();
	private viewers = new Set<WebSocket>();

	// Replay buffer: the minimal world state a late-joining viewer needs.
	private init?: string;
	private pos?: string;
	private live?: string; // latest `state`
	private time?: string;
	private chunks = new Map<string, string>();
	private entities = new Map<string, string>(); // latest spawn per id
	private equips = new Map<string, string>();
	// Bot's current chunk, from the latest `position`; chunks farther than
	// KEEP_RADIUS from it are evicted so the buffer (and every replay) stays
	// bounded instead of growing with everywhere the bot has ever been.
	private botCx = 0;
	private botCz = 0;
	private static readonly KEEP_RADIUS = 4; // matches the bot's stream viewDistance

	// Entity moves arrive hundreds of times a second (item drops, mobs, other
	// bots). Coalesce to the latest position per entity and fan out ONE
	// `entityMoves` batch every 100ms instead of a JSON message per move.
	private moveBuf = new Map<string, Record<string, unknown>>();
	private moveTimer: ReturnType<typeof setTimeout> | null = null;

	private scheduleMoveFlush() {
		if (this.moveTimer) return;
		this.moveTimer = setTimeout(() => {
			this.moveTimer = null;
			if (this.moveBuf.size === 0) return;
			const batch = JSON.stringify({ type: 'entityMoves', moves: [...this.moveBuf.values()] });
			this.moveBuf.clear();
			for (const v of this.viewers) {
				try {
					v.send(batch);
				} catch {
					/* ignore */
				}
			}
		}, 100);
	}

	private pruneChunks() {
		for (const key of this.chunks.keys()) {
			const [cx, cz] = key.split(',').map(Number);
			if (Math.abs(cx - this.botCx) > Relay.KEEP_RADIUS || Math.abs(cz - this.botCz) > Relay.KEEP_RADIUS)
				this.chunks.delete(key);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	constructor(_state: DurableObjectState, _env: Env) {}

	async fetch(request: Request): Promise<Response> {
		const role = new URL(request.url).pathname.startsWith('/ingest') ? 'ingest' : 'viewer';
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		server.accept();
		if (role === 'ingest') this.onIngest(server);
		else this.onViewer(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	private onIngest(ws: WebSocket) {
		this.ingest.add(ws);
		ws.addEventListener('message', (e: MessageEvent) => {
			if (typeof e.data === 'string') this.onMessage(e.data);
		});
		const drop = () => this.ingest.delete(ws);
		ws.addEventListener('close', drop);
		ws.addEventListener('error', drop);
	}

	private onViewer(ws: WebSocket) {
		this.viewers.add(ws);
		try {
			if (this.init) ws.send(this.init);
			for (const c of this.chunks.values()) ws.send(c);
			for (const s of this.entities.values()) ws.send(s);
			for (const eq of this.equips.values()) ws.send(eq);
			if (this.pos) ws.send(this.pos);
			if (this.time) ws.send(this.time);
			if (this.live) ws.send(this.live);
		} catch {
			/* ignore */
		}
		const drop = () => this.viewers.delete(ws);
		ws.addEventListener('close', drop);
		ws.addEventListener('error', drop);
	}

	private onMessage(json: string) {
		let msg: { type?: string; x?: number; z?: number; id?: number } & Record<string, unknown>;
		try {
			msg = JSON.parse(json);
		} catch {
			return;
		}
		switch (msg.type) {
			case 'assets':
				return; // never relayed live (browser fetches it statically)
			case 'init':
				this.init = json;
				break;
			case 'position':
				this.pos = json;
				if (typeof msg.x === 'number' && typeof msg.z === 'number') {
					const cx = Math.floor(msg.x / 16);
					const cz = Math.floor(msg.z / 16);
					if (cx !== this.botCx || cz !== this.botCz) {
						this.botCx = cx;
						this.botCz = cz;
						this.pruneChunks();
					}
				}
				break;
			case 'entityMove':
				// Coalesce; flushed as one `entityMoves` batch (see scheduleMoveFlush).
				if (msg.id != null) {
					this.moveBuf.set(String(msg.id), msg);
					this.scheduleMoveFlush();
				}
				return;
			case 'state':
				this.live = json;
				break;
			case 'time':
				this.time = json;
				break;
			case 'chunk':
				this.chunks.set(`${msg.x},${msg.z}`, json);
				break;
			case 'unloadChunk':
				this.chunks.delete(`${msg.x},${msg.z}`);
				break;
			case 'entitySpawn':
				if (msg.id != null) this.entities.set(String(msg.id), json);
				break;
			case 'entityGone':
				if (msg.id != null) {
					this.entities.delete(String(msg.id));
					this.equips.delete(String(msg.id));
					this.moveBuf.delete(String(msg.id));
				}
				break;
			case 'entityEquip':
				if (msg.id != null) this.equips.set(String(msg.id), json);
				break;
		}
		for (const v of this.viewers) {
			try {
				v.send(json);
			} catch {
				/* ignore */
			}
		}
	}
}

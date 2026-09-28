import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

// Player skin proxy for the 3D viewer (/skins/<uuid>.png). Offline-mode UUIDs
// (v3 — our own bots) have no Mojang skin, so they redirect to the bundled
// Steve texture; real accounts are fetched from crafatar and edge-cached.
// (A Worker can't fetch its own origin — Cloudflare error 1042 — hence redirects
// rather than internal fetches for the static fallback.)
const isOfflineUuid = (uuid: string): boolean => uuid.charAt(14) === '3';

export const GET: RequestHandler = async ({ params, request }) => {
	const uuid = params.file.replace(/\.png$/i, '');
	if (!/^[0-9a-f-]{32,36}$/i.test(uuid)) return new Response('bad uuid', { status: 400 });
	if (isOfflineUuid(uuid)) throw redirect(302, '/textures/steve.png');

	const cache = caches.default;
	const cached = await cache.match(request);
	if (cached) return cached;

	const res = await fetch(`https://crafatar.com/skins/${uuid}`);
	if (!res.ok) throw redirect(302, '/textures/steve.png');
	const out = new Response(res.body, {
		status: 200,
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
	});
	await cache.put(request, out.clone());
	return out;
};

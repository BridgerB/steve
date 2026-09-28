import type { RequestHandler } from './$types';
import { redirect } from '@sveltejs/kit';

// Fallback for held-item icons the viewer requests as /textures/item/<name>.png.
// Existing item PNGs are served as static assets before this runs; blocks held
// as items (logs, cobblestone, …) only have a *block* texture, so redirect there.
export const GET: RequestHandler = ({ params }) => {
	if (!/^[a-z0-9_]+\.png$/.test(params.name)) return new Response('not found', { status: 404 });
	throw redirect(302, `/textures/block/${params.name}`);
};

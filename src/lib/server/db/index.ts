import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

// The dashboard (Cloudflare Worker) reads the telemetry DB via the D1 binding,
// which is only available per-request on `platform.env.DB`. Pass it in from a
// load function / endpoint: `getDb(platform.env.DB)`.
export const getDb = (d1: D1Database) => drizzle(d1, { schema });

export { schema };

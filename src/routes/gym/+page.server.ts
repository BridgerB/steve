import type { PageServerLoad } from './$types';
import { gymStepMeta } from '$lib/steve/gym/registry';

export const load: PageServerLoad = async () => ({ steps: gymStepMeta() });

import { redirect } from '@sveltejs/kit';
import { appUrl } from '#lib/utils/urls.js';
import type { PageLoad } from './$types';

/** The Gate report tab moved to the Ontology page as Model checks; old links (`/validation?tab=gates`) land there. */
export const load: PageLoad = ({ url }) => {
	if (url.searchParams.get('tab') === 'gates') redirect(307, appUrl('/pipeline?tab=checks'));
	return {};
};

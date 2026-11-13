/** Lets a page ask the layout to open the Documentation panel on a section (process-description STORY-346). The
 *  layout owns the panel, so pages get a function through Svelte context and need no knowledge of the panel. A page
 *  rendered without a provider gets `undefined` and leaves its guide links out. */
import { getContext, setContext } from 'svelte';

export type OpenDocumentation = (sectionId: string) => void;

const KEY = Symbol('open-documentation');

export function provideOpenDocumentation(open: OpenDocumentation): void {
	setContext(KEY, open);
}

export function useOpenDocumentation(): OpenDocumentation | undefined {
	return getContext<OpenDocumentation | undefined>(KEY);
}

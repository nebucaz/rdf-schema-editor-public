/**
 * Short share links (object-browser STORY-261). Pure: id generation/validation and the choice
 * between an inline `?m=` link and a stored short link. Nothing here touches the network.
 */
import { encodeModelForUrl, type QueryModel } from './query-model';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const SHORT_ID_LENGTH = 10;
/** Upper bound for a stored model's JSON, enforced by the create route. */
export const MAX_SHARED_MODEL_BYTES = 200_000;

const SHORT_ID_PATTERN = /^[A-Za-z0-9]{10}$/;

export function isShortId(id: unknown): id is string {
	return typeof id === 'string' && SHORT_ID_PATTERN.test(id);
}

/** 10 base62 characters (~59 bits). `random` is injectable for tests; rejection sampling avoids modulo bias. */
export function newShortId(
	random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))
): string {
	let id = '';
	while (id.length < SHORT_ID_LENGTH) {
		for (const byte of random(SHORT_ID_LENGTH * 2)) {
			if (byte < 248 && id.length < SHORT_ID_LENGTH) id += ALPHABET[byte % ALPHABET.length];
		}
	}
	return id;
}

export type ShareLinkPlan =
	| { kind: 'inline'; url: string }
	| { kind: 'short' };

/** `?m=` while the model fits `MAX_SHARE_PARAM_LENGTH`, otherwise a request for a stored short link. */
export function shareLinkFor(origin: string, model: QueryModel): ShareLinkPlan {
	const enc = encodeModelForUrl(model);
	return enc.ok ? { kind: 'inline', url: `${origin}/workbench?m=${enc.param}` } : { kind: 'short' };
}

export function shortLinkUrl(origin: string, id: string): string {
	return `${origin}/workbench?q=${id}`;
}

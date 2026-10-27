/**
 * Build step for the nginx image: reads the static build's `index.html`, hashes its inline scripts
 * (SvelteKit's bootstrap script changes on every build) and writes an nginx snippet with the security
 * headers, so `script-src` can stay free of `'unsafe-inline'`.
 *
 *   bun run scripts/csp-snippet.ts build/index.html /tmp/security-headers.conf
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/** `'sha256-…'` CSP sources for every inline `<script>` (those without a `src`) in `html`. */
export function inlineScriptHashes(html: string): string[] {
	const hashes: string[] = [];
	for (const match of html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)) {
		hashes.push(`'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
	}
	return hashes;
}

/**
 * nginx `add_header` lines, included in every location that sets its own headers (nginx drops
 * inherited `add_header`s as soon as a location defines one). `$hsts_header` comes from the `map` in
 * `nginx/default.conf.template`; an empty value makes nginx omit the header.
 *
 * `style-src 'unsafe-inline'` is needed for the inline style attributes Svelte and @xyflow/svelte set.
 * `img-src data: blob:` and `font-src data:` cover the PNG/SVG export (html-to-image).
 */
export function securityHeadersConf(scriptHashes: string[]): string {
	const csp = [
		"default-src 'self'",
		`script-src 'self' ${scriptHashes.join(' ')}`.trim(),
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		"connect-src 'self'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"frame-ancestors 'none'"
	].join('; ');
	return [
		`add_header Content-Security-Policy "${csp}" always;`,
		'add_header X-Content-Type-Options nosniff always;',
		'add_header Referrer-Policy same-origin always;',
		'add_header X-Frame-Options DENY always;',
		'add_header Strict-Transport-Security $hsts_header always;',
		''
	].join('\n');
}

if (import.meta.main) {
	const [htmlPath, outPath] = process.argv.slice(2);
	if (!htmlPath || !outPath) throw new Error('usage: csp-snippet.ts <index.html> <out.conf>');
	writeFileSync(outPath, securityHeadersConf(inlineScriptHashes(readFileSync(htmlPath, 'utf8'))));
}

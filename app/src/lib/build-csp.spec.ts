import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { inlineScriptHashes, securityHeadersConf } from '../../scripts/csp-snippet';

const sha = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;

describe('inlineScriptHashes', () => {
	it('hashes the exact text of each inline script and skips external ones', () => {
		const body = '\n\t{ __sveltekit_x = { base: "" }; }\n';
		const html = `<head><script src="/a.js"></script></head><body><script>${body}</script><script type="module">x()</script></body>`;
		expect(inlineScriptHashes(html)).toEqual([sha(body), sha('x()')]);
	});

	it('finds nothing in a page without inline scripts', () => {
		expect(inlineScriptHashes('<script src="/a.js"></script>')).toEqual([]);
	});
});

describe('securityHeadersConf', () => {
	const conf = securityHeadersConf(["'sha256-abc='"]);

	it('puts the hashes into a strict script-src without unsafe-inline/eval', () => {
		expect(conf).toContain("script-src 'self' 'sha256-abc='");
		expect(conf).not.toMatch(/script-src[^;]*unsafe/);
	});

	it('sets the framing, sniffing and referrer headers and an opt-in HSTS', () => {
		expect(conf).toContain("frame-ancestors 'none'");
		expect(conf).toContain('X-Content-Type-Options nosniff');
		expect(conf).toContain('Referrer-Policy same-origin');
		expect(conf).toContain('X-Frame-Options DENY');
		expect(conf).toContain('Strict-Transport-Security $hsts_header');
	});
});

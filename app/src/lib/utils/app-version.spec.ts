import { describe, expect, it } from 'vitest';
import pkg from '../../../package.json';
import { APP_VERSION, formatAppVersion, resolveAppVersion } from './app-version';

describe('app version', () => {
	it('is package.json version plus the commit (injected at build time by vite.config.ts)', () => {
		expect(pkg.version).toBe('1.0.9');
		expect(APP_VERSION.startsWith(pkg.version)).toBe(true);
	});

	it('shows the bare version on a clean build of exactly the release tag', () => {
		expect(formatAppVersion('1.0.9', 'v1.0.9')).toBe('1.0.9');
	});

	it('shows git describe in brackets after the version otherwise', () => {
		expect(formatAppVersion('1.0.9', 'v1.0.9-3-ga1b2c3d')).toBe('1.0.9 (v1.0.9-3-ga1b2c3d)');
		expect(formatAppVersion('1.0.9', 'v1.0.9-dirty')).toBe('1.0.9 (v1.0.9-dirty)');
		expect(formatAppVersion('1.0.9', 'v1.0.8-2-ga1b2c3d-dirty')).toBe('1.0.9 (v1.0.8-2-ga1b2c3d-dirty)');
		expect(formatAppVersion('1.0.9', 'a1b2c3d')).toBe('1.0.9 (a1b2c3d)');
		expect(formatAppVersion('1.0.9', ' a1b2c3d\n')).toBe('1.0.9 (a1b2c3d)');
	});

	it('shows the version alone without git information', () => {
		expect(formatAppVersion('1.0.9', '')).toBe('1.0.9');
		expect(formatAppVersion('1.0.9', undefined)).toBe('1.0.9');
	});

	it('falls back when the build-time constant is missing', () => {
		expect(resolveAppVersion(undefined)).toBe('dev');
		expect(resolveAppVersion('')).toBe('dev');
		expect(resolveAppVersion('1.2.3')).toBe('1.2.3');
	});
});

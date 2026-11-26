import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard for spec/unify-instance-forms STORY-007: instances are created and edited in exactly two dialogs,
 * `IdentityCreateDialog` and `IdentityEditDialog`, hosted by the Identities page and the canvas. A third wrapper
 * around `MemberForm` is how the forms drifted apart before (edit-instance), so any other `<MemberForm` fails here.
 */
const OPEN_TAG = /<MemberForm\b.*?\/>/gs;

/** Components allowed to render the form, each with the reason. */
const ALLOWED = new Set(['lib/components/IdentityCreateDialog.svelte', 'lib/components/IdentityEditDialog.svelte']);

/**
 * The relation-assertion form on the canvas shows only the Assertions section (`hideNameForm`): a reified
 * statement has no name or class to edit. It is the one other use, and it must stay that variant.
 */
const VARIANT_FILE = 'routes/+page.svelte';

/** Every `<MemberForm ... />` tag in the source, as written. */
export function findMemberFormTags(source: string): string[] {
	return source.match(OPEN_TAG) ?? [];
}

export function isAssertionsOnlyVariant(tag: string): boolean {
	return /\bhideNameForm\b/.test(tag);
}

function* sourceFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* sourceFiles(path);
		else if (/\.svelte$/.test(entry)) yield path;
	}
}

describe('findMemberFormTags', () => {
	it('finds single- and multi-line tags', () => {
		expect(findMemberFormTags('<MemberForm mode="edit" />')).toHaveLength(1);
		expect(findMemberFormTags('<MemberForm\n\tmode="create"\n\tonSubmit={x}\n/>')).toHaveLength(1);
		expect(findMemberFormTags('<p>no form</p>')).toEqual([]);
	});

	it('tells the assertions-only variant from an edit or create form', () => {
		expect(isAssertionsOnlyVariant('<MemberForm mode="edit" hideNameForm onCancel={c} />')).toBe(true);
		expect(isAssertionsOnlyVariant('<MemberForm mode="edit" initialLabel="x" />')).toBe(false);
	});
});

describe('app/src', () => {
	it('renders MemberForm only in the two shared dialogs and the assertions-only variant', () => {
		const root = join(process.cwd(), 'src');
		const violations: string[] = [];
		for (const file of sourceFiles(root)) {
			const rel = relative(root, file).split(sep).join('/');
			if (rel.endsWith('MemberForm.svelte') || ALLOWED.has(rel)) continue;
			for (const tag of findMemberFormTags(readFileSync(file, 'utf8'))) {
				if (rel === VARIANT_FILE && isAssertionsOnlyVariant(tag)) continue;
				violations.push(`${rel}: ${tag.replace(/\s+/g, ' ').slice(0, 80)}`);
			}
		}
		expect(violations).toEqual([]);
	});

	it('keeps the allow-list honest: each shared dialog still renders the form', () => {
		const root = join(process.cwd(), 'src');
		for (const rel of ALLOWED) {
			expect(findMemberFormTags(readFileSync(join(root, rel), 'utf8')).length, rel).toBeGreaterThan(0);
		}
	});

	it('fails for a third edit-mode wrapper (verified against a synthetic file)', () => {
		const tags = findMemberFormTags('<MemberForm mode="edit" initialLabel="x" onSubmit={s} onCancel={c} />');
		expect(tags.filter((t) => !isAssertionsOnlyVariant(t))).toHaveLength(1);
	});
});

/**
 * The cell conventions of the SKOS spreadsheet format, shared by the CSV export (STORY-412) and import (STORY-416):
 * several values in one cell are separated by `;` (a literal `;` or `\` inside a value is escaped with `\`), and a
 * reference to another concept is written `label <iri>` so it stays unambiguous.
 */
export function joinValues(values: string[]): string {
	return values.map((v) => v.replace(/[\\;]/g, (ch) => `\\${ch}`)).join(';');
}

export function splitValues(cell: string): string[] {
	const out: string[] = [];
	let current = '';
	for (let i = 0; i < cell.length; i++) {
		const ch = cell[i];
		if (ch === '\\' && i + 1 < cell.length) {
			current += cell[++i];
		} else if (ch === ';') {
			out.push(current);
			current = '';
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out.map((v) => v.trim()).filter(Boolean);
}

export function formatRef(label: string, iri: string): string {
	return `${label} <${iri}>`;
}

export function parseRef(value: string): { label: string; iri: string } {
	const m = /^(.*?)\s*<([^<>\s]+)>$/.exec(value.trim());
	return m ? { label: m[1].trim(), iri: m[2] } : { label: value.trim(), iri: '' };
}

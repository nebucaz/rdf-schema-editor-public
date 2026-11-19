/** Page arithmetic shared by the three tabs of the Vocabulary page. Pages are 1-based. */

/** Number of pages for `total` items; an empty list still has one (empty) page. */
export function pageCount(total: number, pageSize: number): number {
	const size = Math.max(1, Math.floor(pageSize) || 1);
	return Math.max(1, Math.ceil(Math.max(0, total) / size));
}

/** Keeps `page` within `1..pages`; anything that is not a number becomes the first page. */
export function clampPage(page: number, pages: number): number {
	if (!Number.isFinite(page)) return 1;
	return Math.min(Math.max(1, Math.floor(page)), Math.max(1, pages));
}

/** The page numbers a pager shows: first, last and the current page with its neighbours, `null` for a gap.
 *  A gap that would hide only one page shows that page instead. */
export function pageWindow(page: number, pages: number): (number | null)[] {
	const shown = new Set<number>([1, pages]);
	for (let p = page - 1; p <= page + 1; p++) if (p >= 1 && p <= pages) shown.add(p);
	const sorted = [...shown].sort((a, b) => a - b);
	const out: (number | null)[] = [];
	for (let i = 0; i < sorted.length; i++) {
		if (i > 0) {
			const hidden = sorted[i] - sorted[i - 1] - 1;
			if (hidden === 1) out.push(sorted[i] - 1);
			else if (hidden > 1) out.push(null);
		}
		out.push(sorted[i]);
	}
	return out;
}

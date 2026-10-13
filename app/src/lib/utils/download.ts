/** Browser-native file download — no new dependency (`research.md` §4.7). Shared by
 *  `TriplesPanel.svelte` (Turtle/LinkML YAML), `+layout.svelte` (N-Quads), and
 *  `WorkspaceManagementView.svelte` (workspace-export bundle, STORY-093) rather than each
 *  duplicating the same `Blob`/`URL.createObjectURL`/anchor-click dance. */
export function downloadFile(filename: string, text: string, mimeType: string): void {
	downloadBlob(filename, new Blob([text], { type: mimeType }));
}

/** Same download dance for an already-built `Blob` (e.g. a rasterised PNG). */
export function downloadBlob(filename: string, blob: Blob): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

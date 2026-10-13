/**
 * Rasterises a strict-SVG ERD string to PNG (STORY-161). The generated SVG has no `foreignObject` and
 * no external references, so drawing it onto a canvas never taints it. The DOM-bound part is
 * `svgToPngBlob`; `pngDimensions` is pure and separately tested.
 */

export const DEFAULT_PNG_SCALE = 2;
/** Browsers cap canvas size (Safari ~16k side / 268M px); stay well inside. */
export const MAX_PNG_SIDE = 8192;

export interface PngDimensions {
	width: number;
	height: number;
	/** The scale actually applied — smaller than requested when the size cap kicked in. */
	scale: number;
}

export function pngDimensions(svg: string, scale: number = DEFAULT_PNG_SCALE): PngDimensions {
	if (!(scale > 0) || !Number.isFinite(scale)) throw new Error(`Invalid PNG scale: ${scale}`);
	const m = svg.match(/<svg\b[^>]*\sviewBox="([^"]*)"/);
	const parts = m ? m[1].trim().split(/[\s,]+/).map(Number) : [];
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) {
		throw new Error('SVG has no usable viewBox');
	}
	const [, , w, h] = parts;
	const applied = Math.min(scale, MAX_PNG_SIDE / Math.max(w, h));
	return { width: Math.min(MAX_PNG_SIDE, Math.ceil(w * applied)), height: Math.min(MAX_PNG_SIDE, Math.ceil(h * applied)), scale: applied };
}

function loadImage(url: string): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Could not rasterise the ERD SVG'));
		img.src = url;
	});
}

/** Draws `svg` to a canvas at `scale`× and resolves with the PNG. Always revokes its Blob URL. */
export async function svgToPngBlob(svg: string, scale: number = DEFAULT_PNG_SCALE): Promise<Blob> {
	const { width, height } = pngDimensions(svg, scale);
	const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const img = await loadImage(url);
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D context unavailable');
		ctx.drawImage(img, 0, 0, width, height);
		return await new Promise<Blob>((resolve, reject) =>
			canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png')
		);
	} finally {
		URL.revokeObjectURL(url);
	}
}

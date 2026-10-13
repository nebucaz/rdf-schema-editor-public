import { createCanvasMeasurer } from '$lib/utils/erd-measurer-browser';
import { heuristicMeasurer, type TextMeasurer } from '$lib/utils/erd-svg';
import type { CanvasModel } from './canvas-model';
import { buildErdModel } from './erd-model';
import type { Notation, Point } from './erd-layout';
import { renderErd } from './erd-render';

export interface ErdExportInput {
	canvas: CanvasModel;
	/** Active Workspace's member IRIs. */
	memberIris: ReadonlySet<string>;
	/** Stored canvas position per node IRI. */
	positionOf: (iri: string) => Point | undefined;
	/** Namespace base IRI → hex colour. */
	namespaceColors: ReadonlyMap<string, string>;
	notation: Notation;
	legend: boolean;
	theme: 'light' | 'dark';
	selection?: ReadonlySet<string>;
	/** Workbench-hidden namespaces and reverse-relation toggle, so the export mirrors the canvas. */
	hiddenNamespaces?: ReadonlySet<string>;
	showReverseRelations?: boolean;
	/** Crow's Foot `0..*` at relation source ends (Settings preference). */
	sourceMarker?: boolean;
	measurer?: TextMeasurer;
}

/** Workspace (or selection) → ERD model → layout → strict SVG string. */
export function buildErdSvg(input: ErdExportInput): string {
	const model = buildErdModel(input.canvas, {
		memberIris: input.memberIris,
		selection: input.selection,
		namespaceColors: input.namespaceColors,
		hiddenNamespaces: input.hiddenNamespaces,
		showReverseRelations: input.showReverseRelations
	});
	const positions: Record<string, Point> = {};
	for (const iri of [...model.entities.map((e) => e.iri), ...model.externals.map((x) => x.iri)]) {
		const p = input.positionOf(iri);
		if (p) positions[iri] = { x: p.x, y: p.y };
	}
	const measurer = input.measurer ?? createCanvasMeasurer('Helvetica, Arial, sans-serif', heuristicMeasurer);
	return renderErd(model, positions, input.notation, { theme: input.theme, legend: input.legend, measurer, sourceMarker: input.sourceMarker });
}

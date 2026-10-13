import { el, type ErdTheme } from '$lib/utils/erd-svg';
import type { ErdModel } from './erd-model';
import type { ErdLayout } from './erd-layout';
import {
	classBox,
	diamondPoints,
	edgeShape,
	externalBox,
	generalizationMarker,
	GENERALIZATION_MARKER,
	nearEnd,
	polygonEl,
	textEl,
	type RenderParts
} from './erd-render-common';

/** UML class-diagram renderer — symbol specs in `spec/export-erd/notation-reference.md` §2. */
export function renderUml(model: ErdModel, layout: ErdLayout, theme: ErdTheme): RenderParts {
	const labels: string[] = [];
	const edges = layout.edges.map((e) => {
		if (e.kind === 'inheritance') {
			return edgeShape(e, theme, { 'data-kind': 'inheritance', 'marker-end': `url(#${GENERALIZATION_MARKER})` });
		}
		if (e.kind === 'associationClass') {
			return edgeShape(e, theme, { 'data-kind': 'associationClass', 'stroke-dasharray': '6 4' });
		}
		const parts = [edgeShape(e, theme, { 'data-kind': e.kind, 'data-ref': e.ref })];
		if (e.kind === 'relation' && e.name) {
			labels.push(textEl(e.label.x, e.label.y, e.name, { size: 11, anchor: 'middle', fill: theme.text, halo: theme.background, haloWidth: 8 }));
		}
		if (e.cardinality) {
			const p = nearEnd(e, 16, 11);
			parts.push(textEl(p.x, p.y, e.multiplicity ?? e.cardinality, { size: 11, anchor: 'middle', fill: theme.text, halo: theme.background, extra: { 'data-multiplicity-of': e.ref } }));
		}
		return el('g', {}, parts);
	});

	const diamonds = layout.symbols
		.filter((s) => s.kind === 'diamond')
		.map((s) => polygonEl(diamondPoints(s.rect), { 'data-kind': 'association-diamond', 'data-ref': s.ref, fill: theme.surface, stroke: theme.stroke, 'stroke-width': 1.5 }));

	const boxes = [
		...model.entities.map((e) => classBox(e, layout.entities[e.iri], theme, 'uml')),
		...model.externals.map((x) => externalBox(x, layout.entities[x.iri], theme))
	];
	return { defs: [generalizationMarker(theme)], body: [...edges, ...diamonds, ...labels, ...boxes] };
}

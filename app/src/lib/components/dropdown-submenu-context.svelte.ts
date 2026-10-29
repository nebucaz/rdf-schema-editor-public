interface DropdownSubmenuCoordinator {
	readonly openId: string | null;
	setOpenId(id: string | null): void;
}

/** Shared "which group is open" slot for every `DropdownSubmenuGroup` instance (STORY-144) — a
 *  group can't know about its siblings via its own local `$state` alone, since each is a separate
 *  component instance. A plain module-level singleton, not Svelte context: `DropdownSubmenuGroup`
 *  is written inside `DropdownMenu`'s `children` snippet in `+layout.svelte`, and Svelte context
 *  follows the *component instantiation tree* (the snippet's own declaring component, i.e.
 *  `+layout.svelte`) rather than the *rendered* tree, so context set by `DropdownMenu` itself would
 *  never be visible here. Only the Settings menu contains submenu groups (the user menu has none),
 *  so a single shared slot is safe even though more than one `DropdownMenu` exists in the app. */
let openId = $state<string | null>(null);

const coordinator: DropdownSubmenuCoordinator = {
	get openId() {
		return openId;
	},
	setOpenId(id) {
		openId = id;
	}
};

export function getDropdownSubmenuCoordinator(): DropdownSubmenuCoordinator {
	return coordinator;
}

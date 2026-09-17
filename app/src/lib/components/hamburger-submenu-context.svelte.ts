interface HamburgerSubmenuCoordinator {
	readonly openId: string | null;
	setOpenId(id: string | null): void;
}

/** Shared "which group is open" slot for every `HamburgerSubmenuGroup` instance (STORY-144) — a
 *  group can't know about its siblings via its own local `$state` alone, since each is a separate
 *  component instance. A plain module-level singleton, not Svelte context: `HamburgerSubmenuGroup`
 *  is written inside `HamburgerMenu`'s `children` snippet in `+layout.svelte`, and Svelte context
 *  follows the *component instantiation tree* (the snippet's own declaring component, i.e.
 *  `+layout.svelte`) rather than the *rendered* tree, so context set by `HamburgerMenu` itself would
 *  never be visible here. There's only ever one `HamburgerMenu` in the app, so a singleton is safe. */
let openId = $state<string | null>(null);

const coordinator: HamburgerSubmenuCoordinator = {
	get openId() {
		return openId;
	},
	setOpenId(id) {
		openId = id;
	}
};

export function getHamburgerSubmenuCoordinator(): HamburgerSubmenuCoordinator {
	return coordinator;
}

interface HideableMenuItem {
	IsHidden: boolean
}

export function setHidden(hidden: boolean, items: readonly HideableMenuItem[]) {
	for (const item of items) {
		item.IsHidden = hidden
	}
}

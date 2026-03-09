import { WardPoint } from "./WardTypes"

export interface RemoteDragState {
	/** Live ward inside remoteWards that is being dragged. */
	ward: WardPoint
	/** Copy of the ward as it was when the drag started, used by cancel. */
	snapshot: WardPoint
	/** Cursor-following copy rendered instead of the ward while dragging. */
	preview: WardPoint
}

export class WardState {
	public remoteWards: WardPoint[] = []
	public customWards: WardPoint[] = []
	public hoveredWard?: WardPoint
	public remoteDrag?: RemoteDragState
	public isRemoteLoaded = false
	public isCustomLoaded = false
	public alphaAnimation = 0
}

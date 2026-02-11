import { WardPoint } from "./WardTypes"

export class WardState {
	public remoteWards: WardPoint[] = []
	public customWards: WardPoint[] = []
	public hoveredWard?: WardPoint
	public draggedRemoteWard?: WardPoint
	public draggedRemoteWardSnapshot?: WardPoint
	public draggedRemoteWardPreview?: WardPoint
	public isRemoteLoaded = false
	public remoteSourceKey = "opendota"
	public isCustomLoaded = false
	public draggedRemoteWardID = -1
	public alphaAnimation = 0

	public ResetRemote() {
		this.remoteWards = []
		this.hoveredWard = undefined
		this.draggedRemoteWard = undefined
		this.draggedRemoteWardSnapshot = undefined
		this.draggedRemoteWardPreview = undefined
		this.isRemoteLoaded = false
		this.draggedRemoteWardID = -1
	}
}

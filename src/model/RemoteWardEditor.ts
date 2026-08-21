import {
	GetPositionHeight,
	InputManager,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { distanceSq2D, worldToCell } from "./WardGeometry"
import { cloneWard } from "./WardSerialization"
import { WardState } from "./WardState"
import { WardPoint } from "./WardTypes"

const REMOTE_PICK_DISTANCE_WORLD = 260

export class RemoteWardEditor {
	constructor(private readonly state: WardState) {}

	public ResetDragState() {
		this.state.remoteDrag = undefined
	}

	public PickHoveredRemoteWard() {
		const targetID = this.FindRemoteWardUnderCursor()
		if (targetID === undefined) {
			return
		}
		const ward = this.state.remoteWards[targetID]
		this.state.remoteDrag = {
			ward,
			snapshot: cloneWard(ward),
			preview: cloneWard(ward)
		}
	}

	public UpdateDraggedRemoteWardToCursor() {
		const drag = this.state.remoteDrag
		if (drag === undefined) {
			return
		}
		this.ApplyWorldToWard(drag.preview, InputManager.CursorOnWorld)
	}

	public FinishRemoteDrag(): boolean {
		const drag = this.state.remoteDrag
		this.state.remoteDrag = undefined
		if (drag === undefined) {
			return false
		}
		Object.assign(drag.ward, cloneWard(drag.preview))
		return true
	}

	public CancelRemoteDrag() {
		const drag = this.state.remoteDrag
		this.state.remoteDrag = undefined
		if (drag !== undefined) {
			Object.assign(drag.ward, drag.snapshot)
		}
	}

	public DeleteRemoteHoveredOrDraggedWard(): boolean {
		const drag = this.state.remoteDrag
		const targetID =
			drag !== undefined
				? this.IndexOfWard(drag.ward)
				: this.FindRemoteWardUnderCursor()
		if (targetID === undefined) {
			return false
		}
		this.state.remoteWards.splice(targetID, 1)
		this.state.remoteDrag = undefined
		return true
	}

	private IndexOfWard(ward: WardPoint): number | undefined {
		const index = this.state.remoteWards.indexOf(ward)
		return index >= 0 ? index : undefined
	}

	private FindRemoteWardUnderCursor(): number | undefined {
		const hoveredWard = this.state.hoveredWard
		if (hoveredWard !== undefined) {
			const hoveredID = this.IndexOfWard(hoveredWard)
			if (hoveredID !== undefined) {
				return hoveredID
			}
		}
		const cursorWorld = InputManager.CursorOnWorld
		let bestID: number | undefined
		let bestDistSq = REMOTE_PICK_DISTANCE_WORLD * REMOTE_PICK_DISTANCE_WORLD
		for (let i = 0; i < this.state.remoteWards.length; i++) {
			const ward = this.state.remoteWards[i]
			const distSq = distanceSq2D(ward.x, ward.y, cursorWorld.x, cursorWorld.y)
			if (distSq <= bestDistSq) {
				bestDistSq = distSq
				bestID = i
			}
		}
		return bestID
	}

	private ApplyWorldToWard(ward: WardPoint, world: Vector3) {
		ward.x = world.x
		ward.y = world.y
		ward.z = GetPositionHeight(new Vector2(world.x, world.y))
		ward.cellX = worldToCell(world.x)
		ward.cellY = worldToCell(world.y)
	}
}

import {
	GetPositionHeight,
	InputManager,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { WardState } from "./WardState"
import { WardPoint } from "./WardTypes"

const REMOTE_PICK_DISTANCE_WORLD = 260
// world -> minimap cell mapping, mirrors build_ward_reco_runtime.py.
const WORLD_CELL_SIZE = 128
const WORLD_ORIGIN_OFFSET = 16384

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
			snapshot: this.CloneWard(ward),
			preview: this.CloneWard(ward)
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
		Object.assign(drag.ward, this.CloneWard(drag.preview))
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
			const dx = ward.x - cursorWorld.x
			const dy = ward.y - cursorWorld.y
			const distSq = dx * dx + dy * dy
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
		ward.cellX = (world.x + WORLD_ORIGIN_OFFSET) / WORLD_CELL_SIZE
		ward.cellY = (world.y + WORLD_ORIGIN_OFFSET) / WORLD_CELL_SIZE
	}

	private CloneWard(ward: WardPoint): WardPoint {
		return {
			x: ward.x,
			y: ward.y,
			z: ward.z,
			cellX: ward.cellX,
			cellY: ward.cellY,
			timeBucket: ward.timeBucket,
			score: ward.score,
			observerRiskyQuickDeward: ward.observerRiskyQuickDeward,
			type: ward.type,
			description: ward.description,
			teams: ward.teams !== undefined ? [...ward.teams] : undefined
		}
	}
}

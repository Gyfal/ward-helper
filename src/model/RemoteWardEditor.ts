import {
	GetPositionHeight,
	InputManager,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { WardState } from "./WardState"
import { WardPoint } from "./WardTypes"

const REMOTE_PICK_DISTANCE_WORLD = 260

export class RemoteWardEditor {
	constructor(private readonly state: WardState) {}

	public ResetDragState() {
		this.state.draggedRemoteWardID = -1
		this.state.draggedRemoteWard = undefined
		this.state.draggedRemoteWardSnapshot = undefined
		this.state.draggedRemoteWardPreview = undefined
	}

	public PickHoveredRemoteWard() {
		const targetID = this.FindRemoteWardUnderCursor()
		if (targetID === undefined) {
			return
		}
		this.state.draggedRemoteWardID = targetID
		const ward = this.state.remoteWards[targetID]
		this.state.draggedRemoteWard = ward
		this.state.draggedRemoteWardSnapshot = this.CloneWard(ward)
		this.state.draggedRemoteWardPreview = this.CloneWard(ward)
	}

	public UpdateDraggedRemoteWardToCursor() {
		const id = this.state.draggedRemoteWardID
		if (id < 0 || id >= this.state.remoteWards.length) {
			this.ResetDragState()
			return
		}
		const cursorWorld = InputManager.CursorOnWorld
		const preview = this.state.draggedRemoteWardPreview
		if (preview === undefined) {
			return
		}
		this.ApplyWorldToWard(preview, cursorWorld)
	}

	public FinishRemoteDrag(): boolean {
		const id = this.state.draggedRemoteWardID
		const preview = this.state.draggedRemoteWardPreview
		if (
			id >= 0 &&
			id < this.state.remoteWards.length &&
			preview !== undefined
		) {
			this.RestoreWard(this.state.remoteWards[id], preview)
			this.ResetDragState()
			return true
		}
		this.ResetDragState()
		return false
	}

	public CancelRemoteDrag() {
		const id = this.state.draggedRemoteWardID
		const snapshot = this.state.draggedRemoteWardSnapshot
		if (
			id >= 0 &&
			id < this.state.remoteWards.length &&
			snapshot !== undefined
		) {
			this.RestoreWard(this.state.remoteWards[id], snapshot)
		}
		this.ResetDragState()
	}

	public DeleteRemoteHoveredOrDraggedWard(): boolean {
		let targetID = this.state.draggedRemoteWardID
		if (targetID < 0) {
			const hovered = this.FindRemoteWardUnderCursor()
			targetID = hovered ?? -1
		}
		if (targetID < 0 || targetID >= this.state.remoteWards.length) {
			return false
		}
		this.state.remoteWards.splice(targetID, 1)
		this.ResetDragState()
		return true
	}

	private FindRemoteWardUnderCursor(): number | undefined {
		const hoveredWard = this.state.hoveredWard
		if (hoveredWard !== undefined) {
			for (let i = 0; i < this.state.remoteWards.length; i++) {
				if (this.state.remoteWards[i] === hoveredWard) {
					return i
				}
			}
		}
		const cursorWorld = InputManager.CursorOnWorld
		const maxDistSq = REMOTE_PICK_DISTANCE_WORLD * REMOTE_PICK_DISTANCE_WORLD
		let bestID = -1
		let bestDistSq = maxDistSq
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
		if (bestID >= 0) {
			return bestID
		}
		return undefined
	}

	private ApplyWorldToWard(ward: WardPoint, world: Vector3) {
		ward.x = world.x
		ward.y = world.y
		ward.z = GetPositionHeight(new Vector2(world.x, world.y))
	}

	private CloneWard(ward: WardPoint): WardPoint {
		return {
			x: ward.x,
			y: ward.y,
			z: ward.z,
			timeBucket: ward.timeBucket,
			towerDiffAvg: ward.towerDiffAvg,
			score: ward.score,
			observerRiskyQuickDeward: ward.observerRiskyQuickDeward,
			type: ward.type,
			description: ward.description,
			teams: ward.teams !== undefined ? [...ward.teams] : undefined
		}
	}

	private RestoreWard(target: WardPoint, source: WardPoint) {
		target.x = source.x
		target.y = source.y
		target.z = source.z
		target.timeBucket = source.timeBucket
		target.towerDiffAvg = source.towerDiffAvg
		target.score = source.score
		target.observerRiskyQuickDeward = source.observerRiskyQuickDeward
		target.type = source.type
		target.description = source.description
		target.teams = source.teams !== undefined ? [...source.teams] : undefined
	}
}

import { Vector3 } from "github.com/octarine-public/wrapper/index"

import { WardPoint } from "./WardTypes"

// world -> minimap cell mapping, mirrors build_ward_reco_runtime.py.
export const WORLD_CELL_SIZE = 128
export const WORLD_ORIGIN_OFFSET = 16384

export function worldToCell(world: number): number {
	return (world + WORLD_ORIGIN_OFFSET) / WORLD_CELL_SIZE
}

export function distanceSq2D(ax: number, ay: number, bx: number, by: number): number {
	const dx = ax - bx
	const dy = ay - by
	return dx * dx + dy * dy
}

export function isWithinRadius2D(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	radius: number
): boolean {
	return distanceSq2D(ax, ay, bx, by) <= radius * radius
}

export function getWardPosition(ward: WardPoint): Vector3 {
	return new Vector3(ward.x, ward.y, ward.z)
}

/** Cell coordinates of the ward, derived from world position when missing. */
export function getWardCellCoords(ward: WardPoint): { x: number; y: number } {
	if (ward.cellX !== undefined && ward.cellY !== undefined) {
		return { x: ward.cellX, y: ward.cellY }
	}
	return { x: worldToCell(ward.x), y: worldToCell(ward.y) }
}

/** Distance in dataset cells, infinite when either ward has no cell data. */
export function getWardCellDistance(a: WardPoint, b: WardPoint): number {
	if (
		a.cellX === undefined ||
		a.cellY === undefined ||
		b.cellX === undefined ||
		b.cellY === undefined
	) {
		return Number.POSITIVE_INFINITY
	}
	return Math.hypot(a.cellX - b.cellX, a.cellY - b.cellY)
}

/** World distance expressed in cell units, always available. */
export function getWardWorldDistanceInCells(a: WardPoint, b: WardPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y) / WORLD_CELL_SIZE
}

export function getWardDistance3D(a: WardPoint, b: WardPoint): number {
	return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

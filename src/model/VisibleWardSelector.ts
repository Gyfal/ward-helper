import { Vector3 } from "github.com/octarine-public/wrapper/index"

import { clamp } from "./Utils"
import { DEFAULT_WARD_TEAMS, WardPoint, WardTeam, WardTypes } from "./WardTypes"

const PLACED_WARD_SKIP_RADIUS = 260
// Keyed directly by time bucket id (matches build_ward_reco_runtime.py TIME_BUCKETS).
const ADAPTIVE_SPACING_BY_BUCKET: Record<
	string,
	{ minCellDistance: number; minMinimapDistance: number }
> = {
	"0_12": { minCellDistance: 2.5, minMinimapDistance: 5.0 },
	"12_25": { minCellDistance: 2.0, minMinimapDistance: 4.2 },
	"25_50": { minCellDistance: 1.8, minMinimapDistance: 3.6 },
	"50_plus": { minCellDistance: 1.5, minMinimapDistance: 3.0 }
}
const DEFAULT_ADAPTIVE_SPACING = {
	minCellDistance: 1.5,
	minMinimapDistance: 2.5
}
const ADAPTIVE_REGION_PHASE_BY_BUCKET: Record<string, number> = {
	"0_12": 1.2,
	"12_25": 1.1,
	"25_50": 1.0,
	"50_plus": 0.9
}
const DEFAULT_ADAPTIVE_REGION_PHASE_SCALE = 1.0
const AUTO_REGION_SIZE_BOUNDS = {
	min: 8,
	max: 96
}
const AUTO_REGION_TOP_N_BASELINE = 10
const AUTO_REGION_QUOTA_BASELINE = 3

export interface VisibleWardSelectorContext {
	remoteWards: WardPoint[]
	customWards: WardPoint[]
	localTeam: WardTeam | undefined
	currentBucket: string
	placedObserver: Vector3[]
	placedSentry: Vector3[]
	showCustomWards: boolean
	teamFilterEnabled: boolean
	dynamicTopPerType: number
	dynamicMinCellDistance: number
	dynamicMinMinimapDistance: number
	dynamicDedupeRadius3D: number
	dynamicExcludeRiskyObserver: boolean
	dynamicAdaptiveSpacingEnabled: boolean
	dynamicRegionQuota: number
	dynamicAutoRegionSizeEnabled: boolean
	dynamicRegionSize: number
}

export class VisibleWardSelector {
	public Select(context: VisibleWardSelectorContext): WardPoint[] {
		const remoteVisible = this.dedupeByRadius3D(
			this.buildDynamicVisibleWards(context),
			context.dynamicDedupeRadius3D
		)
		if (!context.showCustomWards) {
			return remoteVisible
		}

		const out = [...remoteVisible]
		for (let i = 0; i < context.customWards.length; i++) {
			const ward = context.customWards[i]
			if (this.isWardVisibleForLocalTeam(ward, context)) {
				out.push(ward)
			}
		}
		return out
	}

	private dedupeByRadius3D(wards: WardPoint[], radius: number): WardPoint[] {
		if (radius <= 0 || wards.length <= 1) {
			return wards
		}
		// Input arrives sorted by score within each type, and only same-type
		// wards conflict, so a forward pass keeps the better ward of each pair.
		const out: WardPoint[] = []
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			let hasBetterNearby = false
			for (let j = 0; j < out.length; j++) {
				if (
					out[j].type === ward.type &&
					this.getWardDistance3D(out[j], ward) < radius
				) {
					hasBetterNearby = true
					break
				}
			}
			if (!hasBetterNearby) {
				out.push(ward)
			}
		}
		return out
	}

	private buildDynamicVisibleWards(context: VisibleWardSelectorContext): WardPoint[] {
		const localTeam = context.localTeam
		if (localTeam === undefined) {
			return []
		}

		const topN = Math.max(1, Math.floor(context.dynamicTopPerType))
		let minCellDistance = context.dynamicMinCellDistance
		let minMinimapDistance = context.dynamicMinMinimapDistance
		if (context.dynamicAdaptiveSpacingEnabled) {
			const adaptive =
				ADAPTIVE_SPACING_BY_BUCKET[context.currentBucket] ??
				DEFAULT_ADAPTIVE_SPACING
			minCellDistance = adaptive.minCellDistance
			minMinimapDistance = adaptive.minMinimapDistance
		}
		const regionQuota = Math.max(0, Math.floor(context.dynamicRegionQuota))
		let regionSize = Math.max(1, context.dynamicRegionSize)
		if (context.dynamicAutoRegionSizeEnabled) {
			regionSize = this.getAdaptiveRegionSize(
				context.currentBucket,
				regionSize,
				topN,
				regionQuota
			)
		}

		const ownObserver: WardPoint[] = []
		const ownSentry: WardPoint[] = []
		for (let i = 0; i < context.remoteWards.length; i++) {
			const ward = context.remoteWards[i]
			if (!this.isWardVisibleByTimeBucket(ward, context)) {
				continue
			}
			if (!this.hasWardTeam(ward, localTeam)) {
				continue
			}
			if (this.isWardBlockedByPlacedWards(ward, context)) {
				continue
			}
			if (ward.type === WardTypes.Observer) {
				if (
					!context.dynamicExcludeRiskyObserver ||
					!ward.observerRiskyQuickDeward
				) {
					ownObserver.push(ward)
				}
			} else if (ward.type === WardTypes.Sentry) {
				// Sentry score already includes the precomputed counter-sentry boost.
				ownSentry.push(ward)
			}
		}

		const byScore = (a: WardPoint, b: WardPoint) => this.compareWardByRank(a, b)
		ownObserver.sort(byScore)
		ownSentry.sort(byScore)

		const observerTop = this.dedupeRanked(
			ownObserver,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize
		)
		const ownSentryTop = this.dedupeRanked(
			ownSentry,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize
		)

		return [...observerTop, ...ownSentryTop]
	}

	private compareWardByRank(a: WardPoint, b: WardPoint): number {
		const as = this.getWardScore(a)
		const bs = this.getWardScore(b)
		// Both scores can be -Infinity; subtracting would produce NaN.
		return bs === as ? 0 : bs - as
	}

	private dedupeRanked(
		source: WardPoint[],
		topN: number,
		minCellDistance: number,
		minMinimapDistance: number,
		regionQuota: number,
		regionSize: number
	): WardPoint[] {
		if (minCellDistance <= 0 && minMinimapDistance <= 0 && regionQuota <= 0) {
			return source.slice(0, topN)
		}
		const out: WardPoint[] = []
		for (let i = 0; i < source.length; i++) {
			const ward = source[i]
			if (
				this.isWardBlockedByDedupeRules(
					ward,
					out,
					minCellDistance,
					minMinimapDistance
				)
			) {
				continue
			}
			if (this.isRegionQuotaReached(ward, out, regionQuota, regionSize)) {
				continue
			}
			out.push(ward)
			if (out.length >= topN) {
				break
			}
		}
		return out
	}

	private isWardVisibleForLocalTeam(
		ward: WardPoint,
		context: VisibleWardSelectorContext
	): boolean {
		if (!context.teamFilterEnabled || context.localTeam === undefined) {
			return true
		}
		return this.hasWardTeam(ward, context.localTeam)
	}

	private isWardBlockedByPlacedWards(
		ward: WardPoint,
		context: VisibleWardSelectorContext
	): boolean {
		const source =
			ward.type === WardTypes.Observer
				? context.placedObserver
				: context.placedSentry
		const maxDistSq = PLACED_WARD_SKIP_RADIUS * PLACED_WARD_SKIP_RADIUS
		for (let i = 0; i < source.length; i++) {
			const p = source[i]
			const dx = ward.x - p.x
			const dy = ward.y - p.y
			if (dx * dx + dy * dy <= maxDistSq) {
				return true
			}
		}
		return false
	}

	private isWardVisibleByTimeBucket(
		ward: WardPoint,
		context: VisibleWardSelectorContext
	): boolean {
		const bucket = ward.timeBucket
		if (bucket === undefined || bucket.length === 0) {
			return true
		}
		return bucket === context.currentBucket
	}

	private getWardScore(ward: WardPoint): number {
		return ward.score ?? Number.NEGATIVE_INFINITY
	}

	private hasWardTeam(ward: WardPoint, team: WardTeam): boolean {
		const teams = ward.teams ?? DEFAULT_WARD_TEAMS
		return teams.includes(team)
	}

	private getWardCellDistance(a: WardPoint, b: WardPoint): number {
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

	private getWardWorldDistance(a: WardPoint, b: WardPoint): number {
		return Math.hypot(a.x - b.x, a.y - b.y) / 128
	}

	private getWardDistance3D(a: WardPoint, b: WardPoint): number {
		return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
	}

	private isWardBlockedByDedupeRules(
		ward: WardPoint,
		selected: WardPoint[],
		minCellDistance: number,
		minMinimapDistance: number
	): boolean {
		for (let j = 0; j < selected.length; j++) {
			const current = selected[j]
			if (
				minCellDistance > 0 &&
				this.getWardCellDistance(ward, current) < minCellDistance
			) {
				return true
			}
			if (
				minMinimapDistance > 0 &&
				this.getWardWorldDistance(ward, current) < minMinimapDistance
			) {
				return true
			}
		}
		return false
	}

	private getAdaptiveRegionSize(
		bucket: string,
		baseRegionSize: number,
		topN: number,
		regionQuota: number
	): number {
		const phaseScale =
			ADAPTIVE_REGION_PHASE_BY_BUCKET[bucket] ?? DEFAULT_ADAPTIVE_REGION_PHASE_SCALE
		const topNScale = Math.sqrt(AUTO_REGION_TOP_N_BASELINE / Math.max(1, topN))
		const quotaScale = Math.sqrt(
			Math.max(1, regionQuota) / AUTO_REGION_QUOTA_BASELINE
		)
		const scaled = baseRegionSize * phaseScale * topNScale * quotaScale
		return clamp(scaled, AUTO_REGION_SIZE_BOUNDS.min, AUTO_REGION_SIZE_BOUNDS.max)
	}

	private isRegionQuotaReached(
		ward: WardPoint,
		selected: WardPoint[],
		regionQuota: number,
		regionSize: number
	): boolean {
		if (regionQuota <= 0) {
			return false
		}
		const key = this.getWardRegionKey(ward, regionSize)
		let count = 0
		for (let i = 0; i < selected.length; i++) {
			if (this.getWardRegionKey(selected[i], regionSize) === key) {
				count += 1
				if (count >= regionQuota) {
					return true
				}
			}
		}
		return false
	}

	private getWardRegionKey(ward: WardPoint, regionSize: number): string {
		const size = Math.max(1, regionSize)
		const m = this.getWardMapCoords(ward)
		return `${Math.floor(m.x / size)}:${Math.floor(m.y / size)}`
	}

	private getWardMapCoords(ward: WardPoint): { x: number; y: number } {
		if (ward.cellX !== undefined && ward.cellY !== undefined) {
			return { x: ward.cellX, y: ward.cellY }
		}
		// World fallback, mapped into 0..256 minimap-like space.
		return {
			x: (ward.x + 16384) / 128,
			y: (ward.y + 16384) / 128
		}
	}
}

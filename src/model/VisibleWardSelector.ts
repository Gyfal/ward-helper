import { Vector3 } from "github.com/octarine-public/wrapper/index"

import {
	compareMetricAsc,
	compareMetricDesc,
	firstNonZeroComparison,
	normalizeTowerKey,
	parseBucketStartMinute
} from "./Utils"
import { RemoteWardSourceKey } from "./WardDataLoader"
import {
	DEFAULT_WARD_TEAMS,
	WardPoint,
	WardTeam,
	WardTeams,
	WardTypes
} from "./WardTypes"

const CONTEXT_LEVEL_ORDER: Record<string, number> = {
	direct: 0,
	weak: 1,
	fallback: 2,
	base: 3
}
const PLACED_WARD_SKIP_RADIUS = 260
const COUNTER_SENTRY_DISTANCE_FALLOFF = 6
const ADAPTIVE_SPACING_BY_MINUTE: readonly {
	fromMin: number
	minCellDistance: number
	minMinimapDistance: number
}[] = [
	{ fromMin: 0, minCellDistance: 2.5, minMinimapDistance: 5.0 },
	{ fromMin: 10, minCellDistance: 2.0, minMinimapDistance: 4.2 },
	{ fromMin: 20, minCellDistance: 1.8, minMinimapDistance: 3.6 },
	{ fromMin: 35, minCellDistance: 1.6, minMinimapDistance: 3.2 },
	{ fromMin: 50, minCellDistance: 1.5, minMinimapDistance: 3.0 }
]
const DEFAULT_ADAPTIVE_SPACING = {
	minCellDistance: 1.5,
	minMinimapDistance: 2.5
}

export interface VisibleWardSelectorContext {
	remoteSourceKey: RemoteWardSourceKey
	remoteWards: WardPoint[]
	customWards: WardPoint[]
	localTeam: WardTeam | undefined
	currentBucket: string
	placedObserver: Vector3[]
	placedSentry: Vector3[]
	showCustomWards: boolean
	teamFilterEnabled: boolean
	useTowerStateFilter: boolean
	hidePlacedWards: boolean
	dynamicTopPerType: number
	dynamicMinCellDistance: number
	dynamicMinMinimapDistance: number
	dynamicDedupeRadius3D: number
	dynamicExcludeRiskyObserver: boolean
	missingOwnTowers: string[]
	missingEnemyTowers: string[]
	dynamicTowerFitWeight: number
	dynamicMinTowerFit: number
	dynamicMinContextSupportPlacements: number
	dynamicConfidencePlacementsRef: number
	dynamicConfidenceMatchesRef: number
	dynamicAdaptiveSpacingEnabled: boolean
	dynamicRegionQuota: number
	dynamicRegionSize: number
	dynamicLaneQuotaMin: number
	dynamicLaneQuotaUse: "own" | "enemy" | "both"
	dynamicLaneBand: number
}

export interface VisibleWardDebugStats {
	sourceKey: RemoteWardSourceKey
	mode: "dynamic" | "static"
	bucket: string
	localTeam?: WardTeam
	remoteInput: number
	timeFilteredOut: number
	teamFilteredOut: number
	placedFilteredOut: number
	remoteVisible: number
	customAdded: number
	finalVisible: number
	dynamicCandidate?: number
	dynamicOwnObserver?: number
	dynamicOwnSentry?: number
	dynamicEnemyObserver?: number
	dynamicObserverTop?: number
	dynamicCounterTop?: number
}

export class VisibleWardSelector {
	private lastDebugStats: VisibleWardDebugStats | undefined

	public GetLastDebugStats(): VisibleWardDebugStats | undefined {
		return this.lastDebugStats
	}

	public Select(context: VisibleWardSelectorContext): WardPoint[] {
		const remoteVisible = this.dedupeByRadius3D(
			this.collectRemoteVisibleWards(context),
			context.dynamicDedupeRadius3D
		)
		const baseStats: VisibleWardDebugStats = this.lastDebugStats ?? {
			sourceKey: context.remoteSourceKey,
			mode: context.remoteSourceKey === "ward_reco_dynamic" ? "dynamic" : "static",
			bucket: context.currentBucket,
			localTeam: context.localTeam,
			remoteInput: context.remoteWards.length,
			timeFilteredOut: 0,
			teamFilteredOut: 0,
			placedFilteredOut: 0,
			remoteVisible: remoteVisible.length,
			customAdded: 0,
			finalVisible: remoteVisible.length
		}
		baseStats.remoteVisible = remoteVisible.length
		if (!context.showCustomWards) {
			baseStats.customAdded = 0
			baseStats.finalVisible = remoteVisible.length
			this.lastDebugStats = baseStats
			return remoteVisible
		}

		const out = [...remoteVisible]
		let customAdded = 0
		for (let i = 0; i < context.customWards.length; i++) {
			const ward = context.customWards[i]
			if (this.isWardVisibleForLocalTeam(ward, context)) {
				out.push(ward)
				customAdded += 1
			}
		}
		baseStats.customAdded = customAdded
		baseStats.finalVisible = out.length
		this.lastDebugStats = baseStats
		return out
	}

	private collectRemoteVisibleWards(context: VisibleWardSelectorContext): WardPoint[] {
		return this.collectRemoteVisibleWardsByFilters(context)
	}

	private dedupeByRadius3D(wards: WardPoint[], radius: number): WardPoint[] {
		if (radius <= 0 || wards.length <= 1) {
			return wards
		}
		const ranked = wards
			.map((ward, index) => ({ ward, index }))
			.sort((a, b) => this.compareWardByPopularity(a.ward, b.ward))

		const selectedIndices: number[] = []
		for (let i = 0; i < ranked.length; i++) {
			const current = ranked[i]
			let hasBetterNearby = false
			for (let j = 0; j < selectedIndices.length; j++) {
				const selectedWard = wards[selectedIndices[j]]
				if (selectedWard.type !== current.ward.type) {
					continue
				}
				if (this.getWardDistance3D(selectedWard, current.ward) < radius) {
					hasBetterNearby = true
					break
				}
			}
			if (!hasBetterNearby) {
				selectedIndices.push(current.index)
			}
		}

		selectedIndices.sort((a, b) => a - b)
		const out: WardPoint[] = []
		for (let i = 0; i < selectedIndices.length; i++) {
			out.push(wards[selectedIndices[i]])
		}
		return out
	}

	private collectRemoteVisibleWardsByFilters(
		context: VisibleWardSelectorContext
	): WardPoint[] {
		if (context.remoteSourceKey === "ward_reco_dynamic") {
			return this.buildDynamicVisibleWards(context)
		}

		const out: WardPoint[] = []
		let timeFilteredOut = 0
		let teamFilteredOut = 0
		let placedFilteredOut = 0
		for (let i = 0; i < context.remoteWards.length; i++) {
			const ward = context.remoteWards[i]
			if (!this.isWardVisibleByTimeBucket(ward, context)) {
				timeFilteredOut += 1
				continue
			}
			if (!this.isWardVisibleForLocalTeam(ward, context)) {
				teamFilteredOut += 1
				continue
			}
			if (this.isWardBlockedByPlacedWards(ward, context)) {
				placedFilteredOut += 1
				continue
			}
			out.push(ward)
		}
		this.lastDebugStats = {
			sourceKey: context.remoteSourceKey,
			mode: "static",
			bucket: context.currentBucket,
			localTeam: context.localTeam,
			remoteInput: context.remoteWards.length,
			timeFilteredOut,
			teamFilteredOut,
			placedFilteredOut,
			remoteVisible: out.length,
			customAdded: 0,
			finalVisible: out.length
		}
		return out
	}

	private buildDynamicVisibleWards(context: VisibleWardSelectorContext): WardPoint[] {
		const localTeam = context.localTeam
		if (localTeam === undefined) {
			this.lastDebugStats = {
				sourceKey: context.remoteSourceKey,
				mode: "dynamic",
				bucket: context.currentBucket,
				localTeam: undefined,
				remoteInput: context.remoteWards.length,
				timeFilteredOut: 0,
				teamFilteredOut: 0,
				placedFilteredOut: 0,
				remoteVisible: 0,
				customAdded: 0,
				finalVisible: 0
			}
			return []
		}
		const enemyTeam =
			localTeam === WardTeams.Radiant ? WardTeams.Dire : WardTeams.Radiant

		const candidate: WardPoint[] = []
		for (let i = 0; i < context.remoteWards.length; i++) {
			const ward = context.remoteWards[i]
			if (!this.isWardVisibleByTimeBucket(ward, context)) {
				continue
			}
			candidate.push(ward)
		}

		const topN = Math.max(1, Math.floor(context.dynamicTopPerType))
		let minCellDistance = context.dynamicMinCellDistance
		let minMinimapDistance = context.dynamicMinMinimapDistance
		if (context.dynamicAdaptiveSpacingEnabled) {
			const adaptive = this.getAdaptiveSpacing(context.currentBucket)
			minCellDistance = adaptive.minCellDistance
			minMinimapDistance = adaptive.minMinimapDistance
		}
		const regionQuota = Math.max(0, Math.floor(context.dynamicRegionQuota))
		const regionSize = Math.max(1, context.dynamicRegionSize)
		const laneQuotaMin = Math.max(0, Math.floor(context.dynamicLaneQuotaMin))
		const laneBand = Math.max(0, context.dynamicLaneBand)
		const excludeRiskyObserver = context.dynamicExcludeRiskyObserver
		const laneQuotaLanes = this.getLaneQuotaLanes(context)

		const ownObserver: WardPoint[] = []
		const ownSentry: WardPoint[] = []
		const enemyObserver: WardPoint[] = []
		for (let i = 0; i < candidate.length; i++) {
			const ward = candidate[i]
			if (ward.type === WardTypes.Observer) {
				if (
					this.hasWardTeam(ward, localTeam) &&
					(!excludeRiskyObserver || !ward.observerRiskyQuickDeward) &&
					!this.isWardBlockedByPlacedWards(ward, context)
				) {
					ownObserver.push(
						this.decorateWardWithContextRuntime(
							ward,
							context.missingOwnTowers,
							context.missingEnemyTowers,
							context
						)
					)
				}
				if (this.hasWardTeam(ward, enemyTeam)) {
					enemyObserver.push(
						this.decorateWardWithContextRuntime(
							ward,
							context.missingEnemyTowers,
							context.missingOwnTowers,
							context
						)
					)
				}
				continue
			}
			if (
				ward.type === WardTypes.Sentry &&
				this.hasWardTeam(ward, localTeam) &&
				!this.isWardBlockedByPlacedWards(ward, context)
			) {
				ownSentry.push(
					this.decorateWardWithContextRuntime(
						ward,
						context.missingOwnTowers,
						context.missingEnemyTowers,
						context
					)
				)
			}
		}

		const byScore = (a: WardPoint, b: WardPoint) => this.compareWardByRank(a, b)
		ownObserver.sort(byScore)
		ownSentry.sort(byScore)
		enemyObserver.sort(byScore)

		const observerTop = this.dedupeRanked(
			ownObserver,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize,
			laneQuotaLanes,
			laneQuotaMin,
			laneBand
		)
		const ownSentryTop = this.dedupeRanked(
			ownSentry,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize,
			laneQuotaLanes,
			laneQuotaMin,
			laneBand
		)
		const enemyObserverTop = this.dedupeRanked(
			enemyObserver,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize,
			laneQuotaLanes,
			laneQuotaMin,
			laneBand
		)
		const counterSentry = this.buildCounterSentryCandidates(
			ownSentryTop,
			enemyObserverTop
		)
		const counterSentryTop = this.dedupeRanked(
			counterSentry,
			topN,
			minCellDistance,
			minMinimapDistance,
			regionQuota,
			regionSize,
			laneQuotaLanes,
			laneQuotaMin,
			laneBand
		)

		const out = [...observerTop.slice(0, topN), ...counterSentryTop.slice(0, topN)]
		this.lastDebugStats = {
			sourceKey: context.remoteSourceKey,
			mode: "dynamic",
			bucket: context.currentBucket,
			localTeam,
			remoteInput: context.remoteWards.length,
			timeFilteredOut: context.remoteWards.length - candidate.length,
			teamFilteredOut: Math.max(
				0,
				candidate.length -
					(ownObserver.length + ownSentry.length + enemyObserver.length)
			),
			placedFilteredOut: 0,
			remoteVisible: out.length,
			customAdded: 0,
			finalVisible: out.length,
			dynamicCandidate: candidate.length,
			dynamicOwnObserver: ownObserver.length,
			dynamicOwnSentry: ownSentry.length,
			dynamicEnemyObserver: enemyObserver.length,
			dynamicObserverTop: observerTop.length,
			dynamicCounterTop: counterSentryTop.length
		}
		return out
	}

	private compareWardByRank(a: WardPoint, b: WardPoint): number {
		const aLevel = CONTEXT_LEVEL_ORDER[a.contextLevel ?? "base"] ?? 3
		const bLevel = CONTEXT_LEVEL_ORDER[b.contextLevel ?? "base"] ?? 3
		if (aLevel !== bLevel) {
			return aLevel - bLevel
		}
		const as = this.getWardScore(a)
		const bs = this.getWardScore(b)
		if (bs !== as) {
			return bs - as
		}
		return 0
	}

	private compareWardByPopularity(a: WardPoint, b: WardPoint): number {
		const byPopularity = firstNonZeroComparison(
			compareMetricDesc(a.placements, b.placements),
			compareMetricDesc(a.matchesSeen, b.matchesSeen),
			compareMetricAsc(
				this.getWardRadiusForSort(a, "p90"),
				this.getWardRadiusForSort(b, "p90")
			),
			compareMetricAsc(
				this.getWardRadiusForSort(a, "p50"),
				this.getWardRadiusForSort(b, "p50")
			)
		)
		return byPopularity !== 0 ? byPopularity : this.compareWardByRank(a, b)
	}

	private decorateWardWithContextRuntime(
		ward: WardPoint,
		missingOwnTowers: string[],
		missingEnemyTowers: string[],
		context: VisibleWardSelectorContext
	): WardPoint {
		const baseScore = this.getWardScore(ward)
		if (!Number.isFinite(baseScore)) {
			return {
				...ward,
				scoreBase: undefined,
				scoreRuntime: undefined,
				towerFit: 0,
				towerFitCoverage: 0,
				contextSupportPlacements: 0,
				contextSupportMatches: 0,
				contextConfidence: 0,
				contextLevel: "fallback"
			}
		}
		const hasContext = missingOwnTowers.length > 0 || missingEnemyTowers.length > 0
		const metrics = this.getTowerContextMetrics(
			ward,
			missingOwnTowers,
			missingEnemyTowers,
			context
		)
		const runtimeScore =
			baseScore *
			(1 +
				Math.max(0, context.dynamicTowerFitWeight) *
					metrics.fit *
					metrics.confidence)

		let contextLevel: WardPoint["contextLevel"] = "base"
		if (hasContext && context.useTowerStateFilter) {
			if (
				metrics.fit >= context.dynamicMinTowerFit &&
				metrics.supportPlacements >= context.dynamicMinContextSupportPlacements
			) {
				contextLevel = "direct"
			} else if (metrics.fit > 0) {
				contextLevel = "weak"
			} else {
				contextLevel = "fallback"
			}
		}

		return {
			...ward,
			score: runtimeScore,
			scoreBase: baseScore,
			scoreRuntime: runtimeScore,
			towerFit: metrics.fit,
			towerFitCoverage: metrics.coverage,
			contextSupportPlacements: metrics.supportPlacements,
			contextSupportMatches: metrics.supportMatches,
			contextConfidence: metrics.confidence,
			contextLevel
		}
	}

	private getTowerContextMetrics(
		ward: WardPoint,
		missingOwnTowers: string[],
		missingEnemyTowers: string[],
		context: VisibleWardSelectorContext
	) {
		const ownRates = ward.towerDestroyedOwnRate ?? {}
		const enemyRates = ward.towerDestroyedEnemyRate ?? {}
		const signals: number[] = []
		for (let i = 0; i < missingOwnTowers.length; i++) {
			const key = normalizeTowerKey(missingOwnTowers[i])
			if (key === undefined) {
				continue
			}
			signals.push(Number(ownRates[key] ?? 0))
		}
		for (let i = 0; i < missingEnemyTowers.length; i++) {
			const key = normalizeTowerKey(missingEnemyTowers[i])
			if (key === undefined) {
				continue
			}
			signals.push(Number(enemyRates[key] ?? 0))
		}
		const targetCount = signals.length
		const fit =
			targetCount > 0
				? signals.reduce((acc, value) => acc + Math.max(0, value), 0) /
					targetCount
				: 0
		const matchedCount =
			targetCount > 0
				? signals.filter(value => Number.isFinite(value) && value > 0).length
				: 0
		const coverage = targetCount > 0 ? matchedCount / targetCount : 0
		const placements = Number(ward.placements ?? 0)
		const matches = Number(ward.matchesSeen ?? 0)
		const supportPlacements = Math.max(0, placements) * fit
		const supportMatches = Math.max(0, matches) * fit
		const placementRef = Math.max(1, context.dynamicConfidencePlacementsRef)
		const matchRef = Math.max(1, context.dynamicConfidenceMatchesRef)
		const confidence =
			Math.min(1, supportPlacements / placementRef) *
			Math.min(1, supportMatches / matchRef)
		return {
			fit,
			coverage,
			supportPlacements,
			supportMatches,
			confidence
		}
	}

	private buildCounterSentryCandidates(
		ownSentry: WardPoint[],
		enemyObserver: WardPoint[]
	): WardPoint[] {
		const scored: WardPoint[] = []
		for (let i = 0; i < ownSentry.length; i++) {
			const own = ownSentry[i]
			let bestEnemySignal = 0
			for (let j = 0; j < enemyObserver.length; j++) {
				const enemy = enemyObserver[j]
				const dist = this.getWardDistance(own, enemy)
				const enemyWeight = this.getWardScore(enemy)
				const candidate =
					enemyWeight * Math.exp(-dist / COUNTER_SENTRY_DISTANCE_FALLOFF)
				if (candidate > bestEnemySignal) {
					bestEnemySignal = candidate
				}
			}
			scored.push({
				...own,
				score: this.getWardScore(own) + bestEnemySignal
			})
		}
		scored.sort((a, b) => this.getWardScore(b) - this.getWardScore(a))
		return scored
	}

	private dedupeRanked(
		source: WardPoint[],
		topN: number,
		minCellDistance: number,
		minMinimapDistance: number,
		regionQuota: number,
		regionSize: number,
		laneQuotaLanes: string[],
		laneQuotaMin: number,
		laneBand: number
	): WardPoint[] {
		if (
			minCellDistance <= 0 &&
			minMinimapDistance <= 0 &&
			regionQuota <= 0 &&
			(laneQuotaMin <= 0 || laneQuotaLanes.length === 0)
		) {
			return source.slice(0, topN)
		}
		const out: WardPoint[] = []
		const laneLeft = new Map<string, number>()
		for (let i = 0; i < laneQuotaLanes.length; i++) {
			laneLeft.set(laneQuotaLanes[i], laneQuotaMin)
		}

		for (let i = 0; i < source.length; i++) {
			if (out.length >= topN) {
				break
			}
			const ward = source[i]
			const lane = this.getWardLane(ward, laneBand)
			const need = laneLeft.get(lane) ?? 0
			if (need <= 0) {
				continue
			}
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
			laneLeft.set(lane, need - 1)
		}

		for (let i = 0; i < source.length; i++) {
			const ward = source[i]
			if (out.indexOf(ward) >= 0) {
				continue
			}
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
		const forceTeamFilter = context.remoteSourceKey === "ward_reco_dynamic"
		if (!context.teamFilterEnabled && !forceTeamFilter) {
			return true
		}
		if (context.localTeam === undefined) {
			return true
		}

		const teams = ward.teams ?? DEFAULT_WARD_TEAMS
		for (let i = 0; i < teams.length; i++) {
			if (teams[i] === context.localTeam) {
				return true
			}
		}
		return false
	}

	private isWardBlockedByPlacedWards(
		ward: WardPoint,
		context: VisibleWardSelectorContext
	): boolean {
		if (!context.hidePlacedWards) {
			return false
		}
		const source =
			ward.type === WardTypes.Observer
				? context.placedObserver
				: context.placedSentry
		if (source.length === 0) {
			return false
		}
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
		if (context.remoteSourceKey !== "ward_reco_dynamic") {
			return true
		}
		const bucket = ward.timeBucket
		if (bucket === undefined || bucket.length === 0) {
			return true
		}
		return bucket === context.currentBucket
	}

	private getWardScore(ward: WardPoint): number {
		const score = Number(ward.score ?? Number.NEGATIVE_INFINITY)
		return Number.isFinite(score) ? score : Number.NEGATIVE_INFINITY
	}

	private getWardRadiusForSort(ward: WardPoint, level: "p50" | "p90"): number {
		const raw = Number(level === "p90" ? ward.radiusP90 : ward.radiusP50)
		return Number.isFinite(raw) && raw >= 0 ? raw : Number.POSITIVE_INFINITY
	}

	private hasWardTeam(ward: WardPoint, team: WardTeam): boolean {
		const teams = ward.teams ?? DEFAULT_WARD_TEAMS
		for (let i = 0; i < teams.length; i++) {
			if (teams[i] === team) {
				return true
			}
		}
		return false
	}

	private getWardDistance(a: WardPoint, b: WardPoint): number {
		const cellDist = this.getWardCellDistance(a, b)
		if (Number.isFinite(cellDist) && cellDist > 0) {
			return cellDist
		}
		return this.getWardWorldDistance(a, b)
	}

	private getWardCellDistance(a: WardPoint, b: WardPoint): number {
		const aCellX = Number(a.cellX)
		const aCellY = Number(a.cellY)
		const bCellX = Number(b.cellX)
		const bCellY = Number(b.cellY)
		if (
			Number.isFinite(aCellX) &&
			Number.isFinite(aCellY) &&
			Number.isFinite(bCellX) &&
			Number.isFinite(bCellY)
		) {
			return Math.hypot(aCellX - bCellX, aCellY - bCellY)
		}
		return Number.POSITIVE_INFINITY
	}

	private getWardWorldDistance(a: WardPoint, b: WardPoint): number {
		const dx = a.x - b.x
		const dy = a.y - b.y
		return Math.hypot(dx, dy) / 128
	}

	private getWardDistance3D(a: WardPoint, b: WardPoint): number {
		const dx = a.x - b.x
		const dy = a.y - b.y
		const dz = a.z - b.z
		return Math.hypot(dx, dy, dz)
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

	private getAdaptiveSpacing(bucket: string): {
		minCellDistance: number
		minMinimapDistance: number
	} {
		const startMin = parseBucketStartMinute(bucket)
		if (startMin === undefined) {
			return DEFAULT_ADAPTIVE_SPACING
		}
		let selected = ADAPTIVE_SPACING_BY_MINUTE[0]
		for (let i = 1; i < ADAPTIVE_SPACING_BY_MINUTE.length; i++) {
			const current = ADAPTIVE_SPACING_BY_MINUTE[i]
			if (startMin >= current.fromMin) {
				selected = current
			} else {
				break
			}
		}
		return {
			minCellDistance: selected.minCellDistance,
			minMinimapDistance: selected.minMinimapDistance
		}
	}

	private getLaneQuotaLanes(context: VisibleWardSelectorContext): string[] {
		const own = this.extractLanesFromTowers(context.missingOwnTowers)
		const enemy = this.extractLanesFromTowers(context.missingEnemyTowers)
		if (context.dynamicLaneQuotaUse === "enemy") {
			return enemy
		}
		if (context.dynamicLaneQuotaUse === "both") {
			return this.uniqueLanes([...own, ...enemy])
		}
		return own
	}

	private extractLanesFromTowers(keys: string[]): string[] {
		const out: string[] = []
		for (let i = 0; i < keys.length; i++) {
			const raw = String(keys[i] ?? "")
			const lane = raw.split("_", 1)[0]
			if (lane === "top" || lane === "mid" || lane === "bot") {
				out.push(lane)
			}
		}
		return this.uniqueLanes(out)
	}

	private uniqueLanes(values: string[]): string[] {
		const out: string[] = []
		for (let i = 0; i < values.length; i++) {
			const lane = values[i]
			if (out.indexOf(lane) < 0) {
				out.push(lane)
			}
		}
		return out
	}

	private getWardLane(ward: WardPoint, laneBand: number): string {
		const { x, y } = this.getWardMapCoords(ward)
		const delta = y - x
		if (delta > laneBand) {
			return "top"
		}
		if (delta < -laneBand) {
			return "bot"
		}
		return "mid"
	}

	private getWardMapCoords(ward: WardPoint): { x: number; y: number } {
		const cx = Number(ward.cellX)
		const cy = Number(ward.cellY)
		if (Number.isFinite(cx) && Number.isFinite(cy)) {
			return { x: cx, y: cy }
		}
		// World fallback, mapped into 0..256 minimap-like space.
		return {
			x: (ward.x + 16384) / 128,
			y: (ward.y + 16384) / 128
		}
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
		const gx = Math.floor(m.x / size)
		const gy = Math.floor(m.y / size)
		return `${gx}:${gy}`
	}
}

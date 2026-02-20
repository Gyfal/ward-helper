import {
	GetPositionHeight,
	Utils as WrapperUtils,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { REMOTE_SOURCE_KEYS, REMOTE_SOURCE_PATHS, RemoteSourceKey } from "./RemoteSources"
import { isObjectRecord, normalizeTowerKey } from "./Utils"
import {
	DEFAULT_WARD_TEAMS,
	WardPoint,
	WardTeam,
	WardTeams,
	WardType,
	WardTypes
} from "./WardTypes"
export type RemoteWardSourceKey = RemoteSourceKey
export const REMOTE_WARD_SOURCE_KEYS = [...REMOTE_SOURCE_KEYS]

function parseDatasetTeam(value: unknown): WardTeam[] {
	if (value === "radiant") {
		return [WardTeams.Radiant]
	}
	if (value === "dire") {
		return [WardTeams.Dire]
	}
	return [...DEFAULT_WARD_TEAMS]
}

function parseWardType(value: unknown): Nullable<WardType> {
	if (
		value === WardTypes.Observer ||
		value === "Obs" ||
		value === "Observer" ||
		value === "Observer Ward"
	) {
		return WardTypes.Observer
	}
	if (value === WardTypes.Sentry || value === "Sentry Ward") {
		return WardTypes.Sentry
	}
	return undefined
}

function parseTeams(value: unknown): WardTeam[] {
	if (!Array.isArray(value)) {
		return [...DEFAULT_WARD_TEAMS]
	}
	const teams: WardTeam[] = []
	for (let i = 0; i < value.length; i++) {
		const team = value[i]
		if (team === WardTeams.Dire || team === WardTeams.Radiant) {
			teams.push(team)
		}
	}
	if (teams.length === 0) {
		return [...DEFAULT_WARD_TEAMS]
	}
	return teams
}

function parseTowerRateMap(value: unknown): Record<string, number> | undefined {
	if (!isObjectRecord(value)) {
		return undefined
	}
	const out: Record<string, number> = {}
	let hasAny = false
	for (const key of Object.keys(value)) {
		const normalized = normalizeTowerKey(key)
		if (normalized === undefined) {
			continue
		}
		const n = Number(value[key])
		if (!Number.isFinite(n)) {
			continue
		}
		out[normalized] = n
		hasAny = true
	}
	return hasAny ? out : undefined
}

function resolveWardZ(x: number, y: number, rawZ: unknown): number {
	const parsedZ = Number(rawZ)
	if (Number.isFinite(parsedZ) && parsedZ !== 0) {
		return parsedZ
	}
	const autoZ = GetPositionHeight(new Vector2(x, y))
	if (Number.isFinite(autoZ)) {
		return autoZ
	}
	return 256
}

function parseWardPoint(value: unknown): Nullable<WardPoint> {
	if (!isObjectRecord(value)) {
		return undefined
	}
	const x = Number(value.x)
	const y = Number(value.y)
	const type = parseWardType(value.type)
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return undefined
	}
	if (type === undefined) {
		return undefined
	}
	const z = resolveWardZ(x, y, value.z)
	const description =
		typeof value.description === "string" && value.description.length > 0
			? value.description
			: undefined
	const timeBucket =
		typeof value.timeBucket === "string" && value.timeBucket.length > 0
			? value.timeBucket
			: undefined
	const cellX = Number(value.cellX)
	const cellY = Number(value.cellY)
	const hasCell = Number.isFinite(cellX) && Number.isFinite(cellY)
	const towerDiffAvg = Number(value.towerDiffAvg)
	const hasTowerDiffAvg = Number.isFinite(towerDiffAvg)
	const matchesSeen = Number(value.matchesSeen)
	const hasMatchesSeen = Number.isFinite(matchesSeen)
	const placements = Number(value.placements)
	const hasPlacements = Number.isFinite(placements)
	const radiusP50 = Number(value.radiusP50 ?? value.radius_p50)
	const hasRadiusP50 = Number.isFinite(radiusP50)
	const radiusP90 = Number(value.radiusP90 ?? value.radius_p90)
	const hasRadiusP90 = Number.isFinite(radiusP90)
	const score = Number(value.score)
	const hasScore = Number.isFinite(score)
	const scoreBase = Number(value.scoreBase)
	const hasScoreBase = Number.isFinite(scoreBase)
	const scoreRuntime = Number(value.scoreRuntime)
	const hasScoreRuntime = Number.isFinite(scoreRuntime)
	const towerFit = Number(value.towerFit)
	const hasTowerFit = Number.isFinite(towerFit)
	const towerFitCoverage = Number(value.towerFitCoverage)
	const hasTowerFitCoverage = Number.isFinite(towerFitCoverage)
	const contextSupportPlacements = Number(value.contextSupportPlacements)
	const hasContextSupportPlacements = Number.isFinite(contextSupportPlacements)
	const contextSupportMatches = Number(value.contextSupportMatches)
	const hasContextSupportMatches = Number.isFinite(contextSupportMatches)
	const contextConfidence = Number(value.contextConfidence)
	const hasContextConfidence = Number.isFinite(contextConfidence)
	const contextLevel =
		value.contextLevel === "base" ||
		value.contextLevel === "direct" ||
		value.contextLevel === "weak" ||
		value.contextLevel === "fallback"
			? value.contextLevel
			: undefined
	const observerRiskyQuickDeward = Boolean(value.observerRiskyQuickDeward)
	const towerDestroyedOwnRate = parseTowerRateMap(value.towerDestroyedOwnRate)
	const towerDestroyedEnemyRate = parseTowerRateMap(value.towerDestroyedEnemyRate)
	return {
		x,
		y,
		z,
		cellX: hasCell ? cellX : undefined,
		cellY: hasCell ? cellY : undefined,
		timeBucket,
		towerDiffAvg: hasTowerDiffAvg ? towerDiffAvg : undefined,
		towerDestroyedOwnRate,
		towerDestroyedEnemyRate,
		matchesSeen: hasMatchesSeen ? matchesSeen : undefined,
		placements: hasPlacements ? placements : undefined,
		radiusP50: hasRadiusP50 ? radiusP50 : undefined,
		radiusP90: hasRadiusP90 ? radiusP90 : undefined,
		score: hasScore ? score : undefined,
		scoreBase: hasScoreBase ? scoreBase : undefined,
		scoreRuntime: hasScoreRuntime ? scoreRuntime : undefined,
		towerFit: hasTowerFit ? towerFit : undefined,
		towerFitCoverage: hasTowerFitCoverage ? towerFitCoverage : undefined,
		contextSupportPlacements: hasContextSupportPlacements
			? contextSupportPlacements
			: undefined,
		contextSupportMatches: hasContextSupportMatches
			? contextSupportMatches
			: undefined,
		contextConfidence: hasContextConfidence ? contextConfidence : undefined,
		contextLevel,
		observerRiskyQuickDeward,
		type,
		description,
		teams: parseTeams(value.teams)
	}
}

function normalizeWardArray(source: unknown): WardPoint[] {
	if (!Array.isArray(source)) {
		return []
	}
	const wards: WardPoint[] = []
	for (let i = 0; i < source.length; i++) {
		const ward = parseWardPoint(source[i])
		if (ward !== undefined) {
			wards.push(ward)
		}
	}
	return wards
}

function parseWardRecoDataset(source: unknown): WardPoint[] {
	if (!isObjectRecord(source)) {
		return []
	}

	const spotsRaw = source.spots
	if (!Array.isArray(spotsRaw)) {
		return []
	}

	const wards: WardPoint[] = []
	const seen = new Set<string>()
	for (let i = 0; i < spotsRaw.length; i++) {
		const spot = spotsRaw[i]
		if (!isObjectRecord(spot)) {
			continue
		}
		const spotID = spot.spot_id
		if (typeof spotID !== "string" || spotID.length === 0) {
			continue
		}
		const type = parseWardType(spot.type)
		if (type === undefined) {
			continue
		}

		const world = isObjectRecord(spot.world_avg) ? spot.world_avg : {}
		const stats = isObjectRecord(spot.stats) ? spot.stats : {}
		const flags = isObjectRecord(spot.flags) ? spot.flags : {}
		const cell = isObjectRecord(spot.cell) ? spot.cell : {}
		const x = Number(world.x)
		const y = Number(world.y)
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			continue
		}
		const key = `${type}:${spotID}`
		if (seen.has(key)) {
			continue
		}
		seen.add(key)

		const cellX = Number(cell.x)
		const cellY = Number(cell.y)
		const score = Number(stats.score)
		const timeBucket =
			typeof spot.time_bucket === "string" && spot.time_bucket.length > 0
				? spot.time_bucket
				: undefined
		const context = isObjectRecord(spot.context_profile) ? spot.context_profile : {}
		const towerDiffAvg = Number(context.avg_tower_diff_for_team)
		const towerDestroyedOwnRate = parseTowerRateMap(context.tower_destroyed_own_rate)
		const towerDestroyedEnemyRate = parseTowerRateMap(
			context.tower_destroyed_enemy_rate
		)
		const matchesSeen = Number(stats.matches_seen)
		const placements = Number(stats.placements)
		const radiusP50 = Number(stats.radius_p50)
		const radiusP90 = Number(stats.radius_p90)
		const observerRiskyQuickDeward = Boolean(flags.observer_risky_quick_deward)

		wards.push({
			x,
			y,
			z: resolveWardZ(x, y, Number(world.z)),
			cellX: Number.isFinite(cellX) ? cellX : undefined,
			cellY: Number.isFinite(cellY) ? cellY : undefined,
			timeBucket,
			towerDiffAvg: Number.isFinite(towerDiffAvg) ? towerDiffAvg : undefined,
			towerDestroyedOwnRate,
			towerDestroyedEnemyRate,
			matchesSeen: Number.isFinite(matchesSeen) ? matchesSeen : undefined,
			placements: Number.isFinite(placements) ? placements : undefined,
			radiusP50: Number.isFinite(radiusP50) ? radiusP50 : undefined,
			radiusP90: Number.isFinite(radiusP90) ? radiusP90 : undefined,
			score: Number.isFinite(score) ? score : undefined,
			observerRiskyQuickDeward,
			type,
			description: Number.isFinite(score)
				? `Ward reco (${timeBucket ?? "all"}) score=${score.toFixed(3)}`
				: `Ward reco (${timeBucket ?? "all"})`,
			teams: parseDatasetTeam(spot.team)
		})
	}

	return wards
}

export class WardDataLoader {
	public static Normalize(source: unknown): WardPoint[] {
		if (Array.isArray(source)) {
			return normalizeWardArray(source)
		}
		if (!isObjectRecord(source)) {
			return []
		}
		return normalizeWardArray(source.wards)
	}

	public static LoadRemoteWards(source: RemoteWardSourceKey = "opendota"): WardPoint[] {
		const path = REMOTE_SOURCE_PATHS[source] ?? REMOTE_SOURCE_PATHS.opendota
		try {
			const raw = WrapperUtils.readJSON<unknown>(path)
			if (source === "ward_reco_dynamic") {
				const fromDataset = parseWardRecoDataset(raw)
				if (fromDataset.length > 0) {
					return fromDataset
				}
			}
			return WardDataLoader.Normalize(raw)
		} catch (error) {
			console.error(`[ward-helper] failed load remote wards: ${path}`, error)
			return []
		}
	}

	public static LoadStaticCustomWards(): WardPoint[] {
		try {
			return WardDataLoader.Normalize(
				WrapperUtils.readJSON<unknown>("data/custom_wards.json")
			)
		} catch {
			return []
		}
	}
}

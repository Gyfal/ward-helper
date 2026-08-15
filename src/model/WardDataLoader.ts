import {
	GetPositionHeight,
	Utils as WrapperUtils,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { isObjectRecord } from "./Utils"
import {
	DEFAULT_WARD_TEAMS,
	WardPoint,
	WardTeam,
	WardTeams,
	WardType,
	WardTypes
} from "./WardTypes"

const REMOTE_DATASET_PATH = "data/ward_reco_dataset.runtime.json"
// Dota world coordinates never leave this envelope; anything outside comes from
// corrupted or tampered data and must not reach the renderer.
const WORLD_COORD_LIMIT = 16384
const MAX_WARDS = 20000
const MAX_TEXT_LENGTH = 256

function isWorldCoord(value: number): boolean {
	return Number.isFinite(value) && Math.abs(value) <= WORLD_COORD_LIMIT
}

function parseText(value: unknown): Nullable<string> {
	if (typeof value !== "string" || value.length === 0) {
		return undefined
	}
	return value.slice(0, MAX_TEXT_LENGTH)
}

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

function resolveWardZ(x: number, y: number, rawZ: unknown): number {
	const parsedZ = Number(rawZ)
	if (isWorldCoord(parsedZ) && parsedZ !== 0) {
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
	if (!isWorldCoord(x) || !isWorldCoord(y)) {
		return undefined
	}
	if (type === undefined) {
		return undefined
	}
	const z = resolveWardZ(x, y, value.z)
	const description = parseText(value.description)
	const timeBucket = parseText(value.timeBucket)
	const cellX = Number(value.cellX)
	const cellY = Number(value.cellY)
	const hasCell = Number.isFinite(cellX) && Number.isFinite(cellY)
	const score = Number(value.score)
	const hasScore = Number.isFinite(score)
	const observerRiskyQuickDeward = Boolean(value.observerRiskyQuickDeward)
	return {
		x,
		y,
		z,
		cellX: hasCell ? cellX : undefined,
		cellY: hasCell ? cellY : undefined,
		timeBucket,
		score: hasScore ? score : undefined,
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
	const count = Math.min(source.length, MAX_WARDS)
	for (let i = 0; i < count; i++) {
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
	const spotCount = Math.min(spotsRaw.length, MAX_WARDS)
	for (let i = 0; i < spotCount; i++) {
		const spot = spotsRaw[i]
		if (!isObjectRecord(spot)) {
			continue
		}
		const spotID = parseText(spot.spot_id)
		if (spotID === undefined) {
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
		if (!isWorldCoord(x) || !isWorldCoord(y)) {
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
		const timeBucket = parseText(spot.time_bucket)
		const observerRiskyQuickDeward = Boolean(flags.observer_risky_quick_deward)

		wards.push({
			x,
			y,
			z: resolveWardZ(x, y, Number(world.z)),
			cellX: Number.isFinite(cellX) ? cellX : undefined,
			cellY: Number.isFinite(cellY) ? cellY : undefined,
			timeBucket,
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

	public static LoadRemoteWards(): WardPoint[] {
		try {
			const raw = WrapperUtils.readJSON<unknown>(REMOTE_DATASET_PATH)
			return parseWardRecoDataset(raw)
		} catch (error) {
			console.error(
				`[ward-helper] failed load remote wards: ${REMOTE_DATASET_PATH}`,
				error
			)
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

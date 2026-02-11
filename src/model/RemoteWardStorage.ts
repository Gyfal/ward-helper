import { WardDataLoader, RemoteWardSourceKey } from "./WardDataLoader"
import { WardPoint } from "./WardTypes"

const REMOTE_WARDS_STORAGE_KEY = "ward-helper.remote-wards.v1"

function parseConfig(rawConfig: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(rawConfig) as unknown
		if (typeof parsed === "object" && parsed !== null) {
			return parsed as Record<string, unknown>
		}
	} catch (error) {
		console.error("[ward-helper] invalid config json", error)
	}
	return {}
}

function serializeWard(ward: WardPoint) {
	return {
		x: ward.x,
		y: ward.y,
		z: ward.z,
		cellX: ward.cellX,
		cellY: ward.cellY,
		timeBucket: ward.timeBucket,
		towerDiffAvg: ward.towerDiffAvg,
		towerDestroyedOwnRate: ward.towerDestroyedOwnRate,
		towerDestroyedEnemyRate: ward.towerDestroyedEnemyRate,
		matchesSeen: ward.matchesSeen,
		placements: ward.placements,
		score: ward.score,
		scoreBase: ward.scoreBase,
		scoreRuntime: ward.scoreRuntime,
		towerFit: ward.towerFit,
		towerFitCoverage: ward.towerFitCoverage,
		contextSupportPlacements: ward.contextSupportPlacements,
		contextSupportMatches: ward.contextSupportMatches,
		contextConfidence: ward.contextConfidence,
		contextLevel: ward.contextLevel,
		observerRiskyQuickDeward: ward.observerRiskyQuickDeward,
		type: ward.type,
		description: ward.description,
		teams: ward.teams
	}
}

export class RemoteWardStorage {
	private saveQueue: Promise<void> = Promise.resolve()

	public async Load(source: RemoteWardSourceKey): Promise<WardPoint[] | undefined> {
		try {
			const raw = await readConfig()
			const config = parseConfig(raw)
			const storage = config[REMOTE_WARDS_STORAGE_KEY]
			if (typeof storage !== "object" || storage === null) {
				return undefined
			}
			const key = source as unknown as string
			const payload = (storage as Record<string, unknown>)[key]
			const parsed = WardDataLoader.Normalize(payload)
			return parsed.length > 0 ? parsed : undefined
		} catch (error) {
			console.error("[ward-helper] failed load remote edits from config", error)
			return undefined
		}
	}

	public Save(source: RemoteWardSourceKey, wards: WardPoint[]) {
		const payload = wards.map(serializeWard)
		this.saveQueue = this.saveQueue
			.then(async () => {
				const raw = await readConfig()
				const config = parseConfig(raw)
				const key = source as unknown as string
				const current = config[REMOTE_WARDS_STORAGE_KEY]
				const storage =
					typeof current === "object" && current !== null
						? (current as Record<string, unknown>)
						: {}
				storage[key] = payload
				config[REMOTE_WARDS_STORAGE_KEY] = storage
				writeConfig(JSON.stringify(config))
			})
			.catch(error => {
				console.error("[ward-helper] failed save remote ward edits", error)
			})
	}
}

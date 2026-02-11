import { WardDataLoader } from "./WardDataLoader"
import { WardPoint } from "./WardTypes"

const CUSTOM_WARDS_STORAGE_KEY = "ward-helper.custom-wards.v1"

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

export class CustomWardStorage {
	private saveQueue: Promise<void> = Promise.resolve()

	public async Load(): Promise<WardPoint[]> {
		try {
			const raw = await readConfig()
			const config = parseConfig(raw)
			const configWards = WardDataLoader.Normalize(config[CUSTOM_WARDS_STORAGE_KEY])
			if (configWards.length !== 0) {
				return configWards
			}
		} catch (error) {
			console.error("[ward-helper] failed load custom wards from config", error)
		}
		return WardDataLoader.LoadStaticCustomWards()
	}

	public Save(wards: WardPoint[]) {
		const payload = wards.map(ward => ({
			x: ward.x,
			y: ward.y,
			z: ward.z,
			timeBucket: ward.timeBucket,
			towerDiffAvg: ward.towerDiffAvg,
			score: ward.score,
			type: ward.type,
			description: ward.description,
			teams: ward.teams
		}))

		this.saveQueue = this.saveQueue
			.then(async () => {
				const raw = await readConfig()
				const config = parseConfig(raw)
				config[CUSTOM_WARDS_STORAGE_KEY] = payload
				writeConfig(JSON.stringify(config))
			})
			.catch(error => {
				console.error("[ward-helper] failed save custom wards", error)
			})
	}
}

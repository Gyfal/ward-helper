import { ConfigWriteQueue, parseConfigRecord } from "./Utils"
import { WardDataLoader } from "./WardDataLoader"
import { WardPoint } from "./WardTypes"

const CUSTOM_WARDS_STORAGE_KEY = "ward-helper.custom-wards.v1"

export class CustomWardStorage {
	private readonly writeQueue = new ConfigWriteQueue()

	public async Load(): Promise<WardPoint[]> {
		try {
			const raw = await readConfig()
			const config = parseConfigRecord(raw)
			const configWards = WardDataLoader.Normalize(config[CUSTOM_WARDS_STORAGE_KEY])
			if (configWards.length !== 0) {
				return configWards
			}
		} catch (error) {
			console.error("[ward-helper] failed load custom wards from config", error)
		}
		return WardDataLoader.LoadStaticCustomWards()
	}

	public Save(wards: WardPoint[]): Promise<void> {
		const payload = wards.map(ward => ({
			x: ward.x,
			y: ward.y,
			z: ward.z,
			timeBucket: ward.timeBucket,
			score: ward.score,
			type: ward.type,
			description: ward.description,
			teams: ward.teams
		}))
		return this.writeQueue.Enqueue(
			"[ward-helper] failed save custom wards",
			config => {
				config[CUSTOM_WARDS_STORAGE_KEY] = payload
			}
		)
	}
}

import { ConfigWriteQueue, readConfigRecord } from "./Utils"
import { WardDataLoader } from "./WardDataLoader"
import { serializeWards } from "./WardSerialization"
import { WardPoint } from "./WardTypes"

const CUSTOM_WARDS_STORAGE_KEY = "ward-helper.custom-wards.v1"

export class CustomWardStorage {
	private readonly writeQueue = new ConfigWriteQueue()

	public async Load(): Promise<WardPoint[]> {
		try {
			const config = await readConfigRecord()
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
		const payload = serializeWards(wards)
		return this.writeQueue.Enqueue(
			"[ward-helper] failed save custom wards",
			config => {
				config[CUSTOM_WARDS_STORAGE_KEY] = payload
			}
		)
	}
}

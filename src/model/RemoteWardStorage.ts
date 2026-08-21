import { ConfigWriteQueue, isObjectRecord, readConfigRecord } from "./Utils"
import { WardDataLoader } from "./WardDataLoader"
import { serializeWards } from "./WardSerialization"
import { WardPoint } from "./WardTypes"

const REMOTE_WARDS_STORAGE_KEY = "ward-helper.remote-wards.v1"
// Sub-key left over from the multi-source era so existing saved edits keep working.
const REMOTE_SOURCE_KEY = "ward_reco_dynamic"

export class RemoteWardStorage {
	private readonly writeQueue = new ConfigWriteQueue()

	public async Load(): Promise<WardPoint[] | undefined> {
		try {
			const config = await readConfigRecord()
			const storage = config[REMOTE_WARDS_STORAGE_KEY]
			if (!isObjectRecord(storage)) {
				return undefined
			}
			const payload = storage[REMOTE_SOURCE_KEY]
			if (!Array.isArray(payload)) {
				return undefined
			}
			// An empty array is a valid saved state (every ward deleted), so it
			// must not fall back to the base dataset.
			return WardDataLoader.Normalize(payload)
		} catch (error) {
			console.error("[ward-helper] failed load remote edits from config", error)
			return undefined
		}
	}

	public Save(wards: WardPoint[]): Promise<void> {
		const payload = serializeWards(wards)
		return this.writeQueue.Enqueue(
			"[ward-helper] failed save remote ward edits",
			config => {
				const current = config[REMOTE_WARDS_STORAGE_KEY]
				const storage = isObjectRecord(current) ? current : {}
				storage[REMOTE_SOURCE_KEY] = payload
				config[REMOTE_WARDS_STORAGE_KEY] = storage
			}
		)
	}
}

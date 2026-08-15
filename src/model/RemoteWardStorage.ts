import { ConfigWriteQueue, isObjectRecord, parseConfigRecordStrict } from "./Utils"
import { WardDataLoader } from "./WardDataLoader"
import { WardPoint } from "./WardTypes"

const REMOTE_WARDS_STORAGE_KEY = "ward-helper.remote-wards.v1"
// Sub-key left over from the multi-source era so existing saved edits keep working.
const REMOTE_SOURCE_KEY = "ward_reco_dynamic"

function serializeWard(ward: WardPoint) {
	return {
		x: ward.x,
		y: ward.y,
		z: ward.z,
		cellX: ward.cellX,
		cellY: ward.cellY,
		timeBucket: ward.timeBucket,
		score: ward.score,
		observerRiskyQuickDeward: ward.observerRiskyQuickDeward,
		type: ward.type,
		description: ward.description,
		teams: ward.teams
	}
}

export class RemoteWardStorage {
	private readonly writeQueue = new ConfigWriteQueue()

	/**
	 * Resolves to undefined only when no edits are stored; a failed read or an
	 * unparsable config rejects so the caller can report it instead of quietly
	 * treating broken storage as "no edits".
	 */
	public async Load(): Promise<WardPoint[] | undefined> {
		const config = parseConfigRecordStrict(await readConfig())
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
	}

	public Save(wards: WardPoint[]): Promise<void> {
		const payload = wards.map(serializeWard)
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

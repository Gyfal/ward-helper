// Bucket ids must match TIME_BUCKETS in build_ward_reco_runtime.py.
export const TimeBuckets = {
	Start: "0_12",
	Mid: "12_25",
	Late: "25_50",
	VeryLate: "50_plus"
} as const

export type TimeBucketID = (typeof TimeBuckets)[keyof typeof TimeBuckets]

interface TimeBucketDefinition {
	id: TimeBucketID
	label: string
	/** Exclusive upper bound in game seconds, undefined for the last bucket. */
	maxGameTimeSec?: number
}

export const TIME_BUCKETS: readonly TimeBucketDefinition[] = [
	{ id: TimeBuckets.Start, label: "0-12 min", maxGameTimeSec: 12 * 60 },
	{ id: TimeBuckets.Mid, label: "12-25 min", maxGameTimeSec: 25 * 60 },
	{ id: TimeBuckets.Late, label: "25-50 min", maxGameTimeSec: 50 * 60 },
	{ id: TimeBuckets.VeryLate, label: "50+ min" }
]

export const TIME_BUCKET_LABELS: readonly string[] = TIME_BUCKETS.map(
	bucket => bucket.label
)

export function getTimeBucketByGameTime(gameTimeSec: number): TimeBucketID {
	const timeSec = Math.max(0, gameTimeSec)
	for (let i = 0; i < TIME_BUCKETS.length; i++) {
		const bucket = TIME_BUCKETS[i]
		if (bucket.maxGameTimeSec === undefined || timeSec < bucket.maxGameTimeSec) {
			return bucket.id
		}
	}
	return TimeBuckets.VeryLate
}

export function getTimeBucketByID(index: number): TimeBucketID | undefined {
	return TIME_BUCKETS[index]?.id
}

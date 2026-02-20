export function compareMetricDesc(a: number | undefined, b: number | undefined): number {
	return Number(b ?? 0) - Number(a ?? 0)
}

export function compareMetricAsc(a: number, b: number): number {
	return a - b
}

export function firstNonZeroComparison(...comparisons: number[]): number {
	for (let i = 0; i < comparisons.length; i++) {
		if (comparisons[i] !== 0) {
			return comparisons[i]
		}
	}
	return 0
}

export function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

export function approach(current: number, target: number, speed: number): number {
	if (current < target) {
		return Math.min(current + speed, target)
	}
	if (current > target) {
		return Math.max(current - speed, target)
	}
	return current
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null
}

export function normalizeTowerKey(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}
	const raw = value.trim().toLowerCase()
	if (raw.length === 0) {
		return undefined
	}
	const match = raw.match(/^(top|mid|bot)[_ -]?t([1-4])$/)
	if (match === null) {
		return undefined
	}
	return `${match[1]}_t${match[2]}`
}

export function parseBucketStartMinute(bucket: string): number | undefined {
	const normalized = String(bucket ?? "")
		.trim()
		.toLowerCase()
	if (normalized.length === 0) {
		return undefined
	}
	const rangeMatch = normalized.match(/^(\d+)[_-](\d+)$/)
	if (rangeMatch !== null) {
		const start = Number(rangeMatch[1])
		return Number.isFinite(start) ? start : undefined
	}
	const plusMatch = normalized.match(/^(\d+)[_ -]?plus$/)
	if (plusMatch !== null) {
		const start = Number(plusMatch[1])
		return Number.isFinite(start) ? start : undefined
	}
	return undefined
}

export function parseConfigRecord(rawConfig: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(rawConfig) as unknown
		if (isObjectRecord(parsed)) {
			return parsed
		}
	} catch (error) {
		console.error("[ward-helper] invalid config json", error)
	}
	return {}
}

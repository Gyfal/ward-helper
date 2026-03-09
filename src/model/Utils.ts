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

/**
 * Serializes read-modify-write cycles of the shared config so concurrent
 * saves cannot interleave and drop each other's keys.
 */
export class ConfigWriteQueue {
	private queue: Promise<void> = Promise.resolve()

	public Enqueue(
		errorLabel: string,
		mutate: (config: Record<string, unknown>) => void
	): Promise<void> {
		const next = this.queue
			.catch(() => undefined)
			.then(async () => {
				const config = parseConfigRecord(await readConfig())
				mutate(config)
				writeConfig(JSON.stringify(config))
			})
		this.queue = next
		return next.catch(error => {
			console.error(errorLabel, error)
			throw error
		})
	}
}

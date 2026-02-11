interface TooltipAnimation {
	width: number
	targetWidth: number
	startTime: number
}

export class TooltipAnimator {
	private readonly animations = new Map<string, TooltipAnimation>()

	public Get(
		key: string,
		baseWidth: number,
		targetWidth: number,
		gameTime: number,
		duration = 0.1
	) {
		let data = this.animations.get(key)
		if (data === undefined) {
			data = {
				width: baseWidth,
				targetWidth,
				startTime: gameTime
			}
			this.animations.set(key, data)
		}

		data.targetWidth = targetWidth
		const elapsed = Math.max(gameTime - data.startTime, 0)
		const progressLinear = duration <= 0 ? 1 : Math.min(elapsed / duration, 1)
		const progress = 1 - (1 - progressLinear) * (1 - progressLinear)
		data.width = baseWidth + (data.targetWidth - baseWidth) * progress
		return {
			width: data.width,
			progress
		}
	}

	public Clear(key: string) {
		this.animations.delete(key)
	}

	public ClearAll() {
		this.animations.clear()
	}
}


import { InputManager, VKeys, VMouseKeys } from "github.com/octarine-public/wrapper/index"

export class InputEdgeTracker {
	private readonly keyWasDown = new Map<number, boolean>()
	private readonly mouseKeyWasDown = new Map<number, boolean>()

	public IsKeyJustPressed(keyCode: number) {
		const isDown = InputManager.IsKeyDown(keyCode as VKeys)
		const wasDown = this.keyWasDown.get(keyCode) ?? false
		this.keyWasDown.set(keyCode, isDown)
		return isDown && !wasDown
	}

	public IsMouseKeyJustPressed(mouseKey: number) {
		const isDown = InputManager.IsMouseKeyDown(mouseKey as VMouseKeys)
		const wasDown = this.mouseKeyWasDown.get(mouseKey) ?? false
		this.mouseKeyWasDown.set(mouseKey, isDown)
		return isDown && !wasDown
	}

	public ClearMouseState() {
		this.mouseKeyWasDown.clear()
	}
}

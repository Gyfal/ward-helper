import {
	Color,
	GetPositionHeight,
	InputManager,
	Rectangle,
	RendererSDK,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "../gui"

export class WardDebugOverlay {
	constructor(private readonly gui: GUIHelper) {}

	public DrawCursorDebug() {
		const cursorWorld = InputManager.CursorOnWorld
		const cursorGround = GetPositionHeight(new Vector2(cursorWorld.x, cursorWorld.y))
		const minimapX = this.gui.WorldToMinimap512(cursorWorld.x)
		const minimapY = this.gui.WorldToMinimap512(cursorWorld.y)
		const textAnchor = this.GetCursorTextAnchor(
			cursorWorld.x,
			cursorWorld.y,
			cursorGround
		)

		RendererSDK.FilledCircle(
			InputManager.CursorOnScreen,
			new Vector2(6, 6),
			Color.White
		)
		this.DrawTextLine(
			`POS X: ${cursorWorld.x.toFixed(2)} POS Y: ${cursorWorld.y.toFixed(2)} POS Z: ${cursorGround.toFixed(2)}`,
			textAnchor,
			0
		)
		this.DrawTextLine(
			`3D X: ${cursorWorld.x.toFixed(2)} Y: ${cursorWorld.y.toFixed(2)} Z: ${cursorGround.toFixed(2)}`,
			textAnchor,
			72
		)
		this.DrawTextLine(
			`Minimap 0-512 X: ${minimapX.toFixed(2)} Y: ${minimapY.toFixed(2)}`,
			textAnchor,
			96
		)
	}

	public DrawTextNearCursorWorld(text: string, yOffset: number) {
		const cursorWorld = InputManager.CursorOnWorld
		const cursorGround = GetPositionHeight(new Vector2(cursorWorld.x, cursorWorld.y))
		this.DrawTextNearWorld(
			text,
			new Vector3(cursorWorld.x, cursorWorld.y, cursorGround),
			yOffset
		)
	}

	public DrawTextNearWorld(text: string, world: Vector3, yOffset: number) {
		this.DrawWorldTextLine(text, world, yOffset)
	}

	private GetCursorTextAnchor(x: number, y: number, z: number) {
		const projected = RendererSDK.WorldToScreen(new Vector3(x, y, z + 80))
		if (projected !== undefined) {
			return new Vector2(projected.x + 30, projected.y)
		}
		const cursorScreen = InputManager.CursorOnScreen
		return new Vector2(cursorScreen.x + 30, cursorScreen.y)
	}

	private DrawTextLine(text: string, anchor: Vector2, yOffset: number) {
		const linePosition = new Vector2(anchor.x, anchor.y + yOffset)
		const rect = new Rectangle(
			linePosition,
			new Vector2(linePosition.x + 900, linePosition.y + 22)
		)
		RendererSDK.TextByFlags(text, rect, Color.White, 1)
	}

	private DrawWorldTextLine(text: string, world: Vector3, yOffset: number) {
		const w2s = RendererSDK.WorldToScreen(world)
		if (w2s === undefined) {
			return
		}
		const size = this.gui.GetScaledVector(360, 24)
		const linePos = new Vector2(w2s.x - size.x / 2, w2s.y + yOffset)
		const rect = new Rectangle(linePos, linePos.Add(size))
		RendererSDK.TextByFlags(text, rect, Color.White, 3)
	}
}

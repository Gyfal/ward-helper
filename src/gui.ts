import {
	DOTAGameState,
	DOTAGameUIState,
	GameRules,
	GameState,
	GUIInfo,
	RendererSDK,
	Vector2
} from "github.com/octarine-public/wrapper/index"

import { clamp } from "./model/Utils"

const MINIMAP_512_CENTER = 256
const WORLD_UNITS_PER_MINIMAP_512 = 32

export class GUIHelper {
	public get IsReady() {
		return GUIInfo !== undefined && GUIInfo.TopBar !== undefined
	}

	public get IsUIGame() {
		return GameState.UIState === DOTAGameUIState.DOTA_GAME_UI_DOTA_INGAME
	}

	public get IsMatchActive() {
		const state = this.gameState
		return (
			state >= DOTAGameState.DOTA_GAMERULES_STATE_PRE_GAME &&
			state < DOTAGameState.DOTA_GAMERULES_STATE_POST_GAME
		)
	}

	public IsHovered(
		center: Vector2,
		cursor: Vector2,
		halfWidth: number,
		halfHeight = halfWidth
	): boolean {
		return (
			cursor.x >= center.x - halfWidth &&
			cursor.x <= center.x + halfWidth &&
			cursor.y >= center.y - halfHeight &&
			cursor.y <= center.y + halfHeight
		)
	}

	public GetScaledVector(x: number, y: number): Vector2 {
		if (GUIInfo === undefined) {
			return new Vector2(x, y)
		}
		return GUIInfo.ScaleVector(x, y)
	}

	public WorldToMinimap512(worldCoordinate: number): number {
		const minimapCoordinate =
			worldCoordinate / WORLD_UNITS_PER_MINIMAP_512 + MINIMAP_512_CENTER
		return clamp(minimapCoordinate, 0, 512)
	}

	public GetTextWidth(
		text: string,
		font: string,
		size: number,
		weight: number,
		italic: boolean
	): number {
		return RendererSDK.GetTextSize(text, font, size, weight, italic).x
	}

	private get gameState() {
		return GameRules?.GameState ?? DOTAGameState.DOTA_GAMERULES_STATE_INIT
	}
}

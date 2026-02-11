import {
	DOTAGameState,
	DOTAGameUIState,
	GameRules,
	GameState,
	GUIInfo
} from "github.com/octarine-public/wrapper/index"

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
	private get gameState() {
		return GameRules?.GameState ?? DOTAGameState.DOTA_GAMERULES_STATE_INIT
	}
}

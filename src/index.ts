import "./translations"

import {
	EventsSDK,
	GameState,
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "./gui"
import { MenuManager } from "./menu"
import { WardSpawnerModel } from "./model/WardSpawner"

new (class WardHelper {
	private readonly gui = new GUIHelper()
	private readonly menu = new MenuManager()
	private readonly model = new WardSpawnerModel(this.menu, this.gui)

	constructor() {
		EventsSDK.on("Draw", this.onDraw.bind(this))
		EventsSDK.on("PostDataUpdate", this.onPostDataUpdate.bind(this))
	}

	protected onDraw() {
		if (!GameState.IsConnected || !this.State || !this.gui.IsUIGame) {
			this.model.ResetEffects()
			return
		}

		if (!this.gui.IsReady || !this.gui.IsMatchActive) {
			this.model.ResetEffects()
			return
		}

		this.model.OnDraw()
	}

	private get State() {
		return this.menu.State.value
	}

	protected onPostDataUpdate(_dt: number) {
		if (!GameState.IsConnected || !this.State || !this.gui.IsUIGame) {
			this.model.ResetEffects()
			return
		}

		if (!this.gui.IsReady || !this.gui.IsMatchActive) {
			this.model.ResetEffects()
			return
		}

		this.model.OnTick()
	}
})()

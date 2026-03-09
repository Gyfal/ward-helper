import "./translations"

import { EventsSDK, GameState } from "github.com/octarine-public/wrapper/index"

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
		if (this.isActive()) {
			this.model.OnDraw()
		} else {
			this.model.ResetEffects()
		}
	}

	protected onPostDataUpdate(_dt: number) {
		if (this.isActive()) {
			this.model.OnTick()
		}
	}

	private isActive(): boolean {
		return (
			GameState.IsConnected &&
			this.menu.State.value &&
			this.gui.IsUIGame &&
			this.gui.IsReady &&
			this.gui.IsMatchActive
		)
	}
})()

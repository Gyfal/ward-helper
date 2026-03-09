import {
	Color,
	EntityManager,
	GameState,
	GetPositionHeight,
	InputManager,
	LocalPlayer,
	RendererSDK,
	Team,
	Vector2,
	Vector3,
	VKeys,
	VMouseKeys,
	WardObserver,
	WardTrueSight
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "../gui"
import { InputEdgeTracker } from "../input"
import { MenuManager } from "../menu"
import { CustomWardStorage } from "./CustomWardStorage"
import { PlaceHelper } from "./PlaceHelper"
import { RemoteWardEditor } from "./RemoteWardEditor"
import { RemoteWardStorage } from "./RemoteWardStorage"
import { TooltipAnimator } from "./TooltipAnimator"
import { VisibleWardSelector } from "./VisibleWardSelector"
import { WardDataLoader } from "./WardDataLoader"
import { WardListPresenter } from "./WardListPresenter"
import { WardRenderer } from "./WardRenderer"
import { WardState } from "./WardState"
import {
	DEFAULT_WARD_DESCRIPTION,
	DEFAULT_WARD_TEAMS,
	WardPoint,
	WardTeam,
	WardTeams
} from "./WardTypes"

const VK_ESCAPE = 0x1b
const VK_BACKSPACE = 0x08
const VK_DELETE = 0x2e
const TIME_BUCKETS = {
	start: "0_12",
	mid: "12_25",
	late: "25_50",
	veryLate: "50_plus"
} as const

interface PlacedWardPositions {
	observer: Vector3[]
	sentry: Vector3[]
}

export class WardSpawnerModel {
	private isCustomLoading = false
	private effectsAreReset = false
	private readonly state = new WardState()
	private readonly storage = new CustomWardStorage()
	private readonly remoteStorage = new RemoteWardStorage()
	private readonly placeHelper: PlaceHelper
	private readonly tooltipAnimator = new TooltipAnimator()
	private readonly input = new InputEdgeTracker()
	private readonly visibleWardSelector = new VisibleWardSelector()
	private readonly remoteEditor = new RemoteWardEditor(this.state)
	private readonly renderer: WardRenderer

	constructor(
		public readonly menu: MenuManager,
		public readonly gui: GUIHelper
	) {
		this.placeHelper = new PlaceHelper(this.gui)
		this.renderer = new WardRenderer(
			this.menu,
			this.state,
			this.tooltipAnimator,
			this.gui
		)
		this.menu.SetRemoteWardStats("Loaded remote wards: 0")
		this.RefreshWardList(0)
	}

	public OnTick() {
		this.ensureRemoteWardsLoaded()
		this.ensureCustomWardsLoaded()
		this.placeHelper.UpdatePendingPlacement()
		this.handleBuilderActions()
		this.handleRemoteEditActions()
		this.handlePlaceHelper()
	}

	public OnDraw() {
		if (!this.state.isRemoteLoaded) {
			return
		}
		this.effectsAreReset = false
		this.renderer.Draw(this.GetVisibleWards())
		this.DrawRemoteEditOverlay()
	}

	public ResetEffects() {
		if (this.effectsAreReset) {
			return
		}
		this.renderer.ResetEffects()
		this.effectsAreReset = true
	}

	private ensureRemoteWardsLoaded() {
		if (this.state.isRemoteLoaded) {
			return
		}
		const baseRemote = WardDataLoader.LoadRemoteWards()
		this.state.remoteWards = baseRemote
		this.state.isRemoteLoaded = true
		this.menu.SetRemoteWardStats(`Loaded remote wards: ${baseRemote.length}`)
		void this.remoteStorage.Load().then(edited => {
			if (edited === undefined) {
				return
			}
			this.state.remoteWards = edited
			this.menu.SetRemoteWardStats(`Loaded remote wards: ${edited.length} (edited)`)
		})
	}

	private ensureCustomWardsLoaded() {
		if (this.state.isCustomLoaded || this.isCustomLoading) {
			return
		}
		this.isCustomLoading = true
		void this.storage
			.Load()
			.then(wards => {
				this.state.customWards = wards
			})
			.catch(error => {
				console.error("[ward-helper] failed loading custom wards", error)
				this.state.customWards = []
			})
			.finally(() => {
				this.state.isCustomLoaded = true
				this.isCustomLoading = false
				this.RefreshWardList(0)
			})
	}

	private handleBuilderActions() {
		if (this.menu.Consume("syncSelectedWard")) {
			this.SyncSelectedWardDescription()
		}
		if (this.menu.Consume("saveRemote")) {
			this.SaveRemoteWards()
		}
		if (!this.state.isCustomLoaded) {
			return
		}

		if (this.menu.Consume("addWard")) {
			this.AddWardAtCursor()
		}
		if (this.menu.Consume("clearAll")) {
			this.state.customWards = []
			this.SaveCustomWards()
			this.RefreshWardList(0)
		}
		if (this.menu.Consume("saveCustom")) {
			this.SaveCustomWards()
		}
		if (this.menu.Consume("showInfo")) {
			this.PrintWardsInfo()
		}
		if (this.menu.Consume("applyDescription")) {
			this.ApplySelectedDescription()
		}
		if (this.menu.Consume("deleteWard")) {
			this.DeleteSelectedWard()
		}
		if (this.menu.Consume("duplicateWard")) {
			this.DuplicateSelectedWard()
		}
		if (this.menu.Consume("export")) {
			console.log(
				"[ward-helper] custom wards json:",
				JSON.stringify(this.state.customWards)
			)
		}
	}

	private handleRemoteEditActions() {
		if (!this.menu.EditRemoteMode.value || !this.state.isRemoteLoaded) {
			this.remoteEditor.ResetDragState()
			this.input.ClearMouseState()
			return
		}

		if (
			this.input.IsKeyJustPressed(VK_ESCAPE) &&
			this.state.remoteDrag !== undefined
		) {
			this.remoteEditor.CancelRemoteDrag()
			return
		}
		if (
			this.input.IsKeyJustPressed(VK_DELETE) ||
			this.input.IsKeyJustPressed(VK_BACKSPACE)
		) {
			if (this.remoteEditor.DeleteRemoteHoveredOrDraggedWard()) {
				this.SaveRemoteWards()
			}
			return
		}

		const actionPressed =
			this.input.IsMouseKeyJustPressed(VMouseKeys.MK_LBUTTON) ||
			this.menu.Consume("editRemotePlace")

		if (actionPressed) {
			if (this.state.remoteDrag !== undefined) {
				this.remoteEditor.UpdateDraggedRemoteWardToCursor()
				if (this.remoteEditor.FinishRemoteDrag()) {
					this.SaveRemoteWards()
				}
				return
			}
			this.remoteEditor.PickHoveredRemoteWard()
		}

		if (this.state.remoteDrag !== undefined) {
			this.remoteEditor.UpdateDraggedRemoteWardToCursor()
		}
	}

	private handlePlaceHelper() {
		// Consume unconditionally so a press made in edit mode doesn't fire later.
		const requested = this.menu.Consume("placeWard")
		if (!requested || this.menu.EditRemoteMode.value) {
			return
		}
		if (!this.menu.PlaceHelper.value || !this.state.isRemoteLoaded) {
			return
		}
		if (this.menu.OnlyAlt.value && !InputManager.IsKeyDown(VKeys.MENU)) {
			return
		}
		this.placeHelper.TryPlaceWard(this.GetVisibleWards(), this.menu.IconSize.value)
	}

	private GetVisibleWards() {
		const localGameTeam = this.GetEffectiveLocalGameTeam()
		const placed = this.GetPlacedWardPositions(localGameTeam)
		return this.visibleWardSelector.Select({
			remoteWards: this.state.remoteWards,
			customWards: this.state.customWards,
			localTeam: this.TeamToWardTeam(localGameTeam),
			currentBucket: this.GetCurrentTimeBucket(),
			placedObserver: placed.observer,
			placedSentry: placed.sentry,
			showCustomWards: this.menu.ShowCustomWards.value,
			teamFilterEnabled: this.menu.TeamFilter.value,
			dynamicTopPerType: this.menu.DynamicTopPerType.value,
			dynamicMinCellDistance: this.menu.DynamicMinCellDistance,
			dynamicMinMinimapDistance: this.menu.DynamicMinMinimapDistance,
			dynamicDedupeRadius3D: this.menu.DynamicDedupeRadius3D.value,
			dynamicExcludeRiskyObserver: this.menu.DynamicExcludeRiskyObserver.value,
			dynamicAdaptiveSpacingEnabled: this.menu.DynamicAdaptiveSpacing.value,
			dynamicRegionQuota: this.menu.DynamicRegionQuota.value,
			dynamicAutoRegionSizeEnabled: this.menu.DynamicAutoRegionSize.value,
			dynamicRegionSize: this.menu.DynamicRegionSize.value
		})
	}

	private GetEffectiveLocalGameTeam(): Team {
		const forced = this.menu.TestForcedLocalTeam
		if (forced === WardTeams.Radiant) {
			return Team.Radiant
		}
		if (forced === WardTeams.Dire) {
			return Team.Dire
		}
		return LocalPlayer?.Hero?.Team ?? GameState.LocalTeam
	}

	private TeamToWardTeam(team: Team): WardTeam | undefined {
		if (team === Team.Radiant) {
			return WardTeams.Radiant
		}
		if (team === Team.Dire) {
			return WardTeams.Dire
		}
		return undefined
	}

	private GetCurrentTimeBucket() {
		const forced = this.menu.TestForcedTimeBucket
		if (forced !== undefined) {
			return forced
		}
		const timeSec = Math.max(0, GameState.RawGameTime)
		if (timeSec < 12 * 60) {
			return TIME_BUCKETS.start
		}
		if (timeSec < 25 * 60) {
			return TIME_BUCKETS.mid
		}
		if (timeSec < 50 * 60) {
			return TIME_BUCKETS.late
		}
		return TIME_BUCKETS.veryLate
	}

	private GetPlacedWardPositions(localTeam: Team): PlacedWardPositions {
		const observer: Vector3[] = []
		const sentry: Vector3[] = []
		if (
			!this.menu.HidePlacedWards.value ||
			(localTeam !== Team.Radiant && localTeam !== Team.Dire)
		) {
			return { observer, sentry }
		}
		// WardTrueSight extends WardObserver, so one query returns both kinds.
		const wards = EntityManager.GetEntitiesByClass(WardObserver)
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			if (!ward.IsValid || !ward.IsAlive || ward.Team !== localTeam) {
				continue
			}
			const out = ward instanceof WardTrueSight ? sentry : observer
			out.push(new Vector3(ward.Position.x, ward.Position.y, ward.Position.z))
		}
		return { observer, sentry }
	}

	private SaveRemoteWards() {
		void this.remoteStorage.Save(this.state.remoteWards).catch(() => undefined)
		this.menu.SetRemoteWardStats(
			`Loaded remote wards: ${this.state.remoteWards.length} (edited)`
		)
	}

	private AddWardAtCursor() {
		if (!this.menu.BuilderMode.value) {
			return
		}
		const cursorWorld = InputManager.CursorOnWorld
		const newWard: WardPoint = {
			x: cursorWorld.x,
			y: cursorWorld.y,
			z: GetPositionHeight(new Vector2(cursorWorld.x, cursorWorld.y)),
			type: this.menu.SelectedWardType,
			description: DEFAULT_WARD_DESCRIPTION,
			teams: this.menu.TeamsForNewWard
		}
		this.state.customWards.push(newWard)
		this.SaveCustomWards()
		this.RefreshWardList(this.state.customWards.length - 1)
	}

	private ApplySelectedDescription() {
		const selected = this.GetSelectedWard()
		if (selected === undefined) {
			return
		}
		selected.description = this.menu.SelectedDescription
		this.SaveCustomWards()
		this.RefreshWardList(this.menu.SelectedWardID)
	}

	private DeleteSelectedWard() {
		const selectedID = this.menu.SelectedWardID
		if (selectedID < 0 || selectedID >= this.state.customWards.length) {
			return
		}
		this.state.customWards.splice(selectedID, 1)
		this.SaveCustomWards()
		this.RefreshWardList(selectedID)
	}

	private DuplicateSelectedWard() {
		const selected = this.GetSelectedWard()
		if (selected === undefined) {
			return
		}
		const copy: WardPoint = {
			x: selected.x + 100,
			y: selected.y + 100,
			z: selected.z,
			timeBucket: selected.timeBucket,
			type: selected.type,
			description: `${selected.description ?? DEFAULT_WARD_DESCRIPTION} (Copy)`,
			teams: [...(selected.teams ?? DEFAULT_WARD_TEAMS)]
		}
		this.state.customWards.push(copy)
		this.SaveCustomWards()
		this.RefreshWardList(this.state.customWards.length - 1)
	}

	private GetSelectedWard(): Nullable<WardPoint> {
		return WardListPresenter.GetWardBySelectedID(
			this.state.customWards,
			this.menu.SelectedWardID
		)
	}

	private SyncSelectedWardDescription() {
		this.menu.SetSelectedWardDescription(
			WardListPresenter.GetDescription(this.GetSelectedWard() ?? undefined)
		)
	}

	private RefreshWardList(selectedID: number) {
		const safeSelected = WardListPresenter.GetSafeSelectionID(
			this.state.customWards,
			selectedID
		)
		this.menu.SetWardListOptions(
			WardListPresenter.BuildWardOptions(this.state.customWards),
			safeSelected
		)
		this.menu.SetWardStats(WardListPresenter.BuildStatsText(this.state.customWards))
		this.SyncSelectedWardDescription()
	}

	private SaveCustomWards() {
		void this.storage.Save(this.state.customWards).catch(() => undefined)
	}

	private PrintWardsInfo() {
		const wards = this.state.customWards
		console.log("[ward-helper] total custom wards:", wards.length)
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			const description = ward.description ?? DEFAULT_WARD_DESCRIPTION
			const teams = (ward.teams ?? DEFAULT_WARD_TEAMS).join(", ")
			console.log(
				`[ward-helper] #${i + 1}: ${ward.type} (${ward.x.toFixed(2)}, ${ward.y.toFixed(2)}, ${ward.z.toFixed(2)}) [${teams}] - ${description}`
			)
		}
		const { observer, sentry } = WardListPresenter.CountByType(wards)
		console.log("[ward-helper] observer wards:", observer)
		console.log("[ward-helper] sentry wards:", sentry)
	}

	private DrawRemoteEditOverlay() {
		if (!this.menu.EditRemoteMode.value || this.state.remoteDrag === undefined) {
			return
		}
		RendererSDK.FilledCircle(
			InputManager.CursorOnScreen,
			new Vector2(8, 8),
			new Color(255, 125, 50, 230)
		)
	}
}

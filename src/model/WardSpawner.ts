import {
	Color,
	EntityManager,
	GameState,
	GetPositionHeight,
	InputManager,
	LocalPlayer,
	RendererSDK,
	Team,
	Tower,
	WardObserver,
	WardTrueSight,
	VKeys,
	VMouseKeys,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "../gui"
import { InputEdgeTracker } from "../input"
import { MenuManager } from "../menu"
import { CustomWardStorage } from "./CustomWardStorage"
import { PlaceHelper } from "./PlaceHelper"
import { RemoteWardEditor } from "./RemoteWardEditor"
import { RemoteWardStorage } from "./RemoteWardStorage"
import { TooltipAnimator } from "./TooltipAnimator"
import { RemoteWardSourceKey, WardDataLoader } from "./WardDataLoader"
import { WardDebugOverlay } from "./WardDebugOverlay"
import { WardListPresenter } from "./WardListPresenter"
import { WardRenderer } from "./WardRenderer"
import { VisibleWardSelector } from "./VisibleWardSelector"
import { WardState } from "./WardState"
import {
	DEFAULT_WARD_DESCRIPTION,
	DEFAULT_WARD_TEAMS,
	WardPoint,
	WardTeams,
	WardTypes
} from "./WardTypes"

const VK_ESCAPE = 0x1b
const VK_BACKSPACE = 0x08
const VK_DELETE = 0x2e
const TIME_BUCKETS = {
	start: "0_10",
	mid: "10_20",
	late: "20_35",
	veryLate: "35_50",
	ultraLate: "50_plus"
} as const
const TOWER_KEY_RE = /npc_dota_(goodguys|badguys)_tower([1-4])_(top|mid|bot)/i
const TOWER_ALL_KEYS = [
	"top_t1",
	"top_t2",
	"top_t3",
	"top_t4",
	"mid_t1",
	"mid_t2",
	"mid_t3",
	"mid_t4",
	"bot_t1",
	"bot_t2",
	"bot_t3",
	"bot_t4"
]

export class WardSpawnerModel {
	private isCustomLoading = false
	private effectsAreReset = false
	private readonly state = new WardState()
	private readonly storage = new CustomWardStorage()
	private readonly remoteStorage = new RemoteWardStorage()
	private readonly placeHelper = new PlaceHelper()
	private readonly debugOverlay = new WardDebugOverlay()
	private readonly tooltipAnimator = new TooltipAnimator()
	private readonly input = new InputEdgeTracker()
	private readonly visibleWardSelector = new VisibleWardSelector()
	private readonly remoteEditor = new RemoteWardEditor(this.state)
	private readonly renderer: WardRenderer
	private remoteLoadToken = 0

	constructor(
		public readonly menu: MenuManager,
		public readonly gui: GUIHelper
	) {
		this.renderer = new WardRenderer(this.menu, this.state, this.tooltipAnimator)
		this.menu.SetRemoteWardStats("Loaded remote wards: 0")
		this.RefreshWardList(0)
	}

	public OnTick() {
		this.handleRemoteSource()
		this.ensureCustomWardsLoaded()
		this.handleBuilderActions()
		this.handleRemoteEditActions()
		this.handlePlaceHelper()
	}

	public OnDraw() {
		if (!this.menu.State.value || !this.gui.IsReady) {
			this.ResetEffects()
			return
		}
		if (this.menu.Debug.value && this.menu.CursorPositionOverlay.value) {
			this.DrawDebug()
		}
		if (!this.state.isRemoteLoaded) {
			this.ResetEffects()
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

	private handleRemoteSource() {
		const selectedSource = this.menu.SelectedRemoteSource
		if (
			this.state.isRemoteLoaded &&
			this.state.remoteSourceKey === selectedSource
		) {
			return
		}
		this.remoteEditor.ResetDragState()
		const baseRemote = WardDataLoader.LoadRemoteWards(selectedSource)
		this.state.remoteWards = baseRemote
		this.state.remoteSourceKey = selectedSource
		this.state.isRemoteLoaded = true
		this.menu.SetRemoteWardStats(
			`Loaded remote wards: ${baseRemote.length}`
		)
		const token = ++this.remoteLoadToken
		void this.remoteStorage.Load(selectedSource).then(edited => {
			if (token !== this.remoteLoadToken) {
				return
			}
			if (edited === undefined) {
				return
			}
			this.state.remoteWards = edited
			this.menu.SetRemoteWardStats(
				`Loaded remote wards: ${edited.length} (edited)`
			)
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
				this.state.isCustomLoaded = true
				this.RefreshWardList(0)
			})
			.catch(error => {
				console.error("[ward-helper] failed loading custom wards", error)
				this.state.customWards = []
				this.state.isCustomLoaded = true
				this.RefreshWardList(0)
			})
			.finally(() => {
				this.isCustomLoading = false
			})
	}

	private handleBuilderActions() {
		if (this.menu.ConsumeSyncSelectedWardRequest()) {
			this.SyncSelectedWardDescription()
		}
		if (this.menu.ConsumeSaveRemoteRequest()) {
			this.SaveRemoteWards()
		}
		if (!this.state.isCustomLoaded) {
			return
		}

		if (this.menu.ConsumeAddWardRequest()) {
			this.AddWardAtCursor()
		}
		if (this.menu.ConsumeClearAllRequest()) {
			this.state.customWards = []
			this.SaveCustomWards()
			this.RefreshWardList(0)
		}
		if (this.menu.ConsumeSaveCustomRequest()) {
			this.SaveCustomWards()
		}
		if (this.menu.ConsumeShowInfoRequest()) {
			this.PrintWardsInfo()
		}
		if (this.menu.ConsumeApplyDescriptionRequest()) {
			this.ApplySelectedDescription()
		}
		if (this.menu.ConsumeDeleteWardRequest()) {
			this.DeleteSelectedWard()
		}
		if (this.menu.ConsumeDuplicateWardRequest()) {
			this.DuplicateSelectedWard()
		}
		if (this.menu.ConsumeExportRequest()) {
			console.log("[ward-helper] custom wards json:", JSON.stringify(this.state.customWards))
		}
	}

	private handleRemoteEditActions() {
		if (!this.menu.EditRemoteMode.value || !this.state.isRemoteLoaded) {
			this.remoteEditor.ResetDragState()
			this.input.ClearMouseState()
			return
		}

		if (this.input.IsKeyJustPressed(VK_ESCAPE) && this.state.draggedRemoteWardID >= 0) {
			this.remoteEditor.CancelRemoteDrag()
			return
		}
		if (this.input.IsKeyJustPressed(VK_DELETE) || this.input.IsKeyJustPressed(VK_BACKSPACE)) {
			if (this.remoteEditor.DeleteRemoteHoveredOrDraggedWard()) {
				this.SaveRemoteWards()
			}
			return
		}

		const actionPressed =
			this.input.IsMouseKeyJustPressed(VMouseKeys.MK_LBUTTON) ||
			this.menu.ConsumeEditRemotePlaceRequest()

		if (actionPressed) {
			if (this.state.draggedRemoteWardID >= 0) {
				this.remoteEditor.UpdateDraggedRemoteWardToCursor()
				if (this.remoteEditor.FinishRemoteDrag()) {
					this.SaveRemoteWards()
				}
				return
			}
			this.remoteEditor.PickHoveredRemoteWard()
		}

		if (this.state.draggedRemoteWardID >= 0) {
			this.remoteEditor.UpdateDraggedRemoteWardToCursor()
		}
	}

	private handlePlaceHelper() {
		if (this.menu.EditRemoteMode.value) {
			return
		}
		if (!this.menu.ConsumePlaceWardRequest()) {
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
		const currentBucket = this.GetCurrentTimeBucket()
		const localTeam = this.GetEffectiveLocalGameTeam()
		const towerContext = this.GetCurrentTowerContext(localTeam)
		const placedObserver = this.GetPlacedWardPositions(localTeam, WardTypes.Observer)
		const placedSentry = this.GetPlacedWardPositions(localTeam, WardTypes.Sentry)
		return this.visibleWardSelector.Select({
			remoteSourceKey: this.state.remoteSourceKey as RemoteWardSourceKey,
			remoteWards: this.state.remoteWards,
			customWards: this.state.customWards,
			localTeam: this.GetLocalWardTeamName(),
			currentBucket,
			placedObserver,
			placedSentry,
			showCustomWards: this.menu.ShowCustomWards.value,
			teamFilterEnabled: this.menu.TeamFilter.value,
			useTowerStateFilter: this.menu.UseTowerStateFilter.value,
			hidePlacedWards: this.menu.HidePlacedWards.value,
			dynamicTopPerType: this.menu.DynamicTopPerType.value,
			dynamicMinCellDistance: this.menu.DynamicMinCellDistance,
			dynamicMinMinimapDistance: this.menu.DynamicMinMinimapDistance,
			dynamicDedupeRadius3D: this.menu.DynamicDedupeRadius3DValue,
			dynamicExcludeRiskyObserver: this.menu.DynamicExcludeRiskyObserver.value,
			missingOwnTowers: towerContext.missingOwn,
			missingEnemyTowers: towerContext.missingEnemy,
			dynamicTowerFitWeight: this.menu.DynamicTowerFitWeight,
			dynamicMinTowerFit: this.menu.DynamicMinTowerFit,
			dynamicMinContextSupportPlacements:
				this.menu.DynamicMinContextSupportPlacementsValue,
			dynamicConfidencePlacementsRef: this.menu.DynamicConfidencePlacementsRefValue,
			dynamicConfidenceMatchesRef: this.menu.DynamicConfidenceMatchesRefValue,
			dynamicAdaptiveSpacingEnabled: this.menu.DynamicAdaptiveSpacingEnabled,
			dynamicRegionQuota: this.menu.DynamicRegionQuotaValue,
			dynamicRegionSize: this.menu.DynamicRegionSizeValue,
			dynamicLaneQuotaMin: this.menu.DynamicLaneQuotaMinValue,
			dynamicLaneQuotaUse: this.menu.DynamicLaneQuotaUseValue,
			dynamicLaneBand: this.menu.DynamicLaneBandValue
		})
	}

	private GetCurrentTowerContext(localTeam: Team) {
		if (this.menu.DebugTowerTemplateOverrideEnabled) {
			return {
				missingOwn: this.menu.DebugMissingOwnTowersFromTemplate,
				missingEnemy: this.menu.DebugMissingEnemyTowersFromTemplate
			}
		}
		if (this.menu.DebugAliveTowerOverrideEnabled) {
			return this.GetTowerContextFromAlive(
				this.menu.DebugAliveOwnTowers,
				this.menu.DebugAliveEnemyTowers
			)
		}
		return this.GetCurrentTowerContextFromGame(localTeam)
	}

	private GetTowerContextFromAlive(aliveOwn: string[], aliveEnemy: string[]) {
		const ownSet = new Set(aliveOwn)
		const enemySet = new Set(aliveEnemy)
		const missingOwn: string[] = []
		const missingEnemy: string[] = []
		for (let i = 0; i < TOWER_ALL_KEYS.length; i++) {
			const key = TOWER_ALL_KEYS[i]
			if (!ownSet.has(key)) {
				missingOwn.push(key)
			}
			if (!enemySet.has(key)) {
				missingEnemy.push(key)
			}
		}
		return { missingOwn, missingEnemy }
	}

	private GetCurrentTowerContextFromGame(localTeam: Team) {
		if (localTeam !== Team.Radiant && localTeam !== Team.Dire) {
			return { missingOwn: [] as string[], missingEnemy: [] as string[] }
		}
		const radiantAlive = new Set<string>()
		const direAlive = new Set<string>()
		try {
			const towers = EntityManager.GetEntitiesByClass(Tower)
			for (let i = 0; i < towers.length; i++) {
				const tower = towers[i]
				if (!tower.IsValid || !tower.IsAlive) {
					continue
				}
				const parsed = this.ParseTowerContextKey(tower)
				if (parsed === undefined) {
					continue
				}
				if (parsed.team === Team.Radiant) {
					radiantAlive.add(parsed.key)
					continue
				}
				if (parsed.team === Team.Dire) {
					direAlive.add(parsed.key)
				}
			}
		} catch {
			return { missingOwn: [] as string[], missingEnemy: [] as string[] }
		}

		const radiantMissing: string[] = []
		const direMissing: string[] = []
		for (let i = 0; i < TOWER_ALL_KEYS.length; i++) {
			const key = TOWER_ALL_KEYS[i]
			if (!radiantAlive.has(key)) {
				radiantMissing.push(key)
			}
			if (!direAlive.has(key)) {
				direMissing.push(key)
			}
		}
		if (localTeam === Team.Radiant) {
			return { missingOwn: radiantMissing, missingEnemy: direMissing }
		}
		return { missingOwn: direMissing, missingEnemy: radiantMissing }
	}

	private ParseTowerContextKey(
		tower: Tower
	): { team: Team; key: string } | undefined {
		const anyTower = tower as unknown as Record<string, unknown>
		const candidates = [
			anyTower["Name"],
			anyTower["UnitName"],
			anyTower["ClassName"],
			anyTower["NetworkName"],
			anyTower["ModelName"]
		]
		for (let i = 0; i < candidates.length; i++) {
			const raw = candidates[i]
			if (typeof raw !== "string" || raw.length === 0) {
				continue
			}
			const m = raw.match(TOWER_KEY_RE)
			if (m === null) {
				continue
			}
			const sideRaw = m[1]
			const tier = m[2]
			const lane = m[3]
			const team = sideRaw.toLowerCase() === "goodguys" ? Team.Radiant : Team.Dire
			return { team, key: `${lane.toLowerCase()}_t${tier}` }
		}
		return undefined
	}

	private GetLocalWardTeamName() {
		const forced = this.menu.DebugForcedLocalTeam
		if (forced !== undefined) {
			return forced
		}
		const team = LocalPlayer?.Hero?.Team ?? GameState.LocalTeam
		if (team === Team.Radiant) {
			return WardTeams.Radiant
		}
		if (team === Team.Dire) {
			return WardTeams.Dire
		}
		return undefined
	}

	private GetEffectiveLocalGameTeam() {
		const forced = this.menu.DebugForcedLocalTeam
		if (forced === WardTeams.Radiant) {
			return Team.Radiant
		}
		if (forced === WardTeams.Dire) {
			return Team.Dire
		}
		return LocalPlayer?.Hero?.Team ?? GameState.LocalTeam
	}

	private GetCurrentTimeBucket() {
		const forcedBucket = this.menu.DebugForcedTimeBucket
		if (forcedBucket !== undefined && forcedBucket.length > 0) {
			return forcedBucket
		}
		const timeSec = Math.max(0, Number(GameState.RawGameTime) || 0)
		if (timeSec < 600) {
			return TIME_BUCKETS.start
		}
		if (timeSec < 1200) {
			return TIME_BUCKETS.mid
		}
		if (timeSec < 2100) {
			return TIME_BUCKETS.late
		}
		if (timeSec < 3000) {
			return TIME_BUCKETS.veryLate
		}
		return TIME_BUCKETS.ultraLate
	}

	private GetPlacedWardPositions(localTeam: Team, type: WardPoint["type"]): Vector3[] {
		if (
			!this.menu.HidePlacedWards.value ||
			(localTeam !== Team.Radiant && localTeam !== Team.Dire)
		) {
			return []
		}
		const out: Vector3[] = []
		try {
			if (type === WardTypes.Observer) {
				const wards = EntityManager.GetEntitiesByClass(WardObserver)
				for (let i = 0; i < wards.length; i++) {
					const ward = wards[i]
					if (
						!ward.IsValid ||
						!ward.IsAlive ||
						ward.Team !== localTeam ||
						ward.ClassName !== "CDOTA_NPC_Observer_Ward"
					) {
						continue
					}
					out.push(new Vector3(ward.Position.x, ward.Position.y, ward.Position.z))
				}
				return out
			}
			const sentries = EntityManager.GetEntitiesByClass(WardTrueSight)
			for (let i = 0; i < sentries.length; i++) {
				const ward = sentries[i]
				if (!ward.IsValid || !ward.IsAlive || ward.Team !== localTeam) {
					continue
				}
				out.push(new Vector3(ward.Position.x, ward.Position.y, ward.Position.z))
			}
		} catch {
			return []
		}
		return out
	}

	private SaveRemoteWards() {
		const source = this.state.remoteSourceKey as RemoteWardSourceKey
		this.remoteStorage.Save(source, this.state.remoteWards)
		this.menu.SetRemoteWardStats(
			`Loaded  remote wards: ${this.state.remoteWards.length} (edited)`
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
			towerDiffAvg: selected.towerDiffAvg,
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
		this.storage.Save(this.state.customWards)
	}

	private PrintWardsInfo() {
		const wards = this.state.customWards
		console.log("[ward-helper] total custom wards:", wards.length)
		let obsCount = 0
		let sentryCount = 0
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			if (ward.type === WardTypes.Observer) {
				obsCount++
			} else if (ward.type === WardTypes.Sentry) {
				sentryCount++
			}
			const description = ward.description ?? DEFAULT_WARD_DESCRIPTION
			const teams = (ward.teams ?? DEFAULT_WARD_TEAMS).join(", ")
			console.log(
				`[ward-helper] #${i + 1}: ${ward.type} (${ward.x.toFixed(2)}, ${ward.y.toFixed(2)}, ${ward.z.toFixed(2)}) [${teams}] - ${description}`
			)
		}
		console.log("[ward-helper] observer wards:", obsCount)
		console.log("[ward-helper] sentry wards:", sentryCount)
	}

	private DrawDebug() {
		this.debugOverlay.DrawCursorDebug()
		const topN = Math.max(1, Math.floor(this.menu.DynamicTopPerType.value))
		const phaseBucket = this.GetCurrentTimeBucket()
		const selectorStats = this.visibleWardSelector.GetLastDebugStats()
		this.debugOverlay.DrawTextNearCursorWorld(
			`Dynamic top per type: ${topN} | bucket=${phaseBucket}`,
			120
		)
		if (selectorStats !== undefined) {
			this.debugOverlay.DrawTextNearCursorWorld(
				`Selector: source=${selectorStats.sourceKey} mode=${selectorStats.mode} team=${selectorStats.localTeam ?? "unknown"} bucket=${selectorStats.bucket}`,
				108
			)
			this.debugOverlay.DrawTextNearCursorWorld(
				`Input=${selectorStats.remoteInput} -> visible=${selectorStats.remoteVisible} final=${selectorStats.finalVisible} (custom+${selectorStats.customAdded})`,
				204
			)
			this.debugOverlay.DrawTextNearCursorWorld(
				`Filtered: time=${selectorStats.timeFilteredOut} team=${selectorStats.teamFilteredOut} placed=${selectorStats.placedFilteredOut}`,
				216
			)
			if (selectorStats.mode === "dynamic") {
				this.debugOverlay.DrawTextNearCursorWorld(
					`Dynamic pools: cand=${selectorStats.dynamicCandidate ?? 0} ownObs=${selectorStats.dynamicOwnObserver ?? 0} ownSen=${selectorStats.dynamicOwnSentry ?? 0} enemyObs=${selectorStats.dynamicEnemyObserver ?? 0}`,
					228
				)
				this.debugOverlay.DrawTextNearCursorWorld(
					`Dynamic top: obs=${selectorStats.dynamicObserverTop ?? 0} counter=${selectorStats.dynamicCounterTop ?? 0}`,
					240
				)
			}
		}
		this.debugOverlay.DrawTextNearCursorWorld(
			`Dedupe: cell>=${this.menu.DynamicMinCellDistance.toFixed(1)} minimap>=${this.menu.DynamicMinMinimapDistance.toFixed(1)} 3D>=${this.menu.DynamicDedupeRadius3DValue.toFixed(0)} | riskyObserverFilter=${this.menu.DynamicExcludeRiskyObserver.value}`,
			132
		)
		this.debugOverlay.DrawTextNearCursorWorld(
			`Tower fit: w=${this.menu.DynamicTowerFitWeight.toFixed(1)} minFit=${this.menu.DynamicMinTowerFit.toFixed(2)} minSupport=${this.menu.DynamicMinContextSupportPlacementsValue.toFixed(0)} confRef(P=${this.menu.DynamicConfidencePlacementsRefValue.toFixed(0)},M=${this.menu.DynamicConfidenceMatchesRefValue.toFixed(0)})`,
			144
		)
		const localTeam = this.GetEffectiveLocalGameTeam()
		const towerContext = this.GetCurrentTowerContext(localTeam)
		this.debugOverlay.DrawTextNearCursorWorld(
			`Missing own: ${towerContext.missingOwn.join(", ") || "none"}`,
			168
		)
		this.debugOverlay.DrawTextNearCursorWorld(
			`Missing enemy: ${towerContext.missingEnemy.join(", ") || "none"}`,
			180
		)
		this.debugOverlay.DrawTextNearCursorWorld(
			`Tower debug source: ${
				this.menu.DebugTowerTemplateOverrideEnabled
					? "Template"
					: this.menu.DebugAliveTowerOverrideEnabled
						? "Alive keys"
						: "Live game"
			}`,
			192
		)
		const hovered = this.state.hoveredWard
		if (hovered !== undefined) {
			const textWorld = new Vector3(hovered.x, hovered.y, hovered.z + 24)
			this.debugOverlay.DrawTextNearWorld(
				`ctx=${hovered.contextLevel ?? "n/a"} fit=${(hovered.towerFit ?? 0).toFixed(3)} cov=${(hovered.towerFitCoverage ?? 0).toFixed(3)} conf=${(hovered.contextConfidence ?? 0).toFixed(3)}`,
				textWorld,
				0
			)
			this.debugOverlay.DrawTextNearWorld(
				`score: base=${(hovered.scoreBase ?? hovered.score ?? 0).toFixed(3)} runtime=${(hovered.scoreRuntime ?? hovered.score ?? 0).toFixed(3)} supportP=${(hovered.contextSupportPlacements ?? 0).toFixed(1)} supportM=${(hovered.contextSupportMatches ?? 0).toFixed(1)}`,
				textWorld,
				20
			)
		}
	}

	private DrawRemoteEditOverlay() {
		if (!this.menu.EditRemoteMode.value || !this.state.isRemoteLoaded) {
			return
		}

		const isAttach = this.state.draggedRemoteWardID >= 0
		const isHover = this.state.hoveredWard !== undefined
		const textWard =
			this.state.draggedRemoteWardPreview ??
			this.state.draggedRemoteWard ??
			this.state.hoveredWard
		if (textWard !== undefined) {
			const textWorld = new Vector3(textWard.x, textWard.y, textWard.z + 32)
			this.debugOverlay.DrawTextNearWorld(`isHover: ${isHover}`, textWorld, 0)
			this.debugOverlay.DrawTextNearWorld(`isAttach: ${isAttach}`, textWorld, 22)
		}
		if (isAttach) {
			RendererSDK.FilledCircle(
				InputManager.CursorOnScreen,
				new Vector2(8, 8),
				new Color(255, 125, 50, 230)
			)
			this.debugOverlay.DrawTextNearCursorWorld(
				`Editing remote ward #${this.state.draggedRemoteWardID + 1} | LMB place | DEL/BACKSPACE delete | ESC cancel`,
				24
			)
		}
	}

}

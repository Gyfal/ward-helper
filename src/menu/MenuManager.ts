import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import {
	REMOTE_SOURCE_KEYS,
	REMOTE_SOURCE_OPTIONS,
	RemoteSourceKey
} from "../model/RemoteSources"
import {
	DEFAULT_WARD_DESCRIPTION,
	WARD_TEAM_OPTION_VALUES,
	WARD_TEAM_VALUES,
	WARD_TYPE_VALUES,
	WardTeam,
	WardTeamOption,
	WardTeamOptions,
	WardTeams,
	WardType
} from "../model/WardTypes"
import { DEBUG_PHASE_BUCKETS } from "./constants"
import { createBuilderSection } from "./sections/builder"
import {
	createDebugSection,
	DEBUG_SCENARIO_PRESETS,
	DebugMenuModel,
	MenuReadModel
} from "./sections/debug"
import { createMainSection } from "./sections/main"

const DEFAULT_REMOTE_SOURCE_INDEX = REMOTE_SOURCE_KEYS.indexOf("ward_reco_dynamic")
const DESCRIPTION_PRESETS = [
	DEFAULT_WARD_DESCRIPTION,
	"Aggressive cliff",
	"Defensive vision",
	"Roshan control",
	"Smoke break"
]

export class MenuManager {
	public readonly State: Menu.Toggle

	public readonly IconSize: Menu.Slider
	public readonly TooltipSize: Menu.Slider
	public readonly ShowOnMinimap: Menu.Toggle
	public readonly LegacyMinimapCoordinates: Menu.Toggle
	public readonly RemoteSource: Menu.Dropdown
	public readonly TeamFilter: Menu.Toggle
	public readonly UseTowerStateFilter: Menu.Toggle
	public readonly DynamicAdaptiveSpacing: Menu.Toggle
	public readonly DynamicTopPerType: Menu.Slider
	public readonly DynamicExcludeRiskyObserver: Menu.Toggle
	public readonly DynamicMinCellDistanceTenths: Menu.Slider
	public readonly DynamicMinMinimapDistanceTenths: Menu.Slider
	public readonly DynamicRegionQuota: Menu.Slider
	public readonly DynamicRegionSize: Menu.Slider
	public readonly DynamicLaneQuotaMin: Menu.Slider
	public readonly DynamicLaneQuotaUse: Menu.Dropdown
	public readonly DynamicLaneBand: Menu.Slider
	public readonly DynamicDedupeRadius3D: Menu.Slider
	public readonly DynamicTowerFitWeightTenths: Menu.Slider
	public readonly DynamicMinTowerFitPercent: Menu.Slider
	public readonly DynamicMinContextSupportPlacements: Menu.Slider
	public readonly DynamicConfidencePlacementsRef: Menu.Slider
	public readonly DynamicConfidenceMatchesRef: Menu.Slider
	public readonly HidePlacedWards: Menu.Toggle
	public readonly OnlyAlt: Menu.Toggle
	public readonly PlaceHelper: Menu.Toggle
	public readonly PlaceBind: Menu.KeyBind
	public readonly CursorPositionOverlay: Menu.Toggle
	public readonly Debug: Menu.Toggle
	public readonly DebugPhaseOverride: Menu.Toggle
	public readonly DebugPhase: Menu.Dropdown
	public readonly DebugScenarioPreset: Menu.Dropdown
	public readonly DebugLocalTeamOverride: Menu.Toggle
	public readonly DebugLocalTeam: Menu.Dropdown
	public readonly DebugTowerTemplateOverride: Menu.Toggle
	public readonly DebugTowerTemplate: Menu.Dropdown
	public readonly DebugAliveTowersOverride: Menu.Toggle

	public readonly BuilderMode: Menu.Toggle
	public readonly EditRemoteMode: Menu.Toggle
	public readonly EditRemotePlaceBind: Menu.KeyBind
	public readonly SaveRemoteButton: Menu.Button
	public readonly WardType: Menu.Dropdown
	public readonly TeamType: Menu.Dropdown
	public readonly ShowCustomWards: Menu.Toggle
	public readonly AddWardBind: Menu.KeyBind
	public readonly WardList: Menu.Dropdown
	public readonly DescriptionPreset: Menu.Dropdown

	public readonly ClearAllButton: Menu.Button
	public readonly SaveCustomButton: Menu.Button
	public readonly ShowInfoButton: Menu.Button
	public readonly ApplyDescriptionButton: Menu.Button
	public readonly DeleteWardButton: Menu.Button
	public readonly DuplicateWardButton: Menu.Button
	public readonly ExportButton: Menu.Button

	private requestAddWard = false
	private requestPlaceWard = false
	private requestClearAll = false
	private requestSaveCustom = false
	private requestShowInfo = false
	private requestApplyDescription = false
	private requestDeleteWard = false
	private requestDuplicateWard = false
	private requestExport = false
	private requestSyncSelectedWard = true
	private requestEditRemotePlace = false
	private requestSaveRemote = false

	private readonly baseNode = Menu.AddEntry("Visual")
	private readonly tree = this.baseNode.AddNode(
		"Ward tracker",
		ImageData.Icons.icon_ward
	)
	private readonly mainTree = this.tree.AddNode("Main")
	private readonly builderTree = this.tree.AddNode("Builder")
	private readonly debugTree = this.tree.AddNode("Debug")
	private readonly remoteWardStats = this.mainTree.AddShortDescription(
		"Loaded remote wards: 0"
	)
	private readonly wardStats: any
	private readonly selectedWardDescription: any
	private readonly debugModel: DebugMenuModel
	private readonly readModel: MenuReadModel

	constructor() {
		this.tree.SortNodes = false
		this.mainTree.SortNodes = false
		this.builderTree.SortNodes = false
		this.debugTree.SortNodes = false
		this.State = this.tree.AddToggle("State", true)

		const main = createMainSection(
			this.mainTree,
			REMOTE_SOURCE_OPTIONS,
			DEFAULT_REMOTE_SOURCE_INDEX >= 0 ? DEFAULT_REMOTE_SOURCE_INDEX : 0
		)
		const builder = createBuilderSection(this.builderTree, DESCRIPTION_PRESETS)
		const debug = createDebugSection(this.debugTree)
		this.debugModel = new DebugMenuModel(main.Debug, debug)
		this.readModel = new MenuReadModel({
			wardList: builder.WardList,
			wardType: builder.WardType,
			teamType: builder.TeamType,
			descriptionPreset: builder.DescriptionPreset,
			remoteSource: main.RemoteSource,
			dynamicMinCellDistanceTenths: debug.DynamicMinCellDistanceTenths,
			dynamicMinMinimapDistanceTenths: debug.DynamicMinMinimapDistanceTenths,
			dynamicAdaptiveSpacing: debug.DynamicAdaptiveSpacing,
			dynamicRegionQuota: debug.DynamicRegionQuota,
			dynamicRegionSize: debug.DynamicRegionSize,
			dynamicLaneQuotaMin: debug.DynamicLaneQuotaMin,
			dynamicLaneQuotaUse: debug.DynamicLaneQuotaUse,
			dynamicLaneBand: debug.DynamicLaneBand,
			dynamicTowerFitWeightTenths: debug.DynamicTowerFitWeightTenths,
			dynamicDedupeRadius3D: debug.DynamicDedupeRadius3D,
			dynamicMinTowerFitPercent: debug.DynamicMinTowerFitPercent,
			dynamicMinContextSupportPlacements: debug.DynamicMinContextSupportPlacements,
			dynamicConfidencePlacementsRef: debug.DynamicConfidencePlacementsRef,
			dynamicConfidenceMatchesRef: debug.DynamicConfidenceMatchesRef,
			wardTypeValues: WARD_TYPE_VALUES,
			wardTeamOptionValues: WARD_TEAM_OPTION_VALUES,
			descriptionPresets: DESCRIPTION_PRESETS,
			defaultWardDescription: DEFAULT_WARD_DESCRIPTION,
			remoteSourceKeys: REMOTE_SOURCE_KEYS,
			debugModel: this.debugModel
		})

		this.IconSize = main.IconSize
		this.TooltipSize = main.TooltipSize
		this.RemoteSource = main.RemoteSource
		this.TeamFilter = main.TeamFilter
		this.HidePlacedWards = main.HidePlacedWards
		this.OnlyAlt = main.OnlyAlt
		this.PlaceHelper = main.PlaceHelper
		this.PlaceBind = main.PlaceBind
		this.Debug = main.Debug

		this.ShowOnMinimap = debug.ShowOnMinimap
		this.LegacyMinimapCoordinates = debug.LegacyMinimapCoordinates
		this.UseTowerStateFilter = debug.UseTowerStateFilter
		this.DynamicAdaptiveSpacing = debug.DynamicAdaptiveSpacing
		this.DynamicTopPerType = debug.DynamicTopPerType
		this.DynamicExcludeRiskyObserver = debug.DynamicExcludeRiskyObserver
		this.DynamicMinCellDistanceTenths = debug.DynamicMinCellDistanceTenths
		this.DynamicMinMinimapDistanceTenths = debug.DynamicMinMinimapDistanceTenths
		this.DynamicRegionQuota = debug.DynamicRegionQuota
		this.DynamicRegionSize = debug.DynamicRegionSize
		this.DynamicLaneQuotaMin = debug.DynamicLaneQuotaMin
		this.DynamicLaneQuotaUse = debug.DynamicLaneQuotaUse
		this.DynamicLaneBand = debug.DynamicLaneBand
		this.DynamicDedupeRadius3D = debug.DynamicDedupeRadius3D
		this.DynamicTowerFitWeightTenths = debug.DynamicTowerFitWeightTenths
		this.DynamicMinTowerFitPercent = debug.DynamicMinTowerFitPercent
		this.DynamicMinContextSupportPlacements = debug.DynamicMinContextSupportPlacements
		this.DynamicConfidencePlacementsRef = debug.DynamicConfidencePlacementsRef
		this.DynamicConfidenceMatchesRef = debug.DynamicConfidenceMatchesRef
		this.CursorPositionOverlay = debug.CursorPositionOverlay
		this.DebugPhaseOverride = debug.DebugPhaseOverride
		this.DebugPhase = debug.DebugPhase
		this.DebugScenarioPreset = debug.DebugScenarioPreset
		this.DebugLocalTeamOverride = debug.DebugLocalTeamOverride
		this.DebugLocalTeam = debug.DebugLocalTeam
		this.DebugTowerTemplateOverride = debug.DebugTowerTemplateOverride
		this.DebugTowerTemplate = debug.DebugTowerTemplate
		this.DebugAliveTowersOverride = debug.DebugAliveTowersOverride

		this.BuilderMode = builder.BuilderMode
		this.EditRemoteMode = builder.EditRemoteMode
		this.EditRemotePlaceBind = builder.EditRemotePlaceBind
		this.SaveRemoteButton = builder.SaveRemoteButton
		this.WardType = builder.WardType
		this.TeamType = builder.TeamType
		this.ShowCustomWards = builder.ShowCustomWards
		this.AddWardBind = builder.AddWardBind
		this.WardList = builder.WardList
		this.DescriptionPreset = builder.DescriptionPreset
		this.ClearAllButton = builder.ClearAllButton
		this.SaveCustomButton = builder.SaveCustomButton
		this.ShowInfoButton = builder.ShowInfoButton
		this.ApplyDescriptionButton = builder.ApplyDescriptionButton
		this.DeleteWardButton = builder.DeleteWardButton
		this.DuplicateWardButton = builder.DuplicateWardButton
		this.ExportButton = builder.ExportButton
		this.wardStats = builder.wardStats
		this.selectedWardDescription = builder.selectedWardDescription

		this.PlaceBind.OnPressed(() => {
			this.requestPlaceWard = true
		})
		this.AddWardBind.OnPressed(() => {
			this.requestAddWard = true
		})
		this.EditRemotePlaceBind.OnPressed(() => {
			this.requestEditRemotePlace = true
		})

		this.WardList.OnValue(() => {
			this.requestSyncSelectedWard = true
		})

		this.ClearAllButton.OnValue(() => {
			this.requestClearAll = true
		})
		this.SaveCustomButton.OnValue(() => {
			this.requestSaveCustom = true
		})
		this.ShowInfoButton.OnValue(() => {
			this.requestShowInfo = true
		})
		this.ApplyDescriptionButton.OnValue(() => {
			this.requestApplyDescription = true
		})
		this.DeleteWardButton.OnValue(() => {
			this.requestDeleteWard = true
		})
		this.DuplicateWardButton.OnValue(() => {
			this.requestDuplicateWard = true
		})
		this.ExportButton.OnValue(() => {
			this.requestExport = true
		})
		this.SaveRemoteButton.OnValue(() => {
			this.requestSaveRemote = true
		})

		this.State.OnValue(toggle => {
			this.setMainVisibility(toggle.value)
		})
		this.PlaceHelper.OnValue(toggle => {
			this.PlaceBind.IsHidden = !toggle.value
		})
		this.EditRemoteMode.OnValue(toggle => {
			this.EditRemotePlaceBind.IsHidden = !toggle.value
			this.SaveRemoteButton.IsHidden = !toggle.value
		})
		this.Debug.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})
		this.DebugPhaseOverride.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})
		this.DebugScenarioPreset.OnValue(() => {
			this.ApplyDebugScenarioPreset()
			this.UpdateDebugControlsVisibility()
		})
		this.DebugLocalTeamOverride.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})
		this.DebugAliveTowersOverride.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})
		this.DebugTowerTemplateOverride.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})
		debug.DebugAdvanced.OnValue(() => {
			this.UpdateDebugControlsVisibility()
		})

		this.UpdateDebugControlsVisibility()
	}

	public get SelectedWardID() {
		return this.readModel.SelectedWardID
	}

	public get SelectedWardType(): WardType {
		return this.readModel.SelectedWardType
	}

	public get SelectedTeam(): WardTeamOption {
		return this.readModel.SelectedTeam
	}

	public get SelectedDescription() {
		return this.readModel.SelectedDescription
	}

	public get SelectedRemoteSource(): RemoteSourceKey {
		return this.readModel.SelectedRemoteSource
	}

	public get DynamicMinCellDistance(): number {
		return this.readModel.DynamicMinCellDistance
	}

	public get DynamicMinMinimapDistance(): number {
		return this.readModel.DynamicMinMinimapDistance
	}

	public get DynamicTowerFitWeight(): number {
		return this.readModel.DynamicTowerFitWeight
	}

	public get DynamicAdaptiveSpacingEnabled(): boolean {
		return this.readModel.DynamicAdaptiveSpacing
	}

	public get DynamicRegionQuotaValue(): number {
		return this.readModel.DynamicRegionQuotaValue
	}

	public get DynamicRegionSizeValue(): number {
		return this.readModel.DynamicRegionSizeValue
	}

	public get DynamicLaneQuotaMinValue(): number {
		return this.readModel.DynamicLaneQuotaMinValue
	}

	public get DynamicLaneQuotaUseValue(): "own" | "enemy" | "both" {
		return this.readModel.DynamicLaneQuotaUseValue
	}

	public get DynamicLaneBandValue(): number {
		return this.readModel.DynamicLaneBandValue
	}

	public get DynamicDedupeRadius3DValue(): number {
		return this.readModel.DynamicDedupeRadius3DValue
	}

	public get DynamicMinTowerFit(): number {
		return this.readModel.DynamicMinTowerFit
	}

	public get DynamicMinContextSupportPlacementsValue(): number {
		return this.readModel.DynamicMinContextSupportPlacementsValue
	}

	public get DynamicConfidencePlacementsRefValue(): number {
		return this.readModel.DynamicConfidencePlacementsRefValue
	}

	public get DynamicConfidenceMatchesRefValue(): number {
		return this.readModel.DynamicConfidenceMatchesRefValue
	}

	public get DebugForcedTimeBucket(): string | undefined {
		return this.readModel.DebugForcedTimeBucket
	}

	public get DebugForcedLocalTeam(): WardTeam | undefined {
		return this.readModel.DebugForcedLocalTeam
	}

	public get DebugAliveTowerOverrideEnabled(): boolean {
		return this.readModel.DebugAliveTowerOverrideEnabled
	}

	public get DebugTowerTemplateOverrideEnabled(): boolean {
		return this.readModel.DebugTowerTemplateOverrideEnabled
	}

	public get DebugMissingOwnTowersFromTemplate(): string[] {
		return this.readModel.DebugMissingOwnTowersFromTemplate
	}

	public get DebugMissingEnemyTowersFromTemplate(): string[] {
		return this.readModel.DebugMissingEnemyTowersFromTemplate
	}

	public get DebugAliveOwnTowers(): string[] {
		return this.readModel.DebugAliveOwnTowers
	}

	public get DebugAliveEnemyTowers(): string[] {
		return this.readModel.DebugAliveEnemyTowers
	}

	public get TeamsForNewWard(): WardTeam[] {
		const selectedTeam = this.SelectedTeam
		if (selectedTeam === WardTeamOptions.Both) {
			return [...WARD_TEAM_VALUES]
		}
		return [selectedTeam]
	}

	public SetWardListOptions(options: string[], selectedID: number) {
		const safeOptions = options.length === 0 ? ["No wards available"] : options
		this.WardList.InternalValuesNames = safeOptions
		this.WardList.SelectedID = Math.max(
			0,
			Math.min(selectedID, safeOptions.length - 1)
		)
		this.WardList.Update()
	}

	public SetWardStats(text: string) {
		this.wardStats.InternalName = text
		this.wardStats.Update()
	}

	public SetRemoteWardStats(text: string) {
		this.remoteWardStats.InternalName = text
		this.remoteWardStats.Update()
	}

	public SetSelectedWardDescription(description: string) {
		this.selectedWardDescription.InternalName = `Selected: ${description}`
		this.selectedWardDescription.Update()
	}

	public ConsumeAddWardRequest() {
		const current = this.requestAddWard
		this.requestAddWard = false
		return current
	}

	public ConsumePlaceWardRequest() {
		const current = this.requestPlaceWard
		this.requestPlaceWard = false
		return current
	}

	public ConsumeClearAllRequest() {
		const current = this.requestClearAll
		this.requestClearAll = false
		return current
	}

	public ConsumeSaveCustomRequest() {
		const current = this.requestSaveCustom
		this.requestSaveCustom = false
		return current
	}

	public ConsumeShowInfoRequest() {
		const current = this.requestShowInfo
		this.requestShowInfo = false
		return current
	}

	public ConsumeApplyDescriptionRequest() {
		const current = this.requestApplyDescription
		this.requestApplyDescription = false
		return current
	}

	public ConsumeDeleteWardRequest() {
		const current = this.requestDeleteWard
		this.requestDeleteWard = false
		return current
	}

	public ConsumeDuplicateWardRequest() {
		const current = this.requestDuplicateWard
		this.requestDuplicateWard = false
		return current
	}

	public ConsumeExportRequest() {
		const current = this.requestExport
		this.requestExport = false
		return current
	}

	public ConsumeSyncSelectedWardRequest() {
		const current = this.requestSyncSelectedWard
		this.requestSyncSelectedWard = false
		return current
	}

	public ConsumeEditRemotePlaceRequest() {
		const current = this.requestEditRemotePlace
		this.requestEditRemotePlace = false
		return current
	}

	public ConsumeSaveRemoteRequest() {
		const current = this.requestSaveRemote
		this.requestSaveRemote = false
		return current
	}

	private setMainVisibility(enabled: boolean) {
		const hidden = !enabled
		this.IconSize.IsHidden = hidden
		this.TooltipSize.IsHidden = hidden
		this.RemoteSource.IsHidden = hidden
		this.TeamFilter.IsHidden = hidden
		this.HidePlacedWards.IsHidden = hidden
		this.OnlyAlt.IsHidden = hidden
		this.PlaceHelper.IsHidden = hidden
		this.PlaceBind.IsHidden = hidden || !this.PlaceHelper.value
		this.Debug.IsHidden = hidden
		this.EditRemoteMode.IsHidden = hidden
		this.EditRemotePlaceBind.IsHidden = hidden || !this.EditRemoteMode.value
		this.SaveRemoteButton.IsHidden = hidden || !this.EditRemoteMode.value
		this.UpdateDebugControlsVisibility()
	}

	private ApplyDebugScenarioPreset() {
		const preset = DEBUG_SCENARIO_PRESETS[this.DebugScenarioPreset.SelectedID]
		if (preset === undefined || this.DebugScenarioPreset.SelectedID === 0) {
			return
		}
		if (DEFAULT_REMOTE_SOURCE_INDEX >= 0) {
			this.RemoteSource.SelectedID = DEFAULT_REMOTE_SOURCE_INDEX
			this.RemoteSource.Update()
		}

		if (preset.phaseBucket !== undefined) {
			const phaseID = DEBUG_PHASE_BUCKETS.indexOf(preset.phaseBucket)
			if (phaseID >= 0) {
				this.DebugPhaseOverride.value = true
				this.DebugPhase.SelectedID = phaseID
				this.DebugPhase.Update()
			}
		}

		if (preset.towerTemplateId !== undefined) {
			this.DebugTowerTemplateOverride.value = true
			this.DebugTowerTemplate.SelectedID = preset.towerTemplateId
			this.DebugTowerTemplate.Update()
		}

		if (preset.useTowerStateFilter !== undefined) {
			this.UseTowerStateFilter.value = preset.useTowerStateFilter
		}

		if (preset.localTeam !== undefined) {
			this.DebugLocalTeamOverride.value = true
			this.DebugLocalTeam.SelectedID =
				preset.localTeam === WardTeams.Radiant ? 1 : 2
			this.DebugLocalTeam.Update()
		}
	}

	private UpdateDebugControlsVisibility() {
		this.debugModel.applyVisibility(!this.State.value || !this.Debug.value)
	}
}

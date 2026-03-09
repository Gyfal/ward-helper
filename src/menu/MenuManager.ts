import { ImageData, Menu } from "github.com/octarine-public/wrapper/index"

import {
	DEFAULT_WARD_DESCRIPTION,
	WARD_TEAM_OPTION_VALUES,
	WARD_TEAM_VALUES,
	WARD_TYPE_VALUES,
	WardTeam,
	WardTeamOption,
	WardTeamOptions,
	WardType
} from "../model/WardTypes"
import { createBuilderSection } from "./sections/builder"
import { createMainSection } from "./sections/main"
import { createSettingsSection } from "./sections/settings"

const DESCRIPTION_PRESETS = [
	DEFAULT_WARD_DESCRIPTION,
	"Aggressive cliff",
	"Defensive vision",
	"Roshan control",
	"Smoke break"
]
interface TestPresetDefinition {
	label: string
	timeBucket: string
}
// Debug override: force a time bucket so late-game recommendations can be
// inspected in-game without waiting. Buckets match build_ward_reco_runtime.py.
const TEST_PRESETS: readonly TestPresetDefinition[] = [
	{ label: "0-12 min", timeBucket: "0_12" },
	{ label: "12-25 min", timeBucket: "12_25" },
	{ label: "25-50 min", timeBucket: "25_50" },
	{ label: "50+ min", timeBucket: "50_plus" }
]
const TEST_PRESET_LABELS: readonly string[] = TEST_PRESETS.map(preset => preset.label)

export type MenuRequest =
	| "addWard"
	| "placeWard"
	| "clearAll"
	| "saveCustom"
	| "showInfo"
	| "applyDescription"
	| "deleteWard"
	| "duplicateWard"
	| "export"
	| "syncSelectedWard"
	| "editRemotePlace"
	| "saveRemote"

export class MenuManager {
	public readonly State: Menu.Toggle

	public readonly IconSize: Menu.Slider
	public readonly TooltipSize: Menu.Slider
	public readonly ShowOnMinimap: Menu.Toggle
	public readonly TeamFilter: Menu.Toggle
	public readonly TestPresetEnabled: Menu.Toggle
	public readonly TestPreset: Menu.Dropdown
	public readonly TestLocalTeam: Menu.Dropdown
	public readonly DynamicAdaptiveSpacing: Menu.Toggle
	public readonly DynamicTopPerType: Menu.Slider
	public readonly DynamicExcludeRiskyObserver: Menu.Toggle
	public readonly DynamicMinCellDistanceTenths: Menu.Slider
	public readonly DynamicMinMinimapDistanceTenths: Menu.Slider
	public readonly DynamicRegionQuota: Menu.Slider
	public readonly DynamicAutoRegionSize: Menu.Toggle
	public readonly DynamicRegionSize: Menu.Slider
	public readonly DynamicDedupeRadius3D: Menu.Slider
	public readonly HidePlacedWards: Menu.Toggle
	public readonly OnlyAlt: Menu.Toggle
	public readonly PlaceHelper: Menu.Toggle
	public readonly PlaceBind: Menu.KeyBind

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

	// Seeded with syncSelectedWard so the description line is filled on startup.
	private readonly pending = new Set<MenuRequest>(["syncSelectedWard"])

	private readonly baseNode = Menu.AddEntry("Visual")
	private readonly tree = this.baseNode.AddNode(
		"Ward tracker",
		ImageData.Icons.icon_ward
	)
	private readonly mainTree = this.tree.AddNode("Main")
	private readonly builderTree = this.tree.AddNode("Builder")
	private readonly settingsTree = this.tree.AddNode("Settings")
	private readonly remoteWardStats = this.mainTree.AddShortDescription(
		"Loaded remote wards: 0"
	)
	private readonly wardStats: Menu.ShortDescription
	private readonly selectedWardDescription: Menu.ShortDescription

	constructor() {
		this.tree.SortNodes = false
		this.mainTree.SortNodes = false
		this.builderTree.SortNodes = false
		this.settingsTree.SortNodes = false
		this.State = this.tree.AddToggle("State", true)

		const main = createMainSection(this.mainTree)
		const builder = createBuilderSection(this.builderTree, DESCRIPTION_PRESETS)
		const settings = createSettingsSection(this.settingsTree, TEST_PRESET_LABELS)

		this.IconSize = main.IconSize
		this.TooltipSize = main.TooltipSize
		this.TeamFilter = main.TeamFilter
		this.HidePlacedWards = main.HidePlacedWards
		this.OnlyAlt = main.OnlyAlt
		this.PlaceHelper = main.PlaceHelper
		this.PlaceBind = main.PlaceBind

		this.ShowOnMinimap = settings.ShowOnMinimap
		this.TestPresetEnabled = settings.TestPresetEnabled
		this.TestPreset = settings.TestPreset
		this.TestLocalTeam = settings.TestLocalTeam
		this.DynamicAdaptiveSpacing = settings.DynamicAdaptiveSpacing
		this.DynamicTopPerType = settings.DynamicTopPerType
		this.DynamicExcludeRiskyObserver = settings.DynamicExcludeRiskyObserver
		this.DynamicMinCellDistanceTenths = settings.DynamicMinCellDistanceTenths
		this.DynamicMinMinimapDistanceTenths = settings.DynamicMinMinimapDistanceTenths
		this.DynamicRegionQuota = settings.DynamicRegionQuota
		this.DynamicAutoRegionSize = settings.DynamicAutoRegionSize
		this.DynamicRegionSize = settings.DynamicRegionSize
		this.DynamicDedupeRadius3D = settings.DynamicDedupeRadius3D

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

		const binds: [Menu.KeyBind, MenuRequest][] = [
			[this.PlaceBind, "placeWard"],
			[this.AddWardBind, "addWard"],
			[this.EditRemotePlaceBind, "editRemotePlace"]
		]
		for (const [bind, request] of binds) {
			bind.OnPressed(() => this.pending.add(request))
		}

		const buttons: [Menu.Button, MenuRequest][] = [
			[this.ClearAllButton, "clearAll"],
			[this.SaveCustomButton, "saveCustom"],
			[this.ShowInfoButton, "showInfo"],
			[this.ApplyDescriptionButton, "applyDescription"],
			[this.DeleteWardButton, "deleteWard"],
			[this.DuplicateWardButton, "duplicateWard"],
			[this.ExportButton, "export"],
			[this.SaveRemoteButton, "saveRemote"]
		]
		for (const [button, request] of buttons) {
			button.OnValue(() => this.pending.add(request))
		}

		this.WardList.OnValue(() => this.pending.add("syncSelectedWard"))

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
		this.TestPresetEnabled.OnValue(() => {
			this.setSettingsVisibility(!this.State.value)
		})
		this.setSettingsVisibility(!this.State.value)
	}

	public Consume(request: MenuRequest): boolean {
		return this.pending.delete(request)
	}

	public get SelectedWardID() {
		return this.WardList.SelectedID
	}

	public get SelectedWardType(): WardType {
		return WARD_TYPE_VALUES[this.WardType.SelectedID] ?? WARD_TYPE_VALUES[0]
	}

	public get SelectedTeam(): WardTeamOption {
		return WARD_TEAM_OPTION_VALUES[this.TeamType.SelectedID] ?? WardTeamOptions.Both
	}

	public get SelectedDescription() {
		return (
			DESCRIPTION_PRESETS[this.DescriptionPreset.SelectedID] ??
			DEFAULT_WARD_DESCRIPTION
		)
	}

	public get DynamicMinCellDistance(): number {
		return this.DynamicMinCellDistanceTenths.value / 10
	}

	public get DynamicMinMinimapDistance(): number {
		return this.DynamicMinMinimapDistanceTenths.value / 10
	}

	public get TestForcedLocalTeam(): WardTeam | undefined {
		if (!this.hasTestPresetOverrides) {
			return undefined
		}
		if (this.TestLocalTeam.SelectedID === 1) {
			return WardTeamOptions.Radiant
		}
		if (this.TestLocalTeam.SelectedID === 2) {
			return WardTeamOptions.Dire
		}
		return undefined
	}

	public get TestForcedTimeBucket(): string | undefined {
		if (!this.hasTestPresetOverrides) {
			return undefined
		}
		return TEST_PRESETS[this.TestPreset.SelectedID]?.timeBucket
	}

	public get TeamsForNewWard(): WardTeam[] {
		const selectedTeam = this.SelectedTeam
		if (selectedTeam === WardTeamOptions.Both) {
			return [...WARD_TEAM_VALUES]
		}
		return [selectedTeam]
	}

	public SetWardListOptions(options: string[], selectedID: number) {
		this.WardList.InternalValuesNames = options
		this.WardList.SelectedID = selectedID
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

	private get hasTestPresetOverrides(): boolean {
		return this.TestPresetEnabled.value && this.TestPreset.SelectedID >= 0
	}

	private setMainVisibility(enabled: boolean) {
		const hidden = !enabled
		this.IconSize.IsHidden = hidden
		this.TooltipSize.IsHidden = hidden
		this.TeamFilter.IsHidden = hidden
		this.HidePlacedWards.IsHidden = hidden
		this.OnlyAlt.IsHidden = hidden
		this.PlaceHelper.IsHidden = hidden
		this.PlaceBind.IsHidden = hidden || !this.PlaceHelper.value
		this.EditRemoteMode.IsHidden = hidden
		this.EditRemotePlaceBind.IsHidden = hidden || !this.EditRemoteMode.value
		this.SaveRemoteButton.IsHidden = hidden || !this.EditRemoteMode.value
		this.setSettingsVisibility(hidden)
	}

	private setSettingsVisibility(hidden: boolean) {
		this.ShowOnMinimap.IsHidden = hidden
		this.TestPresetEnabled.IsHidden = hidden
		this.TestPreset.IsHidden = hidden || !this.TestPresetEnabled.value
		this.TestLocalTeam.IsHidden = hidden || !this.TestPresetEnabled.value
		this.DynamicAdaptiveSpacing.IsHidden = hidden
		this.DynamicTopPerType.IsHidden = hidden
		this.DynamicExcludeRiskyObserver.IsHidden = hidden
		this.DynamicMinCellDistanceTenths.IsHidden = hidden
		this.DynamicMinMinimapDistanceTenths.IsHidden = hidden
		this.DynamicRegionQuota.IsHidden = hidden
		this.DynamicAutoRegionSize.IsHidden = hidden
		this.DynamicRegionSize.IsHidden = hidden
		this.DynamicDedupeRadius3D.IsHidden = hidden
	}
}

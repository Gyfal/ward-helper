import { Menu } from "github.com/octarine-public/wrapper/index"

import { RemoteSourceKey } from "../../model/RemoteSources"
import { WardTeam, WardTeamOption, WardTeams, WardType } from "../../model/WardTypes"
import {
	DEBUG_PHASE_BUCKETS,
	DEBUG_PHASE_VALUES,
	DEBUG_TOWER_ALIVE_KEYS,
	DebugTowerAliveKey
} from "../constants"

export const DEBUG_TOWER_TEMPLATE_VALUES = [
	"None",
	"Own top: no T1/T2/T3",
	"Own mid: no T1/T2/T3",
	"Own bot: no T1/T2/T3",
	"Enemy top: no T1/T2/T3",
	"Enemy mid: no T1/T2/T3",
	"Enemy bot: no T1/T2/T3",
	"Own top+mid: no T1/T2/T3",
	"Own top+bot: no T1/T2/T3",
	"Own mid+bot: no T1/T2/T3",
	"Enemy top+mid: no T1/T2/T3",
	"Enemy top+bot: no T1/T2/T3",
	"Enemy mid+bot: no T1/T2/T3",
	"Both top: no T1/T2/T3",
	"Both mid: no T1/T2/T3",
	"Both bot: no T1/T2/T3",
	"Both all lanes: no T1/T2/T3",
	"Own bot T2+T3",
	"Own top T2+T3",
	"Own mid T2+T3",
	"Own all T2+T3",
	"Enemy bot T2+T3",
	"Enemy top T2+T3",
	"Enemy mid T2+T3",
	"Enemy all T2+T3",
	"Own bot T2+T3 + Enemy top T2"
] as const

export const DEBUG_TOWER_TEMPLATE_IDS = {
	None: 0,
	OwnTop123: 1,
	OwnMid123: 2,
	OwnBot123: 3,
	EnemyTop123: 4,
	EnemyMid123: 5,
	EnemyBot123: 6,
	OwnTopMid123: 7,
	OwnTopBot123: 8,
	OwnMidBot123: 9,
	EnemyTopMid123: 10,
	EnemyTopBot123: 11,
	EnemyMidBot123: 12,
	BothTop123: 13,
	BothMid123: 14,
	BothBot123: 15,
	BothAll123: 16,
	OwnBot23: 17,
	OwnTop23: 18,
	OwnMid23: 19,
	OwnAll23: 20,
	EnemyBot23: 21,
	EnemyTop23: 22,
	EnemyMid23: 23,
	EnemyAll23: 24,
	OwnBot23EnemyTop2: 25
} as const

const DEBUG_LOCAL_TEAM_VALUES = ["Auto", "Radiant", "Dire"] as const

const QUICK_SCENARIO_PHASES = ["0_10", "10_20", "20_35", "35_50", "50_plus"] as const

type QuickScenarioPhase = (typeof QUICK_SCENARIO_PHASES)[number]
type QuickScenarioTeam = "radiant" | "dire"

export interface DebugScenarioPreset {
	label: string
	phaseBucket?: QuickScenarioPhase
	towerTemplateId?: number
	localTeam?: WardTeam
	useTowerStateFilter?: boolean
}

function buildPhaseScenarioPresets(
	tag: string,
	templateId: number,
	useTowerStateFilter: boolean
): DebugScenarioPreset[] {
	const out: DebugScenarioPreset[] = []
	for (let i = 0; i < QUICK_SCENARIO_PHASES.length; i++) {
		const phase = QUICK_SCENARIO_PHASES[i]
		out.push(
			makeScenarioPreset(phase, tag, "radiant", templateId, useTowerStateFilter),
			makeScenarioPreset(phase, tag, "dire", templateId, useTowerStateFilter)
		)
	}
	return out
}

function makeScenarioPreset(
	phase: QuickScenarioPhase,
	tag: string,
	team: QuickScenarioTeam,
	templateId: number,
	useTowerStateFilter: boolean
): DebugScenarioPreset {
	const isRadiant = team === "radiant"
	return {
		label: `Example: ${phase} ${tag} (${isRadiant ? "Radiant" : "Dire"})`,
		phaseBucket: phase,
		towerTemplateId: templateId,
		localTeam: isRadiant ? WardTeams.Radiant : WardTeams.Dire,
		useTowerStateFilter
	}
}

export const DEBUG_SCENARIO_PRESETS: readonly DebugScenarioPreset[] = [
	{ label: "None" },
	...buildPhaseScenarioPresets("baseline", DEBUG_TOWER_TEMPLATE_IDS.None, false),
	...buildPhaseScenarioPresets("own_mid23", DEBUG_TOWER_TEMPLATE_IDS.OwnMid23, true),
	...buildPhaseScenarioPresets(
		"both_all123",
		DEBUG_TOWER_TEMPLATE_IDS.BothAll123,
		true
	),
	...buildPhaseScenarioPresets(
		"own_bot23_enemy_top2",
		DEBUG_TOWER_TEMPLATE_IDS.OwnBot23EnemyTop2,
		true
	)
]

const DEBUG_SCENARIO_VALUES = DEBUG_SCENARIO_PRESETS.map(preset => preset.label)

const DEBUG_TOWER_TEMPLATE_PRESETS: readonly {
	own: string[]
	enemy: string[]
}[] = [
	{ own: [], enemy: [] },
	{ own: ["top_t1", "top_t2", "top_t3"], enemy: [] },
	{ own: ["mid_t1", "mid_t2", "mid_t3"], enemy: [] },
	{ own: ["bot_t1", "bot_t2", "bot_t3"], enemy: [] },
	{ own: [], enemy: ["top_t1", "top_t2", "top_t3"] },
	{ own: [], enemy: ["mid_t1", "mid_t2", "mid_t3"] },
	{ own: [], enemy: ["bot_t1", "bot_t2", "bot_t3"] },
	{ own: ["top_t1", "top_t2", "top_t3", "mid_t1", "mid_t2", "mid_t3"], enemy: [] },
	{ own: ["top_t1", "top_t2", "top_t3", "bot_t1", "bot_t2", "bot_t3"], enemy: [] },
	{ own: ["mid_t1", "mid_t2", "mid_t3", "bot_t1", "bot_t2", "bot_t3"], enemy: [] },
	{ own: [], enemy: ["top_t1", "top_t2", "top_t3", "mid_t1", "mid_t2", "mid_t3"] },
	{ own: [], enemy: ["top_t1", "top_t2", "top_t3", "bot_t1", "bot_t2", "bot_t3"] },
	{ own: [], enemy: ["mid_t1", "mid_t2", "mid_t3", "bot_t1", "bot_t2", "bot_t3"] },
	{ own: ["top_t1", "top_t2", "top_t3"], enemy: ["top_t1", "top_t2", "top_t3"] },
	{ own: ["mid_t1", "mid_t2", "mid_t3"], enemy: ["mid_t1", "mid_t2", "mid_t3"] },
	{ own: ["bot_t1", "bot_t2", "bot_t3"], enemy: ["bot_t1", "bot_t2", "bot_t3"] },
	{
		own: [
			"top_t1",
			"top_t2",
			"top_t3",
			"mid_t1",
			"mid_t2",
			"mid_t3",
			"bot_t1",
			"bot_t2",
			"bot_t3"
		],
		enemy: [
			"top_t1",
			"top_t2",
			"top_t3",
			"mid_t1",
			"mid_t2",
			"mid_t3",
			"bot_t1",
			"bot_t2",
			"bot_t3"
		]
	},
	{ own: ["bot_t2", "bot_t3"], enemy: [] },
	{ own: ["top_t2", "top_t3"], enemy: [] },
	{ own: ["mid_t2", "mid_t3"], enemy: [] },
	{ own: ["bot_t2", "bot_t3", "mid_t2", "mid_t3", "top_t2", "top_t3"], enemy: [] },
	{ own: [], enemy: ["bot_t2", "bot_t3"] },
	{ own: [], enemy: ["top_t2", "top_t3"] },
	{ own: [], enemy: ["mid_t2", "mid_t3"] },
	{ own: [], enemy: ["bot_t2", "bot_t3", "mid_t2", "mid_t3", "top_t2", "top_t3"] },
	{ own: ["bot_t2", "bot_t3"], enemy: ["top_t2"] }
]

export interface DebugSectionControls {
	ShowOnMinimap: Menu.Toggle
	LegacyMinimapCoordinates: Menu.Toggle
	UseTowerStateFilter: Menu.Toggle
	DebugAdvanced: Menu.Toggle
	DynamicAdaptiveSpacing: Menu.Toggle
	DynamicTopPerType: Menu.Slider
	DynamicExcludeRiskyObserver: Menu.Toggle
	DynamicMinCellDistanceTenths: Menu.Slider
	DynamicMinMinimapDistanceTenths: Menu.Slider
	DynamicRegionQuota: Menu.Slider
	DynamicRegionSize: Menu.Slider
	DynamicLaneQuotaMin: Menu.Slider
	DynamicLaneQuotaUse: Menu.Dropdown
	DynamicLaneBand: Menu.Slider
	DynamicDedupeRadius3D: Menu.Slider
	DynamicTowerFitWeightTenths: Menu.Slider
	DynamicMinTowerFitPercent: Menu.Slider
	DynamicMinContextSupportPlacements: Menu.Slider
	DynamicConfidencePlacementsRef: Menu.Slider
	DynamicConfidenceMatchesRef: Menu.Slider
	CursorPositionOverlay: Menu.Toggle
	DebugPhaseOverride: Menu.Toggle
	DebugPhase: Menu.Dropdown
	DebugScenarioPreset: Menu.Dropdown
	DebugLocalTeamOverride: Menu.Toggle
	DebugLocalTeam: Menu.Dropdown
	DebugTowerTemplateOverride: Menu.Toggle
	DebugTowerTemplate: Menu.Dropdown
	DebugAliveTowersOverride: Menu.Toggle
	debugAliveOwnToggles: Map<DebugTowerAliveKey, Menu.Toggle>
	debugAliveEnemyToggles: Map<DebugTowerAliveKey, Menu.Toggle>
}

export function createDebugSection(debugTree: any): DebugSectionControls {
	const debugAliveTree = debugTree.AddNode("Alive towers")
	debugAliveTree.SortNodes = false
	const aliveByTierNodes = {
		t1: debugAliveTree.AddNode("T1"),
		t2: debugAliveTree.AddNode("T2"),
		t3: debugAliveTree.AddNode("T3"),
		t4: debugAliveTree.AddNode("T4")
	}
	aliveByTierNodes.t1.SortNodes = false
	aliveByTierNodes.t2.SortNodes = false
	aliveByTierNodes.t3.SortNodes = false
	aliveByTierNodes.t4.SortNodes = false

	const debugAliveOwnToggles = new Map<DebugTowerAliveKey, Menu.Toggle>()
	const debugAliveEnemyToggles = new Map<DebugTowerAliveKey, Menu.Toggle>()
	const laneNodesByTier = {
		t1: {
			top: aliveByTierNodes.t1.AddNode("Top"),
			mid: aliveByTierNodes.t1.AddNode("Mid"),
			bot: aliveByTierNodes.t1.AddNode("Bot")
		},
		t2: {
			top: aliveByTierNodes.t2.AddNode("Top"),
			mid: aliveByTierNodes.t2.AddNode("Mid"),
			bot: aliveByTierNodes.t2.AddNode("Bot")
		},
		t3: {
			top: aliveByTierNodes.t3.AddNode("Top"),
			mid: aliveByTierNodes.t3.AddNode("Mid"),
			bot: aliveByTierNodes.t3.AddNode("Bot")
		},
		t4: {
			top: aliveByTierNodes.t4.AddNode("Top"),
			mid: aliveByTierNodes.t4.AddNode("Mid"),
			bot: aliveByTierNodes.t4.AddNode("Bot")
		}
	}
	laneNodesByTier.t1.top.SortNodes = false
	laneNodesByTier.t1.mid.SortNodes = false
	laneNodesByTier.t1.bot.SortNodes = false
	laneNodesByTier.t2.top.SortNodes = false
	laneNodesByTier.t2.mid.SortNodes = false
	laneNodesByTier.t2.bot.SortNodes = false
	laneNodesByTier.t3.top.SortNodes = false
	laneNodesByTier.t3.mid.SortNodes = false
	laneNodesByTier.t3.bot.SortNodes = false
	laneNodesByTier.t4.top.SortNodes = false
	laneNodesByTier.t4.mid.SortNodes = false
	laneNodesByTier.t4.bot.SortNodes = false

	const controls: DebugSectionControls = {
		ShowOnMinimap: debugTree.AddToggle("Minimap marks", true),
		LegacyMinimapCoordinates: debugTree.AddToggle("Legacy minimap", true),
		UseTowerStateFilter: debugTree.AddToggle("Tower filter", false),
		DebugAdvanced: debugTree.AddToggle("Advanced debug", false),
		DynamicAdaptiveSpacing: debugTree.AddToggle("Adaptive spacing", true),
		DynamicTopPerType: debugTree.AddSlider("Top spots per type", 10, 1, 30),
		DynamicExcludeRiskyObserver: debugTree.AddToggle("Hide risky obs", true),
		DynamicMinCellDistanceTenths: debugTree.AddSlider(
			"Min cell dist x0.1",
			15,
			0,
			60
		),
		DynamicMinMinimapDistanceTenths: debugTree.AddSlider(
			"Min map dist x0.1",
			25,
			0,
			100
		),
		DynamicRegionQuota: debugTree.AddSlider("Region quota", 3, 0, 8),
		DynamicRegionSize: debugTree.AddSlider("Region size", 42, 8, 96),
		DynamicLaneQuotaMin: debugTree.AddSlider("Lane quota min", 2, 0, 6),
		DynamicLaneQuotaUse: debugTree.AddDropdown("Lane quota use", [
			"Own",
			"Enemy",
			"Both"
		]),
		DynamicLaneBand: debugTree.AddSlider("Lane band", 18, 4, 64),
		DynamicDedupeRadius3D: debugTree.AddSlider("3D dedupe radius", 500, 0, 2000),
		DynamicTowerFitWeightTenths: debugTree.AddSlider(
			"Tower fit weight x0.1",
			15,
			0,
			50
		),
		DynamicMinTowerFitPercent: debugTree.AddSlider("Min tower fit %", 20, 0, 100),
		DynamicMinContextSupportPlacements: debugTree.AddSlider(
			"Min support placements",
			12,
			0,
			120
		),
		DynamicConfidencePlacementsRef: debugTree.AddSlider(
			"Conf placements ref",
			30,
			1,
			200
		),
		DynamicConfidenceMatchesRef: debugTree.AddSlider("Conf matches ref", 20, 1, 200),
		CursorPositionOverlay: debugTree.AddToggle("Cursor debug", true),
		DebugPhaseOverride: debugTree.AddToggle("Phase override", false),
		DebugPhase: debugTree.AddDropdown("Phase", [...DEBUG_PHASE_VALUES]),
		DebugScenarioPreset: debugTree.AddDropdown("Quick scenario", [
			...DEBUG_SCENARIO_VALUES
		]),
		DebugLocalTeamOverride: debugTree.AddToggle("Local team override", false),
		DebugLocalTeam: debugTree.AddDropdown("Local team", [...DEBUG_LOCAL_TEAM_VALUES]),
		DebugTowerTemplateOverride: debugTree.AddToggle("Tower template override", false),
		DebugTowerTemplate: debugTree.AddDropdown("Tower template", [
			...DEBUG_TOWER_TEMPLATE_VALUES
		]),
		DebugAliveTowersOverride: debugTree.AddToggle("Alive towers override", false),
		debugAliveOwnToggles,
		debugAliveEnemyToggles
	}

	for (let i = 0; i < DEBUG_TOWER_ALIVE_KEYS.length; i++) {
		const key = DEBUG_TOWER_ALIVE_KEYS[i]
		const [lane, tier] = key.split("_")
		const laneNodes = laneNodesByTier[tier as keyof typeof laneNodesByTier]
		const laneNode = laneNodes[lane as keyof typeof laneNodes]
		debugAliveOwnToggles.set(key, laneNode.AddToggle("Own alive", true))
		debugAliveEnemyToggles.set(key, laneNode.AddToggle("Enemy alive", true))
	}

	return controls
}

export class DebugMenuModel {
	constructor(
		private readonly debugToggle: Menu.Toggle,
		private readonly controls: DebugSectionControls
	) {}

	public get ForcedTimeBucket(): string | undefined {
		if (!this.debugToggle.value || !this.controls.DebugPhaseOverride.value) {
			return undefined
		}
		return DEBUG_PHASE_BUCKETS[this.controls.DebugPhase.SelectedID] || undefined
	}

	public get ForcedLocalTeam(): WardTeam | undefined {
		if (!this.debugToggle.value || !this.controls.DebugLocalTeamOverride.value) {
			return undefined
		}
		if (this.controls.DebugLocalTeam.SelectedID === 1) {
			return WardTeams.Radiant
		}
		if (this.controls.DebugLocalTeam.SelectedID === 2) {
			return WardTeams.Dire
		}
		return undefined
	}

	public get AliveTowerOverrideEnabled(): boolean {
		return (
			this.debugToggle.value &&
			this.controls.DebugAliveTowersOverride.value &&
			!this.controls.DebugTowerTemplateOverride.value
		)
	}

	public get TowerTemplateOverrideEnabled(): boolean {
		return this.debugToggle.value && this.controls.DebugTowerTemplateOverride.value
	}

	public get MissingOwnTowersFromTemplate(): string[] {
		const preset =
			DEBUG_TOWER_TEMPLATE_PRESETS[this.controls.DebugTowerTemplate.SelectedID] ??
			DEBUG_TOWER_TEMPLATE_PRESETS[0]
		return [...preset.own]
	}

	public get MissingEnemyTowersFromTemplate(): string[] {
		const preset =
			DEBUG_TOWER_TEMPLATE_PRESETS[this.controls.DebugTowerTemplate.SelectedID] ??
			DEBUG_TOWER_TEMPLATE_PRESETS[0]
		return [...preset.enemy]
	}

	public get AliveOwnTowers(): string[] {
		return this.collectAliveTowers(this.controls.debugAliveOwnToggles)
	}

	public get AliveEnemyTowers(): string[] {
		return this.collectAliveTowers(this.controls.debugAliveEnemyToggles)
	}

	public applyVisibility(debugRootHidden: boolean) {
		this.controls.ShowOnMinimap.IsHidden = debugRootHidden
		this.controls.LegacyMinimapCoordinates.IsHidden = debugRootHidden
		this.controls.UseTowerStateFilter.IsHidden = debugRootHidden
		this.controls.DebugAdvanced.IsHidden = debugRootHidden
		this.controls.DynamicTopPerType.IsHidden = debugRootHidden
		this.controls.DebugPhaseOverride.IsHidden = debugRootHidden
		this.controls.DebugPhase.IsHidden = debugRootHidden
		this.controls.DebugScenarioPreset.IsHidden = debugRootHidden
		this.controls.DebugLocalTeamOverride.IsHidden = debugRootHidden
		this.controls.DebugLocalTeam.IsHidden =
			debugRootHidden || !this.controls.DebugLocalTeamOverride.value
		this.controls.DebugTowerTemplateOverride.IsHidden = debugRootHidden
		this.controls.DebugTowerTemplate.IsHidden =
			debugRootHidden || !this.controls.DebugTowerTemplateOverride.value
		const advancedHidden = debugRootHidden || !this.controls.DebugAdvanced.value
		this.controls.CursorPositionOverlay.IsHidden = advancedHidden
		this.controls.DynamicAdaptiveSpacing.IsHidden = advancedHidden
		this.controls.DynamicExcludeRiskyObserver.IsHidden = advancedHidden
		this.controls.DynamicMinCellDistanceTenths.IsHidden = advancedHidden
		this.controls.DynamicMinMinimapDistanceTenths.IsHidden = advancedHidden
		this.controls.DynamicRegionQuota.IsHidden = advancedHidden
		this.controls.DynamicRegionSize.IsHidden = advancedHidden
		this.controls.DynamicLaneQuotaMin.IsHidden = advancedHidden
		this.controls.DynamicLaneQuotaUse.IsHidden = advancedHidden
		this.controls.DynamicLaneBand.IsHidden = advancedHidden
		this.controls.DynamicDedupeRadius3D.IsHidden = advancedHidden
		this.controls.DynamicTowerFitWeightTenths.IsHidden = advancedHidden
		this.controls.DynamicMinTowerFitPercent.IsHidden = advancedHidden
		this.controls.DynamicMinContextSupportPlacements.IsHidden = advancedHidden
		this.controls.DynamicConfidencePlacementsRef.IsHidden = advancedHidden
		this.controls.DynamicConfidenceMatchesRef.IsHidden = advancedHidden
		this.controls.DebugAliveTowersOverride.IsHidden = advancedHidden
		const aliveTowersHidden =
			advancedHidden ||
			!this.controls.DebugAliveTowersOverride.value ||
			this.controls.DebugTowerTemplateOverride.value
		for (const toggle of this.controls.debugAliveOwnToggles.values()) {
			toggle.IsHidden = aliveTowersHidden
		}
		for (const toggle of this.controls.debugAliveEnemyToggles.values()) {
			toggle.IsHidden = aliveTowersHidden
		}
	}

	private collectAliveTowers(source: Map<DebugTowerAliveKey, Menu.Toggle>): string[] {
		const out: string[] = []
		for (const [key, toggle] of source.entries()) {
			if (toggle.value) {
				out.push(key)
			}
		}
		return out
	}
}

export interface MenuReadModelConfig {
	wardList: Menu.Dropdown
	wardType: Menu.Dropdown
	teamType: Menu.Dropdown
	descriptionPreset: Menu.Dropdown
	remoteSource: Menu.Dropdown
	dynamicMinCellDistanceTenths: Menu.Slider
	dynamicMinMinimapDistanceTenths: Menu.Slider
	dynamicAdaptiveSpacing: Menu.Toggle
	dynamicRegionQuota: Menu.Slider
	dynamicRegionSize: Menu.Slider
	dynamicLaneQuotaMin: Menu.Slider
	dynamicLaneQuotaUse: Menu.Dropdown
	dynamicLaneBand: Menu.Slider
	dynamicTowerFitWeightTenths: Menu.Slider
	dynamicDedupeRadius3D: Menu.Slider
	dynamicMinTowerFitPercent: Menu.Slider
	dynamicMinContextSupportPlacements: Menu.Slider
	dynamicConfidencePlacementsRef: Menu.Slider
	dynamicConfidenceMatchesRef: Menu.Slider
	wardTypeValues: WardType[]
	wardTeamOptionValues: WardTeamOption[]
	descriptionPresets: readonly string[]
	defaultWardDescription: string
	remoteSourceKeys: readonly RemoteSourceKey[]
	debugModel: DebugMenuModel
}

export class MenuReadModel {
	constructor(private readonly config: MenuReadModelConfig) {}

	public get SelectedWardID() {
		return this.config.wardList.SelectedID
	}

	public get SelectedWardType(): WardType {
		return (
			this.config.wardTypeValues[this.config.wardType.SelectedID] ??
			this.config.wardTypeValues[0]
		)
	}

	public get SelectedTeam(): WardTeamOption {
		return (
			this.config.wardTeamOptionValues[this.config.teamType.SelectedID] ??
			this.config.wardTeamOptionValues[2]
		)
	}

	public get SelectedDescription() {
		return (
			this.config.descriptionPresets[this.config.descriptionPreset.SelectedID] ??
			this.config.defaultWardDescription
		)
	}

	public get SelectedRemoteSource(): RemoteSourceKey {
		return (
			this.config.remoteSourceKeys[this.config.remoteSource.SelectedID] ??
			this.config.remoteSourceKeys[0]
		)
	}

	public get DynamicMinCellDistance(): number {
		return Math.max(0, Number(this.config.dynamicMinCellDistanceTenths.value)) / 10
	}

	public get DynamicMinMinimapDistance(): number {
		return Math.max(0, Number(this.config.dynamicMinMinimapDistanceTenths.value)) / 10
	}

	public get DynamicTowerFitWeight(): number {
		return Math.max(0, Number(this.config.dynamicTowerFitWeightTenths.value)) / 10
	}

	public get DynamicAdaptiveSpacing(): boolean {
		return this.config.dynamicAdaptiveSpacing.value
	}

	public get DynamicRegionQuotaValue(): number {
		return Math.max(0, Number(this.config.dynamicRegionQuota.value))
	}

	public get DynamicRegionSizeValue(): number {
		return Math.max(1, Number(this.config.dynamicRegionSize.value))
	}

	public get DynamicLaneQuotaMinValue(): number {
		return Math.max(0, Number(this.config.dynamicLaneQuotaMin.value))
	}

	public get DynamicLaneQuotaUseValue(): "own" | "enemy" | "both" {
		const id = this.config.dynamicLaneQuotaUse.SelectedID
		if (id === 1) {
			return "enemy"
		}
		if (id === 2) {
			return "both"
		}
		return "own"
	}

	public get DynamicLaneBandValue(): number {
		return Math.max(0, Number(this.config.dynamicLaneBand.value))
	}

	public get DynamicDedupeRadius3DValue(): number {
		return Math.max(0, Number(this.config.dynamicDedupeRadius3D.value))
	}

	public get DynamicMinTowerFit(): number {
		return Math.max(0, Number(this.config.dynamicMinTowerFitPercent.value)) / 100
	}

	public get DynamicMinContextSupportPlacementsValue(): number {
		return Math.max(0, Number(this.config.dynamicMinContextSupportPlacements.value))
	}

	public get DynamicConfidencePlacementsRefValue(): number {
		return Math.max(1, Number(this.config.dynamicConfidencePlacementsRef.value))
	}

	public get DynamicConfidenceMatchesRefValue(): number {
		return Math.max(1, Number(this.config.dynamicConfidenceMatchesRef.value))
	}

	public get DebugForcedTimeBucket(): string | undefined {
		return this.config.debugModel.ForcedTimeBucket
	}

	public get DebugForcedLocalTeam(): WardTeam | undefined {
		return this.config.debugModel.ForcedLocalTeam
	}

	public get DebugAliveTowerOverrideEnabled(): boolean {
		return this.config.debugModel.AliveTowerOverrideEnabled
	}

	public get DebugTowerTemplateOverrideEnabled(): boolean {
		return this.config.debugModel.TowerTemplateOverrideEnabled
	}

	public get DebugMissingOwnTowersFromTemplate(): string[] {
		return this.config.debugModel.MissingOwnTowersFromTemplate
	}

	public get DebugMissingEnemyTowersFromTemplate(): string[] {
		return this.config.debugModel.MissingEnemyTowersFromTemplate
	}

	public get DebugAliveOwnTowers(): string[] {
		return this.config.debugModel.AliveOwnTowers
	}

	public get DebugAliveEnemyTowers(): string[] {
		return this.config.debugModel.AliveEnemyTowers
	}
}

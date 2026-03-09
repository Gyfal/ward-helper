import { Menu } from "github.com/octarine-public/wrapper/index"

export interface SettingsSectionControls {
	ShowOnMinimap: Menu.Toggle
	TestPresetEnabled: Menu.Toggle
	TestPreset: Menu.Dropdown
	TestLocalTeam: Menu.Dropdown
	DynamicAdaptiveSpacing: Menu.Toggle
	DynamicTopPerType: Menu.Slider
	DynamicExcludeRiskyObserver: Menu.Toggle
	DynamicMinCellDistanceTenths: Menu.Slider
	DynamicMinMinimapDistanceTenths: Menu.Slider
	DynamicRegionQuota: Menu.Slider
	DynamicAutoRegionSize: Menu.Toggle
	DynamicRegionSize: Menu.Slider
	DynamicDedupeRadius3D: Menu.Slider
}

export function createSettingsSection(
	settingsTree: Menu.Node,
	testPresetOptions: readonly string[]
): SettingsSectionControls {
	return {
		ShowOnMinimap: settingsTree.AddToggle("Minimap marks", true),
		TestPresetEnabled: settingsTree.AddToggle("Force time bucket", false),
		TestPreset: settingsTree.AddDropdown("Time bucket", [...testPresetOptions]),
		TestLocalTeam: settingsTree.AddDropdown("Forced local team", [
			"Auto",
			"Radiant",
			"Dire"
		]),
		DynamicAdaptiveSpacing: settingsTree.AddToggle("Adaptive spacing", true),
		DynamicTopPerType: settingsTree.AddSlider("Top spots per type", 10, 1, 30),
		DynamicExcludeRiskyObserver: settingsTree.AddToggle("Hide risky obs", true),
		DynamicMinCellDistanceTenths: settingsTree.AddSlider(
			"Min cell dist x0.1",
			15,
			0,
			60
		),
		DynamicMinMinimapDistanceTenths: settingsTree.AddSlider(
			"Min map dist x0.1",
			25,
			0,
			100
		),
		DynamicRegionQuota: settingsTree.AddSlider("Region quota", 3, 0, 8),
		DynamicAutoRegionSize: settingsTree.AddToggle("Auto region size", false),
		DynamicRegionSize: settingsTree.AddSlider("Region size", 42, 8, 96),
		DynamicDedupeRadius3D: settingsTree.AddSlider("3D dedupe radius", 500, 0, 2000)
	}
}

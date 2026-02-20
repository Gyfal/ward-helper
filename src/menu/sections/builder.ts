import { Menu } from "github.com/octarine-public/wrapper/index"

import { DEFAULT_WARD_DESCRIPTION, WARD_TEAM_OPTION_VALUES } from "../../model/WardTypes"

export interface BuilderSectionControls {
	BuilderMode: Menu.Toggle
	EditRemoteMode: Menu.Toggle
	EditRemotePlaceBind: Menu.KeyBind
	SaveRemoteButton: Menu.Button
	WardType: Menu.Dropdown
	TeamType: Menu.Dropdown
	ShowCustomWards: Menu.Toggle
	AddWardBind: Menu.KeyBind
	ClearAllButton: Menu.Button
	SaveCustomButton: Menu.Button
	ShowInfoButton: Menu.Button
	WardList: Menu.Dropdown
	DescriptionPreset: Menu.Dropdown
	ApplyDescriptionButton: Menu.Button
	DeleteWardButton: Menu.Button
	DuplicateWardButton: Menu.Button
	ExportButton: Menu.Button
	wardStats: any
	selectedWardDescription: any
}

export function createBuilderSection(
	builderTree: any,
	descriptionPresets: readonly string[]
): BuilderSectionControls {
	const wardStats = builderTree.AddShortDescription(
		"Total: 0 | Observer: 0 | Sentry: 0"
	)
	const selectedWardDescription = builderTree.AddShortDescription(
		`Selected: ${DEFAULT_WARD_DESCRIPTION}`
	)
	return {
		BuilderMode: builderTree.AddToggle("Builder mode", false),
		EditRemoteMode: builderTree.AddToggle("Edit remote pool", false),
		EditRemotePlaceBind: builderTree.AddKeybind(
			"Pick/place hovered remote ward",
			"Left mouse"
		),
		SaveRemoteButton: builderTree.AddButton("Save remote pool edits"),
		WardType: builderTree.AddDropdown("Ward type", ["Observer Ward", "Sentry Ward"]),
		TeamType: builderTree.AddDropdown("Team", [...WARD_TEAM_OPTION_VALUES], 2),
		ShowCustomWards: builderTree.AddToggle("Show custom wards", true),
		AddWardBind: builderTree.AddKeybind("Add ward at cursor", "F5"),
		ClearAllButton: builderTree.AddButton("Clear all custom wards"),
		SaveCustomButton: builderTree.AddButton("Save custom wards"),
		ShowInfoButton: builderTree.AddButton("Show wards info"),
		WardList: builderTree.AddDropdown("Select ward", ["No wards available"]),
		DescriptionPreset: builderTree.AddDropdown("Description preset", [
			...descriptionPresets
		]),
		ApplyDescriptionButton: builderTree.AddButton("Apply description"),
		DeleteWardButton: builderTree.AddButton("Delete selected ward"),
		DuplicateWardButton: builderTree.AddButton("Duplicate selected ward"),
		ExportButton: builderTree.AddButton("Export to console"),
		wardStats,
		selectedWardDescription
	}
}

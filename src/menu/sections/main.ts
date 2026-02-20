import { Menu } from "github.com/octarine-public/wrapper/index"

export interface MainSectionControls {
	IconSize: Menu.Slider
	TooltipSize: Menu.Slider
	RemoteSource: Menu.Dropdown
	TeamFilter: Menu.Toggle
	HidePlacedWards: Menu.Toggle
	OnlyAlt: Menu.Toggle
	PlaceHelper: Menu.Toggle
	PlaceBind: Menu.KeyBind
	Debug: Menu.Toggle
}

export function createMainSection(
	mainTree: any,
	remoteSourceOptions: string[],
	defaultRemoteSourceIndex: number
): MainSectionControls {
	return {
		IconSize: mainTree.AddSlider("Icon size", 20, 10, 50),
		TooltipSize: mainTree.AddSlider("Tooltip font size", 14, 10, 24),
		RemoteSource: mainTree.AddDropdown(
			"Remote source",
			[...remoteSourceOptions],
			defaultRemoteSourceIndex
		),
		TeamFilter: mainTree.AddToggle("Filter by team", false),
		HidePlacedWards: mainTree.AddToggle("Hide already placed wards", true),
		OnlyAlt: mainTree.AddToggle("Only ALT", false),
		PlaceHelper: mainTree.AddToggle("Place helper", true),
		PlaceBind: mainTree.AddKeybind("Place ward key", "Left mouse"),
		Debug: mainTree.AddToggle("Debug", false)
	}
}

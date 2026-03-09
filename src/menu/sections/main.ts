import { Menu } from "github.com/octarine-public/wrapper/index"

export interface MainSectionControls {
	IconSize: Menu.Slider
	TooltipSize: Menu.Slider
	TeamFilter: Menu.Toggle
	HidePlacedWards: Menu.Toggle
	OnlyAlt: Menu.Toggle
	PlaceHelper: Menu.Toggle
	PlaceBind: Menu.KeyBind
}

export function createMainSection(mainTree: Menu.Node): MainSectionControls {
	return {
		IconSize: mainTree.AddSlider("Icon size", 20, 10, 50),
		TooltipSize: mainTree.AddSlider("Tooltip font size", 14, 10, 24),
		TeamFilter: mainTree.AddToggle("Filter by team", false),
		HidePlacedWards: mainTree.AddToggle("Hide already placed wards", true),
		OnlyAlt: mainTree.AddToggle("Only ALT", false),
		PlaceHelper: mainTree.AddToggle("Place helper", true),
		PlaceBind: mainTree.AddKeybind("Place ward key", "Left mouse")
	}
}

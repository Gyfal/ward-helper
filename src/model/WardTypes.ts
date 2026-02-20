export const WardTypes = {
	Observer: "Observer",
	Sentry: "Sentry"
} as const

export const WardTeams = {
	Dire: "Dire",
	Radiant: "Radiant"
} as const

export const WardTeamOptions = {
	Dire: WardTeams.Dire,
	Radiant: WardTeams.Radiant,
	Both: "Both"
} as const

export type WardType = (typeof WardTypes)[keyof typeof WardTypes]
export type WardTeam = (typeof WardTeams)[keyof typeof WardTeams]
export type WardTeamOption = (typeof WardTeamOptions)[keyof typeof WardTeamOptions]

export interface WardPoint {
	x: number
	y: number
	z: number
	cellX?: number
	cellY?: number
	timeBucket?: string
	towerDiffAvg?: number
	towerDestroyedOwnRate?: Record<string, number>
	towerDestroyedEnemyRate?: Record<string, number>
	matchesSeen?: number
	placements?: number
	radiusP50?: number
	radiusP90?: number
	score?: number
	scoreBase?: number
	scoreRuntime?: number
	towerFit?: number
	towerFitCoverage?: number
	contextSupportPlacements?: number
	contextSupportMatches?: number
	contextConfidence?: number
	contextLevel?: "base" | "direct" | "weak" | "fallback"
	observerRiskyQuickDeward?: boolean
	type: WardType
	description?: string
	teams?: WardTeam[]
}

export const DEFAULT_WARD_DESCRIPTION = "Custom ward desc"
export const WARD_TEAM_VALUES: WardTeam[] = [WardTeams.Dire, WardTeams.Radiant]
export const WARD_TEAM_OPTION_VALUES: WardTeamOption[] = [
	WardTeamOptions.Dire,
	WardTeamOptions.Radiant,
	WardTeamOptions.Both
]
export const DEFAULT_WARD_TEAMS: WardTeam[] = [...WARD_TEAM_VALUES]
export const WARD_TYPE_VALUES: WardType[] = [WardTypes.Observer, WardTypes.Sentry]

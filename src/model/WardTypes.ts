import { Team } from "github.com/octarine-public/wrapper/index"

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
	score?: number
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

export function gameTeamToWardTeam(team: Team): WardTeam | undefined {
	if (team === Team.Radiant) {
		return WardTeams.Radiant
	}
	if (team === Team.Dire) {
		return WardTeams.Dire
	}
	return undefined
}

export function wardTeamToGameTeam(team: WardTeam): Team {
	return team === WardTeams.Radiant ? Team.Radiant : Team.Dire
}

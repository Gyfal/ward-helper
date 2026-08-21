import { DEFAULT_WARD_TEAMS, WardPoint, WardTeam } from "./WardTypes"

export function getWardTeams(ward: WardPoint): WardTeam[] {
	return ward.teams ?? DEFAULT_WARD_TEAMS
}

export function copyWardTeams(ward: WardPoint): WardTeam[] | undefined {
	return ward.teams !== undefined ? [...ward.teams] : undefined
}

/** Team copy that falls back to the default teams for team-less wards. */
export function copyWardTeamsOrDefault(ward: WardPoint): WardTeam[] {
	return [...getWardTeams(ward)]
}

/** Plain payload of a ward, used for every config write. */
export function serializeWard(ward: WardPoint) {
	return {
		x: ward.x,
		y: ward.y,
		z: ward.z,
		cellX: ward.cellX,
		cellY: ward.cellY,
		timeBucket: ward.timeBucket,
		score: ward.score,
		observerRiskyQuickDeward: ward.observerRiskyQuickDeward,
		type: ward.type,
		description: ward.description,
		teams: ward.teams
	}
}

export function serializeWards(wards: WardPoint[]) {
	return wards.map(serializeWard)
}

export function cloneWard(ward: WardPoint): WardPoint {
	return {
		...serializeWard(ward),
		teams: copyWardTeams(ward)
	}
}

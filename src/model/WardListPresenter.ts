import { DEFAULT_WARD_DESCRIPTION, WardPoint, WardTypes } from "./WardTypes"

export class WardListPresenter {
	public static readonly EmptyWardText = "No wards available"

	public static BuildWardOptions(wards: WardPoint[]): string[] {
		if (wards.length === 0) {
			return [WardListPresenter.EmptyWardText]
		}
		return wards.map((ward, index) => {
			const teams = ward.teams?.length ? ` [${ward.teams.join(", ")}]` : ""
			const bucket = ward.timeBucket ? ` <${ward.timeBucket}>` : ""
			return `#${index + 1}: ${ward.type}${bucket} at (${Math.round(ward.x)}, ${Math.round(ward.y)})${teams}`
		})
	}

	public static BuildStatsText(wards: WardPoint[]): string {
		let observer = 0
		let sentry = 0
		for (let i = 0; i < wards.length; i++) {
			if (wards[i].type === WardTypes.Observer) {
				observer++
			} else if (wards[i].type === WardTypes.Sentry) {
				sentry++
			}
		}
		return `Total: ${wards.length} | Observer: ${observer} | Sentry: ${sentry}`
	}

	public static GetWardBySelectedID(
		wards: WardPoint[],
		selectedID: number
	): Nullable<WardPoint> {
		if (selectedID < 0 || selectedID >= wards.length) {
			return undefined
		}
		return wards[selectedID]
	}

	public static GetSafeSelectionID(wards: WardPoint[], selectedID: number): number {
		if (wards.length === 0) {
			return 0
		}
		return Math.max(0, Math.min(selectedID, wards.length - 1))
	}

	public static GetDescription(ward?: WardPoint): string {
		return ward?.description ?? DEFAULT_WARD_DESCRIPTION
	}
}

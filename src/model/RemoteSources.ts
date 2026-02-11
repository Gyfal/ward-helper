export const REMOTE_SOURCE_KEYS = [
	"opendota",
	"stratz_pro",
	"stratz_public",
	"ward_reco_dynamic"
] as const

export type RemoteSourceKey = (typeof REMOTE_SOURCE_KEYS)[number]

export const REMOTE_SOURCE_LABELS: Record<RemoteSourceKey, string> = {
	opendota: "OpenDota",
	stratz_pro: "STRATZ Monthly (Pro)",
	stratz_public: "STRATZ Monthly (Public)",
	ward_reco_dynamic: "Ward Reco Dataset (Dynamic)"
}

export const REMOTE_SOURCE_PATHS: Record<RemoteSourceKey, string> = {
	opendota: "data/ward_sources/wards.json",
	stratz_pro: "data/ward_sources/stratz_monthly_wards_pro.json",
	stratz_public: "data/ward_sources/stratz_monthly_wards_public.json",
	ward_reco_dynamic: "data/ward_reco_dataset.json"
}

export const REMOTE_SOURCE_OPTIONS = REMOTE_SOURCE_KEYS.map(
	source => REMOTE_SOURCE_LABELS[source]
)

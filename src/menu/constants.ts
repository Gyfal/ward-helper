export const DEBUG_PHASE_VALUES = [
	"Auto",
	"0-10 min",
	"10-20 min",
	"20-35 min",
	"35-50 min",
	"50+ min"
] as const

export const DEBUG_PHASE_BUCKETS = [
	"",
	"0_10",
	"10_20",
	"20_35",
	"35_50",
	"50_plus"
] as const

export const DEBUG_TOWER_ALIVE_KEYS = [
	"top_t1",
	"top_t2",
	"top_t3",
	"top_t4",
	"mid_t1",
	"mid_t2",
	"mid_t3",
	"mid_t4",
	"bot_t1",
	"bot_t2",
	"bot_t3",
	"bot_t4"
] as const

export type DebugTowerAliveKey = (typeof DEBUG_TOWER_ALIVE_KEYS)[number]

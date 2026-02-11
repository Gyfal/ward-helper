import {
	Color,
	GameState,
	GetPositionHeight,
	GUIInfo,
	InputManager,
	MinimapSDK,
	LocalPlayer,
	ParticleAttachment,
	ParticlesSDK,
	RendererSDK,
	VKeys,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { MenuManager } from "../menu"
import { TooltipAnimator } from "./TooltipAnimator"
import { WardState } from "./WardState"
import { WardPoint, WardTypes } from "./WardTypes"

const OBSERVER_ICON =
	"panorama/images/emoticons/observer_ward_png.vtex_c"
const SENTRY_ICON =
	"panorama/images/emoticons/sentry_ward_png.vtex_c"
const TOOLTIP_TEXT_FALLBACK = "No description"
const ICON_HEIGHT_SCALE = 1.8
const WARD_PULSE_RADIUS_BASE = 30
const WARD_PULSE_Z_OFFSET = 8
const WARD_PARTICLE_ALPHA = 180
const CIRCLE_PARTICLE_PATH = "particles/range_display/range_display_normal.vpcf"
const PANEL_ROUND_DIAMETER = 11
const PANEL_ACCENT_HEIGHT = 3

interface TooltipSizeCacheEntry {
	text: string
	size: number
	width: number
}

interface WardRenderEntry {
	ward: WardPoint
	drawWard: WardPoint
	wardKey: string
	particleKey: string
	w2s: Nullable<Vector2>
	isVisibleOnScreen: boolean
}

export class WardRenderer {
	private readonly particleManager = new ParticlesSDK()
	private renderedParticleKeys = new Set<string>()
	private seenParticleKeys = new Set<string>()
	private readonly particleVisibility = new Map<string, boolean>()
	private readonly tooltipSizeCache = new Map<string, TooltipSizeCacheEntry>()

	constructor(
		private readonly menu: MenuManager,
		private readonly state: WardState,
		private readonly tooltipAnimator: TooltipAnimator
	) {}

	public Draw(wards: WardPoint[]) {
		this.state.hoveredWard = undefined
		const targetAlpha =
			this.menu.OnlyAlt.value && !InputManager.IsKeyDown(VKeys.MENU) ? 0 : 1
		this.state.alphaAnimation = this.Approach(
			this.state.alphaAnimation,
			targetAlpha,
			0.1
		)

		if (this.state.alphaAnimation <= 0) {
			this.state.hoveredWard = undefined
			this.syncParticles(new Set<string>())
			return
		}

		const cursor = InputManager.CursorOnScreen
		const nextParticleKeys = new Set<string>()
		const renderEntries: WardRenderEntry[] = []
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			const drawWard =
				this.state.draggedRemoteWard === ward &&
				this.state.draggedRemoteWardPreview !== undefined
					? this.state.draggedRemoteWardPreview
					: ward
			const world = new Vector3(drawWard.x, drawWard.y, drawWard.z)
			const w2s = RendererSDK.WorldToScreen(world)
			const isVisibleOnScreen =
				w2s !== undefined && RendererSDK.IsInScreenArea(w2s)
			renderEntries.push({
				ward,
				drawWard,
				wardKey: `ward_${i}`,
				particleKey: `ward_pulse_${i}`,
				w2s,
				isVisibleOnScreen
			})
		}

		for (let i = 0; i < renderEntries.length; i++) {
			const entry = renderEntries[i]
			this.ensureWardParticleCreated(entry.drawWard, entry.particleKey, nextParticleKeys)
		}

		let hoveredWard: Nullable<WardPoint>
		let hoveredDistanceSq = Number.MAX_VALUE
		for (let i = 0; i < renderEntries.length; i++) {
			const entry = renderEntries[i]
			const isHidden = !(entry.isVisibleOnScreen && entry.w2s !== undefined)
			if (entry.isVisibleOnScreen && entry.w2s !== undefined) {
				const hoverScore = this.drawSingleWard(
					entry.drawWard,
					entry.wardKey,
					cursor,
					entry.w2s
				)
				if (hoverScore !== undefined && hoverScore < hoveredDistanceSq) {
					hoveredDistanceSq = hoverScore
					hoveredWard = entry.ward
				}
				this.setWardParticleHidden(entry.drawWard, entry.particleKey, false)
			} else {
				this.tooltipAnimator.Clear(entry.wardKey)
				this.setWardParticleHidden(entry.drawWard, entry.particleKey, true)
			}
			if (this.state.draggedRemoteWard === entry.ward) {
				// Keep particle center in sync while the ward is being dragged.
				this.drawWardParticle(entry.drawWard, entry.particleKey, isHidden)
			}
			if (this.menu.ShowOnMinimap.value) {
				this.drawMinimapWard(entry.drawWard)
			}
		}
		this.state.hoveredWard = hoveredWard
		this.syncParticles(nextParticleKeys)
	}

	public ResetEffects() {
		this.state.alphaAnimation = 0
		this.state.hoveredWard = undefined
		this.tooltipAnimator.ClearAll()
		this.particleManager.DestroyAll()
		this.renderedParticleKeys.clear()
		this.seenParticleKeys.clear()
		this.particleVisibility.clear()
		this.tooltipSizeCache.clear()
	}

	private drawSingleWard(
		ward: WardPoint,
		key: string,
		cursor: Vector2,
		w2s: Vector2
	): Nullable<number> {
		const iconSize = this.menu.IconSize.value
		const iconWidth = iconSize
		const iconHeight = iconSize * ICON_HEIGHT_SCALE
		const renderOffset = 15
		const basePosition = new Vector2(w2s.x, w2s.y - renderOffset)
		const iconPositionCenter = basePosition

		const baseWidth = iconSize * 1.8
		const baseHalfWidth = baseWidth / 2
		const baseHalfHeight = iconSize / 1.5
		const hoverHalfSize = Math.max(iconWidth, iconHeight) * 0.65
		const isHovered = this.IsHovered(basePosition, cursor, hoverHalfSize)

		let panelWidth = baseWidth
		let textProgress = 0

		if (isHovered) {
			const tooltipText = this.GetWardTooltipText(ward)
			const targetWidth = this.GetTooltipTargetWidth(
				key,
				tooltipText,
				this.menu.TooltipSize.value,
				iconSize
			)
			const animation = this.tooltipAnimator.Get(
				key,
				baseWidth,
				targetWidth,
				GameState.RawGameTime
			)
			panelWidth = animation.width
			textProgress = animation.progress
		} else {
			this.tooltipAnimator.Clear(key)
		}

		const panelPosition = new Vector2(
			basePosition.x - baseHalfWidth,
			basePosition.y - baseHalfHeight
		)
		const panelSize = new Vector2(panelWidth, baseHalfHeight * 2)
		const bgAlpha = Math.floor(170 * this.state.alphaAnimation)
		const iconAlpha = Math.floor(255 * this.state.alphaAnimation)
		const arrowAlpha = Math.floor(120 * this.state.alphaAnimation)
		const borderColor = new Color(
			255,
			255,
			255,
			Math.floor(55 * this.state.alphaAnimation)
		)
		const accentColor =
			ward.type === WardTypes.Observer
				? new Color(255, 211, 88, Math.floor(230 * this.state.alphaAnimation))
				: new Color(120, 205, 255, Math.floor(230 * this.state.alphaAnimation))

		RendererSDK.RectRounded(
			panelPosition,
			panelSize,
			PANEL_ROUND_DIAMETER,
			new Color(0, 0, 0, bgAlpha),
			borderColor,
			1
		)

		const accentPosition = new Vector2(panelPosition.x + 1, panelPosition.y + 1)
		const accentSize = new Vector2(Math.max(panelSize.x - 2, 1), PANEL_ACCENT_HEIGHT)
		RendererSDK.RectRounded(
			accentPosition,
			accentSize,
			PANEL_ROUND_DIAMETER,
			accentColor,
			new Color(0, 0, 0, 0),
			0
		)

		const iconPosition = new Vector2(
			basePosition.x - iconWidth / 2,
			iconPositionCenter.y - iconHeight / 2
		)
		const iconColor = new Color(iconAlpha, iconAlpha, iconAlpha, iconAlpha)
		RendererSDK.Image(
			ward.type === WardTypes.Observer ? OBSERVER_ICON : SENTRY_ICON,
			iconPosition,
			-1,
			new Vector2(iconWidth, iconHeight),
			iconColor
		)

		const arrowSize = iconSize * 0.4
		const arrowY = iconPositionCenter.y + iconSize / 2 + 10
		RendererSDK.Line(
			new Vector2(basePosition.x - arrowSize / 2 - 2, arrowY - arrowSize / 2),
			new Vector2(basePosition.x, arrowY + arrowSize / 2),
			new Color(255, 255, 255, arrowAlpha),
			2
		)
		RendererSDK.Line(
			new Vector2(basePosition.x, arrowY + arrowSize / 2),
			new Vector2(basePosition.x + arrowSize / 2 + 2, arrowY - arrowSize / 2),
			new Color(255, 255, 255, arrowAlpha),
			2
		)

		if (!isHovered) {
			return undefined
		}

		const tooltipText = this.GetWardTooltipText(ward)
		const textColor = new Color(
			255,
			255,
			255,
			Math.floor(255 * this.state.alphaAnimation * textProgress)
		)
		RendererSDK.Text(
			tooltipText,
			new Vector2(
				panelPosition.x + iconSize + 10,
				basePosition.y - this.menu.TooltipSize.value / 1.8
			),
			textColor,
			"MuseoSansEx",
			this.menu.TooltipSize.value,
			400,
			false,
			false
		)
		const dx = basePosition.x - cursor.x
		const dy = basePosition.y - cursor.y
		return dx * dx + dy * dy
	}

	private drawMinimapWard(ward: WardPoint) {
		if (GUIInfo?.Minimap === undefined) {
			return
		}
		const minimapPos = MinimapSDK.WorldToMinimap(this.GetMinimapWorldPosition(ward))
		const size = this.GetMinimapIconSize()
		const position = minimapPos.Subtract(size.DivideScalar(2))
		const alpha = Math.floor(255 * this.state.alphaAnimation)
		const iconColor = new Color(alpha, alpha, alpha, alpha)
		RendererSDK.Image(
			ward.type === WardTypes.Observer ? OBSERVER_ICON : SENTRY_ICON,
			position,
			-1,
			size,
			iconColor
		)
	}

	private ensureWardParticleCreated(
		ward: WardPoint,
		key: string,
		nextKeys: Set<string>
	) {
		const wasSeen = this.seenParticleKeys.has(key)
		if (!wasSeen) {
			this.drawWardParticle(ward, key, true)
			this.seenParticleKeys.add(key)
			this.particleVisibility.set(key, true)
			nextKeys.add(key)
			return
		}
		nextKeys.add(key)
	}

	private setWardParticleHidden(ward: WardPoint, key: string, hidden: boolean) {
		const prevHidden = this.particleVisibility.get(key)
		if (prevHidden === hidden) {
			// Keys are index-based; after deletion the same key can refer to another ward.
			// Keep visible particles updated even when hidden-state didn't change.
			if (!hidden) {
				this.drawWardParticle(ward, key, false)
			}
			return
		}
		this.drawWardParticle(ward, key, hidden)
		this.particleVisibility.set(key, hidden)
	}

	private drawWardParticle(ward: WardPoint, key: string, hidden: boolean) {
		const hero = LocalPlayer?.Hero
		if (hero === undefined) {
			return
		}
		const center2D = new Vector2(ward.x, ward.y)
		const center = new Vector3(
			ward.x,
			ward.y,
			GetPositionHeight(center2D) + WARD_PULSE_Z_OFFSET
		)
		const particleAlpha = hidden
			? 0
			: Math.floor(WARD_PARTICLE_ALPHA * this.state.alphaAnimation)
		const base =
			ward.type === WardTypes.Observer
				? { r: 255, g: 219, b: 96 }
				: { r: 139, g: 225, b: 255 }
		const color = new Color(base.r, base.g, base.b, particleAlpha)
		this.particleManager.AddOrUpdate(
			key,
			CIRCLE_PARTICLE_PATH,
			ParticleAttachment.PATTACH_ABSORIGIN,
			hero,
			[0, center],
			[1, WARD_PULSE_RADIUS_BASE],
			[2, color],
			[3, 0],
			[4, particleAlpha]
		)
	}

	private syncParticles(nextKeys: Set<string>) {
		for (const key of this.renderedParticleKeys) {
			if (!nextKeys.has(key)) {
				this.particleManager.DestroyByKey(key)
				this.seenParticleKeys.delete(key)
				this.particleVisibility.delete(key)
			}
		}
		this.renderedParticleKeys = nextKeys
	}

	private GetTooltipTargetWidth(
		key: string,
		tooltipText: string,
		tooltipSize: number,
		iconSize: number
	) {
		const cached = this.tooltipSizeCache.get(key)
		if (
			cached !== undefined &&
			cached.text === tooltipText &&
			cached.size === tooltipSize
		) {
			return cached.width + iconSize + 20
		}
		const textSize = RendererSDK.GetTextSize(
			tooltipText,
			"MuseoSansEx",
			tooltipSize,
			400,
			false
		)
		this.tooltipSizeCache.set(key, {
			text: tooltipText,
			size: tooltipSize,
			width: textSize.x
		})
		return textSize.x + iconSize + 20
	}

	private GetWardTooltipText(ward: WardPoint): string {
		const description = ward.description
		const bucket = ward.timeBucket
		if (bucket !== undefined && bucket.length > 0) {
			if (description !== undefined && description.length > 0) {
				if (description.includes(bucket)) {
					return description
				}
				return `[${bucket}] ${description}`
			}
			return `${bucket} min`
		}
		return description ?? TOOLTIP_TEXT_FALLBACK
	}

	private GetMinimapWorldPosition(ward: WardPoint): Vector3 {
		if (
			Number.isFinite(ward.x) &&
			Number.isFinite(ward.y)
		) {
			return new Vector3(ward.x, ward.y, ward.z)
		}
		// For minimap rendering rely on world coordinates only.
		return new Vector3(0, 0, ward.z)
	}

	private GetMinimapIconSize(): Vector2 {
		const size = Math.max(10, this.menu.IconSize.value * 0.6)
		return GUIInfo.ScaleVector(size, size)
	}

	private Approach(current: number, target: number, speed: number) {
		if (current < target) {
			return Math.min(current + speed, target)
		}
		if (current > target) {
			return Math.max(current - speed, target)
		}
		return current
	}

	private IsHovered(center: Vector2, cursor: Vector2, halfSize: number) {
		return (
			cursor.x >= center.x - halfSize &&
			cursor.x <= center.x + halfSize &&
			cursor.y >= center.y - halfSize &&
			cursor.y <= center.y + halfSize
		)
	}
}

import {
	Color,
	GameState,
	GetPositionHeight,
	GUIInfo,
	InputManager,
	LocalPlayer,
	MinimapSDK,
	ParticleAttachment,
	ParticlesSDK,
	RendererSDK,
	Vector2,
	Vector3,
	VKeys
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "../gui"
import { MenuManager } from "../menu"
import { TooltipAnimator } from "./TooltipAnimator"
import { approach } from "./Utils"
import { WardState } from "./WardState"
import { WardPoint, WardType, WardTypes } from "./WardTypes"

const OBSERVER_ICON = "panorama/images/emoticons/observer_ward_png.vtex_c"
const SENTRY_ICON = "panorama/images/emoticons/sentry_ward_png.vtex_c"
const TOOLTIP_TEXT_FALLBACK = "No description"
const WARD_PULSE_RADIUS_BASE = 30
const WARD_PULSE_Z_OFFSET = 8
const WARD_PARTICLE_ALPHA = 180
const CIRCLE_PARTICLE_PATH = "particles/range_display/range_display_normal.vpcf"
const PANEL_BORDER_PADDING = 4
const PANEL_BORDER_WIDTH = 2
const WARD_UI_VERTICAL_OFFSET = 34
const WARD_PANEL_RGB: Record<WardType, { r: number; g: number; b: number }> = {
	[WardTypes.Observer]: { r: 255, g: 211, b: 88 },
	[WardTypes.Sentry]: { r: 120, g: 205, b: 255 }
}

interface TooltipSizeCacheEntry {
	text: string
	size: number
	width: number
}

export class WardRenderer {
	private readonly particleManager = new ParticlesSDK()
	// key -> hidden flag of the last successfully applied particle state.
	private readonly particleHidden = new Map<string, boolean>()
	private readonly tooltipSizeCache = new Map<string, TooltipSizeCacheEntry>()

	constructor(
		private readonly menu: MenuManager,
		private readonly state: WardState,
		private readonly tooltipAnimator: TooltipAnimator,
		private readonly gui: GUIHelper
	) {}

	public Draw(wards: WardPoint[]) {
		this.state.hoveredWard = undefined
		const targetAlpha =
			this.menu.OnlyAlt.value && !InputManager.IsKeyDown(VKeys.MENU) ? 0 : 1
		this.state.alphaAnimation = approach(this.state.alphaAnimation, targetAlpha, 0.1)

		if (this.state.alphaAnimation <= 0) {
			this.syncParticles(new Set<string>())
			return
		}

		const cursor = InputManager.CursorOnScreen
		const activeKeys = new Set<string>()
		const drag = this.state.remoteDrag
		let hoveredWard: Nullable<WardPoint>
		let hoveredDistanceSq = Number.MAX_VALUE
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			const isDragged = drag !== undefined && drag.ward === ward
			const drawWard = isDragged ? drag.preview : ward
			const key = this.getWardKey(ward)
			activeKeys.add(key)

			const w2s = RendererSDK.WorldToScreen(
				new Vector3(drawWard.x, drawWard.y, drawWard.z)
			)
			const isVisibleOnScreen = w2s !== undefined && RendererSDK.IsInScreenArea(w2s)
			if (w2s !== undefined && isVisibleOnScreen) {
				const hoverScore = this.drawSingleWard(drawWard, key, cursor, w2s)
				if (hoverScore !== undefined && hoverScore < hoveredDistanceSq) {
					hoveredDistanceSq = hoverScore
					hoveredWard = ward
				}
			} else {
				this.tooltipAnimator.Clear(key)
			}
			this.updateWardParticle(drawWard, key, !isVisibleOnScreen, isDragged)
			if (this.menu.ShowOnMinimap.value) {
				this.drawMinimapWard(drawWard)
			}
		}
		this.state.hoveredWard = hoveredWard
		this.syncParticles(activeKeys)
	}

	public ResetEffects() {
		this.state.alphaAnimation = 0
		this.state.hoveredWard = undefined
		this.tooltipAnimator.ClearAll()
		this.particleManager.DestroyAll()
		this.particleHidden.clear()
		this.tooltipSizeCache.clear()
	}

	private getWardKey(ward: WardPoint): string {
		return `${ward.type}:${ward.x}:${ward.y}`
	}

	private drawSingleWard(
		ward: WardPoint,
		key: string,
		cursor: Vector2,
		w2s: Vector2
	): Nullable<number> {
		const iconSize = this.menu.IconSize.value
		const iconWidth = iconSize
		const iconHeight = iconSize
		const basePosition = new Vector2(w2s.x, w2s.y - WARD_UI_VERTICAL_OFFSET)

		const baseWidth = iconWidth + PANEL_BORDER_PADDING * 2
		const panelHeight = iconHeight + PANEL_BORDER_PADDING * 2
		const baseHalfWidth = baseWidth / 2
		const baseHalfHeight = panelHeight / 2
		const hoverHalfSize = Math.max(iconWidth, iconHeight) * 0.65
		const isHovered = this.gui.IsHovered(basePosition, cursor, hoverHalfSize)

		let panelWidth = baseWidth
		let textProgress = 0

		if (isHovered) {
			const tooltipLabel = this.GetWardTooltipText(ward)
			const targetWidth = this.GetTooltipTargetWidth(
				key,
				tooltipLabel,
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
		const panelSize = new Vector2(panelWidth, panelHeight)
		const panelRoundDiameter = panelHeight
		const bgAlpha = Math.floor(170 * this.state.alphaAnimation)
		const iconAlpha = Math.floor(255 * this.state.alphaAnimation)
		const accent = WARD_PANEL_RGB[ward.type]
		const accentColor = new Color(
			accent.r,
			accent.g,
			accent.b,
			Math.floor(230 * this.state.alphaAnimation)
		)
		const panelBackground = new Color(
			accent.r,
			accent.g,
			accent.b,
			Math.floor(48 * this.state.alphaAnimation)
		)

		RendererSDK.RectRounded(
			panelPosition,
			panelSize,
			panelRoundDiameter,
			isHovered ? new Color(0, 0, 0, bgAlpha) : panelBackground,
			accentColor,
			PANEL_BORDER_WIDTH
		)

		const iconPosition = new Vector2(
			basePosition.x - iconWidth / 2,
			basePosition.y - iconHeight / 2
		)
		const iconColor = new Color(iconAlpha, iconAlpha, iconAlpha, iconAlpha)
		this.gui.DrawAnimatedImage(
			this.GetWardIconPath(ward.type),
			iconPosition,
			new Vector2(iconWidth, iconHeight),
			iconColor
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
				panelPosition.x + baseWidth + 8,
				basePosition.y - this.menu.TooltipSize.value / 2
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
		const minimapPos = MinimapSDK.WorldToMinimap(new Vector3(ward.x, ward.y, ward.z))
		const rawSize = Math.max(10, this.menu.IconSize.value * 0.6)
		const size = this.gui.GetScaledVector(rawSize, rawSize)
		const position = minimapPos.Subtract(size.DivideScalar(2))
		const alpha = Math.floor(255 * this.state.alphaAnimation)
		const iconColor = new Color(alpha, alpha, alpha, alpha)
		this.gui.DrawAnimatedImage(
			this.GetWardIconPath(ward.type),
			position,
			size,
			iconColor
		)
	}

	private GetWardIconPath(type: WardType) {
		return type === WardTypes.Observer ? OBSERVER_ICON : SENTRY_ICON
	}

	private updateWardParticle(
		ward: WardPoint,
		key: string,
		hidden: boolean,
		forceUpdate: boolean
	) {
		const prevHidden = this.particleHidden.get(key)
		const isFading = !hidden && this.state.alphaAnimation < 1
		if (prevHidden === hidden && !isFading && !forceUpdate) {
			return
		}
		if (this.drawWardParticle(ward, key, hidden)) {
			this.particleHidden.set(key, hidden)
		}
	}

	private drawWardParticle(ward: WardPoint, key: string, hidden: boolean): boolean {
		const hero = LocalPlayer?.Hero
		if (hero === undefined) {
			return false
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
		return true
	}

	private syncParticles(activeKeys: Set<string>) {
		for (const key of this.particleHidden.keys()) {
			if (!activeKeys.has(key)) {
				this.particleManager.DestroyByKey(key)
				this.particleHidden.delete(key)
				this.tooltipAnimator.Clear(key)
				this.tooltipSizeCache.delete(key)
			}
		}
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
		const textWidth = this.gui.GetTextWidth(
			tooltipText,
			"MuseoSansEx",
			tooltipSize,
			400,
			false
		)
		this.tooltipSizeCache.set(key, {
			text: tooltipText,
			size: tooltipSize,
			width: textWidth
		})
		return textWidth + iconSize + 20
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
}

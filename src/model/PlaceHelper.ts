import {
	GameState,
	InputManager,
	LocalPlayer,
	RendererSDK,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { GUIHelper } from "../gui"
import { WardPoint, WardType, WardTypes } from "./WardTypes"

interface PendingDispenserPlacement {
	position: Vector3
	type: WardType
}

export class PlaceHelper {
	private pendingDispenserPlacement: PendingDispenserPlacement | undefined = undefined

	constructor(private readonly gui: GUIHelper) {}

	public UpdatePendingPlacement(): boolean {
		const pending = this.pendingDispenserPlacement
		if (pending === undefined) {
			return false
		}
		const hero = LocalPlayer?.Hero
		const wardDispenser = hero?.GetItemByName("item_ward_dispenser", true)
		if (hero === undefined || wardDispenser === undefined) {
			this.pendingDispenserPlacement = undefined
			return false
		}
		if (!wardDispenser.CanBeCasted()) {
			return false
		}
		const wantsObserver = pending.type === WardTypes.Observer
		if (wardDispenser.IsToggled !== wantsObserver) {
			return false
		}
		hero.CastPosition(wardDispenser, pending.position)
		this.pendingDispenserPlacement = undefined
		return true
	}

	public TryPlaceWard(wards: WardPoint[], iconSize: number) {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || wards.length === 0) {
			return false
		}

		const observerWard = hero.GetItemByName("item_ward_observer", true)
		const sentryWard = hero.GetItemByName("item_ward_sentry", true)
		const wardDispenser = hero.GetItemByName("item_ward_dispenser", true)

		if (
			observerWard === undefined &&
			sentryWard === undefined &&
			wardDispenser === undefined
		) {
			return false
		}

		const cursor = InputManager.CursorOnScreen
		for (let i = 0; i < wards.length; i++) {
			const ward = wards[i]
			if (!this.IsCursorOnWard(ward, cursor, iconSize)) {
				continue
			}

			const wardPosition = new Vector3(ward.x, ward.y, ward.z)
			if (wardDispenser?.CanBeCasted()) {
				const wantsObserver = ward.type === WardTypes.Observer
				if (wardDispenser.IsToggled !== wantsObserver) {
					hero.CastToggle(wardDispenser)
					this.pendingDispenserPlacement = {
						position: wardPosition,
						type: ward.type
					}
					return true
				}
				this.pendingDispenserPlacement = undefined
				hero.CastPosition(wardDispenser, wardPosition)
				return true
			}

			if (ward.type === WardTypes.Observer && observerWard?.CanBeCasted()) {
				this.pendingDispenserPlacement = undefined
				hero.CastPosition(observerWard, wardPosition)
			}
			if (ward.type === WardTypes.Sentry && sentryWard?.CanBeCasted()) {
				this.pendingDispenserPlacement = undefined
				hero.CastPosition(sentryWard, wardPosition)
			}
			return true
		}

		return false
	}

	private IsCursorOnWard(ward: WardPoint, cursor: Vector2, iconSize: number) {
		const screenPosition = RendererSDK.WorldToScreen(
			new Vector3(ward.x, ward.y, ward.z)
		)
		if (screenPosition === undefined) {
			return false
		}

		const animationTime = GameState.RawGameTime * 2
		const bounceOffset = Math.sin(animationTime) * 3
		const renderOffset = 15
		const animated = new Vector2(
			screenPosition.x,
			screenPosition.y - renderOffset + bounceOffset
		)

		const halfSize = iconSize / 1.5
		return this.gui.IsHovered(animated, cursor, halfSize)
	}
}

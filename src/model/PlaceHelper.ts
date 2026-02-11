import {
	GameState,
	InputManager,
	LocalPlayer,
	RendererSDK,
	Vector2,
	Vector3
} from "github.com/octarine-public/wrapper/index"

import { WardPoint, WardTypes } from "./WardTypes"

export class PlaceHelper {
	public TryPlaceWard(wards: WardPoint[], iconSize: number) {
		const hero = LocalPlayer?.Hero
		if (hero === undefined || wards.length === 0) {
			return false
		}

		const observerWard = hero.GetItemByName("item_ward_observer", true)
		const sentryWard = hero.GetItemByName("item_ward_sentry", true)
		const wardDispenser = hero.GetItemByName("item_ward_dispenser", true)

		if (observerWard === undefined && sentryWard === undefined && wardDispenser === undefined) {
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
				const isObserverSelected = wardDispenser.IsToggled
				if (ward.type === WardTypes.Observer && !isObserverSelected) {
					hero.CastToggle(wardDispenser)
				}
				if (ward.type === WardTypes.Sentry && isObserverSelected) {
					hero.CastToggle(wardDispenser)
				}
				hero.CastPosition(wardDispenser, wardPosition)
				return true
			}

			if (ward.type === WardTypes.Observer && observerWard?.CanBeCasted()) {
				hero.CastPosition(observerWard, wardPosition)
			}
			if (ward.type === WardTypes.Sentry && sentryWard?.CanBeCasted()) {
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

		const halfWidth = iconSize / 1.5
		const halfHeight = iconSize / 1.5
		return (
			cursor.x >= animated.x - halfWidth &&
			cursor.x <= animated.x + halfWidth &&
			cursor.y >= animated.y - halfHeight &&
			cursor.y <= animated.y + halfHeight
		)
	}

}

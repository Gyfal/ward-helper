import { Color } from "github.com/octarine-public/wrapper/index"

export interface RGB {
	r: number
	g: number
	b: number
}

export function scaledAlphaColor(rgb: RGB, baseAlpha: number, alphaScale: number): Color {
	return new Color(rgb.r, rgb.g, rgb.b, Math.floor(baseAlpha * alphaScale))
}

/** Neutral tint used to fade icons in and out. */
export function grayscaleColor(alphaScale: number): Color {
	const alpha = Math.floor(255 * alphaScale)
	return new Color(alpha, alpha, alpha, alpha)
}

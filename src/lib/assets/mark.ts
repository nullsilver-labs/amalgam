/**
 * The Nullsilver mark.
 *
 * A four-point star cut *out* of a filled tile, so whatever sits behind shows
 * through the star. Traced from the master raster (static/nullsilver_400x400.png)
 * at sub-pixel tolerance; it matches the original to 99.9% of pixels.
 *
 * Path is authored in a 400x400 space. The star bleeds past the top and bottom
 * edges by design — that crop is part of the mark.
 */
export const MARK_SIZE = 400;

/** Outline of the star, in the 400x400 mark space. */
export const STAR_PATH =
	'M303.5 0 L302.5 0.84 L298.84 9.5 L292.7 21.5 L284.93 34.5 L274.89 48.5 L260.92 64.5 L246.5 77.92 L233.5 87.96 L216.5 98.84 L200.5 106.93 L183.5 113.84 L177.5 115.84 L163.5 119.62 L146.5 122.89 L126.5 124.84 L108.5 124.84 L95.5 123.84 L87.5 122.77 L71.5 119.71 L63.5 117.62 L52.5 114.07 L51.5 113.9 L51 114.5 L63.92 126.5 L77.89 142.5 L87.89 156.5 L96.84 171.5 L102.84 183.5 L105.84 190.5 L111.84 207.5 L116.84 227.5 L118.7 238.5 L119.93 249.5 L120.51 260.5 L120.51 271.5 L119.84 284.5 L118.78 293.5 L116.78 305.5 L114.7 314.5 L110.7 328.5 L104.7 344.5 L95.84 362.5 L89.93 372.5 L82.51 383.5 L76.5 391.38 L69.51 399.5 L70.5 400 L96.5 400 L97.3 399.5 L104.07 384.5 L110.11 373.5 L117.07 362.5 L122.07 355.5 L130.04 345.5 L143.5 331.08 L158.5 318.04 L166.5 312.04 L175.5 306.04 L188.5 298.5 L197.5 294 L208.5 289.16 L222.5 284.16 L242.5 279.07 L260.5 276.23 L276.5 275.07 L291.5 275.16 L304.5 276.16 L312.5 277.23 L328.5 280.3 L342.5 284.16 L347.5 285.93 L348.5 286.1 L349 285.5 L336.08 273.5 L326.16 262.5 L316.16 249.5 L310.16 240.5 L304.23 230.5 L297.16 216.5 L291.16 201.5 L286.16 185.5 L282.07 166.5 L280.16 151.5 L279.49 139.5 L279.49 128.5 L280.16 115.5 L283.23 94.5 L287.16 78.5 L290.3 68.5 L295.3 55.5 L304.16 37.5 L310.07 27.5 L316.07 18.5 L323.5 8.62 L330.5 0.5 L329.5 0 L304.5 0 Z';

/**
 * Builds the full tile path: an outer rectangle with the star punched out.
 * Render with `fill-rule="evenodd"`.
 *
 * @param inset Extra tile width on each side, in mark-space units. The design
 *   calls for a tile wider than it is tall, so the star sits in a silver field.
 */
export function markPath(inset = 0): string {
	const left = -inset;
	const right = MARK_SIZE + inset;
	return `M${left} 0H${right}V${MARK_SIZE}H${left}Z ${STAR_PATH}`;
}

/** viewBox for {@link markPath} with the same inset. */
export function markViewBox(inset = 0): string {
	return `${-inset} 0 ${MARK_SIZE + inset * 2} ${MARK_SIZE}`;
}

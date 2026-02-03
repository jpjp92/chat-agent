/**
 * Celestial coordinate transformation utilities for constellation visualization
 */

/**
 * Convert Right Ascension (hours) and Declination (degrees) to 3D Cartesian coordinates
 * @param ra Right Ascension in hours (0-24)
 * @param dec Declination in degrees (-90 to 90)
 * @returns [x, y, z] coordinates on unit sphere
 */
export function sphericalToCartesian(ra: number, dec: number): [number, number, number] {
    const raRad = ra * (Math.PI / 12);  // Convert hours to radians
    const decRad = dec * (Math.PI / 180);  // Convert degrees to radians

    return [
        Math.cos(decRad) * Math.cos(raRad),
        Math.cos(decRad) * Math.sin(raRad),
        Math.sin(decRad)
    ];
}

/**
 * Project celestial coordinates directly to 2D canvas
 * @param ra Right Ascension in hours (0-24)
 * @param dec Declination in degrees (-90 to 90)
 * @param scale Scaling factor for canvas
 * @param centerX Canvas center X
 * @param centerY Canvas center Y
 * @param centerRA Center RA for viewport (default: 6 hours for Orion region)
 * @param centerDec Center Dec for viewport (default: 0 degrees for celestial equator)
 * @returns [canvasX, canvasY] pixel coordinates
 */
export function projectToCanvas(
    ra: number,
    dec: number,
    scale: number,
    centerX: number,
    centerY: number,
    centerRA: number = 6,
    centerDec: number = 0
): [number, number] {
    // Convert RA/Dec offsets from center to canvas coordinates
    // RA: 1 hour = 15 degrees, so we scale by 15
    const raOffset = (ra - centerRA) * 15;  // Convert to degrees
    const decOffset = dec - centerDec;

    // Apply distance compression for better visualization
    // This brings outlier stars closer to the center
    const distance = Math.sqrt(raOffset * raOffset + decOffset * decOffset);
    const compressionFactor = distance > 30 ?
        30 + Math.log(1 + (distance - 30) / 10) * 10 : // Compress beyond 30°
        distance;

    const compressionRatio = distance > 0 ? compressionFactor / distance : 1;
    const compressedRAOffset = raOffset * compressionRatio;
    const compressedDecOffset = decOffset * compressionRatio;

    // Map to canvas with appropriate scaling
    // Smaller scale factor for RA to account for spherical distortion
    const x = centerX + (compressedRAOffset * scale * 0.05);
    const y = centerY - (compressedDecOffset * scale * 0.05);

    return [x, y];
}

/**
 * Calculate star size based on magnitude (brighter stars = larger size)
 * @param magnitude Apparent magnitude (lower = brighter)
 * @returns Radius in pixels
 */
export function magnitudeToSize(magnitude: number): number {
    // Magnitude scale: -1.5 (Sirius) to 6 (faintest visible)
    // Map to pixel radius: 12px (brightest) to 2px (faintest)
    return Math.max(2, Math.min(12, 9 - magnitude));
}

/**
 * Calculate star opacity based on magnitude
 * @param magnitude Apparent magnitude
 * @returns Opacity value (0-1)
 */
export function magnitudeToOpacity(magnitude: number): number {
    // Brighter stars = more opaque
    return Math.max(0.3, Math.min(1, 1 - magnitude / 8));
}

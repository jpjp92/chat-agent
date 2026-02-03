/**
 * Astronomy helper utilities using astronomy-engine
 * Provides real-time sky calculations for constellation visualization
 */

import * as Astronomy from 'astronomy-engine';

export interface ObserverLocation {
    latitude: number;
    longitude: number;
    elevation?: number; // meters above sea level
}

export interface HorizontalCoordinates {
    altitude: number;  // degrees above horizon (-90 to +90)
    azimuth: number;   // degrees clockwise from north (0 to 360)
    visible: boolean;  // true if above horizon
}

/**
 * Convert equatorial coordinates (RA/Dec) to horizontal coordinates (Alt/Az)
 * for a specific observer location and time
 */
export function equatorialToHorizontal(
    ra: number,        // Right Ascension in hours (0-24)
    dec: number,       // Declination in degrees (-90 to +90)
    date: Date,
    location: ObserverLocation
): HorizontalCoordinates {
    const observer = new Astronomy.Observer(
        location.latitude,
        location.longitude,
        location.elevation || 0
    );

    const time = Astronomy.MakeTime(date);

    // Convert RA from hours to degrees
    const raDegrees = ra * 15;

    // Get horizontal coordinates
    const hor = Astronomy.Horizon(time, observer, raDegrees, dec, 'normal');

    return {
        altitude: hor.altitude,
        azimuth: hor.azimuth,
        visible: hor.altitude > 0
    };
}

/**
 * Project horizontal coordinates (Alt/Az) to canvas coordinates
 * Uses stereographic projection centered on zenith
 */
export function horizontalToCanvas(
    altitude: number,
    azimuth: number,
    canvasWidth: number,
    canvasHeight: number,
    scale: number = 1.0
): [number, number] {
    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    // Convert to radians
    const altRad = altitude * (Math.PI / 180);
    const azRad = azimuth * (Math.PI / 180);

    // Stereographic projection from zenith
    // Distance from center increases as altitude decreases
    let r = Math.tan((Math.PI / 2 - altRad) / 2) * scale * 2.5; // Increased scale factor

    // Apply distance compression for better visualization
    // Similar to static mode, compress large distances
    if (r > 100) {
        r = 100 + Math.log(1 + (r - 100) / 20) * 20;
    }

    // Azimuth determines angle (0° = North = top, 90° = East = right)
    // Rotate by -90° to make North point up
    const angle = azRad - Math.PI / 2;

    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);

    return [x, y];
}

/**
 * Get current location from browser geolocation API
 */
export async function getCurrentLocation(): Promise<ObserverLocation> {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            // Default to Seoul
            resolve({ latitude: 37.5665, longitude: 126.9780 });
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                resolve({
                    latitude: position.coords.latitude,
                    longitude: position.coords.longitude,
                    elevation: position.coords.altitude || 0
                });
            },
            (error) => {
                console.warn('Geolocation error:', error);
                // Default to Seoul
                resolve({ latitude: 37.5665, longitude: 126.9780 });
            }
        );
    });
}

/**
 * Calculate sun position to determine day/night
 */
export function getSunAltitude(date: Date, location: ObserverLocation): number {
    const observer = new Astronomy.Observer(
        location.latitude,
        location.longitude,
        location.elevation || 0
    );

    const time = Astronomy.MakeTime(date);
    const equ = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
    const hor = Astronomy.Horizon(time, observer, equ.ra, equ.dec, 'normal');

    return hor.altitude;
}

/**
 * Check if it's nighttime (sun below -6° for astronomical twilight)
 */
export function isNighttime(date: Date, location: ObserverLocation): boolean {
    const sunAlt = getSunAltitude(date, location);
    return sunAlt < -6; // Astronomical twilight
}

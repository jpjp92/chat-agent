/**
 * astronomy-engine 기반 천문 계산 유틸
 * 별자리 시각화를 위한 실시간 하늘 계산
 */

import * as Astronomy from 'astronomy-engine';

interface ObserverLocation {
    latitude: number;
    longitude: number;
    elevation?: number; // 해발 고도(m)
}

interface HorizontalCoordinates {
    altitude: number;  // 지평선 위 각도 (-90 ~ +90)
    azimuth: number;   // 북쪽에서 시계 방향 각도 (0 ~ 360)
    visible: boolean;  // 지평선 위면 true
}

/**
 * 적도 좌표(RA/Dec)를 지평 좌표(Alt/Az)로 변환
 * (관측 위치·시각 기준)
 */
export function equatorialToHorizontal(
    ra: number,        // 적경(시, 0-24)
    dec: number,       // 적위(도, -90 ~ +90)
    date: Date,
    location: ObserverLocation
): HorizontalCoordinates {
    const observer = new Astronomy.Observer(
        location.latitude,
        location.longitude,
        location.elevation || 0
    );

    const time = Astronomy.MakeTime(date);

    // RA 를 시 → 도로 변환
    const raDegrees = ra * 15;

    // 지평 좌표 구하기
    const hor = Astronomy.Horizon(time, observer, raDegrees, dec, 'normal');

    return {
        altitude: hor.altitude,
        azimuth: hor.azimuth,
        visible: hor.altitude > 0
    };
}

/**
 * 지평 좌표(Alt/Az)를 캔버스 좌표로 투영
 * 천정 중심 평사도법
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

    // 라디안으로 변환
    const altRad = altitude * (Math.PI / 180);
    const azRad = azimuth * (Math.PI / 180);

    // 천정 기준 평사도법
    // 고도가 낮을수록 중심에서 멀어진다
    let r = Math.tan((Math.PI / 2 - altRad) / 2) * scale * 2.5; // 배율 키움

    // 보기 좋게 먼 거리를 압축
    // (정적 모드와 같은 방식)
    if (r > 100) {
        r = 100 + Math.log(1 + (r - 100) / 20) * 20;
    }

    // 방위가 각도를 정한다 (0° = 북 = 위, 90° = 동 = 오른쪽)
    // -90° 회전해 북쪽이 위로
    const angle = azRad - Math.PI / 2;

    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);

    return [x, y];
}

/**
 * 낮/밤 판정용 태양 위치 계산
 */
function getSunAltitude(date: Date, location: ObserverLocation): number {
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
 * 밤인지 확인 (천문박명: 태양 고도 -6° 미만)
 */
export function isNighttime(date: Date, location: ObserverLocation): boolean {
    const sunAlt = getSunAltitude(date, location);
    return sunAlt < -6; // 천문박명
}

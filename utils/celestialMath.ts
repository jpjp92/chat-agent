/**
 * 별자리 시각화용 천구 좌표 변환 유틸
 */


/**
 * 등급으로 별 크기 계산 (밝을수록 크게)
 * @param magnitude 겉보기 등급 (낮을수록 밝음)
 * @returns 반지름(px)
 */
export function magnitudeToSize(magnitude: number): number {
    // 등급 범위: -1.5 (시리우스) ~ 6 (맨눈 한계)
    // 픽셀 반지름: 12px (가장 밝음) ~ 2px (가장 어두움)
    return Math.max(2, Math.min(12, 9 - magnitude));
}

/**
 * 등급으로 별 불투명도 계산
 * @param magnitude 겉보기 등급
 * @returns 불투명도 (0-1)
 */
export function magnitudeToOpacity(magnitude: number): number {
    // 밝은 별일수록 불투명
    return Math.max(0.3, Math.min(1, 1 - magnitude / 8));
}

/**
 * 정적 "포스터 차트" 투영: 실제 RA/Dec 상대 위치를 별자리 무게중심에
 * 맞추고 프레임에 자동 맞춤. 시간·위치 무관.
 * 하늘 방향: RA 는 **왼쪽**으로 증가, 북(dec+)이 위.
 */
export function projectStaticChart(
    stars: { id: number; ra: number; dec: number }[],
    width: number,
    height: number,
    padXFrac = 0.15,
    padYFrac = 0.19,
    topInset = 0, // 포스터 제목용 위쪽 여백(px) — 그림이 제목 아래에 놓이게
): { id: number; x: number; y: number }[] {
    if (stars.length === 0) return [];
    const cRA = stars.reduce((s, x) => s + x.ra, 0) / stars.length;
    const cDec = stars.reduce((s, x) => s + x.dec, 0) / stars.length;
    const cosD = Math.cos((cDec * Math.PI) / 180);
    const raw = stars.map(s => ({
        id: s.id,
        px: -((s.ra - cRA) * 15) * cosD, // 도 단위, RA 는 왼쪽으로 증가
        py: -(s.dec - cDec),             // 도 단위, 북쪽이 위
    }));
    const xs = raw.map(p => p.px), ys = raw.map(p => p.py);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const padX = width * padXFrac, padY = height * padYFrac;
    const availTop = padY + topInset, availBottom = height - padY;
    const availH = Math.max(1, availBottom - availTop);
    const sc = Math.min((width - 2 * padX) / ((maxX - minX) || 1), availH / ((maxY - minY) || 1));
    const ox = (width - (maxX + minX) * sc) / 2;
    const oy = (availTop + availBottom) / 2 - ((minY + maxY) / 2) * sc; // 제목 띠 아래 영역 가운데에 배치
    return raw.map(p => ({ id: p.id, x: p.px * sc + ox, y: p.py * sc + oy }));
}

/** 중심 기준 화면 뷰 변환(줌 + 회전 + 이동) — 두 투영 모드 공통. */
export function applyViewTransform(
    pts: { id: number; x: number; y: number }[],
    cx: number,
    cy: number,
    view: { scale: number; rot: number; px: number; py: number },
): { id: number; x: number; y: number }[] {
    const cs = Math.cos(view.rot), sn = Math.sin(view.rot);
    return pts.map(p => {
        const dx = (p.x - cx) * view.scale, dy = (p.y - cy) * view.scale;
        return { id: p.id, x: cx + dx * cs - dy * sn + view.px, y: cy + dx * sn + dy * cs + view.py };
    });
}

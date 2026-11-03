/**
 * json:diagram 의 `parameters` 형식 판정 — SVG 렌더러가 그릴 수 있으면 정규화한 값을, 아니면 null(기존 canvas 로).
 * 각도는 배치 하니스가 검증한 범위로 자른다(그 밖은 도형이 퇴화). 질량·속력은 화살표 길이가 정규화돼 그림이 깨지지 않으므로
 * 넓게 받는다 — 20kg 로 자르자 "100kg 물체" 답의 카드가 mg 196 N(실제 981 N)으로 나왔다.
 */
export type PhysicsData =
    | { type: 'inclined_plane'; title?: string; parameters: { angleDeg: number; massKg: number; mu?: number } }
    | { type: 'projectile'; title?: string; parameters: { launchDeg: number; speed: number } };

export const RANGE = {
    angleDeg: [5, 60], massKg: [0.1, 10000], mu: [0, 1], launchDeg: [10, 80], speed: [1, 200],
} as const;

const num = (v: unknown, [lo, hi]: readonly [number, number]) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;

export const normalizePhysics = (data: unknown): PhysicsData | null => {
    if (!data || typeof data !== 'object') return null;
    const d = data as { type?: unknown; title?: unknown; parameters?: Record<string, unknown> };
    const p = d.parameters;
    if (!p || typeof p !== 'object') return null;
    const title = typeof d.title === 'string' ? d.title : undefined;
    if (d.type === 'inclined_plane') {
        const angleDeg = num(p.angleDeg, RANGE.angleDeg), massKg = num(p.massKg, RANGE.massKg);
        if (angleDeg === null || massKg === null) return null;
        // μ 가 없으면 "마찰 없는 경사면" — 0 으로 채우면 마찰 슬라이더가 생겨 문제 조건과 달라진다
        const mu = p.mu === undefined ? undefined : num(p.mu, RANGE.mu);
        if (mu === null) return null;
        return { type: 'inclined_plane', title, parameters: mu === undefined ? { angleDeg, massKg } : { angleDeg, massKg, mu } };
    }
    if (d.type === 'projectile') {
        const launchDeg = num(p.launchDeg, RANGE.launchDeg), speed = num(p.speed, RANGE.speed);
        if (launchDeg === null || speed === null) return null;
        return { type: 'projectile', title, parameters: { launchDeg, speed } };
    }
    return null;
};

// 슬라이더 기본 범위 — 문제 값이 밖에 있으면 그 값까지 넓힌다
export const SLIDER = { massKg: [0.5, 20], speed: [5, 40] } as const;
export const sliderRange = ([lo, hi]: readonly [number, number], v: number): [number, number] => [Math.min(lo, v), Math.max(hi, v)];

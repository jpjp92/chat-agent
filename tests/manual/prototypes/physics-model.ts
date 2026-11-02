/**
 * 물리 도해 계산 — 그림 좌표는 전부 여기서 나온다. 렌더러는 그리기만 한다.
 * LLM 이 만든 시안 5개 중 4개가 경사면 벡터 방향을 틀렸다(DEV 로그) — 방향은 LLM 이 아니라 이 함수가 정한다.
 * 좌표: 물리 좌표(x 오른쪽, y 위). 화면 변환은 렌더러에서 y 만 뒤집는다.
 */
export const G = 9.81;
export type Vec = { x: number; y: number };
const v = (x: number, y: number): Vec => ({ x, y });
const rad = (d: number) => (d * Math.PI) / 180;

export interface InclineParams { angleDeg: number; massKg: number; mu?: number }
export interface InclineResult {
    /** 단위 벡터 — 경사 위쪽, 면 바깥 법선 */
    upSlope: Vec; normal: Vec;
    weight: number; normalForce: number; parallel: number; perpendicular: number;
    friction: number; moves: boolean; accel: number;
    /** 힘 벡터(N) — 실제 힘과 중력 분해 성분 */
    forces: { id: 'weight' | 'normal' | 'friction'; vec: Vec; mag: number }[];
    components: { id: 'parallel' | 'perpendicular'; vec: Vec; mag: number }[];
}

/** 오른쪽이 높은 경사면. 마찰은 μs=μk 로 단순화(정지면 필요한 만큼, 미끄러지면 μN). */
export const incline = ({ angleDeg, massKg, mu = 0 }: InclineParams): InclineResult => {
    const t = rad(angleDeg);
    const upSlope = v(Math.cos(t), Math.sin(t));
    const normal = v(-Math.sin(t), Math.cos(t));
    const weight = massKg * G, normalForce = weight * Math.cos(t), parallel = weight * Math.sin(t);
    const fMax = mu * normalForce, moves = parallel > fMax + 1e-9;
    const friction = moves ? fMax : parallel;
    const accel = moves ? (parallel - fMax) / massKg : 0;
    const scale = (u: Vec, k: number) => v(u.x * k, u.y * k);
    return {
        upSlope, normal, weight, normalForce, parallel, perpendicular: normalForce, friction, moves, accel,
        forces: [
            { id: 'weight', vec: v(0, -weight), mag: weight },
            { id: 'normal', vec: scale(normal, normalForce), mag: normalForce },
            ...(friction > 1e-9 ? [{ id: 'friction' as const, vec: scale(upSlope, friction), mag: friction }] : []),
        ],
        components: [
            { id: 'parallel', vec: scale(upSlope, -parallel), mag: parallel },
            { id: 'perpendicular', vec: scale(normal, -normalForce), mag: normalForce },
        ],
    };
};

export interface ProjectileParams { launchDeg: number; speed: number }
export const projectile = ({ launchDeg, speed }: ProjectileParams) => {
    const t = rad(launchDeg), vx = speed * Math.cos(t), vy = speed * Math.sin(t);
    const T = (2 * vy) / G, R = vx * T, H = (vy * vy) / (2 * G);
    const at = (time: number) => {
        const tt = Math.max(0, Math.min(T, time));
        return { t: tt, pos: v(vx * tt, vy * tt - 0.5 * G * tt * tt), vel: v(vx, vy - G * tt) };
    };
    return { vx, vy, T, R, H, at };
};

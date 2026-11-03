/**
 * 충돌 도해의 화면 배치 — 충돌 전(위 줄)·후(아래 줄). 렌더러와 겹침 하니스가 같은 함수를 쓴다.
 * 화살표 길이는 네 속도 중 최댓값 기준 비례, 상한은 두 공 사이 간격의 절반 미만 — 마주 오는 두 화살표가 겹치지 않게.
 */
import { collision, type Vec, type CollisionParams } from './model';
import { textRect, overlaps, inside, hitsSegment, bounds, fitViewBox, type Rect } from './layout';

interface Ball { id: string; c: Vec; r: number; color: string }
interface Arrow { id: string; from: Vec; to: Vec; color: string }
interface Label { id: string; x: number; y: number; rect: Rect; text: string; fontSize: number; kind: 'v' | 'm' | 'row' }

const C1 = '#5aa9f0', C2 = '#e0558b', CM = '#8b7cf0';
const fmtV = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)} m/s`;

export const collisionScene = (p: CollisionParams, opts: { narrow: boolean; rowBefore: string; rowAfter: string; still: string }) => {
    const r = collision(p);
    const fs = opts.narrow ? 26 : 15;
    const x1 = 230, x2 = 530, rows = [130, 330];
    const mMax = Math.max(p.m1, p.m2);
    // 반지름 ∝ 세제곱근(질량) — 부피 비례. 가벼운 쪽도 보이게 하한
    const rad = (m: number) => 16 + 18 * Math.cbrt(m / mMax);
    const vMax = Math.max(Math.abs(p.v1), Math.abs(p.v2), Math.abs(r.u1), Math.abs(r.u2), 1e-9);
    const L = 100, k = L / vMax;

    const balls: Ball[] = [
        { id: 'b1', c: { x: x1, y: rows[0] }, r: rad(p.m1), color: C1 },
        { id: 'b2', c: { x: x2, y: rows[0] }, r: rad(p.m2), color: C2 },
        ...(r.merged
            ? [{ id: 'a12', c: { x: (x1 + x2) / 2, y: rows[1] }, r: rad(p.m1 + p.m2) * 0.9, color: CM }]
            : [{ id: 'a1', c: { x: x1, y: rows[1] }, r: rad(p.m1), color: C1 }, { id: 'a2', c: { x: x2, y: rows[1] }, r: rad(p.m2), color: C2 }]),
    ];
    const vel: Record<string, number> = { b1: p.v1, b2: p.v2, a1: r.u1, a2: r.u2, a12: r.u1 };
    const mass: Record<string, number> = { b1: p.m1, b2: p.m2, a1: p.m1, a2: p.m2, a12: p.m1 + p.m2 };
    const arrows: Arrow[] = balls.filter(b => Math.abs(vel[b.id]) * k >= 6).map(b => {
        const s = Math.sign(vel[b.id]), from = { x: b.c.x + s * b.r, y: b.c.y };
        return { id: b.id, from, to: { x: from.x + vel[b.id] * k, y: b.c.y }, color: b.color };
    });

    const labels: Label[] = [];
    const ballRects = balls.map(b => ({ x: b.c.x - b.r, y: b.c.y - b.r, w: b.r * 2, h: b.r * 2 }));
    const rowText = [opts.rowBefore, opts.rowAfter];
    rows.forEach((y, i) => {
        const w = textRect(0, 0, rowText[i], fs).w;
        const cx = x1 - 150 + w / 2;
        labels.push({ id: `row${i}`, x: cx, y: y - 70, rect: textRect(cx, y - 70, rowText[i], fs), text: rowText[i], fontSize: fs, kind: 'row' });
    });
    // 질량은 공 바로 아래(고정), 속도는 화살표 위 → 막히면 아래·옆 후보
    for (const b of balls) {
        const t = `${+mass[b.id].toFixed(2)} kg`;
        const c = { x: b.c.x, y: b.c.y + b.r + fs * 0.9 };
        labels.push({ id: `m-${b.id}`, x: c.x, y: c.y, rect: textRect(c.x, c.y, t, fs), text: t, fontSize: fs, kind: 'm' });
    }
    const content = bounds([...arrows.map(a => a.to)], [...ballRects, ...labels.map(l => l.rect),
        { x: x1 - 160, y: rows[0] - 95, w: x2 - x1 + 320, h: rows[1] - rows[0] + 190 }]);
    const viewBox = fitViewBox(content, opts.narrow, opts.narrow ? 620 / 420 : 760 / 440);
    const ok = (rc: Rect) => inside(rc, viewBox) && !ballRects.some(b => overlaps(rc, b)) && !labels.some(l => overlaps(rc, l.rect))
        && !arrows.some(a => hitsSegment(rc, a.from, a.to));
    for (const b of balls) {
        const v = vel[b.id], a = arrows.find(x => x.id === b.id);
        const t = a ? fmtV(v) : opts.still;
        const mid = a ? { x: (a.from.x + a.to.x) / 2, y: b.c.y } : b.c;
        const cands: Vec[] = [
            { x: mid.x, y: b.c.y - fs * 1.1 }, { x: mid.x, y: b.c.y - b.r - fs * 0.9 },
            { x: mid.x, y: b.c.y - fs * 2.3 }, { x: b.c.x, y: b.c.y - b.r - fs * 2 },
            { x: mid.x, y: b.c.y + fs * 1.1 }, { x: mid.x, y: b.c.y + b.r + fs * 2.1 },
        ];
        const pick = cands.map(q => ({ q, rc: textRect(q.x, q.y, t, fs) })).find(({ rc }) => ok(rc))
            ?? { q: cands[0], rc: textRect(cands[0].x, cands[0].y, t, fs) };
        labels.push({ id: `v-${b.id}`, x: pick.q.x, y: pick.q.y, rect: pick.rc, text: t, fontSize: fs, kind: 'v' });
    }
    return { model: r, viewBox, balls, arrows, labels, rows, divider: (rows[0] + rows[1]) / 2 };
};

/**
 * 자유물체도 화면 배치 — 물체 가운데에서 힘 화살표, 라벨은 후보 자리 탐색. 렌더러와 겹침 하니스가 같은 함수를 쓴다.
 * 화살표 길이: 물체 가장자리까지 + 바깥 부분이 크기에 비례(최댓값 120px, 최소 24px). 가운데서 일정 길이를 깔면
 *   물체 밖으로 보이는 길이의 비가 실제 크기 비와 달라진다(29 N 과 40 N 이 거의 같아 보였다). 크기가 없으면 같은 길이.
 * 거의 같은 방향의 화살표는 옆으로 비켜 그린다 — 겹쳐 하나로 보이면 힘 하나가 사라진 것처럼 읽힌다.
 */
import { freeBody, type Vec, type BodyForce } from './model';
import { textRect, overlaps, inside, hitsSegment, bounds, fitViewBox, type Rect } from './layout';

const FORCE_SYMBOL: Record<string, string> = {
    gravity: 'mg', normal: 'N', friction: 'f', tension: 'T', buoyancy: 'F_b', drag: 'D', applied: 'F', spring: 'F_s', other: 'F',
};

interface Arrow { id: string; i: number; from: Vec; to: Vec; kind: string; net?: boolean }
interface Label { id: string; x: number; y: number; rect: Rect; text: string; fontSize: number }

export const freeBodyScene = (forces: BodyForce[], opts: { narrow: boolean; shape: 'circle' | 'rectangle'; showNet: boolean }) => {
    const fb = freeBody(forces);
    const fs = opts.narrow ? 26 : 15;
    const c = { x: 380, y: 230 };
    const half = opts.shape === 'circle' ? { w: 42, h: 42 } : { w: 56, h: 38 };
    const body: Rect = { x: c.x - half.w, y: c.y - half.h, w: half.w * 2, h: half.h * 2 };
    const maxN = Math.max(...forces.map(f => f.magnitudeN ?? 0), 1e-9);
    // 가운데에서 물체 가장자리까지의 거리 — 원은 반지름, 사각형은 방향에 따라
    const edge = (ux: number, uy: number) => opts.shape === 'circle' ? half.w
        : Math.min(Math.abs(ux) > 1e-9 ? half.w / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? half.h / Math.abs(uy) : Infinity);
    const len = (f: BodyForce, ux: number, uy: number) => edge(ux, uy) + (fb.known ? Math.max(24, 120 * (f.magnitudeN! / maxN)) : 90);

    const arrows: Arrow[] = forces.map((f, i) => {
        const t = (f.angleDeg * Math.PI) / 180, ux = Math.cos(t), uy = -Math.sin(t);
        // 같은 방향(±8°)의 앞선 힘 수만큼 수직으로 비켜 선다
        const dup = forces.slice(0, i).filter(g => Math.abs(((g.angleDeg - f.angleDeg + 540) % 360) - 180) < 8).length;
        const off = dup * 14, from = { x: c.x - uy * off, y: c.y + ux * off };
        const L = len(f, ux, uy);
        return { id: `f${i}`, i, kind: f.kind, from, to: { x: from.x + ux * L, y: from.y + uy * L } };
    });
    if (opts.showNet && fb.net && !fb.balanced && fb.netMag) {
        const ux = fb.net.x / fb.netMag, uy = -fb.net.y / fb.netMag, L = edge(ux, uy) + Math.max(24, 120 * Math.min(1, fb.netMag / maxN));
        arrows.push({ id: 'net', i: -1, kind: 'net', from: c, to: { x: c.x + ux * L, y: c.y + uy * L }, net: true });
    }

    // viewBox 는 화살표 끝 + 라벨 여유 — 알짜힘 표시를 켜고 끌 때 흔들리지 않게 최대 길이 원을 넣는다
    const R = Math.max(half.w, half.h) * 1.5 + 120 + fs * 2.4;
    const content = bounds([...arrows.map(a => a.to), { x: c.x - R, y: c.y }, { x: c.x + R, y: c.y }, { x: c.x, y: c.y - R }, { x: c.x, y: c.y + R }], [body]);
    const viewBox = fitViewBox(content, opts.narrow, opts.narrow ? 620 / 520 : 760 / 520);

    const labels: Label[] = [];
    const text = (a: Arrow) => a.net ? 'ΣF' : forces[a.i].kind === 'other' && forces[a.i].label ? forces[a.i].label!.slice(0, 6) : FORCE_SYMBOL[a.kind];
    const ok = (rc: Rect) => inside(rc, viewBox) && !overlaps(rc, body) && !labels.some(l => overlaps(rc, l.rect))
        && !arrows.some(o => hitsSegment(rc, o.from, o.to));
    for (const a of [...arrows].sort((m, n) => Math.hypot(n.to.x - n.from.x, n.to.y - n.from.y) - Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y))) {
        const t = text(a);
        const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, px = -uy, py = ux;
        const tw = textRect(0, 0, t, fs).w, gap = Math.abs(ux) * tw / 2 + Math.abs(uy) * fs * 0.6 + 6, side = Math.abs(px) * tw / 2 + Math.abs(py) * fs * 0.6 + 8;
        const cands: Vec[] = [
            { x: a.to.x + ux * gap, y: a.to.y + uy * gap },
            { x: a.to.x + px * side, y: a.to.y + py * side }, { x: a.to.x - px * side, y: a.to.y - py * side },
            ...[0.75, 0.6].flatMap(k => [{ x: a.from.x + dx * k + px * side, y: a.from.y + dy * k + py * side }, { x: a.from.x + dx * k - px * side, y: a.from.y + dy * k - py * side }]),
            ...Array.from({ length: 6 }, (_, j) => ({ x: a.to.x + ux * (gap + 8 * (j + 1)), y: a.to.y + uy * (gap + 8 * (j + 1)) })),
            ...Array.from({ length: 6 }, (_, j) => ({ x: a.to.x + ux * gap + px * side * (1 + j * 0.6), y: a.to.y + uy * gap + py * side * (1 + j * 0.6) })),
            ...Array.from({ length: 6 }, (_, j) => ({ x: a.to.x + ux * gap - px * side * (1 + j * 0.6), y: a.to.y + uy * gap - py * side * (1 + j * 0.6) })),
        ];
        const pick = cands.map(q => ({ q, rc: textRect(q.x, q.y, t, fs) })).find(({ rc }) => ok(rc))
            ?? { q: cands[0], rc: textRect(cands[0].x, cands[0].y, t, fs) };
        labels.push({ id: a.id, x: pick.q.x, y: pick.q.y, rect: pick.rc, text: t, fontSize: fs });
    }
    return { model: fb, viewBox, c, body, arrows, labels };
};

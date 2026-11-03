/**
 * 경사면 도해의 화면 배치 — 도형·화살표·라벨 위치와 viewBox 를 계산한다. 렌더러와 겹침 하니스가 같은 함수를 쓴다.
 * 라벨은 후보 자리를 차례로 시험해 상자·다른 라벨·다른 화살표와 겹치지 않는 첫 자리에 둔다(라벨 3~5개라 탐욕법으로 충분).
 */
import { incline, type Vec, type InclineParams } from './model';
import { textRect, overlaps, hitsSegment, bounds, fitViewBox, type Rect } from './layout';

interface SceneArrow { id: string; from: Vec; to: Vec; label: string; dashed: boolean }
interface SceneLabel { id: string; x: number; y: number; rect: Rect; text: string; fontSize: number }
interface InclineScene {
    viewBox: Rect; floorY: number; wedge: Vec[]; angleLabel: Vec;
    block: { c: Vec; w: number; h: number; rot: number; rect: Rect };
    arrows: SceneArrow[]; labels: SceneLabel[];
}

const FULL: Record<string, string> = { weight: 'mg', normal: 'N', friction: 'f', parallel: 'mg sinθ', perpendicular: 'mg cosθ' };
// 모바일은 라벨 면적을 줄인다 — 전체 이름은 지표 카드·범례에 있다
const SHORT: Record<string, string> = { ...FULL, parallel: 'mg∥', perpendicular: 'mg⊥' };

export const inclineScene = (p: InclineParams, opts: { tab: 'forces' | 'components'; narrow: boolean }): InclineScene => {
    const r = incline(p), t = (p.angleDeg * Math.PI) / 180;
    const fs = opts.narrow ? 26 : 15, names = opts.narrow ? SHORT : FULL;
    const ox = 150, oy = 380, L = Math.min(520, 300 / Math.max(Math.sin(t), 0.2));
    const S = (q: Vec): Vec => ({ x: ox + q.x, y: oy - q.y });
    const top = S({ x: L * Math.cos(t), y: L * Math.sin(t) });
    const contact = { x: L * 0.55 * Math.cos(t), y: L * 0.55 * Math.sin(t) };
    const bw = 76, bh = 48;
    const centerP = { x: contact.x + r.normal.x * bh / 2, y: contact.y + r.normal.y * bh / 2 };
    const c = S(centerP);
    // 회전한 상자의 외접 사각형
    const ex = (Math.abs(Math.cos(t)) * bw + Math.abs(Math.sin(t)) * bh) / 2, ey = (Math.abs(Math.sin(t)) * bw + Math.abs(Math.cos(t)) * bh) / 2;
    const blockRect = { x: c.x - ex, y: c.y - ey, w: ex * 2, h: ey * 2 };
    const k = 130 / r.weight;
    const tip = (v: Vec) => S({ x: centerP.x + v.x * k, y: centerP.y + v.y * k });
    const vecs = opts.tab === 'forces' ? r.forces : [r.forces[0], ...r.components];
    const arrows: SceneArrow[] = vecs.map(f => ({ id: f.id, from: c, to: tip(f.vec), label: names[f.id], dashed: f.id === 'parallel' || f.id === 'perpendicular' }));

    const angleLabel = { x: ox + 76, y: oy - 12 };
    const fixed: Rect[] = [blockRect, textRect(angleLabel.x + 30, angleLabel.y - 4, `θ = ${p.angleDeg}°`, opts.narrow ? 24 : 14)];
    const labels: SceneLabel[] = [];
    // 긴 화살표부터 자리를 잡는다 — 짧은 화살표 라벨이 옮겨 갈 여지가 더 많다
    for (const a of [...arrows].sort((m, n) => Math.hypot(n.to.x - n.from.x, n.to.y - n.from.y) - Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y))) {
        const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, px = -uy, py = ux;
        const tw = [...a.label].length * fs * 0.62 + 6, gap = Math.abs(ux) * tw / 2 + Math.abs(uy) * fs * 0.6 + 6;
        const mid = { x: a.from.x + dx * 0.6, y: a.from.y + dy * 0.6 };
        const side = Math.abs(px) * tw / 2 + Math.abs(py) * fs * 0.6 + 8;
        const cands: Vec[] = [
            ...(len > 40 ? [{ x: a.to.x + ux * gap, y: a.to.y + uy * gap }] : []),
            { x: a.to.x + px * side, y: a.to.y + py * side }, { x: a.to.x - px * side, y: a.to.y - py * side },
            { x: mid.x + px * side, y: mid.y + py * side }, { x: mid.x - px * side, y: mid.y - py * side },
            { x: a.to.x + ux * (gap + fs), y: a.to.y + uy * (gap + fs) },
            { x: a.to.x + px * side * 2, y: a.to.y + py * side * 2 }, { x: a.to.x - px * side * 2, y: a.to.y - py * side * 2 },
            // 짧은 화살표는 끝점이 상자 안에 있다 — 화살표 방향으로 조금씩 밀어 상자 밖 빈자리를 찾는다
            ...Array.from({ length: 24 }, (_, i) => ({ x: a.to.x + ux * (gap + 8 * (i + 1)), y: a.to.y + uy * (gap + 8 * (i + 1)) })),
        ];
        const others = arrows.filter(o => o.id !== a.id);
        const ok = (rc: Rect) => !fixed.some(f => overlaps(rc, f)) && !labels.some(l => overlaps(rc, l.rect)) && !others.some(o => hitsSegment(rc, o.from, o.to));
        const pick = cands.map(q => ({ q, rc: textRect(q.x, q.y, a.label, fs) })).find(({ rc }) => ok(rc))
            ?? { q: cands[0], rc: textRect(cands[0].x, cands[0].y, a.label, fs) };
        labels.push({ id: a.id, x: pick.q.x, y: pick.q.y, rect: pick.rc, text: a.label, fontSize: fs });
    }

    // viewBox 를 내용에 맞춘다(가로세로 비율 고정) — 완경사에서 위쪽 빈 공간이 도해를 작게 만들었다
    const wedge = [{ x: ox, y: oy }, top, { x: top.x, y: oy }];
    const content = bounds([...wedge, ...arrows.map(a => a.to)], [blockRect, ...labels.map(l => l.rect), ...fixed]);
    const viewBox = fitViewBox(content, opts.narrow);
    return { viewBox, floorY: oy, wedge, angleLabel, block: { c, w: bw, h: bh, rot: -p.angleDeg, rect: blockRect }, arrows, labels };
};

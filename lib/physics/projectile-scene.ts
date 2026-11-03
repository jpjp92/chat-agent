/**
 * 포물선 도해의 화면 배치 — 궤적·화살표·라벨 위치와 viewBox. 렌더러와 겹침 하니스가 같은 함수를 쓴다.
 * viewBox 는 시간과 무관한 내용으로 정한다 — 시간 슬라이더를 움직일 때 도해가 흔들리지 않게.
 * H 치수선은 발사점 왼쪽에 둔다 — 최고점 세로선에 두면 공이 최고점일 때(기본값) g 화살표와 겹쳤다.
 */
import { projectile, type Vec, type ProjectileParams } from './model';
import { textRect, overlaps, inside, hitsSegment, bounds, fitViewBox, type Rect } from './layout';

interface Label { id: string; x: number; y: number; rect: Rect; text: string; fontSize: number }
interface Arrow { id: 'velocity' | 'gravity' | 'v0'; from: Vec; to: Vec }

const GLEN = 55;

export const projectileScene = (p: ProjectileParams, opts: { frac: number; narrow: boolean }) => {
    const m = projectile(p), rad = (p.launchDeg * Math.PI) / 180;
    // 모바일은 라벨을 짧게(H·R 값은 바로 아래 지표 카드에 있다) — 긴 라벨이 viewBox 를 988 까지 넓혀 실제 글자가 9px 로 줄었다
    const fs = opts.narrow ? 30 : 17;
    // 속도 화살표 px/(m/s) — 40 m/s 를 넘으면 길이를 160px 로 묶는다(빠른 공에서 화살표가 궤적보다 길어졌다)
    const VS = 4 * Math.min(1, 40 / p.speed);
    // 가로·세로 같은 축척 — 모양이 실제 궤적과 같다
    const k = Math.min(560 / Math.max(m.R, 0.1), 280 / Math.max(m.H, 0.1));
    const ox = 90, oy = 370;
    const S = (q: Vec): Vec => ({ x: ox + q.x * k, y: oy - q.y * k });
    const path = Array.from({ length: 121 }, (_, i) => S(m.at((m.T * i) / 120).pos));
    const peak = S({ x: m.R / 2, y: m.H }), land = S({ x: m.R, y: 0 }), origin = { x: ox, y: oy };
    const hx = ox - 36;
    const v0: Arrow = { id: 'v0', from: origin, to: { x: ox + p.speed * Math.cos(rad) * VS, y: oy - p.speed * Math.sin(rad) * VS } };

    const fixed: Label[] = [];
    const put = (id: string, text: string, c: Vec) => fixed.push({ id, x: c.x, y: c.y, rect: textRect(c.x, c.y, text, fs), text, fontSize: fs });
    const hText = opts.narrow ? 'H' : `H = ${m.H.toFixed(2)} m`;
    put('H', hText, { x: hx - 10 - textRect(0, 0, hText, fs).w / 2, y: (peak.y + oy) / 2 });
    // 시간과 무관한 최대 범위 — 모든 시각의 속도 화살표 끝과 g 화살표 끝, 이동 라벨 여유
    const tips = Array.from({ length: 21 }, (_, i) => {
        const s = m.at((m.T * i) / 20), b = S(s.pos);
        return [{ x: b.x + s.vel.x * VS, y: b.y - s.vel.y * VS }, { x: b.x, y: b.y + GLEN }];
    }).flat();
    const margin = fs * (opts.narrow ? 2 : 3.6);
    const content = bounds([...path, v0.to, origin, { x: hx, y: oy }], fixed.map(l => l.rect));
    const grown = bounds([...tips], [{ x: content.x - margin, y: content.y - margin, w: content.w + margin * 2, h: content.h + margin * 2 }]);
    const viewBox = fitViewBox(grown, opts.narrow, opts.narrow ? 620 / 300 : 760 / 280);

    const now = m.at(m.T * Math.min(1, Math.max(0, opts.frac))), ball = S(now.pos);
    const ballRect: Rect = { x: ball.x - 11, y: ball.y - 11, w: 22, h: 22 };
    const arrows: Arrow[] = [
        v0,
        { id: 'velocity', from: ball, to: { x: ball.x + now.vel.x * VS, y: ball.y - now.vel.y * VS } },
        { id: 'gravity', from: ball, to: { x: ball.x, y: ball.y + GLEN } },
    ];
    const segs: [Vec, Vec][] = [...arrows.map(a => [a.from, a.to] as [Vec, Vec]), [{ x: hx, y: oy }, { x: hx, y: peak.y }], [{ x: hx, y: peak.y }, peak]];

    const labels: Label[] = [...fixed];
    const ok = (rc: Rect) => inside(rc, viewBox) && !overlaps(rc, ballRect) && !labels.some(l => overlaps(rc, l.rect))
        && !segs.some(([s, e]) => hitsSegment(rc, s, e));
    const place = (id: string, text: string, cands: Vec[]) => {
        const pick = cands.map(q => ({ q, rc: textRect(q.x, q.y, text, fs) })).find(({ rc }) => ok(rc))
            ?? { q: cands[0], rc: textRect(cands[0].x, cands[0].y, text, fs) };
        labels.push({ id, x: pick.q.x, y: pick.q.y, rect: pick.rc, text, fontSize: fs });
    };
    const below = oy + fs * 1.2;
    // 착지 순간엔 g 화살표가 바닥 아래로 내려온다 — R 은 착지점 좌우로 비켜 설 자리를 둔다
    const rText = opts.narrow ? 'R' : `R = ${m.R.toFixed(2)} m`, rw = textRect(0, 0, rText, fs).w;
    place('R', rText, [{ x: land.x, y: below }, { x: land.x - rw / 2 - 14, y: below }, { x: land.x + rw / 2 + 14, y: below }, { x: land.x - rw / 2 - 14, y: below + fs * 1.3 }]);
    // 완만한 발사각에선 호 안쪽이 v₀ 화살표에 붙는다 — 그때는 바닥 아래로
    const thText = opts.narrow ? `${p.launchDeg}°` : `θ = ${p.launchDeg}°`, thw = textRect(0, 0, thText, fs).w, thR = 52 + thw / 2;
    place('theta', thText, [{ x: ox + thR * Math.cos(rad / 2), y: oy - thR * Math.sin(rad / 2) }, { x: ox + 30 + thw / 2, y: below }, { x: ox + 30 + thw / 2, y: below + fs * 1.3 }]);
    for (const [id, text] of [['v0', 'v₀'], ['velocity', 'v(t)'], ['gravity', 'g']] as const) {
        const a = arrows.find(x => x.id === id)!;
        const dx = a.to.x - a.from.x, dy = a.to.y - a.from.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, px = -uy, py = ux;
        const tw = textRect(0, 0, text, fs).w, gap = Math.abs(ux) * tw / 2 + Math.abs(uy) * fs * 0.6 + 6, side = Math.abs(px) * tw / 2 + Math.abs(py) * fs * 0.6 + 8;
        const mid = { x: a.from.x + dx * 0.6, y: a.from.y + dy * 0.6 };
        place(id, text, [
            { x: a.to.x + ux * gap, y: a.to.y + uy * gap },
            { x: a.to.x + px * side, y: a.to.y + py * side }, { x: a.to.x - px * side, y: a.to.y - py * side },
            { x: mid.x + px * side, y: mid.y + py * side }, { x: mid.x - px * side, y: mid.y - py * side },
            ...Array.from({ length: 8 }, (_, i) => ({ x: a.to.x + px * side * (2 + i * 0.5), y: a.to.y + py * side * (2 + i * 0.5) })),
            ...Array.from({ length: 8 }, (_, i) => ({ x: a.to.x - px * side * (2 + i * 0.5), y: a.to.y - py * side * (2 + i * 0.5) })),
            // 착지 순간처럼 끝점 쪽이 막히면 시작점 뒤쪽(공 반대편)으로
            ...Array.from({ length: 6 }, (_, i) => ({ x: a.from.x - ux * (gap + 14 + i * fs * 0.6), y: a.from.y - uy * (gap + 14 + i * fs * 0.6) })),
            ...Array.from({ length: 6 }, (_, i) => ({ x: a.from.x - ux * (gap + 14) + px * side * (1 + i * 0.5), y: a.from.y - uy * (gap + 14) + py * side * (1 + i * 0.5) })),
        ]);
    }
    return { model: m, now, viewBox, floorY: oy, origin, path, peak, hx, ball, ballRect, arrows, labels, rad };
};

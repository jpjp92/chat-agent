/**
 * 물리 도해 계산·배치 — lib/physics 검산.
 * 방향은 LLM 이 아니라 이 코드가 정하므로(PLAN_PHYSICS_SVG_261103) 방향 오류는 여기서만 잡힌다.
 * 라벨 겹침은 5°~60° × 탭 2 × 폭 2 × 마찰 3 전 장면을 본다 — 각도 하나만 보면 37°~48° 같은 구간 회귀를 놓친다.
 */
import { incline, projectile, G } from '../lib/physics/model.js';
import { inclineScene } from '../lib/physics/incline-scene.js';
import { overlaps, inside, hitsSegment } from '../lib/physics/layout.js';
import { projectileScene } from '../lib/physics/projectile-scene.js';
import { normalizePhysics } from '../lib/physics/params.js';

let fail = 0;
const ok = (name: string, cond: boolean, d = '') => { console.log(`${cond ? '✅' : '🔴'} ${name}${d ? ` — ${d}` : ''}`); if (!cond) fail++; };
const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) <= e;

for (const angleDeg of [5, 30, 37, 60]) {
    const r = incline({ angleDeg, massKg: 2, mu: 0.2 });
    ok(`${angleDeg}° 법선 ⊥ 경사면`, near(dot(r.normal, r.upSlope), 0, 1e-9));
    ok(`${angleDeg}° 법선은 위·왼쪽(오른쪽이 높은 경사면)`, r.normal.y > 0 && r.normal.x < 0);
    const par = r.components.find(c => c.id === 'parallel')!, perp = r.components.find(c => c.id === 'perpendicular')!;
    ok(`${angleDeg}° mg sinθ 는 경사 아래`, near(dot(par.vec, r.upSlope), -r.parallel, 1e-9));
    ok(`${angleDeg}° mg cosθ 는 N 의 정반대`, near(perp.vec.x, -r.forces[1].vec.x, 1e-9) && near(perp.vec.y, -r.forces[1].vec.y, 1e-9));
    ok(`${angleDeg}° 두 성분의 합 = mg`, near(par.vec.x + perp.vec.x, 0, 1e-9) && near(par.vec.y + perp.vec.y, -r.weight, 1e-9));
    const fr = r.forces.find(f => f.id === 'friction');
    if (fr) ok(`${angleDeg}° 마찰은 경사 위`, dot(fr.vec, r.upSlope) > 0);
}
const s = incline({ angleDeg: 37, massKg: 5.5 });
ok('37°·5.5kg mg 53.96 · N 43.09 · mg sinθ 32.47 · a 5.90',
    near(s.weight, 53.96) && near(s.normalForce, 43.09) && near(s.parallel, 32.47) && near(s.accel, 5.90));
const still = incline({ angleDeg: 10, massKg: 5, mu: 0.5 });
ok('μ 큰 완경사 — 정지, 마찰 = mg sinθ, a = 0', !still.moves && near(still.friction, still.parallel, 1e-9) && still.accel === 0);
const slide = incline({ angleDeg: 30, massKg: 5, mu: 0.3 });
ok('30°·μ0.3 — 미끄러짐, a = g(sinθ − μcosθ)', slide.moves && near(slide.accel, G * (Math.sin(Math.PI / 6) - 0.3 * Math.cos(Math.PI / 6))));
const p = projectile({ launchDeg: 45, speed: 20 });
ok('포물선 45° R = v²/g · 착지 y=0 · 최고점 vᵧ=0',
    near(p.R, 400 / G) && near(p.at(p.T).pos.y, 0, 1e-9) && near(p.at(p.T / 2).vel.y, 0, 1e-9));

let bad = 0, total = 0;
const fails: string[] = [];
for (const narrow of [false, true]) for (const tab of ['forces', 'components'] as const) for (const mu of [undefined, 0.3, 0.9]) for (let a = 5; a <= 60; a++) {
    total++;
    const sc = inclineScene({ angleDeg: a, massKg: 5, mu }, { tab, narrow });
    const why: string[] = [];
    sc.labels.forEach((l, i) => {
        if (overlaps(l.rect, sc.block.rect)) why.push(`${l.text}↔상자`);
        sc.labels.slice(i + 1).forEach(m => { if (overlaps(l.rect, m.rect)) why.push(`${l.text}↔${m.text}`); });
        const v = sc.viewBox;
        if (l.rect.x < v.x || l.rect.y < v.y || l.rect.x + l.rect.w > v.x + v.w || l.rect.y + l.rect.h > v.y + v.h) why.push(`${l.text} 잘림`);
    });
    if (why.length) { bad++; if (fails.length < 12) fails.push(`${narrow ? '모바일' : 'PC'} ${tab} μ=${mu ?? '-'} ${a}°: ${why.join(', ')}`); }
}
fails.forEach(f => console.log('🔴', f));
ok(`라벨 겹침·잘림 — ${total}개 장면`, bad === 0, `${bad}개`);

// 포물선 — 발사각 10°~80° × 속력 3 × 시각 5 × 폭 2. 시간 슬라이더 위치마다 라벨이 화살표·공·서로를 피해야 한다
{
    let bad = 0, total = 0, unstable = 0;
    const fails: string[] = [];
    for (const narrow of [false, true]) for (let deg = 10; deg <= 80; deg += 5) for (const speed of [5, 20, 40, 120]) {
        const vbs = new Set<string>();
        for (const frac of [0, 0.25, 0.5, 0.75, 1]) {
            total++;
            const sc = projectileScene({ launchDeg: deg, speed }, { frac, narrow });
            vbs.add(JSON.stringify(sc.viewBox));
            const why: string[] = [];
            sc.labels.forEach((l, i) => {
                if (!inside(l.rect, sc.viewBox)) why.push(`${l.text} 잘림`);
                if (overlaps(l.rect, sc.ballRect) && l.id !== 'v0' && l.id !== 'theta') why.push(`${l.text}↔공`);
                sc.labels.slice(i + 1).forEach(m => { if (overlaps(l.rect, m.rect)) why.push(`${l.text}↔${m.text}`); });
                sc.arrows.forEach(a => { if (hitsSegment(l.rect, a.from, a.to)) why.push(`${l.text}↔${a.id} 화살표`); });
            });
            if (why.length) { bad++; if (fails.length < 12) fails.push(`${narrow ? '모바일' : 'PC'} ${deg}° ${speed}m/s t=${frac}: ${why.join(', ')}`); }
        }
        if (vbs.size !== 1) unstable++;
    }
    fails.forEach(f => console.log('🔴', f));
    ok(`포물선 라벨 겹침·잘림 — ${total}개 장면`, bad === 0, `${bad}개`);
    ok('포물선 viewBox 는 시간 슬라이더와 무관', unstable === 0, `${unstable}개 조건에서 흔들림`);
}

// 형식 판정 — 옛 대화(forces 형식)는 canvas 로 남아야 한다
ok('forces 형식은 SVG 대상 아님', normalizePhysics({ type: 'inclined_plane', angle: 30, forces: [] }) === null);
ok('parameters 경사면 → 범위로 잘림', JSON.stringify(normalizePhysics({ type: 'inclined_plane', parameters: { angleDeg: 80, massKg: 0, mu: 2 } })?.parameters)
    === JSON.stringify({ angleDeg: 60, massKg: 0.1, mu: 1 }));
ok('100kg 은 자르지 않는다(카드 mg = 981 N)', normalizePhysics({ type: 'inclined_plane', parameters: { angleDeg: 30, massKg: 100 } })?.parameters.massKg === 100);
ok('μ 없으면 마찰 없는 경사면', normalizePhysics({ type: 'inclined_plane', parameters: { angleDeg: 30, massKg: 2 } })?.parameters.hasOwnProperty('mu') === false);
ok('숫자 아닌 값은 null(canvas 로)', normalizePhysics({ type: 'inclined_plane', parameters: { angleDeg: '30도', massKg: 2 } }) === null);
ok('parameters 포물선', normalizePhysics({ type: 'projectile', parameters: { launchDeg: 45, speed: 20 } })?.type === 'projectile');
ok('free_body 는 SVG 대상 아님', normalizePhysics({ type: 'free_body', parameters: { angleDeg: 30 } }) === null);

console.log(`\n✅ 통과 · 실패 ${fail}`);
if (fail) process.exit(1);

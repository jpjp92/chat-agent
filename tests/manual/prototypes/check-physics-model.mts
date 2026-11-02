/** physics-model 검산 — 방향(내적)과 Claude 웹 샘플 수치. `npx tsx tests/manual/prototypes/check-physics-model.mts` */
import { incline, projectile, G } from './physics-model';
let fail = 0;
const ok = (name: string, cond: boolean, d = '') => { console.log(`${cond ? '✅' : '🔴'} ${name}${d ? ` — ${d}` : ''}`); if (!cond) fail++; };
const dot = (a: { x: number; y: number }, b: { x: number; y: number }) => a.x * b.x + a.y * b.y;
const near = (a: number, b: number, e = 0.01) => Math.abs(a - b) <= e;

for (const angleDeg of [5, 30, 37, 60]) {
    const r = incline({ angleDeg, massKg: 2, mu: 0.2 });
    ok(`${angleDeg}° 법선 ⊥ 경사면`, near(dot(r.normal, r.upSlope), 0, 1e-9));
    ok(`${angleDeg}° 법선은 위쪽(y>0)·오른쪽 높은 경사면에선 왼쪽(x<0)`, r.normal.y > 0 && r.normal.x < 0);
    const par = r.components.find(c => c.id === 'parallel')!, perp = r.components.find(c => c.id === 'perpendicular')!;
    ok(`${angleDeg}° mg sinθ 는 경사 아래(내적 −|v|)`, near(dot(par.vec, r.upSlope), -r.parallel, 1e-9));
    ok(`${angleDeg}° mg cosθ 는 N 의 정반대`, near(perp.vec.x, -r.forces[1].vec.x, 1e-9) && near(perp.vec.y, -r.forces[1].vec.y, 1e-9));
    ok(`${angleDeg}° 두 성분의 합 = mg`, near(par.vec.x + perp.vec.x, 0, 1e-9) && near(par.vec.y + perp.vec.y, -r.weight, 1e-9));
    const fr = r.forces.find(f => f.id === 'friction');
    if (fr) ok(`${angleDeg}° 마찰은 경사 위쪽`, dot(fr.vec, r.upSlope) > 0);
}
const s = incline({ angleDeg: 37, massKg: 5.5 });
ok('Claude 샘플 mg 53.96', near(s.weight, 53.96)); ok('N 43.09', near(s.normalForce, 43.09));
ok('mg sinθ 32.47', near(s.parallel, 32.47)); ok('a 5.90', near(s.accel, 5.90));
const still = incline({ angleDeg: 10, massKg: 5, mu: 0.5 });
ok('μ 큰 완경사 — 정지, 마찰 = mg sinθ, a = 0', !still.moves && near(still.friction, still.parallel, 1e-9) && still.accel === 0);
const slide = incline({ angleDeg: 30, massKg: 5, mu: 0.3 });
ok('30°·μ0.3 — 미끄러짐, a = g(sinθ − μcosθ)', slide.moves && near(slide.accel, G * (Math.sin(Math.PI / 6) - 0.3 * Math.cos(Math.PI / 6))));
const p = projectile({ launchDeg: 45, speed: 20 });
ok('포물선 45° R = v²/g', near(p.R, 400 / G)); ok('착지 y=0', near(p.at(p.T).pos.y, 0, 1e-9)); ok('최고점 vᵧ=0', near(p.at(p.T / 2).vel.y, 0, 1e-9));
console.log(`\n실패 ${fail}`); if (fail) process.exit(1);

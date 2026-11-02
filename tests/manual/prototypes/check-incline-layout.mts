/** 경사면 라벨 겹침 검사 — 5°~60° × 탭 2 × 폭 2 × 마찰 유무. `npx tsx tests/manual/prototypes/check-incline-layout.mts` */
import { inclineScene, overlaps } from './incline-scene';
let bad = 0, total = 0;
const fails: string[] = [];
for (const narrow of [false, true]) for (const tab of ['forces', 'components'] as const) for (const mu of [undefined, 0.3, 0.9]) for (let a = 5; a <= 60; a++) {
    total++;
    const s = inclineScene({ angleDeg: a, massKg: 5, mu }, { tab, narrow });
    const why: string[] = [];
    s.labels.forEach((l, i) => {
        if (overlaps(l.rect, s.block.rect)) why.push(`${l.text}↔상자`);
        s.labels.slice(i + 1).forEach(m => { if (overlaps(l.rect, m.rect)) why.push(`${l.text}↔${m.text}`); });
        const v = s.viewBox;
        if (l.rect.x < v.x || l.rect.y < v.y || l.rect.x + l.rect.w > v.x + v.w || l.rect.y + l.rect.h > v.y + v.h) why.push(`${l.text} 잘림`);
    });
    if (why.length) { bad++; if (fails.length < 12) fails.push(`${narrow ? '모바일' : 'PC'} ${tab} μ=${mu ?? '-'} ${a}°: ${why.join(', ')}`); }
}
fails.forEach(f => console.log('🔴', f));
console.log(`\n${total}개 장면 중 겹침·잘림 ${bad}개`);
if (bad) process.exit(1);

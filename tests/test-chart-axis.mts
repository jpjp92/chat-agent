/**
 * 차트 x축 판정 하니스 — `npx tsx tests/test-chart-axis.mts`
 * 계획: docs/plans/PLAN_CHART_AXIS_261105.md §2 · 픽셀 간격은 tests/manual/check-chart-axis-pixels.py
 *
 * 숫자 x 를 범주로 놓으면 차트는 그려지지만 좌표가 틀린다(11-05: 1970·1980…2020·2021 이 같은 폭).
 */
import { resolveXAxis, isEvenlySpaced, numericAxisOptions, numericTickLabel } from '../components/chart-axis.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const pts = (xs: number[], f: (x: number) => number) => xs.map(x => ({ x, y: f(x) }));

// AX-01 불규칙 x 점 → numeric, x 보존
const a1 = resolveXAxis('line', [{ name: 'y', data: pts([0, 1, 2, 10], x => x * x) }], []);
check('AX-01 {x,y} 불규칙 → numeric', a1.scale === 'numeric' && a1.categories.length === 0);
check('AX-01 x 값 보존', JSON.stringify((a1.series[0].data as any[]).map(d => d.x)) === '[0,1,2,10]');

// AX-02·03 함수 점(음수·소수 x)
const xs = Array.from({ length: 13 }, (_, i) => -3 + i * 0.5);
const a2 = resolveXAxis('line', [{ data: pts(xs, x => x * x) }], []);
check('AX-02 y = x² 점 → numeric', a2.scale === 'numeric' && !a2.integerX);
const a3 = resolveXAxis('line', [{ data: pts(Array.from({ length: 9 }, (_, i) => -Math.PI + i * Math.PI / 4), Math.sin) }], []);
check('AX-03 sin(x) 점 → numeric', a3.scale === 'numeric');

// AX-04 불규칙 연도 범주 → numeric, 정수 눈금
const a4 = resolveXAxis('line', [{ data: [1006645, 862835, 640089, 272337, 260562] }], ['1970', '1980', '2000', '2020', '2021']);
check('AX-04 불규칙 연도 → numeric', a4.scale === 'numeric' && a4.integerX);
check('AX-04 값-연도 짝 유지', JSON.stringify((a4.series[0].data as any[])[2]) === '{"x":2000,"y":640089}');

// AX-05 등간격 연도·막대 → category(기존 동작)
const a5 = resolveXAxis('line', [{ data: [1, 2, 3, 4, 5, 6] }], ['2020', '2021', '2022', '2023', '2024', '2025']);
check('AX-05 등간격 연도 선 → category(라벨 그대로)', a5.scale === 'category' && a5.categories[0] === '2020');
const a5b = resolveXAxis('bar', [{ data: [1, 2, 3] }], ['1970', '2000', '2021']);
check('막대는 불규칙 숫자 범주여도 category', a5b.scale === 'category');
const a5c = resolveXAxis('line', [{ data: [4, 3, 2, 1, 0] }], ['-0.4', '-0.2', '0', '0.2', '0.4']);
check('등간격 소수 범주(변위) → category', a5c.scale === 'category');

// AX-06 산점도
const a6 = resolveXAxis('scatter', [{ data: pts([1, 2, 3], x => [2, 4, 1][x - 1]) }], []);
check('AX-06 산점도 → numeric', a6.scale === 'numeric');

// AX-07 문자열 범주
const a7 = resolveXAxis('line', [{ data: Array(12).fill(1) }], Array.from({ length: 12 }, (_, i) => `${i + 1}월`));
check('AX-07 "1월"… → category', a7.scale === 'category');
const a7b = resolveXAxis('line', [{ data: [1, 2, 3] }], ['2021년', '2022년', '2025년']);
check('"2021년" 처럼 단위 붙은 연도 → category', a7b.scale === 'category');

// 숫자 아닌 {x,y} → category, 시리즈끼리 x 로 맞춤
const a8 = resolveXAxis('line', [{ data: [{ x: 'A', y: 1 }, { x: 'B', y: 2 }] }, { data: [{ x: 'B', y: 5 }] }], []);
check('이름 x {x,y} → category · 없는 칸 null', a8.scale === 'category' && JSON.stringify(a8.series[1].data) === '[null,5]');
const a9 = resolveXAxis('bar', [{ data: pts([1, 2, 10], x => x) }], []);
check('막대 {x,y} 숫자 → category', a9.scale === 'category' && a9.categories.join() === '1,2,10');
const a10 = resolveXAxis('line', [{ data: [{ x: '-3', y: 9 }, { x: '0', y: 0 }, { x: '3', y: 9 }] }], []);
check('숫자 문자열 x → numeric', a10.scale === 'numeric' && (a10.series[0].data[0] as any).x === -3);

check('isEvenlySpaced 내림차순', isEvenlySpaced([3, 2, 1, 0]));
check('isEvenlySpaced 같은 값 반복은 불균등', !isEvenlySpaced([1, 1, 1]));

// 눈금 — 깔끔한 간격·양끝 배수(눈금 숫자와 위치가 일치), 데이터보다 가장 덜 넓어지는 간격
const o1 = numericAxisOptions(a2.series, true) as any;
check(`y = x² 모바일 축 −3~3 그대로 (${o1.min}~${o1.max}, 눈금 ${o1.tickAmount})`, o1.min === -3 && o1.max === 3);
const o2 = numericAxisOptions(a4.series, false) as any;
check(`불규칙 연도 축 1970~2030·간격 10 (${o2.min}~${o2.max}/${o2.tickAmount})`, o2.min === 1970 && o2.max === 2030 && o2.tickAmount === 6);
const o3 = numericAxisOptions(a1.series, false) as any;
check(`0~10 축 그대로 (${o3.min}~${o3.max})`, o3.min === 0 && o3.max === 10);
check('부동소수 눈금 정리', numericTickLabel(0.30000000000000004) === '0.3' && numericTickLabel('-2') === '-2');

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);

/**
 * 차트 숫자 표시 하니스 — `npx tsx tests/test-chart-format.mts`
 * 계획: docs/plans/PLAN_CHART_P1_261105.md §4 (F-01~F-05·F-07)
 */
import { formatAxisValue, formatTooltipValue, isPreScaledUnit, markerSize, sanitizeUnit } from '../components/chart-format.js';
import { resolveXAxis } from '../components/chart-axis.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const eq = (name: string, got: unknown, want: unknown) => check(`${name} → ${JSON.stringify(got)}`, got === want, `want ${JSON.stringify(want)}`);

// F-01 한국어 만·억
eq('ko 1,000,000', formatAxisValue(1000000, 'ko'), '100만');
eq('ko 200,000', formatAxisValue(200000, 'ko'), '20만');
eq('ko 1,006,645', formatAxisValue(1006645, 'ko'), '100.7만');
eq('ko 1.2억', formatAxisValue(120000000, 'ko'), '1.2억');
eq('ko 9,999 는 구분만', formatAxisValue(9999, 'ko'), '9,999');
eq('ko 음수', formatAxisValue(-50000, 'ko'), '-5만');
eq('ko 소수', formatAxisValue(0.25, 'ko'), '0.25');
eq('en 1,000,000', formatAxisValue(1000000, 'en'), '1M');
eq('en 2,500', formatAxisValue(2500, 'en'), '2.5k');

// F-02 툴팁 원본 + 단위
eq('툴팁 명', formatTooltipValue(1006645, '명'), '1,006,645명');
eq('툴팁 %', formatTooltipValue(3.5, '%'), '3.5%');
eq('툴팁 N 은 띄움', formatTooltipValue(12, 'N'), '12 N');
eq('툴팁 m/s²', formatTooltipValue(9.81, 'm/s²'), '9.81 m/s²');
eq('툴팁 null', formatTooltipValue(null, '명'), '–');

// F-03 단위 없음
eq('툴팁 단위 없음', formatTooltipValue(1006645), '1,006,645');
eq('축 단위 없음', formatAxisValue(1000000, 'ko', undefined), '100만');

// F-04 이미 축약된 단위
check('만 명 은 축약 단위', isPreScaledUnit('만 명'));
check('M USD 는 축약 단위', isPreScaledUnit('M USD'));
check('m/s² 는 아님', !isPreScaledUnit('m/s²'));
check('kg 는 아님', !isPreScaledUnit('kg'));
check('명 은 아님', !isPreScaledUnit('명'));
eq('만 명 값 100.7 재축약 안 함', formatAxisValue(100.7, 'ko', '만 명'), '100.7');
eq('억 원 값 12000 재축약 안 함', formatAxisValue(12000, 'ko', '억 원'), '12,000');

// 단위 정리(모델 출력)
check('긴 문장 단위 거부', sanitizeUnit('this is a very long sentence') === undefined);
check('숫자 단위 거부', sanitizeUnit(5) === undefined);
check('제어문자 거부', sanitizeUnit('명\n') === '명' && sanitizeUnit('a\u0007b') === undefined);

// F-05 마커
const few = resolveXAxis('line', [{ data: [1006645, 862835, 640089, 272337, 260562] }], ['1970', '1980', '2000', '2020', '2021']);
eq('불규칙 연도 5점 numeric 선 마커', markerSize('line', few.scale, few.series), 4);
const dense = resolveXAxis('line', [{ data: Array.from({ length: 61 }, (_, i) => ({ x: -3 + i * 0.1, y: (-3 + i * 0.1) ** 2 })) }], []);
eq('함수 61점 마커 숨김', markerSize('line', dense.scale, dense.series), 0);
eq('범주 선 마커 없음(기존)', markerSize('line', 'category', [{ data: [1, 2, 3] }]), 0);
eq('산점도 6', markerSize('scatter', 'numeric', [{ data: [] }]), 6);
eq('결측 범주 선 4(기존)', markerSize('line', 'category', [{ data: [1, null, 3] }]), 4);
eq('막대 0', markerSize('bar', 'category', [{ data: [1, 2] }]), 0);

// F-07 null 보존(0 으로 바뀌지 않음)
const withNull = resolveXAxis('line', [{ data: [5, null, 7] }], ['1970', '1980', '2000']);
check('불규칙 범주 null 보존', (withNull.series[0].data[1] as any).y === null);
const ptsNull = resolveXAxis('line', [{ data: [{ x: 'A', y: 1 }, { x: 'B', y: null }] }], []);
check('이름 x {x,y} null 보존', ptsNull.series[0].data[1] === null);

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);

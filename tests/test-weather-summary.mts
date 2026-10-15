/**
 * 날씨 카드 아래 한 줄 설명 하니스 — `npx tsx tests/test-weather-summary.mts`
 *
 * 카드 JSON 에서 서버가 만든다(모델 호출 없음). 카드에 있는 사실만 — 조언(우산 등) 없음.
 * 오류 카드·깨진 블록에는 아무것도 붙이지 않는다. 실제 SSE 루프(createStreamDispatch)로 카드 뒤에 붙는지도 본다.
 */
import { weatherSummaryLine, interleaveWeatherSummaries } from '../server/agent/weather-summary.js';
import { createStreamDispatch } from '../server/agent/stream-dispatch.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, got?: string) => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${ok || got === undefined ? '' : `  → ${got}`}`); };

const seoul = {
    source: 'KMA', location: { name: '서울', country: 'KR' },
    current: { temp: 16.2, condition: 'clear' },
    daily: [{ date: '2026-10-15', condition: 'cloudy', minTemp: 10, maxTemp: 21, pop: 30 }],
};
const block = (d: unknown) => '```json:weather\n' + JSON.stringify(d) + '\n```';

const ko = weatherSummaryLine(seoul, 'ko');
check('ko — 현재·오늘 최저최고·강수확률', ko === '서울은 현재 맑고 16°입니다. 오늘 기온은 10~21°, 강수확률은 30%입니다.', ko);
check('조언 없음(우산·챙기)', !/우산|챙기|umbrella/i.test(ko));
check('ko 조사 — 받침 없으면 "는"', weatherSummaryLine({ ...seoul, location: { name: '도쿄' } }, 'ko').startsWith('도쿄는 현재'));
check('en', weatherSummaryLine(seoul, 'en') === '서울 is clear at 16° right now. Today: 10–21°, 30% chance of precipitation.', weatherSummaryLine(seoul, 'en'));
check('en — 명사 상태도 서술형(rain → rainy)', weatherSummaryLine({ ...seoul, current: { ...seoul.current, condition: 'rain' } }, 'en').startsWith('서울 is rainy at'), weatherSummaryLine({ ...seoul, current: { ...seoul.current, condition: 'rain' } }, 'en'));
check('es·fr 도 문장이 나온다', weatherSummaryLine(seoul, 'es').includes('30%') && weatherSummaryLine(seoul, 'fr').includes('30 %'));
check('상태 unknown 이면 상태 없이', weatherSummaryLine({ ...seoul, current: { temp: 16, condition: 'unknown' } }, 'ko').startsWith('서울은 현재 16°입니다.'));
check('ko 연결형 — 흐림·비', weatherSummaryLine({ ...seoul, current: { temp: 12, condition: 'overcast' } }, 'ko').startsWith('서울은 현재 흐리고 12°') && weatherSummaryLine({ ...seoul, current: { temp: 12, condition: 'rain' } }, 'ko').startsWith('서울은 현재 비가 오고 12°'));
check('daily 없으면 현재만', weatherSummaryLine({ ...seoul, daily: [] }, 'ko') === '서울은 현재 맑고 16°입니다.');
check('오류 카드 → 빈 문자열', weatherSummaryLine({ error: true, input: '없는시', code: 'CITY_NOT_FOUND' }, 'ko') === '');
const two = interleaveWeatherSummaries([block(seoul), block({ ...seoul, location: { name: '부산' } })], 'ko');
check('여러 도시 → 각 카드 바로 위에 그 도시 문장', two.indexOf('서울은 현재') < two.indexOf('"서울"') && two.indexOf('"서울"') < two.indexOf('부산은 현재') && two.indexOf('부산은 현재') < two.indexOf('"부산"'));
const broken = ['```json:weather\n{깨짐\n```', block({ error: true })];
check('깨진 블록·오류 카드는 문장 없이 카드만', interleaveWeatherSummaries(broken, 'ko') === broken.join('\n\n'));

// 실제 SSE 루프 — 카드 뒤에 한 줄이 붙는가(언어 옵션 반영)
const run = (lang?: 'ko' | 'en') => {
    let text = '';
    const d = createStreamDispatch(f => { if (f.text) text += f.text; }, lang ? { lang } : {});
    d.handle({ event: 'on_chain_end', name: 'router', data: { output: { intent: 'weather' } } });
    d.handle({ event: 'on_tool_end', name: 'weatherTool', data: { output: block(seoul) } });
    return text;
};
const out = run();
check('SSE — 문장 다음에 카드', out.indexOf('서울은 현재') >= 0 && out.indexOf('서울은 현재') < out.indexOf('```json:weather'), out.slice(0, 80));
check('SSE — lang 옵션(en)', run('en').includes('right now'));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);

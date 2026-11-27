/**
 * 날씨 카드 뒤 짧은 답 하니스 — `npx tsx tests/test-weather-answer.mts` (네트워크·환경변수 없음)
 *
 * 왜 있는가(DEV_261125 §11): 첫 날씨 질문은 fast-pass(카드 + 템플릿 한 줄)라 "우산 챙겨야 할까?" 에 답이 없었다.
 * 카드 뒤에 역할 모델이 1~2문장을 붙이되, ① 모델 산문이 이미 있는 턴·오류 카드엔 붙이지 않고
 * ② 날씨만 물었으면 모델이 none 을 낸다(JSON). ①의 판정·프롬프트 계약·route 배선·KMA 시간 초과를 고정한다.
 * ⑥ 날씨 + 미세먼지 복합 질문: 카드를 두고 카드 밖 부분만 선택 모델이 검색(PLAN_WEATHER_COMPOSITE_261125).
 * ⑤ 답이 "찾아볼까요?" 로 끝나면 다음 "응" 은 검색이어야 한다 — 라우터가 직전 답 끝을 보고(lookup) 카드 답(검색 꺼짐)으로 보내지 않는다(§11-5).
 */
import fs from 'node:fs';
import { chipTitle, fastPassWeatherCards, buildWeatherAnswerPrompt, buildWeatherExtraPrompt, composeWeatherAnswer } from '../server/agent/weather-answer-prompt.js';
import { interleaveWeatherSummaries, weatherSummaryLine } from '../server/agent/weather-summary.js';
import { previousResponseExcerpt } from '../server/agent/previous-response.js';
import { decideWeatherFollowup } from '../server/agent/weather-followup.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); } else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const card = { source: 'KMA', location: { name: '서울', country: 'KR' }, current: { temp: 7, feelsLike: 7, condition: 'clear', humidity: 54, windSpeed: 3.9 },
    daily: [{ date: '2026-11-25', condition: 'cloudy', minTemp: -4, maxTemp: 7, pop: 20, rainMm: 0, snowMm: 0 }, { date: '2026-11-27', condition: 'rain', minTemp: 8, maxTemp: 16, pop: 60, rainMm: 3, snowMm: 0 }] };
const block = (c: unknown) => '```json:weather\n' + JSON.stringify(c) + '\n```';
// 실제 스트림 본문 모양 — stream-dispatch 가 보내는 그대로
const gemini = '\n' + interleaveWeatherSummaries([block(card)], 'ko') + '\n\n';

check('① Gemini fast-pass(한 줄 + 카드) → 카드 1장', fastPassWeatherCards(gemini, 'ko')?.length === 1);
check('① GPT fast-pass(카드만) → 카드 1장', fastPassWeatherCards(block(card), 'ko')?.length === 1);
check('① 여러 도시 → 모두', fastPassWeatherCards(interleaveWeatherSummaries([block(card), block({ ...card, location: { name: '부산', country: 'KR' } })], 'ko'), 'ko')?.length === 2);
check('① 모델 산문이 이미 있으면 붙이지 않음', fastPassWeatherCards(gemini + '오늘은 우산이 필요 없어요.', 'ko') === null);
check('① 오류 카드만이면 붙이지 않음', fastPassWeatherCards(block({ error: true, code: 'CITY_NOT_FOUND' }), 'ko') === null);
check('① 카드 없으면 null', fastPassWeatherCards('그냥 답변', 'ko') === null);
check('① 영어 한 줄도 인식', fastPassWeatherCards(interleaveWeatherSummaries([block(card)], 'en'), 'en')?.length === 1);

const p = buildWeatherAnswerPrompt('오늘 우산 챙겨야 할까?', [card], 'ko', '2026-11-25');
check('② 프롬프트: 날씨만 물으면 none(기본값 true·팁 금지)', /"none": true if the message only asks/.test(p) && /The default is true/.test(p) && /do not add tips/.test(p));
check('② 프롬프트: 1–2문장·결론 먼저·응답 언어', /1–2 short sentences/.test(p) && /Conclusion first/.test(p) && /in Korean/.test(p));
check('② 프롬프트: 한국어는 해요체 고정·다른 언어엔 없음', /해요체/.test(p) && !/해요체/.test(buildWeatherAnswerPrompt('Will it rain?', [card], 'en', '2026-11-25')));
check('② 프롬프트: 빠진 정보는 lookup 이름만(역질문은 서버가)', /"lookup": only if the user explicitly asked about something this forecast does not have/.test(p) && /The server adds the offer/.test(p));
// 금지 문구 나열·예시로는 질문이 바뀌면 "나와 있지 않아" 가 다시 나왔다 → 모델은 lookup 이름만, 문장은 서버가(DEV_261127)
check('② 프롬프트: 빠진 것·카드·데이터를 말하지 않음, 금지 문구를 나열하지 않음(나열하면 그 표현이 나왔다)', /do not mention anything that is missing, the card, or the data/.test(p) && !p.includes('나와 있지 않'));
check('② compose: none → 빈 답', composeWeatherAnswer('{"none":true,"answer":"","lookup":""}', 'ko') === '');
check('② compose: 답 + 서버 역질문(ko·en)', composeWeatherAnswer('{"none":false,"answer":"오늘은 비가 와요.","lookup":"미세먼지"}', 'ko') === '오늘은 비가 와요. 미세먼지도 찾아볼까요?'
    && composeWeatherAnswer('{"none":false,"answer":"It rains today.","lookup":"fine dust"}', 'en') === 'It rains today. Want me to look up fine dust?');
check('② compose: "없다" 문장은 뺀다(실측 문장) — 남는 게 없으면 역질문만',
    composeWeatherAnswer('{"none":false,"answer":"자외선 지수는 이 예보에서 제공되지 않아요.","lookup":"자외선 지수"}', 'ko') === '자외선 지수도 찾아볼까요?'
    && composeWeatherAnswer('{"none":false,"answer":"오늘 서울 미세먼지 정보는 알 수 없어요.","lookup":"미세먼지"}', 'ko') === '미세먼지도 찾아볼까요?'
    && composeWeatherAnswer('{"none":false,"answer":"부산은 하루 종일 비가 와요. 그치는 시간은 나와 있지 않아요.","lookup":"비 그치는 시간"}', 'ko') === '부산은 하루 종일 비가 와요. 비 그치는 시간도 찾아볼까요?');
check('② compose: lookup 없으면 답만 · 깨진 JSON 은 빈 답', composeWeatherAnswer('{"none":false,"answer":"우산 챙기세요.","lookup":""}', 'ko') === '우산 챙기세요.' && composeWeatherAnswer('NONE', 'ko') === '');
check('② 호출: JSON 스키마(none·answer·lookup) 로 받는다', /responseMimeType: 'application\/json'/.test(fs.readFileSync(new URL('../server/agent/weather-answer.ts', import.meta.url), 'utf8')) && /composeWeatherAnswer\(res\.text/.test(fs.readFileSync(new URL('../server/agent/weather-answer.ts', import.meta.url), 'utf8')));
check('② 출처 이름을 사용자 언어로(KMA → 기상청), 보통은 생략·수치 하나가 근거일 때만 한 번', p.includes('"source":"기상청"') && /Usually no source; name it \("기상청 예보로는 …"\) at most once/.test(p));
check('② 현재 기온·오늘 범위·강수확률 반복 금지 · 숫자는 기호로(한 줄이 보여 준다) · 묻지 않은 lookup 금지', /Do not repeat the current temperature, today's range, or today's precipitation chance/.test(p) && /never spelled out/.test(p) && /only if the user explicitly asked about/.test(p) && /never offer something they did not ask about/.test(p));
check('② 데이터에 없는 비교(평년·평균·과거) 금지', /no normal years, averages, or past days/.test(p));
check('② 다른 날 예보만 묻기("내일 날씨는?")도 none · 날씨 요청 + 판단 질문은 답한다(JSON 전환 때 빠져 2/2 none 이 됐다)', /"내일 날씨는\?"/.test(p) && /"날씨 어때\? 우산 챙겨야 할까\?"\) is false/.test(p));
check('② 하루 안의 시각을 말하지 않음(일 단위 데이터 — "내일 오전부터 맑아져요" 를 지어냈다)', /never say a time within a day/.test(p));
check('② 오늘 칸엔 하늘 상태가 없다(관측과 섞임 방지)', !/"weekday":"수","condition"/.test(p) && /"weekday":"금","condition":"rain"/.test(p), p.slice(p.indexOf('dailyForecast'), p.indexOf('dailyForecast') + 160));
check('② 관측(observedNow)·예보(dailyForecast) 이름을 가른다', p.includes('"observedNow"') && p.includes('"dailyForecast"') && /"Right now" = observedNow; today and later = dailyForecast/.test(p));
check('② 요일을 미리 붙인다(11-27 = 금)', p.includes('"date":"2026-11-27","weekday":"금"'), p.slice(p.indexOf('Card data'), p.indexOf('Card data') + 200));
check('② 원문 메타(updatedAt·timezone) 는 넘기지 않음', !p.includes('updatedAt') && !p.includes('timezoneOffsetSec'));

const route = fs.readFileSync(new URL('../app/api/chat/route.ts', import.meta.url), 'utf8');
check('③ route: 그래프 스트림이 끝난 뒤·저장 전에 붙인다',
    /for await \(const event of streamEvents\) dispatch\.handle\(event\);[\s\S]{0,300}fastPassWeatherCards\([\s\S]{0,1600}const fullAiResponse = st\.fullAiResponse;/.test(route));
const ans = fs.readFileSync(new URL('../server/agent/weather-answer.ts', import.meta.url), 'utf8');
check('③ 역할 모델·유료 키 우선·제한 시간', /model: ROLE_MODEL/.test(ans) && /getRoleApiKey\(\)/.test(ans) && /abortSignal: AbortSignal\.timeout\(WEATHER_ANSWER_TIMEOUT_MS\)/.test(ans));

const wx = fs.readFileSync(new URL('../server/lib/weather/index.ts', import.meta.url), 'utf8');
check('④ KMA 시간 초과 5s(11-25 측정 최대 3.45s)', /const KMA_FETCH_TIMEOUT_MS = 5_000;/.test(wx));
check('④ 느린 응답·시간 초과를 로그로(작업명·ms·결과만)', /KMA 지연 \$\{op\} \$\{ms\}ms ok/.test(wx) && /KMA 지연 \$\{op\} \$\{Date\.now\(\) - startedAt\}ms/.test(wx));

// ⑤ 역질문 → "응" 이 검색으로
const offer = gemini + '\n기상청 예보로는 금요일 강수확률이 60%라 우산은 챙기세요. 몇 시쯤 오는지 찾아볼까요?\n';
const ex = previousResponseExcerpt(offer);
check('⑤ 라우터가 보는 직전 답: 카드 JSON 은 표시로 줄이고 끝의 제안을 남긴다', ex.includes('[card shown]') && ex.endsWith('찾아볼까요?') && !ex.includes('"daily"'), ex);
const long = '가'.repeat(600) + ' 찾아볼까요?';
check('⑤ 긴 산문은 앞·뒤를 남긴다(끝 제안 유지)', previousResponseExcerpt(long).endsWith('찾아볼까요?') && previousResponseExcerpt(long).length < 420);
const wf = (text: string, llmLookup: boolean, useLlm = true) => decideWeatherFollowup({ text, intentIsWeather: false, llmFollowUp: 'unrelated', llmLookup, useLlm, shownCities: ['서울'] }).decision;
check('⑤ "응" + LLM lookup → lookup(검색)', wf('응', true) === 'lookup' && wf('찾아줘', true) === 'lookup');
check('⑤ 날씨 어휘가 섞여도 제안 수락이면 lookup', wf('응 비 몇 시에 오는지 찾아줘', true) === 'lookup');
check('⑤ 다른 도시는 lookup 보다 새 조회가 먼저', wf('응 그리고 부산은?', true) === 'new');
check('⑤ LLM 판정 끄면(A/B 스위치) lookup 없음', wf('응', true, false) !== 'lookup');
const router = fs.readFileSync(new URL('../server/agent/nodes/router.ts', import.meta.url), 'utf8');
check('⑤ 라우터: follow_up "lookup" 정의·검색 켬·다른 카드엔 unrelated 로',
    /"lookup"\s+: the previous assistant response OFFERED/.test(router) && /decision === "lookup"[\s\S]{0,200}llmNeedsSearch = true/.test(router)
    && /parsed\.follow_up === "lookup"[\s\S]{0,80}llmFollowUp = "unrelated"/.test(router));
check('⑤ 라우터: 직전 답은 previousResponseExcerpt 로(앞 300자 자르기 없음)', /previousResponseExcerpt\(String\(lastAssistantMsg\.content\)\)/.test(router) && !/first 300 chars/.test(router));

// ⑥ 복합 질문 — 카드 유지 + 카드 밖 부분만 선택 모델 검색
const xp = buildWeatherExtraPrompt('오늘 서울 날씨 어때? 미세먼지는?', [card], 'ko', '2026-11-25', '미세먼지');
check('⑥ 프롬프트: 날씨 수치는 말하지 않음(판단에 필요하면 카드 데이터만, 검색 결과 수치 금지)', /Do not state temperatures/.test(xp) && /never from search results/.test(xp) && xp.includes('"observedNow"'));
check('⑥ 프롬프트: 한 문장(판단 질문이 있을 때만 두 문장)·등급에 근거(수치·기준 시각)·측정/예보 구분·지어낸 수치 금지·해요체', /in ONE short sentence — two only if/.test(xp) && /with its basis in parentheses/.test(xp) && /current measurement or a forecast/.test(xp) && /never a made-up number/.test(xp) && /news articles are not a source for values/.test(xp) && /해요체/.test(xp));
// 밤의 OpenWeather 폴백 — 예보가 내일부터라 첫 칸이 오늘이 아니다(DEV_261127 §10)
const night = { ...card, updatedAt: '2026-11-27T13:39:00Z', timezoneOffsetSec: 32400, daily: card.daily.map((d: any, i: number) => ({ ...d, date: `2026-11-${28 + i}`.replace('2026-11-31', '2026-12-01').replace('2026-11-32', '2026-12-02') })) };
check('⑦ 첫 칸이 오늘이 아니면 한 줄에 "오늘 기온" 없음', !weatherSummaryLine(night, 'ko').includes('오늘'));
check('⑦ 첫 칸이 오늘이면 한 줄에 "오늘 기온" 있음', weatherSummaryLine({ ...night, daily: [{ ...night.daily[0], date: '2026-11-27' }, ...night.daily] }, 'ko').includes('오늘 기온'));
check('⑦ 답 프롬프트: 오늘이 아닌 첫 칸은 하늘 상태를 남긴다', buildWeatherAnswerPrompt('우산?', [night], 'ko', '2026-11-27').includes('"date":"2026-11-28","weekday":"토","condition"'));

check('⑥ 프롬프트: 찾을 것만 검색·공식 출처(에어코리아 예보)·측정값 3시간 이내·확인 떠넘기기 금지', /Search the web for: 미세먼지 in 서울/.test(xp) && /airkorea.or.kr\/web\/dustForecast/.test(xp) && /last 3 hours/.test(xp) && /Not news/.test(xp) && /Do not tell the user to check another site/.test(xp));
check('⑥ 라우터: weather_extra 정의 + 날씨 요청 어휘가 있을 때만 카드 유지(현상만은 검색)',
    /"weather_extra": ONLY when the message asks for the weather/.test(router)
    && /llmIntent === "weather" && llmWeatherExtra && WEATHER_CARD_REQUEST\.test\(textContent\)/.test(router)
    && !/WEATHER_CARD_REQUEST = [^;]*미세먼지/.test(router));
check('⑥ 라우터: 현상 목록에 "자외선" 단독도(전엔 "자외선 지수" 만)', /\|가뭄\|자외선\|꽃가루\|/.test(router));
const ex2 = fs.readFileSync(new URL('../server/agent/weather-extra.ts', import.meta.url), 'utf8');
check('⑥ 검색 모델: GPT web_search · Gemini 선택 모델 grounding · 무료 키(역할 모델 강등)는 검색 생략 → 역질문',
    /isOpenAIChatModel\(args\.model\)[\s\S]{0,300}useWebSearch: true/.test(ex2)
    && /if \(\(!caps\.freeTierSearch && !isPaidKey\(apiKey\)\) \|\| !caps\.groundingReliable\) \{[\s\S]{0,120}return null;/.test(ex2)
    && /tools: \[\{ googleSearch: \{\} \}\]/.test(ex2));
check('⑥ route: extra 있으면 검색 답, 없거나 실패하면 역할 모델 답 · 출처를 저장 전에',
    /st\.weatherExtra\s*\?\s*await weatherExtraAnswer\(\{[\s\S]{0,200}model: finalModel \}\)/.test(route)
    && /extra\?\.text \?\? await weatherQuickAnswer\(/.test(route)
    && /st\.allSources\.push\(s\)[\s\S]{0,800}const fullAiResponse = st\.fullAiResponse;/.test(route));
const disp = fs.readFileSync(new URL('../server/agent/stream-dispatch.ts', import.meta.url), 'utf8');
check('⑥ dispatch 가 라우터 weatherExtra 를 잡는다', /st\.weatherExtra = data\.output\.weatherExtra/.test(disp));

const cw = (a: string) => composeWeatherAnswer(JSON.stringify({ none: false, answer: a, lookup: '' }), 'ko');
check('④ 해요체: 겠습니다·있습니다·됩니다', cw('우산을 챙기시는 것이 좋겠습니다. 비 소식이 있습니다. 안 챙겨도 됩니다.') === '우산을 챙기시는 것이 좋겠어요. 비 소식이 있어요. 안 챙겨도 돼요.');
check('④ 해요체: 입니다 받침 구분', cw('맑은 날입니다. 내일은 금요일입니다.') === '맑은 날이에요. 내일은 금요일이에요.' && cw('토요일이 최고 기온 16도로 가장 따뜻한 하루입니다.').endsWith('하루예요.'));
check('④ 해요체: % 뒤는 예요, 숫자 뒤는 그대로', cw('강수 확률은 60%입니다.') === '강수 확률은 60%예요.' && cw('비는 3mm입니다.') === '비는 3mm입니다.');
check('④ 없다 문장 추가 패턴', composeWeatherAnswer(JSON.stringify({ none: false, answer: '미세먼지 정보는 제공하지 않아서 확인이 어려워요.', lookup: '미세먼지' }), 'ko') === '미세먼지도 찾아볼까요?');
{
    check('⑧ 출처 칩: 끝의 ":" 를 뗀다', chipTitle('에어코리아 :', 'https://www.airkorea.or.kr/web/dustForecast') === '에어코리아');
    check('⑧ 출처 칩: 비면 도메인', chipTitle('', 'https://www.airkorea.or.kr/x') === 'airkorea.or.kr');
}
console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);

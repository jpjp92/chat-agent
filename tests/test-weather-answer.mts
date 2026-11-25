/**
 * 날씨 카드 뒤 짧은 답 하니스 — `npx tsx tests/test-weather-answer.mts` (네트워크·환경변수 없음)
 *
 * 왜 있는가(DEV_261125 §11): 첫 날씨 질문은 fast-pass(카드 + 템플릿 한 줄)라 "우산 챙겨야 할까?" 에 답이 없었다.
 * 카드 뒤에 역할 모델이 1~2문장을 붙이되, ① 모델 산문이 이미 있는 턴·오류 카드엔 붙이지 않고
 * ② 날씨만 물었으면 모델이 NONE 을 낸다. ①의 판정·프롬프트 계약·route 배선·KMA 시간 초과를 고정한다.
 * ⑥ 날씨 + 미세먼지 복합 질문: 카드를 두고 카드 밖 부분만 선택 모델이 검색(PLAN_WEATHER_COMPOSITE_261125).
 * ⑤ 답이 "찾아볼까요?" 로 끝나면 다음 "응" 은 검색이어야 한다 — 라우터가 직전 답 끝을 보고(lookup) 카드 답(검색 꺼짐)으로 보내지 않는다(§11-5).
 */
import fs from 'node:fs';
import { fastPassWeatherCards, buildWeatherAnswerPrompt, buildWeatherExtraPrompt } from '../server/agent/weather-answer-prompt.js';
import { interleaveWeatherSummaries } from '../server/agent/weather-summary.js';
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
check('② 프롬프트: 날씨만 물으면 NONE(기본값·팁 금지)', /Output exactly NONE/.test(p) && /The default is NONE/.test(p) && /do not add tips/.test(p));
check('② 프롬프트: 1–2문장·결론 먼저·응답 언어', /1–2 short sentences/.test(p) && /Lead with the conclusion/.test(p) && /in Korean/.test(p));
check('② 프롬프트: 없는 정보는 결론 먼저 + 찾아볼지 역질문(다른 사이트 안내 금지)', /end by offering to look it up/.test(p) && /Do not tell them to check another site/.test(p));
check('② 프롬프트: 시스템 단어(카드·데이터) 금지', /Never mention the card, the data/.test(p));
check('② 출처 이름을 사용자 언어로(KMA → 기상청), 수치가 근거일 때만 한 번', p.includes('"source":"기상청"') && /Name the source only when a forecast number is the whole reason, at most once/.test(p));
check('② 데이터에 없는 비교(평년·평균·과거) 금지', /No comparisons with normal years, averages, past days/.test(p));
check('② 다른 날 예보만 묻기("내일 날씨는?")도 NONE', /"내일 날씨는\?"/.test(p));
check('② 오늘 칸엔 하늘 상태가 없다(관측과 섞임 방지)', !/"weekday":"수","condition"/.test(p) && /"weekday":"금","condition":"rain"/.test(p), p.slice(p.indexOf('dailyForecast'), p.indexOf('dailyForecast') + 160));
check('② 관측(observedNow)·예보(dailyForecast) 이름을 가른다', p.includes('"observedNow"') && p.includes('"dailyForecast"') && /Do not mix them/.test(p));
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
check('⑥ 프롬프트: 한 문장(판단 질문이 있을 때만 두 문장)·세부 수치 생략', /in ONE short sentence — two only if/.test(xp) && /Leave out station readings/.test(xp));
check('⑥ 프롬프트: 찾을 것만 검색·공식 출처 우선·확인 떠넘기기 금지', /Search the web for: 미세먼지 in 서울/.test(xp) && /Prefer official sources/.test(xp) && /Do not tell the user to check another site/.test(xp));
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

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);

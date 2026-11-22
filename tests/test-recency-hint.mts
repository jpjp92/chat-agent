/**
 * 최신 제품 질문 기준 시점 힌트 — `npx tsx tests/test-recency-hint.mts`
 * 계획: docs/plans/PLAN_WEB_SEARCH_QUALITY_261122.md §3 W2 · 구현: server/agent/recency-hint.ts
 */
import { isLatestProductRequest, buildRecencyHint, appendHintToSdkContents, appendHintToMessages } from '../server/agent/recency-hint.js';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✅' : '❌'} ${name}${!ok && detail ? `\n     ${detail}` : ''}`); };

// ── 판정 ──
const ON = [
    '아이폰·갤럭시·픽셀 최신 모델 배터리 용량 비교 차트 그려줘',
    '최신 맥북 프로 칩 성능 비교해줘',
    '갤럭시 Z 폴드 최신 모델 가격 알려줘',
    '요즘 나온 노트북 추천해줘',
    '신형 아이패드 가격',
    'latest iPhone battery capacity',
    'newest Pixel phone price',
    'el último modelo de Galaxy',
    'le dernier MacBook Pro',
    '최신정보알려줘 갤럭시',               // 띄어쓰기 없어도 최신 요구
];
const OFF = [
    '아이폰 13 배터리 용량 알려줘',          // 옛 모델 지정
    '스마트폰 배터리 오래 쓰는 법 알려줘',     // 최신성 무관
    '오늘 서울 날씨',                         // temporal 이지만 제품 아님
    '지금 몇 시야',
    '최근 검색한 내용 요약해줘',              // 직전 결과 참조
    '방금 최신 답변 다시 보여줘',
    'what is the current time',
];
for (const t of ON) check(`on  ${t}`, isLatestProductRequest(t));
for (const t of OFF) check(`off ${t}`, !isLatestProductRequest(t));

// ── 문구 — 사용자 시간대 기준 연·월 ──
const NOV = new Date('2026-11-22T03:00:00Z');
check('ko 문구', buildRecencyHint(NOV, 'Asia/Seoul', 'Korean') === '(기준: 2026년 11월 현재 출시·판매 중인 최신 라인업)', buildRecencyHint(NOV, 'Asia/Seoul', 'Korean'));
check('en 문구', buildRecencyHint(NOV, 'Asia/Seoul', 'English').startsWith('(As of 2026-11'));
check('es·fr 문구', buildRecencyHint(NOV, 'Asia/Seoul', 'Spanish').includes('11/2026') && buildRecencyHint(NOV, 'Asia/Seoul', 'French').includes('11/2026'));
// UTC 로는 아직 11-30 이지만 서울은 12-01 — 달이 사용자 시간대를 따른다
check('시간대 경계(서울 12월 1일)', buildRecencyHint(new Date('2026-11-30T16:00:00Z'), 'Asia/Seoul', 'Korean').includes('2026년 12월'));

// ── SDK contents — 마지막 user 턴에만, 원본 불변 ──
const contents = [
    { role: 'user', parts: [{ text: '첫 질문' }] },
    { role: 'model', parts: [{ text: '답' }] },
    { role: 'user', parts: [{ text: '최신 맥북 칩' }, { inlineData: { mimeType: 'image/png', data: 'x' } }] },
];
const hinted = appendHintToSdkContents(contents, 'H');
check('SDK: 마지막 user 턴 끝에 텍스트 파트 추가', hinted[2].parts!.length === 3 && (hinted[2].parts![2] as any).text === '\n\nH');
check('SDK: 이전 턴·이미지 파트 그대로', hinted[0] === contents[0] && hinted[1] === contents[1] && hinted[2].parts![1] === contents[2].parts[1]);
check('SDK: 원본 불변', contents[2].parts.length === 2);

// ── LangChain 메시지 — 마지막 human 만 복제, 원본 불변 ──
type M = { _getType(): string; content: any };
const mk = (type: string, content: any): M => ({ _getType: () => type, content });
const msgs = [mk('human', [{ type: 'text', text: '앞 질문' }]), mk('ai', '답'), mk('human', [{ type: 'text', text: '최신 폴드 가격' }])];
const out = appendHintToMessages(msgs, 'H', content => mk('human', content));
check('LC: 마지막 human 에 텍스트 파트 추가', Array.isArray(out[2].content) && out[2].content.at(-1).text === '\n\nH');
check('LC: 앞 메시지 그대로 · 원본 불변', out[0] === msgs[0] && out[1] === msgs[1] && msgs[2].content.length === 1);
check('LC: 문자열 content 도 처리', appendHintToMessages([mk('human', '최신 폰')], 'H', c => mk('human', c))[0].content === '최신 폰\n\nH');

// ── 배선 — 두 공급자 경로가 검색 턴에만 붙인다 ──
const { readFileSync } = await import('node:fs');
const gen = readFileSync(new URL('../server/agent/nodes/generator.ts', import.meta.url), 'utf8');
check('배선: Gemini 경로 — useGoogleSearch && isLatestProductRequest', /useGoogleSearch && isLatestProductRequest\(latestUserText\)/.test(gen));
check('배선: Gemini 호출이 모두 힌트 반영 contents 를 쓴다', !/contents: sdkContents/.test(gen) && (gen.match(/contents: modelContents/g) ?? []).length >= 1);
check('배선: OpenAI 경로 — useWebSearch && isLatestProductRequest', /useWebSearch && isLatestProductRequest\(latestUserText\)/.test(gen) && /messages: openaiMessages/.test(gen));

console.log(`\n${fail ? '❌' : '✅'} 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);

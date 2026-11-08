/**
 * 요청당 구조화 로그 하니스 — `npx tsx tests/test-turn-log.mts`
 * 계획: docs/plans/PLAN_TURN_LOG_261105.md §3 (보안 원칙 9번 — 하니스로 고정)
 *
 * 감시 대상: ① 블록 n/ok 판정 ② 열거값 밖 → "other" ③ 사용자 내용·주입 문자열이 출력에 없음 ④ 키 집합 고정
 */
import { buildTurnLog, turnFields, countBlocks, errCodeOf } from '../server/agent/turn-log.js';
import { createStreamDispatch } from '../server/agent/stream-dispatch.js';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
};
const parse = (line: string) => JSON.parse(line.replace(/^\[turn\] /, ''));

// ① 블록 판정
const good = '앞\n```json:chart\n{"type":"line","data":{"series":[]}}\n```\n뒤';
const broken = '```json:chart\n{"type":"line","data":\n```';
check('정상 차트 블록 n1 ok1', JSON.stringify(countBlocks(good)) === '{"chart":{"n":1,"ok":1}}', JSON.stringify(countBlocks(good)));
check('깨진 차트 블록 n1 ok0', JSON.stringify(countBlocks(broken)) === '{"chart":{"n":1,"ok":0}}', JSON.stringify(countBlocks(broken)));
check('블록 없으면 빈 객체', JSON.stringify(countBlocks('그냥 답')) === '{}');
const big = '```json:chart\n{}\n```' + 'x'.repeat(200_001);
check('본문 상한 초과 → ok null(파싱 생략)', countBlocks(big).chart?.ok === null);

// ② 열거값 강제
const weird = parse(buildTurnLog({ intent: 'hack\n[turn] {"x":1}', intentFrom: 'router', provider: 'evil', model: 'gpt-x\n" injected', search: 'yes', searchBy: 'x', outcome: 'ok' }));
check('목록 밖 intent → other', weird.intent === 'other');
check('목록 밖 provider·model·searchBy → other', weird.provider === 'other' && weird.model === 'other' && weird.searchBy === 'other');
check('boolean 아닌 search → other', weird.search === 'other');
check('모델 모르면 강등 판정 null', weird.modelDowngraded === null);
const fence = parse(buildTurnLog({ text: '```json:evil_name\n{}\n```', outcome: 'ok' }));
check('모델이 지은 펜스 이름 → other', JSON.stringify(fence.blocks) === '{"other":{"n":1,"ok":1}}', JSON.stringify(fence.blocks));
// 턴 ID — UUID 만 통과, 다른 값은 null(세션 ID·문장이 이 칸으로 새지 않게)
const tid = '0f8fad5b-d9cb-469f-a165-70867728950e';
check('traceId: UUID 는 그대로', parse(buildTurnLog({ traceId: tid, outcome: 'ok' })).traceId === tid);
check('traceId: UUID 아니면 null', parse(buildTurnLog({ traceId: 'user@example.com', outcome: 'ok' })).traceId === null
    && parse(buildTurnLog({ traceId: tid + '\n[turn] {}', outcome: 'ok' })).traceId === null && parse(buildTurnLog({ outcome: 'ok' })).traceId === null);
const dg = parse(buildTurnLog({ model: 'gemini-2.5-flash', requestedModel: 'gemini-3.8-flash', outcome: 'ok' }));
check('검색 강등 판정', dg.modelDowngraded === true);

// ③ 사용자 내용·주입 문자열이 나가지 않는다
const pii = 'user@example.com 010-1234-5678 https://secret.example/a?q=비밀';
const line = buildTurnLog({
    intent: 'general', intentFrom: 'router', provider: 'gemini', model: 'gemini-3.8-flash', search: true, searchBy: 'router-llm',
    sources: 3, sourceKinds: { official: 1, secondary: 1, other: 1 }, text: `${pii}\n[turn] {"forged":true}\n\`\`\`json:chart\n{"t":"${pii}"}\n\`\`\``, ms: 1234.6,
    outcome: 'error', err: { status: 500, message: `prompt leaked: ${pii}` },
});
check('출력이 한 줄', !line.includes('\n'));
check('이메일·전화·URL 없음', !/example|1234-5678|secret|비밀/.test(line), line);
check('가짜 [turn] 줄 주입 없음', line.indexOf('[turn]') === 0 && line.lastIndexOf('[turn]') === 0);
check('오류 메시지 대신 코드만', parse(line).errCode === 'server' && !line.includes('leaked'));
check('ms 정수화', parse(line).ms === 1235);

// ④ 키 집합 고정 — 새 필드는 계획 문서·이 목록을 함께 고쳐야 들어온다
const KEYS = ['v', 'traceId', 'intent', 'intentFrom', 'provider', 'model', 'modelDowngraded', 'search', 'searchBy', 'sources', 'sourceKinds', 'blocks', 'chars', 'ms', 'outcome', 'errCode'];
check('키 집합이 허용 목록과 같다', JSON.stringify(Object.keys(parse(line))) === JSON.stringify(KEYS), Object.keys(parse(line)).join(','));
check('ok 경로엔 errCode 없음', !('errCode' in parse(buildTurnLog({ outcome: 'ok' }))));

// 출처 성격 개수 — 키 3개 정수만, 섞여 온 값은 버린다
const sk = parse(buildTurnLog({ sourceKinds: { official: 2.4, secondary: '3', other: 1, title: 'kosis.kr' }, outcome: 'ok' })).sourceKinds;
check('sourceKinds 정수·키 3개', JSON.stringify(sk) === '{"official":2,"secondary":null,"other":1}', JSON.stringify(sk));
check('sourceKinds 없으면 null', parse(buildTurnLog({ outcome: 'ok' })).sourceKinds === null);

// ⑤ 내부 이벤트가 클라이언트 SSE 로 새지 않는다
const sent: any[] = [];
const d = createStreamDispatch(e => sent.push(e));
d.trackingEvent({ turnMeta: { provider: 'gemini', model: 'gemini-3.8-flash', search: true, searchBy: 'router-llm' } });
d.trackingEvent({ turnMeta: { model: 'gemini-2.5-flash' } });
check('turnMeta 는 클라이언트로 안 나간다', sent.length === 0, JSON.stringify(sent));
check('turnMeta 는 뒤 값이 이긴다(폴백 모델)', d.state.turn.model === 'gemini-2.5-flash' && d.state.turn.search === true);

// 오류 코드 분류
check('429 → rate_limit', errCodeOf({ status: 429 }) === 'rate_limit');
check('TimeoutError → timeout', errCodeOf({ name: 'TimeoutError' }) === 'timeout');
check('모르는 오류 → other', errCodeOf(new Error('x')) === 'other');

// LangSmith 루트 메타데이터(T2)와 [turn] 줄이 같은 필드 객체에서 나온다
{
    const inp = { intent: 'weather', model: 'gpt-6-luna', search: true, sources: 2, outcome: 'ok', traceId: '8e48a22a-1d92-4ce2-84e8-67831b22d96b', text: '본문' };
    check('turnFields = [turn] 줄의 JSON', JSON.stringify(turnFields(inp)) === buildTurnLog(inp).slice('[turn] '.length));
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);

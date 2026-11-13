/**
 * 요청당 구조화 로그 하니스 — `npx tsx tests/test-turn-log.mts`
 * 계획: docs/plans/PLAN_TURN_LOG_261105.md §3 (보안 원칙 9번 — 하니스로 고정)
 *
 * 감시 대상: ① 블록 n/ok 판정 ② 열거값 밖 → "other" ③ 사용자 내용·주입 문자열이 출력에 없음 ④ 키 집합 고정
 */
import { buildTurnLog, turnFields, countBlocks, errCodeOf, errLogFields } from '../server/agent/turn-log.js';
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
const KEYS = ['v', 'traceId', 'intent', 'intentFrom', 'provider', 'model', 'modelDowngraded', 'needsSearch', 'search', 'searchBy', 'sources', 'sourceKinds', 'blocks', 'chars', 'ms', 'routerMs', 'saveMs', 'outcome', 'retries', 'retryReasons', 'errCode'];
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
d.trackingEvent({ turnRetry: 'rate_limit' }); d.trackingEvent({ turnRetry: 'timeout' }); d.trackingEvent({ turnRetry: 'rate_limit' });
check('turnRetry 는 클라이언트로 안 나가고 발생 순으로 모인다', sent.length === 0 && JSON.stringify(d.state.turn.retries) === '["rate_limit","timeout","rate_limit"]', JSON.stringify(d.state.turn.retries));
// 재시도 사유 — 횟수는 전부, 사유는 중복 없이·열거값 밖은 other·상한
const rl = parse(buildTurnLog({ outcome: 'ok', retries: ['rate_limit', 'timeout', 'rate_limit', 'Error: user@example.com'] }));
check('retries 횟수·retryReasons 중복 없이·밖은 other', rl.retries === 4 && JSON.stringify(rl.retryReasons) === '["rate_limit","timeout","other"]' && !JSON.stringify(rl).includes('example.com'), JSON.stringify(rl));
check('재시도 없으면 0·빈 목록', parse(buildTurnLog({ outcome: 'ok' })).retries === 0 && JSON.stringify(parse(buildTurnLog({ outcome: 'ok' })).retryReasons) === '[]');
check('재시도 기록 상한 20', parse(buildTurnLog({ outcome: 'ok', retries: Array(500).fill('empty') })).retries === 20);

// 라우터 소요·검색 필요 판정·저장 대기(PLAN_STABILITY_261112 §3)
const d2 = createStreamDispatch(() => {});
d2.handle({ event: 'on_chain_start', name: 'router', data: {} } as any);
await new Promise(r => setTimeout(r, 15));
d2.handle({ event: 'on_chain_end', name: 'router', data: { output: { intent: 'general', intentFrom: 'router', needsSearch: true } } } as any);
check('routerMs: 라우터 시작~끝', (d2.state.turn.routerMs ?? -1) >= 10 && (d2.state.turn.routerMs ?? 0) < 500, String(d2.state.turn.routerMs));
check('needsSearch: 라우터 출력에서', d2.state.turn.needsSearch === true);
const d3 = createStreamDispatch(() => {});
d3.handle({ event: 'on_chain_end', name: 'router', data: { output: { intent: 'drug_id', intentFrom: 'shortcut' } } } as any);
check('판정 없는 턴(vision)·시작 이벤트 없음 → 비움', d3.state.turn.needsSearch === undefined && d3.state.turn.routerMs === undefined);
const ns = parse(buildTurnLog({ outcome: 'ok', needsSearch: true, search: false, routerMs: 812.6, saveMs: 41 }));
check('needsSearch on/off·routerMs·saveMs 정수', ns.needsSearch === 'on' && ns.search === 'off' && ns.routerMs === 813 && ns.saveMs === 41, JSON.stringify(ns));
const nsBad = parse(buildTurnLog({ outcome: 'ok', needsSearch: 'yes; user@example.com', routerMs: '1200ms', saveMs: NaN }));
check('형식 밖 → other·null', nsBad.needsSearch === 'other' && nsBad.routerMs === null && nsBad.saveMs === null && !JSON.stringify(nsBad).includes('example'), JSON.stringify(nsBad));

// 오류 코드 분류
check('429 → rate_limit', errCodeOf({ status: 429 }) === 'rate_limit');
check('TimeoutError → timeout', errCodeOf({ name: 'TimeoutError' }) === 'timeout');
check('모르는 오류 → other', errCodeOf(new Error('x')) === 'other');
// 화면 분류와 같은 원인 → 같은 이름(REF_ErrorCodes §4 어긋남 4건)
check('504·DEADLINE_EXCEEDED·OpenAI code timeout → timeout', errCodeOf({ status: 504 }) === 'timeout' && errCodeOf(new Error('DEADLINE_EXCEEDED')) === 'timeout' && errCodeOf({ status: 504, code: 'timeout' }) === 'timeout');
check('OpenAI 할당량 → openai_quota(429 와 구분)', errCodeOf({ status: 429, code: 'insufficient_quota' }) === 'openai_quota' && errCodeOf({ type: 'insufficient_quota' }) === 'openai_quota');
check('안전 차단 → safety', errCodeOf(Object.assign(new Error('Content blocked'), { safetyBlock: true })) === 'safety');
check('키 전부 소진 → keys_exhausted', errCodeOf(new Error('[LangGraph] All API keys exhausted for LangChain path.')) === 'keys_exhausted' && errCodeOf(new Error('No API key available')) === 'keys_exhausted');
check('메시지 문장은 값으로 안 나간다', errCodeOf(new Error('user@example.com 010-1234-5678')) === 'other');

// 모델 요청 실패 로그 — 원문 없이 코드·표지·길이만(11-13)
const PII_MSG = '[429 Too Many Requests] RESOURCE_EXHAUSTED quota GenerateRequestsPerDayPerProjectPerModel-FreeTier for "내 주민번호 900101-1234567 user@example.com https://x.example/secret"';
const lf = errLogFields(Object.assign(new Error(PII_MSG), { status: 429, code: 'x"; DROP\n[turn] {}', type: 'insufficient_quota' }));
const lfJson = JSON.stringify(lf);
check('실패 로그: errCode·status·표지', lf.errCode === 'openai_quota' && lf.status === 429 && JSON.stringify(lf.markers) === '["RESOURCE_EXHAUSTED","PerDay"]', lfJson);
check('실패 로그: 원문·개인정보·URL 없음', !/900101|example|secret|Too Many|주민/.test(lfJson), lfJson);
check('실패 로그: 형식 밖 code 는 버리고 type 은 유지', lf.code === undefined && lf.type === 'insufficient_quota' && lf.name === 'Error', lfJson);
check('실패 로그: 길이만 남김', lf.msgLen === PII_MSG.length);
check('실패 로그: 키 집합 고정', Object.keys(lf).join() === 'errCode,status,code,type,name,markers,msgLen');
const lfStr = errLogFields('Failed to parse stream');
check('실패 로그: 문자열·빈 오류도 처리', JSON.stringify(lfStr.markers) === '["Failed to parse stream"]' && errLogFields(null).msgLen === 0 && errLogFields(undefined).errCode === 'other');

// LangSmith 루트 메타데이터(T2)와 [turn] 줄이 같은 필드 객체에서 나온다
{
    const inp = { intent: 'weather', model: 'gpt-6-luna', search: true, sources: 2, outcome: 'ok', traceId: '8e48a22a-1d92-4ce2-84e8-67831b22d96b', text: '본문' };
    check('turnFields = [turn] 줄의 JSON', JSON.stringify(turnFields(inp)) === buildTurnLog(inp).slice('[turn] '.length));
}

console.log(`\n${fail === 0 ? '🟢' : '🔴'} pass ${pass} / fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);

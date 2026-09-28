/**
 * 9단계 Q1 — 시각 블록 위치 A/B (PLAN_PROMPT_LAYERING §10-11, 사전 등록 설계).
 *
 *   start : 현재 프로덕션 — 시각 블록을 base **앞**에 prepend
 *   end   : 대안 — 의도 정책 **뒤**, 맨 끝(사용자 턴에 가장 가까운 자리)
 *
 * 🔴 통과 기준 1번은 "더 좋아지는가" 가 아니라 **"2026-08-24 결함이 돌아오지 않는가"** 다.
 *    `prompt-assembly.ts` 주석: 00:20 KST 에 `오늘 나온 AI 뉴스` 가 전날(8/23) 기사를 "오늘"로 답했다.
 *    위치가 그 방어의 일부일 수 있다(§7-1 ⚠️).
 *
 * ── 자정 직후를 아무 시각에나 만드는 법 ────────────────────────────────────────
 * 검색 결과는 실시간이라 낮에 돌리면 "가장 새 자료가 전날"이 안 만들어진다.
 * → 프로세스 시계를 **내일 00:20 KST** 로 옮긴다. 살아 있는 검색 결과 전부가 주장된 "오늘"의
 *   전날 이전이 되어 사건 당시와 **같은 구조**가 된다. 도구는 가짜로 만들지 않는다.
 *   (a 팔에만 건다. c 팔은 진짜 시계 — 순수한 회귀 팔이어야 한다.)
 *
 * ── 모델을 고정한다 ──────────────────────────────────────────────────────────
 *   gemini-2.5-flash : freeTierSearch·groundingReliable 둘 다 true — **무료·유료 어느 키로도
 *                      같은 경로**를 탄다. 3.6/3.7 은 티어에 따라 폴백 여부가 갈려(models.ts)
 *                      위치 효과가 경로 차이에 묻힌다. 3.6 은 TIER1 실측 정답률 2/5 이기도 하다.
 *   gpt-5.6-luna     : 검증된 캡. gpt-6-luna 는 **카드 기재값뿐, 실호출 검증 없음** → 제외.
 *   시각 블록이 붙은 `finalInstruction` 은 OpenAI 에도 `instructions` 로 그대로 간다
 *   (generator.ts) — 같은 조작을 두 공급자에서 읽는다.
 *
 * ── 판정 (자수로 하지 않는다 — §5·§10-1·§11-3 에서 세 번 당했다) ──────────────
 *   a: 전날 자료를 내면서 **그 날짜를 밝혔는가**(날짜 문자열·"어제"·"전날" / "오늘은 아직 적다").
 *      검색이 안 일어났으면 조건이 안 만들어진 것 → ⚪ 무효(§8-3).
 *   c: 주제 답을 했는가 + **묻지 않은 날짜를 말하지 않았는가** + 태그 누설 없음.
 *      끝으로 옮긴 블록은 가장 최근에 읽히므로 "묻지도 않은 날짜 언급"이 새는지가 과교정 신호다.
 *
 * 순서 편향 방지: 한 라운드 안에서 start/end 를 **붙여서** 돌리고, 라운드마다 먼저 도는 쪽을 바꾼다.
 * 기준선을 먼저 다 돌리고 대안을 나중에 돌리면 시간대 변동이 위치 효과로 둔갑한다.
 *
 * 실행:
 *   TIER1=1 npx tsx --tsconfig tests/tsconfig.probe.json tests/manual/probe-time-block-position.mts --live [--rounds 7] [--only a|c] [--provider gemini|openai]
 * 실제 비용이 드는 수동 프로브 — `npm test` 에 넣지 않는다(tests/README: manual/ 은 test- 접두 금지).
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

for (const file of ['.env.local', '.env']) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.includes('=') || line.trim().startsWith('#')) continue;
        const i = line.indexOf('='); const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
    }
}
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
    console.log('[프로브] Gemini: TIER1 유료 키 단독 사용');
}
if (!process.env.OPENAI_API_KEY_TIER1) { console.error('OPENAI_API_KEY_TIER1 이 없다'); process.exit(1); }

const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
    const i = args.indexOf(name);
    if (i < 0) return fallback;
    if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${name} requires a value`);
    return args[i + 1];
};
const live = args.includes('--live');
const rounds = Number(option('--rounds', '7'));
const only = option('--only', '');
const onlyProvider = option('--provider', '');
const out = option('--out', '/tmp/time-block-position.json');

// ── 시계 — a 팔에만 "내일 00:20 KST" 를 건다 ─────────────────────────────────
const RealDate = Date;
const kstParts = (d: Date) => {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d);
    const g = (t: string) => Number(p.find(x => x.type === t)!.value);
    return { y: g('year'), m: g('month'), d: g('day') };
};
const realToday = kstParts(new RealDate());
// 내일 00:20 KST — 주장될 "오늘"
const tomorrowKst = new RealDate(RealDate.UTC(realToday.y, realToday.m - 1, realToday.d + 1, 0, 20) - 9 * 3600_000);
const claimed = kstParts(tomorrowKst);
let clockOffset = 0;
const bootReal = RealDate.now();
class ShiftedDate extends RealDate {
    constructor(...a: any[]) {
        if (a.length === 0) super(RealDate.now() + clockOffset);
        else super(...(a as [any]));
    }
    static now() { return RealDate.now() + clockOffset; }
}
(globalThis as any).Date = ShiftedDate;
const useClaimedClock = (on: boolean) => {
    // 켤 때마다 00:20 에서 다시 시작 — 라운드가 길어져도 "자정 직후" 가 유지된다
    clockOffset = on ? tomorrowKst.getTime() - RealDate.now() : 0;
};
void bootReal;

const { getSystemInstruction } = await import('../../server/agent/prompt.js');
const { compileAgentGraph } = await import('../../server/agent/graph.js');
const { HumanMessage } = await import('@langchain/core/messages');

// ── 팔 ───────────────────────────────────────────────────────────────────────
type ArmId = 'a' | 'c';
const ARMS: { id: ArmId; q: string; claimedClock: boolean; what: string }[] = [
    { id: 'a', q: '오늘 나온 AI 뉴스 알려줘', claimedClock: true, what: '전날 자료를 오늘로 조용히 내는가' },
    { id: 'c', q: '광합성 과정을 간단히 설명해줘', claimedClock: false, what: '무관한 턴 회귀(묻지 않은 날짜·누설)' },
];
const PROVIDERS = [
    { id: 'gemini', model: 'gemini-2.5-flash' },
    { id: 'openai', model: 'gpt-5.6-luna' },
] as const;
type Pos = 'start' | 'end' | 'both';
const POSITIONS = (option('--positions', 'start,both').split(',') as Pos[]);

const selArms = only ? ARMS.filter(a => a.id === only) : ARMS;
const selProv = onlyProvider ? PROVIDERS.filter(p => p.id === onlyProvider) : PROVIDERS;

// ── 판정 ─────────────────────────────────────────────────────────────────────
const dateRx = (x: { m: number; d: number }) => new RegExp(`${x.m}\\s*월\\s*${x.d}\\s*일|${x.m}\\s*/\\s*${x.d}(?!\\d)`);
const before = (m: number, d: number) => m < claimed.m || (m === claimed.m && d < claimed.d);
/**
 * 전날 이전 자료임을 밝혔는가 — 시각 블록 3번째 줄이 시킨 일이다.
 *
 * 🔴 스모크(2026-09-28)에서 판정기 결함 2건을 본문을 읽고 찾았다:
 *   ① `9월 28일` 만 찾아 **범위 표기** *"9월 27~28일에 나온 내용"* 을 놓쳤고, `오늘…아직` 만 찾아
 *      *"29일 **당일** 새 기사는 아직 많지 않습니다"* 를 놓쳤다 → 규칙을 정확히 지킨 답을 **거짓 실패**.
 *   ② `(아직|많지 않|적|없)` 의 `적` 이 **"누적"** 에 걸려 다른 답이 **우연히** 통과했다.
 *   → 날짜는 범위까지 읽고 "주장된 오늘보다 앞선 날짜" 로 판단한다. 한 글자 어휘는 쓰지 않는다.
 */
const mentionsEarlierDate = (t: string) => {
    for (const m of t.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})(?:\s*[~\-–]\s*(\d{1,2}))?\s*일/g)) {
        const mo = Number(m[1]), d1 = Number(m[2]);
        // 같은 달·7일 이내만 — "2025년 3월 출시된" 같은 곁다리 날짜를 고지로 세지 않는다
        if (mo === claimed.m && before(mo, d1) && claimed.d - d1 <= 7) return true;
    }
    return false;
};
const disclosesEarlier = (t: string) =>
    mentionsEarlierDate(t)
    || /어제|전날|하루 전/.test(t)
    || /(오늘|당일)[^.\n]{0,30}(아직|많지 않|거의 없|나오지 않)/.test(t);
/**
 * 🔴 오늘 날짜를 **틀리게 단정**했는가 — 스모크에서 gemini(end) 가 주장된 오늘(9/29)도
 *    실제 오늘(9/28)도 아닌 *"오늘(2026년 9월 27일)"* 이라고 썼다. 시각 블록이
 *    "This is the ONLY source for today's date" 라고 못 박은 것을 정면으로 어긴 것이라
 *    고지 여부와 **별도 사유**로 센다.
 */
const wrongToday = (t: string) => {
    for (const m of t.matchAll(/오늘\s*(?:은|는)?\s*[(（]?\s*\**\s*(?:\d{4}\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
        if (Number(m[1]) !== claimed.m || Number(m[2]) !== claimed.d) return `${m[1]}/${m[2]}`;
    }
    return '';
};
const DOMAIN_C = /엽록체|엽록소|이산화탄소|포도당|산소|빛\s*에너지|명반응|암반응|캘빈/;
const TAG_LEAK = /CURRENT_SYSTEM_TIME|PROVIDED_SOURCE_TEXT|ACTIVE_WEB_SEARCH/;

type Verdict = { pass: boolean; invalid: boolean; notes: string[] };
const judge = (arm: ArmId, text: string, searched: boolean): Verdict => {
    const notes: string[] = [];
    if (!text.trim()) return { pass: false, invalid: false, notes: ['빈 응답'] };
    if (TAG_LEAK.test(text)) notes.push('🔴 태그 누설');
    if (arm === 'a') {
        if (!searched) return { pass: true, invalid: true, notes: ['⚪ 무효: 검색 미발생 — 전날 자료 조건이 안 만들어짐'] };
        const wt = wrongToday(text);
        if (wt) notes.push(`🔴 오늘을 ${wt} 로 틀리게 단정`);
        if (!disclosesEarlier(text)) notes.push('🔴 전날 자료를 날짜 고지 없이 오늘로 냈다');
        return { pass: !notes.some(n => n.startsWith('🔴')), invalid: false, notes };
    }
    const hasDomain = DOMAIN_C.test(text);
    const unaskedDate = dateRx(realToday).test(text) || /오늘은\s|현재 시각|오늘 날짜/.test(text);
    if (!hasDomain) notes.push('🔴 주제 답 없음');
    if (unaskedDate) notes.push('🔴 묻지 않은 날짜 언급');
    return { pass: !notes.some(n => n.startsWith('🔴')), invalid: false, notes };
};

// ── 한 턴 — route.ts 와 같은 이벤트 소비 ────────────────────────────────────
async function turn(q: string, model: string, pos: Pos) {
    const graph = compileAgentGraph(getSystemInstruction('Korean'), false, () => {}, 'Korean', { timeBlockAt: pos });
    let delivered = '', intent = '', sources = 0, finalText = '';
    const events = await graph.streamEvents({
        messages: [new HumanMessage({ content: [{ type: 'text', text: q }] })],
        webContent: '', attachments: [], contextInfo: '', pillData: null, sessionId: '',
        model, timeZone: 'Asia/Seoul', nextNode: 'router', movieContext: '',
        activeCards: [], cardContexts: [], lastTurnSearched: false,
    } as any, { version: 'v2' });
    for await (const ev of events as any) {
        const node = ev.metadata?.langgraph_node;
        if (ev.event === 'on_chain_end' && ev.name === 'router') {
            if (typeof ev.data?.output?.intent === 'string') intent = ev.data.output.intent;
        } else if (ev.event === 'on_chat_model_stream' && node === 'generator') {
            const t = ev.data?.chunk?.content;
            if (typeof t === 'string') delivered += t;
        } else if (ev.event === 'on_chain_end' && ev.name === 'generator') {
            const o = ev.data?.output;
            if (Array.isArray(o?.groundingSources)) sources = Math.max(sources, o.groundingSources.length);
            const m = o?.messages?.[0]?.content;
            if (typeof m === 'string' && m) finalText = m;
        }
    }
    return { text: delivered || finalText, intent, sources };
}

// ── 실행 ─────────────────────────────────────────────────────────────────────
// ── 재채점 — 판정기를 고친 뒤 저장된 응답으로 다시 센다(재호출 0) ─────────────────
const rescore = option('--rescore', '');
if (rescore) {
    const saved = JSON.parse(readFileSync(rescore, 'utf8'));
    // 저장 당시의 날짜로 판정해야 한다 — 오늘 재채점하면 "주장된 오늘" 이 달라진다
    Object.assign(realToday, saved.realToday); Object.assign(claimed, saved.claimed);
    for (const r of saved.rows) {
        if (r.notes?.some((n: string) => n.startsWith('⚪ 무효: 호출 실패'))) continue;
        const v = judge(r.arm, r.text, r.sources > 0);
        const was = r.invalid ? '⚪' : r.pass ? '✅' : '❌', now = v.invalid ? '⚪' : v.pass ? '✅' : '❌';
        console.log(`${was}→${now} r${r.round} ${r.provider.padEnd(6)} ${r.arm} ${r.pos.padEnd(5)} ${v.notes.join(' · ')}`);
    }
    process.exit(0);
}

const fmt = (x: { y: number; m: number; d: number }) => `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`;
const plan = selProv.length * selArms.length * POSITIONS.length * rounds;
console.log(JSON.stringify({
    rounds, arms: selArms.map(a => a.id), providers: selProv.map(p => p.model),
    realToday: fmt(realToday), claimedToday: `${fmt(claimed)} 00:20 KST (a 팔만)`,
    positions: POSITIONS, turns: plan, modelCallsApprox: plan * 2,
}, null, 2));
if (!live) { console.log('\n--live 없이 계획만 출력했다.'); process.exit(0); }

type Row = { round: number; provider: string; arm: ArmId; pos: Pos; ms: number; intent: string; sources: number; chars: number; text: string } & Verdict;
/**
 * 🔴 **이어서 하기.** `out` 파일이 있으면 거기 담긴 턴을 그대로 살리고 **없는 조합만** 돌린다.
 * 2026-09-28 에 IDE 가 죽으면서 56턴 실행이 **한 턴도 못 남기고** 통째로 날아갔다.
 * 프로브는 매 턴 저장하지만, 중단되면 다시 1라운드부터 도는 게 문제였다 — 유료 호출을 두 번 낸다.
 * 이제 라운드를 나눠(`--rounds 2` → `4` → `7`) 같은 `out` 에 쌓을 수 있다.
 * ⚠️ 저장본의 날짜가 오늘과 다르면 **이어 붙이지 않는다** — "주장된 오늘" 이 달라져 판정이 섞인다.
 */
const rows: Row[] = [];
if (existsSync(out)) {
    const prev = JSON.parse(readFileSync(out, 'utf8'));
    const sameDay = prev?.realToday?.d === realToday.d && prev?.realToday?.m === realToday.m;
    if (!sameDay) {
        console.error(`[프로브] ${out} 은 다른 날(${prev?.realToday?.m}/${prev?.realToday?.d}) 측정이다 — 다른 --out 을 쓰거나 지워라`);
        process.exit(1);
    }
    rows.push(...(prev.rows ?? []));
    console.log(`[프로브] 이어서 — 기존 ${rows.length}턴 유지`);
}
const done = new Set(rows.map(r => `${r.round}|${r.provider}|${r.arm}|${r.pos}`));

for (let round = 1; round <= rounds; round++) {
    // 라운드마다 먼저 도는 위치를 바꾼다 — 순서·시간대 변동이 위치 효과로 둔갑하지 않게
    const order: Pos[] = round % 2 ? [...POSITIONS] : [...POSITIONS].reverse();
    for (const p of selProv) for (const a of selArms) for (const pos of order) {
        if (done.has(`${round}|${p.id}|${a.id}|${pos}`)) continue;
        useClaimedClock(a.claimedClock);
        const t0 = performance.now();
        let r: Row;
        try {
            const { text, intent, sources } = await turn(a.q, p.model, pos);
            const v = judge(a.id, text, sources > 0);
            r = { round, provider: p.id, arm: a.id, pos, ms: Math.round(performance.now() - t0), intent, sources, chars: text.length, text: text.slice(0, 3000), ...v };
        } catch (e: any) {
            r = { round, provider: p.id, arm: a.id, pos, ms: Math.round(performance.now() - t0), intent: '', sources: 0, chars: 0, text: '',
                pass: false, invalid: true, notes: [`⚪ 무효: 호출 실패 ${String(e?.message ?? e).slice(0, 120)}`] };
        } finally { useClaimedClock(false); }
        rows.push(r);
        console.log(`${r.invalid ? '⚪' : r.pass ? '✅' : '❌'} r${round} ${p.id.padEnd(6)} ${a.id} ${pos.padEnd(5)} `
            + `${String(r.ms).padStart(6)}ms ${String(r.chars).padStart(5)}자 intent=${(r.intent || '?').padEnd(8)} src=${r.sources}  ${r.notes.join(' · ')}`);
        writeFileSync(out, JSON.stringify({ realToday, claimed, rows }, null, 2));
    }
}

console.log('\n── 요약 (⚪ 무효는 분모에서 뺀다) ──');
for (const p of selProv) for (const a of selArms) {
    const cell = (pos: Pos) => {
        const rs = rows.filter(r => r.round <= rounds && r.provider === p.id && r.arm === a.id && r.pos === pos);
        const valid = rs.filter(r => !r.invalid);
        return { pass: valid.filter(r => r.pass).length, n: valid.length, inv: rs.length - valid.length };
    };
    const [p0, p1] = POSITIONS;
    const s = cell(p0), e = cell(p1);
    // 사전 등록 기준: end 가 start 보다 낮으면 기각, 같거나 높을 때만 통과
    const verdict = s.n === 0 || e.n === 0 ? '판정 불가(유효 표본 없음)'
        : e.pass / e.n < s.pass / s.n ? `🔴 ${p1} 기각 — ${p0} 보다 낮다` : `✅ ${p1} 가 ${p0} 이상`;
    console.log(`${p.id.padEnd(6)} ${a.id}  ${p0} ${s.pass}/${s.n}${s.inv ? ` (⚪${s.inv})` : ''}   ${p1} ${e.pass}/${e.n}${e.inv ? ` (⚪${e.inv})` : ''}   → ${verdict}`);
}
// 🔴 실패를 방식으로 갈라 본다 — Q1 에서 F1(날짜 치환)만 위치에 민감했다(2/7→6/7).
//    합계만 보면 어느 방식이 줄었는지 못 읽는다.
console.log('\n── 실패 방식 분해 ──');
for (const p of selProv) for (const a of selArms) for (const pos of POSITIONS) {
    const rs = rows.filter(r => r.round <= rounds && r.provider === p.id && r.arm === a.id && r.pos === pos && !r.invalid);
    if (!rs.length) continue;
    const f1 = rs.filter(r => r.notes.some(n => n.includes('틀리게 단정'))).length;
    const f2 = rs.filter(r => r.notes.some(n => n.includes('고지 없이'))).length;
    console.log(`${p.id.padEnd(6)} ${a.id} ${pos.padEnd(5)} n=${rs.length}  F1 날짜치환 ${f1}  F2 무고지 ${f2}`);
}
console.log(`\n결과 저장: ${out}`);

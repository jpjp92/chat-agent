/**
 * 화면 카드의 **의도 흡입** 측정 — `TIER1=1 npx tsx tests/manual/live-card-suction.mts [반복수]`
 *
 * §6.15 에서 날씨·법률 카드가 무관한 다음 턴을 자기 쪽으로 끌어당기는 걸 고쳤다. 근거는
 * "2/2 재현" 이었다. 약국·병원·동물병원·영화·논문 카드는 **한 번도 재지 않았다**(§7).
 *
 * 🔴 **대조군이 핵심이다.** "약국 카드가 있을 때 X 로 갔다" 만으로는 카드 탓인지 원래 그런지
 * 모른다. 같은 질의를 카드 없이 돌린 결과와 **갈리는지**를 센다.
 *
 * 🔴 **intent 만 보면 놓친다.** §6.22 가 정확히 그랬다 — 의도는 `general` 로 맞았고
 * `needsSearch=false` 와 카드 근거 지시가 조용히 붙었다. 그래서 세 값을 함께 기록한다:
 *   intent · needsSearch · 카드 후속 플래그(cardFollowup/paperFollowup)
 *
 * ⚠️ `TIER1=1` 없이 돌리지 말 것. 무료 키 로테이션은 이 횟수에서 429 를 맞고 규칙 폴백으로
 * 떨어져 전부 `general` 이 된다 — 측정이 통째로 오염된다(§6.11 에서 겪었다).
 */
import fs from 'node:fs';
for (const file of ['.env.local', '.env']) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
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
    console.log('[프로브] TIER1 유료 키 단독 — 429 로 인한 측정 오염을 피한다');
} else {
    console.log('⚠️ TIER1=1 없이 돈다. 429 가 나면 전부 general 로 떨어져 결과가 무의미해진다');
}

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage, AIMessage } = await import('@langchain/core/messages');

const RUNS = Number(process.argv[2] ?? 3);

// ── 카드 픽스처 ──────────────────────────────────────────────────
// 감지 방식이 카드마다 다르다(router.ts §카드 감지). 영화만 메시지가 아니라 movieContext 다.
const card = (kind: string, body: object) =>
    new AIMessage(`검색 결과입니다.\n\n\`\`\`json:${kind}\n${JSON.stringify(body)}\n\`\`\``);

const CARDS: { key: string; label: string; state: () => any }[] = [
    {
        key: 'pharmacy', label: '약국',
        state: () => ({ messages: [new HumanMessage('서초구 약국 알려줘'), card('pharmacy', {
            area: '서초구', pharmacies: [{ name: '서초온누리약국', addr: '서초대로 100', tel: '02-123-4567' }],
        })] }),
    },
    {
        key: 'hospital', label: '병원',
        state: () => ({ messages: [new HumanMessage('서초구 소아과 알려줘'), card('hospital', {
            area: '서초구', hospitals: [{ name: '서초아이소아청소년과의원', addr: '서초대로 200', tel: '02-222-3333' }],
        })] }),
    },
    {
        key: 'vet', label: '동물병원',
        state: () => ({ messages: [new HumanMessage('서초구 동물병원 알려줘'), card('vet', {
            area: '서초구', vets: [{ name: '서초동물병원', addr: '서초대로 300', tel: '02-444-5555' }],
        })] }),
    },
    {
        key: 'movie', label: '영화',
        // 🔴 영화만 카드 메시지가 아니라 movieContext 문자열이 신호다
        state: () => ({
            messages: [new HumanMessage('강남 영화 상영표')],
            movieContext: 'CGV 강남 — 오디세이 10:00, 13:20 / 스파이더맨: 브랜드 뉴 데이 09:40, 12:35',
        }),
    },
    {
        key: 'paper', label: '논문',
        state: () => ({ messages: [new HumanMessage('프로바이오틱스 감기 논문'), card('paper', {
            query: 'probiotics common cold prevention', source: 'pubmed', total: 54,
            papers: [{ pmid: '23372900', title: 'The effect of probiotics on prevention of common cold', year: '2013' }],
        })] }),
    },
    // 고쳐 둔 둘 — 회귀 확인용으로 같이 돌린다
    {
        key: 'weather', label: '날씨',
        state: () => ({ messages: [new HumanMessage('서울 날씨'), card('weather', {
            location: { name: '서울' }, current: { temp: 27 }, daily: [{ date: '2026-09-01' }],
        })] }),
    },
    {
        key: 'law', label: '법률',
        state: () => ({ messages: [new HumanMessage('근로기준법 연차 조항'), card('law', {
            query: '연차', articles: [{ title: '근로기준법 제60조', body: '사용자는 …' }],
        })] }),
    },
];

// ── 무관 질의 ────────────────────────────────────────────────────
// 카드별로 다른 질의를 던지면 비교가 안 된다. 공통 7종을 전 카드에 똑같이 던지고,
// 어휘가 겹치는 함정 1종만 카드별로 바꾼다.
interface Q { q: string; want: string; note: string }
const COMMON: Q[] = [
    { q: '오늘 서울 날씨 어때?', want: 'weather', note: '다른 카드 의도로 정상 이동' },
    { q: '타이레놀 성분 알려줘', want: 'drug_info', note: '조회형 의도 유지' },
    { q: '지금 코스피 지수 얼마야?', want: 'general', note: '🔴 검색이 켜져 있어야 한다' },
    { q: '파이썬에서 리스트 정렬하는 법 알려줘', want: 'general', note: '검색 불필요한 일반 질문' },
    // 🔴 이게 실제 결함을 잡아낸 질의다 — 지시어가 하나도 없는데 `쉽게` 로 카드 대화에 걸렸다
    { q: '리액트 훅 쉽게 설명해줘', want: 'general', note: '🔴 목적어 있음 — 카드와 무관해야 한다' },
    { q: '이 사진 쉽게 설명해줘', want: 'general', note: '🔴 이미지 첨부 턴이 논문 카드에 물리면 안 된다' },
    // ⚖️ 아래 둘은 **지시어를 품고 있다**("3번"·"이"). 화면에 카드가 있을 때 후속으로 보고
    //   검색을 끄는 건 설계대로 맞는 동작이다 — 오히려 카드 없는 대조군이 검색을 켜는 게 이상하다
    //   (정리할 대상이 없는데). 처음엔 이걸 흡입으로 세는 바람에 43% 라는 부풀린 숫자가 나왔다.
    //   판정하지 않고 관찰만 한다.
    { q: '3번 항목 자세히 알려줘', want: '*', note: '지시어 있음 — 카드 후속이 정상이다(관찰)' },
    { q: '이 내용 표로 정리해줘', want: '*', note: '지시어 있음 — 카드 후속이 정상이다(관찰)' },
];
const TRAP: Record<string, Q> = {
    pharmacy: { q: '감기 걸렸는데 어떻게 해?', want: 'medical_qa', note: '어휘 겹침 — 약국 위치가 아니다' },
    hospital: { q: '건강보험 본인부담금 얼마야?', want: 'general', note: '어휘 겹침 — 병원 목록이 아니다' },
    vet: { q: '강아지 사료 추천해줘', want: 'general', note: '어휘 겹침 — 동물병원이 아니다' },
    movie: { q: '오징어게임 시즌3 언제 나와?', want: 'general', note: '어휘 겹침 — 상영표가 아니다' },
    paper: { q: '프로바이오틱스 뭐가 좋아?', want: 'medical_qa', note: '어휘 겹침 — 논문 요청이 아니다' },
    weather: { q: '태풍 이름은 누가 정해?', want: 'general', note: '어휘 겹침 — 예보가 아니다' },
    law: { q: '변호사 비용 얼마나 들어?', want: 'general', note: '어휘 겹침 — 조문이 아니다' },
};

/** 한 번의 라우터 판정을 비교 가능한 한 줄로 압축한다. */
const sig = (o: any) => `${o.intent}/${o.needsSearch ? 'S' : '-'}` +
    `${o.cardFollowup ? `/cf:${o.cardFollowup}` : ''}${o.paperFollowup ? '/pf' : ''}` +
    `${o.movieFollowup ? '/mf' : ''}${o.weatherFollowup ? '/wf' : ''}`;

async function run(state: any, q: string): Promise<string> {
    try {
        const out: any = await routerNode({ ...state, messages: [...state.messages, new HumanMessage(q)] });
        return sig(out);
    } catch (e) { return `ERR(${e instanceof Error ? e.message.slice(0, 30) : e})`; }
}

// ── 대조군 먼저 ──────────────────────────────────────────────────
const allQueries = [...COMMON, ...Object.values(TRAP)];
const control = new Map<string, string[]>();
console.log(`\n── 대조군 (카드 없음) · 질의 ${allQueries.length}종 × ${RUNS}회 ──`);
for (const c of allQueries) {
    const got: string[] = [];
    for (let i = 0; i < RUNS; i++) got.push(await run({ messages: [] }, c.q));
    control.set(c.q, got);
    const uniq = [...new Set(got)];
    const ok = c.want === '*' || got.every(g => g.startsWith(`${c.want}/`));
    console.log(`  ${ok ? '✅' : '⚠️'} "${c.q}"  →  ${uniq.join(' , ')}${c.want !== '*' ? `  (기대 ${c.want})` : ''}`);
}

// ── 카드별 ──────────────────────────────────────────────────────
let pulled = 0, searchKilled = 0, total = 0;
const findings: string[] = [];
for (const cardDef of CARDS) {
    console.log(`\n── ${cardDef.label} 카드가 떠 있을 때 ──`);
    const queries = [...COMMON, TRAP[cardDef.key]];
    for (const c of queries) {
        const got: string[] = [];
        for (let i = 0; i < RUNS; i++) got.push(await run(cardDef.state(), c.q));
        total += RUNS;
        const ctrl = control.get(c.q)!;
        const ctrlSet = new Set(ctrl);
        const drifted = got.filter(g => !ctrlSet.has(g));
        // 대조군은 검색을 켰는데 카드가 있으니 껐다 — §6.22 형태의 조용한 결함
        const killed = got.filter((g, i) => ctrl.some(x => x.endsWith('/S')) && !g.includes('/S')).length;
        pulled += drifted.length;
        searchKilled += killed;
        const mark = drifted.length === 0 ? '✅' : killed ? '🔴' : '⚠️';
        console.log(`  ${mark} "${c.q}"`);
        console.log(`      카드있음 ${[...new Set(got)].join(' , ')}`);
        console.log(`      대조군   ${[...new Set(ctrl)].join(' , ')}${c.note ? `   — ${c.note}` : ''}`);
        if (drifted.length) findings.push(`${cardDef.label} 카드 + "${c.q}" → ${[...new Set(drifted)].join(',')} (대조 ${[...new Set(ctrl)].join(',')})${killed ? ' 🔴 검색 꺼짐' : ''}`);
    }
}

console.log(`\n── 요약 ── 카드 ${CARDS.length}종 × 질의 8 × ${RUNS}회 = ${total}회`);
console.log(`  대조군과 갈린 판정 ${pulled}건 (${(pulled / (total || 1) * 100).toFixed(0)}%)`);
console.log(`  🔴 그중 검색이 꺼진 것 ${searchKilled}건 — 이게 §6.22 형태의 조용한 결함이다`);
if (findings.length) { console.log('\n── 갈린 자리 ──'); for (const f of findings) console.log(`  ${f}`); }
else console.log('  ✅ 흡입 없음');

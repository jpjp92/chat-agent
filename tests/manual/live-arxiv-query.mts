/**
 * arXiv 검색어 조립 실측 — `npx tsx tests/manual/live-arxiv-query.mts [질의…]`
 *
 * 🔴 왜 필요한가(2026-09-03). `트랜스포머 논문 찾아줘` 에 모델이 `transformer neural network`
 * 로 검색해 **상위 5건 중 관련 1건**짜리 카드가 나갔다. 원 논문은 없고 베이즈 필터·음향 인식이
 * 올라왔다. 조립을 고쳐 5/5 로 되돌렸는데, 그 판단의 근거가 전부 일회용 스크립트였다 —
 * 다음에 `GENERIC_TERMS` 를 만질 때 같은 측정을 다시 짜야 한다. 그래서 프로브로 고정한다.
 *
 * 무엇을 보는가: 총건수가 아니라 **상위 5건의 관련도**가 지표다 — 총건수는 줄어도 관련도가
 * 무너질 수 있다(그게 이번 결함이었다). 조립이 기준선과 다르면 **전후를 나란히** 띄운다.
 *
 * 🔴 **이 프로브가 만들자마자 한 일**: 범용어를 AND 에서 빼는 수정을 넣었더니
 * `transformer neural network` 는 1/5 → 5/5 로 나아졌지만 `graph neural network` 가
 * 5/5 → **0/5**(그래프 이론), `convolutional neural network` 가 5/5 → **1/5**(부호이론)로
 * 무너졌다. 하나 고치고 둘 깨는 교환이라 되돌렸다. 정규식 판정이 느슨해 처음엔 5/5 로 보였다 —
 * **숫자만 보지 말고 제목을 읽을 것.**
 *
 * ⚠️ arXiv 는 3초 간격을 요구한다(`MIN_GAP_MS`). 케이스당 2회 호출이라 12케이스면 ~80초.
 *    실측 중 한 호출이 15s 걸린 적이 있다 — 서두르면 스로틀된다.
 *
 * 인자를 주면 그 질의만 본다: `npx tsx tests/manual/live-arxiv-query.mts "spiking neural network"`
 */
import { buildArxivSearchQuery, buildArxivQueryPlan, parseArxivFeed } from '../../server/agent/arxiv-tool.js';

const GAP_MS = 3_200;
const TOP_N = 5;
/** 이 밑으로 떨어지면 실패로 본다. 5건 중 4건은 관련 있어야 카드라고 부를 수 있다. */
const MIN_RELEVANT = 4;

/** 조립 전 기준선 — 범용어를 빼지 않던 옛 동작. 델타를 보려고 여기 남긴다. */
const rawAssembly = (q: string): string => {
    const w = q.trim().split(/\s+/).filter(x => x.length > 1);
    return w.length < 2 ? `all:${w[0] ?? q}` : w.map(x => `all:${x}`).join(' AND ');
};

const fetchTop = async (searchQuery: string) => {
    const p = new URLSearchParams({
        search_query: searchQuery, start: '0', max_results: String(TOP_N),
        sortBy: 'relevance', sortOrder: 'descending',
    });
    const res = await fetch(`https://export.arxiv.org/api/query?${p}`);
    if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
    return parseArxivFeed(await res.text());
};

/**
 * 관련성 판정.
 *
 * ⚖️ 자동 판정은 **근사다.** 정규식이 제목·초록에 걸리는지만 본다 — 사람이 보면 다를 수 있다.
 * 그래서 제목을 전부 찍는다. 숫자가 애매하면 제목을 읽고 판단할 것.
 */
type Case = {
    query: string;
    relevant: RegExp;
    note?: string;
    /** arXiv 코퍼스 자체에 그 주제가 없어 0건이 정답인 케이스 — 미달로 세지 않는다. */
    expectEmpty?: true;
    /**
     * **질의 자체가 나쁜** 케이스. 조립으로는 못 고치고 상류(도구 설명)에서 막는다.
     * 여기서 관련도가 낮은 것이 정상이다 — 이 프로브는 그 사실을 기록으로 남긴다.
     */
    upstreamGuarded?: true;
    /** 이 케이스만의 합격선. 제목 질의처럼 **딱 한 편**을 찾는 게 목적이면 5건 중 4건은 무의미하다. */
    minRelevant?: number;
};

const CASES: Case[] = [
    // 🔴 이번 결함의 원본. 모델이 `neural network` 를 덧붙인 질의다.
    // 🔴 결함 원본. 사용자는 `트랜스포머 논문` 만 물었는데 모델이 `neural network` 를 덧붙였다.
    //   조립을 바꿔 고치려다 복합 개념 질의를 깨서 되돌렸다 → **도구 설명이 이 질의를 막는다.**
    //   그래서 여기서 1/5 인 것이 정상이다. 이 줄은 "질의가 이렇게 오면 이렇게 나쁘다" 의 증거다.
    { query: 'transformer neural network', relevant: /transformer|attention|self-attention/i,
      note: '질의 자체가 나쁨 — 도구 설명이 상류에서 막는다', upstreamGuarded: true },
    // 위 질의의 정답 형태. 모델이 사용자 말을 그대로 쓰면 이렇게 된다.
    { query: 'transformer', relevant: /transformer|attention|self-attention/i,
      note: '사용자가 말한 그대로 — 5/5 여야 한다' },
    // 범용어가 주제 자체인 경우. 빼도 되는지 확인한다.
    { query: 'spiking neural network', relevant: /spiking|\bsnn\b/i, note: '범용어가 주제' },
    // ⚠️ 정규식을 좁게 잡는다. `/graph/i` 로 두면 그래프 **이론** 논문까지 관련으로 세어
    //    회귀를 숨긴다(실제로 숨겼다).
    { query: 'graph neural network', relevant: /graph neural|\bgnn\b|message passing/i,
      note: '복합 개념 — 쪼개면 그래프 이론이 온다' },
    { query: 'convolutional neural network', relevant: /convolutional neural|\bcnn\b/i,
      note: '복합 개념 — 쪼개면 부호이론이 온다' },
    // 전부 범용어 → fail-open 이 서는지
    { query: 'deep learning', relevant: /deep|learning/i, note: 'fail-open' },
    // 주제어끼리의 AND — 조립이 실제로 좁혀 주는 쪽. 이게 깨지면 좁히기를 과하게 한 것이다.
    { query: 'transformer attention optimization', relevant: /transformer|attention/i,
      note: 'AND 가 필요한 쪽 (DEV_260830 §6.13)' },
    { query: 'reinforcement learning reward design', relevant: /reinforcement|reward/i },
    // 비CS 분야 — GENERIC_TERMS 가 CS 편향인지 본다
    // 🔴 실측(2026-09-03): 3단어 AND 로 **0건**이다. 조립 결함이 아니라 **arXiv 가 토목을 거의
    //   안 싣는다**(`all:retrofit` 505건 · `all:seismic AND all:retrofit` 5건). 0건을 OR 로
    //   넓히지 않는 것이 설계다(넓히면 무관한 논문이 온다 — DEV_260830 §6.13).
    //   ⚠️ 다만 라우터의 `paper_source` 는 "engineering of any kind → arxiv" 라고 말한다.
    //      토목 질의는 카드가 빈손으로 끝난다는 뜻이다 — 별건으로 판단할 것.
    { query: 'bridge seismic retrofit', relevant: /seismic|bridge|retrofit/i,
      note: '토목 — arXiv 미수록 (0건이 정답)', expectEmpty: true },
    { query: 'quantum error correction code', relevant: /quantum|error correction/i, note: '물리' },
    // 🔴 제목 질의(2026-09-03). 다섯 단어 중 셋이 불용어라 AND 조립이 `all:Attention AND all:Need`
    //   (7,982건)로 줄고 **원 논문 1706.03762 가 상위 5건에 못 들었다.** 구절 폴백이 고친 케이스다 —
    //   정규식은 원 논문을 가리키게 좁게 잡는다(`attention` 만 보면 아무거나 통과한다).
    { query: 'Attention Is All You Need', relevant: /^Attention Is All You Need[ .]/,
      note: '제목 질의 — 구절 폴백이 없으면 원 논문이 안 나온다', minRelevant: 1 },
];

const argv = process.argv.slice(2);
const cases: Case[] = argv.length
    ? argv.map(q => ({ query: q, relevant: /./ , note: '인자 — 관련도 판정 없음, 제목을 읽을 것' }))
    : CASES;

let failures = 0;
let first = true;

for (const c of cases) {
    if (!first) await new Promise(r => setTimeout(r, GAP_MS));
    first = false;

    // 🔴 프로덕션이 하는 그대로 **계획을 순회**한다. `buildArxivSearchQuery` 만 부르면
    //   구절 폴백이 빠져, 프로브가 프로덕션이 하지 않는 일을 재게 된다(§10.3 의 교훈).
    const plan = buildArxivQueryPlan(c.query);
    const baseline = rawAssembly(c.query);

    let assembled = plan[plan.length - 1];
    let now = { total: 0, papers: [] as Awaited<ReturnType<typeof fetchTop>>['papers'] };
    for (const [i, sq] of plan.entries()) {
        if (i > 0) await new Promise(r => setTimeout(r, GAP_MS));
        now = await fetchTop(sq);
        if (now.papers.length > 0) { assembled = sq; break; }
    }
    const hit = now.papers.filter(p => c.relevant.test(`${p.title} ${p.summary}`)).length;

    console.log(`\n■ "${c.query}"${c.note ? `  — ${c.note}` : ''}`);
    console.log(`   조립 → ${assembled}`);
    console.log(`   총 ${now.total.toLocaleString()}건 · 상위 ${TOP_N} 중 관련 ${hit}/${now.papers.length}`);
    for (const [i, p] of now.papers.entries()) {
        const ok = c.relevant.test(`${p.title} ${p.summary}`);
        console.log(`     ${ok ? '✓' : '✗'} ${i + 1}. ${p.title.slice(0, 78)}`);
    }

    // 조립이 기준선과 다를 때만 델타를 잰다 — 같으면 호출을 아낀다(3초씩 쌓인다).
    if (assembled !== baseline) {
        await new Promise(r => setTimeout(r, GAP_MS));
        const before = await fetchTop(baseline);
        const beforeHit = before.papers.filter(p => c.relevant.test(`${p.title} ${p.summary}`)).length;
        const arrow = hit > beforeHit ? '개선' : hit < beforeHit ? '🔴 악화' : '변화 없음';
        console.log(`   조립 전 (${baseline}) → ${beforeHit}/${before.papers.length}  ⇒ ${arrow}`);
    }

    if (c.expectEmpty) {
        const ok = now.papers.length === 0;
        console.log(`   ${ok ? '✅ 예상대로 빈손' : '🔴 빈손일 줄 알았는데 결과가 있다 — 코퍼스가 바뀌었다'}`);
        if (!ok) failures++;
    } else if (c.upstreamGuarded) {
        console.log(`   ℹ️ 관련도가 낮은 것이 정상 — 조립이 아니라 도구 설명이 막는 질의다`);
    } else if (argv.length === 0 && hit < (c.minRelevant ?? MIN_RELEVANT)) {
        failures++;
        console.log(`   🔴 기준 미달 (${c.minRelevant ?? MIN_RELEVANT}/${TOP_N} 필요)`);
    }
}

if (argv.length === 0) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(failures ? `🚨 ${failures}/${cases.length} 케이스가 기준 미달` : `✅ ${cases.length}/${cases.length} 케이스 통과`);
    if (failures) process.exitCode = 1;
}

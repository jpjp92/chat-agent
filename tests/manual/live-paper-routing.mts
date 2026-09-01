/**
 * paper_search 라우팅 누수 측정 — `npx tsx tests/manual/live-paper-routing.mts [반복수]`
 *
 * LLM 라우터는 확률적이라 1회 측정으로는 경계를 알 수 없다. 같은 질의를 여러 번 돌려
 * **누수율**을 센다. PubMed 는 의생명만 색인하므로 비의생명 주제가 새면 그 주제의
 * 보건 분야 단면이 근거랍시고 나간다(DEV_260830 §6.1).
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
/**
 * TIER1=1 이면 유료 키 하나만 쓴다. 무료 키 12개 로테이션으로 45회를 돌리면 라우터가
 * 429 로 죽고 규칙 폴백(→ general)으로 떨어져 **측정이 통째로 오염된다**(실측).
 * `API_KEY_TIER1` 은 `/^API_KEY\d*$/` 에 안 걸려 기본 풀에서 빠져 있으므로 여기서 주입한다.
 * config.ts 가 import 시점에 env 를 읽으므로 반드시 동적 import 앞에서 바꾼다.
 */
if (process.env.TIER1 === '1') {
    const tier1 = process.env.API_KEY_TIER1;
    if (!tier1) { console.error('API_KEY_TIER1 이 없다'); process.exit(1); }
    for (const k of Object.keys(process.env)) if (/^API_KEY\d+$/.test(k)) delete process.env[k];
    process.env.API_KEY = tier1;
    console.log('[프로브] TIER1 유료 키 단독 사용 — 429 로 인한 측정 오염을 피한다');
}

const { routerNode } = await import('../../server/agent/nodes/router.js');
const { HumanMessage } = await import('@langchain/core/messages');

const RUNS = Number(process.argv[2] ?? 3);
const FIELDS = process.argv.includes('--fields');
const UNSEEN = process.argv.includes('--unseen');

/**
 * 분야별 경계 확인 세트(--fields). 핵심은 **PubMed 수록 여부는 학문 이름이 아니라 주제로 갈린다**는 것:
 * 심리학·간호학·음악치료·운동생리학·노년학은 PubMed 에 방대하게 실려 있어 허용해야 하고,
 * 문학·예술사·거시경제·순수공학은 수록이 부수적이라 막아야 한다.
 */
const FIELD_CASES: { q: string; want: 'paper' | 'arxiv' | 'not-paper' | 'either'; note: string }[] = [
    // ── PubMed 안 (허용) ──
    { q: '인지행동치료 우울증 효과 연구', want: 'paper', note: '심리학·정신건강' },
    { q: '간호 인력 배치와 환자 예후 연구', want: 'paper', note: '간호학' },
    { q: '음악치료 불안 완화 연구 있어?', want: 'paper', note: '음악치료(PubMed 다수)' },
    { q: '운동생리학 최대산소섭취량 논문', want: 'paper', note: '운동과학' },
    { q: '고령화와 인지기능 저하 연구', want: 'paper', note: '노년학' },
    { q: '직업성 소음 노출 청력 연구', want: 'paper', note: '산업보건' },
    { q: '반려견 슬개골 탈구 연구 논문', want: 'paper', note: '수의학(PubMed 수록)' },
    { q: '식품 첨가물 안전성 연구', want: 'paper', note: '식품위생' },

    // ── PubMed 밖 (차단) ──
    { q: '한국 현대문학 논문 찾아줘', want: 'not-paper', note: '문학' },
    { q: '셰익스피어 비극 연구 알려줘', want: 'not-paper', note: '문학' },
    { q: '인상주의 회화 미술사 논문', want: 'not-paper', note: '예술사' },
    { q: '바로크 음악 형식 연구 찾아줘', want: 'not-paper', note: '음악학(치료 아님)' },
    { q: '인플레이션과 통화정책 논문', want: 'arxiv', note: '거시경제 → arXiv(econ)' },
    { q: '주식시장 변동성 연구 자료', want: 'arxiv', note: '금융 → arXiv(q-fin)' },
    { q: '조선시대 신분제 연구 논문', want: 'not-paper', note: '역사학' },
    { q: '헌법 개정 논의 관련 논문', want: 'not-paper', note: '법학 — law_search 로 가면 더 좋다' },
    { q: '교량 내진설계 논문 찾아줘', want: 'arxiv', note: '토목 → arXiv' },
    { q: '강화학습 보상함수 논문', want: 'arxiv', note: 'CS → arXiv' },

    // ── 경계 (어느 쪽도 방어 가능) ──
    { q: '최저임금 인상 효과 연구 있어?', want: 'either', note: '경제 — 보건 문헌은 주변부' },
    { q: '교육 격차 관련 연구 알려줘', want: 'either', note: '교육 — 건강격차 문헌 존재' },
    { q: '도시 녹지와 삶의 질 연구', want: 'either', note: '도시계획 — 환경보건 겹침' },
];
/**
 * 미등장 분야 세트(--unseen). **라우터 프롬프트에 한 번도 이름이 나오지 않는 분야들**이다.
 * 판정을 분야 목록으로 적어두면 적어둔 분야만 맞는다 — 여기가 그걸 드러내는 자리다.
 * 규칙("그 분야가 살아있는 몸을 연구하는가")이라야 처음 보는 분야도 갈린다. 실측 42/42.
 */
const UNSEEN_CASES: { q: string; want: 'paper' | 'arxiv' | 'not-paper' | 'either'; note: string }[] = [
    { q: '해양 포유류 회유 경로 연구 논문', want: 'paper', note: '해양생물학 — 생물' },
    { q: '벼 병해충 저항성 연구 찾아줘', want: 'paper', note: '식물병리학 — 생물' },
    { q: '말라리아 매개 모기 방제 논문', want: 'paper', note: '곤충학·기생충학' },
    { q: '치과 임플란트 골유착 연구', want: 'paper', note: '치의학' },
    { q: '언어치료 말더듬 중재 연구', want: 'paper', note: '언어병리학 — 치료' },
    { q: '고대 토기 편년 연구 논문 찾아줘', want: 'not-paper', note: '고고학 — 유물' },
    { q: '한국어 통사론 연구 알려줘', want: 'not-paper', note: '언어학 — 텍스트' },
    { q: '초고층 건축 구조 설계 논문', want: 'either', note: '건축 — 구조공학은 arXiv 주변부' },
    { q: '화산암 형성 과정 지질학 논문', want: 'arxiv', note: '지질학 → arXiv(physics.geo-ph)' },
    { q: '선거제도 개편 정치학 연구', want: 'not-paper', note: '정치학 — 제도' },
    { q: '복식부기 회계처리 연구 자료', want: 'not-paper', note: '회계학 — 추상' },
    { q: '이족보행 로봇 제어 논문', want: 'arxiv', note: '로봇공학 → arXiv' },
    { q: '인류 진화 화석 골격 연구 논문', want: 'either', note: '형질인류학 — 몸이지만 고생물' },
    { q: '수화 언어 습득 연구 있어?', want: 'either', note: '언어학/언어발달 겹침' },
];
const CASES: { q: string; want: 'paper' | 'arxiv' | 'not-paper' | 'either'; note: string }[] = [
    { q: '프로바이오틱스 감기 예방 논문 찾아줘', want: 'paper', note: '의생명+논문' },
    { q: '비타민D 효과 연구된 거 있어?', want: 'paper', note: '의생명+논문(간접)' },
    { q: '운동이 우울증에 미치는 영향 연구', want: 'paper', note: '의생명+연구' },
    { q: '장내 미생물 최신 연구 알려줘', want: 'paper', note: '생명과학' },
    { q: '아스피린 심혈관 예방 임상시험 결과', want: 'paper', note: '의생명+임상시험' },
    { q: '고혈압에 좋은 음식 알려줘', want: 'not-paper', note: '의학이나 논문요청 아님' },
    { q: '감기 걸렸는데 어떻게 해?', want: 'not-paper', note: '의학이나 논문요청 아님' },
    { q: '타이레놀 성분 알려줘', want: 'not-paper', note: '약품조회' },
    { q: '머신러닝 트랜스포머 논문 찾아줘', want: 'arxiv', note: 'CS → arXiv' },
    // 공중보건 인접 — PubMed 에 실제 문헌이 있고 카드가 범위를 밝히므로 어느 쪽이든 허용한다
    { q: '기후변화가 건강에 미치는 영향 연구', want: 'paper', note: '기후-건강(허용 대상)' },
    { q: '기후변화 관련 연구 결과 알려줘', want: 'either', note: '기후 일반 — 어느 쪽도 무방' },
    { q: '미세먼지 노출 관련 연구', want: 'paper', note: '환경보건(허용 대상)' },
    { q: '최저임금 인상 효과 연구 있어?', want: 'either', note: '경제 — 보건 문헌은 있으나 주변부' },
    { q: '반도체 공정 관련 논문 찾아줘', want: 'arxiv', note: '공학 → arXiv' },
    { q: '트랜스포머 어텐션 논문 찾아줘', want: 'arxiv', note: 'CS → arXiv' },
];

const rows: string[] = [];
/**
 * 세 갈래를 따로 센다. **"의생명이 아니면 arXiv" 가 아니다** — arXiv 도 어떤 질의에든 그럴듯한
 * 결과를 준다("한국어 통사론" → astro-ph 전파망원경). 그래서 오배송(엉뚱한 DB) 과
 * 미발송(있는 DB 를 놓침) 을 나눠 센다. 오배송이 더 해롭다 — 사용자는 근거를 받았다고 믿는다.
 */
let misrouted = 0, missed = 0, total = 0;
const WANT_INTENT = { paper: 'paper_search', arxiv: 'arxiv_search', 'not-paper': 'general' } as const;
for (const c of (UNSEEN ? UNSEEN_CASES : FIELDS ? FIELD_CASES : CASES)) {
    const got: string[] = [];
    for (let i = 0; i < RUNS; i++) {
        try {
            const out: any = await routerNode({ messages: [new HumanMessage(c.q)] } as any);
            got.push(out.intent);
        } catch { got.push('ERR'); }
    }
    total += RUNS;
    const cards = got.filter(g => g === 'paper_search' || g === 'arxiv_search').length;
    let mark = '➖', hits = cards;
    if (c.want !== 'either') {
        const wanted = WANT_INTENT[c.want];
        hits = got.filter(g => g === wanted).length;
        if (c.want === 'not-paper') {
            // 논문 카드만 안 나가면 통과다. 어느 의도로 갔는지는 묻지 않는다 — "헌법 개정 논문" 이
            // law_search 로 가는 건 오답이 아니라 이 앱에 법령 카드가 있어서 더 나은 답이다.
            hits = RUNS - cards;
            misrouted += cards;
        } else {
            missed += RUNS - cards;                                  // DB 가 있는데 카드가 안 나갔다
            misrouted += cards - hits;                               // 카드는 나갔는데 DB 가 틀렸다
        }
        mark = hits === RUNS ? '✅' : '🔴';
    }
    rows.push(`  ${mark} ${hits}/${RUNS} ${c.want === 'either' ? '카드' : c.want === 'not-paper' ? '카드없음' : WANT_INTENT[c.want]}  "${c.q}"  (${c.note})  → ${[...new Set(got)].join(',')}`);
}
console.log(`\n라우팅 ${(UNSEEN ? UNSEEN_CASES : FIELDS ? FIELD_CASES : CASES).length}종 × ${RUNS}회 = ${total}회\n`);
console.log(rows.join('\n'));
console.log(`\n🔴 오배송(엉뚱한 DB 로 갔거나, 어느 DB 에도 없는데 카드가 나감): ${misrouted}`);
console.log(`🔴 미발송(해당 DB 가 있는데 카드가 안 나감): ${missed}`);
console.log('➖ 는 어느 쪽으로 가도 무방한 경계 사례다(카드가 범위를 밝힌다).');

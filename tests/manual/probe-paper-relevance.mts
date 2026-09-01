/**
 * 논문 카드 관련도 프로브 — `npx tsx --env-file=.env tests/manual/probe-paper-relevance.mts [--arxiv]`
 *
 * 왜 만드나: 실측(2026-08-31, `프로바이오틱스 감기 논문`) 5건 중 **2건이 프로바이오틱스
 * 논문이 아니었다.** 1번은 비타민C·에키네시아 리뷰, 4번은 "Earthing accelerates immune
 * response"(접지) 발췌였다. 카드↔질문 관련도는 여태 자동 검사가 하나도 없다(§7).
 *
 * 🔴 **단순 용어 커버리지로는 못 가른다.** 위 사례를 손으로 계산해 보면 순위가 뒤집힌다:
 *     #1 무관 75% · #3 관련 75% · #5 관련 50% · #4 무관 75%
 * "common cold prevention" 은 결과 전체가 공유한다 — PubMed 가 그걸로 매칭했으니 당연하다.
 * 가르는 건 **주제어**(probiotics) 하나뿐이고, 그건 5/5 정확히 일치했다.
 *
 * 그래서 이 프로브가 재는 것은 두 지표의 **분리력 비교**다:
 *   ① 평면 커버리지 — 질의 용어 중 몇 개가 제목+초록에 있는가
 *   ② 주제어 존재   — 질의 용어 중 **PubMed 수록량이 가장 적은** 용어가 있는가
 * ②의 "가장 적은" 은 추측이 아니라 esearch 의 count 로 정한다(코퍼스가 직접 IDF 를 준다).
 *
 * ⚠️ 임계값을 여기서 정하지 않는다. 분포를 보고 나서 정한다 — 지금 정하면 표본 1개에
 * 맞춘 숫자가 된다. 프로덕션 필터는 이 프로브의 출력을 보고 별도로 짠다.
 *
 * eutils 를 import 하지 않고 count 질의를 직접 던진다. 프로덕션의 export 면을 넓히지 않기
 * 위해서다(데드코드 정리에서 과한 export 55건을 걷어낸 직후다) — 프로브는 측정 도구다.
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

const { paperTool } = await import('../../server/agent/paper-tool.js');
const { arxivTool } = await import('../../server/agent/arxiv-tool.js');

const WITH_ARXIV = process.argv.includes('--arxiv');
const WITH_SUBJECT = process.argv.includes('--subject');
/** 한 질의만 다시 재고 싶을 때: `… -- "probiotics common"` (부분 일치) */
const ONLY = process.argv.slice(2).find(a => !a.startsWith('--'));

/** 질의를 용어로 쪼갤 때 버리는 말. 이건 측정 도구의 것이라 프로덕션과 공유하지 않는다. */
const STOP = new Set(['a', 'an', 'the', 'of', 'for', 'in', 'on', 'at', 'to', 'by', 'with',
    'from', 'is', 'are', 'and', 'or', 'as', 'that', 'this', 'its', 'using', 'via', 'based']);

const terms = (q: string) => q.toLowerCase().split(/[^a-z0-9-]+/)
    .filter(w => w.length > 2 && !STOP.has(w));

/** 어미만 깎는다. 형태소 분석이 아니라 `preventing`↔`prevention` 정도를 잇기 위한 근사다. */
const stem = (w: string) => w.replace(/(ings?|ion|ies|es|s)$/, '');
const has = (hay: string, w: string) => hay.includes(stem(w));

// ── 용어별 수록량 (PubMed count) ──────────────────────────────────
const NCBI_KEY = process.env.NCBI_KEY ?? '';
let lastCall = 0;
const totalCache = new Map<string, number>();

async function pubmedCount(term: string): Promise<number> {
    if (totalCache.has(term)) return totalCache.get(term)!;
    const wait = Math.max(0, lastCall + (NCBI_KEY ? 150 : 400) - Date.now());
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastCall = Date.now();
    const qs = new URLSearchParams({ db: 'pubmed', term, rettype: 'count', retmode: 'json', tool: 'chat-agent' });
    if (NCBI_KEY) qs.set('api_key', NCBI_KEY);
    const res = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?${qs}`);
    const n = Number(JSON.parse(await res.text())?.esearchresult?.count ?? 0);
    totalCache.set(term, n);
    return n;
}

let lastArxiv = 0;
async function arxivCount(term: string): Promise<number> {
    if (totalCache.has(`arxiv:${term}`)) return totalCache.get(`arxiv:${term}`)!;
    const wait = Math.max(0, lastArxiv + 3100 - Date.now());   // arXiv ToU: 3초 간격
    if (wait) await new Promise(r => setTimeout(r, wait));
    lastArxiv = Date.now();
    const qs = new URLSearchParams({ search_query: `all:${term}`, start: '0', max_results: '1' });
    const xml = await (await fetch(`https://export.arxiv.org/api/query?${qs}`)).text();
    const n = Number(xml.match(/<opensearch:totalResults[^>]*>(\d+)</)?.[1] ?? 0);
    totalCache.set(`arxiv:${term}`, n);
    return n;
}

// ── 질의 세트 ────────────────────────────────────────────────────
// 모델이 실제로 도구에 넣는 모양(영어 학술어)으로 적는다. 라우팅이 아니라 **결과 관련도**를 재므로
// 한국어 원문은 주석으로만 남긴다.
const PUBMED_QUERIES = [
    'probiotics common cold prevention',            // 실측 결함이 나온 그 질의
    'vitamin D supplementation immune function',
    'aspirin cardiovascular prevention clinical trial',
    'exercise depression randomized controlled trial',
    'gut microbiome obesity',
    'music therapy anxiety reduction',
    'omega-3 fatty acids cognitive decline elderly',
    'intermittent fasting insulin resistance',
    'nurse staffing patient outcomes',
    'occupational noise exposure hearing loss',
];
/**
 * 🔴 **개입어가 질병어보다 흔한 질의**(실측 2026-09-01, `그럼 비타민D 논문은?`).
 * 주제는 `vitamin D` 인데 `D` 가 1글자라 용어 목록에서 빠지고, 남은 `vitamin`(512,555)이
 * `cold`(250,148)보다 흔해 **주제어를 질병어에 뺏긴다.** 그 `cold` 는 결과 5건 중 1건에만 있어
 * fail-open 이 발동하고 필터가 통째로 꺼진다 — 그래서 **요로감염 논문**이 감기 카드에 남았다.
 * 프로바이오틱스 질의는 주제어가 곧 최희귀어라 우연히 잘 맞았던 것이다.
 */
const SUBJECT_QUERIES = [
    'vitamin D common cold prevention respiratory tract infection',   // 실측 결함이 나온 그 질의
    'vitamin C common cold treatment',
    'zinc supplementation common cold duration',
    'melatonin sleep quality insomnia',
    'magnesium migraine prophylaxis',
    'coenzyme Q10 heart failure',
    'vitamin K2 bone mineral density',
    'iron deficiency anemia fatigue',
];
const ARXIV_QUERIES = [
    'transformer attention optimization',
    'reinforcement learning reward function',
    'bridge seismic design',
    'monetary policy inflation',
];

interface Row {
    q: string; n: number; title: string; head: string; headHit: boolean;
    cov: number; hits: string[]; miss: string[];
}
const rows: Row[] = [];
const perQuery: { q: string; head: string; headTotal: number; kept: number; total: number }[] = [];
const agreement: { q: string; byCount: string; byFreq: string | null; freqOfCount: number; tied: string[] }[] = [];
const candidates: { q: string; byCount: string; freqOfCount: number; total: number; applied: boolean;
    byMajority: string | null; majorityDrops: string[] }[] = [];

async function measure(
    q: string,
    fetchCard: (q: string) => Promise<any>,
    count: (t: string) => Promise<number>,
    label: string,
) {
    // efetch 가 502 를 뱉는 일이 있다(실측 1/10). 프로덕션은 429 만 재시도하므로 여기서 한 번 더 준다 —
    // 측정에서 한 질의가 통째로 빠지면 그 질의가 조용히 표본에서 사라진다.
    let card: any = null;
    for (let attempt = 0; attempt < 3 && !card; attempt++) {
        if (attempt) await new Promise(r => setTimeout(r, 2000 * attempt));
        const raw = String(await fetchCard(q));
        const m = raw.match(/^```json:paper\n([\s\S]*)\n```$/);
        if (!m) { console.log(`🔴 ${label} "${q}" — 카드 형식이 아니다`); return; }
        const parsed = JSON.parse(m[1]);
        if (parsed.error) { console.log(`   ↻ ${label} "${q}" — ${parsed.error} (재시도 ${attempt + 1}/3)`); continue; }
        card = parsed;
    }
    if (!card) { console.log(`🔴 ${label} "${q}" — 3회 모두 실패`); return; }

    const ts = terms(q);
    const counts = new Map<string, number>();
    for (const t of ts) counts.set(t, await count(t));
    // 주제어 = 코퍼스에 가장 적게 실린 용어. 0건이면 오타일 수 있으니 후보에서 뺀다.
    const head = [...counts.entries()].filter(([, n]) => n > 0)
        .sort((a, b) => a[1] - b[1])[0]?.[0] ?? ts[0];

    /**
     * 후보 ②: **결과 내 빈도**로 주제어를 고른다 — API 를 한 번도 더 부르지 않는다.
     * 착안: PubMed 가 이미 그 주제로 매칭했으므로 맥락어("common cold prevention")는 결과
     * 전건이 공유하고, 주제어만 일부에서 빠진다. 가장 적게 등장한 용어가 곧 판별어다.
     * 코퍼스 빈도(①)와 같은 답을 내면 프로덕션은 공짜 쪽을 쓰면 된다.
     */
    const docFreq = new Map<string, number>();
    for (const t of ts) docFreq.set(t, (card.papers ?? [])
        .filter((p: any) => has(`${p.title} ${p.summary}`.toLowerCase(), t)).length);
    const minFreq = Math.min(...docFreq.values());
    const tied = ts.filter(t => docFreq.get(t) === minFreq);
    // 전건이 공유하면 판별어가 없다 — 그런 질의는 거를 것도 없다
    const headByFreq = minFreq === (card.papers?.length ?? 0) ? null : (tied.length === 1 ? tied[0] : null);
    agreement.push({ q, byCount: head, byFreq: headByFreq, freqOfCount: docFreq.get(head) ?? 0, tied });

    /**
     * 후보 ③: **결과의 절반 이상에 등장하는 용어 중 가장 희귀한 것**.
     * 현행(①)은 최희귀어가 소수에만 있으면 fail-open 으로 통째로 포기한다. ③은 포기하는 대신
     * 한 칸 흔한 용어로 **물러선다** — 판별력은 약해지지만 아무것도 안 하는 것보다는 낫다.
     * 비타민D 사례: ① `cold`(1/5, 포기) vs ③ `vitamin`(4/5, 아연 논문 제외).
     */
    const half = Math.ceil((card.papers?.length ?? 0) / 2);
    const majority = ts.filter(t => (docFreq.get(t) ?? 0) >= half);
    const headByMajority = majority.length
        ? majority.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))[0] : null;
    const dropByMajority = headByMajority
        ? (card.papers ?? []).filter((p: any) => !has(`${p.title} ${p.summary}`.toLowerCase(), headByMajority)) : [];
    candidates.push({ q, byCount: head, freqOfCount: docFreq.get(head) ?? 0, total: card.papers?.length ?? 0,
        applied: (docFreq.get(head) ?? 0) >= half, byMajority: headByMajority,
        majorityDrops: dropByMajority.map((p: any) => p.title) });

    let kept = 0;
    for (const [i, p] of (card.papers ?? []).entries()) {
        const hay = `${p.title} ${p.summary}`.toLowerCase();
        const hits = ts.filter(t => has(hay, t));
        const headHit = has(hay, head);
        if (headHit) kept++;
        rows.push({
            q, n: i + 1, title: p.title, head, headHit,
            cov: ts.length ? hits.length / ts.length : 0,
            hits, miss: ts.filter(t => !has(hay, t)),
        });
    }
    perQuery.push({ q, head, headTotal: counts.get(head) ?? 0, kept, total: card.papers?.length ?? 0 });
    console.log(`  ${label} "${q}" — 주제어 \`${head}\`(${(counts.get(head) ?? 0).toLocaleString()}건) · ` +
        `주제어 있는 논문 ${kept}/${card.papers?.length ?? 0}   [${ts.map(t => `${t}:${(counts.get(t) ?? 0).toLocaleString()}`).join(' ')}]`);
}

console.log('\n── 질의별 측정 ──');
for (const q of PUBMED_QUERIES.filter(q => !ONLY || q.includes(ONLY))) {
    await measure(q, x => paperTool.invoke({ query: x, limit: 5 }), pubmedCount, 'PubMed');
}
if (WITH_SUBJECT) {
    for (const q of SUBJECT_QUERIES.filter(q => !ONLY || q.includes(ONLY))) {
        await measure(q, x => paperTool.invoke({ query: x, limit: 5 }), pubmedCount, 'PubMed');
    }
}
if (WITH_ARXIV) {
    for (const q of ARXIV_QUERIES.filter(q => !ONLY || q.includes(ONLY))) {
        await measure(q, x => arxivTool.invoke({ query: x, limit: 5 }), arxivCount, 'arXiv ');
    }
}

// ── 두 지표의 분리력 ──────────────────────────────────────────────
console.log('\n── 주제어가 없는 논문 (제안 규칙이 걸러낼 후보) ──');
const dropped = rows.filter(r => !r.headHit);
if (!dropped.length) console.log('  (없음)');
for (const r of dropped) {
    console.log(`  🔴 "${r.q}" #${r.n} · 커버리지 ${(r.cov * 100).toFixed(0)}% · 주제어 \`${r.head}\` 없음`);
    console.log(`      ${r.title.slice(0, 88)}`);
    console.log(`      걸린 용어 [${r.hits.join(' ')}]`);
}

console.log('\n── 커버리지 분포 (임계값을 정할 수 있는가) ──');
const bucket = (v: number) => `${Math.floor(v * 100 / 25) * 25}~`;
const byBucket = new Map<string, { keep: number; drop: number }>();
for (const r of rows) {
    const b = bucket(r.cov);
    const e = byBucket.get(b) ?? { keep: 0, drop: 0 };
    r.headHit ? e.keep++ : e.drop++;
    byBucket.set(b, e);
}
for (const b of [...byBucket.keys()].sort()) {
    const e = byBucket.get(b)!;
    console.log(`  커버리지 ${b.padEnd(4)}%  주제어 있음 ${e.keep}  ·  주제어 없음 ${e.drop}` +
        `${e.keep && e.drop ? '   ← 같은 구간에 둘 다 있다(커버리지로는 못 가른다)' : ''}`);
}

console.log('\n── 주제어 선정: 코퍼스 빈도(API 추가 호출) vs 결과 내 빈도(공짜) ──');
let same = 0, diff = 0, none = 0;
for (const a of agreement) {
    const mark = a.byFreq === null ? '➖' : a.byFreq === a.byCount ? '✅' : '🔴';
    if (a.byFreq === null) none++; else if (a.byFreq === a.byCount) same++; else diff++;
    console.log(`  ${mark} "${a.q}"\n      코퍼스 \`${a.byCount}\`(결과 ${a.freqOfCount}건에 등장)  ·  결과빈도 ` +
        `${a.byFreq ? `\`${a.byFreq}\`` : `판별어 없음(최저 ${a.tied.join('/')} 가 전건 공유)`}`);
}
console.log(`  → 일치 ${same} · 불일치 ${diff} · 판별어 없음 ${none}`);

console.log('\n── 후보 ③: 절반 이상 등장하는 용어 중 최희귀 (fail-open 대신 물러서기) ──');
let failOpen = 0, rescued = 0;
for (const c of candidates) {
    if (c.applied) { console.log(`  ✅ "${c.q}" — ① \`${c.byCount}\`(${c.freqOfCount}/${c.total}) 로 이미 걸린다`); continue; }
    failOpen++;
    if (c.byMajority && c.majorityDrops.length) rescued++;
    console.log(`  ${c.byMajority && c.majorityDrops.length ? '🟢' : '➖'} "${c.q}"`);
    console.log(`      ① \`${c.byCount}\`(${c.freqOfCount}/${c.total}) → fail-open, 아무것도 안 거른다`);
    console.log(`      ③ ${c.byMajority ? `\`${c.byMajority}\` → 제외 ${c.majorityDrops.length}건` : '후보 없음'}`);
    for (const t of c.majorityDrops) console.log(`         · ${t.slice(0, 84)}`);
}
console.log(`  → ① 이 포기한 질의 ${failOpen}종 중 ③ 이 뭔가 거른 것 ${rescued}종 (제외된 것이 진짜 무관한지는 눈으로 봐야 한다)`);

console.log('\n── 요약 ──');
console.log(`  논문 ${rows.length}건 / 질의 ${perQuery.length}종`);
console.log(`  주제어 없는 논문 ${dropped.length}건 (${(dropped.length / (rows.length || 1) * 100).toFixed(0)}%)`);
const emptied = perQuery.filter(p => p.total > 0 && p.kept === 0);
console.log(`  🔴 규칙 적용 시 카드가 통째로 비는 질의 ${emptied.length}종${emptied.length ? `: ${emptied.map(p => `"${p.q}"`).join(', ')}` : ''}`);
const thin = perQuery.filter(p => p.kept > 0 && p.kept <= 2);
console.log(`  ⚠️ 2건 이하로 얇아지는 질의 ${thin.length}종${thin.length ? `: ${thin.map(p => `"${p.q}"(${p.kept}/${p.total})`).join(', ')}` : ''}`);
console.log('\n주제어 판정이 맞는지는 위 목록을 **눈으로** 확인해야 한다 — 이 프로브는 자동 판정이 아니라 측정이다.');

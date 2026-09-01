/**
 * 논문 조회 API 실사용 가능성 프로브 — `npx tsx tests/manual/probe-paper-apis.mts`
 *
 * 국립의과학지식센터(NCMIK) OpenAPI 를 붙이려다 폐기한 경위가 배경이다. 그쪽은
 * **검색 파라미터가 배선돼 있지 않아** `kwd` 를 무엇으로 주든 같은 결과를 돌려줬고
 * (없는 단어까지 totalCnt 652,993 동일), `retstart` 는 1 외에는 빈 응답이라 50건을
 * 넘겨 가져올 수 없었으며, 응답에 URL·DOI 가 없어 인용 링크를 만들 수 없었다.
 *
 * 그래서 대체 후보 두 곳을 **문서가 아니라 실제 응답으로** 검증한다:
 *   - PubMed E-utilities … 검색 (MeSH 큐레이션)
 *   - CrossRef            … DOI 보강 / PubMed 미수록 국내 저널
 *
 * 네트워크를 타므로 `npm test` 에 넣지 않는다(tests/README ⓑ 기준).
 *
 * 환경변수(둘 다 선택):
 *   NCBI_KEY            무키 3 req/s → 10 req/s. §4 가 실제로 429 를 재현한다.
 *   PAPER_API_CONTACT   NCBI `email` / CrossRef `mailto`(polite pool) 용 연락처.
 *                       현재는 쓰지 않는다 — 비어 있으면 파라미터 자체를 보내지 않는다.
 */
const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
const CROSSREF = 'https://api.crossref.org/works';
// 레포의 HOSPITAL_KEY·PHARM_KEY·VET_KEY 관례를 따라 NCBI_KEY 를 쓴다.
const NCBI_KEY = process.env.NCBI_KEY ?? '';
const CONTACT = process.env.PAPER_API_CONTACT ?? '';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

/** 빈 값은 빼고 쿼리스트링을 만든다 — 키가 없을 때 `api_key=` 를 보내면 NCBI 가 400 을 준다. */
const qs = (o: Record<string, string | number | undefined>) =>
    new URLSearchParams(
        Object.entries(o)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)]),
    ).toString();

const eutilsCommon = { db: 'pubmed', retmode: 'json', api_key: NCBI_KEY, email: CONTACT, tool: 'chat-agent' };

/**
 * 프로브가 스스로 레이트리밋에 걸리지 않게 호출 간격을 벌린다.
 * 무키 3 req/s → 350ms, 키 있으면 10 req/s → 110ms. §4 만 의도적으로 이걸 우회한다.
 */
const MIN_GAP_MS = NCBI_KEY ? 110 : 350;
let lastCall = 0;
async function eutils(path: string, params: Record<string, string | number | undefined>) {
    for (let attempt = 0; attempt < 3; attempt++) {
        const wait = Math.max(0, lastCall + MIN_GAP_MS - Date.now());
        if (wait) await new Promise(r => setTimeout(r, wait));
        lastCall = Date.now();

        const res = await fetch(`${EUTILS}/${path}?${qs({ ...eutilsCommon, ...params })}`);
        if (res.status === 429) continue;          // 간격을 벌려 다시 시도
        if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
        return res.json() as Promise<any>;
    }
    throw new Error(`${path}: 429 가 3회 연속 — 레이트리밋을 벗어나지 못했다`);
}

type Paper = {
    source: 'pubmed' | 'crossref';
    id: string;
    title: string;
    journal?: string;
    year?: string | number;
    authors: string[];
    doi: string | null;
    url: string;
};

async function pubmedSearch(term: string, retmax = 3): Promise<{ total: number; items: Paper[] }> {
    const search = await eutils('esearch.fcgi', { term, retmax });
    const ids: string[] = search.esearchresult?.idlist ?? [];
    const total = Number(search.esearchresult?.count ?? 0);
    if (!ids.length) return { total, items: [] };

    const sum = await eutils('esummary.fcgi', { id: ids.join(',') });
    if (!sum.result) throw new Error(`esummary 응답에 result 가 없다: ${JSON.stringify(sum).slice(0, 200)}`);

    return {
        total,
        items: ids.map(id => {
            const r = sum.result[id];
            return {
                source: 'pubmed' as const,
                id,
                // esummary 의 title 에는 <i>·<sup> 같은 태그가 그대로 들어온다
                title: String(r.title ?? '').replace(/<\/?[^>]+>/g, ''),
                journal: r.fulljournalname,
                year: r.pubdate,
                authors: (r.authors ?? []).map((a: { name: string }) => a.name),
                doi: r.articleids?.find((a: { idtype: string }) => a.idtype === 'doi')?.value ?? null,
                url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`,
            };
        }),
    };
}

async function crossrefSearch(query: string, rows = 3, journal = ''): Promise<{ total: number; items: Paper[] }> {
    const url = `${CROSSREF}?${qs({
        query,
        rows,
        'query.container-title': journal,
        mailto: CONTACT,
        select: 'DOI,title,container-title,author,published',
    })}`;
    // CrossRef 는 부하가 걸리면 200 에 빈 본문을 돌려주는 일이 있다. JSON.parse 가 터지므로
    // 본문을 먼저 문자열로 받아 확인한다 — polite pool(mailto) 을 쓰면 빈도가 줄어든다.
    let msg: any;
    for (let attempt = 0; ; attempt++) {
        const res = await fetch(url, {
            headers: { 'User-Agent': `chat-agent/1.0${CONTACT ? ` (mailto:${CONTACT})` : ''}` },
        });
        const body = await res.text();
        if (res.ok && body.trim()) { msg = JSON.parse(body).message; break; }
        if (attempt >= 2) throw new Error(`CrossRef HTTP ${res.status} · 본문 ${body.length}B`);
        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
    }

    return {
        total: msg['total-results'],
        items: (msg.items ?? []).map((it: any) => ({
            source: 'crossref' as const,
            id: it.DOI,
            title: it.title?.[0] ?? '',
            journal: it['container-title']?.[0],
            year: it.published?.['date-parts']?.[0]?.[0],
            authors: (it.author ?? []).map((a: any) => `${a.family ?? ''} ${a.given ?? ''}`.trim()),
            doi: it.DOI,
            url: `https://doi.org/${it.DOI}`,
        })),
    };
}

// ─────────────────────────────────────────────────────────────
console.log(`\n환경: NCBI_KEY ${NCBI_KEY ? '있음' : '없음'} · 연락처 ${CONTACT || '없음'}`);

console.log('\n§1 PubMed 검색이 실제로 필터링하는가 (NCMIK 가 실패한 지점)');
{
    const hit = await pubmedSearch('probiotics common cold', 1);
    const other = await pubmedSearch('myocardial infarction stent', 1);
    const none = await pubmedSearch('zzzqqqxxnonsenseterm', 1);
    check('질의마다 건수가 달라진다', hit.total !== other.total,
        `probiotics ${hit.total} vs stent ${other.total}`);
    check('없는 단어는 0건', none.total === 0, `${none.total}건`);
    check('결과 ID 가 질의마다 다르다',
        hit.items[0]?.id !== other.items[0]?.id, `${hit.items[0]?.id} vs ${other.items[0]?.id}`);
}

console.log('\n§2 인용에 필요한 필드가 다 오는가');
{
    const { items } = await pubmedSearch('probiotics common cold', 3);
    check('제목·저널·연도·저자', items.every(p => p.title && p.journal && p.year && p.authors.length));
    check('인용 URL', items.every(p => /^https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\/$/.test(p.url)));
    check('DOI', items.every(p => p.doi), `${items.filter(p => p.doi).length}/${items.length}건`);
    for (const p of items) console.log(`     · ${p.title.slice(0, 66)}\n       ${p.journal} (${p.year}) ${p.url}`);
}

console.log('\n§3 NCMIK 가 주던 논문을 인용 링크와 함께 찾을 수 있는가');
{
    // NCMIK kFetch 샘플: Korean J Fam Med 2013;34(1):2-10 — 그쪽은 URL·DOI 를 주지 못했다
    // 제목 전체를 따옴표로 묶으면 정확일치라 빗나간다(실제 제목은 "The effect of probiotics on…").
    // 핵심어를 [Title] 로 AND 하고 저널로 좁힌다.
    const r = await pubmedSearch(
        'Probiotics Prevention Common Cold Meta-Analysis[Title] AND "Korean J Fam Med"[Journal]', 1);
    const p = r.items[0];
    check('PubMed 에 수록돼 있다', r.total >= 1, `${r.total}건`);
    check('DOI 가 있다', p?.doi === '10.4082/kjfm.2013.34.1.2', p?.doi ?? '없음');
    if (p) console.log(`     · ${p.url}`);

    const kjfm = await pubmedSearch('"Korean J Fam Med"[Journal]', 1);
    check('국내 저널이 통째로 색인돼 있다', kjfm.total > 500, `Korean J Fam Med ${kjfm.total}건`);
}

console.log(`\n§4 레이트리밋 — 병렬 6회 (키 ${NCBI_KEY ? '있음' : '없음'})`);
{
    const codes = await Promise.all(
        Array.from({ length: 6 }, () =>
            fetch(`${EUTILS}/esearch.fcgi?${qs({ ...eutilsCommon, term: 'asthma', retmax: 1 })}`)
                .then(r => r.status)),
    );
    const throttled = codes.filter(c => c === 429).length;
    console.log(`     응답 코드: ${codes.join(' ')}`);
    if (NCBI_KEY) {
        check('키가 있으면 429 없음 (10 req/s)', throttled === 0, `429 ${throttled}건`);
    } else {
        // 429 가 나는 게 정상이다 — 배포 환경에서 키가 왜 필요한지를 보여주는 관측이다
        console.log(`     ℹ️  429 ${throttled}건 — 무키 3 req/s 제한. Vercel 은 동시 인스턴스가`);
        console.log('        egress IP 를 공유하므로 배포 시 NCBI_KEY 를 권장한다.');
    }
}

console.log('\n§5 CrossRef — DOI 보강 / 국내 저널 폴백');
{
    const r = await crossrefSearch('probiotics common cold', 2, 'Korean Journal of Family Medicine');
    check('키 없이 응답한다', r.items.length > 0, `${r.items.length}건`);
    check('전건 DOI 보유', r.items.every(p => p.doi));
    for (const p of r.items) console.log(`     · ${p.title.slice(0, 66)}\n       ${p.journal} (${p.year}) ${p.url}`);

    // CrossRef 는 DOI 등록소지 큐레이션된 색인이 아니다. 검색 품질을 PubMed 와 같게 기대하면 안 된다.
    const broad = await crossrefSearch('probiotics common cold', 1);
    console.log(`     ℹ️  같은 질의 전체 검색 시 ${broad.total.toLocaleString()}건 — 적합도 정렬이 느슨하다.`);
    console.log('        검색은 PubMed 에 맡기고 CrossRef 는 DOI·미수록 저널 보강에만 쓴다.');
}

console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);

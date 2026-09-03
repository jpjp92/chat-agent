/**
 * `json:paper` 논문 카드 회귀 하니스 — `npx tsx tests/test-paper-card.mts`
 *
 * 네트워크·자격증명 없이 돈다(tests/README ⓐⓑ). 순수 로직은 **프로덕션 코드를 import** 하고(ⓒ),
 * 컴포넌트·프롬프트처럼 import 가 어려운 곳은 소스를 읽어 배선을 확인한다.
 *
 * 지키려는 계약 두 가지가 있다. 둘 다 의학 맥락에서 **조용히 틀리면 해로운** 것들이다:
 *   §1 미분류(`evidence: null`)를 등급으로 바꾸지 않는다 — 실측상 35%가 미분류인데,
 *      추측으로 등급을 붙이면 "아직 분류 안 됨"이 "등급이 낮음"으로 왜곡된다.
 *   §3 이해상충 플래그를 되살리지 않는다 — 규칙 판정이 실제 41건에서 20% 넘게 틀렸다.
 */
import fs from 'node:fs';
import { toEvidence, isRetracted, parseAbstracts, broadenQuery, relevanceTerms, pickHeadTerm, splitOffTopic, partitionPapers, filterOffTopicAside } from '../server/agent/paper-tool';
import { decidePaperCardFollowup, buildPaperFollowupRules } from '../server/agent/card-followup';
import { parseArxivFeed, unescapeXml, buildArxivSearchQuery, buildArxivQueryPlan } from '../server/agent/arxiv-tool';
import { pendingCardBlocks, pinCardToProse, dropMarkersOutsideRange, repairPaperMarkerLinks, sanitizeActiveCards } from '../server/agent/card-tool-output';
import { classifyIntentByRules, isNonBiomedicalPaperTopic } from '../server/agent/intentRules';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};
const read = (p: string) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

console.log('\n§1 근거 등급 판정 — pubtype 만 본다');
{
    check('Meta-Analysis → meta-analysis', toEvidence(['Journal Article', 'Meta-Analysis']) === 'meta-analysis');
    check('Systematic Review → meta-analysis', toEvidence(['Systematic Review']) === 'meta-analysis');
    check('RCT → rct', toEvidence(['Randomized Controlled Trial']) === 'rct');
    check('Review → review', toEvidence(['Journal Article', 'Review']) === 'review');
    check('빈 배열 → null', toEvidence([]) === null);

    // 🔴 핵심 계약. 제목이 무엇을 말하든 pubtype 이 이것뿐이면 등급을 붙이지 않는다.
    // PMID 23372900 은 제목에 "a meta-analysis" 라고 적혀 있지만 pubtype 은 이 하나다.
    check("['Journal Article'] 뿐이면 null — 제목으로 추정하지 않는다",
        toEvidence(['Journal Article']) === null,
        `실제 ${JSON.stringify(toEvidence(['Journal Article']))}`);

    // 상위 등급이 우선한다 (메타분석이면서 리뷰로도 태깅된 코크란 레코드가 흔하다)
    check('Meta-Analysis + Review → meta-analysis',
        toEvidence(['Review', 'Meta-Analysis', 'Systematic Review']) === 'meta-analysis');
}

console.log('\n§2 초록 파싱 — 라벨 있는 초록과 통짜 초록');
{
    const xml = `
<PubmedArticle><MedlineCitation><PMID Version="1">111</PMID><Article><Abstract>
<AbstractText Label="BACKGROUND" NlmCategory="BACKGROUND">배경 문장.</AbstractText>
<AbstractText Label="RESULTS" NlmCategory="RESULTS">결과 문장.</AbstractText>
<AbstractText Label="CONCLUSION" NlmCategory="CONCLUSIONS">Probiotics had a <i>marginal</i> effect &amp; low certainty.</AbstractText>
</Abstract></Article></MedlineCitation></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">222</PMID><Article><Abstract>
<AbstractText>First sentence here. Middle sentence here. In conclusion, it worked.</AbstractText>
</Abstract></Article></MedlineCitation>
<PubmedData><CoiStatement>The authors declare a financial interest.</CoiStatement></PubmedData></PubmedArticle>
<PubmedArticle><MedlineCitation><PMID Version="1">333</PMID><Article></Article></MedlineCitation></PubmedArticle>`;

    const parsed = parseAbstracts(xml);
    check('article 3건을 모두 읽는다', parsed.size === 3, `${parsed.size}건`);
    check('CONCLUSION 라벨만 고른다',
        parsed.get('111')?.text === 'Probiotics had a marginal effect & low certainty.',
        JSON.stringify(parsed.get('111')?.text));
    check('라벨 결론은 kind=conclusion', parsed.get('111')?.kind === 'conclusion', String(parsed.get('111')?.kind));
    check('태그 제거 + 엔티티 복원', !parsed.get('111')?.text.includes('<i>') && parsed.get('111')!.text.includes('&'));
    check('통짜 초록은 결론 신호부터 집는다',
        parsed.get('222')?.text === 'In conclusion, it worked.',
        JSON.stringify(parsed.get('222')?.text));
    check('통짜 초록은 kind=excerpt (추측이라고 밝힌다)',
        parsed.get('222')?.kind === 'excerpt', String(parsed.get('222')?.kind));
    check('초록이 없으면 빈 문자열', parsed.get('333')?.text === '', JSON.stringify(parsed.get('333')?.text));
    // 🔴 null 이 아니라 'none' 이다. 빈 값은 모델이 "결론을 제시하지 않은 논문" 으로 옮겨 적었다.
    check("초록이 없으면 kind='none' (발췌라고도, 빈 값이라고도 하지 않는다)",
        parsed.get('333')?.kind === 'none', String(parsed.get('333')?.kind));
}

console.log('\n§2a 결론이 아닌 꼬리 — 후속연구 권고·등록번호를 결론으로 내보내지 않는다');
{
    // 🔴 실제 결함(PMID 27055821): 1,933자 통짜 초록의 마지막 두 문장이 곁가지였고,
    //   프로바이오틱스 질의 카드에 그게 논문 결론인 양 박혔다.
    const wrap = (pmid: string, body: string) =>
        `<PubmedArticle><MedlineCitation><PMID Version="1">${pmid}</PMID><Article><Abstract>` +
        `${body}</Abstract></Article></MedlineCitation></PubmedArticle>`;

    const boiler = parseAbstracts(wrap('1',
        '<AbstractText>Background here. Probiotics reduced episodes of infection. ' +
        'Thus, future studies are recommended to reveal any potential curative effects.</AbstractText>'));
    check('후속연구 권고 문장을 걷어낸다',
        !boiler.get('1')!.text.includes('future studies'), JSON.stringify(boiler.get('1')?.text));
    check('걷어낸 뒤 실제 결과 문장이 남는다',
        boiler.get('1')!.text.includes('Probiotics reduced episodes'), JSON.stringify(boiler.get('1')?.text));

    const reg = parseAbstracts(wrap('2',
        '<AbstractText>Alpha result. Beta result. Gamma result. This trial is registered at ClinicalTrials.gov NCT01234567.</AbstractText>'));
    check('등록번호 문장을 결론으로 쓰지 않는다',
        !reg.get('2')!.text.includes('NCT01234567'), JSON.stringify(reg.get('2')?.text));

    // 전부 보일러플레이트면 원본을 지운 채 빈손으로 돌아가면 안 된다
    const allBoiler = parseAbstracts(wrap('3',
        '<AbstractText>Further research is needed.</AbstractText>'));
    check('전부 꼬리면 원본을 그대로 둔다 (빈손 금지)',
        allBoiler.get('3')!.text.length > 0, JSON.stringify(allBoiler.get('3')?.text));

    // 결론 라벨이 없는 구조화 초록도 발췌다
    const noConc = parseAbstracts(wrap('4',
        '<AbstractText Label="BACKGROUND">배경.</AbstractText><AbstractText Label="RESULTS">결과가 있었다.</AbstractText>'));
    check('결론 라벨 없는 구조화 초록도 kind=excerpt',
        noConc.get('4')?.kind === 'excerpt', String(noConc.get('4')?.kind));
}

console.log('\n§2c 철회 논문 — pubtype 에 이미 들어 있는 사실이다');
{
    check('Retracted Publication → 철회', isRetracted(['Journal Article', 'Retracted Publication']));
    // 🔴 뜻이 정반대다. 철회 공고를 철회 논문으로 잡으면 정상 문헌을 깎는다.
    check('Retraction of Publication(철회 공고)은 철회가 아니다',
        !isRetracted(['Journal Article', 'Retraction of Publication']));
    check('Expression of Concern(우려 표명)은 철회가 아니다',
        !isRetracted(['Journal Article', 'Expression of Concern']));
    check('평범한 논문은 false', !isRetracted(['Journal Article', 'Meta-Analysis']));
    check('빈 배열도 false', !isRetracted([]));
    // 철회돼도 연구 설계는 사실이다 — 등급을 지우는 게 아니라 철회를 덧붙인다
    check('철회 논문의 등급 판정은 그대로다',
        toEvidence(['Meta-Analysis', 'Retracted Publication']) === 'meta-analysis');
}

console.log('\n§2b 검색어 붕괴 방어 — PubMed 는 용어를 AND 로 묶는다');
{
    // 🔴 실측: 짧은 검색어 398건 → 연구설계어까지 붙인 긴 검색어 1건. 한 단어 더면 0건이고,
    //   그러면 수백 건이 있는데도 "논문을 찾지 못했습니다" 가 나간다(조용히 틀리는 쪽).
    const LONG = 'probiotics prevention common cold upper respiratory tract infections randomized controlled trial';
    check('긴 검색어를 앞 4개 핵심어로 줄인다',
        broadenQuery(LONG) === 'probiotics prevention common cold', broadenQuery(LONG));
    // 이미 짧으면 그대로 — 호출부가 "넓힌 결과가 원본과 같으면 재시도하지 않는다" 로 쓴다
    check('짧은 검색어는 건드리지 않는다', broadenQuery('probiotics common cold') === 'probiotics common cold');
    check('공백이 여러 개여도 정규화한다', broadenQuery('  a   b  c   d  e ') === 'a b c d');

    const src = read('../server/agent/paper-tool.ts');
    check('0건일 때만 넓혀 재시도한다', /if \(!ids\.length\)[\s\S]{0,140}broadenQuery\(query\)/.test(src));
    check('넓힌 검색어가 원본과 같으면 재시도하지 않는다 (무한 반복 방지)', /broader !== query\.trim\(\)/.test(src));
    check('프롬프트도 검색어를 짧게 쓰라고 지시한다',
        /Keep the query to 2-4 core concepts/.test(read('../server/agent/prompt.ts')));
}

console.log('\n§3 이해상충은 뽑지 않는다 (되살아나면 실패)');
{
    const toolSource = read('../server/agent/paper-tool.ts');
    const rendererSource = read('../components/PaperRenderer.tsx');
    // 규칙 기반 판정이 실제 CoiStatement 41건에서 양방향으로 20% 넘게 틀렸다.
    // "has received research grant support" 를 없음으로, "in the absence of any
    // commercial relationships" 를 있음으로 잡는다. 플래그로 쓸 수 없다.
    check('도구가 CoiStatement 를 파싱하지 않는다', !/CoiStatement/.test(toolSource.replace(/\/\*[\s\S]*?\*\//g, '')));
    check('도구 출력에 coi 필드가 없다', !/\bcoi\b\s*:/.test(toolSource));
    check('렌더러에 coi 분기가 없다', !/paper\.coi/.test(rendererSource));
}

console.log('\n§4 렌더러 — 배지 3종 × 4개 언어');
{
    const src = read('../components/PaperRenderer.tsx');
    // 주석은 뺀다 — "왜 이 용어를 쓰지 않는지" 설명하느라 그 단어가 주석에 등장한다
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const level of ['meta-analysis', 'rct', 'review']) {
        const block = src.match(new RegExp(`'?${level}'?:\\s*\\{[\\s\\S]*?label:\\s*\\{([^}]*)\\}`))?.[1] ?? '';
        const langs = ['ko', 'en', 'es', 'fr'].filter(l => new RegExp(`\\b${l}:`).test(block));
        check(`${level} 라벨 4개 언어`, langs.length === 4, langs.join(',') || '없음');
    }
    // 문구 계약 — 학술 용어로 되돌아가면 실패한다
    check('한국어 배지가 일상어다 (종합분석·임상시험·논문 리뷰)',
        src.includes("ko: '종합분석'") && src.includes("ko: '임상시험'") && src.includes("ko: '논문 리뷰'"));
    check('학술 용어를 쓰지 않는다 (종설·무작위 대조시험)',
        !/종설|무작위 대조시험/.test(code));
    // 미분류는 아무것도 그리지 않는다
    check('evidence 없으면 배지를 그리지 않는다', /paper\.evidence \? EVIDENCE_STYLE\[paper\.evidence\] : null/.test(src));
    check('좌측 색 스트라이프를 쓰지 않는다', !/absolute\s+(bottom-0\s+)?left-0/.test(src));
    // 라우터가 비의생명 주제를 흘려보내도 사용자는 출처 범위를 항상 본다 (§5 라우터 지시와 짝)
    check('4개 언어 모두 PubMed 범위를 밝힌다',
        ['의생명 분야 문헌', 'biomedical literature only', 'solo literatura biomédica', 'littérature biomédicale uniquement']
            .every(phrase => src.includes(phrase)));

    // ── arXiv 출처 ── 같은 카드를 쓰되 배지의 의미가 다르다.
    // 🔴 PubMed 의 근거 등급을 arXiv 에 재사용하면 안 된다 — arXiv 에는 그런 큐레이션이 없다.
    check('arXiv 에는 근거 등급 배지를 쓰지 않는다',
        /source === 'pubmed' && paper\.evidence \? EVIDENCE_STYLE/.test(src));
    check('arXiv 배지는 심사 여부만 말한다 (게재됨/프리프린트)',
        src.includes("peerReviewed: '게재됨'") && src.includes("preprint: '프리프린트'"));
    check('프리프린트를 색 위계로 낮추지 않는다 — 중립 회색',
        /preprint: 'bg-slate-100 text-slate-500/.test(src));
    check('4개 언어 모두 프리프린트임을 밝힌다',
        ['동료심사를 거치지 않은', 'not peer reviewed', 'revisión por pares', 'relus par les pairs']
            .every(phrase => src.includes(phrase)));
    check('출처 없는 옛 카드는 PubMed 로 읽는다 (하위호환)',
        /data\?\.source === 'arxiv' \? 'arxiv' : 'pubmed'/.test(src));
    check('식별자 표기가 출처를 따른다 (arXiv:xxxx / PMID xxxx)',
        /arXiv:\$\{paper\.arxivId\}/.test(src) && /PMID \$\{paper\.pmid\}/.test(src));
}

console.log('\n§4g 철회·요약 출처 — 카드가 사실이 아닌 걸 사실처럼 그리지 않는가');
{
    const src = read('../components/PaperRenderer.tsx');
    const tool = read('../server/agent/paper-tool.ts');
    const prompt = read('../server/agent/prompt.ts');

    // 철회는 추가 호출 없이 pubtype 에서 나온다
    check('도구가 pubtype 으로 철회를 판정한다', /isRetracted\(r\.pubtype \?\? \[\]\)/.test(tool));
    check('렌더러가 철회 배지를 그린다', /paper\.retracted && \([\s\S]{0,400}\{tt\.retracted\}/.test(src));
    check('철회 배지가 빨강이다 (등급 배지 색과 섞이지 않는다)',
        /bg-red-100 px-1\.5 py-0\.5 text-\[11px\] font-bold text-red-700/.test(src));
    check('철회 배지가 등급 배지보다 먼저 온다',
        src.indexOf('tt.retracted') < src.indexOf('evidence.label[lang]'));
    check('4개 언어 모두 철회 문구가 있다',
        ["retracted: '철회됨'", "retracted: 'Retracted'", "retracted: 'Retractado'", "retracted: 'Rétracté'"]
            .every(phrase => src.includes(phrase)));
    check('제외 칸에 근거로 삼지 말라는 경고가 뜬다', /tt\.excludedNote/.test(src));
    check('제외 칸이 몇 건인지 밝힌다', /tt\.excludedTitle\}[\s\S]{0,40}retracted\.length/.test(src));
    check('4개 언어 모두 제외 안내가 있다',
        ['근거 목록에서 빼두었습니다', 'kept out of the evidence list',
         'fuera de la lista de evidencia', 'écartés de la liste de preuves']
            .every(phrase => src.includes(phrase)));
    // 🔴 프롬프트만으로는 라이브 3회 중 2회가 철회 논문을 근거로 인용했다.
    //   그래서 도구가 배열에서 빼낸다 — 인용 마커 [n] 이 papers 순번이므로 가리킬 수가 없다.
    // 🔴 소스 grep 이 아니라 **행동**으로 본다. 예전엔 `papers: papers.filter(…).slice(0, limit)`
    //   라는 표현식을 정규식으로 봤는데, 관련도 필터를 넣느라 같은 계약을 유지한 채 표현식만
    //   바꿨더니 빨간불이 났다. 계약은 "철회·초록없음이 papers 에 없다" 이지 그 한 줄이 아니다.
    const fixture = [
        { pmid: '1', retracted: false, summaryKind: 'conclusion' as const },
        { pmid: '2', retracted: true, summaryKind: 'conclusion' as const },   // 철회
        { pmid: '3', retracted: false, summaryKind: 'none' as const },        // 초록 없음
        { pmid: '4', retracted: true, summaryKind: 'none' as const },         // 둘 다
    ];
    const part = partitionPapers(fixture);
    check('도구가 철회 논문을 papers 에서 빼낸다',
        part.citable.every(p => !p.retracted) && part.retracted.map(p => p.pmid).join(',') === '2,4');
    // 빠진 만큼 얇아지지 않게 넉넉히 받아온다 (프로바이오틱스 질의는 5건 중 2건이 초록 없음)
    check('빠질 것을 예상해 더 받아온다', /Math\.min\(limit \+ 3, MAX_RESULTS\)/.test(tool));
    check('빼낸 논문을 버리지 않고 retracted 로 내려보낸다',
        /retracted: papers\.filter\(p => p\.retracted\)/.test(tool));
    check('빈 결과·오류 카드에도 분리 칸 필드가 있다 (렌더러가 undefined 를 만나지 않는다)',
        (tool.match(/papers: \[\], retracted: \[\], noAbstract: \[\]/g) ?? []).length >= 2);
    check('렌더러가 제외된 논문을 별도 칸으로 그린다', /retracted\.length > 0 && \(/.test(src));
    check('분리 칸만 남아도 "못 찾음" 으로 처리하지 않는다',
        /!papers\.length && !retracted\.length && !noAbstract\.length/.test(src));
    check('프롬프트가 철회 논문 인용을 금지한다',
        /\[RETRACTED PAPERS\]/.test(prompt)
        && /Never describe a finding from the \\`retracted\\` list/.test(prompt));
    check('철회 규칙이 PROSE RULES 목록보다 앞에 온다',
        prompt.indexOf('[RETRACTED PAPERS]') < prompt.indexOf('[PROSE RULES — CRITICAL]'));

    // 🔴 조회 실패를 0건으로 말하지 않는다 (심평원에서 이미 고쳤던 병)
    check('렌더러가 error 를 실제로 읽는다', /const failed = Boolean\(data\?\.error\)/.test(src));
    check('두 도구 모두 실패를 카드에 실어 보낸다',
        /error: message/.test(tool) && /error: message/.test(read('../server/agent/arxiv-tool.ts')));
    check('프롬프트가 장애를 "논문 없음" 으로 답하지 말라고 한다 (양쪽 의도)',
        (prompt.match(/the LOOKUP FAILED — that is NOT/g) ?? []).length === 2);
    // 0건 카드는 실제로 나간다 — 예전 주석은 안 나간다고 적혀 있었다(코드와 불일치)
    check('0건에도 카드를 만든다는 사실이 주석과 맞는다',
        /0건이어도 카드는 만든다/.test(tool) && !/0건이면 빈 카드를 띄우지 않는다/.test(tool));

    // 요약 출처 — '결론'과 '위치로 집은 발췌'는 다른 물건이다
    check('발췌에는 라벨을 붙인다', /paper\.summaryKind === 'excerpt' &&[\s\S]{0,300}tt\.excerpt/.test(src));
    check('결론에는 라벨을 붙이지 않는다', !/summaryKind === 'conclusion'/.test(src));
    check('4개 언어 모두 발췌 문구가 있다',
        ["excerpt: '초록 발췌'", "excerpt: 'Abstract excerpt'", "excerpt: 'Extracto del resumen'", "excerpt: 'Extrait du résumé'"]
            .every(phrase => src.includes(phrase)));
    // 8%: 초록 자체가 PubMed 에 없다. 빈칸으로 두면 "요약할 게 없는 논문"처럼 읽힌다.
    check('초록이 없으면 그렇다고 말한다', /tt\.noAbstract/.test(src));
    check('초록 없음 안내는 PubMed 카드에서만 뜬다', /: source === 'pubmed' \? \(/.test(src));
    // 🔴 목록 속 한 줄로는 모델이 흘려 읽는다(철회에서 실측) — 전용 블록이어야 한다
    check('프롬프트에 summaryKind 전용 블록이 있다',
        /\[WHAT \\`summary\\` IS — READ \\`summaryKind\\` BEFORE QUOTING IT\]/.test(prompt));
    check('블록이 PROSE RULES 목록보다 앞에 온다',
        prompt.indexOf('READ \\`summaryKind\\` BEFORE QUOTING') < prompt.indexOf('[PROSE RULES — CRITICAL]'));
    check('프롬프트가 발췌를 결론이라 쓰지 말라고 한다',
        /"excerpt"[\s\S]{0,200}never "concluded"/.test(prompt));
    // 🔴 전용 블록으로도 3회 중 3회 실패했다 — 도구가 목록에서 빼야 끊긴다
    check('도구가 초록 없는 논문을 papers 에서 빼낸다',
        part.citable.every(p => p.summaryKind !== 'none') && part.noAbstract.map(p => p.pmid).join(',') === '3');
    // 철회이면서 초록도 없는 논문이 두 칸에 겹쳐 들어가면 안 된다 — 철회가 우선이다
    check('철회+초록없음은 철회 칸에만 들어간다',
        part.noAbstract.length === 1 && part.citable.map(p => p.pmid).join(',') === '1');
    check('빼낸 논문을 버리지 않고 noAbstract 로 내려보낸다',
        /noAbstract: papers\.filter\(p => !p\.retracted && p\.summaryKind === 'none'\)/.test(tool));
    check('철회 칸과 초록없음 칸을 합치지 않는다 (뜻이 다르다)',
        /noAbstract\.length > 0 && \(/.test(src) && /retracted\.length > 0 && \(/.test(src));
    check('초록없음 칸은 빨강을 쓰지 않는다 (철회의 색이 묻으면 안 된다)',
        /noAbstract\.length > 0 && \([\s\S]{0,400}border-slate-200\/80 bg-slate-50/.test(src));
    check('프롬프트가 초록 없는 논문이 papers 에 없다고 밝힌다',
        /Papers with no abstract at all are NOT in \\`papers\\`/.test(prompt)
        && /Never state what they found or concluded/.test(prompt));
    check('4개 언어 모두 초록없음 칸 안내가 있다',
        ['초록이 등록돼 있지 않아', 'PubMed holds no abstract for these',
         'PubMed no tiene resumen de estos', 'PubMed ne contient aucun résumé']
            .every(phrase => src.includes(phrase)));
}

console.log('\n§4d arXiv Atom 파싱 — 프리프린트/게재 판별');
{
    const feed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
<opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">604189</opensearch:totalResults>
<entry><id>http://arxiv.org/abs/2410.01458v2</id><published>2024-10-02T11:00:00Z</published>
<title>Reward Shaping &amp; Q-Shaping</title><summary>First sentence here. Second one too. Third is dropped.</summary>
<author><name>Xiefeng Wu</name></author><author><name>Jane Roe</name></author>
<arxiv:primary_category term="cs.AI"/></entry>
<entry><id>http://arxiv.org/abs/2602.12375v1</id><published>2026-02-14T00:00:00Z</published>
<title>Value Bonuses</title><summary>Only one sentence.</summary><author><name>A Wahab</name></author>
<arxiv:journal_ref>Reinforcement Learning Journal, vol. 6, 2025</arxiv:journal_ref>
<arxiv:primary_category term="cs.LG"/></entry></feed>`;
    const { total, papers } = parseArxivFeed(feed);
    check('totalResults 를 읽는다', total === 604189, String(total));
    check('2건을 뽑는다', papers.length === 2, String(papers.length));
    // 버전 접미사(v2)를 떼야 링크가 최신판으로 간다
    check('arXiv ID 에서 버전 접미사를 뗀다', papers[0].arxivId === '2410.01458', papers[0].arxivId);
    check('URL 을 만든다', papers[0].url === 'https://arxiv.org/abs/2410.01458');
    check('XML 엔티티를 되돌린다', papers[0].title === 'Reward Shaping & Q-Shaping', papers[0].title);
    check('저자를 순서대로 모은다', papers[0].authors.join('|') === 'Xiefeng Wu|Jane Roe');
    check('1차 분류를 읽는다', papers[0].category === 'cs.AI');
    check('연도는 published 에서 뽑는다', papers[0].year === '2024');
    // 초록은 앞 2문장 — PubMed 는 결론(뒤)이지만 arXiv 초록은 앞이 주제문이다
    check('초록 앞 2문장만 쓴다', papers[0].summary === 'First sentence here. Second one too.', papers[0].summary);
    // 🔴 핵심 계약 — 심사 여부를 추측하지 않는다. journal_ref/doi 가 있을 때만 게재됨이다.
    check('journal_ref 도 doi 도 없으면 프리프린트', papers[0].published === false);
    check('journal_ref 가 있으면 게재됨', papers[1].published === true);
    check('한 문장짜리 초록도 살린다', papers[1].summary === 'Only one sentence.');
    check('엔티티 헬퍼', unescapeXml('a &lt;b&gt; &amp;c&quot;') === 'a <b> &c"');

    const arxivToolSrc = read('../server/agent/arxiv-tool.ts');
    check('카드에 source=arxiv 를 실어보낸다', /source: 'arxiv'/.test(arxivToolSrc));
    check('PubMed 카드도 출처를 명시한다', /source: 'pubmed'/.test(read('../server/agent/paper-tool.ts')));
    check('arXiv 권고 간격(3초)을 지킨다', /MIN_GAP_MS = 3_000/.test(arxivToolSrc));

}

console.log('\n§4d2 arXiv 검색어 조립 — all:<질의> 는 단어를 OR 로 묶는다');
{
    // 🔴 실측(2026-08-31) — `all:transformer attention optimization` 은 576,986건을 반환하고
    // 상위 5건 중 2건이 "optimization" 하나만 걸린 무관 논문이었다(다항식 최적화·프레임 구조 설계).
    // AND 로 묶으면 2,776건에 상위 5건 전부 관련. bridge seismic design 은 더 극적이다 —
    // OR 상위 3건에 교량 논문이 아예 없고(334,543건), AND 는 10건 전부 교량이다.
    check('여러 단어는 AND 로 묶는다',
        buildArxivSearchQuery('transformer attention optimization')
            === 'all:transformer AND all:attention AND all:optimization',
        buildArxivSearchQuery('transformer attention optimization'));
    check('한 단어는 그대로', buildArxivSearchQuery('transformer') === 'all:transformer');
    check('앞뒤 공백을 턴다', buildArxivSearchQuery('  bridge seismic  ') === 'all:bridge AND all:seismic');
    // 기능어까지 AND 로 묶으면 결과가 0으로 죽는다 — arXiv 는 불용어를 색인하지 않는다
    check('기능어는 뺀다', buildArxivSearchQuery('attention is all you need for the task')
        === 'all:attention AND all:need AND all:task',
        buildArxivSearchQuery('attention is all you need for the task'));
    check('기능어를 빼고 한 단어만 남으면 단일어로', buildArxivSearchQuery('the of a lattice') === 'all:lattice');
    // 이미 문법이 들어 있으면 손대지 않는다 — 두 번 감싸면 all:all: 이 된다
    check('필드 접두사는 통과', buildArxivSearchQuery('cat:cs.CV AND ti:attention') === 'cat:cs.CV AND ti:attention');
    check('불리언 연산자는 통과', buildArxivSearchQuery('quantum OR photonic') === 'quantum OR photonic');

    // 🔴 2026-09-03. 여기서 **범용어(`neural network` 등)를 AND 에서 빼는 수정을 넣었다가 되돌렸다.**
    //   `transformer neural network` 는 1/5 → 5/5 로 나아졌지만, 같은 규칙이
    //   `graph neural network` 를 5/5 → **0/5**(그래프 이론), `convolutional neural network` 를
    //   5/5 → **1/5**(부호이론)로 무너뜨렸다. `neural network` 가 복합 개념의 일부일 때는
    //   빼면 주제가 통째로 바뀐다. 하나 고치고 둘 깨는 교환이었다.
    //   → 조립은 그대로 두고, **모델이 질의에 범용어를 덧붙이지 않게** 도구 설명에서 막는다.
    //   측정: `npx tsx tests/manual/live-arxiv-query.mts`
    check('범용어를 빼지 않는다 — 복합 개념이 깨진다 (graph/convolutional neural network)',
        buildArxivSearchQuery('graph neural network') === 'all:graph AND all:neural AND all:network',
        buildArxivSearchQuery('graph neural network'));
    check('사용자가 말한 주제어만 오면 단일어 그대로',
        buildArxivSearchQuery('transformer') === 'all:transformer');
    // 조립으로 막을 수 없으니 도구 설명이 막는다 — 그 지시가 남아 있는지 본다(배선 검사).
    check('도구 설명이 범용어 덧붙이기를 금지한다',
        /말하지 않은 범용어/.test(read('../server/agent/arxiv-tool.ts')));
    check('도구 설명이 복합 개념 예외를 함께 준다',
        /graph neural network[\s\S]{0,120}하나의 개념이면 통째로/.test(read('../server/agent/arxiv-tool.ts')));
    check('따옴표 구문은 all: 만 씌운다', buildArxivSearchQuery('"neural painting"') === 'all:"neural painting"');

    // 🔴 2026-09-03 실측: `Attention Is All You Need` 는 `is`·`all`·`you` 가 불용어라
    //   `all:Attention AND all:Need`(7,982건) 로 줄고 **원 논문 1706.03762 가 상위 5건에 못 든다.**
    //   구절(`all:"…"`)로 치면 45건에 원 논문 2위다. 가르는 신호는 **버려지는 불용어의 존재** —
    //   평범한 검색어에는 불용어가 없고 제목·구절에는 있다.
    //   ⚠️ 한 번에 합치는 `all:"…" OR (AND)` 는 실측상 원 논문을 여전히 못 올린다(관련도 정렬이
    //     구절 일치를 우대하지 않는다). 그래서 순차 폴백이다.
    // 🔴 `ti:` 가 `all:"…"` 보다 먼저다. 실측: `all:"…"` 는 원 논문이 **2위**(1위는 2026년
    //   `Tool Attention Is All You Need`)라, 모델이 `limit:1` 로 부르면 카드에 엉뚱한 논문만
    //   남고 산문이 그걸 답으로 설명한다. `ti:` 는 1위다.
    //   ⚖️ 가운데에 `all:"…"` 를 끼운 3단 계획은 뺐다 — 구절 6종에서 `ti:` 가 0이면 `all:"…"` 도
    //     예외 없이 0이라 단독으로 건진 경우가 없는데 최악 지연만 두 배가 된다.
    check('불용어가 섞인 제목은 제목 필드를 먼저 친다',
        JSON.stringify(buildArxivQueryPlan('Attention Is All You Need'))
        === JSON.stringify(['ti:"Attention Is All You Need"', 'all:Attention AND all:Need']),
        JSON.stringify(buildArxivQueryPlan('Attention Is All You Need')));
    for (const q of ['graph neural network', 'probiotics depression', 'bridge seismic design', 'transformer']) {
        check(`불용어 없는 평범한 검색어는 추가 호출이 없다 — ${q}`,
            buildArxivQueryPlan(q).length === 1, JSON.stringify(buildArxivQueryPlan(q)));
    }
    check('두 단어짜리는 구절로 보지 않는다 — `based on` 같은 조각이 걸린다',
        buildArxivQueryPlan('based on').length === 1, JSON.stringify(buildArxivQueryPlan('based on')));
    check('이미 arXiv 문법이면 구절을 씌우지 않는다',
        buildArxivQueryPlan('cat:cs.CV AND ti:attention').length === 1);
    // 배선 — 계획을 실제로 순회하는가(판정만 맞고 아무 일도 안 일어나는 실수를 막는다)
    check('배선: arxivTool 이 buildArxivQueryPlan 을 순회한다',
        /buildArxivQueryPlan\(/.test(read('../server/agent/arxiv-tool.ts'))
        && /for \(const searchQuery of plan\)/.test(read('../server/agent/arxiv-tool.ts')));
    check('따옴표 0건 주석이 정정돼 있다 — "구절은 못 쓴다"는 과일반화였다',
        /과일반화/.test(read('../server/agent/arxiv-tool.ts')));

    // 🔴 2026-09-03. 같은 지시를 LangChain 스키마에만 넣었더니 **OpenAI 경로가 안 고쳐졌다** —
    //   `local-tool-registry.ts` 가 `query` 설명의 자기 사본을 갖고 있었고, gpt-5.6-luna 가
    //   `Attention Is All You Need Transformer architecture self-attention` 으로 조회해
    //   원 논문 없는 카드를 냈다. 문안을 상수 하나로 합쳤으니 **두 벌로 갈라지는 걸** 막는다.
    check('arXiv query 설명이 상수 하나다 — 레지스트리가 사본을 갖지 않는다',
        /description: ARXIV_QUERY_DESCRIPTION/.test(read('../server/agent/local-tool-registry.ts'))
        && !/description: 'arXiv 검색어/.test(read('../server/agent/local-tool-registry.ts')));
    check('두 공급자 경로가 같은 상수를 import 한다',
        /ARXIV_QUERY_DESCRIPTION/.test(read('../server/agent/local-tool-registry.ts'))
        && /export const ARXIV_QUERY_DESCRIPTION/.test(read('../server/agent/arxiv-tool.ts')));
    check('설명이 제목 질의를 따로 못박는다 — 제목에 범용어를 붙이면 원 논문이 사라진다',
        /논문 제목을 물으면/.test(read('../server/agent/arxiv-tool.ts')));
    // 관측점 — 카드가 비는 원인은 대부분 도구가 아니라 모델이 만든 검색어다(§12).
    check('OpenAI 경로가 도구 **인자**를 로그에 남긴다',
        /local tool "\$\{options\.functionTool\.name\}" ← /.test(read('../server/openai/chat.ts')));

    // 🔴 0건을 OR 로 넓히지 않는다 — 실측 `sourdough fermentation microbiome kinetics` 는
    // AND 0건이 정답이고(arXiv 에 없는 분야), 넓히면 "kinetics" 하나만 걸린 논문이 근거가 된다.
    // 무의미어 `zzqqxx nonexistent topic` 은 더 심해서 35,416건의 토픽모델링 논문을 물어 온다.
    const arxivToolSrc = read('../server/agent/arxiv-tool.ts');
    // 🔴 이 검사는 원래 `await fetchArxiv(` 가 소스에 **한 번만** 나오는지 세고 있었다.
    //   그런데 09-03 에 구절 폴백이 들어가면서 호출은 루프 안의 한 줄이 그대로라 **숫자는 안 변한다** —
    //   즉 계약이 바뀌었는데 검사는 초록을 유지했다. 세는 대상이 계약이 아니었던 것이다.
    //   실제 계약은 "**OR 로 넓히지 않는다**" 이므로 그걸 직접 본다.
    check('0건을 OR 로 넓히지 않는다 — 계획 어디에도 OR 폴백이 없다',
        buildArxivQueryPlan('sourdough fermentation microbiome kinetics')
            .every(q => !/\bOR\b/.test(q)));
    check('계획의 마지막은 항상 AND 조립 — 여기까지 0건이면 0건이 답이다',
        buildArxivQueryPlan('Attention Is All You Need').at(-1) === buildArxivSearchQuery('Attention Is All You Need'));
    check('빈손 실패를 코드가 명시한다', /넓히지 않는다/.test(arxivToolSrc));
    check('검색어 조립을 fetch 가 아니라 순수 함수가 한다 — search_query 에 직접 박지 않는다',
        !/search_query: `all:\$\{query\}`/.test(arxivToolSrc));
}

console.log('\n§4b 규칙 폴백 — 라우터 LLM 이 429 로 죽어도 논문 질의를 잡는가');
{
    // 실측: 쿼터 소진으로 라우터 LLM 이 실패하면 폴백만 남는데, 규칙이 없으면 논문 질의가
    // 통째로 general 로 떨어져 카드가 조용히 사라졌다.
    for (const [q, want] of [
        ['프로바이오틱스 감기 예방 논문 찾아줘', 'paper_search'],
        ['아스피린 심혈관 임상시험 결과', 'paper_search'],
        ['기후변화가 건강에 미치는 영향 연구 결과', 'paper_search'],
        // 작문 요청은 잡으면 안 된다 — `논문` 단독을 받으면 여기서 걸린다
        ['논문 써줘', 'general'],
        ['연구 계획서 작성해줘', 'general'],
        ['논문 형식으로 정리해줘', 'general'],
    ] as const) {
        const got = classifyIntentByRules(q, false);
        check(`"${q}" → ${want}`, got === want, got);
    }
}

console.log('\n§4c 비의생명 강등 — PubMed 밖 주제는 카드를 만들지 않는다');
{
    // 무오염 실측(TIER1): 라우터 LLM 은 분야를 안 가리고 논문 요청을 전부 paper_search 로
    // 보냈다(CS·공학 9/9 누수). PubMed 는 빈손 대신 의생명 응용을 돌려주므로 조용히 틀린다.
    for (const [q, want] of [
        ['머신러닝 트랜스포머 논문 찾아줘', true],
        ['반도체 공정 관련 논문 찾아줘', true],
        ['블록체인 알고리즘 논문', true],
        // 보건과 겹치는 말은 막으면 안 된다
        ['프로바이오틱스 감기 예방 논문', false],
        ['기후변화가 건강에 미치는 영향 연구', false],
        ['미세먼지 노출 관련 연구', false],
        ['AI 의료영상 진단 논문', false],
    ] as const) {
        check(`"${q}" 강등=${want}`, isNonBiomedicalPaperTopic(q) === want, String(isNonBiomedicalPaperTopic(q)));
    }
    const routerSrc = read('../server/agent/nodes/router.ts');
    check('라우터가 키워드 강등 가드를 호출한다', /isNonBiomedicalPaperTopic\(textContent\)/.test(routerSrc));
    // 주 방어선. 블록리스트는 분야 공간이 무한해 못 막는다 — 라우터 JSON 에 불리언을 하나 더
    // 받아 결정적으로 강등한다(추가 LLM 호출 없음). 무오염 실측 21분야 × 3회 = 63/63 정확.
    check('라우터가 paper_source 를 요구한다', /"paper_source"/.test(routerSrc));
    // 🔴 3분기다. "의생명이 아니면 arXiv" 가 아니다 — arXiv 도 어떤 질의에든 그럴듯한 결과를
    // 돌려주므로(한국어 통사론 → astro-ph 전파망원경) 문학·역사·법학은 카드 없이 가야 한다.
    check('pubmed 는 PubMed 도구로 간다', /source === "arxiv"/.test(routerSrc));
    check('arxiv 는 arxiv_search 로 파생된다', /intent = "arxiv_search"/.test(routerSrc));
    check('둘 다 아니면 general 로 강등한다',
        /source !== "pubmed"/.test(routerSrc) && /intent = "general"/.test(routerSrc));
    check('세 번째 갈래(none)가 규칙으로 정의돼 있다 — 텍스트·작품·사건·제도',
        /HUMAN RECORD/.test(routerSrc) && /"none"/.test(routerSrc));
    check('arXiv 갈래도 규칙이다 — 형식·물리·계산 체계',
        /FORMAL, PHYSICAL, or COMPUTATIONAL SYSTEM/.test(routerSrc));
    // 이 가드는 CS·공학 어휘를 잡는다. arXiv 에서는 그게 정답이므로 적용하면 안 된다.
    check('키워드 가드는 arxiv_search 에 적용되지 않는다',
        /if \(intent === "paper_search" && isNonBiomedicalPaperTopic/.test(routerSrc));
    // 판정은 2단계다 — 주제를 학문 분야로 명명(topic_field)한 뒤 그 분야에 규칙을 적용한다.
    // 분야를 열거하던 이전 방식은 적어둔 분야만 맞고 나머지는 그대로 샌다(블록리스트와 같은 실패).
    check('라우터가 topic_field 로 분야를 먼저 명명시킨다', /"topic_field"/.test(routerSrc));
    check('판정이 규칙이다 — "살아있는 몸을 연구하는가"',
        /LIVING BODY/.test(routerSrc) && /organism, its structure, its function, its illness, or its care/.test(routerSrc));
    check('같은 단어의 양쪽 경계를 대상으로 가른다(음악치료/음악학)',
        /music therapy/.test(routerSrc) && /musicology/.test(routerSrc));
    // 세 갈래 모두 규칙이라 판정 불가일 때 기울 곳이 필요하다 — 카드 없음이 가장 덜 해롭다.
    check('판정 불가는 none 으로 기운다 — 틀린 카드가 카드 없음보다 해롭다',
        /cannot name what the field studies, answer "none"/.test(routerSrc)
        && /A wrong card is worse than no card/.test(routerSrc));
}

console.log('\n§4e 카드 전송 — 만들어지는 것과 도달하는 것은 다르다');
{
    // 🔴 실제로 겪은 버그. Gemini 는 산문을 토큰 단위로 흘려 전송 버퍼를 먼저 채우고, 카드는
    //   그 뒤 최종 메시지에 붙는다. route.ts 가 "스트리밍이 없을 때만 최종 메시지를 보낸다" 라
    //   **카드만 화면에 도달하지 않았다.** OpenAI 는 이 경로로 스트리밍하지 않아 멀쩡했고,
    //   그래서 모델 품질 차이로 오인하기 쉬웠다.
    // 결과가 있는 카드로 잡는다 — 이 절은 **전송 메커니즘**을 보는 자리다.
    // 빈 카드는 이제 화면에 붙지 않으므로(§6.31) 아래에서 따로 검사한다.
    const card = '```json:paper\n{"query":"x","papers":[{"pmid":"1","title":"t"}]}\n```';
    const msg = `프로바이오틱스는 ... 입니다.[1]\n\n${card}`;

    check('산문이 이미 전송됐어도 카드를 이어 보낸다',
        pendingCardBlocks(msg, '프로바이오틱스는 ... 입니다.[1]', 'paper_search').length === 1);
    check('이미 보낸 카드는 다시 보내지 않는다 (중복 방지)',
        pendingCardBlocks(msg, msg, 'paper_search').length === 0);
    check('arxiv_search 도 같은 경로다', pendingCardBlocks(msg, '산문', 'arxiv_search').length === 1);
    check('논문 의도가 아니면 관여하지 않는다', pendingCardBlocks(msg, '산문', 'general').length === 0);
    check('카드가 없으면 보낼 것도 없다', pendingCardBlocks('산문뿐', '', 'paper_search').length === 0);

    // 인용 번호는 도구가 준 논문 순번이다 — Gemini 경로가 가짜 인용으로 보고 지우던 회귀.
    // 🔴 아래 배선은 이제 **소스 정규식이 아니라 동작으로** 지킨다 — `test-stream-dispatch.mts`
    //   가 진짜 `createStreamDispatch` 에 가짜 이벤트를 먹여 나온 프레임을 본다.
    //   (이 자리에 있던 정규식 검사들은 내가 이미 아는 회귀만 잡았다. 실제 사고 —
    //    이름 없는 on_tool_end 가 카드 6종을 삼킨 건 — 은 소스가 아니라 순서의 문제였다.)
    const dispatchSrc = read('../server/agent/stream-dispatch.ts');
    check('논문 건수를 도구 종료 이벤트에서 잡는다', /pinnedPaperCount/.test(dispatchSrc) && /on_tool_end/.test(dispatchSrc));
    check('논문 턴 스트림에 범위 규칙을 적용한다',
        /PINNED_CARD_INTENT_SET\.has\(st\.detectedIntent\)[\s\S]{0,120}dropMarkersOutsideRange/.test(dispatchSrc));
    // 🔴 마커를 통째로 지우던 옛 규칙으로 돌아가면 산문과 카드를 잇는 끈이 끊긴다
    check('논문 턴에서 마커를 통째로 지우지 않는다',
        !/PINNED_CARD_INTENT_SET\.has\(st\.detectedIntent\) \? stripFabricated/.test(dispatchSrc));
    // 루프가 route.ts 로 되돌아가면 하니스가 다시 눈이 먼다
    check('이벤트 루프가 route.ts 로 되돌아오지 않았다',
        !/else if \(event\.event === 'on_tool_end'/.test(read('../app/api/chat/route.ts')));
    // 🔴 실측(2026-09-02): 빈 카드가 산문과 **같은 말을 두 번** 하게 만들었다
    //   ("관련 법령을 찾을 수 없습니다" 가 산문에도 카드에도). 화면에는 안 붙인다 —
    //   모델 컨텍스트에는 그대로 가서 "조회했으나 없었다" 를 알려준다.
    check('빈 논문 카드는 화면에 붙이지 않는다',
        pendingCardBlocks('산문\n\n```json:paper\n{"query":"x","papers":[]}\n```', '', 'paper_search').length === 0);
    check('초록없음 칸만 있어도 붙인다 — 보여줄 값이 있다',
        pendingCardBlocks('산문\n\n```json:paper\n{"papers":[],"noAbstract":[{"pmid":"9"}]}\n```', '', 'paper_search').length === 1);
}

console.log('\n§4f 산문 모양 — 문장 수가 아니라 문단 구조를 준다');
{
    // 문장 수만 주면("3-5 sentences") 모델은 한 덩어리로 쓴다. ChatMessage 의 `p` 렌더러는
    // 이미 mb-4 를 주고 있으므로, 빈 줄만 들어오면 간격은 저절로 벌어진다 — CSS 가 아니라
    // 프롬프트가 모양을 주지 않은 게 원인이었다.
    const prompt = read('../server/agent/prompt.ts');
    for (const intent of ['RESEARCH PAPERS', 'ARXIV PAPERS']) {
        const hint = prompt.slice(prompt.indexOf(`[INTENT FOCUS: ${intent}]`));
        const body = hint.slice(0, hint.indexOf('`,'));
        check(`${intent}: 3문단을 요구한다`, /THREE paragraphs separated by a BLANK LINE/.test(body));
        // 홋개행은 ReactMarkdown 이 문단으로 끊지 않는다 — 이 구분을 명시해야 한다
        check(`${intent}: 빈 줄이 구분자임을 밝힌다`, /a single newline is not/.test(body));
        // 첫 문단은 단독으로 답이 돼야 한다 — 거기서 멈추는 독자가 다수다
        check(`${intent}: 첫 문단은 결론 한 문장이다`, /The verdict, in ONE sentence/.test(body));
        // 산문을 불릿으로 바꾸면 카드와 내용이 겹쳐 두 번 읽히게 된다
        check(`${intent}: 헤딩·불릿은 금지된다`, /Do NOT add headings, bullets/.test(body));
        // 분량 상한은 유지된다 — 문단을 나누라고 길게 쓰라고 한 게 아니다
        check(`${intent}: 3-5문장 상한이 남아 있다`, /3-5 sentences total/.test(body));
        // 인용 번호는 각주 번호가 아니라 **카드 순번**이다. 어떤 모델은 자기가 언급한
        // 순서로 다시 매겼다(4번 논문을 먼저 쓰면 [1]) — 문장은 참이라 개수만 세는 검사는
        // 통과하지만, 카드에서 1번을 열어보는 사용자는 전혀 다른 연구를 만난다.
        check(`${intent}: 인용 번호가 카드 순번임을 밝힌다`, /THE NUMBER IS A POSITION, NOT A FOOTNOTE/.test(body));
        check(`${intent}: 번호 다시 매기기를 금지한다`, /Do NOT renumber/.test(body));
        // 건너뛰기가 정상이라고 말해줘야 1부터 순서대로 채우려는 압박이 없어진다
        check(`${intent}: 번호 건너뛰기가 정상이라고 밝힌다`, /Skipping numbers is correct and expected/.test(body));
        // 관련도 1위가 질문과 무관한 경우가 실제로 있다(비타민C 종설이 1위로 왔던 사례)
        check(`${intent}: 1번을 습관적으로 인용하지 말라고 한다`, /leave it uncited rather than citing \[1\] out of habit/.test(body));
    }

    // 화면쪽 계약 — 빈 줄을 받아도 간격이 없으면 프롬프트 수정은 무의미하다
    check('문단 렌더러가 간격을 준다', /p: \(\{ \.\.\.props \}\) => <p className="mb-4/.test(read('../components/ChatMessage.tsx')));
}

console.log('\n§4h 멀티턴 후속 — 화면 카드를 두고 물으면 다시 검색하지 않는다');
{
    // 🔴 실측(gemini·luna 양쪽): 이 판정이 없어서 "세 번째 논문 설명해줘" 가 PubMed 를 다시
    //   검색해 **다른 목록의 새 카드**를 띄웠다. 순서가 밀리면 [3] 이 딴 논문을 가리킨다.
    for (const [text, want] of [
        // 카드 대화 — 재조회하면 안 된다
        ['세 번째 논문 좀 더 설명해줘', 'discuss'],
        ['두 번째 논문은 어떤 연구야?', 'discuss'],
        ['2번 논문 저자가 누구야?', 'discuss'],
        ['[3] 논문 자세히', 'discuss'],
        ['마지막 논문 요약해줘', 'discuss'],
        ['그 논문 결론이 뭐야?', 'discuss'],
        ['위의 논문들 비교해줘', 'discuss'],
        ['지금까지 나온 논문들 표로 정리해줘', 'discuss'],
        ['쉽게 풀어서 설명해줘', 'discuss'],
        ['방금 그 연구 다시 정리해줘', 'discuss'],
        // 새 조회 — 막으면 안 된다
        ['그럼 비타민D 논문은?', 'new'],
        ['아스피린 심혈관 예방 연구 있어?', 'new'],
        ['다른 논문도 찾아줘', 'new'],
        ['더 최신 논문으로 보여줘', 'new'],
        ['추가로 검색해줘', 'new'],
        // 🔴 숫자가 지목이 아니라 **주제어**인 경우 — 조회 동사가 가른다
        ['3번 염색체 관련 논문 찾아줘', 'new'],
        ['1형 당뇨 논문 검색해줘', 'new'],
        ['관련 논문 검색해서 정리해줘', 'new'],
    ] as const) {
        check(`"${text}" → ${want}`, decidePaperCardFollowup(text, true) === want,
            decidePaperCardFollowup(text, true));
    }
    // 카드가 없으면 판정 자체를 하지 않는다 — 첫 턴을 막으면 안 된다
    check('카드가 없으면 항상 new', decidePaperCardFollowup('세 번째 논문 설명해줘', false) === 'new');

    /**
     * 🔴 실측(`tests/manual/live-card-suction.mts`, 2026-09-01, 168회).
     * 논문 카드가 떠 있을 때 **지시어가 하나도 없는 무관 질의**가 `discuss` 로 빨려 들어갔다:
     *   "리액트 훅 쉽게 설명해줘" → general/검색OFF/**paperFollowup**  (대조군: general/검색OFF)
     * 리액트 질문에 "화면 논문 카드가 근거다, 초록 밖을 사실로 쓰지 마라" 가 주입된다.
     *
     * 원인은 LLM 이 아니라 결정적 정규식이다 — `PAPER_REFORMAT` 이 `쉽게` 한 단어만 보고 걸렸다.
     * 어제 가드를 `general` 까지 넓히면서(§6.22) 이 정규식의 넓이가 그대로 노출됐다.
     *
     * ⚖️ 경계는 **목적어 유무**다. 재구성 어휘를 걷어내고 남는 게 있으면 새 주제다:
     *   "표로 정리해줘"(남는 것 없음) → 카드 대화 · "서울 맛집 목록으로 보여줘"(서울 맛집) → 새 질의
     */
    for (const [text, want] of [
        // 목적어 없는 순수 재구성 — 카드 대화가 맞다
        ['표로 정리해줘', 'discuss'],
        ['쉽게 풀어서 설명해줘', 'discuss'],
        ['간단히 요약해줘', 'discuss'],
        ['한 줄로 요약해줘', 'discuss'],
        ['비교해줘', 'discuss'],
        ['영어로 번역해줘', 'discuss'],
        ['이 내용 표로 정리해줘', 'discuss'],
        ['지금까지 나온 논문들 표로 정리해줘', 'discuss'],
        // 🔴 목적어가 있다 — 새 질의다. 논문 카드가 근거일 이유가 없다
        ['리액트 훅 쉽게 설명해줘', 'new'],
        ['파이썬 리스트 정렬 간단히 알려줘', 'new'],
        ['이 사진 쉽게 설명해줘', 'new'],
        ['서울 맛집 목록으로 보여줘', 'new'],
        ['도커 컴포즈 쉽게 정리해줘', 'new'],
        ['환율 추이 표로 보여줘', 'new'],
    ] as const) {
        check(`"${text}" → ${want}`, decidePaperCardFollowup(text, true) === want,
            decidePaperCardFollowup(text, true));
    }

    const routerSrc = read('../server/agent/nodes/router.ts');
    check('라우터가 창 안의 논문 카드를 감지한다', /json\\s\*:\\s\*paper/.test(routerSrc));
    check('라우터가 후속 판정을 호출한다', /decidePaperCardFollowup\(/.test(routerSrc));
    // 🔴 실측(사용자 로컬, 2026-08-31): 라우터 LLM 이 "세 번째 논문 좀 더 설명해줘" 를
    //   **`general`** 로 분류했다(paper_source=none → 두 DB 밖 강등). 가드가 paper_search 일 때만
    //   보고 있어 그냥 지나갔고, needsSearch 가 켜진 채 웹 검색으로 엉뚱한 답이 나갔다:
    //   "죄송합니다. 세 번째 논문은 찾을 수 없었습니다. arXiv 데이터베이스에 연결할 수 없었습니다."
    //   화면엔 카드가 멀쩡히 떠 있는데 말이다. 의도가 무엇이든 **카드가 있고 카드 대화면** 잡아야 한다.
    check('general 로 분류된 턴도 가드가 잡는다',
        /intent === "paper_search" \|\| intent === "arxiv_search" \|\| intent === "general"/.test(routerSrc));
    check('카드 대화는 general 로 보낸다', /paperFollowup = true;[\s\S]{0,120}intent = ['"]general['"]|intent = ['"]general['"];[\s\S]{0,120}paperFollowup = true/.test(routerSrc));
    // 카드가 근거다 — 검색을 켜면 모델이 카드를 무시하고 웹 결과로 답한다(날씨 카드와 같은 이유)
    check('카드 대화 턴은 검색을 끈다', /else if \(paperFollowup\)[\s\S]{0,200}needsSearch = false/.test(routerSrc));

    /**
     * 🔴 실측(사용자 화면, 2026-09-01). 여러 턴을 테스트한 뒤 "두번째 논문 설명해줘" 를 물었더니
     * **빈 arXiv 카드**("조건에 맞는 논문을 찾지 못했습니다")가 새로 붙었다. 판정 함수는 정상이고
     * (`decidePaperCardFollowup('두번째 논문 설명해줘', true) === 'discuss'`) 3턴 재현도 정상이라
     * 원인은 `paperCardShown` 이 false 였던 것으로 좁혀진다.
     *
     * 🔴 **논문 카드만 `activeCards` 보호를 못 받고 있었다.** 서버가 받는 히스토리는 최근 10개인데
     * 클라이언트는 최근 20개(`CARD_WINDOW`)로 판정해 `activeCards` 로 보내 준다 — 그 간극을
     * 메우려고 만든 장치다(날씨·약국·병원·동물병원·법률이 전부 쓴다). 논문만 창 스캔뿐이었다.
     *
     * ⚖️ router.ts 의 옛 주석은 "창을 벗어나면 재조회가 맞다(카드가 화면에서 밀려났으므로)" 였다.
     * 틀렸다 — **밀려난 건 서버의 창이지 사용자의 화면이 아니다.** 사용자는 카드를 보면서
     * "두번째 논문" 이라고 물었다.
     */
    check('🔴 논문 카드도 activeCards 를 우선한다',
        /const paperCardShown = state\.activeCards\?\.paper \?\?/.test(routerSrc),
        '창 스캔만 쓰면 대화가 5턴만 지나도 후속 판정이 꺼진다');
    check('진단을 위해 paperCardShown 을 로그에 남긴다', /paperCardShown=\$\{paperCardShown\}/.test(routerSrc));
    check('서버가 paper 플래그를 통과시킨다',
        sanitizeActiveCards({ paper: true, weather: false }).paper === true);
    check('불린이 아니면 버린다', sanitizeActiveCards({ paper: 'yes' }).paper === undefined);
    const streamSrc = read('../src/hooks/useChatStream.ts');
    check('🔴 클라이언트가 paper 를 실제로 보낸다',
        /paper:\s*hasRecentCard\(messages, '```json:paper'\)/.test(streamSrc),
        '서버가 받을 준비만 하고 클라가 안 보내면 아무 일도 안 일어난다');
}

console.log('\n§4j 카드 대화 턴의 근거 고정 — 판정만으로는 아무 일도 안 일어난다');
{
    // 🔴 실측(사용자 화면, 2026-08-31). "세번째 논문 자세히 설명해줘" 에 카드가 가진 초록은
    //   `A two-strain probiotic combination given twice a day for 3 months was able to reduce
    //   the symptoms of the co…` 한 문장뿐인데, 답변은 연구가 측정한 결과지표 5개(감기 횟수·
    //   지속기간·발열/기침/콧물·학교 결석·이상반응)를 **"연구에서 확인하려 한 주요 결과"** 라고
    //   사실처럼 나열했다. 초록에 없는 내용이다.
    //
    //   원인은 판정이 아니라 **배선**이었다. `paperFollowup` 은 router 의 지역 변수로 끝나서
    //   `needsSearch` 만 끄고 state 로 나가지 않았다 — generator 는 이 턴이 카드 대화인 줄
    //   모르고, `weatherFollowup`·`movieFollowup` 이 받는 근거 고정 규칙을 논문만 못 받았다.
    //   §4h 가 전부 초록이었는데도 이게 지나간 이유다: 판정은 맞았고 그 결과가 버려졌다.
    // 지시문은 한국어 고정이다 — 이 레포는 **모델이 인용할 수 있는 값**만 다국어로 만든다
    //   (PHARMACY_FACT_LABELS 가 그 이유를 적어 뒀다). 규칙문은 값이 아니라 지시다.
    const rules = buildPaperFollowupRules();
    // 🔴 이 검사들은 **문구를 직접** 본다. 초안에서는 `/지어내지|추측하지|만들지/` 처럼 느슨하게
    //   봤는데, 핵심 문장을 "그 논문의 사실로 **쓸 수 있습니다**" 로 뒤집어도 다른 줄의 "추측" 에
    //   걸려 초록으로 통과했다(실측). 규칙문은 계약이므로 계약 문장을 못 박는다 —
    //   문구를 바꾸려면 이 줄도 같이 바꾸게 해서, 바꾼 사실이 리뷰에 보이게 한다.
    const lines = rules.split('\n');
    check('규칙이 8줄 이상이다', lines.length >= 8, `${lines.length}줄`);
    check('블록 제목이 있다', lines[0].startsWith('[표시된 논문 카드 후속 대화 규칙'));
    check('카드에 무엇이 없는지 열거한다',
        rules.includes('연구가 측정한 결과지표 목록') && rules.includes('대부분 들어 있지 않습니다'));
    check('🔴 초록 밖 내용을 그 논문의 사실로 쓰는 것을 금지한다',
        rules.includes('그 논문의 사실로 쓰지 마세요'),
        '실측된 결함 문장이 "주요 결과는 다음과 같다" 였다');
    check('추측 항목의 목록 나열을 특히 짚는다', rules.includes('추측한 항목을 목록으로 나열'));
    check('배경 설명 자체는 막지 않는다', rules.includes('설명해도 됩니다'));
    check('초록 출처와 일반 지식을 구분해 밝히게 한다',
        rules.includes('초록에서 확인된 것과 일반 지식으로 덧붙인 것을 문장 안에서 구분'));
    check('없으면 원문으로 안내한다', rules.includes('짧게 없다고 말하고') && /PMID/.test(rules));
    check('새 카드를 만들지 말라고 한다', rules.includes('새 카드를 만들지 마세요'));
    check('표 재구성도 카드 값으로 묶는다',
        rules.includes('카드에 있는 논문만, 카드에 있는 값만') && rules.includes('기억으로 채우지 마세요'));
    check('표로 옮겨도 근거 식별자를 잃지 않게 한다', rules.includes('표에도 남겨'));

    // ── 배선 ── 판정 결과가 generator 까지 실제로 가는가
    const routerSrc = read('../server/agent/nodes/router.ts');
    const stateSrc = read('../server/agent/state.ts');
    const genSrc = read('../server/agent/nodes/generator.ts');
    check('state 에 paperFollowup 이 있다', /paperFollowup:\s*Annotation/.test(stateSrc));
    check('🔴 라우터가 paperFollowup 을 반환한다', /return \{[^}]*paperFollowup/.test(routerSrc),
        '지역 변수로만 쓰이면 generator 는 이 턴이 카드 대화인 줄 모른다');
    check('generator 가 그 값을 보고 규칙을 넣는다',
        /state\.paperFollowup/.test(genSrc) && /buildPaperFollowupRules\(/.test(genSrc));
}

console.log('\n§4i 인용 번호는 이번 턴 카드만 가리킨다');
{
    const prompt = read('../server/agent/prompt.ts');
    // 🔴 실측: 새 카드가 1건뿐인 턴에 모델이 "이전 검색 결과에서 … [5] 입니다" 로 답했다.
    //   [5] 는 지난 턴 카드의 번호다 — 화면의 카드에는 그 번호가 없다.
    check('이번 턴 카드만 가리킨다는 지시가 양쪽 의도에 있다',
        (prompt.match(/A marker points ONLY into the card attached to THIS message/g) ?? []).length === 2);
    check('지난 턴 논문은 번호 없이 이름으로 부르게 한다',
        (prompt.match(/name it \(title, author, year\) and give it NO marker/g) ?? []).length === 2);
}

console.log('\n§4k 주제 이탈 논문 — 커버리지로는 못 가른다, 주제어로 가른다');
{
    /**
     * 🔴 실측(사용자 화면 + `tests/manual/probe-paper-relevance.mts`, 2026-09-01).
     * `프로바이오틱스 감기 논문` 카드 5건 중 2건에 probiotics 가 초록에 **한 번도** 안 나왔다
     * (비타민C·에키네시아 리뷰, "Earthing accelerates immune response" 종설). 산문도 그 둘만
     * 인용하지 않았다 — 모델의 인용이 관련도 판정을 이미 하고 있었다.
     *
     * 🔴 **평면 커버리지로는 못 가른다.** 실측 커버리지가 뒤집힌다:
     *      #1 무관 75% · #3 관련 75% · #5 관련 50% · #4 무관 75%
     * "common cold prevention" 은 결과 전건이 공유한다 — PubMed 가 그걸로 매칭했으니 당연하다.
     * 프로브 50건에서도 75% 구간에 관련 13건과 무관 2건이 같이 들어 있었다.
     *
     * 🔴 **결과 내 빈도로 주제어를 고르는 공짜 방법도 실패했다** — 10질의 중 일치 1·불일치 6.
     * `elderly`·`outcomes`·`clinical` 같은 맥락어를 골랐다. 그래서 코퍼스 수록량(esearch count)을
     * 쓴다. NCBI_KEY 가 있어 용어당 110ms 다.
     */
    check('용어 분해 — 기능어를 뺀다',
        relevanceTerms('probiotics common cold prevention').join(' ') === 'probiotics common cold prevention');
    check('짧은 말과 기능어 제거', relevanceTerms('the role of a gut microbiome in obesity').join(' ') === 'role gut microbiome obesity');
    check('빈 질의는 빈 배열', relevanceTerms('   ').length === 0);

    // 주제어 = 코퍼스에 **가장 적게** 실린 용어. 실측값 그대로 넣는다(프로브 출력).
    const counts = new Map([['probiotics', 66551], ['common', 2251661], ['cold', 250094], ['prevention', 3684125]]);
    check('주제어는 가장 희귀한 용어', pickHeadTerm(counts) === 'probiotics');
    check('0건 용어는 후보에서 뺀다 — 오타일 수 있다',
        pickHeadTerm(new Map([['zzqqxx', 0], ['aspirin', 80508], ['trial', 2492099]])) === 'aspirin');
    check('전부 0건이면 주제어 없음', pickHeadTerm(new Map([['zzqqxx', 0]])) === null);
    check('용어가 하나뿐이면 판별할 게 없다 — 주제어 없음', pickHeadTerm(new Map([['aspirin', 80508]])) === null);

    // 실측 5건 그대로. #1·#4 만 빠져야 한다.
    const papers = [
        { title: 'Complementary and alternative medicine for prevention and treatment of the common cold',
          summary: 'Vitamin C can be recommended to Canadian patients for prevention of the common cold. There is moderate evidence supporting the use of Echinacea purpurea and zinc lozenges.' },
        { title: 'The effect of probiotics on prevention of common cold: a meta-analysis of randomized controlled trial studies',
          summary: 'In this meta-analysis, there was marginal effect of probiotics on the prevention of the common cold.' },
        { title: 'Randomized controlled trial of probiotics to reduce common cold in schoolchildren',
          summary: 'A two-strain probiotic combination given twice a day for 3 months was able to reduce the symptoms of the common cold and school absenteeism in schoolchildren.' },
        { title: 'Prevention and Treatment of Influenza, Influenza-Like Illness, and Common Cold by Herbal, Complementary, and Natural Therapies',
          summary: 'Earthing accelerates immune response following vaccination, as demonstrated by increases of gamma globulin concentration.' },
        { title: 'Comparative effectiveness of oral nutritional supplements in preventing respiratory tract infections among adults',
          summary: 'Based on the current evidence, catechin, B. animalis, and multi-strain probiotics show relatively better effects in preventing adult RTI.' },
    ] as any[];
    const split = splitOffTopic(papers, 'probiotics');
    check('실측 5건에서 무관 2건만 빠진다', split.kept.length === 3 && split.offTopic.length === 2,
        `kept ${split.kept.length} / off ${split.offTopic.length}`);
    check('빠진 것이 #1 과 #4 다 — 산문이 인용하지 않은 바로 그 둘',
        split.offTopic[0].title.startsWith('Complementary') && split.offTopic[1].title.startsWith('Prevention and Treatment of Influenza'));
    // ── 어간 근사 ── 위 5건은 제목에 복수형이 있어 어간 처리를 **거치지 않는다.**
    //   그래서 단수형만 있는 논문을 따로 세운다(어간 처리를 지우면 이 검사가 빨개진다).
    const stemCase = [
        { title: 'A probiotic intervention in schoolchildren', summary: 'The probiotic reduced symptoms.' },
        { title: 'Zinc lozenges for the common cold', summary: 'Zinc shortened duration.' },
    ] as any[];
    check('어미 차이를 넘어 매칭한다 — probiotic ↔ probiotics',
        splitOffTopic(stemCase, 'probiotics').kept.length === 1 &&
        splitOffTopic(stemCase, 'probiotics').kept[0].title.startsWith('A probiotic'));
    const verbCase = [{ title: 'Preventing respiratory infections', summary: 'A trial.' }] as any[];
    check('prevention ↔ preventing 도 이어진다', splitOffTopic(verbCase, 'prevention').offTopic.length === 0);
    // 🔴 과하게 깎으면 주제어가 무력화된다 — `lesion`→`les` 는 "unless" 에 걸린다
    const overCut = [{ title: 'Unless treatment is given', summary: 'A series of observations.' }] as any[];
    check('짧은 어간으로 깎아 아무 데나 붙지 않는다', splitOffTopic(overCut, 'lesion').offTopic.length === 0
        ? splitOffTopic(overCut, 'lesion').kept.length === 1 : true);
    check('🔴 lesion 이 unless 에 걸리지 않는다',
        !splitOffTopic([...overCut, { title: 'Brain lesion mapping', summary: 'x' }] as any[], 'lesion')
            .kept.some(p => /Unless/.test(p.title)));

    // ── 안전판 ── 걸러내다 카드를 비우면 안 된다
    check('주제어가 없으면 아무것도 거르지 않는다', splitOffTopic(papers, null).offTopic.length === 0);
    // 주제어가 **절반 미만**에만 있으면 질의 자체가 어긋난 것이다 — 논문 개별의 문제가 아니다.
    // 프로브 10질의에서 한 번도 발동하지 않았지만(최저 3/5), 발동하면 통째로 비는 자리다.
    check('🔴 주제어가 절반 미만이면 필터를 끈다(fail-open)',
        splitOffTopic(papers, 'earthing').offTopic.length === 0,
        '1/5 에만 있는 용어로 4건을 버리면 카드가 무너진다');
    check('빈 목록에 안전하다', splitOffTopic([], 'probiotics').kept.length === 0);
    // 필터가 실제로 걸렸는지를 호출부가 알아야 한다 — 철회 목록에 같은 주제어를 쓸지 정하는 근거다
    check('적용 여부를 반환한다', splitOffTopic(papers, 'probiotics').applied === true);
    check('fail-open 이면 미적용으로 표시', splitOffTopic(papers, 'earthing').applied === false);
    check('주제어 없으면 미적용', splitOffTopic(papers, null).applied === false);

    /**
     * 🔴 실측(사용자 화면, 2026-09-01). 감기 논문을 물었는데 **철회됨** 딱지가 붙은
     * 위장 논문(34007566 `Alternative Treatments for Minor GI Ailments`)이 카드에 떴다.
     * 주제 필터가 `papers` 에만 걸려 있고 `retracted`·`noAbstract` 는 그대로 나갔다.
     *
     * ⚖️ `noAbstract` 에는 걸지 않는다. `summary` 가 빈 문자열이라 **제목만** 남는데,
     * 실측 3건 중 `Prevention and treatment of the common cold: making sense of the evidence`
     * 는 제목에 probiotics 가 없어도 질문과 관련 있는 논문이다. 판단 근거가 없으면 판단하지 않는다.
     */
    const retractedPapers = [
        { title: 'Alternative Treatments for Minor GI Ailments', summaryKind: 'excerpt' as const,
          summary: 'On the other hand, dietary habits and specific food types can play a significant role in the onset, treatment, and prevention of many GI disorders.' },
        { title: 'Probiotics for acute gastroenteritis', summaryKind: 'conclusion' as const,
          summary: 'This probiotic did not reduce symptoms.' },
        { title: 'Some paper with no abstract', summaryKind: 'none' as const, summary: '' },
    ] as any[];
    const keptRet = filterOffTopicAside(retractedPapers, 'probiotics');
    check('🔴 주제 무관한 철회 논문은 카드에서 빠진다',
        !keptRet.some(p => /GI Ailments/.test(p.title)), keptRet.map(p => p.title).join(' | '));
    check('주제에 맞는 철회 논문은 남는다 — 알려줄 값이 있다',
        keptRet.some(p => /acute gastroenteritis/.test(p.title)));
    check('초록 없는 논문은 판단하지 않는다 — 제목만으로 자르면 관련 논문이 잘린다',
        keptRet.some(p => /no abstract/.test(p.title)));
    check('주제어가 없으면 손대지 않는다', filterOffTopicAside(retractedPapers, null).length === 3);

    // ── 배선 ── 🔴 순수 함수만 검사했더니 무력화 실험에서 ①(곁칸 필터 미적용)과
    //   ③(fail-open 무시)이 둘 다 초록이었다. 판정을 만들어 놓고 연결을 안 본 것 —
    //   §6.22 와 같은 실수다. `searchPapers` 는 네트워크를 타서 임포트할 수 없으므로
    //   **배선만** 소스로 본다(계약은 위에서 행동으로 봤다).
    const toolSrc = read('../server/agent/paper-tool.ts');
    check('🔴 철회 목록이 필터를 거쳐 나간다',
        /retracted:\s*filterOffTopicAside\(retracted,/.test(toolSrc),
        '순수 함수를 만들어 놓고 반환에 연결하지 않으면 아무 일도 안 일어난다');
    check('🔴 초록없음 목록은 필터를 거치지 않는다',
        /noAbstract,\s*\n?\s*\}/.test(toolSrc) && !/noAbstract:\s*filterOffTopicAside/.test(toolSrc));
    check('🔴 본 목록에서 필터가 실제로 걸렸을 때만 곁칸에 같은 주제어를 쓴다',
        /if \(split\.applied\) appliedHead = head;/.test(toolSrc),
        'fail-open 으로 본 목록을 못 거른 주제어를 곁칸에 쓰면 근거 없이 자른다');
}

console.log('\n§5 배선 — 카드가 실제로 화면까지 가는가');
{
    const chat = read('../components/ChatMessage.tsx');
    check('블록 정규식이 paper 를 받는다', /\|paper\|/.test(chat) || /paper\|weather/.test(chat));
    check('파서가 paper 를 분기한다', /blockType === 'paper'/.test(chat));
    check('렌더러를 디스패치한다', /part\.type === 'paper'/.test(chat) && /<PaperRenderer/.test(chat));

    check("카드 타입에 'paper' 가 있다", /'paper'/.test(read('../server/agent/card-tool-output.ts')));
    check('의도 paper_search 가 등록돼 있다', /intent: 'paper_search'/.test(read('../server/agent/local-tool-registry.ts')));
    check('라우터가 paper_search 를 유효 의도로 받는다', /"paper_search"/.test(read('../server/agent/nodes/router.ts')));

    const prompt = read('../server/agent/prompt.ts');
    check('프롬프트에 paper_search 힌트가 있다', /paper_search: `\[INTENT FOCUS: RESEARCH PAPERS\]/.test(prompt));
    // 모델이 식별자를 고쳐 쓰면 잘못된 DOI 가 사용자에게 간다 — 지시가 사라지면 실패시킨다
    check('식별자 변조 금지 지시가 있다', /Never edit, guess, or invent an identifier/.test(prompt));
    check('null 등급을 추정하지 말라는 지시가 있다', /do NOT infer a level from the title/i.test(prompt));
    // 카드는 코드가 붙인다 — 모델이 카드를 쓰면 산문 없이 카드만 내는 사례가 있었다(Gemini 실측)
    check('모델이 카드를 직접 쓰지 말라는 지시가 있다', /Do NOT output a .*json:paper block yourself/.test(prompt));
    check('카드 고정 헬퍼가 있다', /export const pinCardToProse/.test(read('../server/agent/card-tool-output.ts')));
    check('ToolNode 에 paperTool 이 등록돼 있다', /new ToolNode\(\[[^\]]*paperTool/.test(read('../server/agent/graph.ts')));
    check('LANGCHAIN_INTENTS 에 paper_search 가 있다', /"paper_search"/.test(read('../server/agent/nodes/generator.ts')));
    // arXiv 배선 — 하나라도 빠지면 도구가 안 붙거나 카드가 모델 손을 탄다(PubMed 에서 4곳 다 겪었다)
    const lc = read('../server/agent/nodes/langchain-path.ts');
    check('arxiv_search 가 LANGCHAIN_INTENTS 에 있다', /"arxiv_search"/.test(read('../server/agent/nodes/generator.ts')));
    // 2026-09-02: 논문 두 의도가 한 분기로 합쳐졌다(§9.3 — 종합 단계 웹검색). 검사 대상은
    // 리터럴 모양이 아니라 **계약**이다: ① arxiv_search 는 arxivTool 을 묶는다
    // ② 조회 1차 호출은 반드시 단일 도구다(forceDomainTool 이 allTools.length===1 을 요구하므로,
    //    풀리면 모델이 논문 도구를 아예 안 부를 수 있다).
    check('arxiv_search 에 arxivTool 을 묶는다',
        /state\.intent === "paper_search" \? paperTool : arxivTool/.test(lc));
    check('🔴 논문 조회 1차 호출은 단일 도구 — 강제가 풀리면 도구를 안 부른다',
        /\? \[paperCardTool, searchWebTool\]\s*\n?\s*: \[paperCardTool\]/.test(lc));
    check('논문 종합 단계 웹검색은 판정 함수를 거친다(명시 요청일 때만)',
        /shouldAddWebSearchToPaperFollowup\(state\.intent, lastMsg\._getType\(\) === 'tool'/.test(lc));
    check('arxiv_search 도 도구 강제(SYNTH_TOOL_INTENTS)', /SYNTH_TOOL_INTENTS[^\n]*arxiv_search/.test(lc));
    check('arxiv_search 도 카드를 도구 출력으로 고정한다', /arxiv_search: "paper"/.test(lc));
    check('ToolNode 에 arxivTool 이 등록돼 있다', /arxivTool\]/.test(read('../server/agent/graph.ts')));
    check('OpenAI 경로 레지스트리에도 있다', /intent: 'arxiv_search'/.test(read('../server/agent/local-tool-registry.ts')));
    check('프롬프트가 프리프린트임을 밝히게 한다', /PREPRINT server/.test(prompt));
    check('arXiv 프롬프트도 카드를 직접 쓰지 말라고 한다',
        (prompt.match(/Do NOT output a .{0,6}json:paper block yourself/g) ?? []).length >= 2);
    // PubMed 는 의생명만 색인한다 — 주제가 어긋나면 카드를 내지 말라는 백스톱
    check('주제 불일치 시 카드를 내지 말라는 지시가 있다',
        /Never present topically mismatched papers as evidence/.test(prompt));
    const router = read('../server/agent/nodes/router.ts');
    // 의도는 "논문을 요청했나" 만 본다 — 분야는 paper_source 가 가른다(같은 판단을 두 번 하면 어긋난다).
    check('paper_search 의도가 분야를 판단하지 않는다',
        /do NOT judge the field here/.test(router));
    check('arxiv_search 는 모델이 고르지 않는다 — paper_source 에서 파생된다',
        !/- "arxiv_search"/.test(router));
    check('라우터 LLM 실패 시 규칙 폴백이 있다',
        /intent: "paper_search"/.test(read('../server/agent/intentRules.ts')));
}

console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);

console.log('\n§4h 링크형 인용의 번호를 URL 로 교정한다 (2026-09-03)');
{
    // 🔴 실측(gpt-5.6-luna, `Attention Is All You Need 논문 찾아줘`): 카드 8건 중 원 논문은 2번인데
    //   산문이 `[1](https://arxiv.org/abs/1706.03762)` 라고 썼다. URL 은 맞고 번호가 틀렸다.
    //   `dropMarkersOutsideRange` 로는 못 잡는다 — `[1]` 은 범위 **안**이다. 범위가 아니라
    //   가리키는 대상이 틀린 결함이라 판정 근거가 URL 이어야 한다.
    const urls = [
        'https://arxiv.org/abs/2604.21816',
        'https://arxiv.org/abs/1706.03762',
        'https://arxiv.org/abs/2104.04692',
    ];
    const run = (t: string) => dropMarkersOutsideRange(repairPaperMarkerLinks(t, urls), urls.length);

    check('실측 사례 — 카드 2번을 가리키게 고친다',
        run('식별자: 1706.03762 [1](https://arxiv.org/abs/1706.03762)') === '식별자: 1706.03762 [2]',
        run('식별자: 1706.03762 [1](https://arxiv.org/abs/1706.03762)'));
    check('버전 접미사가 붙어도 같은 논문으로 본다',
        run('어텐션 [3](https://arxiv.org/abs/1706.03762v2) 입니다') === '어텐션 [2] 입니다');
    check('카드에 없는 arXiv 논문은 마커를 뗀다 — 카드 순번 계약 위반',
        !/\[\d+\]/.test(run('다른 논문 [2](https://arxiv.org/abs/9999.99999) 도 있습니다')));
    check('🔴 grounding 링크는 건드리지 않는다 — 출처가 사라지면 안 된다',
        run('설명 [1](https://vertexaisearch.cloud.google.com/x) 끝')
        === '설명 [1](https://vertexaisearch.cloud.google.com/x) 끝');
    check('맨 마커는 그대로 통과한다', run('이 논문 [2] 입니다') === '이 논문 [2] 입니다');
    check('PubMed 호스트도 대상이다',
        !/\[\d+\]\(/.test(run('연구 [1](https://pubmed.ncbi.nlm.nih.gov/99999999/) 참고')));
    check('카드가 비면 손대지 않는다', repairPaperMarkerLinks('a [1](https://arxiv.org/abs/1) b', []) === 'a [1](https://arxiv.org/abs/1) b');

    // 배선 — 판정만 맞고 아무 일도 안 일어나는 실수를 막는다(DEV_260830 §6.22·§6.25 규칙)
    const dispatchSrc = read('../server/agent/stream-dispatch.ts');
    check('배선: 스트림이 교정을 **먼저** 하고 범위 검사를 뒤에 한다',
        /dropMarkersOutsideRange\(repairPaperMarkerLinks\(t, st\.pinnedPaperUrls\), st\.pinnedPaperCount\)/.test(dispatchSrc));
    check('배선: 스트림이 카드 URL 을 캡처한다', /pinnedPaperUrls = papers\.map/.test(dispatchSrc));
    check('배선: 청크 경계 보류가 링크형까지 잡는다 — 반쪽 URL 이 화면에 남으면 안 된다',
        /\\]\(\[\^\)\\s\]\*\)\?\$/.test(dispatchSrc));
    check('배선: 최종 메시지 경로도 교정한다',
        /repairPaperMarkerLinks\(prose, papers\.map/.test(read('../server/agent/card-tool-output.ts')));
}

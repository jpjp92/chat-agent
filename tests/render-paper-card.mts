/**
 * PaperRenderer 를 **실제로 렌더해서** 확인한다 — `npm test` 에 들어간다(무네트워크·무자격증명).
 *
 * 🔴 test-paper-card.mts §4 는 소스를 정규식으로 본다. 그건 "그 코드가 파일에 있다" 까지만
 * 말해준다 — 조건이 틀려 영영 안 그려지는 칸도, 다른 언어에서만 깨지는 문구도 통과한다.
 * 여기서는 JSX 를 돌려 **나온 HTML** 을 본다. 두 검사는 겹치지 않는다.
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaperRenderer } from '../components/PaperRenderer';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
    console.log(`  ${ok ? '✅' : '🔴'} ${label}${detail ? ` — ${detail}` : ''}`);
    if (!ok) failures++;
};

const paper = (over: Record<string, unknown> = {}) => {
    const pmid = String(over.pmid ?? '1');
    return {
        pmid, title: 'A study of things', journal: 'J', year: '2020',
        authors: ['Kim A'], evidence: null, retracted: false, doi: null,
        url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        summary: 'It worked.', summaryKind: 'conclusion', ...over,
    };
};

const render = (data: Record<string, unknown>, language = 'ko') =>
    renderToStaticMarkup(React.createElement(PaperRenderer, { data, language } as never));

const LANGS = ['ko', 'en', 'es', 'fr'] as const;

console.log('\n§R1 근거 목록 — 기본 렌더');
{
    const html = render({ query: 'q', source: 'pubmed', total: 54, papers: [paper()], retracted: [], noAbstract: [] });
    check('제목이 나온다', html.includes('A study of things'));
    check('PMID 링크가 나온다', html.includes('https://pubmed.ncbi.nlm.nih.gov/1/') && html.includes('PMID'));
    check('결론에는 발췌 칩을 안 단다', !html.includes('초록 발췌'));
    check('철회 칸이 없다', !html.includes('철회'));
    check('초록없음 칸이 없다', !html.includes('초록이 없어'));
}

console.log('\n§R2 요약 출처 — 결론 / 발췌 / 초록 없음');
{
    const excerpt = render({ query: 'q', source: 'pubmed', total: 1, papers: [paper({ summaryKind: 'excerpt' })], retracted: [], noAbstract: [] });
    check('발췌에는 칩이 붙는다', excerpt.includes('초록 발췌'));
    check('발췌 본문도 함께 나온다', excerpt.includes('It worked.'));

    // summary 가 빈 논문이 papers 에 남아 있던 옛 카드(하위호환) — 빈칸으로 두지 않는다
    const empty = render({ query: 'q', source: 'pubmed', total: 1, papers: [paper({ summary: '', summaryKind: 'none' })], retracted: [], noAbstract: [] });
    check('요약이 비면 초록 없음이라고 말한다', empty.includes('초록이 공개되지 않은'));

    // arXiv 에는 PubMed 의 초록 개념을 들이대지 않는다
    const arxiv = render({
        query: 'q', source: 'arxiv', total: 1,
        papers: [{ arxivId: '2401.1', title: 'T', url: 'https://arxiv.org/abs/2401.1', published: false, summary: '' }],
    });
    check('arXiv 카드에는 초록 없음 문구를 안 쓴다', !arxiv.includes('초록이 공개되지 않은'));
    check('arXiv 카드에 프리프린트 배지가 뜬다', arxiv.includes('프리프린트'));
}

console.log('\n§R3 철회 칸 — 번호 목록 밖, 빨강, 취소선');
{
    const html = render({
        query: 'q', source: 'pubmed', total: 9,
        papers: [paper()],
        retracted: [paper({ pmid: '40323973', title: 'RETRACTED: bad meta-analysis', retracted: true, evidence: 'meta-analysis' })],
        noAbstract: [],
    });
    check('제외 칸 제목이 나온다', html.includes('철회되어 제외된 논문'));
    check('건수를 단위와 함께 밝힌다', html.includes('철회되어 제외된 논문 · 1건'),
        html.match(/철회되어 제외된 논문[^<]*/)?.[0]);
    check('철회 논문 제목이 나온다', html.includes('RETRACTED: bad meta-analysis'));
    check('취소선이 걸린다', html.includes('line-through'));
    check('빨강 배지가 붙는다', /bg-red-100[^"]*"[^>]*>철회됨/.test(html));
    check('경고 문구가 나온다', html.includes('근거 목록에서 빼두었습니다'));
    // 🔴 근거 등급 배지를 제외 칸에 그리면 철회 논문이 다시 신뢰 신호를 얻는다
    check('제외 칸에는 종합분석 배지를 그리지 않는다', !html.includes('종합분석'));
}

console.log('\n§R4 초록없음 칸 — 철회와 색도 문구도 달라야 한다');
{
    const html = render({
        query: 'q', source: 'pubmed', total: 9,
        papers: [paper()],
        retracted: [],
        noAbstract: [paper({ pmid: '23306139', title: 'Can probiotics do it?', summary: '', summaryKind: 'none' })],
    });
    check('초록없음 칸 제목이 나온다', html.includes('초록이 없어 요약하지 못한 논문'));
    check('논문 제목과 링크가 나온다',
        html.includes('Can probiotics do it?') && html.includes('pubmed.ncbi.nlm.nih.gov/23306139'));
    check('철회 문구가 섞이지 않는다', !html.includes('철회'));
    check('빨강을 쓰지 않는다', !/bg-red-/.test(html.slice(html.indexOf('초록이 없어 요약하지 못한'))));
    check('취소선을 긋지 않는다 (멀쩡한 논문이다)', !html.includes('line-through'));
}

console.log('\n§R5 두 칸이 동시에 — 합쳐지지 않는가');
{
    const html = render({
        query: 'q', source: 'pubmed', total: 9,
        papers: [paper()],
        retracted: [paper({ pmid: '40323973', title: 'RETRACTED: x', retracted: true })],
        noAbstract: [paper({ pmid: '23306139', title: 'No abstract here', summary: '', summaryKind: 'none' })],
    });
    check('두 칸이 모두 나온다',
        html.includes('철회되어 제외된 논문') && html.includes('초록이 없어 요약하지 못한 논문'));
    // ⚖️ 한 상자에 담으면 멀쩡한 논문에 철회의 색이 묻는다
    const between = html.slice(html.indexOf('철회되어 제외된 논문'), html.indexOf('초록이 없어 요약하지 못한'));
    check('철회 칸이 초록없음 칸보다 먼저 닫힌다 (별개 상자다)', between.includes('</div>'));
    check('초록없음 논문에 철회 배지가 안 붙는다',
        !/No abstract here[\s\S]{0,200}철회됨/.test(html) && !/철회됨[\s\S]{0,200}No abstract here/.test(html));
}

console.log('\n§R6 빈손 — 무엇이 남았는지에 따라 문구가 달라야 한다');
{
    const nothing = render({ query: 'q', source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [] });
    check('아무것도 없으면 "찾지 못했습니다"', nothing.includes('조건에 맞는 논문을 찾지 못했습니다'));

    // 🔴 전부 철회인데 "못 찾았다" 고 하면 거짓말이다 — 찾긴 찾았고 쓸 수 없는 것이다
    const allRetracted = render({
        query: 'q', source: 'pubmed', total: 1, papers: [],
        retracted: [paper({ retracted: true, title: 'RETRACTED: only hit' })], noAbstract: [],
    });
    check('전부 철회면 "못 찾음" 이 아니다', !allRetracted.includes('찾지 못했습니다'));
    check('전부 철회면 제외 칸을 보여준다', allRetracted.includes('RETRACTED: only hit'));

    const allNoAbstract = render({
        query: 'q', source: 'pubmed', total: 1, papers: [],
        retracted: [], noAbstract: [paper({ summary: '', summaryKind: 'none', title: 'Only hit, no abstract' })],
    });
    check('전부 초록없음이면 "못 찾음" 이 아니다', !allNoAbstract.includes('찾지 못했습니다'));
    check('전부 초록없음이면 그 논문을 보여준다', allNoAbstract.includes('Only hit, no abstract'));

    // 이 필드들이 생기기 전 카드 — undefined 로 와도 터지면 안 된다
    const legacy = render({ query: 'q', total: 1, papers: [paper()] });
    check('옛 카드(분리 칸 없음)도 렌더된다', legacy.includes('A study of things'));
}

console.log('\n§R6b 조회 실패 — 0건과 같은 화면이면 거짓말이다');
{
    // 🔴 PubMed 가 죽어서 아무것도 못 받은 것과 조건에 맞는 논문이 정말 없는 것은
    //   사용자에게 정반대 뜻이다. `error` 를 선언만 해두고 안 그려서 장애가 "찾지 못했습니다" 로 나갔다.
    const empty = render({ query: 'q', source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [] });
    const failed = render({ query: 'q', source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [], error: 'PubMed esearch HTTP 500' });

    check('두 화면이 다르다', empty !== failed);
    check('실패는 "찾지 못했습니다" 라고 말하지 않는다', !failed.includes('조건에 맞는 논문을 찾지 못했습니다'));
    check('실패는 조회 실패라고 말한다', failed.includes('논문을 조회하지 못했습니다'));
    check('다시 시도 안내가 붙는다', failed.includes('다시 시도해'));
    check('0건 쪽은 실패 문구를 쓰지 않는다', !empty.includes('조회하지 못했습니다'));
    // 원문 에러 메시지는 사용자에게 노출하지 않는다(다른 카드들의 계약과 같다)
    check('내부 에러 메시지를 노출하지 않는다', !failed.includes('HTTP 500'));

    // 🔴 실제 화면에서 잡힌 두 가지(2026-08-31 사용자 확인).
    //   ⓐ arXiv 조회 실패인데 카드가 "PubMed 응답을 받지 못했습니다" 라고 말했다 —
    //     이 카드는 두 출처가 공유한다. `disclaimer` 는 이미 출처별로 갈라 두었는데 여기만 빠뜨렸다.
    //   ⓑ 아이콘이 두부(⊠)로 떴다 — `fa-regular fa-circle-exclamation` 은 무료 세트에 없다.
    const failedArxiv = render({ query: 'q', source: 'arxiv', total: 0, papers: [], error: 'arXiv HTTP 429' });
    check('arXiv 실패에 PubMed 라고 하지 않는다', !failedArxiv.includes('PubMed'),
        failedArxiv.match(/[^>]*PubMed[^<]*/)?.[0]?.slice(0, 60) ?? '');
    check('arXiv 실패는 arXiv 라고 말한다', failedArxiv.includes('arXiv'));
    check('PubMed 실패는 PubMed 라고 말한다', failed.includes('PubMed'));
    check('실패 아이콘이 무료 세트에 있는 것이다 (fa-solid)',
        /fa-solid fa-(circle|triangle)-exclamation/.test(failed),
        failed.match(/fa-[a-z]+ fa-[a-z-]+/g)?.join(' ') ?? '');
    check('실패 아이콘에 fa-regular 를 쓰지 않는다', !/fa-regular fa-circle-exclamation/.test(failed));

    for (const l of ['en', 'es', 'fr'] as const) {
        const h = render({ query: 'q', source: 'pubmed', total: 0, papers: [], retracted: [], noAbstract: [], error: 'x' }, l);
        check(`${l}: 조회 실패 문구가 번역돼 있다`, h !== failed && !h.includes('undefined') && !h.includes('조회하지'));
    }
}

console.log('\n§R7 4개 언어 — 새 칸 문구가 전부 번역돼 있는가');
{
    const data = {
        query: 'q', source: 'pubmed', total: 9,
        papers: [paper({ summaryKind: 'excerpt' })],
        retracted: [paper({ pmid: '2', title: 'R', retracted: true })],
        noAbstract: [paper({ pmid: '3', title: 'N', summary: '', summaryKind: 'none' })],
    };
    // 언어별 HTML 이 서로 달라야 한다 — 같으면 한 언어가 폴백된 것이다
    const htmls = Object.fromEntries(LANGS.map(l => [l, render(data, l)]));
    for (const l of LANGS) {
        const h = htmls[l];
        const ok = !h.includes('undefined') && h.length > 500;
        check(`${l}: 렌더되고 undefined 가 없다`, ok, `${h.length}자`);
    }
    for (const l of LANGS.slice(1)) {
        check(`${l}: 한국어와 다른 문구다 (번역 누락 아님)`, htmls[l] !== htmls.ko);
    }
    // 실제 문구 대조 — 키만 있고 값이 한국어인 경우를 잡는다
    check('en 제외 칸 문구', htmls.en.includes('Excluded') && htmls.en.includes('kept out of the evidence list'));
    // 단위는 언어마다 다르다 — ko 만 '건' 이고 나머지는 숫자로 끝난다(카드 머리말과 같은 규칙)
    check('ko 는 건수에 단위가 붙는다', htmls.ko.includes('· 1건'));
    check('en 은 단위 없이 숫자로 끝난다', /Excluded — retracted · 1</.test(htmls.en),
        htmls.en.match(/Excluded[^<]*/)?.[0]);
    check('es 제외 칸 문구', htmls.es.includes('Excluidos') && htmls.es.includes('lista de evidencia'));
    check('fr 제외 칸 문구', htmls.fr.includes('Exclus') && htmls.fr.includes('liste de preuves'));
    check('en 초록없음 칸 문구', htmls.en.includes('No abstract') && htmls.en.includes('holds no abstract'));
    check('es 초록없음 칸 문구', htmls.es.includes('Sin resumen'));
    check('fr 초록없음 칸 문구', htmls.fr.includes('Sans résumé'));
    check('발췌 칩도 4개 언어',
        htmls.en.includes('Abstract excerpt') && htmls.es.includes('Extracto') && htmls.fr.includes('Extrait'));
    // 지원하지 않는 언어는 한국어로 떨어진다(렌더러 계약)
    check('모르는 언어는 ko 로 폴백한다', render(data, 'de' as never) === htmls.ko);
}

console.log(`\n${failures === 0 ? '✅ 전부 통과' : `🔴 실패 ${failures}건`}`);
process.exit(failures === 0 ? 0 : 1);

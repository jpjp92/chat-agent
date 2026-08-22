/**
 * DDG 파서 하니스 — `npx tsx tests/test-ddg-parse.mts`
 *
 * 🔴 왜 있는가 (2026-08-18): 파싱 정규식이 `searchWebTool` 안에 박혀 있어서
 *   **DDG 가 HTML 을 바꿔도 아무도 몰랐다.** 실측상 **전 검색에서 출처 URL 이 0건**이었다.
 *   스니펫은 나오니 검색이 되는 것처럼 보였고, 근거를 요구하는 호출부(알약 웹 폴백)는
 *   결과를 통째로 버렸으며, 요구하지 않는 호출부는 **출처 없이** 답했다. 후자가 더 나쁘다.
 *
 * 픽스처는 **실제 응답에서 뜬 조각**이다. 네트워크를 타지 않으므로 하니스 예외 [A] 3조건 충족.
 */
import { parseDdgHtml, resolveDdgHref, formatDdgResults } from '../server/agent/ddg-parse.js';

// 현재(2026-08-18) DDG: `rel` 이 `class` 보다 **앞**에 오고, href 는 **직접 URL**이다.
const NOW = `<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://www.yakcheck.co.kr/pill/202100590">무코스타서방정150밀리그램 (레바미피드) 알약 식별 - 원형 하양 | 약체크</a>
  </h2>
  <div class="result__extras">
    <a rel="nofollow" class="result__snippet" href="https://www.yakcheck.co.kr/pill/202100590">모양 원형 색 하양 앞면 각인 <b>OG37</b> 크기 9.8 &amp; 4.1 mm</a>
  </div>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="https://total.druginfo.co.kr/x.aspx?ckey=DRUGINFO&amp;key=10000015">무코스타 - 드러그인포</a>
  </h2>
  <a class="result__snippet" href="#">흰색의 장방형 서방성 필름코팅 정제</a>
</div>`;

// 옛 DDG: `class` 가 맨 앞이고 href 가 `uddg=` 리디렉션. **둘 다 지원해야 한다.**
const OLD = `<h2><a class="result__a" href="/l/?uddg=https%3A%2F%2Fexample.com%2Fpill%2F1">옛 형식 결과</a></h2>
<a class="result__snippet">옛 형식 스니펫</a>`;

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, why = '') => {
    if (cond) { pass++; console.log(`✅ ${name}`); }
    else { fail++; console.log(`❌ ${name}${why ? ' — ' + why : ''}`); }
};

const now = parseDdgHtml(NOW);
ok('현재 형식  결과 2건을 뽑는다', now.length === 2, `${now.length}건`);
ok('현재 형식  🔴 rel 이 class 앞에 와도 잡는다', now[0]?.url === 'https://www.yakcheck.co.kr/pill/202100590',
   `속성 순서를 고정하면 전 검색의 URL 이 0건이 된다: ${now[0]?.url}`);
ok('현재 형식  제목을 뽑는다', /무코스타서방정150밀리그램/.test(now[0]?.title ?? ''),
   '제목에 약품명이 있다 — 이걸 버리면 답이 사라진다');
ok('현재 형식  스니펫이 같은 순번과 짝지어진다', /각인 OG37/.test(now[0]?.snippet ?? ''), now[0]?.snippet);
ok('현재 형식  HTML 엔티티를 푼다', now[1]?.url.includes('&key=') && !now[1]?.url.includes('&amp;'),
   `&amp; 가 남으면 링크가 깨진다: ${now[1]?.url}`);

const old = parseDdgHtml(OLD);
ok('옛 형식  uddg 리디렉션도 계속 지원한다', old[0]?.url === 'https://example.com/pill/1', old[0]?.url);
ok('resolveDdgHref  직접 URL 은 그대로', resolveDdgHref('https://a.example/b') === 'https://a.example/b');

const out = formatDdgResults('q', now);
ok('출력  [WEB_SOURCE_URLS] 블록이 있다', out.includes('[WEB_SOURCE_URLS]'),
   '🔴 이게 없으면 인용을 요구하는 호출부가 결과를 통째로 버린다(알약 웹 폴백이 그랬다)');
ok('출력  본문에 URL 이 http 로 들어간다', /https?:\/\//.test(out));
ok('출력  결과 0건이면 명시적으로 없다고 말한다', formatDdgResults('q', []).includes('결과가 없습니다'));

// 구조가 또 바뀌면 0건이 된다 — 그때 조용히 빈 결과를 내지 않는지
ok('방어  모르는 구조는 0건을 반환한다(예외 아님)', parseDdgHtml('<div>완전히 다른 HTML</div>').length === 0);

console.log(`\n통과 ${pass} · 실패 ${fail}`);
if (fail > 0) process.exit(1);

/**
 * 상영관(멀티플렉스) 지점 데이터 공유 헬퍼 — 서버(movie-tool)와 클라이언트(MovieRenderer) 양쪽에서 사용.
 * 순수 데이터/문자열 로직만 포함(브라우저·Node 어디서나 안전). 실제 상영시간표 fetch는 app/api/showtimes.
 *
 * 데이터 출처: scripts/test-branch-list.mjs → data/theater-branches.json
 *   CGV    : 9개 지역 그룹(region: 서울/경기/…), 각 site { nm, code(siteNo) }
 *   롯데시네마: flat, { nm, code(cinemaID="Division|int(Detail)|CinemaID"), addr, region } (DivisionCode 1만; 2=중복 제거)
 *   메가박스 : flat, { nm, brchNo, region } (region=/theater/list sel-city 그룹)
 */
import branchesRaw from '../data/theater-branches.json';

export type ChainKey = 'cgv' | 'lotte' | 'mega';

export interface Branch {
  code: string;
  nm: string;
}

interface BranchesFile {
  cgv: { region: string; sites: { nm: string; code: string }[] }[];
  lotte: { nm: string; code: string; division?: string; addr?: string; region?: string }[];
  mega: { brchNo: string; nm: string; region?: string }[];
}

const branches = branchesRaw as BranchesFile;

export const CHAINS: { key: ChainKey; nm: string; color: string }[] = [
  { key: 'cgv', nm: 'CGV', color: '#e6002d' },
  { key: 'lotte', nm: '롯데시네마', color: '#2563eb' },
  { key: 'mega', nm: '메가박스', color: '#6b3fa0' },
];

/** 강남 기준 기본 지점 코드 (지역 매칭 실패 시 폴백) */
export const DEFAULT_CODES: Record<ChainKey, string> = {
  cgv: '0056',        // 강남
  lotte: '1|1|1013',  // 가산디지털 (강남 인근 데모 기본)
  mega: '1372',       // 강남
};

/** 스크랩 데이터에 남은 HTML 엔티티(&#40; 등) 정리 */
const decode = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

/** 체인별 평탄화된 지점 목록 (드롭다운/검색용) */
export function flatBranches(chain: ChainKey): Branch[] {
  if (chain === 'cgv') return branches.cgv.flatMap((r) => r.sites.map((s) => ({ code: s.code, nm: decode(s.nm) })));
  if (chain === 'lotte') return branches.lotte.map((c) => ({ code: c.code, nm: decode(c.nm) }));
  if (chain === 'mega') return branches.mega.map((b) => ({ code: b.brchNo, nm: decode(b.nm) }));
  return [];
}

/**
 * 지역 별칭 — **같은 장소의 다른 표기**만 등록한다(손으로 관리 가능한 크기 유지).
 *
 * 원칙: "가까운 다른 동네"는 넣지 않는다. 예를 들어 노원→중계(CGV)는 실제로 다른 동네라,
 * 사용자가 모른 채 엉뚱한 극장 시간표를 받는다 — 지금 고치려는 가산디지털 문제와 같은 성격이다.
 * 그런 경우는 매칭 실패로 두고 "이 지역엔 지점이 없습니다"로 안내하는 편이 정직하다.
 *
 * 정규식으로 접미사를 깎는 방식은 쓰지 않는다("강남역"→"강남"류를 정규화로 처리하려다
 * `강남→강동`, `서면→매칭실패`를 만든 실험이 있었다 — DEV_260801 §3-3).
 */
const REGION_ALIASES: Record<string, string[]> = {
  '강남역': ['강남'],
  '홍대입구': ['홍대'],
  '신촌역': ['신촌'],
  '잠실': ['월드타워'],      // 롯데월드타워 = 잠실역 (CGV·메가는 해당 지점 없음 → 매칭 실패로 남음)
  '잠실역': ['월드타워'],
  '삼성역': ['코엑스'],      // 메가박스 코엑스
  '용산': ['용산아이파크몰'],
  '영등포역': ['영등포'],
};

/**
 * 지역 키워드(예: "강남", "홍대", "노원")로 체인별 최적 지점을 찾음.
 * 1) 지점명에 키워드 포함(부분일치) → 질의로 시작하는 지점 우선, 그 다음 짧은 이름 우선
 * 2) 실패 시 강남 기본값으로 폴백.
 */
export function findDefaultBranch(chain: ChainKey, region?: string): Branch {
  return resolveBranch(chain, region).branch;
}

/**
 * 매칭 결과를 **성공 여부와 함께** 반환한다.
 *
 * `matched: false` = 사용자가 지역을 말했는데 그 체인엔 해당 지점이 없다는 뜻이다(예: 롯데시네마는
 * 강남·신촌에 지점이 없다). 예전엔 이 경우에도 조용히 기본 지점(가산디지털)을 돌려줘서, 사용자가
 * "강남 상영표"를 물었는데 가산디지털 회차가 카드와 movieContext에 섞여 들어갔다(DEV_260801 §3-3).
 * 호출부가 이 플래그를 보고 "이 지역엔 지점이 없습니다"로 안내할 수 있게 한다.
 *
 * 지역을 아예 말하지 않은 경우(region 없음)는 matched=false 지만 기본 지점을 그대로 쓴다 —
 * 그건 실패가 아니라 "기본값 사용"이다. 두 경우는 regionGiven 으로 구분한다.
 */
export function resolveBranch(chain: ChainKey, region?: string): { branch: Branch; matched: boolean; regionGiven: boolean } {
  const list = flatBranches(chain);
  const fallback = list.find((b) => b.code === DEFAULT_CODES[chain]) || list[0] || { code: '', nm: '' };
  const q = (region || '').trim();
  if (!q) return { branch: fallback, matched: false, regionGiven: false };
  // 공백/시·구 접미사 제거한 코어 키워드들로 후보 탐색
  const cores = q.replace(/[시군구동읍면]\s*$/g, '').split(/\s+/).filter(Boolean);
  // 별칭은 원 질의 뒤에 붙인다 — 원 질의로 직접 잡히면 그게 항상 우선.
  const aliases = [q, ...cores].flatMap((k) => REGION_ALIASES[k] ?? []);
  const keys = [...new Set([q, ...cores, ...aliases])].filter((k) => k.length >= 2);
  for (const k of keys) {
    const hits = list.filter((b) => b.nm.includes(k));
    // 정렬 ①: 질의로 **시작하는** 지점을 먼저. 예전엔 "짧은 이름 우선"만 봐서 "광주"(광주광역시)가
    // 4자인 **경기광주**(경기도)를 골랐다 — 광주금남로·광주상무를 두고 다른 도시를 준 셈(DEV_260801 §3-3).
    // 정렬 ②: 그 다음 짧은 이름 우선(= 그 지역의 대표 지점일 확률이 높음).
    if (hits.length) {
      const branch = hits.sort((a, b) =>
        (Number(!a.nm.startsWith(k)) - Number(!b.nm.startsWith(k))) || (a.nm.length - b.nm.length)
      )[0];
      return { branch, matched: true, regionGiven: true };
    }
  }
  return { branch: fallback, matched: false, regionGiven: true };
}

/**
 * 지점 공식 페이지 URL.
 * 롯데·메가박스는 지점 딥링크(HTTP 200 확인). CGV 신규 SPA는 siteNo 쿼리를 무시해
 * 지점 딥링크가 불가 → 극장별 예매 공통 페이지로 연결.
 */
export function branchUrl(chain: ChainKey, code: string): string {
  if (chain === 'cgv') return 'https://cgv.co.kr/cnm/movieBook/cinema';
  if (chain === 'lotte') {
    const [d, dd, id] = code.split('|');
    return `https://www.lottecinema.co.kr/NLCHS/Cinema/Detail?divisionCode=${d}&detailDivisionCode=${dd}&cinemaID=${id}`;
  }
  if (chain === 'mega') return `https://www.megabox.co.kr/theater?brchNo=${code}`;
  return '';
}

/**
 * 세 체인 모두에 대한 기본 지점 묶음 (movie-tool 결과 payload용).
 *
 * 사용자가 지역을 말했는데 그 체인에 해당 지점이 없으면 **null** 을 넣는다 — 카드가 "이 지역엔
 * 지점이 없습니다"로 표시하고 상영표 조회도 건너뛰게 하기 위해서다. 예전처럼 무관한 기본 지점
 * (가산디지털)을 채우면 사용자는 다른 동네 시간표를 자기 지역 것으로 읽는다(DEV_260801 §3-3).
 * 지역을 말하지 않았으면 종전대로 기본 지점을 채운다.
 */
export function defaultsForRegion(region?: string): Record<ChainKey, Branch | null> {
  const pick = (chain: ChainKey): Branch | null => {
    const r = resolveBranch(chain, region);
    return (r.regionGiven && !r.matched) ? null : r.branch;
  };
  return { cgv: pick('cgv'), lotte: pick('lotte'), mega: pick('mega') };
}

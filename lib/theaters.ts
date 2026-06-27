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
 * 지역 키워드(예: "강남", "홍대", "노원")로 체인별 최적 지점을 찾음.
 * 1) 지점명에 키워드 포함(부분일치, 가장 짧은 이름 우선=가장 일반적인 지점)
 * 2) 실패 시 강남 기본값으로 폴백.
 */
export function findDefaultBranch(chain: ChainKey, region?: string): Branch {
  const list = flatBranches(chain);
  const fallback = list.find((b) => b.code === DEFAULT_CODES[chain]) || list[0] || { code: '', nm: '' };
  const q = (region || '').trim();
  if (!q) return fallback;
  // 공백/시·구 접미사 제거한 코어 키워드들로 후보 탐색
  const cores = q.replace(/[시군구동읍면]\s*$/g, '').split(/\s+/).filter(Boolean);
  const keys = [q, ...cores].filter((k) => k.length >= 2);
  for (const k of keys) {
    const hits = list.filter((b) => b.nm.includes(k));
    if (hits.length) return hits.sort((a, b) => a.nm.length - b.nm.length)[0];
  }
  return fallback;
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

/** 세 체인 모두에 대한 기본 지점 묶음 (movie-tool 결과 payload용) */
export function defaultsForRegion(region?: string): Record<ChainKey, Branch> {
  return {
    cgv: findDefaultBranch('cgv', region),
    lotte: findDefaultBranch('lotte', region),
    mega: findDefaultBranch('mega', region),
  };
}

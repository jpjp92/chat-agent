/**
 * 출처 성격 분류 — 출처 사이트가 어떤 종류인지일 뿐, 차트 수치가 맞는지 확인한 것이 아니다.
 * 계획: docs/plans/PLAN_CHART_SOURCE_261106.md §5-3
 *
 * 입력은 grounding 출처의 title. uri 는 Google redirect 라 쓰지 않는다(따라가면 출처마다 HTTP 요청이 생긴다).
 * 불확실하면 'other' — "신뢰 낮음"이 아니라 "분류 안 됨" 이라 잘못 고르는 비용이 작다.
 */
export type SourceKind = 'official' | 'secondary' | 'other';

// 접미사는 점 경계로만 맞춘다 — `.go.kr` 이 `evilgo.kr` 에 맞으면 안 된다
const OFFICIAL_SUFFIXES = ['go.kr', 'gov', 'gov.uk', 'gc.ca', 'gov.au', 'go.jp', 'europa.eu', 'int'];
// 정부 도메인이 아닌 중앙은행·통계기관·거래소·국제기구
const OFFICIAL_HOSTS = ['bok.or.kr', 'kosis.kr', 'korea.kr', 'krx.co.kr', 'stlouisfed.org', 'imf.org', 'worldbank.org',
    'oecd.org', 'un.org', 'bis.org', 'boj.or.jp', 'ons.gov.uk',
    // 서울외국환중개 — 원/달러 매매기준율을 공시하는 지정 중개기관
    'smbs.biz'];
// 언론·위키·민간 리서치·데이터 집계 — 목록이라 처음 보는 언론사는 other 로 떨어진다([turn] sourceKinds 로 보강)
const SECONDARY_HOSTS = ['chosun.com', 'joongang.co.kr', 'donga.com', 'hani.co.kr', 'khan.co.kr', 'hankyung.com', 'mk.co.kr',
    'mt.co.kr', 'sedaily.com', 'edaily.co.kr', 'newspim.com', 'yna.co.kr', 'yonhapnewstv.co.kr', 'einfomax.co.kr',
    'busan.com', 'imaeil.com', 'ikbc.co.kr', 'kbs.co.kr', 'imbc.com', 'sbs.co.kr', 'ytn.co.kr', 'jtbc.co.kr', 'hankookilbo.com',
    'reuters.com', 'bloomberg.com', 'apnews.com', 'bbc.co.uk', 'bbc.com', 'nytimes.com', 'wsj.com', 'ft.com', 'cnbc.com',
    'wikipedia.org', 'investing.com', 'tradingeconomics.com', 'worldometers.info', 'statista.com', 'ycharts.com',
    'macrotrends.net', 'ourworldindata.org', 'kita.net', 'kdi.re.kr', 'kihasa.re.kr'];

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const endsAt = (host: string, base: string) => host === base || host.endsWith(`.${base}`);

export const sourceKindOf = (title: unknown): SourceKind => {
    if (typeof title !== 'string') return 'other';
    const host = title.trim().toLowerCase().replace(/^www\./, '');
    if (!HOST_RE.test(host)) return 'other';
    if (OFFICIAL_SUFFIXES.some(s => endsAt(host, s)) || OFFICIAL_HOSTS.some(h => endsAt(host, h))) return 'official';
    if (SECONDARY_HOSTS.some(h => endsAt(host, h))) return 'secondary';
    return 'other';
};

export const countSourceKinds = (sources: ReadonlyArray<{ title?: unknown }> | undefined): Record<SourceKind, number> => {
    const out: Record<SourceKind, number> = { official: 0, secondary: 0, other: 0 };
    for (const s of sources ?? []) out[sourceKindOf(s?.title)] += 1;
    return out;
};

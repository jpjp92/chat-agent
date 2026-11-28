import 'server-only';

const SEARCH_URL = 'https://www.pharm.or.kr/search/drugidfy/list.asp';

/**
 * 검색 키 — 두 면의 각인을 **토큰으로 쪼개** 영문·숫자가 가장 긴 것.
 * 비전은 한 면에 "UU CFX" 처럼 로고 오독 + 문자 각인을 붙여 내기도 한다 → 통째로 쓰면 "UUCFX" 로 0건이었다(11-28).
 * 로고를 글자로 오독한 토큰(예: 위더스 로고 → "UU")은 대개 짧다.
 */
function imprintTokens(...faces: (string | null | undefined)[]): string[] {
    return faces
        .flatMap(f => String(f ?? '').split(/[\s/|,·]+/))
        .map(t => t.trim())
        .filter(t => /[a-zA-Z0-9]/.test(t) && !/^(null|undefined|없음|none|마크)$/i.test(t))
        .sort((a, b) => b.replace(/[^a-zA-Z0-9]/g, '').length - a.replace(/[^a-zA-Z0-9]/g, '').length);
}
function searchKey(front: string, back?: string): string {
    return imprintTokens(front, back)[0] ?? '';
}

const PHARM_MAX_PAGES = 5;
// "포함" 검색은 사이트가 느린 질의가 있다(TYLENOL 12~13s, CFX ~1s — 11-28 실측). 4s 에서 끊고,
// 빠른 "시작" 검색(~0.7s)을 같이 돌려 둘 중 온 것을 합친다 — 느려도 예전("시작"만)보다 나빠지지 않는다.
const CONTAINS_TIMEOUT_MS = 4_000;

/** 한 질의의 전 페이지 — "포함" 1페이지에서 마지막 페이지를 읽고 나머지를 **병렬**로. "시작" 1페이지도 동시에. */
async function fetchAllPages(q: string): Promise<any[]> {
    const containsAll = (async () => {
        const first = await fetchPage(q, 1, '0', CONTAINS_TIMEOUT_MS);
        const pages = Math.min(first.lastPage, PHARM_MAX_PAGES);
        const rest = await Promise.allSettled(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(q, i + 2, '0', CONTAINS_TIMEOUT_MS)));
        return [...first.rows, ...rest.flatMap(r => (r.status === 'fulfilled' ? r.value.rows : []))];
    })();
    const [contains, startsWith] = await Promise.allSettled([containsAll, fetchPage(q, 1, '2')]);
    return [
        ...(contains.status === 'fulfilled' ? contains.value : []),
        ...(startsWith.status === 'fulfilled' ? startsWith.value.rows : []),
    ];
}

export async function searchPill(criteria: { imprint_front: string, imprint_back?: string, color?: string, shape?: string, form?: string }) {
    const { imprint_front, imprint_back, color, shape, form } = criteria;

    try {
        const key = searchKey(imprint_front, imprint_back);
        const normalized = key.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
        const preservedCase = key.replace(/[^a-zA-Z0-9]/g, '');
        const queries = new Set<string>([normalized, preservedCase].filter(Boolean));
        // 2자 각인 → 가운데 글자 삽입 변형(로고 "dHP" 를 "d-P" 로 읽은 경우), 3자 → 가운데 글자 제거
        if (normalized.length === 2) ['H', 'P', 'A', 'M'].forEach(ch => queries.add(normalized[0] + ch + normalized[1]));
        if (normalized.length === 3) {
            queries.add(normalized[0] + normalized[2]);
            if (preservedCase.length === 3) queries.add(preservedCase[0] + preservedCase[2]);
        }

        // 질의 변형도 병렬 — 지연 원칙(PLAN_PILL_IDENTIFY_261128 §1)
        const settled = await Promise.allSettled([...queries].map(fetchAllPages));
        const allResultsMap = new Map();
        settled.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(item => { if (item.idx) allResultsMap.set(item.idx, item); }); });

        // 나머지 토큰(다른 면·로고 오독)은 뒷면 조건으로만 — 정렬 가산점용, exact 판정에선 그대로 엄격
        const others = imprintTokens(imprint_front, imprint_back).slice(1).join(' ');
        return filterResults(Array.from(allResultsMap.values()), { imprint_front: key, imprint_back: others, color, shape, form });
    } catch (error) {
        console.error('[Pill Logic] Search failed:', error);
        throw error;
    }
}

async function fetchPage(imprint: string, page: number, flag: '0' | '2' = '0', timeoutMs = 6000): Promise<{ rows: any[]; lastPage: number }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // 각인은 그대로 쓴다 — 원하는 질의 형태(대문자 정규화 또는 대소문자 보존)는
    // 호출부가 정해서 넘긴다. pharm.or.kr 은 대소문자를 구분할 수 있다.
    const normalizedQuery = imprint;

    const body = new URLSearchParams({
        s_anal: normalizedQuery,
        // 0=포함, 2=시작. 전엔 2 만 써서 "HLB CFX"·"마크 CFX" 처럼 앞에 다른 표시가 붙은 품목이 전부 빠졌다(11-28, CFX 5건 → 포함 26건)
        s_anal_flag: flag,
        _page: page.toString(),
        s_drug_name: '',
        s_upso_name: '',
        s_upso_name2: '',
        s_mark_code: '',
        s_drug_form_etc: '',
        s_drug_shape_etc: '',
        new_sb_name1: '',
        new_sb_name2: '',
    });

    try {
        const res = await fetch(SEARCH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Referer': 'https://www.pharm.or.kr/search/drugidfy/search.asp',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
            body: body.toString(),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!res.ok) { console.warn('[Pill Logic] 약학정보원 HTTP', res.status); return { rows: [], lastPage: 0 }; }

        const html = await res.text();
        if (!html.includes('change_bgcolor')) {
            // 결과 없음 페이지엔 안내 문구가 없다(행만 빠진 같은 화면). 검색 폼(s_anal)이 있으면 정상 0건,
            // 폼마저 없으면 구조 변경 가능성 — 0건과 구분해 남긴다
            if (!html.includes('name="s_anal"')) console.warn('[Pill Logic] 약학정보원 파싱 실패(검색 화면 아님)', html.length);
            return { rows: [], lastPage: 0 };
        }

        const pageNums = [...html.matchAll(/go_page\('search_form',\s*(\d+)\)/g)].map(m => Number(m[1]));
        return { rows: parseDrugRows(html), lastPage: Math.max(page, ...pageNums) };
    } catch (e: any) {
        clearTimeout(timeoutId);
        console.warn('[Pill Logic] 약학정보원 요청 실패', e?.name === 'AbortError' ? 'timeout' : e?.message);
        return { rows: [], lastPage: 0 };
    }
}

function parseDrugRows(html: string) {
    const results: any[] = [];
    const rowBlocks = html.split(/<tr\s+onmouseover="change_bgcolor/i).slice(1);

    for (const block of rowBlocks) {
        const row = '<tr onmouseover="change_bgcolor' + block;
        const entry: any = {
            idx: extractIdx(row),
            front_imprint: extractImprint(row, '앞'),
            back_imprint: extractImprint(row, '뒤'),
            shape: extractFieldByComment(row, '제형', '색깔'),
            color: extractFieldByComment(row, '색깔', '품목명'),
            product_name: extractProductName(row),
            company: extractCompany(row),
            thumbnail: extractThumbnail(row),
            mark_image: extractMarkImage(imprintCell(row, '앞')) ?? extractMarkImage(imprintCell(row, '뒤')),
        };

        entry.detail_url = entry.idx
            ? `https://www.pharm.or.kr/search/drugidfy/show.asp?idx=${entry.idx}`
            : null;

        if (entry.product_name || entry.front_imprint) {
            results.push(entry);
        }
    }
    return results;
}

function extractIdx(row: string) {
    const m = row.match(/show\.asp\?idx=(\d+)/);
    return m ? m[1] : null;
}

function imprintCell(row: string, side: string): string {
    const pattern = new RegExp(
        `<!--표시\\(${side}\\)[\\s\\S]*?-->[\\s\\S]*?<td>([\\s\\S]*?)<\\/td>`, 'i'
    );
    return row.match(pattern)?.[1] ?? '';
}

function extractImprint(row: string, side: string) {
    const cell = imprintCell(row, side);
    if (!cell) return '';
    const text = stripHtml(cell).replace(/\s+/g, ' ').trim();
    // 제조사 로고는 <img …/mark/…> 로 들어 있어 stripHtml 이 지웠다 → "마크" 로 남긴다(식약처 표기와 같다, 예: "마크 CFX")
    return extractMarkImage(cell) ? `마크 ${text}`.trim() : text;
}

/** 각인 칸의 제조사 로고 이미지 주소 — 같은 문자 각인(CFX) 후보를 로고로 구분하게 표에 보인다(G13). */
function extractMarkImage(cellOrRow: string): string | null {
    const m = cellOrRow.match(/<img src='([^']*\/mark\/[^']+)'/i) ?? cellOrRow.match(/<img src="([^"]*\/mark\/[^"]+)"/i);
    if (!m) return null;
    return m[1].replace('/sb_photo/MFDS/../mark/', '/sb_photo/mark/');
}

function extractFieldByComment(row: string, startComment: string, endComment: string) {
    const pattern = new RegExp(
        `<!--\\s*${startComment}\\s*-->[\\s\\S]*?<td[^>]*>([\\s\\S]*?)<\\/td>[\\s\\S]*?<!--\\s*${endComment}`, 'i'
    );
    const m = row.match(pattern);
    if (!m) return '';
    const lines = m[1]
        .replace(/<br\s*\/?>/gi, '|')
        .split('|')
        .map(l => stripHtml(l).trim())
        .filter(Boolean);
    return [...new Set(lines)].join(' / ');
}

function extractProductName(row: string) {
    const m = row.match(/<!--품목명[\s\S]*?-->([\s\S]*?)<!--신청사/i);
    if (!m) return '';
    return stripHtml(m[1]).replace(/\s+/g, ' ').trim();
}

function extractCompany(row: string) {
    const m = row.match(/<!--신청사[\s\S]*?-->([\s\S]*?)<\/td>/i);
    if (!m) return '';
    return stripHtml(m[1]).replace(/\s+/g, ' ').trim();
}

function extractThumbnail(row: string) {
    const m = row.match(/img src="(https:\/\/common\.health\.kr\/shared\/images\/sb_photo[^"]+_s\.jpg)"/i);
    return m ? m[1] : null;
}

function stripHtml(html: string) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

function filterResults(results: any[], criteria: { imprint_front: string, imprint_back?: string, color?: string, shape?: string, form?: string }) {
    const { imprint_front, imprint_back, color, shape, form } = criteria;
    const normalize = (s: string) => {
        if (!s) return '';
        const lower = s.toLowerCase();
        if (lower === 'null' || lower === 'undefined' || lower === '없음' || lower === 'none' || lower === '-') return '';
        return lower.replace(/[^a-z0-9]/g, '').toUpperCase();
    };

    const contains = (target: string, query: string) => {
        if (!query) return true;
        const q = query.toLowerCase();
        if (q === 'null' || q === 'undefined' || q === '기타') return true;

        const t = (target || '').toLowerCase();

        // 색상 유사 계열 매핑 (노랑/황색/주황 동일 계열)
        if (q.includes('노랑') || q.includes('yellow') || q.includes('황색')) return t.includes('노랑') || t.includes('황색') || t.includes('주황');
        if (q.includes('주황') || q.includes('orange')) return t.includes('주황') || t.includes('노랑') || t.includes('황색');
        if (q.includes('하양') || q.includes('white') || q.includes('백색')) return t.includes('하양') || t.includes('백색');
        if (q.includes('분홍') || q.includes('pink') || q.includes('적색')) return t.includes('분홍') || t.includes('적색');
        if (q.includes('연두') || q.includes('light green')) return t.includes('연두') || t.includes('초록');

        // 모양 유사 매핑 (원형 ↔ 타원형 양방향)
        if (q.includes('원형') || q.includes('타원형') || q.includes('장방형')) {
            return t.includes('원형') || t.includes('타원형') || t.includes('장방형');
        }
        if (q.includes('capsule') || q.includes('캐시')) return t.includes('캐시') || t.includes('장방형');

        // 양방향 포함 체크 (t에 q가 있거나, q에 t가 있으면 유사)
        return t.includes(q) || q.includes(t);
    };

    const normTarget = normalize(imprint_front);
    const normBackTarget = normalize(imprint_back || '');


    // 1단계: 완전 일치 (각인 + 색상 + 모양)
    const exactMatches = results.filter(r => {
        const frontMatch = normalize(r.front_imprint) === normTarget;
        const backMatch = normBackTarget ? normalize(r.back_imprint) === normBackTarget : true;
        const colorMatch = contains(r.color, color || '');
        const shapeMatch = contains(r.shape, shape || '');
        return frontMatch && backMatch && colorMatch && shapeMatch;
    });
    // exact 는 1건일 때만 — "포함" 검색 뒤엔 같은 각인·색·모양 품목이 여럿일 수 있다(CFX 주황 캡슐: 위더스·동구·바이넥스…). 여럿이면 후보 표로.
    if (exactMatches.length === 1) return { match_type: 'exact', filteredResults: exactMatches };
    if (exactMatches.length > 1) return { match_type: 'imprint_only', filteredResults: exactMatches.slice(0, 5) };

    // 1단계-b: 각인 완전 일치 — 색상/모양 불일치 허용
    // pharm.or.kr에 각인 데이터가 없는 약품(예: 마그네스정)은 imprint 검색으로 찾을 수 없음.
    // 이 경우 각인이 동일하게 등록된 다른 약품(색상/모양이 달라도)을 후보로 표시.
    const imprintExactOnly = results.filter(r => {
        const frontMatch = normalize(r.front_imprint) === normTarget;
        const backMatch = normBackTarget ? normalize(r.back_imprint) === normBackTarget : true;
        return frontMatch && backMatch;
    });
    if (imprintExactOnly.length > 0) return { match_type: 'imprint_only', filteredResults: imprintExactOnly.slice(0, 5) };

    // 2단계: 각인 포함 일치 (최소 3글자 — 2자(예: "DP")는 너무 짧아 오탐). 앞·뒷면 어느 쪽에 있어도 본다.
    // "포함" 검색이라 같은 문자 각인 품목이 수십 개 온다(CFX 26건) → 상위 5개 안에 맞는 것이 들도록 점수로 정렬:
    //   제형(캡슐/정제) 일치 > 면 각인이 키와 정확히 같음 > 색상 일치 > 다른 면 일치.
    //   제형을 맨 앞에 — 정확 일치를 앞세우면 "PL / CFX" 하양 정제가 "HLB CFX" 주황 캡슐보다 위로 왔다.
    if (normTarget.length >= 3) {
        const faceHas = (r: any) => [r.front_imprint, r.back_imprint].map(normalize).some(t => t === normTarget || (t.length >= 3 && (t.includes(normTarget) || normTarget.includes(t))));
        const imprintMatches = results.filter(faceHas);
        if (imprintMatches.length > 0) {
            const wantCapsule = form ? form.includes('캡슐') : null;
            const score = (r: any) => {
                const faces = [r.front_imprint, r.back_imprint].map(normalize);
                let sc = 0;
                if (wantCapsule !== null && /캡슐/.test(r.shape || '') === wantCapsule) sc += 8;
                if (faces.includes(normTarget)) sc += 4;
                if (color && contains(r.color, color)) sc += 2;
                if (normBackTarget && faces.includes(normBackTarget)) sc += 1;
                return sc;
            };
            imprintMatches.sort((a, b) => score(b) - score(a));
            return { match_type: 'imprint_only', filteredResults: imprintMatches.slice(0, 5) };
        }
    }

    // 2단계-b: Vision 오독 변형 각인 매칭 (2자 정규화 각인 전용)
    // Vision이 "dP" 같은 2자 로고를 "d-P" 처럼 읽어 normalize 후 2자가 됐을 때만 적용.
    // 3자 이상(예: "DHP")에 적용하면 "DAHP" 같은 무관한 약품이 false positive로 매칭됨.
    if (normTarget.length === 2) {
        const mid = Math.floor(normTarget.length / 2);
        const targetVariants = new Set(
            ['H', 'P', 'A', 'M', 'I', 'O', 'T', 'C'].map(ch => normTarget.slice(0, mid) + ch + normTarget.slice(mid))
        );
        const variantMatches = results.filter(r => targetVariants.has(normalize(r.front_imprint)));
        if (variantMatches.length > 0) {
            const refined = variantMatches.filter(r => contains(r.color, color || '') && contains(r.shape, shape || ''));
            return { match_type: 'imprint_only', filteredResults: (refined.length > 0 ? refined : variantMatches).slice(0, 5) };
        }
    }

    // 3단계: 색상 + 모양 기반 유사 품목 (각인 무관)
    const isTabletShape = shape && (shape.includes('원형') || shape.includes('타원형') || shape.includes('장방형') || shape.includes('사각형'));
    const similarMatches = results.filter(r => {
        const colorMatch = contains(r.color, color || '');
        const shapeMatch = contains(r.shape, shape || '');
        // 정제(타블렛)를 찾는 경우 캡슐 제형 제외
        if (isTabletShape && r.shape && (r.shape.includes('경질캡슐') || r.shape.includes('연질캡슐'))) return false;
        return colorMatch && shapeMatch;
    });
    if (similarMatches.length > 0) return { match_type: 'similar', filteredResults: similarMatches.slice(0, 5) };

    return { match_type: 'none', filteredResults: [] };
}

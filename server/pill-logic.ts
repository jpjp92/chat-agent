import 'server-only';

const SEARCH_URL = 'https://www.pharm.or.kr/search/drugidfy/list.asp';

export async function searchPill(criteria: { imprint_front: string, imprint_back?: string, color?: string, shape?: string }) {
    const { imprint_front, imprint_back, color, shape } = criteria;

    try {
        const allResultsMap = new Map();

        // 1차 검색: 대문자 정규화 + 대소문자 보존 버전 모두 검색
        // pharm.or.kr이 대소문자 구분 검색인 경우 "dP"와 "DP"가 다른 결과를 반환함
        // 예: 마그네스정(동화약품) → 각인 "dP", 검색어 "DP"로는 누락될 수 있음
        const normalized = (imprint_front || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase(); // "DP"
        const preservedCase = (imprint_front || '').replace(/[^a-zA-Z0-9]/g, '');             // "dP"
        const primaryQueries = new Set<string>([normalized, preservedCase].filter(Boolean));

        for (const q of primaryQueries) {
            const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(page => fetchPage(q, page)));
            settled.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(item => { if (item.idx) allResultsMap.set(item.idx, item); }); });
        }

        // 2차 검색: 2자 정규화 각인 → 중간 문자 삽입 변형 검색 (예: "DP" → "DHP", "DAP"...)
        // Vision이 "dHP" 같은 3자 로고를 "d-P"(normalize→"DP")로 오독한 경우 복원
        if (normalized.length === 2) {
            const variants = ['H', 'P', 'A', 'M'].map(ch => normalized[0] + ch + normalized[1]);
            for (const v of variants) {
                const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(page => fetchPage(v, page)));
                settled.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(item => { if (item.idx) allResultsMap.set(item.idx, item); }); });
            }
        }

        // 3차 검색: 3자 정규화 각인 → 중간 문자 제거 역방향 검색 (예: "DHP" → "DP", "dHP" → "dP")
        // Vision이 "dP" 같은 2자 로고에 없는 문자를 삽입해 "dHP"로 오독한 경우 복원
        if (normalized.length === 3) {
            const shortened = normalized[0] + normalized[2];           // 중간 문자 제거: "DHP" → "DP"
            const preservedShortened = preservedCase[0] + (preservedCase[2] ?? ''); // "dHP" → "dP"
            for (const q of new Set([shortened, preservedShortened].filter(Boolean))) {
                const settled = await Promise.allSettled([1, 2, 3, 4, 5].map(page => fetchPage(q, page)));
                settled.forEach(r => { if (r.status === 'fulfilled') r.value.forEach(item => { if (item.idx) allResultsMap.set(item.idx, item); }); });
            }
        }

        const results = Array.from(allResultsMap.values());

        return filterResults(results, { imprint_front, imprint_back, color, shape });
    } catch (error) {
        console.error('[Pill Logic] Search failed:', error);
        throw error;
    }
}

async function fetchPage(imprint: string, page: number): Promise<any[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    // Use imprint as-is — caller is responsible for passing the desired query form
    // (uppercase normalized OR case-preserved). pharm.or.kr may be case-sensitive.
    const normalizedQuery = imprint;

    const body = new URLSearchParams({
        s_anal: normalizedQuery,
        s_anal_flag: normalizedQuery ? '2' : '0',
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
        if (!res.ok) return [];

        const html = await res.text();
        if (html.includes('검색결과가 없') || !html.includes('change_bgcolor')) {
            return [];
        }

        return parseDrugRows(html);
    } catch (e) {
        clearTimeout(timeoutId);
        return [];
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

function extractImprint(row: string, side: string) {
    const pattern = new RegExp(
        `<!--표시\\(${side}\\)[\\s\\S]*?-->[\\s\\S]*?<td>([\\s\\S]*?)<\\/td>`, 'i'
    );
    const m = row.match(pattern);
    if (!m) return '';
    return stripHtml(m[1]).replace(/\s+/g, ' ').trim();
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

function filterResults(results: any[], criteria: { imprint_front: string, imprint_back?: string, color?: string, shape?: string }) {
    const { imprint_front, imprint_back, color, shape } = criteria;
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
    if (exactMatches.length > 0) return { match_type: 'exact', filteredResults: exactMatches.slice(0, 3) };

    // 1단계-b: 각인 완전 일치 — 색상/모양 불일치 허용
    // pharm.or.kr에 각인 데이터가 없는 약품(예: 마그네스정)은 imprint 검색으로 찾을 수 없음.
    // 이 경우 각인이 동일하게 등록된 다른 약품(색상/모양이 달라도)을 후보로 표시.
    const imprintExactOnly = results.filter(r => {
        const frontMatch = normalize(r.front_imprint) === normTarget;
        const backMatch = normBackTarget ? normalize(r.back_imprint) === normBackTarget : true;
        return frontMatch && backMatch;
    });
    if (imprintExactOnly.length > 0) return { match_type: 'imprint_only', filteredResults: imprintExactOnly.slice(0, 5) };

    // 2단계: 각인 포함 일치 (최소 3글자 이상 — 2자 정규화 각인(예: "DP")은 너무 짧아 오탐 발생)
    if (normTarget.length >= 3) {
        const imprintMatches = results.filter(r => {
            const target = normalize(r.front_imprint);
            const frontIncludes = (normTarget.length >= 3 && target.includes(normTarget)) || (target.length >= 3 && normTarget.includes(target));
            return target === normTarget || frontIncludes;
        });
        // 뒷면 각인까지 일치하는 것을 우선 정렬
        if (imprintMatches.length > 0) {
            imprintMatches.sort((a, b) => {
                const aBackMatch = normBackTarget && normalize(a.back_imprint) === normBackTarget ? 0 : 1;
                const bBackMatch = normBackTarget && normalize(b.back_imprint) === normBackTarget ? 0 : 1;
                return aBackMatch - bBackMatch;
            });
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

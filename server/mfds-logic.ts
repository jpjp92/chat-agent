import 'server-only';
import { supabase } from './supabase';
import { matchesEachFace } from './pill-face-match';

const MFDS_DETAIL_URL = (itemSeq: string) =>
    `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${itemSeq}`;

// pill-logic.ts와 동일한 정규화 함수
const normalize = (s: string) =>
    (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

// Vision이 추출한 각인의 모든 검색 후보 생성
// "d-P" → ["DP", "dP", "DHP", "DAP", ...]
function buildSearchCodes(imprint: string): string[] {
    const upper = normalize(imprint);           // "DP"
    const preserved = imprint.replace(/[^a-zA-Z0-9]/g, ''); // "dP"

    const codes = new Set<string>([upper, preserved.toUpperCase()].filter(Boolean));

    // 2자 → 중간 문자 삽입 변형 (Vision이 dHP를 d-P로 읽은 경우 복원)
    if (upper.length === 2) {
        for (const ch of ['H', 'P', 'A', 'M']) {
            codes.add(upper[0] + ch + upper[1]);
        }
    }

    // 3자 → 중간 문자 제거 (Vision이 dP를 dHP로 읽은 경우 복원)
    if (upper.length === 3) {
        codes.add(upper[0] + upper[2]);
    }

    return [...codes].filter(Boolean);
}

// 색상 유사 매핑 (pill-logic.ts와 동일 기준)
const COLOR_ALIASES: Record<string, string[]> = {
    '노랑': ['노랑', '황색'],
    '주황': ['주황', '노랑', '황색'],
    '하양': ['하양', '백색'],
    '분홍': ['분홍', '적색'],
    '연두': ['연두', '초록'],
};

function normalizeColor(color: string): string[] {
    const c = (color || '').trim();
    for (const aliases of Object.values(COLOR_ALIASES)) {
        if (aliases.some(a => c.includes(a))) return aliases;
    }
    return [c];
}

// 모양 유사 매핑 — 원형(round)과 장방형/타원형(oblong)은 육안으로 구분 가능하므로 분리
const SHAPE_ALIASES: Record<string, string[]> = {
    '장방형':  ['장방형', '타원형'],  // 직사각형 모서리 둥근 것과 타원은 유사
    '타원형':  ['타원형', '장방형'],
    '원형':    ['원형'],
    '삼각형':  ['삼각형'],
    '사각형':  ['사각형', '마름모형'],
    '마름모형': ['마름모형', '사각형'],
    '오각형':  ['오각형'],
    '육각형':  ['육각형'],
    '팔각형':  ['팔각형'],
};

function normalizeShape(shape: string): string[] {
    const s = (shape || '').trim();
    for (const [key, aliases] of Object.entries(SHAPE_ALIASES)) {
        if (s.includes(key)) return aliases;
    }
    return [s];
}

interface MfdsResult {
    match_type: 'exact' | 'imprint_only' | 'similar' | 'none';
    results: MfdsDrug[];
}

interface MfdsDrug {
    item_seq: string;
    item_name: string;
    entp_name: string;
    mark_codes: string[];
    color_class1: string | null;
    drug_shape: string | null;
    form_code_name: string | null;
    chart: string | null;
    item_image: string | null;
    detail_url: string;
}

/**
 * 쿼리 실패를 **삼키지 않는다.**
 *
 * `const { data } = await …` 로 `error` 를 버리면 **테이블 없음이 "결과 0건"과 같은 값**이 되어
 * 조용히 `match_type:'none'` → 2순위 스크래핑 폴백으로 내려가고, 그마저 실패하면 모델이 지어낸다 → DEV_260817
 *
 * 실패를 로그로 드러내되 **동작은 바꾸지 않는다** — 폴백은 그대로 타는 게 맞다.
 * 여기서 throw 하면 DB 장애가 곧 기능 장애가 된다. 원하는 건 **보이는 폴백**이다.
 */
const rows = <T>(stage: string, res: { data: T[] | null; error: { message: string; code?: string } | null }): T[] => {
    if (res.error) {
        console.error(`[mfds] ${stage} 쿼리 실패 — 스크래핑 폴백으로 내려간다:`, res.error.message, res.error.code ?? '');
        return [];
    }
    return res.data ?? [];
};

export async function searchMfdsPills(criteria: {
    imprint_front: string;
    imprint_back?: string;
    color?: string;
    shape?: string;
    form?: string;
}): Promise<MfdsResult> {
    const { imprint_front, imprint_back, color, shape, form } = criteria;

    // 면 전체 + 공백 토큰별 코드 — 비전이 한 면에 "UU CFX" 를 붙여 내면 통째 코드("UUCFX")만으론 못 찾는다(11-28)
    const faceCodes = (face?: string) => {
        if (!face) return [];
        const tokens = face.split(/[\s/|,·]+/).filter(t => /[a-zA-Z0-9]/.test(t));
        return [...new Set([...buildSearchCodes(face), ...(tokens.length > 1 ? tokens.flatMap(buildSearchCodes) : [])])];
    };
    const frontCodes = faceCodes(imprint_front);
    const backCodes = faceCodes(imprint_back);
    const uniqueCodes = [...new Set([...frontCodes, ...backCodes])];

    const colorList  = normalizeColor(color || '');
    const shapeList  = normalizeShape(shape || '');

    const select = 'item_seq, item_name, entp_name, mark_codes, color_class1, drug_shape, form_code_name, chart, item_image';

    // 1단계: 각인 + 색상 + 모양 완전 일치
    // exact는 결과가 정확히 1개일 때만 — 복수 후보는 imprint_only로 반환해 사용자가 선택
    const exact = rows('1단계(각인+색상+모양)', await supabase
        .from('mfds_pills')
        .select(select)
        .overlaps('mark_codes', uniqueCodes)
        .in('color_class1', colorList)
        .in('drug_shape', shapeList)
        .limit(20));

    // exact 는 읽은 면의 각인이 **각각** 행에 있을 때만(면별 대조). 한쪽만 맞으면 후보 표로.
    const faceMatched = exact.filter(r => matchesEachFace(r.mark_codes, frontCodes, backCodes));
    if (faceMatched.length === 1) {
        return { match_type: 'exact', results: faceMatched.map(toMfdsDrug) };
    }
    if (exact.length > 0) {
        const rest = exact.filter(r => !faceMatched.includes(r));
        const sorted = [...sortByRelevance(faceMatched, uniqueCodes), ...sortByRelevance(rest, uniqueCodes)];
        return { match_type: 'imprint_only', results: sorted.map(toMfdsDrug) };
    }

    // 2단계: 각인만 일치 (색상/모양 무관)
    const imprintOnly = rows('2단계(각인만)', await supabase
        .from('mfds_pills')
        .select(select)
        .overlaps('mark_codes', uniqueCodes)
        .limit(20));

    if (imprintOnly.length > 0) {
        const sorted = sortByRelevance(imprintOnly, uniqueCodes);
        return { match_type: 'imprint_only', results: sorted.map(toMfdsDrug) };
    }

    // 3단계: 색상 + 모양만 일치 (각인 무관 — 이미지로만 저장된 약품 대응)
    if (color || shape) {
        let q = supabase.from('mfds_pills').select(select);
        if (color)  q = q.in('color_class1', colorList);
        if (shape)  q = q.in('drug_shape', shapeList);
        // 제형으로 거른다 — 없으면 캡슐 사진에 정제 후보가 나왔다(11-28, 주황 캡슐 → 노랑 정제 5개). 추가 쿼리 없음.
        if (form?.includes('캡슐')) q = q.ilike('form_code_name', `%${form.includes('연질') ? '연질캡슐' : '경질캡슐'}%`);
        else if (form === '정제') q = q.not('form_code_name', 'ilike', '%캡슐%');
        const similar = rows('3단계(색상+모양)', await q.limit(5));

        if (similar.length > 0) {
            return { match_type: 'similar', results: similar.map(toMfdsDrug) };
        }
    }

    return { match_type: 'none', results: [] };
}

// 검색된 각인 코드와의 매칭 구체도로 정렬
// 1순위: mark_codes가 적을수록(더 구체적인 각인) 앞에
// 2순위: 검색 코드와 정확히 일치하는 코드가 있으면 앞에
function sortByRelevance(rows: any[], searchCodes: string[]): any[] {
    return [...rows].sort((a, b) => {
        const aLen = (a.mark_codes ?? []).length;
        const bLen = (b.mark_codes ?? []).length;
        if (aLen !== bLen) return aLen - bLen;
        // 검색 코드가 mark_codes에 직접 포함된 경우 우선
        const aHit = searchCodes.some(c => (a.mark_codes ?? []).includes(c)) ? 0 : 1;
        const bHit = searchCodes.some(c => (b.mark_codes ?? []).includes(c)) ? 0 : 1;
        return aHit - bHit;
    });
}

function toMfdsDrug(row: any): MfdsDrug {
    return {
        item_seq:      row.item_seq,
        item_name:     row.item_name,
        entp_name:     row.entp_name,
        mark_codes:    row.mark_codes ?? [],
        color_class1:  row.color_class1,
        drug_shape:    row.drug_shape,
        form_code_name: row.form_code_name,
        chart:         row.chart,
        item_image:    row.item_image,
        detail_url:    MFDS_DETAIL_URL(row.item_seq),
    };
}

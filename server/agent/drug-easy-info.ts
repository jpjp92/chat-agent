/**
 * 식약처 의약품개요정보(e약은요) — 일반의약품의 공식 용법·효능·주의사항 문장.
 *
 * 낱알식별 DB 에는 용법이 없어 약 카드 `dosage` 를 모델 기억으로 채웠다. 3.5 Flash-Lite 는 타이레놀
 * 1일 최대를 2,000mg 으로 썼다(공식 4 g) → PLAN_GEMINI_25_SHUTDOWN §10-3·§10-5.
 * 낱알식별과 같은 공공데이터 계정 키를 쓴다(11-24 실호출 확인, 별도 활용신청 불필요).
 * 전문의약품은 대상이 아니다 — 없으면 null 을 돌려 호출부가 설명서 안내로 내려간다.
 */

const EASY_DRUG_ENDPOINT = 'https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList';
// 낱알식별 조회 뒤에 한 번 더 부르는 보조 조회라 짧게 끊는다 — 실패해도 답은 나간다.
const EASY_DRUG_TIMEOUT_MS = 5000;
// 도구 결과는 모델 입력이다 — 주의사항 원문이 길어 항목마다 자른다.
const FIELD_MAX = 600;

export type EasyDrugInfo = { itemSeq: string; itemName: string; useMethod: string; efficacy: string; caution: string };

// 응답에 <p> 같은 태그·줄바꿈이 섞여 온다
const clean = (v: unknown): string => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const cut = (s: string) => (s.length > FIELD_MAX ? `${s.slice(0, FIELD_MAX)}…` : s);

const toInfo = (it: any): EasyDrugInfo | null => {
    const useMethod = clean(it?.useMethodQesitm);
    if (!useMethod) return null;
    return { itemSeq: String(it.itemSeq ?? ''), itemName: clean(it.itemName), useMethod: cut(useMethod), efficacy: cut(clean(it.efcyQesitm)), caution: cut(clean(it.atpnQesitm)) };
};

const query = async (params: Record<string, string>, key: string): Promise<any[]> => {
    const qs = new URLSearchParams({ type: 'json', numOfRows: '3', pageNo: '1', ...params });
    const res = await fetch(`${EASY_DRUG_ENDPOINT}?serviceKey=${key}&${qs}`, {
        signal: AbortSignal.timeout(EASY_DRUG_TIMEOUT_MS),
        headers: { 'User-Agent': 'curl/8.5.0', 'Referer': 'https://www.data.go.kr' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json: any = await res.json();
    const items = json?.body?.items;
    return Array.isArray(items) ? items : items?.item ? [].concat(items.item) : [];
};

/** 품목기준코드(낱알식별의 ITEM_SEQ)로 정확히 찾는다. 실패·미수록은 null. */
export const fetchEasyDrugBySeq = async (itemSeq: string, key = process.env.MFDS_API_KEY || ''): Promise<EasyDrugInfo | null> => {
    if (!itemSeq || !key) return null;
    try { return toInfo((await query({ itemSeq }, key))[0]); }
    catch (e: any) { console.warn('[EasyDrug] seq 조회 실패:', e?.name ?? 'error'); return null; }
};

/**
 * 제품명으로 찾는다 — 낱알식별에 없는 액제·시럽용. 이름이 정확히 같은 품목만 쓰고,
 * 없으면 첫 품목이 질의를 포함할 때만 쓴다(비슷한 다른 제품의 용법을 붙이지 않게).
 */
export const fetchEasyDrugByName = async (name: string, key = process.env.MFDS_API_KEY || ''): Promise<EasyDrugInfo | null> => {
    const q = name.replace(/\s/g, '');
    if (!q || !key) return null;
    try {
        const items = await query({ itemName: q }, key);
        const exact = items.find(it => clean(it?.itemName).replace(/\s/g, '').startsWith(q));
        return toInfo(exact ?? null);
    } catch (e: any) { console.warn('[EasyDrug] 이름 조회 실패:', e?.name ?? 'error'); return null; }
};

/** 도구 결과에 붙일 블록. 모델이 그대로 옮기도록 출처를 함께 적는다. */
export const formatEasyDrug = (info: EasyDrugInfo): string =>
    `용법(e약은요·식약처): ${info.useMethod}\n`
    + (info.efficacy ? `효능(e약은요·식약처): ${info.efficacy}\n` : '')
    + (info.caution ? `주의사항(e약은요·식약처): ${info.caution}\n` : '');

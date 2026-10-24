/**
 * 약 카드(```json:drug)의 URL 필드를 도구 결과 값으로 덮어쓴다 — 순수 함수. 검증: `npx tsx tests/test-drug-card-urls.mts`
 *
 * 약 카드는 다른 카드와 달리 모델이 JSON 을 직접 쓴다(산문과 효능 요약이 필요해서). URL 은 "그대로 옮기라"고만
 * 지시하는데, 퍼센트 인코딩된 긴 한글 검색어를 모델이 베끼다 깨뜨린다 — GPT 에서 `…%EB%A6%AC% הוא%EA…`,
 * `…밀리%그람` 이 나왔다(DEV_261024 §7). URL 은 도구가 이미 정확히 갖고 있으니 모델 출력을 믿지 않고 바꿔 넣는다.
 */

type Candidate = { name: string; image_url: string | null; mfds_url: string | null; connectdi_url: string | null };

const URL_FIELDS = ['image_url', 'mfds_url', 'connectdi_url'] as const;

const field = (block: string, label: string): string | null => {
    const m = block.match(new RegExp(`^${label}:\\s*(.*)$`, 'm'));
    const v = m?.[1]?.trim();
    return v && v !== 'null' ? v : null;
};

/** `[MFDS_DRUG_DATA]` 도구 출력에서 후보별 이름과 URL 을 뽑는다. */
export const parseDrugCandidates = (toolOutput: string): Candidate[] =>
    (toolOutput || '').split(/^== 후보 \d+ ==$/m).slice(1).map(block => ({
        name: field(block, '약품명\\(KO\\)') ?? '',
        image_url: field(block, '공식 이미지URL'),
        mfds_url: field(block, 'MFDS_DETAIL_URL'),
        connectdi_url: field(block, 'ConnectDI_URL'),
    })).filter(c => c.name);

const baseName = (s: string) => s.split('(')[0].replace(/\s+/g, '');

/** 카드가 가리키는 후보 — 후보가 하나면 그것, 여럿이면 mfds_url 일치 → 이름 일치 순. 못 고르면 null(손대지 않는다). */
const pickCandidate = (card: any, cands: Candidate[]): Candidate | null => {
    if (cands.length === 1) return cands[0];
    const byUrl = cands.find(c => c.mfds_url && c.mfds_url === card?.mfds_url);
    if (byUrl) return byUrl;
    const name = typeof card?.name === 'string' ? baseName(card.name) : '';
    if (!name) return null;
    return cands.find(c => baseName(c.name) === name) ?? null;
};

export const repairDrugCardUrls = (text: string, toolOutput: string): string => {
    if (!text || !/```json:drug/.test(text)) return text;
    const cands = parseDrugCandidates(toolOutput);
    if (!cands.length) return text;
    return text.replace(/```json:drug\s*\n([\s\S]*?)\n```/g, (whole, body: string) => {
        let card: any;
        try { card = JSON.parse(body); } catch { return whole; }
        const c = pickCandidate(card, cands);
        if (!c) return whole;
        let changed = false;
        for (const f of URL_FIELDS) {
            if (card[f] !== c[f]) { card[f] = c[f]; changed = true; }
        }
        return changed ? '```json:drug\n' + JSON.stringify(card, null, 2) + '\n```' : whole;
    });
};

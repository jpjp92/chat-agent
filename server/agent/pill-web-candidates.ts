/** 약 식별 웹 후보 파싱 — 순수 함수(하니스용으로 pill-web-search.ts 에서 분리). */

// 낱알 식별 색인이 있는 곳으로 제한 — 제한이 없으면 커뮤니티·쇼핑몰 글을 근거로 삼는다
export const PILL_DOMAINS = ['health.kr', 'pharm.or.kr', 'druginfo.co.kr', 'mfds.go.kr', 'yakcheck.co.kr'];

export type PillWebCandidate = { name: string; company: string; imprint: string; form: string; color: string; url: string };

/** `후보|…|URL` 줄만 읽는다. URL 은 낱알식별 도메인(PILL_DOMAINS) 안이어야 한다 — 그 밖의 링크는 근거로 쓰지 않는다.
 *  (Gemini grounding 출처는 리디렉트 주소라 호스트 대조가 안 된다 → 두 모델 모두 도메인 목록으로 거른다) */
export function parsePillWebCandidates(text: string, domains: string[] = PILL_DOMAINS): PillWebCandidate[] {
    const out: PillWebCandidate[] = [];
    for (const line of text.split('\n')) {
        const cols = line.replace(/^[-*\s]+/, '').split('|').map(c => c.trim());
        if (cols[0] !== '후보' || cols.length < 7) continue;
        const [, name, company, imprint, form, color, rawUrl] = cols;
        const url = (rawUrl.match(/https?:\/\/[^\s)\]]+/) ?? [''])[0];
        if (!name || !url) continue;
        let host = '';
        try { host = new URL(url).hostname; } catch { continue; }
        if (!domains.some(d => host === d || host.endsWith('.' + d))) continue;
        out.push({ name, company: company.replace(/\(주\)|㈜|주식회사/g, '').trim(), imprint, form, color, url });
    }
    return out.slice(0, 5);
}


/**
 * Gemini grounding 인용을 OpenAI와 같은 클릭 가능한 번호로 변환한다.
 *
 * 모델이 스스로 쓴 `[1]`은 실제 출처와 대응한다는 보장이 없어(가짜 인용) 서버가 지운다.
 * grounding 응답의 `groundingSupports` 에는 문장 구간과 그 구간이 참조한 chunk 인덱스가 들어 있다 —
 * OpenAI `url_citation`의 `endIndex`와 같은 구조라, 추측이 아니라 **API가 알려 준 위치**에 번호를 넣는다.
 *
 * 주의: `segment.startIndex`/`endIndex`는 **UTF-8 바이트 오프셋**이다. JS 문자열 인덱스로 그대로
 * 쓰면 한글 문장 한가운데를 잘라 텍스트가 깨진다 → DEV_260824
 */

type GroundedSource = { title: string; uri: string; citationNumber?: number };

/** 모델이 지어낸 맨 대괄호 번호만 제거한다. `[1](url)` 형태의 실제 링크는 남긴다. */
export const stripFabricatedCitations = (text: string): string =>
    text.replace(/\s?\[\d+(?:,\s*\d+)*\](?!\()/g, '');

/** grounding redirect URL 패턴 — 사람이 읽을 수 없는 불투명 리다이렉트라 본문 노출은 항상 버그다. */
const GROUNDING_REDIRECT_URL = String.raw`https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^\s)\]]+`;

/**
 * 모델이 **본문에 직접 써 넣은** grounding redirect URL 을 지운다.
 *
 * 히스토리에 `[N](redirect)` 마커가 남으면 후속 턴 모델이 그 포맷을 흉내 내 검색 결과 URL 을 맨 괄호로
 * 본문에 쓴다. 그 위에 서버 마커가 꽂히면 `[1](A)(A)` 처럼 겹치고 생 URL 이 화면에 뜬다.
 * 근본 차단은 history.ts(되먹임 차단)이고, 여기는 안전망이다.
 * `](` 바로 뒤 URL(= 우리 마커의 목적지)만 남기고 나머지는 지운다 → DEV_260824
 */
export const stripBareGroundingUrls = (text: string): string => text
    // ① 괄호로 감싼 형태 — `](` 뒤가 아니면 통째로 제거
    .replace(new RegExp(String.raw`\s?(?<!\])\((?:${GROUNDING_REDIRECT_URL})\)`, 'g'), '')
    // ② 괄호 없이 노출된 형태 — 마커 목적지(`](url)`)만 남긴다
    .replace(new RegExp(String.raw`\s?(?<!\]\()${GROUNDING_REDIRECT_URL}`, 'g'), '');

/**
 * UTF-8 바이트 오프셋 → JS 문자열 인덱스. 응답 1건당 한 번만 만들어 재사용한다.
 * 오프셋이 문자 경계 안쪽을 가리키면 그 문자의 시작으로 내림한다.
 */
function buildByteToCharIndex(text: string): (byteOffset: number) => number {
    const charIndexByByte = new Map<number, number>();
    let bytes = 0;
    for (let charIndex = 0; charIndex < text.length; charIndex++) {
        charIndexByByte.set(bytes, charIndex);
        const code = text.codePointAt(charIndex)!;
        // 서로게이트 쌍(이모지 등)은 JS 문자열에서 2칸을 차지한다.
        if (code > 0xffff) {
            charIndex++;
            charIndexByByte.set(bytes, charIndex - 1);
        }
        bytes += Buffer.byteLength(String.fromCodePoint(code), 'utf8');
    }
    const totalBytes = bytes;
    charIndexByByte.set(totalBytes, text.length);

    return (byteOffset: number) => {
        if (byteOffset >= totalBytes) return text.length;
        for (let probe = byteOffset; probe >= 0; probe--) {
            const found = charIndexByByte.get(probe);
            if (found !== undefined) return found;
        }
        return 0;
    };
}

/**
 * grounding 메타데이터로 본문에 `[N](uri)` 마커를 심고 번호가 매겨진 출처 목록을 돌려준다.
 * `groundingSupports`가 없으면(구버전 응답·검색 미발동) 기존 동작 그대로 번호 없는 출처만 준다.
 */
export function applyGeminiCitations(
    rawText: string,
    groundingMetadata: any,
): { text: string; sources: GroundedSource[] } {
    const chunks: Array<{ title: string; uri: string } | null> = (groundingMetadata?.groundingChunks ?? [])
        .map((chunk: any) => (chunk?.web?.uri ? { title: chunk.web.title || chunk.web.uri, uri: chunk.web.uri } : null));

    const uniqueByUri = new Map<string, GroundedSource>();
    for (const chunk of chunks) {
        if (chunk && !uniqueByUri.has(chunk.uri)) uniqueByUri.set(chunk.uri, { ...chunk });
    }
    const sources = [...uniqueByUri.values()];
    const supports: any[] = Array.isArray(groundingMetadata?.groundingSupports) ? groundingMetadata.groundingSupports : [];

    if (sources.length === 0 || supports.length === 0 || !rawText) {
        return { text: stripBareGroundingUrls(stripFabricatedCitations(rawText)), sources };
    }

    // 번호는 본문에 **처음 인용된 순서**로 매긴다. chunk 배열 순서는 검색 결과 순서라
    // 읽는 순서와 어긋날 수 있다.
    const numberByUri = new Map<string, number>();
    const orderedSupports = [...supports]
        .filter(support => Number.isInteger(support?.segment?.endIndex))
        .sort((a, b) => a.segment.endIndex - b.segment.endIndex);

    for (const support of orderedSupports) {
        for (const chunkIndex of support.groundingChunkIndices ?? []) {
            const uri = chunks[chunkIndex]?.uri;
            if (uri && !numberByUri.has(uri)) numberByUri.set(uri, numberByUri.size + 1);
        }
    }
    for (const source of sources) source.citationNumber = numberByUri.get(source.uri);

    const toCharIndex = buildByteToCharIndex(rawText);
    // 뒤에서부터 넣어야 앞쪽 인덱스가 밀리지 않는다.
    let text = rawText;
    for (const support of [...orderedSupports].reverse()) {
        const numbers = [...new Set<number>((support.groundingChunkIndices ?? [])
            .map((chunkIndex: number) => chunks[chunkIndex]?.uri)
            .filter((uri: string | undefined): uri is string => !!uri && numberByUri.has(uri))
            .map((uri: string) => numberByUri.get(uri)!))].sort((a, b) => a - b);
        if (numbers.length === 0) continue;

        const insertAt = toCharIndex(support.segment.endIndex);
        const marker = numbers
            .map(number => `[${number}](${[...uniqueByUri.values()].find(s => s.citationNumber === number)!.uri})`)
            .join('');
        text = `${text.slice(0, insertAt)}${marker}${text.slice(insertAt)}`;
    }

    // 마커를 심은 뒤에 지운다 — 먼저 지우면 바이트 오프셋이 어긋난다.
    return {
        text: stripBareGroundingUrls(stripFabricatedCitations(text)),
        sources: sources.filter(source => source.citationNumber),
    };
}

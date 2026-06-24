/**
 * 스트리밍 중 미완성 마크다운 표 깨짐 방지 (PLAN_STREAMING_PARTIAL §11-1, 방안 B).
 *
 * 누적되는 응답을 매 청크 ReactMarkdown로 재파싱하면, 표는 구분행 `|---|`가
 * 도착하기 전엔 `| a | b |` 생짜 텍스트로(BROKEN), 이후엔 행이 하나씩 자라며(PARTIAL)
 * 들썩인다. 스트리밍 중에는 꼬리의 미완성 표 영역을 숨겨, 표가 완성(다음 비표 행/빈 줄
 * 도착 또는 스트림 종료)될 때 통째로 출현하게 한다.
 *
 * 안전성: isStreaming=false(최종 렌더)면 원본을 그대로 반환 → 출력 1바이트 불변.
 * scripts/test-table-streaming.ts 가 동일 함수로 RAW 14프레임 → 0 검증.
 */
export function gateStreamingTables(text: string, isStreaming: boolean): string {
    if (!isStreaming) return text;
    const lines = text.split('\n');
    // 끝이 빈 줄이면 직전 표 블록은 마감된 것 → 그대로 둠
    if (lines[lines.length - 1].trim() === '') return text;
    // 꼬리의 연속 파이프 행( |로 시작 )을 미완성 표로 보고 제거
    let j = lines.length - 1;
    while (j >= 0 && /^\s*\|/.test(lines[j])) j--;
    if (j < lines.length - 1) return lines.slice(0, j + 1).join('\n');
    return text;
}

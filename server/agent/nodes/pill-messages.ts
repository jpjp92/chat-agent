/**
 * Pill (알약) message formatters — pure helpers extracted from generator.ts.
 * No closure/state dependencies: every function takes explicit args.
 * Used by the LangChain drug_id path to build user-facing messages from
 * identify_pill tool results.
 */

const formatPillAttributes = (pillData: any): string => {
    const parts = [
        pillData?.imprint_front ? `앞면 각인: ${pillData.imprint_front}` : null,
        pillData?.imprint_back ? `뒷면 각인: ${pillData.imprint_back}` : null,
        pillData?.color ? `색상: ${pillData.color}` : null,
        pillData?.shape ? `모양: ${pillData.shape}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : '이미지에서 추출한 특징';
};

export const pillNoMatchMessage = (pillData: any): string =>
    `이미지에서 추출한 특징(${formatPillAttributes(pillData)})과 일치하는 약품을 식품의약품안전처 DB에서 찾지 못했습니다.\n\n알약의 각인·색상·모양을 직접 알려주시면 재검색해드릴게요. 정확한 식별은 약사 또는 의사에게 확인하시기 바랍니다.`;

export const pillLookupErrorMessage =
    '식품의약품안전처 DB 조회 중 오류가 발생했습니다.\n\n잠시 후 다시 시도하거나, 알약의 각인·색상·모양을 텍스트로 알려주시면 다시 검색해드릴게요.';

export const extractPillMatchType = (toolText: string): string => {
    const match = toolText.match(/^match_type:\s*([^\n]+)/m);
    return match?.[1]?.trim() || '';
};

const parsePillCandidates = (toolText: string) => {
    const blocks = toolText.split(/\nCandidate\s+\d+:\n/g).slice(1);
    return blocks.map(block => {
        const read = (label: string) => {
            const match = block.match(new RegExp(`^- ${label}:\\s*(.*)$`, 'm'));
            return match?.[1]?.trim() || '';
        };
        return {
            name: read('Name'),
            company: read('Company'),
            imprint: read('Imprint'),
            color: read('Color'),
            shape: read('Shape'),
            detailUrl: read('Detail URL'),
        };
    }).filter(candidate => candidate.name);
};

export const pillCandidateTableMessage = (pillData: any, matchType: string, toolText: string): string => {
    const candidates = parsePillCandidates(toolText);
    const matchLabel = matchType === 'imprint_only'
        ? '각인 기준 유사 후보'
        : '색상·모양 기준 유사 후보';

    const rows = candidates.map(candidate => [
        candidate.name,
        candidate.company || '-',
        candidate.imprint || '-',
        candidate.color || '-',
        candidate.shape || '-',
        candidate.detailUrl ? `[약품정보](${candidate.detailUrl})` : '-',
    ]);

    const table = [
        '| 제품명 | 제조사 | 식별표시 | 색상 | 모양 | 링크 |',
        '|---|---|---|---|---|---|',
        ...rows.map(row => `| ${row.join(' | ')} |`),
    ].join('\n');

    return [
        `이미지에서 추출한 특징(${formatPillAttributes(pillData)})을 바탕으로 식품의약품안전처 DB에서 검색한 후보 약품입니다.`,
        '',
        `이미지만으로 약품을 단일 확정할 수 없으므로 복용 전 반드시 약사 또는 의사에게 확인하세요.`,
        '',
        table,
    ].join('\n');
};

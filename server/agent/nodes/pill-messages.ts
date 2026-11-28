/**
 * Pill (알약) message formatters — pure helpers extracted from generator.ts.
 * 클로저·상태 의존 없음: 모든 함수가 인자를 명시적으로 받는다.
 * LangChain drug_id 경로가 identify_pill 도구 결과로
 * 사용자에게 보일 문구를 만들 때 쓴다.
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

/**
 * 색상·모양만 나열한다 — `similar` 는 각인을 **쓰지 않은** 결과라 특징 목록에 섞으면 안 된다.
 * 문장 안에 들어가므로 `색상:`·`모양:` 라벨은 붙이지 않는다("색상: 하양, 모양: 장방형만으로" → 어색).
 */
const formatColorShapeOnly = (pillData: any): string => {
    const parts = [pillData?.color, pillData?.shape].map(v => String(v ?? '').trim()).filter(Boolean);
    return parts.length > 0 ? parts.join('·') : '색상·모양';
};

const readImprint = (pillData: any): string => {
    const f = String(pillData?.imprint_front ?? '').trim();
    const b = String(pillData?.imprint_back ?? '').trim();
    return [f, b].filter(Boolean).join(' / ');
};

export const pillNoMatchMessage = (pillData: any): string =>
    `이미지에서 추출한 특징(${formatPillAttributes(pillData)})과 일치하는 약품을 식품의약품안전처 DB에서 찾지 못했습니다.\n\n알약의 각인·색상·모양을 직접 알려주시면 재검색해드릴게요. 정확한 식별은 약사 또는 의사에게 확인하시기 바랍니다.`;

export const pillLookupErrorMessage =
    '식품의약품안전처 DB 조회 중 오류가 발생했습니다.\n\n잠시 후 다시 시도하거나, 알약의 각인·색상·모양을 텍스트로 알려주시면 다시 검색해드릴게요.';

export const extractPillMatchType = (toolText: string): string => {
    const match = toolText.match(/^match_type:\s*([^\n]+)/m);
    return match?.[1]?.trim() || '';
};

/**
 * 줄 값을 읽을 때 `\s*` 를 쓰지 않는다 — 개행을 먹는다.
 * 값이 **빈 줄**이면 `\s*` 가 개행까지 삼키고 `(.*)` 가 다음 줄을 잡는다(`- Imprint: ` 다음 줄의
 * `- Color: 하양` 이 식별표시 칸에 찍힘). 각인 없는 행이 대부분(~91%)이라 거의 항상 나는 경우다.
 * `[ \t]*` 로 **한 줄 안에서만** 읽는다. 값이 비면 빈 문자열이고 표에는 `-` 가 찍힌다 → DEV_260818
 */
/**
 * 값이 빌 수 있는 모든 필드는 `\s*` 대신 줄 안에서만 먹는 `[ \t]*` 로 읽는다.
 * `tools.ts` 는 각인이 없어도 `- Imprint: \n` 줄을 그대로 쓰므로(`mark_codes` 빈 배열 → 빈 문자열),
 * `\s*` 면 다음 줄 값을 잡는다(위 주석 참고).
 */
const parsePillCandidates = (toolText: string) => {
    const blocks = toolText.split(/\nCandidate\s+\d+:\n/g).slice(1);
    return blocks.map(block => {
        const read = (label: string) => {
            const match = block.match(new RegExp(`^- ${label}:[ \\t]*(.*)$`, 'm'));
            return match?.[1]?.trim() || '';
        };
        // 구분자만 남은 값(`/`, `,`, `-`)은 값이 아니다 — pharm.or.kr 폴백이 `${front} / ${back}` 를
        // 쓰는데 양쪽이 비면 `/` 만 남는다. 표에 `/` 를 각인으로 찍으면 없는 각인을 있다고 보여준다.
        const meaningful = (v: string) => (/[a-z0-9가-힣]/i.test(v) ? v : '');
        return {
            name: read('Name'),
            company: read('Company'),
            imprint: meaningful(read('Imprint')),
            color: read('Color'),
            shape: read('Shape'),
            detailUrl: read('Detail URL'),
            image: /^https?:\/\//.test(read('Image')) ? read('Image') : '',
            mark: /^https?:\/\//.test(read('Mark')) ? read('Mark') : '',
        };
    }).filter(candidate => candidate.name);
};

/**
 * **`match_type` 을 문장에 반영한다.**
 *
 * `similar` 은 각인을 쓰지 않은 결과(색상+모양만)다. `imprint_only` 와 같은 문장("추출한 각인을 바탕으로
 * 검색한 후보")을 쓰면 표는 사실을 말하는데 문장이 그걸 부정한다.
 * 각인 텍스트(`mark_code_front_anal`)를 가진 행은 약 8.7% 뿐이라(상류 MFDS API 의 한계)
 * **약 91% 의 질의가 `similar` 로 떨어진다** — 예외가 아니라 기본 경로다 → DEV_260818
 */
export const pillCandidateTableMessage = (pillData: any, matchType: string, toolText: string): string => {
    const candidates = parsePillCandidates(toolText);
    const imprint = readImprint(pillData);

    // 각인을 **읽었는데 DB 에 없는 경우**와 **아예 못 읽은 경우**는 사용자에게 다른 사실이다.
    // 후보 출처를 링크로 판단한다 — 약학정보원 결과를 "식약처 DB 에서 검색" 으로 적고 있었다(11-28)
    const fromPharm = candidates.length > 0 && candidates.every(c => c.detailUrl.includes('pharm.or.kr'));
    const sourceName = fromPharm ? '약학정보원' : '식품의약품안전처 DB';
    const lead = matchType === 'imprint_only'
        ? `이미지에서 추출한 특징(${formatPillAttributes(pillData)})을 바탕으로 ${sourceName}에서 검색한 후보 약품입니다.`
        : imprint
            ? [
                `각인 **${imprint}** 과 일치하는 약품을 식품의약품안전처 DB에서 찾지 못했습니다.`,
                '',
                `아래는 **각인을 제외하고 ${formatColorShapeOnly(pillData)}만으로** 추린 참고 후보입니다 — **각인이 다를 수 있습니다.**`,
            ].join('\n')
            : [
                `이미지에서 각인을 읽지 못했습니다.`,
                '',
                `아래는 **${formatColorShapeOnly(pillData)}만으로** 추린 참고 후보입니다 — **각인이 다를 수 있습니다.**`,
            ].join('\n');

    // 왜 각인이 안 쓰였는지 밝힌다 — 밝히지 않으면 "각인을 무시했다"로 읽힌다
    // 문장 끝의 "약사 또는 의사에게 확인하세요"와 붙으므로 여기서 그 말을 반복하지 않는다
    const coverageNote = matchType === 'imprint_only'
        ? ''
        : ' (식약처 DB는 약 8.7%의 품목에만 각인 텍스트를 제공합니다.)';

    // 이 칸은 **후보 약품이 식약처 DB 에 등록한 각인**이지, 사진에서 읽은 각인이 아니다 —
    // 바로 위 문장이 사용자의 각인을 말하므로 `식별표시` 라고만 쓰면 "그 각인이 없다"로 읽힌다.
    // 빈 값을 `-` 로 쓰면 "이 약은 각인이 없다"로 읽히는데, 우리는 그걸 모른다 — 각인 텍스트·이미지가
    // 둘 다 없는 행이 많아 무각인인지 미등록인지 구분할 수 없다. "각인 없음"과 "정보 없음"은
    // 다른 주장이라 단정하지 않는다 → DEV_260818
    // 같은 문자 각인(CFX)을 여러 제조사가 쓰면 로고가 결정적이다 — 로고 이미지와 알약 사진을 표에 붙여 사용자가 비교하게 한다(G13).
    // 추가 요청 없음: 약학정보원 목록 행·MFDS 행에 이미 있는 주소다.
    const imprintCell = (c: typeof candidates[number]) => {
        if (!c.imprint) return '정보 없음';
        return c.mark ? `![마크](${c.mark}) ${c.imprint.replace(/^마크\s*/, '')}` : c.imprint;
    };
    const showPhotos = candidates.some(c => c.image);
    const rows = candidates.map(candidate => [
        ...(showPhotos ? [candidate.image ? `![사진](${candidate.image})` : '-'] : []),
        candidate.name,
        candidate.company || '-',
        imprintCell(candidate),
        candidate.color || '-',
        candidate.shape || '-',
        candidate.detailUrl ? `[약품정보](${candidate.detailUrl})` : '-',
    ]);

    const table = [
        `|${showPhotos ? ' 사진 |' : ''} 제품명 | 제조사 | DB 등록 각인 | 색상 | 모양 | 링크 |`,
        `|${showPhotos ? '---|' : ''}---|---|---|---|---|---|`,
        ...rows.map(row => `| ${row.join(' | ')} |`),
    ].join('\n');

    return [
        lead,
        '',
        `이미지만으로 약품을 단일 확정할 수 없으므로 복용 전 반드시 약사 또는 의사에게 확인하세요.${coverageNote}`,
        '',
        table,
    ].join('\n');
};

/**
 * 웹 폴백 후보를 **서버가 표로** 만든다 — 생성 모델을 거치지 않는다(규칙 충돌로 웹 후보가 사라졌다, 11-28).
 * 웹 후보는 각인 일치 근거가 있는 출처 링크를 가진 것만 들어온다(pill-web-search.ts). 확정이 아니라 후보다.
 * DB 색상·모양 후보는 아래에 참고로만 붙인다.
 */
export const pillWebCandidateMessage = (
    pillData: any,
    web: { name: string; company: string; imprint: string; form: string; color: string; url: string }[],
    dbToolText: string,
    matchType: string,
): string => {
    const imprint = readImprint(pillData);
    const cell = (v: string) => (v || '-').replace(/\|/g, '/');
    const webTable = [
        '| 제품명 | 제조사 | 각인 | 제형 | 색상 | 출처 |',
        '|---|---|---|---|---|---|',
        ...web.map(c => `| ${cell(c.name)} | ${cell(c.company)} | ${cell(c.imprint)} | ${cell(c.form)} | ${cell(c.color)} | [보기](${c.url}) |`),
    ].join('\n');
    const db = dbToolText ? parsePillCandidates(dbToolText) : [];
    const dbPart = db.length && matchType !== 'imprint_only'
        ? [
            '',
            `**참고 — 식약처 DB 색상·모양 기준 후보** (각인을 쓰지 않은 결과라 다를 수 있습니다)`,
            '',
            '| 제품명 | 제조사 | 색상 | 모양 | 링크 |',
            '|---|---|---|---|---|',
            ...db.map(c => `| ${cell(c.name)} | ${cell(c.company)} | ${cell(c.color)} | ${cell(c.shape)} | ${c.detailUrl ? `[약품정보](${c.detailUrl})` : '-'} |`),
        ].join('\n')
        : '';
    return [
        `각인 **${imprint}** 으로 식품의약품안전처 DB에서는 찾지 못해, 웹(낱알식별 사이트)에서 각인이 일치하는 후보를 찾았습니다.`,
        '',
        webTable,
        '',
        '사진만으로 약을 확정할 수 없습니다. 로고·각인을 출처 페이지의 사진과 비교해 보시고, 복용 전 반드시 약사 또는 의사에게 확인하세요.',
        dbPart,
    ].join('\n').trim();
};

/**
 * ─── 웹 폴백 ──────────────────────────────────────────────────────────────
 *
 * 식약처 낱알식별 API 는 각인 텍스트를 일부 품목(~8.7%)에만 준다. 그래서 각인을 정확히 읽어도
 * DB 에 없으면 색상·모양 후보만 내놓게 되는데, 그건 질문에 답한 게 아니다.
 * 웹(약학정보원·드러그인포 등)은 각인으로 색인돼 있으므로, 이 폴백은 그 필드에 한해 더 나은
 * 소스로 가는 것이다.
 *
 * 주의: 여기가 할루시네이션 위험이 가장 큰 지점이다. 그래서
 *   ⓐ 각인을 **실제로 읽었을 때만** 돌고(검색 키가 없으면 웹도 못 찾는다)
 *   ⓑ 출처 URL 이 있는 결과만 쓰고
 *   ⓒ `json:drug` 카드는 여전히 `exact` 에서만 만든다 → DEV_260818
 */

/** 각인을 읽었고 DB 가 그걸로 못 찾았을 때만 웹을 본다. */
export const shouldTryPillWebFallback = (matchType: string, pillData: any): boolean => {
    if (matchType !== 'similar' && matchType !== 'none') return false;
    // 각인이 없으면 웹에 던질 키 자체가 없다 — 색상·모양으로 웹 검색은 소음만 만든다
    return readImprint(pillData).length > 0;
};

/**
 * 검색어. 각인을 **따옴표로 묶어** 부분 일치로 흩어지는 걸 막고, 색상·모양을 보조어로 붙인다.
 * `알약 각인` 을 함께 넣어야 약품 색인 페이지가 올라온다(그냥 "OG37" 은 부품번호·차량코드가 나온다).
 */
export const buildPillWebQuery = (pillData: any): string => {
    // 면마다 따로 묶는다 — 앞·뒤를 "WU / CFX" 한 구절로 묶으면 그런 문자열은 어디에도 없어 결과가 0건이었다(11-28 실사진).
    // 면이 둘이면 긴 쪽(대개 글자 각인)만 쓴다 — 짧은 쪽은 로고 오독(예: 로고 → "WU")일 때가 많아 검색을 비게 만든다.
    // 토큰 단위 — 한 면에 "UU CFX" 로 붙어 와도 "CFX" 만 묶는다
    const key = String(pillData?.imprint_front ?? '').concat(' ', String(pillData?.imprint_back ?? ''))
        .split(/[\s/|,·]+/).map(t => t.trim())
        .filter(t => /[a-zA-Z0-9]/.test(t) && !/^(null|undefined|없음|none|마크)$/i.test(t))
        .sort((a, b) => b.replace(/[^a-zA-Z0-9]/g, '').length - a.replace(/[^a-zA-Z0-9]/g, '').length)[0] ?? '';
    // 캡슐이면 "캡슐" 로 찾고 모양은 뺀다 — 비전의 모양 판독이 같은 캡슐에서 장방형·타원형·기타로 흔들렸다(11-28)
    const capsule = String(pillData?.form ?? '').includes('캡슐');
    const extra = [pillData?.color, capsule ? '' : pillData?.shape].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
    return `"${key}" ${capsule ? '캡슐' : '알약'} 각인 식별${extra ? ' ' + extra : ''}`;
};

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
 * 🔴 **`\s*` 를 쓰면 안 된다 — 개행을 먹는다.** (2026-08-18 실측)
 *
 * 이전 정규식 `^- ${label}:\s*(.*)$` 는 값이 **빈 줄**일 때 `\s*` 가 줄 끝 공백과 **개행까지**
 * 삼키고 `(.*)` 가 **다음 줄**을 잡았다. `tools.ts` 가 `- Imprint: ${mark_codes.join(', ')}` 를
 * 쓰는데 각인이 없으면 `- Imprint: ` 뿐이라 → 식별표시 칸에 **`- Color: 하양`** 이 찍혔다.
 *
 * 🔴 **각인 없는 행이 91%** 이므로 이건 드문 경우가 아니라 **거의 항상**이었다.
 * `[ \t]*` 로 바꿔 **한 줄 안에서만** 읽는다. 값이 비면 빈 문자열이고 표에는 `-` 가 찍힌다.
 */
/**
 * 🔴 **`\\s*` 를 쓰면 안 된다 — `\\s` 는 개행을 먹는다.** (2026-08-18 실측 버그)
 *
 * `tools.ts` 는 각인이 없어도 줄을 지우지 않고 `- Imprint: \\n` 을 그대로 쓴다
 * (`r.mark_codes.join(', ')` 가 빈 배열이면 빈 문자열).
 * 옛 정규식 `^- Imprint:\\s*(.*)$` 는 `\\s*` 가 **뒤 공백 + 개행까지 소비**한 뒤
 * `(.*)` 가 **다음 줄**을 잡아서, 화면에 `식별표시: - Color: 하양` 이 찍혔다.
 *
 * 각인 텍스트가 있는 행은 8.7% 뿐이라 **나머지 91% 가 전부 이 버그를 탔다.**
 * 값이 빌 수 있는 모든 필드가 같은 위험을 갖는다 → 줄 안에서만 먹는 `[ \\t]*` 로 고정한다.
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
        };
    }).filter(candidate => candidate.name);
};

/**
 * 🔴 **`match_type` 을 문장에 반영한다.** (2026-08-18)
 *
 * 이전에는 `imprint_only` 와 `similar` 이 **똑같은 문장**을 썼다 —
 *   *"이미지에서 추출한 특징(앞면 각인: OG37, 색상: 하양, 모양: 장방형)을 바탕으로 …검색한 후보"*
 * `similar` 은 각인을 **전혀 쓰지 않은** 결과(3단계 = 색상+모양만)인데도 각인 기준으로 찾은 것처럼
 * 읽혔다. 실측(2026-08-18): OG37 알약 질의에서 하양+장방형 **1,845건 중 임의 5건**이 나왔고
 * 표의 `식별표시` 는 전부 `-` 였다 — **표는 사실을 말하는데 문장이 그걸 부정했다.**
 * `matchLabel` 변수는 그때도 있었지만 **어디서도 쓰이지 않는 죽은 코드**였다.
 *
 * 🔴 **이건 예외가 아니라 기본 경로다.** dev 실측상 `mark_code_front_anal`(각인 텍스트)을 가진
 * 행은 25,345 중 2,214 = **8.7%** 뿐이다(상류 MFDS 낱알식별 API 의 한계지 로더 버그가 아니다).
 * 즉 **약 91% 의 질의가 `similar` 로 떨어진다.** 조용히 틀린 답이 기본값이었다.
 */
export const pillCandidateTableMessage = (pillData: any, matchType: string, toolText: string): string => {
    const candidates = parsePillCandidates(toolText);
    const imprint = readImprint(pillData);

    // 각인을 **읽었는데 DB 에 없는 경우**와 **아예 못 읽은 경우**는 사용자에게 다른 사실이다.
    const lead = matchType === 'imprint_only'
        ? `이미지에서 추출한 특징(${formatPillAttributes(pillData)})을 바탕으로 식품의약품안전처 DB에서 검색한 후보 약품입니다.`
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

    // 🔴 이 칸은 **후보 약품이 식약처 DB 에 등록한 각인**이지, 사진에서 읽은 각인이 아니다.
    //   바로 위 문장이 사용자의 각인(OG37)을 말하므로 `식별표시` 라고만 쓰면
    //   "OG37 이 없다"로 읽힌다(2026-08-18 사용자 지적).
    //   그리고 빈 값을 `-` 로 쓰면 **"이 약은 각인이 없다"** 로 읽히는데, 우리는 그걸 모른다 —
    //   실측상 23,121행이 각인 텍스트·이미지 **둘 다 없어** 무각인인지 미등록인지 구분 불가다.
    //   약 식별에서 "각인 없음"과 "정보 없음"은 전혀 다른 주장이라 **단정하면 안 된다.**
    const rows = candidates.map(candidate => [
        candidate.name,
        candidate.company || '-',
        candidate.imprint || '정보 없음',
        candidate.color || '-',
        candidate.shape || '-',
        candidate.detailUrl ? `[약품정보](${candidate.detailUrl})` : '-',
    ]);

    const table = [
        '| 제품명 | 제조사 | DB 등록 각인 | 색상 | 모양 | 링크 |',
        '|---|---|---|---|---|---|',
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
 * ─── 웹 폴백 ──────────────────────────────────────────────────────────────
 *
 * 🔴 **왜 필요한가**: 식약처 낱알식별 API 는 각인 텍스트를 **8.7%** 의 품목에만 준다
 * (실측 2026-08-18: 25,345행 중 2,214). 그래서 각인을 정확히 읽어도 DB 에 없으면
 * 색상·모양 후보만 내놓게 되는데, 그건 **질문에 답한 게 아니다**.
 *
 * 반면 웹(약학정보원·드러그인포 등)은 **각인으로 색인돼 있다.** 즉 이 폴백은 궁여지책이 아니라
 * **그 필드에 한해 더 나은 소스로 가는 것**이다. 이게 이 경로의 정당성이다.
 *
 * ⚠️ 동시에 여기가 **할루시네이션 최악 지점**이다 — *"시각적 유사성을 기반으로…"* 가 나왔던 자리다.
 * 그래서 ⓐ각인을 **실제로 읽었을 때만** 돌고(검색 키가 없으면 웹도 못 찾는다)
 *        ⓑ출처 URL 이 있는 결과만 쓰고
 *        ⓒ`json:drug` 카드는 여전히 `exact` 에서만 만든다.
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
    const imprint = readImprint(pillData);
    const extra = [pillData?.color, pillData?.shape].map(v => String(v ?? '').trim()).filter(Boolean).join(' ');
    return `"${imprint}" 알약 각인 식별${extra ? ' ' + extra : ''}`;
};

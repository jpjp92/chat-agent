/**
 * 직전 답변이 **웹 검색으로 확인된 것**임을 이번 턴 모델에 알린다 → DEV_261013
 *
 * 히스토리에는 이전 답변의 **글만** 간다 — 인용 마커는 지우고(history.ts `stripCitationLinksForHistory`)
 * 출처 내용은 다시 싣지 않는다. 그러면 검색이 꺼진 후속 턴에서 모델(특히 GPT)이 학습 시점 이후 사실을
 * 담은 자기 직전 답변을 환각으로 보고 번복할 수 있다.
 *
 * 근거는 `state.lastTurnSearched`(직전 봇 메시지의 groundingSources 유무)다 — 추측이 아니라 증거.
 */
export const buildGroundedHistoryRules = (sourceLabels: string[] = []): string =>
    `[GROUNDED PREVIOUS ANSWER — this turn]\n- Your previous answer in this conversation was written from **live web search results retrieved in this conversation**${sourceLabels.length ? ` (sources: ${sourceLabels.join(' · ')})` : ''}. It is NOT your training data, so [ANTI-HALLUCINATION DIRECTIVE] does not apply to it — treat its facts as verified, even if they postdate your training cutoff.\n- Without new evidence in this turn (search results, an attachment, or a user correction), NEVER retract it, call it unverified, or claim it "has not been announced yet". Differing from your training knowledge is not a reason to retract.\n- If this turn has web search results: a source that simply does not mention those facts (e.g. a schedule page, an older list) is NOT a contradiction. Correct the previous answer only when a retrieved source explicitly states different facts, and name that source.\n- That previous answer is present above in this conversation and is NOT empty — when asked to reformat it (table, summary, list), do so; never reply that there is no original answer or that it is already in that format.\n- Reformat or reuse its content normally. If asked for a detail it does not contain and you are unsure, say briefly that the detail needs checking — do not invent it and do not cast doubt on the rest.`;

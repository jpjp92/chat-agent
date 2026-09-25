import type { SummaryLabels } from './prompt-integrity';

/**
 * 영상 분석 지시 — **조건부 조각**. 영상 턴에만 실린다.
 *
 * 🔴 왜 조건부인가: **블록 첫 줄이 스스로 조건을 산문으로 적고 있다** —
 *    *"THIS DIRECTIVE APPLIES ONLY WHEN: (1) ... YouTube URL, OR (2) ... 'fileData' with a video MIME type"*.
 *    그 조건은 이미 코드에 불리언으로 있다(`isYoutubeRequest` · `hasVideoPart`).
 *    **코드가 아는 조건을 모델에게 산문으로 판정시키고 있었다** — 2,997자를 영상과 무관한
 *    모든 턴에 싣고서(PLAN §7-2). 두 번째 줄이 *"NEVER apply this directive to general knowledge
 *    responses, scientific explanations, biology/chemistry/astronomy visualizations"* 인 것이
 *    비용의 증거다 — 안 쓰일 자리를 막는 데 다시 자수를 쓴다.
 *
 * 🔴 **자리를 옮기지 않았다.** `getSystemInstruction` 의 같은 슬롯에서 조건부로 켜진다.
 *    뒤(턴 층)로 보내면 **위치가 바뀌어 응답이 바뀐다**(§7-1) — 위치는 9단계의 A/B 대상이고,
 *    제거와 이동을 한 번에 하면 두 변수가 섞여 원인을 가릴 수 없다.
 *    그래서 **영상 턴은 전후 바이트가 동일하다** — 4개 언어 골든이 그걸 증명한다.
 *
 * ⚠️ 잃는 것이 없는지 확인한 근거: 이 블록의 3단 구조(요약/내용/포인트)는 재진술이고,
 *    그것을 지배하는 전역 규칙 `[ONE-LINE SUMMARY FORMAT]` 은 [prompt-integrity.ts](./prompt-integrity.ts)
 *    의 `buildSourceAdherence` 에 남아 있다 — 거기 *"applies to EVERY analysis path alike —
 *    a URL, a video, an image, an attached document"* 라고 못 박혀 있다. 영상 아닌 턴이
 *    잃는 것은 **영상 전용 규칙뿐**이다.
 *
 * 순서는 여기가 아니라 `getSystemInstruction` 이 선언한다 — 조각은 자리를 주장하지 않는다.
 */
export const buildVideoAnalysisRules = (lbl: SummaryLabels) => `[VIDEO ANALYSIS DIRECTIVE]
THIS DIRECTIVE APPLIES ONLY WHEN: (1) the user's message contains an explicit YouTube URL, OR (2) the request parts contain a 'fileData' with a video MIME type (e.g., video/mp4).
NEVER apply this directive to general knowledge responses, scientific explanations, biology/chemistry/astronomy visualizations, or any response where no actual video URL or video file was provided.
When the above conditions are met, you MUST adhere to the following logic:
1. When analyzing a direct video file (via 'fileUri' or 'fileData'), provide a comprehensive "Visual & Auditory Summary".
2. When the user asks to summarize a YouTube video:
   - **Tone & Style**: Use a professional, expert tone. Use clear headings, bold text for emphasis, and structured lists. Aim for the "Gemini Web" premium feel.
   - **Structure**:
     a) **Introduction**: State the video title and channel. Briefly summarize the overall objective of the video.
     b) **Major Sections**: Divide the content into 3-4 logically numbered/headquartered sections (e.g., "1. Single Agent Pattern").
     c) **Detailed Bullets**: For each section, use bullet points to explain **Concepts**, **Pros**, **Cons**, or **Key Takeaways**.
     d) **Conclusion/Summary**: Briefly wrap up the video's significance or mention "Next Steps/Future Outlook" if discussed.
   - **Clickable Timestamps (MANDATORY — YouTube responses only)**:
     - For every heading and significant point, you MUST include a clickable timestamp link.
     - **Format**: \`[[MM:SS](BASE_URL&t=SECONDS)]\`
     - **Calculation**: Convert the timestamp from the \`[TRANSCRIPT]\` (e.g., [01:30]) into seconds (e.g., 90) for the \`&t=\` parameter.
     - **Base URL**: Use the EXACT original YouTube URL provided in the context. NEVER fabricate or construct YouTube search URLs (youtube.com/results?...). If no real YouTube URL is available, omit timestamps entirely.
   - **Video Analysis Fallback (NO TRANSCRIPT)**:
     - If \`[TRANSCRIPT]\` is missing but you have \`fileData\` (Direct Video Analysis):
       - You are **watching the video directly**. Do NOT say you are guessing from metadata. Describe what you actually see and hear.
       - Use the SAME structure as the [URL_CONTENT] summary above — EXACTLY. Start DIRECTLY with the **${lbl.summary}** heading; do NOT write any intro sentence before it (no "이 영상은 …를 보여줍니다" preamble).
         **${lbl.summary}**
         > (영상 전체를 1문장으로)

         **${lbl.content}**
         (영상의 흐름·등장 요소·행동·표정·배경·들리는 오디오를 2~4개 불릿 또는 짧은 헤딩으로 설명. 장면이 바뀌는 지점에만 불릿 맨 앞에 \`[MM:SS]\` 표기 — 문장 중간 금지·같은 값 반복 금지, 30초 이하 짧은 클립은 타임스탬프 생략)

         **${lbl.points}**
         - (영상의 핵심 특징 2~4개를 간결하게)
     - If BOTH \`[TRANSCRIPT]\` and \`fileData\` are missing:
       - Summarize using Title/Description but **explicitly but politely** state: "현재 자막 데이터를 직접 추출할 수 없어 영상의 메타데이터와 검색 결과를 바탕으로 요약을 구성했습니다. 실제 영상의 세부 흐름과는 약간의 차이가 있을 수 있습니다."
       - Still aim for a structured format, but without specific timestamps.`;

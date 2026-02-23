import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './lib/supabase.js';
import { API_KEYS, getNextApiKey } from './lib/config.js';
import { searchPill } from './lib/pill-logic.js';


const CHAT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, history, language, attachment, attachments, webContent, session_id } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
  const currentLang = (language && langNames[language]) ? language : 'ko';
  const langName = langNames[currentLang];

  if (API_KEYS.length === 0) {
    res.write(`data: ${JSON.stringify({ error: 'No API keys found in server environment.' })}\n\n`);
    res.end();
    return;
  }

  let systemInstruction = `CRITICAL: YOUR ENTIRE RESPONSE MUST BE IN ${langName.toUpperCase()} ONLY. 
  IF THE USER SPEAKS ANOTHER LANGUAGE (LIKE KOREAN), YOU MUST STILL RESPOND IN ${langName.toUpperCase()}.
  NEVER switch languages. THIS IS YOUR TOP PRIORITY.

  You are Gemini 2.5 Flash, Google's next-generation high-performance AI model. 

  [CORE DIRECTIVE: SOURCE ADHERENCE]
  - If "PROVIDED_SOURCE_TEXT" is provided, it contains the actual content of the URL or ATTACHED DOCUMENT the user is asking about.
  - You MUST prioritize PROVIDED_SOURCE_TEXT over your internal knowledge or general search results for that specific source.
  - If PROVIDED_SOURCE_TEXT contains "[YOUTUBE_VIDEO_INFO]", it is a YouTube video. You are provided with Title, Channel, and Description. **IMPORTANT**: For shorter videos, you also have direct visual/auditory access via a multimodal 'fileUri' in the request parts. If a 'fileUri' part is present, you can "watch" and "listen" to the video directly. If it is NOT present, it means the video is too long or rich enough in metadata for a fast summary—in this case, use the provided Title and Description as your primary source. NEVER say "I cannot analyze video content"; always use the best available information to assist the user.
  - If PROVIDED_SOURCE_TEXT contains "[PAPER INFO]", it's an Arxiv paper. Use the Title, Authors, and Abstract provided.
  - If PROVIDED_SOURCE_TEXT contains "[EXTRACTED_DOCUMENT_CONTENT]", it's the text from a user-uploaded file (Word, TXT, etc.).
  - If PROVIDED_SOURCE_TEXT contains "[VIDEO_ANALYSIS_SUMMARY]", it is a detailed textual description of a previously uploaded video. Use it to maintain continuity.
  - If PROVIDED_SOURCE_TEXT contains "[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT]", it is a document previously uploaded in the current session. Use it as background context for follow-up questions.
  - If PROVIDED_SOURCE_TEXT contains "[CSV DATA CONVERTED TO MARKDOWN TABLE]" or "[XLSX DATA CONVERTED TO MARKDOWN TABLE]", it is a spreadsheet file precisely converted into a Markdown table. You MUST treat this as a structured dataset where row-column relationships are critical for accuracy.
  - If the user asks for a summary or has questions about the source, use PROVIDED_SOURCE_TEXT as the primary basis.
  - If PROVIDED_SOURCE_TEXT is missing, very short, or you need more data (EXCEPT for YouTube), use the 'googleSearch' tool.

  [VIDEO ANALYSIS DIRECTIVE]
  - When analyzing a direct video file (via 'fileUri' or 'fileData'), you MUST provide a comprehensive response that includes a detailed "Visual & Auditory Summary".
  - This summary MUST be structured to be used as future context, describing key events, visual data, and spoken words.
  - This is CRITICAL because the raw video may not be stored; your textual description will be the primary reference for follow-up questions.
  - DO NOT hallucinate details not present in the source or search results.
  
  [FORMATTING & QUALITY]
  - DO NOT output internal thought processes, planning steps, or draft headers (e.g., "| Col | Col |").
  - Output ONLY the final, polished response intended for the user.
  - [NO DUPLICATION RULE]: NEVER output multiple visualization blocks (Chart, Bio, Smiles, Physics) with redundant or identical data in a single response. One high-quality visualization per entity is the goal.
  - Ensure all Markdown syntax (tables, code blocks) is complete and valid.
  - [TABLE STYLE GUIDE]
    - strictly follow the format: | Header | Header |\n| --- | --- |\n| Row | Row |.
    - Keep table headers as SHORT as possible (e.g., use "경기" instead of "경기수", "득점" instead of "득점수").
    - If there are many columns, prioritize compactness.
    - DO NOT USE HTML TAGS (like <br> or <br/>) INSIDE TABLES. They are not supported in this Markdown implementation and will appear as raw text. Use concise text instead.
    - DO NOT USE raw HTML tags anywhere in the response. Use Markdown syntax only.

  - JSON Format (Strict Compliance Required):
    \`\`\`json:chart
    {
      "type": "bar" | "line" | "pie" | "donut" | "scatter" | "radar" | "treemap",
      "title": "Chart Title",
      "data": {
        "categories": ["Jan", "Feb", ...], // Mandatory for bar/line/radar
        "series": [
          { "name": "Series Name", "data": [10, 20, 30] } // numeric array or [{x:v, y:v}] for scatter
        ]
      }
    }
    \`\`\`
  - [Chart Type Guidelines]:
    - **Time-series/Trend** → "line".
    - **Category Comparison** → "bar".
    - **Proportions** → "pie" or "donut".
    - **Correlation** (X vs Y) → "scatter".
    - **Multivariate/Skills** → "radar".
    - **Hierarchical/Size Comparison** → "treemap".
  - DO NOT output the chart JSON if the data is trivial or single-point. Only correspond when visualization adds value.
  - IMPORTANT: The 'data' array inside 'series' should be a simple array of numbers for most charts, but can be objects like {x:v, y:v} for scatter charts. If data is missing for a point, use 0 instead of null.

  [CHEMICAL STRUCTURES]
  - If the user asks for a chemical structure, reaction, or molecule, generate a JSON block with the SMILES code.
  - JSON Format:
    \`\`\`json:smiles
    {
      "smiles": "CCO", 
      "text": "Ethanol"
    }
    \`\`\`
  - Always prefer SMILES for structural representation over ASCII art or Markdown images.

  [BIOLOGICAL VISUALIZATION]
  - Use these for protein/DNA/RNA sequences (1D) or 3D protein structures (PDB).
  - IMPORTANT: Keep "title" as SHORT as possible (e.g., just the name of the protein or ID).
  - PROACTIVE VISUALIZATION: If the user asks for a specific protein (e.g., "Hemoglobin", "Insulin"), you MUST find the representative PDB ID and generate A SINGLE 'bio' JSON block.
  - [SELECTION RULE]: ALWAYS prioritize the 3D PDB view over the 1D sequence. NEVER provide both for the same entity unless the user explicitly asks for "both sequence and 3D structure".
  - For Sequence Viewer (1D):
    \`\`\`json:bio
    {
      "type": "sequence",
      "title": "Insulin A",
      "data": {
        "sequence": "GIVEQCCTSICSLYQLENYCN",
        "name": "Human Insulin",
        "highlights": [
          { "start": 1, "end": 5, "label": "Active Site", "color": "#f87171" }
        ]
      }
    }
    \`\`\`
  - For 3D Protein Structures (PDB):
    \`\`\`json:bio
    {
      "type": "pdb",
      "title": "Crambin",
      "data": {
        "pdbId": "1CRN",
        "name": "Crambin"
      }
    }
    \`\`\`

  [PHYSICS SIMULATION (Phy-Viz)]
  - Use this for classical mechanics, collisions, gravity, or motion simulations.
  - JSON Format:
    \`\`\`json:physics
    {
      "title": "Simulation Title",
      "description": "Short explanation",
      "gravity": { "x": 0, "y": 1 },
      "objects": [
        { 
          "type": "circle" | "rectangle", 
          "x": number, "y": number, 
          "velocity": { "x": number, "y": number },
          "angle": number (radians),
          "angularVelocity": number,
          "label": "Text Label",
          "vectors": [
            { "type": "velocity" | "force" | "custom", "value": { "x": 0, "y": 5 }, "label": "G", "color": "#ff0000" }
          ],
          "radius": number, 
          "width": number, "height": number,
          "color": "hex_code",
          "options": { "isStatic": boolean, "restitution": 0.8, "friction": 0.1 }
        }
      ]
    }
    \`\`\`
  - ILLUSTRATED EXPLAINER: Best for Classical Mechanics. ALWAYS use "label" for naming objects and "vectors" to show forces/velocity arrows. Perfect for projectile motion or collision analysis. MANDATORY for educational clarity.
  - VELOCITY: Use "velocity": { "x": 5, "y": -2 } to make objects move. Essential for collisions.
  - ROTATION: Use "angle" (radians) and "angularVelocity" to make objects spin. Useful for angular momentum conservation.
  - RESTITUTION (Bouncing): Set "restitution": 0.8 or higher in "options" to make objects bounce. Default is 0.6.
  - PROACTIVE PHYSICS: Generate a 2D "Illustrated Explainer" for Classical Mechanics (gravity, momentum, projectile). Note: Complex Fluid Dynamics (buoyancy, water flow) should be kept simple or handled as a schematic in 2D.
  - GRAVITY SCALE: For educational free-fall or projectile simulations, use SLOW MOTION gravity (e.g., "gravity": { "x": 0, "y": 0.3 }) instead of the default 1.0. This makes it easier for users to follow the motion.
  - Global Constants: Canvas coordinate system is 800 (width) x 400 (height).
  - BOUNDARIES: The ground and walls are ALREADY PRE-CONFIGURED and invisible. DO NOT create static rectangles for the ground at y=400.
  
  
  [INCLINED PLANE FORCE DIAGRAM (Diagram-Viz)]
  - Use \`json:diagram\` blocks for clean educational force diagrams (NO physics simulation).
  - This uses pure Canvas 2D rendering for textbook-quality illustrations.
  - Format:
    \`\`\`json:diagram
    {
      "type": "inclined_plane",
      "angle": 30,
      "showBaseline": true,
      "showAngle": true,
      "forces": [
        { "label": "중력 (mg)", "angle": 90, "magnitude": 1.5, "color": "#0066CC" },
        { "label": "수직항력 (N)", "angle": -60, "magnitude": 1.3, "color": "#FFA500" },
        { "label": "평행 분력 (mg sinθ)", "angle": 30, "magnitude": 0.75, "color": "#00CC00" },
        { "label": "수직 분력 (mg cosθ)", "angle": -60, "magnitude": 1.3, "color": "#87CEEB" },
        { "label": "마찰력 (f)", "angle": 210, "magnitude": 0.5, "color": "#FF0000" }
      ]
    }
    \`\`\`
  - "angle": Incline angle in degrees (e.g., 30 for 30°)
  - "forces": Array of force vectors
    * "label": Force name (can include formulas in parentheses)
    * "angle": Direction in degrees (0 = right, 90 = down, -90 = up, 180 = left)
    * "magnitude": Relative length (1.0 = medium arrow)
    * "color": Hex color code
  - Result: Clean diagram with baseline, angle marker, and labeled force vectors.

  [CONSTELLATION VISUALIZATION (Astro-Viz)]
  - Use \`json:constellation\` blocks for star maps and celestial patterns.
  - MANDATORY FIELDS:
    - "stars": Array of { "id": number, "ra": number (hours 0-24), "dec": number (degrees -90 to 90), "mag": number (magnitude), "name"?: string, "constellation"?: string }
    - "constellations": Array of { "id": string, "name": { "ko": string, "en": string, "es": string, "fr": string }, "lines": [[starId1, starId2], ...] }
  - OPTIONAL FIELDS:
    - "center": { "ra": number, "dec": number } for viewport centering
    - "zoom": number (1.0 = default, higher = closer)
  - EXAMPLE OUTPUT for "오리온자리 보여줘":
    \`\`\`json:constellation
    { "stars": [{ "id": 0, "ra": 5.919, "dec": 7.407, "mag": 0.42, "name": "Betelgeuse", "constellation": "ori" }, { "id": 1, "ra": 5.242, "dec": -8.201, "mag": 0.12, "name": "Rigel", "constellation": "ori" }, { "id": 2, "ra": 5.603, "dec": -1.202, "mag": 1.64, "name": "Bellatrix", "constellation": "ori" }, { "id": 3, "ra": 5.533, "dec": -0.299, "mag": 2.23, "name": "Mintaka", "constellation": "ori" }, { "id": 4, "ra": 5.533, "dec": -1.943, "mag": 1.69, "name": "Alnilam", "constellation": "ori" }, { "id": 5, "ra": 5.679, "dec": -1.942, "mag": 1.74, "name": "Alnitak", "constellation": "ori" }, { "id": 6, "ra": 5.415, "dec": -5.909, "mag": 2.06, "name": "Saiph", "constellation": "ori" }], "constellations": [{ "id": "ori", "name": { "ko": "오리온자리", "en": "Orion", "es": "Orión", "fr": "Orion" }, "lines": [[0, 2], [2, 3], [3, 4], [4, 5], [0, 3], [1, 3], [1, 6], [5, 6]] }] }
    \`\`\`
  - PROACTIVE CONSTELLATION: When users ask about constellations, stars, or night sky, automatically generate a constellation visualization using the exact format shown above.

  [DRUG VISUALIZATION]
  - Use \`json:drug\` blocks for medications, including appearance, ingredient, and efficacy.
  - JSON Format:
    \`\`\`json:drug
    {
      "name": "슈다페드정",
      "engName": "Sudafed Tab.",
      "ingredient": "슈도에페드린염산염 60mg",
      "category": "비충혈제거제 (코막힘 완화)",
      "dosage": "1회 1정, 1일 3~4회 식후 복용",
      "image_url": "https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=슈다페드정",
      "pill_visual": {
        "shape": "round" | "oval" | "capsule" | "other",
        "color": "white" | "yellow" | "pink" | "blue" | "green" | "other",
        "imprint_front": "Front marking (e.g., 012, SAMIL)",
        "imprint_back": "Back marking (e.g., blank, PB, or specific text)"
      },
      "efficacy": [
        { "label": "코막힘 완화", "icon": "fa-nose-bubble" },
        { "label": "비염 증상 개선", "icon": "fa-wind" }
      ]
    }
    \`\`\`
  - **PROACTIVE DRUG VISUALIZATION**: For ANY medication-related query (including "summary", "info", "card style", "visualize"), you **MUST** generate the \`json:drug\` block.
  - **PRIORITY RULE**: The \`json:drug\` block is the PRIMARY response. Do NOT generate a Markdown table or a bullet list *INSTEAD* of the JSON block. You can provide text description *AFTER* the JSON block if needed, but the JSON must come first.
  - **DOSAGE CONSISTENCY RULE (CRITICAL)**: Many drugs (e.g., Allegra, Tylenol) have multiple dosage versions (120mg, 180mg, etc.) with DIFFERENT identification data (imprint, size, color).
    - You **MUST** ensure that \`name\`, \`ingredient\`, \`pill_visual\` (imprint/size/color), \`dosage\`, and \`image_url\` ALL belong to the **EXACT SAME dosage version**.
    - **NEVER mix data**: Do NOT use 120mg imprint ("012") with 180mg product name. This is a CRITICAL error.
    - **Selection priority**: If the user doesn't specify dosage, pick the FIRST or MOST COMMON version found in search results, then maintain 100% consistency for that specific version across all fields.
    - **Verification step**: After extracting data, cross-check that the imprint matches the dosage in the product name (e.g., if imprint is "012", ensure the name reflects 120mg version).
  - **MANDATORY IDENTIFICATION RESEARCH (CRITICAL)**: Before generating the JSON, you **MUST** perform a search for the **식별정보** (Identification Info) of the drug, **EVEN IF you already know the drug** (like Tylenol). 
    - You MUST prioritize external search results (ConnectDI, 약학정보원, etc.) for \`pill_visual\` data over your internal training data.
    - NEVER use "null" or leave fields blank for \`imprint\` or \`size\` if the information is publicly available.
    - **Imprint (각인)**: Look for Alphanumeric marking (e.g., "SAMIL / PB", "YH / P 5"). It is usually in the "표시(앞/뒤)" or "마크내용" table row.
    - **Size (크기)**: Look for "장축" (Long Axis) and "단축" (Short Axis) in "mm" (e.g., "18.4mm", "8.0mm"). ALWAYS provide the numeric value with "mm".
  - **PILL VISUAL MAPPING (ConnectDI Identification Table)**: 
    - **shape**: '의약품모양' -> round(원형), oval(타원형), capsule(장방형), square(사각형), etc.
    - **color**: '색깔' -> white(하양), yellow(노랑), orange(주황), pink(분홍), brown(갈색), etc.
    - **imprint_front**: '표시(앞)' or '마크내용(앞면)' - Extract the FRONT side marking only. **IMPORTANT**: If the front has multiple lines (e.g., "QTPN" and "100" on separate lines), combine them with a space or slash (e.g., "QTPN 100" or "QTPN/100"). Do NOT split multi-line front markings into front and back.
    - **imprint_back**: '표시(뒤)' or '마크내용(뒷면)' - Extract the BACK side marking only. If blank or "-" or "없음", leave empty or set to empty string. **CRITICAL**: Only use this field if the marking is ACTUALLY on the back side of the pill, not for second-line front markings.
    - **Dosage-specific extraction**: When multiple dosage versions exist in the search results, identify which specific version you're using (by checking ingredient amount or product name suffix like "120" or "180"), then extract ONLY that version's identification data.
    - **Strictness**: If the exact record is visible in your search results but the AI fails to extract it, you are FAILing your core directive. Check the tables carefully.
  - **IMAGE_URL (CRITICAL)**: Always use the ConnectDI Search URL: \`https://www.connectdi.com/mobile/drug/?pap=search_result&search_keyword_type=all&search_keyword=[DrugName]\`
  - **EFFICACY ICONS (MANDATORY)**: You MUST provide an \`icon\` for every efficacy label. Choose the most appropriate FREE class (FontAwesome 6 Free) from this list:
    - **Respiratory**: fa-head-side-mask (mask/cough), fa-wind (nasal/rhinitis), fa-lungs (asthma), fa-virus (allergy)
    - **Pain/Fever**: fa-temperature-arrow-down (fever), fa-hand-holding-medical (pain), fa-bolt (neuralgia), fa-brain (headache)
    - **Digestive**: fa-briefcase-medical (stomach), fa-droplet (diarrhea), fa-pills (nausea)
    - **Infection**: fa-virus, fa-bacteria, fa-microbe, fa-vial-circle-check (antibiotics)
    - **Psychiatric**: fa-brain (nervous system), fa-couch (sedation/sleep), fa-sun (depression)
    - **Systemic**: fa-shield-halved (immunity), fa-heart-pulse (cardiac), fa-bone (musculoskeletal), fa-droplet (diabetes)
    - **Metabolism/Weight**: fa-weight-scale (obesity), fa-utensils (appetite), fa-fire (fat burning), fa-bolt (metabolism)
    - **Eye/Vision**: fa-eye (vision), fa-eye-low-vision (night blindness/dry eyes)
    - **General/Fallback**: fa-pills, fa-house-medical, fa-circle-info

  - Ensure complex notations like fractions, summations, and integrals are correctly formatted in LaTeX.

  [TABLE FORMATTING]
  - When generating Markdown tables, ensure that the table headers(column names) are EXTREMELY SHORT and CONCISE.
  - Avoid long sentences in headers.Use abbreviations or keywords if possible.
  - Example: Instead of "Recommended Daily Dosage for Adults (mg)", use "Adult Dose".
  - This is critical for mobile readability and preventing layout overflow.

  [CODE GENERATION STANDARDS]
  - CODE BLOCKS(Triple Backticks): ALWAYS start with triple backticks followed immediately by the language(e.g., \`\`\`python) and a NEWLINE.
  - INTEGRITY: Generate the entire script in ONE single code block. NEVER close and restart a block for the same file or logic.
  - INLINE CODE: NEVER include language names or colons (e.g., use \`print()\` instead of \`python:print()\`). Use ONLY for fragments.
  - Formatting: Ensure proper indentation (2-4 spaces) and latest stable syntax. Mandatory filename (e.g., app.tsx) as tag if applicable.
  - NO HTML: NEVER use <br> or other HTML tags inside code blocks.

  [RESPONSE COMPLETENESS]
  - You MUST complete your response fully. NEVER leave a code block, table, or sentence unfinished.
  - If a response is long, DO NOT summarize it if it compromises the completeness of the code or data. Priority is on FULL SCRIPT generation.
  - Avoid redundant visualization blocks for the same entity.
  - Be concise and efficient with your tokens.
  
  [LANGUAGE ENFORCEMENT]
  - THE USER HAS SELECTED ${langNames[currentLang]} AS THE PREFERRED LANGUAGE.
  - YOU MUST RESPOND IN ${langNames[currentLang]} REGARDLESS OF THE INPUT LANGUAGE.
  - THIS IS A HARD CONSTRAINT. DO NOT SWITCH TO THE USER'S INPUT LANGUAGE.
  
  [PILL IMAGE IDENTIFICATION — MANDATORY PROTOCOL]
  If "PROVIDED_PILL_DATA" is present, use it as the definitive source for drug information:
  1. match_type: 'exact' -> This is the confirmed drug. Use its data for the json:drug block.
  2. match_type: 'imprint_only' or 'similar' -> These are candidates. List them and add a warning: "The identification is based on visual similarity and may not be exact."
  3. match_type: 'none' -> Inform the user that the pill could not be identified in the database and provide the Pharm.or.kr link.
  4. CRITICAL: If PROVIDED_PILL_DATA is 'none', you MUST NOT guess any drug name from your knowledge. Just say "DB에서 일치하는 정보를 찾지 못했습니다" and show what attributes you identified.
  5. VISUAL VERIFICATION: If the candidates' color or shape in PROVIDED_PILL_DATA fundamentally contradict the user's image, reject them and prioritize safety.
  6. NEVER hypothesize about a drug name if PROVIDED_PILL_DATA is present but has no exact match. Only provide the candidates.`;



  if (webContent) {
    systemInstruction += `\n\n[PROVIDED_SOURCE_TEXT]\n${webContent} `;
  }

  const contents: any[] = history
    .filter((msg: any) => msg.content && msg.content.trim() !== "" && msg.role !== 'system')
    .slice(-10)
    .map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

  let userParts: any[] = [{ text: prompt }];

  // YouTube Smart Hybrid Logic
  const ytRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
  const ytMatch = prompt.match(ytRegex) || (webContent && webContent.match(ytRegex));
  if (ytMatch) {
    const normalizedYtUrl = `https://www.youtube.com/watch?v=${ytMatch[1]}`;
    userParts.push({ fileData: { fileUri: normalizedYtUrl, mimeType: 'video/mp4' } });
  }

  // Handle attachments (multi-attachment support)
  const allAttachments = attachments && Array.isArray(attachments) ? attachments : (attachment ? [attachment] : []);

  // Supported Gemini Multimodal MIME types
  const supportedMimeTypes = [
    'image/', 'video/', 'audio/', 'application/pdf'
  ];

  for (const att of allAttachments) {
    if (att && att.data && att.mimeType) {
      // Skip unsupported types (like Excel, Word) - they are already handled via webContent/extractedText
      const isSupported = supportedMimeTypes.some(type => att.mimeType.startsWith(type));
      if (!isSupported) continue;

      const isPublicUrl = att.data.startsWith('http');
      const isVideo = att.mimeType.startsWith('video/');

      if (isPublicUrl && isVideo) {
        // Supabase Storage URL for video - Gemini handles via fileUri (if supported/proxied)
        userParts.push({ fileData: { fileUri: att.data, mimeType: att.mimeType } });
      } else if (isPublicUrl) {
        // 이미지나 문서는 외부 URL을 직접 지원하지 않으므로 백엔드에서 fetch하여 base64로 전달
        try {
          const fetchRes = await fetch(att.data);
          if (fetchRes.ok) {
            const arrayBuffer = await fetchRes.arrayBuffer();
            const base64 = Buffer.from(arrayBuffer).toString('base64');
            userParts.push({ inlineData: { data: base64, mimeType: att.mimeType } });
          }
        } catch (e) {
          console.error('[Chat API] Failed to fetch external attachment:', att.data, e);
        }
      } else {
        const base64Data = att.data.includes(',') ? att.data.split(',')[1] : att.data;
        userParts.push({ inlineData: { data: base64Data, mimeType: att.mimeType } });
      }
    }
  }

  contents.push({ role: 'user', parts: userParts });

  // --- [Phase 2] Pill Identification Preprocessing ---
  const pillKeywords = ['약', '알약', '약품', '정', '캡슐', '명칭', '식별', '이거 뭔', '무슨 약', '이게 뭐야'];
  const hasPillKeyword = pillKeywords.some(k => prompt.includes(k));
  const hasImage = allAttachments.some(att => att.mimeType.startsWith('image/'));

  if (hasPillKeyword && hasImage) {
    let pillPreprocessingSuccess = false;
    try {
      console.log('[Chat API] Pill identification request detected. Starting Vision preprocessing...');

      const visionPrompt = `You are a pharmaceutical pill identification expert. Carefully examine the pill in the image and extract its visual characteristics.

CRITICAL INSTRUCTIONS for imprint reading:
- Read ALL characters exactly as they appear, preserving case (uppercase/lowercase)
- Logos made of combined letters (e.g., "dHP", "dP", "BI", "MSD") should be read as a single imprint string
- Do NOT split letters that are physically connected or part of a logo
- If you see a stylized logo, describe each letter you can identify in order (left-to-right, top-to-bottom)
- Hyphens, slashes, and numbers after letters (e.g., "J 80", "M 5") should be included in the imprint field

Return ONLY a JSON object in this exact format, no other text:
{
  "imprint_front": "exact characters visible on front face, or null if none",
  "imprint_back": "exact characters visible on back face, or null if none",
  "color": "one of: 하양, 노랑, 주황, 분홍, 빨강, 갈색, 연두, 초록, 청록, 파랑, 남색, 보라, 회색, 검정",
  "shape": "one of: 원형, 타원형, 장방형, 삼각형, 사각형, 마름모형, 오각형, 육각형, 팔각형, 기타",
  "confidence": "high|medium|low"
}`;

      const imageAtt = allAttachments.find(att => att.mimeType.startsWith('image/'));
      if (!imageAtt) throw new Error('No image attachment found');

      let visionParts: any[] = [{ text: visionPrompt }];
      if (imageAtt.data.startsWith('http')) {
        const fetchRes = await fetch(imageAtt.data);
        if (fetchRes.ok) {
          const arrayBuffer = await fetchRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString('base64');
          visionParts.push({ inlineData: { data: base64, mimeType: imageAtt.mimeType } });
        }
      } else {
        const base64Data = imageAtt.data.includes(',') ? imageAtt.data.split(',')[1] : imageAtt.data;
        visionParts.push({ inlineData: { data: base64Data, mimeType: imageAtt.mimeType } });
      }

      // 모든 키를 순환하며 Vision 전처리 시도 (단일 키 의존 제거)
      const visionModels = ['gemini-2.5-flash-lite', 'gemini-2.5-flash'];
      let visionText = '';
      let visionSucceeded = false;

      outerLoop:
      for (const visionModel of visionModels) {
        for (let k = 0; k < API_KEYS.length; k++) {
          const apiKey = getNextApiKey();
          if (!apiKey) continue;
          try {
            const ai = new GoogleGenAI({ apiKey });
            const visionResult = await ai.models.generateContent({
              model: visionModel,
              contents: [{ role: 'user', parts: visionParts }]
            });
            visionText = visionResult.text || '';
            visionSucceeded = true;
            console.log(`[Chat API] Vision preprocessing succeeded with model: ${visionModel}`);
            break outerLoop;
          } catch (vErr: any) {
            console.warn(`[Chat API] Vision attempt failed (Model=${visionModel}, Key=${k}): ${vErr?.message?.slice(0, 80)}`);
          }
        }
      }

      if (!visionSucceeded) throw new Error('All Vision API attempts failed');

      const jsonMatch = visionText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const pillInfo = JSON.parse(jsonMatch[0]);
        console.log('[Chat API] Extracted pill info:', pillInfo);

        if (pillInfo.imprint_front || (pillInfo.color && pillInfo.shape)) {
          const searchResult = await searchPill({
            imprint_front: pillInfo.imprint_front,
            imprint_back: pillInfo.imprint_back,
            color: pillInfo.color,
            shape: pillInfo.shape
          });

          if (searchResult && searchResult.filteredResults.length > 0) {
            console.log(`[Chat API] Pharm.or.kr search result: ${searchResult.match_type}, count: ${searchResult.filteredResults.length}`);

            let pillDataText = `\n\n[PROVIDED_PILL_DATA]\nmatch_type: ${searchResult.match_type}\nVision extracted: imprint=${pillInfo.imprint_front}, color=${pillInfo.color}, shape=${pillInfo.shape}\n`;
            searchResult.filteredResults.forEach((r, idx) => {
              pillDataText += `Candidate ${idx + 1}:\n`;
              pillDataText += `- Name: ${r.product_name}\n`;
              pillDataText += `- Company: ${r.company}\n`;
              pillDataText += `- Imprint: ${r.front_imprint} / ${r.back_imprint}\n`;
              pillDataText += `- Color: ${r.color}\n`;
              pillDataText += `- Shape: ${r.shape}\n`;
              pillDataText += `- Image: ${r.thumbnail}\n`;
              pillDataText += `- Detail URL: ${r.detail_url}\n`;
            });

            systemInstruction += pillDataText;
          } else {
            systemInstruction += `\n\n[PROVIDED_PILL_DATA]\nmatch_type: none\nVision extracted: imprint=${pillInfo.imprint_front}, color=${pillInfo.color}, shape=${pillInfo.shape}\nNo matching drug found in Pharm.or.kr database.`;
          }
          pillPreprocessingSuccess = true;
        }
      }
    } catch (e) {
      console.error('[Chat API] Pill preprocessing failed:', e);
    }

    // 전처리 실패 시 → AI에게 명시적 경고 주입 (추측/할루시네이션 강력 차단)
    if (!pillPreprocessingSuccess) {
      systemInstruction += `\n\n[PILL_DB_LOOKUP_FAILED]\n약학정보원 DB 조회가 실패했습니다.\n이 경우 반드시 다음 지침을 따르세요:\n1. 어떤 약품명도 단언하거나 추측해서는 안 됩니다.\n2. 이미지에서 보이는 색상, 모양, 각인 등 시각적 특성만 설명하세요.\n3. "정확한 식별을 위해 약사 또는 의사에게 문의하거나, 약학정보원(www.pharm.or.kr)에서 직접 검색하세요"라고 안내하세요.\n4. 절대로 json:drug 블록을 생성해서는 안 됩니다.`;
    }
  }

  const isYoutubeRequest = !!ytMatch;

  // Supabase: User 메시지 즉시 저장 (비동기)
  if (session_id) {
    const mainAttachment = allAttachments.length > 0 ? allAttachments[0] : null;
    supabase.from('chat_messages').insert({
      session_id,
      role: 'user',
      content: prompt,
      attachment_url: mainAttachment?.data && mainAttachment.data.startsWith('http') ? mainAttachment.data : (mainAttachment?.mimeType || null)
    }).then(({ error }) => {
      if (error) console.error('[Chat API] User message save error:', error);
    });
  }

  // Failover Loop
  let lastError = 'No attempts made';
  for (const currentModel of CHAT_MODELS) {
    for (let k = 0; k < API_KEYS.length; k++) {
      const apiKey = getNextApiKey();
      if (!apiKey) continue;

      try {
        const ai = new GoogleGenAI({ apiKey });
        const result = await ai.models.generateContentStream({
          model: currentModel,
          contents,
          config: {
            systemInstruction: {
              parts: [{ text: systemInstruction }]
            },
            tools: (isYoutubeRequest ? [] : [{ googleSearch: {} }]) as any,
            temperature: 0.2,
            topP: 0.8,
            topK: 40,
            maxOutputTokens: 8192
          } as any
        });

        let fullAiResponse = '';
        const allSources: any[] = [];
        for await (const chunk of result) {
          const chunkText = chunk.text;
          if (chunkText) {
            // Remove excessive spaces (likely hallucination or bad formatting)
            const sanitizedText = chunkText.replace(/ {10,}/g, ' ');
            fullAiResponse += sanitizedText;
            res.write(`data: ${JSON.stringify({ text: sanitizedText })}\n\n`);
          }

          // [CITATIONS] Grounding Metadata 추출 및 전송
          const metadata = chunk.candidates?.[0]?.groundingMetadata;
          if (metadata && metadata.groundingChunks) {
            const sources = metadata.groundingChunks
              .map((gc: any) => gc.web ? { title: gc.web.title, uri: gc.web.uri } : null)
              .filter(Boolean);

            if (sources.length > 0) {
              // 중복 제거 및 누적
              sources.forEach((s: any) => {
                if (!allSources.some(existing => existing.uri === s.uri)) {
                  allSources.push(s);
                }
              });
              res.write(`data: ${JSON.stringify({ sources })}\n\n`);
            }
          }
        }


        // Supabase: AI 응답 저장 (동기적으로 대기하여 저장 보장)
        if (session_id && fullAiResponse) {
          try {
            const { error: msgError } = await supabase.from('chat_messages').insert({
              session_id,
              role: 'assistant',
              content: fullAiResponse,
              grounding_sources: allSources.length > 0 ? allSources : null
            });
            if (msgError) throw msgError;

            await supabase.from('chat_sessions')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', session_id);
          } catch (e) {
            console.error('[Chat API] Assistant message save error:', e);
          }
        }
        res.end();
        return;
      } catch (error: any) {
        lastError = error.message || String(error);
        console.error(`Attempt failed: Model=${currentModel}, KeyIndex=${k}, Error=${lastError}`);
      }
    }
  }

  res.write(`data: ${JSON.stringify({ error: `All attempts failed. Last error: ${lastError}` })}\n\n`);
  res.end();
}

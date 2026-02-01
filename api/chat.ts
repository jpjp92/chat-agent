import { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';
import { supabase } from './lib/supabase.js';
import { API_KEYS, getNextApiKey } from './lib/config.js';

const CHAT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt, history, language, attachment, webContent, session_id } = req.body;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const langNames: any = { ko: 'Korean', en: 'English', es: 'Spanish', fr: 'French' };
  const currentLang = language || 'ko';

  if (API_KEYS.length === 0) {
    res.write(`data: ${JSON.stringify({ error: 'No API keys found in server environment.' })}\n\n`);
    res.end();
    return;
  }

  let systemInstruction = `CRITICAL: YOUR ENTIRE RESPONSE MUST BE IN ${langNames[currentLang].toUpperCase()} ONLY. 
  IF THE USER SPEAKS ANOTHER LANGUAGE (LIKE KOREAN), YOU MUST STILL RESPOND IN ${langNames[currentLang].toUpperCase()}.
  NEVER switch languages. THIS IS YOUR TOP PRIORITY.

  You are Gemini 2.5 Flash, Google's next-generation high-performance AI model. 

  [CORE DIRECTIVE: SOURCE ADHERENCE]
  - If "PROVIDED_SOURCE_TEXT" is provided, it contains the actual content of the URL or ATTACHED DOCUMENT the user is asking about.
  - You MUST prioritize PROVIDED_SOURCE_TEXT over your internal knowledge or general search results for that specific source.
  - If PROVIDED_SOURCE_TEXT contains "[YOUTUBE_VIDEO_INFO]", it is a YouTube video. You are provided with Title, Channel, and Description. **IMPORTANT**: For shorter videos, you also have direct visual/auditory access via a multimodal 'fileUri' in the request parts. If a 'fileUri' part is present, you can "watch" and "listen" to the video directly. If it is NOT present, it means the video is too long or rich enough in metadata for a fast summary—in this case, use the provided Title and Description as your primary source. NEVER say "I cannot analyze video content"; always use the best available information to assist the user.
  - If PROVIDED_SOURCE_TEXT contains "[PAPER INFO]", it's an Arxiv paper. Use the Title, Authors, and Abstract provided.
  - If PROVIDED_SOURCE_TEXT contains "[EXTRACTED_DOCUMENT_CONTENT]", it's the text from a user-uploaded file (Word, TXT, etc.).
  - If PROVIDED_SOURCE_TEXT contains "[PREVIOUSLY_UPLOADED_DOCUMENT_CONTENT]", it is a document previously uploaded in the current session. Use it as background context for follow-up questions.
  - If PROVIDED_SOURCE_TEXT contains "[CSV DATA CONVERTED TO MARKDOWN TABLE]" or "[XLSX DATA CONVERTED TO MARKDOWN TABLE]", it is a spreadsheet file precisely converted into a Markdown table. You MUST treat this as a structured dataset where row-column relationships are critical for accuracy.
  - If the user asks for a summary or has questions about the source, use PROVIDED_SOURCE_TEXT as the primary basis.
  - If PROVIDED_SOURCE_TEXT is missing, very short, or you need more data (EXCEPT for YouTube), use the 'googleSearch' tool.
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

  - Ensure complex notations like fractions, summations, and integrals are correctly formatted in LaTeX.

  [TABLE FORMATTING]
  - When generating Markdown tables, ensure that the table headers (column names) are EXTREMELY SHORT and CONCISE.
  - Avoid long sentences in headers. Use abbreviations or keywords if possible.
  - Example: Instead of "Recommended Daily Dosage for Adults (mg)", use "Adult Dose".
  - This is critical for mobile readability and preventing layout overflow.

  [CODE GENERATION STANDARDS]
  - ALWAYS use triple backticks followed by the explicit language name (e.g., python, tsx, css, bash).
  - Modern Syntax: Use the latest stable standards (e.g., ES6+ for JavaScript, Python 3.10+ with type hints).
  - Clean Structure: Mandatory proper indentation and meaningful variable naming.
  - Minimalist Commenting: Use concise, professional comments for complex logic only. Avoid commenting on obvious code.
  - Formatting: Ensure the code is polished, complete, and optimized for high-quality syntax highlighting.

  [RESPONSE COMPLETENESS]
  - You MUST complete your response fully.
  - If the content is extensive, prioritize summarization over exhaustiveness to ensure the output is not cut off.
  - NEVER leave a Markdown table or sentence unfinished.
  - Avoid redundant visualization blocks for the same entity.
  - Be concise and efficient with your tokens.
  
  [LANGUAGE ENFORCEMENT]
  - THE USER HAS SELECTED ${langNames[currentLang]} AS THE PREFERRED LANGUAGE.
  - YOU MUST RESPOND IN ${langNames[currentLang]} REGARDLESS OF THE INPUT LANGUAGE.
  - THIS IS A HARD CONSTRAINT. DO NOT SWITCH TO THE USER'S INPUT LANGUAGE.`;

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

  if (attachment && attachment.data) {
    const base64Data = attachment.data.includes(',') ? attachment.data.split(',')[1] : attachment.data;
    userParts.push({ inlineData: { data: base64Data, mimeType: attachment.mimeType } });
  }
  contents.push({ role: 'user', parts: userParts });

  const isYoutubeRequest = !!ytMatch;

  // Supabase: User 메시지 즉시 저장 (비동기)
  if (session_id) {
    supabase.from('chat_messages').insert({
      session_id,
      role: 'user',
      content: prompt,
      attachment_url: attachment?.data && attachment.data.startsWith('http') ? attachment.data : (attachment?.mimeType || null)
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

import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split('\n').filter(l=>/^[A-Z_0-9]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,'')]}));
const ai = new GoogleGenAI({ apiKey: env.API_KEY_TIER1 });
const M = process.argv[2] || 'gemini-3.8-flash';
const run = async (label, config, contents = '한 문장으로 자기소개해줘.', extra = {}) => {
  const t0 = Date.now();
  try {
    const r = await ai.models.generateContent({ model: M, contents, config, ...extra });
    const txt = (r.text || '').replace(/\s+/g,' ').slice(0, 60);
    const g = r.candidates?.[0]?.groundingMetadata?.groundingChunks?.length ?? 0;
    const fc = r.functionCalls?.map(f => f.name).join(',') || '';
    console.log(`✅ ${label.padEnd(26)} ${Date.now()-t0}ms think=${r.usageMetadata?.thoughtsTokenCount ?? 0} out=${r.usageMetadata?.candidatesTokenCount ?? 0} ground=${g} fc=${fc} | ${txt}`);
  } catch (e) { console.log(`❌ ${label.padEnd(26)} ${Date.now()-t0}ms ${String(e.message).slice(0, 120)}`); }
};
if (!process.argv[3]) {
await run('기본', {});
for (const lv of ['minimal', 'low', 'medium', 'high']) await run(`thinkingLevel=${lv}`, { thinkingConfig: { thinkingLevel: lv } });
await run('thinkingBudget=0', { thinkingConfig: { thinkingBudget: 0 } });
await run('thinkingBudget=512', { thinkingConfig: { thinkingBudget: 512 } });
await run('google_search', { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: 'low' } }, '오늘 서울 날씨 한 줄로');
await run('function call', { thinkingConfig: { thinkingLevel: 'low' }, tools: [{ functionDeclarations: [{ name: 'get_weather', description: '도시 날씨 조회', parameters: { type: 'OBJECT', properties: { city: { type: 'STRING' } }, required: ['city'] } }] }] }, '부산 날씨 알려줘');
}
const img = fs.readFileSync(process.argv[3]);
await run('inline image', { thinkingConfig: { thinkingLevel: 'low' } }, [{ role: 'user', parts: [{ text: '두 알약 중 각인·로고가 새겨진 알약의 각인을 판독해줘. 결과만.' }, { inlineData: { mimeType: 'image/jpeg', data: img.toString('base64') } }] }]);

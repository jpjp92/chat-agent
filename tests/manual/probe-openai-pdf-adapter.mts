/**
 * GPT PDF — **앱 어댑터 그대로** 실측 (generateOpenAIChat → input_file)
 *
 *   node --conditions=react-server --env-file=.env.local --import tsx tests/manual/probe-openai-pdf-adapter.mts [--model=gpt-6-luna]
 *
 * probe-openai-pdf.mts 는 요청 본문을 손으로 만든다. 이건 history 가 만드는 part 모양
 * (fileData / image_url data URI)을 어댑터에 넣어 **실제 변환 경로**를 잰다(DEV_261011 §1).
 * 파일은 dev Storage 기존 객체(업로드 없음). 키는 출력하지 않는다.
 */
import { HumanMessage, AIMessage } from '@langchain/core/messages';
import { generateOpenAIChat } from '../../server/openai/chat';
import { isOpenAIFileFetchError } from '../../server/openai/media';

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const MODEL = process.argv.find(a => a.startsWith('--model='))?.slice(8) ?? 'gpt-6-luna';
const MB = 1024 * 1024;

const ls = async (prefix: string) => (await (await fetch(`${BASE}/storage/v1/object/list/chat-docs`, {
    method: 'POST', headers: { Authorization: `Bearer ${SR}`, apikey: SR, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix, limit: 200, sortBy: { column: 'created_at', order: 'desc' } }),
})).json()) as any[];
const pdfs: { path: string; size: number }[] = [];
for (const o of await ls('')) {
    if (o.id && o.metadata?.mimetype === 'application/pdf') pdfs.push({ path: o.name, size: o.metadata.size });
    else if (!o.id) for (const c of await ls(o.name)) if (c.metadata?.mimetype === 'application/pdf') pdfs.push({ path: `${o.name}/${c.name}`, size: c.metadata.size });
}
const pub = (p: string) => `${BASE}/storage/v1/object/public/chat-docs/${p.split('/').map(encodeURIComponent).join('/')}`;
const mid = pdfs.find(p => p.size > 1.9 * MB && p.size < 2.4 * MB);
const small = pdfs.find(p => p.size > 100 * 1024 && p.size < MB);
const big = pdfs.find(p => p.size > 8 * MB);

const text = (t: string) => ({ type: 'text', text: t });
const fileData = (uri: string) => ({ fileData: { fileUri: uri, mimeType: 'application/pdf' } });

const cases: [string, any[]][] = [];
if (mid) cases.push([`업로드 ${(mid.size / MB).toFixed(2)}MB "분석"(장문)`, [new HumanMessage({ content: [text('분석'), fileData(pub(mid.path))] })]]);
if (mid) cases.push(['같은 문서 멀티턴 후속', [
    new HumanMessage({ content: [text('분석'), fileData(pub(mid.path))] }),
    new AIMessage('이 문서는 데이터바우처 수행계획서입니다.'),
    new HumanMessage('사업 추진일정을 표로 정리해줘'),
]]);
if (small) {
    const b64 = Buffer.from(await (await fetch(pub(small.path))).arrayBuffer()).toString('base64');
    cases.push([`인라인 ${(small.size / MB).toFixed(2)}MB`, [new HumanMessage({ content: [text('핵심 3줄 요약'), { type: 'image_url', image_url: { url: `data:application/pdf;base64,${b64}` } }] })]]);
}
if (big) cases.push([`업로드 ${(big.size / MB).toFixed(1)}MB`, [new HumanMessage({ content: [text('핵심 3줄 요약'), fileData(pub(big.path))] })]]);
cases.push(['PDF 링크 arXiv', [new HumanMessage({ content: [text('핵심 3줄 요약'), fileData('https://arxiv.org/pdf/1706.03762')] })]]);
cases.push(['PDF 링크 doi 리다이렉트', [new HumanMessage({ content: [text('제목 한 줄'), fileData('https://doi.org/10.48550/arXiv.1706.03762')] })]]);
cases.push(['받을 수 없는 링크', [new HumanMessage({ content: [text('요약'), fileData('https://example.com/not-here.pdf')] })]]);

const rows: any[] = [];
for (const [label, messages] of cases) {
    const t = Date.now();
    try {
        const r = await generateOpenAIChat({
            model: MODEL, messages, instructions: '사용자가 첨부한 문서를 한국어 마크다운으로 답한다. 표가 적절하면 표를 쓴다.',
            useWebSearch: false, maxOutputTokens: 16384,
        });
        const lines = r.text.split('\n');
        const table = lines.filter(l => l.trim().startsWith('|')).length;
        const sep = lines.some(l => /^\s*\|?\s*:?-{3,}/.test(l));
        const dup = lines.some((l, i) => l.trim().startsWith('|') && l === lines[i + 1]);
        rows.push({ case: label, sec: ((Date.now() - t) / 1000).toFixed(1), result: '✅', chars: r.text.length, table: table ? `${table}줄${sep ? '' : ' ⚠️구분선없음'}${dup ? ' ⚠️반복' : ''}` : '-' });
    } catch (e: any) {
        rows.push({ case: label, sec: ((Date.now() - t) / 1000).toFixed(1), result: `❌ ${e.status ?? ''} ${String(e.message).slice(0, 50)}`, chars: 0, table: isOpenAIFileFetchError(e) ? '→ 2.5 재시도 대상' : '' });
    }
    console.log(JSON.stringify(rows.at(-1)));
}
console.log(`\nmodel=${MODEL}`);
console.table(rows);

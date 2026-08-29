/**
 * 회귀 스윕 — `npx tsx tests/manual/sweep-citation-regression.mts [시간]`
 *
 * 최근 N시간의 어시스턴트 답변에서 본문에 노출된 grounding redirect URL 을 센다.
 * 마커(`](url)`)는 정상이고, 그 밖의 등장은 전부 버그다(DEV_260829).
 * 배포 후 상시 감시용. Supabase 자격증명이 필요해 `npm test` 에는 넣지 않는다.
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const hours = Number(process.argv[2] || 24);
const since = new Date(Date.now() - hours * 3600_000).toISOString();

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.from('chat_messages')
    .select('id,session_id,created_at,content')
    .eq('role', 'assistant').gte('created_at', since)
    .order('created_at', { ascending: true });
if (error) { console.error('DB:', error.message); process.exit(1); }

const count = (t: string, re: RegExp) => (t.match(re) || []).length;
const seen = new Map<string, number>();
let bad = 0;
for (const m of data ?? []) {
    const markers = count(m.content, /\]\(https:\/\/vertexaisearch/g);
    const exposed = count(m.content, /vertexaisearch/g) - markers;
    const turn = (seen.get(m.session_id) ?? 0) + 1;
    seen.set(m.session_id, turn);
    if (markers === 0 && exposed === 0) continue;
    if (exposed > 0) bad++;
    console.log(`${exposed > 0 ? '🔴' : '  '} ${m.created_at.slice(5, 16)} | 턴 ${turn} | 마커 ${String(markers).padStart(3)} | 노출 ${exposed}`);
}
console.log(`\n최근 ${hours}h · 어시스턴트 ${data?.length ?? 0}건 · 노출 있는 답변 ${bad}건`);
process.exit(bad === 0 ? 0 : 1);

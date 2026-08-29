/**
 * 실데이터 확인 — `npx tsx tests/manual/check-real-broken-citation.mts`
 *
 * 2026-08-24 세션(6bd6817b)에서 화면에 생 URL 이 노출된 그 답변을 DB 에서 꺼내
 * `stripBareGroundingUrls` 가 마커는 남기고 맨 괄호 URL 만 지우는지 확인한다.
 * (수동 하니스 — Supabase 자격증명이 필요해 `npm test` 에는 넣지 않는다)
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { stripBareGroundingUrls } from '../../server/agent/gemini-citations.js';

const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data, error } = await db.from('chat_messages')
    .select('content').eq('id', 'a18bbfc0-c0dd-4b60-97ae-3ef8dc495702').single();
if (error) { console.error('DB:', error.message); process.exit(1); }

const before: string = (data as any).content;
const after = stripBareGroundingUrls(before);
const count = (t: string, re: RegExp) => (t.match(re) || []).length;

console.log('before | 마커', count(before, /\]\(https:\/\/vertexaisearch/g),
    '· 노출 URL', count(before, /vertexaisearch/g) - count(before, /\]\(https:\/\/vertexaisearch/g));
console.log('after  | 마커', count(after, /\]\(https:\/\/vertexaisearch/g),
    '· 노출 URL', count(after, /vertexaisearch/g) - count(after, /\]\(https:\/\/vertexaisearch/g));
console.log('본문 발췌:', after.slice(0, 300).replace(/https:\/\/vertexaisearch[^)]*/g, '…').replace(/\n/g, ' '));

const ok = count(after, /vertexaisearch/g) === count(after, /\]\(https:\/\/vertexaisearch/g)
    && count(after, /\]\(https:\/\/vertexaisearch/g) === count(before, /\]\(https:\/\/vertexaisearch/g);
console.log(ok ? '\n🟢 마커는 전부 보존 · 노출 URL 0' : '\n🔴 실패');
process.exit(ok ? 0 : 1);

/**
 * `Message.image` 하위호환 필드 제거 가능 여부 확인 — `npx tsx tests/manual/check-legacy-image-field.mts`
 *
 * `types.ts` 의 `image?: MessageAttachment` 는 "하위 호환성을 위해 유지" 주석과 함께 남아 있고
 * `ChatMessage.tsx` 가 `attachment || image` 로 읽는다. 코드만 보면 지워도 될 것 같지만,
 * **DB 에 옛 레코드가 있으면 살아 있는 코드**다 — 지우면 과거 대화의 이미지가 사라진다.
 * 그래서 실제 스키마와 데이터를 보고 판단한다.
 *
 * Supabase 자격증명이 필요해 `npm test` 에는 넣지 않는다(tests/README 의 ⓐ 기준).
 */
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trim().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })
);

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1) 실제 컬럼 목록 — 문서(REF_DB.md)가 아니라 DB 자신에게 묻는다
const { data: sample, error } = await db.from('chat_messages').select('*').limit(1);
if (error) { console.error('DB:', error.message); process.exit(1); }

const columns = Object.keys(sample?.[0] ?? {});
console.log('chat_messages 실제 컬럼:', columns.join(', ') || '(행 없음 — 컬럼 확인 불가)');
const hasImageColumn = columns.includes('image');
console.log(`  image 컬럼 존재: ${hasImageColumn ? '🔴 있음' : '✅ 없음'}`);

// 2) 첨부가 있는 메시지가 어떻게 저장돼 있는지
const { count: total } = await db.from('chat_messages').select('*', { count: 'exact', head: true });
const { count: withAttachment } = await db.from('chat_messages')
    .select('*', { count: 'exact', head: true }).not('attachment_url', 'is', null);

console.log(`\n메시지 ${total ?? 0}건 · attachment_url 있는 메시지 ${withAttachment ?? 0}건`);

// 3) image 컬럼이 있다면 실제로 값이 든 행이 있는지까지 본다
if (hasImageColumn) {
    const { count: withImage } = await db.from('chat_messages')
        .select('*', { count: 'exact', head: true }).not('image', 'is', null);
    console.log(`  image 값이 있는 행: ${withImage ?? 0}건`);
}

console.log(
    hasImageColumn
        ? '\n🔴 image 컬럼이 존재한다 — 값이 든 행이 있으면 필드를 지우면 안 된다.'
        : '\n✅ image 컬럼이 없다 — DB 에서 image 가 실린 메시지가 올 경로가 없다.',
);

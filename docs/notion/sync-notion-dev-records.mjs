#!/usr/bin/env node
/**
 * sync-notion-dev-records.mjs
 * 최근 git 커밋을 읽어서 Notion DEV Records DB에 레코드를 생성합니다.
 *
 * 사용법:
 *   node docs/notion/sync-notion-dev-records.mjs                    # 오늘 커밋 전체
 *   node docs/notion/sync-notion-dev-records.mjs --last 5           # 최근 N개
 *   node docs/notion/sync-notion-dev-records.mjs --after 2026-05-07 # 특정 날짜 이후 전체
 *   node docs/notion/sync-notion-dev-records.mjs --dry-run          # 실제 업로드 없이 미리보기
 */

import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@notionhq/client';

// .env / .env.local 로드
const __dir = dirname(fileURLToPath(import.meta.url));
for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(__dir, '../..', envFile), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

// ── 설정 ──────────────────────────────────────────────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DEV_RECORDS_DB_ID;

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}
if (!DATABASE_ID) {
  console.error('❌ NOTION_DEV_RECORDS_DB_ID 환경변수가 없습니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });

// ── 인자 파싱 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const lastIdx = args.indexOf('--last');
const lastN = lastIdx !== -1 ? parseInt(args[lastIdx + 1], 10) : null;
const afterIdx = args.indexOf('--after');
const afterDate = afterIdx !== -1 ? args[afterIdx + 1] : null;

// ── 커밋 파싱 ─────────────────────────────────────────────────────────────────
function getCommits() {
  const format = '--format=%H|%ai|%s|%b';
  let gitArgs;
  if (lastN) {
    gitArgs = ['log', format, `-${lastN}`];
  } else if (afterDate) {
    gitArgs = ['log', format, `--after=${afterDate} 00:00:00`];
  } else {
    const today = new Date().toISOString().split('T')[0];
    gitArgs = ['log', format, `--after=${today} 00:00:00`];
  }

  const result = spawnSync('git', gitArgs, { encoding: 'utf-8' });
  if (result.error) throw result.error;
  const output = result.stdout.trim();
  if (!output) return [];

  return output.split('\n').map(line => {
    const [hash, dateStr, subject, ...bodyParts] = line.split('|');
    return {
      hash: hash?.substring(0, 8),
      date: dateStr?.split(' ')[0],
      subject: subject?.trim(),
      body: bodyParts.join(' ').trim(),
    };
  }).filter(c => c.hash && c.subject);
}

// ── 커밋 → Notion 속성 매핑 ───────────────────────────────────────────────────
function classifyCommit(subject) {
  const s = subject.toLowerCase();

  // 카테고리 추론
  let categories = [];
  if (s.startsWith('feat')) categories.push('기능개발');
  if (s.startsWith('fix')) categories.push('버그수정');
  if (s.startsWith('refactor')) categories.push('리팩토링');
  if (s.startsWith('docs')) categories.push('문서화');
  if (s.includes('infra') || s.includes('vercel') || s.includes('docker') || s.includes('deploy')) categories.push('인프라');
  if (s.startsWith('test') || s.includes('테스트')) categories.push('기능개발');
  if (categories.length === 0) categories.push('기능개발');

  // 기술스택 추론
  const stacks = [];
  if (s.includes('react') || s.includes('tsx') || s.includes('컴포넌트')) stacks.push('React');
  if (s.includes('typescript') || s.includes('ts')) stacks.push('TypeScript');
  if (s.includes('python') || s.includes('fastapi')) stacks.push('Python');
  if (s.includes('node') || s.includes('npm') || s.includes('mjs')) stacks.push('Node.js');
  if (s.includes('docker')) stacks.push('Docker');
  if (s.includes('aws')) stacks.push('AWS');
  if (s.includes('supabase') || s.includes('db') || s.includes('sql') || s.includes('데이터')) stacks.push('DB');
  if (s.includes('vercel') || s.includes('playwright') || s.includes('scraperapi')) stacks.push('Node.js');
  if (stacks.length === 0) stacks.push('TypeScript'); // 기본값

  // 중복 제거
  return {
    categories: [...new Set(categories)],
    stacks: [...new Set(stacks)],
  };
}

function buildNotionPayload(commit) {
  const { categories, stacks } = classifyCommit(commit.subject);

  // fix: / feat: / refactor: 프리픽스를 제거한 깔끔한 제목
  const cleanTitle = `[chat-agent] ${commit.subject
    .replace(/^(feat|fix|refactor|docs|test|chore|style|ci|build|perf):\s*/i, '')
    .trim()}`;

  return {
    parent: { database_id: DATABASE_ID },
    properties: {
      '제목': {
        title: [{ text: { content: cleanTitle } }],
      },
      '요약': {
        rich_text: [{ text: { content: commit.subject } }],
      },
      '상태': {
        select: { name: '완료' },
      },
      '날짜': {
        date: { start: commit.date },
      },
      '카테고리': {
        multi_select: categories.map(name => ({ name })),
      },
      '기술스택': {
        multi_select: stacks.map(name => ({ name })),
      },
      '참고링크': {
        url: `https://github.com/jpjp92/chat-agent/commit/${commit.hash}`,
      },
    },
  };
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📋 Notion DEV Records 동기화 시작 ${dryRun ? '(dry-run)' : ''}\n`);

  const commits = getCommits();
  if (commits.length === 0) {
    console.log('⚠️  처리할 커밋이 없습니다.');
    return;
  }

  console.log(`🔍 커밋 ${commits.length}개 발견:\n`);
  commits.forEach(c => console.log(`  ${c.hash} [${c.date}] ${c.subject}`));
  console.log();

  let created = 0;
  let skipped = 0;

  for (const commit of commits) {
    const payload = buildNotionPayload(commit);
    const title = payload.properties['제목'].title[0].text.content;
    const { categories, stacks } = classifyCommit(commit.subject);

    if (dryRun) {
      console.log(`[dry-run] ✅ "${title}"`);
      console.log(`         카테고리: ${categories.join(', ')} | 스택: ${stacks.join(', ')} | 날짜: ${commit.date}`);
      continue;
    }

    try {
      await notion.pages.create(payload);
      console.log(`✅ 생성됨: "${title}"`);
      created++;
      // Notion API rate limit 방지 (3req/s 권장)
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      // conflict(중복 URL) 에러는 스킵으로 처리
      if (err.message?.includes('already exists') || err.status === 409) {
        console.log(`⏭️  이미 존재함: "${title}"`);
        skipped++;
      } else {
        console.error(`❌ 실패: "${title}" — ${err.message}`);
      }
    }
  }

  console.log(`\n완료: ${created}개 생성, ${skipped}개 중복 스킵\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

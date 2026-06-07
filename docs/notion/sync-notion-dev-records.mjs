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
 *   node docs/notion/sync-notion-dev-records.mjs --update-existing-times
 *     # 기존 chat-agent 커밋 행의 날짜/시간과 full hash 링크 보정
 */

import { spawnSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@notionhq/client';

// .env / .env.local 로드
const __dir = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dir, '../..');
for (const envFile of ['.env', '.env.local']) {
  try {
    const content = readFileSync(resolve(REPO_ROOT, envFile), 'utf-8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}

// ── 설정 ──────────────────────────────────────────────────────────────────────
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const DATABASE_ID = process.env.NOTION_DEV_RECORDS_DB_ID;
let dataSourceId = process.env.NOTION_DEV_RECORDS_DATA_SOURCE_ID;
const CACHE_FILE = resolve(__dir, '.synced-hashes.json');

if (!NOTION_TOKEN) {
  console.error('❌ NOTION_TOKEN 환경변수가 없습니다.');
  process.exit(1);
}
if (!DATABASE_ID) {
  console.error('❌ NOTION_DEV_RECORDS_DB_ID 환경변수가 없습니다.');
  process.exit(1);
}

const notion = new Client({ auth: NOTION_TOKEN });
let duplicateLookupWarned = false;

async function resolveDataSourceId() {
  if (dataSourceId) return dataSourceId;

  const database = await notion.databases.retrieve({ database_id: DATABASE_ID });
  dataSourceId = database.data_sources?.[0]?.id;
  return dataSourceId;
}

// ── 중복 방지 캐시 ────────────────────────────────────────────────────────────
function loadCache() {
  try {
    return new Set(JSON.parse(readFileSync(CACHE_FILE, 'utf-8')));
  } catch {
    return new Set();
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify([...cache], null, 2));
}

// ── 인자 파싱 ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const lastIdx = args.indexOf('--last');
const lastN = lastIdx !== -1 ? parseInt(args[lastIdx + 1], 10) : null;
const afterIdx = args.indexOf('--after');
const afterDate = afterIdx !== -1 ? args[afterIdx + 1] : null;
const updateExistingTimes = args.includes('--update-existing-times');

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

  const result = spawnSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf-8' });
  if (result.error) throw result.error;
  const output = result.stdout.trim();
  if (!output) return [];

  return output.split('\n').map(line => {
    const [hash, dateStr, subject, ...bodyParts] = line.split('|');
    // dateStr 예: "2026-06-05 16:11:55 +0900"
    const [datePart, timePart, tzPart] = (dateStr ?? '').trim().split(' ');
    return {
      hash: hash?.substring(0, 8),
      fullHash: hash?.trim(),
      date: datePart,        // "2026-06-05"
      time: timePart,        // "16:11:55"
      tz: tzPart,            // "+0900"
      subject: subject?.trim(),
      body: bodyParts.join(' ').trim(),
    };
  }).filter(c => c.hash && c.subject && c.date);
}

function parseCommitLine(line) {
  const [hash, dateStr, subject, ...bodyParts] = line.split('|');
  const [datePart, timePart, tzPart] = (dateStr ?? '').trim().split(' ');
  return {
    hash: hash?.substring(0, 8),
    fullHash: hash?.trim(),
    date: datePart,
    time: timePart,
    tz: tzPart,
    subject: subject?.trim(),
    body: bodyParts.join(' ').trim(),
  };
}

function getCommitByRef(ref) {
  const result = spawnSync('git', ['show', '-s', '--format=%H|%ai|%s|%b', ref], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  });
  if (result.status !== 0) return null;

  const line = result.stdout.trim();
  if (!line) return null;

  const commit = parseCommitLine(line);
  return commit.hash && commit.subject && commit.date ? commit : null;
}

// ── ISO 8601 datetime (Notion date with time) ─────────────────────────────────
function toNotionDatetime(commit) {
  // "+0900" → "+09:00"
  const tz = commit.tz?.replace(/([+-]\d{2})(\d{2})/, '$1:$2') ?? '+00:00';
  return `${commit.date}T${commit.time}${tz}`;
}

function toMinuteKey(dateText) {
  if (!dateText) return '';
  return dateText.substring(0, 16);
}

// ── 커밋 → Notion 속성 매핑 ───────────────────────────────────────────────────
function classifyCommit(subject) {
  const s = subject.toLowerCase();

  let categories = [];
  if (s.startsWith('feat')) categories.push('기능개발');
  if (s.startsWith('fix')) categories.push('버그수정');
  if (s.startsWith('refactor')) categories.push('리팩토링');
  if (s.startsWith('docs')) categories.push('문서화');
  if (s.includes('infra') || s.includes('vercel') || s.includes('docker') || s.includes('deploy')) categories.push('인프라');
  if (s.startsWith('test') || s.includes('테스트')) categories.push('기능개발');
  if (categories.length === 0) categories.push('기능개발');

  const stacks = [];
  if (s.includes('react') || s.includes('tsx') || s.includes('컴포넌트')) stacks.push('React');
  if (s.includes('typescript') || s.includes('ts')) stacks.push('TypeScript');
  if (s.includes('python') || s.includes('fastapi')) stacks.push('Python');
  if (s.includes('node') || s.includes('npm') || s.includes('mjs')) stacks.push('Node.js');
  if (s.includes('docker')) stacks.push('Docker');
  if (s.includes('aws')) stacks.push('AWS');
  if (s.includes('supabase') || s.includes('db') || s.includes('sql') || s.includes('데이터')) stacks.push('DB');
  if (s.includes('vercel') || s.includes('playwright') || s.includes('scraperapi') || s.includes('notion')) stacks.push('Node.js');
  if (stacks.length === 0) stacks.push('TypeScript');

  return {
    categories: [...new Set(categories)],
    stacks: [...new Set(stacks)],
  };
}

function buildNotionPayload(commit) {
  const { categories, stacks } = classifyCommit(commit.subject);

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
        date: {
          start: toNotionDatetime(commit),
        },
      },
      '카테고리': {
        multi_select: categories.map(name => ({ name })),
      },
      '기술스택': {
        multi_select: stacks.map(name => ({ name })),
      },
      '참고링크': {
        url: `https://github.com/jpjp92/chat-agent/commit/${commit.fullHash}`,
      },
    },
  };
}

function commitUrls(commit) {
  const base = 'https://github.com/jpjp92/chat-agent/commit/';
  return [
    `${base}${commit.fullHash}`,
    `${base}${commit.hash}`,
  ];
}

function extractChatAgentCommitRef(url) {
  const match = url?.match(/^https:\/\/github\.com\/jpjp92\/chat-agent\/commit\/([0-9a-f]{7,40})$/i);
  return match?.[1] ?? null;
}

function pageTitle(page) {
  return (page.properties?.['제목']?.title ?? []).map(part => part.plain_text).join('');
}

function pageCommitUrl(page) {
  return page.properties?.['참고링크']?.url ?? '';
}

function pageDateStart(page) {
  return page.properties?.['날짜']?.date?.start ?? '';
}

async function listDevRecordPages() {
  const resolvedDataSourceId = await resolveDataSourceId();
  if (!resolvedDataSourceId) throw new Error('Notion data source ID를 찾을 수 없습니다.');

  const pages = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: resolvedDataSourceId,
      page_size: 100,
      start_cursor: cursor,
      in_trash: false,
    });
    pages.push(...response.results);
    cursor = response.next_cursor;
  } while (cursor);

  return pages.filter(page => !page.in_trash && !page.archived);
}

async function findExistingPageByCommitUrl(commit) {
  const resolvedDataSourceId = await resolveDataSourceId();
  if (!resolvedDataSourceId) return null;

  try {
    for (const url of commitUrls(commit)) {
      const response = await notion.dataSources.query({
        data_source_id: resolvedDataSourceId,
        filter: {
          property: '참고링크',
          url: { equals: url },
        },
        page_size: 1,
      });

      if (response.results[0]) return response.results[0];
    }
  } catch (err) {
    if (!duplicateLookupWarned) {
      console.warn(`⚠️  Notion 중복 조회를 건너뜁니다: ${err.message}`);
      duplicateLookupWarned = true;
    }
  }

  return null;
}

async function updateExistingCommitTimes() {
  console.log(`\n📋 기존 chat-agent 커밋 행 시간 보정 시작 ${dryRun ? '(dry-run)' : ''}\n`);

  const cache = loadCache();
  const pages = await listDevRecordPages();
  const candidates = [];
  const skipped = {
    notCommitUrl: 0,
    missingGitCommit: 0,
    alreadyCurrent: 0,
  };

  for (const page of pages) {
    const currentUrl = pageCommitUrl(page);
    const commitRef = extractChatAgentCommitRef(currentUrl);
    if (!commitRef) {
      skipped.notCommitUrl++;
      continue;
    }

    const commit = getCommitByRef(commitRef);
    if (!commit) {
      skipped.missingGitCommit++;
      continue;
    }

    const expectedDate = toNotionDatetime(commit);
    const expectedUrl = `https://github.com/jpjp92/chat-agent/commit/${commit.fullHash}`;
    const currentDate = pageDateStart(page);
    const needsDateUpdate = toMinuteKey(currentDate) !== toMinuteKey(expectedDate);
    const needsUrlUpdate = currentUrl !== expectedUrl;

    if (!needsDateUpdate && !needsUrlUpdate) {
      cache.add(commit.fullHash);
      skipped.alreadyCurrent++;
      continue;
    }

    candidates.push({
      page,
      commit,
      currentUrl,
      currentDate,
      expectedUrl,
      expectedDate,
      needsDateUpdate,
      needsUrlUpdate,
    });
  }

  console.log(`🔍 active 페이지 ${pages.length}개 중 업데이트 후보 ${candidates.length}개`);
  console.log(`   스킵: 비커밋 URL ${skipped.notCommitUrl}개, git 미발견 ${skipped.missingGitCommit}개, 최신 상태 ${skipped.alreadyCurrent}개\n`);

  let updated = 0;
  for (const item of candidates) {
    const title = pageTitle(item.page);
    const changes = [];
    if (item.needsDateUpdate) changes.push(`${item.currentDate || '(empty)'} -> ${item.expectedDate}`);
    if (item.needsUrlUpdate) changes.push(`${item.currentUrl} -> ${item.expectedUrl}`);

    if (dryRun) {
      console.log(`[dry-run] 🔧 ${title}`);
      console.log(`          ${changes.join(' | ')}`);
      continue;
    }

    await notion.pages.update({
      page_id: item.page.id,
      properties: {
        '날짜': {
          date: { start: item.expectedDate },
        },
        '참고링크': {
          url: item.expectedUrl,
        },
      },
    });
    cache.add(item.commit.fullHash);
    saveCache(cache);
    updated++;
    console.log(`✅ 업데이트됨: ${title}`);
    await new Promise(r => setTimeout(r, 350));
  }

  if (!dryRun) saveCache(cache);
  console.log(`\n완료: ${updated}개 업데이트, ${candidates.length - updated}개 미적용${dryRun ? ' (dry-run)' : ''}\n`);
}

// ── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  if (updateExistingTimes) {
    await updateExistingCommitTimes();
    return;
  }

  console.log(`\n📋 Notion DEV Records 동기화 시작 ${dryRun ? '(dry-run)' : ''}\n`);

  const cache = loadCache();
  const commits = getCommits();

  if (commits.length === 0) {
    console.log('⚠️  처리할 커밋이 없습니다.');
    return;
  }

  console.log(`🔍 커밋 ${commits.length}개 발견:\n`);
  commits.forEach(c => console.log(`  ${c.hash} [${c.date} ${c.time}] ${c.subject}`));
  console.log();

  let created = 0;
  let skipped = 0;

  for (const commit of commits) {
    const payload = buildNotionPayload(commit);
    const title = payload.properties['제목'].title[0].text.content;
    const { categories, stacks } = classifyCommit(commit.subject);

    // 캐시 기반 중복 체크
    if (cache.has(commit.fullHash)) {
      console.log(`⏭️  이미 동기화됨: "${title}"`);
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] ✅ "${title}"`);
      console.log(`         카테고리: ${categories.join(', ')} | 스택: ${stacks.join(', ')} | 날짜: ${toNotionDatetime(commit)}`);
      continue;
    }

    try {
      const existingPage = await findExistingPageByCommitUrl(commit);
      if (existingPage) {
        cache.add(commit.fullHash);
        saveCache(cache);
        console.log(`⏭️  Notion에 이미 있음: "${title}"`);
        skipped++;
        await new Promise(r => setTimeout(r, 350));
        continue;
      }

      await notion.pages.create(payload);
      cache.add(commit.fullHash);
      saveCache(cache);
      console.log(`✅ 생성됨: "${title}"`);
      created++;
      // Notion API rate limit 방지
      await new Promise(r => setTimeout(r, 350));
    } catch (err) {
      console.error(`❌ 실패: "${title}" — ${err.message}`);
    }
  }

  console.log(`\n완료: ${created}개 생성, ${skipped}개 중복 스킵\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});

/**
 * MFDS 식약처 낱알 식별 정보 → Supabase 전체 동기화
 *
 * 실행 전 Supabase Dashboard SQL Editor에서 아래 DDL을 먼저 실행하세요:
 *
 *   -- scripts/sync-mfds-pills.mjs 상단의 CREATE TABLE 블록 참조
 *
 * 실행:
 *   node scripts/sync-mfds-pills.mjs          # 전체 동기화 (최초 1회)
 *   node scripts/sync-mfds-pills.mjs --dry-run # API 연결/파싱만 테스트
 *   node scripts/sync-mfds-pills.mjs --count   # 총 건수만 확인
 */

/* ── Supabase DDL (Dashboard에서 먼저 실행) ──────────────────────────────
CREATE TABLE IF NOT EXISTS mfds_pills (
  item_seq          TEXT PRIMARY KEY,         -- 품목일련번호
  item_name         TEXT,                     -- 품목명
  entp_name         TEXT,                     -- 업체명
  chart             TEXT,                     -- 성상
  drug_shape        TEXT,                     -- 모양 (장방형, 원형 ...)
  color_class1      TEXT,                     -- 색상앞 (노랑, 하양 ...)
  color_class2      TEXT,                     -- 색상뒤
  form_code_name    TEXT,                     -- 제형 (필름코팅정, 캡슐 ...)
  mark_code_front_anal TEXT,                  -- 앞면 각인 텍스트 (쉼표 구분 변형 포함)
  mark_code_back_anal  TEXT,                  -- 뒷면 각인 텍스트
  mark_codes        TEXT[],                   -- 정규화된 각인 변형 배열 (GIN 인덱스용)
  item_image        TEXT,                     -- 약품 이미지 URL
  mark_code_front_img TEXT,                   -- 앞면 각인 이미지 URL
  mark_code_back_img  TEXT,                   -- 뒷면 각인 이미지 URL
  class_name        TEXT,                     -- 분류명
  etc_otc_name      TEXT,                     -- 전문/일반 구분
  leng_long         TEXT,                     -- 장축(mm)
  leng_short        TEXT,                     -- 단축(mm)
  thick             TEXT,                     -- 두께(mm)
  synced_at         TIMESTAMPTZ DEFAULT NOW() -- 마지막 동기화 시각
);

-- 각인 배열 GIN 인덱스 (각인 검색 핵심)
CREATE INDEX IF NOT EXISTS idx_mfds_pills_mark_codes ON mfds_pills USING GIN (mark_codes);

-- 색상/모양 인덱스
CREATE INDEX IF NOT EXISTS idx_mfds_pills_color ON mfds_pills (color_class1);
CREATE INDEX IF NOT EXISTS idx_mfds_pills_shape ON mfds_pills (drug_shape);
CREATE INDEX IF NOT EXISTS idx_mfds_pills_name  ON mfds_pills (item_name);
──────────────────────────────────────────────────────────────────────── */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

// ── 환경변수 로드 ─────────────────────────────────────────────────────
const envPath = resolve(process.cwd(), '.env.local');
const envLines = readFileSync(envPath, 'utf-8').split('\n');
const getEnv = key => {
    const line = envLines.find(l => l.startsWith(key + '='));
    return line ? line.split('=').slice(1).join('=').trim() : null;
};

const MFDS_KEY  = getEnv('MFDS_API_KEY');
const MFDS_URL  = getEnv('MFDS_API_ENDPOINT');
const SB_URL    = getEnv('SUPABASE_URL');
const SB_KEY    = getEnv('SUPABASE_KEY');

if (!MFDS_KEY || !MFDS_URL || !SB_URL || !SB_KEY) {
    console.error('필수 환경변수 누락: MFDS_API_KEY, MFDS_API_ENDPOINT, SUPABASE_URL, SUPABASE_KEY');
    process.exit(1);
}

const supabase = createClient(SB_URL, SB_KEY);

// ── 옵션 파싱 ─────────────────────────────────────────────────────────
const isDryRun = process.argv.includes('--dry-run');
const isCount  = process.argv.includes('--count');

// ── 각인 정규화 유틸 ──────────────────────────────────────────────────
const normalizeImprint = s =>
    (s || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

/**
 * "dHP,dP,d-P,cHP" → ['DHP','DP','CHP']  (정규화 + 중복 제거)
 * 앞면 + 뒷면 합산 배열 반환
 */
function buildMarkCodes(frontAnal, backAnal) {
    const parse = str =>
        (str || '').split(',').map(s => normalizeImprint(s.trim())).filter(Boolean);
    const all = [...parse(frontAnal), ...parse(backAnal)];
    return [...new Set(all)];
}

// ── MFDS API 페이지 fetch ─────────────────────────────────────────────
const PAGE_SIZE = 100;

async function fetchPage(pageNo) {
    const url = new URL(MFDS_URL);
    url.searchParams.set('serviceKey', decodeURIComponent(MFDS_KEY));
    url.searchParams.set('type', 'json');
    url.searchParams.set('numOfRows', String(PAGE_SIZE));
    url.searchParams.set('pageNo', String(pageNo));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const body = data?.body;
    if (!body) throw new Error('body 없음: ' + JSON.stringify(data).slice(0, 200));

    const items = Array.isArray(body.items) ? body.items : [];
    return { items, totalCount: body.totalCount ?? 0 };
}

// ── 행 변환 ───────────────────────────────────────────────────────────
function toRow(item) {
    return {
        item_seq:              item.ITEM_SEQ,
        item_name:             item.ITEM_NAME   || null,
        entp_name:             item.ENTP_NAME   || null,
        chart:                 item.CHART       || null,
        drug_shape:            item.DRUG_SHAPE  || null,
        color_class1:          item.COLOR_CLASS1 || null,
        color_class2:          item.COLOR_CLASS2 || null,
        form_code_name:        item.FORM_CODE_NAME || null,
        mark_code_front_anal:  item.MARK_CODE_FRONT_ANAL || null,
        mark_code_back_anal:   item.MARK_CODE_BACK_ANAL  || null,
        mark_codes:            buildMarkCodes(item.MARK_CODE_FRONT_ANAL, item.MARK_CODE_BACK_ANAL),
        item_image:            item.ITEM_IMAGE  || null,
        mark_code_front_img:   item.MARK_CODE_FRONT_IMG || null,
        mark_code_back_img:    item.MARK_CODE_BACK_IMG  || null,
        class_name:            item.CLASS_NAME  || null,
        etc_otc_name:          item.ETC_OTC_NAME || null,
        leng_long:             item.LENG_LONG   || null,
        leng_short:            item.LENG_SHORT  || null,
        thick:                 item.THICK       || null,
        synced_at:             new Date().toISOString(),
    };
}

// ── 메인 ──────────────────────────────────────────────────────────────
async function main() {
    // 총 건수 확인
    const { totalCount } = await fetchPage(1);
    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    console.log(`MFDS 전체 약품: ${totalCount}건 / ${totalPages}페이지`);

    if (isCount) return;

    if (isDryRun) {
        console.log('\n[DRY RUN] 1페이지 파싱 결과:');
        const { items } = await fetchPage(1);
        items.slice(0, 3).forEach(item => {
            const row = toRow(item);
            console.log(`  ${row.item_name} | mark_codes: [${row.mark_codes.join(', ')}] | ${row.color_class1} / ${row.drug_shape}`);
        });
        return;
    }

    // 전체 동기화
    console.log('\n동기화 시작...');
    let upserted = 0;
    let errors = 0;
    let deduped = 0;  // 배치 내 중복으로 접힌 건수 — API 총계와의 차이를 설명하는 값이다
    const BATCH = 500; // Supabase upsert 배치 크기
    let buffer = [];

    const flush = async () => {
        if (buffer.length === 0) return;
        // 🔴 배치 **안**에 같은 item_seq 가 둘 이상이면 Postgres 가 그 문장 전체를 거부한다
        //    ("ON CONFLICT DO UPDATE command cannot affect row a second time").
        //    중복 1건 때문에 **정상 499건이 같이 날아간다.**
        //    실측 2026-08-17: 배치 6개 거부 = 3,000건 누락(11.8%). 재실행마다 배치 경계가
        //    달라져 **어느 약이 빠지는지가 매번 바뀌었다**(22,359 ↔ 22,362).
        //    배치 **간** 중복은 문제없다 — upsert 가 정상 처리한다. 배치 안만 접으면 된다.
        //    Map 은 뒤 값으로 덮으므로 나중 페이지가 이긴다.
        const rows = [...new Map(buffer.map(r => [r.item_seq, r])).values()];
        const dropped = buffer.length - rows.length;
        buffer = [];

        const { error } = await supabase
            .from('mfds_pills')
            .upsert(rows, { onConflict: 'item_seq' });
        if (error) {
            console.error('  upsert 오류:', error.message);
            errors += rows.length;
        } else {
            upserted += rows.length;
            deduped += dropped;
        }
    };

    for (let page = 1; page <= totalPages; page++) {
        try {
            const { items } = await fetchPage(page);
            buffer.push(...items.map(toRow));

            if (buffer.length >= BATCH) await flush();

            // 진행 상황 출력 (10페이지마다)
            if (page % 10 === 0 || page === totalPages) {
                const pct = Math.round(page / totalPages * 100);
                process.stdout.write(`\r  ${page}/${totalPages}페이지 (${pct}%) | 저장: ${upserted}건`);
            }

            // API 레이트 리밋 방지 (50ms 딜레이)
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {
            console.error(`\n  페이지 ${page} 오류:`, e.message);
            errors++;
        }
    }

    await flush();
    // 🔴 이 줄을 잘라내지 말 것. 2026-08-17 에 `| tail -40` 로 여기를 날려서
    //    3,000건 누락을 못 보고 한 바퀴를 더 돌았다.
    console.log(`\n\n완료: ${upserted}건 저장, ${errors}건 오류, ${deduped}건 배치내중복`);
    if (errors > 0) console.error(`🔴 ${errors}건이 저장되지 않았다 — 위 오류 메시지 확인 후 재실행할 것.`);

    // 검증 쿼리
    console.log('\n검증 — 마그네스정 조회:');
    const { data, error } = await supabase
        .from('mfds_pills')
        .select('item_name, entp_name, mark_codes, color_class1, drug_shape')
        .contains('mark_codes', ['DP'])
        .eq('color_class1', '노랑')
        .eq('drug_shape', '장방형');
    if (error) console.error('검증 쿼리 오류:', error.message);
    else console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);

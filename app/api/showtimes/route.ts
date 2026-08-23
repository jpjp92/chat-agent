import { BROWSER_UA } from '../../../server/browser-ua';
import { NextRequest, NextResponse } from 'next/server';

/**
 * 상영시간표 조회 API — MovieRenderer가 지점별로 호출(마운트/드롭다운 변경 시).
 *   GET /api/showtimes?chain=cgv|lotte|mega&code=XXX&nm=지점명[&nocache=1]
 *
 * 롯데·메가박스는 direct JSON, CGV는 browserless(Cloudflare 우회 + HMAC 서명).
 * SWR 인메모리 캐시: fresh 120s 그대로 / stale 30분 즉시 반환 + 백그라운드 갱신.
 * 한국 정부/극장 API 접근을 위해 서울 리전 고정(law-tool과 동일 이유).
 *
 * 스파이크 원본: scripts/test-showtimes-server.mjs (DEV_260610/260611).
 */
export const runtime = 'nodejs';
export const preferredRegion = 'icn1';
export const maxDuration = 60;

const KEY = process.env.BROWSERLESS_KEY || process.env.BROWSERLESS_TOKEN;
const BASE = (process.env.BROWSERLESS_REST_URL || 'https://production-sfo.browserless.io').replace(/\/+$/, '');
const UA = BROWSER_UA;

const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000);
const toYmd = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
const dash = (y: string) => `${y.slice(0, 4)}-${y.slice(4, 6)}-${y.slice(6, 8)}`;
const hm = (t: string) => (t && /^\d{3,4}$/.test(t) ? `${t.slice(0, -2).padStart(2, '0')}:${t.slice(-2)}` : t || '');
// CGV 상영관명 정제: "4관[SCREENX] (리클라이너,Laser)" → "4관 SCREENX". (...)잡음 제거 + [특수관] 유지.
const cleanCgvScreen = (s: string) => (s || '').replace(/\([^)]*\)/g, '').replace(/\[([^\]]*)\]/g, ' $1').replace(/\s+/g, ' ').trim().slice(0, 16);
// HTML 엔티티 디코드: 메가박스 영화명/포맷/지점명이 "2D&#40;더빙&#41;" 처럼 인코딩돼 옴 → "2D(더빙)".
const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decodeEntities = (s: string): string => (s || '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-zA-Z]+);/g, (m, n) => NAMED[n.toLowerCase()] ?? m);

export interface Showtime { start: string; end: string; screen: string; screenFull?: string; left: number; total: number }
export interface MovieEntry { chain: string; cinema: string; movie: string; date: string; poster: string; rating: string; format: string; showtimes: Showtime[] }

// ── 롯데 (direct) ─────────────────────────────────────────
async function lotteOnce(cinemaID: string, ymd: string) {
  const fd = new URLSearchParams();
  fd.set('paramList', JSON.stringify({ MethodName: 'GetPlaySequence', channelType: 'HO', osType: 'Chrome', osVersion: UA, playDate: dash(ymd), cinemaID, representationMovieCode: '' }));
  const res = await fetch('https://www.lottecinema.co.kr/LCWS/Ticketing/TicketingData.aspx', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.lottecinema.co.kr/NLCHS/', 'Origin': 'https://www.lottecinema.co.kr', 'User-Agent': UA }, body: fd.toString(), signal: AbortSignal.timeout(20000) });
  return JSON.parse(await res.text())?.PlaySeqs?.Items || [];
}
async function fetchLotte(cinemaID: string, today: string, tomorrow: string): Promise<MovieEntry[]> {
  let items = await lotteOnce(cinemaID, today), date = today;
  if (!items.length) { items = await lotteOnce(cinemaID, tomorrow); date = tomorrow; }
  const byMovie: Record<string, MovieEntry> = {};
  for (const it of items) {
    const key = it.MovieNameKR;
    byMovie[key] = byMovie[key] || { chain: '롯데시네마', cinema: it.CinemaNameKR, movie: it.MovieNameKR, date, poster: it.PosterURL ? it.PosterURL.replace(/^http:/, 'https:') : '', rating: String(it.ViewGradeNameKR || ''), format: it.FilmNameKR || '2D', showtimes: [] };
    byMovie[key].showtimes.push({ start: it.StartTime, end: it.EndTime, screen: it.ScreenNameKR, left: it.TotalSeatCount - it.BookingSeatCount, total: it.TotalSeatCount });
  }
  return Object.values(byMovie);
}

// ── 메가박스 (direct schedulePage.do) ─────────────────────
async function fetchMegabox(brchNo: string, today: string, tomorrow: string): Promise<MovieEntry[]> {
  const call = async (ymd: string) => {
    const res = await fetch('https://www.megabox.co.kr/on/oh/ohc/Brch/schedulePage.do', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, 'Referer': 'https://www.megabox.co.kr/booking/timetable', 'X-Requested-With': 'XMLHttpRequest' },
      body: JSON.stringify({ masterType: 'brch', detailType: 'area', areaCd: '', brchNo1: brchNo, brchNo, firstAt: 'Y', playDe: ymd, sellChnlCd: 'MEGABOX' }), signal: AbortSignal.timeout(20000),
    });
    return JSON.parse(await res.text())?.megaMap?.movieFormList || [];
  };
  let list = await call(today), date = today;
  if (!list.length) { list = await call(tomorrow); date = tomorrow; }
  const byMovie: Record<string, MovieEntry> = {};
  for (const f of list) {
    const key = f.movieNm;
    // 상영관명 잡음 제거: "9층 르 리클라이너 2관[Laser]" → "르 리클라이너 2관"
    const screen = (f.theabExpoNm || '').replace(/\s+/g, ' ').replace(/^\d+층\s*/, '').split(/[[(]|\s\d+석/)[0].trim().slice(0, 16);
    const mposter = f.moviePosterImg ? (f.moviePosterImg.startsWith('http') ? f.moviePosterImg : 'https://www.megabox.co.kr' + f.moviePosterImg) : '';
    byMovie[key] = byMovie[key] || { chain: '메가박스', cinema: `메가박스 ${decodeEntities(f.brchNm)}`, movie: decodeEntities(f.movieNm), date: f.playDe || date, poster: mposter, rating: f.admisClassCdNm || '', format: decodeEntities((f.playKindNm || '2D').replace(/\s+/g, '')), showtimes: [] };
    byMovie[key].showtimes.push({ start: f.playStartTime, end: f.playEndTime, screen, left: Number(f.restSeatCnt), total: Number(f.totSeatCnt) });
  }
  return Object.values(byMovie);
}

// ── CGV (browserless + HMAC, siteNo 직접) ─────────────────
async function fetchCgv(siteNo: string, siteNm: string, today: string, tomorrow: string): Promise<MovieEntry[]> {
  if (!KEY) throw new Error('BROWSERLESS_KEY 미설정');
  const code = `
  export default async function ({ page }) {
    await page.setUserAgent(${JSON.stringify(UA)});
    // 콜드 단축(~7s→~2.5s, S6+block): api 오리진으로 직접 goto(가벼운 robots.txt) + 이미지/폰트/CSS 차단.
    await page.setRequestInterception(true);
    page.on('request', rq => { const t = rq.resourceType(); (t === 'image' || t === 'font' || t === 'stylesheet' || t === 'media') ? rq.abort() : rq.continue(); });
    try { await page.goto('https://api.cgv.co.kr/robots.txt', { waitUntil: 'domcontentloaded', timeout: 20000 }); } catch {}
    const result = await page.evaluate(async (dates, siteNo) => {
      const SECRET = 'ydqXY0ocnFLmJGHr_zNzFcpjwAsXq_8JcBNURAkRscg';
      async function sig(msg){ const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']); const s=await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(msg)); return btoa(String.fromCharCode(...new Uint8Array(s))); }
      async function get(pathname, query){ const ts=Math.floor(Date.now()/1000).toString(); const sg=await sig(ts+'|'+pathname+'|'+''); const r=await fetch('https://api.cgv.co.kr'+pathname+(query?'?'+query:''),{headers:{'X-TIMESTAMP':ts,'X-SIGNATURE':sg,'Accept':'application/json'},credentials:'include'}); return r.json(); }
      for (const ymd of dates) {
        const params = 'coCd=A420&siteNo='+siteNo+'&scnYmd='+ymd+'&scnsNo=&scnSseq=&rtctlScopCd=08&custNo=';
        const mov = await get('/cnm/atkt/searchMovScnInfo', params);
        if ((mov.data||[]).length) return { date: ymd, rows: mov.data };
      }
      return { date: dates[0], rows: [] };
    }, ${JSON.stringify([today, tomorrow])}, ${JSON.stringify(String(siteNo))});
    return { data: result, type:'application/json' };
  }`;
  const res = await fetch(`${BASE}/function?token=${encodeURIComponent(KEY)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, context: {} }), signal: AbortSignal.timeout(90000) });
  const d = (JSON.parse(await res.text())).data || {};
  if (!d.rows) return [];
  const cinema = `CGV ${siteNm}`;
  const byMovie: Record<string, MovieEntry> = {};
  for (const r of d.rows) {
    const key = r.movNm;
    const poster = r.physcFilePathnm ? `https://cdn.cgv.co.kr/cgvpomsfilm/Movie/Thumbnail/Poster/${r.physcFilePathnm}` : '';
    byMovie[key] = byMovie[key] || { chain: 'CGV', cinema, movie: r.movNm, date: d.date, poster, rating: (r.cratgClsNm || '').replace(/관람가|이상/g, '').trim(), format: r.movkndDsplNm || '2D', showtimes: [] };
    byMovie[key].showtimes.push({ start: hm(r.scnsrtTm), end: hm(r.scnendTm), screen: cleanCgvScreen(r.scnsNm), screenFull: (r.scnsNm || '').trim(), left: Number(r.frSeatCnt), total: Number(r.stcnt) });
  }
  return Object.values(byMovie);
}

// ── SWR 인메모리 캐시 ─────────────────────────────────────
interface Payload { chain: string; code: string; cinema: string; movies: number; total: number; ms: number; date: string; list: MovieEntry[]; cached?: boolean | string; age?: number }
const CACHE = new Map<string, { payload: Payload; ts: number }>();
const FRESH_MS = 120_000;
const STALE_MS = 30 * 60_000;
const refreshing = new Set<string>();

async function buildPayload(chain: string, code: string, nm: string): Promise<Payload> {
  const today = toYmd(kstNow());
  const tomorrow = toYmd(new Date(kstNow().getTime() + 24 * 3600 * 1000));
  const t0 = Date.now();
  let list: MovieEntry[] = [];
  if (chain === 'lotte') list = await fetchLotte(code, today, tomorrow);
  else if (chain === 'mega') list = await fetchMegabox(code, today, tomorrow);
  else if (chain === 'cgv') list = await fetchCgv(code, nm, today, tomorrow);
  const ms = Date.now() - t0;
  const total = list.reduce((n, m) => n + m.showtimes.length, 0);
  return { chain, code, cinema: list[0]?.cinema || nm, movies: list.length, total, ms, date: today, list };
}

async function getShowtimes(chain: string, code: string, nm: string): Promise<Payload> {
  const key = `${chain}:${code}:${toYmd(kstNow())}`;
  const hit = CACHE.get(key);
  const age = hit ? Date.now() - hit.ts : Infinity;
  if (hit && age < FRESH_MS) return { ...hit.payload, cached: 'fresh', age };
  if (hit && age < STALE_MS) {
    if (!refreshing.has(key)) { refreshing.add(key); buildPayload(chain, code, nm).then((p) => CACHE.set(key, { payload: p, ts: Date.now() })).catch(() => {}).finally(() => refreshing.delete(key)); }
    return { ...hit.payload, cached: 'stale', age };
  }
  const payload = await buildPayload(chain, code, nm);
  CACHE.set(key, { payload, ts: Date.now() });
  return { ...payload, cached: false, age: 0 };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const chain = sp.get('chain') || '';
  const code = sp.get('code') || '';
  const nm = sp.get('nm') || '';
  const nocache = sp.get('nocache') === '1';
  if (!['cgv', 'lotte', 'mega'].includes(chain) || !code) {
    return NextResponse.json({ error: 'chain(cgv|lotte|mega)·code 필수', list: [] }, { status: 400 });
  }
  try {
    const payload = nocache
      ? { ...(await buildPayload(chain, code, nm)), cached: false, age: 0 }
      : await getShowtimes(chain, code, nm);
    return NextResponse.json(payload);
  } catch (e: any) {
    console.error('[showtimes]', chain, code, e?.message);
    return NextResponse.json({ error: e?.message || '조회 실패', chain, code, list: [], movies: 0, total: 0 }, { status: 200 });
  }
}

/**
 * 병원 진료시간 조회 — 심평원 의료기관별상세정보서비스(MadmDtlInfoService2.8).
 *
 * 병원 카드가 쓰는 병원기본목록(getHospBasisList)에는 진료시간이 없다(의사수·개설일·주소만).
 * 그래서 "지금 진료하나"를 카드만으로는 답할 수 없었고, 모델이 침묵하거나 웹 검색으로
 * 추정했다(실측 2026-08-23). 요일별 진료시간은 이 별도 서비스에 구조화돼 있으므로
 * 약국과 동일하게 **서버가 is_open_now를 계산**해 사실로 고정한다.
 *
 * 🔴 ykiho(암호화된 요양기호)를 카드 JSON에 싣지 않는다. 기관당 60자가 넘는 불투명 문자열이라
 *    10건이면 토큰 낭비이고, 무엇보다 모델이 답변에 그대로 인용하는 사고가 실제로 있었다
 *    (is_open_now 노출 회귀). 후속 턴에 병원명으로 기본목록을 1건 재조회해 ykiho를 얻는다 —
 *    상세기능 일일 트래픽이 10,000이라 on-demand 2회 호출은 충분히 여유가 있다.
 */

const HOSP_KEY = process.env.PHARM_KEY || '';

const DETAIL_ENDPOINT = 'https://apis.data.go.kr/B551182/MadmDtlInfoService2.8/getDtlInfo2.8';
const BASIS_ENDPOINT = 'https://apis.data.go.kr/B551182/hospInfoServicev2/getHospBasisList';

/** 요일 인덱스(0=일)에 대응하는 API 필드 접두. 일요일은 시간 필드가 없고 noTrmtSun으로만 온다. */
const DAY_FIELD: Record<number, string | undefined> = {
    0: undefined, 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat',
};

export type HospitalOpenStatus = {
    name: string;
    /** 오늘 진료시간. 진료일이 아니면 빈 문자열. */
    hours_today: string;
    /** 점심시간 원문(형식이 "12:00~13:00"·"12시30분~13시30분"으로 섞여 있어 가공하지 않는다). */
    lunch: string;
    /** 조회 시점 진료 중 여부. 판단 근거가 없으면 null(모른다) — false로 단정하지 않는다. */
    is_open_now: boolean | null;
    /** 닫혀 있다면 그 이유(일요일 휴진, 진료시간 외 등). */
    closed_reason: string;
    /** 야간 응급실 운영 여부. 진료시간이 끝나도 응급실은 열려 있을 수 있다. */
    emergency_night: boolean;
    emergency_phone: string;
    checked_at: string;
};

async function fetchText(url: string, timeoutMs = 12000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/** "0830" | 1700 → 830 | 1700 (숫자 비교용). API가 시작은 문자열, 종료는 숫자로 준다. */
const toMinutesKey = (value: unknown): number | undefined => {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length < 3) return undefined;
    return parseInt(digits, 10);
};

/** 830 → "08:30" */
const formatClock = (value: number): string => {
    const padded = String(value).padStart(4, '0');
    return `${padded.slice(0, 2)}:${padded.slice(2)}`;
};

async function lookupYkiho(hospitalName: string, sidoCd: string, sgguCd?: string): Promise<string | undefined> {
    const qs = new URLSearchParams({ sidoCd, yadmNm: hospitalName, numOfRows: '5', pageNo: '1' });
    if (sgguCd) qs.set('sgguCd', sgguCd);
    const xml = await fetchText(`${BASIS_ENDPOINT}?serviceKey=${HOSP_KEY}&${qs}`);

    // 이름이 부분 일치하면 여러 건이 온다. 카드에 표시된 이름과 정확히 같은 건을 우선한다.
    const entries = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((match) => ({
        name: match[1].match(/<yadmNm>(.*?)<\/yadmNm>/)?.[1] ?? '',
        ykiho: match[1].match(/<ykiho>(.*?)<\/ykiho>/)?.[1] ?? '',
    })).filter((entry) => entry.ykiho);

    const squash = (value: string) => value.replace(/\s+/g, '');
    return (entries.find((entry) => squash(entry.name) === squash(hospitalName)) ?? entries[0])?.ykiho;
}

/**
 * 카드에 표시된 병원 1건의 현재 진료 상태를 조회한다. 실패하면 null —
 * 호출부는 "확인하지 못했다"로 답해야지 임의로 열림/닫힘을 단정하면 안 된다.
 */
export async function fetchHospitalOpenStatus(
    hospitalName: string,
    areaCodes: { sidoCd: string; sgguCd?: string },
    now: Date = new Date(),
): Promise<HospitalOpenStatus | null> {
    if (!HOSP_KEY || !hospitalName.trim()) return null;

    try {
        const ykiho = await lookupYkiho(hospitalName.trim(), areaCodes.sidoCd, areaCodes.sgguCd);
        if (!ykiho) return null;

        const detailUrl = `${DETAIL_ENDPOINT}?serviceKey=${HOSP_KEY}&ykiho=${encodeURIComponent(ykiho)}&_type=json`;
        const payload = JSON.parse(await fetchText(detailUrl));
        const item = payload?.response?.body?.items?.item;
        if (!item) return null;

        const kstNow = new Date(now.toLocaleString('en', { timeZone: 'Asia/Seoul' }));
        const checkedAt = new Intl.DateTimeFormat('sv-SE', {
            timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'medium', hour12: false,
        }).format(now).replace(' ', 'T') + '+09:00';

        const field = DAY_FIELD[kstNow.getDay()];
        const start = field ? toMinutesKey(item[`trmt${field}Start`]) : undefined;
        const end = field ? toMinutesKey(item[`trmt${field}End`]) : undefined;
        const current = kstNow.getHours() * 100 + kstNow.getMinutes();

        const emergencyNight = String(item.emyNgtYn ?? '').toUpperCase() === 'Y';
        const sundayNotice = String(item.noTrmtSun ?? '').trim();

        let isOpenNow: boolean | null;
        let closedReason = '';
        if (start !== undefined && end !== undefined) {
            isOpenNow = current >= start && current <= end;
            if (!isOpenNow) closedReason = '진료시간이 아닙니다';
        } else if (kstNow.getDay() === 0 && sundayNotice) {
            // 일요일은 시간 필드가 없고 noTrmtSun("전부 휴진")으로만 온다.
            isOpenNow = false;
            closedReason = `일요일 ${sundayNotice}`;
        } else if (field && item[`trmt${field}Start`] === undefined) {
            // 토요일 필드 자체가 없는 기관 = 그 요일 휴진.
            isOpenNow = false;
            closedReason = '해당 요일 진료시간이 등록되어 있지 않습니다';
        } else {
            isOpenNow = null;
            closedReason = '진료시간 정보가 등록되어 있지 않습니다';
        }

        return {
            name: hospitalName.trim(),
            hours_today: start !== undefined && end !== undefined
                ? `${formatClock(start)}~${formatClock(end)}` : '',
            lunch: String(item.lunchWeek ?? '').trim(),
            is_open_now: isOpenNow,
            closed_reason: closedReason,
            emergency_night: emergencyNight,
            emergency_phone: String(item.emyNgtTelNo1 ?? item.emyDayTelNo1 ?? '').trim(),
            checked_at: checkedAt,
        };
    } catch (error) {
        console.warn('[HospitalHours] lookup failed:', error);
        return null;
    }
}

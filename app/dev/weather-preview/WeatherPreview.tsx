'use client';

import React, { useState } from 'react';
import WeatherRenderer from '../../../components/WeatherRenderer';

// 표본 데이터 — 실제 카드 JSON 모양(server/lib/weather WeatherData). 현지 시각을 정해 낮/밤을 재현한다.
const TZ = 9 * 3600;
const ymd = (offsetDays: number) => {
    const d = new Date(Date.now() + TZ * 1000 + offsetDays * 86400000);
    return d.toISOString().slice(0, 10);
};
const atLocalHour = (h: number) => {
    const d = new Date(Date.now() + TZ * 1000);
    d.setUTCHours(h, 12, 0, 0);
    return new Date(d.getTime() - TZ * 1000).toISOString();
};
type Cond = 'clear' | 'mostlyClear' | 'partlyCloudy' | 'cloudy' | 'overcast' | 'rain' | 'shower' | 'snow' | 'fog';
const sample = (o: { name: string; source?: 'KMA' | 'OpenWeather'; cond: Cond; temp: number; hour: number; precip?: 'now' | 'expected'; mm?: number; pop?: number; days: [Cond, number, number, number][] }) => ({
    source: o.source ?? 'KMA',
    updatedAt: atLocalHour(o.hour),
    timezoneOffsetSec: TZ,
    location: { name: o.name, country: 'KR' },
    current: {
        temp: o.temp, feelsLike: o.temp - 1, minTemp: o.days[0][1], maxTemp: o.days[0][2], humidity: 64, pressure: null,
        windSpeed: 1.4, windGust: null, clouds: o.cond === 'clear' ? 0 : 80, visibilityKm: null, condition: o.cond,
        precip: { state: o.precip ?? 'none', mm: o.mm ?? 0, pop: o.pop ?? o.days[0][3] }, observedAt: atLocalHour(o.hour),
    },
    daily: o.days.map(([condition, minTemp, maxTemp, pop], i) => ({ date: ymd(i), condition, minTemp, maxTemp, pop, rainMm: 0, snowMm: 0 })),
    forecastDays: o.days.length,
    notes: [],
});
const WEEK: [Cond, number, number, number][] = [['partlyCloudy', 10, 21, 30], ['mostlyClear', 13, 24, 20], ['clear', 13, 24, 30], ['rain', 17, 21, 90], ['cloudy', 17, 17, 30]];

const SAMPLES: { id: string; label: string; data: any }[] = [
    { id: 'day', label: '맑음 · 낮 13시', data: sample({ name: '서울', cond: 'clear', temp: 16, hour: 13, days: WEEK }) },
    { id: 'night', label: '맑음 · 밤 23시', data: sample({ name: '서울', cond: 'clear', temp: 12, hour: 23, days: WEEK }) },
    { id: 'cloudy', label: '흐림', data: sample({ name: '부산광역시', cond: 'overcast', temp: 18, hour: 15, source: 'OpenWeather', days: WEEK }) },
    { id: 'rain', label: '비 (현재 강수)', data: sample({ name: '전주시', cond: 'rain', temp: 14, hour: 10, precip: 'now', mm: 3.5, pop: 90, days: [['rain', 12, 16, 90], ...WEEK.slice(1)] }) },
    { id: 'snow', label: '눈 (예보)', data: sample({ name: '강릉시', cond: 'cloudy', temp: -1, hour: 8, precip: 'expected', mm: 1.2, pop: 70, days: [['snow', -4, 2, 70], ...WEEK.slice(1)] }) },
    { id: 'error', label: '오류 카드', data: { error: true, input: '없는도시', code: 'CITY_NOT_FOUND' } },
];

export default function WeatherPreview() {
    const [id, setId] = useState('day');
    const s = SAMPLES.find(x => x.id === id)!;
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-[#0b1020] text-slate-800 dark:text-slate-200 p-4 sm:p-8">
            <div className="max-w-[1200px] mx-auto space-y-6">
                <header>
                    <h1 className="text-xl font-semibold">날씨 카드 미리보기</h1>
                    <p className="text-sm text-slate-500 mt-1">dev 전용. 운영 카드(components/WeatherRenderer)를 표본 데이터로 띄운다 — 낮/밤·흐림·강수·오류 상태 확인용.</p>
                </header>
                <section className="flex flex-wrap gap-2">
                    {SAMPLES.map(x => (
                        <button key={x.id} onClick={() => setId(x.id)}
                            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${id === x.id ? 'bg-indigo-500 text-white border-indigo-500' : 'border-slate-300 dark:border-white/15 hover:bg-slate-100 dark:hover:bg-white/5'}`}>
                            {x.label}
                        </button>
                    ))}
                </section>
                <section>
                    <WeatherRenderer data={s.data} language="ko" />
                </section>
            </div>
        </div>
    );
}

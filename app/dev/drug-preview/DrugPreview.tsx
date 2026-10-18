'use client';

import React from 'react';
import { DrugRenderer } from '../../../components/DrugRenderer';

// 표본 — MFDS 알약식별 API 실제 값(2026-10-18 조회). 각인은 서버가 정리한 뒤의 값(drug-imprint.ts: "마크" → "마크(dHP)").
const SAMPLES = [
    {
        note: '한 면만 각인 · MFDS 는 "뒷면" 인데 사진은 왼쪽(앞면 자리)',
        data: {
            name: '마그네스정', engName: 'Magnes Tab.', ingredient: '젖산마그네슘수화물 470mg + 피리독신염산염 5mg', category: '무기질제제',
            image_url: 'https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/1NOwp2F69jq',
            pill_visual: { shape: '장방형', color: '노랑', imprint_front: undefined, imprint_back: '마크(dHP)' },
        },
    },
    {
        note: '한 면만 각인 · MFDS 앞면',
        data: {
            name: '아프로바스크정300/5밀리그램', ingredient: '이르베사르탄 300mg + 암로디핀베실산염 5mg', category: '혈압강하제',
            image_url: 'https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/1Opnl07NLab',
            pill_visual: { shape: '타원형', color: '노랑', imprint_front: '300/5', imprint_back: undefined },
        },
    },
    {
        note: '양면 각인 — 두 방식이 같아야 한다',
        data: {
            name: '타이레놀정500밀리그람', ingredient: '아세트아미노펜 500mg', category: '해열.진통.소염제',
            image_url: 'https://nedrug.mfds.go.kr/pbp/cmn/itemImageDownload/1OKRXo9l4D5',
            pill_visual: { shape: '장방형', color: '하양', imprint_front: 'TYLENOL', imprint_back: '500' },
        },
    },
];

export default function DrugPreview() {
    return (
        <div className="min-h-screen bg-slate-950 text-slate-100 p-4 sm:p-8">
            <h1 className="text-lg font-bold mb-1">약 카드 — 각인 면 표기 비교</h1>
            <p className="text-xs text-slate-400 mb-6">① MFDS 앞/뒤 그대로 · ② 한 면만 각인이면 "각인 / 반대면". 로그인 없이 열어 이미지는 proxy 경로로 뜬다.</p>
            {SAMPLES.map(s => (
                <section key={s.data.name} className="mb-10">
                    <h2 className="text-sm font-semibold mb-3">{s.data.name} <span className="text-slate-400 font-normal">— {s.note}</span></h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div><div className="text-xs text-indigo-300 mb-2">① MFDS 그대로</div><DrugRenderer data={s.data} imprintSides="mfds" /></div>
                        <div><div className="text-xs text-indigo-300 mb-2">② 앞뒤 단정 안 함</div><DrugRenderer data={s.data} imprintSides="neutral" /></div>
                    </div>
                </section>
            ))}
        </div>
    );
}

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Language } from '../types';
import { magnitudeToSize, magnitudeToOpacity, projectStaticChart, applyViewTransform } from '../utils/celestialMath';
import { equatorialToHorizontal, horizontalToCanvas, isNighttime } from '../utils/astronomyHelper';

interface Star {
    id: number;
    ra: number;
    dec: number;
    mag: number;
    name?: string;
    constellation?: string;
}

interface ConstellationLine {
    id: string;
    name: { [key: string]: string };
    lines: [number, number][];
}

interface ConstellationData {
    stars: Star[];
    constellations?: ConstellationLine[];
    center?: { ra: number; dec: number };
    zoom?: number;
}

interface ConstellationRendererProps {
    data: ConstellationData;
    language: Language;
}

const labels = {
    ko: { title: '별자리 지도', snapshot: '스냅샷', analyzing: '별자리 분석 중...', mag: '등급', observer: '관측지 모드 (서울 실시간 하늘)', staticBadge: '정적', observerBadge: '관측지 · 서울', zoomIn: '확대', zoomOut: '축소', rotate: '회전', reset: '초기화' },
    en: { title: 'Constellation Map', snapshot: 'Snapshot', analyzing: 'Analyzing constellation...', mag: 'Mag', observer: 'Observer mode (live Seoul sky)', staticBadge: 'Static', observerBadge: 'Observer · Seoul', zoomIn: 'Zoom in', zoomOut: 'Zoom out', rotate: 'Rotate', reset: 'Reset' },
    es: { title: 'Mapa de Constelaciones', snapshot: 'Captura', analyzing: 'Analizando constelación...', mag: 'Mag', observer: 'Modo observador (cielo de Seúl en vivo)', staticBadge: 'Estática', observerBadge: 'Observador · Seúl', zoomIn: 'Acercar', zoomOut: 'Alejar', rotate: 'Rotar', reset: 'Restablecer' },
    fr: { title: 'Carte des Constellations', snapshot: 'Capture', analyzing: 'Analyse de constellation...', mag: 'Mag', observer: 'Mode observateur (ciel de Séoul en direct)', staticBadge: 'Statique', observerBadge: 'Observateur · Séoul', zoomIn: 'Zoom avant', zoomOut: 'Zoom arrière', rotate: 'Rotation', reset: 'Réinitialiser' }
};

// 등급별 별 색온도 (O/B → K/M 형)
const getStarColor = (mag: number): string => {
    // 따뜻한 금색 포스터 램프 (밝을수록 흰 금색, 어두울수록 짙은 금색)
    if (mag < 0.5) return '#ffeecd';
    if (mag < 1.5) return '#ffecc4';
    if (mag < 2.5) return '#ffe2a8';
    if (mag < 3.5) return '#ffd696';
    return '#ffcc88';
};

const hexToRgba = (hex: string, a: number): string => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
};

const ConstellationRenderer: React.FC<ConstellationRendererProps> = ({ data, language }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const currentLabels = labels[language] || labels.ko;

    // 상호작용 상태
    const [zoom, setZoom] = useState(1.0);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [observerMode, setObserverMode] = useState(false); // false = 정적 포스터 차트(기본), true = 실시간 서울 하늘
    const [viewRot, setViewRot] = useState(0);                // 사용자 뷰 회전(라디안), 두 모드 공통
    const [hoveredStar, setHoveredStar] = useState<Star | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [hasAutoCentered, setHasAutoCentered] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    // 호버 판정용 투영된 별 위치
    const projectedStarsRef = useRef<Array<Star & { canvasX: number; canvasY: number; visible?: boolean }>>([]);
    // 핀치 줌 추적
    const pinchStartDistRef = useRef<number | null>(null);
    const pinchStartZoomRef = useRef<number>(1.0);

    // 줌 한계
    const MIN_ZOOM = 0.3;
    const MAX_ZOOM = 3.0;
    const ZOOM_STEP = 0.2;

    // 관측자 위치 (서울) — 실시간 하늘 모드에서 쓴다
    const [observerLocation] = useState({
        latitude: 37.5665,
        longitude: 126.9780,
        elevation: 0
    });

    const [observerTime, setObserverTime] = useState(new Date());
    const [isNight, setIsNight] = useState(true);

    // 시간 애니메이션 루프
    useEffect(() => {
        if (isPlaying) {
            animationIntervalRef.current = setInterval(() => {
                setObserverTime(prev => new Date(prev.getTime() + 3600000));
            }, 150);
        } else {
            if (animationIntervalRef.current) {
                clearInterval(animationIntervalRef.current);
                animationIntervalRef.current = null;
            }
        }

        return () => {
            if (animationIntervalRef.current) {
                clearInterval(animationIntervalRef.current);
            }
        };
    }, [isPlaying]);

    // 시간·위치가 바뀌면 낮/밤 상태 갱신
    useEffect(() => {
        const night = isNighttime(observerTime, observerLocation);
        setIsNight(night);
    }, [observerTime, observerLocation]);

    // 은하수 입자 생성
    const milkyWayParticles = useMemo(() => {
        const particles = [];
        const coreRA = 17.8; // 궁수자리 방향
        const coreDec = -29.0;

        for (let i = 0; i < 500; i++) {
            // 중심 성단 (조밀)
            if (i < 250) {
                const dist = Math.random();
                particles.push({
                    ra: coreRA + (Math.random() - 0.5) * 4, // 조금 더 넓게 퍼짐
                    dec: coreDec + (Math.random() - 0.5) * 18,
                    size: Math.random() * 35 + 15, // 더 부드럽고 큰 입자
                    opacity: (Math.random() * 0.01 + 0.003) * (1 - dist), // 훨씬 흐리게 (최대 ~1.3%)
                    color: '#a0c0ff'
                });
            } else {
                // 바깥으로 뻗는 띠
                particles.push({
                    ra: coreRA + (Math.random() - 0.5) * 6 + (Math.random() > 0.5 ? 2.5 : -2.5),
                    dec: coreDec + (Math.random() - 0.5) * 50,
                    size: Math.random() * 40 + 20,
                    opacity: Math.random() * 0.005 + 0.001, // 아주 흐린 배경
                    color: '#ffffff'
                });
            }
        }
        return particles;
    }, []);

    // 장식용 배경 흐린 별 (화면 좌표, 결정적)
    const bgStars = useMemo(() => {
        const stars: { x: number; y: number; size: number; opacity: number }[] = [];
        let seed = 12345;
        const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff; };
        for (let i = 0; i < 280; i++) {
            stars.push({ x: rand(), y: rand(), size: rand() * 0.7 + 0.2, opacity: rand() * 0.28 + 0.07 });
        }
        return stars;
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 반응형 캔버스: 실제 카드 폭에 맞춰 포스터가 화면을 자연스럽게 채운다.
        const updateCanvasSize = () => {
            const container = canvas.parentElement;
            if (!container) return;

            const isMobile = window.innerWidth < 640;
            // 카드 실제 폭에 맞춘다. 모바일은 세로 여유를 위해 더 높은(정사각형에 가까운) 프레임.
            const width = Math.max(280, Math.round(container.clientWidth));
            const height = Math.round(width * (isMobile ? 0.8 : 0.6));

            canvas.width = width * 2; // 레티나(2x) — renderConstellation/handleSnapshot 이 이 배율을 전제한다
            canvas.height = height * 2;
            canvas.style.width = '100%';
            canvas.style.height = `${height}px`;

            ctx.setTransform(1, 0, 0, 1, 0, 0); // 초기화 — 리사이즈가 반복돼도 배율이 누적되지 않게
            ctx.scale(2, 2);
            renderConstellation();
        };

        const renderConstellation = () => {
            if (!ctx || !canvas) return;

            const width = canvas.width / 2;
            const height = canvas.height / 2;
            // 줌을 배율에 적용
            const scale = height * 0.4 * zoom * (data.zoom || 1.0);

            // 심우주 방사형 그라데이션 배경
            const bgGrad = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.75);
            bgGrad.addColorStop(0,   '#060d20');
            bgGrad.addColorStop(0.5, '#030a16');
            bgGrad.addColorStop(1,   '#010306');
            ctx.fillStyle = bgGrad;
            ctx.fillRect(0, 0, width, height);

            // 따뜻한 포스터 성운 — 보라(좌하) + 파랑(우상)
            const neb1 = ctx.createRadialGradient(width * 0.22, height * 0.82, 0, width * 0.22, height * 0.82, width * 0.55);
            neb1.addColorStop(0, 'rgba(96,62,128,0.42)');
            neb1.addColorStop(1, 'rgba(96,62,128,0)');
            ctx.fillStyle = neb1;
            ctx.fillRect(0, 0, width, height);
            const neb2 = ctx.createRadialGradient(width * 0.8, height * 0.2, 0, width * 0.8, height * 0.2, width * 0.55);
            neb2.addColorStop(0, 'rgba(38,92,140,0.34)');
            neb2.addColorStop(1, 'rgba(38,92,140,0)');
            ctx.fillStyle = neb2;
            ctx.fillRect(0, 0, width, height);

            // 아래 가장자리 은은한 대기광
            const atmGrad = ctx.createLinearGradient(0, height * 0.72, 0, height);
            atmGrad.addColorStop(0, 'rgba(0,0,0,0)');
            atmGrad.addColorStop(1, 'rgba(10,25,50,0.35)');
            ctx.fillStyle = atmGrad;
            ctx.fillRect(0, 0, width, height);

            // 배경 흐린 별 (화면 좌표, 장식)
            ctx.globalCompositeOperation = 'screen';
            bgStars.forEach(s => {
                const sx = s.x * width;
                const sy = s.y * height;
                const gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, s.size * 2.2);
                gr.addColorStop(0, `rgba(200,215,255,${s.opacity})`);
                gr.addColorStop(1, 'rgba(200,215,255,0)');
                ctx.fillStyle = gr;
                ctx.beginPath();
                ctx.arc(sx, sy, s.size * 2.2, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalCompositeOperation = 'source-over';

            // 은하수 배경 — 관측자(실제 하늘) 모드에서만. 정적 포스터 차트는 생략
            if (observerMode) {
                ctx.globalCompositeOperation = 'screen';

                milkyWayParticles.forEach(p => {
                    const hor = equatorialToHorizontal(p.ra, p.dec, observerTime, observerLocation);
                    // 간단한 가시성 판정 (광채 여유 포함)
                    if (hor.altitude < -10) return;

                    const [cx, cy] = horizontalToCanvas(hor.altitude, hor.azimuth, width, height, scale);
                    const x = cx + panOffset.x;
                    const y = cy + panOffset.y;

                    // 화면 밖이면 건너뜀 (최적화)
                    if (x < -p.size || x > width + p.size || y < -p.size || y > height + p.size) return;

                    const radial = ctx.createRadialGradient(x, y, 0, x, y, p.size * zoom);
                    radial.addColorStop(0, `rgba(60, 80, 120, ${p.opacity})`); // 심우주 파랑
                    radial.addColorStop(1, 'rgba(60, 80, 120, 0)');

                    ctx.fillStyle = radial;
                    ctx.beginPath();
                    ctx.arc(x, y, p.size * zoom, 0, Math.PI * 2);
                    ctx.fill();
                });

                ctx.globalCompositeOperation = 'source-over'; // 블렌딩 모드 복원
            }

            // 구도를 위해 실제 별 위치로 중심 RA/Dec 계산
            let centerRA = data.center?.ra;
            let centerDec = data.center?.dec;

            if (!centerRA || !centerDec) {
                // 별 위치로 중심 자동 계산
                const avgRA = data.stars.reduce((sum, s) => sum + s.ra, 0) / data.stars.length;
                const avgDec = data.stars.reduce((sum, s) => sum + s.dec, 0) / data.stars.length;
                centerRA = avgRA;
                centerDec = avgDec;
            }

            // 별 투영: 정적 포스터 차트(기본) 또는 실시간 고도/방위(관측자 모드)
            let projectedStars: Array<Star & { canvasX: number; canvasY: number; visible?: boolean }>;
            if (!observerMode) {
                // 정적: 실제 RA/Dec 상대 위치, 중앙 정렬 + 자동 맞춤, 시간·위치 무관
                // 모바일은 좌우 여백을 줄이고, 포스터 제목이 그림과 겹치지 않게 위쪽 띠를 비워 둔다
                const isMobileView = window.innerWidth < 640;
                const flat = projectStaticChart(
                    data.stars, width, height,
                    isMobileView ? 0.09 : 0.12,
                    isMobileView ? 0.10 : 0.12,
                    isMobileView ? 54 : 74,
                );
                const posById = Object.fromEntries(flat.map(p => [p.id, p]));
                projectedStars = data.stars.map(s => ({ ...s, canvasX: posById[s.id].x, canvasY: posById[s.id].y, visible: true }));
            } else {
                // 관측자: 실제 서울 하늘. 줌은 아래 뷰 변환이 처리하므로 줌 없는 기본 배율로 투영.
                const baseScale = height * 0.4 * (data.zoom || 1.0);
                projectedStars = data.stars.map(star => {
                    const hor = equatorialToHorizontal(star.ra, star.dec, observerTime, observerLocation);
                    const [canvasX, canvasY] = horizontalToCanvas(hor.altitude, hor.azimuth, width, height, baseScale);
                    return { ...star, canvasX, canvasY, visible: hor.visible };
                });

                // 첫 로드 때 별자리를 안전 영역 가운데로 자동 정렬 (관측자 모드만)
                const visibleStars = projectedStars.filter(s => s.visible !== false);
                if (visibleStars.length > 0 && !hasAutoCentered) {
                    const minY = Math.min(...visibleStars.map(s => s.canvasY));
                    const maxY = Math.max(...visibleStars.map(s => s.canvasY));
                    const avgY = (minY + maxY) / 2;
                    const safeTop = 55 + 20, safeBottom = height - 80 - 20;
                    const safeCenterY = safeTop + (safeBottom - safeTop) / 2;
                    setPanOffset({ x: 0, y: safeCenterY - avgY });
                    setHasAutoCentered(true);
                }
            }

            // 캔버스 중심 기준 사용자 뷰 변환(줌 + 회전 + 이동) — 두 모드 공통
            {
                const vt = applyViewTransform(
                    projectedStars.map(s => ({ id: s.id, x: s.canvasX, y: s.canvasY })),
                    width / 2, height / 2,
                    { scale: zoom, rot: viewRot, px: panOffset.x, py: panOffset.y },
                );
                const vById = Object.fromEntries(vt.map(p => [p.id, p]));
                projectedStars = projectedStars.map(s => ({ ...s, canvasX: vById[s.id].x, canvasY: vById[s.id].y }));
            }

            // 호버 판정용 투영 별 저장 (위치에 뷰 변환이 이미 반영됨)
            projectedStarsRef.current = projectedStars;

            // 별자리 선 그리기 (그라데이션 광채 + 얇은 심선)
            if (data.constellations) {
                data.constellations.forEach(constellation => {
                    constellation.lines.forEach(([startId, endId]) => {
                        const start = projectedStars.find(s => s.id === startId);
                        const end = projectedStars.find(s => s.id === endId);
                        if (!start || !end || start.visible === false || end.visible === false) return;

                        const x1 = start.canvasX;
                        const y1 = start.canvasY;
                        const x2 = end.canvasX;
                        const y2 = end.canvasY;

                        // 따뜻한 금색 광채 선 — 가운데가 밝고 별 끝에서 흐려짐
                        const lineGrad = ctx.createLinearGradient(x1, y1, x2, y2);
                        lineGrad.addColorStop(0,   'rgba(224, 168, 111, 0.12)');
                        lineGrad.addColorStop(0.5, 'rgba(240, 205, 150, 0.9)');
                        lineGrad.addColorStop(1,   'rgba(224, 168, 111, 0.12)');
                        ctx.strokeStyle = lineGrad;
                        ctx.lineWidth = 1.4;
                        ctx.lineCap = 'round';
                        ctx.shadowColor = 'rgba(240, 200, 140, 0.5)';
                        ctx.shadowBlur = 9;
                        ctx.beginPath();
                        ctx.moveTo(x1, y1);
                        ctx.lineTo(x2, y2);
                        ctx.stroke();
                        ctx.shadowBlur = 0;
                    });
                });
            }

            // 별 그리기 — 따뜻한 금색 후광(흐린 별은 좁게, 조밀한 성군도 구분되게) + 십자 광채 + 따뜻한 중심
            projectedStars.filter(star => star.visible !== false).forEach(star => {
                const size = magnitudeToSize(star.mag) * 1.5;
                const opacity = magnitudeToOpacity(star.mag);
                const color = getStarColor(star.mag);
                const x = star.canvasX;
                const y = star.canvasY;
                const haloMul = star.mag < 2.5 ? 3.5 : star.mag < 3.4 ? 2.9 : 2.3;
                const haloR = size * haloMul;

                // 바깥 광채 (금빛)
                const glow = ctx.createRadialGradient(x, y, 0, x, y, haloR);
                glow.addColorStop(0,   hexToRgba(color, opacity * 0.9));
                glow.addColorStop(0.3, hexToRgba(color, opacity * 0.5));
                glow.addColorStop(0.7, hexToRgba(color, opacity * 0.15));
                glow.addColorStop(1,   hexToRgba(color, 0));
                ctx.fillStyle = glow;
                ctx.beginPath();
                ctx.arc(x, y, haloR, 0, Math.PI * 2);
                ctx.fill();

                // 밝은 별의 4방향 십자 광채 (포스터 반짝임)
                if (star.mag < 3.0) {
                    const L = size * 3.4;
                    for (const [ex, ey] of [[L, 0], [0, L]] as [number, number][]) {
                        const sg = ctx.createLinearGradient(x - ex, y - ey, x + ex, y + ey);
                        sg.addColorStop(0, 'rgba(255,240,205,0)');
                        sg.addColorStop(0.5, `rgba(255,244,215,${Math.min(0.6, opacity * 0.6)})`);
                        sg.addColorStop(1, 'rgba(255,240,205,0)');
                        ctx.strokeStyle = sg;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(x - ex, y - ey);
                        ctx.lineTo(x + ex, y + ey);
                        ctx.stroke();
                    }
                }

                // 따뜻하고 밝은 중심
                ctx.fillStyle = `rgba(255,246,220,${Math.min(1, opacity * 1.3)})`;
                ctx.beginPath();
                ctx.arc(x, y, size * 0.62, 0, Math.PI * 2);
                ctx.fill();
            });

            // 충돌 판정으로 별 이름 그리기
            const isMobileCanvas = window.innerWidth < 640;
            const labelFontSize = isMobileCanvas ? 10 : 12;
            const labelHeight = isMobileCanvas ? 15 : 18;
            ctx.font = `${labelFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // 겹침 방지용 라벨 위치 기록
            const labelBounds: { x: number; y: number; width: number; height: number }[] = [];

            const checkCollision = (x: number, y: number, width: number, height: number): boolean => {
                return labelBounds.some(bound =>
                    x < bound.x + bound.width &&
                    x + width > bound.x &&
                    y < bound.y + bound.height &&
                    y + height > bound.y
                );
            };

            // 라벨 우선순위: 밝은 별부터 정렬
            const sortedStars = [...projectedStars].sort((a, b) => a.mag - b.mag);

            sortedStars.forEach(star => {
                // 줌 수준과 등급으로 라벨 표시 여부 결정
                // 줌 0.5: 등급 < 1.0 표시
                // 줌 1.0: 등급 < 2.0 표시
                // 줌 3.0: 등급 < 4.0 표시
                const visibleMagLimit = 0.5 + (zoom * 1.2);

                if (star.name && star.mag < visibleMagLimit) {
                    const size = magnitudeToSize(star.mag) * 1.5;
                    // 적응형 광채: 밝은 별(낮은 등급)일수록 크게
                    const glowRadius = size * (4 - star.mag * 0.5); // 밝은 별은 3.5~4배

                    // 글자 크기 측정
                    const textMetrics = ctx.measureText(star.name);
                    const labelWidth = textMetrics.width + 10;

                    // 별 위치에 이동 오프셋 적용
                    const starX = star.canvasX;
                    const starY = star.canvasY;

                    // 여러 위치 시도: 아래, 위, 오른쪽, 왼쪽
                    const positions = [
                        { // 아래 (우선)
                            x: starX - labelWidth / 2,
                            y: starY + glowRadius + 6,
                            align: 'center' as CanvasTextAlign,
                            baseline: 'top' as CanvasTextBaseline
                        },
                        { // 위
                            x: starX - labelWidth / 2,
                            y: starY - glowRadius - 6 - labelHeight,
                            align: 'center' as CanvasTextAlign,
                            baseline: 'top' as CanvasTextBaseline
                        },
                        { // 오른쪽
                            x: starX + glowRadius + 6,
                            y: starY - labelHeight / 2,
                            align: 'left' as CanvasTextAlign,
                            baseline: 'middle' as CanvasTextBaseline
                        },
                        { // 왼쪽
                            x: starX - glowRadius - 6 - labelWidth,
                            y: starY - labelHeight / 2,
                            align: 'left' as CanvasTextAlign,
                            baseline: 'middle' as CanvasTextBaseline
                        }
                    ];

                    // 충돌 없는 첫 위치 찾기
                    for (const pos of positions) {
                        if (!checkCollision(pos.x, pos.y, labelWidth, labelHeight)) {
                            ctx.textAlign = pos.align;
                            ctx.textBaseline = pos.baseline;
                            ctx.fillStyle = 'rgba(248, 223, 176, 0.95)';

                            const textX = pos.align === 'center' ? starX :
                                pos.align === 'left' ? pos.x : pos.x + labelWidth;
                            const textY = pos.baseline === 'top' ? pos.y :
                                pos.baseline === 'middle' ? starY : pos.y + labelHeight;

                            ctx.fillText(star.name, textX, textY);
                            labelBounds.push({ x: pos.x, y: pos.y, width: labelWidth, height: labelHeight });
                            break;
                        }
                    }
                }
            });

            // 별자리 이름은 캔버스가 아니라 헤더에 표시한다(캔버스가 어수선해서).

            setIsLoading(false);
        };

        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);

        return () => {
            window.removeEventListener('resize', updateCanvasSize);
        };
    }, [data, language, zoom, panOffset, observerTime, observerLocation, observerMode, viewRot]);

    // preventDefault 를 쓰려고 휠 이벤트를 passive: false 로 등록
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const handleWheelPassive = (e: WheelEvent) => {
            e.preventDefault();
            handleWheel(e as any);
        };

        canvas.addEventListener('wheel', handleWheelPassive, { passive: false });
        return () => {
            canvas.removeEventListener('wheel', handleWheelPassive);
        };
    }, [zoom]);

    // 줌 조작
    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
    };

    const handleResetView = () => {
        setZoom(1.0);
        setPanOffset({ x: 0, y: 0 });
        setViewRot(0);
        setHoveredStar(null);
        setHasAutoCentered(false); // 자동 중앙 정렬 다시 켜기
    };

    // 클릭마다 뷰를 15° 회전 (버튼 하나, 한 바퀴 돌면 처음으로)
    const handleRotate = () => setViewRot(prev => prev + Math.PI / 12);

    // 정적 포스터 차트 ↔ 실시간 서울 하늘 전환. 구도가 깨지지 않게 프레이밍 초기화
    const handleToggleObserver = () => {
        setObserverMode(prev => !prev);
        setPanOffset({ x: 0, y: 0 });
        setViewRot(0);
        setHoveredStar(null);
        setHasAutoCentered(false);
        setIsPlaying(false);
    };

    // 마우스 휠 줌
    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
    };

    // 이동 조작
    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    };

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();

        if (isDragging) {
            setPanOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        } else {
            // CSS 픽셀 좌표 = 논리 캔버스 좌표 (별은 논리 좌표로 저장)
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const threshold = 15;
            let foundStar: Star | null = null;
            let minDistance = threshold;

            projectedStarsRef.current.forEach(star => {
                if (star.visible === false) return;
                const starScreenX = star.canvasX;
                const starScreenY = star.canvasY;
                const distance = Math.sqrt(
                    Math.pow(x - starScreenX, 2) +
                    Math.pow(y - starScreenY, 2)
                );
                if (distance < minDistance) {
                    minDistance = distance;
                    foundStar = star;
                }
            });

            if (foundStar) {
                setHoveredStar(foundStar);
                canvas.style.cursor = 'pointer';
            } else {
                setHoveredStar(null);
                canvas.style.cursor = 'grab';
            }
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
        setHoveredStar(null);
    };

    // 터치 지원 (드래그 + 핀치 줌)
    const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length === 1) {
            const touch = e.touches[0];
            setIsDragging(true);
            pinchStartDistRef.current = null;
            setDragStart({ x: touch.clientX - panOffset.x, y: touch.clientY - panOffset.y });
        } else if (e.touches.length === 2) {
            setIsDragging(false);
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
            pinchStartZoomRef.current = zoom;
        }
    };

    const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length === 1 && isDragging) {
            const touch = e.touches[0];
            setPanOffset({
                x: touch.clientX - dragStart.x,
                y: touch.clientY - dragStart.y
            });
        } else if (e.touches.length === 2 && pinchStartDistRef.current !== null) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const ratio = dist / pinchStartDistRef.current;
            setZoom(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchStartZoomRef.current * ratio)));
        }
    };

    const handleTouchEnd = (e: React.TouchEvent<HTMLCanvasElement>) => {
        if (e.touches.length === 0) {
            setIsDragging(false);
            pinchStartDistRef.current = null;
        } else if (e.touches.length === 1) {
            // 핀치에서 한 손가락으로 — 현재 위치에서 드래그 재개
            const touch = e.touches[0];
            pinchStartDistRef.current = null;
            setIsDragging(true);
            setDragStart({ x: touch.clientX - panOffset.x, y: touch.clientY - panOffset.y });
        }
    };

    const handleSnapshot = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.fillStyle = '#060d20';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        // 포스터 제목(현지화된 이름 + 금색 선)을 내보내기 이미지에 새긴다.
        // 캔버스는 2x 레티나로 그려지므로(updateCanvasSize 의 ctx.scale(2,2)) scale(2,2) 로 맞춘다.
        const name = data.constellations?.[0]?.name?.[language]
            ?? data.constellations?.[0]?.name?.en
            ?? currentLabels.title;
        tempCtx.setTransform(2, 0, 0, 2, 0, 0);
        tempCtx.textBaseline = 'top';
        tempCtx.font = '800 34px system-ui, -apple-system, "Segoe UI", sans-serif';
        tempCtx.fillStyle = '#f0cd93';
        tempCtx.shadowColor = 'rgba(0,0,0,0.55)';
        tempCtx.shadowBlur = 10;
        tempCtx.fillText(name, 24, 22);
        tempCtx.shadowBlur = 0;
        const ruleY = 22 + 34 + 12;
        const rg = tempCtx.createLinearGradient(24, 0, 24 + 160, 0);
        rg.addColorStop(0, 'rgba(234,194,132,0.85)');
        rg.addColorStop(1, 'rgba(234,194,132,0)');
        tempCtx.fillStyle = rg;
        tempCtx.fillRect(24, ruleY, 160, 1);
        tempCtx.setTransform(1, 0, 0, 1, 0, 0);

        // 파일 이름: EnglishName_YYYYMMDD.png
        const enName = data.constellations?.[0]?.name?.en ?? 'constellation';
        const slug = enName.replace(/\s+/g, '-').replace(/[^\w-]/g, '');
        const now = new Date();
        const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        const filename = `${slug}_${date}.png`;

        tempCanvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        });
    };

    return (
        <div className="relative my-6 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-xl bg-[#0a0a0b]">
            {/* 포스터 제목 — 좌상단 (현지화된 별자리 이름 + 금색 선) */}
            <div className="absolute top-4 left-4 sm:top-5 sm:left-6 z-20 pointer-events-none">
                <div className="text-2xl sm:text-4xl font-extrabold tracking-tight" style={{ color: '#f0cd93', textShadow: '0 0 26px rgba(234,194,132,0.3), 0 2px 12px rgba(0,0,0,0.6)' }}>
                    {data.constellations && data.constellations.length > 0
                        ? (data.constellations[0].name[language] || data.constellations[0].name.en)
                        : currentLabels.title}
                </div>
                <div className="mt-2 sm:mt-3 h-px w-28 sm:w-40" style={{ background: 'linear-gradient(90deg, rgba(234,194,132,0.85), rgba(234,194,132,0))' }} />
            </div>

            {/* 우상단 묶음: 모드 배지 + 시간 조작(관측자만) + 관측자 전환 + 스냅샷 */}
            <div className="absolute top-2.5 right-2.5 sm:top-3 sm:right-3 z-20 flex items-center gap-1.5">
                <span className="hidden sm:inline text-[10px] uppercase tracking-wider" style={{ color: 'rgba(244,215,161,0.5)' }}>
                    {observerMode ? currentLabels.observerBadge : currentLabels.staticBadge}
                </span>
                <button
                    onClick={handleToggleObserver}
                    className={`w-8 h-8 flex items-center justify-center rounded-lg border transition-all active:scale-95 ${observerMode ? 'text-amber-100 border-amber-300/50 bg-amber-500/20' : 'text-amber-200/80 border-white/10 bg-black/50 hover:bg-white/10'}`}
                    title={currentLabels.observer}
                    aria-label={currentLabels.observer}
                >
                    <i className="fa-solid fa-location-crosshairs text-xs sm:text-sm"></i>
                </button>
                <button
                    onClick={handleSnapshot}
                    className="w-8 h-8 flex items-center justify-center text-amber-200/80 bg-black/50 backdrop-blur-md hover:bg-white/10 hover:text-amber-100 active:scale-95 rounded-lg border border-white/10 transition-all"
                    title={currentLabels.snapshot}
                >
                    <i className="fa-solid fa-camera text-xs sm:text-sm"></i>
                </button>
            </div>


            {/* 캔버스 */}
            <canvas
                ref={canvasRef}
                className={`w-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            />

            {/* 조작 패널 */}
            <div className="absolute bottom-2.5 right-2.5 sm:bottom-3 sm:right-3 flex flex-col gap-1 sm:gap-1.5 z-20">
                {/* 줌 조작 */}
                <div className="flex flex-col bg-black/60 backdrop-blur-md rounded border border-white/10">
                    <button
                        onClick={handleZoomIn}
                        disabled={zoom >= MAX_ZOOM}
                        className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-t transition-all"
                        title={currentLabels.zoomIn}
                    >
                        <i className="fa-solid fa-plus text-xs sm:text-sm"></i>
                    </button>
                    <div className="h-px bg-white/10"></div>
                    <button
                        onClick={handleZoomOut}
                        disabled={zoom <= MIN_ZOOM}
                        className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-b transition-all"
                        title={currentLabels.zoomOut}
                    >
                        <i className="fa-solid fa-minus text-xs sm:text-sm"></i>
                    </button>
                </div>

                {/* 회전 버튼 */}
                <button
                    onClick={handleRotate}
                    className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-white bg-black/60 backdrop-blur-md hover:bg-white/10 active:bg-white/20 rounded border border-white/10 transition-all"
                    title={currentLabels.rotate}
                >
                    <i className="fa-solid fa-rotate text-xs sm:text-sm"></i>
                </button>

                {/* 초기화 버튼 */}
                <button
                    onClick={handleResetView}
                    className="w-6 h-6 sm:w-7 sm:h-7 flex items-center justify-center text-white bg-black/60 backdrop-blur-md hover:bg-white/10 active:bg-white/20 rounded border border-white/10 transition-all"
                    title={currentLabels.reset}
                >
                    <i className="fa-solid fa-house text-xs sm:text-sm"></i>
                </button>
            </div>
            {/* 별 정보 패널 — 좌하단 고정 글래스모피즘 */}
            <div className={`absolute bottom-2.5 left-2.5 sm:bottom-3 sm:left-3 z-20 transition-all duration-200 ${hoveredStar ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'}`}>
                {hoveredStar && (
                    <div className="bg-black/55 backdrop-blur-xl rounded-xl sm:rounded-2xl border border-white/10 px-3 py-2 sm:px-4 sm:py-3 shadow-2xl min-w-[150px] sm:min-w-[185px]">
                        <div className="flex items-center gap-1.5 mb-1.5 sm:mb-2.5">
                            <div
                                className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0"
                                style={{ background: getStarColor(hoveredStar.mag), boxShadow: `0 0 6px 2px ${getStarColor(hoveredStar.mag)}` }}
                            />
                            <p className="text-[11px] sm:text-[13px] font-semibold text-white leading-tight truncate">
                                {hoveredStar.name || '—'}
                            </p>
                        </div>
                        <div className="flex flex-col gap-0.5 sm:gap-1">
                            <div className="flex justify-between gap-4 sm:gap-6">
                                <span className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-wide">{currentLabels.mag}</span>
                                <span className="text-[9px] sm:text-[11px] text-slate-200 font-mono">{hoveredStar.mag.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between gap-4 sm:gap-6">
                                <span className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-wide">RA</span>
                                <span className="text-[9px] sm:text-[11px] text-slate-200 font-mono">{hoveredStar.ra.toFixed(2)}h</span>
                            </div>
                            <div className="flex justify-between gap-4 sm:gap-6">
                                <span className="text-[9px] sm:text-[10px] text-slate-500 uppercase tracking-wide">Dec</span>
                                <span className="text-[9px] sm:text-[11px] text-slate-200 font-mono">{hoveredStar.dec.toFixed(2)}°</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 관측자 시간 조작 — 하단 가운데 (관측자 모드만, 제목과 겹치지 않게) */}
            {observerMode && (
                <div className="absolute bottom-2.5 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-1 bg-black/55 backdrop-blur-md rounded-lg border border-white/10">
                    <span className="text-[9px] sm:text-[10px] font-mono text-white whitespace-nowrap">
                        {observerTime.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-[9px] sm:text-[10px]">{isNight ? '🌙' : '☀️'}</span>
                    <button onClick={() => setObserverTime(new Date(observerTime.getTime() - 3600000))} className="px-1 text-[10px] sm:text-xs text-white/90 hover:text-white active:scale-95" title="-1h">◀</button>
                    <button onClick={() => setIsPlaying(!isPlaying)} className="px-1 text-[10px] sm:text-xs text-amber-300 hover:text-amber-200 active:scale-95" title={isPlaying ? '⏸' : '▶'}>
                        <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                    </button>
                    <button onClick={() => setObserverTime(new Date(observerTime.getTime() + 3600000))} className="px-1 text-[10px] sm:text-xs text-white/90 hover:text-white active:scale-95" title="+1h">▶</button>
                </div>
            )}

            {/* 줌 표시 */}
            <div className="absolute bottom-2.5 sm:bottom-3 right-11 sm:right-14 z-20 px-1.5 sm:px-2 h-5 sm:h-6 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded border border-white/10 shadow-lg">
                <span className="text-[9px] sm:text-[10px] font-mono text-slate-300 leading-none">
                    {(zoom * 100).toFixed(0)}%
                </span>
            </div>

            {/* 로딩 오버레이 */}
            {
                isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[#0a0a0b]/80 backdrop-blur-sm">
                        <div className="flex items-center gap-2 text-slate-400">
                            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                            <span className="text-sm font-medium">{currentLabels.analyzing}</span>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default ConstellationRenderer;

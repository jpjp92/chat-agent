import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Language } from '../types';
import { projectToCanvas, magnitudeToSize, magnitudeToOpacity } from '../utils/celestialMath';
import { equatorialToHorizontal, horizontalToCanvas, getCurrentLocation, isNighttime } from '../utils/astronomyHelper';

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
    ko: { title: '별자리 지도', snapshot: '스냅샷', analyzing: '별자리 분석 중...' },
    en: { title: 'Constellation Map', snapshot: 'Snapshot', analyzing: 'Analyzing constellation...' },
    es: { title: 'Mapa de Constelaciones', snapshot: 'Captura', analyzing: 'Analizando constelación...' },
    fr: { title: 'Carte des Constellations', snapshot: 'Capture', analyzing: 'Analyse de constellation...' }
};

const ConstellationRenderer: React.FC<ConstellationRendererProps> = ({ data, language }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const currentLabels = labels[language] || labels.ko;

    // Interactive state
    const [zoom, setZoom] = useState(1.0);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [hoveredStar, setHoveredStar] = useState<Star | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [hasAutoCentered, setHasAutoCentered] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);

    // Store projected star positions for hover detection
    const projectedStarsRef = useRef<Array<Star & { canvasX: number; canvasY: number; visible?: boolean }>>([]);
    // Pinch-to-zoom tracking
    const pinchStartDistRef = useRef<number | null>(null);
    const pinchStartZoomRef = useRef<number>(1.0);

    // Zoom limits
    const MIN_ZOOM = 0.3;
    const MAX_ZOOM = 3.0;
    const ZOOM_STEP = 0.2;

    // Always use realtime sky mode (Static mode removed)
    // Observer location (Seoul, South Korea)
    const [observerLocation] = useState({
        latitude: 37.5665,
        longitude: 126.9780,
        elevation: 0
    });

    const [observerTime, setObserverTime] = useState(new Date());
    const [isNight, setIsNight] = useState(true);

    // Time animation loop
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

    // Update night/day status when time or location changes
    useEffect(() => {
        const night = isNighttime(observerTime, observerLocation);
        setIsNight(night);
    }, [observerTime, observerLocation]);

    // Generate Milky Way particles (Prototype)
    const milkyWayParticles = useMemo(() => {
        const particles = [];
        const coreRA = 17.8; // Sagittarius direction
        const coreDec = -29.0;

        for (let i = 0; i < 500; i++) {
            // Core cluster (dense)
            if (i < 250) {
                const dist = Math.random();
                particles.push({
                    ra: coreRA + (Math.random() - 0.5) * 4, // Slightly wider spread
                    dec: coreDec + (Math.random() - 0.5) * 18,
                    size: Math.random() * 35 + 15, // Softer, larger particles
                    opacity: (Math.random() * 0.01 + 0.003) * (1 - dist), // Much fainter (max ~1.3%)
                    color: '#a0c0ff'
                });
            } else {
                // Band extending outwards
                const t = Math.random();
                particles.push({
                    ra: coreRA + (Math.random() - 0.5) * 6 + (Math.random() > 0.5 ? 2.5 : -2.5),
                    dec: coreDec + (Math.random() - 0.5) * 50,
                    size: Math.random() * 40 + 20,
                    opacity: Math.random() * 0.005 + 0.001, // Extremely faint background
                    color: '#ffffff'
                });
            }
        }
        return particles;
    }, []);


    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Set canvas size - fixed dimensions like ChemicalRenderer
        const updateCanvasSize = () => {
            const container = canvas.parentElement;
            if (!container) return;

            const isMobile = window.innerWidth < 640;
            const width = isMobile ? 500 : 800;
            const height = isMobile ? 420 : 500;

            canvas.width = width * 2; // Retina support
            canvas.height = height * 2;
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;

            ctx.scale(2, 2);
            renderConstellation();
        };

        const renderConstellation = () => {
            if (!ctx || !canvas) return;

            const width = canvas.width / 2;
            const height = canvas.height / 2;
            const centerX = width / 2 + panOffset.x;
            const centerY = height / 2 + panOffset.y;
            // Apply zoom to scale
            const scale = height * 0.4 * zoom * (data.zoom || 1.0);

            // Clear canvas with dark background
            ctx.fillStyle = '#0a0a0b';
            ctx.fillRect(0, 0, width, height);

            // Draw Milky Way Background
            ctx.globalCompositeOperation = 'screen'; // Make overlapping parts brighter

            milkyWayParticles.forEach(p => {
                const hor = equatorialToHorizontal(p.ra, p.dec, observerTime, observerLocation);
                // Simple visibility check (allow some margin for glow)
                if (hor.altitude < -10) return;

                const [cx, cy] = horizontalToCanvas(hor.altitude, hor.azimuth, width, height, scale);
                const x = cx + panOffset.x;
                const y = cy + panOffset.y;

                // Skip if off-screen (optimization)
                if (x < -p.size || x > width + p.size || y < -p.size || y > height + p.size) return;

                const radial = ctx.createRadialGradient(x, y, 0, x, y, p.size * zoom);
                radial.addColorStop(0, `rgba(60, 80, 120, ${p.opacity})`); // Deep space blue
                radial.addColorStop(1, 'rgba(60, 80, 120, 0)');

                ctx.fillStyle = radial;
                ctx.beginPath();
                ctx.arc(x, y, p.size * zoom, 0, Math.PI * 2);
                ctx.fill();
            });

            ctx.globalCompositeOperation = 'source-over'; // Reset blending mode

            // Calculate center RA/Dec from actual star positions for better framing
            let centerRA = data.center?.ra;
            let centerDec = data.center?.dec;

            if (!centerRA || !centerDec) {
                // Auto-calculate center from star positions
                const avgRA = data.stars.reduce((sum, s) => sum + s.ra, 0) / data.stars.length;
                const avgDec = data.stars.reduce((sum, s) => sum + s.dec, 0) / data.stars.length;
                centerRA = avgRA;
                centerDec = avgDec;
            }

            // Project all stars using real-time Alt/Az coordinates
            const projectedStars = data.stars.map(star => {
                // Convert RA/Dec -> Alt/Az -> Canvas
                const horCoords = equatorialToHorizontal(
                    star.ra,
                    star.dec,
                    observerTime,
                    observerLocation
                );

                const [canvasX, canvasY] = horizontalToCanvas(
                    horCoords.altitude,
                    horCoords.azimuth,
                    width,
                    height,
                    scale
                );

                const visible = horCoords.visible; // Only show stars above horizon
                return { ...star, canvasX, canvasY, visible };
            });


            // Auto-adjust viewport to ensure constellation is visible (not hidden by UI)
            const visibleStars = projectedStars.filter(s => s.visible !== false);
            if (visibleStars.length > 0) {
                const minY = Math.min(...visibleStars.map(s => s.canvasY));
                const maxY = Math.max(...visibleStars.map(s => s.canvasY));
                const avgY = (minY + maxY) / 2;

                // Calculate safe viewing area (avoid UI panels)
                const headerHeight = 55; // header bar ~44px + 12px top offset
                const bottomControlHeight = 80;
                const padding = 20;

                const safeTop = headerHeight + padding;
                const safeBottom = height - bottomControlHeight - padding;
                const safeHeight = safeBottom - safeTop;
                const safeCenterY = safeTop + safeHeight / 2;

                // Calculate required pan offset to center constellation in safe area
                const requiredPanY = safeCenterY - avgY;

                // Apply pan offset automatically (only once on initial load)
                if (!hasAutoCentered) {
                    setPanOffset({ x: 0, y: requiredPanY });
                    setHasAutoCentered(true);
                }
            }

            // Store projected stars for hover detection
            projectedStarsRef.current = projectedStars;

            // Draw constellation lines
            if (data.constellations) {
                ctx.strokeStyle = 'rgba(100, 150, 255, 0.6)';
                ctx.lineWidth = 2;

                data.constellations.forEach(constellation => {
                    constellation.lines.forEach(([startId, endId]) => {
                        const start = projectedStars.find(s => s.id === startId);
                        const end = projectedStars.find(s => s.id === endId);

                        if (start && end && start.visible !== false && end.visible !== false) {
                            ctx.beginPath();
                            ctx.moveTo(start.canvasX + panOffset.x, start.canvasY + panOffset.y);
                            ctx.lineTo(end.canvasX + panOffset.x, end.canvasY + panOffset.y);
                            ctx.stroke();
                        }
                    });
                });
            }

            // Draw stars (filter by visibility in realtime mode)
            projectedStars.filter(star => star.visible !== false).forEach(star => {
                const size = magnitudeToSize(star.mag) * 1.5;
                const opacity = magnitudeToOpacity(star.mag);

                // Apply pan offset
                const x = star.canvasX + panOffset.x;
                const y = star.canvasY + panOffset.y;

                // Star glow (larger and brighter)
                const gradient = ctx.createRadialGradient(
                    x, y, 0,
                    x, y, size * 3
                );
                gradient.addColorStop(0, `rgba(255, 255, 255, ${opacity})`);
                gradient.addColorStop(0.3, `rgba(220, 230, 255, ${opacity * 0.8})`);
                gradient.addColorStop(0.7, `rgba(150, 180, 255, ${opacity * 0.4})`);
                gradient.addColorStop(1, 'rgba(100, 150, 255, 0)');

                ctx.fillStyle = gradient;
                ctx.beginPath();
                ctx.arc(x, y, size * 3, 0, Math.PI * 2);
                ctx.fill();

                // Star core (brighter)
                ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, opacity * 1.2)})`;
                ctx.beginPath();
                ctx.arc(x, y, size, 0, Math.PI * 2);
                ctx.fill();
            });

            // Draw star labels with collision detection
            ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            // Track label positions to avoid overlap
            const labelBounds: { x: number; y: number; width: number; height: number }[] = [];

            const checkCollision = (x: number, y: number, width: number, height: number): boolean => {
                return labelBounds.some(bound =>
                    x < bound.x + bound.width &&
                    x + width > bound.x &&
                    y < bound.y + bound.height &&
                    y + height > bound.y
                );
            };

            // Sort stars by brightness (brightest first) for label priority
            const sortedStars = [...projectedStars].sort((a, b) => a.mag - b.mag);

            sortedStars.forEach(star => {
                // Show labels based on zoom level and magnitude
                // Zoom 0.5: show mag < 1.0
                // Zoom 1.0: show mag < 2.0
                // Zoom 3.0: show mag < 4.0
                const visibleMagLimit = 0.5 + (zoom * 1.2);

                if (star.name && star.mag < visibleMagLimit) {
                    const size = magnitudeToSize(star.mag) * 1.5;
                    // Adaptive glow: brighter stars (lower mag) get larger glow
                    const glowRadius = size * (4 - star.mag * 0.5); // 3.5x to 4x for bright stars

                    // Measure text dimensions
                    const textMetrics = ctx.measureText(star.name);
                    const labelWidth = textMetrics.width + 12;
                    const labelHeight = 18;

                    // Apply pan offset to star position
                    const starX = star.canvasX + panOffset.x;
                    const starY = star.canvasY + panOffset.y;

                    // Try multiple positions: bottom, top, right, left
                    const positions = [
                        { // Bottom (preferred)
                            x: starX - labelWidth / 2,
                            y: starY + glowRadius + 6,
                            align: 'center' as CanvasTextAlign,
                            baseline: 'top' as CanvasTextBaseline
                        },
                        { // Top
                            x: starX - labelWidth / 2,
                            y: starY - glowRadius - 6 - labelHeight,
                            align: 'center' as CanvasTextAlign,
                            baseline: 'top' as CanvasTextBaseline
                        },
                        { // Right
                            x: starX + glowRadius + 6,
                            y: starY - labelHeight / 2,
                            align: 'left' as CanvasTextAlign,
                            baseline: 'middle' as CanvasTextBaseline
                        },
                        { // Left
                            x: starX - glowRadius - 6 - labelWidth,
                            y: starY - labelHeight / 2,
                            align: 'left' as CanvasTextAlign,
                            baseline: 'middle' as CanvasTextBaseline
                        }
                    ];

                    // Find first position without collision
                    for (const pos of positions) {
                        if (!checkCollision(pos.x, pos.y, labelWidth, labelHeight)) {
                            ctx.textAlign = pos.align;
                            ctx.textBaseline = pos.baseline;
                            ctx.fillStyle = 'rgba(220, 230, 255, 0.95)';

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

            // Constellation names shown in header - removed from canvas to reduce clutter
            /*
            if (data.constellations) {
                ctx.font = 'bold 10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                ctx.fillStyle = 'rgba(180, 200, 255, 0.8)';

                data.constellations.forEach(constellation => {
                    const constellationStars = projectedStars.filter(s => s.constellation === constellation.id);
                    if (constellationStars.length > 0) {
                        const avgX = constellationStars.reduce((sum, s) => sum + s.canvasX, 0) / constellationStars.length;
                        const avgY = constellationStars.reduce((sum, s) => sum + s.canvasY, 0) / constellationStars.length;

                        const name = constellation.name[language] || constellation.name.en;
                        const textMetrics = ctx.measureText(name);
                        const labelWidth = textMetrics.width;
                        const labelHeight = 16;
                        const labelX = avgX - labelWidth / 2;
                        const labelY = avgY - 25;

                        // Check collision with star labels
                        if (!checkCollision(labelX, labelY, labelWidth, labelHeight)) {
                            ctx.fillText(name, avgX, labelY);
                        }
                    }
                });
            }
            */

            setIsLoading(false);
        };

        updateCanvasSize();
        window.addEventListener('resize', updateCanvasSize);

        return () => {
            window.removeEventListener('resize', updateCanvasSize);
        };
    }, [data, language, zoom, panOffset, observerTime, observerLocation]);

    // Handle wheel events with passive: false to allow preventDefault
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

    // Zoom controls
    const handleZoomIn = () => {
        setZoom(prev => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
    };

    const handleZoomOut = () => {
        setZoom(prev => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
    };

    const handleResetView = () => {
        setZoom(1.0);
        setPanOffset({ x: 0, y: 0 });
        setHoveredStar(null);
        setHasAutoCentered(false); // Re-enable auto-centering
    };

    // Mouse wheel zoom
    const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
        setZoom(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
    };

    // Pan controls
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
            // CSS-pixel coords match logical canvas coords (stars stored in logical space)
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const threshold = 15;
            let foundStar: Star | null = null;
            let minDistance = threshold;

            projectedStarsRef.current.forEach(star => {
                if (star.visible === false) return;
                const starScreenX = star.canvasX + panOffset.x;
                const starScreenY = star.canvasY + panOffset.y;
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
            // Container-relative coords for absolute-positioned tooltip
            setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    const handleMouseLeave = () => {
        setIsDragging(false);
        setHoveredStar(null);
    };

    // Touch support (drag + pinch-to-zoom)
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
            // Pinch released to single finger — resume drag from current position
            const touch = e.touches[0];
            pinchStartDistRef.current = null;
            setIsDragging(true);
            setDragStart({ x: touch.clientX - panOffset.x, y: touch.clientY - panOffset.y });
        }
    };

    const handleSnapshot = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // Create white background version
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) return;

        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.drawImage(canvas, 0, 0);

        tempCanvas.toBlob(blob => {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `constellation-${Date.now()}.png`;
            a.click();
            URL.revokeObjectURL(url);
        });
    };

    return (
        <div className="relative my-6 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-xl bg-[#0a0a0b]">
            {/* Responsive Header Bar */}
            <div className="absolute top-3 left-3 right-3 z-20 flex items-center justify-between gap-2 px-3 py-2 bg-black/70 backdrop-blur-xl rounded-xl border border-white/20 shadow-2xl">
                {/* Left: Constellation Name */}
                <div className="flex items-center gap-2 min-w-0">
                    <i className="fa-solid fa-stars text-xs sm:text-sm text-blue-400 flex-shrink-0"></i>
                    <span className="text-xs sm:text-sm font-bold text-white truncate">
                        {data.constellations && data.constellations.length > 0
                            ? data.constellations[0].name[language] || data.constellations[0].name.en
                            : currentLabels.title}
                    </span>
                </div>

                {/* Center: Time Display & Controls */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-1 justify-center max-w-[320px]">
                    <i className="fa-solid fa-clock text-[10px] sm:text-xs text-blue-400 flex-shrink-0 hidden sm:inline"></i>

                    {/* Time Display (Read-only) */}
                    <div className="flex items-center gap-1.5 px-2 py-0.5 bg-white/10 rounded">
                        <span className="text-[10px] sm:text-xs font-mono text-white whitespace-nowrap">
                            {observerTime.toLocaleString('ko-KR', {
                                month: '2-digit',
                                day: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            })}
                        </span>
                        <span className="text-[10px] sm:text-xs">{isNight ? '🌙' : '☀️'}</span>
                    </div>

                    {/* Time Adjustment Buttons */}
                    <div className="flex items-center gap-0.5">
                        <button
                            onClick={() => setObserverTime(new Date(observerTime.getTime() - 3600000))}
                            className="px-1.5 py-0.5 text-xs text-white bg-white/10 hover:bg-white/20 active:bg-white/30 active:scale-95 rounded transition-all"
                            title="1시간 전"
                        >
                            ◀
                        </button>
                        <button
                            onClick={() => setIsPlaying(!isPlaying)}
                            className="px-2 py-0.5 text-xs text-white bg-blue-500/30 hover:bg-blue-500/40 active:bg-blue-500/50 active:scale-95 rounded transition-all"
                            title={isPlaying ? "일시정지" : "시간 흐름 재생"}
                        >
                            <i className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}></i>
                        </button>
                        <button
                            onClick={() => setObserverTime(new Date(observerTime.getTime() + 3600000))}
                            className="px-1.5 py-0.5 text-xs text-white bg-white/10 hover:bg-white/20 active:bg-white/30 active:scale-95 rounded transition-all"
                            title="1시간 후"
                        >
                            ▶
                        </button>
                    </div>
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                        onClick={handleSnapshot}
                        className="p-1.5 hover:text-white text-slate-300 active:text-white active:scale-95 transition-all"
                        title={currentLabels.snapshot}
                    >
                        <i className="fa-solid fa-camera text-xs sm:text-sm"></i>
                    </button>
                </div>
            </div>



            {/* Canvas */}
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

            {/* Control Panel */}
            <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-20">
                {/* Zoom controls */}
                <div className="flex flex-col bg-black/60 backdrop-blur-md rounded border border-white/10">
                    <button
                        onClick={handleZoomIn}
                        disabled={zoom >= MAX_ZOOM}
                        className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-t transition-all"
                        title="Zoom in"
                    >
                        <i className="fa-solid fa-plus text-sm"></i>
                    </button>
                    <div className="h-px bg-white/10"></div>
                    <button
                        onClick={handleZoomOut}
                        disabled={zoom <= MIN_ZOOM}
                        className="w-10 h-10 flex items-center justify-center text-white hover:bg-white/10 active:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed rounded-b transition-all"
                        title="Zoom out"
                    >
                        <i className="fa-solid fa-minus text-sm"></i>
                    </button>
                </div>

                {/* Reset button */}
                <button
                    onClick={handleResetView}
                    className="w-10 h-10 flex items-center justify-center text-white bg-black/60 backdrop-blur-md hover:bg-white/10 active:bg-white/20 rounded border border-white/10 transition-all"
                    title="Reset view"
                >
                    <i className="fa-solid fa-rotate-right text-sm"></i>
                </button>
            </div>
            {/* Zoom indicator */}
            <div className="absolute bottom-3 left-3 z-20 px-2 h-6 flex items-center justify-center bg-black/60 backdrop-blur-sm rounded border border-white/10 shadow-lg">
                <span className="text-[10px] font-mono text-slate-300 leading-none">
                    {(zoom * 100).toFixed(0)}%
                </span>
            </div>

            {/* Tooltip */}
            {
                hoveredStar && (
                    <div
                        className="absolute z-30 pointer-events-none"
                        style={{
                            left: tooltipPos.x + 10,
                            top: tooltipPos.y - 40
                        }}
                    >
                        <div className="bg-black/90 backdrop-blur-sm rounded-lg border border-white/20 px-3 py-2 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
                            <p className="text-xs font-bold text-white">{hoveredStar.name}</p>
                            <p className="text-[10px] text-slate-400">Mag: {hoveredStar.mag.toFixed(2)}</p>
                            <p className="text-[10px] text-slate-400">
                                RA: {hoveredStar.ra.toFixed(2)}h, Dec: {hoveredStar.dec.toFixed(2)}°
                            </p>
                        </div>
                    </div>
                )
            }

            {/* Loading overlay */}
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

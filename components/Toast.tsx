import React, { useEffect } from 'react';

interface ToastProps {
    message: string;
    type?: 'error' | 'success' | 'info';
    onClose: () => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, type = 'info', onClose, duration = 3000 }) => {
    useEffect(() => {
        const timer = setTimeout(() => {
            onClose();
        }, duration);
        return () => clearTimeout(timer);
    }, [onClose, duration]);

    const icons = {
        error: 'fa-circle-exclamation',
        success: 'fa-circle-check',
        info: 'fa-circle-info'
    };

    const colors = {
        error: 'bg-red-500 shadow-red-500/25',
        success: 'bg-emerald-500 shadow-emerald-500/25',
        info: 'bg-slate-800 shadow-slate-900/25 dark:bg-slate-700'
    };

    return (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-[11000] w-full max-w-xs sm:max-w-sm px-4">
            <div className={`flex items-center gap-3 px-5 py-4 rounded-[20px] text-white shadow-2xl animate-in slide-in-from-bottom-8 fade-in duration-500 ${colors[type]}`}>
                <div className="flex-shrink-0">
                    <i className={`fa-solid ${icons[type]} text-lg`}></i>
                </div>
                <p className="flex-1 text-sm font-bold leading-tight">
                    {message}
                </p>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/10 rounded-lg transition-colors"
                >
                    <i className="fa-solid fa-xmark text-xs"></i>
                </button>
            </div>
        </div>
    );
};

export default Toast;

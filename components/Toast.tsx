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
        <div className="fixed top-24 right-0 sm:right-6 z-[11000] w-fit max-w-[280px] px-4">
            <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-full text-white shadow-lg animate-in slide-in-from-right-8 fade-in duration-500 ${colors[type]}`}>
                <div className="flex-shrink-0">
                    <i className={`fa-solid ${icons[type]} text-base`}></i>
                </div>
                <p className="flex-1 text-[13px] font-semibold leading-tight whitespace-nowrap overflow-hidden text-ellipsis">
                    {message}
                </p>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/10 rounded-full transition-colors ml-1"
                >
                    <i className="fa-solid fa-xmark text-[10px]"></i>
                </button>
            </div>
        </div>
    );
};

export default Toast;

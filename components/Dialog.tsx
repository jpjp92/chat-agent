import React from 'react';

interface DialogProps {
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'danger' | 'info';
    onConfirm: () => void;
    onCancel: () => void;
}

const Dialog: React.FC<DialogProps> = ({ isOpen, title, message, type = 'info', onConfirm, onCancel }) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6">
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-slate-950/60 backdrop-blur-md animate-in fade-in duration-300"
                onClick={onCancel}
            ></div>

            {/* Modal Container */}
            <div className="relative w-full max-w-sm animate-in fade-in zoom-in-95 slide-in-from-bottom-4 duration-300 ease-out">
                <div className="bg-white dark:bg-[#1e1e1f] rounded-[28px] shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 dark:border-white/10 overflow-hidden">
                    <div className="p-8">
                        <div className="flex flex-col items-center text-center space-y-4">
                            {/* Icon */}
                            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-2 ${type === 'danger'
                                    ? 'bg-red-50 dark:bg-red-500/10 text-red-500 shadow-sm'
                                    : 'bg-primary-50 dark:bg-primary-500/10 text-primary-500 shadow-sm'
                                }`}>
                                <i className={`fa-solid ${type === 'danger' ? 'fa-trash-can' : 'fa-circle-info'} text-xl`}></i>
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight">
                                    {title}
                                </h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium leading-relaxed px-2">
                                    {message}
                                </p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-2 mt-8">
                            <button
                                onClick={onConfirm}
                                className={`w-full py-4 rounded-2xl font-bold text-sm transition-all active:scale-[0.98] shadow-lg ${type === 'danger'
                                        ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-500/20'
                                        : 'bg-primary-600 hover:bg-primary-700 text-white shadow-primary-600/20'
                                    }`}
                            >
                                {type === 'danger' ? '삭제하기' : '확인'}
                            </button>
                            <button
                                onClick={onCancel}
                                className="w-full py-4 rounded-2xl bg-slate-50 dark:bg-white/5 text-slate-600 dark:text-slate-300 font-bold text-sm hover:bg-slate-100 dark:hover:bg-white/10 transition-all active:scale-[0.98]"
                            >
                                취소
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Dialog;

import React, { forwardRef } from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    leftIcon?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
    ({ label, error, leftIcon, className = '', ...props }, ref) => {
        return (
            <div className="w-full">
                {label && (
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        {label}
                    </label>
                )}
                <div className="relative">
                    {leftIcon && (
                        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-text-muted">
                            {leftIcon}
                        </div>
                    )}
                    <input
                        ref={ref}
                        className={`
              w-full h-8 px-3 py-1 text-xs bg-bg-primary border border-border-primary rounded-lg
              text-text-primary placeholder-text-muted transition-colors duration-150
              focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
              disabled:opacity-50 disabled:cursor-not-allowed
              ${leftIcon ? 'pl-8' : ''}
              ${error ? 'border-[#f4212e]' : ''}
              ${className}
            `}
                        {...props}
                    />
                </div>
                {error && <p className="mt-1 text-xs text-[#f4212e]">{error}</p>}
            </div>
        );
    },
);

Input.displayName = 'Input';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
    ({ label, error, className = '', ...props }, ref) => {
        return (
            <div className="w-full">
                {label && (
                    <label className="block text-xs font-medium text-text-secondary mb-1.5">
                        {label}
                    </label>
                )}
                <textarea
                    ref={ref}
                    className={`
            w-full px-3 py-2 text-xs bg-bg-primary border border-border-primary rounded-xl
            text-text-primary placeholder-text-muted
            focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent
            disabled:opacity-50 disabled:cursor-not-allowed
            resize-none
            ${error ? 'border-[#f4212e]' : ''}
            ${className}
          `}
                    {...props}
                />
                {error && <p className="mt-1 text-xs text-[#f4212e]">{error}</p>}
            </div>
        );
    },
);

Textarea.displayName = 'Textarea';

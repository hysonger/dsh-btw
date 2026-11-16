import React from 'react';
export declare function Button({ variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
}): React.JSX.Element;
export declare function Modal({ open, onClose, title, closeLabel, className, footer, children }: {
    open: boolean;
    onClose: () => void;
    title: string;
    closeLabel: string;
    className?: string;
    footer?: React.ReactNode;
    children?: React.ReactNode;
}): React.JSX.Element | null;

import React from 'react';
import type { HostMarkdownLabels } from './host-markdown';
/** Render untrusted model output with our own image/HTML policy, never the host renderer. */
export declare function AnswerMarkdown({ text, labels, copyError }: {
    text: string;
    labels: HostMarkdownLabels;
    copyError: string;
}): React.JSX.Element;

import React from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { HostMarkdownLabels } from './host-markdown'

function CodeBlock({ value, labels, errorLabel, children }: { value: string; labels: HostMarkdownLabels['code']; errorLabel: string; children: React.ReactNode }): React.JSX.Element {
  const [status, setStatus] = React.useState<'idle' | 'copied' | 'error'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setStatus('copied') }
    catch { setStatus('error') }
  }
  return <div className="btw-code"><button type="button" onClick={() => { void copy() }}>{status === 'copied' ? labels.copiedLabel : labels.copyLabel}</button>{status === 'error' && <span role="alert">{errorLabel}</span>}<pre>{children}</pre></div>
}

/** Render untrusted model output with our own image/HTML policy, never the host renderer. */
export function AnswerMarkdown({ text, labels, copyError }: { text: string; labels: HostMarkdownLabels; copyError: string }): React.JSX.Element {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: () => null,
    a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
    pre: ({ children, node }) => {
      const code = node?.children?.[0]
      const value = code && 'children' in code ? code.children.map(child => 'value' in child ? child.value : '').join('') : ''
      return <CodeBlock value={value} labels={labels.code} errorLabel={copyError}>{children}</CodeBlock>
    },
  }}>{text}</Markdown>
}

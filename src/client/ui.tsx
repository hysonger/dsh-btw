import React from 'react'

export function Button({ variant, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string }): React.JSX.Element {
  return <button type="button" className={`btw-button${variant ? ` btw-button-${variant}` : ''}`} {...props} />
}

export function Modal({ open, onClose, title, closeLabel, className, footer, children }: { open: boolean; onClose: () => void; title: string; closeLabel: string; className?: string; footer?: React.ReactNode; children?: React.ReactNode }): React.JSX.Element | null {
  const panel = React.useRef<HTMLDivElement>(null)
  const layer = React.useRef<HTMLDialogElement>(null)
  const close = React.useRef(onClose)
  close.current = onClose
  React.useEffect(() => {
    if (!open || !panel.current || !layer.current) return
    const element = panel.current
    const dialog = layer.current
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Native top-layer placement escapes the composer's containing block without
    // creating or mutating nodes outside this component. Tests/older engines use
    // an open-dialog fallback with the same explicit focus policy.
    try {
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    } catch { dialog.setAttribute('open', '') }
    const focusable = () => Array.from(element.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')).filter(node => !node.hidden)
    const initial = element.querySelector<HTMLElement>('textarea:not(:disabled),[autofocus]')
    if (initial) initial.focus()
    else if (!element.contains(document.activeElement)) (focusable()[0] ?? element).focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const nodes = focusable()
      if (!nodes.length) { event.preventDefault(); element.focus(); return }
      const index = nodes.indexOf(document.activeElement as HTMLElement)
      if (event.shiftKey && index <= 0) { event.preventDefault(); nodes[nodes.length - 1]!.focus() }
      else if (!event.shiftKey && (index < 0 || index === nodes.length - 1)) { event.preventDefault(); nodes[0]!.focus() }
    }
    const focus = (event: FocusEvent) => { if (event.target instanceof Node && !element.contains(event.target)) (focusable()[0] ?? element).focus() }
    document.addEventListener('keydown', key, true)
    document.addEventListener('focusin', focus, true)
    return () => {
      document.removeEventListener('keydown', key, true)
      document.removeEventListener('focusin', focus, true)
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
      else dialog.removeAttribute('open')
      if (previous?.isConnected) previous.focus({ preventScroll: true })
    }
  }, [open])
  if (!open) return null
  return <dialog ref={layer} className="btw-modal-backdrop" role="dialog" aria-modal="true" aria-label={title} onCancel={event => { event.preventDefault(); close.current() }}>
    <div ref={panel} tabIndex={-1} className={className}>
      <header><strong>{title}</strong><button type="button" aria-label={closeLabel} onClick={onClose}>×</button></header>
      {children}{footer}
    </div>
  </dialog>
}

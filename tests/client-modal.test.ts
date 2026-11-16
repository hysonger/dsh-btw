// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { Modal } from '../src/client/ui'

it('traps focus, shows a backdrop, closes on Escape and restores focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const outside = document.createElement('button'), mount = document.createElement('div')
  document.body.append(outside, mount)
  outside.focus()
  const close = vi.fn()
  const root = createRoot(mount)
  await act(async () => root.render(React.createElement(Modal, { open: true, onClose: close, title: 'Title', closeLabel: 'Close', footer: React.createElement('button', null, 'Last') }, React.createElement('textarea'))))
  expect(mount.querySelector('.btw-modal-backdrop')).not.toBeNull()
  const first = mount.querySelector('button')!, last = [...mount.querySelectorAll('button')].at(-1)!
  last.focus()
  await act(async () => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })))
  expect(document.activeElement).toBe(first)
  outside.focus()
  expect(document.activeElement).toBe(first)
  await act(async () => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(close).toHaveBeenCalledOnce()
  await act(async () => root.unmount())
  expect(document.activeElement).toBe(outside)
  outside.remove(); mount.remove(); vi.unstubAllGlobals()
})

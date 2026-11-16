// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { AnswerMarkdown } from '../src/client/answer-markdown'

it('never renders images or raw HTML, including reference and malformed code variants', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const labels = { code: { copyLabel: 'copy', copiedLabel: 'copied' }, footnotes: 'footnotes' }
  for (const text of [
    '![alt](https://example.invalid/a)', '![x]\n\n[x]: https://example.invalid/a',
    '![x][]\n\n[x]: https://example.invalid/a', '![alt][x]\n\n[x]: https://example.invalid/a',
    '` unclosed ![x](https://example.invalid/a)', '<img src="https://example.invalid/a">',
    '<script>bad()</script>', '![a](\nhttps://example.invalid/a\n)',
  ]) {
    await act(async () => root.render(React.createElement(AnswerMarkdown, { text, labels, copyError: 'copy failed' })))
    expect(container.querySelector('img,script,iframe,object')).toBeNull()
  }
  await act(async () => root.render(React.createElement(AnswerMarkdown, { text: '[bad](javascript:alert(1))\n\n**bold**\n\n```js\nhello\n```', labels, copyError: 'copy failed' })))
  expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
  expect(container.querySelector('strong')?.textContent).toBe('bold')
  expect(container.querySelector('pre')?.textContent).toContain('hello')
  expect(container.querySelector('button')?.textContent).toBe('copy')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined) } })
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role=alert]')?.textContent).toBe('copy failed')
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('button')?.textContent).toBe('copied')
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

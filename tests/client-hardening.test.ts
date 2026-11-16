// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { createSettingsScope } from '../src/client/settings-scope'
import { jumpToQuote } from '../src/client/quotes'

it('disposes both settings subscriptions and pending retry work', async () => {
  const offMirror = vi.fn(), offForm = vi.fn()
  const form = { getSnapshot: () => ({ status: 'ready' as const }), subscribe: () => offForm }
  const mirror = { getSnapshot: () => ({ view: { namespaces: [{ ns: 'michengai-btw' }] } }), subscribe: () => offMirror }
  const scope = createSettingsScope({ describe: () => mirror, get: () => form })
  scope.dispose()
  expect(offMirror).toHaveBeenCalledTimes(1)
  expect(offForm).toHaveBeenCalledTimes(1)
  expect(scope.bound()).toBe(false)
})

it('never jumps without a scoped root or to a mismatching row', () => {
  const scope = document.createElement('div')
  scope.innerHTML = '<div data-chat-flow-kind="user">other content</div>'
  const quote = { id: 'q', sessionId: 'a', text: 'private', role: 'user' as const, turnIndex: 1, createdAt: 0 }
  expect(jumpToQuote(quote)).toBe(false)
  expect(jumpToQuote(quote, scope)).toBe(false)
})

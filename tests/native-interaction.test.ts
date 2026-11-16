// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  NativeBtwAskAction,
  registerAskHandler,
  triggerAskModal,
} from '../src/client/NativeBtwAsk'
import { SelectionAsk } from '../src/client/SelectionAsk'
import { BubbleStore } from '../src/client/bubbles'
import { translate } from '../src/locales'

describe('NativeBtwAsk 适配官方选区交互规范与插槽', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
  })

  afterEach(() => {
    container.remove()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('registerAskHandler 与 triggerAskModal 能跨组件派发打开旁问弹窗请求', () => {
    const handler = vi.fn()
    const unregister = registerAskHandler('session-1', handler)

    expect(triggerAskModal('session-2', '未匹配的文本')).toBe(false)
    expect(handler).not.toHaveBeenCalled()

    expect(triggerAskModal('session-1', '测试选中文本')).toBe(true)
    expect(handler).toHaveBeenCalledWith('测试选中文本')

    unregister()
    expect(triggerAskModal('session-1', '测试选中文本')).toBe(false)
  })

  it('NativeBtwAskAction 按钮点击后读取选中文本，触发旁问并关闭原生浮层', async () => {
    const dismiss = vi.fn()
    const clearSelection = vi.fn()
    const readText = vi.fn(() => '被划选的关键代码')
    const useSession = vi.fn((selector: (s: any) => boolean) => selector({ removed: false, subagent: null }))
    const targetHandler = vi.fn()
    registerAskHandler('session-x', targetHandler)

    const root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(NativeBtwAskAction, {
          sessionId: 'session-x',
          dismiss,
          clearSelection,
          readText,
          useSession,
          t: translate('zh'),
        })
      )
    })

    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '旁问')!
    expect(button).not.toBeNull()
    expect(button.textContent).toBe('旁问')

    await act(async () => {
      button.click()
    })

    expect(readText).toHaveBeenCalled()
    expect(targetHandler).toHaveBeenCalledWith('被划选的关键代码')
    expect(clearSelection).toHaveBeenCalled()
    expect(dismiss).toHaveBeenCalled()

    root.unmount()
  })

  it('SelectionAsk 在 nativeSelection: true 时不自建 DOM mouseup 浮层，但能响应 triggerAskModal 弹出窗口', async () => {
    const store = new BubbleStore({ run: vi.fn(), close: vi.fn() })
    const scope = document.createElement('div')
    scope.setAttribute('data-conversation-scroll', '')
    scope.innerHTML = '<div data-chat-flow-kind="assistant-step"><p>正文内容</p></div>'
    document.body.append(scope)

    scope.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        React.createElement(SelectionAsk, {
          store,
          sessionId: 'session-native',
          nativeSelection: true,
          t: translate('zh'),
        })
      )
    })

    // 模拟划选触发 mouseup
    const p = scope.querySelector('p')!
    const range = document.createRange()
    range.selectNodeContents(p)
    window.getSelection()!.removeAllRanges()
    window.getSelection()!.addRange(range)
    await act(async () => {
      p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })

    // 确认没有自建的悬浮菜单
    expect(container.querySelector('.btw-selection-menu')).toBeNull()

    // 通过 triggerAskModal 唤起
    await act(async () => {
      triggerAskModal('session-native', '外部原生按钮传来的内容')
    })

    // 成功打开 Modal
    expect(container.querySelector('textarea, [data-btw-modal]')).not.toBeNull()
    expect(container.textContent).toContain('外部原生按钮传来的内容')

    root.unmount()
    scope.remove()
  })

  it('quotes via inputActions and preserves selection on failure', async () => {
    const dismiss = vi.fn(), clearSelection = vi.fn(), insertQuote = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    const root = createRoot(container)
    await act(async () => root.render(React.createElement(NativeBtwAskAction, { sessionId: 'a', dismiss, clearSelection, readText: () => 'quoted', inputActions: { insertQuote }, t: translate('zh') })))
    const button = [...container.querySelectorAll('button')].find(item => item.textContent === '引用文本')!
    await act(async () => button.click())
    expect(clearSelection).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
    await act(async () => button.click())
    expect(insertQuote).toHaveBeenCalledWith('quoted')
    expect(clearSelection).toHaveBeenCalledTimes(1)
    expect(dismiss).toHaveBeenCalledTimes(1)
    await act(async () => root.unmount())
  })

  it('does not clear selection when the session handler is absent', async () => {
    const dismiss = vi.fn(), clearSelection = vi.fn()
    const root = createRoot(container)
    await act(async () => root.render(React.createElement(NativeBtwAskAction, {
      sessionId: 'unmounted-session', dismiss, clearSelection,
      readText: () => 'private text', t: translate('zh'),
    })))
    await act(async () => [...container.querySelectorAll('button')].find(item => item.textContent === '旁问')!.click())
    expect(clearSelection).not.toHaveBeenCalled()
    expect(dismiss).not.toHaveBeenCalled()
    await act(async () => root.unmount())
  })
})

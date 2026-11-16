import { describe, expect, it } from 'vitest'
import { createAnswerOnlyGuard } from '../src/server/tool-guard'

const DENY = 'BTW 仅允许文字回答，禁止执行任何工具。'
const DENY_REPLY = 'BTW 禁止向主会话或任何其它代理回传消息'

it('ownId 凭会话或代理 ID 确定性拦截，脱钩生命周期时序与弱引用', () => {
  const guard = createAnswerOnlyGuard()
  const unregister = guard.ownId('child-123')
  expect(guard({ agent: { id: 'child-123' } })).toContain(DENY)
  expect(guard({ agent: { session: { header: { id: 'child-123' } } } })).toContain(DENY)
  expect(guard({ agent: { session: { id: 'child-123' } } })).toContain(DENY)
  expect(guard({ agent: { id: 'other' } })).toBeUndefined()
  unregister()
  expect(guard({ agent: { id: 'child-123' } })).toBeUndefined()
})

it('own 同时 claim agent 及其 session，避免代理对象引用变化导致漏拦', () => {
  const guard = createAnswerOnlyGuard()
  const session = {}
  const originalAgent = { session }
  guard.own(originalAgent)
  const wrappedAgent = { session }
  expect(guard({ agent: wrappedAgent })).toContain(DENY)
})

it('白名单在闸门里逐次生效：加入后放行，移除后立刻恢复拒绝', () => {
  let allowed: readonly string[] = []
  const guard = createAnswerOnlyGuard(() => allowed)
  const agent = { session: { header: { id: 'btw-child', parentSession: 'parent-session' } } }
  guard.own(agent)

  expect(guard({ agent, name: 'pele_draw', arguments: {} })).toContain(DENY)
  allowed = ['pele_draw']
  expect(guard({ agent, name: 'pele_draw', arguments: {} })).toBeUndefined()
  // 不在白名单里的工具照旧拒绝，放行集合不是「打开全部工具」。
  expect(guard({ agent, name: 'ops_bash', arguments: {} })).toContain('白名单工具')
  allowed = []
  expect(guard({ agent, name: 'pele_draw', arguments: {} })).toContain(DENY)
})

it('白名单非空时拒绝文案列出放行工具，空白名单保持 1.1.1 原文', () => {
  const agent = { session: {} }
  const strict = createAnswerOnlyGuard(() => [])
  strict.own(agent)
  expect(strict({ agent, name: 'ops_bash', arguments: {} }))
    .toBe('BTW 仅允许文字回答，禁止执行任何工具。 / BTW allows text responses only; tool execution is strictly prohibited.')

  const permissive = createAnswerOnlyGuard(() => ['pele_draw', 'ops_bash'])
  permissive.own(agent)
  const message = permissive({ agent, name: 'read_file', arguments: {} })
  expect(message).toContain('pele_draw, ops_bash')
  expect(message).toContain('白名单工具')
})

it('白名单只作用于被认领的旁问代理，主任务工具不受影响', () => {
  const guard = createAnswerOnlyGuard(() => ['pele_draw'])
  expect(guard({ agent: { session: {} }, name: 'ops_bash', arguments: {} })).toBeUndefined()
  expect(guard({})).toBeUndefined()
})

describe('F-02 加固：send_message 回传通道彻底关闭', () => {
  const ownedAgent = () => ({
    session: { header: { id: 'btw-child', parentSession: 'parent-session' } },
  })

  it('默认白名单拒绝一切工具，包括发给直接父会话的 send_message', () => {
    const guard = createAnswerOnlyGuard()
    const agent = ownedAgent()
    guard.own(agent)
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'parent-session', message: '回答' } })).toContain(DENY_REPLY)
    expect(guard({ agent, name: 'send_message', arguments: { agent: 'lead', message: '回答' } })).toContain(DENY_REPLY)
    expect(guard({ agent, name: 'ops_bash', arguments: {} })).toContain(DENY)
  })

  it('只凭预登记 childId 认领时同样拒绝 send_message', () => {
    const guard = createAnswerOnlyGuard()
    const unregister = guard.ownId('child-9')
    const agent = { id: 'child-9', session: { header: { id: 'child-9', parentSession: 'parent-1' } } }
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'parent-1', message: '回答' } })).toContain(DENY_REPLY)
    expect(guard({ agent, name: 'ops_bash', arguments: {} })).toContain(DENY)
    unregister()
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'parent-1', message: '回答' } })).toBeUndefined()
  })

  it('白名单写上 send_message 也不能放行：发给父会话与其它 agent 一律拒绝', () => {
    const guard = createAnswerOnlyGuard(() => ['send_message'])
    const agent = ownedAgent()
    guard.own(agent)
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'parent-session', message: '回答' } })).toContain(DENY_REPLY)
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'someone-else', message: '回答' } })).toContain(DENY_REPLY)
    // 配置里的 send_message 被过滤后白名单为空：拒绝文案回到默认原文，
    // 且绝不把 send_message 列成「已放行」。
    const other = guard({ agent, name: 'read_file', arguments: {} })
    expect(other).toBe('BTW 仅允许文字回答，禁止执行任何工具。 / BTW allows text responses only; tool execution is strictly prohibited.')
    expect(other).not.toContain('send_message')
  })

  it('白名单混排时普通工具按配置放行，send_message 仍被拒', () => {
    const guard = createAnswerOnlyGuard(() => ['pele_draw', 'send_message'])
    const agent = ownedAgent()
    guard.own(agent)
    expect(guard({ agent, name: 'pele_draw', arguments: {} })).toBeUndefined()
    expect(guard({ agent, name: 'send_message', arguments: { agent_id: 'parent-session', message: '回答' } })).toContain(DENY_REPLY)
  })

  it('非旁问代理的 send_message 不受影响', () => {
    const guard = createAnswerOnlyGuard()
    const foreign = { session: { header: { parentSession: 'parent-session' } } }
    expect(guard({ agent: foreign, name: 'send_message', arguments: { agent_id: 'parent-session', message: 'x' } })).toBeUndefined()
  })
})

describe('H-2 加固：不再按可碰撞显示 label 认领代理', () => {
  it('同名 label 的外来代理（含 descriptor 快照）绝不被认领、不被误拒', () => {
    const guard = createAnswerOnlyGuard()
    // 模拟带 btw 显示 label 的外来子代理：护栏不应读取任何会话事件/快照/投影。
    const foreign = {
      id: 'foreign-1',
      session: {
        header: { parentSession: 'parent-session' },
        snapshotEvents: () => [{ type: 'subagent/descriptor', data: { label: '旁问专家' } }],
      },
    }
    expect(guard({ agent: foreign, name: 'ops_bash', arguments: {} })).toBeUndefined()
    expect(guard({ agent: foreign, name: 'send_message', arguments: { agent_id: 'parent-session', message: 'x' } })).toBeUndefined()
    // 旁问自己的代理仍被严格拦截，两条路径互不干扰。
    guard.own(foreign)
    expect(guard({ agent: foreign, name: 'ops_bash', arguments: {} })).toContain(DENY)
  })

  it('护栏完全不触碰 session.snapshotEvents / 投影，无 fail-open 读取路径', () => {
    const guard = createAnswerOnlyGuard(() => ['pele_draw'])
    const exploding = {
      session: {
        snapshotEvents: () => { throw new Error('生产路径不应再读 snapshotEvents') },
      },
    }
    // 未认领：不受 label 影响，也不触发快照读取。
    expect(guard({ agent: exploding, name: 'ops_bash', arguments: {} })).toBeUndefined()
    // 已认领：verdict 直接来自白名单判断，同样不读快照。
    guard.own(exploding)
    expect(guard({ agent: exploding, name: 'ops_bash', arguments: {} })).toContain('白名单工具')
    expect(guard({ agent: exploding, name: 'pele_draw', arguments: {} })).toBeUndefined()
  })
})

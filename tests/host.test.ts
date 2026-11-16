import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context as ContextType } from '@deepseek-ai/cordis'
import type { ToolRuntime as RuntimeType } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { apply } from '../src/index'
import { RUN_COMMAND } from '../src/shared'
import { SIDE_MAX_OUTPUT_TOKENS } from '../src/limits'
import { createAnswerOnlyGuard } from '../src/server/tool-guard'

// 默认验证锁文件中的宿主版本；允许显式指定旧版依赖图做兼容回归。
const runtimeRoot = process.env.DSH_RUNTIME_ROOT ?? fileURLToPath(new URL('../node_modules', import.meta.url))
const modulePath = (name: string) => pathToFileURL(join(runtimeRoot, '@deepseek-ai', name, 'lib', 'index.js')).href
const runtimeVersion = JSON.parse(readFileSync(join(runtimeRoot, '@deepseek-ai', 'dsh-tools', 'package.json'), 'utf8')).version
afterEach(() => { vi.useRealTimers() })

describe(`DSH ${runtimeVersion} 真实运行时`, () => {
  const load = async () => {
    const { Context } = await import(/* @vite-ignore */ modulePath('cordis')) as { Context: typeof ContextType }
    const { ToolRuntime } = await import(/* @vite-ignore */ modulePath('dsh-tools')) as { ToolRuntime: typeof RuntimeType }
    const { createScope } = await import(/* @vite-ignore */ modulePath('dsh-scope')) as {
      createScope(ctx: ContextType, key: object): { ctx: ContextType; dispose(): Promise<void> }
    }
    return { Context, ToolRuntime, createScope }
  }

  const setupTools = async (ctx: any, ToolRuntime: any) => {
    if (!ctx.tools) new ToolRuntime(ctx)
    if (typeof ctx.tools?.setExecutor === 'function') {
      const pipelinePath = pathToFileURL(join(runtimeRoot, '@deepseek-ai', 'dsh-tools', 'lib', 'pipeline.js')).href
      const toolsPath = pathToFileURL(join(runtimeRoot, '@deepseek-ai', 'dsh-tools', 'lib', 'index.js')).href
      const { ToolExecutionPipeline, executeToolBatch } = await import(/* @vite-ignore */ pipelinePath)
      const { projectToolSchema } = await import(/* @vite-ignore */ toolsPath) as { projectToolSchema: (d: any, f: boolean) => any }
      const pipeline = new ToolExecutionPipeline(ctx)
      ctx.tools.setExecutor({
        describe: (tools: any[]) => ({ schemas: tools.map(t => projectToolSchema(t, false)) }),
        execute: async (input: any) => {
          const isSingleCall = !input.calls && input.name
          const batchInput = isSingleCall
            ? { ...input, calls: [{ id: input.callId, name: input.name, arguments: JSON.stringify(input.arguments ?? {}) }] }
            : input
          const outcome = await executeToolBatch(batchInput, pipeline, () => 10)
          return isSingleCall ? (outcome.results[0]?.result ?? outcome) : outcome
        },
      })
    }
  }

  it('根 fiber 拒绝 effect 时仍能激活并注册 btw', async () => {
    const { Context, ToolRuntime } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    ctx.provide('subagents', { getProvider: () => undefined })
    const fiber = ctx.root.fiber as { effect(execute: () => unknown, label?: string): unknown }
    const rootEffect = fiber.effect.bind(ctx.root.fiber)
    fiber.effect = (execute, label) => {
      if (label === 'tools.guard()') throw new Error('dsh-tui: root.effect is unavailable from a plugin activation')
      return rootEffect(execute, label)
    }
    const plugin = ctx.plugin(apply)
    try {
      await plugin.await()
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error))
    }
    expect(commands.has('btw')).toBe(true)
    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('空白名单拒绝一切工具（含 send_message 回传），主任务工具可执行', async () => {
    const { Context, ToolRuntime, createScope } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const body = vi.fn(async () => 'executed')
    ctx.tools.register({ name: 'normal', description: '测试工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute: body })
    const protection = createAnswerOnlyGuard()
    ctx.tools.guard(protection)
    // alpha.2+ 移除 presentAs('both')：native 覆盖子作用域自有工具；ptc 覆盖宿主 run_code。
    const childNative = { session: {} } as unknown as Agent
    const scopeNative = createScope(ctx, childNative)
    scopeNative.ctx.tools.register({ name: 'child_local', description: '子作用域工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute: body })
    if (typeof (scopeNative.ctx.tools as any).presentAs === 'function') {
      (scopeNative.ctx.tools as any).presentAs('native')
    } else {
      await setupTools(scopeNative.ctx, ToolRuntime)
    }
    protection.own(childNative)
    expect(ctx.tools.get('normal', childNative)).toBeDefined()
    expect(ctx.tools.get('child_local', childNative)).toBeDefined()
    const blockedLocal = await (ctx.tools as any).execute({ name: 'child_local', callId: 'test-local' as never, arguments: {}, agent: childNative, signal: new AbortController().signal })
    expect(blockedLocal.isError).toBe(true)
    expect(JSON.stringify(blockedLocal.content)).toContain('BTW 仅允许文字回答，禁止执行任何工具。')

    const childPtc = { session: {} } as unknown as Agent
    const scopePtc = createScope(ctx, childPtc)
    if (typeof (scopePtc.ctx.tools as any).presentAs === 'function') {
      (scopePtc.ctx.tools as any).presentAs('ptc')
      protection.own(childPtc)
      expect(ctx.tools.get('run_code', childPtc)).toBeDefined()
      const blockedRun = await (ctx.tools as any).execute({ name: 'run_code', callId: 'test-run' as never, arguments: { description: 'x', code: '1' }, agent: childPtc, signal: new AbortController().signal })
      expect(blockedRun.isError).toBe(true)
      expect(JSON.stringify(blockedRun.content)).toContain('BTW 仅允许文字回答，禁止执行任何工具。')
      expect(body).not.toHaveBeenCalled()
    }

    // F-02 加固：send_message 一律拒绝——即使目标是自己的父会话（工具 schema 仍保留，缓存前缀不受影响）。
    const sendBody = vi.fn(async () => 'sent')
    ctx.tools.register({ name: 'send_message', description: '发消息给另一个 agent', parameters: { type: 'object', properties: { agent_id: { type: 'string' }, message: { type: 'string' } }, required: ['agent_id', 'message'] }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute: sendBody })
    const childReply = { session: { header: { id: 'btw-child', parentSession: 'parent-session' } } } as unknown as Agent
    protection.own(childReply)
    const reply = await (ctx.tools as any).execute({ name: 'send_message', callId: 'test-reply' as never, arguments: { agent_id: 'parent-session', message: '回答' }, agent: childReply, signal: new AbortController().signal })
    expect(reply.isError).toBe(true)
    expect(JSON.stringify(reply.content)).toContain('BTW 禁止向主会话或任何其它代理回传消息')
    expect(sendBody).not.toHaveBeenCalled()

    const misrouted = await (ctx.tools as any).execute({ name: 'send_message', callId: 'test-misroute' as never, arguments: { agent_id: 'someone-else', message: '回答' }, agent: childReply, signal: new AbortController().signal })
    expect(misrouted.isError).toBe(true)
    expect(JSON.stringify(misrouted.content)).toContain('BTW 禁止向主会话或任何其它代理回传消息')
    expect(sendBody).not.toHaveBeenCalled()

    const result = await (ctx.tools as any).execute({ name: 'normal', callId: 'main' as never, arguments: {}, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
    expect(body).toHaveBeenCalledOnce()
    await scopeNative.dispose()
    await scopePtc.dispose()
    await ctx.fiber.dispose()
  })

  it('同名显示 label 的外来子代理不被护栏误伤（label 识别已移除，H-2 回归）', async () => {
    const { Context, ToolRuntime, createScope } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    const body = vi.fn(async () => 'foreign executed')
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { toolFilter: true, persona: true } }),
      startActivation: async (spec: { label: string }) => {
        // 旁问运行期间，一个显示 label 恰好与旁问名相同的外来子代理发出了自己的描述符。
        ctx.emit('session/event', foreign.session as never, { type: 'subagent/descriptor', data: { label: spec.label } } as never)
        return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }), dispose: async () => {} }
      },
    })
    const plugin = ctx.plugin(apply)
    await plugin.await()
    const foreign = { session: { header: { id: 'foreign-session' } } } as unknown as Agent
    const scope = createScope(ctx, foreign)
    scope.ctx.tools.register({ name: 'foreign_tool', description: '外来子代理工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute: body })
    await commands.get(RUN_COMMAND)!.handler({ agent: { session: { header: { id: 'main' } } }, rawInput: JSON.stringify({ id: 'request-lbl', question: '问题' }), signal: new AbortController().signal } as never)
    // 旁问已结束且 label 从未认领任何对象：外来代理的工具照常执行。
    const allowed = await (ctx.tools as any).execute({ name: 'foreign_tool', callId: 'foreign' as never, arguments: {}, agent: foreign, signal: new AbortController().signal })
    expect(allowed.isError).toBeFalsy()
    expect(body).toHaveBeenCalledOnce()
    await plugin.dispose()
    await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('startActivation 扁平契约收紧旁问输出预算，取 min 避免抬高小预算路由', async () => {
    const { Context, ToolRuntime } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    const dispose = vi.fn(async () => {})
    const startActivation = vi.fn(async (_spec: {
      provider: string
      childId: string
      label: string
      parent: unknown
      agentOptions?: { maxTokens?: number }
      prompt: readonly { type: string; text: string }[]
      signal: AbortSignal
      delivery: string
    }) => ({
      result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '旁问答案' }] }),
      dispose,
    }))
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true } }),
      startActivation,
    })

    const plugin = ctx.plugin(apply)
    await plugin.await()
    // 1. 父任务为小预算路由 (4096) 时，不能抬高到 32000
    const outcome1 = await commands.get(RUN_COMMAND)!.handler({
      agent: { session: { header: { id: 'main' } }, options: { maxTokens: 4096 } },
      rawInput: JSON.stringify({ id: 'small-budget-req', question: '小预算' }),
      signal: new AbortController().signal,
    } as never)
    expect(outcome1).toEqual({ kind: 'success', text: '旁问答案' })
    const spec0 = startActivation.mock.calls[0]![0]
    expect(spec0.provider).toBe('fork')
    expect(spec0.parent).toBeDefined()
    expect(spec0.prompt).toEqual([{ type: 'text', text: expect.stringContaining('小预算') }])
    expect(spec0.agentOptions).toEqual({ maxTokens: 4096 })

    // 2. 父任务为大上下文 (256000) 时，收紧到 32000
    await commands.get(RUN_COMMAND)!.handler({
      agent: { session: { header: { id: 'main' } }, options: { maxTokens: 256_000 } },
      rawInput: JSON.stringify({ id: 'large-budget-req', question: '大预算' }),
      signal: new AbortController().signal,
    } as never)
    expect(startActivation.mock.calls[1]![0].agentOptions).toEqual({ maxTokens: SIDE_MAX_OUTPUT_TOKENS })

    // 3. 父任务未显式配置 maxTokens 时，缺省使用 32000
    await commands.get(RUN_COMMAND)!.handler({
      agent: { session: { header: { id: 'main' } } },
      rawInput: JSON.stringify({ id: 'default-budget-req', question: '缺省预算' }),
      signal: new AbortController().signal,
    } as never)
    expect(startActivation.mock.calls[2]![0].agentOptions).toEqual({ maxTokens: SIDE_MAX_OUTPUT_TOKENS })

    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('startActivation 不改系统提示与工具定义，agent/created 后子代理工具被拦截', async () => {
    const { Context, ToolRuntime, createScope } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })

    const childMutable = { id: '', session: {} }
    const child = childMutable as unknown as Agent & { ctx?: ContextType }
    let scope: { ctx: ContextType; dispose(): Promise<void> }
    const dispose = vi.fn(async () => {})
    const startActivation = vi.fn(async (spec: { childId: string; agentOptions?: { maxTokens?: number }; toolFilter?: unknown; persona?: unknown }) => {
      // persona / toolFilter 会改写请求前缀，使旁问无法复用主会话的 prompt cache
      expect(spec.toolFilter).toBeUndefined()
      expect(spec.persona).toBeUndefined()
      expect(spec.agentOptions).toEqual({ maxTokens: 4096 })
      childMutable.id = spec.childId
      scope = createScope(ctx, child)
      child.ctx = scope.ctx
      // 宿主在释放排队工作前串行发出 agent/created，插件据此挂 child 级护栏。
      ctx.emit('agent/created', { agent: child } as never)
      return { result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '启动回答' }] }), dispose }
    })

    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { toolFilter: true, persona: true, agentOptions: true } }),
      startActivation,
    })

    const plugin = ctx.plugin(apply)
    await plugin.await()

    const outcome = await commands.get(RUN_COMMAND)!.handler({
      agent: { session: { header: { id: 'main' } }, options: { maxTokens: 4096 } },
      rawInput: JSON.stringify({ id: 'start-req', question: '启动问题' }),
      signal: new AbortController().signal,
    } as never)

    expect(outcome).toEqual({ kind: 'success', text: '启动回答' })
    expect(startActivation).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce() // 正常完成在 SideJobs execute 结束时调用 cleanup 释放

    // agent/created 认领的子代理，其自有工具同样被拦截
    const currentScope = scope!
    currentScope.ctx.tools.register({ name: 'child_tool', description: '测试工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: v => [{ type: 'text', text: String(v) }] }, execute: vi.fn() })
    const blocked = await (ctx.tools as any).execute({ name: 'child_tool', callId: 'test-call' as never, arguments: {}, agent: child, signal: new AbortController().signal })
    expect(blocked.isError).toBe(true)
    expect(JSON.stringify(blocked.content)).toContain('BTW 仅允许文字回答，禁止执行任何工具。')

    await plugin.dispose()
    if (scope!) await scope.dispose()
    await ctx.fiber.dispose()
  })

  it('插件卸载期间保护持续到子代理清理完成', async () => {
    const { Context } = await load()
    const ctx = new Context()
    const commands = new Map<string, CommandDefinition>()
    let protectedNow = false
    let finishCleanup!: () => void
    let cleanupStarted = false
    ctx.provide('tools', { guard: () => ctx.effect(() => { protectedNow = true; return () => { protectedNow = false } }) })
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true } }),
      startActivation: async () => ({ result: new Promise(() => {}), dispose: () => { cleanupStarted = true; return new Promise<void>(resolve => { finishCleanup = resolve }) } }),
    })
    const plugin = ctx.plugin(apply)
    await plugin.await()
    const answer = commands.get(RUN_COMMAND)!.handler({ agent: { session: { header: { id: 'main' } } }, rawInput: JSON.stringify({ id: 'request-123', question: '问题' }), signal: new AbortController().signal } as never)
    await Promise.resolve()
    const unload = plugin.dispose()
    await vi.waitFor(() => expect(cleanupStarted).toBe(true))
    expect(protectedNow).toBe(true)
    finishCleanup()
    await unload
    await answer
    expect(protectedNow).toBe(false)
    await ctx.fiber.dispose()
  })

  it('卸载清理挂起时按时退出，真实工具保护延续到迟到清理成功', async () => {
    const { Context, ToolRuntime, createScope } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    let finishCleanup!: () => void
    const cleanup = new Promise<void>(resolve => { finishCleanup = resolve })
    const dispose = vi.fn(() => cleanup)
    const childMutable = { id: '', session: {} }
    const child = childMutable as unknown as Agent & { ctx?: ContextType }
    let scope: { ctx: ContextType; dispose(): Promise<void> }
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true } }),
      startActivation: async (spec: { childId: string }) => {
        childMutable.id = spec.childId
        scope = createScope(ctx, child)
        child.ctx = scope.ctx
        ctx.emit('agent/created', { agent: child } as never)
        return { result: new Promise(() => {}), dispose }
      },
    })
    const plugin = ctx.plugin(apply)
    await plugin.await()
    vi.useFakeTimers()
    const answer = commands.get(RUN_COMMAND)!.handler({ agent: { session: { header: { id: 'main' } } }, rawInput: JSON.stringify({ id: 'request-123', question: '问题' }), signal: new AbortController().signal } as never)
    await vi.advanceTimersByTimeAsync(0)
    const body = vi.fn(async () => 'executed')
    scope!.ctx.tools.register({ name: 'orphan_tool', description: '未释放子代理的工具', parameters: { type: 'object', properties: {} }, output: { schema: { type: 'string' }, render: value => [{ type: 'text', text: String(value) }] }, execute: body })
    const unload = plugin.dispose()
    const finished = vi.fn()
    void unload.then(finished)
    await vi.advanceTimersByTimeAsync(5_001)
    expect(finished).toHaveBeenCalledTimes(1)
    expect(commands.has(RUN_COMMAND)).toBe(false)
    expect((await answer)?.kind).toBe('error')
    expect(dispose).toHaveBeenCalledTimes(1)
    const blocked = await (ctx.tools as any).execute({ name: 'orphan_tool', callId: 'orphan' as never, arguments: {}, agent: child, signal: new AbortController().signal })
    expect(blocked.isError).toBe(true)
    expect(body).not.toHaveBeenCalled()
    finishCleanup()
    await vi.advanceTimersByTimeAsync(0)
    const released = await (ctx.tools as any).execute({ name: 'orphan_tool', callId: 'released' as never, arguments: {}, agent: child, signal: new AbortController().signal })
    expect(released.isError).not.toBe(true)
    expect(body).toHaveBeenCalledTimes(1)
    await scope!.dispose()
    await ctx.fiber.dispose()
  })

  it('卸载时启动仍挂起，迟到句柄被清理且注销保护', async () => {
    const { Context } = await load()
    const ctx = new Context()
    const commands = new Map<string, CommandDefinition>()
    let protectedNow = false
    let finishStart!: (run: { result: Promise<unknown>; dispose: () => Promise<void> }) => void
    ctx.provide('tools', { guard: () => ctx.effect(() => { protectedNow = true; return () => { protectedNow = false } }) })
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, agentPreset: false, outputSchema: true, depthLimit: true } }),
      startActivation: () => new Promise(resolve => { finishStart = resolve as typeof finishStart }),
    })
    const plugin = ctx.plugin(apply)
    await plugin.await()
    vi.useFakeTimers()
    const answer = commands.get(RUN_COMMAND)!.handler({ agent: { session: { header: { id: 'main' } } }, rawInput: JSON.stringify({ id: 'request-123', question: '问题' }), signal: new AbortController().signal } as never)
    const unload = plugin.dispose()
    await vi.advanceTimersByTimeAsync(5_001)
    await expect(unload).resolves.toBeUndefined()
    expect(protectedNow).toBe(true)
    const dispose = vi.fn(async () => {})
    finishStart({ result: new Promise(() => {}), dispose })
    await vi.advanceTimersByTimeAsync(0)
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(protectedNow).toBe(false)
    expect((await answer)?.kind).toBe('error')
    await ctx.fiber.dispose()
  })

  it('Issue #21: 错过 agent/created 时凭预登记 childId 确定性拦截工具', async () => {
    const { Context, ToolRuntime } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })

    let capturedChildId: string | undefined
    let resolveRun!: (value: { stopReason: string; output: readonly { type: string; text?: string }[] }) => void
    const runPromise = new Promise<{ stopReason: string; output: readonly { type: string; text?: string }[] }>(resolve => { resolveRun = resolve })

    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, outputSchema: true } }),
      startActivation: async (spec: { childId: string }) => {
        capturedChildId = spec.childId
        return {
          result: runPromise,
          dispose: async () => {},
        }
      },
    })

    const body = vi.fn(async () => 'should-not-run')
    ctx.tools.register({
      name: 'ops_bash',
      description: '执行命令',
      parameters: { type: 'object', properties: {} },
      output: { schema: { type: 'string' }, render: v => [{ type: 'text', text: String(v) }] },
      execute: body,
    })

    const plugin = ctx.plugin(apply)
    await plugin.await()

    // 发起旁问任务（非阻塞挂起）
    const sideAsk = commands.get(RUN_COMMAND)!.handler({
      agent: { session: { header: { id: 'main' } } },
      rawInput: JSON.stringify({ id: 'issue-21-req', question: '测试命令拦截' }),
      signal: new AbortController().signal,
    } as never)

    // 等待 startActivation 被调用并记录分配的 childId
    await vi.waitFor(() => expect(capturedChildId).toBeDefined())

    // 1. 模拟子代理在 live 段尝试执行 ops_bash，由于预登记了 childId，凭 agent.id 立即单调拒绝
    const blockedById = await (ctx.tools as any).execute({
      name: 'ops_bash',
      callId: 'call-1' as never,
      arguments: {},
      agent: { id: capturedChildId } as never,
      signal: new AbortController().signal,
    })
    expect(blockedById.isError).toBe(true)
    expect(JSON.stringify(blockedById.content)).toContain('BTW 仅允许文字回答，禁止执行任何工具。')
    expect(body).not.toHaveBeenCalled()

    // 2. 模拟以 session.header.id 传入（包装 agent 场景），同样单调拒绝
    const blockedByHeader = await (ctx.tools as any).execute({
      name: 'ops_bash',
      callId: 'call-2' as never,
      arguments: {},
      agent: { session: { header: { id: capturedChildId } } } as never,
      signal: new AbortController().signal,
    })
    expect(blockedByHeader.isError).toBe(true)
    expect(JSON.stringify(blockedByHeader.content)).toContain('BTW 仅允许文字回答，禁止执行任何工具。')
    expect(body).not.toHaveBeenCalled()

    // 结束旁问
    resolveRun({ stopReason: 'completed', output: [{ type: 'text', text: '完成回答' }] })
    await sideAsk

    // 任务结束后预登记 id 必须释放，避免残留 id 长期拦截已结束的子会话
    const released = await (ctx.tools as any).execute({
      name: 'ops_bash',
      callId: 'call-3' as never,
      arguments: {},
      agent: { id: capturedChildId } as never,
      signal: new AbortController().signal,
    })
    expect(released.isError).toBeFalsy()
    expect(body).toHaveBeenCalledTimes(1)

    await plugin.dispose()
    await ctx.fiber.dispose()
  })

  it('0.2.2-rc.3 扁平 startActivation：提示词不含父会话标识，send_message 在执行层被拒', async () => {
    const { Context, ToolRuntime } = await load()
    const ctx = new Context()
    ctx.provide('systemPrompt', { tools: () => () => {}, section: () => () => {}, getSectionOrder: () => 0 })
    await setupTools(ctx, ToolRuntime)
    const commands = new Map<string, CommandDefinition>()
    ctx.provide('commands', { register: (command: CommandDefinition) => { commands.set(command.name, command); return () => { commands.delete(command.name) } } })

    const sendBody = vi.fn(async () => 'sent')
    ctx.tools.register({
      name: 'send_message',
      description: 'Send a message to an agent.',
      parameters: { type: 'object', properties: { agent: { type: 'string' }, message: { type: 'string' } }, required: ['agent', 'message'] },
      output: { schema: { type: 'string' }, render: v => [{ type: 'text', text: String(v) }] },
      execute: sendBody,
    })

    const receivedSpecs: Array<Record<string, unknown>> = []
    const rootAgent = { id: 'main', session: { header: { id: 'main' } }, options: { maxTokens: 4096 } } as unknown as Agent
    ctx.provide('subagents', {
      getProvider: () => ({ inheritsParentContext: true, capabilities: { agentOptions: true, outputSchema: true } }),
      startActivation: async (spec: Record<string, unknown>) => {
        receivedSpecs.push(spec)
        const childId = spec.childId as string
        const child = { id: childId, session: { header: { id: childId, parentSession: 'main' } } } as unknown as Agent
        // F-02 加固：即使目标指向父会话（'lead'），回传也在执行层被拒绝
        const replyRes = await (ctx.tools as any).execute({
          name: 'send_message',
          callId: 'call-lead' as never,
          arguments: { agent: 'lead', message: '完成结论' },
          agent: child,
          signal: new AbortController().signal,
        })
        expect(replyRes.isError).toBe(true)
        expect(JSON.stringify(replyRes.content)).toContain('BTW 禁止向主会话或任何其它代理回传消息')
        expect(sendBody).not.toHaveBeenCalled()
        return {
          result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: '扁平回答' }] }),
          dispose: async () => {},
        }
      },
    })

    const plugin = ctx.plugin(apply)
    await plugin.await()
    const outcome = await commands.get(RUN_COMMAND)!.handler({
      agent: rootAgent,
      rawInput: JSON.stringify({ id: 'flat-rc3-req', question: '测试扁平启动' }),
      signal: new AbortController().signal,
    } as never)

    expect(outcome).toEqual({ kind: 'success', text: '扁平回答' })
    expect(sendBody).not.toHaveBeenCalled()
    expect(receivedSpecs).toHaveLength(1)
    const spec = receivedSpecs[0]!
    expect(spec.request).toBeUndefined()
    expect(spec.parent).toBe(rootAgent)
    expect(spec.agentOptions).toEqual({ maxTokens: 4096 })
    expect(spec.delivery).toBe('caller')
    expect(typeof spec.childId).toBe('string')
    expect(typeof spec.label).toBe('string')
    const promptText = (spec.prompt as Array<{ text: string }>)[0]!.text
    // 提示词声明所有工具（含 send_message）会被拒绝执行……
    expect(promptText).toContain('所有工具调用（包括 send_message）都会被拒绝执行')
    // ……但绝不泄漏父会话 id / 别名，也没有回传指引。
    expect(promptText).not.toContain('lead')
    expect(promptText).not.toContain('"main"')
    expect(promptText).not.toContain('agent 为')
    expect(promptText).not.toContain('replyHint')

    await plugin.dispose()
    await ctx.fiber.dispose()
  })
})

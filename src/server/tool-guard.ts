export interface AgentIdentity {
  id?: string
  session?: {
    id?: string
    header?: { id?: string }
  } | object
}

/**
 * 工具白名单的读取函数。
 *
 * 用 getter 而不是快照：配置项在设置面板里是可写的，用户在面板里改完就应在下一次
 * 旁问里生效，不需要重载插件。
 */
export type AllowedToolsOf = () => readonly string[]

const DENY = 'BTW 仅允许文字回答，禁止执行任何工具。 / BTW allows text responses only; tool execution is strictly prohibited.'

/**
 * `send_message` 的专用拒绝文案。
 *
 * 旁问子代理一律禁止向主会话或任何其它代理回传消息（F-02 加固）：保留工具 schema
 * 只为让请求与主会话逐字节一致以复用 prompt cache，执行层永远拒绝。
 * 用户需要答案时可自行复制或引用旁问气泡中的内容。
 */
const DENY_REPLY = 'BTW 禁止向主会话或任何其它代理回传消息，答案只保留在旁问气泡中，用户可自行复制或引用。 / BTW cannot send messages back to the main session or any other agent; the answer stays in this side-ask bubble, where the user can copy or quote it.'

/**
 * 永远禁止执行的继承工具。工具定义仍随 fork 请求下发（保持工具列表与主会话一致、
 * 复用 prompt cache 前缀），但执行层一律拒绝——即使白名单或自定义提示词试图放行。
 */
const REPLY_TOOL = 'send_message'

/**
 * 白名单非空时的拒绝文案。
 *
 * 默认（白名单为空）保持 `DENY` 原文不变，既让既有提示语与测试断言逐字节稳定，
 * 也避免在什么都没配置时给出一段「允许了某些工具」的误导说明。
 */
function denyFor(allowed: readonly string[], name?: string): string {
  if (name === REPLY_TOOL) return DENY_REPLY
  if (allowed.length === 0) return DENY
  const list = allowed.join(', ')
  return `BTW 仅允许文字回答与白名单工具（${list}），其余工具一律禁止。 / BTW allows text responses plus the whitelisted tools (${list}); every other tool call is rejected.`
}

export interface AnswerOnlyGuard {
  (execution: { agent?: AgentIdentity; name?: string; arguments?: unknown }): string | undefined
  own(agent: object): void
  ownId(id: string): () => void
}

/**
 * 构造执行期「只答不执行」护栏。
 *
 * 认领只依赖不可碰撞的作业身份：预登记 childId（`ownId`，先于 `startActivation`）
 * 与 `agent/created` 后 `own` 的代理对象。不读取显示 label、会话快照或投影，
 * 因此不存在按可碰撞 label 永久认领无关代理（H-2）、快照 fail-open（H-1）
 * 或热路径投影开销（H-3）。未被认领的代理（主任务、其它子代理）一律不受影响。
 *
 * 白名单仅覆盖普通工具；`send_message` 被无条件排除，任何配置都无法放开回传通道。
 */
export function createAnswerOnlyGuard(
  allowedTools: AllowedToolsOf = () => [],
): AnswerOnlyGuard {
  const allowedNow = (): string[] => {
    const names = allowedTools()
    if (!Array.isArray(names)) return []
    // 回传工具永远拒绝：即便用户把 send_message 写进白名单也不能放行，
    // 否则旁问就能把答案发给任意 agent。
    return names.filter(name => typeof name === 'string' && name.length > 0 && name !== REPLY_TOOL)
  }

  const owned = new WeakSet<object>()
  const ownedIds = new Set<string>()
  const claim = (value: object | undefined) => {
    if (value && typeof value === 'object') owned.add(value)
  }
  const claimAgent = (agent: object | undefined) => {
    if (!agent) return
    claim(agent)
    if (typeof agent === 'object' && 'session' in agent) {
      claim((agent as { session?: object }).session)
    }
  }
  const isOwnedId = (agent: AgentIdentity): boolean => {
    if (ownedIds.size === 0) return false
    if (typeof agent.id === 'string' && ownedIds.has(agent.id)) return true
    const session = agent.session as { id?: unknown; header?: { id?: unknown } } | undefined
    if (session && typeof session === 'object') {
      if (typeof session.id === 'string' && ownedIds.has(session.id)) return true
      if (typeof session.header?.id === 'string' && ownedIds.has(session.header.id)) return true
    }
    return false
  }

  const guard: AnswerOnlyGuard = ({ agent, name }) => {
    if (!agent) return undefined
    const allowed = allowedNow()
    // 用户显式配置的普通白名单工具按配置放行；白名单不可能包含 send_message。
    if (name !== undefined && allowed.includes(name)) return undefined
    // 认领路径（预登记 id / 已认领对象）命中即拒绝：默认拒绝一切工具，
    // 包括 send_message。
    const verdict = denyFor(allowed, name)
    if (isOwnedId(agent)) return verdict
    if (owned.has(agent) || (agent.session !== undefined && owned.has(agent.session))) return verdict
    return undefined
  }
  guard.own = agent => { claimAgent(agent) }
  guard.ownId = id => {
    ownedIds.add(id)
    return () => { ownedIds.delete(id) }
  }
  return guard
}

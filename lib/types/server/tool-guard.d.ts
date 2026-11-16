export interface AgentIdentity {
    id?: string;
    session?: {
        id?: string;
        header?: {
            id?: string;
        };
    } | object;
}
/**
 * 工具白名单的读取函数。
 *
 * 用 getter 而不是快照：配置项在设置面板里是可写的，用户在面板里改完就应在下一次
 * 旁问里生效，不需要重载插件。
 */
export type AllowedToolsOf = () => readonly string[];
export interface AnswerOnlyGuard {
    (execution: {
        agent?: AgentIdentity;
        name?: string;
        arguments?: unknown;
    }): string | undefined;
    own(agent: object): void;
    ownId(id: string): () => void;
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
export declare function createAnswerOnlyGuard(allowedTools?: AllowedToolsOf): AnswerOnlyGuard;

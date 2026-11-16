# Security boundaries / 安全边界

Personal fork: **hysonger/dsh-btw**, version **1.3.11-hardened.1**. Baseline: upstream release **v1.3.11**, commit `6db748c8c021101eb4878f5b32edd0469e240843`. This fork targets **DSH 0.2.2-rc.3** only; future hosts require renewed verification. Original Apache-2.0 licensing and attribution are retained.

## Model and parent-session isolation / 模型与主会话隔离

The default empty whitelist denies all tools. `send_message` is always denied, including when explicitly whitelisted, requested by the question, or embedded in a custom prompt. The model never receives a parent delivery hint. Retaining inherited tool schemas for cache-prefix reuse does not grant execution permission. Results are delivered to the caller/UI, not automatically to the parent model.

默认空白名单拒绝全部工具；`send_message` 不再是隐藏例外，也不能被白名单放开。问题、引用或自定义提示词不能授权回传。需要把答案带回主对话时，由用户复制或引用后手动发送。护栏按预登记 childId／实际 Agent 身份绑定，不按显示标签认领其他 Agent。

An explicit whitelist for ordinary tools remains an advanced capability grant. Its tools must be reviewed independently; do not add messaging/delegation or general execution tools that can undermine isolation indirectly. Configuration changes are volatile and can affect an active job. The main agent's own tool policy, sandbox and approvals are not replaced by this plugin.

普通工具白名单仍是显式放权，不代表所有工具都适合旁问。不要放行消息、子代理、通用命令执行器来绕过隔离。运行中不要放宽配置。默认限制不保证已授权的任意第三方工具本身安全。

## Untrusted rendering / 不可信输出渲染

Answers use bundled `react-markdown` with GFM, `skipHtml`, and an image component that returns null. No host Markdown renderer is loaded. All image forms—including shortcut/full/collapsed references and malformed code boundaries—reach the same image-denying sink; there is no regex-only image policy. Raw HTML is dropped, and dangerous link protocols use the renderer's default safe URL transform. Links require a user click and use `noopener noreferrer`. Copy actions write only on a user gesture.

回答在组件层禁图，原始 HTML 不渲染，不再用正则猜测 Markdown 图片语法。代码块中的示例保持文字。普通网页链接可由用户主动点击；这不是零网络模型，真实 LLM 调用仍由 DSH 已配置的服务商处理。公式暂显示源码，避免为保留宿主私有渲染器而重新引入不稳定接口。

## Scoped UI and draft editing / 会话作用域与草稿

No global button is injected into the official quote surface. Official keyed actions use the session ID from their own scope; plugin-owned selection UI verifies one message/container. The official quote action is not overwritten. A missing handler does not clear selection. Composer writes require plain editing state and atomic insertion; no `setDraft` fallback discards chips or bypasses a lock. Where source identity cannot be established, jump-back fails closed.

不抢写宿主全局 DOM，不按全局轮次猜测引用位置。会话切换后不得把选区或问题交给旧会话。锁定输入或原子插入失败时提示并保留草稿。设置订阅与计时器有对应 dispose。

## Persistence and limits / 持久化与限额

Bubble state is in memory, but standard DSH fork children may be persisted with inherited history, question and answer. Closing or reloading a bubble is not secure deletion; use DSH's session/log retention controls. There is no new standalone HTTP endpoint, credential store, telemetry endpoint or provider route. The existing concurrency limit (8), bounded inputs, 30-minute watchdog and 32,000-token output cap remain. These are bounds, not a promise of low cost.

气泡消失不代表子会话日志已删除。模型继承已完成的父回合，不包含正在生成的回答。API 凭据仍由宿主提供，不经本插件自建存储。预算与超时不能替代费用控制。

## Build, release and installation / 构建、发布与安装

- The repository is an independent fork, **not** a child dependency of `my-dsh-plugins`. It is tracked alongside the separately hardened `dsh-pet` fork because neither public upstream npm package contains the personal security patches.
- The package retains `@michengai/dsh-btw` and row identities for upgrade traceability, but is `private: true`; this fork does not publish to the upstream npm namespace. Never install upstream and fork simultaneously.
- The inherited publishing workflow is replaced by verification-only dispatch. It has no npm publishing/OIDC job. Runtime schemastery is pinned exactly; development dependencies are locked, and the test runner is upgraded to address the advisories found in the audit.
- Install the stable reviewed local checkout separately. Do not weaken `blockExoticSubdeps`, copy the plugin into the combination bundle, or replace it with `@latest`.
- Run `npm ci --ignore-scripts`, tests/typecheck, build and package-content checks. Review the final source-to-build diff and record hashes before installation. Upstream signatures apply only to the original release, **not** to these derived artifacts.

## Verification scope / 验证边界

Regression tests cover rendered image/HTML denial, safe links, locked/failed draft insertion, session-targeted actions and cleanup, default/whitelisted tool enforcement, no parent-message exception, child identity and foreign-agent separation, plus job cancellation and resource bounds. Real model calls are not needed for these deterministic policy tests. Unit/DOM tests are not screenshots or full browser acceptance; live registration and any unavailable visual checks must be reported separately at installation.

原始审计的禁图绕过、模型回传通道和全局选区按钮路径均由代码及回归测试处理。未声称“所有第三方依赖没有未知漏洞”，也不承诺任意未来 DSH 版本兼容。包内保留的其他语言上游说明是历史参考，fork 的安装与安全行为以本文件、主 README 和加固版更新日志为准。

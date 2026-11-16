# DSH BTW — personal hardened fork

[简体中文](<README.zh-CN.md>) · [English](<README.en.md>) · [Security boundaries](<HARDENING.md>) · [Apache-2.0](<LICENSE>)

Personal fork: [hysonger/dsh-btw](https://github.com/hysonger/dsh-btw). Based on the upstream [MichengAI/dsh-btw v1.3.11](https://github.com/MichengAI/dsh-btw/releases/tag/v1.3.11), commit `6db748c8c021101eb4878f5b32edd0469e240843`. Current fork version: **1.3.11-hardened.1**, supported DSH: **0.2.2-rc.3**.

Type `/btw your question` to ask about the completed conversation context in a separate answer bubble. Selection actions can quote a passage or open a side question without replacing the current draft. Closing a running bubble cancels that side question, not the main task.

## What changed

- The side model cannot call `send_message`, even if a question, custom prompt, or tool whitelist requests it. To return an answer to the main conversation, copy or quote it and send it yourself.
- Answers use a plugin-owned Markdown/GFM renderer that drops HTML and never creates image elements. This covers reference images and malformed Markdown, rather than relying on a regex.
- Selection actions use session-scoped controls, not injected buttons in another component's global DOM. A locked composer never falls back to whole-draft replacement.
- Guards identify reserved child IDs, not display labels that may collide with unrelated agents. Settings subscriptions and timers are cleaned up.
- No private Harness Client modules are loaded at runtime. Code-copy, lists, tables and fenced code remain; mathematics is displayed as source text, and quote jump-back fails closed when a reliable session scope is unavailable.

Read [HARDENING](<HARDENING.md>) for the threat model, retained opt-ins, persistence limits and verification scope. This is a personal derivative, not an official DeepSeek or MichengAI release.

## Installation

This repository is maintained and installed **separately** from [my-dsh-plugins](https://github.com/hysonger/my-dsh-plugins), alongside the independently hardened `dsh-pet` fork. The upstream npm package does not contain these patches. Do not install `@latest`, or enable upstream and fork together: package/plugin identities are intentionally retained.

The current local installation uses this stable checkout:

```sh
dsh plugin --profile desktop add /Users/songer/Projects/dsh-btw
```

For another machine, clone this fork over SSH, check out a reviewed **full commit SHA** or the hardened release tag, verify its artifacts, and add that local directory. The checked-in `lib/` is built before release; installation needs no build scripts. This package is `private: true` and is not published to the upstream npm namespace.

## Configuration

The default empty tool whitelist denies all tool execution. Explicitly allowed ordinary tools remain an advanced opt-in and must be reviewed separately; messaging and delegation tools must not be used to bypass side-question isolation. `send_message` is always denied. Changing a volatile whitelist can affect a running side question, so do not widen it while work is active. Custom prompts do not grant permission.

Questions are independent and inherit completed parent turns, not the response currently being generated. Bubble state is in memory, but DSH may persist child sessions and inherited context: closing a bubble is not secure deletion of logs. Only text questions are accepted.

## Development

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
npm pack --ignore-scripts
```

Use the committed lockfile. The fork's release workflow only verifies; it cannot publish to npm. Review upstream updates and the complete hardening delta before rebuilding or installing another version.

Original code and licensed artwork remain under [Apache-2.0](<LICENSE>), copyright MichengAI. Upstream history and changelogs are retained; fork changes are identified in the [changelog](<CHANGELOG.md>).

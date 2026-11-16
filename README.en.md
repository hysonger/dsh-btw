# DSH BTW — personal hardened fork

Version **1.3.11-hardened.1**, based on MichengAI/dsh-btw release **v1.3.11**. Supported DSH: **0.2.2-rc.3**.

See the [English usage and installation guide](<README.md>), [security boundaries](<HARDENING.md>), and [changelog](<CHANGELOG.md>).

The side model cannot send messages to the parent, even when requested or whitelisted. Model answers render without images or HTML. Scoped selection actions never replace a locked draft. To bring an answer into the main conversation, copy or quote it and send it yourself.

This personal fork is installed independently from `my-dsh-plugins`; the upstream npm package does not contain these patches. Do not install `@latest` or enable both variants together. Formula source remains readable but is no longer typeset; quote jump-back safely stops when its session scope cannot be established. Closing a bubble does not guarantee deletion of DSH child-session logs.

[Personal repository](https://github.com/hysonger/dsh-btw) · [Original upstream](https://github.com/MichengAI/dsh-btw) · [Apache-2.0](<LICENSE>)

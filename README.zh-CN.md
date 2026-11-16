# DSH BTW — 个人安全加固 fork

[English](<README.en.md>) · [安全边界](<HARDENING.md>) · [Apache-2.0](<LICENSE>)

个人仓库：[hysonger/dsh-btw](https://github.com/hysonger/dsh-btw)。基于上游 [MichengAI/dsh-btw v1.3.11](https://github.com/MichengAI/dsh-btw/releases/tag/v1.3.11)，提交 `6db748c8c021101eb4878f5b32edd0469e240843`。加固版本 **1.3.11-hardened.1**，支持宿主 **DSH 0.2.2-rc.3**。

在已有会话里输入 `/btw 问题`，基于已完成上下文获得独立气泡回答；也可选中一条消息内的段落后引用或旁问，不替换当前草稿。关闭正在回答的气泡只取消旁问，不取消主任务。

## 专门加固的边界

- **模型不能自动回传主会话。** `send_message` 始终被执行层拒绝，即使问题、自定义提示词或白名单要求放行。需要把答案带回主对话时，复制或引用后由用户手动发送。
- **渲染层禁图与 HTML。** 使用自有 Markdown/GFM 组件，不创建图片元素；引用式图片、畸形 Markdown 和原始 HTML 也不能触发图片加载，不再依赖正则清洗。
- **选区和输入框隔离。** 不向其他组件的全局 DOM 抢插按钮；按会话处理动作。输入框锁定或原子插入失败时停止，不降级为 `setDraft` 覆盖整个草稿。
- **子代理身份绑定。** 用预登记的子会话 ID 而不是可碰撞的显示标签识别旁问；设置订阅与计时器成对清理。
- **不加载私有 Harness Client 模块。** 保留 Markdown、GFM 表格列表、代码块与代码复制。数学公式暂显示源码；无法可靠定位会话范围时，引用跳回原文安全失败，不猜测其他会话。

详见 [HARDENING](<HARDENING.md>)。这是个人衍生维护版，不是 DeepSeek 或 MichengAI 官方发布。

## 独立安装

本 fork 与独立加固的 `dsh-pet` 一并建账，但**不纳入** [my-dsh-plugins](https://github.com/hysonger/my-dsh-plugins) 组合包。上游 npm 版本不含补丁，不要用 `@latest` 覆盖。为保留上游升级关联，包名和插件身份未重命名；不要同时启用上游与本 fork。

当前机器使用稳定的独立本地检出：

```sh
dsh plugin --profile desktop add /Users/songer/Projects/dsh-btw
```

其他机器请通过 SSH 克隆个人 fork，切到经过审查的完整提交哈希或加固标签，核对制品后单独添加本地目录。`lib/` 在发布前构建并随仓库保存，安装无需执行构建脚本。包设为 `private: true`，不会发布到上游 npm 命名空间。

## 配置与数据保留

默认空白名单拒绝所有工具。普通工具白名单仍属于高级、显式放权，需另行审计；不要加入消息投递、子代理或通用执行器来绕过隔离。`send_message` 无条件拒绝。volatile 白名单调整可能影响正在运行的旁问，不应在任务执行期间放宽；自定义提示词不是权限边界。

每次旁问独立，只继承已完成的父回合，不包含正在生成的回答。气泡状态在内存，但 DSH 的持久化可能保存子会话及继承上下文；关闭或刷新气泡不代表日志安全删除。仅支持文字问题，不接收附件。

## 开发与更新

```sh
npm ci --ignore-scripts --registry=https://registry.npmjs.org/
npm run check
npm pack --ignore-scripts
```

使用已提交的锁文件。fork 的 release workflow 只校验，不执行 npm 发布。每次上游更新都需重新审查加固差异、测试、构建并核对摘要，不能只改版本号。

原始代码和许可图标保留 [Apache-2.0](<LICENSE>) 与 MichengAI 版权；上游 Git 历史与更新日志保留，加固差异见[更新日志](<CHANGELOG.zh-CN.md>)。

# DOM 集成与版本适配

## 安装链路

`production-entry.ts` / `probe-entry.ts` 最终都调用 `install-renderer-binding.ts#installRendererBinding`，调用顺序固定：

1. `window.__codexhostRendererBindingProbeV1?.dispose()`：注入可能重复发生（Controller 重注入、页面重载），所以安装前必须先释放旧实例。设置页 `settings/shell.ts` 对 `__codexhostSettingsShellV1` 也是同样处理。
2. `installRendererBindingProbe`：扫描 Composer，挂载 Agent/Model/权限/用量控件，并把自己发布到 `__codexhostRendererBindingProbeV1`。
3. `installCurrentRendererAdapter`（`versioned-renderer-adapter.ts`）：接管 Desktop 的请求链路，再通过 `binding.setAdapter(...)` 回填给探针。抛出的异常在这里被捕获，状态降级为 `{ state: "unsupported", reason: "installation-failed" }`。**安装失败时不能让官方 Codex 路径跟着失效。**

Adapter 状态只允许取 `RendererAdapterStatus` 里的值：`installing | ready | unsupported`，外加有限的几个 `reason`。状态统一经 `transitionRendererAdapterStatus` 变更，状态不变时不会重复发布事件，变更通过 `codexhost:renderer-adapter-status` 事件广播。

## 与 desktop-control 共享的 window 全局与事件

| 名称 | 写入方 | 读取方 |
|---|---|---|
| `__codexhostProductionConfigV1` | `desktop-control/production-controller.ts` | `production-entry.ts`（读取后立即 `delete`） |
| `__codexhostHostRoutingV1`、`__codexhostDraftPrewarmPolicyV1` | `desktop-control/renderer-host-routing.ts` | `versioned-renderer-adapter.ts`（最多轮询 10s 等待 policy）、`renderer-host-clients.ts` |
| `__codexhostDraftWorkspacesV1` + `codexhost:draft-workspace` 事件 | `desktop-control/renderer-draft-prewarm-runtime.ts` | `renderer-binding-probe.ts` |
| `__codexhostMainProcessTitlePolicyV1` | `desktop-control/main-process-title-policy.ts` | `contract-audit.ts` |
| `__codexhostRendererBindingProbeV1` | 本包 | Controller 通过 CDP 读取 `status()` / `lockedSelection()` |
| `__codexhostContractAuditV1` | `audit-entry.ts` | `desktop-control/contract-audit.ts` |

- 全局名一律带 `V1` 后缀，并在各自模块里用 `declare global { interface Window { … } }` 声明。改动结构时新增版本号，不要原地修改语义。
- `RendererBindingProbeStatus`（`version: 2`）由 `desktop-control/src/renderer-control-session.ts#validateBindingStatus` 手工校验，包括 `enabledAgents` 必须与 Controller 期望的列表完全一致。两边没有共享类型，改一边必须同步另一边。
- 自定义事件统一使用 `codexhost:` 前缀并挂在 `window` 上，`dispose` 时必须 `removeEventListener`（参见 `versioned-renderer-adapter.ts` 末尾的 dispose）。

## 定位原生 DOM

- 原生节点靠 Codex 的语义属性定位：`[data-codex-composer-root]`（`renderer-composer-dom.ts#CODEX_COMPOSER_SELECTOR`）、`[data-local-conversation-item-target-ids]`（`renderer-transcript-dom.ts`）、`header[data-pip-obstacle="app-shell-header"]`（`settings/trigger.ts`）、`[contenteditable="true"][role="textbox"]`。
- **不要借用 Codex 生成的 class 名。** `renderer-trigger-chip-style.ts` 的头注释记录过一次事故：Composer 按钮原本复用 Desktop 的私有 class，Desktop 升级后这些 class 被改名，所有样式随之静默消失。
- 本包创建的节点一律打上 `data-codexhost-*` 标记（如 `data-codexhost-model-control`、`data-codexhost-agent-control`），`renderer-composer-dom.ts` 依靠这些标记把自有控件排除出原生候选集。新控件也要加标记，并补进排除列表。
- 外部 Harness 的 Composer 尾部顺序固定为 `[Model 药丸][思考药丸][Agent 选择器][原生尾部按钮]`，由 `renderer-composer-dom.ts#refreshTrailingClusterPlacement` 维护：`modelPicker.root` → `thinkingPicker.root` → Agent root，都插在 `trailingActionAnchor(sendButton)` 之前。测试里的 `ComposerAgentControl` 伪对象要同时提供 `thinkingPicker.root`，否则 placement 会直接返回。
- Model 与思考选项是两个独立控件：`mountRendererModelPicker(composerId, onSelectModel)` 只负责药丸加模型列表（搜索、收藏）；`mountRendererThinkingOptionPicker(composerId, onSelectThinking)` 负责思考药丸（`data-codexhost-thinking-control`）和挂到 `document.body` 的卡片（`data-codexhost-thinking-card`，`role="dialog"`，内含 `role="slider"`）。两者都用同一个 `RendererModelControlView` 渲染，判定函数（`isRendererModelPickerDisabled`、`isRendererModelPickerTransient`、`shouldCloseRendererModelPicker`、`thinkingOptionsForModel`）只在 `renderer-model-picker.ts` 维护一份。
- 读取 React 内部状态时，从 DOM 节点上找 `__reactFiber$*` 属性，向上遍历时使用 `desktop-control/renderer-bindings#committedReactAncestors`，并且必须设深度上限（`versioned-renderer-adapter.ts#findComposerFiber` 限 12 层，fiber 链限 120 层）。读取到的形状都按 `unknown` 处理，逐字段收窄（`isRecord`、`isLegacySevenSlotDraftWrapper`）。
- 包装 Desktop 的 RequestManager 时，**不要在实例上赋值函数**。Manager 同时是 `RpcTarget`，跨组件 RPC 会拒绝访问实例自有属性。正确做法是在该实例专属的原型层上覆盖方法，卸载时移除这一层（见 `renderer-external-steering.ts` 的注释与 `docs/architecture/external-thread-steering.md`）。`renderer-external-queue.ts` 包装的是普通队列对象，不是 RpcTarget，两者不要互相照抄。

## 契约审计

每个依赖原生 DOM 的模块都导出一个 `inspect…Contract(document)`，例如 `inspectRendererComposerContract`、`inspectRendererSidebarContract`、`inspectRendererForkContract`、`inspectRendererSettingsContract`、`inspectComposerCodexUsageGate`。它们只统计数量，不读取正文。`contract-audit.ts#inspectRendererContracts` 把这些结果汇总成 `RendererContractAuditInspection`（`schemaVersion: 1`），维护者用 `npm run audit:codex-desktop`（`tools/codex-desktop-contract-audit/`）在真实 Desktop 上对比基线。

- 新增原生 DOM 依赖时，要同时写 inspector、接入 `contract-audit.ts`，并同步 `desktop-control/src/contract-audit.ts` 里手写的同构接口。
- 已知瑕疵：`contract-audit.ts` 中 `adapterReason: status?.adapter.state` 读的是 state 而不是 reason。修改这里需要同时评估已审阅的审计基线。

## 新增 Agent 与 Transport Model carrier

Renderer 还不是插件目录驱动的：`KNOWN_RENDERER_AGENTS` 推导出 `RendererAgent` 联合类型，各模块里仍有很多 `agent === "…"` 分支（`src/*.ts` 中约 57 处）。以 Kimi 接入提交 `dc969eb2` 为参照，新增 Agent 要改这些位置：`agent-selection-state.ts`（列表以及按 Agent 区分的 `xxxModel` / `xxxThinkingOptionId` 字段）、`renderer-binding-probe.ts`、`versioned-renderer-adapter.ts#transportModelIdForAgent`、`renderer-agent-icon.ts` 和 `assets/`、`renderer-agent-picker.ts`（安装链接）、`renderer-sidebar-agent-icons.ts`、`settings/connections-page.ts` / `harness-installation-guides.ts`，以及 desktop-control 的 `production-controller.ts`。后续提交 `84e21fbc` 修的就是 Controller 与 Renderer 的 Agent 名单不一致。完整清单见 `.agents/skills/codexhost-add-harness/references/renderer-product-integration.md`。

- Pi、Claude Code、DeepSeek Harness、OpenCode、Grok、OMP、Antigravity 使用历史上的七套私有前缀（`codexhost/<x>-native@`）。这些只保留兼容读取，**不能**当作新 Agent 的模板，也不要趁机删除。
- Kiro CLI、CodeBuddy、WorkBuddy、Cursor CLI、Hermes、Qoder、Qoder CN、Kimi Code 使用 `shared-contracts` 的 `encodeHarnessPluginRoute` / `decodeHarnessPluginRoute`（前缀 `codexhost/plugin-v1@`）。新 Agent 只用这一种。

## 本地持久化与日志

- `localStorage` 键统一命名为 `codexhost.<topic>.v1`（`renderer-model-favorites.ts`、`renderer-new-thread-preference.ts`、`renderer-idle-release-preference.ts`、`agent-group-preference.ts`）。访问时要包 `try/catch` 并返回 `null`（`rendererStorage()`）。读取结果用 schema 或 `isRecord` 校验，遇到未知值不能回退成 `codex`。
- 日志只在失败点用 `console.error("codexhost …", error instanceof Error ? error.name : "UnknownError")`。只打印错误名，不打印用户内容或完整 payload（`install-renderer-binding.ts`、`versioned-renderer-adapter.ts` 的 Fork 错误）。

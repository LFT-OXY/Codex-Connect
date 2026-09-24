# adapter-qoder-cn

> 通用约定见 `.atw/spec/adapters/node/index.md`；Qoder 的全部实现细节见 `.atw/spec/adapter-qoder/node/index.md`。

## 职责与边界

`@codexhost/adapter-qoder-cn` 是 Qoder 中国版的**独立插件外壳**。它只提供自己的插件身份，所有 Adapter/Session 逻辑都来自 `@codexhost/adapter-qoder`：

- `manifest.json`：`id: "qoder-cn"`、`name: "Qoder CN"`、`icon: ./assets/icon.svg`、安装链接 `https://docs.qoder.cn/`。
- `src/plugin.ts`（唯一的源文件，约 10 行）：

```ts
export function createHarnessAdapter(context: HarnessPluginContext): QoderAdapter {
  return new QoderAdapter({
    variant: "cn",
    environment: { ...context.environment },
    platform: context.platform as NodeJS.Platform,
  });
}
```

- `package.json` 只导出 `./plugin`，没有 `src/index.ts`，也没有 `test/`；依赖只有 `@codexhost/adapter-qoder` 和 `@codexhost/harness-adapter`；`tsconfig.json` 引用 `../qoder` 和 `../../harness-adapter`。
- 预装：`scripts/release/harness-plugins.json#plugins` 中与 `packages/adapters/qoder` 并列。打包时 `@qodercn-ai/qodercn-agent-sdk` 通过 `adapter-qoder` 进入 Bundle。

## 规则

- 不要在本包里添加任何 Harness 逻辑。cn 版的差异（SDK、CLI 名、`CODEXHOST_QODERCN_COMMAND`、`QODERCN_PERSONAL_ACCESS_TOKEN`、`~/.qoder-cn`）统一放在 `packages/adapters/qoder/src/qoder-runtime.ts` 和 `qoder-command.ts` 中，由 `variant: "cn"` 选择。
- 工厂不单独读取命令覆盖变量：`QoderAdapter` 的构造函数会从 `environment[QODER_RUNTIMES.cn.commandEnvironmentVariable]` 读取 `CODEXHOST_QODERCN_COMMAND`。海外版的 `qoder/src/plugin.ts` 则显式传入 `commandOverride`，两种写法效果相同，不需要统一。
- 本包没有自己的测试。cn 变体的行为在 `packages/adapters/qoder/test/qoder-variants.test.ts` 中覆盖（SDK/PAT 隔离、身份、跨变体拒绝、发现）。

## 改动前检查清单

1. 改 Qoder 行为时，去 `packages/adapters/qoder` 修改，并在 `qoder-variants.test.ts` 中为 `cn` 变体补充用例。
2. `QoderAdapterOptions` 新增必填参数时，同步修改本包的 `plugin.ts`。
3. 只改 Manifest（名称、链接、图标）时，按 `harnessPluginManifestSchema` 校验，并执行 `npm run build:typescript` 确认 `build:plugins` 能通过。
4. 定向验证：`npx vitest run --config tests/vitest.config.js packages/adapters/qoder/test/qoder-variants.test.ts`。

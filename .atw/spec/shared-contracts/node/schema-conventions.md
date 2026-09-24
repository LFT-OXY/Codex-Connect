# Schema 写法约定

通用基准（zod + `z.infer`、默认 strict）见 `guides/typescript-workspace.md`。这里只写本包内部实际使用的更具体做法。

## 对象：strict 是默认，JSON-RPC 信封是唯一例外

- 契约对象一律拒绝未知字段，两种写法并存：`z.strictObject({...})`（`errors.ts`、`native-refs.ts`、`updates.ts`、`idle-release.ts`）和 `z.object({...}).strict()`（`harness-models.ts`、`harness-plugins.ts`、`harness-route.ts`）。同一文件内保持一致即可。
- 空参数也要写成 strict 空对象：`harnessPluginListParamsSchema = z.object({}).strict()`、`updateEmptyParamsSchema = z.strictObject({})`。
- 例外：`json-rpc.ts` 的信封用 `.catchall(jsonValueSchema)` 允许额外字段，并用 `absentSchema = z.never().optional()` 声明"这类报文不得出现某字段"（如 request 不得有 `result`/`error`）。新增的是业务 payload 就不要模仿 catchall。

## 可选字段与 `rejectExplicitUndefined`

`json-value.ts` 的 `rejectExplicitUndefined(keys)` 把显式 `undefined` 当作非法 JSON 拒绝。它目前只用在会被持久化或跨进程原样转发的外层结构上：

```ts
export const codexhostErrorSchema = z
  .strictObject({ code: z.string().min(1), /* ... */ stage: z.string().min(1).optional() })
  .superRefine(rejectExplicitUndefined(["diagnostic", "stage", "durationMs", "stderrTail"]));
```

- 使用者：`errors.ts`、`native-refs.ts`（`locator`）、`json-rpc.ts`（全部五个信封）。`harness-models.ts`、`updates.ts`、`harness-plugins.ts` 等大部分业务 schema 的 `.optional()` 字段**没有**加。给新的持久化/转发型结构加可选字段时要加；其余 schema 保持现状，不要为了统一去批量补。
- 加了 `rejectExplicitUndefined` 的 schema，`z.infer` 得到的 `field?: T | undefined` 与 `exactOptionalPropertyTypes` 冲突，所以这些文件手写导出类型：先 `Omit<z.infer<...>, "locator">` 再补 `locator?: JsonValue`，并把 schema 断言成 `z.ZodType<NativeSessionRefV1>`（见 `native-refs.ts`、`errors.ts`）。改字段时 schema、`Omit` 列表、`rejectExplicitUndefined` 列表三处要同步。

## ID、Ref 与品牌类型

- Host 侧不透明 ID 在 `ids.ts`：`harnessIdSchema`、`hostThreadIdSchema`、`hostTurnIdSchema`、`hostItemIdSchema`、`hostInteractionIdSchema`，都是"非空白字符串 + `.brand<"...">()`"，**不规范化、不假设编码**（`ids.test.ts`："preserves opaque identifiers without assuming an encoding"，原值 `"  Mixed Case/id:value  "` 原样保留）。
- `ids.test.ts` 用 `// @ts-expect-error` 断言品牌之间不能互相赋值。新增品牌 ID 时照此补一条类型层断言。
- 需要走 URL/路由的 ID 另加字符集约束并品牌化：`harnessModelRefIdSchema`、`harnessThinkingOptionIdSchema`、`harnessPermissionModeIdSchema` 都是 `/^[A-Za-z0-9._~-]+$/u` + 长度上限 + `.brand`。
- 插件身份 `harnessPluginIdSchema` 更严格（小写、`[._-]` 分段、禁止 `"codex"`），并 `.pipe(harnessIdSchema)` 得到 `HarnessId` 品牌。不要把 Native Session ID 当插件 ID 校验。
- Native 引用（`native-refs.ts`）都带 `formatVersion: z.literal(1)`，`locator` 是任意 `jsonValueSchema`，由拥有它的 Adapter 解释。改格式时新增 V2 schema，别就地改 V1；`nativeSessionRefSchema = nativeSessionRefV1Schema` 这层别名就是为此预留的。

## 上限、常量与 RPC method

- 所有字符串和数组都要有显式上限，并把上限导出成 `SCREAMING_CASE` 常量，供 Host 和 Renderer 复用：`HARNESS_MODEL_REF_MAX_LENGTH`、`THREAD_OWNERSHIP_LIST_MAX_LENGTH`、`HARNESS_PLUGIN_LIMIT`、`UPDATE_ERROR_MAX_LENGTH`。
- RPC method 名以 `codexhost/` 开头，作为 `*_METHOD` 常量和 schema 放在同一个文件：`IDLE_RELEASE_SETTINGS_METHOD`、`LOADED_SESSIONS_METHOD`、`HARNESS_LAUNCH_SETTINGS_GET_METHOD`、`CREDENTIAL_IMPORTS_METHOD`。
- 跨字段不变量写在 `superRefine` 里，并带精确的 `path`，例如：catalog 中 ref 唯一、默认值必须存在于 catalog（`harnessModelCatalogSchema`）；`selectPermissionMode` 必须和 `permissionModes` 是否存在一致（`readyHarnessInspectionSchema`）；`forkAcrossCwd` 需要 `fork`（`harnessHistoryCapabilitiesSchema`）。
- 有多种形态的结果用 `z.discriminatedUnion`（`threadInspectionSchema` 按 `owner`，`credentialImportsRequestSchema` 按 `action`）。只有判别字段不唯一时才退回 `z.union`（`harnessInspectionSchema`）。

## 注释写信任边界

schema 注释只写不变量和信任边界，这是现有惯例：

- `harness-plugins.ts`："A manifest is data only. It must be validated before importing any plugin code."、"Entries are explicit trust grants. Discovery alone never enables a plugin."、"Images are presentation data; consumers must use an img, never inline markup."
- `credential-imports.ts`："Display-only metadata. Credentials never cross the Renderer bridge."
- `harness-route.ts`：`decodeHarnessPluginRoute` 返回 `null` 表示"属于其他协议"，格式错误则抛错；解码后会重新编码，比对不一致就按非规范输入拒绝（测试 "rejects reordered, extra, or noncanonical JSON instead of passing it to Codex"）。

## 坑

- 非空白文本的小 schema（`nonBlankTextSchema`）在 `harness-models.ts`、`harness-permission-modes.ts`、`harness-session-import.ts`、`deepseek-modern-sessions.ts`、`codex-accounts.ts` 各有一份私有副本，而且语义并不相同：`codex-accounts.ts` 用 `.trim().min(1)` 会修剪原值，其余用 `refine` 保留原值；`harness-session-import.ts` 和 `deepseek-modern-sessions.ts` 的版本还额外拒绝 NUL。复制时先确认需要哪一种，别以为它们等价。
- `harnessSessionCapabilitiesSchema.configuration.permissionModeScope` 带 `.default("live")`，所以 parse 后的输出类型和输入类型不同。判断"创建时固定"要用 `permissionModeFixedAtCreate()`，不要自己比较字符串。
- `jsonValueSchema` 会先用 `nonCircularSchema` 检查循环引用，再做递归校验。不要直接用 `z.lazy` 自己写 JSON schema，否则遇到循环对象会栈溢出而不是返回校验失败（`json-value.test.ts`："returns validation failures for circular objects and arrays"）。
- 测试数据只用合成值（`"pi-model-v1.synthetic"`、`"SYNTHETIC"`），`errors.test.ts` 专门要求 "uses only synthetic, bounded diagnostics"。

# harness-discovery（node）

`@codexhost/harness-discovery` 解决一个问题：Harness 明明已安装，但 GUI 启动的 codexhost 拿到的 `PATH` 和交互式 Shell 不同，因此找不到可执行文件。它提供三类纯机制：可执行文件解析（`resolveHarnessExecutable` / `harnessCandidates`）、Windows 子进程调用封装（`commandInvocation`）、Node Runtime 的 PATH 补全（`withNodeRuntimeOnPath`）。它**不**发现 codexhost 或 Codex Desktop 本身（那部分属于 Rust Launcher），也不启动进程。

## 依赖与使用方

- `package.json#dependencies` 为空，`tsconfig.json#references` 为空，只用 `node:fs`、`node:path`、`node:os`。保持零依赖，不要引入 `@codexhost/*`。
- 使用方：除 `deepseek-harness` 和 `qoder-cn` 外的 13 个 `packages/adapters/*` 在 `package.json` 里声明了依赖。qoder-cn 复用 qoder 的实现，DeepSeek 的 `dsh`/`npx` 发现仍然留在 Adapter 内部。
- 每个 Adapter 在自己的 `command.ts` 里声明 `HarnessDiscoverySpec`，例如 `adapters/claude-code/src/command.ts` 的 `claudeCodeDiscoverySpec`、`adapters/pi/src/command.ts` 的 `piDiscoverySpec`。**Harness 专属的安装目录和改写规则只能写在 spec 里**，本包只放通用机制（文件头注释："Discovery mechanics — PATH parsing, Windows extensions, version-manager layouts — are shared and live in this package."）。

## 解析语义（以 `src/resolve.ts` 为准）

1. 配置命令 = `input.command`，没有则取 `spec.commandEnvironmentVariable` 指定的环境变量，都没有就用 `spec.command`。
2. 命令里含 `/`、`\` 或是绝对路径时，只检查这一个候选（`source: "configured"`）。
3. 否则按 `PATH` 目录 × Windows `PATHEXT` 扩展名生成候选（`source: "path"`）。
4. **只有没有显式配置时**，才继续搜索 `spec.installRoots`（`source: "install-root"`）。代码注释："A configured command names one specific installation; do not silently fall back to a different one somewhere else on the machine."（测试 "does not fall back to install roots for a configured command"）。
5. `VERSION_MANAGER_ROOTS`（`"<version-managers>"`）是 `installRoots` 中的一个哨兵，它**放在哪个位置就按哪个优先级搜索**，例如 Claude Code 把它放在 `/opt/homebrew/bin` 之前。
6. 每个候选先经过 `spec.runnableCandidate` 改写或拒绝（例如 Windows 上把 `claude.cmd` 改写成包内的 `claude.exe`），再检查是否可执行。

> 文档差异：`docs/architecture/harness-executable-discovery.md` 把顺序写成"安装目录 → 版本管理器目录"的固定五步，实际上版本管理器目录的位置由每个 spec 决定；文档的"当前接入情况"表只列了 5 个 Harness，现在已有 13 个 Adapter 使用本包。以代码为准。

## 跨平台约定

- 所有函数都接受 `platform` 参数，路径语义用 `targetPath(platform)` 选择 `path.win32` 或 `path.posix`，**不要**直接用 `path.join`，否则在 macOS 上测试 Windows 分支会得到错误结果。
- 读环境变量一律用 `environmentValue(env, name)`，因为 Windows 环境变量名不区分大小写。`withNodeRuntimeOnPath` 保留原有的 `Path`/`PATH` 键名。
- 版本目录用 `newestFirst`（数字感知的倒序）排序，同一个 Harness 装在多个 Node 版本下时，结果可预测。
- `withNodeRuntimeOnPath` 只在 PATH 里**追加** Host 的 Node 目录，不替换用户已经选中的 Node（注释："preserve an existing Node.js selection so package-manager shims continue to use the Node.js installation they belong to"）。
- `commandInvocation` 只对 Windows 的 `.cmd`/`.bat` 包一层 `cmd.exe /d /v:off /s /c`，用 `windowsVerbatimArguments` 并对 `%` 和 `"` 手工转义；其他情况直接执行。不要改用 `shell: true`。

## 改动前检查清单

1. 判断改动属于通用机制还是某个 Harness 专属。专属的放进对应 Adapter 的 spec 或 `runnableCandidate`。
2. 新增版本管理器布局时，改 `version-managers.ts` 并同时覆盖 POSIX 和 Windows 分支；具体版本目录要排在 shim 目录之前（注释：shim 需要所属管理器的环境才能工作）。
3. 保持所有 IO 都可注入：`HarnessDiscoveryDependencies.isExecutable` / `subdirectories`、`input.homeDirectory`、`input.platform`，以便测试不接触真实文件系统。
4. 发现成功不等于运行时兼容，本包不做版本探测和进程启动，这些留给 Adapter。
5. 定向测试：`npx vitest run --config tests/vitest.config.js packages/harness-discovery/test/resolve.test.ts`。它用注入的 `platform` 在任意系统上验证 Windows 与 POSIX 两套行为。改动公共函数签名后，还要执行 `npm run typecheck` 检查所有 Adapter。

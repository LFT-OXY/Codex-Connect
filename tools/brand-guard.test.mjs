import { globSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

// 品牌守卫：合并上游后，面向用户的文本不得回退到上游仓库地址或 codexhost 产品名。
// 出现误报时由维护者判断是改文案还是扩白名单；白名单每条都要写明理由和生效文件。

const root = path.resolve(import.meta.dirname, "..");
const hostRuntime = "packages/host-runtime/src";

const SCANNED_FILES = [
  // 本地化文案、设置页、Harness 安装引导
  "packages/renderer-extension/src/settings/*.ts",
  // 给 Agent 的委派命令文案与远程 Host CLI
  `${hostRuntime}/delegation-skill.ts`,
  `${hostRuntime}/delegation-cli-help.ts`,
  `${hostRuntime}/delegation-cli.ts`,
  `${hostRuntime}/delegation-mention-rewrite.ts`,
  `${hostRuntime}/app-server-host.ts`,
  `${hostRuntime}/harness-delegation-coordinator.ts`,
  `${hostRuntime}/remote-host-cli.ts`,
  `${hostRuntime}/remote-host-lifecycle.ts`,
  // 发布脚本
  "scripts/release/**/*.mjs",
  "scripts/release/macos/package.sh",
  "scripts/release/windows/Installer.iss",
  "scripts/release/windows/package.ps1",
  // Harness Adapter：权限模式说明、连接诊断、问答与委派提示会展示给用户或 Agent
  "packages/adapters/*/src/**/*.ts",
  // 应用内更新：失败原因会写入更新状态并显示在设置页
  "packages/update-manager/src/*.ts",
  // Rust 平台层、启动器与更新器（只扫字符串字面量，跳过测试代码）
  "crates/platform/src/*.rs",
  "crates/launcher/src/*.rs",
  "crates/updater/src/*.rs",
  // README
  "README.md",
  "docs/project/README.zh-CN.md",
];

// *_tests.rs 是以 #[cfg(test)] mod 引入的测试文件，其中只有 fixture
const isTestSource = (file) => file.endsWith("_tests.rs");

// 产品名的各种写法：codexhost、CodexHost、Codex Host
const PRODUCT_NAME = /codex ?host/gi;

// 上游仓库地址只允许以署名形式出现在 README 致谢，中英文各恰好一处。
const UPSTREAM_REPOSITORY = /BytePioneer-AI\/codex-?host/gi;
const readmeAcknowledgement = /\[codex-host\]\(https:\/\/github\.com\/BytePioneer-AI\/codex-host\)/;
const UPSTREAM_ATTRIBUTIONS = {
  "README.md": readmeAcknowledgement,
  "docs/project/README.zh-CN.md": readmeAcknowledgement,
};

const only = (...files) =>
  new RegExp(`^(${files.map((file) => file.replaceAll(".", "\\.")).join("|")})$`);
const readmeFiles = only("README.md", "docs/project/README.zh-CN.md");
const rustSources = /^crates\//;
const releaseScripts = /^scripts\/release\//;
const adapterSources = /^packages\/adapters\//;

// 每条规则把允许的内部标识从文本中抹去；抹去后仍剩下的产品名即为违规。
// 没有 files 的规则只匹配不可能是产品名文案的机器标识形状；其余规则限定在实际出现的文件。
const ALLOWED_INTERNAL_NAMES = [
  {
    reason: "术语表登记的例外：README 迁移说明写出上游旧版本的名称、旧包名与旧应用名",
    files: readmeFiles,
    pattern: /<details>\s*<summary>[^<]*codexhost[^<]*<\/summary>[\s\S]*?<\/details>/g,
    allowInside:
      /@codexhost\/cli\b|\/codexhost\.app\b|(?<=<summary>[^<]*)codexhost|(?<=(?:replaces|用于替代) )codexhost/g,
  },
  { reason: "环境变量 CODEXHOST_*", pattern: /CODEXHOST_[A-Z0-9_]*/g },
  {
    reason: "@codexhost/* workspace 包（上游 npm 包 @codexhost/cli* 不在此列）",
    pattern: /@codexhost\/(?!cli\b)[a-z][\w/-]*/g,
  },
  { reason: "数据目录 ~/.codexhost", pattern: /(?<!\w)\.codexhost(?![\w.-])/g },
  { reason: "LaunchAgent 标签", pattern: /ai\.bytepioneer\.codexhost\./g },
  { reason: "macOS bundle id", pattern: /com\.codexhost\.app/g },
  {
    reason: "设置页 CSS 类名、DOM id 与 data 属性",
    pattern: /(?<![\w-])(?:data-)?codexhost-settings-[\w-]*/g,
  },
  { reason: "内部 CLI 参数", pattern: /(?<=--)codexhost-[a-z][\w-]*/g },
  {
    reason:
      "内部二进制与 crate：启动器、Shim、更新器、开始菜单入口、node-repl、平台层（不在用户 PATH 中）",
    pattern: /codexhost-(?:launcher|shim|updater|start|node-repl|platform)\b/g,
  },
  { reason: "内部 Skill 名", pattern: /codexhost-(?:delegation|add-harness)\b/g },
  {
    reason: "内部资源与清单文件名：图标、发行元数据、README 截图",
    pattern: /codexhost-(?:app-icon|icon|distribution|native-overview|full-workspace)\b/g,
  },
  {
    reason: "发布脚本的临时目录前缀",
    files: releaseScripts,
    pattern: /codexhost-(?:icons|npm-smoke|dmg-stage|dmg-assets)\b/g,
  },
  {
    reason: "Rust 层的临时目录前缀，以及更新器挂载 DMG 时的临时目录和暂存、备份 app 名",
    files: rustSources,
    pattern:
      /codexhost-(?:appx-node-env|tool-override|direct-desktop|desktop-launch-args|update-mount|update|backup)\b/g,
  },
  {
    reason: "启动器图标资源名与 Windows 原生启动器 codexhost.exe（内部二进制）",
    files: /^(scripts\/release\/|crates\/launcher\/)/,
    pattern: /codexhost(?=\.(?:png|ico|icns|iconset|exe)\b)/g,
  },
  {
    reason: "原生启动器二进制 bin/codexhost 及带可执行后缀的拼接（内部二进制，不在用户 PATH 中）",
    files: /^(scripts\/release\/|crates\/launcher\/)/,
    pattern: /(?<=(?:bin|MacOS)\/)codexhost(?![\w.-])|codexhost(?=\$\{\w*\}|\{\})/g,
  },
  {
    reason: "Info.plist 的 CFBundleExecutable 指向原生启动器二进制",
    files: only("scripts/release/macos/package.sh"),
    pattern: /(?<=<key>CFBundleExecutable<\/key>\s*<string>)codexhost(?=<\/string>)/g,
  },
  {
    reason: "覆盖升级时删除上游留下的开始菜单快捷方式",
    files: only("scripts/release/windows/Installer.iss"),
    pattern: /(?<=\\)codexhost(?=\.lnk\b)/g,
  },
  {
    reason: "DOM id 前缀",
    files: only("packages/renderer-extension/src/settings/preference-ui.ts"),
    pattern: /^codexhost-(?=\$\{\})/g,
  },
  {
    reason: "codexhost/* 协议方法与 codexhost:* 内部 id 前缀",
    files: only(`${hostRuntime}/app-server-host.ts`, `${hostRuntime}/remote-host-lifecycle.ts`),
    pattern: /(?<!@)codexhost(?=[/:][a-z])/g,
  },
  {
    reason:
      "机器标识：每用户运行时目录名、Linux 存储目录名、SCDynamicStore 客户端名、更新暂存目录名、" +
      "发给 Codex Desktop 的 modelProvider id、远程 Host 协议标签",
    files: only(
      "crates/launcher/src/runtime_instance.rs",
      "crates/launcher/src/secure_storage.rs",
      "crates/platform/src/system_proxy.rs",
      "packages/update-manager/src/distribution.ts",
      `${hostRuntime}/app-server-host.ts`,
      `${hostRuntime}/remote-host-lifecycle.ts`,
    ),
    pattern: /^codexhost$/g,
  },
  {
    reason: "stderr/控制台诊断前缀（PRD 命名规则：诊断输出保留 codexhost）",
    files:
      /^(crates\/|scripts\/release\/|packages\/host-runtime\/src\/(app-server-host|remote-host-cli)\.ts$)/,
    pattern:
      /(?<=^|")codexhost(?: (?:launcher|updater|remote|release|release prepare|npm release|npm meta release|npm publish|Host Runtime))?(?=: )/g,
  },
  {
    reason: "启动追踪标签",
    files: only("scripts/release/prepare-npm.mjs", "crates/launcher/src/main.rs"),
    pattern: /(?<=\[)codexhost(?= startup \+)/g,
  },
  {
    reason: "给 Agent 的委派提示标签，不是命令调用",
    files: only(`${hostRuntime}/delegation-mention-rewrite.ts`),
    pattern: /(?<=\[)codexhost(?= delegation\])/g,
  },
  {
    reason:
      "描述内部组件的诊断错误正文（PRD 命名规则：按诊断输出保留）；" +
      "更新器请求校验失败时尚未写入更新状态，只进 stderr",
    files:
      /^(crates\/launcher\/|crates\/updater\/src\/request\.rs$|packages\/renderer-extension\/src\/settings\/(pages|shell|connections-page)\.ts$|packages\/host-runtime\/src\/remote-host-lifecycle\.ts$)/,
    pattern:
      /codexhost(?= (?:storage|state base|executable|Host chain|control endpoint|runtime descriptor|[Ll]auncher|Start Menu executable|settings shell|update request failed|connection diagnostics)\b)|(?<=not owned by )codexhost/g,
  },
  {
    reason:
      "Adapter 的机器标识：ACP clientInfo 名、OpenCode 服务端认证用户名、Claude Code 配置目录下的暂存目录名",
    files: adapterSources,
    pattern: /^codexhost$/g,
  },
  {
    reason: "Adapter 发给原生进程的 RPC 请求 id 前缀，以及临时文件名前缀",
    files: adapterSources,
    pattern: /^\.?codexhost-(?=\$\{\})/g,
  },
  {
    reason: "Adapter 的临时目录、日志、Hook 与记录文件名前缀，以及 Claude Code SDK 客户端标识",
    files: adapterSources,
    pattern:
      /codexhost-(?:antigravity|agy-question|question-bridge|cursor-fork|hermes-delegation|account|commands|claude-code-adapter|sdk)\b/g,
  },
  {
    reason:
      "Adapter 协议标识：Antigravity Hook 工具名、Hermes 进程内插件名、OpenCode 选择记录键、Pi 凭据归属字段",
    files: adapterSources,
    pattern: /codexhost(?=\.ask_question\b|-runtime\b|\.selection\.v1\b|ImportId\b)/g,
  },
  {
    reason: "URL 解析用的占位基址（保留域名 .invalid）",
    files: only("packages/renderer-extension/src/settings/release-notes.ts"),
    pattern: /codexhost(?=\.invalid\b)/g,
  },
];

function tsStringLiterals(file, source) {
  const scriptKind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind);
  const literals = [];
  const add = (node, text) =>
    literals.push({
      text,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    });
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      // 插值统一记为 ${}，以便规则识别 `codexhost${suffix}` 这类拼接
      add(
        node,
        node.head.text + node.templateSpans.map((span) => "${}" + span.literal.text).join(""),
      );
      for (const span of node.templateSpans) visit(span.expression);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

// #[cfg(test)] 与 #[cfg(all(test, ...))]；#[cfg(not(test))] 是生产代码，不匹配
const RUST_TEST_ATTRIBUTE = /^#\[cfg\((?:test|all\(test\b[^\]]*\))\)\]/;

function rustStringLiterals(source) {
  const literals = [];
  let line = 1;
  let depth = 0;
  // 测试属性之后的项（到分号或配对的右花括号为止）是测试代码，不扫描
  let testItemPending = false;
  let testItemDepth = null;
  const skipping = () => testItemPending || testItemDepth !== null;
  const advanceTo = (end, from) => {
    for (let index = from; index < end; index += 1) if (source[index] === "\n") line += 1;
    return end;
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    // 足以容纳 br###" 前缀和 '\u{10FFFF}' 这类最长的字符字面量
    const lookahead = source.slice(index, index + 16);
    const testAttribute =
      char === "#" && RUST_TEST_ATTRIBUTE.exec(source.slice(index, index + 200));
    if (testAttribute) {
      if (!skipping()) testItemPending = true;
      index += testAttribute[0].length;
    } else if (lookahead.startsWith("//")) {
      const end = source.indexOf("\n", index);
      index = end === -1 ? source.length : end;
    } else if (lookahead.startsWith("/*")) {
      let nesting = 0;
      let end = index;
      do {
        if (source.startsWith("/*", end)) {
          nesting += 1;
          end += 2;
        } else if (source.startsWith("*/", end)) {
          nesting -= 1;
          end += 2;
        } else end += 1;
      } while (nesting > 0 && end < source.length);
      index = advanceTo(end, index);
    } else if (/^b?r#*"/.test(lookahead) && !/\w/.test(source[index - 1] ?? "")) {
      const [prefix] = /^b?r#*"/.exec(lookahead);
      const terminator = '"' + prefix.slice(prefix.indexOf("r") + 1, -1);
      const start = index + prefix.length;
      const end = source.indexOf(terminator, start);
      if (!skipping()) literals.push({ text: source.slice(start, end), line });
      index = advanceTo(end + terminator.length, index);
    } else if (char === '"') {
      let end = index + 1;
      while (source[end] !== '"') end += source[end] === "\\" ? 2 : 1;
      if (!skipping()) literals.push({ text: source.slice(index + 1, end), line });
      index = advanceTo(end + 1, index);
    } else if (char === "'") {
      // 字符字面量整体跳过；生命周期参数（'a）不匹配，按普通字符前进
      const charLiteral = /^'(?:\\u\{[0-9a-fA-F]+\}|\\.|[^\\'\n])'/.exec(lookahead);
      index += charLiteral ? charLiteral[0].length : 1;
    } else {
      if (char === "{") {
        if (testItemPending) {
          testItemPending = false;
          testItemDepth = depth;
        }
        depth += 1;
      } else if (char === "}") {
        depth -= 1;
        if (testItemDepth === depth) testItemDepth = null;
      } else if (char === ";" && testItemPending) {
        testItemPending = false;
      } else if (char === "\n") {
        line += 1;
      }
      index += 1;
    }
  }
  return literals;
}

// 脚本与 Markdown 按整文件扫描；整行注释替换为等长空白以保持行号
function plainText(file, source) {
  const commentLine = file.endsWith(".iss") ? /^[ \t]*;.*$/gm : /^[ \t]*#(?!!).*$/gm;
  const text = /\.(sh|iss|ps1)$/.test(file)
    ? source.replace(commentLine, (comment) => " ".repeat(comment.length))
    : source;
  return [{ text, line: 1 }];
}

function stringLiterals(file, source) {
  if (/\.(ts|mjs)$/.test(file)) return tsStringLiterals(file, source);
  if (file.endsWith(".rs")) return rustStringLiterals(source);
  return plainText(file, source);
}

function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

function maskAllowedNames(file, text) {
  let masked = text;
  for (const rule of ALLOWED_INTERNAL_NAMES) {
    if (rule.files && !rule.files.test(file)) continue;
    masked = masked.replace(rule.pattern, (allowed) =>
      rule.allowInside ? allowed.replace(rule.allowInside, blank) : blank(allowed),
    );
  }
  return masked;
}

// 返回 { kind, file, line, content }，kind 为 productName、upstreamLink 或 upstreamAttribution
function scanSource(file, source) {
  const findings = [];
  const record = (kind, literal, match) => {
    const content = literal.text
      .slice(Math.max(0, match.index - 40), match.index + match[0].length + 40)
      .replace(/\s*\n\s*/g, " ⏎ ")
      .trim();
    const line = literal.line + (literal.text.slice(0, match.index).match(/\n/g)?.length ?? 0);
    findings.push({ kind, file, line, content });
  };
  for (const literal of stringLiterals(file, source)) {
    for (const match of literal.text.matchAll(UPSTREAM_REPOSITORY)) {
      const context = literal.text.slice(Math.max(0, match.index - 60), match.index + 60);
      const attribution = UPSTREAM_ATTRIBUTIONS[file]?.test(context) ?? false;
      record(attribution ? "upstreamAttribution" : "upstreamLink", literal, match);
    }
    if (!/codex ?host/i.test(literal.text)) continue;
    for (const match of maskAllowedNames(file, literal.text).matchAll(PRODUCT_NAME)) {
      record("productName", literal, match);
    }
  }
  return findings;
}

function scannedFiles() {
  return SCANNED_FILES.map((pattern) => ({
    pattern,
    files: globSync(pattern, { cwd: root })
      .map((file) => file.replaceAll("\\", "/"))
      .filter((file) => !isTestSource(file))
      .sort(),
  }));
}

let repositoryFindings;
function scanRepository() {
  repositoryFindings ??= scannedFiles().flatMap(({ files }) =>
    files.flatMap((file) => scanSource(file, readFileSync(path.join(root, file), "utf8"))),
  );
  return repositoryFindings;
}

const report = (findings, kind) =>
  findings
    .filter((finding) => finding.kind === kind)
    .map(({ file, line, content }) => `${file}:${line}: ${content}`);

describe("brand guard", () => {
  it("resolves every scanned path to at least one file", () => {
    const empty = scannedFiles()
      .filter(({ files }) => files.length === 0)
      .map(({ pattern }) => pattern);
    expect(empty).toEqual([]);
  });

  it("keeps the codexhost product name out of user-facing text", () => {
    expect(report(scanRepository(), "productName")).toEqual([]);
  });

  it("links the upstream repository only from the README acknowledgements", () => {
    const findings = scanRepository();
    expect(report(findings, "upstreamLink")).toEqual([]);
    const attributedFiles = findings
      .filter((finding) => finding.kind === "upstreamAttribution")
      .map((finding) => finding.file);
    expect(attributedFiles).toEqual(Object.keys(UPSTREAM_ATTRIBUTIONS));
  });

  it.each([
    [
      "packages/host-runtime/src/delegation-skill.ts",
      'const usage = "codexhost delegate start --harness pi";',
    ],
    ["packages/host-runtime/src/app-server-host.ts", "const hint = `codexhost thread read ${id}`;"],
    [
      "packages/renderer-extension/src/settings/localization.ts",
      'const title = "Restart CodexHost to apply";',
    ],
    [
      "packages/renderer-extension/src/settings/localization.ts",
      'const title = "Restart the codexhost launcher";',
    ],
    [
      "packages/renderer-extension/src/settings/localization.ts",
      'const title = "codexhost: update ready";',
    ],
    [
      "packages/renderer-extension/src/settings/localization.ts",
      "const title = `Restart codexhost${suffix}`;",
    ],
    [
      "packages/renderer-extension/src/settings/localization.ts",
      'const title = "Open codexhost/settings";',
    ],
    [
      "packages/renderer-extension/src/settings/harness-installation-guides.ts",
      'const hint = "Restart Codex Host";',
    ],
    ["scripts/release/prepare-npm.mjs", 'const install = "npm install -g @codexhost/cli@latest";'],
    [
      "scripts/release/prepare-npm.mjs",
      'const platformPackage = "@chinhae/codexhost-darwin-arm64";',
    ],
    ["scripts/release/prepare-payload.mjs", "const asset = `codexhost-${version}-${target}.dmg`;"],
    ["scripts/release/prepare-payload.mjs", 'const asset = "codexhost-macos-arm64.dmg";'],
    ["scripts/release/prepare-payload.mjs", 'const asset = "codexhost-setup.exe";'],
    ["crates/launcher/src/main.rs", 'fn usage() -> &\'static str { "usage: codexhost launch" }'],
    ["crates/launcher/src/main.rs", '#[cfg(not(test))]\nconst USAGE: &str = "usage: codexhost";'],
    ["README.md", "Run `codexhost` to start."],
    [
      "README.md",
      "<details>\n<summary>If you previously installed codexhost</summary>\n\nRun `codexhost` to start.\n</details>",
    ],
    ["scripts/release/windows/Installer.iss", "AppName=codexhost"],
    [
      "packages/adapters/antigravity/src/permission-modes.ts",
      'const description = "codexhost adds no tool approval.";',
    ],
    [
      "packages/adapters/codebuddy/src/command.ts",
      "const instructions = `This Session runs inside codexhost.\nUse ${cli}.`;",
    ],
  ])("rejects the product name in %s: %s", (file, source) => {
    const findings = scanSource(file, source).filter((finding) => finding.kind === "productName");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file, content: expect.stringMatching(/codex ?host/i) });
  });

  it.each([
    [
      "packages/host-runtime/src/app-server-host.ts",
      'const env = { CODEXHOST_DATA_DIR: dir, method: "codexhost/update/check" };',
    ],
    [
      "packages/renderer-extension/src/settings/shell.ts",
      'import type { X } from "@codexhost/shared-contracts"; const id = "codexhost-settings-dialog";',
    ],
    [
      "crates/platform/src/macos_native_harness_broker.rs",
      'const LABEL: &str = "ai.bytepioneer.codexhost.native-harness-broker";',
    ],
    ["crates/launcher/src/main.rs", 'eprintln!("codexhost launcher: {error}");'],
    [
      "crates/launcher/src/main.rs",
      '#[cfg(test)]\nmod tests {\n    const HOME: &str = "/Applications/codexhost.app";\n}',
    ],
    [
      "crates/platform/src/installation.rs",
      '#[cfg(all(test, target_os = "windows"))]\nfn fixture() -> &\'static str { "codexhost-windows-installation" }',
    ],
    [
      "scripts/release/prepare-payload.mjs",
      'const launcher = path.join(root, `codexhost${suffix}`, "libexec/codexhost-shim");',
    ],
    [
      "scripts/release/windows/Installer.iss",
      '; Upgrade from codexhost.\nType: files; Name: "{userprograms}\\codexhost.lnk"',
    ],
    [
      "README.md",
      "<details>\n<summary>If you previously installed codexhost</summary>\n\nCodex Connect replaces codexhost.\n- npm: `npm rm -g @codexhost/cli`\n- macOS: delete `/Applications/codexhost.app`\n</details>",
    ],
    [
      "packages/adapters/grok/src/acp-transport.ts",
      'const init = { clientInfo: { name: "codexhost", version: "0.1.6" } };',
    ],
    ["packages/adapters/pi/src/pi-rpc-session.ts", "const id = `codexhost-${randomUUID()}`;"],
  ])("allows internal identifiers in %s: %s", (file, source) => {
    expect(scanSource(file, source)).toEqual([]);
  });

  it("reports upstream repository links with file, line, and content", () => {
    expect(
      scanSource(
        "packages/renderer-extension/src/settings/connections-page.ts",
        '\nconst issues = "https://github.com/BytePioneer-AI/codex-host/issues";',
      ),
    ).toEqual([
      {
        kind: "upstreamLink",
        file: "packages/renderer-extension/src/settings/connections-page.ts",
        line: 2,
        content: "https://github.com/BytePioneer-AI/codex-host/issues",
      },
    ]);
  });
});

# TranslatorX

**写出来，才是你的。** 先用母语写，再凭记忆亲手写出外语。

[![CI](https://github.com/JasonkayZK/translatorx/actions/workflows/ci.yml/badge.svg)](https://github.com/JasonkayZK/translatorx/actions/workflows/ci.yml)

[English](README.md) | 简体中文

TranslatorX 是一款桌面应用，让你在写真正要发出去的内容时学外语：回一封邮件、发一条消息、写一条评论。先用母语起草，TranslatorX 把草稿拆成句子并翻译，再由你亲手把每一句写成外语——凭记忆默写、填空，或者照着跟打。每次作答都会逐词比对，像老师一样用红笔批改。练完就得到一段可以直接发出去的成品，收藏的单词和句子之后还会按间隔重复安排复习。

> 翻译让你看懂，亲手写出来才让你学会。

> [!NOTE]
> 默认语言对为中文 → 英语，两侧各有 18 种语言可选。界面跟随系统语言（中文 / 英文 / 日文），不支持时回退英文。

## 功能

### 写作默写

1. **起草**：用母语写，可以按整句或短句分段。
2. **翻译**：支持 Google、DeepL 和任意 OpenAI 兼容的大模型。使用大模型时由模型一次完成分句和翻译，并保持原文的语气（邮件、聊天、评论……）。
3. **亲手写出每一段**，三种方式任选：

   | 方式 | 你看到的 | 你要做的 |
   |---|---|---|
   | 默写 | 只有母语原句 | 凭记忆写出整句译文 |
   | 填空 | 挖掉部分单词的译文 | 补全空格（挖空比例 20%–100%） |
   | 跟打 | 完整译文 | 逐字打出来 |

4. **红笔批改**：答案与参考译文逐词对齐，每个词标为正确、拼写小错、错误、缺漏或多余。可以忽略大小写、标点和重音符号。提示会一点点揭示下一个词。
5. **完成**：得到甲 / 乙 / 丙 / 丁评分、练习数据和成品（参考译文或你自己写的版本），一键复制。没写好的段落可以重练，历史练习可以重新打开。

每段练完后，可以点击任意单词查词并加入生词本，收藏或朗读句子，也可以请 AI 老师点评你的写法。

### 快速翻译小窗与悬浮图标

在任何应用里打字时都能用，不必打开主界面。

- **打开**：按全局快捷键（默认 <kbd>⌘⇧Y</kbd>，再按一次关闭），从托盘菜单打开，或者在 macOS 和 Windows 上点击输入框右下角出现的朱红「译」字图标。小窗会出现在你正在输入的输入框旁边。
- **直接填入**：输入 → 翻译 → 修改译文 → 填入。
- **先练再填**：输入 → 翻译 → 逐句亲手写一遍 → 填入。这里的练习同样计入统计和连续天数。
- **填入**：把译文粘贴回原来的输入框，之后恢复你的剪贴板（macOS 与 Windows）。未授权 macOS 辅助功能，或者在 Linux 上，会改为复制到剪贴板。
- 小窗可以置顶，可以调节透明度和磨砂效果，可以把结果存进句子本，也可以转到主界面继续完整练习。

悬浮图标不会出现在密码框里，也可以通过右键菜单在指定应用中关闭。Spotlight、Raycast、Alfred、终端和 iTerm2 默认不显示。

关闭窗口只是隐藏：TranslatorX 会继续留在托盘（macOS 上是菜单栏）中，快捷键随时可用。要退出请使用托盘菜单。

### 阅读理解

粘贴一段外语文本，逐句对照译文阅读。点击单词查词，连同上下文一起收藏；也可以把句子转成反向默写（看母语译文，写出原句）。配置大模型后，**拆解** 会讲解句子的词汇和语法，还可以继续向 AI 老师提问。

### 生词句本与间隔复习

- 收藏的单词会保留出处句子，收藏的句子会保留译文。支持搜索、备注、默写句子，也可以导出 CSV 导入 Anki。
- 复习时单词和句子交替出现：根据释义和挖空的例句拼写单词，或根据母语原句默写整句。
- 每张卡片按 1–4（忘了 / 模糊 / 记得 / 很熟）评分，或按 <kbd>↵</kbd> 采用建议评分。排期采用 SM-2 风格：忘记的卡片 10 分钟内会再次出现，每记住一次，间隔就拉长一些。

### 学习概览

连续天数与每日目标、默写准确率、生词句本总量、近 8 周的收藏图表，以及近 16 周的每日学习热力图。

## 翻译与 AI

| 服务 | 需要配置 | 说明 |
|---|---|---|
| Google 翻译 | 无 | 免费。国内网络可能需要代理。 |
| DeepL | API Key | 也支持免费版 Key（以 `:fx` 结尾）。 |
| 大模型 | Base URL、模型、API Key | 任意 OpenAI 兼容接口。按语境意译，并由模型自己分句。 |

AI 批改、句子拆解和 AI 老师都需要配置大模型，与选哪个翻译服务无关。设置页内置 OpenAI、DeepSeek、通义千问、Kimi、OpenRouter 和本地 Ollama（无需 API Key）的预设，可以测试连接，也可以设置 HTTP 或 SOCKS5 代理。

朗读优先使用系统里对应语言的语音，没有时改用 Google 在线语音。

## 开始使用

### 环境要求

- [Node.js](https://nodejs.org/) 20.19+ 或 22.12+，以及 [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/)（stable）
- 对应系统的 [Tauri 2 依赖](https://v2.tauri.app/start/prerequisites/)（macOS 上为 Xcode Command Line Tools）

### 开发

```bash
pnpm install
pnpm tauri dev
```

启动后打开 **设置**，选择语言和翻译服务。

`pnpm dev` 只在浏览器里运行界面（http://localhost:1420）。后端由 `src/lib/mock.ts` 模拟，带示例数据和一个小型内置词句表，适合调试界面。

### 构建与测试

```bash
pnpm tauri build               # 开发构建；macOS 的正式/长期自用安装请使用下方签名流程
pnpm test                      # 前端单元测试（Vitest）
cd src-tauri && cargo test     # 后端单元测试
```

### CI 与发布

推送到 `main` 或提交 PR 时，GitHub Actions 会运行前端检查（`pnpm test`、`pnpm build`），并在 Ubuntu、macOS、Windows 三个平台运行 Rust 检查（`cargo clippy`、`cargo test`）。

推送 `v*` 标签（如 `v1.0.1`）会构建三平台安装包并发布到 [GitHub Releases](https://github.com/JasonkayZK/translatorx/releases)：macOS（`.dmg`，Apple Silicon 与 Intel）、Linux（`.deb`、`.rpm`、`.AppImage`）、Windows（`.msi`、`.exe`）。构建前会校验标签与应用版本（`src-tauri/tauri.conf.json`）一致。发版步骤与可选的 macOS 签名 Secrets 见 [GitHub Actions 说明](docs/github-actions.md)。

### macOS 辅助功能权限

悬浮图标和自动填入需要辅助功能权限。在 **设置 → 小窗与悬浮图标 → 打开系统设置** 中授权；返回应用会自动重新检测，也可手动点击“重新检测”。诊断信息显示当前程序路径、应用标识和签名类型。

macOS 权限与签名身份绑定。临时（ad-hoc）签名绑定程序哈希，重新编译后即使系统里旧条目仍勾选，新程序也可能不受信任。长期使用或分发请复用同一代码签名证书：

```bash
TRANSLATORX_SIGNING_IDENTITY='你的固定代码签名身份' pnpm build:macos
bash scripts/verify-macos-signature.sh src-tauri/target/release/bundle/macos/TranslatorX.app
```

证书设置、旧签名迁移及跨版本验证见 [macOS 签名说明](docs/macos-signing.md)。应用不会自动清空系统权限。从旧临时签名迁移到固定身份时，可能需要首次重新授权。

### 外观、界面语言与学习历史

- 主界面和浮动窗分别选择宣纸、透明玻璃、科技风格及浅色 / 深色 / 跟随系统；浮动窗还可跟随主界面，气泡跟随浮动窗。
- 界面支持中文、英文、日文，默认跟随系统，不支持的系统语言回退英文；设置中可手动切换。
- macOS 默认显示 Dock 图标。关闭“在 Dock 中显示图标”后，可继续从菜单栏打开应用，关闭窗口仍仅隐藏。
- 翻译、阅读、主动查词、完成练习和复习评分会记录到本地学习历史，无需收藏。概览提供日期筛选、趋势、热力图、类型/语言分布及可展开删除的历史。
- 练习准确率按词数加权，连续学习天数由实际活动计算。旧练习记录自动迁移；旧翻译行为无法追溯。保存失败时请先重试，当前结果会保留到成功保存。

## 快捷键

在 Windows 和 Linux 上用 <kbd>Ctrl</kbd> 代替 <kbd>⌘</kbd>。

| 位置 | 按键 | 作用 |
|---|---|---|
| 任何地方 | <kbd>⌘⇧Y</kbd> | 打开 / 关闭快速翻译小窗（可修改） |
| 主界面 | <kbd>⌘1</kbd> … <kbd>⌘6</kbd> | 切换页面 |
| 写作 / 阅读 | <kbd>⌘↵</kbd> | 开始默写 / 逐句对照 |
| 练习 | <kbd>↵</kbd> | 检查，完成后进入下一段 |
| 练习 | <kbd>⌘/</kbd> · <kbd>⌘J</kbd> · <kbd>⌘E</kbd> · <kbd>⌘S</kbd> | 提示 · 朗读 · 看答案 · 收藏句子 |
| 复习 | <kbd>1</kbd>–<kbd>4</kbd> · <kbd>↵</kbd> | 评分 · 采用建议评分 |
| 小窗 | <kbd>⌘↵</kbd> · <kbd>Esc</kbd> | 下一步（翻译 / 填入）· 隐藏 |

## 数据与隐私

- 设置、生词句本、复习进度和练习记录都保存在本地 SQLite 数据库 `translatorx.db` 中，位于应用数据目录（macOS 上为 `~/Library/Application Support/com.translatorx.desktop/`）。API Key 以明文保存在其中。
- 只有在翻译、查词、使用 AI 功能或在线朗读时才会联网，而且只发给相应的服务：你选的翻译服务、你配置的大模型接口，或 Google 在线语音。所有请求都由 Rust 后端发出。

## 项目结构

```
├── index.html, mini.html, bubble.html   # 主界面、快速翻译小窗、悬浮图标
├── src/                                 # React + TypeScript 前端
│   ├── pages/                           # 写作、阅读、生词句本、复习、概览、设置
│   ├── mini/                            # 快速翻译小窗
│   ├── bubble/                          # 悬浮图标（原生 TS）
│   ├── components/                      # 共享组件
│   └── lib/                             # 后端调用、判题、分句、朗读、浏览器模拟后端
├── src-tauri/src/                       # Rust 后端
│   ├── commands.rs, translate.rs        # 命令；Google / DeepL / 大模型 / 语音合成
│   ├── db.rs, srs.rs, settings.rs       # SQLite 存储、复习排期、设置
│   ├── quick.rs, windows.rs             # 快速翻译小窗与悬浮图标
│   ├── geometry.rs, rules.rs            # 窗口定位、输入框判断规则
│   └── macos/                           # 辅助功能、焦点跟踪、自动填入
├── .github/workflows/                   # CI 与发布工作流
└── docs/                                # 设计文档
```

## 技术栈

[Tauri 2](https://tauri.app/) · Rust · React 19 · TypeScript · Vite · Tailwind CSS 4 · zustand · SQLite（rusqlite）

## 已知限制

- 悬浮图标和自动填入支持 macOS 与 Windows，不支持 Linux；Windows 上无法作用于以管理员身份运行的程序。
- 填入时按键位发送 ⌘V / Ctrl+V，在 Dvorak 等非 QWERTY 键盘布局下可能粘贴失败。
- 界面无法被辅助功能（macOS）或 UI Automation（Windows）识别的应用不会出现悬浮图标，但快捷键照常可用。
- 透明窗口依赖 Tauri 的 `macOSPrivateApi`，因此无法上架 Mac App Store。

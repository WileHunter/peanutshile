# PeanutShield

[![Python Version](https://img.shields.io/badge/Python-3.8+-blue.svg)](https://www.python.org/)
[![Node.js Version](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 项目简介

PeanutShield 是一款专为安全服务工程师设计的 **AI 驱动 Web 安全取证审计工具**。通过 MCP（Model Context Protocol）协议，将 AI 智能分析与自动化爬虫技术深度融合，实现对目标站点的全量审计。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🔍 **站点爬取** | 自动抓取目标站点的完整静态资源（HTML/CSS/JS）,动态加载javascript。 |
| 🕵️ **暗链检测** | 识别 `display:none`、透明度隐藏等 SEO 欺诈外链 |
| 🐴 **挂马审计** | 检测 JS 中的恶意代码注入和 UA 嗅探逻辑 |
| 🔄 **恶意跳转** | 分析动态跳转和可疑重定向行为 |
| 📊 **报告生成** | 自动生成标准化的 Word 格式审计报告 |

## 项目结构

```
PeanutShield/
├── Crawlee/                    # 爬虫核心模块
│   ├── src/
│   │   ├── main.ts            # 爬虫主程序
│   │   ├── config.ts          # 爬虫配置
│   │   ├── ip.txt             # 批量爬取站点列表
│   │   └── storage/           # 临时存储
│   ├── site/                  # 站点镜像存储
│   │   └── mirror_*/          # 每个站点的镜像目录
│   │       └── _audit/        # 审计报告输出目录
│   └── package.json
│
├── MCP-server/                # MCP 服务器（AI 接口）
│   ├── server.py              # MCP 工具实现
│   └── venv/                  # Python 虚拟环境
│
└── README.md
```

## 快速开始

### 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 18.x |
| Python | >= 3.8 |
| Playwright | 自动安装 |

### 安装步骤

```bash
# 1. 安装 Node.js 依赖
cd Crawlee
npm install

# 2. 安装 Python 依赖（使用虚拟环境）
cd ../MCP-server
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt  # 如有需要

# 3. 安装 Playwright 浏览器
npx playwright install chromium
```

### 启动 MCP 服务

```bash
# 方式一：直接启动 MCP 服务
cd MCP-server
python server.py

# 方式二：配置 AI IDE 连接 MCP 服务
# 在 Trae/Claude Desktop 中配置 MCP server 路径
```

### 基本使用

```bash
# 进入 Crawlee 目录
cd Crawlee

# 方式一：AI驱动指定单个 URL 爬取
# 在Trae、chatbox等AI agent客户端说爬取www.baidu.com即可。
http://www.baidu.com

# （推荐!!!）方式二：手动使用 ip.txt 批量爬取
# 编辑 ip.txt，添加站点（每行一个）
npx tsx src/main.ts
```

## 高级使用

```bash
# 修改config.ts，自定义爬虫行为

proxy代理
输出目录
爬虫行为
浏览器指纹
```

## MCP 工具使用

在支持 MCP 的 AI 客户端（如 Trae IDE）中，可使用以下工具：

### 1. crawlee - 爬取站点

```python
crawlee(
    url: str,                    # 目标 URL（必填）
    proxy: str = "",             # 代理地址（可选）
    headers: dict = None,        # 自定义请求头（可选）
    max_concurrency: int = None,# 并发数（可选）
    headless: bool = None,      # 无头模式（可选）
    save_js: bool = None        # 保存 JS 文件（可选）
)
```

**示例**：
```
crawlee(url='http://example.com', headless=True, save_js=True)
```

### 2. crawlee_status - 查看进度

```python
crawlee_status()
```

### 3. get_crawled_files - 获取文件列表

```python
get_crawled_files(site_name: str = "")
# site_name: 站点名（如留空，自动定位最新站点）
```

**示例**：
```
get_crawled_files(site_name='example_com')
```

### 4. read_crawled_file - 读取文件内容

```python
read_crawled_file(
    site_name: str,   # 站点名
    file_path: str    # 文件相对路径
)
```

### 5. generate_docx_report - 生成报告

```python
generate_docx_report(
    site_name: str,           # 站点名
    report_data: str,         # 报告内容（JS 代码）
    output_filename: str = "" # 输出文件名
)
```

## AI提示词

~~~bash
# 角色定义
你是一名为 PeanutShield 工作的 Web 安全取证专家。你具备极强的代码审计能力，专注于发现 SEO 欺诈（暗链）、WebShell（挂马）和恶意跳转代码，不用分析站点是否存在owasp类漏洞风险。你的工作风格严谨、数据导向，且报告必须具备可读性和证据效力。

# 核心任务
对指定的站点镜像进行全量审计，识别恶意代码，分析其利用链，并输出一份包含“统计数据”和“深度代码分析”的专业报告。
当用户指定文件时但未说明具体路径，应查找全局索引，若不存在文件应重新调用get_crawled_files工具，获取列表，定位文件。

# 核心作业指令：单次全域分析法 (One-Pass Analysis)

你必须在单次任务中完成从“索引”到“追溯”的全部动作，严禁对同一文件执行重复的读取操作。
沉默执行：禁止输出“好的”、“我明白了”、“正在分析”等任何废话。在调用工具前、工具执行中，严禁发表任何评论或教育洞察。只说关键：对话框中仅允许输出：
1、发现的漏洞关键点（路径+恶意代码片段）。
2、最终确认生成的报告大纲。

1. **构建动态分析队列 (Indexing & Queueing)**：
   * **全量扫描**：首先调用 `get_crawled_files` 获取所有文件路径。
   * **去重采样 (Deduplication)**：
     - **同类文件**：对同目录下命名的规律性文件（如 `news_1.html`, `news_2.html`），仅将**前 3 个**加入初始分析队列。
     - **高危资产**：将所有独立的 **.js**、**Header/Footer/Config** 文件以及**第三方域名目录**下的文件标记为“高优先级必查”。
   
2. **递归穿透审计 (Recursive Auditing)**：
   * **按序读取**：启动 `read_crawled_file` 依次读取队列文件，**并实时维护一个“已分析清单”**。
   * **实时追溯 (No-Look-Back)**：
     - 在读取 HTML 时，提取所有 `<script src="...">`、`<iframe>` 及外部链接。
     - **判断逻辑**：如果引用的 JS（如 `sdk.js`）**不在**“已分析清单”中，立即中断当前任务流，**优先读取该 JS** 并完成分析。
     - **双向定性**：直接结合 HTML 的引用上下文与 JS 源码逻辑判定是否存在挂马。
     - **禁止二次读取**：一旦某个文件（如 `sdk.js`）被关联读取过，后续即使在其他 HTML 中再次发现其引用，也必须直接复用之前的分析结论，严禁再次调用工具读取。

3. **风险特征匹配 (Target Hunting)**：
   * **挂马/暗链**：重点识别 HTML 中隐蔽的 `display:none` 链接，以及 JS 中根据 `User-Agent` (如 Baiduspider) 动态写入内容的欺诈逻辑。

4.   * **恶意代码分析**：识别到恶意代码时，需要分析整个上下文，由触发-》执行-》结果的整个过程恶意代码链分析并标注出来。
   
5. **一次性产出结论**：分析完成后，直接进入 [报告大纲] 阶段，汇总所有通过“穿透”发现的关联漏洞，严禁在报告阶段要求重新读取。

6.  **证据固化与报告 (Reporting)**
    * 在分析结束后，向用户确认并调用 `Wreport` 生成报告。

## 报告 Markdown 结构规范

生成的 `content` 参数必须严格遵守以下结构，Python 转换器将按此规范渲染为 Word 文档。

```
# {报告标题}

## 1. 审计综述

| 项目 | 内容 |
|------|------|
| 扫描对象 | {site_name} |
| 扫描时间 | {YYYY-MM-DD HH:MM} |
| 文件统计 | 共扫描 {n} 个文件 |
| 风险等级 | 高危 / 中危 / 低危 / 安全 |
| 发现问题 | 共发现 {n} 处风险 |

---

## 2. 外链统计

| 外链域名 | 出现次数 | 是否隐藏 | 风险判断 |
|----------|----------|----------|----------|
| xxx.com  | 3        | 是       | 高危暗链 |

---

## 3. 详细风险分析

### 🚨 风险项 1: {简短标题，如：首页植入博彩暗链}

- **风险类型**：暗链 / 挂马 / 恶意跳转 / WebShell
- **风险等级**：高危 / 中危 / 低危
- **涉及文件**：`/www.example.com/index.html`（相对路径，禁用本地绝对路径）
- **影响范围**：{哪些页面受影响，搜索引擎是否可见}

**攻击链分析：**

- **入口**：{恶意代码如何引入，例：通过 JS 动态写入}
- **载荷**：{具体恶意逻辑}
- **影响**：{最终后果，例：百度蜘蛛抓取到博彩链接}

**恶意代码取证：**

{代码过长时截断，保留关键部分即可}

```php
// 关键恶意代码片段
if (strpos($_SERVER['HTTP_USER_AGENT'], 'Baiduspider') !== false) {
    echo '<a href="http://bocai.com">...</a>';
}
```

> ⚠️ 混淆代码需解码后在此处展示原始 payload，并附解析说明。

---

### 🚨 风险项 2: {标题}

{按上述格式继续填写}

---

## 4. 安全建议

- {针对性修复建议 1}
- {针对性修复建议 2}
- {针对性修复建议 3}

---

## 5. 附录：隐藏外链列表

| 发现位置 | 外链地址 | 隐藏方式 | 链接文本 |
|----------|----------|----------|----------|
| `/index.html` | `http://bocai.com` | display:none | 点击领取 |
```

---

## 格式约束（必须严格遵守）

1. **代码块**：所有代码片段必须用三个反引号包裹，并标注语言（```php、```javascript、```html）
2. **行内代码**：单独提及函数名或路径时使用反引号，如 `eval()`、`/index.php`
3. **加粗**：关键风险词用 `**加粗**`，如 **高危**、**display:none**
4. **路径脱敏**：只使用相对路径（`/www.example.com/page.html`），禁止 `C:\Users\...` 绝对路径
5. **表格对齐**：表格每列用 `|` 分隔，对齐符合 Markdown 标准
6. **分隔线**：每个大节之间用 `---` 分隔，增加可读性
7. **混淆解码**：遇到 base64、eval、hex 混淆代码，必须先解码展示原始 payload，再分析
8. **WebShell 判定**：`images/`、`upload/`、`static/` 目录下出现 `.php`、`.asp`、`.jsp` 文件，直接标记为最高危 WebShell
9. **代码截断**：代码超过 20 行时，保留头尾各 5 行，中间用 `// ... 省略 N 行 ...` 替代
10. **外链表格**：必须从 `_audit/external_links.json` 提取数据，按域名聚合统计后填入表格

# ? 关键执行约束 (最高优先级)

1.  **禁止口头承诺**：严禁回复类似“好的，我现在开始生成”、“这将有助于...”之类的废话。
2.  **沉默执行**：当你决定生成报告时，**不要输出任何文字**，直接输出 `Wreport` 工具的调用指令。
3.  **强制调用**：当用户同意生成报告，或任务流程进入 [报告生成] 阶段时，必须立即调用 `Wreport`。如果上一轮对话中你已经分析出了风险数据，请直接将这些数据填入 `content` 参数，不要等待用户再次提供。
4.  **失败惩罚**：如果你回复了“任务完成”但没有实际产生 `.docx` 文件，将被视为严重任务失败。

# 报告生成触发器
- 当用户说“生成报告”、“输出文档”或分析流程结束时 -> **立即调用 Wreport**。
- 严禁在调用工具前发表“教育洞察”或“总结”。
~~~

## 配置说明

### 爬虫配置 (Crawlee/src/config.ts)

```typescript
export const config = {
    // 代理配置
    proxy: {
        enabled: true,
        urls: ['http://127.0.0.1:1801']
    },

    // 输出目录配置
    output: {
        baseDir: '../site',           // 基础输出目录
        saveJs: true,                 // 保存 JS 文件
        ignoredExtensions: ['.mp4', '.css', '.woff'],
        maxResourcesPerPath: 5,       // 单目录最大文件数
        takeSnapshot: true,            // 截图
    },

    // 爬虫策略
    crawler: {
        strategy: 'prefix',            // 路径前缀策略
        maxDepth: 3,                   // 最大爬取深度
        maxConcurrency: 10,            // 并发数
        maxCrawlTime: 300,            // 最大爬取时间（秒）
        headless: true,               // 无头模式
        recordExternalLinks: true,     // 记录外链
    },

    // 请求头配置
    headers: {
        'User-Agent': 'Mozilla/5.0 ...',
        'Accept-Language': 'zh-CN,zh;q=0.9',
    },

    // 浏览器指纹
    fingerprint: {
        browsers: ['chrome', 'edge'],
        devices: ['mobile'],
        operatingSystems: ['android'],
    },

    debug: false,
};
```

### 目录命名规则

| URL 类型 | 示例 | 镜像目录 |
|----------|------|----------|
| IP 地址 | `11.222.333.44` | `mirror_11_222_333_444` |
| 域名 | `www.example.com` | `mirror_www_example_com` |

## 适用场景

- **安全服务审计**：为客户提供站点安全取证报告
- **合规检测**：检测网站是否存在违规暗链、挂马代码
- **威胁情报**：批量监控站点安全状态变化
- **溯源分析**：对被攻击站点进行事后取证分析

## 注意事项

1. **法律合规**：请确保在授权范围内使用本工具
2. **频率控制**：合理设置爬取间隔，避免对目标服务器造成压力
3. **数据安全**：审计报告和站点镜像请妥善保管
4. **代理使用**：在需要隐藏真实 IP 时，请使用合规代理

## 常见问题

### Q: 爬取失败怎么办？

1. 检查网络连接是否正常
2. 确认目标站点是否可访问
3. 尝试启用代理或调整 headers
4. 查看日志中的具体错误信息

### Q: 报告生成失败？

确保已安装 `docx` 包：
```bash
cd MCP-server
npm install docx
```

## 联系方式

如有问题或建议，请提交 Issue 或联系开发者。

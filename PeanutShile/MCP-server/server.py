from fastmcp import FastMCP
import platform
import psutil
import subprocess
import os
import re
import json
import threading
import time
import tempfile
import uuid
from pathlib import Path
from datetime import datetime
from docx import Document
from docx.shared import Pt, RGBColor, Inches
from docx.enum.text import WD_ALIGN_PARAGRAPH
from datetime import datetime

# 创建 MCP 服务实例
mcp = FastMCP("PeanutShile")

# 全局路径配置
BASE_DIR    = Path(__file__).parent.parent
CRAWLEE_DIR = BASE_DIR / "Crawlee"
SITE_DIR    = CRAWLEE_DIR / "site"
MCP_DIR     = Path(__file__).parent

# 全局任务状态存储
task_status = {
    'running': False,
    'start_time': None,
    'status': 'idle',
    'message': '',
    'output': [],
    'error': None,
    'last_crawl_url': None,    # 最后一次爬取的原始 URL
    'last_site_name': None     # 最后一次爬取的站点目录名（自动生成）
}

def normalize_site_name(url: str) -> str:
    """从 URL 生成标准化的站点目录名（与 main.ts 的 getOutputDir 保持一致）"""
    from urllib.parse import urlparse
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname if parsed.hostname else url.split('://')[-1].split('/')[0]
        
        # 处理 IP 地址（可能带端口）
        if hostname.replace('.', '').replace(':', '').isdigit():
            # 纯 IP，去掉端口后替换点
            return hostname.split(':')[0].replace('.', '_')
        
        # 处理域名（可能带端口）
        parts = hostname.split('.')
        return '_'.join(parts[-min(len(parts), 3):])
    except:
        return 'unknown'

def find_matching_site_dir(site_name: str) -> Path | None:
    """模糊匹配站点目录，支持 IP 和域名变体"""
    if not SITE_DIR.exists():
        return None
    
    site_name_lower = site_name.lower().replace(' ', '').replace('_', '')
    
    # 1. 精确匹配 mirror_{site_name}（忽略大小写）
    target = SITE_DIR / f"mirror_{site_name}"
    if target.exists():
        return target
    
    # 遍历所有站点目录进行智能匹配
    for d in SITE_DIR.iterdir():
        if not d.is_dir():
            continue
        
        # 目录名去掉 mirror_ 前缀
        dir_name = d.name.replace('mirror_', '').lower()
        # 标准化：去除下划线和空格
        dir_name_normalized = dir_name.replace('_', '').replace(' ', '')
        
        # 2. 包含匹配：用户输入是目录名的一部分
        if site_name_lower in dir_name_normalized or dir_name_normalized in site_name_lower:
            return d
        
        # 3. 域名后缀匹配
        dir_parts = dir_name.split('_')
        for part in dir_parts:
            if part and len(part) > 2 and part in site_name_lower:
                return d
                
        # 4. IP 段匹配（用户输入 "10.128" 匹配 "10_128_183_24"）
        if '.' in site_name:
            ip_segments = site_name.split('.')
            for seg in ip_segments:
                if seg.isdigit() and seg in dir_parts:
                    return d
    
    return None

def run_crawlee_async(crawlee_dir, config_path, backup_path, modifications, cli_url=None):
    """异步执行爬虫任务"""
    global task_status
    
    try:
        task_status['status'] = 'running'
        task_status['message'] = '正在启动 Crawlee...'
        
        command = ["npx", "tsx", "src/main.ts"]
        if cli_url:
            command.append(cli_url)
        
        process = subprocess.Popen(
            command,
            cwd=str(crawlee_dir),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            shell=True,
            encoding='utf-8',
            bufsize=1
        )
        
        task_status['message'] = 'Crawlee 已启动，正在爬取...'
        
        # 实时读取输出
        output_lines = []
        error_lines = []
        
        # 读取标准输出
        for line in iter(process.stdout.readline, ''):
            if line:
                output_lines.append(line.strip())
                task_status['output'] = output_lines[-20:]  # 保留最后20行
                task_status['message'] = f'正在爬取... (已输出 {len(output_lines)} 行)'
        
        # 等待进程结束
        process.wait()
        
        # 读取错误输出
        stderr = process.stderr.read()
        if stderr:
            error_lines = stderr.split('\n')
        
        # 恢复原始配置
        if backup_path.exists():
            with open(backup_path, 'r', encoding='utf-8') as f:
                original = f.read()
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write(original)
            backup_path.unlink()
        
        if process.returncode == 0:
            task_status['status'] = 'completed'
            task_status['message'] = '✅ 爬取任务完成'
            task_status['output'] = output_lines[-50:]  # 保留最后50行
            
            # 保存站点信息，供 get_crawled_files 直接使用
            if cli_url:
                task_status['last_crawl_url'] = cli_url
                task_status['last_site_name'] = normalize_site_name(cli_url)
        else:
            task_status['status'] = 'failed'
            task_status['message'] = '❌ 爬取任务失败'
            task_status['error'] = '\n'.join(error_lines[-20:])
            
    except Exception as e:
        task_status['status'] = 'error'
        task_status['message'] = f'❌ 执行异常: {str(e)}'
        task_status['error'] = str(e)
        
        # 恢复配置
        try:
            if backup_path.exists():
                with open(backup_path, 'r', encoding='utf-8') as f:
                    original = f.read()
                with open(config_path, 'w', encoding='utf-8') as f:
                    f.write(original)
                backup_path.unlink()
        except:
            pass
    
    finally:
        task_status['running'] = False

# 调用Crawlee工具
@mcp.tool()
def crawlee(
    url: str,
    proxy: str = "",
    headers: dict = None,
    max_concurrency: int = None,
    headless: bool = None,
    save_js: bool = None
) -> str:
    """
    调用 Crawlee 工具爬取网站（异步执行）。
    
    :param url: 目标爬取 URL（必填，例如: 'https://www.example.com'）
    :param proxy: 代理服务器地址（可选，例如: '127.0.0.1:1801' 或 'http://127.0.0.1:1801'）
    :param headers: 自定义请求头字典（可选，例如: {"User-Agent": "...", "Cookie": "..."}）
    :param max_concurrency: 并发数（可选，例如: 10）
    :param headless: 是否无头模式（可选，True/False）
    :param save_js: 是否保存 JS 文件（可选，True/False）
    
    任务将在后台执行，使用 crawlee_status() 查看进度。
    """
    global task_status
    
    if not url:
        return "❌ 错误: url 参数是必填的。\n\n示例: crawlee(url='https://www.example.com')"
    
    if task_status['running']:
        return f"""⚠️ 已有任务正在运行

当前状态: {task_status['status']}
消息: {task_status['message']}

请使用 crawlee_status() 查看进度，或等待任务完成。
"""
    
    config_path = CRAWLEE_DIR / "src" / "config.ts"
    backup_path = config_path.with_suffix('.ts.backup')
    
    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            original_config = f.read()
        
        with open(backup_path, 'w', encoding='utf-8') as f:
            f.write(original_config)
        
        modified_config = original_config
        modifications = []
        
        modified_config = re.sub(
            r"startUrls:\s*\[[\s\S]*?\]",
            f"startUrls: [\n        '{url}'\n    ]",
            modified_config
        )
        modifications.append(f"URL: {url}")
        
        if proxy:
            if not proxy.startswith(('http://', 'https://', 'socks5://', 'socks4://')):
                proxy = f"http://{proxy}"
            modified_config = re.sub(
                r"proxy:\s*\{[\s\S]*?enabled:\s*(true|false)",
                "proxy: {\n        enabled: true",
                modified_config
            )
            modified_config = re.sub(
                r"urls:\s*\[[\s\S]*?\]",
                f"urls: [\n            '{proxy}'\n        ]",
                modified_config,
                count=1
            )
            modifications.append(f"代理: {proxy}")
        
        if headers and isinstance(headers, dict):
            for key, value in headers.items():
                escaped_value = str(value).replace("'", "\\'").replace('"', '\\"')
                pattern = f"'{key}':\\s*'[^']*'"
                replacement = f"'{key}': '{escaped_value}'"
                if re.search(pattern, modified_config):
                    modified_config = re.sub(pattern, replacement, modified_config)
                else:
                    modified_config = re.sub(
                        r"(headers:\s*\{)",
                        f"\\1\n        '{key}': '{escaped_value}',",
                        modified_config
                    )
                modifications.append(f"请求头: {key}")
        
        if max_concurrency is not None:
            modified_config = re.sub(
                r"maxConcurrency:\s*\d+",
                f"maxConcurrency: {max_concurrency}",
                modified_config
            )
            modifications.append(f"并发数: {max_concurrency}")
        
        if headless is not None:
            modified_config = re.sub(
                r"headless:\s*(true|false)",
                f"headless: {str(headless).lower()}",
                modified_config
            )
            modifications.append(f"无头模式: {headless}")
        
        if save_js is not None:
            modified_config = re.sub(
                r"saveJs:\s*(true|false)",
                f"saveJs: {str(save_js).lower()}",
                modified_config
            )
            modifications.append(f"保存JS: {save_js}")
        
        with open(config_path, 'w', encoding='utf-8') as f:
            f.write(modified_config)
        
        task_status['running'] = True
        task_status['start_time'] = datetime.now().isoformat()
        task_status['status'] = 'starting'
        task_status['message'] = '正在准备启动...'
        task_status['output'] = []
        task_status['error'] = None
        
        thread = threading.Thread(
            target=run_crawlee_async,
            args=(CRAWLEE_DIR, config_path, backup_path, modifications, url)
        )
        thread.daemon = True
        thread.start()
        
        time.sleep(2)
        
        mod_info = "\n".join([f"  - {m}" for m in modifications])
        
        suggested_site_name = normalize_site_name(url)
        
        return f"""🚀 Crawlee 任务已启动（后台执行）

📝 配置修改:
{mod_info}

⏱️ 开始时间: {task_status['start_time']}
📊 当前状态: {task_status['status']}
💬 消息: {task_status['message']}

💡 使用 crawlee_status() 查看实时进度
💡 使用 get_crawled_files() 查看爬取结果（站点名: {suggested_site_name}）
"""
            
    except Exception as e:
        try:
            if backup_path.exists():
                with open(backup_path, 'r', encoding='utf-8') as f:
                    original = f.read()
                with open(config_path, 'w', encoding='utf-8') as f:
                    f.write(original)
                backup_path.unlink()
        except:
            pass
        return f"❌ 启动 Crawlee 工具时发生异常: {str(e)}\n\n已恢复原始配置。"

@mcp.tool()
def crawlee_status() -> str:
    """查看当前 Crawlee 任务的执行状态和进度。"""
    global task_status
    
    if not task_status['running'] and task_status['status'] == 'idle':
        return "📭 当前没有运行中的任务。\n\n使用 crawlee(url='...') 启动新任务。"
    
    elapsed = ""
    if task_status['start_time']:
        start = datetime.fromisoformat(task_status['start_time'])
        elapsed_seconds = (datetime.now() - start).total_seconds()
        elapsed = f"{int(elapsed_seconds // 60)}分{int(elapsed_seconds % 60)}秒"
    
    recent_output = "\n".join(task_status['output'][-10:]) if task_status['output'] else "暂无输出"
    
    status_emoji = {
        'starting': '🔄', 'running': '⚙️', 'completed': '✅',
        'failed': '❌', 'error': '⚠️', 'idle': '📭'
    }
    emoji = status_emoji.get(task_status['status'], '❓')
    
    result = f"""{emoji} Crawlee 任务状态

📊 状态: {task_status['status']}
💬 消息: {task_status['message']}
⏱️ 运行时间: {elapsed}
🔄 是否运行中: {'是' if task_status['running'] else '否'}

📝 最新输出 (最后10行):
{recent_output}
"""
    if task_status['error']:
        result += f"\n\n⚠️ 错误信息:\n{task_status['error']}"
    return result

@mcp.tool()
def crawlee_stop() -> str:
    """停止当前正在运行的 Crawlee 任务。"""
    global task_status
    if not task_status['running']:
        return "📭 当前没有运行中的任务。"
    return """⚠️ 无法直接停止后台任务

由于任务在独立线程中运行，无法直接终止。

建议：
1. 等待任务自然完成
2. 重启 MCP 服务器
3. 手动终止 npx/node 进程

任务完成后会自动恢复配置文件。
"""

@mcp.tool()
def get_crawled_files(site_name: str = "") -> str:
    """
    获取指定站点镜像目录下的所有文件（递归搜索所有子目录和域名文件夹）。
    排除 snapshot 文件夹，并显示文件大小。
    
    :param site_name: 站点名称（例如: '516dm'），若置空，则列出所有已爬取的站点。
                      若刚完成爬取，传入空值将自动定位最新爬取的站点。
    """
    if not SITE_DIR.exists():
        return "📭 存储根目录不存在。"

    # 如果未指定站点名，尝试使用最后一次爬取的站点
    if not site_name:
        if task_status.get('last_site_name'):
            site_name = task_status['last_site_name']
        else:
            # 列出所有站点
            sites = [d.name for d in SITE_DIR.iterdir() if d.is_dir()]
            if not sites:
                return "📭 还没有爬取任何站点。"
            result = "📁 已爬取的站点:\n\n"
            for site in sites:
                site_path = SITE_DIR / site
                file_count = 0
                total_size = 0
                for f in site_path.rglob('*'):
                    if f.is_file() and 'snapshot' not in f.parts:
                        file_count += 1
                        total_size += f.stat().st_size
                if total_size < 1024 * 1024:
                    size_str = f"{total_size / 1024:.2f}KB"
                elif total_size < 1024 * 1024 * 1024:
                    size_str = f"{total_size / (1024 * 1024):.2f}MB"
                else:
                    size_str = f"{total_size / (1024 * 1024 * 1024):.2f}GB"
                clean_name = site.replace('mirror_', '')
                result += f"  - {clean_name}: {file_count} 个文件, {size_str}\n"
            result += "\n💡 使用 get_crawled_files(site_name='站点名') 查看具体文件"
            return result

    target_root = find_matching_site_dir(site_name)
    if not target_root:
        return f"❌ 未找到站点 '{site_name}'。\n\n💡 最近爬取: {task_status.get('last_crawl_url', '无')}"

    files_info = []
    total_size = 0
    for f in target_root.rglob('*'):
        if f.is_file():
            if 'snapshot' in f.parts:
                continue
            relative_path = str(f.relative_to(target_root))
            file_size = f.stat().st_size
            total_size += file_size
            if file_size < 1024:
                size_str = f"{file_size}B"
            elif file_size < 1024 * 1024:
                size_str = f"{file_size / 1024:.2f}KB"
            else:
                size_str = f"{file_size / (1024 * 1024):.2f}MB"
            files_info.append(f"{relative_path} ({size_str})")

    if not files_info:
        return f"📁 站点 {target_root.name} 目录下暂无文件。"
    
    if total_size < 1024:
        total_size_str = f"{total_size}B"
    elif total_size < 1024 * 1024:
        total_size_str = f"{total_size / 1024:.2f}KB"
    elif total_size < 1024 * 1024 * 1024:
        total_size_str = f"{total_size / (1024 * 1024):.2f}MB"
    else:
        total_size_str = f"{total_size / (1024 * 1024 * 1024):.2f}GB"

    return f"""📁 站点根目录: {target_root.name}
📊 发现文件总数: {len(files_info)} (已排除 snapshot 文件夹)
💾 总大小: {total_size_str}

📝 完整路径清单:
{chr(10).join(files_info)}

💡 请根据上述路径，使用 read_crawled_file(site_name='{site_name}', file_path='...') 读取具体内容。
"""

@mcp.tool()
def read_crawled_file(site_name: str, file_path: str) -> str:
    """
    读取镜像目录下指定路径的文件。

    - 文件 < 100KB：直接返回全文
    - 文件 >= 100KB：返回文件信息 + 分块说明，请改用
      read_file_chunk(site_name, file_path, chunk_index) 逐块读取

    :param site_name: 站点名称
    :param file_path: 从 get_crawled_files 获取到的相对路径
    """
    target_file = _resolve_file_path(site_name, file_path)
    if isinstance(target_file, str):
        return target_file  # 错误信息

    try:
        raw = target_file.read_bytes()
        size_bytes = len(raw)
        size_kb = size_bytes / 1024

        # 小文件直接全文返回
        if size_bytes <= 100 * 1024:
            content = raw.decode('utf-8', errors='replace')
            return (
                f"📄 文件路径: {file_path}\n"
                f"📦 大小: {size_kb:.1f} KB（全文，无需分块）\n\n"
                f"{content}"
            )

        # 大文件：返回元信息，引导使用分块工具
        total_chunks = _calc_total_chunks(size_bytes)
        size_str = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb/1024:.2f} MB"
        return (
            f"📄 文件路径: {file_path}\n"
            f"📦 大小: {size_str}  |  总块数: {total_chunks}  |  每块: ~100 KB\n\n"
            f"⚠️  文件超过 100KB，为保证内容完整性请使用分块工具读取：\n\n"
            f"  read_file_chunk(site_name='{site_name}', file_path='{file_path}', chunk_index=0)\n\n"
            f"请从 chunk_index=0 开始，依次读取到 chunk_index={total_chunks - 1}，\n"
            f"对每一块进行分析后再读取下一块，最终汇总得出完整结论。"
        )
    except Exception as e:
        return f"❌ 读取失败: {e}"


@mcp.tool()
def read_file_chunk(site_name: str, file_path: str, chunk_index: int) -> str:
    """
    按块读取大文件，每块约 100KB，用于对超过 100KB 的文件进行完整分析。

    典型工作流：
      1. 先调用 read_crawled_file() 获取总块数
      2. 从 chunk_index=0 开始逐块调用本工具
      3. 对每块内容完成分析后再读取下一块
      4. 所有块读完后汇总结论

    :param site_name:   站点名称
    :param file_path:   文件相对路径
    :param chunk_index: 块编号，从 0 开始
    """
    target_file = _resolve_file_path(site_name, file_path)
    if isinstance(target_file, str):
        return target_file

    CHUNK_SIZE = 100 * 1024  # 100 KB per chunk

    try:
        raw = target_file.read_bytes()
        size_bytes = len(raw)
        total_chunks = _calc_total_chunks(size_bytes)

        if chunk_index < 0 or chunk_index >= total_chunks:
            return (
                f"❌ chunk_index={chunk_index} 超出范围。\n"
                f"   有效范围：0 ~ {total_chunks - 1}（共 {total_chunks} 块）"
            )

        start = chunk_index * CHUNK_SIZE
        end   = min(start + CHUNK_SIZE, size_bytes)
        chunk_bytes = raw[start:end]

        content = chunk_bytes.decode('utf-8', errors='replace')

        size_kb    = size_bytes / 1024
        size_str   = f"{size_kb:.1f} KB" if size_kb < 1024 else f"{size_kb/1024:.2f} MB"
        chunk_kb   = len(chunk_bytes) / 1024
        is_last    = (chunk_index == total_chunks - 1)
        next_hint  = (
            f"✅ 已读完最后一块（{chunk_index + 1}/{total_chunks}），可以汇总分析结论。"
            if is_last else
            f"➡️  下一块：read_file_chunk(site_name='{site_name}', "
            f"file_path='{file_path}', chunk_index={chunk_index + 1})"
        )

        return (
            f"📄 {file_path}\n"
            f"📦 文件总大小: {size_str}  |  第 {chunk_index + 1}/{total_chunks} 块"
            f"  |  本块: {chunk_kb:.1f} KB"
            f"  |  字节范围: [{start} ~ {end - 1}]\n"
            f"{'─' * 60}\n"
            f"{content}\n"
            f"{'─' * 60}\n"
            f"{next_hint}"
        )

    except Exception as e:
        return f"❌ 读取失败: {e}"


# ── 内部辅助：解析文件路径 ────────────────────────────────────────
def _resolve_file_path(site_name: str, file_path: str):
    """返回 Path 对象，或错误字符串"""
    target_root = SITE_DIR / f"mirror_{site_name}"
    if not target_root.exists():
        matches = [d for d in SITE_DIR.iterdir() if d.is_dir() and site_name in d.name]
        if matches:
            target_root = matches[0]
        else:
            return f"❌ 站点目录不存在: mirror_{site_name}"
    f = target_root / file_path
    if not f.exists():
        return f"❌ 找不到文件: {file_path}"
    if not f.is_file():
        return f"❌ 路径不是文件: {file_path}"
    return f


def _calc_total_chunks(size_bytes: int, chunk_size: int = 100 * 1024) -> int:
    """计算总块数"""
    return max(1, (size_bytes + chunk_size - 1) // chunk_size)


# ════════════════════════════════════════════════════════════════
# 新增：基于 docx.js 模板的高质量报告生成
# ════════════════════════════════════════════════════════════════

# 报告 JS 模板骨架 —— 纯格式，无任何业务数据
# LLM 只需填充 DATA_PLACEHOLDER 区域的内容
_REPORT_JS_TEMPLATE = r'''
const {{
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  Header, Footer
}} = require('docx');
const fs = require('fs');

// ── 样式工具函数（固定不变） ────────────────────────────────────
const border   = {{ style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" }};
const borders  = {{ top: border, bottom: border, left: border, right: border }};
const rBorder  = {{ style: BorderStyle.SINGLE, size: 2, color: "CC0000" }};
const rBorders = {{ top: rBorder, bottom: rBorder, left: rBorder, right: rBorder }};

function cell(text, bg="FFFFFF", bold=false, span=1, color="333333") {{
  return new TableCell({{
    columnSpan: span, borders,
    width: {{ size: 0, type: WidthType.AUTO }},
    shading: {{ fill: bg, type: ShadingType.CLEAR }},
    margins: {{ top: 80, bottom: 80, left: 120, right: 120 }},
    children: [new Paragraph({{ children: [new TextRun({{ text, bold, size: 18, font:"Arial", color }})] }})]
  }});
}}
function hcell(text, span=1) {{ return cell(text,"1F3864",true,span,"FFFFFF"); }}
function p(text, opts={{}}) {{
  return new Paragraph({{
    spacing: {{ before:80, after:80 }},
    children: [new TextRun({{ text, size:opts.size||20, bold:opts.bold||false, color:opts.color||"333333", font:"Arial" }})]
  }});
}}
function h1(text) {{
  return new Paragraph({{
    heading: HeadingLevel.HEADING_1,
    spacing: {{ before:320, after:160 }},
    border: {{ bottom: {{ style:BorderStyle.SINGLE, size:4, color:"CC0000", space:4 }} }},
    children: [new TextRun({{ text, size:32, bold:true, color:"CC0000", font:"Arial" }})]
  }});
}}
function h2(text) {{
  return new Paragraph({{
    heading: HeadingLevel.HEADING_2,
    spacing: {{ before:240, after:120 }},
    children: [new TextRun({{ text, size:26, bold:true, color:"1F3864", font:"Arial" }})]
  }});
}}
function h3(text) {{
  return new Paragraph({{
    heading: HeadingLevel.HEADING_3,
    spacing: {{ before:160, after:80 }},
    children: [new TextRun({{ text, size:22, bold:true, color:"2E5090", font:"Arial" }})]
  }});
}}
function bullet(text) {{
  return new Paragraph({{
    spacing: {{ before:40, after:40 }},
    indent: {{ left:360, hanging:240 }},
    children: [
      new TextRun({{ text:"• ", size:20, color:"CC0000", font:"Arial" }}),
      new TextRun({{ text, size:20, color:"333333", font:"Arial" }})
    ]
  }});
}}
function codeBlock(text) {{
  return new Paragraph({{
    spacing: {{ before:80, after:80 }},
    indent: {{ left:360 }},
    border: {{ left: {{ style:BorderStyle.SINGLE, size:8, color:"CC0000", space:4 }} }},
    shading: {{ fill:"F8F0F0", type:ShadingType.CLEAR }},
    children: [new TextRun({{ text, size:18, font:"Courier New", color:"8B0000" }})]
  }});
}}
function spacer() {{ return new Paragraph({{ spacing:{{ before:40, after:40 }}, children:[new TextRun("")] }}); }}
function alertBox(label, text, labelBg="CC0000", boxBg="FFF0F0") {{
  return new Table({{
    width: {{ size:9360, type:WidthType.DXA }},
    columnWidths: [1200, 8160],
    rows: [new TableRow({{ children: [
      new TableCell({{ borders:rBorders, width:{{size:1200,type:WidthType.DXA}},
        shading:{{fill:labelBg,type:ShadingType.CLEAR}},
        margins:{{top:80,bottom:80,left:120,right:120}},
        children:[new Paragraph({{children:[new TextRun({{text:label,bold:true,size:18,font:"Arial",color:"FFFFFF"}})]}})] }}),
      new TableCell({{ borders:rBorders, width:{{size:8160,type:WidthType.DXA}},
        shading:{{fill:boxBg,type:ShadingType.CLEAR}},
        margins:{{top:80,bottom:80,left:120,right:120}},
        children:[new Paragraph({{children:[new TextRun({{text,size:18,font:"Arial",color:"333333"}})]}})] }})
    ]}})]
  }});
}}

// ── 由 LLM 填充的报告数据 ────────────────────────────────────────
{data_placeholder}

// ── 文档组装（固定骨架） ─────────────────────────────────────────
const doc = new Document({{
  styles: {{
    default: {{ document: {{ run: {{ font:"Arial", size:20 }} }} }},
    paragraphStyles: [
      {{ id:"Heading1", name:"Heading 1", basedOn:"Normal", next:"Normal",
         run:{{size:32,bold:true,font:"Arial",color:"CC0000"}},
         paragraph:{{spacing:{{before:320,after:160}},outlineLevel:0}} }},
      {{ id:"Heading2", name:"Heading 2", basedOn:"Normal", next:"Normal",
         run:{{size:26,bold:true,font:"Arial",color:"1F3864"}},
         paragraph:{{spacing:{{before:240,after:120}},outlineLevel:1}} }},
      {{ id:"Heading3", name:"Heading 3", basedOn:"Normal", next:"Normal",
         run:{{size:22,bold:true,font:"Arial",color:"2E5090"}},
         paragraph:{{spacing:{{before:160,after:80}},outlineLevel:2}} }},
    ]
  }},
  sections: [{{
    properties: {{
      page: {{
        size: {{ width:12240, height:15840 }},
        margin: {{ top:1440, right:1440, bottom:1440, left:1440 }}
      }}
    }},
    headers: {{
      default: new Header({{ children: [
        new Paragraph({{
          border: {{ bottom:{{style:BorderStyle.SINGLE,size:4,color:"CC0000",space:4}} }},
          children: [new TextRun({{text: REPORT_HEADER_TEXT, bold:true, size:20, font:"Arial", color:"CC0000"}})]
        }})
      ]}})
    }},
    children: REPORT_SECTIONS
  }}]
}});

Packer.toBuffer(doc).then(buf => {{
  fs.writeFileSync(OUTPUT_PATH, buf);
  console.log("OK:" + OUTPUT_PATH);
}}).catch(e => {{
  console.error("ERR:" + e.message);
  process.exit(1);
}});
'''


@mcp.tool()
def generate_docx_report(
    site_name: str,
    report_data: str,
    output_filename: str = "",
) -> str:
    """
    使用 docx.js 模板生成高质量 Word 安全审计报告。

    工作流程：
      1. 将 report_data（LLM 生成的 JS 数据段）注入模板骨架
      2. 写入临时 JS 文件（tmp_report_<uuid>.js）
      3. 执行 node tmp_report_<uuid>.js 生成 .docx
      4. 删除临时 JS 文件
      5. 返回 .docx 保存路径

    :param site_name:
        站点名称，报告保存到 Crawlee/site/mirror_{site_name}/_audit/
        若传入空字符串则保存到脚本同级目录的 _audit/ 下。

    :param report_data:
        【由 LLM 生成】纯 JavaScript 代码段，须定义以下三个变量：

        ① REPORT_HEADER_TEXT  —— 字符串，页眉文字
           例：const REPORT_HEADER_TEXT = "【机密】安全审计报告 | example.com";

        ② REPORT_SECTIONS     —— 数组，文档 body children（使用模板内置的
           cell/hcell/p/h1/h2/h3/bullet/codeBlock/spacer/alertBox 等函数构造）
           例：
           const REPORT_SECTIONS = [
             h1("一、执行摘要"),
             p("本次审计发现..."),
             new Table({
               width: { size: 9360, type: WidthType.DXA },
               columnWidths: [3120, 3120, 3120],
               rows: [
                 new TableRow({ children: [hcell("指标"), hcell("数值"), hcell("说明")] }),
                 new TableRow({ children: [cell("文件大小"), cell("22 KB"), cell("单文件混淆JS")] }),
               ]
             }),
             spacer(),
           ];

        ③ OUTPUT_PATH          —— 字符串，输出文件的完整绝对路径
           例：const OUTPUT_PATH = "/path/to/report.docx";
           （由工具自动替换，LLM 可写占位符 "__OUTPUT_PATH__"）

    :param output_filename:
        输出文件名（不含路径），默认为 Report_{site_name}_{timestamp}.docx

    :return:
        成功：✅ 报告路径
        失败：❌ 错误信息 + node stderr
    """
    # ── 1. 确定输出路径 ──────────────────────────────────────────
    if site_name:
        out_dir = _resolve_site_dir(SITE_DIR, site_name)
        if isinstance(out_dir, str):
            return out_dir   # 错误信息
        out_dir = out_dir / "_audit"
    else:
        out_dir = MCP_DIR / "_audit"

    out_dir.mkdir(parents=True, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    fname = output_filename if output_filename else f"Report_{site_name or 'nosite'}_{ts}.docx"
    if not fname.endswith(".docx"):
        fname += ".docx"

    docx_path = out_dir / fname

    # ── 2. 替换 OUTPUT_PATH 占位符 ──────────────────────────────
    # 使用正斜杠 (/) 传递给 Node.js，避免 Windows 反斜杠转义问题
    safe_path = str(docx_path).replace("\\", "/")
    
    # 打印调试信息（可选，帮助在日志中确认路径）
    print(f"DEBUG: Generating report to {safe_path}")

    # 替换 report_data 中的占位符
    data_code = report_data
    if "const OUTPUT_PATH" in data_code:
        data_code = re.sub(
            r'const\s+OUTPUT_PATH\s*=\s*["\'][^"\']*["\']',
            f'const OUTPUT_PATH = "{safe_path}"',
            data_code
        )
    elif "let OUTPUT_PATH" in data_code:
        data_code = re.sub(
            r'let\s+OUTPUT_PATH\s*=\s*["\'][^"\']*["\']',
            f'let OUTPUT_PATH = "{safe_path}"',
            data_code
        )
    elif "var OUTPUT_PATH" in data_code:
        data_code = re.sub(
            r'var\s+OUTPUT_PATH\s*=\s*["\'][^"\']*["\']',
            f'var OUTPUT_PATH = "{safe_path}"',
            data_code
        )
    
    # 如果 LLM 用了占位符但没有声明，或者声明不规范，统一在头部强制定义
    if "OUTPUT_PATH" not in data_code or "const OUTPUT_PATH" not in data_code:
        data_code = f'const OUTPUT_PATH = "{safe_path}";\n' + data_code

    # ── 3. 拼合完整 JS ──────────────────────────────────────────
    full_js = _REPORT_JS_TEMPLATE.format(data_placeholder=data_code)

    # ── 4. 写入临时文件 ──────────────────────────────────────────
    tmp_id   = uuid.uuid4().hex[:8]
    tmp_path = MCP_DIR / f"tmp_report_{tmp_id}.js"

    try:
        tmp_path.write_text(full_js, encoding="utf-8")

        # ── 5. 执行 node ─────────────────────────────────────────
        result = subprocess.run(
            ["node", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=60,
            encoding="utf-8"
        )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()

        if result.returncode != 0 or "ERR:" in stdout:
            err_detail = stderr or stdout
            return (
                f"❌ node 执行失败 (exit={result.returncode})\n\n"
                f"stderr:\n{err_detail}\n\n"
                f"💡 请检查 report_data 中的 JS 语法是否正确。"
            )

        # ── 6. 验证文件存在 ───────────────────────────────────────
        if not docx_path.exists():
            return (
                f"❌ node 执行成功但未找到输出文件: {docx_path}\n"
                f"stdout: {stdout}\nstderr: {stderr}"
            )

        size_kb = docx_path.stat().st_size / 1024
        return (
            f"✅ Word 报告已生成\n"
            f"📂 路径: {docx_path}\n"
            f"📦 大小: {size_kb:.1f} KB\n"
            f"📊 站点: {site_name or '（无）'}"
        )

    except subprocess.TimeoutExpired:
        return "❌ node 执行超时（>60s），请检查 report_data 是否存在死循环。"

    except Exception as e:
        return f"❌ 内部异常: {e}"

    finally:
        # ── 7. 清理临时文件（无论成败） ───────────────────────────
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except Exception:
            pass  # 清理失败不影响主流程

# ════════════════════════════════════════════════════════════════
# 内部工具函数
# ════════════════════════════════════════════════════════════════

def _resolve_site_dir(site_dir: Path, site_name: str):
    """精确匹配 → 模糊匹配，返回 Path 或错误字符串"""
    exact = site_dir / f"mirror_{site_name}"
    if exact.exists():
        return exact
    matches = [d for d in site_dir.iterdir() if d.is_dir() and site_name in d.name]
    if matches:
        return matches[0]
    return f"❌ 未找到站点 '{site_name}' 的目录（在 {site_dir}）"


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Run the PeanutShile MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    
    args = parser.parse_args()
    
    if args.transport == "sse":
        print(f"Starting SSE server on http://{args.host}:{args.port}/sse")
        mcp.run(transport="sse", host=args.host, port=args.port)
    else:
        mcp.run()
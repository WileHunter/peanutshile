import { PlaywrightCrawler, ProxyConfiguration } from 'crawlee';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 类型定义
// ============================================================

/**
 * 外链记录条目
 * 每一条代表在某个页面上发现的一个外域链接
 */
interface ExternalLinkRecord {
    foundAt: string;       // 发现该链接的页面 URL
    externalUrl: string;   // 外链目标 URL
    linkText: string;      // 链接文字（空文本本身也是可疑信号）
    rel: string;           // rel 属性（nofollow / sponsored 等）
    isHidden: boolean;     // 是否对用户不可见
    hiddenReason: string;  // 隐藏原因描述
    inIframe: boolean;     // 是否为 iframe 外嵌
    timestamp: string;     // 发现时间 ISO 格式
}

// ============================================================
// 工具函数
// ============================================================

/** 从 ip.txt 读取待爬取站点列表 */
const getSitesFromIpFile = (): string[] => {
    const ipFilePath = path.join(__dirname, 'ip.txt');
    if (!fs.existsSync(ipFilePath)) return [];
    return fs.readFileSync(ipFilePath, 'utf-8')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
            if (line.startsWith('http://') || line.startsWith('https://')) return line;
            return `http://${line}`;
        });
};

const allSites = getSitesFromIpFile();

/** 从命令行参数或环境变量获取单次爬取目标（优先级最高） */
const getCliUrl = (): string | undefined => {
    const arg = process.argv.find(a => a.startsWith('http://') || a.startsWith('https://'));
    if (arg) return arg;
    return process.env.CRAWLEE_TARGET_URL;
};

/** 检测代理是否可达 */
const isProxyReachable = async (): Promise<boolean> => {
    try {
        if (!config.proxy.enabled || !config.proxy.urls?.length) return false;
        const first = new URL(config.proxy.urls[0]);
        const port = Number(first.port || (first.protocol === 'https:' ? 443 : 80));
        const host = first.hostname;
        await new Promise<void>((resolve, reject) => {
            const socket = net.createConnection({ host, port, timeout: 1500 }, () => {
                socket.end();
                resolve();
            });
            socket.on('error', reject);
            socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        });
        return true;
    } catch {
        return false;
    }
};

const getProxyConfiguration = async () => {
    const ok = await isProxyReachable();
    return ok ? new ProxyConfiguration({ proxyUrls: config.proxy.urls }) : undefined;
};

/**
 * 生成稳定的输出目录名
 * - IP 地址：点替换为下划线（192.168.1.1 → 192_168_1_1）
 * - 普通域名：取后三段防止子域名冲突（bbs.example.co.uk → example_co_uk）
 */
const getOutputDir = (siteUrl: string): string => {
    try {
        const hostname = new URL(siteUrl).hostname;
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
            return path.join(__dirname, config.output.baseDir, `mirror_${hostname.replace(/\./g, '_')}`);
        }
        const parts = hostname.split('.');
        const mainDomain = parts.slice(-Math.min(parts.length, 3)).join('_');
        return path.join(__dirname, config.output.baseDir, `mirror_${mainDomain}`);
    } catch {
        return path.join(__dirname, config.output.baseDir, 'mirror_default');
    }
};

// ============================================================
// URL 模式去重器
// ============================================================

/**
 * 将 URL 路径（含 hash 路由解码）模板化，同一模式只采样前 N 个。
 *
 * 归一化规则：
 *   纯数字段     → {id}    （/book/123 → /book/{id}）
 *   纯 hex hash  → {hash}  （/abc1f2e3 → /{hash}）
 *   含数字 slug  → {slug}  （/post-456 → /{slug}）
 *
 * Hash 路由解码顺序：
 *   标准路由(#/xxx) → URL编码 → Base64 → 下划线自定义路由
 */
class UrlPatternDeduplicator {
    private patternCounts = new Map<string, number>();
    private readonly maxPerPattern: number;

    constructor(maxPerPattern = 2) {
        this.maxPerPattern = maxPerPattern;
    }

    private normalizePath(pathname: string): string {
        return pathname
            .split('/')
            .map(seg => {
                if (!seg) return seg;
                if (/^\d+$/.test(seg)) return '{id}';
                if (/^[a-f0-9]{8,}$/i.test(seg)) return '{hash}';
                if (/^[a-z0-9\-_]*\d{3,}[a-z0-9\-_]*$/i.test(seg)) return '{slug}';
                return seg;
            })
            .join('/');
    }

    decodeHashFragment(hash: string): string {
        if (!hash || hash === '#') return '';
        const raw = hash.slice(1);

        // 标准 hash 路由：#/xxx 或 #!/xxx
        if (raw.startsWith('/') || raw.startsWith('!/')) return raw.replace(/^!/, '');

        // URL 编码
        try {
            const decoded = decodeURIComponent(raw);
            if (decoded.startsWith('/') || decoded.startsWith('http')) return decoded;
        } catch { /* ignore */ }

        // Base64
        try {
            const padded = raw + '=='.slice((raw.length % 4) || 4);
            const decoded = Buffer.from(padded, 'base64').toString('utf-8');
            if (decoded.startsWith('/') || decoded.startsWith('http')) return decoded;
        } catch { /* ignore */ }

        // 自定义下划线路由：#book_123_detail → /book/123/detail
        if (/^[a-z]+_/i.test(raw)) return '/' + raw.replace(/_/g, '/');

        return raw;
    }

    shouldCrawl(url: string): boolean {
        try {
            const parsed = new URL(url);
            let logicalPath = parsed.pathname;

            if (parsed.hash) {
                const decoded = this.decodeHashFragment(parsed.hash);
                if (decoded.startsWith('/')) logicalPath = decoded;
                else if (decoded) logicalPath = parsed.pathname + '/' + decoded;
            }

            const pattern = this.normalizePath(logicalPath);
            if (pattern === logicalPath) return true; // 无数字段，不限制

            const key = parsed.origin + '::' + pattern;
            const count = this.patternCounts.get(key) || 0;
            if (count >= this.maxPerPattern) return false;

            this.patternCounts.set(key, count + 1);
            return true;
        } catch {
            return true;
        }
    }

    reset() { this.patternCounts.clear(); }

    dump(): string {
        return [...this.patternCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([p, c]) => `  ${p}  (${c}次)`)
            .join('\n');
    }
}

// ============================================================
// 外链 + 暗链审计收集器
// ============================================================

/**
 * 收集、去重、落盘所有外链记录，同时输出 JSON 和 CSV。
 *
 * 检测维度：
 *  1. display:none / visibility:hidden / opacity:0 / 字号极小 → 视觉隐藏
 *  2. rel="nofollow" / "sponsored" / "ugc"                    → SEO 异常信号
 *  3. iframe src 外域（含 1px 隐藏 iframe）                    → 嵌入式暗链
 *  4. 链接文本为空或仅空白                                      → 隐形链接
 */
class ExternalLinkCollector {
    private records: ExternalLinkRecord[] = [];
    private seen = new Set<string>();
    private readonly targetHostname: string;

    constructor(targetHostname: string) {
        this.targetHostname = targetHostname;
    }

    addRecords(items: ExternalLinkRecord[]) {
        for (const item of items) {
            const key = item.foundAt + '||' + item.externalUrl;
            if (this.seen.has(key)) continue;
            this.seen.add(key);
            this.records.push(item);
        }
    }

    get count() { return this.records.length; }

    /** 写入 JSON + CSV 到 _audit 目录 */
    flush(mirrorDir: string) {
        if (this.records.length === 0) {
            console.log(`\n✅ [${this.targetHostname}] 未发现外链`);
            return;
        }

        const auditDir = path.join(mirrorDir, '_audit');
        fs.mkdirSync(auditDir, { recursive: true });

        // JSON（便于程序处理）
        const jsonPath = path.join(auditDir, 'external_links.json');
        fs.writeFileSync(jsonPath, JSON.stringify(this.records, null, 2), 'utf-8');

        // CSV（便于 Excel 直接打开分析）
        const csvPath = path.join(auditDir, 'external_links.csv');
        const header = 'foundAt,externalUrl,linkText,rel,isHidden,hiddenReason,inIframe,timestamp';
        const rows = this.records.map(r =>
            [
                r.foundAt,
                r.externalUrl,
                r.linkText.replace(/,/g, '，').replace(/\n/g, ' ').slice(0, 100),
                r.rel,
                r.isHidden,
                r.hiddenReason,
                r.inIframe,
                r.timestamp,
            ]
                .map(v => `"${String(v).replace(/"/g, '""')}"`)
                .join(',')
        );
        fs.writeFileSync(csvPath, [header, ...rows].join('\n'), 'utf-8');

        const hiddenCount = this.records.filter(r => r.isHidden).length;
        const iframeCount = this.records.filter(r => r.inIframe).length;

        console.log(`\n🔍 外链审计报告已输出:`);
        console.log(`   JSON → ${jsonPath}`);
        console.log(`   CSV  → ${csvPath}`);
        console.log(`   总外链: ${this.records.length} 条`);
        console.log(`   隐藏外链: ${hiddenCount} 条 ${hiddenCount > 0 ? '⚠️' : '✅'}`);
        console.log(`   外域 iframe: ${iframeCount} 条 ${iframeCount > 0 ? '⚠️' : '✅'}`);
    }
}

// ============================================================
// 核心爬取函数
// ============================================================

async function crawlSite(siteUrl: string) {
    let targetHostname = '';
    try {
        const hostname = new URL(siteUrl).hostname;
        targetHostname = hostname.startsWith('www.') ? hostname.slice(4) : hostname;
    } catch {
        console.error(`无法解析站点 URL: ${siteUrl}`);
        return;
    }
    if (!targetHostname) return;

    const MIRROR_DIR = getOutputDir(siteUrl);
    const pathCounters = new Map<string, number>();
    const patternDedup = new UrlPatternDeduplicator(config.crawler.maxSamplePerPattern ?? 2);
    const externalCollector = new ExternalLinkCollector(targetHostname);

    console.log(`\n========================================`);
    console.log(`🎯 正在启动爬取: ${siteUrl}`);
    console.log(`📁 输出目录: ${MIRROR_DIR}`);
    const proxyConfiguration = await getProxyConfiguration();
    console.log(`🔧 代理状态: ${proxyConfiguration ? '已启用' : '未启用/不可用'}`);
    console.log(`⏱️ 时间限制: ${config.crawler.maxCrawlTime > 0 ? `${config.crawler.maxCrawlTime}秒` : '无限制'}`);
    console.log(`========================================\n`);

    // ── 文件保存 ──────────────────────────────────────────────

    const saveFile = (url: string, buffer: Buffer | string) => {
        try {
            const parsedUrl = new URL(url);
            const ext = path.extname(parsedUrl.pathname).toLowerCase();

            if (config.output.ignoredExtensions.includes(ext)) return;

            const dir = path.dirname(parsedUrl.pathname);
            const currentCount = pathCounters.get(dir) || 0;
            const isTargetJS = ext === '.js' && config.output.saveJs;

            if (!isTargetJS && currentCount >= config.output.maxResourcesPerPath) return;

            const isHostContent = parsedUrl.hostname.includes(targetHostname);
            if (!isHostContent && !isTargetJS) return;

            let relativePath = path.join(parsedUrl.hostname, parsedUrl.pathname);
            if (relativePath.endsWith('/') || !path.extname(relativePath)) {
                relativePath = path.join(relativePath, 'index.html');
            }

            const filePath = path.join(MIRROR_DIR, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, buffer);

            if (!isTargetJS) pathCounters.set(dir, currentCount + 1);
        } catch { /* ignore */ }
    };

    // ── 截图 ────────

    const takeSnapshot = async (page: any, url: string) => {
        if (!config.output.takeSnapshot) return;
        try {
            const parsedUrl = new URL(url);
            let logicalPath = parsedUrl.pathname;

            if (parsedUrl.hash) {
                try {
                    const d = decodeURIComponent(parsedUrl.hash.slice(1));
                    if (d.startsWith('/')) logicalPath = d;
                } catch { /* ignore */ }
            }

            const baseName = logicalPath.replace(/\.[^/.]+$/, '') || '/index';
            const snapshotPath = path.join(
                MIRROR_DIR,
                parsedUrl.hostname,
                'snapshot',   // 独立子目录
                baseName + '.png'
            );
            fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
            await page.screenshot({ path: snapshotPath, fullPage: true });
        } catch { /* ignore */ }
    };

    // ── 外链 / 暗链特征提取 ───────────────────────────────────

    /**
     * 在浏览器上下文中提取当前页面所有外域链接及可疑特征。
     * 使用 page.evaluate 序列化传参，避免闭包跨边界问题。
     */
    const extractExternalLinks = async (
        page: any,
        pageUrl: string,
    ): Promise<ExternalLinkRecord[]> => {
        return page.evaluate(
            ({ pageUrl, targetHostname, ts }: { pageUrl: string; targetHostname: string; ts: string }) => {
                const records: any[] = [];
                const now = ts;

                const isExternal = (href: string) => {
                    try {
                        const h = new URL(href).hostname;
                        return !h.includes(targetHostname) && href.startsWith('http');
                    } catch { return false; }
                };

                const getHiddenInfo = (el: Element): { hidden: boolean; reason: string } => {
                    const s = window.getComputedStyle(el);
                    if (s.display === 'none') return { hidden: true, reason: 'display:none' };
                    if (s.visibility === 'hidden') return { hidden: true, reason: 'visibility:hidden' };
                    if (parseFloat(s.opacity) === 0) return { hidden: true, reason: 'opacity:0' };
                    if (parseInt(s.fontSize) <= 1) return { hidden: true, reason: 'font-size≤1px' };
                    if (parseInt(s.width) <= 1 || parseInt(s.height) <= 1) return { hidden: true, reason: 'zero-size' };
                    return { hidden: false, reason: '' };
                };

                // 1. 所有 <a> 外链
                document.querySelectorAll('a[href]').forEach((el: Element) => {
                    const a = el as HTMLAnchorElement;
                    if (!isExternal(a.href)) return;

                    const { hidden, reason } = getHiddenInfo(a);
                    records.push({
                        foundAt: pageUrl,
                        externalUrl: a.href,
                        linkText: a.textContent?.trim() || a.getAttribute('aria-label') || '',
                        rel: a.rel || '',
                        isHidden: hidden,
                        hiddenReason: reason,
                        inIframe: false,
                        timestamp: now,
                    });
                });

                // 2. 外域 iframe（含 1px 隐藏 iframe）
                document.querySelectorAll('iframe[src]').forEach((el: Element) => {
                    const iframe = el as HTMLIFrameElement;
                    if (!isExternal(iframe.src)) return;

                    const { hidden, reason } = getHiddenInfo(iframe);
                    records.push({
                        foundAt: pageUrl,
                        externalUrl: iframe.src,
                        linkText: iframe.getAttribute('title') || '[iframe]',
                        rel: '',
                        isHidden: hidden,
                        hiddenReason: reason,
                        inIframe: true,
                        timestamp: now,
                    });
                });

                return records;
            },
            { pageUrl, targetHostname, ts: new Date().toISOString() }
        );
    };

    // ── 爬虫实例 ─────────────────────────────────────────────

    let shouldStop = false;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        maxRequestsPerCrawl: config.crawler.maxRequestsPerCrawl ?? 100,
        maxRequestRetries: 0,
        browserPoolOptions: {
            useFingerprints: true,
            fingerprintOptions: {
                fingerprintGeneratorOptions: config.fingerprint as any,
            },
        },
        launchContext: {
            launchOptions: {
                headless: config.crawler.headless,
                args: [
                    '--disable-blink-features=AutomationControlled',
                    '--no-sandbox',
                ],
            },
        },
        maxConcurrency: config.crawler.maxConcurrency,
        navigationTimeoutSecs: config.crawler.navigationTimeoutSecs,

        preNavigationHooks: [
            async ({ page }) => {
                await page.setExtraHTTPHeaders(config.headers);
                await page.addInitScript(() => {
                    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                    Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 });
                });

                // 拦截响应保存静态资源；每个新 page 对象只注册一次
                page.on('response', async (response: any) => {
                    if (response.status() === 200) {
                        try {
                            const buffer = await response.body();
                            saveFile(response.url(), buffer);
                        } catch { /* ignore */ }
                    }
                });
            },
        ],

        async requestHandler({ page, request, enqueueLinks, log }) {
            if (shouldStop) return;

            // 模式去重：处理前再判断一次（入队后配额可能已满）
            if (!patternDedup.shouldCrawl(request.url)) {
                log.debug(`[模式重复跳过]: ${request.url}`);
                return;
            }

            log.info(`正在处理: ${request.url}`);
            await page.waitForTimeout(config.crawler.delays.cloudflare);

            // Cloudflare 挑战检测（精确特征，避免误判正常页面）
            const hasCFChallenge: boolean = await page.evaluate(() => {
                return !!(
                    document.querySelector('#cf-challenge-running') ||
                    document.querySelector('#cf-please-wait') ||
                    document.querySelector('.cf-browser-verification') ||
                    (document.title || '').toLowerCase().includes('just a moment')
                );
            });
            if (hasCFChallenge) {
                log.info('检测到 Cloudflare 挑战，等待中...');
                await page.waitForTimeout(config.crawler.delays.retryWait);
            }

            await page.waitForSelector('body');

            // 模拟滚动触发懒加载内容
            await page.evaluate(async (interval: number) => {
                await new Promise((resolve) => {
                    let totalHeight = 0;
                    const timer = setInterval(() => {
                        window.scrollBy(0, 100);
                        totalHeight += 100;
                        if (totalHeight >= document.body.scrollHeight) {
                            clearInterval(timer);
                            resolve(true);
                        }
                    }, interval);
                });
            }, config.crawler.delays.scrollInterval);

            await page.waitForLoadState('networkidle', {
                timeout: config.crawler.delays.networkIdle,
            }).catch(() => { /* 超时不中断 */ });

            // 保存最终渲染后的 HTML 和截图
            const finalHtml = await page.content();
            saveFile(request.url, finalHtml);
            await takeSnapshot(page, request.url);

            // ── 外链 / 暗链审计（核心产物） ──────────────────

            try {
                const externalLinks = await extractExternalLinks(page, request.url);
                if (externalLinks?.length) {
                    externalCollector.addRecords(externalLinks);
                    const hiddenCount = externalLinks.filter(r => r.isHidden).length;
                    const iframeCount = externalLinks.filter(r => r.inIframe).length;
                    if (hiddenCount > 0) log.warning(`⚠️  隐藏外链 ${hiddenCount} 条: ${request.url}`);
                    if (iframeCount > 0) log.warning(`⚠️  外域 iframe ${iframeCount} 个: ${request.url}`);
                }
            } catch { /* ignore */ }

            // ── SPA / Hash 路由探测 ──────────────────────────

            const isSPA: boolean = await page.evaluate(() => {
                return !!(
                    (window as any).__vue_router__ ||
                    (window as any).__NEXT_DATA__ ||
                    document.querySelector('[data-reactroot]') ||
                    document.querySelector('#app') ||
                    document.querySelector('#root')
                );
            });

            if (isSPA) {
                const hashLinks: string[] = await page.evaluate(() => {
                    const links = new Set<string>();
                    document.querySelectorAll('a[href*="#"]').forEach(a => {
                        const href = (a as HTMLAnchorElement).href;
                        if (href.includes('#')) links.add(href);
                    });
                    return [...links];
                });

                for (const hashUrl of hashLinks) {
                    if (shouldStop) break;
                    if (!patternDedup.shouldCrawl(hashUrl)) continue;
                    try {
                        await page.goto(hashUrl, { waitUntil: 'networkidle', timeout: 15000 });
                        const html = await page.content();
                        saveFile(hashUrl, html);
                        await takeSnapshot(page, hashUrl);

                        // hash 路由页面同样做外链审计
                        const hashExternalLinks = await extractExternalLinks(page, hashUrl);
                        if (hashExternalLinks?.length) externalCollector.addRecords(hashExternalLinks);
                    } catch { /* 单页失败不影响整体 */ }
                }
            }

            // ── 同域链接入队（整站爬取，所有路径均跟进） ────────

            await enqueueLinks({
                strategy: 'same-hostname',
                selector: 'a[href]',
                transformRequestFunction: (req) => {
                    if (shouldStop) return null;
                    try {
                        const u = new URL(req.url);
                        const dir = path.dirname(u.pathname);
                        const ext = path.extname(u.pathname).toLowerCase();
                        const isTargetJS = ext === '.js' && config.output.saveJs;

                        // 目录资源数量上限
                        if (!isTargetJS) {
                            const count = pathCounters.get(dir) || 0;
                            if (count >= config.output.maxResourcesPerPath) return null;
                        }

                        // 模式去重在入队阶段提前剪枝，减少无效请求
                        if (!patternDedup.shouldCrawl(req.url)) return null;

                        return req;
                    } catch {
                        return null;
                    }
                },
            });
        },

        failedRequestHandler({ request, log }) {
            log.error(`[请求失败]: ${request.url} - ${request.errorMessages?.join(', ')}`);
        },
    });

    // ── 超时停止：标志位 + autoscaledPool abort ──────────────

    let timeoutId: NodeJS.Timeout | undefined;
    if (config.crawler.maxCrawlTime > 0) {
        timeoutId = setTimeout(() => {
            console.warn(`\n⏰ 站点爬取超时 (${config.crawler.maxCrawlTime}秒)，正在标记停止...`);
            shouldStop = true;
            // 给正在进行的请求收尾时间，再中止队列
            setTimeout(async () => {
                try { await (crawler as any).autoscaledPool?.abort(); } catch { /* ignore */ }
            }, 3000);
        }, config.crawler.maxCrawlTime * 1000);
    }

    try {
        await crawler.run([siteUrl]);
    } catch (err) {
        console.error(`爬取站点 ${siteUrl} 时发生错误:`, err);
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
        // 落盘外链审计报告（JSON + CSV）
        externalCollector.flush(MIRROR_DIR);

        if (config.debug) {
            console.log(`\n📊 [${targetHostname}] URL模式统计:\n${patternDedup.dump()}`);
        }
    }
}

// ============================================================
// 主程序入口
// ============================================================

(async () => {
    const cliUrl = getCliUrl();

    const sitesToCrawl = cliUrl ? [cliUrl] : allSites;

    if (sitesToCrawl.length === 0) {
        console.error('❌ 错误: 未找到任何待爬取站点。请检查 ip.txt 或传入目标 URL。');
        process.exit(1);
    }

    if (cliUrl) {
        console.log(`🎯 单次爬取模式: ${cliUrl}`);
    } else {
        console.log(`🚀 开始批量爬取任务，共 ${allSites.length} 个站点...`);
    }

    for (let i = 0; i < sitesToCrawl.length; i++) {
        console.log(`\n[任务 ${i + 1}/${sitesToCrawl.length}]`);
        await crawlSite(sitesToCrawl[i]);
    }

    console.log('\n✨ 所有批量爬取任务已完成！');
})();
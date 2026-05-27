/**
 * 配置文件
 */
export const config = {
    // 代理配置
    proxy: {
        enabled: true,
        urls: [
            'http://127.0.0.1:1801'
        ]
    },

    // 输出目录配置
    output: {
        baseDir: '../site',  // 基础输出目录，会自动根据目标域名创建子目录
        saveJs: true, // 是否保存 JS 文件
        // 不需要保存的资源类型
        ignoredExtensions: ['.mp4', '.m4a', '.ts', '.m3u8', '.css', '.woff', '.woff2', '.ttf'],
        // 同一目录下允许保存的最大文件数量 (防止无限制爬取列表页)
        maxResourcesPerPath: 5,
        takeSnapshot: true,// 是否截图
    },

    // 爬虫行为配置
    crawler: {
        // 爬取策略
        strategy: 'prefix',       // 'prefix'=路径前缀限制 | 'hostname'=整站 | 'seed-only'=只爬种子页
        maxDepth: 3,              // 最大跳数（从种子页算起）
        maxConcurrency: 10, // 并发数
        navigationTimeoutSecs: 60, // 导航超时
        headless: true, // 是否无头模式，true不显示浏览器窗口/false显示浏览器窗口
        maxCrawlTime: 300, // 每个站点最大爬取时间 (秒)，0 为一直爬取直到爬完，默认 5 分钟
        maxSamplePerPattern: 2, // 同 URL 模式最多采样几个
        maxRequestsPerCrawl: 100, // 每个站点最大请求数，0 为一直爬取直到爬完，默认 1000
        
        // 外链行为（暗链审计核心）
        recordExternalLinks: true,  // 是否记录外域链接（不跟进，只记录）
        externalLinksFile: 'external_links.json',  // 外链输出文件
        
        // 延时设置 (毫秒)
        delays: {
            cloudflare: 7000, // 初始等待 Cloudflare 5秒盾的时间
            retryWait: 5000,  // 检测到挑战失败后的重试等待时间
            scrollInterval: 50, // 滚动间隔
            networkIdle: 15000, // 网络空闲等待超时
        }
    },

    // 浏览器指纹与 Headers 配置
    headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36 EdgA/140.0.0.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,zh-TW;q=0.8,zh-HK;q=0.7,en-US;q=0.6,en;q=0.5',
        // 请在此处更新 Cookie 字符串
        'Cookie': 'PHPSESSID=udl9suvrmmkfebfm3voptud3i2; server_name_session=c1fd4e01d21387d0ac5e3624f0fe5d1b; __mxau__c2-oRHNxnsm=1c7f71ba-27bd-40c1-bc0c-be1edb2f7c0a; __mxaf__c2-oRHNxnsm=1772184749; __mxas__c2-oRHNxnsm=%7B%22sid%22%3A%229726ee4a-7e43-4b12-9cf4-1641b52b2ec5%22%2C%22vd%22%3A2%2C%22stt%22%3A24%2C%22dr%22%3A24%2C%22expires%22%3A1772186573%2C%22ct%22%3A1772184773%7D; __mxav__c2-oRHNxnsm=2; HISTORY={video:[{"name":"\u5B97\u95E8\u91CC\u9664\u4E86\u6211\u90FD\u662F\u5367\u5E95","link":"https://www.516dm.com/comic/5127270.html","pic":"https://shandianpic.vip/upload/vod/20250414-1/307429ca05a158247027c2252c96c2f9.jpg"}]}',
        'sec-ch-ua-platform': '"Android"',
        'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="137", "Edge";v="137"',
        'sec-ch-ua-mobile': '?1',
        'Priority': 'u=0, i',
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
    },
    
    // 指纹生成器配置
    fingerprint: {
        browsers: ['chrome', 'edge'] as const,
        devices: ['mobile'] as const,
        operatingSystems: ['android'] as const,
    },

    debug: false,
};

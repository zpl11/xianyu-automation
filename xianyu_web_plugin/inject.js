// Xianyu Monitor - 网络请求拦截器 (注入到页面主环境)
// 劫持 fetch 和 XMLHttpRequest，捕获闲鱼所有 API 数据

(function() {
    'use strict';
    
    const XIANYU_DOMAINS = ['goofish.com', 'taobao.com', 'h5api.m.goofish.com', 'api.m.goofish.com'];
    const EXCLUDE_EXTS = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot|webp|wasm|mp4|mp3)$/i;
    
    function isXianyuAPI(url) {
        if (!url || typeof url !== 'string') return false;
        return XIANYU_DOMAINS.some(d => url.includes(d)) && !EXCLUDE_EXTS.test(url);
    }
    
    // 1. 劫持 fetch
    const originalFetch = window.fetch;
    if (originalFetch) {
        window.fetch = async function(...args) {
            const requestInfo = args[0];
            const url = typeof requestInfo === 'string' ? requestInfo : (requestInfo?.url || '');
            const method = (args[1]?.method || requestInfo?.method || 'GET').toUpperCase();
            
            const startTime = Date.now();
            
            try {
                const response = await originalFetch.apply(this, args);
                
                if (isXianyuAPI(url)) {
                    const clone = response.clone();
                    const contentType = response.headers?.get('content-type') || '';
                    
                    if (contentType.includes('json') || url.includes('mtop') || url.includes('h5api')) {
                        clone.text().then(text => {
                            if (text && text.length > 20) {
                                window.postMessage({
                                    type: "XIANYU_INTERCEPT_FETCH",
                                    url: url,
                                    method: method,
                                    data: text,
                                    timestamp: Date.now(),
                                    responseStatus: response.status
                                }, "*");
                            }
                        }).catch(() => {});
                    }
                }
                
                return response;
            } catch (err) {
                // fetch 失败时也恢复原始行为
                throw err;
            }
        };
    }
    
    // 2. 劫持 XMLHttpRequest
    const originalXHR = window.XMLHttpRequest;
    if (originalXHR) {
        function PatchedXHR() {
            const xhr = new originalXHR();
            let interceptedUrl = '';
            
            const originalOpen = xhr.open.bind(xhr);
            xhr.open = function(method, url, ...rest) {
                interceptedUrl = url;
                return originalOpen(method, url, ...rest);
            };
            
            const originalSend = xhr.send.bind(xhr);
            xhr.send = function(body) {
                // 保存 post body
                if (isXianyuAPI(interceptedUrl)) {
                    this.addEventListener('readystatechange', function() {
                        if (this.readyState === 4 && this.status === 200) {
                            const respText = this.responseText;
                            if (respText && respText.length > 20) {
                                window.postMessage({
                                    type: "XIANYU_INTERCEPT_XHR",
                                    url: this.responseURL || interceptedUrl,
                                    method: body ? 'POST' : 'GET',
                                    data: respText,
                                    timestamp: Date.now(),
                                    responseStatus: this.status
                                }, "*");
                            }
                        }
                    });
                }
                return originalSend(body);
            };
            
            return xhr;
        }
        
        // 复制静态属性
        for (let prop in originalXHR) {
            if (originalXHR.hasOwnProperty(prop)) {
                try {
                    PatchedXHR[prop] = originalXHR[prop];
                } catch(e) {}
            }
        }
        
        window.XMLHttpRequest = PatchedXHR;
    }
    
    // 3. 定时扫描当前页面 DOM 中的商品数据（兜底方案）
    setInterval(() => {
        try {
            const items = [];
            // 查找所有可能包含商品数据的元素
            const allFeeds = document.querySelectorAll('[class*="feeds-item"], [class*="card"], [class*="item-wrap"]');
            
            allFeeds.forEach(el => {
                const text = el.textContent || '';
                // 找 "人想要" 模式
                const wantMatch = text.match(/(\d+)\s*人想要/);
                const priceMatch = text.match(/[¥￥]\s*(\d+(\.\d+)?)/);
                const titleEl = el.querySelector('[class*="title"], [class*="Title"]');
                const title = titleEl?.textContent?.trim() || '';
                
                if (wantMatch && title) {
                    const link = el.closest('a');
                    const href = link?.href || '';
                    
                    window.postMessage({
                        type: "XIANYU_DOM_SCRAPE",
                        data: {
                            title: title.substring(0, 100),
                            price: priceMatch ? priceMatch[1] : '0',
                            wantCount: parseInt(wantMatch[1], 10),
                            url: href,
                            timestamp: Date.now()
                        }
                    }, "*");
                }
            });
        } catch(e) {
            // silent
        }
    }, 3000); // 每3秒扫描一次
    
})();

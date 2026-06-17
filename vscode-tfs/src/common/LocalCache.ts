import * as vscode from "vscode"

interface CacheEntry<T> {
    value: T;
    timestamp: number;
    ttl?: number;
    accessCount: number;
    lastAccessed: number;
}

interface CacheStats {
    hits: number;
    misses: number;
    evictions: number;
    sets: number;
}

interface LRUCacheEntry<T> {
    value: T;
    prev: string | null;
    next: string | null;
    timestamp: number;
    ttl?: number;
}

export class LocalCache {
    private static instance: LocalCache;
    private cache = new Map<string, CacheEntry<any>>();
    private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    private maxSize: number;
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(private context: vscode.ExtensionContext) {
        this.maxSize = vscode.workspace.getConfiguration('tfs').get('cache.maxSize', 100);
        this.startCleanupInterval();
    }

    public static getInstance(context: vscode.ExtensionContext): LocalCache {
        if (!LocalCache.instance) {
            LocalCache.instance = new LocalCache(context);
        }
        return LocalCache.instance;
    }

    private getWorkspaceState() {
        return this.context.workspaceState;
    }

    // 增强的 getValue，支持 TTL 和统计
    getValue<T>(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (entry) {
            // 检查 TTL
            if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                this.stats.misses++;
                return undefined;
            }

            // 更新访问统计
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.hits++;
            return entry.value;
        }

        // 回退检查工作区状态
        const workspaceValue = this.getWorkspaceState().get<T>(key);
        if (workspaceValue !== undefined) {
            this.stats.hits++;
            // 本地缓存
            this.setValue(key, workspaceValue);
            return workspaceValue;
        }

        this.stats.misses++;
        return undefined;
    }

    // 增强的 setValue，支持 TTL
    setValue<T>(key: string, value: T, ttl?: number): void {
        const entry: CacheEntry<T> = {
            value,
            timestamp: Date.now(),
            ttl,
            accessCount: 0,
            lastAccessed: Date.now()
        };

        this.cache.set(key, entry);
        this.stats.sets++;

        // 持久化到工作区状态
        this.getWorkspaceState().update(key, value);

        // 强制执行大小限制
        this.enforceSizeLimit();
    }

    // 添加值，可选 TTL
    addValue<T>(key: string, value: T, ttl?: number): void {
        this.setValue(key, value, ttl);
    }

    // 获取所有键
    getAllKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    // 获取缓存统计
    getStats(): CacheStats {
        return { ...this.stats };
    }

    // 清除过期条目
    clearExpired(): number {
        let cleared = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                cleared++;
            }
        }
        return cleared;
    }

    // 清除所有缓存条目
    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    }

    // 使特定键失效
    invalidate(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.getWorkspaceState().update(key, undefined);
        }
        return deleted;
    }

    // 获取缓存大小
    size(): number {
        return this.cache.size;
    }

    // 检查键是否存在且未过期
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    private enforceSizeLimit(): void {
        if (this.cache.size <= this.maxSize) return;

        // LRU 淘汰: 移除最近最少访问的条目
        const entries = Array.from(this.cache.entries());
        entries.sort((a, b) => a[1].lastAccessed - b[1].lastAccessed);

        const toRemove = this.cache.size - this.maxSize;
        for (let i = 0; i < toRemove; i++) {
            const [key] = entries[i];
            this.cache.delete(key);
            this.stats.evictions++;
        }
    }

    private startCleanupInterval(): void {
        // 每 5 分钟清理过期条目
        this.cleanupInterval = setInterval(() => {
            this.clearExpired();
        }, 5 * 60 * 1000);
    }

    // 扩展停用时清理资源
    dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

/**
 * 高性能 LRU 缓存，使用双向链表实现 O(1) 操作
 * 针对 TFS 操作中常见的高频访问模式进行了优化
 */
export class HighPerformanceLRUCache<T> {
    private cache = new Map<string, LRUCacheEntry<T>>();
    private head: string | null = null; // 最近使用的
    private tail: string | null = null; // 最少使用的
    private maxSize: number;
    private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, sets: 0 };

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    /**
     * 以 O(1) 复杂度从缓存中获取值
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return undefined;
        }

        // 检查 TTL
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            this.stats.misses++;
            return undefined;
        }

        // 移到前面（最近使用）
        this.moveToFront(key);
        this.stats.hits++;
        return entry.value;
    }

    /**
     * 以 O(1) 复杂度设置缓存值
     */
    set(key: string, value: T, ttl?: number): void {
        const now = Date.now();

        if (this.cache.has(key)) {
            // 更新现有条目
            const entry = this.cache.get(key)!;
            entry.value = value;
            entry.timestamp = now;
            entry.ttl = ttl;
            this.moveToFront(key);
        } else {
            // 添加新条目
            const entry: LRUCacheEntry<T> = {
                value,
                prev: null,
                next: this.head,
                timestamp: now,
                ttl
            };

            this.cache.set(key, entry);

            // 更新链表
            if (this.head) {
                this.cache.get(this.head)!.prev = key;
            }
            this.head = key;

            if (!this.tail) {
                this.tail = key;
            }

            this.stats.sets++;

            // 强制执行大小限制
            if (this.cache.size > this.maxSize) {
                this.evictLRU();
            }
        }
    }

    /**
     * 从缓存中删除条目
     */
    delete(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // 从链表中移除
        if (entry.prev) {
            this.cache.get(entry.prev)!.next = entry.next;
        } else {
            this.head = entry.next;
        }

        if (entry.next) {
            this.cache.get(entry.next)!.prev = entry.prev;
        } else {
            this.tail = entry.prev;
        }

        this.cache.delete(key);
        return true;
    }

    /**
     * 检查键是否存在
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // 检查 TTL
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            return false;
        }

        return true;
    }

    /**
     * 获取缓存大小
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * 清除所有条目
     */
    clear(): void {
        this.cache.clear();
        this.head = null;
        this.tail = null;
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    }

    /**
     * 获取缓存统计
     */
    getStats(): CacheStats {
        return { ...this.stats };
    }

    /**
     * 获取命中率
     */
    getHitRate(): number {
        const total = this.stats.hits + this.stats.misses;
        return total === 0 ? 0 : this.stats.hits / total;
    }

    /**
     * 清理过期条目
     */
    cleanExpired(): number {
        let cleaned = 0;
        const now = Date.now();
        const keysToDelete: string[] = [];

        for (const [key, entry] of this.cache.entries()) {
            if (entry.ttl && now - entry.timestamp > entry.ttl) {
                keysToDelete.push(key);
            }
        }

        for (const key of keysToDelete) {
            this.delete(key);
            cleaned++;
        }

        return cleaned;
    }

    private moveToFront(key: string): void {
        const entry = this.cache.get(key)!;

        if (key === this.head) return; // 已经在最前面

        // 从当前位置移除
        if (entry.prev) {
            this.cache.get(entry.prev)!.next = entry.next;
        }

        if (entry.next) {
            this.cache.get(entry.next)!.prev = entry.prev;
        } else {
            this.tail = entry.prev;
        }

        // 移到最前面
        entry.prev = null;
        entry.next = this.head;

        if (this.head) {
            this.cache.get(this.head)!.prev = key;
        }
        this.head = key;

        if (!this.tail) {
            this.tail = key;
        }
    }

    private evictLRU(): void {
        if (!this.tail) return;

        const lruKey = this.tail;
        this.delete(lruKey);
        this.stats.evictions++;
    }
}

/**
 * TFS 状态操作专用缓存，具有智能 TTL 管理
 * 当文件更改时自动使缓存条目失效
 */
export class TFSStatusCache {
    private static instance: TFSStatusCache;
    private cache: HighPerformanceLRUCache<any[]>;
    private fileWatchers = new Map<string, vscode.FileSystemWatcher>();
    private defaultTTL: number;

    private constructor() {
        this.cache = new HighPerformanceLRUCache<any[]>(500); // 缓存最多 500 个状态结果
        this.defaultTTL = vscode.workspace.getConfiguration('tfs').get('statusCache.ttl', 30000); // 默认 30 秒
        this.setupFileWatchers();
    }

    public static getInstance(): TFSStatusCache {
        if (!TFSStatusCache.instance) {
            TFSStatusCache.instance = new TFSStatusCache();
        }
        return TFSStatusCache.instance;
    }

    /**
     * 获取 URI 的缓存状态
     */
    getStatus(uri: vscode.Uri): any[] | undefined {
        const key = this.getCacheKey(uri);
        return this.cache.get(key);
    }

    /**
     * 设置 URI 的缓存状态及 TTL
     */
    setStatus(uri: vscode.Uri, status: any[], ttl?: number): void {
        const key = this.getCacheKey(uri);
        this.cache.set(key, status, ttl || this.defaultTTL);
    }

    /**
     * 使特定 URI 的缓存失效
     */
    invalidate(uri: vscode.Uri): void {
        const key = this.getCacheKey(uri);
        this.cache.delete(key);
    }

    /**
     * 使目录及其所有子目录的缓存失效
     */
    invalidateDirectory(directoryUri: vscode.Uri): void {
        const directoryKey = this.getCacheKey(directoryUri);

        // 找到所有以该目录路径开头的键
        const keysToDelete: string[] = [];
        // 注意: HighPerformanceLRUCache 不直接暴露键，
        // 所以我们需要单独跟踪或使用不同的方法

        // 目前，当目录发生变化时，清除整个缓存
        // TODO: 实现更细粒度的缓存失效
        this.cache.clear();
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        return this.cache.getStats();
    }

    /**
     * 获取命中率
     */
    getHitRate(): number {
        return this.cache.getHitRate();
    }

    /**
     * 清除所有缓存状态
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * 设置文件系统监视器以自动使缓存失效
     */
    private setupFileWatchers(): void {
        // 监视工作区中的文件更改
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');

        // 监视文件更改
        const changeWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        changeWatcher.onDidChange(uri => this.invalidate(uri));
        changeWatcher.onDidCreate(uri => this.invalidate(uri));
        changeWatcher.onDidDelete(uri => this.invalidate(uri));

        this.fileWatchers.set('changes', changeWatcher);

        // 监视目录更改
        const dirPattern = new vscode.RelativePattern(workspaceFolder, '**/');
        const dirWatcher = vscode.workspace.createFileSystemWatcher(dirPattern);
        dirWatcher.onDidCreate(uri => this.invalidateDirectory(uri));
        dirWatcher.onDidDelete(uri => this.invalidateDirectory(uri));

        this.fileWatchers.set('directories', dirWatcher);
    }

    /**
     * 为 URI 生成缓存键
     */
    private getCacheKey(uri: vscode.Uri): string {
        return `tfs_status_${uri.fsPath.toLowerCase()}`;
    }

    /**
     * 清理监视器
     */
    dispose(): void {
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
    }
}

/**
 * 异步文件系统缓存，用于昂贵的文件操作
 * 处理并发访问并提供基于 Promise 的缓存
 */
export class AsyncFileSystemCache {
    private static instance: AsyncFileSystemCache;
    private cache: HighPerformanceLRUCache<Promise<any>>;
    private inFlightRequests = new Map<string, Promise<any>>();
    private fileWatchers = new Map<string, vscode.FileSystemWatcher>();

    private constructor() {
        this.cache = new HighPerformanceLRUCache<Promise<any>>(200); // 缓存 Promise
        this.setupFileWatchers();
    }

    public static getInstance(): AsyncFileSystemCache {
        if (!AsyncFileSystemCache.instance) {
            AsyncFileSystemCache.instance = new AsyncFileSystemCache();
        }
        return AsyncFileSystemCache.instance;
    }

    /**
     * 异步获取或计算值，支持缓存
     */
    async getOrCompute<T>(
        key: string,
        computeFn: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        // 检查请求是否正在进行中
        if (this.inFlightRequests.has(key)) {
            return this.inFlightRequests.get(key)!;
        }

        // 检查缓存
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        // 开始计算
        const promise = this.computeAndCache(key, computeFn, ttl);
        this.inFlightRequests.set(key, promise);

        try {
            const result = await promise;
            return result;
        } finally {
            this.inFlightRequests.delete(key);
        }
    }

    /**
     * 使缓存条目失效
     */
    invalidate(key: string): void {
        this.cache.delete(key);
        this.inFlightRequests.delete(key);
    }

    /**
     * 使匹配模式的所有条目失效
     */
    invalidatePattern(_pattern: RegExp): void {
        // 注意: HighPerformanceLRUCache 不暴露键，
        // 所以需要清除全部并让它们重新计算
        // TODO: 当缓存暴露键时实现基于模式的失效
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * 获取缓存统计
     */
    getStats() {
        return this.cache.getStats();
    }

    /**
     * 清除所有缓存值
     */
    clear(): void {
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * 设置文件系统监视器以进行缓存失效
     */
    private setupFileWatchers(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');

        // 监视文件更改
        const changeWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        changeWatcher.onDidChange(uri => this.invalidateByUri(uri));
        changeWatcher.onDidCreate(uri => this.invalidateByUri(uri));
        changeWatcher.onDidDelete(uri => this.invalidateByUri(uri));

        this.fileWatchers.set('changes', changeWatcher);
    }

    /**
     * 使与 URI 相关的缓存条目失效
     */
    private invalidateByUri(uri: vscode.Uri): void {
        const path = uri.fsPath.toLowerCase();

        // 使包含此路径的条目失效
        // 由于无法遍历键，目前清除全部
        // TODO: 实现更复杂的失效策略
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * 计算值并缓存 Promise
     */
    private async computeAndCache<T>(
        key: string,
        computeFn: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        try {
            const result = await computeFn();
            // 缓存已解析的 Promise，而不是 Promise 本身
            const resolvedPromise = Promise.resolve(result);
            this.cache.set(key, resolvedPromise, ttl);
            return result;
        } catch (error) {
            // 不缓存错误 - 让它们可以被重试
            throw error;
        }
    }

    /**
     * 清理资源
     */
    dispose(): void {
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
        this.inFlightRequests.clear();
    }
}

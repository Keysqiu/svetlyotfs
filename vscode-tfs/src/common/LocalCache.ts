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

    // Enhanced getValue with TTL and statistics
    getValue<T>(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (entry) {
            // Check TTL
            if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
                this.cache.delete(key);
                this.stats.misses++;
                return undefined;
            }

            // Update access statistics
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            this.stats.hits++;
            return entry.value;
        }

        // Check workspace state as fallback
        const workspaceValue = this.getWorkspaceState().get<T>(key);
        if (workspaceValue !== undefined) {
            this.stats.hits++;
            // Cache it locally
            this.setValue(key, workspaceValue);
            return workspaceValue;
        }

        this.stats.misses++;
        return undefined;
    }

    // Enhanced setValue with TTL support
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

        // Persist to workspace state
        this.getWorkspaceState().update(key, value);

        // Enforce size limits
        this.enforceSizeLimit();
    }

    // Add value with optional TTL
    addValue<T>(key: string, value: T, ttl?: number): void {
        this.setValue(key, value, ttl);
    }

    // Get all keys
    getAllKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    // Get cache statistics
    getStats(): CacheStats {
        return { ...this.stats };
    }

    // Clear expired entries
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

    // Clear all cache entries
    clear(): void {
        this.cache.clear();
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    }

    // Invalidate specific key
    invalidate(key: string): boolean {
        const deleted = this.cache.delete(key);
        if (deleted) {
            this.getWorkspaceState().update(key, undefined);
        }
        return deleted;
    }

    // Get cache size
    size(): number {
        return this.cache.size;
    }

    // Check if key exists and is not expired
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

        // LRU eviction: remove least recently accessed items
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
        // Clean up expired entries every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.clearExpired();
        }, 5 * 60 * 1000);
    }

    // Cleanup method for extension deactivation
    dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
}

/**
 * High-performance LRU Cache with O(1) operations using doubly-linked list
 * Optimized for frequent access patterns typical in TFS operations
 */
export class HighPerformanceLRUCache<T> {
    private cache = new Map<string, LRUCacheEntry<T>>();
    private head: string | null = null; // Most recently used
    private tail: string | null = null; // Least recently used
    private maxSize: number;
    private stats: CacheStats = { hits: 0, misses: 0, evictions: 0, sets: 0 };

    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }

    /**
     * Get value from cache with O(1) complexity
     */
    get(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.stats.misses++;
            return undefined;
        }

        // Check TTL
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            this.stats.misses++;
            return undefined;
        }

        // Move to front (most recently used)
        this.moveToFront(key);
        this.stats.hits++;
        return entry.value;
    }

    /**
     * Set value in cache with O(1) complexity
     */
    set(key: string, value: T, ttl?: number): void {
        const now = Date.now();

        if (this.cache.has(key)) {
            // Update existing entry
            const entry = this.cache.get(key)!;
            entry.value = value;
            entry.timestamp = now;
            entry.ttl = ttl;
            this.moveToFront(key);
        } else {
            // Add new entry
            const entry: LRUCacheEntry<T> = {
                value,
                prev: null,
                next: this.head,
                timestamp: now,
                ttl
            };

            this.cache.set(key, entry);

            // Update linked list
            if (this.head) {
                this.cache.get(this.head)!.prev = key;
            }
            this.head = key;

            if (!this.tail) {
                this.tail = key;
            }

            this.stats.sets++;

            // Enforce size limit
            if (this.cache.size > this.maxSize) {
                this.evictLRU();
            }
        }
    }

    /**
     * Delete entry from cache
     */
    delete(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Remove from linked list
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
     * Check if key exists
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;

        // Check TTL
        if (entry.ttl && Date.now() - entry.timestamp > entry.ttl) {
            this.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Get cache size
     */
    size(): number {
        return this.cache.size;
    }

    /**
     * Clear all entries
     */
    clear(): void {
        this.cache.clear();
        this.head = null;
        this.tail = null;
        this.stats = { hits: 0, misses: 0, evictions: 0, sets: 0 };
    }

    /**
     * Get cache statistics
     */
    getStats(): CacheStats {
        return { ...this.stats };
    }

    /**
     * Get hit rate
     */
    getHitRate(): number {
        const total = this.stats.hits + this.stats.misses;
        return total === 0 ? 0 : this.stats.hits / total;
    }

    /**
     * Clean expired entries
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

        if (key === this.head) return; // Already at front

        // Remove from current position
        if (entry.prev) {
            this.cache.get(entry.prev)!.next = entry.next;
        }

        if (entry.next) {
            this.cache.get(entry.next)!.prev = entry.prev;
        } else {
            this.tail = entry.prev;
        }

        // Move to front
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
 * Specialized cache for TFS status operations with intelligent TTL management
 * Automatically invalidates cache entries when files change
 */
export class TFSStatusCache {
    private static instance: TFSStatusCache;
    private cache: HighPerformanceLRUCache<any[]>;
    private fileWatchers = new Map<string, vscode.FileSystemWatcher>();
    private defaultTTL: number;

    private constructor() {
        this.cache = new HighPerformanceLRUCache<any[]>(500); // Cache up to 500 status results
        this.defaultTTL = vscode.workspace.getConfiguration('tfs').get('statusCache.ttl', 30000); // 30 seconds default
        this.setupFileWatchers();
    }

    public static getInstance(): TFSStatusCache {
        if (!TFSStatusCache.instance) {
            TFSStatusCache.instance = new TFSStatusCache();
        }
        return TFSStatusCache.instance;
    }

    /**
     * Get cached status for a URI
     */
    getStatus(uri: vscode.Uri): any[] | undefined {
        const key = this.getCacheKey(uri);
        return this.cache.get(key);
    }

    /**
     * Set cached status for a URI with TTL
     */
    setStatus(uri: vscode.Uri, status: any[], ttl?: number): void {
        const key = this.getCacheKey(uri);
        this.cache.set(key, status, ttl || this.defaultTTL);
    }

    /**
     * Invalidate cache for a specific URI
     */
    invalidate(uri: vscode.Uri): void {
        const key = this.getCacheKey(uri);
        this.cache.delete(key);
    }

    /**
     * Invalidate cache for a directory and all its children
     */
    invalidateDirectory(directoryUri: vscode.Uri): void {
        const directoryKey = this.getCacheKey(directoryUri);

        // Find all keys that start with the directory path
        const keysToDelete: string[] = [];
        // Note: HighPerformanceLRUCache doesn't expose keys directly,
        // so we need to track this separately or use a different approach

        // For now, we'll clear the entire cache when directory changes
        // TODO: Implement more granular invalidation
        this.cache.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return this.cache.getStats();
    }

    /**
     * Get hit rate
     */
    getHitRate(): number {
        return this.cache.getHitRate();
    }

    /**
     * Clear all cached status
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Setup file system watchers for automatic cache invalidation
     */
    private setupFileWatchers(): void {
        // Watch for file changes in the workspace
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');

        // Watch for file changes
        const changeWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        changeWatcher.onDidChange(uri => this.invalidate(uri));
        changeWatcher.onDidCreate(uri => this.invalidate(uri));
        changeWatcher.onDidDelete(uri => this.invalidate(uri));

        this.fileWatchers.set('changes', changeWatcher);

        // Watch for directory changes
        const dirPattern = new vscode.RelativePattern(workspaceFolder, '**/');
        const dirWatcher = vscode.workspace.createFileSystemWatcher(dirPattern);
        dirWatcher.onDidCreate(uri => this.invalidateDirectory(uri));
        dirWatcher.onDidDelete(uri => this.invalidateDirectory(uri));

        this.fileWatchers.set('directories', dirWatcher);
    }

    /**
     * Generate cache key for URI
     */
    private getCacheKey(uri: vscode.Uri): string {
        return `tfs_status_${uri.fsPath.toLowerCase()}`;
    }

    /**
     * Cleanup watchers
     */
    dispose(): void {
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
    }
}

/**
 * Asynchronous file system cache for expensive file operations
 * Handles concurrent access and provides promise-based caching
 */
export class AsyncFileSystemCache {
    private static instance: AsyncFileSystemCache;
    private cache: HighPerformanceLRUCache<Promise<any>>;
    private inFlightRequests = new Map<string, Promise<any>>();
    private fileWatchers = new Map<string, vscode.FileSystemWatcher>();

    private constructor() {
        this.cache = new HighPerformanceLRUCache<Promise<any>>(200); // Cache promises
        this.setupFileWatchers();
    }

    public static getInstance(): AsyncFileSystemCache {
        if (!AsyncFileSystemCache.instance) {
            AsyncFileSystemCache.instance = new AsyncFileSystemCache();
        }
        return AsyncFileSystemCache.instance;
    }

    /**
     * Get or compute value asynchronously with caching
     */
    async getOrCompute<T>(
        key: string,
        computeFn: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        // Check if request is already in flight
        if (this.inFlightRequests.has(key)) {
            return this.inFlightRequests.get(key)!;
        }

        // Check cache
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        // Start computation
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
     * Invalidate cache entry
     */
    invalidate(key: string): void {
        this.cache.delete(key);
        this.inFlightRequests.delete(key);
    }

    /**
     * Invalidate all entries matching a pattern
     */
    invalidatePattern(_pattern: RegExp): void {
        // Note: HighPerformanceLRUCache doesn't expose keys,
        // so we need to clear all and let them be recomputed
        // TODO: Implement pattern-based invalidation when cache exposes keys
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * Get cache statistics
     */
    getStats() {
        return this.cache.getStats();
    }

    /**
     * Clear all cached values
     */
    clear(): void {
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * Setup file system watchers for cache invalidation
     */
    private setupFileWatchers(): void {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) return;

        const pattern = new vscode.RelativePattern(workspaceFolder, '**/*');

        // Watch for file changes
        const changeWatcher = vscode.workspace.createFileSystemWatcher(pattern);
        changeWatcher.onDidChange(uri => this.invalidateByUri(uri));
        changeWatcher.onDidCreate(uri => this.invalidateByUri(uri));
        changeWatcher.onDidDelete(uri => this.invalidateByUri(uri));

        this.fileWatchers.set('changes', changeWatcher);
    }

    /**
     * Invalidate cache entries related to a URI
     */
    private invalidateByUri(uri: vscode.Uri): void {
        const path = uri.fsPath.toLowerCase();

        // Invalidate entries that contain this path
        // Since we can't iterate keys, we clear all for now
        // TODO: Implement more sophisticated invalidation
        this.cache.clear();
        this.inFlightRequests.clear();
    }

    /**
     * Compute value and cache the promise
     */
    private async computeAndCache<T>(
        key: string,
        computeFn: () => Promise<T>,
        ttl?: number
    ): Promise<T> {
        try {
            const result = await computeFn();
            // Cache the resolved promise, not the promise itself
            const resolvedPromise = Promise.resolve(result);
            this.cache.set(key, resolvedPromise, ttl);
            return result;
        } catch (error) {
            // Don't cache errors - let them be retried
            throw error;
        }
    }

    /**
     * Cleanup resources
     */
    dispose(): void {
        for (const watcher of this.fileWatchers.values()) {
            watcher.dispose();
        }
        this.fileWatchers.clear();
        this.inFlightRequests.clear();
    }
}

import * as vscode from "vscode";
import { TFSCommandExecutor } from "./Commands";
import { BlameResult } from "./Types";
import { Utilities } from "../common/Utilities";

export class BlameManager {
    private static instance: BlameManager;
    private cache: Map<string, BlameResult>;
    private cacheSizeLimit: number;
    private enabled: boolean;

    private constructor() {
        this.cache = new Map();
        this.cacheSizeLimit = vscode.workspace.getConfiguration("tfs").get("blame.cacheSize", 50);
        this.enabled = vscode.workspace.getConfiguration("tfs").get("blame.enabled", true);
    }

    public static getInstance(): BlameManager {
        if (!BlameManager.instance) {
            BlameManager.instance = new BlameManager();
        }

        return BlameManager.instance;
    }

    public isEnabled(): boolean {
        return this.enabled;
    }

    public async getFileBlame(uri: vscode.Uri): Promise<BlameResult | undefined> {
        if (!this.enabled) {
            return undefined;
        }

        const filePath = uri.fsPath;

        // 检查缓存中是否有标注信息
        if (this.cache.has(filePath)) {
            const cachedResult = this.cache.get(filePath)!;

            // 检查缓存结果是否仍然有效
            if (this.isCacheValid(filePath, cachedResult)) {
                return cachedResult;
            } else {
                // 移除无效的缓存条目
                this.cache.delete(filePath);
            }
        }

        // 从 TFS 获取标注信息
        try {
            const blameResult = await TFSCommandExecutor.getInstance().annotate(uri);

            if (blameResult) {
                // 缓存结果
                this.cache.set(filePath, blameResult);

                // 检查缓存大小并在必要时淘汰
                this.evictCacheIfNecessary();

                return blameResult;
            }
        } catch (error) {
            console.error("获取标注信息时出错:", error);
        }

        return undefined;
    }

    private isCacheValid(filePath: string, cachedResult: BlameResult): boolean {
        // 检查文件自缓存创建以来是否已被修改
        try {
            const fs = require('fs');
            const stats = fs.statSync(filePath);
            return stats.mtime <= cachedResult.timestamp;
        } catch (error) {
            // 如果无法获取文件状态，假定缓存无效
            return false;
        }
    }

    private evictCacheIfNecessary() {
        // 如果缓存大小超过限制，移除最旧的条目
        while (this.cache.size > this.cacheSizeLimit) {
            // 获取第一个（最旧的）条目
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }
    }

    public clearCache() {
        this.cache.clear();
    }
}
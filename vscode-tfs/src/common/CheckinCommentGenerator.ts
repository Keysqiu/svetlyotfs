import * as vscode from 'vscode';
import { PendingChange, TfStatus, getDescriptionText } from '../TFS/Types';
import { TFSCommandExecutor } from '../TFS/Commands';
import * as path from 'path';

/**
 * 签入注解生成器
 * 优先使用 VSCode Language Model API 生成 AI 注解，
 * 不可用时回退到基于文件变更分析的模板生成。
 */
export class CheckinCommentGenerator {
    private static instance: CheckinCommentGenerator;

    private constructor() { }

    public static getInstance(): CheckinCommentGenerator {
        if (!CheckinCommentGenerator.instance) {
            CheckinCommentGenerator.instance = new CheckinCommentGenerator();
        }
        return CheckinCommentGenerator.instance;
    }

    /**
     * 为选中的挂起更改生成签入注解
     * @param changes 待签入的文件变更列表
     * @returns 生成的签入注解
     */
    public async generateComment(changes: PendingChange[]): Promise<string> {
        // 先尝试 AI 生成
        try {
            const aiComment = await this.generateWithAI(changes);
            if (aiComment) {
                return aiComment;
            }
        } catch {
            // AI 不可用，回退到模板生成
        }

        // 回退：基于变更分析生成注解
        return this.generateTemplateComment(changes);
    }

    /**
     * 使用 VSCode Language Model API 生成注解
     */
    private async generateWithAI(changes: PendingChange[]): Promise<string | null> {
        const lm = (vscode as any).lm;
        if (!lm) {
            return null;
        }

        let models: any[];
        try {
            models = await lm.selectChatModels();
        } catch {
            return null;
        }

        if (!models || models.length === 0) {
            return null;
        }

        const model = models[0];
        const prompt = this.buildAIPrompt(changes);

        try {
            const messages = [
                {
                    role: 'system',
                    content: '你是一个专业的版本控制助手。根据文件变更信息生成简洁、准确的中文签入注解。要求：一行以内，直接描述做了什么改动，不需要前缀。'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ];

            const response = await model.sendRequest(messages, {});
            // 处理不同类型的响应格式
            if (typeof response === 'string') {
                return response.trim();
            }
            if (response?.text) {
                return response.text.trim();
            }
            if (response?.content) {
                return response.content.trim();
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * 构建 AI 提示词
     */
    private buildAIPrompt(changes: PendingChange[]): string {
        const changeSummary = changes.map(c => {
            const fileName = path.basename(c.local);
            const dirName = path.dirname(c.local);
            const statusText = getDescriptionText(c.chg);
            return `- ${fileName} (${statusText}, 目录: ${dirName})`;
        }).join('\n');

        const changeTypes = new Set(changes.map(c => c.chg));
        const typeSummary = Array.from(changeTypes).map(t => getDescriptionText(t)).join('、');

        return `请根据以下 TFS 挂起更改生成一句简洁的签入注释（中文，不超过50字）：

变更类型: ${typeSummary}
文件数量: ${changes.length} 个

${changeSummary}

签入注释:`;
    }

    /**
     * 基于文件变更分析生成模板注解（AI 不可用时的回退方案）
     */
    private generateTemplateComment(changes: PendingChange[]): string {
        if (changes.length === 0) {
            return '更新代码';
        }

        // 统计变更类型
        const stats = this.analyzeChanges(changes);

        // 提取公共目录前缀
        const commonDir = this.findCommonDirectory(changes);

        // 构建各部分描述
        const parts: string[] = [];

        if (stats.addCount > 0) {
            const files = changes.filter(c =>
                c.chg === TfStatus.Add ||
                c.chg === TfStatus.AddEncoding ||
                c.chg === TfStatus.AddEditEncoding
            );
            parts.push(this.summarizeGroup('新增', files, commonDir));
        }

        if (stats.editCount > 0) {
            const files = changes.filter(c => c.chg === TfStatus.Edit);
            parts.push(this.summarizeGroup('修改', files, commonDir));
        }

        if (stats.deleteCount > 0) {
            const files = changes.filter(c => c.chg === TfStatus.Delete);
            parts.push(this.summarizeGroup('删除', files, commonDir));
        }

        if (stats.renameCount > 0) {
            parts.push('重命名文件');
        }

        if (stats.otherCount > 0) {
            parts.push('更新文件');
        }

        return parts.join('；') || '更新代码';
    }

    /**
     * 分析变更统计
     */
    private analyzeChanges(changes: PendingChange[]) {
        let addCount = 0, editCount = 0, deleteCount = 0, renameCount = 0, otherCount = 0;

        for (const c of changes) {
            switch (c.chg) {
                case TfStatus.Add:
                case TfStatus.AddEncoding:
                case TfStatus.AddEditEncoding:
                    addCount++;
                    break;
                case TfStatus.Edit:
                case TfStatus.Encoding:
                    editCount++;
                    break;
                case TfStatus.Delete:
                    deleteCount++;
                    break;
                case TfStatus.Rename:
                case TfStatus.SourceRename:
                    renameCount++;
                    break;
                default:
                    otherCount++;
                    break;
            }
        }

        return { addCount, editCount, deleteCount, renameCount, otherCount };
    }

    /**
     * 找到文件的公共目录前缀
     */
    private findCommonDirectory(changes: PendingChange[]): string {
        if (changes.length === 0) return '';
        if (changes.length === 1) return path.dirname(changes[0].local);

        const dirs = changes.map(c => path.dirname(c.local).split(/[/\\]/));
        const minLen = Math.min(...dirs.map(d => d.length));
        let commonParts: string[] = [];

        for (let i = 0; i < minLen; i++) {
            const part = dirs[0][i];
            if (dirs.every(d => d[i] === part)) {
                commonParts.push(part);
            } else {
                break;
            }
        }

        return commonParts.join('/');
    }

    /**
     * 对一组文件进行摘要描述
     */
    private summarizeGroup(action: string, files: PendingChange[], commonDir: string): string {
        if (files.length === 1) {
            const fileName = path.basename(files[0].local);
            return `${action} ${fileName}`;
        }

        // 多文件，尝试按子目录分组
        const subDirs = new Map<string, number>();
        for (const f of files) {
            const dir = path.dirname(f.local);
            const subDir = commonDir ? dir.replace(commonDir, '').replace(/^[/\\]/, '') || '(根目录)' : dir;
            subDirs.set(subDir, (subDirs.get(subDir) || 0) + 1);
        }

        if (subDirs.size === 1) {
            const dir = Array.from(subDirs.keys())[0];
            const label = dir === '(根目录)' ? commonDir || '根目录' : dir;
            return `${action} ${label}下 ${files.length} 个文件`;
        }

        return `${action} ${commonDir || '多个目录下'} ${files.length} 个文件`;
    }
}

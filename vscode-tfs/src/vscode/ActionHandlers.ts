import * as vscode from 'vscode'
import * as path from 'path';
import { TFSCommandExecutor } from '../TFS/Commands';
import { TFSOperationQueue } from '../TFS/OperationQueue';
import { FileNode } from './PendingChangesTreeView';
import { PendingChange } from '../TFS/Types';
import { CheckinCommentGenerator } from '../common/CheckinCommentGenerator';
import { PendingChangesTreeView } from './PendingChangesTreeView';

export namespace ActionHandlers {
    const operationQueue = TFSOperationQueue.getInstance();

    export async function createFiles(files: readonly vscode.Uri[]): Promise<any> {
        const results = [];

        for (const file of files) {
            try {
                console.log(`TFS: 正在将文件添加到版本控制: ${file.fsPath}`);

                await operationQueue.enqueue(() =>
                    TFSCommandExecutor.getInstance().add(file)
                );

                console.log(`TFS: 成功添加文件: ${file.fsPath}`);
                results.push({ file, success: true });
            } catch (error: any) {
                console.error(`TFS: 添加文件 ${file.fsPath} 失败:`, error);
                results.push({ file, success: false, error });
            }
        }

        return results;
    }

    export async function deleteFiles(files: readonly vscode.Uri[]): Promise<any> {
        const results = [];

        for (const file of files) {
            try {
                // 检查文件是否处于"添加"状态（已添加但未提交）
                const isAdded = await TFSCommandExecutor.getInstance().checkIsAdded(file);

                if (isAdded) {
                    // 如果文件已添加到 TFS 但未提交，撤销添加操作
                    console.log(`TFS: 文件 ${file.fsPath} 处于添加状态，撤销添加而不是删除`);
                    await operationQueue.enqueue(() =>
                        TFSCommandExecutor.getInstance().undoUri(file)
                    );
                } else {
                    // 对已跟踪文件执行正常删除操作
                    console.log(`TFS: 从 TFS 中删除文件 ${file.fsPath}`);
                    await operationQueue.enqueue(() =>
                        TFSCommandExecutor.getInstance().delete(file)
                    );
                }

                results.push({ file, success: true });
            } catch (error: any) {
                console.error(`TFS: 处理 ${file.fsPath} 的删除操作失败:`, error);
                results.push({ file, success: false, error });
            }
        }

        return results;
    }

    export async function renameFiles(files: ReadonlyArray<{
        readonly oldUri: vscode.Uri;
        readonly newUri: vscode.Uri;
    }>) {
        for (const file of files) {
            await operationQueue.enqueue(() =>
                TFSCommandExecutor.getInstance().rename(file.oldUri, file.newUri)
            );
        }
    }

    export function undo(file: FileNode) {
        return TFSCommandExecutor.getInstance().undo(file);
    }

    export async function compareFilesFromHistory(uri: vscode.Uri, changeset1: string, changedBy1: string, changeset2: string, changedBy2: string,) {
        return TFSCommandExecutor.getInstance().compareFilesFromHistory(uri, changeset1, changedBy1, changeset2, changedBy2);
    }

    export async function compareFileWithLatest(file: FileNode) {
        return TFSCommandExecutor.getInstance().compare(file);
    }

    export async function onSaveDocument(file: vscode.Uri) {
        console.log(`TFS: onSaveDocument 被调用: ${file.fsPath}`);

        // 跳过对已添加到 TFS（处于"添加"状态）的文件的签出
        const isAdded = await TFSCommandExecutor.getInstance().checkIsAdded(file);
        if (isAdded) {
            console.log(`TFS: 跳过已添加到 TFS 的文件的签出: ${file.fsPath}`);
            return;
        }

        // 跳过对已签出的文件的签出
        const isCheckedOut = await TFSCommandExecutor.getInstance().checkIsCheckedOut(file);
        console.log(`TFS: 文件 ${file.fsPath} 签出状态: ${isCheckedOut}`);

        if(isCheckedOut == false){
            console.log(`TFS: 正在签出文件: ${file.fsPath}`);
            return TFSCommandExecutor.getInstance().checkOut(file);
        } else {
            console.log(`TFS: 文件 ${file.fsPath} 已签出，跳过签出操作`);
        }
    }

    export async function onOpenDocument(file: vscode.Uri) {
        return await TFSCommandExecutor.getInstance().fileHistory(file);
    }

    /**
     * 签入选中的文件
     * @param treeItems 选中的树节点
     */
    export async function checkinSelected(treeItems: readonly vscode.TreeItem[]): Promise<void> {
        const fileNodes = treeItems.filter(item => item instanceof FileNode) as FileNode[];
        if (fileNodes.length === 0) {
            vscode.window.showWarningMessage('TFS: 没有选中的文件可用于签入。');
            return;
        }

        const pendingChanges: PendingChange[] = fileNodes.map(node => node.getPendingChange());
        await doCheckin(pendingChanges);
    }

    /**
     * 签入所有挂起的更改
     */
    export async function checkinAll(): Promise<void> {
        const allChanges = PendingChangesTreeView.getInstance().getAllPendingChanges();
        if (allChanges.length === 0) {
            vscode.window.showWarningMessage('TFS: 没有挂起的更改可用于签入。');
            return;
        }

        await doCheckin(allChanges);
    }

    /**
     * 执行签入流程：选择注解方式 → 获取注解 → 执行签入 → 刷新视图
     */
    async function doCheckin(changes: PendingChange[]): Promise<void> {
        // 步骤1: 选择注解方式
        const commentMethod = await vscode.window.showQuickPick(
            [
                { label: '$(sparkle) AI 生成注解', description: '自动分析文件变更生成签入注释', method: 'ai' },
                { label: '$(edit) 手动输入注解', description: '自己输入签入注释', method: 'manual' }
            ],
            { placeHolder: '选择签入注解方式', ignoreFocusOut: true }
        );

        if (!commentMethod) {
            return; // 用户取消
        }

        let comment: string;

        if (commentMethod.method === 'ai') {
            // AI 生成注解
            comment = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: '正在生成签入注解...',
                cancellable: false
            }, async () => {
                const generator = CheckinCommentGenerator.getInstance();
                return await generator.generateComment(changes);
            });

            // 让用户确认/编辑 AI 生成的注解
            comment = await vscode.window.showInputBox({
                prompt: '确认或编辑签入注解',
                value: comment,
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '签入注解不能为空';
                    }
                    return null;
                }
            }) || '';

            if (!comment.trim()) {
                return; // 用户取消
            }
        } else {
            // 手动输入
            comment = await vscode.window.showInputBox({
                prompt: '请输入签入注解',
                placeHolder: '描述本次变更内容...',
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return '签入注解不能为空';
                    }
                    return null;
                }
            }) || '';

            if (!comment.trim()) {
                return; // 用户取消
            }
        }

        // 步骤2: 执行签入
        try {
            const filePaths = changes.map(c => c.local);
            await TFSOperationQueue.getInstance().enqueue(
                async () => {
                    await TFSCommandExecutor.getInstance().checkinFiles(filePaths, comment.trim());
                },
                `签入 ${changes.length} 个文件`
            );

            // 步骤3: 刷新视图
            PendingChangesTreeView.getInstance().refreshImmediate();
        } catch (error: any) {
            // 错误已在 Commands.ts 中处理并显示
            console.error('TFS 签入操作失败:', error);
        }
    }
}
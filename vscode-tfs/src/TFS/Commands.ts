import * as vscode from "vscode"
import * as path from 'path'
import * as fs from 'fs'
import { spawnSync } from "child_process"
import * as iconv from 'iconv-lite';
import { tf, getSystemEncoding } from "./Spawn";
import { WorkspaceInfo, BlameInfo, BlameResult, TfStatus } from "./Types";
import { FileNode } from "../vscode/PendingChangesTreeView";
import { Settings } from "../common/Settings";
import { Utilities } from "../common/Utilities";
import { TFSStatusCache } from "../common/LocalCache";

enum TeamServerCommands {
    Add = "add",
    CheckIn = "checkin",
    CheckOut = "checkout",
    View = "view",
    Delete = "delete",
    Get = "get",
    Rename = "rename",
    Undo = "undo",
    Status = "status",
    Workspaces = "workspaces",
    Reconcile = "reconcile",
    History = "history",
}

enum TeamServerCommandLineArgs {
    Recursive = "/recursive",
    OutputDirectory = "/output",
    XmlFormat = "/format:xml",
    DetailedFormat = "/format:detailed",
    Workspace = "/workspace:",
    NoPrompt = "/noprompt",
    Adds = "/adds",
    Promote = "/promote",
    Version = "/version:C"
}

export class TFSCommandExecutor {
    private static instance: TFSCommandExecutor;
    static changesetInfo = new Map<number, {user: string, date: string}>();
    private constructor() { }

    public static getInstance(): TFSCommandExecutor {
        if (!TFSCommandExecutor.instance) {
            TFSCommandExecutor.instance = new TFSCommandExecutor();
        }

        return TFSCommandExecutor.instance;
    }

    private getActiveWorkspace () : string | undefined {
        return Settings.getInstance().getActiveTfsWorkspace();
    }

    private getActiveWorkspaceAsCommandLineArgument() : string {
        return this.getActiveWorkspace() ? TeamServerCommandLineArgs.Workspace + this.getActiveWorkspace() : '';
    }

    public async add(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Add, Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.NoPrompt]);
            // await tf([TeamServerCommands.Reconcile, TeamServerCommandLineArgs.Promote, TeamServerCommandLineArgs.Adds, TeamServerCommandLineArgs.NoPrompt]);
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已成功添加到版本控制。`);
        } catch(error: any) {
            const errorMsg = `TFS: 将 ${path.basename(uri.fsPath)} 添加到版本控制失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 添加操作失败:', error);
            throw error; // 重新抛出以确保正确的错误传播
        }
    }

    public async checkIn(uri: vscode.Uri) {
        try {
            await tf([TeamServerCommands.CheckIn, this.getActiveWorkspaceAsCommandLineArgument(), Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive])
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已成功签入到版本控制。`);
        } catch (error: any) {
            const errorMsg = `TFS: 将 ${path.basename(uri.fsPath)} 签入到版本控制失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 签入操作失败:', error);
            throw error;
        }
    }

    /**
     * 签入多个文件并附带注释
     * @param filePaths 文件路径数组（相对或绝对路径）
     * @param comment 签入注释
     */
    public async checkinFiles(filePaths: string[], comment: string): Promise<void> {
        try {
            const args: string[] = [
                TeamServerCommands.CheckIn,
                this.getActiveWorkspaceAsCommandLineArgument(),
                `/comment:${comment}`,
                TeamServerCommandLineArgs.NoPrompt,
                ...filePaths.map(f => Utilities.removeLeadingSlash(vscode.Uri.file(f)))
            ];
            await tf(args);
            const fileCount = filePaths.length;
            vscode.window.showInformationMessage(`TFS: 已成功签入 ${fileCount} 个文件。`);
        } catch (error: any) {
            const errorMsg = `TFS: 签入文件失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 签入操作失败:', error);
            throw error;
        }
    }

    /**
     * 获取文件的差异内容（与服务器最新版本比较）
     * @param filePath 本地文件路径
     * @returns diff 文本内容
     */
    public async getFileDiff(filePath: string): Promise<string> {
        try {
            const relativePath = Utilities.removeLeadingSlash(vscode.Uri.file(filePath));
            const output = await tf([
                TeamServerCommands.Status,
                relativePath,
                TeamServerCommandLineArgs.XmlFormat
            ]);
            return output;
        } catch (error: any) {
            console.warn(`TFS: 获取文件 ${filePath} 差异失败:`, error.message);
            return '';
        }
    }

    public async checkOut(uri: vscode.Uri) {
        try {
            await tf([TeamServerCommands.CheckOut, Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive])
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已成功从版本控制中签出。`);
        } catch (error: any) {
            if (error.message.includes('opened for edit')) {
                vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已成功从版本控制中签出。`);
            } else {
                // 对于其他错误，显示错误消息
                const errorMsg = `TFS: 从版本控制中签出 ${path.basename(uri.fsPath)} 失败。错误: ${error.message}`;
                vscode.window.showErrorMessage(errorMsg);
                console.error('TFS 签出操作失败:', error);
                throw error;
            }
        }
    }

    public async compareFilesFromHistory(uri: vscode.Uri, changeset1: string, changedBy1: string, changeset2: string, changedBy2: string) {
        const firstChangesetFileTemporaryPath = Utilities.generateTemporaryFileNameFromDate(changedBy1 + '-' + changeset1);
        const secondChangesetFileTemporaryPath = Utilities.generateTemporaryFileNameFromDate(changedBy2 + '-' + changeset2);

        try {
            await tf([TeamServerCommands.View, Utilities.getRelativePath(uri),
                `${TeamServerCommandLineArgs.Version}${changeset1}`,
                `${TeamServerCommandLineArgs.OutputDirectory}:${firstChangesetFileTemporaryPath}`])

            await tf([TeamServerCommands.View, Utilities.getRelativePath(uri),
                `${TeamServerCommandLineArgs.Version}${changeset2}`,
                `${TeamServerCommandLineArgs.OutputDirectory}:${secondChangesetFileTemporaryPath}`])

            const firstChangesetFileTemporaryDocument = await vscode.workspace.openTextDocument(firstChangesetFileTemporaryPath);
            const secondChangesetFileTemporaryDocument = await vscode.workspace.openTextDocument(secondChangesetFileTemporaryPath);

            vscode.commands.executeCommand("vscode.diff", secondChangesetFileTemporaryDocument.uri, firstChangesetFileTemporaryDocument.uri).then(() => {
                fs.unlinkSync(firstChangesetFileTemporaryPath);
                fs.unlinkSync(secondChangesetFileTemporaryPath);
            });
        } catch (error: any) {
            const errorMsg = `TFS: 比较 ${path.basename(firstChangesetFileTemporaryPath)} 与 ${path.basename(secondChangesetFileTemporaryPath)} 失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 历史文件比较操作失败:', error);
            throw error;
        }
    }

    public async compare(localUri: FileNode) {
        const temporaryFilePath = Utilities.generateTemporaryFileNameFromUri(localUri);
        try {
            await tf([TeamServerCommands.View, localUri.filePath,
                `${TeamServerCommandLineArgs.OutputDirectory}:${temporaryFilePath}`])

                const temporaryDocument = await vscode.workspace.openTextDocument(temporaryFilePath);
                const localDocument = await vscode.workspace.openTextDocument(localUri.filePath);

                vscode.commands.executeCommand("vscode.diff", temporaryDocument.uri, localDocument.uri).then(() => {
                    fs.unlinkSync(temporaryFilePath);
                });
            } catch (error: any) {
            const errorMsg = `TFS: 将 ${path.basename(localUri.filePath)} 与最新版本比较失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 比较操作失败:', error);
            throw error;
        }
    }

    public async delete(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Delete, Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已成功从版本控制中删除。`);
        } catch(error: any) {
            const errorMsg = `TFS: 删除 ${path.basename(uri.fsPath)} 失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 删除操作失败:', error);
            throw error;
        }
    }

    public async get(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Get, this.getActiveWorkspaceAsCommandLineArgument(), Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} 已更新为最新版本。`);
        } catch(error: any) {
            const errorMsg = `TFS: 获取 ${path.basename(uri.fsPath)} 最新版本失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 获取操作失败:', error);
            throw error;
        }
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
        try {
            // 使用 TFS 原生重命名命令（原子操作）
            await tf([TeamServerCommands.Rename,
                      Utilities.removeLeadingSlash(oldUri),
                      Utilities.removeLeadingSlash(newUri),
                      TeamServerCommandLineArgs.NoPrompt]);

            vscode.window.showInformationMessage(`TFS: ${path.basename(oldUri.fsPath)} 已成功重命名为 ${path.basename(newUri.fsPath)}。`);
        } catch (error: any) {
            const errorMsg = `TFS: 重命名 ${path.basename(oldUri.fsPath)} 失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 重命名操作失败:', error);
            throw error;
        }
    }

    public async status(uri: vscode.Uri) {
        const cache = TFSStatusCache.getInstance();

        // 先检查缓存
        const cachedResult = cache.getStatus(uri);
        if (cachedResult) {
            console.log(`TFS: 使用 ${uri.fsPath} 的缓存状态`);
            return cachedResult;
        }

        try {
            const tfTask = await tf([TeamServerCommands.Status,
                this.getActiveWorkspaceAsCommandLineArgument(),
                TeamServerCommandLineArgs.Recursive,
                TeamServerCommandLineArgs.XmlFormat,
                `${Utilities.removeLeadingSlash(uri)}`]);

            const result = await Utilities.tfsStatusXmlToTypedArray(tfTask);

            // 使用 TTL 缓存结果
            cache.setStatus(uri, result, 30000); // 30 秒 TTL
            console.log(`TFS: 已缓存 ${uri.fsPath} 的状态结果`);

            return result;
        } catch (error: any) {
            throw error;
        }
    }

    public async undo(uri: FileNode | FileNode) {
        try{
            await tf([TeamServerCommands.Undo, uri.getPath(), this.getActiveWorkspaceAsCommandLineArgument(), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: 撤销 ${path.basename(uri.filePath)} 在版本控制中的更改已成功完成。`);
        } catch(error: any) {
            const errorMsg = `TFS: 撤销 ${path.basename(uri.filePath)} 的更改失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 撤销操作失败:', error);
            throw error;
        }
    }

    /**
     * 通过 Uri 撤销文件的挂起更改
     */
    public async undoUri(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Undo, Utilities.removeLeadingSlash(uri), this.getActiveWorkspaceAsCommandLineArgument(), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: 撤销 ${path.basename(uri.fsPath)} 在版本控制中的更改已成功完成。`);
        } catch(error: any) {
            const errorMsg = `TFS: 撤销 ${path.basename(uri.fsPath)} 的更改失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 撤销操作失败:', error);
            throw error;
        }
    }

    public async fileHistory(uri : vscode.Uri) {
        let fileHistory = '';
        try {
            fileHistory = await tf([TeamServerCommands.History,
                Utilities.removeLeadingSlash(uri),
                TeamServerCommandLineArgs.Recursive,
                TeamServerCommandLineArgs.DetailedFormat]);

        } catch(error: any) {
            // 额外功能不显示错误消息 ^^，如果执行不成功说明 TFS 本身有问题。
        }

        return await Utilities.parseTfHistoryOutput(fileHistory);
    }

    public async getWorkspaces() {
        let task;
        try {
            task = await tf([TeamServerCommands.Workspaces])
            const splittedConnectionsOutput = task.split('\n');
            const workspaceInfo: WorkspaceInfo = {
                collection: '',
                workspaces: []
              };

            for (let i = 0; i < splittedConnectionsOutput.length; i++) {
                const line = splittedConnectionsOutput[i].trim();
                if (line.startsWith('Collection:')) {
                    workspaceInfo.collection = line.substring('Collection:'.length).trim();
                } else if (line && i >= 3) {
                    const workspaceName = line.split(/\s+/)[0];
                    workspaceInfo.workspaces.push(workspaceName);
                }
            }
            return workspaceInfo;
        } catch (error: any) {
            const errorMsg = `TFS: 从版本控制中获取工作区失败。错误: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS 获取工作区操作失败:', error);
            throw error;
        }

        return undefined;
    }

    public async checkIsCheckedOut(uri: vscode.Uri) {
        try {
            const task = await tf([TeamServerCommands.Status, this.getActiveWorkspaceAsCommandLineArgument(), Utilities.removeLeadingSlash(uri)]);
            if (task != 'There are no pending changes.\r\n') {
                return true;
            }
            return false;
        } catch (error) {
            return false;
        }
    }

    /**
     * 检查文件是否处于"添加"状态（已添加到 TFS 但尚未提交）
     */
    public async checkIsAdded(uri: vscode.Uri): Promise<boolean> {
        try {
            // 获取工作区状态以查看所有挂起的更改
            const workspaceUri = vscode.Uri.file(Utilities.getWorkspaceDirectory());
            const statusResult = await this.status(workspaceUri);

            if (statusResult && statusResult.length > 0) {
                const filePath = Utilities.removeLeadingSlash(uri);
                for (const change of statusResult) {
                    if (change.local.toLowerCase() == filePath.toLowerCase() && (change.chg === TfStatus.Add
                || change.chg === TfStatus.AddEditEncoding || change.chg === TfStatus.AddEncoding)) {
                        console.log(`TFS: 文件 ${filePath} 处于添加状态`);
                        return true;
                    }
                }
            }

            console.log(`TFS: 文件 ${uri.fsPath} 不处于添加状态`);
            return false;
        } catch (error) {
            console.warn(`TFS: 检查文件是否已添加失败: ${uri.fsPath}`, error);
            return false;
        }
    }

    /**
     * 检查当前工作区是否在 TFS 源代码控制之下
     */
    public async isWorkspaceUnderTFS(): Promise<boolean> {
        try {
            const workspaceDir = Utilities.getWorkspaceDirectory();
            if (!workspaceDir) {
                return false;
            }

            // 尝试获取工作区 - 如果成功说明 TFS 已配置
            const workspaces = await this.getWorkspaces();
            if (!workspaces || !workspaces.workspaces || workspaces.workspaces.length === 0) {
                return false;
            }

            // 通过尝试获取工作区根目录的状态来检查当前工作区目录是否映射到 TFS
            const workspaceUri = vscode.Uri.file(workspaceDir);
            const status = await this.status(workspaceUri);

            // 如果能获取状态结果（即使是空数组），说明 TFS 正常工作
            // 如果 TFS 未为此工作区配置，将会抛出错误
            return true;
        } catch (error) {
            console.log(`TFS: 工作区不在 TFS 控制之下: ${error}`);
            return false;
        }
    }

    public async annotate(uri: vscode.Uri): Promise<BlameResult | undefined> {
        const tfptPath: string | undefined = vscode.workspace.getConfiguration("tfs").get("tfptLocation");

        if (!tfptPath) {
            throw new Error("tfpt.exe 路径未配置");
        }

        try {
            // 执行 tfpt annotate 命令
            const args = ["annotate", Utilities.removeLeadingSlash(uri), "/noprompt"];
            const task = spawnSync(tfptPath, args, { encoding: 'buffer' });

            if (task.stderr.length > 0) {
                const encoding = getSystemEncoding();
                throw new Error(iconv.decode(task.stderr, encoding));
            }

            const outputString = iconv.decode(task.stdout, getSystemEncoding());

            // 解析 annotate 输出以获取变更集 ID
            const blameResult = this.parseAnnotateOutput(uri.fsPath, outputString);

            // 获取每个变更集的用户信息
            const changesetIds = [...new Set(blameResult.blameInfo.map(info => info.changesetId))];
            await this.getChangesetUsers(changesetIds, uri);

            // 使用实际用户名和日期更新标注信息
            for (const blameInfo of blameResult.blameInfo) {
                if (TFSCommandExecutor.changesetInfo.has(blameInfo.changesetId)) {
                    const info = TFSCommandExecutor.changesetInfo.get(blameInfo.changesetId);
                    if (info) {
                        blameInfo.author = info.user || blameInfo.author;
                        if (info.date) {
                            blameInfo.date = info.date;
                        }
                    }
                }
            }

            return blameResult;
        } catch (err: any) {
            throw new Error(err.stderr ? err.stderr : err.message);
        }
    }

    private async getChangesetUsers(changesetIds: number[], fileUri: vscode.Uri){

        // 对于每个变更集 ID，使用 tf history 获取用户信息
        for (const changesetId of changesetIds) {
            try {
                if(TFSCommandExecutor.changesetInfo.has(changesetId))
                    continue;

                // 获取变更集详情
                const historyOutput = await tf([TeamServerCommands.History,
                    Utilities.removeLeadingSlash(fileUri),
                    `/version:C${changesetId}`,
                    TeamServerCommandLineArgs.DetailedFormat]);

                // 解析历史输出以提取用户和日期信息
                const lines = historyOutput.split('\n');
                let user = '';
                let date = '';

                for (const line of lines) {
                    if (line.startsWith('User:')) {
                        user = line.substring(5).trim();
                    } else if (line.startsWith('Date:')) {
                        date = line.substring(5).trim();
                    }

                    if(user != '' && date != '')
                        break;
                }

                if (user && date) {
                    TFSCommandExecutor.changesetInfo.set(changesetId, {user, date});
                } else if (user) {
                    // 如果只有用户信息，日期使用空字符串
                    TFSCommandExecutor.changesetInfo.set(changesetId, {user, date: ''});
                }
            } catch (error) {
                // 如果无法获取变更集的用户信息，保留原始作者信息
                console.warn(`无法获取变更集 ${changesetId} 的用户信息:`, error);
            }
        }
    }

    private parseAnnotateOutput(filePath: string, output: string): BlameResult {
        const lines = output.split('\n');
        const blameInfo: BlameInfo[] = [];

        // 解析 annotate 输出
        // tfpt annotate 格式通常为:
        // changesetId author date-time content
        // 但我们需要处理可能遇到的不同格式
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim()) {
                // 尝试使用更灵活的方法解析行
                // 格式可能有所不同，但通常以变更集信息开头
                const trimmedLine = line.trim();

                // 常见格式:
                // 1. "changesetId author date content"
                // 2. "changesetId author date-time content"
                // 3. "changesetId:author date content"

                // 尝试格式 1: "changesetId author date content"
                let match = trimmedLine.match(/^(\d+)\s+([^\s]+)\s+(\d{4}-\d{2}-\d{2})\s+(.*)$/);
                if (match) {
                    const [, changesetIdStr, author, date, content] = match;
                    const changesetId = parseInt(changesetIdStr, 10);

                    blameInfo.push({
                        lineNumber: i + 1,
                        changesetId: changesetId,
                        author: author,
                        date: date,
                        content: content
                    });
                    continue;
                }

                // 尝试格式 2: "changesetId author date-time content"
                match = trimmedLine.match(/^(\d+)\s+([^\s]+)\s+(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[\+\-]?\d*:?\d*)\s+(.*)$/);
                if (match) {
                    const [, changesetIdStr, author, date, content] = match;
                    const changesetId = parseInt(changesetIdStr, 10);

                    blameInfo.push({
                        lineNumber: i + 1,
                        changesetId: changesetId,
                        author: author,
                        date: date,
                        content: content
                    });
                    continue;
                }

                // 尝试格式 3: "changesetId:author date content"
                match = trimmedLine.match(/^(\d+):([^\s]+)\s+(\d{4}-\d{2}-\d{2})\s+(.*)$/);
                if (match) {
                    const [, changesetIdStr, author, date, content] = match;
                    const changesetId = parseInt(changesetIdStr, 10);

                    blameInfo.push({
                        lineNumber: i + 1,
                        changesetId: changesetId,
                        author: author,
                        date: date,
                        content: content
                    });
                    continue;
                }

                // 其他格式的回退处理 - 至少尝试提取 changesetId 和 author
                const parts = trimmedLine.split(/\s+/);
                if (parts.length >= 2) {
                    // 尝试在第一个部分中找到变更集 ID（数字）
                    const changesetMatch = parts[0].match(/^(\d+)/);
                    if (changesetMatch) {
                        const changesetId = parseInt(changesetMatch[1], 10);
                        const author = parts.length > 1 ? parts[1].split(':')[0] : '未知';
                        const date = parts.length > 2 ? parts[2] : '';
                        const content = parts.length > 3 ? parts.slice(3).join(' ') : '';

                        blameInfo.push({
                            lineNumber: i + 1,
                            changesetId: changesetId,
                            author: author,
                            date: date,
                            content: content
                        });
                    }
                }
            }
        }

        return {
            filePath: filePath,
            blameInfo: blameInfo,
            timestamp: new Date()
        };
    }
}

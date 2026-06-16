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
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} succesfully added in version control.`);
        } catch(error: any) {
            const errorMsg = `TFS: Adding ${path.basename(uri.fsPath)} in version control failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Add Operation Failed:', error);
            throw error; // Re-throw for proper error propagation
        }
    }

    public async checkIn(uri: vscode.Uri) {
        try {
            await tf([TeamServerCommands.CheckIn, this.getActiveWorkspaceAsCommandLineArgument(), Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive])
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} succesfully checked in version control.`);
        } catch (error: any) {
            const errorMsg = `TFS: Checking ${path.basename(uri.fsPath)} in version control failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS CheckIn Operation Failed:', error);
            throw error;
        }
    }

    public async checkOut(uri: vscode.Uri) {
        try {
            await tf([TeamServerCommands.CheckOut, Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive])
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} succesfully checked out in version control.`);
        } catch (error: any) {
            if (error.message.includes('opened for edit')) {
                vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} succesfully checked out in version control.`);
            } else {
                // For other errors, show the error message
                const errorMsg = `TFS: Checking out ${path.basename(uri.fsPath)} in version control failed. Error: ${error.message}`;
                vscode.window.showErrorMessage(errorMsg);
                console.error('TFS CheckOut Operation Failed:', error);
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
            const errorMsg = `TFS: Comparing ${path.basename(firstChangesetFileTemporaryPath)} with ${path.basename(secondChangesetFileTemporaryPath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS CompareFilesFromHistory Operation Failed:', error);
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
            const errorMsg = `TFS: Comparing ${path.basename(localUri.filePath)} with latest failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Compare Operation Failed:', error);
            throw error;
        }
    }

    public async delete(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Delete, Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} succesfully deleted from version control.`);
        } catch(error: any) {
            const errorMsg = `TFS: Deleting ${path.basename(uri.fsPath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Delete Operation Failed:', error);
            throw error;
        }
    }

    public async get(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Get, this.getActiveWorkspaceAsCommandLineArgument(), Utilities.removeLeadingSlash(uri), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: ${path.basename(uri.fsPath)} is now latest.`);
        } catch(error: any) {
            const errorMsg = `TFS: Getting ${path.basename(uri.fsPath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Get Operation Failed:', error);
            throw error;
        }
    }

    public async rename(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<void> {
        try {
            // Use TFS native rename command (atomic operation)
            await tf([TeamServerCommands.Rename,
                      Utilities.removeLeadingSlash(oldUri),
                      Utilities.removeLeadingSlash(newUri),
                      TeamServerCommandLineArgs.NoPrompt]);

            vscode.window.showInformationMessage(`TFS: ${path.basename(oldUri.fsPath)} successfully renamed to ${path.basename(newUri.fsPath)}.`);
        } catch (error: any) {
            const errorMsg = `TFS: Renaming ${path.basename(oldUri.fsPath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Rename Operation Failed:', error);
            throw error;
        }
    }

    public async status(uri: vscode.Uri) {
        const cache = TFSStatusCache.getInstance();

        // Check cache first
        const cachedResult = cache.getStatus(uri);
        if (cachedResult) {
            console.log(`TFS: Using cached status for ${uri.fsPath}`);
            return cachedResult;
        }

        try {
            const tfTask = await tf([TeamServerCommands.Status,
                this.getActiveWorkspaceAsCommandLineArgument(),
                TeamServerCommandLineArgs.Recursive,
                TeamServerCommandLineArgs.XmlFormat,
                `${Utilities.removeLeadingSlash(uri)}`]);

            const result = await Utilities.tfsStatusXmlToTypedArray(tfTask);

            // Cache the result with TTL
            cache.setStatus(uri, result, 30000); // 30 second TTL
            console.log(`TFS: Cached status result for ${uri.fsPath}`);

            return result;
        } catch (error: any) {
            throw error;
        }
    }

    public async undo(uri: FileNode | FileNode) {
        try{
            await tf([TeamServerCommands.Undo, uri.getPath(), this.getActiveWorkspaceAsCommandLineArgument(), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: Undoing changes in version control for ${path.basename(uri.filePath)} completed successfully.`);
        } catch(error: any) {
            const errorMsg = `TFS: Undoing changes for ${path.basename(uri.filePath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Undo Operation Failed:', error);
            throw error;
        }
    }

    /**
     * Undo pending changes for a file by Uri
     */
    public async undoUri(uri: vscode.Uri) {
        try{
            await tf([TeamServerCommands.Undo, Utilities.removeLeadingSlash(uri), this.getActiveWorkspaceAsCommandLineArgument(), TeamServerCommandLineArgs.Recursive]);
            vscode.window.showInformationMessage(`TFS: Undoing changes in version control for ${path.basename(uri.fsPath)} completed successfully.`);
        } catch(error: any) {
            const errorMsg = `TFS: Undoing changes for ${path.basename(uri.fsPath)} failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS Undo Operation Failed:', error);
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
            // No errror messages for extra functionalities ^^, if the execution doesn't succeed that means TFS is garbage.
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
            const errorMsg = `TFS: Retrieving workspaces from version control failed. Error: ${error.message}`;
            vscode.window.showErrorMessage(errorMsg);
            console.error('TFS GetWorkspaces Operation Failed:', error);
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
     * Check if a file is in "Add" state (added to TFS but not yet committed)
     */
    public async checkIsAdded(uri: vscode.Uri): Promise<boolean> {
        try {
            // Get workspace status to see all pending changes
            const workspaceUri = vscode.Uri.file(Utilities.getWorkspaceDirectory());
            const statusResult = await this.status(workspaceUri);

            if (statusResult && statusResult.length > 0) {
                const filePath = Utilities.removeLeadingSlash(uri);
                for (const change of statusResult) {
                    if (change.local.toLowerCase() == filePath.toLowerCase() && (change.chg === TfStatus.Add
                || change.chg === TfStatus.AddEditEncoding || change.chg === TfStatus.AddEncoding)) {
                        console.log(`TFS: File ${filePath} is in Add state`);
                        return true;
                    }
                }
            }

            console.log(`TFS: File ${uri.fsPath} is not in Add state`);
            return false;
        } catch (error) {
            console.warn(`TFS: Failed to check if file is added: ${uri.fsPath}`, error);
            return false;
        }
    }

    /**
     * Check if the current workspace is under TFS source control
     */
    public async isWorkspaceUnderTFS(): Promise<boolean> {
        try {
            const workspaceDir = Utilities.getWorkspaceDirectory();
            if (!workspaceDir) {
                return false;
            }

            // Try to get workspaces - if this succeeds, TFS is configured
            const workspaces = await this.getWorkspaces();
            if (!workspaces || !workspaces.workspaces || workspaces.workspaces.length === 0) {
                return false;
            }

            // Check if the current workspace directory is mapped to TFS
            // We can do this by trying to get status of the workspace root
            const workspaceUri = vscode.Uri.file(workspaceDir);
            const status = await this.status(workspaceUri);

            // If we get status results or even an empty array, TFS is working
            // If TFS is not configured for this workspace, it would throw an error
            return true;
        } catch (error) {
            console.log(`TFS: Workspace not under TFS control: ${error}`);
            return false;
        }
    }

    public async annotate(uri: vscode.Uri): Promise<BlameResult | undefined> {
        const tfptPath: string | undefined = vscode.workspace.getConfiguration("tfs").get("tfptLocation");

        if (!tfptPath) {
            throw new Error("tfpt.exe path is not configured");
        }

        try {
            // Execute tfpt annotate command
            const args = ["annotate", Utilities.removeLeadingSlash(uri), "/noprompt"];
            const task = spawnSync(tfptPath, args, { encoding: 'buffer' });

            if (task.stderr.length > 0) {
                const encoding = getSystemEncoding();
                throw new Error(iconv.decode(task.stderr, encoding));
            }

            const outputString = iconv.decode(task.stdout, getSystemEncoding());

            // Parse the annotate output to get changeset IDs
            const blameResult = this.parseAnnotateOutput(uri.fsPath, outputString);

            // Get user information for each changeset
            const changesetIds = [...new Set(blameResult.blameInfo.map(info => info.changesetId))];
            await this.getChangesetUsers(changesetIds, uri);

            // Update blame info with actual user names and dates
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

        // For each changeset ID, get the user information using tf history
        for (const changesetId of changesetIds) {
            try {
                if(TFSCommandExecutor.changesetInfo.has(changesetId))
                    continue;

                // Get changeset details
                const historyOutput = await tf([TeamServerCommands.History,
                    Utilities.removeLeadingSlash(fileUri),
                    `/version:C${changesetId}`,
                    TeamServerCommandLineArgs.DetailedFormat]);

                // Parse the history output to extract user and date information
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
                    // If we only have user info, use an empty string for date
                    TFSCommandExecutor.changesetInfo.set(changesetId, {user, date: ''});
                }
            } catch (error) {
                // If we can't get user information for a changeset, we'll keep the original author info
                console.warn(`Could not get user information for changeset ${changesetId}:`, error);
            }
        }
    }

    private parseAnnotateOutput(filePath: string, output: string): BlameResult {
        const lines = output.split('\n');
        const blameInfo: BlameInfo[] = [];

        // Parse the annotate output
        // The tfpt annotate format is typically:
        // changesetId author date-time content
        // But we need to handle different formats that might be encountered
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim()) {
                // Try to parse the line with a more flexible approach
                // The format can vary, but typically starts with changeset info
                const trimmedLine = line.trim();

                // Common formats:
                // 1. "changesetId author date content"
                // 2. "changesetId author date-time content"
                // 3. "changesetId:author date content"

                // Try format 1: "changesetId author date content"
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

                // Try format 2: "changesetId author date-time content"
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

                // Try format 3: "changesetId:author date content"
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

                // Fallback for any other format - try to extract at least changesetId and author
                const parts = trimmedLine.split(/\s+/);
                if (parts.length >= 2) {
                    // Try to find a changeset ID (number) in the first part
                    const changesetMatch = parts[0].match(/^(\d+)/);
                    if (changesetMatch) {
                        const changesetId = parseInt(changesetMatch[1], 10);
                        const author = parts.length > 1 ? parts[1].split(':')[0] : 'Unknown';
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

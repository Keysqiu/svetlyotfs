import * as vscode from 'vscode'
import * as path from 'path';
import { TFSCommandExecutor } from '../TFS/Commands';
import { TFSOperationQueue } from '../TFS/OperationQueue';
import { FileNode } from './PendingChangesTreeView';

export namespace ActionHandlers {
    const operationQueue = TFSOperationQueue.getInstance();

    export async function createFiles(files: readonly vscode.Uri[]): Promise<any> {
        const results = [];

        for (const file of files) {
            try {
                console.log(`TFS: Adding file to version control: ${file.fsPath}`);

                await operationQueue.enqueue(() =>
                    TFSCommandExecutor.getInstance().add(file)
                );

                console.log(`TFS: Successfully added file: ${file.fsPath}`);
                results.push({ file, success: true });
            } catch (error: any) {
                console.error(`TFS: Failed to add file ${file.fsPath}:`, error);
                results.push({ file, success: false, error });
            }
        }

        return results;
    }

    export async function deleteFiles(files: readonly vscode.Uri[]): Promise<any> {
        const results = [];

        for (const file of files) {
            try {
                // Check if file is in "Add" state (added but not committed)
                const isAdded = await TFSCommandExecutor.getInstance().checkIsAdded(file);

                if (isAdded) {
                    // If file is added to TFS but not committed, undo the add operation
                    console.log(`TFS: File ${file.fsPath} is in Add state, undoing instead of deleting`);
                    await operationQueue.enqueue(() =>
                        TFSCommandExecutor.getInstance().undoUri(file)
                    );
                } else {
                    // Normal delete operation for tracked files
                    console.log(`TFS: Deleting file ${file.fsPath} from TFS`);
                    await operationQueue.enqueue(() =>
                        TFSCommandExecutor.getInstance().delete(file)
                    );
                }

                results.push({ file, success: true });
            } catch (error: any) {
                console.error(`TFS: Failed to handle deletion for ${file.fsPath}:`, error);
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
        console.log(`TFS: onSaveDocument called for: ${file.fsPath}`);

        // Skip checkout for files that are already added to TFS (in "Add" state)
        const isAdded = await TFSCommandExecutor.getInstance().checkIsAdded(file);
        if (isAdded) {
            console.log(`TFS: Skipping checkout for file already added to TFS: ${file.fsPath}`);
            return;
        }

        // Skip checkout for files that are already checked out
        const isCheckedOut = await TFSCommandExecutor.getInstance().checkIsCheckedOut(file);
        console.log(`TFS: File ${file.fsPath} checked out status: ${isCheckedOut}`);

        if(isCheckedOut == false){
            console.log(`TFS: Checking out file: ${file.fsPath}`);
            return TFSCommandExecutor.getInstance().checkOut(file);
        } else {
            console.log(`TFS: File ${file.fsPath} is already checked out, skipping checkout`);
        }
    }

    export async function onOpenDocument(file: vscode.Uri) {
        return await TFSCommandExecutor.getInstance().fileHistory(file);
    }
}
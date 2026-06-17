import * as vscode from 'vscode'
import * as os from 'os'
import * as path from 'path'
import * as xml2js from 'xml2js';
import { PendingChange, Changeset } from '../TFS/Types';
import { FileNode } from '../vscode/PendingChangesTreeView';

export class Utilities {
    static removeLeadingSlash(uri: vscode.Uri) {
        return uri.fsPath.replace(/^\//, '');
    }

    static getRelativePath(uri: vscode.Uri) {
        return '$' + uri.path;
    }

    static replaceForwardSlashes(input: string): string {
        return input.replace(/\//g, '\\');
    }

    static removeLastDirectory(uri: string): string {
        const parts = uri.split('/');
        parts.pop();
        const newUriString = parts.join('/');
        return newUriString;
    }

    static getGlobalStoragePath() {
        return os.homedir();
    }

    static generateTemporaryFileNameFromDate(datetime: string) {
        return path.join(Utilities.getGlobalStoragePath(), datetime);
    }

    static generateTemporaryFileNameFromUri(uri: FileNode) {
        return path.join(Utilities.getGlobalStoragePath(), path.basename(uri.filePath));
    }

    static getWorkspaceDirectory() {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            return workspaceFolders[0].uri.path;
        }
        return '';
    }

     static async xmlToObject(xml: string) : Promise<any> {
        const parser = new xml2js.Parser({
            explicitArray: false,
            mergeAttrs: true
        })
          try {
            const cleanedXml = xml.replace(/\r?\n|\r/g, '').trim();
            return await parser.parseStringPromise(cleanedXml);
          } catch (error: any) {
            console.log("TFS: XML 解析失败。\n 错误:", error.message, `\n XML: ${xml}`);
          }

          return undefined;
      }

      static async tfsStatusXmlToTypedArray(xml: string): Promise<PendingChange[]> {
        const pendingChanges: PendingChange[] = [];
        const parsedObject = await Utilities.xmlToObject(xml);
        if (!parsedObject || !parsedObject.Status || !parsedObject.Status.PendingSet || !parsedObject.Status.PendingSet.PendingChanges || !parsedObject.Status.PendingSet.PendingChanges.PendingChange) {
            return pendingChanges;
        }

        if (Array.isArray(parsedObject.Status.PendingSet.PendingChanges.PendingChange)) {
            pendingChanges.push(...parsedObject.Status.PendingSet.PendingChanges.PendingChange);
        } else {
            pendingChanges.push(parsedObject.Status.PendingSet.PendingChanges.PendingChange);
        }

        return pendingChanges;
    }

    static async parseTfHistoryOutput(tfOutput: string): Promise<Changeset[]> {
        const changesetPattern = /^Changeset:\s+(\d+)/;
        const userPattern = /^User:\s+(.+)/;
        const datePattern = /^Date:\s+(.+)/;
        const commentPattern = /^Comment:\s*(.+)/;
        const itemPattern = /^  edit\s+\$(.+)/;

        let changesets: Changeset[] = [];
        let currentChangeset: Partial<Changeset> = {};
        let lines = tfOutput.split('\n');

        for (let line of lines) {
            if (changesetPattern.test(line)) {
                if (currentChangeset.changesetId) {
                    changesets.push(currentChangeset as Changeset);
                    currentChangeset = {};
                }
                let match = line.match(changesetPattern);
                currentChangeset.changesetId = match ? parseInt(match[1], 10) : 0;
                currentChangeset.items = [];
            } else if (userPattern.test(line)) {
                let match = line.match(userPattern);
                currentChangeset.user = match ? match[1].trim() : '';
            } else if (datePattern.test(line)) {
                let match = line.match(datePattern);
                currentChangeset.date = match ? match[1].trim() : '';
            } else if (commentPattern.test(line)) {
                let match = line.match(commentPattern);
                currentChangeset.comment = match ? match[1].trim() : '';
            } else if (itemPattern.test(line)) {
                let match = line.match(itemPattern);
                if (match) currentChangeset.items?.push(match[1].trim());
            }
        }

        if (currentChangeset.changesetId) {
            changesets.push(currentChangeset as Changeset);
        }

        return changesets;
    }
}

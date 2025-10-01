import * as vscode from 'vscode'
import { PendingChangesTreeView } from './PendingChangesTreeView';
import { Settings } from '../common/Settings';
import { TFSStatusCache } from '../common/LocalCache';

export class WorkspacesStatusBarItem {
    private static instance: WorkspacesStatusBarItem;
    private _statusBarItem: vscode.StatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    private readonly _command = 'tfs.statusbar.workspace';

    private constructor() {
        this._statusBarItem.command = this._command;
        this._statusBarItem.text = `[TFS]: Workspaces`;
        this._statusBarItem.tooltip = "Change your TFS workspace";
        this._statusBarItem.show();
    }  

    public static getInstance(): WorkspacesStatusBarItem {
        if (!WorkspacesStatusBarItem.instance) {
            WorkspacesStatusBarItem.instance = new WorkspacesStatusBarItem();
        }
  
        return WorkspacesStatusBarItem.instance;
    }

    public async registerTriggerCommand() {
        vscode.commands.registerCommand(this._command, async () =>{
            this.trigger();
        });   
    }

    private async trigger() {
        let quickpickOptions : vscode.QuickPickOptions = {
            placeHolder: "Choose workspace"    
        } 

        const activeWorkspace : string = Settings.getInstance().getActiveTfsWorkspace() || '';
        if(activeWorkspace.length > 0){
            quickpickOptions.placeHolder = `Current: ${activeWorkspace}`;
            Settings.getInstance().getWorkspaceInfo().workspaces.sort((a: string) => {
            if(a === activeWorkspace) {
                return -1;
            }
            return 0;
        })
        }

        const selectedWorkspace = await vscode.window.showQuickPick(Settings.getInstance().getWorkspaceInfo().workspaces, quickpickOptions);
        if(selectedWorkspace){
            const workspaceName = selectedWorkspace.toString();
            console.log(`TFS: User selected workspace: ${workspaceName}`);

            // Update the active workspace
            Settings.getInstance().setActiveTfsWorkspace(workspaceName);

            // Clear any cached data that depends on the workspace
            // This ensures fresh data is loaded for the new workspace
            TFSStatusCache.getInstance().clear();
            PendingChangesTreeView.getInstance().refreshImmediate();

            // Update status bar text to show current workspace
            this._statusBarItem.text = `[TFS]: ${workspaceName}`;

            vscode.window.showInformationMessage(`TFS: Switched to workspace "${workspaceName}"`);
        }
    }

    public getStatusBarItem() {
        return this._statusBarItem;
    }

    public update() {
        const activeWorkspace = Settings.getInstance().getActiveTfsWorkspace<string>();
        if (activeWorkspace) {
            this._statusBarItem.text = `[TFS]: ${activeWorkspace}`;
        } else {
            this._statusBarItem.text = `[TFS]: Workspaces`;
        }
    }
}
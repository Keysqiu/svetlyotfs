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
        this._statusBarItem.text = `[TFS]: 工作区`;
        this._statusBarItem.tooltip = "切换 TFS 工作区";
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
            placeHolder: "选择工作区"
        }

        const activeWorkspace : string = Settings.getInstance().getActiveTfsWorkspace() || '';
        if(activeWorkspace.length > 0){
            quickpickOptions.placeHolder = `当前: ${activeWorkspace}`;
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
            console.log(`TFS: 用户选择了工作区: ${workspaceName}`);

            // 更新活动工作区
            Settings.getInstance().setActiveTfsWorkspace(workspaceName);

            // 清除依赖工作区的缓存数据
            // 这确保为新工作区加载新数据
            TFSStatusCache.getInstance().clear();
            PendingChangesTreeView.getInstance().refreshImmediate();

            // 更新状态栏文本以显示当前工作区
            this._statusBarItem.text = `[TFS]: ${workspaceName}`;

            vscode.window.showInformationMessage(`TFS: 已切换到工作区 "${workspaceName}"`);
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
            this._statusBarItem.text = `[TFS]: 工作区`;
        }
    }
}
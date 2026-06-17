import * as vscode from "vscode"
import { TFSCommandExecutor } from "../TFS/Commands";
import { WorkspaceInfo } from "../TFS/Types";
import { LocalCache } from "./LocalCache";

enum SettingNames
{
    ActiveWorkspace = "ActiveWorkspace"
};

export class Settings {
    private static _instance: Settings;
    private static _context: vscode.ExtensionContext;
    private static _cache : LocalCache;
    private static _workspaceInfo : WorkspaceInfo;

    private constructor() { }

    public static getInstance(): Settings {
        if (!Settings._instance) {
            Settings._instance = new Settings();
        }

        return Settings._instance;
    }

    public setContext(context: vscode.ExtensionContext){
        Settings._context = context;
        Settings._cache = new LocalCache(Settings._context);
    }

    public getActiveTfsWorkspace<T>(){
        return Settings._cache.getValue<T>(SettingNames.ActiveWorkspace.toString());
    }

    public getWorkspaceInfo() : WorkspaceInfo {
        return Settings._workspaceInfo;
    }

    public async setWorkspaceInfo(): Promise<void> {
        try {
            const setting = await TFSCommandExecutor.getInstance().getWorkspaces();
            if(!setting || setting.workspaces.length <= 0)
                return;

            // 检查是否有先前选择的工作区已保存
            const savedWorkspace = this.getActiveTfsWorkspace<string>();
            let activeWorkspace: string;

            if (savedWorkspace && setting.workspaces.includes(savedWorkspace)) {
                // 如果先前选择的工作区仍然可用，继续使用
                activeWorkspace = savedWorkspace;
                console.log(`TFS: 使用先前选择的工作区: ${activeWorkspace}`);
            } else {
                // 使用第一个可用工作区作为默认值
                activeWorkspace = setting.workspaces[0];
                console.log(`TFS: 使用默认工作区: ${activeWorkspace}`);
            }

            this.setActiveTfsWorkspace(activeWorkspace);
            Settings._workspaceInfo = setting;
        } catch (error) {
            console.log("设置默认 TFS 工作区时出错。", error);
        }
    }

    public setActiveTfsWorkspace(workspaceName: string){
        // 始终更新活动工作区，而不仅仅是在未定义时
        Settings._cache.setValue(SettingNames.ActiveWorkspace.toString(), workspaceName);
        console.log(`TFS: 活动工作区已更改为: ${workspaceName}`);
    }
}

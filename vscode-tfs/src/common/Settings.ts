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

            // Check if there's a previously selected workspace saved
            const savedWorkspace = this.getActiveTfsWorkspace<string>();
            let activeWorkspace: string;

            if (savedWorkspace && setting.workspaces.includes(savedWorkspace)) {
                // Use the previously selected workspace if it's still available
                activeWorkspace = savedWorkspace;
                console.log(`TFS: Using previously selected workspace: ${activeWorkspace}`);
            } else {
                // Use the first available workspace as default
                activeWorkspace = setting.workspaces[0];
                console.log(`TFS: Using default workspace: ${activeWorkspace}`);
            }

            this.setActiveTfsWorkspace(activeWorkspace);
            Settings._workspaceInfo = setting;
        } catch (error) {
            console.log("Error setting default TFS workspace.", error);
        }
    }

    public setActiveTfsWorkspace(workspaceName: string){
        // Always update the active workspace, not just if undefined
        Settings._cache.setValue(SettingNames.ActiveWorkspace.toString(), workspaceName);
        console.log(`TFS: Active workspace changed to: ${workspaceName}`);
    }
}

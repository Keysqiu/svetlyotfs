import * as vscode from "vscode";
import path from "path";
import { ActionHandlers } from "./vscode/ActionHandlers";
import { WorkspacesStatusBarItem } from "./vscode/WorkspaceStatusBarItem";
import { FileHistoryTreeView } from "./vscode/FileHistoryTreeView";
import { Changeset } from "./TFS/Types";
import { PendingChangesTreeView } from "./vscode/PendingChangesTreeView";
import { PendingChangesViewDecoration } from "./vscode/PendingChangesViewDecoration";
import { BlameManager } from "./TFS/BlameManager";
import { BlameDecorationsProvider } from "./vscode/BlameDecorationsProvider";
import { Settings } from "./common/Settings";
import { Utilities } from "./common/Utilities";
import { TFSCommandExecutor } from "./TFS/Commands";
import { testAnnotateCommand } from "./test/annotateTest";
import { runBlameIntegrationTest } from "./test/blameIntegrationTest";

let treeview: any;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Set context first to initialize cache
    Settings.getInstance().setContext(context);

    // Load workspace info and wait for it to complete
    await Settings.getInstance().setWorkspaceInfo();

    // Check if workspace is under TFS control
    const isUnderTFS = await TFSCommandExecutor.getInstance().isWorkspaceUnderTFS();
    if (!isUnderTFS) {
        console.log('TFS: Workspace is not under TFS source control. Extension will be disabled.');
        vscode.window.showWarningMessage(
            'TFS: Current workspace is not under TFS source control. TFS extension features are disabled.'
        );
        return;
    }

    console.log('TFS: Workspace is under TFS control. Activating extension...');
    registerProviders(context);
    registerHandlers(context);
    addWorkspaceStatusBarItem(context);

    // Update status bar with saved workspace selection (now that workspace info is loaded)
    WorkspacesStatusBarItem.getInstance().update();
}

function registerProviders(context: vscode.ExtensionContext) {
  context.subscriptions.push(new PendingChangesViewDecoration());
  context.subscriptions.push(vscode.window.createTreeView("pendingChanges", {
    treeDataProvider: PendingChangesTreeView.getInstance(),
    canSelectMany: true,
  }));

  context.subscriptions.push( treeview = vscode.window.createTreeView("currentFileHistory", {
    treeDataProvider: FileHistoryTreeView.getInstance(),
    canSelectMany: true,
  }));
  
  PendingChangesTreeView.getInstance().refresh();
}

function registerHandlers(context: vscode.ExtensionContext){
  // Debounce mechanism to prevent duplicate execution between VSCode events and file system watcher
  const recentOperations = new Set<string>();
  const DEBOUNCE_TIME = 10000; // 1 second debounce

  const addRecentOperation = (uri: vscode.Uri, operation: string) => {
    const key = `${operation}:${uri.fsPath.toLowerCase()}`;
    recentOperations.add(key);
    setTimeout(() => recentOperations.delete(key), DEBOUNCE_TIME);
  };

  const isRecentOperation = (uri: vscode.Uri, operation: string): boolean => {
    const key = `${operation}:${uri.fsPath.toLowerCase()}`;
    return recentOperations.has(key);
  };

  // File system watcher for external file operations (Kilocode, other apps, etc.)
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(fileWatcher);

  // Handle file creations from external sources (skip if recently handled by VSCode)
  fileWatcher.onDidCreate(async (uri) => {
    if (isRecentOperation(uri, 'create')) {
      console.log(`TFS: Skipping duplicate create operation for: ${uri.fsPath}`);
      return;
    }
    console.log(`TFS: File created externally: ${uri.fsPath}`);
    await ActionHandlers.createFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // Handle file deletions from external sources (skip if recently handled by VSCode)
  fileWatcher.onDidDelete(async (uri) => {
    if (isRecentOperation(uri, 'delete')) {
      console.log(`TFS: Skipping duplicate delete operation for: ${uri.fsPath}`);
      return;
    }
    console.log(`TFS: File deleted externally: ${uri.fsPath}`);
    await ActionHandlers.deleteFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // Handle file changes from external sources (skip if recently handled by VSCode)
  fileWatcher.onDidChange(async (uri) => {
    if (isRecentOperation(uri, 'change')) {
      console.log(`TFS: Skipping duplicate change operation for: ${uri.fsPath}`);
      return;
    }
    console.log(`TFS: File changed externally: ${uri.fsPath}`);

    // Check if file is already added to TFS (in "Add" state)
    const isAdded = await TFSCommandExecutor.getInstance().checkIsAdded(uri);
    if (isAdded) {
      console.log(`TFS: File ${uri.fsPath} is already added to TFS, skipping checkout`);
      await PendingChangesTreeView.getInstance().refresh();
      return;
    }

    // Check if file is already checked out
    const isCheckedOut = await TFSCommandExecutor.getInstance().checkIsCheckedOut(uri);
    if (!isCheckedOut) {
      await ActionHandlers.onSaveDocument(uri);
    }
    await PendingChangesTreeView.getInstance().refresh();
  });

  // Save document (VSCode internal saves)
  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument( async (event) => {
    return await ActionHandlers.onSaveDocument(event.document.uri)
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async () => {
    return await PendingChangesTreeView.getInstance().refresh();
  }))

  // // Rename files (VSCode internal renames)
  // context.subscriptions.push(vscode.workspace.onDidRenameFiles(async (event) => {
  //   await ActionHandlers.renameFiles(event.files);
  //   return await PendingChangesTreeView.getInstance().refresh();
  // }));

  // Delete files (VSCode internal deletes)
  context.subscriptions.push(vscode.workspace.onWillDeleteFiles(async (event) => {
    // Mark files as recently deleted to prevent duplicate file watcher execution
    event.files.forEach(uri => addRecentOperation(uri, 'delete'));
    return await event.waitUntil(ActionHandlers.deleteFiles(event.files));
  }));

  context.subscriptions.push(vscode.workspace.onDidDeleteFiles(async () => {
    return await PendingChangesTreeView.getInstance().refresh();
  }));

  // Create files (VSCode internal creates)
  context.subscriptions.push(vscode.workspace.onDidCreateFiles(async (event) => {
    // Mark files as recently created to prevent duplicate file watcher execution
    event.files.forEach(uri => addRecentOperation(uri, 'create'));
    await ActionHandlers.createFiles(event.files);
    return await PendingChangesTreeView.getInstance().refresh();
  }));

  // Commands registration
  context.subscriptions.push(vscode.commands.registerCommand("pendingChanges.undo", async (uri: any) => {
    await ActionHandlers.undo(uri);
    return await PendingChangesTreeView.getInstance().refresh();
  }));

  context.subscriptions.push(vscode.commands.registerCommand('fileHistory.comapreWithAnother', async () =>{
    let changesets: Changeset[] = [];

    treeview.selection.forEach((item: { data: any; }) => {
      const queryObject = JSON.parse((item as any).resourceUri.query as any)
      console.log(queryObject);

      changesets.push(queryObject as Changeset);
    });

    if(changesets.length != 2 || changesets === undefined) {
      return;
    }

    await ActionHandlers.compareFilesFromHistory(vscode.Uri.parse(changesets[0].items[0]),
      changesets[0].changesetId.toString(),
      changesets[0].user as string,
      changesets[1].changesetId.toString(),
      changesets[1].user as string,
      );

    console.log(changesets);
  }));

  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async (event) => {
    const workspaceDirectory = Utilities.getWorkspaceDirectory();
    if(workspaceDirectory === '')
      return;

    if(!event)
      return;

    if(path.basename(workspaceDirectory) != vscode.workspace.getWorkspaceFolder(event.document.uri)?.name) {
      return;
    }

    const fileHistory = await ActionHandlers.onOpenDocument(event.document.uri);
    FileHistoryTreeView.getInstance().refresh(fileHistory as any);
  }))
  
  vscode.commands.registerCommand("pendingChanges.compareFiles", async (uri: any) => {
    return await ActionHandlers.compareFileWithLatest(uri)
  });
  
  // Test annotate command
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.testAnnotate", async () => {
    return await testAnnotateCommand();
  }));
  
  // Test blame integration
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.testBlameIntegration", async () => {
    return await runBlameIntegrationTest();
  }));
  
  // Show blame information for a file
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.showBlame", async () => {
    // Get the active text editor's document
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("No active editor to show blame information for.");
      return;
    }
    
    const resource = editor.document.uri;
    const decorationsProvider = BlameDecorationsProvider.getInstance();
    
    // Show loading indicator
    decorationsProvider.showLoadingIndicator(editor);
    
    // Get blame information for the file
    try {
      const blameManager = BlameManager.getInstance();
      const blameResult = await blameManager.getFileBlame(resource);
      
      // Hide loading indicator
      decorationsProvider.hideLoadingIndicator();
      
      if (blameResult) {
        // Show the blame information as decorations
        decorationsProvider.showBlameInformation(editor, blameResult);
        
        vscode.window.showInformationMessage(`Blame information displayed for ${resource.fsPath}`);
      } else {
        vscode.window.showErrorMessage(`Could not get blame information for ${resource.fsPath}`);
      }
    } catch (error: any) {
      // Hide loading indicator in case of error
      decorationsProvider.hideLoadingIndicator();
      vscode.window.showErrorMessage(`Error getting blame information: ${error.message}`);
      console.error("Error getting blame information:", error);
    }
  }));
  
  // Blame functionality - now only available via context menu
  // Removed automatic blame loading on file open
}

function addWorkspaceStatusBarItem(context: vscode.ExtensionContext) {
  context.subscriptions.push(WorkspacesStatusBarItem.getInstance().getStatusBarItem());
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(WorkspacesStatusBarItem.getInstance().update));
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(WorkspacesStatusBarItem.getInstance().update));
  WorkspacesStatusBarItem.getInstance().registerTriggerCommand();
}

export function deactivate(): void {}

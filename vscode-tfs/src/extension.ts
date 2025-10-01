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

  // Check if file is in an ignored directory (build outputs, dependencies, etc.)
  const isIgnoredDirectory = (uri: vscode.Uri): boolean => {
    const pathParts = uri.fsPath.split(/[/\\]/);
    const ignoredDirs = [
      'out', 'dist', 'build', 'bin', 'obj', 'target',
      'node_modules', '.git', '.svn', '.hg',
      '.vscode', '.vs', '.idea', '.DS_Store',
      'packages', 'bower_components', 'jspm_packages',
      '.net', 'temp', 'tmp', 'cache', 'logs'
    ];

    return pathParts.some(part =>
      ignoredDirs.includes(part.toLowerCase()) ||
      part.startsWith('.') && ignoredDirs.includes(part.toLowerCase())
    );
  };

  // Check if file is currently open/active in VSCode (indicates development workflow)
  const isFileActiveInVSCode = (uri: vscode.Uri): boolean => {
    // Check if file is currently open in an editor
    const openTabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
    const isOpen = openTabs.some(tab =>
      tab.input instanceof vscode.TabInputText &&
      tab.input.uri.fsPath === uri.fsPath
    );

    // Check if file is in the active workspace
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const isInWorkspace = workspaceFolder !== undefined;

    return isOpen || isInWorkspace;
  };

  // Check if file appears to be a temporary or system-generated file that shouldn't be added to TFS
  const isTemporaryOrSystemFile = (uri: vscode.Uri): boolean => {
    const fileName = path.basename(uri.fsPath);
    const extension = path.extname(uri.fsPath).toLowerCase();

    // Extensions that indicate temporary/system files
    const tempExtensions = [
      '.tmp', '.temp', '.bak', '.backup', '.old', '.orig',
      '.vsidx', '.vspscc', '.vssscc', '.suo', '.user',
      '.cache', '.log', '.pid', '.lock', '.swp', '.swo'
    ];

    // Check for temporary extensions
    if (tempExtensions.includes(extension)) {
      return true;
    }

    // Check for GUID-like filenames (8-4-4-4-12 pattern)
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-zA-Z0-9]+)?$/i;
    if (guidPattern.test(fileName)) {
      return true;
    }

    // Check for files starting with temporary prefixes
    const tempPrefixes = ['~$', 'temp', 'tmp', 'cache', 'tempfile'];
    if (tempPrefixes.some(prefix => fileName.toLowerCase().startsWith(prefix))) {
      return true;
    }

    // Check for files in temporary directories
    const pathParts = uri.fsPath.split(/[/\\]/);
    const tempDirs = ['temp', 'tmp', 'cache', 'temporary', '.tmp'];
    if (pathParts.some(part => tempDirs.includes(part.toLowerCase()))) {
      return true;
    }

    return false;
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

    if (isIgnoredDirectory(uri)) {
      console.log(`TFS: Skipping create operation for ignored directory: ${uri.fsPath}`);
      return;
    }

    // Skip temporary or system-generated files
    if (isTemporaryOrSystemFile(uri)) {
      console.log(`TFS: Skipping temporary/system file creation: ${uri.fsPath}`);
      return;
    }

    console.log(`TFS: File created (active workflow): ${uri.fsPath}`);
    await ActionHandlers.createFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // Handle file deletions from external sources (skip if recently handled by VSCode)
  fileWatcher.onDidDelete(async (uri) => {
    if (isRecentOperation(uri, 'delete')) {
      console.log(`TFS: Skipping duplicate delete operation for: ${uri.fsPath}`);
      return;
    }
    if (isIgnoredDirectory(uri)) {
      console.log(`TFS: Skipping delete operation for ignored directory: ${uri.fsPath}`);
      return;
    }
    if (!isFileActiveInVSCode(uri)) {
      console.log(`TFS: Skipping delete operation for inactive file: ${uri.fsPath}`);
      return;
    }
    console.log(`TFS: File deleted (active workflow): ${uri.fsPath}`);
    await ActionHandlers.deleteFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // Save document (VSCode internal saves - only for active files)
  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument( async (event) => {
    // Skip files in ignored directories
    if (isIgnoredDirectory(event.document.uri)) {
      console.log(`TFS: Skipping save operation for ignored directory: ${event.document.uri.fsPath}`);
      return;
    }

    console.log(`TFS: Handling save for active file: ${event.document.uri.fsPath}`);
    return await ActionHandlers.onSaveDocument(event.document.uri);
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

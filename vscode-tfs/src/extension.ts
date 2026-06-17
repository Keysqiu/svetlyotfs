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
    // 首先设置上下文以初始化缓存
    Settings.getInstance().setContext(context);

    // 加载工作区信息并等待完成
    await Settings.getInstance().setWorkspaceInfo();

    // 检查工作区是否在 TFS 控制之下
    const isUnderTFS = await TFSCommandExecutor.getInstance().isWorkspaceUnderTFS();
    if (!isUnderTFS) {
        console.log('TFS: 工作区不在 TFS 源代码控制之下。扩展将被禁用。');
        vscode.window.showWarningMessage(
            'TFS: 当前工作区不在 TFS 源代码控制之下。TFS 扩展功能已禁用。'
        );
        return;
    }

    console.log('TFS: 工作区在 TFS 控制之下。正在激活扩展...');
    registerProviders(context);
    registerHandlers(context);
    addWorkspaceStatusBarItem(context);

    // 使用已保存的工作区选择更新状态栏（工作区信息已加载）
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
  // 防抖机制，防止 VSCode 事件和文件系统监视器之间的重复执行
  const recentOperations = new Set<string>();
  const DEBOUNCE_TIME = 10000; // 10 秒防抖

  const addRecentOperation = (uri: vscode.Uri, operation: string) => {
    const key = `${operation}:${uri.fsPath.toLowerCase()}`;
    recentOperations.add(key);
    setTimeout(() => recentOperations.delete(key), DEBOUNCE_TIME);
  };

  const isRecentOperation = (uri: vscode.Uri, operation: string): boolean => {
    const key = `${operation}:${uri.fsPath.toLowerCase()}`;
    return recentOperations.has(key);
  };

  // 检查文件是否在忽略目录中（构建输出、依赖项等）
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

  // 检查文件当前是否在 VSCode 中打开/激活（表示开发工作流）
  const isFileActiveInVSCode = (uri: vscode.Uri): boolean => {
    // 检查文件当前是否在编辑器中打开
    const openTabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
    const isOpen = openTabs.some(tab =>
      tab.input instanceof vscode.TabInputText &&
      tab.input.uri.fsPath === uri.fsPath
    );

    // 检查文件是否在活动工作区中
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
    const isInWorkspace = workspaceFolder !== undefined;

    return isOpen || isInWorkspace;
  };

  // 检查文件是否为不应添加到 TFS 的临时文件或系统生成文件
  const isTemporaryOrSystemFile = (uri: vscode.Uri): boolean => {
    const fileName = path.basename(uri.fsPath);
    const extension = path.extname(uri.fsPath).toLowerCase();

    // 表示临时/系统文件的扩展名
    const tempExtensions = [
      '.tmp', '.temp', '.bak', '.backup', '.old', '.orig',
      '.vsidx', '.vspscc', '.vssscc', '.suo', '.user',
      '.cache', '.log', '.pid', '.lock', '.swp', '.swo'
    ];

    // 检查临时扩展名
    if (tempExtensions.includes(extension)) {
      return true;
    }

    // 检查类似 GUID 的文件名（8-4-4-4-12 模式）
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.[a-zA-Z0-9]+)?$/i;
    if (guidPattern.test(fileName)) {
      return true;
    }

    // 检查以临时前缀开头的文件
    const tempPrefixes = ['~$', 'temp', 'tmp', 'cache', 'tempfile'];
    if (tempPrefixes.some(prefix => fileName.toLowerCase().startsWith(prefix))) {
      return true;
    }

    // 检查临时目录中的文件
    const pathParts = uri.fsPath.split(/[/\\]/);
    const tempDirs = ['temp', 'tmp', 'cache', 'temporary', '.tmp'];
    if (pathParts.some(part => tempDirs.includes(part.toLowerCase()))) {
      return true;
    }

    return false;
  };

  // 文件系统监视器，用于外部文件操作（Kilocode、其他应用等）
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(fileWatcher);

  // 处理来自外部的文件创建（如果最近已被 VSCode 处理则跳过）
  fileWatcher.onDidCreate(async (uri) => {
    if (isRecentOperation(uri, 'create')) {
      console.log(`TFS: 跳过重复的创建操作: ${uri.fsPath}`);
      return;
    }

    if (isIgnoredDirectory(uri)) {
      console.log(`TFS: 跳过忽略目录中的创建操作: ${uri.fsPath}`);
      return;
    }

    // 跳过临时文件或系统生成文件
    if (isTemporaryOrSystemFile(uri)) {
      console.log(`TFS: 跳过临时/系统文件创建: ${uri.fsPath}`);
      return;
    }

    console.log(`TFS: 文件已创建(活动工作流): ${uri.fsPath}`);
    await ActionHandlers.createFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // 处理来自外部的文件删除（如果最近已被 VSCode 处理则跳过）
  fileWatcher.onDidDelete(async (uri) => {
    if (isRecentOperation(uri, 'delete')) {
      console.log(`TFS: 跳过重复的删除操作: ${uri.fsPath}`);
      return;
    }
    if (isIgnoredDirectory(uri)) {
      console.log(`TFS: 跳过忽略目录中的删除操作: ${uri.fsPath}`);
      return;
    }
    if (!isFileActiveInVSCode(uri)) {
      console.log(`TFS: 跳过非活动文件的删除操作: ${uri.fsPath}`);
      return;
    }
    console.log(`TFS: 文件已删除(活动工作流): ${uri.fsPath}`);
    await ActionHandlers.deleteFiles([uri]);
    await PendingChangesTreeView.getInstance().refresh();
  });

  // 保存文档（VSCode 内部保存 - 仅针对活动文件）
  context.subscriptions.push(vscode.workspace.onWillSaveTextDocument( async (event) => {
    // 跳过忽略目录中的文件
    if (isIgnoredDirectory(event.document.uri)) {
      console.log(`TFS: 跳过忽略目录中的保存操作: ${event.document.uri.fsPath}`);
      return;
    }

    console.log(`TFS: 处理活动文件保存: ${event.document.uri.fsPath}`);
    return await ActionHandlers.onSaveDocument(event.document.uri);
  }));

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(async () => {
    return await PendingChangesTreeView.getInstance().refresh();
  }))

  // // 重命名文件（VSCode 内部重命名）
  // context.subscriptions.push(vscode.workspace.onDidRenameFiles(async (event) => {
  //   await ActionHandlers.renameFiles(event.files);
  //   return await PendingChangesTreeView.getInstance().refresh();
  // }));

  // 删除文件（VSCode 内部删除）
  context.subscriptions.push(vscode.workspace.onWillDeleteFiles(async (event) => {
    // 将文件标记为最近删除，防止文件监视器重复执行
    event.files.forEach(uri => addRecentOperation(uri, 'delete'));
    return await event.waitUntil(ActionHandlers.deleteFiles(event.files));
  }));

  context.subscriptions.push(vscode.workspace.onDidDeleteFiles(async () => {
    return await PendingChangesTreeView.getInstance().refresh();
  }));

  // 创建文件（VSCode 内部创建）
  context.subscriptions.push(vscode.workspace.onDidCreateFiles(async (event) => {
    // 将文件标记为最近创建，防止文件监视器重复执行
    event.files.forEach(uri => addRecentOperation(uri, 'create'));
    await ActionHandlers.createFiles(event.files);
    return await PendingChangesTreeView.getInstance().refresh();
  }));

  // 命令注册
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

  // 签入选中的文件（右键菜单）
  context.subscriptions.push(vscode.commands.registerCommand("pendingChanges.checkin", async (clickedItem: vscode.TreeItem, selectedItems: readonly vscode.TreeItem[]) => {
    // selectedItems 包含所有选中的树节点
    return await ActionHandlers.checkinSelected(selectedItems || [clickedItem]);
  }));

  // 签入所有文件（视图标题按钮）
  context.subscriptions.push(vscode.commands.registerCommand("pendingChanges.checkinAll", async () => {
    return await ActionHandlers.checkinAll();
  }));

  // 测试标注命令
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.testAnnotate", async () => {
    return await testAnnotateCommand();
  }));

  // 测试 blame 集成
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.testBlameIntegration", async () => {
    return await runBlameIntegrationTest();
  }));

  // 显示文件的标注信息
  context.subscriptions.push(vscode.commands.registerCommand("vscode-tfs.showBlame", async () => {
    // 获取活动文本编辑器的文档
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showErrorMessage("没有活动编辑器可显示标注信息。");
      return;
    }

    const resource = editor.document.uri;
    const decorationsProvider = BlameDecorationsProvider.getInstance();

    // 显示加载指示器
    decorationsProvider.showLoadingIndicator(editor);

    // 获取文件的标注信息
    try {
      const blameManager = BlameManager.getInstance();
      const blameResult = await blameManager.getFileBlame(resource);

      // 隐藏加载指示器
      decorationsProvider.hideLoadingIndicator();

      if (blameResult) {
        // 以装饰形式显示标注信息
        decorationsProvider.showBlameInformation(editor, blameResult);

        vscode.window.showInformationMessage(`已显示 ${resource.fsPath} 的标注信息`);
      } else {
        vscode.window.showErrorMessage(`无法获取 ${resource.fsPath} 的标注信息`);
      }
    } catch (error: any) {
      // 出错时隐藏加载指示器
      decorationsProvider.hideLoadingIndicator();
      vscode.window.showErrorMessage(`获取标注信息时出错: ${error.message}`);
      console.error("获取标注信息时出错:", error);
    }
  }));

  // 标注功能 - 现在仅通过上下文菜单使用
  // 已移除文件打开时自动加载标注
}

function addWorkspaceStatusBarItem(context: vscode.ExtensionContext) {
  context.subscriptions.push(WorkspacesStatusBarItem.getInstance().getStatusBarItem());
	context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(WorkspacesStatusBarItem.getInstance().update));
	context.subscriptions.push(vscode.window.onDidChangeTextEditorSelection(WorkspacesStatusBarItem.getInstance().update));
  WorkspacesStatusBarItem.getInstance().registerTriggerCommand();
}

export function deactivate(): void {}

import * as vscode from 'vscode';
import * as path from 'path';
import { TFSCommandExecutor } from '../TFS/Commands';
import { PendingChange, getDescriptionText, TfStatus } from '../TFS/Types';
import { Utilities } from '../common/Utilities';

export enum Schemes {
	FileChange = 'filechange',
}

export class PendingChangesTreeView implements vscode.TreeDataProvider<vscode.TreeItem> {
   private static instance: PendingChangesTreeView;
   private refreshTimeout: NodeJS.Timeout | null = null;
   private pendingRefresh = false;
   private virtualScrollEnabled = true;
   private maxItemsPerFolder = 100; // 限制每个文件夹的条目数以支持虚拟滚动
   private loadedItems = new Map<string, number>(); // 跟踪每个文件夹已加载的条目

   private constructor() {this.loadItems()}

   public static getInstance(): PendingChangesTreeView {
     if (!PendingChangesTreeView.instance) {
       PendingChangesTreeView.instance = new PendingChangesTreeView();
     }

     return PendingChangesTreeView.instance;
   }

   private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
   readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

   /**
    * 防抖刷新，防止过度的 UI 更新
    * 延迟 200ms 以批量处理多个快速更改
    */
   refresh(): void {
     this.pendingRefresh = true;

     if (this.refreshTimeout) {
       // 已安排，标记为待处理
       return;
     }

     this.refreshTimeout = setTimeout(() => {
       if (this.pendingRefresh) {
         this._onDidChangeTreeData.fire(undefined);
         this.pendingRefresh = false;
       }
       this.refreshTimeout = null;
     }, 200); // 200ms 防抖延迟
   }

   /**
    * 关键更新的即时刷新
    */
   refreshImmediate(): void {
     if (this.refreshTimeout) {
       clearTimeout(this.refreshTimeout);
       this.refreshTimeout = null;
     }
     this.pendingRefresh = false;
     this._onDidChangeTreeData.fire(undefined);
   }

  private async loadItems() {
    try {
        await this.getFolderNodes();
        this.refresh();
    } catch (error) {
        vscode.window.showErrorMessage(`加载挂起更改时出错: ${error}`);
    }
}
  fileNodes : FileNode[] = [];
  folderNodesMap = new Map<string, FolderNode>();
  folderNodesArray : FolderNode[]= [];

  getFileNode(uri: vscode.Uri) {
    return this.fileNodes.find(element => {
      return element.filePath.toLowerCase() === Utilities.removeLeadingSlash(uri).toLowerCase()
    });
  }

  getFolderNode(uri: vscode.Uri) {
    return this.folderNodesArray.find(element => {
      const a = element.getPath().toLowerCase();
      const b = Utilities.replaceForwardSlashes(Utilities.removeLeadingSlash(uri).toLowerCase());
      return a === b;
    });
  }

  /**
   * 获取所有挂起的更改（用于签入所有等功能）
   */
  getAllPendingChanges(): PendingChange[] {
    return this.fileNodes.map(node => node.getPendingChange());
  }

  private async getFolderNodes(): Promise<vscode.TreeItem[]> {
    try {
        this.folderNodesMap.clear();
        this.fileNodes.length = 0; // 修复: 正确清空数组

        const workspaceDir = Utilities.getWorkspaceDirectory();
        if (!workspaceDir) {
            // 没有可用的工作区目录
            return [];
        }

        const pendingChanges = await TFSCommandExecutor.getInstance().status(vscode.Uri.parse(workspaceDir));
        if(pendingChanges === undefined || pendingChanges.length === 0){
            // 没有挂起更改 - 显示占位符消息
            const placeholderNode = new PlaceholderNode('没有挂起的更改');
            return [placeholderNode];
        }

        for (const change of pendingChanges) {
            const directoryPart = path.dirname(change.local);
            let folderNode = this.folderNodesMap.get(directoryPart);

            if (!folderNode) {
                 folderNode = new FolderNode(path.basename(directoryPart), directoryPart, change);
                 this.folderNodesMap.set(directoryPart, folderNode);
             }

            const fileNode = new FileNode(path.basename(change.local), vscode.TreeItemCollapsibleState.None, change.local, change);
            this.fileNodes.push(fileNode);
            folderNode.allChildren.push(fileNode); // 存储在 allChildren 中以支持虚拟滚动
        }

        this.folderNodesArray = Array.from(this.folderNodesMap.values());
        return this.folderNodesArray;
    } catch (error) {
        // 记录错误但不抛出 - 允许视图显示空状态
        console.warn('加载 TFS 挂起更改失败:', error);
        return [];
    }
}

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
        // 根级别 - 返回文件夹节点（懒加载）
        return this.getFolderNodes();
    } else if (element instanceof FolderNode) {
        // 文件夹节点 - 按需加载子项，支持虚拟滚动
        return element.loadChildren(this.maxItemsPerFolder);
    } else if (element instanceof LoadMoreNode) {
        // 为父文件夹加载更多条目
        const folderNode = this.folderNodesMap.get(element.folderPath);
        if (folderNode) {
            folderNode.loadMoreItems();
            // 触发父级刷新
            this.refresh();
        }
        return Promise.resolve([]);
    } else {
        return Promise.resolve([]);
    }
  }

  /**
   * 懒加载文件夹节点的子项
   * 此方法可在展开文件夹时调用
   */
  async loadFolderChildren(_folderNode: FolderNode): Promise<void> {
    // 目前，子项已在 getFolderNodes 中加载
    // 此方法可扩展用于更复杂的懒加载场景
    // 如按需加载子目录
    return Promise.resolve();
  }

  /**
   * 清理资源
   */
  dispose(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
  }
}

class FolderNode extends vscode.TreeItem {
  public childrenLoaded = false;
  public allChildren: vscode.TreeItem[] = [];
  public children: vscode.TreeItem[] = [];
  public hasMoreItems = false;

  constructor(
      public readonly label: string,
      public readonly folderPath: string,
      public readonly pendingChange: PendingChange
  ) {
      super(label, vscode.TreeItemCollapsibleState.Expanded); // 默认展开以显示所有更改
      this.iconPath = vscode.ThemeIcon.Folder;
      this.resourceUri = vscode.Uri.parse(folderPath);
      this.contextValue = 'checkedOut';
  }

  /**
   * 按需加载子项，支持虚拟滚动
   */
  async loadChildren(maxItems?: number): Promise<vscode.TreeItem[]> {
     if (this.childrenLoaded) {
       return this.children;
     }

     // 设置子项，限制虚拟滚动数量
     const limit = maxItems || 100;
     this.children = this.allChildren.slice(0, limit);

     // 如果有更多子项，添加"加载更多"条目
     if (this.allChildren.length > limit) {
       this.hasMoreItems = true;
       const loadMoreItem = new LoadMoreNode(this.folderPath, this.allChildren.length - limit);
       this.children.push(loadMoreItem);
     }

     this.childrenLoaded = true;
     this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
     return this.children;
  }

  /**
   * 加载更多条目以支持虚拟滚动
   */
  async loadMoreItems(increment: number = 50): Promise<void> {
    const currentCount = this.children.length - (this.hasMoreItems ? 1 : 0);
    const newCount = Math.min(currentCount + increment, this.allChildren.length);
    const newItems = this.allChildren.slice(currentCount, newCount);

    // 临时移除"加载更多"条目
    if (this.hasMoreItems) {
      this.children.pop();
    }

    // 添加新条目
    this.children.push(...newItems);

    // 如果仍需，重新添加"加载更多"条目
    if (newCount < this.allChildren.length) {
      const loadMoreItem = new LoadMoreNode(this.folderPath, this.allChildren.length - newCount);
      this.children.push(loadMoreItem);
    } else {
      this.hasMoreItems = false;
    }
  }

  getPath() {
    return this.pendingChange.local;
  }
}

/**
 * 虚拟滚动中的"加载更多"专用节点
 */
class LoadMoreNode extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    public readonly remainingCount: number
  ) {
    super(`加载 ${remainingCount} 个更多条目...`, vscode.TreeItemCollapsibleState.None);
    this.command = {
      command: 'tfs.loadMoreItems',
      title: '加载更多条目',
      arguments: [folderPath]
    };
    this.contextValue = 'loadMore';
  }
}

/**
 * 无数据时的占位符节点
 */
class PlaceholderNode extends vscode.TreeItem {
  constructor(
    public readonly message: string
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'placeholder';
    this.tooltip = '配置 TFS 设置以查看挂起的更改';
  }
}

function strikethrough(text: string): string {
  return text.split('').map(t => t + '̶').join('');
}

export class FileNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly filePath: string,
    public readonly pendingChange: PendingChange
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);

    this.tooltip = getDescriptionText(pendingChange.chg);
    this.command = {
      command: 'vscode.open',
      title: '打开文件',
      arguments: [vscode.Uri.file(this.filePath)],
  };


    if(Utilities.getWorkspaceDirectory() === undefined){
      return;
    }
    const relativePath = path.relative(Utilities.getWorkspaceDirectory(), filePath);
    const directoryPart = path.dirname(relativePath);

    this.iconPath = vscode.ThemeIcon.File;
    this.resourceUri = this.toResourceUri(vscode.Uri.parse('_.'+ path.extname(filePath)), this.pendingChange);
    this.description = directoryPart;

    if(this.pendingChange.chg == TfStatus.Delete){
      this.label = strikethrough(this.label);
      this.description = strikethrough(this.description);
    }

    if(this.pendingChange.chg == TfStatus.Rename){
      this.description = this.pendingChange.srcitem;
    }

    this.contextValue = 'checkedOut';
    this.label = this.label;
  }

  getPath() {
    return this.filePath;
  }

  getPendingChange(): PendingChange {
    return this.pendingChange;
  }

  toResourceUri(uri: vscode.Uri, item : PendingChange ) {
    return uri.with({
      scheme: Schemes.FileChange,
      query: JSON.stringify(item),
    });
  }

}
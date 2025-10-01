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
   private maxItemsPerFolder = 100; // Limit items per folder for virtual scrolling
   private loadedItems = new Map<string, number>(); // Track loaded items per folder

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
    * Debounced refresh to prevent excessive UI updates
    * Delays refresh by 200ms to batch multiple rapid changes
    */
   refresh(): void {
     this.pendingRefresh = true;

     if (this.refreshTimeout) {
       // Already scheduled, just mark as pending
       return;
     }

     this.refreshTimeout = setTimeout(() => {
       if (this.pendingRefresh) {
         this._onDidChangeTreeData.fire(undefined);
         this.pendingRefresh = false;
       }
       this.refreshTimeout = null;
     }, 200); // 200ms debounce delay
   }

   /**
    * Immediate refresh for critical updates
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
        vscode.window.showErrorMessage(`Error loading pending changes: ${error}`);
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

  private async getFolderNodes(): Promise<vscode.TreeItem[]> {
    try {
        this.folderNodesMap.clear();
        this.fileNodes.length = 0; // FIXED: Proper array clearing

        const workspaceDir = Utilities.getWorkspaceDirectory();
        if (!workspaceDir) {
            // No workspace directory available
            return [];
        }

        const pendingChanges = await TFSCommandExecutor.getInstance().status(vscode.Uri.parse(workspaceDir));
        if(pendingChanges === undefined || pendingChanges.length === 0){
            // No pending changes - show placeholder message
            const placeholderNode = new PlaceholderNode('No pending changes');
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
            folderNode.allChildren.push(fileNode); // Store in allChildren for virtual scrolling
        }

        this.folderNodesArray = Array.from(this.folderNodesMap.values());
        return this.folderNodesArray;
    } catch (error) {
        // Log error but don't throw - allow view to show empty state
        console.warn('Failed to load TFS pending changes:', error);
        return [];
    }
}
  
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
    if (!element) {
        // Root level - return folder nodes (lazy loaded)
        return this.getFolderNodes();
    } else if (element instanceof FolderNode) {
        // Folder node - load children on demand with virtual scrolling
        return element.loadChildren(this.maxItemsPerFolder);
    } else if (element instanceof LoadMoreNode) {
        // Load more items for the parent folder
        const folderNode = this.folderNodesMap.get(element.folderPath);
        if (folderNode) {
            folderNode.loadMoreItems();
            // Trigger refresh of the parent
            this.refresh();
        }
        return Promise.resolve([]);
    } else {
        return Promise.resolve([]);
    }
  }

  /**
   * Lazy load children for a folder node
   * This method can be called when a folder is expanded
   */
  async loadFolderChildren(_folderNode: FolderNode): Promise<void> {
    // For now, children are already loaded in getFolderNodes
    // This method can be extended for more complex lazy loading scenarios
    // such as loading subdirectories on demand
    return Promise.resolve();
  }

  /**
   * Cleanup resources
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
      super(label, vscode.TreeItemCollapsibleState.Collapsed); // Start collapsed for lazy loading
      this.iconPath = vscode.ThemeIcon.Folder;
      this.resourceUri = vscode.Uri.parse(folderPath);
      this.contextValue = 'checkedOut';
  }

  /**
   * Load children on demand with virtual scrolling
   */
  async loadChildren(maxItems?: number): Promise<vscode.TreeItem[]> {
     if (this.childrenLoaded) {
       return this.children;
     }

     // Set children with virtual scrolling limit
     const limit = maxItems || 100;
     this.children = this.allChildren.slice(0, limit);

     // Add "Load More" item if there are more children
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
   * Load additional items for virtual scrolling
   */
  async loadMoreItems(increment: number = 50): Promise<void> {
    const currentCount = this.children.length - (this.hasMoreItems ? 1 : 0);
    const newCount = Math.min(currentCount + increment, this.allChildren.length);
    const newItems = this.allChildren.slice(currentCount, newCount);

    // Remove "Load More" item temporarily
    if (this.hasMoreItems) {
      this.children.pop();
    }

    // Add new items
    this.children.push(...newItems);

    // Add "Load More" item back if still needed
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
 * Special node for "Load More" functionality in virtual scrolling
 */
class LoadMoreNode extends vscode.TreeItem {
  constructor(
    public readonly folderPath: string,
    public readonly remainingCount: number
  ) {
    super(`Load ${remainingCount} more items...`, vscode.TreeItemCollapsibleState.None);
    // this.iconPath = vscode.ThemeIcon.Folder; // Use default icon
    this.command = {
      command: 'tfs.loadMoreItems',
      title: 'Load More Items',
      arguments: [folderPath]
    };
    this.contextValue = 'loadMore';
  }
}

/**
 * Placeholder node for when no data is available
 */
class PlaceholderNode extends vscode.TreeItem {
  constructor(
    public readonly message: string
  ) {
    super(message, vscode.TreeItemCollapsibleState.None);
    // this.iconPath = vscode.ThemeIcon.Info; // Use default icon
    this.contextValue = 'placeholder';
    this.tooltip = 'Configure TFS settings to see pending changes';
  }
}

function strikethrough(text: string): string {
  return text.split('').map(t => t + '\u0336').join('');
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
      title: 'Open File',
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

  toResourceUri(uri: vscode.Uri, item : PendingChange ) {
    return uri.with({
      scheme: Schemes.FileChange,
      query: JSON.stringify(item),
    });
  }
  
}
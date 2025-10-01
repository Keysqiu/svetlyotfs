import * as vscode from 'vscode';
import { PendingChangesTreeView } from './PendingChangesTreeView';
import { PendingChange, TfStatus } from '../TFS/Types';
import { HighPerformanceLRUCache } from '../common/LocalCache';

interface DecorationCacheEntry {
  decoration: vscode.FileDecoration;
  timestamp: number;
}

export class PendingChangesViewDecoration implements vscode.FileDecorationProvider {
	private _disposables: vscode.Disposable[] = [];
  private decorationCache: HighPerformanceLRUCache<DecorationCacheEntry>;
  private colorCache: Map<TfStatus, vscode.ThemeColor>;
  private cacheTimeout: number;

  constructor() {
		this._disposables.push(vscode.window.registerFileDecorationProvider(this));
    this.decorationCache = new HighPerformanceLRUCache<DecorationCacheEntry>(1000); // Cache up to 1000 decorations
    this.colorCache = new Map<TfStatus, vscode.ThemeColor>();
    this.cacheTimeout = 5000; // 5 second cache timeout

    // Listen for tree view changes to invalidate cache
    const treeView = PendingChangesTreeView.getInstance();
    this._disposables.push(treeView.onDidChangeTreeData(() => {
      this.decorationCache.clear();
    }));
	}
  
fromFileChangeNodeUri(uri: vscode.Uri): PendingChange | undefined {
	try {
		return uri.query ? JSON.parse(uri.query) as PendingChange : undefined;
	} catch (e) { }
  return undefined;
}

  onDidChangeFileDecorations?: vscode.Event<vscode.Uri | vscode.Uri[] | undefined> | undefined

	provideFileDecoration(
		uri: vscode.Uri,
		_token: vscode.CancellationToken,
	): vscode.ProviderResult<vscode.FileDecoration> {
    const cacheKey = uri.fsPath;
    const now = Date.now();

    // Check cache first
    const cached = this.decorationCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.decoration;
    }

    // Optimized lookup - try the most likely source first
    let pendingChange: PendingChange | undefined;

    // 1. Try file change URI (most specific)
    pendingChange = this.fromFileChangeNodeUri(uri);

    // 2. Try file node lookup
    if (!pendingChange) {
      const fileNode = PendingChangesTreeView.getInstance().getFileNode(uri);
      if (fileNode) {
        pendingChange = fileNode.pendingChange;
      }
    }

    // 3. Try folder node lookup (least likely for file decorations)
    if (!pendingChange) {
      const folderNode = PendingChangesTreeView.getInstance().getFolderNode(uri);
      if (folderNode) {
        pendingChange = folderNode.pendingChange;
      }
    }

    // Create decoration if we have a pending change
    if (pendingChange) {
      const decoration: vscode.FileDecoration = {
        propagate: false,
        color: this.getCachedColor(pendingChange.chg),
        badge: pendingChange.chg.toString().charAt(0)
      };

      // Cache the result
      this.decorationCache.set(cacheKey, {
        decoration,
        timestamp: now
      });

      return decoration;
    }

    return undefined;
	}

  getCachedColor(status: TfStatus): vscode.ThemeColor {
    // Check cache first
    if (this.colorCache.has(status)) {
      return this.colorCache.get(status)!;
    }

    // Create and cache the color
    const colorString = this.remoteReposColors(status);
    const color = new vscode.ThemeColor(colorString);
    this.colorCache.set(status, color);
    return color;
 }

  // Тази функция я описвам просто с ":D"
  remoteReposColors(status: TfStatus): string  {
		switch (status) {
      case TfStatus.AddEncoding:
				return 'gitDecoration.addedResourceForeground';
      case TfStatus.AddEditEncoding:
				return 'gitDecoration.addedResourceForeground';
			case TfStatus.Edit:
				return 'gitDecoration.modifiedResourceForeground';
			case TfStatus.Add:
				return 'gitDecoration.addedResourceForeground';
			case TfStatus.Delete:
				return 'gitDecoration.deletedResourceForeground';
			case TfStatus.Rename:
				return 'gitDecoration.renamedResourceForeground';
      default:
        return '';
		}
	}

  dispose() {
    this._disposables.forEach(disposable => {
      disposable.dispose();
    });
	}
}
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
    this.decorationCache = new HighPerformanceLRUCache<DecorationCacheEntry>(1000); // 缓存最多 1000 个装饰
    this.colorCache = new Map<TfStatus, vscode.ThemeColor>();
    this.cacheTimeout = 5000; // 5 秒缓存超时

    // 监听树视图更改以使缓存失效
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

    // 先检查缓存
    const cached = this.decorationCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < this.cacheTimeout) {
      return cached.decoration;
    }

    // 优化查找 - 首先尝试最可能的来源
    let pendingChange: PendingChange | undefined;

    // 1. 尝试文件更改 URI（最具体）
    pendingChange = this.fromFileChangeNodeUri(uri);

    // 2. 尝试文件节点查找
    if (!pendingChange) {
      const fileNode = PendingChangesTreeView.getInstance().getFileNode(uri);
      if (fileNode) {
        pendingChange = fileNode.pendingChange;
      }
    }

    // 3. 尝试文件夹节点查找（文件装饰可能性最低）
    if (!pendingChange) {
      const folderNode = PendingChangesTreeView.getInstance().getFolderNode(uri);
      if (folderNode) {
        pendingChange = folderNode.pendingChange;
      }
    }

    // 如果有挂起更改，创建装饰
    if (pendingChange) {
      const decoration: vscode.FileDecoration = {
        propagate: false,
        color: this.getCachedColor(pendingChange.chg),
        badge: pendingChange.chg.toString().charAt(0)
      };

      // 缓存结果
      this.decorationCache.set(cacheKey, {
        decoration,
        timestamp: now
      });

      return decoration;
    }

    return undefined;
	}

  getCachedColor(status: TfStatus): vscode.ThemeColor {
    // 先检查缓存
    if (this.colorCache.has(status)) {
      return this.colorCache.get(status)!;
    }

    // 创建并缓存颜色
    const colorString = this.remoteReposColors(status);
    const color = new vscode.ThemeColor(colorString);
    this.colorCache.set(status, color);
    return color;
 }

  // 此函数描述为 ":D"
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
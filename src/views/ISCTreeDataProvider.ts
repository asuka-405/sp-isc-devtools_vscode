import { EventEmitter, ExtensionContext, TreeDataProvider, TreeItem, Event, TreeItemCollapsibleState, TreeDragAndDropController, DataTransfer, DataTransferItem, CancellationToken } from 'vscode';
import { BaseTreeItem, FolderTreeItem, TenantFolderTreeItem, TenantTreeItem } from '../models/ISCTreeItem';
import { TenantService } from '../services/TenantService';
import { SyncManager, SyncState } from '../services/SyncManager';
import { convertToBaseTreeItem } from './utils';


const DROP_MIME_TYPE = 'application/vnd.code.tree.sp-isc-devtools.view';



export class ISCTreeDataProvider implements TreeDataProvider<BaseTreeItem>, TreeDragAndDropController<BaseTreeItem> {

    private _onDidChangeTreeData: EventEmitter<BaseTreeItem | undefined | null | void> = new EventEmitter<BaseTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData?: Event<BaseTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;
    private showOnlyActiveSync = true; // Show only ACTIVE_SYNC tenants by default

    constructor(private readonly context: ExtensionContext,
        private readonly tenantService: TenantService) {
        // Listen to sync state changes to refresh tree
        const syncManager = SyncManager.getInstance();
        syncManager.on('syncStateChanged', () => {
            this.refresh();
        });
        syncManager.on('syncError', () => {
            this.refresh();
        });
    }
    /////////////////////////////////////
    //#region Drag and drop controller
    /////////////////////////////////////
    dropMimeTypes: readonly string[] = [DROP_MIME_TYPE];
    dragMimeTypes: readonly string[] = ["text/uri-list"];

    handleDrag(source: readonly BaseTreeItem[], dataTransfer: DataTransfer, token: CancellationToken): Thenable<void> | void {
        source = source.filter(x => x instanceof TenantTreeItem || x instanceof TenantFolderTreeItem)
        if (source && source.length > 0) {
            dataTransfer.set(DROP_MIME_TYPE, new DataTransferItem(source));
        }
    }

    handleDrop(target: BaseTreeItem, dataTransfer: DataTransfer, token: CancellationToken): Thenable<void> | void {

        if (!(target === undefined || target instanceof TenantFolderTreeItem)) {
            return
        }

        const transferItem = dataTransfer.get(DROP_MIME_TYPE)
        if (!transferItem) {
            return
        }

        const treeItems: BaseTreeItem[] = transferItem.value
        for (const item of treeItems) {
            if (item instanceof TenantTreeItem || item instanceof TenantFolderTreeItem) {
                this.tenantService.move(item.id, target?.id)
            }
        }
        this.refresh()

    }

    /////////////////////////////////////
    //#endregion Drag and drop controller
    /////////////////////////////////////

    forceRefresh(node: BaseTreeItem): void {
        console.log('> ISCDataProvider.forceRefresh');
        node?.reset();
        this.refresh(node);
    }

    refresh(node?: BaseTreeItem): void {
        console.log('> ISCDataProvider.refresh');
        if (node) {
            this._onDidChangeTreeData.fire(node);
        } else {
            this._onDidChangeTreeData.fire();
        }
    }

    async getChildren(item?: BaseTreeItem): Promise<BaseTreeItem[]> {
        console.log("> getChildren", item);
        if (item === undefined) {
            const roots = this.tenantService.getRoots();
            let results = roots.map(x => convertToBaseTreeItem(x, this.tenantService));
            
            // Filter by sync state if enabled
            if (this.showOnlyActiveSync) {
                const syncManager = SyncManager.getInstance();
                results = results.filter(treeItem => {
                    if (treeItem instanceof TenantTreeItem) {
                        const syncState = syncManager.getSyncState(treeItem.tenantId);
                        return syncState === SyncState.ACTIVE_SYNC;
                    }
                    // Include folders and other items
                    return true;
                });
            }
            
            console.log("< getChildren", results);
            return results;
        } else if (item.collapsibleState === TreeItemCollapsibleState.None) {
            console.log("< getChildren []");
            return [];
        } else {
            const results = await item.getChildren();
            console.log("< getChildren", results);
            return results;
        }
    }
    
    /**
     * Toggle showing only ACTIVE_SYNC tenants
     */
    public toggleSyncFilter(): void {
        this.showOnlyActiveSync = !this.showOnlyActiveSync;
        this.refresh();
    }
    
    /**
     * Set whether to show only ACTIVE_SYNC tenants
     */
    public setShowOnlyActiveSync(showOnly: boolean): void {
        this.showOnlyActiveSync = showOnly;
        this.refresh();
    }

    getTreeItem(item: BaseTreeItem): TreeItem {
        console.log("> getTreeItem", item);
        item.updateIcon(this.context);
        console.log("after update", item);

        if (item.contextValue !== item.computedContextValue) {
            const newItem = {
                ...item,
                contextValue: item.computedContextValue
            };
            return newItem;
        } else {

            return item;
        }
    }
}
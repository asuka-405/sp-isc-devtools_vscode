import * as vscode from 'vscode';
import { LocalCacheService, CacheableEntityType } from './cache/LocalCacheService';
import { ISCClient } from './ISCClient';
import { TenantService } from './TenantService';

/**
 * Pending change item
 */
export interface PendingChange {
    tenantId: string;
    tenantName: string;
    entityType: CacheableEntityType;
    entityId: string;
    entityName: string;
}

/**
 * Commit result
 */
export interface CommitResult {
    success: boolean;
    entityId: string;
    entityName: string;
    entityType: CacheableEntityType;
    error?: string;
}

/**
 * Service for managing commits
 */
export class CommitService {
    private static instance: CommitService;
    private readonly _onCommitComplete = new vscode.EventEmitter<CommitResult>();
    public readonly onCommitComplete = this._onCommitComplete.event;
    private stagingEnabled: boolean = false;

    private constructor(
        private readonly tenantService: TenantService,
        private readonly context: vscode.ExtensionContext
    ) {
        const config = vscode.workspace.getConfiguration('sp-isc-devtools');
        this.stagingEnabled = config.get('commit.enableStagingArea', false);
    }

    public isStagingEnabled(): boolean {
        return this.stagingEnabled;
    }

    public async toggleStaging(enabled: boolean): Promise<void> {
        this.stagingEnabled = enabled;
        const config = vscode.workspace.getConfiguration('sp-isc-devtools');
        await config.update('commit.enableStagingArea', enabled, vscode.ConfigurationTarget.Global);
    }

    public static initialize(tenantService: TenantService, context: vscode.ExtensionContext): CommitService {
        if (!CommitService.instance) {
            CommitService.instance = new CommitService(tenantService, context);
        }
        return CommitService.instance;
    }

    public static getInstance(): CommitService {
        if (!CommitService.instance) {
            throw new Error('CommitService not initialized');
        }
        return CommitService.instance;
    }

    /**
     * Get all pending changes
     */
    public async getPendingChanges(tenantId?: string): Promise<PendingChange[]> {
        const cacheService = LocalCacheService.getInstance();
        const changedEntities = cacheService.getEntitiesWithLocalChanges(tenantId);
        const changes: PendingChange[] = [];

        for (const entity of changedEntities) {
            const tenantInfo = this.tenantService.getTenant(entity.tenantId);
            changes.push({
                tenantId: entity.tenantId,
                tenantName: tenantInfo?.name ?? entity.tenantId,
                entityType: entity.entityType,
                entityId: entity.entityId,
                entityName: entity.name
            });
        }

        return changes;
    }

    /**
     * Commit a single entity
     */
    public async commitEntity(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string,
        showConfirmation: boolean = true
    ): Promise<CommitResult> {
        const cacheService = LocalCacheService.getInstance();
        const cached = cacheService.getCachedEntity(tenantId, entityType, entityId);
        
        if (!cached) {
            return {
                success: false,
                entityId,
                entityName: '',
                entityType,
                error: 'Entity not found in cache'
            };
        }

        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            return {
                success: false,
                entityId,
                entityName: cached.name,
                entityType,
                error: 'Tenant not found'
            };
        }

        if (tenantInfo.readOnly) {
            vscode.window.showWarningMessage('This tenant is read-only. Cannot commit changes.');
            return {
                success: false,
                entityId,
                entityName: cached.name,
                entityType,
                error: 'Tenant is read-only'
            };
        }

        if (showConfirmation) {
            const confirm = await vscode.window.showWarningMessage(
                `Commit changes to "${cached.name}"? This will update the resource in SailPoint ISC.`,
                { modal: true },
                'Commit'
            );
            if (confirm !== 'Commit') {
                return {
                    success: false,
                    entityId,
                    entityName: cached.name,
                    entityType,
                    error: 'Cancelled by user'
                };
            }
        }

        try {
            const client = new ISCClient(tenantId, tenantInfo.name);
            await this.pushEntityToRemote(client, entityType, entityId, cached.data, cached.parentId);
            
            cacheService.markAsCommitted(tenantId, entityType, entityId);

            const result: CommitResult = {
                success: true,
                entityId,
                entityName: cached.name,
                entityType
            };

            vscode.window.showInformationMessage(`✅ Successfully committed "${cached.name}"`);
            this._onCommitComplete.fire(result);
            
            return result;
        } catch (error: any) {
            const errorMsg = error.message ?? 'Unknown error';
            vscode.window.showErrorMessage(`❌ Failed to commit "${cached.name}": ${errorMsg}`);
            
            return {
                success: false,
                entityId,
                entityName: cached.name,
                entityType,
                error: errorMsg
            };
        }
    }

    /**
     * Commit all pending changes for a tenant
     */
    public async commitAllForTenant(tenantId: string): Promise<CommitResult[]> {
        const pendingChanges = await this.getPendingChanges(tenantId);
        
        if (pendingChanges.length === 0) {
            vscode.window.showInformationMessage('No pending changes to commit');
            return [];
        }

        const confirm = await vscode.window.showWarningMessage(
            `Commit ${pendingChanges.length} changes to SailPoint ISC?`,
            { modal: true },
            'Commit All'
        );
        
        if (confirm !== 'Commit All') {
            return [];
        }

        const results: CommitResult[] = [];
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Committing changes...',
            cancellable: true
        }, async (progress, token) => {
            for (let i = 0; i < pendingChanges.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }
                
                const change = pendingChanges[i];
                progress.report({
                    message: `(${i + 1}/${pendingChanges.length}) ${change.entityName}`,
                    increment: 100 / pendingChanges.length
                });
                
                const result = await this.commitEntity(
                    change.tenantId,
                    change.entityType,
                    change.entityId,
                    false
                );
                results.push(result);
            }
        });

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;
        
        if (failCount > 0) {
            vscode.window.showWarningMessage(`Committed ${successCount}, failed ${failCount}`);
        } else {
            vscode.window.showInformationMessage(`✅ Successfully committed ${successCount} changes`);
        }

        return results;
    }

    /**
     * Push entity to remote ISC
     */
    private async pushEntityToRemote(
        client: ISCClient,
        entityType: CacheableEntityType,
        entityId: string,
        data: any,
        parentId?: string
    ): Promise<void> {
        switch (entityType) {
            case CacheableEntityType.source:
                await client.updateResource(`v3/sources/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.transform:
                await client.updateResource(`v3/transforms/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.connectorRule:
                await client.updateResource(`beta/connector-rules/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.identityProfile:
                await client.updateResource(`v3/identity-profiles/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.accessProfile:
                await client.updateResource(`v3/access-profiles/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.role:
                await client.updateResource(`v3/roles/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.workflow:
                await client.updateResource(`beta/workflows/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.serviceDesk:
                await client.updateResource(`v3/service-desk-integrations/${entityId}`, JSON.stringify(data));
                break;
            case CacheableEntityType.schema:
                if (parentId) {
                    await client.updateResource(`v3/sources/${parentId}/schemas/${entityId}`, JSON.stringify(data));
                }
                break;
            case CacheableEntityType.provisioningPolicy:
                if (parentId) {
                    await client.updateResource(`v3/sources/${parentId}/provisioning-policies/${data.usageType}`, JSON.stringify(data));
                }
                break;
            default:
                throw new Error(`Unsupported entity type: ${entityType}`);
        }
    }

    /**
     * Revert local changes
     */
    public async revertEntity(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string
    ): Promise<boolean> {
        const cacheService = LocalCacheService.getInstance();
        const tenantInfo = this.tenantService.getTenant(tenantId);
        
        if (!tenantInfo) {
            vscode.window.showErrorMessage('Tenant not found');
            return false;
        }

        const confirm = await vscode.window.showWarningMessage(
            'Revert local changes? This will discard all uncommitted modifications.',
            { modal: true },
            'Revert'
        );
        
        if (confirm !== 'Revert') {
            return false;
        }

        try {
            const client = new ISCClient(tenantId, tenantInfo.name);
            const remoteData = await this.fetchRemoteEntity(client, entityType, entityId);
            
            const cached = cacheService.getCachedEntity(tenantId, entityType, entityId);
            await cacheService.cacheEntity(
                tenantId,
                entityType,
                entityId,
                cached?.name ?? '',
                remoteData,
                cached?.parentId
            );

            vscode.window.showInformationMessage('Changes reverted successfully');
            return true;
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to revert: ${error.message}`);
            return false;
        }
    }

    /**
     * Fetch entity from remote
     */
    private async fetchRemoteEntity(
        client: ISCClient,
        entityType: CacheableEntityType,
        entityId: string,
        parentId?: string
    ): Promise<any> {
        switch (entityType) {
            case CacheableEntityType.source:
                return await client.getResource(`v3/sources/${entityId}`);
            case CacheableEntityType.transform:
                return await client.getResource(`v3/transforms/${entityId}`);
            case CacheableEntityType.connectorRule:
                return await client.getResource(`beta/connector-rules/${entityId}`);
            case CacheableEntityType.identityProfile:
                return await client.getResource(`v3/identity-profiles/${entityId}`);
            case CacheableEntityType.accessProfile:
                return await client.getResource(`v3/access-profiles/${entityId}`);
            case CacheableEntityType.role:
                return await client.getResource(`v3/roles/${entityId}`);
            case CacheableEntityType.workflow:
                return await client.getResource(`beta/workflows/${entityId}`);
            case CacheableEntityType.serviceDesk:
                return await client.getResource(`v3/service-desk-integrations/${entityId}`);
            default:
                throw new Error(`Unsupported entity type: ${entityType}`);
        }
    }

    /**
     * Open diff view
     */
    public async openDiffView(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string
    ): Promise<void> {
        const cacheService = LocalCacheService.getInstance();
        const cached = cacheService.getCachedEntity(tenantId, entityType, entityId);
        
        if (!cached) {
            vscode.window.showErrorMessage('Entity not found in cache');
            return;
        }

        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            vscode.window.showErrorMessage('Tenant not found');
            return;
        }

        try {
            const client = new ISCClient(tenantId, tenantInfo.name);
            const remoteData = await this.fetchRemoteEntity(client, entityType, entityId, cached.parentId);
            
            const localContent = JSON.stringify(cached.data, null, 2);
            const remoteContent = JSON.stringify(remoteData, null, 2);
            
            // Create virtual documents for diff view
            const provider = new (class implements vscode.TextDocumentContentProvider {
                private content: Map<string, string> = new Map();
                
                setContent(uri: string, content: string) {
                    this.content.set(uri, content);
                }
                
                provideTextDocumentContent(uri: vscode.Uri): string {
                    return this.content.get(uri.toString()) || '';
                }
            })();
            
            const localUri = vscode.Uri.parse(`isc-diff://local/${cached.name}.json`);
            const remoteUri = vscode.Uri.parse(`isc-diff://remote/${cached.name}.json`);
            
            provider.setContent(localUri.toString(), localContent);
            provider.setContent(remoteUri.toString(), remoteContent);
            
            this.context.subscriptions.push(
                vscode.workspace.registerTextDocumentContentProvider('isc-diff', provider)
            );
            
            await vscode.commands.executeCommand('vscode.diff', 
                remoteUri, 
                localUri, 
                `${cached.name} (Remote ↔ Local)`
            );
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to open diff: ${error.message}`);
        }
    }
}

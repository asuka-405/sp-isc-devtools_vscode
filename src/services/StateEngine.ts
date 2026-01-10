import { EventEmitter } from 'events';
import { SyncManager, SyncState } from './SyncManager';
import { ISCClient } from './ISCClient';
import { TenantService } from './TenantService';

/**
 * Object type identifiers
 */
export type ObjectType = 
    | 'sources'
    | 'transforms'
    | 'workflows'
    | 'identity-profiles'
    | 'rules'
    | 'access-profiles'
    | 'roles'
    | 'forms'
    | 'service-desk'
    | 'governance-groups'
    | 'identities'
    | 'applications'
    | 'campaigns'
    | 'identity-attributes'
    | 'search-attributes';

/**
 * Normalized object cache entry
 */
export interface ObjectCacheEntry<T = any> {
    id: string;
    type: ObjectType;
    data: T;
    lastUpdated: Date;
    relationships?: Map<string, string[]>; // relationship type -> array of related IDs
}

/**
 * Tenant state cache
 */
export interface TenantState {
    tenantId: string;
    objects: Map<string, ObjectCacheEntry>; // key: `${type}:${id}`
    lastFullSync?: Date;
    syncInProgress: boolean;
    error?: string;
}

/**
 * State Engine - Maintains full object graph per tenant
 * 
 * Responsibilities:
 * - Operate ONLY for ACTIVE_SYNC tenants
 * - Keep in-memory normalized cache
 * - Track relationships
 * - Refresh on schedule or manual trigger
 * 
 * Constraints:
 * - State Engine must not decide sync eligibility
 * - State Engine must tolerate sync suspension
 */
export class StateEngine extends EventEmitter {
    private static instance: StateEngine | undefined;
    private tenantStates: Map<string, TenantState> = new Map();
    private syncManager: SyncManager;
    private tenantService: TenantService;

    private constructor(syncManager: SyncManager, tenantService: TenantService) {
        super();
        this.syncManager = syncManager;
        this.tenantService = tenantService;
        this.setupSyncListeners();
    }

    /**
     * Initialize StateEngine instance
     */
    public static initialize(syncManager: SyncManager, tenantService: TenantService): StateEngine {
        if (!StateEngine.instance) {
            StateEngine.instance = new StateEngine(syncManager, tenantService);
        }
        return StateEngine.instance;
    }

    /**
     * Get StateEngine instance
     */
    public static getInstance(): StateEngine {
        if (!StateEngine.instance) {
            throw new Error('StateEngine not initialized. Call initialize() first.');
        }
        return StateEngine.instance;
    }

    /**
     * Setup listeners for sync manager events
     */
    private setupSyncListeners(): void {
        // Listen for sync triggers (from background refresh)
        this.syncManager.on('syncTrigger', async ({ tenantId }) => {
            if (this.syncManager.getSyncState(tenantId) === SyncState.ACTIVE_SYNC) {
                await this.refreshTenantState(tenantId);
            }
        });

        // Listen for sync state changes
        this.syncManager.on('syncStateChanged', ({ tenantId, state }) => {
            if (state === SyncState.ACTIVE_SYNC) {
                // Start initial sync
                this.refreshTenantState(tenantId).catch(err => {
                    console.error(`[StateEngine] Error in initial sync for ${tenantId}:`, err);
                });
            } else if (state === SyncState.PAUSED || state === SyncState.ERROR) {
                // Clear sync in progress flag but keep cache
                const state = this.tenantStates.get(tenantId);
                if (state) {
                    state.syncInProgress = false;
                }
            }
        });

        // Listen for tenant registration
        this.syncManager.on('tenantRegistered', ({ tenantId }) => {
            this.initializeTenantState(tenantId);
        });

        // Listen for tenant unregistration
        this.syncManager.on('tenantUnregistered', ({ tenantId }) => {
            this.tenantStates.delete(tenantId);
        });
    }

    /**
     * Initialize state for a tenant
     */
    private initializeTenantState(tenantId: string): void {
        if (!this.tenantStates.has(tenantId)) {
            const state: TenantState = {
                tenantId,
                objects: new Map(),
                syncInProgress: false
            };
            this.tenantStates.set(tenantId, state);
        }
    }

    /**
     * Get tenant state
     */
    public getTenantState(tenantId: string): TenantState | undefined {
        return this.tenantStates.get(tenantId);
    }

    /**
     * Check if tenant is actively syncing
     */
    private isActiveSync(tenantId: string): boolean {
        return this.syncManager.getSyncState(tenantId) === SyncState.ACTIVE_SYNC;
    }

    /**
     * Get object from cache
     */
    public getObject<T = any>(tenantId: string, type: ObjectType, id: string): ObjectCacheEntry<T> | undefined {
        const state = this.tenantStates.get(tenantId);
        if (!state) {
            return undefined;
        }
        const key = `${type}:${id}`;
        return state.objects.get(key) as ObjectCacheEntry<T> | undefined;
    }

    /**
     * Get all objects of a type from cache
     */
    public getObjectsByType<T = any>(tenantId: string, type: ObjectType): ObjectCacheEntry<T>[] {
        const state = this.tenantStates.get(tenantId);
        if (!state) {
            return [];
        }
        const results: ObjectCacheEntry<T>[] = [];
        for (const [key, entry] of state.objects.entries()) {
            if (entry.type === type) {
                results.push(entry as ObjectCacheEntry<T>);
            }
        }
        return results;
    }

    /**
     * Store object in cache
     */
    public setObject<T = any>(tenantId: string, type: ObjectType, id: string, data: T, relationships?: Map<string, string[]>): void {
        let state = this.tenantStates.get(tenantId);
        if (!state) {
            this.initializeTenantState(tenantId);
            state = this.tenantStates.get(tenantId)!;
        }

        const key = `${type}:${id}`;
        const entry: ObjectCacheEntry<T> = {
            id,
            type,
            data,
            lastUpdated: new Date(),
            relationships
        };

        state.objects.set(key, entry);
        this.emit('objectUpdated', { tenantId, type, id, entry });
    }

    /**
     * Remove object from cache
     */
    public removeObject(tenantId: string, type: ObjectType, id: string): void {
        const state = this.tenantStates.get(tenantId);
        if (!state) {
            return;
        }
        const key = `${type}:${id}`;
        state.objects.delete(key);
        this.emit('objectRemoved', { tenantId, type, id });
    }

    /**
     * Refresh tenant state (full sync)
     */
    public async refreshTenantState(tenantId: string, force = false): Promise<void> {
        // Only sync ACTIVE_SYNC tenants
        if (!this.isActiveSync(tenantId) && !force) {
            console.log(`[StateEngine] Skipping sync for ${tenantId} (not ACTIVE_SYNC)`);
            return;
        }

        let state = this.tenantStates.get(tenantId);
        if (!state) {
            this.initializeTenantState(tenantId);
            state = this.tenantStates.get(tenantId)!;
        }

        // Prevent concurrent syncs
        if (state.syncInProgress && !force) {
            console.log(`[StateEngine] Sync already in progress for ${tenantId}`);
            return;
        }

        state.syncInProgress = true;
        state.error = undefined;

        try {
            const tenantInfo = this.tenantService.getTenant(tenantId);
            if (!tenantInfo) {
                throw new Error(`Tenant ${tenantId} not found`);
            }

            const client = new ISCClient(tenantId, tenantInfo.tenantName);
            this.emit('syncStarted', { tenantId });

            // Sync all object types
            await Promise.all([
                this.syncObjectType(tenantId, client, 'sources'),
                this.syncObjectType(tenantId, client, 'transforms'),
                this.syncObjectType(tenantId, client, 'workflows'),
                this.syncObjectType(tenantId, client, 'identity-profiles'),
                this.syncObjectType(tenantId, client, 'rules'),
                this.syncObjectType(tenantId, client, 'access-profiles'),
                this.syncObjectType(tenantId, client, 'roles'),
                this.syncObjectType(tenantId, client, 'forms'),
                this.syncObjectType(tenantId, client, 'service-desk'),
                this.syncObjectType(tenantId, client, 'governance-groups'),
                this.syncObjectType(tenantId, client, 'identities'),
                this.syncObjectType(tenantId, client, 'applications'),
                this.syncObjectType(tenantId, client, 'campaigns')
            ]);

            state.lastFullSync = new Date();
            state.syncInProgress = false;

            // Update sync manager with success
            this.syncManager.updateLastSync(tenantId);
            this.emit('syncCompleted', { tenantId, timestamp: state.lastFullSync });
        } catch (error: any) {
            state.syncInProgress = false;
            state.error = error.message || 'Unknown error';
            this.syncManager.setSyncError(tenantId, state.error);
            this.emit('syncError', { tenantId, error: state.error });
            console.error(`[StateEngine] Sync error for ${tenantId}:`, error);
        }
    }

    /**
     * Sync a specific object type
     */
    private async syncObjectType(tenantId: string, client: ISCClient, type: ObjectType): Promise<void> {
        try {
            let objects: any[] = [];

            switch (type) {
                case 'sources':
                    objects = await client.getSources();
                    break;
                case 'transforms':
                    objects = await client.getTransforms();
                    break;
                case 'workflows':
                    objects = await client.getWorflows();
                    break;
                case 'identity-profiles':
                    objects = await client.getIdentityProfiles();
                    break;
                case 'rules':
                    objects = await client.getConnectorRules();
                    break;
                case 'access-profiles':
                    const apResponse = await client.getAccessProfiles();
                    objects = apResponse.data || [];
                    break;
                case 'roles':
                    const rolesResponse = await client.getRoles();
                    objects = rolesResponse.data || [];
                    break;
                case 'forms':
                    objects = await client.listForms();
                    break;
                case 'service-desk':
                    objects = await client.getServiceDesks();
                    break;
                case 'governance-groups':
                    objects = await client.getGovernanceGroups();
                    break;
                case 'identities':
                    const identitiesResp = await client.listIdentities({ limit: 250 });
                    objects = identitiesResp.data || [];
                    break;
                case 'applications':
                    const appsResp = await client.getPaginatedApplications('', 250, 0);
                    objects = appsResp.data || [];
                    break;
                case 'campaigns':
                    const campaignsResp = await client.getPaginatedCampaigns('', 250, 0);
                    objects = campaignsResp.data || [];
                    break;
                default:
                    console.warn(`[StateEngine] Unknown object type: ${type}`);
                    return;
            }

            // Store objects in cache
            for (const obj of objects) {
                if (obj.id) {
                    this.setObject(tenantId, type, obj.id, obj);
                }
            }

            console.log(`[StateEngine] Synced ${objects.length} ${type} for tenant ${tenantId}`);
        } catch (error: any) {
            console.error(`[StateEngine] Error syncing ${type} for ${tenantId}:`, error);
            // Don't throw - continue with other types
        }
    }

    /**
     * Clear cache for a tenant
     */
    public clearTenantCache(tenantId: string): void {
        const state = this.tenantStates.get(tenantId);
        if (state) {
            state.objects.clear();
            state.lastFullSync = undefined;
            this.emit('cacheCleared', { tenantId });
        }
    }

    /**
     * Get cache statistics
     */
    public getCacheStats(tenantId: string): { objectCount: number; lastSync?: Date } {
        const state = this.tenantStates.get(tenantId);
        if (!state) {
            return { objectCount: 0 };
        }
        return {
            objectCount: state.objects.size,
            lastSync: state.lastFullSync
        };
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.tenantStates.clear();
        this.removeAllListeners();
    }
}

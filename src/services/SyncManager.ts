import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { TenantService } from './TenantService';

/**
 * Sync states for tenants
 */
export enum SyncState {
    ACTIVE_SYNC = 'ACTIVE_SYNC',
    PAUSED = 'PAUSED',
    ERROR = 'ERROR',
    DISABLED = 'DISABLED'
}

/**
 * Sync health status
 */
export enum SyncHealth {
    OK = 'OK',
    DEGRADED = 'DEGRADED',
    FAILED = 'FAILED'
}

/**
 * Tenant sync information
 */
export interface TenantSyncInfo {
    tenantId: string;
    state: SyncState;
    health: SyncHealth;
    lastSyncTimestamp?: Date;
    errorMessage?: string;
}

/**
 * Sync Manager - Controls which tenants participate in background state synchronization
 * 
 * Rules:
 * - Maximum 4 tenants may be in ACTIVE_SYNC state at any time
 * - Remaining tenants are in PAUSED (cold) state
 * - Cold tenants are visible in UI but do not run background refresh
 * - Cold tenants load data only on explicit user action
 */
export class SyncManager extends EventEmitter {
    private static instance: SyncManager | undefined;
    private readonly MAX_ACTIVE_SYNC = 4;
    private tenantSyncStates: Map<string, TenantSyncInfo> = new Map();
    private syncIntervals: Map<string, NodeJS.Timeout> = new Map();
    private readonly DEFAULT_SYNC_INTERVAL_MS = 300000; // 5 minutes (default)

    private constructor(private tenantService: TenantService) {
        super();
        this.initializeFromTenants();
    }

    /**
     * Initialize SyncManager instance
     */
    public static initialize(tenantService: TenantService): SyncManager {
        if (!SyncManager.instance) {
            SyncManager.instance = new SyncManager(tenantService);
        }
        return SyncManager.instance;
    }

    /**
     * Get SyncManager instance
     */
    public static getInstance(): SyncManager {
        if (!SyncManager.instance) {
            throw new Error('SyncManager not initialized. Call initialize() first.');
        }
        return SyncManager.instance;
    }

    /**
     * Initialize sync states from existing tenants
     */
    private initializeFromTenants(): void {
        const tenants = this.tenantService.getTenants();
        let activeCount = 0;

        for (const tenant of tenants) {
            // Initialize all tenants as PAUSED by default
            const syncInfo: TenantSyncInfo = {
                tenantId: tenant.id,
                state: SyncState.PAUSED,
                health: SyncHealth.OK
            };
            this.tenantSyncStates.set(tenant.id, syncInfo);
        }

        // Auto-activate up to MAX_ACTIVE_SYNC tenants (first ones)
        for (const tenant of tenants.slice(0, this.MAX_ACTIVE_SYNC)) {
            if (activeCount < this.MAX_ACTIVE_SYNC) {
                this.setSyncState(tenant.id, SyncState.ACTIVE_SYNC, false);
                activeCount++;
            }
        }
    }

    /**
     * Get sync state for a tenant
     */
    public getSyncState(tenantId: string): SyncState {
        const info = this.tenantSyncStates.get(tenantId);
        return info?.state || SyncState.PAUSED;
    }

    /**
     * Get sync info for a tenant
     */
    public getSyncInfo(tenantId: string): TenantSyncInfo | undefined {
        return this.tenantSyncStates.get(tenantId);
    }

    /**
     * Get all tenant sync info
     */
    public getAllSyncInfo(): TenantSyncInfo[] {
        return Array.from(this.tenantSyncStates.values());
    }

    /**
     * Get active sync tenants
     */
    public getActiveSyncTenants(): string[] {
        return Array.from(this.tenantSyncStates.entries())
            .filter(([_, info]) => info.state === SyncState.ACTIVE_SYNC)
            .map(([tenantId]) => tenantId);
    }

    /**
     * Check if tenant can be set to ACTIVE_SYNC
     */
    public canActivateSync(tenantId: string): boolean {
        const currentState = this.getSyncState(tenantId);
        if (currentState === SyncState.ACTIVE_SYNC) {
            return false; // Already active
        }
        if (currentState === SyncState.DISABLED) {
            return false; // Cannot activate disabled tenants
        }
        
        const activeCount = this.getActiveSyncTenants().length;
        return activeCount < this.MAX_ACTIVE_SYNC;
    }

    /**
     * Set sync state for a tenant
     */
    public setSyncState(tenantId: string, state: SyncState, emitEvent = true): boolean {
        const currentInfo = this.tenantSyncStates.get(tenantId);
        if (!currentInfo) {
            console.warn(`[SyncManager] Tenant ${tenantId} not found`);
            return false;
        }

        // Enforce limits
        if (state === SyncState.ACTIVE_SYNC) {
            const activeCount = this.getActiveSyncTenants().length;
            if (activeCount >= this.MAX_ACTIVE_SYNC && currentInfo.state !== SyncState.ACTIVE_SYNC) {
                console.warn(`[SyncManager] Cannot activate sync for ${tenantId}: limit of ${this.MAX_ACTIVE_SYNC} active sync tenants reached`);
                return false;
            }
        }

        // Update state
        const newInfo: TenantSyncInfo = {
            ...currentInfo,
            state,
            health: state === SyncState.ERROR ? SyncHealth.FAILED : 
                   state === SyncState.ACTIVE_SYNC ? SyncHealth.OK : currentInfo.health
        };

        this.tenantSyncStates.set(tenantId, newInfo);

        // Manage background sync loop
        if (state === SyncState.ACTIVE_SYNC) {
            this.startSyncLoop(tenantId);
        } else {
            this.stopSyncLoop(tenantId);
        }

        if (emitEvent) {
            this.emit('syncStateChanged', { tenantId, state, info: newInfo });
        }

        return true;
    }

    /**
     * Pause sync for a tenant
     */
    public pauseSync(tenantId: string): boolean {
        return this.setSyncState(tenantId, SyncState.PAUSED);
    }

    /**
     * Resume sync for a tenant
     */
    public resumeSync(tenantId: string): boolean {
        if (!this.canActivateSync(tenantId)) {
            return false;
        }
        return this.setSyncState(tenantId, SyncState.ACTIVE_SYNC);
    }

    /**
     * Set sync error state
     */
    public setSyncError(tenantId: string, errorMessage: string): void {
        const info = this.tenantSyncStates.get(tenantId);
        if (info) {
            const newInfo: TenantSyncInfo = {
                ...info,
                state: SyncState.ERROR,
                health: SyncHealth.FAILED,
                errorMessage
            };
            this.tenantSyncStates.set(tenantId, newInfo);
            this.emit('syncError', { tenantId, errorMessage, info: newInfo });
        }
    }

    /**
     * Update last sync timestamp
     */
    public updateLastSync(tenantId: string, timestamp: Date = new Date()): void {
        const info = this.tenantSyncStates.get(tenantId);
        if (info) {
            const newInfo: TenantSyncInfo = {
                ...info,
                lastSyncTimestamp: timestamp,
                health: SyncHealth.OK,
                errorMessage: undefined
            };
            // If in ERROR state, keep it unless explicitly changed
            if (info.state !== SyncState.ERROR) {
                this.tenantSyncStates.set(tenantId, newInfo);
            } else {
                // Update timestamp but keep error state
                this.tenantSyncStates.set(tenantId, { ...newInfo, state: SyncState.ERROR });
            }
        }
    }

    /**
     * Get sync interval in milliseconds
     */
    public getSyncIntervalMs(): number {
        const config = vscode.workspace.getConfiguration('sp-isc-devtools');
        return config.get<number>('sync.intervalMs', this.DEFAULT_SYNC_INTERVAL_MS);
    }

    /**
     * Set sync interval in milliseconds
     */
    public async setSyncIntervalMs(intervalMs: number): Promise<void> {
        if (intervalMs < 10000) {
            throw new Error('Sync interval must be at least 10 seconds (10000ms)');
        }
        if (intervalMs > 3600000) {
            throw new Error('Sync interval must be at most 1 hour (3600000ms)');
        }
        
        const config = vscode.workspace.getConfiguration('sp-isc-devtools');
        await config.update('sync.intervalMs', intervalMs, vscode.ConfigurationTarget.Global);
        
        // Restart all active sync loops with new interval
        const activeTenants = this.getActiveSyncTenants();
        for (const tenantId of activeTenants) {
            this.stopSyncLoop(tenantId);
            this.startSyncLoop(tenantId);
        }
        
        this.emit('syncIntervalChanged', { intervalMs });
    }

    /**
     * Start background sync loop for a tenant
     */
    private startSyncLoop(tenantId: string): void {
        // Stop existing loop if any
        this.stopSyncLoop(tenantId);

        // Get current sync interval from configuration
        const intervalMs = this.getSyncIntervalMs();

        // Start new loop
        const interval = setInterval(() => {
            this.emit('syncTrigger', { tenantId });
        }, intervalMs);

        this.syncIntervals.set(tenantId, interval);
        console.log(`[SyncManager] Started sync loop for tenant ${tenantId} with interval ${intervalMs}ms (${intervalMs / 1000}s)`);
    }

    /**
     * Stop background sync loop for a tenant
     */
    private stopSyncLoop(tenantId: string): void {
        const interval = this.syncIntervals.get(tenantId);
        if (interval) {
            clearInterval(interval);
            this.syncIntervals.delete(tenantId);
            console.log(`[SyncManager] Stopped sync loop for tenant ${tenantId}`);
        }
    }

    /**
     * Register a new tenant (called when tenant is added)
     */
    public registerTenant(tenantId: string): void {
        if (!this.tenantSyncStates.has(tenantId)) {
            const syncInfo: TenantSyncInfo = {
                tenantId,
                state: SyncState.PAUSED,
                health: SyncHealth.OK
            };
            this.tenantSyncStates.set(tenantId, syncInfo);
            this.emit('tenantRegistered', { tenantId, info: syncInfo });
        }
    }

    /**
     * Unregister a tenant (called when tenant is removed)
     */
    public unregisterTenant(tenantId: string): void {
        this.stopSyncLoop(tenantId);
        this.tenantSyncStates.delete(tenantId);
        this.emit('tenantUnregistered', { tenantId });
    }

    /**
     * Cleanup - stop all sync loops
     */
    public dispose(): void {
        for (const tenantId of this.syncIntervals.keys()) {
            this.stopSyncLoop(tenantId);
        }
        this.syncIntervals.clear();
        this.tenantSyncStates.clear();
        this.removeAllListeners();
    }
}

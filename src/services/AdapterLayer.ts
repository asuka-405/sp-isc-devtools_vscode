import { StateEngine } from './StateEngine';
import { ISCClient } from './ISCClient';
import { SyncManager, SyncState } from './SyncManager';
import { TenantService } from './TenantService';
import { ObjectType } from './StateEngine';

/**
 * Adapter Layer - Abstracts data access from transport layer
 * 
 * Responsibilities:
 * - Provide unified interface for data access
 * - Use State Engine cache for ACTIVE_SYNC tenants
 * - Fall back to direct API calls for PAUSED tenants or cache misses
 * - Handle pagination automatically
 */
export class AdapterLayer {
    private static instance: AdapterLayer | undefined;
    private stateEngine: StateEngine;
    private syncManager: SyncManager;
    private tenantService: TenantService;
    private readonly PAGE_SIZE = 250;

    private constructor(
        stateEngine: StateEngine,
        syncManager: SyncManager,
        tenantService: TenantService
    ) {
        this.stateEngine = stateEngine;
        this.syncManager = syncManager;
        this.tenantService = tenantService;
    }

    /**
     * Initialize AdapterLayer instance
     */
    public static initialize(
        stateEngine: StateEngine,
        syncManager: SyncManager,
        tenantService: TenantService
    ): AdapterLayer {
        if (!AdapterLayer.instance) {
            AdapterLayer.instance = new AdapterLayer(stateEngine, syncManager, tenantService);
        }
        return AdapterLayer.instance;
    }

    /**
     * Get AdapterLayer instance
     */
    public static getInstance(): AdapterLayer {
        if (!AdapterLayer.instance) {
            throw new Error('AdapterLayer not initialized. Call initialize() first.');
        }
        return AdapterLayer.instance;
    }

    /**
     * Get client for a tenant
     */
    private getClient(tenantId: string): ISCClient {
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            throw new Error(`Tenant ${tenantId} not found`);
        }
        return new ISCClient(tenantId, tenantInfo.tenantName);
    }

    /**
     * Get objects of a type (uses cache if available, otherwise fetches)
     */
    public async getObjects<T = any>(
        tenantId: string,
        type: ObjectType,
        options?: {
            useCache?: boolean;
            offset?: number;
            limit?: number;
            filters?: string;
        }
    ): Promise<T[]> {
        const useCache = options?.useCache !== false;
        const syncState = this.syncManager.getSyncState(tenantId);

        // Try cache first for ACTIVE_SYNC tenants
        if (useCache && syncState === SyncState.ACTIVE_SYNC) {
            const cached = this.stateEngine.getObjectsByType<T>(tenantId, type);
            if (cached.length > 0) {
                // Apply filters if provided
                let results = cached.map(entry => entry.data);
                if (options?.filters) {
                    results = this.applyFilters(results, options.filters);
                }
                // Apply pagination
                const offset = options?.offset || 0;
                const limit = options?.limit || this.PAGE_SIZE;
                return results.slice(offset, offset + limit);
            }
        }

        // Fall back to direct API call
        return this.fetchObjectsDirect<T>(tenantId, type, options);
    }

    /**
     * Get a single object by ID
     */
    public async getObject<T = any>(
        tenantId: string,
        type: ObjectType,
        id: string,
        useCache = true
    ): Promise<T | undefined> {
        const syncState = this.syncManager.getSyncState(tenantId);

        // Try cache first for ACTIVE_SYNC tenants
        if (useCache && syncState === SyncState.ACTIVE_SYNC) {
            const cached = this.stateEngine.getObject<T>(tenantId, type, id);
            if (cached) {
                return cached.data;
            }
        }

        // Fall back to direct API call
        return this.fetchObjectDirect<T>(tenantId, type, id);
    }

    /**
     * Fetch objects directly from API
     */
    private async fetchObjectsDirect<T = any>(
        tenantId: string,
        type: ObjectType,
        options?: {
            offset?: number;
            limit?: number;
            filters?: string;
        }
    ): Promise<T[]> {
        const client = this.getClient(tenantId);
        const limit = Math.min(options?.limit || this.PAGE_SIZE, this.PAGE_SIZE);
        const offset = options?.offset || 0;

        try {
            switch (type) {
                case 'sources':
                    const sources = await client.getSources();
                    return this.paginateResults(sources, offset, limit) as T[];
                case 'transforms':
                    const transforms = await client.getTransforms();
                    return this.paginateResults(transforms, offset, limit) as T[];
                case 'workflows':
                    const workflows = await client.getWorflows();
                    return this.paginateResults(workflows, offset, limit) as T[];
                case 'identity-profiles':
                    const identityProfiles = await client.getIdentityProfiles();
                    return this.paginateResults(identityProfiles, offset, limit) as T[];
                case 'rules':
                    const rules = await client.getConnectorRules();
                    return this.paginateResults(rules, offset, limit) as T[];
                case 'access-profiles':
                    const apResponse = await client.getAccessProfiles({
                        limit,
                        offset,
                        filters: options?.filters
                    });
                    return (apResponse.data || []) as T[];
                case 'roles':
                    const rolesResponse = await client.getRoles({
                        limit,
                        offset,
                        filters: options?.filters
                    });
                    return (rolesResponse.data || []) as T[];
                case 'forms':
                    const forms = await client.listForms();
                    return this.paginateResults(forms, offset, limit) as T[];
                case 'service-desk':
                    const serviceDesks = await client.getServiceDesks();
                    return this.paginateResults(serviceDesks, offset, limit) as T[];
                case 'governance-groups':
                    const governanceGroups = await client.getGovernanceGroups(options?.filters, limit);
                    return this.paginateResults(governanceGroups, offset, limit) as T[];
                case 'identities':
                    const identitiesResp = await client.listIdentities({ 
                        limit, 
                        offset,
                        filters: options?.filters 
                    });
                    return (identitiesResp.data || []) as T[];
                case 'applications':
                    const appsResp = await client.getPaginatedApplications(
                        options?.filters || '', 
                        limit, 
                        offset
                    );
                    return (appsResp.data || []) as T[];
                case 'identity-attributes':
                    const identityAttrs = await client.getIdentityAttributes();
                    return this.paginateResults(identityAttrs, offset, limit) as T[];
                case 'search-attributes':
                    const searchAttrs = await client.getSearchAttributes();
                    return this.paginateResults(searchAttrs, offset, limit) as T[];
                default:
                    console.warn(`[AdapterLayer] Unknown object type: ${type}`);
                    return [];
            }
        } catch (error: any) {
            console.error(`[AdapterLayer] Error fetching ${type} for ${tenantId}:`, error);
            throw error;
        }
    }

    /**
     * Fetch a single object directly from API
     */
    private async fetchObjectDirect<T = any>(
        tenantId: string,
        type: ObjectType,
        id: string
    ): Promise<T | undefined> {
        const client = this.getClient(tenantId);

        try {
            switch (type) {
                case 'sources':
                    return await client.getSourceById(id) as T;
                case 'transforms':
                    // Would need getTransformById if available
                    const transforms = await client.getTransforms();
                    return transforms.find(t => t.id === id) as T | undefined;
                case 'workflows':
                    return await client.getWorflow(id) as T;
                case 'identity-profiles':
                    // Would need getIdentityProfileById if available
                    const profiles = await client.getIdentityProfiles();
                    return profiles.find(p => p.id === id) as T | undefined;
                case 'rules':
                    return await client.getConnectorRuleById(id) as T;
                case 'access-profiles':
                    // Would need getAccessProfileById if available
                    const aps = await client.getAccessProfiles();
                    return aps.data?.find(ap => ap.id === id) as T | undefined;
                case 'roles':
                    // Would need getRoleById if available
                    const roles = await client.getRoles();
                    return roles.data?.find(r => r.id === id) as T | undefined;
                case 'forms':
                    // Would need getFormById if available
                    const forms = await client.listForms();
                    return forms.find(f => f.id === id) as T | undefined;
                case 'service-desk':
                    // Would need getServiceDeskById if available
                    const serviceDesks = await client.getServiceDesks();
                    return serviceDesks.find(sd => sd.id === id) as T | undefined;
                default:
                    console.warn(`[AdapterLayer] Unknown object type: ${type}`);
                    return undefined;
            }
        } catch (error: any) {
            console.error(`[AdapterLayer] Error fetching ${type}:${id} for ${tenantId}:`, error);
            return undefined;
        }
    }

    /**
     * Apply simple filters to results (basic implementation)
     */
    private applyFilters<T>(results: T[], filters: string): T[] {
        // Basic filter implementation - can be enhanced
        // For now, just return all results
        // In production, this would parse the filter string and apply it
        return results;
    }

    /**
     * Paginate results
     */
    private paginateResults<T>(results: T[], offset: number, limit: number): T[] {
        return results.slice(offset, offset + limit);
    }

    /**
     * Get count of objects (for pagination)
     */
    public async getObjectCount(
        tenantId: string,
        type: ObjectType,
        filters?: string
    ): Promise<number> {
        const syncState = this.syncManager.getSyncState(tenantId);

        // Try cache first for ACTIVE_SYNC tenants
        if (syncState === SyncState.ACTIVE_SYNC) {
            const cached = this.stateEngine.getObjectsByType(tenantId, type);
            if (cached.length > 0) {
                return cached.length;
            }
        }

        // Fall back to API call with count
        const client = this.getClient(tenantId);
        try {
            switch (type) {
                case 'access-profiles':
                    const apResponse = await client.getAccessProfiles({
                        limit: 0,
                        offset: 0,
                        count: true,
                        filters
                    });
                    return parseInt(apResponse.headers['x-total-count'] || '0');
                case 'roles':
                    const rolesResponse = await client.getRoles({
                        limit: 0,
                        offset: 0,
                        count: true,
                        filters
                    });
                    return parseInt(rolesResponse.headers['x-total-count'] || '0');
                case 'identities':
                    const identitiesResp = await client.listIdentities({
                        limit: 0,
                        offset: 0,
                        count: true,
                        filters
                    });
                    return parseInt(identitiesResp.headers['x-total-count'] || '0');
                case 'applications':
                    const appsResp = await client.getPaginatedApplications(
                        filters || '', 
                        0, 
                        0, 
                        true
                    );
                    return parseInt(appsResp.headers['x-total-count'] || '0');
                case 'sources':
                    const sources = await client.getSources();
                    return sources.length;
                case 'transforms':
                    const transforms = await client.getTransforms();
                    return transforms.length;
                case 'workflows':
                    const workflows = await client.getWorflows();
                    return workflows.length;
                case 'identity-profiles':
                    const identityProfiles = await client.getIdentityProfiles();
                    return identityProfiles.length;
                case 'rules':
                    const rules = await client.getConnectorRules();
                    return rules.length;
                case 'forms':
                    const forms = await client.listForms();
                    return forms.length;
                case 'governance-groups':
                    const governanceGroups = await client.getGovernanceGroups();
                    return governanceGroups.length;
                case 'campaigns':
                    const campaignsResp = await client.getPaginatedCampaigns('', 0, 0, true);
                    return parseInt(campaignsResp.headers['x-total-count'] || '0');
                case 'service-desk':
                    const serviceDesks = await client.getServiceDesks();
                    return serviceDesks.length;
                default:
                    // For other types, return cached count or estimate
                    const objects = await this.getObjects(tenantId, type, { useCache: true });
                    return objects.length;
            }
        } catch (error: any) {
            console.error(`[AdapterLayer] Error getting count for ${type}:`, error);
            return 0;
        }
    }
}

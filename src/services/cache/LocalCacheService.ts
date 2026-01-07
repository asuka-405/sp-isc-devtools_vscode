import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

/**
 * Entity types that can be cached
 */
export enum CacheableEntityType {
    source = 'sources',
    transform = 'transforms',
    connectorRule = 'connector-rules',
    identityProfile = 'identity-profiles',
    accessProfile = 'access-profiles',
    role = 'roles',
    workflow = 'workflows',
    form = 'forms',
    serviceDesk = 'service-desk-integrations',
    lifecycleState = 'lifecycle-states',
    schema = 'schemas',
    provisioningPolicy = 'provisioning-policies',
}

/**
 * Cached entity metadata
 */
export interface CachedEntity<T = any> {
    id: string;
    name: string;
    type: CacheableEntityType;
    tenantId: string;
    data: T;
    remoteHash: string;
    localHash: string;
    lastFetched: number;
    lastModifiedLocal?: number;
    parentId?: string;
}

/**
 * Cache index structure
 */
interface CacheIndex {
    version: string;
    tenants: {
        [tenantId: string]: {
            [entityType: string]: {
                [entityId: string]: {
                    name: string;
                    remoteHash: string;
                    localHash: string;
                    lastFetched: number;
                    lastModifiedLocal?: number;
                    parentId?: string;
                    hasLocalChanges: boolean;
                }
            }
        }
    }
}

/**
 * Local cache service for storing ISC entities offline
 */
export class LocalCacheService {
    private static instance: LocalCacheService;
    private cacheDir: string;
    private indexPath: string;
    private index: CacheIndex;
    private readonly cacheVersion = '1.0.0';

    private constructor(private readonly context: vscode.ExtensionContext) {
        this.cacheDir = path.join(context.globalStorageUri.fsPath, 'entity-cache');
        this.indexPath = path.join(this.cacheDir, 'index.json');
        this.index = this.loadIndex();
    }

    public static initialize(context: vscode.ExtensionContext): LocalCacheService {
        if (!LocalCacheService.instance) {
            LocalCacheService.instance = new LocalCacheService(context);
        }
        return LocalCacheService.instance;
    }

    public static getInstance(): LocalCacheService {
        if (!LocalCacheService.instance) {
            throw new Error('LocalCacheService not initialized');
        }
        return LocalCacheService.instance;
    }

    private ensureCacheDir(): void {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    private loadIndex(): CacheIndex {
        this.ensureCacheDir();
        if (fs.existsSync(this.indexPath)) {
            try {
                const data = fs.readFileSync(this.indexPath, 'utf-8');
                const index = JSON.parse(data) as CacheIndex;
                if (index.version === this.cacheVersion) {
                    return index;
                }
            } catch (e) {
                console.error('Failed to load cache index:', e);
            }
        }
        return { version: this.cacheVersion, tenants: {} };
    }

    private saveIndex(): void {
        this.ensureCacheDir();
        fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
    }

    private computeHash(data: any): string {
        const str = JSON.stringify(data, Object.keys(data).sort());
        return createHash('sha256').update(str).digest('hex').substring(0, 16);
    }

    private getEntityPath(tenantId: string, entityType: CacheableEntityType, entityId: string): string {
        return path.join(this.cacheDir, tenantId, entityType, `${entityId}.json`);
    }

    public async cacheEntity<T>(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string,
        name: string,
        data: T,
        parentId?: string
    ): Promise<CachedEntity<T>> {
        const hash = this.computeHash(data);
        const entityPath = this.getEntityPath(tenantId, entityType, entityId);
        
        const dir = path.dirname(entityPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        const cachedEntity: CachedEntity<T> = {
            id: entityId,
            name,
            type: entityType,
            tenantId,
            data,
            remoteHash: hash,
            localHash: hash,
            lastFetched: Date.now(),
            parentId
        };

        fs.writeFileSync(entityPath, JSON.stringify(cachedEntity, null, 2));

        if (!this.index.tenants[tenantId]) {
            this.index.tenants[tenantId] = {};
        }
        if (!this.index.tenants[tenantId][entityType]) {
            this.index.tenants[tenantId][entityType] = {};
        }
        this.index.tenants[tenantId][entityType][entityId] = {
            name,
            remoteHash: hash,
            localHash: hash,
            lastFetched: Date.now(),
            parentId,
            hasLocalChanges: false
        };
        this.saveIndex();

        return cachedEntity;
    }

    public async updateLocalEntity<T>(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string,
        data: T
    ): Promise<CachedEntity<T> | null> {
        const entityPath = this.getEntityPath(tenantId, entityType, entityId);
        
        if (!fs.existsSync(entityPath)) {
            return null;
        }

        const existing = JSON.parse(fs.readFileSync(entityPath, 'utf-8')) as CachedEntity<T>;
        const newHash = this.computeHash(data);

        const updated: CachedEntity<T> = {
            ...existing,
            data,
            localHash: newHash,
            lastModifiedLocal: Date.now()
        };

        fs.writeFileSync(entityPath, JSON.stringify(updated, null, 2));

        if (this.index.tenants[tenantId]?.[entityType]?.[entityId]) {
            this.index.tenants[tenantId][entityType][entityId].localHash = newHash;
            this.index.tenants[tenantId][entityType][entityId].lastModifiedLocal = Date.now();
            this.index.tenants[tenantId][entityType][entityId].hasLocalChanges = newHash !== existing.remoteHash;
            this.saveIndex();
        }

        return updated;
    }

    public getCachedEntity<T>(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string
    ): CachedEntity<T> | null {
        const entityPath = this.getEntityPath(tenantId, entityType, entityId);
        
        if (!fs.existsSync(entityPath)) {
            return null;
        }

        try {
            return JSON.parse(fs.readFileSync(entityPath, 'utf-8')) as CachedEntity<T>;
        } catch (e) {
            return null;
        }
    }

    public getAllCachedEntities<T>(
        tenantId: string,
        entityType: CacheableEntityType
    ): CachedEntity<T>[] {
        const results: CachedEntity<T>[] = [];
        const typeIndex = this.index.tenants[tenantId]?.[entityType];
        
        if (!typeIndex) {
            return results;
        }

        for (const entityId of Object.keys(typeIndex)) {
            const entity = this.getCachedEntity<T>(tenantId, entityType, entityId);
            if (entity) {
                results.push(entity);
            }
        }

        return results;
    }

    public getEntitiesWithLocalChanges(tenantId?: string): Array<{
        tenantId: string;
        entityType: CacheableEntityType;
        entityId: string;
        name: string;
    }> {
        const results: Array<{
            tenantId: string;
            entityType: CacheableEntityType;
            entityId: string;
            name: string;
        }> = [];

        const tenants = tenantId ? [tenantId] : Object.keys(this.index.tenants);

        for (const tid of tenants) {
            const tenantIndex = this.index.tenants[tid];
            if (!tenantIndex) { continue; }

            for (const [entityType, entities] of Object.entries(tenantIndex)) {
                for (const [entityId, metadata] of Object.entries(entities)) {
                    if (metadata.hasLocalChanges) {
                        results.push({
                            tenantId: tid,
                            entityType: entityType as CacheableEntityType,
                            entityId,
                            name: metadata.name
                        });
                    }
                }
            }
        }

        return results;
    }

    public hasLocalChanges(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string
    ): boolean {
        return this.index.tenants[tenantId]?.[entityType]?.[entityId]?.hasLocalChanges ?? false;
    }

    public markAsCommitted(
        tenantId: string,
        entityType: CacheableEntityType,
        entityId: string
    ): void {
        const entityPath = this.getEntityPath(tenantId, entityType, entityId);
        
        if (!fs.existsSync(entityPath)) {
            return;
        }

        const entity = JSON.parse(fs.readFileSync(entityPath, 'utf-8')) as CachedEntity;
        entity.remoteHash = entity.localHash;
        delete entity.lastModifiedLocal;
        fs.writeFileSync(entityPath, JSON.stringify(entity, null, 2));

        if (this.index.tenants[tenantId]?.[entityType]?.[entityId]) {
            this.index.tenants[tenantId][entityType][entityId].remoteHash = entity.localHash;
            this.index.tenants[tenantId][entityType][entityId].hasLocalChanges = false;
            delete this.index.tenants[tenantId][entityType][entityId].lastModifiedLocal;
            this.saveIndex();
        }
    }

    public clearTenantCache(tenantId: string): void {
        const tenantDir = path.join(this.cacheDir, tenantId);
        if (fs.existsSync(tenantDir)) {
            fs.rmSync(tenantDir, { recursive: true });
        }
        delete this.index.tenants[tenantId];
        this.saveIndex();
    }

    public clearAllCache(): void {
        if (fs.existsSync(this.cacheDir)) {
            fs.rmSync(this.cacheDir, { recursive: true });
        }
        this.index = { version: this.cacheVersion, tenants: {} };
        this.ensureCacheDir();
        this.saveIndex();
    }
}

import * as vscode from 'vscode';
import { ISCClient } from './ISCClient';
import { TenantService } from './TenantService';

/**
 * Search index types
 */
export type SearchIndexType = 'identities' | 'accessprofiles' | 'entitlements' | 'roles' | 'events' | 'accounts';

/**
 * Search result
 */
export interface SearchResult {
    id: string;
    name: string;
    _type: string;
    description?: string;
    source?: { id: string; name: string };
    raw: any;
}

/**
 * Quick filter
 */
export interface QuickFilter {
    id: string;
    label: string;
    description: string;
    query: string;
    indices: SearchIndexType[];
}

/**
 * Predefined quick filters
 */
export const QUICK_FILTERS: QuickFilter[] = [
    {
        id: 'modified-today',
        label: '📅 Modified Today',
        description: 'Items modified in the last 24 hours',
        query: 'modified:[now-1d TO now]',
        indices: ['identities', 'accessprofiles', 'roles', 'entitlements']
    },
    {
        id: 'modified-week',
        label: '📆 Modified This Week',
        description: 'Items modified in the last 7 days',
        query: 'modified:[now-7d TO now]',
        indices: ['identities', 'accessprofiles', 'roles', 'entitlements']
    },
    {
        id: 'active-identities',
        label: '✅ Active Identities',
        description: 'All active identities',
        query: 'lifecycleState.name:active',
        indices: ['identities']
    },
    {
        id: 'inactive-identities',
        label: '⏸️ Inactive Identities',
        description: 'All inactive identities',
        query: 'lifecycleState.name:inactive',
        indices: ['identities']
    },
    {
        id: 'privileged-access',
        label: '🔐 Privileged Access',
        description: 'Access profiles marked as privileged',
        query: 'privileged:true',
        indices: ['accessprofiles']
    },
    {
        id: 'requestable-roles',
        label: '🎫 Requestable Roles',
        description: 'Roles that can be requested',
        query: 'requestable:true',
        indices: ['roles']
    },
    {
        id: 'orphan-accounts',
        label: '👻 Orphan Accounts',
        description: 'Uncorrelated accounts',
        query: 'uncorrelated:true',
        indices: ['accounts']
    }
];

/**
 * SailPoint Search Service
 */
export class SearchService {
    private static instance: SearchService;
    private searchHistory: Map<string, string[]> = new Map();
    private readonly maxHistory = 20;

    private constructor(
        private readonly tenantService: TenantService,
        private readonly context: vscode.ExtensionContext
    ) {
        this.loadSearchHistory();
    }

    public static initialize(tenantService: TenantService, context: vscode.ExtensionContext): SearchService {
        if (!SearchService.instance) {
            SearchService.instance = new SearchService(tenantService, context);
        }
        return SearchService.instance;
    }

    public static getInstance(): SearchService {
        if (!SearchService.instance) {
            throw new Error('SearchService not initialized');
        }
        return SearchService.instance;
    }

    private loadSearchHistory(): void {
        const history = this.context.globalState.get<Record<string, string[]>>('searchHistory', {});
        this.searchHistory = new Map(Object.entries(history));
    }

    private async saveSearchHistory(): Promise<void> {
        const history = Object.fromEntries(this.searchHistory);
        await this.context.globalState.update('searchHistory', history);
    }

    private async addToHistory(tenantId: string, query: string): Promise<void> {
        if (!this.searchHistory.has(tenantId)) {
            this.searchHistory.set(tenantId, []);
        }
        
        const history = this.searchHistory.get(tenantId)!;
        const existingIndex = history.indexOf(query);
        if (existingIndex > -1) {
            history.splice(existingIndex, 1);
        }
        history.unshift(query);
        if (history.length > this.maxHistory) {
            history.pop();
        }
        await this.saveSearchHistory();
    }

    public getSearchHistory(tenantId: string): string[] {
        return this.searchHistory.get(tenantId) ?? [];
    }

    /**
     * Global search
     */
    public async globalSearch(
        tenantId: string,
        query: string,
        options?: { indices?: SearchIndexType[]; limit?: number }
    ): Promise<SearchResult[]> {
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            throw new Error('Tenant not found');
        }

        const client = new ISCClient(tenantId, tenantInfo.name);
        const indices = options?.indices ?? ['identities', 'accessprofiles', 'roles', 'entitlements'];
        const limit = options?.limit ?? 100;
        const results: SearchResult[] = [];

        await this.addToHistory(tenantId, query);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Searching SailPoint ISC...',
            cancellable: true
        }, async (progress, token) => {
            for (const index of indices) {
                if (token.isCancellationRequested) { break; }

                progress.report({ message: `Searching ${index}...` });

                try {
                    const searchPayload: any = {
                        indices: [index],
                        query: { query },
                        sort: ['-modified']
                    };

                    const response = await client.search(searchPayload, limit);
                    
                    for (const item of response || []) {
                        const doc = item as any;
                        results.push({
                            id: doc.id,
                            name: doc.name || doc.displayName || doc.id,
                            _type: index,
                            description: doc.description,
                            source: doc.source,
                            raw: item
                        });
                    }
                } catch (error) {
                    console.error(`Error searching ${index}:`, error);
                }
            }
        });

        return results;
    }

    /**
     * Show search quick pick UI
     */
    public async showSearchQuickPick(tenantId: string): Promise<void> {
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            vscode.window.showErrorMessage('Tenant not found');
            return;
        }

        const history = this.getSearchHistory(tenantId);

        type QuickPickItem = vscode.QuickPickItem & { action?: string; value?: string };
        const items: QuickPickItem[] = [
            { label: '$(search) Enter Search Query...', description: 'Search SailPoint ISC', action: 'search' },
            { label: '', kind: vscode.QuickPickItemKind.Separator },
            { label: 'Quick Filters', kind: vscode.QuickPickItemKind.Separator },
            ...QUICK_FILTERS.map(f => ({
                label: f.label,
                description: f.description,
                action: 'filter',
                value: f.id
            }))
        ];

        if (history.length > 0) {
            items.push(
                { label: '', kind: vscode.QuickPickItemKind.Separator },
                { label: 'Recent Searches', kind: vscode.QuickPickItemKind.Separator },
                ...history.slice(0, 5).map(h => ({
                    label: `$(history) ${h}`,
                    action: 'history',
                    value: h
                }))
            );
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: `Search in ${tenantInfo.name}...`,
            matchOnDescription: true
        });

        if (!selected || !selected.action) { return; }

        let query: string | undefined;
        let indices: SearchIndexType[] | undefined;

        switch (selected.action) {
            case 'search':
                query = await vscode.window.showInputBox({
                    placeHolder: 'name:John OR email:*@example.com',
                    prompt: 'Enter SailPoint search query',
                    ignoreFocusOut: true
                });
                break;
            case 'filter':
                const filter = QUICK_FILTERS.find(f => f.id === selected.value);
                if (filter) {
                    query = filter.query;
                    indices = filter.indices;
                }
                break;
            case 'history':
                query = selected.value;
                break;
        }

        if (!query) { return; }

        const results = await this.globalSearch(tenantId, query, { indices });
        
        if (results.length === 0) {
            vscode.window.showInformationMessage('No results found');
            return;
        }

        // Show results
        const resultItems = results.map(r => ({
            label: r.name,
            description: `${r._type} • ${r.id}`,
            detail: r.description?.substring(0, 100),
            result: r
        }));

        const selectedResult = await vscode.window.showQuickPick(resultItems, {
            placeHolder: `${results.length} results found`,
            matchOnDescription: true,
            matchOnDetail: true
        });

        if (selectedResult) {
            // Open the resource
            vscode.window.showInformationMessage(`Selected: ${selectedResult.result.name} (${selectedResult.result._type})`);
        }
    }

    /**
     * Find transform usages in identity profiles
     */
    public async findTransformUsage(
        tenantId: string,
        transformName: string
    ): Promise<{ profileId: string; profileName: string; attributeName: string }[]> {
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            throw new Error('Tenant not found');
        }

        const client = new ISCClient(tenantId, tenantInfo.name);
        const profiles = await client.getIdentityProfiles();
        const usages: { profileId: string; profileName: string; attributeName: string }[] = [];

        for (const profile of profiles) {
            const attributeConfig = (profile as any).identityAttributeConfig;
            if (!attributeConfig?.attributeTransforms) { continue; }

            for (const transform of attributeConfig.attributeTransforms) {
                const transformDef = transform.transformDefinition;
                if (this.transformReferencesName(transformDef, transformName)) {
                    usages.push({
                        profileId: profile.id!,
                        profileName: profile.name!,
                        attributeName: transform.identityAttributeName
                    });
                }
            }
        }

        return usages;
    }

    private transformReferencesName(transformDef: any, name: string): boolean {
        if (!transformDef) { return false; }

        if (transformDef.type === 'reference' && transformDef.attributes?.id === name) {
            return true;
        }

        if (transformDef.attributes) {
            for (const value of Object.values(transformDef.attributes)) {
                if (typeof value === 'object' && value !== null) {
                    if (this.transformReferencesName(value, name)) {
                        return true;
                    }
                }
            }
        }

        return false;
    }
}

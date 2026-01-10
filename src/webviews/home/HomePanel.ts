import * as vscode from 'vscode';
import { TenantService } from '../../services/TenantService';
import { TenantInfo } from '../../models/TenantInfo';
import { ISCClient, TOTAL_COUNT_HEADER } from '../../services/ISCClient';
import { LocalCacheService } from '../../services/cache/LocalCacheService';
import { SyncManager } from '../../services/SyncManager';
import { AdapterLayer } from '../../services/AdapterLayer';
import * as commands from '../../commands/constants';

type EntityType = 'sources' | 'transforms' | 'workflows' | 'identity-profiles' | 'rules' | 
                  'access-profiles' | 'roles' | 'forms' | 'governance-groups' | 'campaigns' |
                  'service-desk' | 'notification-templates' | 'segments' | 'tags' | 
                  'identities' | 'identity-attributes' | 'search-attributes' | 'applications' |
                  'accounts' | 'access-history' | 'outliers' | 'activities' |
                  'entitlements' | 'role-insights' | 'metadata' | 'launchers' |
                  'virtual-appliances' | 'integrations' | 'multi-host-sources' | 'credential-providers';

interface NavigationState {
    view: 'home' | 'tenant' | 'entity-list' | 'sync-management' | 'search' | 'automation';
    tenantId?: string;
    tenantName?: string;
    entityType?: EntityType;
    searchQuery?: string;
    searchResults?: any[];
    automationTaskId?: string;
    automationStep?: 'select' | 'configure' | 'execute';
}

export class HomePanel {
    public static currentPanel: HomePanel | undefined;
    public static readonly viewType = 'iscDevToolsHome';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    private navigationState: NavigationState = { view: 'home' };
    private entityCache: Map<string, any[]> = new Map();
    private searchQuery: string = '';
    private recentItems: { type: string; name: string; tenantId: string; id: string; timestamp: number }[] = [];
    private entityListPagination: { offset: number; limit: number; total?: number } = { offset: 0, limit: 250 };

    public static createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService
    ): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (HomePanel.currentPanel) {
            HomePanel.currentPanel._panel.reveal(column);
            HomePanel.currentPanel._update();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            HomePanel.viewType,
            'ISC DevTools',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        HomePanel.currentPanel = new HomePanel(panel, extensionUri, tenantService);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private tenantService: TenantService
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(
            async (message) => { await this.handleMessage(message); },
            null,
            this._disposables
        );
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'navigate':
                this.navigationState = message.state;
                await this._update();
                break;
            case 'goHome':
                this.navigationState = { view: 'home' };
                await this._update();
                break;
            case 'goBack':
                this.goBack();
                await this._update();
                break;
            case 'openAutomation':
                this.navigationState = {
                    view: 'automation',
                    tenantId: this.navigationState.tenantId,
                    tenantName: this.navigationState.tenantName
                };
                await this._update();
                break;
            case 'selectAutomationTask':
                this.navigationState.automationTaskId = message.taskId;
                this.navigationState.automationStep = 'configure';
                await this._update();
                break;
            case 'executeAutomationTask':
                await this.handleExecuteAutomationTask(message);
                break;
            case 'executeTaskSearch':
                await this.handleExecuteTaskSearch(message.taskId, message.query);
                break;
            case 'uploadCSV':
                await this.handleCSVUpload(message.fileData, message.fileName, message.taskId);
                break;
            case 'searchIdentities':
                await this.handleSearchIdentities(message.query, message.fieldName);
                break;
            case 'addTenant':
                await vscode.commands.executeCommand(commands.ADD_TENANT);
                await this._update();
                break;
            case 'pauseSync':
                await this.handlePauseSync(message.tenantId);
                break;
            case 'resumeSync':
                await this.handleResumeSync(message.tenantId);
                break;
            case 'refreshSyncStatus':
                await this._update();
                break;
            case 'entityListPreviousPage':
                if (this.entityListPagination.offset > 0) {
                    this.entityListPagination.offset = Math.max(0, this.entityListPagination.offset - this.entityListPagination.limit);
                    this.entityListPagination.total = undefined; // Reset to recalculate
                    await this._update();
                }
                break;
            case 'entityListNextPage':
                this.entityListPagination.offset += this.entityListPagination.limit;
                this.entityListPagination.total = undefined; // Reset to recalculate
                await this._update();
                break;
            case 'refreshEntityList':
                this.entityListPagination.offset = 0;
                this.entityListPagination.total = undefined;
                this.entityCache.clear();
                await this._update();
                break;
            case 'loadEntityList':
                this.entityListPagination.offset = 0;
                this.entityListPagination.total = undefined;
                this.entityCache.clear();
                this.navigationState = {
                    view: 'entity-list',
                    tenantId: this.navigationState.tenantId,
                    tenantName: this.navigationState.tenantName,
                    entityType: message.entityType
                };
                await this._update();
                break;
            case 'selectTenant':
                this.navigationState = {
                    view: 'tenant',
                    tenantId: message.tenantId,
                    tenantName: message.tenantName
                };
                await this._update();
                break;
            case 'openEntity':
                await this.openEntity(message.entityType, message.entityId, message.entityName);
                break;
            case 'search':
                this.searchQuery = message.query;
                await this._update();
                break;
            case 'entitySearch':
                this.searchQuery = message.query || '';
                this.entityListPagination.offset = 0;
                this.entityListPagination.total = undefined;
                await this._update();
                break;
            case 'performGlobalSearch':
                await this.handleGlobalSearch(message.query, message.indices);
                break;
            case 'clearGlobalSearch':
                this.navigationState.searchQuery = '';
                this.navigationState.searchResults = [];
                await this._update();
                break;
            case 'showHelp':
                await this.handleShowHelp(message.helpKey);
                break;
            case 'globalSearch':
                // Navigate to search page
                this.navigateToSearch(
                    this.navigationState.tenantId,
                    this.navigationState.tenantName
                );
                break;
            case 'refresh':
                this.entityCache.clear();
                await this._update();
                break;
            case 'clearCache':
                try { LocalCacheService.getInstance().clearAllCache(); vscode.window.showInformationMessage('Cache cleared'); } catch {}
                break;
            case 'exportConfig':
                await vscode.commands.executeCommand(commands.EXPORT_CONFIG_PALETTE);
                break;
            case 'importConfig':
                await vscode.commands.executeCommand(commands.IMPORT_CONFIG_PALETTE);
                break;
            case 'openDocs':
                vscode.env.openExternal(vscode.Uri.parse('https://developer.sailpoint.com/docs/'));
                break;
            case 'openSidebar':
                await vscode.commands.executeCommand('workbench.view.extension.sp-isc-devtools');
                break;
            case 'newRule':
                if (this.navigationState.tenantId) {
                    const tenantInfo = this.tenantService.getTenant(this.navigationState.tenantId);
                    if (tenantInfo) {
                        await vscode.commands.executeCommand(commands.NEW_RULE, {
                            tenantId: this.navigationState.tenantId,
                            tenantName: tenantInfo.tenantName
                        });
                    }
                }
                break;
        }
    }

    private goBack(): void {
        if (this.navigationState.view === 'entity-list') {
            this.navigationState = { view: 'tenant', tenantId: this.navigationState.tenantId, tenantName: this.navigationState.tenantName };
        } else if (this.navigationState.view === 'automation' && this.navigationState.automationStep === 'configure') {
            this.navigationState.automationStep = 'select';
            this.navigationState.automationTaskId = undefined;
        } else if (this.navigationState.view === 'automation') {
            this.navigationState = { view: 'tenant', tenantId: this.navigationState.tenantId, tenantName: this.navigationState.tenantName };
        } else if (this.navigationState.view === 'tenant') {
            this.navigationState = { view: 'home' };
        }
    }

    private addToRecent(type: string, name: string, id: string): void {
        const item = { type, name, tenantId: this.navigationState.tenantId!, id, timestamp: Date.now() };
        this.recentItems = [item, ...this.recentItems.filter(i => i.id !== id)].slice(0, 10);
    }

    private async openEntity(entityType: string, entityId: string, entityName: string): Promise<void> {
        const tenantId = this.navigationState.tenantId;
        if (!tenantId) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            return;
        }

        // Get tenant info from service
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            return;
        }

        this.addToRecent(entityType, entityName, entityId);
        const args = { tenantId, tenantName: tenantInfo.tenantName, id: entityId };

        try {
            // Open specialized panels for each entity type
            switch (entityType) {
                case 'sources':
                    await vscode.commands.executeCommand(commands.OPEN_SOURCE_CONFIG_PANEL, args);
                    break;
                case 'rules':
                    await vscode.commands.executeCommand(commands.OPEN_RULE_EDITOR, args);
                    break;
                case 'transforms':
                    await vscode.commands.executeCommand(commands.OPEN_TRANSFORM_EDITOR, args);
                    break;
                case 'access-profiles':
                    await vscode.commands.executeCommand(commands.OPEN_ACCESS_PROFILE_EDITOR, args);
                    break;
                case 'roles':
                    await vscode.commands.executeCommand(commands.OPEN_ROLE_EDITOR, args);
                    break;
                case 'workflows':
                    await vscode.commands.executeCommand(commands.OPEN_WORKFLOW_EDITOR, args);
                    break;
                default:
                    const uri = vscode.Uri.parse(`idn://${tenantInfo.tenantName}/${entityType}/${entityId}`);
                    await vscode.commands.executeCommand('vscode.open', uri);
            }
        } finally {
            // Always hide the loader after opening the entity
            this._panel.webview.postMessage({ command: 'hideLoader' });
        }
    }

    private async handlePauseSync(tenantId: string): Promise<void> {
        const syncManager = SyncManager.getInstance();
        syncManager.pauseSync(tenantId);
        await this._update();
    }

    private async handleResumeSync(tenantId: string): Promise<void> {
        const syncManager = SyncManager.getInstance();
        if (syncManager.canActivateSync(tenantId)) {
            syncManager.resumeSync(tenantId);
            await this._update();
        } else {
            vscode.window.showWarningMessage('Cannot activate sync: Maximum of 4 active sync tenants reached.');
        }
    }

    private async handleShowHelp(helpKey: string): Promise<void> {
        try {
            const { HelpService } = await import('../../services/HelpService');
            const helpService = HelpService.getInstance();
            const help = helpService.getHelp(helpKey);
            
            if (help) {
                const message = help.link 
                    ? `${help.title}\n\n${help.content}\n\nLearn more: ${help.link}`
                    : `${help.title}\n\n${help.content}`;
                
                vscode.window.showInformationMessage(message, ...(help.link ? ['Open Documentation'] : []))
                    .then(selection => {
                        if (selection === 'Open Documentation' && help.link) {
                            vscode.env.openExternal(vscode.Uri.parse(help.link));
                        }
                    });
            } else {
                vscode.window.showInformationMessage('Help content not available for this item.');
            }
        } catch (error) {
            console.error('[HomePanel] Error showing help:', error);
        }
    }

    private async handleGlobalSearch(query: string, indices?: string[]): Promise<void> {
        const tenantId = this.navigationState.tenantId;
        if (!tenantId) {
            vscode.window.showWarningMessage('Please select a tenant first');
            return;
        }

        if (!query || query.trim() === '') {
            return;
        }

        try {
            const searchServiceModule = await import('../../services/SearchService');
            const searchService = searchServiceModule.SearchService.getInstance();
            
            this._panel.webview.postMessage({ command: 'showLoader', message: 'Searching...' });
            
            const results = await searchService.globalSearch(tenantId, query.trim(), { 
                indices: indices as any 
            });
            
            this.navigationState.searchQuery = query;
            this.navigationState.searchResults = results;
            this.navigationState.view = 'search';
            
            await this._update();
            this._panel.webview.postMessage({ command: 'hideLoader' });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            vscode.window.showErrorMessage(`Search failed: ${error.message}`);
            console.error('[HomePanel] Search error:', error);
        }
    }

    private async fetchEntities(entityType: EntityType, options?: { offset?: number; limit?: number; searchQuery?: string }): Promise<any[]> {
        const tenantId = this.navigationState.tenantId;
        
        // Validate tenant info
        if (!tenantId) {
            console.error(`[HomePanel] Missing tenantId`);
            return [];
        }

        const limit = Math.min(options?.limit || 250, 250); // Enforce max 250
        const offset = options?.offset || 0;
        const searchQuery = options?.searchQuery || this.searchQuery || '';
        const cacheKey = `${tenantId}-${entityType}-${offset}-${limit}-${searchQuery}`;
        
        if (this.entityCache.has(cacheKey)) {
            return this.entityCache.get(cacheKey)!;
        }

        try {
            // Use AdapterLayer for data access (enforces pagination and uses cache)
            const adapterLayer = AdapterLayer.getInstance();
            
            // Map EntityType to ObjectType
            const objectTypeMap: Record<EntityType, any> = {
                'sources': 'sources',
                'transforms': 'transforms',
                'workflows': 'workflows',
                'identity-profiles': 'identity-profiles',
                'rules': 'rules',
                'access-profiles': 'access-profiles',
                'roles': 'roles',
                'forms': 'forms',
                'governance-groups': 'governance-groups',
                'campaigns': 'campaigns',
                'service-desk': 'service-desk',
                'notification-templates': undefined,
                'segments': undefined,
                'tags': undefined,
                'identities': 'identities',
                'identity-attributes': undefined,
                'search-attributes': undefined,
                'applications': 'applications',
                'accounts': undefined, // Link-only type
                'access-history': undefined, // Link-only type
                'outliers': undefined, // Link-only type
                'activities': undefined, // Link-only type
                'entitlements': undefined, // Link-only type
                'role-insights': undefined, // Link-only type
                'metadata': undefined, // Link-only type
                'segments': undefined, // Link-only type
                'launchers': undefined, // Link-only type
                'virtual-appliances': undefined, // Link-only type
                'integrations': undefined, // Link-only type
                'multi-host-sources': undefined, // Link-only type
                'credential-providers': undefined // Link-only type
            };

            const objectType = objectTypeMap[entityType];
            
            if (objectType) {
                // Use AdapterLayer (enforces pagination)
                const entities = await adapterLayer.getObjects(tenantId, objectType, {
                    offset,
                    limit,
                    useCache: true
                });
                
                this.entityCache.set(cacheKey, entities);
                return entities;
            } else {
                // Fallback for types not in AdapterLayer yet
                const tenantInfo = this.tenantService.getTenant(tenantId);
                if (!tenantInfo) {
                    console.error(`[HomePanel] Tenant not found: ${tenantId}`);
                    return [];
                }

                const client = new ISCClient(tenantId, tenantInfo.tenantName);
                let entities: any[] = [];

                switch (entityType) {
                    case 'identity-attributes': 
                        entities = await client.getIdentityAttributes(); 
                        // Enforce pagination
                        entities = entities.slice(offset, offset + limit);
                        break;
                    case 'search-attributes': 
                        entities = await client.getSearchAttributes(); 
                        // Enforce pagination
                        entities = entities.slice(offset, offset + limit);
                        break;
                    case 'accounts':
                        // Fetch accounts with pagination
                        const accountsResp = await client.getAccounts({
                            limit,
                            offset,
                            filters: searchQuery ? `name sw "${searchQuery}"` : undefined
                        });
                        entities = accountsResp.data || [];
                        break;
                    case 'access-history':
                        // Use Search API for access history (events index)
                        const { Search } = await import('sailpoint-api-client');
                        const accessHistorySearch: Search = {
                            indices: ['events'],
                            query: {
                                query: searchQuery || '*'
                            },
                            sort: ['-created']
                        };
                        const accessHistoryResults = await client.search(accessHistorySearch, limit);
                        entities = accessHistoryResults.slice(offset, offset + limit);
                        break;
                    case 'outliers':
                        // Use Search API for outliers (search identities with outlier flag)
                        const { Search: OutlierSearch } = await import('sailpoint-api-client');
                        const outlierSearch: OutlierSearch = {
                            indices: ['identities'],
                            query: {
                                query: searchQuery ? `name sw "${searchQuery}" AND attributes.outlier:true` : 'attributes.outlier:true'
                            },
                            sort: ['name']
                        };
                        const outlierResults = await client.search(outlierSearch, limit);
                        entities = outlierResults.slice(offset, offset + limit);
                        break;
                    case 'activities':
                        // Use Search API for activities (events index with activity type)
                        const { Search: ActivitySearch } = await import('sailpoint-api-client');
                        const activitySearch: ActivitySearch = {
                            indices: ['events'],
                            query: {
                                query: searchQuery ? `type:activity AND name sw "${searchQuery}"` : 'type:activity'
                            },
                            sort: ['-created']
                        };
                        const activityResults = await client.search(activitySearch, limit);
                        entities = activityResults.slice(offset, offset + limit);
                        break;
                    case 'entitlements':
                        // Fetch entitlements with pagination
                        const entitlementsResp = await client.getEntitlements({
                            limit,
                            offset,
                            filters: searchQuery ? `name sw "${searchQuery}"` : undefined
                        });
                        entities = entitlementsResp.data || [];
                        break;
                    case 'segments':
                        // Fetch segments
                        const segments = await client.getSegments();
                        // Apply search filter if provided
                        let filteredSegments = segments;
                        if (searchQuery) {
                            filteredSegments = segments.filter(s => 
                                (s.name || '').toLowerCase().includes(searchQuery.toLowerCase())
                            );
                        }
                        // Enforce pagination
                        entities = filteredSegments.slice(offset, offset + limit);
                        break;
                    case 'role-insights':
                        // Use Search API for role insights (search roles with insights)
                        const { Search: RoleInsightSearch } = await import('sailpoint-api-client');
                        const roleInsightSearch: RoleInsightSearch = {
                            indices: ['roles'],
                            query: {
                                query: searchQuery ? `name sw "${searchQuery}"` : '*'
                            },
                            sort: ['name']
                        };
                        const roleInsightResults = await client.search(roleInsightSearch, limit);
                        entities = roleInsightResults.slice(offset, offset + limit);
                        break;
                    case 'metadata':
                        // Use Search API for metadata (search access profiles and roles with metadata)
                        const { Search: MetadataSearch } = await import('sailpoint-api-client');
                        const metadataSearch: MetadataSearch = {
                            indices: ['accessprofiles', 'roles'],
                            query: {
                                query: searchQuery ? `name sw "${searchQuery}" AND accessModelMetadata:*` : 'accessModelMetadata:*'
                            },
                            sort: ['name']
                        };
                        const metadataResults = await client.search(metadataSearch, limit);
                        entities = metadataResults.slice(offset, offset + limit);
                        break;
                    case 'launchers':
                        // Fetch all applications and filter for launchers client-side
                        // Note: applications index is not available in Search API, and type field is not queryable
                        try {
                            // Fetch a larger batch to account for filtering
                            const fetchLimit = Math.min(limit * 10, 2000); // Fetch more to find launchers
                            const allAppsResp = await client.getPaginatedApplications(
                                searchQuery ? `name sw "${searchQuery}"` : '',
                                fetchLimit,
                                0 // Start from beginning
                            );
                            const allApps = allAppsResp.data || [];
                            console.log(`[HomePanel] Fetched ${allApps.length} applications for launcher filtering`);
                            
                            // Log structure of first few apps to understand the data model
                            if (allApps.length > 0) {
                                console.log(`[HomePanel] First app structure:`, {
                                    id: allApps[0].id,
                                    name: allApps[0].name,
                                    allKeys: Object.keys(allApps[0]),
                                    accountSource: allApps[0].accountSource,
                                    enabled: allApps[0].enabled
                                });
                                
                                // Log a few more to see variations
                                if (allApps.length > 1) {
                                    console.log(`[HomePanel] Second app:`, {
                                        name: allApps[1].name,
                                        accountSource: allApps[1].accountSource
                                    });
                                }
                                if (allApps.length > 2) {
                                    console.log(`[HomePanel] Third app:`, {
                                        name: allApps[2].name,
                                        accountSource: allApps[2].accountSource
                                    });
                                }
                            }
                            
                            // Filter for launcher applications
                            // Launchers might be identified by:
                            // - accountSource.type being something specific
                            // - accountSource.name containing "launch"
                            // - Some other property
                            let launchers = allApps.filter((app: any) => {
                                const accountSource = app.accountSource || {};
                                const accountSourceType = accountSource.type || '';
                                const accountSourceName = (accountSource.name || '').toLowerCase();
                                const appName = (app.name || '').toLowerCase();
                                
                                // Check various possible indicators
                                const isLauncher = 
                                    accountSourceName.includes('launch') ||
                                    accountSourceName.includes('launcher') ||
                                    appName.includes('launcher') ||
                                    accountSourceType === 'LAUNCHER' ||
                                    accountSourceType === 'launcher';
                                
                                return isLauncher;
                            });
                            
                            console.log(`[HomePanel] Found ${launchers.length} launchers out of ${allApps.length} applications`);
                            
                            // If no launchers found, log all unique accountSource types to help identify the pattern
                            if (launchers.length === 0 && allApps.length > 0) {
                                const uniqueTypes = new Set(allApps.map((app: any) => app.accountSource?.type || 'N/A'));
                                const uniqueSourceNames = new Set(allApps.map((app: any) => app.accountSource?.name || 'N/A').slice(0, 20));
                                console.log(`[HomePanel] No launchers found. Unique accountSource types:`, Array.from(uniqueTypes));
                                console.log(`[HomePanel] Sample accountSource names:`, Array.from(uniqueSourceNames));
                            }
                            
                            // Apply pagination after filtering
                            entities = launchers.slice(offset, offset + limit);
                        } catch (error) {
                            console.error('[HomePanel] Error fetching launchers:', error);
                            entities = [];
                        }
                        break;
                    default: 
                        entities = [];
                }

                this.entityCache.set(cacheKey, entities);
                return entities;
            }
        } catch (error: any) {
            console.error(`[HomePanel] Failed to fetch ${entityType}:`, error);
            return [];
        }
    }

    private async _update(): Promise<void> {
        this._panel.webview.html = await this._getHtmlForWebview();
    }

    public navigateToSyncManagement(): void {
        this.navigationState = { view: 'sync-management' };
        this._update();
    }

    private async _getHtmlForWebview(): Promise<string> {
        const tenants = this.tenantService.getTenants();
        let content = '';
        let breadcrumbs = '';

        switch (this.navigationState.view) {
            case 'home':
                content = this._renderHomeView(tenants);
                breadcrumbs = '<span class="breadcrumb active">Home</span>';
                break;
            case 'sync-management':
                content = await this._renderSyncManagementView();
                breadcrumbs = '<span class="breadcrumb" onclick="goHome()">Home</span><span class="sep">/</span><span class="breadcrumb active">Manage Tenant Sync</span>';
                break;
            case 'search':
                content = await this._renderSearchView();
                breadcrumbs = `<span class="breadcrumb" onclick="goHome()">Home</span><span class="sep">/</span><span class="breadcrumb" onclick="selectTenant('${this.navigationState.tenantId}', '${this.esc(this.navigationState.tenantName || '')}')">${this.esc(this.navigationState.tenantName || '')}</span><span class="sep">/</span><span class="breadcrumb active">Search</span>`;
                break;
            case 'automation':
                content = await this._renderAutomationView();
                breadcrumbs = `<span class="breadcrumb" onclick="goHome()">Home</span><span class="sep">/</span><span class="breadcrumb" onclick="selectTenant('${this.navigationState.tenantId}', '${this.esc(this.navigationState.tenantName || '')}')">${this.esc(this.navigationState.tenantName || '')}</span><span class="sep">/</span><span class="breadcrumb active">Automation</span>`;
                break;
            case 'tenant':
                content = await this._renderTenantView();
                breadcrumbs = `<span class="breadcrumb" onclick="goHome()">Home</span><span class="sep">/</span><span class="breadcrumb active">${this.esc(this.navigationState.tenantName || '')}</span>`;
                break;
            case 'entity-list':
                content = await this._renderEntityListView();
                breadcrumbs = `<span class="breadcrumb" onclick="goHome()">Home</span><span class="sep">/</span><span class="breadcrumb" onclick="selectTenant('${this.navigationState.tenantId}', '${this.esc(this.navigationState.tenantName || '')}')">${this.esc(this.navigationState.tenantName || '')}</span><span class="sep">/</span><span class="breadcrumb active">${this._getEntityLabel(this.navigationState.entityType!)}</span>`;
                break;
        }

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ISC DevTools</title>
    <style>${this._getStyles()}</style>
</head>
<body>
    <!-- Loader Overlay -->
    <div class="loader-overlay" id="loader">
        <div class="loader">
            <div class="loader-spinner"></div>
            <div class="loader-text" id="loaderText">Loading...</div>
        </div>
    </div>

    <div class="app">
        <header class="header">
            <nav class="nav-left">
                <button class="nav-btn" onclick="goHome()" title="Home">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L8.354 1.146z"/></svg>
                </button>
                <div class="breadcrumbs">${breadcrumbs}</div>
            </nav>
            <div class="search-container">
                <svg class="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/></svg>
                <input type="text" id="searchInput" placeholder="Search..." value="${this.esc(this.searchQuery)}" onkeyup="handleSearch(event)">
            </div>
            <nav class="nav-right">
                <button class="nav-btn" onclick="refresh()" title="Refresh">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>
                </button>
                <button class="nav-btn" onclick="openSidebar()" title="Tree View">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h12zM2 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2H2z"/><path d="M3 4h10v1H3V4zm0 3h10v1H3V7zm0 3h10v1H3v-1z"/></svg>
                </button>
            </nav>
        </header>
        <main class="main">${content}</main>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        
        // Loader functions
        function showLoader(text = 'Loading...') {
            const loader = document.getElementById('loader');
            const loaderText = document.getElementById('loaderText');
            if (loaderText) loaderText.textContent = text;
            if (loader) loader.classList.add('active');
        }
        
        function hideLoader() {
            const loader = document.getElementById('loader');
            if (loader) loader.classList.remove('active');
        }
        
        function goHome() { vscode.postMessage({ command: 'goHome' }); }
        function goBack() { vscode.postMessage({ command: 'goBack' }); }
        function selectTenant(id, name) { showLoader('Loading tenant...'); vscode.postMessage({ command: 'selectTenant', tenantId: id, tenantName: name }); }
        function loadEntityList(type) { showLoader('Loading...'); vscode.postMessage({ command: 'loadEntityList', entityType: type }); }
        function openEntity(type, id, name) { showLoader('Opening...'); vscode.postMessage({ command: 'openEntity', entityType: type, entityId: id, entityName: name }); }
        function addTenant() { vscode.postMessage({ command: 'addTenant' }); }
        function refresh() { showLoader('Refreshing...'); vscode.postMessage({ command: 'refresh' }); }
        function clearCache() { showLoader('Clearing cache...'); vscode.postMessage({ command: 'clearCache' }); }
        function exportConfig() { showLoader('Exporting...'); vscode.postMessage({ command: 'exportConfig' }); }
        function importConfig() { vscode.postMessage({ command: 'importConfig' }); }
        function openDocs() { vscode.postMessage({ command: 'openDocs' }); }
        function openSidebar() { vscode.postMessage({ command: 'openSidebar' }); }
        function globalSearch() { vscode.postMessage({ command: 'globalSearch' }); }
        function openGlobalSearch() { vscode.postMessage({ command: 'globalSearch' }); }
        function newRule() { showLoader('Creating rule...'); vscode.postMessage({ command: 'newRule' }); }
        function openAutomation() { vscode.postMessage({ command: 'openAutomation' }); }
        function selectAutomationTask(taskId) { vscode.postMessage({ command: 'selectAutomationTask', taskId: taskId }); }
        function executeAutomationTask(taskId, config) { showLoader('Executing task...'); vscode.postMessage({ command: 'executeAutomationTask', taskId: taskId, config: config }); }
        function uploadCSVFile(file) { 
            const reader = new FileReader();
            reader.onload = (e) => {
                vscode.postMessage({ command: 'uploadCSV', fileName: file.name, fileData: e.target.result });
            };
            reader.readAsText(file);
        }
        function handleSearch(event) { if (event.key === 'Enter') { showLoader('Searching...'); vscode.postMessage({ command: 'search', query: event.target.value }); } }
        document.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); document.getElementById('searchInput')?.focus(); } });
        
        // Hide loader when page is ready
        document.addEventListener('DOMContentLoaded', () => { hideLoader(); });
        window.addEventListener('load', () => { hideLoader(); });
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'hideLoader') {
                hideLoader();
            }
        });
    </script>
</body>
</html>`;
    }

    private _renderHomeView(tenants: TenantInfo[]): string {
        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>SailPoint ISC DevTools</h1>
                        <p class="subtitle">Identity Security Cloud Development Environment</p>
                    </div>
                </div>
                
                ${this.recentItems.length > 0 ? `
                <section class="section">
                    <h2 class="section-title">Recent</h2>
                    <div class="recent-grid">
                        ${this.recentItems.slice(0, 6).map(item => `
                            <button class="recent-item" onclick="openEntity('${item.type}s', '${item.id}', '${this.esc(item.name)}')">
                                <span class="recent-name">${this.esc(item.name)}</span>
                                <span class="recent-meta">${this._getEntityLabel(item.type)}</span>
                            </button>
                        `).join('')}
                    </div>
                </section>
                ` : ''}
                
                <section class="section">
                    <div class="section-header">
                        <h2 class="section-title">Tenants</h2>
                        <button class="btn btn-primary" onclick="addTenant()">Add Tenant</button>
                    </div>
                    ${tenants.length > 0 ? `
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>URL</th>
                                        <th>Status</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${tenants.map(t => `
                                        <tr class="table-row" onclick="selectTenant('${t.id}', '${this.esc(t.name)}')">
                                            <td class="cell-primary">${this.esc(t.tenantName || t.name)}</td>
                                            <td class="cell-secondary">${this.esc(t.name)}.identitynow.com</td>
                                            <td><span class="status ${t.readOnly ? 'status-warning' : 'status-success'}">${t.readOnly ? 'Read Only' : 'Active'}</span></td>
                                            <td class="cell-action"><span class="arrow">→</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    ` : `
                        <div class="empty">
                            <p>No tenants configured</p>
                            <button class="btn btn-primary" onclick="addTenant()">Add Your First Tenant</button>
                        </div>
                    `}
                </section>
                
                <section class="section">
                    <h2 class="section-title">Quick Actions</h2>
                    <div class="actions-grid">
                        <button class="action-btn" onclick="exportConfig()">
                            <span class="action-title">Export Config</span>
                            <span class="action-desc">Download SP-Config backup</span>
                        </button>
                        <button class="action-btn" onclick="importConfig()">
                            <span class="action-title">Import Config</span>
                            <span class="action-desc">Upload SP-Config backup</span>
                        </button>
                        <button class="action-btn" onclick="clearCache()">
                            <span class="action-title">Clear Cache</span>
                            <span class="action-desc">Reset local entity cache</span>
                        </button>
                        <button class="action-btn" onclick="openDocs()">
                            <span class="action-title">Documentation</span>
                            <span class="action-desc">SailPoint Developer Portal</span>
                        </button>
                        <button class="action-btn" onclick="openSyncManagement()" title="Manage tenant synchronization settings. Activate/pause sync for up to 4 tenants simultaneously.">
                            <span class="action-title">Manage Tenant Sync</span>
                            <span class="action-desc">Control background synchronization</span>
                        </button>
                    </div>
                </section>
            </div>
            
            <script>
                function openSyncManagement() {
                    vscode.postMessage({ command: 'navigate', state: { view: 'sync-management' } });
                }
            </script>
        `;
    }

    private async _renderTenantView(): Promise<string> {
        // Organized by category to match spec hierarchy
        const categories = [
            {
                name: 'Identity Management',
                items: [
                    { type: 'identities' as EntityType, label: 'Identities' },
                    { type: 'accounts' as EntityType, label: 'Accounts' },
                    { type: 'access-history' as EntityType, label: 'Access History' },
                    { type: 'identity-profiles' as EntityType, label: 'Identity Profiles' },
                    { type: 'outliers' as EntityType, label: 'Outliers' },
                    { type: 'governance-groups' as EntityType, label: 'Governance Groups' },
                    { type: 'activities' as EntityType, label: 'Activities' }
                ]
            },
            {
                name: 'Access Model',
                items: [
                    { type: 'access-profiles' as EntityType, label: 'Access Profiles' },
                    { type: 'roles' as EntityType, label: 'Roles' },
                    { type: 'entitlements' as EntityType, label: 'Entitlements' },
                    { type: 'role-insights' as EntityType, label: 'Role Insights' },
                    { type: 'applications' as EntityType, label: 'Applications' },
                    { type: 'metadata' as EntityType, label: 'Metadata' },
                    { type: 'segments' as EntityType, label: 'Segments' },
                    { type: 'launchers' as EntityType, label: 'Launchers' }
                ]
            },
            {
                name: 'Connections',
                items: [
                    { type: 'sources' as EntityType, label: 'Sources' },
                    { type: 'transforms' as EntityType, label: 'Transforms' },
                    { type: 'rules' as EntityType, label: 'Connector Rules' },
                    { type: 'service-desk' as EntityType, label: 'Service Desk' },
                    { type: 'virtual-appliances' as EntityType, label: 'Virtual Appliances' },
                    { type: 'integrations' as EntityType, label: 'Integrations' },
                    { type: 'multi-host-sources' as EntityType, label: 'Multi-Host Sources' },
                    { type: 'credential-providers' as EntityType, label: 'Credential Providers' }
                ]
            },
            {
                name: 'Workflows',
                items: [
                    { type: 'workflows' as EntityType, label: 'Workflows' }
                ]
            },
            {
                name: 'Certifications',
                items: [
                    { type: 'campaigns' as EntityType, label: 'Campaigns' }
                ]
            },
            {
                name: 'Reports & Tools',
                items: [
                    { type: 'forms' as EntityType, label: 'Forms' },
                    { type: 'applications' as EntityType, label: 'Applications' }
                ]
            }
        ];
        
        const entityTypes: { type: EntityType; label: string }[] = categories.flatMap(cat => cat.items);

        // Get counts for all entity types (skip link-only types)
        const linkOnlyTypes: EntityType[] = ['accounts', 'access-history', 'outliers', 'activities', 'entitlements', 'role-insights', 'metadata', 'segments', 'launchers', 'virtual-appliances', 'integrations', 'multi-host-sources', 'credential-providers'];
        const counts = await Promise.all(entityTypes.map(async et => {
            if (linkOnlyTypes.includes(et.type)) {
                return { type: et.type, count: 0 }; // Link-only types don't have counts in tenant view
            }
            try { return { type: et.type, count: (await this.fetchEntities(et.type)).length }; }
            catch { return { type: et.type, count: 0 }; }
        }));
        const countMap = new Map(counts.map(c => [c.type, c.count]));

        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>${this.esc(this.navigationState.tenantName || '')}</h1>
                        <p class="subtitle">${this.esc(this.navigationState.tenantName || '')}.identitynow.com</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="openAutomation()">Automation</button>
                        <button class="btn btn-secondary" onclick="newRule()">New Rule</button>
                        <button class="btn btn-secondary" onclick="openGlobalSearch()">Global Search</button>
                    </div>
                </div>
                
                ${categories.map(category => `
                    <section class="section">
                        <h2 class="section-title">${category.name}</h2>
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Type</th>
                                        <th>Count</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${category.items.map(item => `
                                        <tr class="table-row" onclick="loadEntityList('${item.type}')">
                                            <td class="cell-primary">${item.label}</td>
                                            <td class="cell-count">${countMap.get(item.type) || 0}</td>
                                            <td class="cell-action"><span class="arrow">→</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `).join('')}
            </div>
        `;
    }

    private async _renderSyncManagementView(): Promise<string> {
        const syncManager = SyncManager.getInstance();
        const allSyncInfo = syncManager.getAllSyncInfo();
        const activeSyncTenants = syncManager.getActiveSyncTenants();
        const tenants = this.tenantService.getTenants();

        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>Manage Tenant Sync</h1>
                        <p class="subtitle">Control which tenants participate in background synchronization</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="refreshSyncStatus()">Refresh</button>
                    </div>
                </div>
                
                <section class="section">
                    <div class="info-box" style="margin-bottom: 24px; padding: 16px; background: var(--bg-2); border-radius: var(--radius);">
                        <p style="margin: 0; color: var(--fg-2); font-size: 13px;">
                            <strong>Active Sync Limit:</strong> Maximum ${activeSyncTenants.length} of 4 tenants can be actively syncing. 
                            Paused tenants are visible in the UI but do not run background refresh.
                        </p>
                    </div>
                    
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Tenant</th>
                                    <th>Sync State</th>
                                    <th>Health</th>
                                    <th>Last Sync</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tenants.map(tenant => {
                                    const syncInfo = syncManager.getSyncInfo(tenant.id);
                                    const isActive = syncInfo?.state === 'ACTIVE_SYNC';
                                    const canActivate = syncManager.canActivateSync(tenant.id);
                                    const isLimitReached = activeSyncTenants.length >= 4 && !isActive;
                                    
                                    return `
                                        <tr class="table-row">
                                            <td class="cell-primary">${this.esc(tenant.name)}</td>
                                            <td>
                                                <span class="status ${isActive ? 'status-success' : 'status-warning'}">
                                                    ${syncInfo?.state || 'PAUSED'}
                                                </span>
                                            </td>
                                            <td>
                                                <span class="status ${syncInfo?.health === 'OK' ? 'status-success' : syncInfo?.health === 'DEGRADED' ? 'status-warning' : 'status-error'}">
                                                    ${syncInfo?.health || 'OK'}
                                                </span>
                                            </td>
                                            <td class="cell-secondary">
                                                ${syncInfo?.lastSyncTimestamp 
                                                    ? new Date(syncInfo.lastSyncTimestamp).toLocaleString() 
                                                    : 'Never'}
                                            </td>
                                            <td class="cell-action">
                                                ${isActive 
                                                    ? `<button class="btn btn-small btn-secondary" onclick="pauseSync('${tenant.id}')" style="font-size: 12px; padding: 4px 8px;" title="Pause background synchronization. Cached data remains available.">Pause</button>`
                                                    : `<button class="btn btn-small btn-primary" onclick="resumeSync('${tenant.id}')" style="font-size: 12px; padding: 4px 8px;" ${isLimitReached ? 'disabled' : ''} title="${isLimitReached ? 'Maximum 4 tenants can sync simultaneously. Pause another tenant first.' : 'Activate background synchronization. Data refreshes every 60 seconds.'}">Activate</button>`
                                                }
                                            </td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
            
            <script>
                function pauseSync(tenantId) {
                    vscode.postMessage({ command: 'pauseSync', tenantId });
                }
                
                function resumeSync(tenantId) {
                    vscode.postMessage({ command: 'resumeSync', tenantId });
                }
                
                function refreshSyncStatus() {
                    vscode.postMessage({ command: 'refreshSyncStatus' });
                }
            </script>
        `;
    }

    public navigateToSearch(tenantId?: string, tenantName?: string, initialQuery?: string): void {
        this.navigationState = { 
            view: 'search',
            tenantId: tenantId || this.navigationState.tenantId,
            tenantName: tenantName || this.navigationState.tenantName,
            searchQuery: initialQuery || ''
        };
        this._update();
    }

    private async _renderSearchView(): Promise<string> {
        const tenantId = this.navigationState.tenantId;
        const searchQuery = this.navigationState.searchQuery || '';
        const searchResults = this.navigationState.searchResults || [];
        
        if (!tenantId) {
            return `
                <div class="container">
                    <div class="empty">
                        <p>Please select a tenant first</p>
                    </div>
                </div>
            `;
        }

        // Import SearchService dynamically
        const searchServiceModule = await import('../../services/SearchService');
        const searchService = searchServiceModule.SearchService.getInstance();
        const quickFilters = searchServiceModule.QUICK_FILTERS;
        const history = searchService.getSearchHistory(tenantId);

        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>Search</h1>
                        <p class="subtitle">Search across SailPoint ISC resources</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="clearSearch()" title="Clear search query and results">Clear</button>
                    </div>
                </div>
                
                <div class="search-container" style="margin-bottom: 24px; max-width: 600px; position: relative;">
                    <span class="search-icon">🔍</span>
                    <input 
                        type="text" 
                        id="globalSearchInput" 
                        placeholder="Enter search query (e.g., name:John OR email:*@example.com)..." 
                        value="${this.esc(searchQuery)}"
                        onkeydown="if(event.key === 'Enter') performSearch()"
                        title="Use SailPoint search syntax: field:value, field:*pattern*, AND/OR operators"
                    />
                    <button class="btn btn-primary" onclick="performSearch()" style="margin-left: 8px;" title="Search across all SailPoint ISC resources">Search</button>
                    <span class="help-icon" title="Use SailPoint search syntax: field:value, field:*pattern*, AND/OR operators. Example: name:John OR email:*@example.com" onclick="showHelp('search.query')">ℹ️</span>
                </div>
                
                ${history.length > 0 ? `
                    <section class="section" style="margin-bottom: 24px;">
                        <h3 class="section-title" style="font-size: 14px; margin-bottom: 8px;">Recent Searches</h3>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${history.slice(0, 5).map((h: string) => `
                                <button class="btn btn-small btn-secondary" onclick="searchHistory('${this.esc(h)}')" style="font-size: 12px; padding: 4px 12px;" title="Click to reuse this search query">
                                    ${this.esc(h)}
                                </button>
                            `).join('')}
                        </div>
                    </section>
                ` : ''}
                
                <section class="section" style="margin-bottom: 24px;">
                    <h3 class="section-title" style="font-size: 14px; margin-bottom: 8px;">Quick Filters</h3>
                    <p style="font-size: 12px; color: var(--fg-2); margin-bottom: 8px;">Pre-built search filters for common scenarios</p>
                    <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px;">
                        ${quickFilters.map((filter: any) => `
                            <button class="action-btn" onclick="applyQuickFilter('${this.esc(filter.query)}', ${JSON.stringify(filter.indices)})" style="text-align: left; padding: 12px;">
                                <span class="action-title">${filter.label}</span>
                                <span class="action-desc">${filter.description}</span>
                            </button>
                        `).join('')}
                    </div>
                </section>
                
                ${searchQuery && searchResults.length > 0 ? `
                    <section class="section">
                        <h2 class="section-title">Search Results (${searchResults.length})</h2>
                        <div class="table-container">
                            <table class="table">
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>ID</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${searchResults.map((result: any) => {
                                        const entityType = result._type === 'identity' ? 'identities' :
                                                          result._type === 'accessprofile' ? 'access-profiles' :
                                                          result._type === 'role' ? 'roles' :
                                                          result._type === 'entitlement' ? 'entitlements' :
                                                          result._type === 'account' ? 'accounts' : '';
                                        const hasEntityType = entityType !== '';
                                        return `
                                            <tr class="table-row" ${hasEntityType ? `onclick="openSearchResult('${entityType}', '${result.id}', '${this.esc(result.name || '')}')" style="cursor: pointer;"` : ''}>
                                                <td class="cell-primary">${this.esc(result.name || 'Unnamed')}</td>
                                                <td class="cell-meta">${this.esc(result._type || '')}</td>
                                                <td class="cell-secondary">${this.esc(result.id || '')}</td>
                                                <td class="cell-action">${hasEntityType ? '<span class="arrow">→</span>' : ''}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                ` : searchQuery && searchResults.length === 0 ? `
                    <div class="empty">
                        <p>No results found for "${this.esc(searchQuery)}"</p>
                    </div>
                ` : ''}
            </div>
            
            <script>
                function performSearch() {
                    const input = document.getElementById('globalSearchInput');
                    const query = input.value.trim();
                    if (query) {
                        vscode.postMessage({ command: 'performGlobalSearch', query });
                    }
                }
                
                function clearSearch() {
                    document.getElementById('globalSearchInput').value = '';
                    vscode.postMessage({ command: 'clearGlobalSearch' });
                }
                
                function searchHistory(query) {
                    document.getElementById('globalSearchInput').value = query;
                    vscode.postMessage({ command: 'performGlobalSearch', query });
                }
                
                function applyQuickFilter(query, indices) {
                    document.getElementById('globalSearchInput').value = query;
                    vscode.postMessage({ command: 'performGlobalSearch', query: query, indices: indices });
                }
                
                function openSearchResult(entityType, entityId, entityName) {
                    if (entityType) {
                        vscode.postMessage({ command: 'openEntity', entityType: entityType, entityId: entityId, entityName: entityName });
                    } else {
                        vscode.window.showWarningMessage('Cannot open this result type');
                    }
                }
            </script>
        `;
    }

    private async _renderEntityListView(): Promise<string> {
        const entityType = this.navigationState.entityType!;
        
        // Fetch entities with pagination (enforced max 250)
        const entities = await this.fetchEntities(entityType, {
            offset: this.entityListPagination.offset,
            limit: this.entityListPagination.limit,
            searchQuery: this.searchQuery
        });
        
        // Get total count for pagination
        let totalCount = this.entityListPagination.total;
        if (totalCount === undefined) {
            try {
                const adapterLayer = AdapterLayer.getInstance();
                const tenantId = this.navigationState.tenantId!;
                const tenantInfo = this.tenantService.getTenant(tenantId);
                const client = new ISCClient(tenantId, tenantInfo?.tenantName || '');
                
                const objectTypeMap: Record<EntityType, any> = {
                    'sources': 'sources',
                    'transforms': 'transforms',
                    'workflows': 'workflows',
                    'identity-profiles': 'identity-profiles',
                    'rules': 'rules',
                    'access-profiles': 'access-profiles',
                    'roles': 'roles',
                    'forms': 'forms',
                    'governance-groups': 'governance-groups',
                    'campaigns': 'campaigns',
                    'service-desk': 'service-desk',
                    'identities': 'identities',
                    'applications': 'applications',
                    'notification-templates': undefined,
                    'segments': undefined,
                    'tags': undefined,
                    'identity-attributes': undefined,
                    'search-attributes': undefined,
                    'accounts': 'accounts',
                    'access-history': 'access-history',
                    'outliers': 'outliers',
                    'activities': 'activities'
                };
                const objectType = objectTypeMap[entityType];
                const newEntityTypes = ['accounts', 'access-history', 'outliers', 'activities', 'entitlements', 'role-insights', 'metadata', 'segments', 'launchers'];
                if (objectType && newEntityTypes.includes(entityType)) {
                    // For new entity types, get count from API
                    switch (entityType) {
                        case 'accounts':
                            const accountsCountResp = await client.getAccounts({
                                count: true,
                                limit: 0,
                                offset: 0,
                                filters: this.searchQuery ? `name sw "${this.searchQuery}"` : undefined
                            });
                            totalCount = Number(accountsCountResp.headers[TOTAL_COUNT_HEADER] || 0);
                            break;
                        case 'entitlements':
                            try {
                                // Use limit: 1 instead of limit: 0 (similar to getEntitlementCountBySource)
                                const entitlementsCountResp = await client.getEntitlements({
                                    count: true,
                                    limit: 1,
                                    offset: 0,
                                    filters: this.searchQuery ? `name sw "${this.searchQuery}"` : undefined
                                });
                                // Headers in axios responses - access directly using TOTAL_COUNT_HEADER
                                const headers = entitlementsCountResp.headers;
                                totalCount = Number(headers[TOTAL_COUNT_HEADER] || 0);
                                
                                // If count is 0 or invalid, but we have entities, there might be an issue
                                if ((totalCount === 0 || isNaN(totalCount)) && entities.length > 0) {
                                    // If we got a full page (250), there are definitely more
                                    if (entities.length >= 250) {
                                        console.warn('[HomePanel] Entitlements count header returned 0, but have 250+ entities. API may not support count header.');
                                        // Don't fall back to entities.length - indicate there are more
                                        totalCount = 250 + 1; // Will show "250+ items"
                                    } else {
                                        totalCount = entities.length;
                                    }
                                }
                                
                                // Log for debugging
                                console.log(`[HomePanel] Entitlements total count: ${totalCount} (from header: ${headers[TOTAL_COUNT_HEADER]})`);
                            } catch (error) {
                                console.error('[HomePanel] Error getting entitlements count:', error);
                                // Fallback: if we have 250 entities, there are definitely more
                                totalCount = entities.length >= 250 ? 250 + 1 : entities.length;
                            }
                            break;
                        case 'segments':
                            const segments = await client.getSegments();
                            if (this.searchQuery) {
                                totalCount = segments.filter(s => 
                                    (s.name || '').toLowerCase().includes(this.searchQuery.toLowerCase())
                                ).length;
                            } else {
                                totalCount = segments.length;
                            }
                            break;
                        case 'launchers':
                            // For launchers, we need to fetch and filter, so count is approximate
                            // If we got a full page after filtering, there might be more
                            totalCount = entities.length >= limit ? limit + 1 : entities.length;
                            break;
                        case 'access-history':
                        case 'outliers':
                        case 'activities':
                        case 'role-insights':
                        case 'metadata':
                        case 'virtual-appliances':
                        case 'integrations':
                        case 'multi-host-sources':
                        case 'credential-providers':
                            // For search-based or link-only types, estimate count based on results
                            // If we got a full page, there might be more
                            totalCount = entities.length >= 250 ? 250 + 1 : entities.length;
                            break;
                        default:
                            totalCount = entities.length;
                    }
                } else if (objectType) {
                    totalCount = await adapterLayer.getObjectCount(tenantId, objectType);
                } else {
                    totalCount = entities.length; // Fallback
                }
            } catch (error) {
                totalCount = entities.length; // Fallback
            }
            this.entityListPagination.total = totalCount;
        }
        
        // For new entity types, search is handled in fetchEntities, so no client-side filtering needed
        const newEntityTypes = ['accounts', 'access-history', 'outliers', 'activities', 'entitlements', 'role-insights', 'metadata', 'segments', 'launchers'];
        const filtered = (newEntityTypes.includes(entityType))
            ? entities
            : (this.searchQuery
                ? entities.filter(e => (e.name || '').toLowerCase().includes(this.searchQuery.toLowerCase()))
                : entities);
        const label = this._getEntityLabel(entityType);
        
        const hasMore = (this.entityListPagination.offset + this.entityListPagination.limit) < totalCount;
        const currentPage = Math.floor(this.entityListPagination.offset / this.entityListPagination.limit) + 1;
        const totalPages = Math.ceil(totalCount / this.entityListPagination.limit);

        const showingFrom = this.entityListPagination.offset + 1;
        const showingTo = Math.min(this.entityListPagination.offset + filtered.length, totalCount);
        
        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>${label}</h1>
                        <p class="subtitle">Showing ${showingFrom}-${showingTo} of ${totalCount} item${totalCount !== 1 ? 's' : ''}${totalCount > 250 ? ' (paginated)' : ''}</p>
                    </div>
                    <div class="header-actions">
                        ${entityType === 'rules' ? `<button class="btn btn-primary" onclick="newRule()" title="Create a new connector rule">New Rule</button>` : ''}
                        <button class="btn btn-secondary" onclick="refreshEntityList()" title="Refresh data from SailPoint ISC API">Refresh</button>
                    </div>
                </div>
                
                <div class="search-container" style="margin-bottom: 16px; position: relative;">
                    <span class="search-icon">🔍</span>
                    <input 
                        type="text" 
                        id="entitySearchInput" 
                        placeholder="Search ${label.toLowerCase()}..." 
                        value="${this.esc(this.searchQuery || '')}"
                        onkeydown="if(event.key === 'Enter') { handleEntitySearch(this.value); }"
                        onblur="handleEntitySearch(this.value)"
                        title="Press Enter or click outside to search. Search filters the currently loaded page. Use Global Search for advanced queries across all resources."
                    />
                    ${this.searchQuery ? `<button class="btn btn-small" onclick="clearEntitySearch()" style="margin-left: 8px; padding: 4px 8px; font-size: 12px;">Clear</button>` : ''}
                    <span class="help-icon" title="Press Enter or click outside to search. Search filters the currently loaded page. Use Global Search for advanced queries across all resources." onclick="showHelp('search.entity')">ℹ️</span>
                </div>
                
                ${filtered.length > 0 ? `
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    ${entityType === 'accounts' ? `
                                        <th>Account Name</th>
                                        <th>Source</th>
                                        <th>Identity</th>
                                        <th>Status</th>
                                    ` : entityType === 'access-history' ? `
                                        <th>Event</th>
                                        <th>Identity</th>
                                        <th>Time</th>
                                        <th>Type</th>
                                    ` : entityType === 'outliers' ? `
                                        <th>Identity</th>
                                        <th>Outlier Type</th>
                                        <th>Risk Score</th>
                                    ` : entityType === 'activities' ? `
                                        <th>Activity</th>
                                        <th>Identity</th>
                                        <th>Time</th>
                                        <th>Status</th>
                                    ` : entityType === 'entitlements' ? `
                                        <th>Entitlement Name</th>
                                        <th>Source</th>
                                        <th>Type</th>
                                        <th>Description</th>
                                    ` : entityType === 'role-insights' ? `
                                        <th>Role Name</th>
                                        <th>Insight Type</th>
                                        <th>Status</th>
                                    ` : entityType === 'metadata' ? `
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th>Metadata Keys</th>
                                    ` : entityType === 'segments' ? `
                                        <th>Segment Name</th>
                                        <th>Description</th>
                                        <th>Owner</th>
                                    ` : entityType === 'launchers' ? `
                                        <th>Launcher Name</th>
                                        <th>Type</th>
                                        <th>Status</th>
                                    ` : `
                                        <th>Name</th>
                                        <th>Type</th>
                                        <th></th>
                                    `}
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.map(e => {
                                    if (entityType === 'accounts') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('${entityType}', '${e.id}', '${this.esc(e.nativeIdentity || e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.nativeIdentity || e.name || 'Unnamed')}</div>
                                                    ${e.displayName ? `<div class="cell-secondary">${this.esc(e.displayName)}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.source?.name || e.sourceId || '')}</td>
                                                <td class="cell-meta">${this.esc(e.identity?.name || e.identityId || 'Uncorrelated')}</td>
                                                <td class="cell-meta">${e.disabled ? '<span style="color: var(--warning);">Disabled</span>' : '<span style="color: var(--success);">Active</span>'}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'access-history') {
                                        return `
                                            <tr class="table-row">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.type || e.name || 'Event')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.identity?.name || e.identityId || '')}</td>
                                                <td class="cell-meta">${e.created ? new Date(e.created).toLocaleString() : ''}</td>
                                                <td class="cell-meta">${this.esc(e.type || '')}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'outliers') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('identities', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.displayName ? `<div class="cell-secondary">${this.esc(e.displayName)}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.attributes?.outlierType || 'Outlier')}</td>
                                                <td class="cell-meta">${e.attributes?.riskScore || 'N/A'}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'activities') {
                                        return `
                                            <tr class="table-row">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || e.type || 'Activity')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.identity?.name || e.identityId || '')}</td>
                                                <td class="cell-meta">${e.created ? new Date(e.created).toLocaleString() : ''}</td>
                                                <td class="cell-meta">${e.status || 'Completed'}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'entitlements') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('${entityType}', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.displayName ? `<div class="cell-secondary">${this.esc(e.displayName)}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.source?.name || e.sourceId || '')}</td>
                                                <td class="cell-meta">${this.esc(e.type || e.attribute || '')}</td>
                                                <td class="cell-meta">${e.description ? this.esc(e.description.substring(0, 50)) + (e.description.length > 50 ? '...' : '') : ''}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'role-insights') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('roles', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.insightType || 'Role Insight')}</td>
                                                <td class="cell-meta">${e.enabled !== false ? '<span style="color: var(--success);">Active</span>' : '<span style="color: var(--warning);">Inactive</span>'}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'metadata') {
                                        const metadataKeys = e.accessModelMetadata?.attributes ? 
                                            Object.keys(e.accessModelMetadata.attributes).join(', ') : 
                                            (e.metadata ? Object.keys(e.metadata).join(', ') : '');
                                        return `
                                            <tr class="table-row" onclick="openEntity('${e._type === 'accessprofile' ? 'access-profiles' : 'roles'}', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e._type === 'accessprofile' ? 'Access Profile' : 'Role')}</td>
                                                <td class="cell-meta">${this.esc(metadataKeys || 'No metadata')}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'segments') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('${entityType}', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.displayName ? `<div class="cell-secondary">${this.esc(e.displayName)}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${e.description ? this.esc(e.description.substring(0, 60)) + (e.description.length > 60 ? '...' : '') : ''}</td>
                                                <td class="cell-meta">${this.esc(e.owner?.name || e.ownerId || '')}</td>
                                            </tr>
                                        `;
                                    } else if (entityType === 'launchers') {
                                        return `
                                            <tr class="table-row" onclick="openEntity('applications', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.type || 'Launcher')}</td>
                                                <td class="cell-meta">${e.enabled !== false ? '<span style="color: var(--success);">Active</span>' : '<span style="color: var(--warning);">Inactive</span>'}</td>
                                            </tr>
                                        `;
                                    } else {
                                        return `
                                            <tr class="table-row" onclick="openEntity('${entityType}', '${e.id}', '${this.esc(e.name || '')}')">
                                                <td>
                                                    <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                                    ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                                </td>
                                                <td class="cell-meta">${this.esc(e.type || '')}</td>
                                                <td class="cell-action"><span class="arrow">→</span></td>
                                            </tr>
                                        `;
                                    }
                                }).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    ${totalCount > this.entityListPagination.limit ? `
                        <div class="pagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding: 12px;">
                            <div>
                                <button class="btn btn-small btn-secondary" onclick="previousPage()" ${this.entityListPagination.offset === 0 ? 'disabled' : ''} style="font-size: 12px; padding: 4px 8px;" title="Go to previous page">Previous</button>
                                <span style="margin: 0 12px; color: var(--fg-2); font-size: 13px;" title="Maximum 250 items per page">
                                    Page ${currentPage} of ${totalPages}
                                </span>
                                <button class="btn btn-small btn-secondary" onclick="nextPage()" ${!hasMore ? 'disabled' : ''} style="font-size: 12px; padding: 4px 8px;" title="Go to next page">Next</button>
                            </div>
                            <div style="color: var(--fg-2); font-size: 12px;" title="Results are paginated with a maximum of 250 items per page">
                                ${this.entityListPagination.limit} per page
                            </div>
                        </div>
                    ` : ''}
                ` : `
                    <div class="empty">
                        <p>No ${label.toLowerCase()} found${this.searchQuery ? ` matching "${this.esc(this.searchQuery)}"` : ''}</p>
                        ${this.searchQuery ? `<button class="btn btn-secondary" onclick="clearEntitySearch()" style="margin-top: 12px;">Clear Search</button>` : ''}
                    </div>
                `}
            </div>
            
            <script>
                function previousPage() {
                    vscode.postMessage({ command: 'entityListPreviousPage' });
                }
                
                function nextPage() {
                    vscode.postMessage({ command: 'entityListNextPage' });
                }
                
                function refreshEntityList() {
                    vscode.postMessage({ command: 'refreshEntityList' });
                }
                
                function handleEntitySearch(query) {
                    vscode.postMessage({ command: 'entitySearch', query: query });
                }
                
                function clearEntitySearch() {
                    document.getElementById('entitySearchInput').value = '';
                    vscode.postMessage({ command: 'entitySearch', query: '' });
                }
                
                function showHelp(helpKey) {
                    vscode.postMessage({ command: 'showHelp', helpKey: helpKey });
                }
            </script>
        `;
    }

    private async _renderAutomationView(): Promise<string> {
        const { AutomationTasksService } = await import('../../services/AutomationTasks');
        const automationService = AutomationTasksService.getInstance();
        const tasks = automationService.getAllTasks();
        
        const taskId = this.navigationState.automationTaskId;
        const step = this.navigationState.automationStep || 'select';
        
        if (step === 'configure' && taskId) {
            return this._renderTaskConfigurationView(taskId);
        }
        
        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>Automation</h1>
                        <p class="subtitle">Execute automated tasks using search queries or CSV files</p>
                    </div>
                </div>
                
                <section class="section">
                    <h2 class="section-title">Available Tasks</h2>
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Task</th>
                                    <th>Description</th>
                                    <th>Input Type</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${tasks.map(task => `
                                    <tr class="table-row" onclick="selectAutomationTask('${task.id}')">
                                        <td>
                                            <div class="cell-primary">${task.icon} ${this.esc(task.name)}</div>
                                        </td>
                                        <td class="cell-secondary">${this.esc(task.description)}</td>
                                        <td class="cell-meta">
                                            ${task.inputType === 'both' ? 'Search Query or CSV' : 
                                              task.inputType === 'search' ? 'Search Query' : 'CSV File'}
                                        </td>
                                        <td class="cell-action"><span class="arrow">→</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </section>
            </div>
        `;
    }

    private async _renderTaskConfigurationView(taskId: string): Promise<string> {
        const { AutomationTasksService } = await import('../../services/AutomationTasks');
        const automationService = AutomationTasksService.getInstance();
        const task = automationService.getTask(taskId);
        
        if (!task) {
            return `
                <div class="container">
                    <div class="page-header">
                        <div>
                            <h1>Task Not Found</h1>
                        </div>
                    </div>
                    <button class="btn btn-secondary" onclick="goBack()">Go Back</button>
                </div>
            `;
        }

        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>${task.icon} ${this.esc(task.name)}</h1>
                        <p class="subtitle">${this.esc(task.description)}</p>
                    </div>
                    <div class="header-actions">
                        <button class="btn btn-secondary" onclick="goBack()">Back</button>
                    </div>
                </div>
                
                <section class="section">
                    <h2 class="section-title">Input Data</h2>
                    <div style="margin-bottom: 24px;">
                        <div style="display: flex; gap: 16px; margin-bottom: 16px;">
                            <button class="btn ${task.inputType === 'search' || task.inputType === 'both' ? 'btn-primary' : 'btn-secondary'}" 
                                    onclick="showSearchInput()" 
                                    ${task.inputType === 'csv' ? 'disabled' : ''}>
                                Use Search Query
                            </button>
                            <button class="btn ${task.inputType === 'csv' || task.inputType === 'both' ? 'btn-primary' : 'btn-secondary'}" 
                                    onclick="showCSVInput()"
                                    ${task.inputType === 'search' ? 'disabled' : ''}>
                                Upload CSV File
                            </button>
                        </div>
                        
                        <div id="searchInputSection" style="display: ${task.inputType === 'csv' ? 'none' : 'block'};">
                            <label style="display: block; margin-bottom: 8px; font-weight: 500;">Search Query</label>
                            <input 
                                type="text" 
                                id="taskSearchQuery" 
                                placeholder="e.g., source.id eq &quot;abc123&quot;" 
                                style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                            />
                            <button class="btn btn-secondary" onclick="executeTaskSearch()" style="margin-top: 8px;">Search</button>
                            <div id="searchResults" style="margin-top: 16px;"></div>
                        </div>
                        
                        <div id="csvInputSection" style="display: ${task.inputType === 'search' ? 'none' : 'block'};">
                            <label style="display: block; margin-bottom: 8px; font-weight: 500;">CSV File</label>
                            <input 
                                type="file" 
                                id="taskCSVFile" 
                                accept=".csv"
                                onchange="handleCSVFileSelect(this.files[0])"
                                style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                            />
                            <div id="csvPreview" style="margin-top: 16px;"></div>
                        </div>
                    </div>
                </section>
                
                <section class="section" id="configSection" style="display: none;">
                    <h2 class="section-title">Task Configuration</h2>
                    <form id="taskConfigForm">
                        ${task.configFields.map(field => {
                            if (field.name === 'owner') {
                                // Special handling for owner - identity search
                                return `
                                    <div style="margin-bottom: 16px;">
                                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">
                                            ${this.esc(field.label)} ${field.required ? '<span style="color: var(--warning);">*</span>' : ''}
                                        </label>
                                        <div style="display: flex; gap: 8px;">
                                            <input 
                                                type="text" 
                                                id="ownerSearchInput"
                                                placeholder="${this.esc(field.placeholder || '')}"
                                                style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                                                onkeydown="if(event.key === 'Enter') { searchOwnerIdentity(); }"
                                            />
                                            <button type="button" class="btn btn-secondary" onclick="searchOwnerIdentity()" style="white-space: nowrap;">Search</button>
                                        </div>
                                        <input type="hidden" name="${field.name}" id="ownerIdInput" ${field.required ? 'required' : ''} />
                                        <div id="ownerSearchResults" style="margin-top: 8px;"></div>
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2);">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            } else if (field.name.includes('Identity') && field.type === 'text') {
                                // Special handling for identity search fields in approval levels
                                const fieldId = field.name.replace(/[^a-zA-Z0-9]/g, '');
                                return `
                                    <div style="margin-bottom: 16px;" id="${fieldId}Container" style="display: none;">
                                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">
                                            ${this.esc(field.label)} ${field.required ? '<span style="color: var(--warning);">*</span>' : ''}
                                        </label>
                                        <div style="display: flex; gap: 8px;">
                                            <input 
                                                type="text" 
                                                id="${fieldId}SearchInput"
                                                placeholder="${this.esc(field.placeholder || '')}"
                                                style="flex: 1; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                                                onkeydown="if(event.key === 'Enter') { searchApprovalIdentity('${field.name}'); }"
                                            />
                                            <button type="button" class="btn btn-secondary" onclick="searchApprovalIdentity('${field.name}')" style="white-space: nowrap;">Search</button>
                                        </div>
                                        <input type="hidden" name="${field.name}" id="${fieldId}IdInput" ${field.required ? 'required' : ''} />
                                        <div id="${fieldId}SearchResults" style="margin-top: 8px;"></div>
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2);">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            } else if (field.type === 'text') {
                                return `
                                    <div style="margin-bottom: 16px;">
                                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">
                                            ${this.esc(field.label)} ${field.required ? '<span style="color: var(--warning);">*</span>' : ''}
                                        </label>
                                        <input 
                                            type="text" 
                                            name="${field.name}" 
                                            placeholder="${this.esc(field.placeholder || '')}"
                                            value="${this.esc(field.defaultValue || '')}"
                                            ${field.required ? 'required' : ''}
                                            style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                                        />
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2);">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            } else if (field.type === 'textarea') {
                                return `
                                    <div style="margin-bottom: 16px;">
                                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">
                                            ${this.esc(field.label)} ${field.required ? '<span style="color: var(--warning);">*</span>' : ''}
                                        </label>
                                        <textarea 
                                            name="${field.name}" 
                                            placeholder="${this.esc(field.placeholder || '')}"
                                            ${field.required ? 'required' : ''}
                                            rows="3"
                                            style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0); font-family: inherit;"
                                        >${this.esc(field.defaultValue || '')}</textarea>
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2);">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            } else if (field.type === 'select') {
                                return `
                                    <div style="margin-bottom: 16px;">
                                        <label style="display: block; margin-bottom: 8px; font-weight: 500;">
                                            ${this.esc(field.label)} ${field.required ? '<span style="color: var(--warning);">*</span>' : ''}
                                        </label>
                                        <select 
                                            name="${field.name}" 
                                            ${field.required ? 'required' : ''}
                                            onchange="handleApprovalLevelChange('${field.name}', this.value)"
                                            style="width: 100%; padding: 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2); color: var(--fg-0);"
                                        >
                                            ${field.options?.map(opt => `
                                                <option value="${this.esc(opt.value)}" ${opt.value === field.defaultValue ? 'selected' : ''}>
                                                    ${this.esc(opt.label)}
                                                </option>
                                            `).join('')}
                                        </select>
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2);">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            } else if (field.type === 'checkbox') {
                                return `
                                    <div style="margin-bottom: 16px;">
                                        <label style="display: flex; align-items: center; gap: 8px;">
                                            <input 
                                                type="checkbox" 
                                                name="${field.name}" 
                                                ${field.defaultValue === 'true' ? 'checked' : ''}
                                                style="width: auto;"
                                            />
                                            <span style="font-weight: 500;">${this.esc(field.label)}</span>
                                        </label>
                                        ${field.helpText ? `<div style="margin-top: 4px; font-size: 12px; color: var(--fg-2); margin-left: 24px;">${this.esc(field.helpText)}</div>` : ''}
                                    </div>
                                `;
                            }
                            return '';
                        }).join('')}
                        
                        <div style="margin-top: 24px;">
                            <button type="button" class="btn btn-primary" onclick="launchTask('${task.id}')">Launch Task</button>
                            <button type="button" class="btn btn-secondary" onclick="goBack()" style="margin-left: 8px;">Cancel</button>
                        </div>
                    </form>
                </section>
            </div>
            
            <script>
                let currentInputData = [];
                
                function showSearchInput() {
                    document.getElementById('searchInputSection').style.display = 'block';
                    document.getElementById('csvInputSection').style.display = 'none';
                }
                
                function showCSVInput() {
                    document.getElementById('searchInputSection').style.display = 'none';
                    document.getElementById('csvInputSection').style.display = 'block';
                }
                
                async function executeTaskSearch() {
                    const query = document.getElementById('taskSearchQuery').value;
                    if (!query.trim()) {
                        alert('Please enter a search query');
                        return;
                    }
                    
                    showLoader('Searching...');
                    vscode.postMessage({ 
                        command: 'executeTaskSearch', 
                        taskId: '${task.id}',
                        query: query 
                    });
                }
                
                function handleCSVFileSelect(file) {
                    if (!file) return;
                    
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        vscode.postMessage({ 
                            command: 'uploadCSV', 
                            taskId: '${task.id}',
                            fileName: file.name, 
                            fileData: e.target.result 
                        });
                    };
                    reader.readAsText(file);
                }
                
                async function searchOwnerIdentity() {
                    const query = document.getElementById('ownerSearchInput').value;
                    if (!query.trim()) {
                        alert('Please enter a search query');
                        return;
                    }
                    
                    showLoader('Searching identities...');
                    vscode.postMessage({ 
                        command: 'searchIdentities', 
                        query: query 
                    });
                }
                
                function handleApprovalLevelChange(levelField, value) {
                    // Show/hide governance group field based on selection
                    const govGroupField = levelField.replace('Level', 'Level') + 'GovGroup';
                    const govGroupDiv = document.querySelector(\`input[name="\${govGroupField}"], textarea[name="\${govGroupField}"]\`)?.closest('div');
                    if (govGroupDiv) {
                        govGroupDiv.style.display = value === 'GOVERNANCE_GROUP' ? 'block' : 'none';
                    }
                    
                    // Show/hide identity field based on selection
                    const identityField = levelField.replace('Level', 'Level') + 'Identity';
                    const identityFieldId = identityField.replace(/[^a-zA-Z0-9]/g, '');
                    const identityContainer = document.getElementById(\`\${identityFieldId}Container\`);
                    if (identityContainer) {
                        identityContainer.style.display = value === 'IDENTITY' ? 'block' : 'none';
                        // Clear selection if hiding
                        if (value !== 'IDENTITY') {
                            const idInput = document.getElementById(\`\${identityFieldId}IdInput\`);
                            const searchInput = document.getElementById(\`\${identityFieldId}SearchInput\`);
                            const resultsDiv = document.getElementById(\`\${identityFieldId}SearchResults\`);
                            if (idInput) idInput.value = '';
                            if (searchInput) searchInput.value = '';
                            if (resultsDiv) resultsDiv.innerHTML = '';
                        }
                    }
                }
                
                async function searchApprovalIdentity(fieldName) {
                    const fieldId = fieldName.replace(/[^a-zA-Z0-9]/g, '');
                    const query = document.getElementById(\`\${fieldId}SearchInput\`).value;
                    if (!query.trim()) {
                        alert('Please enter a search query');
                        return;
                    }
                    
                    showLoader('Searching identities...');
                    vscode.postMessage({ 
                        command: 'searchIdentities', 
                        query: query,
                        fieldName: fieldName
                    });
                }
                
                function selectApprovalIdentity(fieldName, id, name) {
                    const fieldId = fieldName.replace(/[^a-zA-Z0-9]/g, '');
                    document.getElementById(\`\${fieldId}IdInput\`).value = id;
                    document.getElementById(\`\${fieldId}SearchInput\`).value = name;
                    document.getElementById(\`\${fieldId}SearchResults\`).innerHTML = \`
                        <div style="padding: 8px; background: var(--bg-2); border-radius: var(--radius); color: var(--fg-0); font-size: 12px;">
                            Selected: <strong>\${name}</strong>
                        </div>
                    \`;
                }
                
                // Initialize visibility of governance group fields
                ${task.configFields.filter(f => f.name.includes('GovGroup')).map(f => {
                    const levelField = f.name.replace('GovGroup', '');
                    return `
                        (function() {
                            const levelSelect = document.querySelector('select[name="${levelField}"]');
                            if (levelSelect) {
                                handleApprovalLevelChange('${levelField}', levelSelect.value);
                            }
                        })();
                    `;
                }).join('')}
                
                async function launchTask(taskId) {
                    const form = document.getElementById('taskConfigForm');
                    if (!form.checkValidity()) {
                        form.reportValidity();
                        return;
                    }
                    
                    if (currentInputData.length === 0) {
                        alert('Please provide input data (search query or CSV file)');
                        return;
                    }
                    
                    // Check owner is selected
                    const ownerId = document.getElementById('ownerIdInput').value;
                    if (!ownerId) {
                        alert('Please search and select an owner identity');
                        return;
                    }
                    
                    const formData = new FormData(form);
                    const config = {};
                    for (const [key, value] of formData.entries()) {
                        config[key] = value;
                    }
                    
                    // Handle checkboxes
                    ${task.configFields.filter(f => f.type === 'checkbox').map(f => `
                        config['${f.name}'] = document.querySelector('input[name="${f.name}"]').checked;
                    `).join('')}
                    
                    // Handle select fields
                    ${task.configFields.filter(f => f.type === 'select').map(f => `
                        const ${f.name}Select = document.querySelector('select[name="${f.name}"]');
                        if (${f.name}Select) {
                            config['${f.name}'] = ${f.name}Select.value;
                        }
                    `).join('')}
                    
                    executeAutomationTask(taskId, { inputData: currentInputData, config: config });
                }
                
                // Listen for search results
                window.addEventListener('message', event => {
                    const msg = event.data;
                    if (msg.command === 'taskSearchResults') {
                        hideLoader();
                        currentInputData = msg.data || [];
                        const resultsDiv = document.getElementById('searchResults');
                        resultsDiv.innerHTML = \`
                            <div style="padding: 12px; background: var(--bg-2); border-radius: var(--radius);">
                                <strong>Found \${currentInputData.length} items</strong>
                                <div style="margin-top: 8px; font-size: 12px; color: var(--fg-2);">
                                    ${task.inputEntityType === 'entitlements' ? 'Entitlements' : 'Items'} ready for processing
                                </div>
                            </div>
                        \`;
                        document.getElementById('configSection').style.display = 'block';
                    } else if (msg.command === 'taskCSVLoaded') {
                        hideLoader();
                        currentInputData = msg.data || [];
                        const previewDiv = document.getElementById('csvPreview');
                        previewDiv.innerHTML = \`
                            <div style="padding: 12px; background: var(--bg-2); border-radius: var(--radius);">
                                <strong>Loaded \${currentInputData.length} rows from CSV</strong>
                                <div style="margin-top: 8px; font-size: 12px; color: var(--fg-2);">
                                    Data ready for processing
                                </div>
                            </div>
                        \`;
                        document.getElementById('configSection').style.display = 'block';
                    } else if (msg.command === 'identitySearchResults') {
                        hideLoader();
                        const results = msg.results || [];
                        const fieldName = msg.fieldName;
                        
                        // Determine which results div to update
                        if (fieldName === 'owner' || !fieldName) {
                            // Owner search
                            const resultsDiv = document.getElementById('ownerSearchResults');
                            if (results.length === 0) {
                                resultsDiv.innerHTML = '<div style="padding: 8px; color: var(--fg-2); font-size: 12px;">No identities found</div>';
                            } else {
                                resultsDiv.innerHTML = \`
                                    <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2);">
                                        \${results.map(identity => \`
                                            <div 
                                                style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.1s;"
                                                onmouseover="this.style.background='var(--bg-3)'"
                                                onmouseout="this.style.background='transparent'"
                                                onclick="selectOwnerIdentity('\${identity.id}', '\${identity.name.replace(/'/g, "\\\\'")}')"
                                            >
                                                <div style="font-weight: 500; color: var(--fg-0);">\${identity.name}</div>
                                                <div style="font-size: 11px; color: var(--fg-2);">\${identity.id}</div>
                                            </div>
                                        \`).join('')}
                                    </div>
                                \`;
                            }
                        } else {
                            // Approval level identity search
                            const fieldId = fieldName.replace(/[^a-zA-Z0-9]/g, '');
                            const resultsDiv = document.getElementById(\`\${fieldId}SearchResults\`);
                            if (results.length === 0) {
                                resultsDiv.innerHTML = '<div style="padding: 8px; color: var(--fg-2); font-size: 12px;">No identities found</div>';
                            } else {
                                resultsDiv.innerHTML = \`
                                    <div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-2);">
                                        \${results.map(identity => \`
                                            <div 
                                                style="padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--border); transition: background 0.1s;"
                                                onmouseover="this.style.background='var(--bg-3)'"
                                                onmouseout="this.style.background='transparent'"
                                                onclick="selectApprovalIdentity('\${fieldName}', '\${identity.id}', '\${identity.name.replace(/'/g, "\\\\'")}')"
                                            >
                                                <div style="font-weight: 500; color: var(--fg-0);">\${identity.name}</div>
                                                <div style="font-size: 11px; color: var(--fg-2);">\${identity.id}</div>
                                            </div>
                                        \`).join('')}
                                    </div>
                                \`;
                            }
                        }
                    } else if (msg.command === 'taskExecutionResult') {
                        hideLoader();
                        if (msg.result.success) {
                            alert('Task executed successfully: ' + msg.result.message);
                            goBack();
                        } else {
                            alert('Task failed: ' + msg.result.message + '\\n' + (msg.result.errors || []).join('\\n'));
                        }
                    }
                });
                
                function selectOwnerIdentity(id, name) {
                    document.getElementById('ownerIdInput').value = id;
                    document.getElementById('ownerSearchInput').value = name;
                    document.getElementById('ownerSearchResults').innerHTML = \`
                        <div style="padding: 8px; background: var(--bg-2); border-radius: var(--radius); color: var(--fg-0); font-size: 12px;">
                            Selected: <strong>\${name}</strong>
                        </div>
                    \`;
                }
            </script>
        `;
    }

    private _getEntityLabel(type: string): string {
        const labels: Record<string, string> = {
            'sources': 'Sources', 'transforms': 'Transforms', 'workflows': 'Workflows',
            'identity-profiles': 'Identity Profiles', 'rules': 'Connector Rules',
            'access-profiles': 'Access Profiles', 'roles': 'Roles', 'forms': 'Forms',
            'governance-groups': 'Governance Groups', 'service-desk': 'Service Desk',
            'identities': 'Identities', 'campaigns': 'Campaigns', 'applications': 'Applications',
            'identity-attributes': 'Identity Attributes', 'search-attributes': 'Search Attributes',
            'accounts': 'Accounts', 'access-history': 'Access History',
            'outliers': 'Outliers', 'activities': 'Activities',
            'entitlements': 'Entitlements', 'role-insights': 'Role Insights',
            'metadata': 'Metadata', 'segments': 'Segments', 'launchers': 'Launchers',
            'virtual-appliances': 'Virtual Appliances', 'integrations': 'Integrations',
            'multi-host-sources': 'Multi-Host Sources', 'credential-providers': 'Credential Providers',
            'source': 'Source', 'transform': 'Transform', 'workflow': 'Workflow',
            'rule': 'Rule', 'access-profile': 'Access Profile', 'role': 'Role',
            'identity': 'Identity', 'identity-profile': 'Identity Profile'
        };
        return labels[type] || type;
    }

    private _getStyles(): string {
        return `
            :root {
                --bg-0: #1a1a1a;
                --bg-1: #222222;
                --bg-2: #2a2a2a;
                --bg-3: #333333;
                --fg-0: #ffffff;
                --fg-1: #cccccc;
                --fg-2: #888888;
                --fg-3: #555555;
                --accent: #0078d4;
                --accent-hover: #1a8cff;
                --success: #4caf50;
                --warning: #ff9800;
                --border: #3a3a3a;
                --radius: 4px;
            }
            
            * { box-sizing: border-box; margin: 0; padding: 0; }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                background: var(--bg-0);
                color: var(--fg-1);
            }
            
            /* Loader Overlay */
            .loader-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(26, 26, 26, 0.9);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                opacity: 0;
                visibility: hidden;
                transition: opacity 0.2s, visibility 0.2s;
            }
            
            .loader-overlay.active {
                opacity: 1;
                visibility: visible;
            }
            
            .loader {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 16px;
            }
            
            .loader-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid var(--bg-3);
                border-top-color: var(--accent);
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
            }
            
            @keyframes spin {
                to { transform: rotate(360deg); }
            }
            
            .loader-text {
                color: var(--fg-2);
                font-size: 13px;
                font-size: 13px;
                line-height: 1.5;
            }
            
            .app { min-height: 100vh; display: flex; flex-direction: column; }
            
            /* Header */
            .header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0 16px;
                height: 48px;
                background: var(--bg-1);
                border-bottom: 1px solid var(--border);
            }
            
            .nav-left, .nav-right { display: flex; align-items: center; gap: 8px; }
            
            .nav-btn {
                display: flex;
                align-items: center;
                justify-content: center;
                width: 32px;
                height: 32px;
                background: transparent;
                border: none;
                border-radius: var(--radius);
                color: var(--fg-2);
                cursor: pointer;
            }
            
            .nav-btn:hover { background: var(--bg-2); color: var(--fg-1); }
            
            .breadcrumbs { display: flex; align-items: center; gap: 4px; font-size: 13px; }
            .breadcrumb { padding: 4px 8px; border-radius: var(--radius); color: var(--fg-2); cursor: pointer; }
            .breadcrumb:hover { background: var(--bg-2); color: var(--fg-1); }
            .breadcrumb.active { color: var(--fg-1); cursor: default; }
            .breadcrumb.active:hover { background: transparent; }
            .sep { color: var(--fg-3); }
            
            .search-container {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 0 12px;
                height: 32px;
                background: var(--bg-2);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                width: 300px;
            }
            
            .search-icon { color: var(--fg-3); flex-shrink: 0; }
            
            .search-container input {
                flex: 1;
                background: transparent;
                border: none;
                color: var(--fg-1);
                font-size: 13px;
                outline: none;
            }
            
            .search-container:focus-within { border-color: var(--accent); }
            
            .help-icon {
                margin-left: 8px;
                cursor: help;
                color: var(--fg-2);
                font-size: 14px;
                opacity: 0.7;
                transition: opacity 0.2s;
            }
            
            .help-icon:hover {
                opacity: 1;
                color: var(--accent);
            }
            
            .help-tooltip {
                position: absolute;
                background: var(--bg-2);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                padding: 12px;
                max-width: 300px;
                z-index: 1000;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                display: none;
                font-size: 13px;
                line-height: 1.5;
            }
            
            .help-tooltip.show {
                display: block;
            }
            
            .help-tooltip-title {
                font-weight: 600;
                color: var(--fg-0);
                margin-bottom: 6px;
            }
            
            .help-tooltip-content {
                color: var(--fg-1);
                margin-bottom: 8px;
            }
            
            .help-tooltip-link {
                color: var(--accent);
                text-decoration: none;
                font-size: 12px;
            }
            
            .help-tooltip-link:hover {
                text-decoration: underline;
            }
            
            /* Main */
            .main { flex: 1; overflow-y: auto; }
            .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
            
            /* Page header */
            .page-header {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                margin-bottom: 32px;
            }
            
            .page-header h1 { font-size: 24px; font-weight: 600; color: var(--fg-0); margin-bottom: 4px; }
            .subtitle { color: var(--fg-2); font-size: 14px; }
            .header-actions { display: flex; gap: 8px; }
            
            /* Section */
            .section { margin-bottom: 32px; }
            .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
            .section-title { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-2); }
            
            /* Buttons */
            .btn {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 8px 16px;
                font-size: 13px;
                font-weight: 500;
                border: none;
                border-radius: var(--radius);
                cursor: pointer;
                transition: background 0.15s;
            }
            
            .btn-primary { background: var(--accent); color: white; }
            .btn-primary:hover { background: var(--accent-hover); }
            .btn-secondary { background: var(--bg-2); color: var(--fg-1); border: 1px solid var(--border); }
            .btn-secondary:hover { background: var(--bg-3); }
            
            /* Table */
            .table-container { background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
            
            .table { width: 100%; border-collapse: collapse; }
            .table th { text-align: left; padding: 12px 16px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-2); background: var(--bg-2); border-bottom: 1px solid var(--border); }
            .table td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
            .table tbody tr:last-child td { border-bottom: none; }
            
            .table-row { cursor: pointer; transition: background 0.1s; }
            .table-row:hover { background: var(--bg-2); }
            
            .cell-primary { font-weight: 500; color: var(--fg-0); }
            .cell-secondary { color: var(--fg-2); font-size: 12px; margin-top: 2px; }
            .cell-meta { color: var(--fg-2); }
            .cell-count { font-variant-numeric: tabular-nums; color: var(--fg-2); }
            .cell-action { text-align: right; color: var(--fg-3); }
            .arrow { font-size: 14px; }
            
            .status { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 500; }
            .status-success { background: rgba(76, 175, 80, 0.15); color: var(--success); }
            .status-warning { background: rgba(255, 152, 0, 0.15); color: var(--warning); }
            
            /* Actions grid */
            .actions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
            
            .action-btn {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                padding: 16px;
                background: var(--bg-1);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                cursor: pointer;
                text-align: left;
                transition: border-color 0.15s, background 0.15s;
            }
            
            .action-btn:hover { background: var(--bg-2); border-color: var(--fg-3); }
            .action-title { font-weight: 500; color: var(--fg-0); }
            .action-desc { font-size: 12px; color: var(--fg-2); }
            
            /* Recent */
            .recent-grid { display: flex; flex-wrap: wrap; gap: 8px; }
            
            .recent-item {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 2px;
                padding: 8px 12px;
                background: var(--bg-1);
                border: 1px solid var(--border);
                border-radius: var(--radius);
                cursor: pointer;
                transition: border-color 0.15s;
            }
            
            .recent-item:hover { border-color: var(--fg-3); }
            .recent-name { font-size: 13px; color: var(--fg-0); }
            .recent-meta { font-size: 11px; color: var(--fg-3); }
            
            /* Empty state */
            .empty {
                padding: 48px 24px;
                text-align: center;
                background: var(--bg-1);
                border: 1px solid var(--border);
                border-radius: var(--radius);
            }
            
            .empty p { color: var(--fg-2); margin-bottom: 16px; }
        `;
    }

    private async handleExecuteTaskSearch(taskId: string, query: string): Promise<void> {
        const tenantId = this.navigationState.tenantId;
        
        if (!tenantId) {
            vscode.window.showWarningMessage('Please select a tenant first');
            return;
        }

        // Get tenant info to ensure we have the correct tenant name
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            vscode.window.showWarningMessage('Tenant not found');
            return;
        }

        // Use tenantName from tenantInfo (should be the API tenant name without spaces)
        const tenantName = tenantInfo.tenantName || tenantInfo.name;

        try {
            this._panel.webview.postMessage({ command: 'showLoader', message: 'Searching...' });
            
            const { AutomationTasksService } = await import('../../services/AutomationTasks');
            const automationService = AutomationTasksService.getInstance();
            const task = automationService.getTask(taskId);
            
            if (!task) {
                throw new Error('Task not found');
            }

            const results = await automationService.executeSearchQuery(
                tenantId,
                tenantName,
                query,
                task.inputEntityType || 'entitlements'
            );

            this._panel.webview.postMessage({
                command: 'taskSearchResults',
                data: results
            });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            vscode.window.showErrorMessage(`Search failed: ${error.message}`);
        }
    }

    private async handleSearchIdentities(query: string, fieldName?: string): Promise<void> {
        const tenantId = this.navigationState.tenantId;
        
        if (!tenantId) {
            vscode.window.showWarningMessage('Please select a tenant first');
            return;
        }

        try {
            this._panel.webview.postMessage({ command: 'showLoader', message: 'Searching identities...' });
            
            // Use ISCClient search directly instead of SearchService
            const tenantInfo = this.tenantService.getTenant(tenantId);
            if (!tenantInfo) {
                throw new Error('Tenant not found');
            }

            const client = new ISCClient(tenantId, tenantInfo.tenantName || tenantInfo.name);
            const { Search } = await import('sailpoint-api-client');
            
            const searchPayload: Search = {
                indices: ['identities'],
                query: {
                    query: query
                },
                sort: ['name']
            };

            const searchResults = await client.search(searchPayload, 20);
            
            // Convert to format expected by UI
            const results = searchResults.map((item: any) => ({
                id: item.id,
                name: item.name || item.displayName || item.id,
                _type: 'identity'
            }));
            
            this._panel.webview.postMessage({
                command: 'identitySearchResults',
                results: results,
                fieldName: fieldName
            });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            vscode.window.showErrorMessage(`Identity search failed: ${error.message}`);
        }
    }

    private async handleCSVUpload(fileData: string, fileName: string, taskId?: string): Promise<void> {
        try {
            this._panel.webview.postMessage({ command: 'showLoader', message: 'Processing CSV...' });
            
            const { AutomationTasksService } = await import('../../services/AutomationTasks');
            const automationService = AutomationTasksService.getInstance();
            
            const data = automationService.parseCSV(fileData);
            
            this._panel.webview.postMessage({
                command: 'taskCSVLoaded',
                data: data
            });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            vscode.window.showErrorMessage(`CSV processing failed: ${error.message}`);
        }
    }

    private async handleExecuteAutomationTask(message: any): Promise<void> {
        const tenantId = this.navigationState.tenantId;
        
        if (!tenantId) {
            vscode.window.showWarningMessage('Please select a tenant first');
            return;
        }

        // Get tenant info to ensure we have the correct tenant name
        const tenantInfo = this.tenantService.getTenant(tenantId);
        if (!tenantInfo) {
            vscode.window.showWarningMessage('Tenant not found');
            return;
        }

        // Use tenantName from tenantInfo (should be the API tenant name without spaces)
        const tenantName = tenantInfo.tenantName || tenantInfo.name;

        try {
            this._panel.webview.postMessage({ command: 'showLoader', message: 'Executing task...' });
            
            const { AutomationTasksService } = await import('../../services/AutomationTasks');
            const automationService = AutomationTasksService.getInstance();
            const task = automationService.getTask(message.taskId);
            
            if (!task) {
                throw new Error('Task not found');
            }

            const client = new ISCClient(tenantId, tenantName);
            const result = await task.execute(
                client,
                tenantId,
                tenantName,
                message.config.inputData || [],
                message.config.config || {}
            );

            this._panel.webview.postMessage({
                command: 'taskExecutionResult',
                result: result
            });

            if (result.success) {
                vscode.window.showInformationMessage(result.message);
            } else {
                vscode.window.showErrorMessage(result.message);
            }
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'hideLoader' });
            vscode.window.showErrorMessage(`Task execution failed: ${error.message}`);
            this._panel.webview.postMessage({
                command: 'taskExecutionResult',
                result: {
                    success: false,
                    message: error.message,
                    errors: [error.message]
                }
            });
        }
    }

    private esc(str: string): string {
        if (!str) return '';
        return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    public dispose(): void {
        HomePanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    }
}

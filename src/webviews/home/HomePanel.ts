import * as vscode from 'vscode';
import { TenantService } from '../../services/TenantService';
import { TenantInfo } from '../../models/TenantInfo';
import { ISCClient } from '../../services/ISCClient';
import { LocalCacheService } from '../../services/cache/LocalCacheService';
import * as commands from '../../commands/constants';

type EntityType = 'sources' | 'transforms' | 'workflows' | 'identity-profiles' | 'rules' | 
                  'access-profiles' | 'roles' | 'forms' | 'governance-groups' | 'campaigns' |
                  'service-desk' | 'notification-templates' | 'segments' | 'tags';

interface NavigationState {
    view: 'home' | 'tenant' | 'entity-list';
    tenantId?: string;
    tenantName?: string;
    entityType?: EntityType;
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
            case 'addTenant':
                await vscode.commands.executeCommand(commands.ADD_TENANT);
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
            case 'loadEntityList':
                this.navigationState = {
                    ...this.navigationState,
                    view: 'entity-list',
                    entityType: message.entityType
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
            case 'globalSearch':
                if (this.navigationState.tenantId) {
                    const tenantInfo = this.tenantService.getTenant(this.navigationState.tenantId);
                    if (tenantInfo) {
                        await vscode.commands.executeCommand(commands.GLOBAL_SEARCH, { 
                            tenantId: this.navigationState.tenantId,
                            tenantName: tenantInfo.tenantName 
                        });
                    }
                }
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

    private async fetchEntities(entityType: EntityType): Promise<any[]> {
        const tenantId = this.navigationState.tenantId;
        
        // Validate tenant info
        if (!tenantId) {
            console.error(`[HomePanel] Missing tenantId`);
            return [];
        }

        const cacheKey = `${tenantId}-${entityType}`;
        if (this.entityCache.has(cacheKey)) {
            return this.entityCache.get(cacheKey)!;
        }

        try {
            // Get tenant info from service to ensure we have correct values
            const tenantInfo = this.tenantService.getTenant(tenantId);
            if (!tenantInfo) {
                console.error(`[HomePanel] Tenant not found: ${tenantId}`);
                return [];
            }

            // Use tenantInfo.tenantName (the subdomain) for API calls
            const client = new ISCClient(tenantId, tenantInfo.tenantName);
            let entities: any[] = [];

            switch (entityType) {
                case 'sources': entities = await client.getSources(); break;
                case 'transforms': entities = await client.getTransforms(); break;
                case 'workflows': entities = await client.getWorflows(); break;
                case 'identity-profiles': entities = await client.getIdentityProfiles(); break;
                case 'rules': entities = await client.getConnectorRules(); break;
                case 'access-profiles': entities = (await client.getAccessProfiles()).data || []; break;
                case 'roles': entities = (await client.getRoles()).data || []; break;
                case 'governance-groups': entities = await client.getGovernanceGroups(); break;
                case 'forms': entities = await client.listForms(); break;
                case 'service-desk': entities = await client.getServiceDesks(); break;
                default: entities = [];
            }

            this.entityCache.set(cacheKey, entities);
            return entities;
        } catch (error: any) {
            console.error(`[HomePanel] Failed to fetch ${entityType}:`, error);
            return [];
        }
    }

    private async _update(): Promise<void> {
        this._panel.webview.html = await this._getHtmlForWebview();
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
        function newRule() { showLoader('Creating rule...'); vscode.postMessage({ command: 'newRule' }); }
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
                    </div>
                </section>
            </div>
        `;
    }

    private async _renderTenantView(): Promise<string> {
        const entityTypes: { type: EntityType; label: string }[] = [
            { type: 'sources', label: 'Sources' },
            { type: 'transforms', label: 'Transforms' },
            { type: 'rules', label: 'Connector Rules' },
            { type: 'workflows', label: 'Workflows' },
            { type: 'identity-profiles', label: 'Identity Profiles' },
            { type: 'access-profiles', label: 'Access Profiles' },
            { type: 'roles', label: 'Roles' },
            { type: 'governance-groups', label: 'Governance Groups' },
            { type: 'forms', label: 'Forms' },
            { type: 'service-desk', label: 'Service Desk' },
        ];

        const counts = await Promise.all(entityTypes.map(async et => {
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
                        <button class="btn btn-secondary" onclick="newRule()">New Rule</button>
                        <button class="btn btn-secondary" onclick="globalSearch()">Search</button>
                    </div>
                </div>
                
                <section class="section">
                    <h2 class="section-title">Resources</h2>
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
                                ${entityTypes.map(et => `
                                    <tr class="table-row" onclick="loadEntityList('${et.type}')">
                                        <td class="cell-primary">${et.label}</td>
                                        <td class="cell-count">${countMap.get(et.type) || 0}</td>
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

    private async _renderEntityListView(): Promise<string> {
        const entityType = this.navigationState.entityType!;
        const entities = await this.fetchEntities(entityType);
        const filtered = this.searchQuery
            ? entities.filter(e => (e.name || '').toLowerCase().includes(this.searchQuery.toLowerCase()))
            : entities;
        const label = this._getEntityLabel(entityType);

        return `
            <div class="container">
                <div class="page-header">
                    <div>
                        <h1>${label}</h1>
                        <p class="subtitle">${filtered.length} item${filtered.length !== 1 ? 's' : ''}</p>
                    </div>
                    ${entityType === 'rules' ? `<button class="btn btn-primary" onclick="newRule()">New Rule</button>` : ''}
                </div>
                
                ${filtered.length > 0 ? `
                    <div class="table-container">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.map(e => `
                                    <tr class="table-row" onclick="openEntity('${entityType}', '${e.id}', '${this.esc(e.name || '')}')">
                                        <td>
                                            <div class="cell-primary">${this.esc(e.name || 'Unnamed')}</div>
                                            ${e.description ? `<div class="cell-secondary">${this.esc(e.description.substring(0, 60))}${e.description.length > 60 ? '...' : ''}</div>` : ''}
                                        </td>
                                        <td class="cell-meta">${this.esc(e.type || '')}</td>
                                        <td class="cell-action"><span class="arrow">→</span></td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : `
                    <div class="empty">
                        <p>No ${label.toLowerCase()} found</p>
                    </div>
                `}
            </div>
        `;
    }

    private _getEntityLabel(type: string): string {
        const labels: Record<string, string> = {
            'sources': 'Sources', 'transforms': 'Transforms', 'workflows': 'Workflows',
            'identity-profiles': 'Identity Profiles', 'rules': 'Connector Rules',
            'access-profiles': 'Access Profiles', 'roles': 'Roles', 'forms': 'Forms',
            'governance-groups': 'Governance Groups', 'service-desk': 'Service Desk',
            'source': 'Source', 'transform': 'Transform', 'workflow': 'Workflow',
            'rule': 'Rule', 'access-profile': 'Access Profile', 'role': 'Role'
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

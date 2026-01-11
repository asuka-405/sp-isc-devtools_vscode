import * as vscode from 'vscode';
import { ISCClient } from '../../services/ISCClient';
import { TenantService } from '../../services/TenantService';
import { Search } from 'sailpoint-api-client';

/**
 * Get pinned identity attributes from configuration
 */
function getPinnedAttributes(): string[] {
    const config = vscode.workspace.getConfiguration('sp-isc-devtools');
    return config.get<string[]>('identity.pinnedAttributes', []);
}

/**
 * Update pinned identity attributes in configuration
 */
async function updatePinnedAttributes(attributes: string[]): Promise<void> {
    const config = vscode.workspace.getConfiguration('sp-isc-devtools');
    await config.update('identity.pinnedAttributes', attributes, vscode.ConfigurationTarget.Global);
}

/**
 * Identity Editor Panel - Comprehensive view for identity management
 */
export class IdentityEditorPanel {
    public static currentPanel: IdentityEditorPanel | undefined;
    public static readonly viewType = 'identityEditor';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    
    private tenantId: string;
    private tenantName: string;
    private identityId: string;
    private identityData: any;
    private activeTab: string = 'details';
    private events: any[] = [];
    private accessItems: any[] = [];
    private accounts: any[] = [];
    private workReassignments: any[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        identityId: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (IdentityEditorPanel.currentPanel) {
            IdentityEditorPanel.currentPanel._panel.reveal(column);
            await IdentityEditorPanel.currentPanel.loadIdentity(tenantId, tenantName, identityId);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            IdentityEditorPanel.viewType,
            'Identity Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        IdentityEditorPanel.currentPanel = new IdentityEditorPanel(panel, extensionUri, tenantService, tenantId, tenantName, identityId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        identityId: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.identityId = identityId;

        this._updateWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                console.log('[IdentityEditor] Received message:', message.command);
                try {
                    switch (message.command) {
                        case 'switchTab':
                            this.activeTab = message.tab;
                            await this.loadTabData(message.tab);
                            // Send updated data to webview
                            this._panel.webview.postMessage({
                                command: 'tabDataLoaded',
                                tab: message.tab,
                                data: {
                                    events: this.events,
                                    accessItems: this.accessItems,
                                    accounts: this.accounts,
                                    workReassignments: this.workReassignments
                                }
                            });
                            this._updateWebview();
                            break;
                        case 'processIdentity':
                            vscode.window.showInformationMessage('Process Identity - Coming soon in next version');
                            break;
                        case 'setUserLevel':
                            vscode.window.showInformationMessage('Set User Level - Coming soon in next version');
                            break;
                        case 'syncAttributes':
                            vscode.window.showInformationMessage('Sync Attributes - Coming soon in next version');
                            break;
                        case 'setLifecycleState':
                            vscode.window.showInformationMessage('Set Lifecycle State - Coming soon in next version');
                            break;
                        case 'disableIdentity':
                            vscode.window.showInformationMessage('Disable Identity - Coming soon in next version');
                            break;
                        case 'resetIdentity':
                            vscode.window.showInformationMessage('Reset Identity - Coming soon in next version');
                            break;
                        case 'resetPassword':
                            vscode.window.showInformationMessage('Reset Password - Coming soon in next version');
                            break;
                        case 'deleteIdentity':
                            await this.deleteIdentity();
                            break;
                        case 'refresh':
                            await this.loadIdentity(this.tenantId, this.tenantName, this.identityId);
                            break;
                        case 'pinAttribute':
                            await this.pinAttribute(message.attributeName);
                            break;
                        case 'unpinAttribute':
                            await this.unpinAttribute(message.attributeName);
                            break;
                        default:
                            console.warn('[IdentityEditor] Unknown command:', message.command);
                            vscode.window.showInformationMessage(`Unknown command: ${message.command}`);
                    }
                } catch (error: any) {
                    console.error('[IdentityEditor] Error handling message:', error);
                    vscode.window.showErrorMessage(`Error: ${error.message || 'Unknown error'}`);
                }
            },
            null,
            this._disposables
        );

        this.loadIdentity(tenantId, tenantName, identityId);
    }

    private async loadIdentity(tenantId: string, tenantName: string, identityId: string): Promise<void> {
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.identityId = identityId;

        try {
            const client = new ISCClient(tenantId, tenantName);
            
            // Load identity data - use paginatedSearchIdentities to get full identity with access info
            try {
                const identitySearchResp = await client.paginatedSearchIdentities(
                    `id:${identityId}`,
                    1,
                    0,
                    false,
                    ['id', 'name', 'displayName', 'email', 'inactive', 'lifecycleState', 'attributes', 'access', 'accessProfiles', 'roles', 'apps'],
                    true // includeNested to get access items
                );
                if (identitySearchResp.data && identitySearchResp.data.length > 0) {
                    this.identityData = identitySearchResp.data[0] as any;
                } else {
                    // Fallback to listIdentities
                    const identityResp = await client.listIdentities({ filters: `id eq "${identityId}"`, limit: 1 });
                    if (identityResp.data && identityResp.data.length > 0) {
                        this.identityData = identityResp.data[0];
                    } else {
                        // Final fallback to search
                        this.identityData = await client.getIdentity(identityId);
                    }
                }
            } catch (error: any) {
                console.error('[IdentityEditor] Error loading identity:', error);
                // Try fallback
                const identityResp = await client.listIdentities({ filters: `id eq "${identityId}"`, limit: 1 });
                if (identityResp.data && identityResp.data.length > 0) {
                    this.identityData = identityResp.data[0];
                } else {
                    this.identityData = await client.getIdentity(identityId);
                }
            }
            
            if (!this.identityData) {
                vscode.window.showErrorMessage(`Identity ${identityId} not found`);
                return;
            }

            this._panel.title = `👤 ${(this.identityData as any).name || (this.identityData as any).displayName || 'Identity'}`;
            
            // Load initial tab data
            await this.loadTabData(this.activeTab);
            
            this._updateWebview();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load identity: ${error.message}`);
        }
    }

    private async loadTabData(tab: string): Promise<void> {
        if (!this.identityData) return;

        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            
            switch (tab) {
                case 'events':
                    await this.loadEvents(client);
                    break;
                case 'access':
                    await this.loadAccessItems(client);
                    break;
                case 'accounts':
                    await this.loadAccounts(client);
                    break;
                case 'work-reassignment':
                    await this.loadWorkReassignments(client);
                    break;
            }
        } catch (error: any) {
            console.error(`[IdentityEditor] Error loading ${tab} tab:`, error);
        }
    }

    private async loadEvents(client: ISCClient): Promise<void> {
        try {
            // Search for events related to this identity
            const eventsSearch: Search = {
                indices: ['events'],
                query: {
                    query: `target.id eq "${this.identityId}" OR actor.id eq "${this.identityId}"`
                },
                sort: ['-created']
            };
            this.events = await client.search(eventsSearch, 250);
        } catch (error: any) {
            console.error('[IdentityEditor] Error loading events:', error);
            this.events = [];
        }
    }

    private async loadAccessItems(client: ISCClient): Promise<void> {
        try {
            // Use identity data that's already loaded, or fetch it with access information
            if (this.identityData) {
                const identity = this.identityData as any;
                // Combine access profiles, roles, and entitlements from identity
                this.accessItems = [
                    ...(identity.accessProfiles || []).map((ap: any) => ({ ...ap, _type: 'accessprofile', type: 'ACCESS_PROFILE' })),
                    ...(identity.roles || []).map((r: any) => ({ ...r, _type: 'role', type: 'ROLE' })),
                    ...(identity.access || []).filter((a: any) => a.type === 'ENTITLEMENT').map((e: any) => ({ ...e, _type: 'entitlement', type: 'ENTITLEMENT' }))
                ];
            } else {
                // Fallback: search for access items
                const accessSearch: Search = {
                    indices: ['accessprofiles', 'roles'],
                    query: {
                        query: `assigned.id eq "${this.identityId}" OR members.id eq "${this.identityId}"`
                    }
                };
                this.accessItems = await client.search(accessSearch, 250);
            }
        } catch (error: any) {
            console.error('[IdentityEditor] Error loading access items:', error);
            this.accessItems = [];
        }
    }

    private async loadAccounts(client: ISCClient): Promise<void> {
        try {
            // Get accounts linked to this identity using AccountsApi directly
            const apiConfig = await (client as any).getApiConfiguration();
            const AccountsApi = (await import('sailpoint-api-client')).AccountsApi;
            const api = new AccountsApi(apiConfig, undefined, (client as any).getAxiosWithInterceptors());
            const response = await api.listAccounts({
                filters: `identityId eq "${this.identityId}"`,
                limit: 250,
                offset: 0
            });
            this.accounts = response.data || [];
        } catch (error: any) {
            console.error('[IdentityEditor] Error loading accounts:', error);
            this.accounts = [];
        }
    }

    private async loadWorkReassignments(client: ISCClient): Promise<void> {
        try {
            // Search for work reassignments (certifications, access requests, etc.)
            // This might need to be implemented based on available APIs
            const reassignmentSearch: Search = {
                indices: ['events'],
                query: {
                    query: `target.id eq "${this.identityId}" AND (type eq "CERTIFICATION_REASSIGNED" OR type eq "ACCESS_REQUEST_REASSIGNED")`
                },
                sort: ['-created']
            };
            this.workReassignments = await client.search(reassignmentSearch, 250);
        } catch (error: any) {
            console.error('[IdentityEditor] Error loading work reassignments:', error);
            this.workReassignments = [];
        }
    }


    private async deleteIdentity(): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            `Are you sure you want to delete identity "${(this.identityData as any).name || (this.identityData as any).displayName}"?`,
            { modal: true },
            'Delete'
        );
        
        if (confirm === 'Delete') {
            try {
                const client = new ISCClient(this.tenantId, this.tenantName);
                await client.deleteIdentity(this.identityId);
                vscode.window.showInformationMessage('Identity deleted successfully');
                this._panel.dispose();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to delete identity: ${error.message}`);
            }
        }
    }

    private async pinAttribute(attributeName: string): Promise<void> {
        const pinned = getPinnedAttributes();
        if (!pinned.includes(attributeName)) {
            pinned.push(attributeName);
            await updatePinnedAttributes(pinned);
            this._updateWebview();
        }
    }

    private async unpinAttribute(attributeName: string): Promise<void> {
        const pinned = getPinnedAttributes();
        const updated = pinned.filter(a => a !== attributeName);
        await updatePinnedAttributes(updated);
        this._updateWebview();
    }

    private _updateWebview(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const identityJson = JSON.stringify(this.identityData || {}, null, 2);
        const tenantInfo = this.tenantService.getTenant(this.tenantId);
        const isReadOnly = tenantInfo?.readOnly ?? false;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Identity Editor</title>
    <style>
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
            line-height: 1.5;
        }
        
        .app { min-height: 100vh; display: flex; flex-direction: column; }
        
        .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }
        
        .page-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            margin-bottom: 32px;
        }
        
        .page-header h1 { 
            font-size: 24px; 
            font-weight: 600; 
            color: var(--fg-0); 
            margin-bottom: 4px; 
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .subtitle { color: var(--fg-2); font-size: 14px; }
        .header-actions { display: flex; gap: 8px; flex-wrap: wrap; }
        
        .status { 
            display: inline-block; 
            padding: 2px 8px; 
            border-radius: 10px; 
            font-size: 11px; 
            font-weight: 500; 
        }
        .status-success { background: rgba(76, 175, 80, 0.15); color: var(--success); }
        .status-warning { background: rgba(255, 152, 0, 0.15); color: var(--warning); }
        
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
        .btn-danger { background: #d32f2f; color: white; }
        .btn-danger:hover { background: #c62828; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .section { margin-bottom: 32px; }
        .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
        .section-title { 
            font-size: 12px; 
            font-weight: 600; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
            color: var(--fg-2); 
        }
        
        .tabs {
            display: flex;
            gap: 0;
            margin-bottom: 24px;
            border-bottom: 1px solid var(--border);
        }
        
        .tab {
            padding: 12px 16px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--fg-2);
            font-weight: 500;
            cursor: pointer;
            transition: color 0.15s;
            font-size: 13px;
        }
        
        .tab:hover { color: var(--fg-1); }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .info-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 16px;
        }
        
        .info-item {
            background: var(--bg-2);
            padding: 12px;
            border-radius: var(--radius);
            border: 1px solid var(--border);
        }
        
        .info-label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
            margin-bottom: 4px;
            font-weight: 500;
        }
        
        .info-value {
            font-size: 14px;
            color: var(--fg-0);
            word-break: break-word;
        }
        
        .card {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 20px;
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
        }
        
        .card.fixed-height {
            height: 400px;
            overflow-y: auto;
            overflow-x: hidden;
        }
        
        .card.auto-height {
            max-height: 400px;
            overflow-y: auto;
            overflow-x: hidden;
        }
        
        .card-header {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--fg-0);
            display: flex;
            align-items: center;
            gap: 8px;
            flex-shrink: 0;
        }
        
        .card.fixed-height > .attributes-grid,
        .card.fixed-height > .info-grid {
            flex: 1;
            overflow-y: auto;
            overflow-x: hidden;
            min-height: 0;
        }
        
        .table-container { 
            background: var(--bg-1); 
            border: 1px solid var(--border); 
            border-radius: var(--radius); 
            overflow: hidden; 
        }
        
        .table { width: 100%; border-collapse: collapse; }
        .table th { 
            text-align: left; 
            padding: 12px 16px; 
            font-size: 11px; 
            font-weight: 600; 
            text-transform: uppercase; 
            letter-spacing: 0.5px; 
            color: var(--fg-2); 
            background: var(--bg-2); 
            border-bottom: 1px solid var(--border); 
        }
        .table td { padding: 12px 16px; border-bottom: 1px solid var(--border); }
        .table tbody tr:last-child td { border-bottom: none; }
        
        .table-row { cursor: pointer; transition: background 0.1s; }
        .table-row:hover { background: var(--bg-2); }
        
        .cell-primary { font-weight: 500; color: var(--fg-0); }
        .cell-secondary { color: var(--fg-2); font-size: 12px; }
        
        .empty-state {
            text-align: center;
            padding: 40px 24px;
            color: var(--fg-2);
        }
        
        .attributes-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
            gap: 12px;
        }
        
        .attribute-item {
            background: var(--bg-2);
            padding: 12px;
            border-radius: var(--radius);
            border: 1px solid var(--border);
            position: relative;
        }
        
        .attribute-item.pinned {
            border-color: var(--warning);
            background: rgba(255, 152, 0, 0.1);
        }
        
        .attribute-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
        }
        
        .attribute-name {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
            font-weight: 600;
        }
        
        .pin-button {
            background: none;
            border: none;
            color: var(--fg-3);
            cursor: pointer;
            padding: 4px;
            display: flex;
            align-items: center;
            font-size: 14px;
            transition: color 0.2s;
        }
        
        .pin-button:hover {
            color: var(--warning);
        }
        
        .pin-button.pinned {
            color: var(--warning);
        }
        
        .attribute-value {
            font-size: 13px;
            color: var(--fg-0);
            word-break: break-word;
            max-height: 200px;
            overflow-y: auto;
            overflow-x: hidden;
            padding-right: 4px;
        }
        
        .attribute-value pre {
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
            font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
            font-size: 12px;
        }
        
        .attribute-value::-webkit-scrollbar {
            width: 6px;
        }
        
        .attribute-value::-webkit-scrollbar-track {
            background: var(--bg-0);
            border-radius: var(--radius);
        }
        
        .attribute-value::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: var(--radius);
        }
        
        .attribute-value::-webkit-scrollbar-thumb:hover {
            background: var(--fg-3);
        }
        
        .pinned-section {
            margin-bottom: 24px;
        }
        
        .pinned-section-title {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
    </style>
</head>
<body>
    <div class="app">
        <div class="container">
            <div class="page-header">
                <div>
                    <h1>
                        👤 ${this._escapeHtml((this.identityData as any)?.name || (this.identityData as any)?.displayName || 'Identity')}
                        ${(this.identityData as any)?.inactive ? '<span class="status status-warning">Inactive</span>' : '<span class="status status-success">Active</span>'}
                    </h1>
                    <p class="subtitle">Identity Details</p>
                </div>
                <div class="header-actions">
                    <button class="btn btn-secondary" data-action="processIdentity" ${isReadOnly ? 'disabled' : ''}>Process Identity</button>
                    <button class="btn btn-secondary" data-action="setUserLevel" ${isReadOnly ? 'disabled' : ''}>Set User Level</button>
                    <button class="btn btn-secondary" data-action="syncAttributes" ${isReadOnly ? 'disabled' : ''}>Sync Attributes</button>
                    <button class="btn btn-secondary" data-action="setLifecycleState" ${isReadOnly ? 'disabled' : ''}>Set Lifecycle State</button>
                    <button class="btn btn-secondary" data-action="disableIdentity" ${isReadOnly ? 'disabled' : ''}>Disable Identity</button>
                    <button class="btn btn-secondary" data-action="resetIdentity" ${isReadOnly ? 'disabled' : ''}>Reset Identity</button>
                    <button class="btn btn-secondary" data-action="resetPassword" ${isReadOnly ? 'disabled' : ''}>Reset Password</button>
                    <button class="btn btn-danger" data-action="deleteIdentity" ${isReadOnly ? 'disabled' : ''}>Delete Identity</button>
                    <button class="btn btn-secondary" data-action="refresh">🔄 Refresh</button>
                </div>
            </div>
            
            <div class="tabs">
                <button class="tab ${this.activeTab === 'details' ? 'active' : ''}" data-tab="details">Details</button>
                <button class="tab ${this.activeTab === 'events' ? 'active' : ''}" data-tab="events">Events (${this.events.length})</button>
                <button class="tab ${this.activeTab === 'access' ? 'active' : ''}" data-tab="access">Access (${this.accessItems.length})</button>
                <button class="tab ${this.activeTab === 'accounts' ? 'active' : ''}" data-tab="accounts">Accounts (${this.accounts.length})</button>
                <button class="tab ${this.activeTab === 'work-reassignment' ? 'active' : ''}" data-tab="work-reassignment">Work Reassignment (${this.workReassignments.length})</button>
            </div>
            
            <div id="tab-details" class="tab-content ${this.activeTab === 'details' ? 'active' : ''}">
                ${this._renderDetailsTab()}
            </div>
            
            <div id="tab-events" class="tab-content ${this.activeTab === 'events' ? 'active' : ''}">
                ${this._renderEventsTab()}
            </div>
            
            <div id="tab-access" class="tab-content ${this.activeTab === 'access' ? 'active' : ''}">
                ${this._renderAccessTab()}
            </div>
            
            <div id="tab-accounts" class="tab-content ${this.activeTab === 'accounts' ? 'active' : ''}">
                ${this._renderAccountsTab()}
            </div>
            
            <div id="tab-work-reassignment" class="tab-content ${this.activeTab === 'work-reassignment' ? 'active' : ''}">
                ${this._renderWorkReassignmentTab()}
            </div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let currentTab = '${this.activeTab}';
        
        function switchTab(tab, event) {
            console.log('[IdentityEditor] switchTab called:', tab);
            // Update active tab visually
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            
            // Find and activate the correct tab button
            const tabButton = document.querySelector(\`[data-tab="\${tab}"]\`);
            if (tabButton) {
                tabButton.classList.add('active');
            }
            
            const tabContent = document.getElementById('tab-' + tab);
            if (tabContent) {
                tabContent.classList.add('active');
            }
            currentTab = tab;
            
            // Request data from extension
            vscode.postMessage({ command: 'switchTab', tab: tab });
        }
        
        function processIdentity() {
            console.log('processIdentity called');
            try {
                vscode.postMessage({ command: 'processIdentity' });
                console.log('processIdentity message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Process Identity - Coming soon in next version');
            }
        }
        
        function setUserLevel() {
            console.log('setUserLevel called');
            try {
                vscode.postMessage({ command: 'setUserLevel' });
                console.log('setUserLevel message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Set User Level - Coming soon in next version');
            }
        }
        
        function syncAttributes() {
            console.log('syncAttributes called');
            try {
                vscode.postMessage({ command: 'syncAttributes' });
                console.log('syncAttributes message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Sync Attributes - Coming soon in next version');
            }
        }
        
        function setLifecycleStatePrompt() {
            console.log('setLifecycleStatePrompt called');
            try {
                vscode.postMessage({ command: 'setLifecycleState' });
                console.log('setLifecycleState message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Set Lifecycle State - Coming soon in next version');
            }
        }
        
        function disableIdentity() {
            console.log('disableIdentity called');
            try {
                vscode.postMessage({ command: 'disableIdentity' });
                console.log('disableIdentity message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Disable Identity - Coming soon in next version');
            }
        }
        
        function resetIdentity() {
            console.log('resetIdentity called');
            try {
                vscode.postMessage({ command: 'resetIdentity' });
                console.log('resetIdentity message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Reset Identity - Coming soon in next version');
            }
        }
        
        function resetPassword() {
            console.log('resetPassword called');
            try {
                vscode.postMessage({ command: 'resetPassword' });
                console.log('resetPassword message sent');
            } catch (e) {
                console.error('Error posting message:', e);
                alert('Reset Password - Coming soon in next version');
            }
        }
        
        function deleteIdentity() {
            console.log('[IdentityEditor] deleteIdentity called');
            vscode.postMessage({ command: 'deleteIdentity' });
        }
        
        function refresh() {
            console.log('[IdentityEditor] refresh called');
            vscode.postMessage({ command: 'refresh' });
        }
        
        function pinAttribute(attributeName) {
            vscode.postMessage({ command: 'pinAttribute', attributeName: attributeName });
        }
        
        function unpinAttribute(attributeName) {
            vscode.postMessage({ command: 'unpinAttribute', attributeName: attributeName });
        }
        
        // Make functions globally accessible
        window.processIdentity = processIdentity;
        window.setUserLevel = setUserLevel;
        window.syncAttributes = syncAttributes;
        window.setLifecycleStatePrompt = setLifecycleStatePrompt;
        window.disableIdentity = disableIdentity;
        window.resetIdentity = resetIdentity;
        window.resetPassword = resetPassword;
        window.deleteIdentity = deleteIdentity;
        window.refresh = refresh;
        window.switchTab = switchTab;
        window.pinAttribute = pinAttribute;
        window.unpinAttribute = unpinAttribute;
        
        // Set up event listeners using event delegation - wait for DOM to be ready
        function setupClickHandlers() {
            console.log('[IdentityEditor] Setting up click handlers');
            
            // Use event delegation on document body
            document.body.addEventListener('click', (e) => {
                const target = e.target as HTMLElement;
                if (!target) return;
                
                console.log('[IdentityEditor] Click detected on:', target.tagName, target.className);
                
                // Handle action buttons
                const actionBtn = target.closest('[data-action]') as HTMLElement;
                if (actionBtn) {
                    const action = actionBtn.getAttribute('data-action');
                    if (action) {
                        e.preventDefault();
                        e.stopPropagation();
                        
                        if (actionBtn.hasAttribute('disabled') || (actionBtn as HTMLButtonElement).disabled) {
                            console.log('[IdentityEditor] Button disabled:', action);
                            return;
                        }
                        
                        console.log('[IdentityEditor] Button clicked:', action);
                        
                        switch(action) {
                            case 'processIdentity':
                                processIdentity();
                                break;
                            case 'setUserLevel':
                                setUserLevel();
                                break;
                            case 'syncAttributes':
                                syncAttributes();
                                break;
                            case 'setLifecycleState':
                                setLifecycleStatePrompt();
                                break;
                            case 'disableIdentity':
                                disableIdentity();
                                break;
                            case 'resetIdentity':
                                resetIdentity();
                                break;
                            case 'resetPassword':
                                resetPassword();
                                break;
                            case 'deleteIdentity':
                                deleteIdentity();
                                break;
                            case 'refresh':
                                refresh();
                                break;
                            case 'pinAttribute':
                                const pinAttr = actionBtn.getAttribute('data-attribute');
                                if (pinAttr) {
                                    pinAttribute(pinAttr);
                                }
                                break;
                            case 'unpinAttribute':
                                const unpinAttr = actionBtn.getAttribute('data-attribute');
                                if (unpinAttr) {
                                    unpinAttribute(unpinAttr);
                                }
                                break;
                            default:
                                console.warn('[IdentityEditor] Unknown action:', action);
                        }
                        return;
                    }
                }
                
                // Handle tab buttons
                const tabBtn = target.closest('[data-tab]') as HTMLElement;
                if (tabBtn) {
                    const tab = tabBtn.getAttribute('data-tab');
                    if (tab) {
                        e.preventDefault();
                        e.stopPropagation();
                        console.log('[IdentityEditor] Tab clicked:', tab);
                        switchTab(tab, e);
                        return;
                    }
                }
            });
            
            console.log('[IdentityEditor] Click handlers set up');
        }
        
        // Set up handlers when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', setupClickHandlers);
        } else {
            // DOM already ready, set up immediately
            setupClickHandlers();
        }
        
        // Listen for messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'tabDataLoaded') {
                // Update tab counts if needed
                if (msg.tab === 'events') {
                    const eventsTab = document.querySelector('[data-tab="events"]');
                    if (eventsTab) eventsTab.textContent = \`Events (\${msg.data.events.length})\`;
                } else if (msg.tab === 'access') {
                    const accessTab = document.querySelector('[data-tab="access"]');
                    if (accessTab) accessTab.textContent = \`Access (\${msg.data.accessItems.length})\`;
                } else if (msg.tab === 'accounts') {
                    const accountsTab = document.querySelector('[data-tab="accounts"]');
                    if (accountsTab) accountsTab.textContent = \`Accounts (\${msg.data.accounts.length})\`;
                } else if (msg.tab === 'work-reassignment') {
                    const reassignmentTab = document.querySelector('[data-tab="work-reassignment"]');
                    if (reassignmentTab) reassignmentTab.textContent = \`Work Reassignment (\${msg.data.workReassignments.length})\`;
                }
        });
    </script>
</body>
</html>`;
    }

    private _renderDetailsTab(): string {
        if (!this.identityData) {
            return '<div class="empty-state">Loading identity details...</div>';
        }

        const identity = this.identityData as any;
        const attributes = identity.attributes || {};
        const attributeEntries = Object.entries(attributes);
        const pinnedAttributes = getPinnedAttributes();
        
        // Separate pinned and unpinned attributes
        const pinnedEntries: [string, any][] = [];
        const unpinnedEntries: [string, any][] = [];
        
        attributeEntries.forEach(([key, value]) => {
            if (pinnedAttributes.includes(key)) {
                pinnedEntries.push([key, value]);
            } else {
                unpinnedEntries.push([key, value]);
            }
        });
        
        // Sort pinned attributes by their order in pinnedAttributes array
        pinnedEntries.sort((a, b) => {
            const indexA = pinnedAttributes.indexOf(a[0]);
            const indexB = pinnedAttributes.indexOf(b[0]);
            return indexA - indexB;
        });

        return `
            <div class="card auto-height">
                <div class="card-header">Basic Information</div>
                <div class="info-grid">
                    <div class="info-item">
                        <div class="info-label">Name</div>
                        <div class="info-value">${this._escapeHtml(identity.name || 'N/A')}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Display Name</div>
                        <div class="info-value">${this._escapeHtml(identity.displayName || 'N/A')}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Email</div>
                        <div class="info-value">${this._escapeHtml(identity.email || attributes.email || 'N/A')}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">ID</div>
                        <div class="info-value">${this._escapeHtml(identity.id || 'N/A')}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Status</div>
                        <div class="info-value">${identity.inactive ? '<span class="status status-warning">Inactive</span>' : '<span class="status status-success">Active</span>'}</div>
                    </div>
                    <div class="info-item">
                        <div class="info-label">Lifecycle State</div>
                        <div class="info-value">${this._escapeHtml(identity.lifecycleState?.name || attributes.lifecycleState || 'N/A')}</div>
                    </div>
                </div>
            </div>
            
            ${pinnedEntries.length > 0 ? `
            <div class="pinned-section">
                <div class="pinned-section-title">
                    📌 Pinned Attributes
                </div>
                <div class="card auto-height">
                    <div class="attributes-grid">
                        ${pinnedEntries.map(([key, value]) => `
                            <div class="attribute-item pinned">
                                <div class="attribute-header">
                                    <div class="attribute-name">${this._escapeHtml(key)}</div>
                                    <button class="pin-button pinned" data-action="unpinAttribute" data-attribute="${this._escapeHtml(key)}" title="Unpin attribute">📌</button>
                                </div>
                                <div class="attribute-value">${this._formatAttributeValue(value)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
            ` : ''}
            
            <div class="section">
                <h2 class="section-title">All Identity Attributes</h2>
                ${attributeEntries.length > 0 ? `
                    <div class="card fixed-height">
                        <div class="attributes-grid">
                            ${unpinnedEntries.map(([key, value]) => `
                                <div class="attribute-item">
                                    <div class="attribute-header">
                                        <div class="attribute-name">${this._escapeHtml(key)}</div>
                                        <button class="pin-button" data-action="pinAttribute" data-attribute="${this._escapeHtml(key)}" title="Pin attribute for all identities">📌</button>
                                    </div>
                                    <div class="attribute-value">${this._formatAttributeValue(value)}</div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '<div class="empty-state">No attributes available</div>'}
            </div>
        `;
    }

    private _renderEventsTab(): string {
        if (this.events.length === 0) {
            return '<div class="empty-state">No events found for this identity</div>';
        }

        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Event Type</th>
                            <th>Description</th>
                            <th>Created</th>
                            <th>Actor</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.events.map((event: any) => `
                            <tr class="table-row">
                                <td class="cell-primary">${this._escapeHtml(event.type || event.eventType || 'N/A')}</td>
                                <td>${this._escapeHtml(event.description || event.name || 'N/A')}</td>
                                <td class="cell-secondary">${event.created ? new Date(event.created).toLocaleString() : 'N/A'}</td>
                                <td class="cell-secondary">${this._escapeHtml(event.actor?.name || event.actorId || 'N/A')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    private _renderAccessTab(): string {
        if (this.accessItems.length === 0) {
            return '<div class="empty-state">No access items found for this identity</div>';
        }

        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Name</th>
                            <th>Description</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.accessItems.map((item: any) => `
                            <tr class="table-row">
                                <td class="cell-primary">${this._escapeHtml(item._type || item.type || 'N/A')}</td>
                                <td class="cell-primary">${this._escapeHtml(item.name || 'N/A')}</td>
                                <td>${this._escapeHtml(item.description || 'N/A')}</td>
                                <td>${item.enabled !== false ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-warning">Inactive</span>'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    private _renderAccountsTab(): string {
        if (this.accounts.length === 0) {
            return '<div class="empty-state">No accounts found for this identity</div>';
        }

        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Account Name</th>
                            <th>Source</th>
                            <th>Native Identity</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.accounts.map((account: any) => `
                            <tr class="table-row">
                                <td class="cell-primary">${this._escapeHtml(account.name || account.nativeIdentity || 'N/A')}</td>
                                <td class="cell-secondary">${this._escapeHtml(account.source?.name || account.sourceId || 'N/A')}</td>
                                <td class="cell-secondary">${this._escapeHtml(account.nativeIdentity || 'N/A')}</td>
                                <td>${account.disabled ? '<span class="badge badge-warning">Disabled</span>' : '<span class="badge badge-success">Active</span>'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    private _renderWorkReassignmentTab(): string {
        if (this.workReassignments.length === 0) {
            return '<div class="empty-state">No work reassignments found for this identity</div>';
        }

        return `
            <div class="table-container">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Type</th>
                            <th>Description</th>
                            <th>Status</th>
                            <th>Created</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this.workReassignments.map((reassignment: any) => `
                            <tr class="table-row">
                                <td class="cell-primary">${this._escapeHtml(reassignment.type || reassignment.eventType || 'N/A')}</td>
                                <td>${this._escapeHtml(reassignment.description || reassignment.name || 'N/A')}</td>
                                <td>${reassignment.status ? `<span class="badge badge-info">${this._escapeHtml(reassignment.status)}</span>` : 'N/A'}</td>
                                <td class="cell-secondary">${reassignment.created ? new Date(reassignment.created).toLocaleString() : 'N/A'}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    private _escapeHtml(text: string): string {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    private _formatAttributeValue(value: any): string {
        if (value === null || value === undefined) return 'N/A';
        
        // If it's an object or array, format as JSON
        if (typeof value === 'object') {
            try {
                const jsonStr = JSON.stringify(value, null, 2);
                // Escape HTML and preserve whitespace
                return `<pre>${this._escapeHtml(jsonStr)}</pre>`;
            } catch (e) {
                return this._escapeHtml(String(value));
            }
        }
        
        // For strings, use pre-wrap for long text to preserve formatting
        const strValue = String(value);
        // Use pre-wrap for any string to handle long text better
        return `<pre>${this._escapeHtml(strValue)}</pre>`;
    }

    public dispose(): void {
        IdentityEditorPanel.currentPanel = undefined;
        while (this._disposables.length) {
            const disposable = this._disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}

import * as vscode from 'vscode';
import { ISCClient } from '../../services/ISCClient';
import { TenantService } from '../../services/TenantService';
import { LocalCacheService, CacheableEntityType } from '../../services/cache/LocalCacheService';
import { CommitService } from '../../services/CommitService';
import * as commands from '../../commands/constants';

/**
 * Source Configuration Panel - Rich UI for editing sources
 */
export class SourceConfigPanel {
    public static currentPanel: SourceConfigPanel | undefined;
    public static readonly viewType = 'sourceConfigPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    
    private tenantId: string;
    private tenantName: string;
    private sourceId: string;
    private sourceData: any;
    private schemas: any[] = [];
    private provisioningPolicies: any[] = [];
    private clusters: any[] = [];
    private connectorRules: any[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        sourceId: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (SourceConfigPanel.currentPanel) {
            SourceConfigPanel.currentPanel._panel.reveal(column);
            await SourceConfigPanel.currentPanel.loadSource(tenantId, tenantName, sourceId);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            SourceConfigPanel.viewType,
            'Source Configuration',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        SourceConfigPanel.currentPanel = new SourceConfigPanel(panel, extensionUri, tenantService, tenantId, tenantName, sourceId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        sourceId: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.sourceId = sourceId;

        this._updateWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this.saveSource(message.data);
                        break;
                    case 'commit':
                        await this.commitSource();
                        break;
                    case 'revert':
                        await this.revertSource();
                        break;
                    case 'testConnection':
                        await this.testConnection();
                        break;
                    case 'refresh':
                        await this.loadSource(this.tenantId, this.tenantName, this.sourceId);
                        break;
                    case 'searchIdentity':
                        await this.searchIdentity(message.query);
                        break;
                    case 'searchGovernanceGroup':
                        await this.searchGovernanceGroup(message.query);
                        break;
                    case 'updateOwner':
                        await this.updateOwner(message.owner);
                        break;
                    case 'updateCluster':
                        await this.updateCluster(message.clusterId);
                        break;
                    case 'updateGovernanceGroup':
                        await this.updateGovernanceGroup(message.group);
                        break;
                    case 'saveSchema':
                        await this.saveSchema(message.schemaId, message.data);
                        break;
                    case 'saveProvisioningPolicy':
                        await this.saveProvisioningPolicy(message.policyType, message.data);
                        break;
                    case 'openRule':
                        await this.openRule(message.ruleName);
                        break;
                    case 'saveJson':
                        await this.saveSourceJson(message.json);
                        break;
                }
            },
            null,
            this._disposables
        );

        this.loadSource(tenantId, tenantName, sourceId);
    }

    private async loadSource(tenantId: string, tenantName: string, sourceId: string): Promise<void> {
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.sourceId = sourceId;

        try {
            const client = new ISCClient(tenantId, tenantName);
            
            // Load source data
            this.sourceData = await client.getSourceById(sourceId);
            
            // Load schemas
            this.schemas = await client.getResource(`v3/sources/${sourceId}/schemas`) || [];
            
            // Load provisioning policies
            this.provisioningPolicies = await client.getProvisioningPolicies(sourceId) || [];
            
            // Load clusters
            try {
                this.clusters = await client.getResource('beta/managed-clusters') || [];
            } catch (e) {
                this.clusters = [];
            }

            // Load connector rules for rule lookup
            try {
                this.connectorRules = await client.getConnectorRules() || [];
            } catch (e) {
                this.connectorRules = [];
            }
            
            // Cache the source
            const cacheService = LocalCacheService.getInstance();
            await cacheService.cacheEntity(
                tenantId,
                CacheableEntityType.source,
                sourceId,
                this.sourceData.name,
                this.sourceData
            );

            this._panel.title = `⚙️ ${this.sourceData.name}`;
            this._updateWebview();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load source: ${error.message}`);
        }
    }

    private async searchIdentity(query: string): Promise<void> {
        if (!query || query.length < 2) {
            this._panel.webview.postMessage({ command: 'identityResults', results: [] });
            return;
        }

        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            // Use a simpler search query that's more reliable
            const response = await client.paginatedSearchIdentities(
                `*${query}*`,
                15,
                0,
                false
            );
            
            const results = (response.data || []).map((identity: any) => ({
                id: identity.id,
                name: identity.name,
                displayName: identity.displayName || identity.attributes?.displayName || identity.name,
                email: identity.attributes?.email || identity.email || ''
            }));
            
            this._panel.webview.postMessage({ command: 'identityResults', results });
        } catch (error: any) {
            console.error('Identity search error:', error);
            this._panel.webview.postMessage({ command: 'identityResults', results: [] });
        }
    }

    private async searchGovernanceGroup(query: string): Promise<void> {
        if (!query || query.length < 2) {
            this._panel.webview.postMessage({ command: 'governanceGroupResults', results: [] });
            return;
        }

        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            const groups = await client.getGovernanceGroups(`name sw "${query}"`, 10);
            
            const results = (groups || []).map((group: any) => ({
                id: group.id,
                name: group.name,
                description: group.description || ''
            }));
            
            this._panel.webview.postMessage({ command: 'governanceGroupResults', results });
        } catch (error: any) {
            console.error('Governance group search error:', error);
            this._panel.webview.postMessage({ command: 'governanceGroupResults', results: [] });
        }
    }

    private async updateOwner(owner: { id: string; name: string; type: string }): Promise<void> {
        if (!this.sourceData) { return; }
        
        this.sourceData.owner = {
            id: owner.id,
            name: owner.name,
            type: owner.type || 'IDENTITY'
        };
        
        await this.saveSource(this.sourceData);
    }

    private async updateCluster(clusterId: string): Promise<void> {
        if (!this.sourceData) { return; }
        
        const cluster = this.clusters.find(c => c.id === clusterId);
        if (cluster) {
            this.sourceData.cluster = {
                id: cluster.id,
                name: cluster.name,
                type: 'CLUSTER'
            };
        }
        
        await this.saveSource(this.sourceData);
    }

    private async updateGovernanceGroup(group: { id: string; name: string }): Promise<void> {
        if (!this.sourceData) { return; }
        
        this.sourceData.managementWorkgroup = {
            id: group.id,
            name: group.name,
            type: 'GOVERNANCE_GROUP'
        };
        
        await this.saveSource(this.sourceData);
    }

    private async saveSchema(schemaId: string, data: string): Promise<void> {
        try {
            const parsed = JSON.parse(data);
            const client = new ISCClient(this.tenantId, this.tenantName);
            await client.updateResource(`v3/sources/${this.sourceId}/schemas/${schemaId}`, JSON.stringify(parsed));
            vscode.window.showInformationMessage('✅ Schema saved successfully!');
            await this.loadSource(this.tenantId, this.tenantName, this.sourceId);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save schema: ${error.message}`);
        }
    }

    private async saveProvisioningPolicy(policyType: string, data: string): Promise<void> {
        try {
            const parsed = JSON.parse(data);
            const client = new ISCClient(this.tenantId, this.tenantName);
            await client.updateResource(`v3/sources/${this.sourceId}/provisioning-policies/${policyType}`, JSON.stringify(parsed));
            vscode.window.showInformationMessage('✅ Provisioning policy saved successfully!');
            await this.loadSource(this.tenantId, this.tenantName, this.sourceId);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save provisioning policy: ${error.message}`);
        }
    }

    private async openRule(ruleName: string): Promise<void> {
        // Find the rule by name
        const rule = this.connectorRules.find(r => r.name === ruleName);
        if (rule) {
            // Open the Rule Editor panel
            await vscode.commands.executeCommand(commands.OPEN_RULE_EDITOR, {
                tenantId: this.tenantId,
                tenantName: this.tenantName,
                id: rule.id
            });
        } else {
            vscode.window.showWarningMessage(`Rule "${ruleName}" not found in connector rules`);
        }
    }

    private async saveSourceJson(json: string): Promise<void> {
        try {
            const parsed = JSON.parse(json);
            await this.saveSource(parsed);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Invalid JSON: ${error.message}`);
        }
    }

    private async saveSource(data: any): Promise<void> {
        try {
            const cacheService = LocalCacheService.getInstance();
            await cacheService.updateLocalEntity(
                this.tenantId,
                CacheableEntityType.source,
                this.sourceId,
                data
            );
            
            this.sourceData = data;
            this._updateWebview();
            
            vscode.window.showInformationMessage('💾 Changes saved locally. Click Commit to push to ISC.');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save: ${error.message}`);
        }
    }

    private async commitSource(): Promise<void> {
        const commitService = CommitService.getInstance();
        await commitService.commitEntity(this.tenantId, CacheableEntityType.source, this.sourceId);
        await this.loadSource(this.tenantId, this.tenantName, this.sourceId);
    }

    private async revertSource(): Promise<void> {
        const commitService = CommitService.getInstance();
        const reverted = await commitService.revertEntity(this.tenantId, CacheableEntityType.source, this.sourceId);
        if (reverted) {
            await this.loadSource(this.tenantId, this.tenantName, this.sourceId);
        }
    }

    private async testConnection(): Promise<void> {
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            const result = await client.testSourceConnection(this.sourceId);
            
            this._panel.webview.postMessage({ 
                command: 'testResult', 
                success: result.status === 'SUCCESS',
                message: result.status === 'SUCCESS' ? '✅ Connection successful!' : (result as any).message || 'Connection failed'
            });
        } catch (error: any) {
            this._panel.webview.postMessage({ 
                command: 'testResult', 
                success: false, 
                message: `❌ ${error.message}` 
            });
        }
    }

    private _updateWebview(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const cacheService = LocalCacheService.getInstance();
        const hasLocalChanges = cacheService.hasLocalChanges(this.tenantId, CacheableEntityType.source, this.sourceId);
        const sourceJson = JSON.stringify(this.sourceData || {}, null, 2);
        const tenantInfo = this.tenantService.getTenant(this.tenantId);
        const isReadOnly = tenantInfo?.readOnly ?? false;
        const clustersJson = JSON.stringify(this.clusters || []);
        const schemasJson = JSON.stringify(this.schemas || []);
        const provPoliciesJson = JSON.stringify(this.provisioningPolicies || []);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Source Configuration</title>
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
            --error: #f44336;
            --border: #3a3a3a;
            --radius: 4px;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: var(--bg-0);
            color: var(--fg-1);
            font-size: 13px;
            line-height: 1.5;
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
        }
        
        /* Header */
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 24px;
            height: 56px;
            background: var(--bg-1);
            border-bottom: 1px solid var(--border);
        }
        
        .header-left {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .header-title {
            font-size: 15px;
            font-weight: 600;
            color: var(--fg-0);
        }
        
        .header-meta {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 500;
        }
        
        .badge-info { background: rgba(0, 120, 212, 0.15); color: var(--accent); }
        .badge-warning { background: rgba(255, 152, 0, 0.15); color: var(--warning); }
        .badge-success { background: rgba(76, 175, 80, 0.15); color: var(--success); }
        
        .header-actions { display: flex; gap: 8px; }
        
        /* Buttons */
        .btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 7px 14px;
            font-size: 12px;
            font-weight: 500;
            border: none;
            border-radius: var(--radius);
            cursor: pointer;
            transition: background 0.15s;
        }
        
        .btn-secondary { background: var(--bg-2); color: var(--fg-1); border: 1px solid var(--border); }
        .btn-secondary:hover { background: var(--bg-3); }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover { background: var(--accent-hover); }
        .btn-success { background: var(--success); color: white; }
        .btn-success:hover { background: #5cb85c; }
        .btn:disabled { opacity: 0.5; cursor: not-allowed; }
        
        /* Main content */
        .main { padding: 24px; max-width: 1000px; margin: 0 auto; }
        
        /* Alert banner */
        .alert {
            padding: 12px 16px;
            border-radius: var(--radius);
            margin-bottom: 20px;
            font-size: 13px;
        }
        
        .alert-warning { background: rgba(255, 152, 0, 0.15); color: var(--warning); }
        
        /* Tabs */
        .tabs {
            display: flex;
            gap: 0;
            margin-bottom: 24px;
            border-bottom: 1px solid var(--border);
        }
        
        .tab {
            padding: 12px 20px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--fg-2);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: color 0.15s;
        }
        
        .tab:hover { color: var(--fg-1); }
        .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
        
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        /* Section */
        .section { margin-bottom: 24px; }
        .section-title {
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--fg-2);
            margin-bottom: 12px;
        }
        
        /* Card */
        .card {
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            overflow: hidden;
        }
        
        .card-header {
            padding: 12px 16px;
            background: var(--bg-2);
            border-bottom: 1px solid var(--border);
            font-size: 12px;
            font-weight: 600;
            color: var(--fg-1);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .card-body { padding: 16px; }
        
        /* Form */
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
        @media (max-width: 600px) { .form-row { grid-template-columns: 1fr; } }
        .form-group { margin-bottom: 16px; }
        .form-group:last-child { margin-bottom: 0; }
        
        .form-group label {
            display: block;
            font-size: 11px;
            font-weight: 600;
            color: var(--fg-2);
            text-transform: uppercase;
            letter-spacing: 0.3px;
            margin-bottom: 6px;
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            background: var(--bg-2);
            color: var(--fg-1);
            font-size: 13px;
        }
        
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: var(--accent);
        }
        
        .form-group input:read-only {
            background: var(--bg-0);
            color: var(--fg-2);
        }
        
        /* Search */
        .search-field { position: relative; }
        
        .current-value {
            padding: 8px 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        
        .current-value-name { font-weight: 500; color: var(--fg-0); }
        .current-value-meta { font-size: 11px; color: var(--fg-3); }
        
        .search-input-wrapper { position: relative; }
        
        .search-input-wrapper input {
            width: 100%;
            padding-left: 32px;
        }
        
        .search-input-wrapper .search-icon {
            position: absolute;
            left: 10px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--fg-3);
            pointer-events: none;
        }
        
        .search-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            margin-top: 4px;
            background: var(--bg-1);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            max-height: 240px;
            overflow-y: auto;
            z-index: 100;
            display: none;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        }
        
        .search-dropdown.show { display: block; }
        
        .search-item {
            padding: 10px 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--border);
        }
        
        .search-item:last-child { border-bottom: none; }
        .search-item:hover { background: var(--bg-2); }
        .search-item-name { font-weight: 500; color: var(--fg-0); }
        .search-item-meta { font-size: 11px; color: var(--fg-2); margin-top: 2px; }
        
        /* Feature grid */
        .feature-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
            gap: 8px;
        }
        
        .feature-item {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 10px 12px;
            background: var(--bg-2);
            border-radius: var(--radius);
            font-size: 12px;
        }
        
        .feature-item input { width: auto; margin: 0; }
        
        /* Table */
        .table-container { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
        .table { width: 100%; border-collapse: collapse; }
        .table th { 
            text-align: left; 
            padding: 10px 16px; 
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
        .cell-meta { color: var(--fg-2); font-size: 12px; }
        .cell-action { text-align: right; color: var(--fg-3); }
        
        /* List */
        .list-container { display: flex; flex-direction: column; gap: 1px; background: var(--border); border-radius: var(--radius); overflow: hidden; }
        
        .list-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-1);
            cursor: pointer;
            transition: background 0.1s;
        }
        
        .list-item:hover { background: var(--bg-2); }
        .list-item-name { font-weight: 500; color: var(--fg-0); }
        .list-item-meta { font-size: 12px; color: var(--fg-2); }
        .list-item-arrow { color: var(--fg-3); }
        
        /* Empty state */
        .empty-state {
            text-align: center;
            padding: 40px 24px;
            color: var(--fg-2);
        }
        
        /* JSON Editor */
        .json-editor {
            width: 100%;
            min-height: 400px;
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 12px;
            color: var(--fg-1);
            resize: vertical;
            line-height: 1.5;
            tab-size: 2;
        }
        
        .json-editor:focus {
            outline: none;
            border-color: var(--accent);
        }
        
        /* Test result */
        .test-result {
            padding: 12px 16px;
            border-radius: var(--radius);
            margin-top: 12px;
            display: none;
            font-size: 13px;
        }
        
        .test-result.show { display: block; }
        .test-result.success { background: rgba(76, 175, 80, 0.15); color: var(--success); }
        .test-result.error { background: rgba(244, 67, 54, 0.15); color: var(--error); }
        
        /* Schema/Policy editor */
        .editor-section {
            margin-top: 20px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
        }
        
        .editor-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        
        .editor-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--fg-0);
        }
        
        .selector-tabs {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
            flex-wrap: wrap;
        }
        
        .selector-tab {
            padding: 6px 12px;
            background: var(--bg-2);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            cursor: pointer;
            font-size: 12px;
            color: var(--fg-1);
        }
        
        .selector-tab:hover { background: var(--bg-3); }
        .selector-tab.active {
            background: var(--accent);
            border-color: var(--accent);
            color: white;
        }
    </style>
</head>
<body>
    <!-- Loader Overlay -->
    <div class="loader-overlay" id="loader">
        <div class="loader">
            <div class="loader-spinner"></div>
            <div class="loader-text" id="loaderText">Loading...</div>
        </div>
    </div>

    <header class="header">
        <div class="header-left">
            <span class="header-title">${this._escapeHtml(this.sourceData?.name || 'Loading...')}</span>
            <div class="header-meta">
                <span class="badge badge-info">${this._escapeHtml(this.sourceData?.type || '')}</span>
                ${hasLocalChanges ? '<span class="badge badge-warning">Modified</span>' : ''}
            </div>
        </div>
        <div class="header-actions">
            <button class="btn btn-secondary" onclick="refresh()">Refresh</button>
            <button class="btn btn-secondary" onclick="testConnection()">Test Connection</button>
            ${hasLocalChanges ? `
                <button class="btn btn-secondary" onclick="revert()">Revert</button>
                <button class="btn btn-primary" onclick="commit()" ${isReadOnly ? 'disabled' : ''}>Commit</button>
            ` : ''}
        </div>
    </header>
    
    <main class="main">
        ${isReadOnly ? '<div class="alert alert-warning">This tenant is read-only. Changes cannot be committed.</div>' : ''}
        
        <div class="tabs">
            <button class="tab active" onclick="switchTab('general')">General</button>
            <button class="tab" onclick="switchTab('schemas')">Schemas (${this.schemas.length})</button>
            <button class="tab" onclick="switchTab('provisioning')">Provisioning (${this.provisioningPolicies.length})</button>
        <button class="tab" onclick="switchTab('rules')">Rules</button>
        <button class="tab" onclick="switchTab('json')">JSON Editor</button>
    </div>
    
    <div id="tab-general" class="tab-content active">
        ${this.sourceData ? this._renderGeneralTab() : '<p>Loading...</p>'}
    </div>
    
    <div id="tab-schemas" class="tab-content">
        ${this._renderSchemasTab()}
    </div>
    
    <div id="tab-provisioning" class="tab-content">
        ${this._renderProvisioningTab()}
    </div>
    
    <div id="tab-rules" class="tab-content">
        ${this.sourceData ? this._renderRulesTab() : ''}
    </div>
    
    <div id="tab-json" class="tab-content">
        <div class="card">
            <div class="card-header">
                <span>Source JSON (Editable)</span>
                <button class="btn-primary btn-sm" onclick="saveJson()">💾 Save JSON</button>
            </div>
            <textarea id="jsonEditor" class="json-editor">${this._escapeHtml(sourceJson)}</textarea>
        </div>
    </div>
    
        <div id="testResult" class="test-result"></div>
    </main>
    
    <script>
        const vscode = acquireVsCodeApi();
        let sourceData = ${sourceJson};
        const clusters = ${clustersJson};
        const schemas = ${schemasJson};
        const provPolicies = ${provPoliciesJson};
        let searchDebounce = null;
        let currentSchemaIdx = 0;
        let currentPolicyIdx = 0;
        
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
        
        function switchTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        }
        
        function refresh() { 
            showLoader('Refreshing...');
            vscode.postMessage({ command: 'refresh' }); 
        }
        function testConnection() { 
            showLoader('Testing connection...');
            vscode.postMessage({ command: 'testConnection' }); 
        }
        function commit() { 
            showLoader('Committing changes...');
            vscode.postMessage({ command: 'commit' }); 
        }
        function revert() { 
            showLoader('Reverting...');
            vscode.postMessage({ command: 'revert' }); 
        }
        
        function saveChanges() {
            const updated = { ...sourceData };
            const name = document.getElementById('sourceName');
            if (name) { updated.name = name.value; }
            const desc = document.getElementById('sourceDescription');
            if (desc) { updated.description = desc.value; }
            vscode.postMessage({ command: 'save', data: updated });
        }
        
        function saveJson() {
            const editor = document.getElementById('jsonEditor');
            if (editor) {
                vscode.postMessage({ command: 'saveJson', json: editor.value });
            }
        }
        
        // Identity Search
        function searchIdentity(query) {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                vscode.postMessage({ command: 'searchIdentity', query });
            }, 300);
        }
        
        function selectIdentity(id, name) {
            vscode.postMessage({ 
                command: 'updateOwner', 
                owner: { id, name, type: 'IDENTITY' }
            });
            document.getElementById('ownerDropdown').classList.remove('show');
        }
        
        // Governance Group Search
        function searchGovernanceGroup(query) {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                vscode.postMessage({ command: 'searchGovernanceGroup', query });
            }, 300);
        }
        
        function selectGovernanceGroup(id, name) {
            vscode.postMessage({ 
                command: 'updateGovernanceGroup', 
                group: { id, name }
            });
            document.getElementById('governanceGroupDropdown').classList.remove('show');
        }
        
        // Cluster Selection
        function updateCluster(clusterId) {
            vscode.postMessage({ command: 'updateCluster', clusterId });
        }
        
        // Schema Editor
        function selectSchema(idx) {
            currentSchemaIdx = idx;
            document.querySelectorAll('#schemaSelector .selector-tab').forEach((btn, i) => {
                btn.classList.toggle('active', i === idx);
            });
            const editor = document.getElementById('schemaEditor');
            if (editor && schemas[idx]) {
                editor.value = JSON.stringify(schemas[idx], null, 2);
            }
        }
        
        function saveSchema() {
            const editor = document.getElementById('schemaEditor');
            if (editor && schemas[currentSchemaIdx]) {
                vscode.postMessage({ 
                    command: 'saveSchema', 
                    schemaId: schemas[currentSchemaIdx].id,
                    data: editor.value 
                });
            }
        }
        
        // Provisioning Policy Editor
        function selectPolicy(idx) {
            currentPolicyIdx = idx;
            document.querySelectorAll('#policySelector .selector-tab').forEach((btn, i) => {
                btn.classList.toggle('active', i === idx);
            });
            const editor = document.getElementById('policyEditor');
            if (editor && provPolicies[idx]) {
                editor.value = JSON.stringify(provPolicies[idx], null, 2);
            }
        }
        
        function savePolicy() {
            const editor = document.getElementById('policyEditor');
            if (editor && provPolicies[currentPolicyIdx]) {
                vscode.postMessage({ 
                    command: 'saveProvisioningPolicy', 
                    policyType: provPolicies[currentPolicyIdx].usageType,
                    data: editor.value 
                });
            }
        }
        
        // Open Rule
        function openRule(ruleName) {
            vscode.postMessage({ command: 'openRule', ruleName });
        }
        
        // Handle dropdown visibility
        function showDropdown(id) {
            document.getElementById(id).classList.add('show');
        }
        
        function hideDropdown(id) {
            setTimeout(() => {
                document.getElementById(id).classList.remove('show');
            }, 200);
        }
        
        window.addEventListener('message', event => {
            const msg = event.data;
            hideLoader(); // Hide loader on any message
            switch(msg.command) {
                case 'testResult':
                    const el = document.getElementById('testResult');
                    el.className = 'test-result show ' + (msg.success ? 'success' : 'error');
                    el.textContent = msg.success ? 'Connection successful' : msg.message;
                    break;
                case 'identityResults':
                    const dropdown = document.getElementById('ownerDropdown');
                    if (dropdown) {
                        if (msg.results.length === 0) {
                            dropdown.innerHTML = '<div class="search-item"><div class="search-item-meta">No results found</div></div>';
                        } else {
                            dropdown.innerHTML = msg.results.map(r => 
                                '<div class="search-item" onmousedown="selectIdentity(\\'' + r.id + '\\', \\'' + escapeStr(r.name) + '\\')">' +
                                '<div class="search-item-name">' + escapeHtml(r.displayName) + '</div>' +
                                '<div class="search-item-meta">' + escapeHtml(r.name) + (r.email ? ' • ' + escapeHtml(r.email) : '') + '</div>' +
                                '</div>'
                            ).join('');
                        }
                        dropdown.classList.add('show');
                    }
                    break;
                case 'governanceGroupResults':
                    const ggDropdown = document.getElementById('governanceGroupDropdown');
                    if (ggDropdown) {
                        if (msg.results.length === 0) {
                            ggDropdown.innerHTML = '<div class="search-item"><div class="search-item-meta">No results found</div></div>';
                        } else {
                            ggDropdown.innerHTML = msg.results.map(r => 
                                '<div class="search-item" onmousedown="selectGovernanceGroup(\\'' + r.id + '\\', \\'' + escapeStr(r.name) + '\\')">' +
                                '<div class="search-item-name">' + escapeHtml(r.name) + '</div>' +
                                '<div class="search-item-meta">' + escapeHtml(r.description || 'No description') + '</div>' +
                                '</div>'
                            ).join('');
                        }
                        ggDropdown.classList.add('show');
                    }
                    break;
            }
        });
        
        function escapeHtml(str) {
            if (!str) return '';
            return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        
        function escapeStr(str) {
            if (!str) return '';
            return str.toString().replace(/'/g, "\\\\'").replace(/"/g, '\\\\"');
        }
    </script>
</body>
</html>`;
    }

    private _renderGeneralTab(): string {
        const s = this.sourceData;
        const features = s.features || [];
        const allFeatures = ['AUTHENTICATE', 'COMPOSITE', 'DIRECT_PERMISSIONS', 'DISCOVER_SCHEMA', 
            'ENABLE', 'MANAGER_LOOKUP', 'NO_RANDOM_ACCESS', 'PASSWORD', 'PROVISIONING', 'SYNC_PROVISIONING', 'UNLOCK'];

        const currentClusterId = s.cluster?.id || '';
        const clusterOptions = this.clusters.map((c: any) => 
            `<option value="${c.id}" ${c.id === currentClusterId ? 'selected' : ''}>${this._escapeHtml(c.name)}</option>`
        ).join('');

        return `
            <div class="card">
                <div class="card-header"><span>Basic Information</span></div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" id="sourceName" value="${this._escapeHtml(s.name || '')}" onchange="saveChanges()">
                    </div>
                    <div class="form-group">
                        <label>Type</label>
                        <input type="text" value="${this._escapeHtml(s.type || '')}" disabled>
                    </div>
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="sourceDescription" rows="3" onchange="saveChanges()">${this._escapeHtml(s.description || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Connector</label>
                        <input type="text" value="${this._escapeHtml(s.connectorClass || '')}" disabled>
                    </div>
                    <div class="form-group">
                        <label>Connector ID</label>
                        <input type="text" value="${this._escapeHtml(s.connectorId || '')}" disabled>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header"><span>👤 Owner & Management</span></div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Owner</label>
                        <div class="search-container">
                            ${s.owner ? `
                                <div class="current-value">
                                    <div>
                                        <div class="current-value-name">${this._escapeHtml(s.owner.name || 'Unknown')}</div>
                                        <div class="current-value-id">ID: ${this._escapeHtml(s.owner.id || '')}</div>
                                    </div>
                                </div>
                            ` : '<div class="current-value"><span class="current-value-name">No owner set</span></div>'}
                            <div class="search-input-wrapper">
                                <span class="search-icon">🔍</span>
                                <input type="text" id="ownerSearch" 
                                    placeholder="Search identities to change owner..." 
                                    oninput="searchIdentity(this.value)"
                                    onfocus="showDropdown('ownerDropdown')"
                                    onblur="hideDropdown('ownerDropdown')">
                                <div id="ownerDropdown" class="search-dropdown"></div>
                            </div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Cluster</label>
                        <select id="clusterSelect" onchange="updateCluster(this.value)">
                            <option value="">No cluster selected</option>
                            ${clusterOptions}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Governance Group</label>
                    <div class="search-container">
                        ${s.managementWorkgroup ? `
                            <div class="current-value">
                                <div>
                                    <div class="current-value-name">${this._escapeHtml(s.managementWorkgroup.name || 'Unknown')}</div>
                                    <div class="current-value-id">ID: ${this._escapeHtml(s.managementWorkgroup.id || '')}</div>
                                </div>
                            </div>
                        ` : '<div class="current-value"><span class="current-value-name">No governance group set</span></div>'}
                        <div class="search-input-wrapper">
                            <span class="search-icon">🔍</span>
                            <input type="text" id="governanceGroupSearch" 
                                placeholder="Search governance groups..." 
                                oninput="searchGovernanceGroup(this.value)"
                                onfocus="showDropdown('governanceGroupDropdown')"
                                onblur="hideDropdown('governanceGroupDropdown')">
                            <div id="governanceGroupDropdown" class="search-dropdown"></div>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header"><span>✨ Features</span></div>
                <div class="feature-grid">
                    ${allFeatures.map(f => `
                        <div class="feature-item">
                            <input type="checkbox" ${features.includes(f) ? 'checked' : ''} disabled>
                            <span>${f}</span>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    private _renderSchemasTab(): string {
        if (this.schemas.length === 0) {
            return `
                <div class="card">
                    <div class="card-header"><span>Schemas</span></div>
                    <div class="empty-state">No schemas found</div>
                </div>`;
        }

        const firstSchema = JSON.stringify(this.schemas[0], null, 2);

        return `
            <div class="card">
                <div class="card-header">
                    <span>Schema Editor</span>
                    <button class="btn btn-primary" onclick="saveSchema()">Save Schema</button>
                </div>
                <div class="card-body">
                    <div class="selector-tabs" id="schemaSelector">
                        ${this.schemas.map((s: any, idx: number) => `
                            <button class="selector-tab ${idx === 0 ? 'active' : ''}" onclick="selectSchema(${idx})">
                                ${this._escapeHtml(s.name || 'Schema ' + idx)}
                            </button>
                        `).join('')}
                    </div>
                    <textarea id="schemaEditor" class="json-editor" style="min-height: 350px;">${this._escapeHtml(firstSchema)}</textarea>
                </div>
            </div>`;
    }

    private _renderProvisioningTab(): string {
        if (this.provisioningPolicies.length === 0) {
            return `
                <div class="card">
                    <div class="card-header"><span>Provisioning Policies</span></div>
                    <div class="empty-state">No provisioning policies found</div>
                </div>`;
        }

        const firstPolicy = JSON.stringify(this.provisioningPolicies[0], null, 2);

        return `
            <div class="card">
                <div class="card-header">
                    <span>Provisioning Policy Editor</span>
                    <button class="btn btn-primary" onclick="savePolicy()">Save Policy</button>
                </div>
                <div class="card-body">
                    <div class="selector-tabs" id="policySelector">
                        ${this.provisioningPolicies.map((p: any, idx: number) => `
                            <button class="selector-tab ${idx === 0 ? 'active' : ''}" onclick="selectPolicy(${idx})">
                                ${this._escapeHtml(p.name || p.usageType || 'Policy ' + idx)}
                            </button>
                        `).join('')}
                    </div>
                    <textarea id="policyEditor" class="json-editor" style="min-height: 350px;">${this._escapeHtml(firstPolicy)}</textarea>
                </div>
            </div>`;
    }

    private _renderRulesTab(): string {
        const rules: string[] = [];
        const s = this.sourceData;
        
        if (s.beforeProvisioningRule?.name) { rules.push(s.beforeProvisioningRule.name); }
        if (s.accountCorrelationRule?.name) { rules.push(s.accountCorrelationRule.name); }
        if (s.managerCorrelationRule?.name) { rules.push(s.managerCorrelationRule.name); }
        
        const connAttrs = s.connectorAttributes || {};
        if (connAttrs.connectionParameters && Array.isArray(connAttrs.connectionParameters)) {
            for (const param of connAttrs.connectionParameters) {
                if (param.beforeRule) { rules.push(param.beforeRule); }
                if (param.afterRule) { rules.push(param.afterRule); }
            }
        }
        
        const uniqueRules = [...new Set(rules)];
        
        return `
            <div class="card">
                <div class="card-header"><span>📜 Referenced Rules (${uniqueRules.length})</span></div>
                ${uniqueRules.length === 0 
                    ? '<div class="empty-state">No rules referenced by this source</div>'
                    : `<div class="list-container">
                        ${uniqueRules.map(r => `
                            <div class="list-item" onclick="openRule('${this._escapeHtml(r)}')">
                                <div class="list-item-name">📜 ${this._escapeHtml(r)}</div>
                                <span class="list-item-arrow">Open →</span>
                            </div>
                        `).join('')}
                    </div>`
                }
            </div>`;
    }

    private _escapeHtml(str: string): string {
        if (!str) { return ''; }
        return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    public dispose(): void {
        SourceConfigPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

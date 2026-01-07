import * as vscode from 'vscode';
import { ISCClient } from '../../services/ISCClient';
import { TenantService } from '../../services/TenantService';
import { LocalCacheService, CacheableEntityType } from '../../services/cache/LocalCacheService';
import { CommitService } from '../../services/CommitService';

/**
 * Access Profile Editor Panel - Rich UI for editing access profiles
 */
export class AccessProfileEditorPanel {
    public static currentPanel: AccessProfileEditorPanel | undefined;
    public static readonly viewType = 'accessProfileEditor';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];
    
    private tenantId: string;
    private tenantName: string;
    private accessProfileId: string;
    private accessProfileData: any;
    private sourceData: any;
    private entitlements: any[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        accessProfileId: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (AccessProfileEditorPanel.currentPanel) {
            AccessProfileEditorPanel.currentPanel._panel.reveal(column);
            await AccessProfileEditorPanel.currentPanel.loadAccessProfile(tenantId, tenantName, accessProfileId);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            AccessProfileEditorPanel.viewType,
            'Access Profile Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        AccessProfileEditorPanel.currentPanel = new AccessProfileEditorPanel(panel, extensionUri, tenantService, tenantId, tenantName, accessProfileId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        accessProfileId: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.accessProfileId = accessProfileId;

        this._updateWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this.saveAccessProfile(message.data);
                        break;
                    case 'commit':
                        await this.commitAccessProfile();
                        break;
                    case 'revert':
                        await this.revertAccessProfile();
                        break;
                    case 'refresh':
                        await this.loadAccessProfile(this.tenantId, this.tenantName, this.accessProfileId);
                        break;
                    case 'searchOwner':
                        await this.searchIdentity(message.query, 'owner');
                        break;
                    case 'updateOwner':
                        await this.updateOwner(message.owner);
                        break;
                }
            },
            null,
            this._disposables
        );

        this.loadAccessProfile(tenantId, tenantName, accessProfileId);
    }

    private async loadAccessProfile(tenantId: string, tenantName: string, accessProfileId: string): Promise<void> {
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.accessProfileId = accessProfileId;

        try {
            const client = new ISCClient(tenantId, tenantName);
            
            // Load access profile data
            this.accessProfileData = await client.getResource(`v3/access-profiles/${accessProfileId}`);
            
            // Load source info
            if (this.accessProfileData.source?.id) {
                this.sourceData = await client.getSourceById(this.accessProfileData.source.id);
            }
            
            // Load entitlements
            this.entitlements = this.accessProfileData.entitlements || [];
            
            // Cache the access profile
            const cacheService = LocalCacheService.getInstance();
            await cacheService.cacheEntity(
                tenantId,
                CacheableEntityType.accessProfile,
                accessProfileId,
                this.accessProfileData.name,
                this.accessProfileData
            );

            this._panel.title = `📦 ${this.accessProfileData.name}`;
            this._updateWebview();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load access profile: ${error.message}`);
        }
    }

    private async searchIdentity(query: string, field: string): Promise<void> {
        if (!query || query.length < 2) {
            this._panel.webview.postMessage({ command: 'identityResults', results: [], field });
            return;
        }

        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            const response = await client.paginatedSearchIdentities(
                `name sw "${query}" OR displayName sw "${query}"`,
                10,
                0,
                false
            );
            
            const results = (response.data || []).map((identity: any) => ({
                id: identity.id,
                name: identity.name,
                displayName: identity.displayName || identity.name,
                email: identity.email || ''
            }));
            
            this._panel.webview.postMessage({ command: 'identityResults', results, field });
        } catch (error: any) {
            console.error('Identity search error:', error);
            this._panel.webview.postMessage({ command: 'identityResults', results: [], field });
        }
    }

    private async updateOwner(owner: { id: string; name: string; type: string }): Promise<void> {
        if (!this.accessProfileData) return;
        
        this.accessProfileData.owner = {
            id: owner.id,
            name: owner.name,
            type: owner.type || 'IDENTITY'
        };
        
        await this.saveAccessProfile(this.accessProfileData);
    }

    private async saveAccessProfile(data: any): Promise<void> {
        try {
            const cacheService = LocalCacheService.getInstance();
            await cacheService.updateLocalEntity(
                this.tenantId,
                CacheableEntityType.accessProfile,
                this.accessProfileId,
                data
            );
            
            this.accessProfileData = data;
            this._updateWebview();
            
            vscode.window.showInformationMessage('💾 Changes saved locally. Click Commit to push to ISC.');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save: ${error.message}`);
        }
    }

    private async commitAccessProfile(): Promise<void> {
        const commitService = CommitService.getInstance();
        await commitService.commitEntity(this.tenantId, CacheableEntityType.accessProfile, this.accessProfileId);
        await this.loadAccessProfile(this.tenantId, this.tenantName, this.accessProfileId);
    }

    private async revertAccessProfile(): Promise<void> {
        const commitService = CommitService.getInstance();
        const reverted = await commitService.revertEntity(this.tenantId, CacheableEntityType.accessProfile, this.accessProfileId);
        if (reverted) {
            await this.loadAccessProfile(this.tenantId, this.tenantName, this.accessProfileId);
        }
    }

    private _updateWebview(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const cacheService = LocalCacheService.getInstance();
        const hasLocalChanges = cacheService.hasLocalChanges(this.tenantId, CacheableEntityType.accessProfile, this.accessProfileId);
        const apJson = JSON.stringify(this.accessProfileData || {}, null, 2);
        const tenantInfo = this.tenantService.getTenant(this.tenantId);
        const isReadOnly = tenantInfo?.readOnly ?? false;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Access Profile Editor</title>
    <style>
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --bg-hover: #30363d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
            --text-muted: #484f58;
            --accent-blue: #58a6ff;
            --accent-green: #3fb950;
            --accent-red: #f85149;
            --accent-yellow: #d29922;
            --accent-purple: #a371f7;
            --border-color: #30363d;
        }
        
        * { box-sizing: border-box; margin: 0; padding: 0; }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            background: var(--bg-primary);
            color: var(--text-primary);
            line-height: 1.5;
            padding: 24px;
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .header h1 {
            font-size: 20px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .badge {
            font-size: 12px;
            padding: 4px 10px;
            border-radius: 20px;
            font-weight: 500;
        }
        
        .badge-success { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
        .badge-warning { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }
        .badge-info { background: rgba(88, 166, 255, 0.15); color: var(--accent-blue); }
        
        .btn-group { display: flex; gap: 8px; }
        
        button {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.2s;
        }
        
        button:hover { background: var(--bg-hover); border-color: var(--text-muted); }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .btn-primary { background: var(--accent-blue); border-color: var(--accent-blue); color: white; }
        .btn-primary:hover { background: #4c9aed; }
        
        .tabs {
            display: flex;
            gap: 4px;
            margin-bottom: 20px;
            border-bottom: 1px solid var(--border-color);
        }
        
        .tab {
            padding: 12px 16px;
            background: none;
            border: none;
            border-bottom: 2px solid transparent;
            color: var(--text-secondary);
            font-weight: 500;
            cursor: pointer;
        }
        
        .tab:hover { color: var(--text-primary); }
        .tab.active { color: var(--accent-blue); border-bottom-color: var(--accent-blue); }
        
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        
        .card {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 16px;
        }
        
        .card-header {
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 16px;
            color: var(--text-primary);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-group { margin-bottom: 16px; position: relative; }
        
        .form-group label {
            display: block;
            font-size: 12px;
            font-weight: 500;
            color: var(--text-secondary);
            margin-bottom: 6px;
        }
        
        .form-group input, .form-group select, .form-group textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: 14px;
        }
        
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
            outline: none;
            border-color: var(--accent-blue);
        }
        
        .search-field { position: relative; }
        
        .search-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: var(--bg-tertiary);
            border: 1px solid var(--border-color);
            border-radius: 6px;
            max-height: 200px;
            overflow-y: auto;
            z-index: 100;
            display: none;
        }
        
        .search-dropdown.show { display: block; }
        
        .search-item {
            padding: 10px 12px;
            cursor: pointer;
            border-bottom: 1px solid var(--border-color);
        }
        
        .search-item:last-child { border-bottom: none; }
        .search-item:hover { background: var(--bg-hover); }
        .search-item-name { font-weight: 500; }
        .search-item-meta { font-size: 12px; color: var(--text-secondary); }
        
        .list-container { display: flex; flex-direction: column; gap: 8px; }
        
        .list-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 16px;
            background: var(--bg-tertiary);
            border-radius: 6px;
        }
        
        .list-item-name { font-weight: 500; }
        .list-item-meta { font-size: 12px; color: var(--text-secondary); }
        
        .toggle-switch {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .toggle-switch input[type="checkbox"] {
            width: 40px;
            height: 20px;
        }
        
        .json-view {
            font-family: 'Fira Code', 'Consolas', monospace;
            font-size: 12px;
            background: var(--bg-tertiary);
            border-radius: 6px;
            padding: 16px;
            overflow: auto;
            max-height: 500px;
            white-space: pre-wrap;
        }
        
        .readonly-banner {
            background: rgba(210, 153, 34, 0.15);
            color: var(--accent-yellow);
            padding: 12px 16px;
            border-radius: 6px;
            margin-bottom: 16px;
        }
        
        .empty-state {
            text-align: center;
            padding: 32px;
            color: var(--text-muted);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>
            📦 ${this._escapeHtml(this.accessProfileData?.name || 'Loading...')}
            ${this.accessProfileData?.enabled ? '<span class="badge badge-success">Enabled</span>' : '<span class="badge badge-warning">Disabled</span>'}
            ${hasLocalChanges ? '<span class="badge badge-warning">Modified</span>' : ''}
        </h1>
        <div class="btn-group">
            <button onclick="refresh()">🔄 Refresh</button>
            ${hasLocalChanges ? `
                <button onclick="revert()">↩️ Revert</button>
                <button class="btn-primary" onclick="commit()" ${isReadOnly ? 'disabled' : ''}>📤 Commit</button>
            ` : ''}
        </div>
    </div>
    
    ${isReadOnly ? '<div class="readonly-banner">⚠️ This tenant is read-only</div>' : ''}
    
    <div class="tabs">
        <button class="tab active" onclick="switchTab('general')">General</button>
        <button class="tab" onclick="switchTab('entitlements')">Entitlements (${this.entitlements.length})</button>
        <button class="tab" onclick="switchTab('json')">JSON</button>
    </div>
    
    <div id="tab-general" class="tab-content active">
        ${this.accessProfileData ? this._renderGeneralTab() : '<p>Loading...</p>'}
    </div>
    
    <div id="tab-entitlements" class="tab-content">
        ${this._renderEntitlementsTab()}
    </div>
    
    <div id="tab-json" class="tab-content">
        <div class="card">
            <div class="card-header">📋 Raw JSON</div>
            <div class="json-view">${this._escapeHtml(apJson)}</div>
        </div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        let accessProfileData = ${apJson};
        let searchDebounce = null;
        
        function switchTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        }
        
        function refresh() { vscode.postMessage({ command: 'refresh' }); }
        function commit() { vscode.postMessage({ command: 'commit' }); }
        function revert() { vscode.postMessage({ command: 'revert' }); }
        
        function saveChanges() {
            const updated = { ...accessProfileData };
            const name = document.getElementById('apName');
            if (name) updated.name = name.value;
            const desc = document.getElementById('apDescription');
            if (desc) updated.description = desc.value;
            const enabled = document.getElementById('apEnabled');
            if (enabled) updated.enabled = enabled.checked;
            const requestable = document.getElementById('apRequestable');
            if (requestable) updated.requestable = requestable.checked;
            vscode.postMessage({ command: 'save', data: updated });
        }
        
        function searchOwner(query) {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                vscode.postMessage({ command: 'searchOwner', query });
            }, 300);
        }
        
        function selectOwner(id, name) {
            vscode.postMessage({ 
                command: 'updateOwner', 
                owner: { id, name, type: 'IDENTITY' }
            });
            document.getElementById('ownerDropdown').classList.remove('show');
        }
        
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'identityResults') {
                const dropdown = document.getElementById('ownerDropdown');
                if (dropdown) {
                    dropdown.innerHTML = msg.results.map(r => 
                        '<div class="search-item" onclick="selectOwner(\\''+r.id+'\\', \\''+r.name+'\\')">' +
                        '<div class="search-item-name">' + r.displayName + '</div>' +
                        '<div class="search-item-meta">' + r.name + '</div>' +
                        '</div>'
                    ).join('') || '<div class="search-item">No results</div>';
                    dropdown.classList.add('show');
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _renderGeneralTab(): string {
        const ap = this.accessProfileData;

        return `
            <div class="card">
                <div class="card-header">📝 Basic Information</div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Name</label>
                        <input type="text" id="apName" value="${this._escapeHtml(ap.name || '')}" onchange="saveChanges()">
                    </div>
                    <div class="form-group">
                        <label>Source</label>
                        <input type="text" value="${this._escapeHtml(ap.source?.name || '')}" disabled>
                    </div>
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="apDescription" rows="3" onchange="saveChanges()">${this._escapeHtml(ap.description || '')}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Owner (Search to change)</label>
                        <div class="search-field">
                            <input type="text" value="${this._escapeHtml(ap.owner?.name || '')}" disabled style="margin-bottom: 8px;">
                            <input type="text" id="ownerSearch" 
                                placeholder="Search for identity..." 
                                oninput="searchOwner(this.value)"
                                onfocus="document.getElementById('ownerDropdown').classList.add('show')"
                                onblur="setTimeout(() => document.getElementById('ownerDropdown').classList.remove('show'), 200)">
                            <div id="ownerDropdown" class="search-dropdown"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Request Comments</label>
                        <input type="text" value="${this._escapeHtml(ap.requestCommentsRequired ? 'Required' : 'Not required')}" disabled>
                    </div>
                </div>
            </div>
            
            <div class="card">
                <div class="card-header">⚙️ Settings</div>
                <div class="form-row">
                    <div class="toggle-switch">
                        <input type="checkbox" id="apEnabled" ${ap.enabled ? 'checked' : ''} onchange="saveChanges()">
                        <label for="apEnabled">Enabled</label>
                    </div>
                    <div class="toggle-switch">
                        <input type="checkbox" id="apRequestable" ${ap.requestable ? 'checked' : ''} onchange="saveChanges()">
                        <label for="apRequestable">Requestable</label>
                    </div>
                </div>
            </div>`;
    }

    private _renderEntitlementsTab(): string {
        if (this.entitlements.length === 0) {
            return `
                <div class="card">
                    <div class="card-header">🔐 Entitlements</div>
                    <div class="empty-state">No entitlements assigned</div>
                </div>`;
        }

        return `
            <div class="card">
                <div class="card-header">🔐 Entitlements (${this.entitlements.length})</div>
                <div class="list-container">
                    ${this.entitlements.map((e: any) => `
                        <div class="list-item">
                            <div>
                                <div class="list-item-name">${this._escapeHtml(e.name || e.value || 'Unnamed')}</div>
                                <div class="list-item-meta">${this._escapeHtml(e.type || '')}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>`;
    }

    private _escapeHtml(str: string): string {
        if (!str) return '';
        return str.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    public dispose(): void {
        AccessProfileEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}


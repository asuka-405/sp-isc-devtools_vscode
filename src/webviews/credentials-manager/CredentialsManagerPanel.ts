import * as vscode from 'vscode';
import { TenantService } from '../../services/TenantService';
import { TenantInfo, TenantCredentials } from '../../models/TenantInfo';

export class CredentialsManagerPanel {
    public static currentPanel: CredentialsManagerPanel | undefined;
    public static readonly viewType = 'credentialsManager';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private tenantService: TenantService,
        private context: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (msg) => { await this.handleMessage(msg); }, null, this._disposables);
    }

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        context: vscode.ExtensionContext
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (CredentialsManagerPanel.currentPanel) {
            CredentialsManagerPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            CredentialsManagerPanel.viewType,
            'Credentials Manager',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        CredentialsManagerPanel.currentPanel = new CredentialsManagerPanel(panel, extensionUri, tenantService, context);
    }

    public dispose() {
        CredentialsManagerPanel.currentPanel = undefined;
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) {
                x.dispose();
            }
        }
    }

    private async _update() {
        const webview = this._panel.webview;
        this._panel.webview.html = this._getHtmlForWebview(webview);
        await this.loadCredentials();
    }

    private async loadCredentials() {
        // Load tenant credentials
        const tenants = this.tenantService.getTenants();
        const tenantCredentials: Array<{ tenant: TenantInfo; credentials: TenantCredentials | null; hasAccessToken: boolean }> = [];

        for (const tenant of tenants) {
            const credentials = await this.tenantService.getTenantCredentials(tenant.id);
            const accessToken = await this.tenantService.getTenantAccessToken(tenant.id);
            tenantCredentials.push({
                tenant,
                credentials: credentials || null,
                hasAccessToken: accessToken !== undefined && !accessToken.expired()
            });
        }

        // Load other credentials (like Cursor API tokens) organized by tenant
        const otherCredentials: Record<string, Array<{ key: string; name: string; masked: string }>> = {};
        
        // Get all secrets
        const allSecrets = await this.getAllSecrets();
        
        for (const tenant of tenants) {
            otherCredentials[tenant.id] = [];
            
            // Cursor API token (global, but we can show it per tenant if needed)
            const cursorToken = await this.context.secrets.get('cursor.api.token');
            if (cursorToken) {
                otherCredentials[tenant.id].push({
                    key: 'cursor.api.token',
                    name: 'Cursor API Token',
                    masked: this.maskSecret(cursorToken)
                });
            }
            
            // Add other tenant-specific credentials here in the future
            // Example: const customToken = await this.context.secrets.get(`tenant.${tenant.id}.custom.token`);
        }

        this._panel.webview.postMessage({
            command: 'credentialsLoaded',
            tenantCredentials,
            otherCredentials
        });
    }

    private async getAllSecrets(): Promise<string[]> {
        // VS Code doesn't provide a direct way to list all secrets
        // We'll maintain a list of known credential keys
        const knownKeys: string[] = ['cursor.api.token'];
        return knownKeys;
    }

    private maskSecret(secret: string): string {
        if (!secret || secret.length < 8) {
            return '••••••••';
        }
        return secret.substring(0, 4) + '••••••••' + secret.substring(secret.length - 4);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.loadCredentials();
                break;
            case 'updateTenantCredentials':
                await this.updateTenantCredentials(message.tenantId, message.credentials);
                break;
            case 'deleteTenantCredentials':
                await this.deleteTenantCredentials(message.tenantId);
                break;
            case 'updateOtherCredential':
                await this.updateOtherCredential(message.tenantId, message.key, message.value);
                break;
            case 'deleteOtherCredential':
                await this.deleteOtherCredential(message.key);
                break;
            case 'revealCredential':
                await this.revealCredential(message.key, message.tenantId);
                break;
        }
    }

    private async updateTenantCredentials(tenantId: string, credentials: TenantCredentials): Promise<void> {
        try {
            await this.tenantService.setTenantCredentials(tenantId, credentials);
            vscode.window.showInformationMessage('Tenant credentials updated successfully');
            await this.loadCredentials();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to update credentials: ${error.message}`);
        }
    }

    private async deleteTenantCredentials(tenantId: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to delete these credentials?',
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm === 'Delete') {
            try {
                await this.tenantService.removeTenantCredentials(tenantId);
                vscode.window.showInformationMessage('Tenant credentials deleted');
                await this.loadCredentials();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to delete credentials: ${error.message}`);
            }
        }
    }

    private async updateOtherCredential(tenantId: string, key: string, value: string): Promise<void> {
        try {
            await this.context.secrets.store(key, value);
            vscode.window.showInformationMessage('Credential updated successfully');
            await this.loadCredentials();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to update credential: ${error.message}`);
        }
    }

    private async deleteOtherCredential(key: string): Promise<void> {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to delete this credential?',
            { modal: true },
            'Delete',
            'Cancel'
        );

        if (confirm === 'Delete') {
            try {
                await this.context.secrets.delete(key);
                vscode.window.showInformationMessage('Credential deleted');
                await this.loadCredentials();
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to delete credential: ${error.message}`);
            }
        }
    }

    private async revealCredential(key: string, tenantId?: string): Promise<void> {
        let value: string | undefined;
        
        if (tenantId) {
            // For tenant credentials, get from TenantService
            const credentials = await this.tenantService.getTenantCredentials(tenantId);
            if (key === 'clientId') {
                value = credentials?.clientId;
            } else if (key === 'clientSecret') {
                value = credentials?.clientSecret;
            }
        } else {
            // For other credentials, get from secrets
            value = await this.context.secrets.get(key);
        }

        if (value) {
            const action = await vscode.window.showInformationMessage(
                `Credential value: ${value}`,
                'Copy to Clipboard'
            );
            if (action === 'Copy to Clipboard') {
                await vscode.env.clipboard.writeText(value);
                vscode.window.showInformationMessage('Credential copied to clipboard');
            }
        } else {
            vscode.window.showWarningMessage('Credential not found');
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Credentials Manager</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 20px;
        }
        .header {
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
        }
        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        .section {
            margin-bottom: 32px;
        }
        .section-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 16px;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tenant-group {
            margin-bottom: 24px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        .tenant-header {
            padding: 12px 16px;
            background: var(--vscode-list-hoverBackground);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .tenant-name {
            font-size: 16px;
        }
        .tenant-url {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            font-weight: normal;
        }
        .credentials-content {
            padding: 16px;
        }
        .credential-item {
            padding: 12px;
            margin-bottom: 12px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .credential-info {
            flex: 1;
        }
        .credential-label {
            font-weight: 600;
            margin-bottom: 4px;
        }
        .credential-value {
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            word-break: break-all;
        }
        .credential-actions {
            display: flex;
            gap: 8px;
        }
        .btn {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: background 0.2s;
        }
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .btn-danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-errorForeground);
        }
        .btn-danger:hover {
            opacity: 0.8;
        }
        .status-badge {
            display: inline-block;
            padding: 2px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            margin-left: 8px;
        }
        .status-success {
            background: var(--vscode-testing-iconPassed);
            color: var(--vscode-foreground);
        }
        .status-warning {
            background: var(--vscode-testing-iconQueued);
            color: var(--vscode-foreground);
        }
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
        }
        .refresh-btn {
            position: absolute;
            top: 20px;
            right: 20px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Credentials Manager</h1>
        <p>Manage tenant credentials and other API tokens</p>
    </div>
    
    <button class="btn btn-secondary refresh-btn" onclick="refresh()">🔄 Refresh</button>
    
    <div class="section">
        <h2 class="section-title">Tenant Credentials</h2>
        <div id="tenantCredentials"></div>
    </div>
    
    <div class="section">
        <h2 class="section-title">Other Credentials</h2>
        <div id="otherCredentials"></div>
    </div>
    
    <script>
        const vscode = acquireVsCodeApi();
        
        let tenantCredentials = [];
        let otherCredentials = {};
        
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'credentialsLoaded':
                    tenantCredentials = msg.tenantCredentials || [];
                    otherCredentials = msg.otherCredentials || {};
                    render();
                    break;
            }
        });
        
        function render() {
            renderTenantCredentials();
            renderOtherCredentials();
        }
        
        function renderTenantCredentials() {
            const container = document.getElementById('tenantCredentials');
            if (tenantCredentials.length === 0) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔐</div><p>No tenant credentials configured</p></div>';
                return;
            }
            
            container.innerHTML = tenantCredentials.map(tc => {
                const tenant = tc.tenant;
                const creds = tc.credentials;
                const hasToken = tc.hasAccessToken;
                
                return \`
                    <div class="tenant-group">
                        <div class="tenant-header">
                            <div>
                                <span class="tenant-name">\${escapeHtml(tenant.tenantName || tenant.name)}</span>
                                <span class="tenant-url">\${escapeHtml(tenant.name)}.identitynow.com</span>
                            </div>
                            <span class="status-badge \${hasToken ? 'status-success' : 'status-warning'}">
                                \${hasToken ? '✓ Authenticated' : '⚠ Not Authenticated'}
                            </span>
                        </div>
                        <div class="credentials-content">
                            \${creds ? \`
                                <div class="credential-item">
                                    <div class="credential-info">
                                        <div class="credential-label">Client ID</div>
                                        <div class="credential-value">\${escapeHtml(maskSecret(creds.clientId))}</div>
                                    </div>
                                    <div class="credential-actions">
                                        <button class="btn btn-secondary" onclick="revealCredential('\${tenant.id}', 'clientId')">Reveal</button>
                                        <button class="btn btn-primary" onclick="editTenantCredential('\${tenant.id}', 'clientId', '\${escapeHtml(creds.clientId)}')">Edit</button>
                                    </div>
                                </div>
                                <div class="credential-item">
                                    <div class="credential-info">
                                        <div class="credential-label">Client Secret</div>
                                        <div class="credential-value">\${escapeHtml(maskSecret(creds.clientSecret))}</div>
                                    </div>
                                    <div class="credential-actions">
                                        <button class="btn btn-secondary" onclick="revealCredential('\${tenant.id}', 'clientSecret')">Reveal</button>
                                        <button class="btn btn-primary" onclick="editTenantCredential('\${tenant.id}', 'clientSecret', '\${escapeHtml(creds.clientSecret)}')">Edit</button>
                                    </div>
                                </div>
                                <div style="margin-top: 12px;">
                                    <button class="btn btn-danger" onclick="deleteTenantCredentials('\${tenant.id}')">Delete Credentials</button>
                                </div>
                            \` : \`
                                <div class="empty-state">
                                    <p>No credentials configured for this tenant</p>
                                    <button class="btn btn-primary" onclick="addTenantCredentials('\${tenant.id}')" style="margin-top: 12px;">Add Credentials</button>
                                </div>
                            \`}
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        function renderOtherCredentials() {
            const container = document.getElementById('otherCredentials');
            const tenantIds = Object.keys(otherCredentials);
            
            if (tenantIds.length === 0 || tenantIds.every(id => otherCredentials[id].length === 0)) {
                container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🔑</div><p>No other credentials configured</p></div>';
                return;
            }
            
            container.innerHTML = tenantIds.map(tenantId => {
                const creds = otherCredentials[tenantId];
                if (creds.length === 0) return '';
                
                const tenant = tenantCredentials.find(tc => tc.tenant.id === tenantId)?.tenant;
                const tenantName = tenant ? (tenant.tenantName || tenant.name) : 'Unknown';
                
                return \`
                    <div class="tenant-group">
                        <div class="tenant-header">
                            <span class="tenant-name">\${escapeHtml(tenantName)}</span>
                        </div>
                        <div class="credentials-content">
                            \${creds.map(cred => \`
                                <div class="credential-item">
                                    <div class="credential-info">
                                        <div class="credential-label">\${escapeHtml(cred.name)}</div>
                                        <div class="credential-value">\${escapeHtml(cred.masked)}</div>
                                    </div>
                                    <div class="credential-actions">
                                        <button class="btn btn-secondary" onclick="revealOtherCredential('\${escapeHtml(cred.key)}', '\${tenantId}')">Reveal</button>
                                        <button class="btn btn-primary" onclick="editOtherCredential('\${escapeHtml(cred.key)}', '\${tenantId}')">Edit</button>
                                        <button class="btn btn-danger" onclick="deleteOtherCredential('\${escapeHtml(cred.key)}')">Delete</button>
                                    </div>
                                </div>
                            \`).join('')}
                        </div>
                    </div>
                \`;
            }).join('');
        }
        
        function refresh() {
            vscode.postMessage({ command: 'refresh' });
        }
        
        function maskSecret(secret) {
            if (!secret || secret.length < 8) return '••••••••';
            return secret.substring(0, 4) + '••••••••' + secret.substring(secret.length - 4);
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        function editTenantCredential(tenantId, field, currentValue) {
            const label = field === 'clientId' ? 'Client ID' : 'Client Secret';
            const newValue = prompt(\`Enter new \${label}:\`, currentValue);
            if (newValue !== null && newValue !== currentValue) {
                const tenant = tenantCredentials.find(tc => tc.tenant.id === tenantId);
                const creds = tenant?.credentials || { clientId: '', clientSecret: '' };
                creds[field] = newValue;
                vscode.postMessage({
                    command: 'updateTenantCredentials',
                    tenantId,
                    credentials: creds
                });
            }
        }
        
        function addTenantCredentials(tenantId) {
            const clientId = prompt('Enter Client ID:');
            if (!clientId) return;
            const clientSecret = prompt('Enter Client Secret:');
            if (!clientSecret) return;
            
            vscode.postMessage({
                command: 'updateTenantCredentials',
                tenantId,
                credentials: { clientId, clientSecret }
            });
        }
        
        function deleteTenantCredentials(tenantId) {
            vscode.postMessage({ command: 'deleteTenantCredentials', tenantId });
        }
        
        function revealCredential(tenantId, field) {
            vscode.postMessage({ command: 'revealCredential', key: field, tenantId });
        }
        
        function editOtherCredential(key, tenantId) {
            const name = key === 'cursor.api.token' ? 'Cursor API Token' : key;
            const currentValue = prompt(\`Enter new \${name}:\`);
            if (currentValue !== null) {
                vscode.postMessage({
                    command: 'updateOtherCredential',
                    tenantId,
                    key,
                    value: currentValue
                });
            }
        }
        
        function deleteOtherCredential(key) {
            vscode.postMessage({ command: 'deleteOtherCredential', key });
        }
        
        function revealOtherCredential(key, tenantId) {
            vscode.postMessage({ command: 'revealCredential', key, tenantId });
        }
        
        // Request initial data
        vscode.postMessage({ command: 'refresh' });
    </script>
</body>
</html>`;
    }
}


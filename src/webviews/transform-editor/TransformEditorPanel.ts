import * as vscode from 'vscode';
import { ISCClient } from '../../services/ISCClient';
import { TenantService } from '../../services/TenantService';
import { LocalCacheService, CacheableEntityType } from '../../services/cache/LocalCacheService';
import { CommitService } from '../../services/CommitService';
import { SearchService } from '../../services/SearchService';

const TRANSFORM_TYPES: Record<string, { label: string; hasInput: boolean }> = {
    accountAttribute: { label: 'Account Attribute', hasInput: false },
    base64Decode: { label: 'Base64 Decode', hasInput: true },
    base64Encode: { label: 'Base64 Encode', hasInput: true },
    concat: { label: 'Concatenate', hasInput: false },
    conditional: { label: 'Conditional', hasInput: true },
    dateCompare: { label: 'Date Compare', hasInput: true },
    dateFormat: { label: 'Date Format', hasInput: true },
    dateMath: { label: 'Date Math', hasInput: true },
    firstValid: { label: 'First Valid', hasInput: false },
    identityAttribute: { label: 'Identity Attribute', hasInput: false },
    indexOf: { label: 'Index Of', hasInput: true },
    lookup: { label: 'Lookup', hasInput: true },
    lower: { label: 'Lowercase', hasInput: true },
    normalizeNames: { label: 'Normalize Names', hasInput: true },
    reference: { label: 'Reference', hasInput: true },
    replaceAll: { label: 'Replace All', hasInput: true },
    replace: { label: 'Replace', hasInput: true },
    split: { label: 'Split', hasInput: true },
    static: { label: 'Static', hasInput: false },
    substring: { label: 'Substring', hasInput: true },
    trim: { label: 'Trim', hasInput: true },
    upper: { label: 'Uppercase', hasInput: true },
    uuid: { label: 'UUID', hasInput: false },
};

/**
 * Transform Visual Editor Panel
 */
export class TransformEditorPanel {
    public static currentPanel: TransformEditorPanel | undefined;
    public static readonly viewType = 'transformEditorPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private tenantId: string;
    private tenantName: string;
    private transformId: string;
    private transformData: any;
    private allTransforms: any[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        transformId: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (TransformEditorPanel.currentPanel) {
            TransformEditorPanel.currentPanel._panel.reveal(column);
            await TransformEditorPanel.currentPanel.loadTransform(tenantId, tenantName, transformId);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            TransformEditorPanel.viewType,
            'Transform Editor',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'resources')]
            }
        );

        TransformEditorPanel.currentPanel = new TransformEditorPanel(panel, extensionUri, tenantService, tenantId, tenantName, transformId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private readonly tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        transformId: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.transformId = transformId;

        this._updateWebview();

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'save':
                        await this.saveTransform(message.data);
                        break;
                    case 'commit':
                        await this.commitTransform();
                        break;
                    case 'revert':
                        await this.revertTransform();
                        break;
                    case 'test':
                        await this.testTransform(message.input);
                        break;
                    case 'findUsages':
                        await this.findUsages();
                        break;
                    case 'refresh':
                        await this.loadTransform(this.tenantId, this.tenantName, this.transformId);
                        break;
                }
            },
            null,
            this._disposables
        );

        this.loadTransform(tenantId, tenantName, transformId);
    }

    private async loadTransform(tenantId: string, tenantName: string, transformId: string): Promise<void> {
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.transformId = transformId;

        try {
            const client = new ISCClient(tenantId, tenantName);
            
            const [transform, transforms] = await Promise.all([
                client.getResource(`v3/transforms/${transformId}`),
                client.getTransforms()
            ]);
            
            this.transformData = transform;
            this.allTransforms = transforms;

            const cacheService = LocalCacheService.getInstance();
            await cacheService.cacheEntity(
                tenantId,
                CacheableEntityType.transform,
                transformId,
                this.transformData.name,
                this.transformData
            );

            this._panel.title = `🔄 ${this.transformData.name}`;
            this._updateWebview();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load transform: ${error.message}`);
        }
    }

    private async saveTransform(data: any): Promise<void> {
        try {
            const cacheService = LocalCacheService.getInstance();
            await cacheService.updateLocalEntity(
                this.tenantId,
                CacheableEntityType.transform,
                this.transformId,
                data
            );

            this.transformData = data;
            this._updateWebview();

            vscode.window.showInformationMessage('💾 Changes saved locally. Click Commit to push to ISC.');
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save: ${error.message}`);
        }
    }

    private async commitTransform(): Promise<void> {
        const commitService = CommitService.getInstance();
        await commitService.commitEntity(this.tenantId, CacheableEntityType.transform, this.transformId);
        await this.loadTransform(this.tenantId, this.tenantName, this.transformId);
    }

    private async revertTransform(): Promise<void> {
        const commitService = CommitService.getInstance();
        const reverted = await commitService.revertEntity(this.tenantId, CacheableEntityType.transform, this.transformId);
        if (reverted) {
            await this.loadTransform(this.tenantId, this.tenantName, this.transformId);
        }
    }

    private async testTransform(input: any): Promise<void> {
        try {
            // For now, show a message - real transform testing requires the ISC API
            this._panel.webview.postMessage({
                command: 'testResult',
                success: true,
                result: `Transform "${this.transformData.name}" - Testing requires an identity context.`
            });
        } catch (error: any) {
            this._panel.webview.postMessage({
                command: 'testResult',
                success: false,
                error: error.message
            });
        }
    }

    private async findUsages(): Promise<void> {
        try {
            const searchService = SearchService.getInstance();
            const usages = await searchService.findTransformUsage(this.tenantId, this.transformData.name);

            this._panel.webview.postMessage({
                command: 'usagesResult',
                usages
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to find usages: ${error.message}`);
        }
    }

    private _updateWebview(): void {
        this._panel.webview.html = this._getHtmlForWebview();
    }

    /**
     * Sanitize JSON string for safe injection into script tags
     */
    private _sanitizeJsonForScript(json: string): string {
        return json
            .replace(/<\/script/gi, '<\\/script')
            .replace(/<\/\//g, '<\\/\\/');
    }

    private _getHtmlForWebview(): string {
        const cacheService = LocalCacheService.getInstance();
        const hasLocalChanges = cacheService.hasLocalChanges(this.tenantId, CacheableEntityType.transform, this.transformId);
        const transformJson = this._sanitizeJsonForScript(JSON.stringify(this.transformData || {}, null, 2));
        const transformTypesJson = this._sanitizeJsonForScript(JSON.stringify(TRANSFORM_TYPES));
        const allTransformsJson = this._sanitizeJsonForScript(JSON.stringify(this.allTransforms.map(t => ({ id: t.id, name: t.name, type: t.type }))));
        const tenantInfo = this.tenantService.getTenant(this.tenantId);
        const isReadOnly = tenantInfo?.readOnly ?? false;

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Transform Editor</title>
    <style>
        :root {
            --bg-primary: #0d1117;
            --bg-secondary: #161b22;
            --bg-tertiary: #21262d;
            --text-primary: #c9d1d9;
            --text-secondary: #8b949e;
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
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .badge {
            font-size: 12px;
            padding: 4px 10px;
            border-radius: 20px;
            background: rgba(163, 113, 247, 0.15);
            color: var(--accent-purple);
        }
        
        .badge-warning { background: rgba(210, 153, 34, 0.15); color: var(--accent-yellow); }
        
        .btn-group { display: flex; gap: 8px; }
        
        button {
            padding: 8px 16px;
            border: 1px solid var(--border-color);
            border-radius: 6px;
            background: var(--bg-tertiary);
            color: var(--text-primary);
            font-size: 14px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 6px;
        }
        
        button:hover { background: var(--bg-secondary); }
        .btn-primary { background: var(--accent-blue); border-color: var(--accent-blue); color: white; }
        .btn-success { background: var(--accent-green); border-color: var(--accent-green); color: white; }
        
        .main-layout {
            display: grid;
            grid-template-columns: 1fr 350px;
            gap: 24px;
        }
        
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
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .form-group { margin-bottom: 16px; }
        
        .form-group label {
            display: block;
            font-size: 12px;
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
        
        .form-group textarea {
            font-family: 'Fira Code', monospace;
            min-height: 100px;
        }
        
        .json-view {
            font-family: 'Fira Code', monospace;
            font-size: 12px;
            background: var(--bg-tertiary);
            border-radius: 6px;
            padding: 16px;
            overflow: auto;
            max-height: 400px;
            white-space: pre-wrap;
        }
        
        .sidebar-card { margin-bottom: 16px; }
        
        .test-input {
            width: 100%;
            min-height: 80px;
            font-family: 'Fira Code', monospace;
        }
        
        .test-result {
            margin-top: 12px;
            padding: 12px;
            border-radius: 6px;
            font-size: 13px;
            display: none;
        }
        
        .test-result.show { display: block; }
        .test-result.success { background: rgba(63, 185, 80, 0.15); color: var(--accent-green); }
        .test-result.error { background: rgba(248, 81, 73, 0.15); color: var(--accent-red); }
        
        .usage-item {
            padding: 8px 12px;
            background: var(--bg-tertiary);
            border-radius: 6px;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .usage-item strong { color: var(--accent-purple); }
        
        .nested-transform {
            margin-top: 12px;
            padding-left: 16px;
            border-left: 2px solid var(--accent-blue);
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>
            🔄 ${this.transformData?.name || 'Loading...'}
            <span class="badge">${this.transformData?.type || ''}</span>
            ${hasLocalChanges ? '<span class="badge badge-warning">Modified</span>' : ''}
        </h1>
        <div class="btn-group">
            <button onclick="refresh()">🔄 Refresh</button>
            <button onclick="findUsages()">🔍 Find Usages</button>
            ${hasLocalChanges ? `
                <button onclick="revert()">↩️ Revert</button>
                <button class="btn-primary" onclick="commit()" ${isReadOnly ? 'disabled' : ''}>📤 Commit</button>
            ` : ''}
        </div>
    </div>

    <div class="main-layout">
        <div class="editor-section">
            <div class="card">
                <div class="card-header">✏️ Transform Configuration</div>
                ${this._renderTransformEditor()}
            </div>
            
            <div class="card">
                <div class="card-header">📋 JSON View</div>
                <div class="json-view">${this._escapeHtml(transformJson)}</div>
            </div>
        </div>

        <div class="sidebar">
            <div class="card sidebar-card">
                <div class="card-header">⚡ Test Transform</div>
                <div class="form-group">
                    <label>Test Input (JSON)</label>
                    <textarea id="testInput" class="test-input" placeholder='{"value": "test"}'></textarea>
                </div>
                <button class="btn-success" onclick="testTransform()">▶️ Run Test</button>
                <div id="testResult" class="test-result"></div>
            </div>

            <div class="card sidebar-card">
                <div class="card-header">📋 References</div>
                <div id="usagesList">
                    <p style="color: var(--text-secondary); font-size: 13px;">
                        Click "Find Usages" to see where this transform is used in identity profiles.
                    </p>
                </div>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let transformData = ${transformJson};
        const transformTypes = ${transformTypesJson};
        const allTransforms = ${allTransformsJson};

        function refresh() { vscode.postMessage({ command: 'refresh' }); }
        function commit() { vscode.postMessage({ command: 'commit' }); }
        function revert() { vscode.postMessage({ command: 'revert' }); }
        function findUsages() { vscode.postMessage({ command: 'findUsages' }); }
        
        function testTransform() {
            const input = document.getElementById('testInput').value;
            let inputObj = {};
            try { inputObj = JSON.parse(input); } catch (e) { inputObj = { value: input }; }
            vscode.postMessage({ command: 'test', input: inputObj });
        }
        
        function saveChanges() {
            vscode.postMessage({ command: 'save', data: transformData });
        }
        
        function updateAttribute(path, value) {
            const parts = path.split('.');
            let obj = transformData;
            for (let i = 0; i < parts.length - 1; i++) {
                if (!obj.hasOwnProperty(parts[i]) || typeof obj[parts[i]] !== 'object' || obj[parts[i]] === null) {
                    obj[parts[i]] = {};
                }
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
            saveChanges();
        }
        
        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'testResult') {
                const el = document.getElementById('testResult');
                el.className = 'test-result show ' + (msg.success ? 'success' : 'error');
                el.textContent = msg.success ? msg.result : msg.error;
            }
            if (msg.command === 'usagesResult') {
                const el = document.getElementById('usagesList');
                if (msg.usages.length === 0) {
                    el.innerHTML = '<p style="color: var(--text-secondary);">No usages found.</p>';
                } else {
                    el.innerHTML = msg.usages.map(u => 
                        '<div class="usage-item"><strong>' + u.profileName + '</strong><br>Attribute: ' + u.attributeName + '</div>'
                    ).join('');
                }
            }
        });
    </script>
</body>
</html>`;
    }

    private _renderTransformEditor(): string {
        const t = this.transformData;
        if (!t) { return '<p>Loading...</p>'; }

        const attrs = t.attributes || {};

        return `
            <div class="form-group">
                <label>Type</label>
                <select onchange="updateAttribute('type', this.value)">
                    ${Object.entries(TRANSFORM_TYPES).map(([type, config]) =>
                        `<option value="${type}" ${t.type === type ? 'selected' : ''}>${config.label}</option>`
                    ).join('')}
                </select>
            </div>
            ${this._renderAttributesByType(t.type, attrs)}
        `;
    }

    private _renderAttributesByType(type: string, attrs: any): string {
        switch (type) {
            case 'static':
                return this._renderField('Value', 'attributes.value', attrs.value || '');
            case 'accountAttribute':
                return `
                    ${this._renderField('Source Name', 'attributes.sourceName', attrs.sourceName || '')}
                    ${this._renderField('Attribute Name', 'attributes.attributeName', attrs.attributeName || '')}
                `;
            case 'identityAttribute':
                return this._renderField('Attribute Name', 'attributes.name', attrs.name || '');
            case 'reference':
                return `
                    <div class="form-group">
                        <label>Referenced Transform</label>
                        <select onchange="updateAttribute('attributes.id', this.value)">
                            <option value="">-- Select Transform --</option>
                            ${this.allTransforms
                                .filter(tr => tr.id !== this.transformId)
                                .map(tr => `<option value="${tr.name}" ${attrs.id === tr.name ? 'selected' : ''}>${tr.name} (${tr.type})</option>`)
                                .join('')}
                        </select>
                    </div>
                `;
            case 'conditional':
                return `
                    ${this._renderField('Expression', 'attributes.expression', attrs.expression || '')}
                    ${this._renderField('Positive Condition', 'attributes.positiveCondition', attrs.positiveCondition || '')}
                    ${this._renderField('Negative Condition', 'attributes.negativeCondition', attrs.negativeCondition || '')}
                `;
            case 'lookup':
                return this._renderField('Table (JSON)', 'attributes.table', JSON.stringify(attrs.table || {}), true);
            case 'substring':
                return `
                    ${this._renderField('Begin Index', 'attributes.begin', attrs.begin || '0')}
                    ${this._renderField('End Index', 'attributes.end', attrs.end || '')}
                `;
            case 'replace':
            case 'replaceAll':
                return `
                    ${this._renderField('Regex Pattern', 'attributes.regex', attrs.regex || '')}
                    ${this._renderField('Replacement', 'attributes.replacement', attrs.replacement || '')}
                `;
            case 'dateFormat':
                return `
                    ${this._renderField('Input Format', 'attributes.inputFormat', attrs.inputFormat || '')}
                    ${this._renderField('Output Format', 'attributes.outputFormat', attrs.outputFormat || '')}
                `;
            default:
                return `<p style="color: var(--text-secondary);">Configure this transform via JSON.</p>`;
        }
    }

    private _renderField(label: string, path: string, value: string, isTextarea: boolean = false): string {
        if (isTextarea) {
            return `
                <div class="form-group">
                    <label>${label}</label>
                    <textarea onchange="updateAttribute('${path}', this.value)">${this._escapeHtml(value)}</textarea>
                </div>
            `;
        }
        return `
            <div class="form-group">
                <label>${label}</label>
                <input type="text" value="${this._escapeHtml(value)}" onchange="updateAttribute('${path}', this.value)">
            </div>
        `;
    }

    private _escapeHtml(str: string): string {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    public dispose(): void {
        TransformEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            this._disposables.pop()?.dispose();
        }
    }
}

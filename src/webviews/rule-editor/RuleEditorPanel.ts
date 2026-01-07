import * as vscode from 'vscode';
import { TenantService } from '../../services/TenantService';
import { ISCClient } from '../../services/ISCClient';
import { BeanShellService, RuleTypeDefinition, TestResult } from '../../services/beanshell/BeanShellService';

/**
 * Rule Editor Panel - BeanShell rule development with Monaco Editor
 */
export class RuleEditorPanel {
    public static currentPanel: RuleEditorPanel | undefined;
    public static readonly viewType = 'ruleEditorPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private tenantId: string;
    private tenantName: string;
    private ruleId: string | null;
    private ruleData: any;
    private ruleTypes: RuleTypeDefinition[];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        ruleId?: string,
        initialRuleType?: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (RuleEditorPanel.currentPanel) {
            RuleEditorPanel.currentPanel._panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            RuleEditorPanel.viewType,
            ruleId ? 'Edit Rule' : 'New Rule',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        RuleEditorPanel.currentPanel = new RuleEditorPanel(
            panel, extensionUri, tenantService, tenantId, tenantName, ruleId || null, initialRuleType
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        ruleId: string | null,
        initialRuleType?: string
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.ruleId = ruleId;
        this.ruleData = null;

        try {
            this.ruleTypes = BeanShellService.getInstance().getRuleTypes();
        } catch {
            this.ruleTypes = [];
        }

        this._update(initialRuleType);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (msg) => { await this.handleMessage(msg); }, null, this._disposables);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'loadRule': await this.loadRule(); break;
            case 'saveRule': await this.saveRule(message.data); break;
            case 'testRule': await this.testRule(message.script, message.ruleType, message.testData); break;
            case 'validateSyntax': this.validateSyntax(message.script); break;
            case 'uploadRule': await this.saveRule(message.data); break;
            case 'validateCloud': await this.validateOnCloud(message.script); break;
            case 'getRuleTypeInfo': this.sendRuleTypeInfo(message.ruleType); break;
        }
    }

    private async loadRule(): Promise<void> {
        if (!this.ruleId) return;
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            this.ruleData = await client.getConnectorRuleById(this.ruleId);
            this._panel.webview.postMessage({ command: 'ruleLoaded', data: this.ruleData });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load rule: ${error.message}`);
        }
    }

    private async saveRule(data: any): Promise<void> {
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            if (this.ruleId) {
                await client.updateConnectorRule({ id: this.ruleId, ...data });
                vscode.window.showInformationMessage('Rule saved successfully');
            } else {
                const result = await client.createResource('/beta/connector-rules', JSON.stringify(data));
                this.ruleId = result.id;
                vscode.window.showInformationMessage('Rule created successfully');
            }
            this._panel.webview.postMessage({ command: 'saveDone', success: true });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save rule: ${error.message}`);
            this._panel.webview.postMessage({ command: 'saveDone', success: false, error: error.message });
        }
    }

    private async testRule(script: string, ruleType: string, testData: any): Promise<void> {
        try {
            const bshService = BeanShellService.getInstance();
            const result = await bshService.executeScript(script, ruleType, testData);
            this._panel.webview.postMessage({ command: 'testResults', data: result });
        } catch (error: any) {
            this._panel.webview.postMessage({
                command: 'testResults',
                data: { success: false, output: null, consoleOutput: [], errors: [error.message], executionTime: 0, warnings: [] }
            });
        }
    }

    private validateSyntax(script: string): void {
        try {
            const result = BeanShellService.getInstance().validateSyntax(script);
            this._panel.webview.postMessage({ command: 'syntaxValidation', data: result });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'syntaxValidation', data: { valid: false, errors: [error.message] } });
        }
    }

    private async validateOnCloud(script: string): Promise<void> {
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            const result = await client.validateConnectorRule(script);
            this._panel.webview.postMessage({
                command: 'cloudValidation',
                data: { valid: result.state === 'OK', message: result.state === 'OK' ? 'Valid' : (result as any).details || 'Failed' }
            });
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'cloudValidation', data: { valid: false, message: error.message } });
        }
    }

    private sendRuleTypeInfo(ruleType: string): void {
        try {
            const bshService = BeanShellService.getInstance();
            const typeInfo = bshService.getRuleType(ruleType);
            const completions = bshService.getCompletions(ruleType);
            this._panel.webview.postMessage({ command: 'ruleTypeInfo', data: { typeInfo, completions } });
        } catch {}
    }

    private async _update(initialRuleType?: string): Promise<void> {
        if (this.ruleId) await this.loadRule();
        let envStatus = { java: false, rdk: false, beanshell: false };
        try { envStatus = BeanShellService.getInstance().getEnvironmentStatus(); } catch {}
        this._panel.webview.html = this._getHtmlForWebview(envStatus, initialRuleType);
    }

    private _getHtmlForWebview(envStatus: { java: boolean; rdk: boolean; beanshell: boolean }, initialRuleType?: string): string {
        const ruleTypesJson = JSON.stringify(this.ruleTypes);
        const ruleDataJson = this.ruleData ? JSON.stringify(this.ruleData) : 'null';
        const initialType = initialRuleType || (this.ruleData?.type) || '';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Rule Editor</title>
    <style>
        :root {
            --bg-0: #1e1e1e; --bg-1: #252526; --bg-2: #2d2d2d; --bg-3: #3c3c3c;
            --fg-0: #d4d4d4; --fg-1: #cccccc; --fg-2: #9d9d9d; --fg-3: #6e6e6e;
            --accent: #007acc; --border: #404040; --success: #4ec9b0; --error: #f14c4c; --warning: #cca700;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: var(--bg-0); color: var(--fg-0); height: 100vh; overflow: hidden; }
        
        .container { display: grid; grid-template-columns: 260px 1fr 300px; grid-template-rows: 48px 1fr 28px; height: 100vh; }
        
        .header { grid-column: 1 / -1; background: var(--bg-1); border-bottom: 1px solid var(--border); 
            display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .header-title { font-size: 14px; font-weight: 600; }
        .env-badges { display: flex; gap: 8px; }
        .env-badge { font-size: 11px; padding: 2px 8px; border-radius: 3px; background: var(--bg-3); color: var(--fg-2); }
        .env-badge.active { background: rgba(78, 201, 176, 0.2); color: var(--success); }
        .header-actions { display: flex; gap: 8px; }
        
        .btn { padding: 6px 14px; font-size: 12px; border: none; border-radius: 3px; cursor: pointer; }
        .btn-default { background: var(--bg-3); color: var(--fg-1); }
        .btn-default:hover { background: #4a4a4a; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover { background: #1a8cd8; }
        .btn-success { background: #388a34; color: white; }
        .btn-success:hover { background: #45a341; }
        
        .sidebar { background: var(--bg-1); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; }
        .section { margin-bottom: 16px; }
        .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--fg-3); margin-bottom: 8px; }
        .form-group { margin-bottom: 10px; }
        .form-group label { display: block; font-size: 11px; color: var(--fg-2); margin-bottom: 4px; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 6px 8px; background: var(--bg-2); border: 1px solid var(--border); 
            border-radius: 3px; color: var(--fg-0); font-size: 12px; 
        }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: var(--accent); }
        
        .var-list { max-height: 180px; overflow-y: auto; }
        .var-item { padding: 6px 8px; background: var(--bg-2); border-radius: 3px; margin-bottom: 4px; cursor: pointer; font-size: 11px; }
        .var-item:hover { background: var(--bg-3); }
        .var-name { color: #9cdcfe; font-family: Consolas, monospace; }
        .var-type { color: var(--fg-3); font-size: 10px; }
        
        .editor-pane { display: flex; flex-direction: column; overflow: hidden; }
        .editor-tabs { display: flex; background: var(--bg-1); border-bottom: 1px solid var(--border); padding: 0 8px; }
        .editor-tab { padding: 8px 16px; font-size: 12px; color: var(--fg-2); cursor: pointer; border-bottom: 2px solid transparent; }
        .editor-tab.active { color: var(--fg-0); border-bottom-color: var(--accent); }
        #monacoContainer { flex: 1; }
        
        .test-panel { background: var(--bg-1); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
        .test-header { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .test-header h3 { font-size: 12px; font-weight: 600; }
        .test-content { flex: 1; overflow-y: auto; padding: 12px; }
        .test-data { width: 100%; height: 120px; padding: 8px; background: var(--bg-2); border: 1px solid var(--border);
            border-radius: 3px; font-family: Consolas, monospace; font-size: 11px; color: var(--fg-0); resize: vertical; }
        
        .result-card { background: var(--bg-2); border-radius: 3px; margin-top: 12px; overflow: hidden; }
        .result-header { padding: 6px 10px; font-size: 11px; font-weight: 500; display: flex; justify-content: space-between; }
        .result-header.success { background: rgba(78, 201, 176, 0.15); color: var(--success); }
        .result-header.error { background: rgba(241, 76, 76, 0.15); color: var(--error); }
        .result-body { padding: 8px 10px; font-family: Consolas, monospace; font-size: 11px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; }
        
        .console-output { background: #0c0c0c; border-radius: 3px; padding: 8px; max-height: 120px; overflow-y: auto; 
            font-family: Consolas, monospace; font-size: 11px; margin-top: 12px; }
        .console-line { margin-bottom: 2px; }
        .console-line.info { color: #9cdcfe; }
        .console-line.warn { color: #cca700; }
        .console-line.error { color: #f14c4c; }
        
        .footer { grid-column: 1 / -1; background: var(--bg-1); border-top: 1px solid var(--border); 
            display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 11px; color: var(--fg-2); }
        .status { display: flex; align-items: center; gap: 6px; }
        .status-dot { width: 8px; height: 8px; border-radius: 50%; }
        .status-dot.ok { background: var(--success); }
        .status-dot.error { background: var(--error); }
        .status-dot.pending { background: var(--warning); }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-left">
                <span class="header-title">Rule Editor</span>
                <div class="env-badges">
                    <span class="env-badge ${envStatus.java ? 'active' : ''}">Java ${envStatus.java ? '✓' : '✗'}</span>
                    <span class="env-badge ${envStatus.beanshell ? 'active' : ''}">BeanShell ${envStatus.beanshell ? '✓' : '✗'}</span>
                </div>
            </div>
            <div class="header-actions">
                <button class="btn btn-default" onclick="validateSyntax()">Validate</button>
                <button class="btn btn-default" onclick="validateCloud()">Cloud Check</button>
                <button class="btn btn-primary" onclick="testRule()">Run Test</button>
                <button class="btn btn-success" onclick="uploadRule()">Save to Cloud</button>
            </div>
        </header>
        
        <div class="sidebar">
            <div class="section">
                <div class="section-title">Configuration</div>
                <div class="form-group">
                    <label>Rule Name</label>
                    <input type="text" id="ruleName" placeholder="Enter rule name">
                </div>
                <div class="form-group">
                    <label>Rule Type</label>
                    <select id="ruleType" onchange="onRuleTypeChange()">
                        <option value="">Select type...</option>
                        ${this.ruleTypes.map(rt => `<option value="${rt.type}" ${rt.type === initialType ? 'selected' : ''}>${rt.displayName}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="ruleDescription" rows="2" placeholder="Optional description"></textarea>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Available Variables</div>
                <div class="var-list" id="varList">
                    <div style="color: var(--fg-3); font-size: 11px; padding: 8px;">Select a rule type</div>
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Snippets</div>
                <div class="var-list">
                    <div class="var-item" onclick="insertSnippet('log')"><span class="var-name">log.info()</span></div>
                    <div class="var-item" onclick="insertSnippet('map')"><span class="var-name">new HashMap()</span></div>
                    <div class="var-item" onclick="insertSnippet('list')"><span class="var-name">new ArrayList()</span></div>
                    <div class="var-item" onclick="insertSnippet('if')"><span class="var-name">if statement</span></div>
                    <div class="var-item" onclick="insertSnippet('for')"><span class="var-name">for loop</span></div>
                    <div class="var-item" onclick="insertSnippet('try')"><span class="var-name">try-catch</span></div>
                </div>
            </div>
        </div>
        
        <div class="editor-pane">
            <div class="editor-tabs">
                <div class="editor-tab active">Script</div>
            </div>
            <div id="monacoContainer"></div>
        </div>
        
        <div class="test-panel">
            <div class="test-header">
                <h3>Test Panel</h3>
                <button class="btn btn-primary" onclick="testRule()">Run</button>
            </div>
            <div class="test-content">
                <div class="section-title">Test Data (JSON)</div>
                <textarea class="test-data" id="testData" placeholder='{"key": "value"}'></textarea>
                
                <div id="results"></div>
                
                <div class="section-title" style="margin-top: 12px;">Console Output</div>
                <div class="console-output" id="consoleOutput">
                    <div style="color: var(--fg-3);">Run a test to see output...</div>
                </div>
            </div>
        </div>
        
        <footer class="footer">
            <div class="status">
                <div class="status-dot pending" id="statusDot"></div>
                <span id="statusText">Ready</span>
            </div>
            <div>BeanShell / Java</div>
        </footer>
    </div>
    
    <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>
    <script>
        const vscode = acquireVsCodeApi();
        const ruleTypes = ${ruleTypesJson};
        let ruleData = ${ruleDataJson};
        let editor = null;
        let currentRuleType = '${initialType}';
        
        // Initialize Monaco Editor
        require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            // Register Java language for BeanShell (close enough)
            monaco.languages.register({ id: 'beanshell' });
            monaco.languages.setMonarchTokensProvider('beanshell', {
                keywords: ['import', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default',
                    'break', 'continue', 'try', 'catch', 'finally', 'throw', 'new', 'this', 'super',
                    'class', 'interface', 'extends', 'implements', 'public', 'private', 'protected', 'static',
                    'final', 'void', 'boolean', 'byte', 'short', 'int', 'long', 'float', 'double', 'char',
                    'true', 'false', 'null', 'instanceof'],
                typeKeywords: ['String', 'Integer', 'Boolean', 'Double', 'Float', 'Long', 'Object', 'List', 
                    'ArrayList', 'Map', 'HashMap', 'Set', 'HashSet', 'Date', 'Exception', 'Identity', 
                    'Application', 'Link', 'Bundle', 'Attributes', 'Connector', 'Schema', 'Rule',
                    'ProvisioningPlan', 'ProvisioningResult', 'AccountRequest', 'AttributeRequest', 'ResourceObject'],
                operators: ['=', '>', '<', '!', '~', '?', ':', '==', '<=', '>=', '!=', '&&', '||', '++', '--',
                    '+', '-', '*', '/', '&', '|', '^', '%', '<<', '>>', '>>>', '+=', '-=', '*=', '/='],
                symbols: /[=><!~?:&|+\\-*\\/\\^%]+/,
                tokenizer: {
                    root: [
                        [/[a-z_$][\\w$]*/, { cases: { '@typeKeywords': 'type', '@keywords': 'keyword', '@default': 'identifier' } }],
                        [/[A-Z][\\w$]*/, 'type'],
                        { include: '@whitespace' },
                        [/[{}()\\[\\]]/, '@brackets'],
                        [/@symbols/, { cases: { '@operators': 'operator', '@default': '' } }],
                        [/\\d*\\.\\d+([eE][\\-+]?\\d+)?/, 'number.float'],
                        [/\\d+/, 'number'],
                        [/[;,.]/, 'delimiter'],
                        [/"([^"\\\\]|\\\\.)*$/, 'string.invalid'],
                        [/"/, 'string', '@string'],
                    ],
                    whitespace: [
                        [/[ \\t\\r\\n]+/, 'white'],
                        [/\\/\\*/, 'comment', '@comment'],
                        [/\\/\\/.*$/, 'comment'],
                    ],
                    comment: [
                        [/[^\\/*]+/, 'comment'],
                        [/\\*\\//, 'comment', '@pop'],
                        [/[\\/*]/, 'comment']
                    ],
                    string: [
                        [/[^\\\\"]+/, 'string'],
                        [/\\\\./, 'string.escape'],
                        [/"/, 'string', '@pop']
                    ],
                }
            });
            
            editor = monaco.editor.create(document.getElementById('monacoContainer'), {
                value: ruleData?.sourceCode?.script || '// Enter your BeanShell script here\\n',
                language: 'beanshell',
                theme: 'vs-dark',
                automaticLayout: true,
                minimap: { enabled: true },
                fontSize: 13,
                lineNumbers: 'on',
                wordWrap: 'on',
                scrollBeyondLastLine: false,
                renderWhitespace: 'selection',
                tabSize: 4,
                insertSpaces: true,
                folding: true,
                bracketPairColorization: { enabled: true },
                suggest: { showWords: true }
            });
            
            // Load rule data if available
            if (ruleData) loadRuleData(ruleData);
            if (currentRuleType) onRuleTypeChange();
            
            // Request to load rule from server if we have an ID
            vscode.postMessage({ command: 'loadRule' });
        });
        
        function loadRuleData(data) {
            document.getElementById('ruleName').value = data.name || '';
            document.getElementById('ruleType').value = data.type || '';
            document.getElementById('ruleDescription').value = data.description || '';
            if (data.sourceCode?.script && editor) {
                editor.setValue(data.sourceCode.script);
            }
            currentRuleType = data.type;
            onRuleTypeChange();
        }
        
        function onRuleTypeChange() {
            const ruleType = document.getElementById('ruleType').value;
            currentRuleType = ruleType;
            vscode.postMessage({ command: 'getRuleTypeInfo', ruleType });
        }
        
        function insertSnippet(type) {
            const snippets = {
                'log': 'log.info("");',
                'map': 'Map map = new HashMap();',
                'list': 'List list = new ArrayList();',
                'if': 'if (condition) {\\n    \\n}',
                'for': 'for (Object item : list) {\\n    \\n}',
                'try': 'try {\\n    \\n} catch (Exception e) {\\n    log.error(e.getMessage());\\n}'
            };
            if (editor) {
                const snippet = snippets[type] || '';
                const selection = editor.getSelection();
                editor.executeEdits('snippet', [{ range: selection, text: snippet }]);
                editor.focus();
            }
        }
        
        function insertVar(text) {
            if (editor) {
                const selection = editor.getSelection();
                editor.executeEdits('variable', [{ range: selection, text: text }]);
                editor.focus();
            }
        }
        
        function validateSyntax() {
            if (!editor) return;
            setStatus('pending', 'Validating...');
            vscode.postMessage({ command: 'validateSyntax', script: editor.getValue() });
        }
        
        function validateCloud() {
            if (!editor) return;
            setStatus('pending', 'Checking with cloud...');
            vscode.postMessage({ command: 'validateCloud', script: editor.getValue() });
        }
        
        function testRule() {
            if (!editor) return;
            setStatus('pending', 'Running test...');
            let testData = {};
            try { testData = JSON.parse(document.getElementById('testData').value || '{}'); } catch {}
            vscode.postMessage({ command: 'testRule', script: editor.getValue(), ruleType: currentRuleType, testData });
        }
        
        function uploadRule() {
            if (!editor) return;
            const name = document.getElementById('ruleName').value;
            const type = document.getElementById('ruleType').value;
            const description = document.getElementById('ruleDescription').value;
            if (!name) { setStatus('error', 'Rule name is required'); return; }
            if (!type) { setStatus('error', 'Rule type is required'); return; }
            setStatus('pending', 'Saving to cloud...');
            vscode.postMessage({
                command: 'uploadRule',
                data: { name, type, description, sourceCode: { version: '1.0', script: editor.getValue() } }
            });
        }
        
        function setStatus(type, text) {
            const dot = document.getElementById('statusDot');
            const statusText = document.getElementById('statusText');
            dot.className = 'status-dot ' + type;
            statusText.textContent = text;
        }
        
        function displayResults(data) {
            const resultsEl = document.getElementById('results');
            const consoleEl = document.getElementById('consoleOutput');
            
            if (data.success) {
                setStatus('ok', 'Test passed (' + data.executionTime + 'ms)');
                resultsEl.innerHTML = '<div class="result-card"><div class="result-header success">Result</div>' +
                    '<div class="result-body">' + escapeHtml(JSON.stringify(data.output, null, 2)) + '</div></div>';
            } else {
                setStatus('error', 'Test failed');
                resultsEl.innerHTML = '<div class="result-card"><div class="result-header error">Errors</div>' +
                    '<div class="result-body">' + data.errors.map(e => escapeHtml(e)).join('\\n') + '</div></div>';
            }
            
            if (data.consoleOutput && data.consoleOutput.length > 0) {
                consoleEl.innerHTML = data.consoleOutput.map(line => {
                    const level = line.level || 'info';
                    return '<div class="console-line ' + level + '">' + escapeHtml(line.message) + '</div>';
                }).join('');
            } else {
                consoleEl.innerHTML = '<div style="color: var(--fg-3);">No console output</div>';
            }
        }
        
        function escapeHtml(str) {
            if (str === null || str === undefined) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'ruleLoaded':
                    ruleData = msg.data;
                    loadRuleData(ruleData);
                    break;
                case 'testResults':
                    displayResults(msg.data);
                    break;
                case 'syntaxValidation':
                    if (msg.data.valid) setStatus('ok', 'Syntax OK');
                    else setStatus('error', 'Errors: ' + msg.data.errors.join(', '));
                    break;
                case 'cloudValidation':
                    if (msg.data.valid) setStatus('ok', 'Cloud validation passed');
                    else setStatus('error', msg.data.message);
                    break;
                case 'saveDone':
                    if (msg.success) setStatus('ok', 'Saved successfully');
                    else setStatus('error', 'Save failed: ' + (msg.error || 'Unknown error'));
                    break;
                case 'ruleTypeInfo':
                    if (msg.data.typeInfo) {
                        const vars = msg.data.typeInfo.variables || [];
                        document.getElementById('varList').innerHTML = vars.length > 0 
                            ? vars.map(v => '<div class="var-item" onclick="insertVar(\\'' + v.name + '\\')"><span class="var-name">' + v.name + '</span><br><span class="var-type">' + v.type + '</span></div>').join('')
                            : '<div style="color: var(--fg-3); font-size: 11px; padding: 8px;">No variables for this type</div>';
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        RuleEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    }
}
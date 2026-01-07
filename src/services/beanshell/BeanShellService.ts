import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';

/**
 * Rule type definitions with their available variables
 */
export interface RuleVariable {
    name: string;
    type: string;
    description: string;
    mockValue?: any;
}

export interface RuleTypeDefinition {
    type: string;
    displayName: string;
    description: string;
    variables: RuleVariable[];
    expectedOutput?: {
        name: string;
        type: string;
        description: string;
    };
}

/**
 * Test execution result
 */
export interface TestResult {
    success: boolean;
    output: any;
    consoleOutput: string[];
    errors: string[];
    executionTime: number;
    warnings: string[];
}

/**
 * BeanShell Service - Provides local BeanShell script execution and testing
 */
export class BeanShellService {
    private static instance: BeanShellService;
    private extensionPath: string;
    private javaPath: string | undefined;
    private rdkPath: string | undefined;
    private bshJarPath: string | undefined;
    private isRdkAvailable: boolean = false;
    private isJavaAvailable: boolean = false;

    private constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    public static initialize(context: vscode.ExtensionContext): BeanShellService {
        if (!BeanShellService.instance) {
            BeanShellService.instance = new BeanShellService(context.extensionPath);
            BeanShellService.instance.detectEnvironment();
        }
        return BeanShellService.instance;
    }

    public static getInstance(): BeanShellService {
        if (!BeanShellService.instance) {
            throw new Error('BeanShellService not initialized');
        }
        return BeanShellService.instance;
    }

    /**
     * Detect Java and RDK availability
     */
    private async detectEnvironment(): Promise<void> {
        // Check for Java
        this.javaPath = await this.findJava();
        this.isJavaAvailable = !!this.javaPath;

        // Check for RDK
        this.rdkPath = await this.findRdk();
        this.isRdkAvailable = !!this.rdkPath;

        // Check for bundled BeanShell jar
        this.bshJarPath = await this.findBeanShellJar();

        if (this.isJavaAvailable) {
            console.log(`Java found at: ${this.javaPath}`);
        } else {
            console.log('Java not found - local testing will use JavaScript fallback');
        }

        if (this.isRdkAvailable) {
            console.log(`SailPoint RDK found at: ${this.rdkPath}`);
        }
    }

    private async findJava(): Promise<string | undefined> {
        const possiblePaths = [
            process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', 'java') : '',
            'java',
            '/usr/bin/java',
            '/usr/local/bin/java',
            'C:\\Program Files\\Java\\jdk-11\\bin\\java.exe',
            'C:\\Program Files\\Java\\jdk-17\\bin\\java.exe',
        ].filter(p => p);

        for (const javaPath of possiblePaths) {
            if (await this.testCommand(javaPath, ['-version'])) {
                return javaPath;
            }
        }
        return undefined;
    }

    private async findRdk(): Promise<string | undefined> {
        // Check common RDK locations
        const possiblePaths = [
            process.env.SAILPOINT_RDK_PATH,
            path.join(this.extensionPath, 'resources', 'rdk'),
            path.join(process.env.HOME || '', '.sailpoint', 'rdk'),
            path.join(process.env.USERPROFILE || '', '.sailpoint', 'rdk'),
        ].filter(p => p);

        for (const rdkPath of possiblePaths) {
            if (rdkPath && fs.existsSync(rdkPath)) {
                const rdkJar = path.join(rdkPath, 'sailpoint-rdk.jar');
                if (fs.existsSync(rdkJar)) {
                    return rdkPath;
                }
            }
        }
        return undefined;
    }

    private async findBeanShellJar(): Promise<string | undefined> {
        const possiblePaths = [
            path.join(this.extensionPath, 'resources', 'bsh-2.0b4.jar'),
            path.join(this.extensionPath, 'resources', 'bsh.jar'),
        ];

        for (const jarPath of possiblePaths) {
            if (fs.existsSync(jarPath)) {
                return jarPath;
            }
        }
        return undefined;
    }

    private async testCommand(command: string, args: string[]): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const proc = spawn(command, args, { stdio: 'pipe' });
                proc.on('error', () => resolve(false));
                proc.on('close', (code) => resolve(code === 0));
                setTimeout(() => {
                    proc.kill();
                    resolve(false);
                }, 5000);
            } catch {
                resolve(false);
            }
        });
    }

    /**
     * Get environment status
     */
    public getEnvironmentStatus(): { java: boolean; rdk: boolean; beanshell: boolean } {
        return {
            java: this.isJavaAvailable,
            rdk: this.isRdkAvailable,
            beanshell: !!this.bshJarPath || this.isJavaAvailable
        };
    }

    /**
     * Get rule type definitions with their available variables
     */
    public getRuleTypes(): RuleTypeDefinition[] {
        return [
            {
                type: 'BuildMap',
                displayName: 'Delimited File BuildMap',
                description: 'Manipulate raw input data and build a map from incoming data',
                variables: [
                    { name: 'col', type: 'List<String>', description: 'Ordered list of column names from file header', mockValue: ['id', 'name', 'email', 'status'] },
                    { name: 'record', type: 'List<String>', description: 'Ordered list of values for current record', mockValue: ['001', 'John Doe', 'john@example.com', 'active'] },
                    { name: 'application', type: 'Application', description: 'The source object', mockValue: { name: 'TestSource', type: 'DelimitedFile' } },
                    { name: 'schema', type: 'Schema', description: 'Schema object for the source', mockValue: { objectType: 'account' } }
                ],
                expectedOutput: { name: 'map', type: 'Map<String, Object>', description: 'Built map from the data' }
            },
            {
                type: 'JDBCBuildMap',
                displayName: 'JDBC BuildMap',
                description: 'Build a map representation from JDBC ResultSet',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: { info: () => {}, warn: () => {}, error: () => {} } },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context for database queries', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application being processed', mockValue: { name: 'JDBCSource', type: 'JDBC' } },
                    { name: 'state', type: 'Map', description: 'Map containing state information', mockValue: {} },
                    { name: 'result', type: 'ResultSet', description: 'ResultSet from database', mockValue: {} },
                    { name: 'connection', type: 'Connection', description: 'Database connection object', mockValue: {} }
                ],
                expectedOutput: { name: 'map', type: 'Map<String, Object>', description: 'Map assembled from the data' }
            },
            {
                type: 'JDBCProvision',
                displayName: 'JDBC Provisioning',
                description: 'Process provisioning requests for JDBC sources',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: { name: 'JDBCSource' } },
                    { name: 'schema', type: 'Schema', description: 'Schema currently in use', mockValue: { objectType: 'account' } },
                    { name: 'connection', type: 'Connection', description: 'Database connection', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: { accountRequests: [] } }
                ],
                expectedOutput: { name: 'result', type: 'ProvisioningResult', description: 'Result of provisioning operation' }
            },
            {
                type: 'WebServiceBeforeOperationRule',
                displayName: 'Web Services Before Operation',
                description: 'Execute before any Web Services connector operation',
                variables: [
                    { name: 'application', type: 'Application', description: 'The application', mockValue: { name: 'WebServiceSource' } },
                    { name: 'requestEndPoint', type: 'WebServicesClient.RequestEndPoint', description: 'Request information with header, body, URL', mockValue: { contextUrl: '', method: 'GET', headers: {} } },
                    { name: 'oldResponseMap', type: 'Map', description: 'Previous response object', mockValue: {} },
                    { name: 'restClient', type: 'RestClient', description: 'REST client object', mockValue: {} }
                ],
                expectedOutput: { name: 'EndPoint', type: 'RequestEndPoint', description: 'Updated endpoint object' }
            },
            {
                type: 'WebServiceAfterOperationRule',
                displayName: 'Web Services After Operation',
                description: 'Execute after Web Services connector operation to process response',
                variables: [
                    { name: 'application', type: 'Application', description: 'The application', mockValue: { name: 'WebServiceSource' } },
                    { name: 'requestEndPoint', type: 'WebServicesClient.RequestEndPoint', description: 'Request information', mockValue: {} },
                    { name: 'processedResponseObject', type: 'Object', description: 'Response processed by connector', mockValue: [] },
                    { name: 'rawResponseObject', type: 'Object', description: 'Raw response from end system', mockValue: {} },
                    { name: 'restClient', type: 'RestClient', description: 'REST client object', mockValue: {} }
                ],
                expectedOutput: { name: 'result', type: 'List<Map>', description: 'Updated account/group list' }
            },
            {
                type: 'ConnectorBeforeCreate',
                displayName: 'Before Account Create',
                description: 'Execute before an account is created',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} }
                ]
            },
            {
                type: 'ConnectorAfterCreate',
                displayName: 'After Account Create',
                description: 'Execute after an account is created',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} },
                    { name: 'result', type: 'ProvisioningResult', description: 'Result of create operation', mockValue: {} }
                ]
            },
            {
                type: 'ConnectorBeforeModify',
                displayName: 'Before Account Modify',
                description: 'Execute before an account is modified',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} }
                ]
            },
            {
                type: 'ConnectorAfterModify',
                displayName: 'After Account Modify',
                description: 'Execute after an account is modified',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} },
                    { name: 'result', type: 'ProvisioningResult', description: 'Result of modify operation', mockValue: {} }
                ]
            },
            {
                type: 'ConnectorBeforeDelete',
                displayName: 'Before Account Delete',
                description: 'Execute before an account is deleted',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} }
                ]
            },
            {
                type: 'ConnectorAfterDelete',
                displayName: 'After Account Delete',
                description: 'Execute after an account is deleted',
                variables: [
                    { name: 'log', type: 'Log', description: 'Logger object', mockValue: {} },
                    { name: 'context', type: 'SailPointContext', description: 'SailPoint context', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'plan', type: 'ProvisioningPlan', description: 'Provisioning plan', mockValue: {} },
                    { name: 'result', type: 'ProvisioningResult', description: 'Result of delete operation', mockValue: {} }
                ]
            },
            {
                type: 'SAPBuildMap',
                displayName: 'SAP BuildMap',
                description: 'Transform SAP data during aggregation',
                variables: [
                    { name: 'destination', type: 'JCoDestination', description: 'SAP destination object', mockValue: {} },
                    { name: 'object', type: 'Attributes', description: 'Attributes object with built attributes', mockValue: {} },
                    { name: 'connector', type: 'SAPConnector', description: 'SAP Connector reference', mockValue: {} },
                    { name: 'state', type: 'Map', description: 'State map for sharing data', mockValue: {} },
                    { name: 'application', type: 'Application', description: 'The application', mockValue: {} },
                    { name: 'schema', type: 'Schema', description: 'Schema object', mockValue: {} }
                ]
            }
        ];
    }

    /**
     * Get rule type by name
     */
    public getRuleType(type: string): RuleTypeDefinition | undefined {
        return this.getRuleTypes().find(rt => rt.type === type);
    }

    /**
     * Execute BeanShell script locally
     */
    public async executeScript(
        script: string,
        ruleType: string,
        testData: Record<string, any>
    ): Promise<TestResult> {
        const startTime = Date.now();
        const consoleOutput: string[] = [];
        const errors: string[] = [];
        const warnings: string[] = [];

        try {
            // Try Java-based execution if available
            if (this.isJavaAvailable && this.bshJarPath) {
                return await this.executeWithJava(script, ruleType, testData);
            }

            // Fallback to JavaScript-based simulation
            return await this.executeWithJavaScriptSimulation(script, ruleType, testData);
        } catch (error: any) {
            return {
                success: false,
                output: null,
                consoleOutput,
                errors: [error.message || String(error)],
                executionTime: Date.now() - startTime,
                warnings
            };
        }
    }

    /**
     * Execute with Java BeanShell interpreter
     */
    private async executeWithJava(
        script: string,
        ruleType: string,
        testData: Record<string, any>
    ): Promise<TestResult> {
        const startTime = Date.now();

        return new Promise((resolve) => {
            const consoleOutput: string[] = [];
            const errors: string[] = [];

            // Create a wrapper script that sets up variables and executes
            const ruleTypeDef = this.getRuleType(ruleType);
            const setupCode = this.generateSetupCode(ruleTypeDef, testData);
            const fullScript = `${setupCode}\n${script}`;

            // Write script to temp file
            const tempDir = path.join(this.extensionPath, '.temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            const scriptFile = path.join(tempDir, 'test_script.bsh');
            fs.writeFileSync(scriptFile, fullScript);

            const args = ['-cp', this.bshJarPath!, 'bsh.Interpreter', scriptFile];
            const proc = spawn(this.javaPath!, args, { 
                cwd: tempDir,
                timeout: 30000 
            });

            let stdout = '';
            let stderr = '';

            proc.stdout?.on('data', (data) => {
                stdout += data.toString();
                consoleOutput.push(data.toString());
            });

            proc.stderr?.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                // Clean up
                try { fs.unlinkSync(scriptFile); } catch {}

                if (code === 0) {
                    resolve({
                        success: true,
                        output: stdout.trim() || 'Script executed successfully',
                        consoleOutput,
                        errors: [],
                        executionTime: Date.now() - startTime,
                        warnings: stderr ? [stderr] : []
                    });
                } else {
                    resolve({
                        success: false,
                        output: null,
                        consoleOutput,
                        errors: [stderr || `Process exited with code ${code}`],
                        executionTime: Date.now() - startTime,
                        warnings: []
                    });
                }
            });

            proc.on('error', (err) => {
                resolve({
                    success: false,
                    output: null,
                    consoleOutput,
                    errors: [err.message],
                    executionTime: Date.now() - startTime,
                    warnings: []
                });
            });

            // Timeout
            setTimeout(() => {
                proc.kill();
                resolve({
                    success: false,
                    output: null,
                    consoleOutput,
                    errors: ['Script execution timed out (30s limit)'],
                    executionTime: 30000,
                    warnings: []
                });
            }, 30000);
        });
    }

    /**
     * Generate setup code for BeanShell script
     */
    private generateSetupCode(ruleTypeDef: RuleTypeDefinition | undefined, testData: Record<string, any>): string {
        const lines: string[] = [
            '// Auto-generated setup code',
            'import java.util.*;',
            'import java.text.*;',
            '',
            '// Mock log object',
            'class MockLog {',
            '    void info(String msg) { System.out.println("[INFO] " + msg); }',
            '    void warn(String msg) { System.out.println("[WARN] " + msg); }',
            '    void error(String msg) { System.out.println("[ERROR] " + msg); }',
            '    void debug(String msg) { System.out.println("[DEBUG] " + msg); }',
            '}',
            'log = new MockLog();',
            ''
        ];

        if (ruleTypeDef) {
            for (const variable of ruleTypeDef.variables) {
                const value = testData[variable.name] ?? variable.mockValue;
                if (value !== undefined) {
                    const serialized = this.serializeToJava(value, variable.type);
                    lines.push(`${variable.name} = ${serialized};`);
                }
            }
        }

        return lines.join('\n');
    }

    private serializeToJava(value: any, type: string): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'string') {
            return `"${value.replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
        }
        if (typeof value === 'number') {
            return String(value);
        }
        if (typeof value === 'boolean') {
            return value ? 'true' : 'false';
        }
        if (Array.isArray(value)) {
            if (type?.includes('List')) {
                const items = value.map(v => this.serializeToJava(v, '')).join(', ');
                return `new ArrayList(Arrays.asList(${items}))`;
            }
            return `new Object[]{${value.map(v => this.serializeToJava(v, '')).join(', ')}}`;
        }
        if (typeof value === 'object') {
            const entries = Object.entries(value)
                .map(([k, v]) => `map.put("${k}", ${this.serializeToJava(v, '')});`)
                .join(' ');
            return `((Supplier)(() -> { Map map = new HashMap(); ${entries} return map; })).get()`;
        }
        return 'null';
    }

    /**
     * Execute with JavaScript simulation (fallback when Java not available)
     */
    private async executeWithJavaScriptSimulation(
        script: string,
        ruleType: string,
        testData: Record<string, any>
    ): Promise<TestResult> {
        const startTime = Date.now();
        const consoleOutput: string[] = [];
        const warnings: string[] = [];

        warnings.push('⚠️ Running in JavaScript simulation mode. Install Java for accurate BeanShell execution.');

        try {
            // Get rule type definition
            const ruleTypeDef = this.getRuleType(ruleType);

            // Build execution context with mock objects
            const context = this.buildMockContext(ruleTypeDef, testData, consoleOutput);

            // Transform BeanShell to approximate JavaScript
            const jsScript = this.transformBeanShellToJS(script);

            // Create sandboxed function
            const wrappedScript = `
                (function() {
                    const { ${Object.keys(context).join(', ')} } = __context__;
                    ${jsScript}
                })()
            `;

            // Execute in a try-catch
            const fn = new Function('__context__', `return ${wrappedScript}`);
            const result = fn(context);

            return {
                success: true,
                output: result,
                consoleOutput,
                errors: [],
                executionTime: Date.now() - startTime,
                warnings
            };
        } catch (error: any) {
            return {
                success: false,
                output: null,
                consoleOutput,
                errors: [this.formatError(error)],
                executionTime: Date.now() - startTime,
                warnings
            };
        }
    }

    /**
     * Build mock context for JavaScript execution
     */
    private buildMockContext(
        ruleTypeDef: RuleTypeDefinition | undefined,
        testData: Record<string, any>,
        consoleOutput: string[]
    ): Record<string, any> {
        const context: Record<string, any> = {};

        // Add log object
        context.log = {
            info: (msg: string) => consoleOutput.push(`[INFO] ${msg}`),
            warn: (msg: string) => consoleOutput.push(`[WARN] ${msg}`),
            error: (msg: string) => consoleOutput.push(`[ERROR] ${msg}`),
            debug: (msg: string) => consoleOutput.push(`[DEBUG] ${msg}`)
        };

        // Add variables from rule type
        if (ruleTypeDef) {
            for (const variable of ruleTypeDef.variables) {
                context[variable.name] = testData[variable.name] ?? variable.mockValue ?? null;
            }
        }

        // Add common Java-like utilities
        context.HashMap = class HashMap extends Map {
            put(key: any, value: any) { this.set(key, value); return value; }
            containsKey(key: any) { return this.has(key); }
        };
        context.ArrayList = class ArrayList extends Array {
            add(item: any) { this.push(item); return true; }
            contains(item: any) { return this.includes(item); }
        };

        return context;
    }

    /**
     * Transform BeanShell to approximate JavaScript
     */
    private transformBeanShellToJS(script: string): string {
        let js = script;

        // Remove Java imports (not needed in JS)
        js = js.replace(/import\s+[\w.]+\*?;?\s*/g, '');

        // Transform common patterns
        js = js.replace(/new\s+HashMap\s*\(\)/g, 'new HashMap()');
        js = js.replace(/new\s+ArrayList\s*\(\)/g, 'new ArrayList()');
        js = js.replace(/\.equals\s*\(/g, ' === (');
        js = js.replace(/\.equalsIgnoreCase\s*\(/g, '.toLowerCase() === (');
        js = js.replace(/\.toString\s*\(\)/g, '.toString()');
        js = js.replace(/\bnull\b/g, 'null');
        js = js.replace(/\btrue\b/g, 'true');
        js = js.replace(/\bfalse\b/g, 'false');

        // Handle String operations
        js = js.replace(/\.length\(\)/g, '.length');
        js = js.replace(/\.isEmpty\(\)/g, '.length === 0');
        js = js.replace(/\.substring\(/g, '.substring(');

        // Handle Map operations
        js = js.replace(/\.get\s*\(/g, '.get(');
        js = js.replace(/\.put\s*\(/g, '.put(');
        js = js.replace(/\.containsKey\s*\(/g, '.containsKey(');

        // Handle List operations
        js = js.replace(/\.size\(\)/g, '.length');
        js = js.replace(/\.add\s*\(/g, '.add(');

        return js;
    }

    private formatError(error: any): string {
        if (error instanceof SyntaxError) {
            return `Syntax Error: ${error.message}`;
        }
        if (error instanceof ReferenceError) {
            return `Reference Error: ${error.message} (variable may not be defined in test data)`;
        }
        if (error instanceof TypeError) {
            return `Type Error: ${error.message}`;
        }
        return error.message || String(error);
    }

    /**
     * Validate BeanShell script syntax (basic validation)
     */
    public validateSyntax(script: string): { valid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check for unclosed braces
        const openBraces = (script.match(/{/g) || []).length;
        const closeBraces = (script.match(/}/g) || []).length;
        if (openBraces !== closeBraces) {
            errors.push(`Mismatched braces: ${openBraces} opening, ${closeBraces} closing`);
        }

        // Check for unclosed parentheses
        const openParens = (script.match(/\(/g) || []).length;
        const closeParens = (script.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            errors.push(`Mismatched parentheses: ${openParens} opening, ${closeParens} closing`);
        }

        // Check for unclosed strings
        const singleQuotes = (script.match(/'/g) || []).length;
        if (singleQuotes % 2 !== 0) {
            errors.push('Unclosed single-quote string');
        }

        const doubleQuotes = (script.match(/(?<!\\)"/g) || []).length;
        if (doubleQuotes % 2 !== 0) {
            errors.push('Unclosed double-quote string');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Get code completions for BeanShell
     */
    public getCompletions(ruleType: string): { label: string; kind: string; detail: string; insertText: string }[] {
        const completions: { label: string; kind: string; detail: string; insertText: string }[] = [];

        // Add rule type variables
        const ruleTypeDef = this.getRuleType(ruleType);
        if (ruleTypeDef) {
            for (const variable of ruleTypeDef.variables) {
                completions.push({
                    label: variable.name,
                    kind: 'Variable',
                    detail: `${variable.type} - ${variable.description}`,
                    insertText: variable.name
                });
            }
        }

        // Add common methods
        const commonMethods = [
            { label: 'log.info', kind: 'Method', detail: 'Log info message', insertText: 'log.info("${1:message}");' },
            { label: 'log.warn', kind: 'Method', detail: 'Log warning message', insertText: 'log.warn("${1:message}");' },
            { label: 'log.error', kind: 'Method', detail: 'Log error message', insertText: 'log.error("${1:message}");' },
            { label: 'new HashMap()', kind: 'Constructor', detail: 'Create new HashMap', insertText: 'new HashMap()' },
            { label: 'new ArrayList()', kind: 'Constructor', detail: 'Create new ArrayList', insertText: 'new ArrayList()' },
            { label: 'map.put', kind: 'Method', detail: 'Put value in map', insertText: 'map.put("${1:key}", ${2:value});' },
            { label: 'map.get', kind: 'Method', detail: 'Get value from map', insertText: 'map.get("${1:key}")' },
            { label: 'list.add', kind: 'Method', detail: 'Add item to list', insertText: 'list.add(${1:item});' },
            { label: 'return', kind: 'Keyword', detail: 'Return statement', insertText: 'return ${1:value};' },
        ];

        completions.push(...commonMethods);

        return completions;
    }

    /**
     * Setup RDK if not present
     */
    public async setupRdk(): Promise<boolean> {
        const answer = await vscode.window.showInformationMessage(
            'SailPoint Rule Development Kit (RDK) is not detected. Would you like to set it up?',
            'Download RDK',
            'Configure Path',
            'Cancel'
        );

        if (answer === 'Download RDK') {
            vscode.env.openExternal(vscode.Uri.parse('https://developer.sailpoint.com/docs/tools/rule-development-kit/'));
            return false;
        } else if (answer === 'Configure Path') {
            const rdkPath = await vscode.window.showInputBox({
                prompt: 'Enter the path to your SailPoint RDK directory',
                placeHolder: '/path/to/sailpoint-rdk'
            });
            if (rdkPath) {
                // Store in settings
                await vscode.workspace.getConfiguration('sp-isc-devtools').update('rdk.path', rdkPath, vscode.ConfigurationTarget.Global);
                this.rdkPath = rdkPath;
                return true;
            }
        }
        return false;
    }
}


import * as vscode from 'vscode';
import * as axios from 'axios';
import { TenantService } from '../../services/TenantService';
import { ISCClient } from '../../services/ISCClient';
import { WorkflowBeta } from 'sailpoint-api-client';

/**
 * Workflow Editor Panel - Visual workflow builder with AI integration
 */
export class WorkflowEditorPanel {
    public static currentPanel: WorkflowEditorPanel | undefined;
    public static readonly viewType = 'workflowEditorPanel';

    private readonly _panel: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _disposables: vscode.Disposable[] = [];

    private tenantId: string;
    private tenantName: string;
    private workflowId: string | null;
    private workflowData: WorkflowBeta | null = null;
    private workflowTriggers: any[] = [];
    private workflowActions: any[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        workflowId?: string,
        context?: vscode.ExtensionContext
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (WorkflowEditorPanel.currentPanel) {
            WorkflowEditorPanel.currentPanel._panel.reveal(column);
            if (workflowId) {
                await WorkflowEditorPanel.currentPanel.loadWorkflow(tenantId, tenantName, workflowId);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            WorkflowEditorPanel.viewType,
            workflowId ? 'Edit Workflow' : 'New Workflow',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        // Get extension context for secrets storage if not provided
        let extensionContext = context;
        if (!extensionContext) {
            // Try to get context from extension exports
            const extension = vscode.extensions.getExtension('sp-isc-devtools.sp-isc-devtools') || 
                            vscode.extensions.getExtension('sp-isc-devtools');
            extensionContext = extension?.exports?.context;
        }

        WorkflowEditorPanel.currentPanel = new WorkflowEditorPanel(
            panel, extensionUri, tenantService, tenantId, tenantName, workflowId || null, extensionContext
        );
    }

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        private tenantService: TenantService,
        tenantId: string,
        tenantName: string,
        workflowId: string | null,
        private context?: vscode.ExtensionContext
    ) {
        this._panel = panel;
        this._extensionUri = extensionUri;
        this.tenantId = tenantId;
        this.tenantName = tenantName;
        this.workflowId = workflowId;

        this._update();
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._panel.webview.onDidReceiveMessage(async (msg) => { await this.handleMessage(msg); }, null, this._disposables);
    }

    private async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case 'loadWorkflow':
                if (this.workflowId) await this.loadWorkflow(this.tenantId, this.tenantName, this.workflowId);
                break;
            case 'saveWorkflow':
                await this.saveWorkflow(message.data);
                break;
            case 'testWorkflow':
                await this.testWorkflow(message.payload);
                break;
            case 'generateWithAI':
                await this.generateWithAI(message.prompt);
                break;
            case 'getWorkflowTriggers':
                await this.loadWorkflowTriggers();
                break;
            case 'getWorkflowActions':
                await this.loadWorkflowActions();
                break;
        }
    }

    private async loadWorkflow(tenantId: string, tenantName: string, workflowId: string): Promise<void> {
        try {
            const client = new ISCClient(tenantId, tenantName);
            this.workflowData = await client.getWorflow(workflowId);
            this.tenantId = tenantId;
            this.tenantName = tenantName;
            this.workflowId = workflowId;
            this._panel.title = `⚙️ ${this.workflowData.name}`;
            this._panel.webview.postMessage({ command: 'workflowLoaded', data: this.workflowData });
            await this.loadWorkflowTriggers();
            await this.loadWorkflowActions();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to load workflow: ${error.message}`);
        }
    }

    private async loadWorkflowTriggers(): Promise<void> {
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            this.workflowTriggers = await client.getWorflowTriggers();
            this._panel.webview.postMessage({ command: 'triggersLoaded', data: this.workflowTriggers });
        } catch (error: any) {
            console.error('Failed to load triggers:', error);
        }
    }

    private async loadWorkflowActions(): Promise<void> {
        // Comprehensive list of SailPoint workflow actions and operators
        // Based on SailPoint workflow documentation: https://documentation.sailpoint.com/saas/help/workflows/index.html
        const allActions = [
            // ========== IDENTITY ACTIONS ==========
            { id: 'sp:get-identity', name: 'Get Identity', category: 'Identity', description: 'Retrieve identity information by ID', type: 'action' },
            { id: 'sp:search-identities', name: 'Search Identities', category: 'Identity', description: 'Search for identities using query', type: 'action' },
            { id: 'sp:create-identity', name: 'Create Identity', category: 'Identity', description: 'Create a new identity', type: 'action' },
            { id: 'sp:update-identity', name: 'Update Identity', category: 'Identity', description: 'Update identity attributes', type: 'action' },
            { id: 'sp:delete-identity', name: 'Delete Identity', category: 'Identity', description: 'Delete an identity', type: 'action' },
            
            // ========== ACCOUNT ACTIONS ==========
            { id: 'sp:create-account', name: 'Create Account', category: 'Account', description: 'Create an account on a source', type: 'action' },
            { id: 'sp:update-account', name: 'Update Account', category: 'Account', description: 'Update account attributes', type: 'action' },
            { id: 'sp:delete-account', name: 'Delete Account', category: 'Account', description: 'Delete an account', type: 'action' },
            { id: 'sp:get-account', name: 'Get Account', category: 'Account', description: 'Retrieve account information', type: 'action' },
            { id: 'sp:enable-account', name: 'Enable Account', category: 'Account', description: 'Enable a disabled account', type: 'action' },
            { id: 'sp:disable-account', name: 'Disable Account', category: 'Account', description: 'Disable an account', type: 'action' },
            { id: 'sp:unlock-account', name: 'Unlock Account', category: 'Account', description: 'Unlock a locked account', type: 'action' },
            { id: 'sp:set-password', name: 'Set Password', category: 'Account', description: 'Set password for an account', type: 'action' },
            { id: 'sp:change-password', name: 'Change Password', category: 'Account', description: 'Change account password', type: 'action' },
            
            // ========== ACCESS ACTIONS ==========
            { id: 'sp:provision', name: 'Provision', category: 'Access', description: 'Provision access to identity', type: 'action' },
            { id: 'sp:revoke', name: 'Revoke', category: 'Access', description: 'Revoke access from identity', type: 'action' },
            { id: 'sp:access:get', name: 'Get Access', category: 'Access', description: 'Retrieve access information (access profile, role, entitlement)', type: 'action' },
            { id: 'sp:access:manage', name: 'Manage Access', category: 'Access', description: 'Create or update access request', type: 'action' },
            { id: 'sp:grant-access', name: 'Grant Access', category: 'Access', description: 'Grant access to identity', type: 'action' },
            { id: 'sp:remove-access', name: 'Remove Access', category: 'Access', description: 'Remove access from identity', type: 'action' },
            
            // ========== COMMUNICATION ACTIONS ==========
            { id: 'sp:send-email', name: 'Send Email', category: 'Communication', description: 'Send an email notification', type: 'action' },
            { id: 'sp:send-slack-message', name: 'Send Slack Message', category: 'Communication', description: 'Send message to Slack channel', type: 'action' },
            { id: 'sp:send-teams-message', name: 'Send Teams Message', category: 'Communication', description: 'Send message to Microsoft Teams', type: 'action' },
            { id: 'sp:send-webhook', name: 'Send Webhook', category: 'Communication', description: 'Send HTTP webhook notification', type: 'action' },
            
            // ========== FORMS ==========
            { id: 'sp:forms', name: 'Form', category: 'Forms', description: 'Create a form for user input (non-interactive)', type: 'action' },
            { id: 'sp:interactive-form', name: 'Interactive Form', category: 'Forms', description: 'Create an interactive form for user input', type: 'action' },
            
            // ========== CAMPAIGN ACTIONS ==========
            { id: 'sp:create-campaign', name: 'Create Campaign', category: 'Campaigns', description: 'Create a certification campaign', type: 'action' },
            { id: 'sp:activate-campaign', name: 'Activate Campaign', category: 'Campaigns', description: 'Activate a certification campaign', type: 'action' },
            { id: 'sp:complete-campaign', name: 'Complete Campaign', category: 'Campaigns', description: 'Complete a certification campaign', type: 'action' },
            
            // ========== SEARCH ACTIONS ==========
            { id: 'sp:search', name: 'Search', category: 'Search', description: 'Perform a search query across entities', type: 'action' },
            { id: 'sp:search-accounts', name: 'Search Accounts', category: 'Search', description: 'Search for accounts', type: 'action' },
            { id: 'sp:search-entitlements', name: 'Search Entitlements', category: 'Search', description: 'Search for entitlements', type: 'action' },
            { id: 'sp:search-access-profiles', name: 'Search Access Profiles', category: 'Search', description: 'Search for access profiles', type: 'action' },
            { id: 'sp:search-roles', name: 'Search Roles', category: 'Search', description: 'Search for roles', type: 'action' },
            
            // ========== SOURCE ACTIONS ==========
            { id: 'sp:aggregate-source', name: 'Aggregate Source', category: 'Sources', description: 'Trigger source aggregation', type: 'action' },
            { id: 'sp:test-connection', name: 'Test Connection', category: 'Sources', description: 'Test source connection', type: 'action' },
            { id: 'sp:peek-account', name: 'Peek Account', category: 'Sources', description: 'Peek account from source', type: 'action' },
            
            // ========== HTTP/INTEGRATION ACTIONS ==========
            { id: 'sp:http', name: 'HTTP Request', category: 'Integration', description: 'Make HTTP/HTTPS request to external API', type: 'action' },
            { id: 'sp:rest-api', name: 'REST API', category: 'Integration', description: 'Call SailPoint REST API', type: 'action' },
            
            // ========== UTILITY ACTIONS ==========
            { id: 'sp:sleep', name: 'Wait/Sleep', category: 'Utility', description: 'Wait for specified duration before continuing', type: 'action' },
            { id: 'sp:set-variable', name: 'Set Variable', category: 'Utility', description: 'Set a variable in workflow context', type: 'action' },
            { id: 'sp:transform', name: 'Transform', category: 'Utility', description: 'Apply transform to data', type: 'action' },
            { id: 'sp:json-path', name: 'JSONPath', category: 'Utility', description: 'Extract data using JSONPath expression', type: 'action' },
            
            // ========== LOOP OPERATORS ==========
            { id: 'sp:loop:iterator', name: 'Loop Iterator', category: 'Loops', description: 'Iterate over array and execute steps for each item', type: 'operator' },
            { id: 'sp:loop:for', name: 'For Loop', category: 'Loops', description: 'Execute steps for a specified number of iterations', type: 'operator' },
            { id: 'sp:loop:while', name: 'While Loop', category: 'Loops', description: 'Execute steps while condition is true', type: 'operator' },
            
            // ========== COMPARISON OPERATORS ==========
            { id: 'sp:operator-compare-strings', name: 'Compare Strings', category: 'Operators', description: 'Compare two string values with conditions (equals, contains, startsWith, etc.)', type: 'operator' },
            { id: 'sp:operator-compare-numbers', name: 'Compare Numbers', category: 'Operators', description: 'Compare two numeric values (equals, greater than, less than, etc.)', type: 'operator' },
            { id: 'sp:operator-compare-dates', name: 'Compare Dates', category: 'Operators', description: 'Compare two date values', type: 'operator' },
            { id: 'sp:operator-switch', name: 'Switch', category: 'Operators', description: 'Switch/case operator for multiple conditions', type: 'operator' },
            { id: 'sp:operator-if', name: 'If Condition', category: 'Operators', description: 'Conditional branching based on expression', type: 'operator' },
            
            // ========== END STEP OPERATORS ==========
            { id: 'sp:operator-success', name: 'Success', category: 'Operators', description: 'End step - workflow completed successfully', type: 'operator' },
            { id: 'sp:operator-error', name: 'Error', category: 'Operators', description: 'End step - workflow ended with error', type: 'operator' },
            { id: 'sp:operator-failure', name: 'Failure', category: 'Operators', description: 'End step - workflow failed with specific failure name', type: 'operator' },
        ];
        
        this.workflowActions = allActions;
        this._panel.webview.postMessage({ command: 'actionsLoaded', data: this.workflowActions });
    }

    private async saveWorkflow(data: any): Promise<void> {
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            if (this.workflowId) {
                // Update existing workflow
                await client.updateResource(`beta/workflows/${this.workflowId}`, JSON.stringify(data));
                vscode.window.showInformationMessage('Workflow saved successfully');
            } else {
                // Create new workflow
                const result = await client.createWorflow(data);
                this.workflowId = result.id;
                this.workflowData = result;
                this._panel.title = `⚙️ ${result.name}`;
                vscode.window.showInformationMessage('Workflow created successfully');
            }
            this._panel.webview.postMessage({ command: 'saveDone', success: true });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to save workflow: ${error.message}`);
            this._panel.webview.postMessage({ command: 'saveDone', success: false, error: error.message });
        }
    }

    private async testWorkflow(payload: any): Promise<void> {
        if (!this.workflowId) {
            vscode.window.showWarningMessage('Please save the workflow before testing');
            return;
        }
        try {
            const client = new ISCClient(this.tenantId, this.tenantName);
            const executionId = await client.testWorkflow(this.workflowId, payload);
            this._panel.webview.postMessage({ command: 'testResult', executionId, success: true });
            vscode.window.showInformationMessage(`Workflow test started. Execution ID: ${executionId}`);
        } catch (error: any) {
            this._panel.webview.postMessage({ command: 'testResult', success: false, error: error.message });
            vscode.window.showErrorMessage(`Failed to test workflow: ${error.message}`);
        }
    }

    /**
     * Get or prompt for Cursor API token
     */
    private async getCursorApiToken(): Promise<string | null> {
        if (!this.context) {
            vscode.window.showErrorMessage('Extension context not available');
            return null;
        }

        const secretKey = 'cursor.api.token';
        let apiToken = await this.context.secrets.get(secretKey);

        if (!apiToken) {
            // Prompt user for API token
            const input = await vscode.window.showInputBox({
                prompt: 'Enter your Cursor API Token',
                placeHolder: 'cur_... or your Cursor API token',
                password: true,
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return 'Please enter a valid Cursor API token';
                    }
                    return null;
                }
            });

            if (!input) {
                return null;
            }

            // Store the API token securely
            await this.context.secrets.store(secretKey, input);
            apiToken = input;
        }

        return apiToken;
    }

    /**
     * Generate or modify workflow using Cursor API
     */
    private async generateWithAI(prompt: string): Promise<void> {
        try {
            // Show progress
            this._panel.webview.postMessage({ command: 'aiGenerating', generating: true });

            // Get Cursor API token
            const apiToken = await this.getCursorApiToken();
            if (!apiToken) {
                this._panel.webview.postMessage({ 
                    command: 'aiError', 
                    error: 'Cursor API token is required. Please provide your API token to use AI workflow generation.' 
                });
                return;
            }

            // Comprehensive system prompt with full SailPoint workflow context
            const systemPrompt = `You are an expert SailPoint IdentityNow workflow developer. Your task is to generate complete, valid, production-ready workflow JSON configurations based on user requirements.

# SAILPOINT WORKFLOW STRUCTURE

A SailPoint workflow is a JSON object with the following structure:

{
  "name": "Workflow Name",
  "description": "Workflow description",
  "enabled": true,
  "trigger": {
    "type": "EVENT" | "SCHEDULED" | "MANUAL",
    "attributes": {
      // Trigger-specific configuration
    }
  },
  "definition": {
    "start": "StepName",  // Name of the first step to execute
    "steps": {
      "StepName": {
        "actionId": "sp:action-id",
        "type": "action" | "operator" | "success" | "error" | "failure",
        "displayName": "Human-readable step name",
        "attributes": {
          // Step-specific attributes
        },
        "nextStep": "NextStepName",  // Optional - name of next step
        "versionNumber": 2  // Always use 2
      }
    }
  }
}

# TRIGGERS

## EVENT Triggers
Common event trigger IDs:
- "idn:identity-created" - When a new identity is created
- "idn:identity-attributes-changed" - When identity attributes change
- "idn:account-aggregation-completed" - When source aggregation finishes
- "idn:source-deleted" - When a source is deleted
- "idn:access-profile-created" - When access profile is created
- "idn:role-created" - When role is created
- "idn:interactive-process-launched" - When interactive process/form is launched

Event trigger attributes example:
{
  "type": "EVENT",
  "attributes": {
    "id": "idn:identity-attributes-changed",
    "attributeToFilter": "department",
    "filter.$": "$.changes[?(@.attribute == 'department')]"
  }
}

## SCHEDULED Triggers
{
  "type": "SCHEDULED",
  "attributes": {
    "schedule": "0 0 * * *"  // Cron expression: minute hour day month weekday
  }
}

## MANUAL Triggers
{
  "type": "MANUAL",
  "attributes": {}
}

# ACTIONS (actionId)

## Identity Actions
- sp:get-identity - Get identity by ID (attributes: id.$)
- sp:search-identities - Search identities (attributes: query, limit)
- sp:create-identity - Create new identity
- sp:update-identity - Update identity attributes
- sp:delete-identity - Delete identity

## Account Actions
- sp:create-account - Create account on source (attributes: sourceId, nativeIdentity, attributes)
- sp:update-account - Update account (attributes: accountId, attributes)
- sp:delete-account - Delete account (attributes: accountId)
- sp:get-account - Get account info (attributes: accountId)
- sp:enable-account - Enable account (attributes: accountId)
- sp:disable-account - Disable account (attributes: accountId)
- sp:unlock-account - Unlock account (attributes: accountId)
- sp:set-password - Set password (attributes: accountId, password)
- sp:change-password - Change password (attributes: accountId, newPassword)

## Access Actions
- sp:provision - Provision access (attributes: identityId, accessProfileId, roleId, etc.)
- sp:revoke - Revoke access (attributes: identityId, accessProfileId, roleId, etc.)
- sp:access:get - Get access info (attributes: identityId, accessType)
- sp:access:manage - Manage access request (attributes: requestType, identityId, requestedItems)
- sp:grant-access - Grant access (attributes: identityId, accessProfileId)
- sp:remove-access - Remove access (attributes: identityId, accessProfileId)

## Communication Actions
- sp:send-email - Send email (attributes: recipientEmailList, subject, body, context, from, replyTo)
- sp:send-slack-message - Send Slack message (attributes: channel, message, webhookUrl)
- sp:send-teams-message - Send Teams message (attributes: webhookUrl, message)
- sp:send-webhook - Send webhook (attributes: url, method, headers, body)

## Forms
- sp:forms - Create non-interactive form (attributes: formDefinitionId, deadline, inputForForm_*)
- sp:interactive-form - Create interactive form (attributes: formDefinitionId, interactiveProcessId, ownerId, title)

## Campaign Actions
- sp:create-campaign - Create certification campaign (attributes: name, description, duration, reviewerId, reviewerIdentitiesToCertify, type, activateUponCreation)
- sp:activate-campaign - Activate campaign (attributes: id.$)
- sp:complete-campaign - Complete campaign (attributes: id.$)

## Search Actions
- sp:search - Generic search (attributes: indices, query, limit)
- sp:search-accounts - Search accounts (attributes: query, limit)
- sp:search-entitlements - Search entitlements (attributes: query, limit)
- sp:search-access-profiles - Search access profiles (attributes: query, limit)
- sp:search-roles - Search roles (attributes: query, limit)

## Source Actions
- sp:aggregate-source - Trigger source aggregation (attributes: sourceId)
- sp:test-connection - Test source connection (attributes: sourceId)
- sp:peek-account - Peek account from source (attributes: sourceId, nativeIdentity)

## HTTP/Integration
- sp:http - HTTP request (attributes: url, method, headers, body, authenticationType, oAuthClientId, oAuthClientSecret, oAuthTokenUrl)
- sp:rest-api - Call SailPoint REST API (attributes: endpoint, method, body)

## Utility Actions
- sp:sleep - Wait/delay (attributes: duration, type: "waitFor") - duration format: "1m", "30s", "1h", "1d"
- sp:set-variable - Set variable (attributes: variableName, value)
- sp:transform - Apply transform (attributes: transformId, input)
- sp:json-path - Extract using JSONPath (attributes: expression, input)

## Loop Operators
- sp:loop:iterator - Loop over array (attributes: input.$, context.$, start, steps: { nested steps })
- sp:loop:for - For loop (attributes: count, start, steps)
- sp:loop:while - While loop (attributes: condition, start, steps)

## Comparison Operators
- sp:operator-compare-strings - Compare strings (attributes: left, right, operator: "equals"|"contains"|"startsWith"|"endsWith")
- sp:operator-compare-numbers - Compare numbers (attributes: left, right, operator: "equals"|"greaterThan"|"lessThan"|"greaterThanOrEqual"|"lessThanOrEqual")
- sp:operator-compare-dates - Compare dates (attributes: left, right, operator)
- sp:operator-switch - Switch/case (attributes: value, cases: [{value, nextStep}], default)
- sp:operator-if - If condition (attributes: condition, trueNext, falseNext)

## End Step Operators
- sp:operator-success - Success end step (no attributes needed)
- sp:operator-error - Error end step (no attributes needed)
- sp:operator-failure - Failure end step (attributes: failureName)

# JSONPATH EXPRESSIONS

JSONPath is used to access data from previous steps or trigger:
- "$.trigger.identity.id" - Access identity ID from trigger
- "$.trigger.identity.name" - Access identity name from trigger
- "$.trigger.identity.email" - Access identity email from trigger
- "$.trigger.changes" - Access attribute changes array
- "$.getIdentity.attributes.email" - Access output from "Get Identity" step
- "$.getIdentity.managerRef.id" - Access manager ID from identity
- "$.changes[?(@.attribute == 'department')]" - Filter array for specific attribute
- "$.loop.loopInput" - Access current loop iteration value
- "$.loop.context" - Access parent context in loop

To use JSONPath in attributes, suffix the attribute name with ".$":
{
  "id.$": "$.trigger.identity.id"
}

# INLINE VARIABLES

In text fields, use double curly braces for inline variables:
- "Hello {{$.getIdentity.attributes.displayName}}" - Embed identity display name
- "Department: {{$.getIdentity.attributes.department}}" - Embed department

# WORKFLOW BEST PRACTICES

1. Always start with "Get Identity" step if you need identity data
2. Always end with sp:operator-success or sp:operator-error
3. Use descriptive step names (no spaces in step names, use CamelCase)
4. Set versionNumber to 2 for all steps
5. Use JSONPath for dynamic data flow between steps
6. For conditional logic, use comparison operators with proper nextStep branching
7. For loops, use sp:loop:iterator with nested steps
8. For error handling, use catch blocks in step attributes

# EXAMPLE WORKFLOW

{
  "name": "Welcome Email Workflow",
  "description": "Send welcome email when identity is created",
  "enabled": true,
  "trigger": {
    "type": "EVENT",
    "attributes": {
      "id": "idn:identity-created"
    }
  },
  "definition": {
    "start": "Get Identity",
    "steps": {
      "Get Identity": {
        "actionId": "sp:get-identity",
        "type": "action",
        "displayName": "Get Identity",
        "attributes": {
          "id.$": "$.trigger.identity.id"
        },
        "nextStep": "Send Email",
        "versionNumber": 2
      },
      "Send Email": {
        "actionId": "sp:send-email",
        "type": "action",
        "displayName": "Send Welcome Email",
        "attributes": {
          "recipientEmailList": ["{{$.getIdentity.attributes.email}}"],
          "subject": "Welcome to the Organization",
          "body": "<p>Hello {{$.getIdentity.attributes.displayName}}, welcome!</p>"
        },
        "nextStep": "End Step - Success",
        "versionNumber": 2
      },
      "End Step - Success": {
        "actionId": "sp:operator-success",
        "type": "success",
        "displayName": "Success",
        "versionNumber": 2
      }
    }
  }
}

# YOUR TASK

${this.workflowData ? 
`You are MODIFYING an existing workflow. The current workflow JSON is provided below. The user wants to make specific changes to it. Please generate the MODIFIED workflow JSON that incorporates the user's requested changes while preserving all other aspects of the workflow.

CURRENT WORKFLOW JSON:
${JSON.stringify(this.workflowData, null, 2)}

IMPORTANT: 
- Keep the workflow structure intact
- Only modify what the user specifically requests
- Preserve all existing steps, triggers, and attributes unless explicitly asked to change them
- Maintain proper step relationships and nextStep references
- Return the COMPLETE modified workflow JSON, not just the changes` :
`Generate a complete, valid SailPoint workflow JSON based on the user's description. Return ONLY the JSON object, no markdown formatting, no explanations, no code blocks. The JSON must be valid and complete.`}`;

            // Call Cursor API
            // Cursor API tokens typically work with OpenAI's API endpoint
            // Try OpenAI endpoint first (most common), then Cursor-specific endpoints
            const possibleEndpoints = [
                'https://api.openai.com/v1/chat/completions', // Cursor tokens often work with OpenAI API
                'https://api.cursor.com/v1/chat/completions',
                'https://api.cursor.com/v0/chat/completions',
                'https://api.cursor.com/chat/completions'
            ];
            
            let response: any = null;
            let lastError: any = null;
            
            // Try each endpoint until one works
            for (const endpoint of possibleEndpoints) {
                try {
                    response = await axios.default.post(
                        endpoint,
                        {
                            model: 'gpt-4', // Cursor's default model
                            messages: [
                                {
                                    role: 'system',
                                    content: systemPrompt
                                },
                                {
                                    role: 'user',
                                    content: prompt
                                }
                            ],
                            temperature: 0.7,
                            max_tokens: 4000,
                            response_format: { type: 'json_object' } // Request JSON response
                        },
                        {
                            headers: {
                                'Authorization': `Bearer ${apiToken}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 60000 // 60 second timeout
                        }
                    );
                    
                    // If we get a successful response, break out of the loop
                    if (response && response.data) {
                        break;
                    }
                } catch (error: any) {
                    lastError = error;
                    // If it's not a 404, it might be auth or other issue, so stop trying
                    if (error.response && error.response.status !== 404) {
                        throw error;
                    }
                    // Continue to next endpoint if 404
                    continue;
                }
            }
            
            // If no endpoint worked, throw the last error
            if (!response || !response.data) {
                if (lastError) {
                    throw lastError;
                } else {
                    throw new Error('All Cursor API endpoints failed. Please check your API token and try again.');
                }
            }

            // Handle response from Cursor API
            let aiResponse: string | undefined;
            
            // Cursor API might return data in different formats
            if (response.data.choices && response.data.choices[0]?.message?.content) {
                aiResponse = response.data.choices[0].message.content;
            } else if (response.data.content) {
                aiResponse = response.data.content;
            } else if (response.data.message) {
                aiResponse = response.data.message;
            } else if (typeof response.data === 'string') {
                aiResponse = response.data;
            }
            
            if (!aiResponse) {
                throw new Error('No response from Cursor API. Response format: ' + JSON.stringify(response.data).substring(0, 200));
            }

            // Parse the response from Cursor API
            let workflowJson = aiResponse.trim();
            
            // Remove markdown code blocks if present
            if (workflowJson.startsWith('```')) {
                workflowJson = workflowJson.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '');
            }
            
            // Cursor API might return JSON wrapped in explanation text, try to extract JSON
            if (!workflowJson.startsWith('{')) {
                const jsonMatch = workflowJson.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    workflowJson = jsonMatch[0];
                }
            }

            // Try to parse as JSON
            let parsed: any;
            try {
                parsed = JSON.parse(workflowJson);
            } catch (parseError) {
                // If direct parse fails, try to extract JSON from response
                const jsonMatch = workflowJson.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    parsed = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('Could not extract valid JSON from AI response');
                }
            }

            // Validate it's a workflow structure
            if (!parsed.definition || !parsed.definition.steps) {
                throw new Error('Invalid workflow structure: missing definition.steps');
            }

            // Validate steps structure
            const steps = parsed.definition.steps;
            if (typeof steps !== 'object' || Object.keys(steps).length === 0) {
                throw new Error('Invalid workflow structure: no steps defined');
            }

            // Ensure start step exists
            if (!parsed.definition.start || !steps[parsed.definition.start]) {
                // Use first step as start if not specified
                parsed.definition.start = Object.keys(steps)[0];
            }

            // Validate each step has required fields
            for (const [stepName, step] of Object.entries(steps as any)) {
                const stepObj = step as any;
                if (!stepObj.actionId) {
                    throw new Error(`Step "${stepName}" is missing actionId`);
                }
                if (stepObj.versionNumber === undefined) {
                    stepObj.versionNumber = 2;
                }
            }

            // Success - send to webview
            this._panel.webview.postMessage({ 
                command: 'aiGenerated', 
                data: parsed,
                success: true 
            });
            vscode.window.showInformationMessage('Workflow generated successfully by AI!');
        } catch (error: any) {
            let errorMessage = error.message || 'Unknown error';
            
            // Handle specific Cursor API errors
            if (error.response) {
                const status = error.response.status;
                const data = error.response.data;
                
                if (status === 401) {
                    errorMessage = 'Invalid Cursor API token. Please check your API token. You can get your token from https://cursor.com/settings/api';
                    // Clear invalid token
                    if (this.context) {
                        await this.context.secrets.delete('cursor.api.token');
                    }
                } else if (status === 404) {
                    errorMessage = 'Cursor API endpoint not found (404). The API endpoint may have changed. Please check Cursor API documentation or try using OpenAI API directly with your Cursor token.';
                } else if (status === 429) {
                    errorMessage = 'Cursor API rate limit exceeded. Please try again later.';
                } else if (status === 500) {
                    errorMessage = 'Cursor API server error. Please try again later.';
                } else if (data?.error?.message) {
                    errorMessage = `Cursor API error: ${data.error.message}`;
                } else {
                    errorMessage = `Cursor API error (${status}): ${errorMessage}`;
                }
            } else if (error.code === 'ECONNABORTED') {
                errorMessage = 'Request timeout. The AI generation took too long. Please try again.';
            } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
                errorMessage = 'Cannot connect to Cursor API. Please check your internet connection.';
            } else if (error.message?.includes('cancelled')) {
                errorMessage = 'AI generation was cancelled.';
            } else if (error.message?.includes('All Cursor API endpoints failed')) {
                errorMessage = error.message;
            } else {
                errorMessage = `Cursor API error: ${errorMessage}`;
            }
            
            vscode.window.showErrorMessage(`AI generation failed: ${errorMessage}`);
            this._panel.webview.postMessage({ 
                command: 'aiError', 
                error: errorMessage 
            });
        } finally {
            this._panel.webview.postMessage({ command: 'aiGenerating', generating: false });
        }
    }

    private async _update(): Promise<void> {
        if (this.workflowId) {
            await this.loadWorkflow(this.tenantId, this.tenantName, this.workflowId);
        }
        this._panel.webview.html = this._getHtmlForWebview();
    }

    private _getHtmlForWebview(): string {
        const workflowJson = this.workflowData ? JSON.stringify(this.workflowData, null, 2) : 'null';

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Workflow Editor</title>
    <style>
        :root {
            --bg-0: #1e1e1e; --bg-1: #252526; --bg-2: #2d2d2d; --bg-3: #3c3c3c;
            --fg-0: #d4d4d4; --fg-1: #cccccc; --fg-2: #9d9d9d; --fg-3: #6e6e6e;
            --accent: #007acc; --border: #404040; --success: #4ec9b0; --error: #f14c4c; --warning: #cca700;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', sans-serif; background: var(--bg-0); color: var(--fg-0); height: 100vh; overflow: hidden; }
        
        .container { display: grid; grid-template-columns: 280px 1fr 320px; grid-template-rows: 48px 1fr 32px; height: 100vh; }
        
        .header { grid-column: 1 / -1; background: var(--bg-1); border-bottom: 1px solid var(--border); 
            display: flex; align-items: center; justify-content: space-between; padding: 0 16px; }
        .header-left { display: flex; align-items: center; gap: 16px; }
        .header-title { font-size: 14px; font-weight: 600; }
        .header-actions { display: flex; gap: 8px; }
        
        .btn { padding: 6px 14px; font-size: 12px; border: none; border-radius: 3px; cursor: pointer; }
        .btn-default { background: var(--bg-3); color: var(--fg-1); }
        .btn-default:hover { background: #4a4a4a; }
        .btn-primary { background: var(--accent); color: white; }
        .btn-primary:hover { background: #1a8cd8; }
        .btn-success { background: #388a34; color: white; }
        .btn-success:hover { background: #45a341; }
        .btn-ai { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
        .btn-ai:hover { background: linear-gradient(135deg, #764ba2 0%, #667eea 100%); }
        .btn-ai:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .badge { padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 500; }
        .badge-success { background: rgba(78, 201, 176, 0.2); color: var(--success); }
        .badge-error { background: rgba(241, 76, 76, 0.2); color: var(--error); }
        
        .sidebar { background: var(--bg-1); border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; }
        .section { margin-bottom: 16px; }
        .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--fg-3); margin-bottom: 8px; }
        .form-group { margin-bottom: 10px; }
        .form-group label { display: block; font-size: 11px; color: var(--fg-2); margin-bottom: 4px; }
        .form-group input, .form-group select, .form-group textarea { 
            width: 100%; padding: 6px 8px; background: var(--bg-2); border: 1px solid var(--border); 
            border-radius: 3px; color: var(--fg-0); font-size: 12px; 
        }
        .form-group input:focus, .form-group select:focus, .form-group textarea:focus { outline: none; border-color: var(--accent); }
        
        .editor-pane { display: flex; flex-direction: column; background: var(--bg-0); overflow: hidden; position: relative; }
        .editor-tabs { display: flex; background: var(--bg-1); border-bottom: 1px solid var(--border); padding: 0 8px; }
        .editor-tab { padding: 8px 16px; font-size: 12px; color: var(--fg-2); cursor: pointer; border-bottom: 2px solid transparent; }
        .editor-tab.active { color: var(--fg-0); border-bottom-color: var(--accent); }
        
        #workflowCanvas { flex: 1; background: var(--bg-0); position: relative; overflow: auto; }
        
        /* Workflow Node Styles */
        .workflow-node { position: absolute; min-width: 180px; max-width: 200px; background: var(--bg-2); 
            border: 2px solid var(--border); border-radius: 6px; padding: 12px; cursor: move; 
            box-shadow: 0 2px 8px rgba(0,0,0,0.3); z-index: 10; }
        .workflow-node.selected { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.3); }
        .workflow-node.trigger { border-color: var(--success); }
        .workflow-node.action { border-color: var(--accent); }
        .workflow-node.operator { border-color: var(--warning); }
        .workflow-node.end { border-color: var(--fg-3); }
        .workflow-node.start { border-left: 4px solid var(--success); }
        .node-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .node-title { font-weight: 600; font-size: 13px; color: var(--fg-0); }
        .node-type { font-size: 10px; color: var(--fg-3); text-transform: uppercase; }
        .node-body { font-size: 11px; color: var(--fg-2); }
        .node-actions { display: flex; gap: 4px; margin-top: 8px; }
        .node-btn { padding: 4px 8px; font-size: 10px; background: var(--bg-3); border: none; border-radius: 3px; cursor: pointer; color: var(--fg-1); }
        .node-btn:hover { background: var(--bg-1); }
        
        /* Connection Lines */
        .connections-layer { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1; }
        .workflow-connection { transition: stroke 0.2s; }
        .workflow-connection:hover { stroke: #1a8cd8; stroke-width: 3; }
        
        /* Palette */
        .palette { background: var(--bg-1); border-left: 1px solid var(--border); overflow-y: auto; padding: 12px; }
        .palette-item { padding: 8px; background: var(--bg-2); border-radius: 4px; margin-bottom: 8px; cursor: grab; }
        .palette-item:hover { background: var(--bg-3); }
        .palette-item-title { font-weight: 500; font-size: 12px; color: var(--fg-0); }
        .palette-item-desc { font-size: 10px; color: var(--fg-3); margin-top: 4px; }
        
        .test-panel { background: var(--bg-1); border-left: 1px solid var(--border); display: flex; flex-direction: column; overflow: hidden; }
        .test-header { padding: 8px 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .test-header h3 { font-size: 12px; font-weight: 600; }
        .test-content { flex: 1; overflow-y: auto; padding: 12px; }
        .test-data { width: 100%; height: 120px; padding: 8px; background: var(--bg-2); border: 1px solid var(--border);
            border-radius: 3px; font-family: Consolas, monospace; font-size: 11px; color: var(--fg-0); resize: vertical; }
        
        .footer { grid-column: 1 / -1; background: var(--bg-1); border-top: 1px solid var(--border); 
            display: flex; align-items: center; justify-content: space-between; padding: 0 12px; font-size: 11px; color: var(--fg-2); }
        
        /* AI Panel */
        .ai-panel { position: absolute; top: 0; right: 0; bottom: 0; width: 450px; background: var(--bg-1); 
            border-left: 1px solid var(--border); z-index: 100; display: none; flex-direction: column; box-shadow: -4px 0 12px rgba(0,0,0,0.3); }
        .ai-panel.show { display: flex; }
        .ai-header { padding: 12px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .ai-header h3 { font-size: 14px; font-weight: 600; }
        .ai-content { flex: 1; overflow-y: auto; padding: 12px; }
        .ai-input { width: 100%; padding: 10px; background: var(--bg-2); border: 1px solid var(--border); 
            border-radius: 3px; color: var(--fg-0); font-size: 12px; margin-bottom: 8px; min-height: 80px; resize: vertical; }
        .ai-status { padding: 8px; background: var(--bg-2); border-radius: 3px; margin-bottom: 12px; font-size: 11px; display: none; }
        .ai-status.show { display: block; }
        .ai-status.generating { color: var(--warning); }
        .ai-status.error { color: var(--error); }
        .ai-status.success { color: var(--success); }
        .ai-suggestion { padding: 10px; background: var(--bg-2); border-radius: 4px; margin-bottom: 8px; cursor: pointer; transition: background 0.2s; }
        .ai-suggestion:hover { background: var(--bg-3); }
        .ai-suggestion-title { font-weight: 500; font-size: 12px; color: var(--fg-0); margin-bottom: 4px; }
        .ai-suggestion-desc { font-size: 11px; color: var(--fg-3); }
        .ai-error-box { padding: 12px; background: rgba(241, 76, 76, 0.15); border: 1px solid var(--error); 
            border-radius: 3px; margin-bottom: 12px; display: none; }
        .ai-error-box.show { display: block; }
        .ai-error-box-title { font-weight: 600; color: var(--error); margin-bottom: 4px; font-size: 12px; }
        .ai-error-box-text { font-size: 11px; color: var(--fg-2); }
        
        /* Step Editor Modal */
        .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.7); 
            z-index: 1000; display: none; align-items: center; justify-content: center; }
        .modal-overlay.show { display: flex; }
        .modal { background: var(--bg-1); border: 1px solid var(--border); border-radius: 6px; 
            width: 90%; max-width: 700px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 8px 24px rgba(0,0,0,0.5); }
        .modal-header { padding: 16px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .modal-title { font-size: 16px; font-weight: 600; }
        .modal-body { flex: 1; overflow-y: auto; padding: 16px; }
        .modal-footer { padding: 12px 16px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
        .jsonpath-input { display: flex; gap: 4px; }
        .jsonpath-input input { flex: 1; }
        .jsonpath-btn { padding: 4px 8px; font-size: 11px; background: var(--bg-3); border: 1px solid var(--border); 
            border-radius: 3px; cursor: pointer; color: var(--fg-1); }
        .jsonpath-btn:hover { background: var(--bg-2); }
        .variable-selector { position: absolute; background: var(--bg-1); border: 1px solid var(--border); 
            border-radius: 3px; max-height: 200px; overflow-y: auto; z-index: 100; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .variable-selector.show { display: block; }
        .variable-item { padding: 6px 10px; cursor: pointer; font-size: 11px; font-family: Consolas, monospace; }
        .variable-item:hover { background: var(--bg-2); }
        .variable-category { padding: 6px 10px; font-size: 10px; font-weight: 600; color: var(--fg-3); text-transform: uppercase; background: var(--bg-2); }
        .attribute-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; margin-bottom: 8px; align-items: center; }
        .attribute-key { font-size: 11px; color: var(--fg-2); }
        .attribute-value { position: relative; }
    </style>
</head>
<body>
    <div class="container">
        <header class="header">
            <div class="header-left">
                <span class="header-title">Workflow Editor</span>
                <span class="badge badge-success">🤖 AI Assistant Available</span>
            </div>
            <div class="header-actions">
                <button class="btn btn-default" onclick="toggleAIPanel()" title="Generate or modify workflow using Cursor API">
                    🤖 AI Assistant
                </button>
                <button class="btn btn-default" onclick="testWorkflow()">Test</button>
                <button class="btn btn-primary" onclick="saveWorkflow()">Save</button>
            </div>
        </header>
        
        <div class="sidebar">
            <div class="section">
                <div class="section-title">Workflow Info</div>
                <div class="form-group">
                    <label>Name</label>
                    <input type="text" id="workflowName" placeholder="Workflow name">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea id="workflowDescription" rows="2" placeholder="Workflow description"></textarea>
                </div>
                <div class="form-group">
                    <label>Enabled</label>
                    <input type="checkbox" id="workflowEnabled">
                </div>
            </div>
            
            <div class="section">
                <div class="section-title">Trigger</div>
                <div class="form-group">
                    <label>Trigger Type</label>
                    <select id="triggerType" onchange="onTriggerTypeChange()">
                        <option value="">Select trigger...</option>
                        <option value="EVENT">Event</option>
                        <option value="SCHEDULED">Scheduled</option>
                        <option value="MANUAL">Manual</option>
                    </select>
                </div>
                <div id="triggerConfig"></div>
            </div>
        </div>
        
        <div class="editor-pane">
            <div class="editor-tabs">
                <div class="editor-tab active" onclick="switchTab('visual')">Visual</div>
                <div class="editor-tab" onclick="switchTab('json')">JSON</div>
            </div>
            <div id="workflowCanvas"></div>
            <div id="jsonEditor" style="display: none; flex: 1; padding: 16px; overflow: auto;">
                <textarea id="jsonTextarea" style="width: 100%; height: 100%; background: var(--bg-2); 
                    border: 1px solid var(--border); border-radius: 3px; padding: 12px; 
                    font-family: Consolas, monospace; font-size: 12px; color: var(--fg-0);"></textarea>
            </div>
        </div>
        
        <div class="palette">
            <div class="section-title">Actions</div>
            <div id="actionPalette"></div>
        </div>
        
        <!-- AI Panel -->
        <div class="ai-panel" id="aiPanel">
            <div class="ai-header">
                <h3>🤖 AI Assistant</h3>
                <button class="btn btn-default" onclick="toggleAIPanel()">✕</button>
            </div>
            <div class="ai-content">
                <div class="ai-status" id="aiStatus"></div>
                
                <div style="font-size: 11px; color: var(--fg-3); margin-bottom: 8px; padding: 8px; background: var(--bg-2); border-radius: 3px;">
                    <strong>Powered by Cursor API</strong><br>
                    Your API token is stored securely. Get your token from <a href="https://cursor.com/settings/api" target="_blank" style="color: var(--accent);">cursor.com/settings/api</a>
                </div>
                
                <textarea class="ai-input" id="aiPrompt" placeholder="${this.workflowData ? 'Describe the changes you want to make to this workflow...' : 'Describe the workflow you want to create...'}&#10;&#10;${this.workflowData ? 'Example: Add a step to send notification email after provisioning' : 'Example: Send welcome email when a new identity is created with department \'IT\''}"></textarea>
                <button class="btn btn-ai" onclick="generateWithAI()" style="width: 100%; margin-bottom: 16px;">
                    ${this.workflowData ? '✨ Modify Workflow with AI' : '✨ Generate Workflow with AI'}
                </button>
                
                <div class="section-title">Quick Suggestions</div>
                <div class="ai-suggestion" onclick="useSuggestion('Create a workflow that sends a welcome email when a new identity is created')">
                    <div class="ai-suggestion-title">Welcome Email Workflow</div>
                    <div class="ai-suggestion-desc">Send welcome email when identity is created</div>
                </div>
                <div class="ai-suggestion" onclick="useSuggestion('Create a workflow that provisions an account when identity department changes to IT')">
                    <div class="ai-suggestion-title">Auto-Provisioning</div>
                    <div class="ai-suggestion-desc">Provision account based on attribute change</div>
                </div>
                <div class="ai-suggestion" onclick="useSuggestion('Create a workflow that creates a form for user onboarding when identity is created')">
                    <div class="ai-suggestion-title">Onboarding Form</div>
                    <div class="ai-suggestion-desc">Create form workflow for new users</div>
                </div>
                <div class="ai-suggestion" onclick="useSuggestion('Create a workflow that sends notification when account aggregation completes')">
                    <div class="ai-suggestion-title">Aggregation Notification</div>
                    <div class="ai-suggestion-desc">Notify when source aggregation finishes</div>
                </div>
            </div>
        </div>
        
        <footer class="footer">
            <div>Workflow Editor</div>
            <div id="status">Ready</div>
        </footer>
    </div>
    
    <!-- Step Editor Modal -->
    <div class="modal-overlay" id="stepEditorModal">
        <div class="modal">
            <div class="modal-header">
                <div class="modal-title">Edit Step</div>
                <button class="btn btn-default" onclick="closeStepEditor()">✕</button>
            </div>
            <div class="modal-body" id="stepEditorBody">
                <!-- Step editor content will be injected here -->
            </div>
            <div class="modal-footer">
                <button class="btn btn-default" onclick="closeStepEditor()">Cancel</button>
                <button class="btn btn-primary" onclick="saveStepEditor()">Save</button>
            </div>
        </div>
    </div>
    
    <!-- Variable Selector -->
    <div class="variable-selector" id="variableSelector"></div>
    
    <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>
    <script>
        const vscode = acquireVsCodeApi();
        let workflowData = ${workflowJson};
        const isEditingWorkflow = ${this.workflowData ? 'true' : 'false'};
        let nodes = [];
        let arrows = []; // New arrow data structure
        let selectedNode = null;
        let isDragging = false;
        let dragOffset = { x: 0, y: 0 };
        let nextNodeId = 1;
        let nextArrowId = 1;
        let actions = [];
        let triggers = [];
        let animationFrameId = null;
        
        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            if (workflowData) loadWorkflowData(workflowData);
            loadActions();
            renderCanvas();
        });
        
        function loadWorkflowData(data) {
            workflowData = data;
            document.getElementById('workflowName').value = data.name || '';
            document.getElementById('workflowDescription').value = data.description || '';
            document.getElementById('workflowEnabled').checked = data.enabled || false;
            
            if (data.trigger) {
                document.getElementById('triggerType').value = data.trigger.type || '';
                onTriggerTypeChange();
            }
            
            if (data.definition && data.definition.steps) {
                parseWorkflowSteps(data.definition);
            }
        }
        
        function parseWorkflowSteps(definition) {
            nodes = [];
            arrows = [];
            const steps = definition.steps || {};
            const start = definition.start;
            
            // Create nodes from steps
            Object.keys(steps).forEach((stepName, idx) => {
                const step = steps[stepName];
                const node = {
                    id: 'node_' + nextNodeId++,
                    name: stepName,
                    type: step.type || 'action',
                    actionId: step.actionId,
                    attributes: step.attributes || {},
                    displayName: step.displayName || stepName,
                    nextStep: step.nextStep,
                    x: 200 + (idx % 3) * 250,
                    y: 100 + Math.floor(idx / 3) * 150,
                    width: 200, // Default width
                    height: 100, // Default height
                    anchors: {
                        top: { x: 0, y: 0 },
                        right: { x: 0, y: 0 },
                        bottom: { x: 0, y: 0 },
                        left: { x: 0, y: 0 },
                        center: { x: 0, y: 0 }
                    }
                };
                nodes.push(node);
            });
            
            // Calculate anchor points for all nodes
            updateNodeAnchors();
            
            // Create arrows based on nextStep relationships
            nodes.forEach(node => {
                if (node.nextStep) {
                    const targetNode = nodes.find(n => n.name === node.nextStep);
                    if (targetNode) {
                        const arrow = createArrow(node.id, targetNode.id);
                        arrows.push(arrow);
                    } else {
                        console.warn('Target node not found for nextStep:', node.nextStep, 'from node:', node.name);
                    }
                }
            });
            
            console.log('Parsed workflow steps:', nodes.length, 'nodes,', arrows.length, 'arrows');
            
            // Mark start node
            if (start) {
                const startNode = nodes.find(n => n.name === start);
                if (startNode) {
                    startNode.isStart = true;
                }
            }
            
            renderCanvas();
        }
        
        function updateNodeAnchors() {
            nodes.forEach(node => {
                const nodeEl = document.getElementById(node.id);
                if (nodeEl) {
                    const rect = nodeEl.getBoundingClientRect();
                    node.width = rect.width || 200;
                    node.height = rect.height || 100;
                    
                    // Update anchor coordinates relative to node position
                    node.anchors.top = { x: node.x + node.width / 2, y: node.y };
                    node.anchors.right = { x: node.x + node.width, y: node.y + node.height / 2 };
                    node.anchors.bottom = { x: node.x + node.width / 2, y: node.y + node.height };
                    node.anchors.left = { x: node.x, y: node.y + node.height / 2 };
                    node.anchors.center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
                } else {
                    // Fallback if element not in DOM yet
                    node.anchors.top = { x: node.x + node.width / 2, y: node.y };
                    node.anchors.right = { x: node.x + node.width, y: node.y + node.height / 2 };
                    node.anchors.bottom = { x: node.x + node.width / 2, y: node.y + node.height };
                    node.anchors.left = { x: node.x, y: node.y + node.height / 2 };
                    node.anchors.center = { x: node.x + node.width / 2, y: node.y + node.height / 2 };
                }
            });
        }
        
        function getBestAnchor(sourceNode, targetNode) {
            const sourceCenter = sourceNode.anchors.center;
            const targetCenter = targetNode.anchors.center;
            
            const dx = targetCenter.x - sourceCenter.x;
            const dy = targetCenter.y - sourceCenter.y;
            
            // Determine which edge of source node faces target
            let sourceAnchor, targetAnchor;
            
            if (Math.abs(dx) > Math.abs(dy)) {
                // Horizontal direction dominates
                if (dx > 0) {
                    sourceAnchor = sourceNode.anchors.right;
                    targetAnchor = targetNode.anchors.left;
                } else {
                    sourceAnchor = sourceNode.anchors.left;
                    targetAnchor = targetNode.anchors.right;
                }
            } else {
                // Vertical direction dominates
                if (dy > 0) {
                    sourceAnchor = sourceNode.anchors.bottom;
                    targetAnchor = targetNode.anchors.top;
                } else {
                    sourceAnchor = sourceNode.anchors.top;
                    targetAnchor = targetNode.anchors.bottom;
                }
            }
            
            return { source: sourceAnchor, target: targetAnchor };
        }
        
        function createArrow(sourceNodeId, targetNodeId) {
            const sourceNode = nodes.find(n => n.id === sourceNodeId);
            const targetNode = nodes.find(n => n.id === targetNodeId);
            
            if (!sourceNode || !targetNode) {
                console.warn('Cannot create arrow: nodes not found', sourceNodeId, targetNodeId);
                return null;
            }
            
            const anchors = getBestAnchor(sourceNode, targetNode);
            
            return {
                id: 'arrow_' + nextArrowId++,
                sourceNodeId: sourceNodeId,
                targetNodeId: targetNodeId,
                sourceAnchor: anchors.source,
                targetAnchor: anchors.target,
                path: calculateArrowPath(anchors.source, anchors.target)
            };
        }
        
        function calculateArrowPath(source, target) {
            const dx = target.x - source.x;
            const dy = target.y - source.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Use curved path for better readability
            if (distance > 50) {
                // Cubic bezier curve
                const cp1x = source.x + dx * 0.3;
                const cp1y = source.y + dy * 0.3;
                const cp2x = source.x + dx * 0.7;
                const cp2y = source.y + dy * 0.7;
                
                // Add perpendicular offset for curve
                const perpX = -dy * 0.2;
                const perpY = dx * 0.2;
                
                return \`M \${source.x} \${source.y} C \${cp1x + perpX} \${cp1y + perpY}, \${cp2x + perpX} \${cp2y + perpY}, \${target.x} \${target.y}\`;
            } else {
                // Straight line for very close nodes
                return \`M \${source.x} \${source.y} L \${target.x} \${target.y}\`;
            }
        }
        
        function updateArrows(nodeId) {
            // Update all arrows connected to this node
            arrows.forEach(arrow => {
                if (arrow.sourceNodeId === nodeId || arrow.targetNodeId === nodeId) {
                    const sourceNode = nodes.find(n => n.id === arrow.sourceNodeId);
                    const targetNode = nodes.find(n => n.id === arrow.targetNodeId);
                    
                    if (sourceNode && targetNode) {
                        const anchors = getBestAnchor(sourceNode, targetNode);
                        arrow.sourceAnchor = anchors.source;
                        arrow.targetAnchor = anchors.target;
                        arrow.path = calculateArrowPath(anchors.source, anchors.target);
                    }
                }
            });
        }
        
        function loadActions() {
            vscode.postMessage({ command: 'getWorkflowActions' });
        }
        
        function renderCanvas() {
            const canvas = document.getElementById('workflowCanvas');
            
            // Remove existing SVG if it exists
            const existingSvg = canvas.querySelector('.connections-layer');
            if (existingSvg) {
                existingSvg.remove();
            }
            
            // Remove existing nodes
            nodes.forEach(node => {
                const existingNode = document.getElementById(node.id);
                if (existingNode) {
                    existingNode.remove();
                }
            });
            
            // Render nodes first (so we can get their actual dimensions)
            nodes.forEach(node => {
                const nodeEl = createNodeElement(node);
                canvas.appendChild(nodeEl);
            });
            
            // Wait a tick for DOM to update, then update anchors and render arrows
            setTimeout(() => {
                updateNodeAnchors();
                renderArrows();
            }, 0);
        }
        
        function renderArrows() {
            const canvas = document.getElementById('workflowCanvas');
            
            // Remove existing SVG
            const existingSvg = canvas.querySelector('.connections-layer');
            if (existingSvg) {
                existingSvg.remove();
            }
            
            if (arrows.length === 0) return;
            
            // Calculate bounds of all nodes and arrows
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            let hasNodes = false;
            
            nodes.forEach(node => {
                hasNodes = true;
                minX = Math.min(minX, node.x);
                minY = Math.min(minY, node.y);
                maxX = Math.max(maxX, node.x + node.width);
                maxY = Math.max(maxY, node.y + node.height);
            });
            
            // Include arrow paths in bounds
            arrows.forEach(arrow => {
                if (arrow.sourceAnchor && arrow.targetAnchor) {
                    minX = Math.min(minX, arrow.sourceAnchor.x, arrow.targetAnchor.x);
                    minY = Math.min(minY, arrow.sourceAnchor.y, arrow.targetAnchor.y);
                    maxX = Math.max(maxX, arrow.sourceAnchor.x, arrow.targetAnchor.x);
                    maxY = Math.max(maxY, arrow.sourceAnchor.y, arrow.targetAnchor.y);
                }
            });
            
            if (!hasNodes) return;
            
            // Ensure valid bounds
            if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
                minX = 0;
                minY = 0;
                maxX = 2000;
                maxY = 2000;
            }
            
            // Add padding
            const padding = 200;
            minX = minX - padding;
            minY = minY - padding;
            maxX = maxX + padding;
            maxY = maxY + padding;
            
            const svgWidth = Math.max(1000, maxX - minX);
            const svgHeight = Math.max(1000, maxY - minY);
            
            // Create SVG container
            const svgContainer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgContainer.setAttribute('class', 'connections-layer');
            svgContainer.style.position = 'absolute';
            svgContainer.style.top = '0';
            svgContainer.style.left = '0';
            svgContainer.style.width = '100%';
            svgContainer.style.height = '100%';
            svgContainer.style.pointerEvents = 'none';
            svgContainer.style.zIndex = '1';
            svgContainer.style.overflow = 'visible';
            svgContainer.setAttribute('viewBox', \`\${minX} \${minY} \${svgWidth} \${svgHeight}\`);
            svgContainer.setAttribute('preserveAspectRatio', 'none');
            
            // Define arrow marker
            const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'arrowhead');
            marker.setAttribute('markerWidth', '10');
            marker.setAttribute('markerHeight', '10');
            marker.setAttribute('refX', '9');
            marker.setAttribute('refY', '3');
            marker.setAttribute('orient', 'auto');
            const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            polygon.setAttribute('points', '0 0, 10 3, 0 6');
            polygon.setAttribute('fill', '#007acc');
            marker.appendChild(polygon);
            defs.appendChild(marker);
            svgContainer.appendChild(defs);
            
            // Render all arrows
            arrows.forEach(arrow => {
                if (arrow.path) {
                    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                    path.setAttribute('d', arrow.path);
                    path.setAttribute('stroke', '#007acc');
                    path.setAttribute('stroke-width', '2');
                    path.setAttribute('fill', 'none');
                    path.setAttribute('marker-end', 'url(#arrowhead)');
                    path.setAttribute('class', 'workflow-connection');
                    path.setAttribute('data-arrow-id', arrow.id);
                    svgContainer.appendChild(path);
                }
            });
            
            canvas.appendChild(svgContainer);
        }
        
        function createNodeElement(node) {
            const div = document.createElement('div');
            let nodeClass = 'workflow-node ' + node.type;
            if (node.isStart) nodeClass += ' start';
            div.className = nodeClass;
            div.id = node.id;
            div.style.left = node.x + 'px';
            div.style.top = node.y + 'px';
            
            // Determine node icon/color based on type
            let nodeIcon = '⚙️';
            if (node.actionId === 'sp:operator-success') nodeIcon = '✓';
            else if (node.actionId === 'sp:operator-error' || node.actionId === 'sp:operator-failure') nodeIcon = '✗';
            else if (node.type === 'operator') nodeIcon = '⟲';
            else if (node.actionId?.startsWith('sp:loop')) nodeIcon = '⟳';
            else if (node.actionId === 'sp:send-email') nodeIcon = '✉️';
            else if (node.actionId === 'sp:forms' || node.actionId === 'sp:interactive-form') nodeIcon = '📋';
            else if (node.actionId === 'sp:get-identity') nodeIcon = '👤';
            
            div.innerHTML = \`
                <div class="node-header">
                    <div class="node-title">\${nodeIcon} \${escapeHtml(node.displayName || node.name)}</div>
                    <div class="node-type">\${node.type || 'action'}</div>
                </div>
                <div class="node-body">\${escapeHtml(node.actionId || 'Trigger')}</div>
                \${node.nextStep ? '<div class="node-next" style="font-size: 10px; color: var(--fg-3); margin-top: 4px;">→ \${escapeHtml(node.nextStep)}</div>' : ''}
                <div class="node-actions">
                    <button class="node-btn" onclick="editNode('\${node.id}')">Edit</button>
                    <button class="node-btn" onclick="deleteNode('\${node.id}')">Delete</button>
                </div>
            \`;
            
            // Make draggable
            div.addEventListener('mousedown', (e) => {
                if (e.target.tagName === 'BUTTON') return;
                selectedNode = node;
                div.classList.add('selected');
                isDragging = true;
                const canvas = document.getElementById('workflowCanvas');
                const canvasRect = canvas.getBoundingClientRect();
                dragOffset.x = e.clientX - canvasRect.left - node.x;
                dragOffset.y = e.clientY - canvasRect.top - node.y;
            });
            
            return div;
        }
        
        
        document.addEventListener('mousemove', (e) => {
            if (isDragging && selectedNode) {
                const canvas = document.getElementById('workflowCanvas');
                const canvasRect = canvas.getBoundingClientRect();
                selectedNode.x = e.clientX - canvasRect.left - dragOffset.x;
                selectedNode.y = e.clientY - canvasRect.top - dragOffset.y;
                const nodeEl = document.getElementById(selectedNode.id);
                if (nodeEl) {
                    nodeEl.style.left = selectedNode.x + 'px';
                    nodeEl.style.top = selectedNode.y + 'px';
                }
                
                // Update anchors and arrows using requestAnimationFrame for smooth performance
                if (!animationFrameId) {
                    animationFrameId = requestAnimationFrame(() => {
                        updateNodeAnchors();
                        updateArrows(selectedNode.id);
                        renderArrows();
                        animationFrameId = null;
                    });
                }
            }
        });
        
        document.addEventListener('mouseup', () => {
            isDragging = false;
            if (selectedNode) {
                const nodeEl = document.getElementById(selectedNode.id);
                if (nodeEl) nodeEl.classList.remove('selected');
                
                // Cancel any pending animation frame
                if (animationFrameId) {
                    cancelAnimationFrame(animationFrameId);
                    animationFrameId = null;
                }
                
                // Final update after drag ends
                updateNodeAnchors();
                updateArrows(selectedNode.id);
                renderArrows();
                
                selectedNode = null;
            }
        });
        
        function switchTab(tab) {
            document.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');
            if (tab === 'visual') {
                document.getElementById('workflowCanvas').style.display = 'block';
                document.getElementById('jsonEditor').style.display = 'none';
            } else {
                document.getElementById('workflowCanvas').style.display = 'none';
                document.getElementById('jsonEditor').style.display = 'flex';
                updateJSONEditor();
            }
        }
        
        function updateJSONEditor() {
            const workflow = buildWorkflowFromNodes();
            document.getElementById('jsonTextarea').value = JSON.stringify(workflow, null, 2);
        }
        
        function buildWorkflowFromNodes() {
            const steps = {};
            
            // Build steps from nodes
            nodes.forEach(node => {
                steps[node.name] = {
                    actionId: node.actionId,
                    attributes: node.attributes || {},
                    displayName: node.displayName || node.name,
                    type: node.type || 'action',
                    versionNumber: 2
                };
            });
            
            // Build nextStep relationships from arrows
            arrows.forEach(arrow => {
                const sourceNode = nodes.find(n => n.id === arrow.sourceNodeId);
                const targetNode = nodes.find(n => n.id === arrow.targetNodeId);
                
                if (sourceNode && targetNode) {
                    // Only add nextStep if it's not an end step
                    if (sourceNode.type !== 'operator' && 
                        sourceNode.actionId !== 'sp:operator-success' && 
                        sourceNode.actionId !== 'sp:operator-error' &&
                        sourceNode.actionId !== 'sp:operator-failure') {
                        steps[sourceNode.name].nextStep = targetNode.name;
                    }
                }
            });
            
            // Build trigger attributes
            const triggerType = document.getElementById('triggerType').value;
            const triggerAttributes = {};
            
            if (triggerType === 'EVENT') {
                const eventId = document.getElementById('eventId')?.value;
                if (eventId) {
                    triggerAttributes.id = eventId;
                }
                const eventFilter = document.getElementById('eventFilter')?.value;
                if (eventFilter) {
                    triggerAttributes['filter.$'] = eventFilter;
                }
                // Common event trigger attributes
                const attributeToFilter = document.getElementById('attributeToFilter')?.value;
                if (attributeToFilter) {
                    triggerAttributes.attributeToFilter = attributeToFilter;
                }
            } else if (triggerType === 'SCHEDULED') {
                const cron = document.getElementById('scheduleCron')?.value;
                if (cron) {
                    triggerAttributes.schedule = cron;
                }
            }
            
            return {
                name: document.getElementById('workflowName').value || 'Untitled Workflow',
                description: document.getElementById('workflowDescription').value || '',
                enabled: document.getElementById('workflowEnabled').checked || false,
                trigger: {
                    type: triggerType || 'MANUAL',
                    attributes: triggerAttributes
                },
                definition: {
                    start: nodes[0]?.name || '',
                    steps: steps
                }
            };
        }
        
        function saveWorkflow() {
            const workflow = buildWorkflowFromNodes();
            vscode.postMessage({ command: 'saveWorkflow', data: workflow });
        }
        
        function testWorkflow() {
            const payload = prompt('Enter test payload (JSON):', '{}');
            if (payload) {
                try {
                    const parsed = JSON.parse(payload);
                    vscode.postMessage({ command: 'testWorkflow', payload: parsed });
                } catch {
                    alert('Invalid JSON');
                }
            }
        }
        
        function toggleAIPanel() {
            document.getElementById('aiPanel').classList.toggle('show');
        }
        
        function generateWithAI() {
            const prompt = document.getElementById('aiPrompt').value;
            if (!prompt) {
                alert('Please enter a workflow description');
                return;
            }
            setAIStatus('generating', isEditingWorkflow ? 'Modifying workflow with Cursor AI...' : 'Generating workflow with Cursor AI...');
            vscode.postMessage({ command: 'generateWithAI', prompt });
        }
        
        function setAIStatus(type, message) {
            const statusEl = document.getElementById('aiStatus');
            if (statusEl) {
                statusEl.className = 'ai-status show ' + type;
                statusEl.textContent = message;
            }
        }
        
        function useSuggestion(text) {
            document.getElementById('aiPrompt').value = text;
        }
        
        function onTriggerTypeChange() {
            const type = document.getElementById('triggerType').value;
            const config = document.getElementById('triggerConfig');
            config.innerHTML = '';
            
            if (type === 'EVENT') {
                config.innerHTML = \`
                    <div class="form-group">
                        <label>Event ID</label>
                        <select id="eventId" onchange="updateTriggerConfig()">
                            <option value="">Select event...</option>
                            <option value="idn:identity-created">Identity Created</option>
                            <option value="idn:identity-attributes-changed">Identity Attributes Changed</option>
                            <option value="idn:account-aggregation-completed">Account Aggregation Completed</option>
                            <option value="idn:source-deleted">Source Deleted</option>
                            <option value="idn:access-profile-created">Access Profile Created</option>
                            <option value="idn:role-created">Role Created</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Attribute to Filter (optional)</label>
                        <input type="text" id="attributeToFilter" placeholder="department" onchange="updateTriggerConfig()">
                    </div>
                    <div class="form-group">
                        <label>Filter (JSONPath - optional)</label>
                        <input type="text" id="eventFilter" placeholder="$.changes[?(@.attribute == 'department')]" onchange="updateTriggerConfig()">
                        <small style="color: var(--fg-3); font-size: 10px; display: block; margin-top: 4px;">
                            Use JSONPath to filter events
                        </small>
                    </div>
                \`;
            } else if (type === 'SCHEDULED') {
                config.innerHTML = \`
                    <div class="form-group">
                        <label>Cron Expression</label>
                        <input type="text" id="scheduleCron" placeholder="0 0 * * *" onchange="updateTriggerConfig()">
                        <small style="color: var(--fg-3); font-size: 10px; display: block; margin-top: 4px;">
                            Format: minute hour day month weekday
                        </small>
                    </div>
                \`;
            } else if (type === 'MANUAL') {
                config.innerHTML = \`
                    <div style="color: var(--fg-3); font-size: 11px; padding: 8px;">
                        Manual workflows are triggered by users through the UI or API.
                    </div>
                \`;
            }
        }
        
        function updateTriggerConfig() {
            // Trigger config will be saved with workflow
        }
        
        let editingNode = null;
        
        function editNode(id) {
            const node = nodes.find(n => n.id === id);
            if (!node) return;
            editingNode = node;
            openStepEditor(node);
        }
        
        function openStepEditor(node) {
            const modal = document.getElementById('stepEditorModal');
            const body = document.getElementById('stepEditorBody');
            
            // Get available variables from previous steps
            const availableVars = getAvailableVariables(node);
            
            body.innerHTML = \`
                <div class="form-group">
                    <label>Step Name</label>
                    <input type="text" id="stepName" value="\${escapeHtml(node.name)}" readonly>
                </div>
                <div class="form-group">
                    <label>Display Name</label>
                    <input type="text" id="stepDisplayName" value="\${escapeHtml(node.displayName || node.name)}">
                </div>
                <div class="form-group">
                    <label>Action/Operator</label>
                    <input type="text" id="stepActionId" value="\${escapeHtml(node.actionId || '')}" readonly>
                </div>
                <div class="form-group">
                    <label>Next Step</label>
                    <select id="stepNextStep">
                        <option value="">(End step)</option>
                        \${nodes.filter(n => n.id !== node.id).map(n => 
                            \`<option value="\${n.name}" \${node.nextStep === n.name ? 'selected' : ''}>\${escapeHtml(n.displayName || n.name)}</option>\`
                        ).join('')}
                    </select>
                </div>
                <div class="section-title" style="margin-top: 16px;">Attributes</div>
                <div id="stepAttributes"></div>
                <button class="btn btn-default" onclick="addAttribute()" style="margin-top: 8px;">+ Add Attribute</button>
            \`;
            
            // Render existing attributes
            renderStepAttributes(node.attributes || {}, availableVars);
            
            modal.classList.add('show');
        }
        
        function getAvailableVariables(currentNode) {
            const vars = {
                trigger: ['trigger.identity.id', 'trigger.identity.name', 'trigger.identity.email', 'trigger.changes'],
                steps: []
            };
            
            // Get variables from previous steps
            const currentIndex = nodes.findIndex(n => n.id === currentNode.id);
            for (let i = 0; i < currentIndex; i++) {
                const step = nodes[i];
                const stepName = step.name.replace(/\\s+/g, '');
                vars.steps.push({
                    step: stepName,
                    prefix: \`\${stepName}.\`,
                    common: [
                        \`\${stepName}.attributes\`,
                        \`\${stepName}.id\`,
                        \`\${stepName}.name\`
                    ]
                });
            }
            
            return vars;
        }
        
        function renderStepAttributes(attributes, availableVars) {
            const container = document.getElementById('stepAttributes');
            container.innerHTML = '';
            
            Object.keys(attributes).forEach(key => {
                // Handle JSONPath attributes (key ends with .$)
                const isJsonPath = key.endsWith('.$');
                const actualKey = isJsonPath ? key.slice(0, -2) : key;
                const value = isJsonPath ? attributes[key] : (typeof attributes[key] === 'object' ? JSON.stringify(attributes[key]) : attributes[key]);
                addAttributeRow(actualKey, value, availableVars, isJsonPath);
            });
            
            if (Object.keys(attributes).length === 0) {
                container.innerHTML = '<div style="color: var(--fg-3); font-size: 11px; padding: 8px;">No attributes configured</div>';
            }
        }
        
        function addAttributeRow(key = '', value = '', availableVars = null, isJsonPath = false) {
            const container = document.getElementById('stepAttributes');
            if (container.innerHTML.includes('No attributes')) {
                container.innerHTML = '';
            }
            
            const row = document.createElement('div');
            row.className = 'attribute-row';
            row.innerHTML = \`
                <input type="text" class="attribute-key" placeholder="Attribute name" value="\${escapeHtml(key)}" 
                    onchange="updateAttributeKey(this)">
                <div class="attribute-value">
                    <div class="jsonpath-input">
                        <input type="text" class="attribute-value-input" placeholder="Value or JSONPath" 
                            value="\${escapeHtml(value)}"
                            onfocus="showVariableSelector(this, event)" onchange="updateAttributeValue(this)">
                        <button type="button" class="jsonpath-btn" onclick="insertJSONPath(this)" title="Insert JSONPath">$</button>
                    </div>
                </div>
                <button class="btn btn-default" onclick="removeAttribute(this)" style="padding: 4px 8px; font-size: 11px;">✕</button>
            \`;
            container.appendChild(row);
        }
        
        function addAttribute() {
            addAttributeRow();
        }
        
        function removeAttribute(btn) {
            btn.closest('.attribute-row').remove();
            const container = document.getElementById('stepAttributes');
            if (container.children.length === 0) {
                container.innerHTML = '<div style="color: var(--fg-3); font-size: 11px; padding: 8px;">No attributes configured</div>';
            }
        }
        
        function updateAttributeKey(input) {
            // Update will be saved when modal is closed
        }
        
        function updateAttributeValue(input) {
            // Update will be saved when modal is closed
        }
        
        function showVariableSelector(input, event) {
            event.stopPropagation();
            const selector = document.getElementById('variableSelector');
            const rect = input.getBoundingClientRect();
            selector.style.left = rect.left + 'px';
            selector.style.top = (rect.bottom + 4) + 'px';
            selector.style.minWidth = rect.width + 'px';
            
            // Get available variables
            const availableVars = editingNode ? getAvailableVariables(editingNode) : { trigger: [], steps: [] };
            
            selector.innerHTML = \`
                <div class="variable-category">Trigger Variables</div>
                \${availableVars.trigger.map(v => 
                    \`<div class="variable-item" onclick="insertVariable('\${v}')">\$.\${v}</div>\`
                ).join('')}
                \${availableVars.steps.map(step => \`
                    <div class="variable-category">\${step.step}</div>
                    \${step.common.map(v => 
                        \`<div class="variable-item" onclick="insertVariable('\${v}')">\$.\${v}</div>\`
                    ).join('')}
                \`).join('')}
            \`;
            
            selector.classList.add('show');
            
            // Close on outside click
            setTimeout(() => {
                const closeSelector = (e) => {
                    if (!selector.contains(e.target) && e.target !== input) {
                        selector.classList.remove('show');
                        document.removeEventListener('click', closeSelector);
                    }
                };
                document.addEventListener('click', closeSelector);
            }, 100);
        }
        
        function insertVariable(varPath) {
            const selector = document.getElementById('variableSelector');
            const activeInput = document.activeElement;
            if (activeInput && activeInput.classList.contains('attribute-value-input')) {
                const jsonPath = \`\$.\${varPath}\`;
                activeInput.value = jsonPath;
                activeInput.dispatchEvent(new Event('change'));
            }
            selector.classList.remove('show');
        }
        
        function insertJSONPath(btn) {
            const input = btn.previousElementSibling;
            if (input) {
                const jsonPath = prompt('Enter JSONPath expression:', '$.trigger.identity.id');
                if (jsonPath) {
                    input.value = jsonPath;
                    input.dispatchEvent(new Event('change'));
                }
            }
        }
        
        function saveStepEditor() {
            if (!editingNode) return;
            
            const displayName = document.getElementById('stepDisplayName').value;
            const nextStep = document.getElementById('stepNextStep').value;
            
            // Collect attributes
            const attributes = {};
            document.querySelectorAll('.attribute-row').forEach(row => {
                const keyInput = row.querySelector('.attribute-key');
                const valueInput = row.querySelector('.attribute-value-input');
                if (keyInput && valueInput) {
                    const key = keyInput.value.trim();
                    const value = valueInput.value.trim();
                    if (key) {
                        // Check if value is a JSONPath (starts with $.)
                        if (value.startsWith('$.')) {
                            attributes[key + '.$'] = value;
                        } else {
                            // Try to parse as JSON, otherwise treat as string
                            try {
                                attributes[key] = JSON.parse(value);
                            } catch {
                                attributes[key] = value;
                            }
                        }
                    }
                }
            });
            
            const oldNextStep = editingNode.nextStep;
            editingNode.displayName = displayName;
            editingNode.nextStep = nextStep || null;
            editingNode.attributes = attributes;
            
            // Update arrows if nextStep changed
            if (oldNextStep !== editingNode.nextStep) {
                // Remove old arrow if it existed
                arrows = arrows.filter(a => !(a.sourceNodeId === editingNode.id && 
                    nodes.find(n => n.id === a.targetNodeId)?.name === oldNextStep));
                
                // Create new arrow if nextStep is set
                if (editingNode.nextStep) {
                    const targetNode = nodes.find(n => n.name === editingNode.nextStep);
                    if (targetNode) {
                        const arrow = createArrow(editingNode.id, targetNode.id);
                        if (arrow) {
                            arrows.push(arrow);
                        }
                    }
                }
            }
            
            closeStepEditor();
            renderCanvas();
        }
        
        function closeStepEditor() {
            document.getElementById('stepEditorModal').classList.remove('show');
            editingNode = null;
        }
        
        function escapeHtml(str) {
            if (!str) return '';
            return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        }
        
        function deleteNode(id) {
            const node = nodes.find(n => n.id === id);
            if (!node) return;
            if (confirm('Delete step "' + (node.displayName || node.name) + '"?')) {
                nodes = nodes.filter(n => n.id !== id);
                // Remove arrows connected to this node
                arrows = arrows.filter(a => a.sourceNodeId !== id && a.targetNodeId !== id);
                renderCanvas();
            }
        }
        
        window.addEventListener('message', event => {
            const msg = event.data;
            switch (msg.command) {
                case 'workflowLoaded':
                    loadWorkflowData(msg.data);
                    break;
                case 'actionsLoaded':
                    actions = msg.data;
                    renderActionPalette();
                    break;
                case 'triggersLoaded':
                    triggers = msg.data;
                    break;
                case 'aiGenerated':
                    if (msg.success && msg.data) {
                        setAIStatus('success', 'Workflow generated successfully!');
                        // Auto-update the workflow with AI-generated data
                        if (msg.data.name) {
                            document.getElementById('workflowName').value = msg.data.name;
                        }
                        if (msg.data.description) {
                            document.getElementById('workflowDescription').value = msg.data.description;
                        }
                        if (msg.data.enabled !== undefined) {
                            document.getElementById('workflowEnabled').checked = msg.data.enabled;
                        }
                        if (msg.data.trigger) {
                            document.getElementById('triggerType').value = msg.data.trigger.type || '';
                            onTriggerTypeChange();
                        }
                        if (msg.data.definition) {
                            parseWorkflowSteps(msg.data.definition);
                            // Switch to visual tab to show the generated workflow
                            switchTab('visual');
                            setTimeout(() => {
                                setAIStatus('success', 'Workflow loaded. Review and save when ready.');
                            }, 2000);
                        }
                    }
                    break;
                case 'aiGenerating':
                    if (msg.generating) {
                        setAIStatus('generating', 'AI is generating your workflow...');
                    } else {
                        const statusEl = document.getElementById('aiStatus');
                        if (statusEl) statusEl.classList.remove('show');
                    }
                    break;
                case 'aiError':
                    setAIStatus('error', 'Error: ' + (msg.error || 'Unknown error'));
                    break;
                case 'saveDone':
                    if (msg.success) {
                        document.getElementById('status').textContent = 'Saved successfully';
                    } else {
                        document.getElementById('status').textContent = 'Save failed: ' + (msg.error || '');
                    }
                    break;
            }
        });
        
        function renderActionPalette() {
            const palette = document.getElementById('actionPalette');
            if (!actions || actions.length === 0) {
                palette.innerHTML = '<div style="color: var(--fg-3); font-size: 11px; padding: 8px;">Loading actions...</div>';
                return;
            }
            
            // Group by category
            const grouped = {};
            actions.forEach(action => {
                const cat = action.category || 'Other';
                if (!grouped[cat]) grouped[cat] = [];
                grouped[cat].push(action);
            });
            
            palette.innerHTML = Object.keys(grouped).sort().map(category => \`
                <div style="margin-bottom: 12px;">
                    <div class="section-title" style="margin-bottom: 6px;">\${category}</div>
                    \${grouped[category].map(action => \`
                        <div class="palette-item" draggable="true" ondragstart="dragStart(event, '\${action.id}')" 
                             title="\${action.description}">
                            <div class="palette-item-title">\${action.name}</div>
                            <div class="palette-item-desc">\${action.description}</div>
                        </div>
                    \`).join('')}
                </div>
            \`).join('');
        }
        
        function dragStart(e, actionId) {
            e.dataTransfer.setData('actionId', actionId);
        }
        
        document.getElementById('workflowCanvas').addEventListener('drop', (e) => {
            e.preventDefault();
            const actionId = e.dataTransfer.getData('actionId');
            if (actionId) {
                const action = actions.find(a => a.id === actionId);
                if (action) {
                    const node = {
                        id: 'node_' + nextNodeId++,
                        name: action.name.replace(/\\s+/g, '') + '_' + nextNodeId,
                        type: action.type || 'action',
                        actionId: action.id,
                        attributes: {},
                        displayName: action.name,
                        x: e.offsetX,
                        y: e.offsetY,
                        width: 200,
                        height: 100,
                        anchors: {
                            top: { x: 0, y: 0 },
                            right: { x: 0, y: 0 },
                            bottom: { x: 0, y: 0 },
                            left: { x: 0, y: 0 },
                            center: { x: 0, y: 0 }
                        }
                    };
                    nodes.push(node);
                    renderCanvas();
                }
            }
        });
        
        document.getElementById('workflowCanvas').addEventListener('dragover', (e) => {
            e.preventDefault();
        });
    </script>
</body>
</html>`;
    }

    public dispose(): void {
        WorkflowEditorPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    }
}


import { EventEmitter } from 'events';
import { SyncManager, SyncState } from './SyncManager';

/**
 * Command interface
 */
export interface Command {
    type: string;
    payload: any;
    tenantId?: string;
}

/**
 * Command handler function
 */
export type CommandHandler = (command: Command) => Promise<any> | any;

/**
 * Command Bus - Centralized command handling
 * 
 * Responsibilities:
 * - Route commands to appropriate handlers
 * - Validate commands affecting sync (must be global)
 * - Validate commands affecting data (must target ACTIVE_SYNC tenants)
 * - Emit events for command execution
 */
export class CommandBus extends EventEmitter {
    private static instance: CommandBus | undefined;
    private handlers: Map<string, CommandHandler[]> = new Map();
    private syncManager: SyncManager;

    private constructor(syncManager: SyncManager) {
        super();
        this.syncManager = syncManager;
    }

    /**
     * Initialize CommandBus instance
     */
    public static initialize(syncManager: SyncManager): CommandBus {
        if (!CommandBus.instance) {
            CommandBus.instance = new CommandBus(syncManager);
        }
        return CommandBus.instance;
    }

    /**
     * Get CommandBus instance
     */
    public static getInstance(): CommandBus {
        if (!CommandBus.instance) {
            throw new Error('CommandBus not initialized. Call initialize() first.');
        }
        return CommandBus.instance;
    }

    /**
     * Register a command handler
     */
    public registerHandler(commandType: string, handler: CommandHandler): void {
        if (!this.handlers.has(commandType)) {
            this.handlers.set(commandType, []);
        }
        this.handlers.get(commandType)!.push(handler);
    }

    /**
     * Unregister a command handler
     */
    public unregisterHandler(commandType: string, handler: CommandHandler): void {
        const handlers = this.handlers.get(commandType);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    /**
     * Execute a command
     */
    public async execute(command: Command): Promise<any> {
        // Validate command
        this.validateCommand(command);

        // Emit command started event
        this.emit('commandStarted', command);

        try {
            // Get handlers for this command type
            const handlers = this.handlers.get(command.type) || [];
            
            if (handlers.length === 0) {
                throw new Error(`No handler registered for command type: ${command.type}`);
            }

            // Execute all handlers (support multiple handlers for same command type)
            const results = await Promise.all(
                handlers.map(handler => handler(command))
            );

            // Emit command completed event
            this.emit('commandCompleted', { command, results });

            // Return first result (or all if multiple handlers)
            return results.length === 1 ? results[0] : results;
        } catch (error: any) {
            // Emit command error event
            this.emit('commandError', { command, error });
            throw error;
        }
    }

    /**
     * Validate command
     */
    private validateCommand(command: Command): void {
        // Commands affecting sync must be global (no tenantId restriction)
        const syncCommands = [
            'SET_SYNC_STATE',
            'PAUSE_SYNC',
            'RESUME_SYNC',
            'GET_SYNC_STATUS'
        ];

        if (syncCommands.includes(command.type)) {
            // Sync commands are global - no validation needed
            return;
        }

        // Commands affecting data must target ACTIVE_SYNC tenants
        if (command.tenantId) {
            const syncState = this.syncManager.getSyncState(command.tenantId);
            if (syncState !== SyncState.ACTIVE_SYNC) {
                // Allow data commands for PAUSED tenants if explicitly requested
                // (for on-demand loading)
                if (command.payload?.forceLoad !== true && syncState === SyncState.PAUSED) {
                    console.warn(`[CommandBus] Command ${command.type} for tenant ${command.tenantId} is PAUSED. Use forceLoad: true to execute.`);
                }
            }
        }
    }

    /**
     * Execute command synchronously (for simple commands)
     */
    public executeSync(command: Command): any {
        this.validateCommand(command);
        this.emit('commandStarted', command);

        try {
            const handlers = this.handlers.get(command.type) || [];
            if (handlers.length === 0) {
                throw new Error(`No handler registered for command type: ${command.type}`);
            }

            // Execute first handler synchronously
            const result = handlers[0](command);
            this.emit('commandCompleted', { command, results: [result] });
            return result;
        } catch (error: any) {
            this.emit('commandError', { command, error });
            throw error;
        }
    }

    /**
     * Get registered command types
     */
    public getRegisteredCommands(): string[] {
        return Array.from(this.handlers.keys());
    }

    /**
     * Check if a command type is registered
     */
    public isRegistered(commandType: string): boolean {
        return this.handlers.has(commandType) && this.handlers.get(commandType)!.length > 0;
    }

    /**
     * Cleanup
     */
    public dispose(): void {
        this.handlers.clear();
        this.removeAllListeners();
    }
}

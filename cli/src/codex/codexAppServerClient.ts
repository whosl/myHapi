import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@/ui/logger';
import { killProcessByChildProcess } from '@/utils/process';
import type {
    InitializeParams,
    InitializeResponse,
    ModelListParams,
    ModelListResponse,
    ThreadStartParams,
    ThreadStartResponse,
    ThreadResumeParams,
    ThreadResumeResponse,
    TurnStartParams,
    TurnStartResponse,
    TurnInterruptParams,
    TurnInterruptResponse,
    ThreadCompactStartParams,
    ThreadCompactStartResponse,
    ServerCapabilities,
    ThreadListParams,
    ThreadListResponse,
    ThreadForkParams,
    ThreadForkResponse,
    ThreadRollbackParams,
    ThreadRollbackResponse,
    TurnSteerParams,
    TurnSteerResponse,
    CommandExecParams,
    CommandExecResponse,
    ServerRequestResolvedParams,
    ServerRequestResolvedResponse,
    AvailableDecisionsParams,
    AvailableDecisionsResponse,
    WindowsSandboxSetupStartParams,
    WindowsSandboxSetupStartResponse
} from './appServerTypes';

type JsonRpcLiteRequest = {
    id: number;
    method: string;
    params?: unknown;
};

type JsonRpcLiteNotification = {
    method: string;
    params?: unknown;
};

type JsonRpcLiteResponse = {
    id: number | string | null;
    result?: unknown;
    error?: {
        code?: number;
        message: string;
        data?: unknown;
    };
};

type RequestHandler = (params: unknown) => Promise<unknown> | unknown;

type PendingRequest = {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

function createAbortError(): Error {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    return error;
}

function resolveCodexBinary(): string {
    if (process.platform !== 'win32') {
        return 'codex';
    }

    // On Windows, skip the codex.cmd → node codex.js → codex.exe chain.
    // codex.js uses stdio:'inherit' which breaks pipe-based IPC.
    // Resolve the native codex.exe directly.
    const codexHome = process.env.CODEX_HOME;
    const searchRoots: string[] = [];
    if (codexHome) {
        searchRoots.push(codexHome);
    }
    const npmGlobal = process.env.APPDATA
        ? join(process.env.APPDATA, 'npm', 'node_modules', '@openai', 'codex')
        : null;
    if (npmGlobal) {
        searchRoots.push(npmGlobal);
    }

    for (const root of searchRoots) {
        const exePath = join(
            root,
            'node_modules', '@openai', 'codex-win32-x64',
            'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe'
        );
        if (existsSync(exePath)) {
            return exePath;
        }
        // Fallback: local vendor inside the codex package
        const localExe = join(
            root,
            'vendor', 'x86_64-pc-windows-msvc', 'codex', 'codex.exe'
        );
        if (existsSync(localExe)) {
            return localExe;
        }
    }

    // Fall back to codex.cmd (will use shell: true)
    return 'codex';
}

export class CodexAppServerClient {
    private process: ChildProcessWithoutNullStreams | null = null;
    private connected = false;
    private buffer = '';
    private nextId = 1;
    private readonly pending = new Map<number, PendingRequest>();
    private readonly requestHandlers = new Map<string, RequestHandler>();
    private notificationHandler: ((method: string, params: unknown) => void) | null = null;
    private protocolError: Error | null = null;
    private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    private readonly unsupportedMethods = new Set<string>();

    static readonly DEFAULT_TIMEOUT_MS = 14 * 24 * 60 * 60 * 1000;

    async connect(): Promise<void> {
        if (this.connected) {
            return;
        }

        const command = resolveCodexBinary();
        const useShell = !command.endsWith('.exe');

        this.process = spawn(command, ['app-server'], {
            env: Object.keys(process.env).reduce((acc, key) => {
                const value = process.env[key];
                if (typeof value === 'string') acc[key] = value;
                return acc;
            }, {} as Record<string, string>),
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32',
            windowsHide: process.platform === 'win32'
        });

        this.process.stdout.setEncoding('utf8');
        this.process.stdout.on('data', (chunk) => this.handleStdout(chunk));

        this.process.stderr.setEncoding('utf8');
        this.process.stderr.on('data', (chunk) => {
            const text = chunk.toString().trim();
            if (text.length > 0) {
                logger.debug(`[CodexAppServer][stderr] ${text}`);
            }
        });

        this.process.on('exit', (code, signal) => {
            if (this.keepAliveTimer) {
                clearInterval(this.keepAliveTimer);
                this.keepAliveTimer = null;
            }
            const message = `Codex app-server exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
            logger.debug(message);
            this.rejectAllPending(new Error(message));
            this.connected = false;
            this.resetParserState();
            this.process = null;
        });

        this.process.on('error', (error) => {
            if (this.keepAliveTimer) {
                clearInterval(this.keepAliveTimer);
                this.keepAliveTimer = null;
            }
            logger.debug('[CodexAppServer] Process error', error);
            const message = error instanceof Error ? error.message : String(error);
            this.rejectAllPending(new Error(
                `Failed to spawn codex app-server: ${message}. Is it installed and on PATH?`,
                { cause: error }
            ));
            this.connected = false;
            this.resetParserState();
            this.process = null;
        });

        this.connected = true;

        // Keep stdin active so the codex binary doesn't exit after turn/start
        this.keepAliveTimer = setInterval(() => {
            if (this.process?.stdin?.writable) {
                this.process.stdin.write('\n');
            }
        }, 5000);
        this.keepAliveTimer.unref();

        logger.debug('[CodexAppServer] Connected');
    }

    setNotificationHandler(handler: ((method: string, params: unknown) => void) | null): void {
        this.notificationHandler = handler;
    }

    registerRequestHandler(method: string, handler: RequestHandler): void {
        this.requestHandlers.set(method, handler);
    }

    hasCapability(method: string): boolean {
        return !this.unsupportedMethods.has(method);
    }

    async initialize(params: InitializeParams): Promise<InitializeResponse> {
        const response = await this.sendRequest('initialize', params, { timeoutMs: 30_000 });
        // codex >= 0.129.0 no longer accepts 'initialized' notification
        // Keep sending it for backward compatibility — older versions may need it
        try {
            this.sendNotification('initialized');
        } catch {
            // Ignore — notification send failures are non-critical
        }
        return response as InitializeResponse;
    }

    async listModels(params?: ModelListParams): Promise<ModelListResponse> {
        const response = await this.sendRequest('model/list', params ?? {}, {
            timeoutMs: 30_000
        });
        return response as ModelListResponse;
    }

    async startThread(params: ThreadStartParams, options?: { signal?: AbortSignal }): Promise<ThreadStartResponse> {
        const response = await this.sendRequest('thread/start', params, {
            signal: options?.signal,
            timeoutMs: CodexAppServerClient.DEFAULT_TIMEOUT_MS
        });
        return response as ThreadStartResponse;
    }

    async resumeThread(params: ThreadResumeParams, options?: { signal?: AbortSignal }): Promise<ThreadResumeResponse> {
        const response = await this.sendRequest('thread/resume', params, {
            signal: options?.signal,
            timeoutMs: CodexAppServerClient.DEFAULT_TIMEOUT_MS
        });
        return response as ThreadResumeResponse;
    }

    async startTurn(params: TurnStartParams, options?: { signal?: AbortSignal }): Promise<TurnStartResponse> {
        const response = await this.sendRequest('turn/start', params, {
            signal: options?.signal,
            timeoutMs: CodexAppServerClient.DEFAULT_TIMEOUT_MS
        });
        return response as TurnStartResponse;
    }

    async interruptTurn(params: TurnInterruptParams): Promise<TurnInterruptResponse> {
        const response = await this.sendRequest('turn/interrupt', params, {
            timeoutMs: 30_000
        });
        return response as TurnInterruptResponse;
    }

    async compactThread(
        params: ThreadCompactStartParams,
        options?: { signal?: AbortSignal }
    ): Promise<ThreadCompactStartResponse> {
        const response = await this.sendRequest('thread/compact/start', params, {
            signal: options?.signal,
            timeoutMs: CodexAppServerClient.DEFAULT_TIMEOUT_MS
        });
        return response as ThreadCompactStartResponse;
    }

    // --- New API methods ---

    async listThreads(params?: ThreadListParams, options?: { signal?: AbortSignal }): Promise<ThreadListResponse> {
        if (!this.hasCapability('thread/list')) {
            return { data: [] };
        }
        const response = await this.sendRequest('thread/list', params ?? {}, {
            signal: options?.signal,
            timeoutMs: 30_000
        });
        return response as ThreadListResponse;
    }

    async forkThread(params: ThreadForkParams, options?: { signal?: AbortSignal }): Promise<ThreadForkResponse> {
        if (!this.hasCapability('thread/fork')) {
            throw new Error("Codex app-server does not support 'thread/fork'");
        }
        const response = await this.sendRequest('thread/fork', params, {
            signal: options?.signal,
            timeoutMs: CodexAppServerClient.DEFAULT_TIMEOUT_MS
        });
        return response as ThreadForkResponse;
    }

    async rollbackThread(params: ThreadRollbackParams, options?: { signal?: AbortSignal }): Promise<ThreadRollbackResponse> {
        if (!this.hasCapability('thread/rollback')) {
            throw new Error("Codex app-server does not support 'thread/rollback'");
        }
        const response = await this.sendRequest('thread/rollback', params, {
            signal: options?.signal,
            timeoutMs: 60_000
        });
        return response as ThreadRollbackResponse;
    }

    async steerTurn(params: TurnSteerParams): Promise<TurnSteerResponse> {
        if (!this.hasCapability('turn/steer')) {
            throw new Error("Codex app-server does not support 'turn/steer'");
        }
        const response = await this.sendRequest('turn/steer', params, {
            timeoutMs: 30_000
        });
        return response as TurnSteerResponse;
    }

    async execCommand(params: CommandExecParams, options?: { signal?: AbortSignal }): Promise<CommandExecResponse> {
        if (!this.hasCapability('command/exec')) {
            throw new Error("Codex app-server does not support 'command/exec'");
        }
        // On Windows, command/exec defaults to sandbox which may fail with
        // CreateProcessAsUserW. Inject dangerFullAccess sandboxPolicy when
        // no sandbox policy is explicitly provided.
        const finalParams = { ...params };
        if (process.platform === 'win32' && !finalParams.sandboxPolicy) {
            finalParams.sandboxPolicy = { type: 'dangerFullAccess' };
        }
        const response = await this.sendRequest('command/exec', finalParams, {
            signal: options?.signal,
            timeoutMs: params.timeoutMs ?? 120_000
        });
        return response as CommandExecResponse;
    }

    async resolveServerRequest(params: ServerRequestResolvedParams): Promise<ServerRequestResolvedResponse> {
        if (!this.hasCapability('serverRequest/resolved')) {
            throw new Error("Codex app-server does not support 'serverRequest/resolved'");
        }
        const response = await this.sendRequest('serverRequest/resolved', params, {
            timeoutMs: 30_000
        });
        return response as ServerRequestResolvedResponse;
    }

    async getAvailableDecisions(params: AvailableDecisionsParams): Promise<AvailableDecisionsResponse> {
        if (!this.hasCapability('serverRequest/resolved')) {
            return { decisions: ['accept', 'acceptForSession', 'decline', 'cancel'] };
        }
        const response = await this.sendRequest('availableDecisions', params, {
            timeoutMs: 10_000
        });
        return response as AvailableDecisionsResponse;
    }

    async startWindowsSandboxSetup(params: WindowsSandboxSetupStartParams, options?: { signal?: AbortSignal }): Promise<WindowsSandboxSetupStartResponse> {
        if (!this.hasCapability('windowsSandbox/setupStart')) {
            throw new Error("Codex app-server does not support 'windowsSandbox/setupStart'");
        }
        const response = await this.sendRequest('windowsSandbox/setupStart', params, {
            signal: options?.signal,
            timeoutMs: 60_000
        });
        return response as WindowsSandboxSetupStartResponse;
    }

    async disconnect(): Promise<void> {
        if (!this.connected) {
            return;
        }

        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }

        const child = this.process;
        this.process = null;

        try {
            child?.stdin.end();
            if (child) {
                await killProcessByChildProcess(child);
            }
        } catch (error) {
            logger.debug('[CodexAppServer] Error while stopping process', error);
        } finally {
            this.rejectAllPending(new Error('Codex app-server disconnected'));
            this.connected = false;
            this.resetParserState();
        }

        logger.debug('[CodexAppServer] Disconnected');
    }

    private async sendRequest(
        method: string,
        params?: unknown,
        options?: { signal?: AbortSignal; timeoutMs?: number }
    ): Promise<unknown> {
        if (!this.connected) {
            await this.connect();
        }

        const id = this.nextId++;
        this.pendingMethodByRequestId.set(id, method);
        const payload: JsonRpcLiteRequest = {
            id,
            method,
            params
        };

        const timeoutMs = options?.timeoutMs ?? CodexAppServerClient.DEFAULT_TIMEOUT_MS;

        return new Promise((resolve, reject) => {
            let timeout: ReturnType<typeof setTimeout> | null = null;
            let aborted = false;

            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                }
                if (options?.signal) {
                    options.signal.removeEventListener('abort', onAbort);
                }
            };

            const onAbort = () => {
                if (aborted) return;
                aborted = true;
                this.pending.delete(id);
                cleanup();
                reject(createAbortError());
            };

            if (options?.signal) {
                if (options.signal.aborted) {
                    onAbort();
                    return;
                }
                options.signal.addEventListener('abort', onAbort, { once: true });
            }

            if (Number.isFinite(timeoutMs)) {
                timeout = setTimeout(() => {
                    if (this.pending.has(id)) {
                        this.pending.delete(id);
                        cleanup();
                        reject(new Error(`Codex app-server request '${method}' timed out after ${timeoutMs}ms`));
                    }
                }, timeoutMs);
                timeout.unref();
            }

            this.pending.set(id, {
                resolve: (value) => {
                    cleanup();
                    resolve(value);
                },
                reject: (error) => {
                    cleanup();
                    reject(error);
                },
                cleanup
            });

            this.writePayload(payload);
        });
    }

    private sendNotification(method: string, params?: unknown): void {
        const payload: JsonRpcLiteNotification = { method, params };
        this.writePayload(payload);
    }

    private handleStdout(chunk: string): void {
        this.buffer += chunk;
        let newlineIndex = this.buffer.indexOf('\n');

        while (newlineIndex >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);

            if (line.length > 0) {
                this.handleLine(line);
            }

            newlineIndex = this.buffer.indexOf('\n');
        }
    }

    private handleLine(line: string): void {
        if (this.protocolError) {
            return;
        }

        let message: Record<string, unknown> | null = null;
        try {
            const parsed = JSON.parse(line);
            message = asRecord(parsed);
            if (!message) {
                logger.debug('[CodexAppServer] Ignoring non-object JSON from stdout', { line });
                return;
            }
        } catch (error) {
            const protocolError = new Error('Failed to parse JSON from codex app-server');
            this.protocolError = protocolError;
            logger.debug('[CodexAppServer] Failed to parse JSON line', { line, error });
            this.rejectAllPending(protocolError);
            this.process?.stdin.end();
            return;
        }

        if (typeof message.method === 'string') {
            const method = message.method;
            const params = 'params' in message ? message.params : null;

            if ('id' in message && message.id !== undefined) {
                const requestId = message.id;
                void this.handleIncomingRequest({
                    id: requestId,
                    method,
                    params
                });
                return;
            }

            this.notificationHandler?.(method, params ?? null);
            return;
        }

        if ('id' in message) {
            this.handleResponse(message as JsonRpcLiteResponse);
        }
    }

    private async handleIncomingRequest(request: { id: unknown; method: string; params?: unknown }): Promise<void> {
        const responseId = typeof request.id === 'number' || typeof request.id === 'string'
            ? request.id
            : null;
        const handler = this.requestHandlers.get(request.method);

        if (!handler) {
            this.writePayload({
                id: responseId,
                error: {
                    code: -32601,
                    message: `Method not found: ${request.method}`
                }
            } satisfies JsonRpcLiteResponse);
            return;
        }

        try {
            const result = await handler(request.params ?? null);
            this.writePayload({
                id: responseId,
                result
            } satisfies JsonRpcLiteResponse);
        } catch (error) {
            this.writePayload({
                id: responseId,
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : 'Internal error'
                }
            } satisfies JsonRpcLiteResponse);
        }
    }

    private pendingMethodByRequestId = new Map<number, string>();

    private handleResponse(response: JsonRpcLiteResponse): void {
        if (response.id === null || response.id === undefined) {
            logger.debug('[CodexAppServer] Received response without id');
            return;
        }

        if (typeof response.id !== 'number') {
            logger.debug('[CodexAppServer] Received response with non-numeric id', response.id);
            return;
        }

        const pending = this.pending.get(response.id);
        if (!pending) {
            logger.debug('[CodexAppServer] Received response with no pending request', response.id);
            return;
        }

        this.pending.delete(response.id);
        this.pendingMethodByRequestId.delete(response.id);

        if (response.error) {
            if (response.error.code === -32601) {
                const method = response.error.message.match(/Method not found: (.+)/)?.[1];
                if (method) {
                    this.unsupportedMethods.add(method);
                    logger.debug(`[CodexAppServer] Method '${method}' not supported, caching as unavailable`);
                }
            }
            pending.reject(new Error(response.error.message));
            return;
        }

        pending.resolve(response.result);
    }

    private writePayload(payload: JsonRpcLiteRequest | JsonRpcLiteNotification | JsonRpcLiteResponse): void {
        const serialized = JSON.stringify(payload);
        this.process?.stdin.write(`${serialized}\n`);
    }

    private resetParserState(): void {
        this.buffer = '';
        this.protocolError = null;
    }

    private rejectAllPending(error: Error): void {
        for (const { reject, cleanup } of this.pending.values()) {
            cleanup();
            reject(error);
        }
        this.pending.clear();
    }
}

import { logger } from '@/ui/logger'
import { getInvokedCwd } from '@/utils/invokedCwd'
import type {
    TerminalErrorPayload,
    TerminalExitPayload,
    TerminalOutputPayload,
    TerminalReadyPayload
} from '@hapi/protocol'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { TerminalSession } from './types'

type TerminalRuntime = TerminalSession & {
    proc: Bun.Subprocess
    terminal: Bun.Terminal
    idleTimer: ReturnType<typeof setTimeout> | null
}

type ConptyHelperRuntime = TerminalSession & {
    helperProc: Bun.Subprocess<'pipe', 'pipe', 'pipe'>
    idleTimer: ReturnType<typeof setTimeout> | null
}

type ManagedTerminal = TerminalRuntime | ConptyHelperRuntime

type TerminalManagerOptions = {
    sessionId: string
    getSessionPath: () => string | null
    onReady: (payload: TerminalReadyPayload) => void
    onOutput: (payload: TerminalOutputPayload) => void
    onExit: (payload: TerminalExitPayload) => void
    onError: (payload: TerminalErrorPayload) => void
    idleTimeoutMs?: number
    maxTerminals?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_MAX_TERMINALS = 4
const SENSITIVE_ENV_KEYS = new Set([
    'CLI_API_TOKEN',
    'HAPI_API_URL',
    'HAPI_HTTP_MCP_URL',
    'TELEGRAM_BOT_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY'
])

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveShell(): string {
    if (process.env.SHELL) {
        return process.env.SHELL
    }
    if (process.platform === 'win32') {
        return process.env.COMSPEC || 'cmd.exe'
    }
    if (process.platform === 'darwin') {
        return '/bin/zsh'
    }
    return '/bin/bash'
}

function buildFilteredEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (!value) {
            continue
        }
        if (SENSITIVE_ENV_KEYS.has(key)) {
            continue
        }
        env[key] = value
    }
    if (!env.TERM) {
        env.TERM = 'xterm-256color'
    }
    if (!env.COLORTERM) {
        env.COLORTERM = 'truecolor'
    }
    if (!env.LANG) {
        env.LANG = process.platform === 'win32' ? 'en_US.UTF-8' : process.platform === 'darwin' ? 'en_US.UTF-8' : 'C.UTF-8'
    }
    return env
}

function isBunTerminalRuntime(rt: ManagedTerminal): rt is TerminalRuntime {
    return 'terminal' in rt && 'proc' in rt
}

function isConptyHelperRuntime(rt: ManagedTerminal): rt is ConptyHelperRuntime {
    return 'helperProc' in rt
}

function findNodeExe(): string | null {
    if (process.env.NODE) {
        return process.env.NODE
    }
    // Common Node.js locations on Windows
    if (process.platform === 'win32') {
        const candidates = [
            join(process.env.ProgramFiles || 'C:\\Program Files', 'nodejs', 'node.exe'),
            join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'nodejs', 'node.exe'),
        ]
        // Also try D: drive (common on Chinese Windows)
        const dNode = 'D:\\Application\\nodejs\\node.exe'
        candidates.push(dNode)
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate
            }
        }
    }
    // Fall back to PATH lookup
    try {
        const which = process.platform === 'win32' ? 'where.exe' : 'which'
        const result = Bun.spawnSync([which, 'node'], { stdout: 'pipe' })
        if (result.exitCode === 0 && result.stdout) {
            const lines = result.stdout.toString().trim().split(/\r?\n/)
            if (lines.length > 0 && lines[0]) {
                return lines[0].trim()
            }
        }
    } catch {}
    return null
}

function findConptyHelper(): string | null {
    // Check relative to the executable
    const exeDir = dirname(process.execPath)
    const relativePath = join(exeDir, 'conpty-helper.cjs')
    if (existsSync(relativePath)) {
        return relativePath
    }
    // Check in the source tree (development mode)
    const srcPath = join(dirname(import.meta.dir), 'src', 'terminal', 'conpty-helper.cjs')
    if (existsSync(srcPath)) {
        return srcPath
    }
    return null
}

function findNodePtyPath(): string | null {
    // Check common node_modules locations
    const searchPaths = [
        join(dirname(process.execPath), '..', 'node_modules'),
        join(dirname(process.execPath), 'node_modules'),
    ]
    // Also check user-level global node_modules
    if (process.env.APPDATA) {
        searchPaths.push(join(process.env.APPDATA, 'npm', 'node_modules'))
    }
    for (const searchPath of searchPaths) {
        const ptyPath = join(searchPath, 'node-pty')
        if (existsSync(ptyPath)) {
            return ptyPath
        }
    }
    // Try requiring node-pty directly (uses NODE_PATH)
    try {
        return require.resolve('node-pty')
    } catch {}
    return null
}

export class TerminalManager {
    private readonly sessionId: string
    private readonly getSessionPath: () => string | null
    private readonly onReady: (payload: TerminalReadyPayload) => void
    private readonly onOutput: (payload: TerminalOutputPayload) => void
    private readonly onExit: (payload: TerminalExitPayload) => void
    private readonly onError: (payload: TerminalErrorPayload) => void
    private readonly idleTimeoutMs: number
    private readonly maxTerminals: number
    private readonly terminals: Map<string, ManagedTerminal> = new Map()
    private readonly filteredEnv: NodeJS.ProcessEnv
    private bunTerminalSupported: boolean | null = null

    constructor(options: TerminalManagerOptions) {
        this.sessionId = options.sessionId
        this.getSessionPath = options.getSessionPath
        this.onReady = options.onReady
        this.onOutput = options.onOutput
        this.onExit = options.onExit
        this.onError = options.onError
        this.idleTimeoutMs = options.idleTimeoutMs ?? resolveEnvNumber('HAPI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
        this.maxTerminals = options.maxTerminals ?? resolveEnvNumber('HAPI_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS)
        this.filteredEnv = buildFilteredEnv()
    }

    create(terminalId: string, cols: number, rows: number): void {
        const existing = this.terminals.get(terminalId)
        if (existing) {
            existing.cols = cols
            existing.rows = rows
            if (isBunTerminalRuntime(existing)) {
                existing.terminal.resize(cols, rows)
            } else if (isConptyHelperRuntime(existing)) {
                this.sendToHelper(existing, { type: 'resize', terminalId, cols, rows })
            }
            this.markActivity(existing)
            this.onReady({ sessionId: this.sessionId, terminalId })
            return
        }

        if (this.terminals.size >= this.maxTerminals) {
            this.emitError(terminalId, `Too many terminals open (max ${this.maxTerminals}).`)
            return
        }

        if (typeof Bun === 'undefined' || typeof Bun.spawn !== 'function') {
            this.emitError(terminalId, 'Terminal is unavailable in this runtime.')
            return
        }

        // Try Bun's native terminal first
        if (this.bunTerminalSupported !== false) {
            if (this.tryCreateBunTerminal(terminalId, cols, rows)) {
                return
            }
        }

        // Fallback to ConPTY helper on Windows
        if (process.platform === 'win32') {
            this.tryCreateConptyHelper(terminalId, cols, rows)
            return
        }

        this.emitError(terminalId, 'Terminal is unavailable on this platform.')
    }

    write(terminalId: string, data: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            this.emitError(terminalId, 'Terminal not found.')
            return
        }
        if (isBunTerminalRuntime(runtime)) {
            runtime.terminal.write(data)
        } else if (isConptyHelperRuntime(runtime)) {
            this.sendToHelper(runtime, { type: 'write', terminalId, data })
        }
        this.markActivity(runtime)
    }

    resize(terminalId: string, cols: number, rows: number): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        runtime.cols = cols
        runtime.rows = rows
        if (isBunTerminalRuntime(runtime)) {
            runtime.terminal.resize(cols, rows)
        } else if (isConptyHelperRuntime(runtime)) {
            this.sendToHelper(runtime, { type: 'resize', terminalId, cols, rows })
        }
        this.markActivity(runtime)
    }

    close(terminalId: string): void {
        this.cleanup(terminalId)
    }

    closeAll(): void {
        for (const terminalId of this.terminals.keys()) {
            this.cleanup(terminalId)
        }
    }

    private tryCreateBunTerminal(terminalId: string, cols: number, rows: number): boolean {
        const sessionPath = this.getSessionPath() ?? getInvokedCwd()
        const shell = resolveShell()
        const decoder = new TextDecoder()

        try {
            const proc = Bun.spawn([shell], {
                cwd: sessionPath,
                env: this.filteredEnv,
                terminal: {
                    cols,
                    rows,
                    data: (terminal, data) => {
                        const text = decoder.decode(data, { stream: true })
                        if (text) {
                            this.onOutput({ sessionId: this.sessionId, terminalId, data: text })
                        }
                        const active = this.terminals.get(terminalId)
                        if (active) {
                            this.markActivity(active)
                        }
                    },
                    exit: (terminal, exitCode) => {
                        if (exitCode === 1) {
                            this.emitError(terminalId, 'Terminal stream closed unexpectedly.')
                        }
                    }
                },
                onExit: (subprocess, exitCode) => {
                    const signal = subprocess.signalCode ?? null
                    this.onExit({
                        sessionId: this.sessionId,
                        terminalId,
                        code: exitCode ?? null,
                        signal
                    })
                    this.cleanup(terminalId)
                }
            })

            const terminal = proc.terminal
            if (!terminal) {
                try {
                    proc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill process after missing terminal', { error })
                }
                this.bunTerminalSupported = false
                return false
            }

            const runtime: TerminalRuntime = {
                terminalId,
                cols,
                rows,
                proc,
                terminal,
                idleTimer: null
            }

            this.terminals.set(terminalId, runtime)
            this.markActivity(runtime)
            this.bunTerminalSupported = true
            this.onReady({ sessionId: this.sessionId, terminalId })
            return true
        } catch (error) {
            logger.debug('[TERMINAL] Bun.spawn terminal failed, trying ConPTY helper fallback', { error })
            this.bunTerminalSupported = false
            return false
        }
    }

    private tryCreateConptyHelper(terminalId: string, cols: number, rows: number): void {
        const nodeExe = findNodeExe()
        if (!nodeExe) {
            this.emitError(terminalId, 'Node.js is required for terminal support on Windows. Install Node.js and restart.')
            return
        }

        const helperScript = findConptyHelper()
        if (!helperScript) {
            this.emitError(terminalId, 'ConPTY helper script not found.')
            return
        }

        const sessionPath = this.getSessionPath() ?? getInvokedCwd()
        const shell = resolveShell()

        try {
            const helperProc = Bun.spawn([nodeExe, helperScript], {
                stdin: 'pipe',
                stdout: 'pipe',
                stderr: 'pipe',
                cwd: sessionPath,
                env: this.filteredEnv
            })

            const decoder = new TextDecoder()

            this.readHelperStdout(terminalId, helperProc.stdout, decoder)

            helperProc.exited.then((exitCode) => {
                if (!this.terminals.has(terminalId)) return
                this.onExit({
                    sessionId: this.sessionId,
                    terminalId,
                    code: exitCode,
                    signal: null
                })
                this.cleanup(terminalId)
            })

            const runtime: ConptyHelperRuntime = {
                terminalId,
                cols,
                rows,
                helperProc,
                idleTimer: null
            }

            this.terminals.set(terminalId, runtime)
            this.markActivity(runtime)

            // Send create command to helper
            this.sendToHelper(runtime, {
                type: 'create',
                terminalId,
                cols,
                rows,
                cwd: sessionPath,
                shell,
                env: this.filteredEnv
            })
        } catch (error) {
            logger.debug('[TERMINAL] ConPTY helper spawn failed', { error })
            this.emitError(terminalId, 'Failed to spawn terminal helper.')
        }
    }

    private handleHelperMessage(terminalId: string, msg: Record<string, unknown>): void {
        switch (msg.type) {
            case 'ready':
                this.onReady({ sessionId: this.sessionId, terminalId })
                break
            case 'output':
                this.onOutput({ sessionId: this.sessionId, terminalId, data: msg.data as string })
                const active = this.terminals.get(terminalId)
                if (active) this.markActivity(active)
                break
            case 'exit':
                this.onExit({
                    sessionId: this.sessionId,
                    terminalId,
                    code: (msg.code as number) ?? null,
                    signal: (msg.signal as string) ?? null
                })
                this.cleanup(terminalId)
                break
            case 'error':
                this.emitError(terminalId, msg.message as string)
                break
            case 'fatal':
                logger.error('[TERMINAL] ConPTY helper fatal error:', msg.message)
                this.emitError(terminalId, msg.message as string)
                break
        }
    }

    private sendToHelper(runtime: ConptyHelperRuntime, msg: Record<string, unknown>): void {
        try {
            runtime.helperProc.stdin.write(JSON.stringify(msg) + '\n')
            runtime.helperProc.stdin.flush()
        } catch (error) {
            logger.debug('[TERMINAL] Failed to send to helper', { error })
        }
    }

    private async readHelperStdout(terminalId: string, stdout: ReadableStream<Uint8Array>, decoder: TextDecoder): Promise<void> {
        const reader = stdout.getReader()
        let buffer = ''
        try {
            while (true) {
                const { done, value } = await reader.read()
                if (done) break
                buffer += decoder.decode(value, { stream: true })
                const lines = buffer.split('\n')
                buffer = lines.pop() || ''
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed) continue
                    try {
                        const msg = JSON.parse(trimmed)
                        this.handleHelperMessage(terminalId, msg)
                    } catch {
                        // ignore malformed messages
                    }
                }
            }
        } catch {
            // stream closed or error
        }
    }

    private markActivity(runtime: ManagedTerminal): void {
        this.scheduleIdleTimer(runtime)
    }

    private scheduleIdleTimer(runtime: ManagedTerminal): void {
        if (this.idleTimeoutMs <= 0) {
            return
        }

        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }

        runtime.idleTimer = setTimeout(() => {
            this.emitError(runtime.terminalId, 'Terminal closed due to inactivity.')
            this.cleanup(runtime.terminalId)
        }, this.idleTimeoutMs)
    }

    private cleanup(terminalId: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }

        this.terminals.delete(terminalId)
        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }

        if (isBunTerminalRuntime(runtime)) {
            if (!runtime.proc.killed && runtime.proc.exitCode === null) {
                try {
                    runtime.proc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill process', { error })
                }
            }
            try {
                runtime.terminal.close()
            } catch (error) {
                logger.debug('[TERMINAL] Failed to close terminal', { error })
            }
        } else if (isConptyHelperRuntime(runtime)) {
            try {
                this.sendToHelper(runtime, { type: 'close', terminalId })
            } catch {}
            if (!runtime.helperProc.killed && runtime.helperProc.exitCode === null) {
                try {
                    runtime.helperProc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill helper process', { error })
                }
            }
        }
    }

    private emitError(terminalId: string, message: string): void {
        this.onError({ sessionId: this.sessionId, terminalId, message })
    }
}

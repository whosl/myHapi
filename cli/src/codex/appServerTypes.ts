export type ApprovalPolicy = 'untrusted' | 'on-failure' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';

export interface InitializeCapabilities {
    experimentalApi: boolean;
}

export interface ServerCapabilities {
    experimentalApi?: boolean;
    threadList?: boolean;
    threadFork?: boolean;
    threadRollback?: boolean;
    turnSteer?: boolean;
    commandExec?: boolean;
    explicitApproval?: boolean;
    windowsSandboxSetup?: boolean;
}

export interface InitializeParams {
    clientInfo: {
        name: string;
        title?: string;
        version: string;
    };
    capabilities: InitializeCapabilities | null;
}

export interface InitializeResponse {
    userAgent?: string;
    codexHome?: string;
    platformFamily?: string;
    platformOs?: string;
    [key: string]: unknown;
}

export interface ModelListParams {
    includeHidden?: boolean;
}

export interface ModelListItem {
    id: string;
    model?: string;
    displayName?: string;
    description?: string;
    hidden?: boolean;
    supportedReasoningEfforts?: Array<{
        reasoningEffort?: string;
        description?: string;
    }>;
    defaultReasoningEffort?: string | null;
    isDefault?: boolean;
    [key: string]: unknown;
}

export interface ModelListResponse {
    data?: ModelListItem[];
    nextCursor?: string | null;
    [key: string]: unknown;
}

export interface ThreadStartParams {
    model?: string;
    modelProvider?: string;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
    ephemeral?: boolean;
    experimentalRawEvents?: boolean;
}

export interface ThreadStartResponse {
    thread: {
        id: string;
    };
    model: string;
    [key: string]: unknown;
}

export type ResponseItem = Record<string, unknown>;

export interface ThreadResumeParams {
    threadId: string;
    history?: ResponseItem[];
    path?: string;
    model?: string;
    modelProvider?: string;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
}

export interface ThreadResumeResponse {
    thread: {
        id: string;
    };
    model: string;
    [key: string]: unknown;
}

export type UserInput =
    | {
        type: 'text';
        text: string;
        textElements?: Array<{
            byteRange: { start: number; end: number };
            placeholder?: string;
        }>;
    }
    | {
        type: 'image';
        url: string;
    }
    | {
        type: 'localImage';
        path: string;
    }
    | {
        type: 'skill';
        name: string;
        path: string;
    };

export type SandboxPolicy =
    | { type: 'dangerFullAccess' }
    | { type: 'readOnly' }
    | { type: 'externalSandbox'; networkAccess?: 'restricted' | 'enabled' }
    | {
        type: 'workspaceWrite';
        writableRoots?: string[];
        networkAccess?: boolean;
        excludeTmpdirEnvVar?: boolean;
        excludeSlashTmp?: boolean;
    };

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningSummary = 'auto' | 'none' | 'brief' | 'detailed';

export type CollaborationMode = {
    mode: 'plan' | 'default';
    settings: {
        model: string;
        reasoning_effort?: ReasoningEffort | null;
        developer_instructions?: string | null;
    };
};

export interface TurnStartParams {
    threadId: string;
    input: UserInput[];
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandboxPolicy?: SandboxPolicy;
    model?: string;
    effort?: ReasoningEffort;
    summary?: ReasoningSummary;
    personality?: string;
    outputSchema?: unknown;
    collaborationMode?: CollaborationMode;
}

export interface TurnStartResponse {
    turn: {
        id: string;
        status?: string;
    };
    [key: string]: unknown;
}

export interface TurnInterruptParams {
    threadId: string;
    turnId: string;
}

export interface TurnInterruptResponse {
    ok: boolean;
    [key: string]: unknown;
}

export interface ThreadCompactStartParams {
    threadId: string;
}

export interface ThreadCompactStartResponse {
    [key: string]: unknown;
}

// --- New API types ---

export interface ThreadListParams {
    cwd?: string | string[] | null;
    limit?: number | null;
    cursor?: string | null;
    archived?: boolean | null;
    [key: string]: unknown;
}

export interface ThreadListItem {
    id: string;
    sessionId?: string;
    preview?: string;
    cwd?: string;
    modelProvider?: string;
    createdAt?: number;
    updatedAt?: number;
    status?: string;
    path?: string;
    cliVersion?: string;
    source?: string;
    name?: string | null;
    [key: string]: unknown;
}

export interface ThreadListResponse {
    data: ThreadListItem[];
    nextCursor?: string | null;
    [key: string]: unknown;
}

export interface ThreadForkParams {
    threadId: string;
    model?: string | null;
    cwd?: string | null;
    approvalPolicy?: ApprovalPolicy | null;
    sandbox?: SandboxMode | null;
    config?: Record<string, unknown> | null;
    baseInstructions?: string | null;
    developerInstructions?: string | null;
    ephemeral?: boolean;
    [key: string]: unknown;
}

export interface ThreadForkResponse {
    thread: {
        id: string;
        forkedFromId?: string | null;
        [key: string]: unknown;
    };
    model: string;
    modelProvider: string;
    cwd: string;
    [key: string]: unknown;
}

export interface ThreadRollbackParams {
    threadId: string;
    numTurns: number;
}

export interface ThreadRollbackResponse {
    thread: {
        id: string;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface TurnSteerParams {
    threadId: string;
    input: UserInput[];
    expectedTurnId: string;
}

export interface TurnSteerResponse {
    turnId: string;
}

export interface CommandExecParams {
    command: string[];
    cwd?: string | null;
    processId?: string | null;
    tty?: boolean;
    streamStdin?: boolean;
    streamStdoutStderr?: boolean;
    timeoutMs?: number | null;
    disableTimeout?: boolean;
    env?: Record<string, string | null> | null;
    [key: string]: unknown;
}

export interface CommandExecResponse {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export type ServerRequestResolvedDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface ServerRequestResolvedParams {
    requestId: string;
    decision: ServerRequestResolvedDecision;
    reason?: string;
}

export interface ServerRequestResolvedResponse {
    [key: string]: unknown;
}

export interface AvailableDecisionsParams {
    requestId: string;
}

export interface AvailableDecisionsResponse {
    decisions: ServerRequestResolvedDecision[];
    [key: string]: unknown;
}

export type WindowsSandboxSetupMode = 'elevated' | 'unelevated';

export interface WindowsSandboxSetupStartParams {
    mode: WindowsSandboxSetupMode;
    cwd?: string | null;
}

export interface WindowsSandboxSetupStartResponse {
    started: boolean;
}

// === Collaboration Mode (upstream v0.18) ===

export interface CollaborationModeListItem {
    name?: string;
    mode?: 'plan' | 'default' | string | null;
    model?: string | null;
    reasoning_effort?: ReasoningEffort | null;
    [key: string]: unknown;
}

export interface CollaborationModeListResponse {
    data?: Array<CollaborationModeListItem | string>;
    modes?: Array<CollaborationModeListItem | string>;
    collaborationModes?: Array<CollaborationModeListItem | string>;
    items?: Array<CollaborationModeListItem | string>;
    [key: string]: unknown;
}

// === Thread Goal (upstream v0.18) ===

export type ThreadGoalStatus = 'active' | 'paused' | 'budgetLimited' | 'complete';

export interface ThreadGoal {
    threadId: string;
    objective: string;
    status: ThreadGoalStatus;
    tokenBudget: number | null;
    tokensUsed: number;
    timeUsedSeconds: number;
    createdAt: number;
    updatedAt: number;
}

export interface ThreadGoalSetParams {
    threadId: string;
    objective?: string | null;
    status?: ThreadGoalStatus | null;
    tokenBudget?: number | null;
}

export interface ThreadGoalSetResponse {
    goal: ThreadGoal;
    [key: string]: unknown;
}

export interface ThreadGoalGetParams {
    threadId: string;
}

export interface ThreadGoalGetResponse {
    goal: ThreadGoal | null;
    [key: string]: unknown;
}

export interface ThreadGoalClearParams {
    threadId: string;
}

export interface ThreadGoalClearResponse {
    cleared: boolean;
    [key: string]: unknown;
}

// === Experimental Feature Enablement (upstream v0.18) ===

export interface ExperimentalFeatureEnablementSetParams {
    enablement: Record<string, boolean>;
}

export interface ExperimentalFeatureEnablementSetResponse {
    enablement: Record<string, boolean>;
    [key: string]: unknown;
}

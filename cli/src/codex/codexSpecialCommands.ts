export type CodexSpecialCommand =
    | { type: 'clear' | 'compact' }
    | { type: 'fork' }
    | { type: 'rollback'; numTurns?: number }
    | { type: 'invalid'; command: string; message: string }
    | { type: null };

export function parseCodexSpecialCommand(message: string): CodexSpecialCommand {
    const trimmed = message.trim();
    if (trimmed === '/clear') {
        return { type: 'clear' };
    }
    if (trimmed === '/compact') {
        return { type: 'compact' };
    }
    if (trimmed.startsWith('/clear ')) {
        return {
            type: 'invalid',
            command: 'clear',
            message: '/clear does not accept arguments'
        };
    }
    if (trimmed.startsWith('/compact ')) {
        return {
            type: 'invalid',
            command: 'compact',
            message: '/compact does not accept arguments'
        };
    }
    if (trimmed === '/fork') {
        return { type: 'fork' };
    }
    if (trimmed.startsWith('/fork ')) {
        return {
            type: 'invalid',
            command: 'fork',
            message: '/fork does not accept arguments'
        };
    }
    if (trimmed === '/rollback') {
        return { type: 'rollback', numTurns: 1 };
    }
    if (trimmed.startsWith('/rollback ')) {
        const arg = trimmed.slice(10).trim();
        const numTurns = parseInt(arg, 10);
        if (isNaN(numTurns) || numTurns < 1) {
            return {
                type: 'invalid',
                command: 'rollback',
                message: '/rollback requires a positive number (e.g. /rollback 2)'
            };
        }
        return { type: 'rollback', numTurns };
    }
    return { type: null };
}

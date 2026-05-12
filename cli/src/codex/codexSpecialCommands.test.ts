import { describe, expect, it } from 'vitest';
import { parseCodexSpecialCommand } from './codexSpecialCommands';

describe('parseCodexSpecialCommand', () => {
    it('accepts exact /clear and /compact commands', () => {
        expect(parseCodexSpecialCommand('  /clear  ')).toEqual({ type: 'clear' });
        expect(parseCodexSpecialCommand('/compact')).toEqual({ type: 'compact' });
    });

    it('rejects argument-bearing special commands without treating them as prompts', () => {
        expect(parseCodexSpecialCommand('/clear now')).toEqual({
            type: 'invalid',
            command: 'clear',
            message: '/clear does not accept arguments'
        });
        expect(parseCodexSpecialCommand('/compact summarize this')).toEqual({
            type: 'invalid',
            command: 'compact',
            message: '/compact does not accept arguments'
        });
    });

    it('ignores regular slash-like messages', () => {
        expect(parseCodexSpecialCommand('/clearing')).toEqual({ type: null });
        expect(parseCodexSpecialCommand('please /clear')).toEqual({ type: null });
    });

    it('parses /fork command', () => {
        expect(parseCodexSpecialCommand('/fork')).toEqual({ type: 'fork' });
    });

    it('rejects /fork with arguments', () => {
        expect(parseCodexSpecialCommand('/fork hello')).toEqual({
            type: 'invalid',
            command: 'fork',
            message: '/fork does not accept arguments'
        });
    });

    it('parses /rollback without argument as 1 turn', () => {
        expect(parseCodexSpecialCommand('/rollback')).toEqual({ type: 'rollback', numTurns: 1 });
    });

    it('parses /rollback with a number', () => {
        expect(parseCodexSpecialCommand('/rollback 3')).toEqual({ type: 'rollback', numTurns: 3 });
        expect(parseCodexSpecialCommand('/rollback 10')).toEqual({ type: 'rollback', numTurns: 10 });
    });

    it('rejects /rollback with invalid arguments', () => {
        expect(parseCodexSpecialCommand('/rollback abc')).toEqual({
            type: 'invalid',
            command: 'rollback',
            message: '/rollback requires a positive number (e.g. /rollback 2)'
        });
        expect(parseCodexSpecialCommand('/rollback -1')).toEqual({
            type: 'invalid',
            command: 'rollback',
            message: '/rollback requires a positive number (e.g. /rollback 2)'
        });
        expect(parseCodexSpecialCommand('/rollback 0')).toEqual({
            type: 'invalid',
            command: 'rollback',
            message: '/rollback requires a positive number (e.g. /rollback 2)'
        });
    });
});

import { readdir, stat, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve as resolvePath } from 'node:path'
import { logger } from '@/ui/logger'
import type { CodexAppServerClient } from '@/codex/codexAppServerClient'

interface CachedSession {
    sessionId: string
    filePath: string
    mtime: number
    size: number
    cwd: string
}

let cache: CachedSession[] | null = null
let cachedAt = 0
const CACHE_TTL = 30_000

let appServerClient: CodexAppServerClient | null = null

export function setCodexAppServerClient(client: CodexAppServerClient | null): void {
    appServerClient = client
    cache = null
    cachedAt = 0
}

async function scan(): Promise<CachedSession[]> {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    const sessionsRoot = join(codexHome, 'sessions')
    const sessions: CachedSession[] = []

    try {
        const yearDirs = await readdir(sessionsRoot)
        for (const year of yearDirs) {
            const yearPath = join(sessionsRoot, year)
            let monthDirs: string[]
            try { monthDirs = await readdir(yearPath) } catch { continue }

            for (const month of monthDirs) {
                const monthPath = join(yearPath, month)
                let dayDirs: string[]
                try { dayDirs = await readdir(monthPath) } catch { continue }

                for (const day of dayDirs) {
                    const dayPath = join(monthPath, day)
                    let files: string[]
                    try { files = await readdir(dayPath) } catch { continue }

                    for (const name of files) {
                        if (!name.endsWith('.jsonl')) continue
                        const filePath = join(dayPath, name)

                        try {
                            const sessionId = name.match(/^rollout-[\dT-]+-(.+)\.jsonl$/)?.[1]
                            if (!sessionId) continue

                            const stats = await stat(filePath)
                            const buf = await readFile(filePath, { encoding: 'utf8' })
                            const newlineIdx = buf.indexOf('\n')
                            const firstLine = newlineIdx >= 0 ? buf.slice(0, newlineIdx) : buf
                            if (!firstLine) continue

                            const meta = JSON.parse(firstLine)
                            const cwd: string | undefined = meta?.payload?.cwd
                            if (!cwd) continue

                            sessions.push({ sessionId, filePath, mtime: stats.mtime.getTime(), size: stats.size, cwd })
                        } catch {
                            // skip unreadable files
                        }
                    }
                }
            }
        }
    } catch {
        // sessions root doesn't exist
    }

    return sessions
}

async function getSessions(): Promise<CachedSession[]> {
    if (cache && Date.now() - cachedAt < CACHE_TTL) {
        return cache
    }
    cache = await scan()
    cachedAt = Date.now()
    return cache
}

export async function listCodexSessionsFromFilesystem(workingDirectory: string): Promise<Array<{ sessionId: string; lastModified: number; size: number; cwd: string }>> {
    const all = await getSessions()
    const resolvedWorkingDir = resolvePath(workingDirectory).toLowerCase()
    return all
        .filter(s => resolvePath(s.cwd).toLowerCase() === resolvedWorkingDir)
        .map(s => ({ sessionId: s.sessionId, lastModified: s.mtime, size: s.size, cwd: s.cwd }))
        .sort((a, b) => b.lastModified - a.lastModified)
}

export async function listCodexSessions(workingDirectory: string): Promise<Array<{ sessionId: string; lastModified: number; size: number; cwd: string }>> {
    if (appServerClient) {
        try {
            const response = await appServerClient.listThreads({ cwd: workingDirectory })
            if (response.data && response.data.length > 0) {
                const mapped = response.data
                    .map(item => {
                        if (!item.id || !item.cwd) return null
                        const lastModified = item.updatedAt ?? Date.now()
                        return {
                            sessionId: item.id,
                            lastModified,
                            size: 0,
                            cwd: item.cwd
                        }
                    })
                    .filter((s): s is NonNullable<typeof s> => s !== null)
                if (mapped.length > 0) {
                    return mapped.sort((a, b) => b.lastModified - a.lastModified)
                }
            }
        } catch (error) {
            logger.debug('[codexSessionCache] thread/list failed, falling back to filesystem scan', error)
        }
    }

    return listCodexSessionsFromFilesystem(workingDirectory)
}

export async function findCodexSessionCwd(sessionId: string): Promise<string | null> {
    const all = await getSessions()
    return all.find(s => s.sessionId === sessionId)?.cwd ?? null
}

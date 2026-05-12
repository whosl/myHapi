import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface CachedEntry {
    sessionId: string
    filePath: string
}

let cache: CachedEntry[] | null = null
let cachedAt = 0
const CACHE_TTL = 30_000

async function scan(): Promise<CachedEntry[]> {
    const codexHome = process.env.CODEX_HOME || join(homedir(), '.codex')
    const sessionsRoot = join(codexHome, 'sessions')
    const entries: CachedEntry[] = []

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
                        const sessionId = name.match(/^rollout-[\dT-]+-(.+)\.jsonl$/)?.[1]
                        if (!sessionId) continue
                        entries.push({ sessionId, filePath: join(dayPath, name) })
                    }
                }
            }
        }
    } catch {
        // sessions root doesn't exist
    }

    return entries
}

async function getEntries(): Promise<CachedEntry[]> {
    if (cache && Date.now() - cachedAt < CACHE_TTL) {
        return cache
    }
    cache = await scan()
    cachedAt = Date.now()
    return cache
}

export async function findCodexSessionPath(sessionId: string): Promise<string | null> {
    const entries = await getEntries()
    return entries.find(e => e.sessionId === sessionId)?.filePath ?? null
}

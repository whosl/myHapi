import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export type ClaudeSessionInfo = {
    sessionId: string
    lastModified: number
    size: number
    cwd: string
}

export function useClaudeSessions(args: {
    api: ApiClient | null
    machineId: string | null
    workingDirectory: string
    enabled?: boolean
}): {
    sessions: ClaudeSessionInfo[]
    isLoading: boolean
} {
    const { api, machineId, workingDirectory } = args
    const enabled = Boolean(args.enabled && api && machineId && workingDirectory)

    const query = useQuery({
        queryKey: queryKeys.machineClaudeSessions(machineId ?? '', workingDirectory),
        queryFn: async () => {
            if (!api || !machineId) throw new Error('API unavailable')
            return await api.listClaudeSessions(machineId, workingDirectory)
        },
        enabled,
        staleTime: 30_000,
        retry: false,
    })

    return {
        sessions: query.data?.sessions ?? [],
        isLoading: query.isLoading,
    }
}

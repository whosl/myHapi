import { useState } from 'react'
import type { ApiClient } from '@/api/client'

export function ImportHistoryDialog(props: {
    isOpen: boolean
    onClose: () => void
    api: ApiClient | null
    sessionId: string
    workingDirectory?: string
}) {
    const [claudeSessionId, setClaudeSessionId] = useState('')
    const [importing, setImporting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [imported, setImported] = useState<number | null>(null)

    if (!props.isOpen) return null

    const handleImport = async () => {
        if (!props.api || !claudeSessionId.trim() || !props.workingDirectory) return
        setImporting(true)
        setError(null)
        setImported(null)
        try {
            const result = await props.api.importClaudeHistory(
                props.sessionId,
                claudeSessionId.trim(),
                props.workingDirectory
            )
            setImported(result.imported)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Failed to import history')
        } finally {
            setImporting(false)
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={props.onClose}>
            <div
                className="mx-4 w-full max-w-md rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-4 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className="text-lg font-semibold mb-3">Import Claude Session History</h2>

                {!props.workingDirectory ? (
                    <p className="text-sm text-[var(--app-hint)] mb-4">
                        No working directory found for this session.
                    </p>
                ) : (
                    <>
                        <p className="text-sm text-[var(--app-hint)] mb-3">
                            Import conversation history from an existing Claude Code session into this HAPI session.
                        </p>

                        <label className="block text-sm font-medium mb-1">Claude Session ID</label>
                        <input
                            type="text"
                            value={claudeSessionId}
                            onChange={(e) => setClaudeSessionId(e.target.value)}
                            placeholder="e.g. 19536e23-908d-42aa-8bf5-..."
                            className="w-full rounded-md border border-[var(--app-border)] bg-transparent px-3 py-2 text-sm mb-1"
                            disabled={importing}
                        />
                        <p className="text-xs text-[var(--app-hint)] mb-3">
                            Working directory: {props.workingDirectory}
                        </p>

                        {error && (
                            <p className="text-sm text-red-600 mb-3">{error}</p>
                        )}

                        {imported !== null && (
                            <p className="text-sm text-green-600 mb-3">
                                Successfully imported {imported} messages.
                            </p>
                        )}

                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={props.onClose}
                                className="rounded-md px-4 py-2 text-sm hover:bg-[var(--app-subtle-bg)]"
                                disabled={importing}
                            >
                                {imported !== null ? 'Close' : 'Cancel'}
                            </button>
                            {imported === null && (
                                <button
                                    type="button"
                                    onClick={handleImport}
                                    disabled={importing || !claudeSessionId.trim()}
                                    className="rounded-md bg-[var(--app-accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
                                >
                                    {importing ? 'Importing...' : 'Import'}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

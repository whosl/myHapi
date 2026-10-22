import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PendingAttachment } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import { createAttachmentAdapter } from './attachmentAdapter'

const key = 'uploads/session-1/object/file.txt'
const path = '/tmp/hapi/uploads/file.txt'
function setup() {
    const api = {
        presignUpload: vi.fn().mockResolvedValue({ success: true, key, uploadUrl: 'https://r2/upload' }),
        confirmR2Upload: vi.fn().mockResolvedValue({ success: true, path }),
        deleteR2Upload: vi.fn().mockResolvedValue({ success: true }),
        deleteUploadFile: vi.fn().mockResolvedValue({ success: true }),
        uploadFile: vi.fn().mockResolvedValue({ success: true, path })
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const adapter = createAttachmentAdapter(api as unknown as ApiClient, 'session-1')
    const generator = adapter.add({ file: new File(['hello'], 'file.txt', { type: 'text/plain' }) }) as AsyncGenerator<PendingAttachment>
    return { api, adapter, generator }
}
afterEach(() => vi.unstubAllGlobals())
describe('R2 attachments', () => {
    it('sends local metadata and removes both local and R2 uploads', async () => {
        const { api, adapter, generator } = setup()
        await generator.next()
        const pending = (await generator.next()).value!
        const complete = await adapter.send(pending)
        expect(complete.content).toEqual([expect.objectContaining({ text: expect.stringContaining(`"path":"${path}"`) })])
        await adapter.remove(pending)
        expect(api.deleteUploadFile).toHaveBeenCalledWith('session-1', path)
        expect(api.deleteR2Upload).toHaveBeenCalledWith('session-1', key)
    })

    it.each(['put', 'confirm'])('cleans uploads canceled during %s', async (stage) => {
        const { api, adapter, generator } = setup()
        const initial = (await generator.next()).value!
        let resolve!: (value: never) => void
        const waiting = new Promise<never>(r => { resolve = r })
        if (stage === 'put') vi.mocked(fetch).mockReturnValue(waiting)
        else api.confirmR2Upload.mockReturnValue(waiting)
        const next = generator.next()
        await vi.waitFor(() => expect(stage === 'put' ? fetch : api.confirmR2Upload).toHaveBeenCalled())
        await adapter.remove(initial)
        resolve((stage === 'put' ? { ok: true } : { success: true, path }) as never)
        expect((await next).done).toBe(true)
        expect(api.deleteR2Upload).toHaveBeenCalledWith('session-1', key)
        expect(api.uploadFile).not.toHaveBeenCalled()
        if (stage === 'confirm') expect(api.deleteUploadFile).toHaveBeenCalledWith('session-1', path)
    })

    it('cleans a local fallback upload canceled while awaiting the server', async () => {
        const { api, adapter, generator } = setup()
        api.presignUpload.mockRejectedValue(new Error('R2 unavailable'))
        const initial = (await generator.next()).value!
        await generator.next()
        let resolve!: (value: { success: boolean; path: string }) => void
        api.uploadFile.mockReturnValue(new Promise(r => { resolve = r }))
        const next = generator.next()
        await vi.waitFor(() => expect(api.uploadFile).toHaveBeenCalled())
        await adapter.remove(initial)
        resolve({ success: true, path })
        expect((await next).done).toBe(true)
        expect(api.deleteUploadFile).toHaveBeenCalledWith('session-1', path)
        expect(api.deleteR2Upload).not.toHaveBeenCalled()
    })

    it('does not start an upload canceled before processing', async () => {
        const { api, adapter, generator } = setup()
        const initial = (await generator.next()).value!
        await adapter.remove(initial)
        expect((await generator.next()).done).toBe(true)
        expect(api.presignUpload).not.toHaveBeenCalled()
        expect(api.uploadFile).not.toHaveBeenCalled()
    })

    it('cleans R2 on confirmation failure before falling back to local upload', async () => {
        const { api, generator } = setup()
        api.confirmR2Upload.mockRejectedValue(new Error('failed'))
        let pending: PendingAttachment | undefined
        for await (const value of generator) pending = value
        expect(pending).toMatchObject({ path, status: { type: 'requires-action' } })
        expect(api.deleteR2Upload).toHaveBeenCalledWith('session-1', key)
        expect(api.uploadFile).toHaveBeenCalled()
    })
})

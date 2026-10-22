import { describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import * as r2Storage from '../../storage/r2Storage'
import { createSessionsRoutes } from './sessions'

function setup() {
    const uploadFile = mock(async () => ({ success: true, path: '/tmp/uploads/file.txt' }))
    const readUpload = mock(async () => 'aGVsbG8=')
    const deleteUpload = mock(async () => {})
    const engine = {
        resolveSessionAccess: () => ({ ok: true, sessionId: 'session-1', session: { active: true } }),
        uploadFile
    } as unknown as SyncEngine
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => { c.set('namespace', 'default'); await next() })
    app.route('/api', createSessionsRoutes(() => engine, { ...r2Storage, readUpload, deleteUpload }))
    const request = (route: string, key = 'uploads/session-1/id/file.txt') => app.request(`/api/sessions/session-1/upload/${route}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, filename: 'file.txt', mimeType: 'text/plain' })
    })
    return { request, uploadFile, readUpload, deleteUpload }
}

describe('R2 upload routes', () => {
    it('materializes bytes through CLI upload and returns a local path', async () => {
        const { request, uploadFile, readUpload } = setup()
        const response = await request('r2-complete')
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({ success: true, path: '/tmp/uploads/file.txt' })
        expect(readUpload).toHaveBeenCalledWith('uploads/session-1/id/file.txt', 50 * 1024 * 1024)
        expect(uploadFile).toHaveBeenCalledWith('session-1', 'file.txt', 'aGVsbG8=', 'text/plain')
    })
    it('does not claim success when local materialization fails', async () => {
        const { request, uploadFile } = setup()
        uploadFile.mockImplementation(async () => ({ success: false, path: '' }))
        expect(await (await request('r2-complete')).json()).toMatchObject({ success: false })
    })
    it('deletes the remote object by key', async () => {
        const { request, deleteUpload, uploadFile } = setup()
        expect(await (await request('r2-delete')).json()).toEqual({ success: true })
        expect(deleteUpload).toHaveBeenCalledWith('uploads/session-1/id/file.txt')
        expect(uploadFile).not.toHaveBeenCalled()
    })
    it.each(['r2-complete', 'r2-delete'])('rejects foreign session keys for %s', async route => {
        const { request, readUpload, deleteUpload } = setup()
        expect((await request(route, 'uploads/session-2/id/file.txt')).status).toBe(400)
        expect(readUpload).not.toHaveBeenCalled()
        expect(deleteUpload).not.toHaveBeenCalled()
    })
})

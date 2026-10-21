import { expect, test } from "@playwright/test"
import { _electron as electron } from "playwright"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import path from "node:path"
import { createServer } from "vite"

test("development frontend completes startup after a production build", async () => {
    const testRoot = path.resolve("test-output")
    mkdirSync(testRoot, { recursive: true })
    const temporaryRoot = mkdtempSync(path.join(testRoot, "dev-startup-"))
    const server = await createServer({ mode: "development" })
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined
    try {
        await server.listen()
        app = await electron.launch({
            args: [".", `--user-data-dir=${path.join(temporaryRoot, "browser")}`],
            env: { ...process.env, NODE_ENV: "development", FS_MOCK_STORE_PATH: path.join(temporaryRoot, "settings") }
        })

        // The real main window only becomes visible after the frontend's IPC
        // startup handshake; a splash-only hang never meets this condition.
        await expect.poll(async () => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().startsWith("http://localhost:3000") && window.isVisible())), { timeout: 60_000 }).toBe(true)
        const main = app.windows().find((window) => window.url().startsWith("http://localhost:3000"))!
        await expect(main.locator("body")).not.toBeEmpty()
    } finally {
        if (app) {
            // This instance uses disposable stores and never opens the user's shows.
            await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
            await app.close().catch(() => {})
        }
        await server.close()
        if (path.dirname(temporaryRoot) !== testRoot) throw new Error("Refusing to remove a path outside the test fixtures")
        rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 3 })
    }
})

import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compile, preprocess } from "svelte/compiler"
import sveltePreprocess from "svelte-preprocess"

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} })

let script = ""
test.beforeAll(async () => {
    const filename = path.resolve("config/testing/FocusHarness.svelte")
    const source = `<script>
        import FocusMode from "../../src/frontend/components/show/focus/FocusMode.svelte"
        import { activeFocus, activeProject, outputs, projects } from "../../src/frontend/stores"
        projects.set({test: {shows: [{id: "announcements", type: "show", name: "Announcements"}, {id: "next", type: "show", name: "Next show"}]}})
        activeProject.set("test")
        activeFocus.set({id: "announcements", index: 0, type: "show"})
        outputs.set({main: {out: {slide: {id: "announcements", layout: "layout", index: 0}}}})
        window.advance = (index, autoAdvance) => outputs.set({main: {out: {slide: {id: "announcements", layout: "layout", index, autoAdvance}}}})
        window.selectNext = () => activeFocus.set({id: "next", index: 1, type: "show"})
    </script>
    <div class="center" style="height:400px; overflow:auto; position:relative"><FocusMode /></div>`
    const compiled = compile(source, { filename, generate: "dom" })
    const result = await build({
        stdin: { contents: compiled.js.code + "\nnew FocusHarness({target: document.body})", resolveDir: path.dirname(filename) },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        plugins: [
            {
                name: "focus-test-data",
                setup(builder) {
                    // Use the real FocusMode and stores, with deterministic project data
                    // and simple slide geometry instead of loading shows from disk.
                    builder.onLoad({ filter: /[\\/]components[\\/]helpers[\\/]output\.ts$/ }, () => ({ contents: "export const getActiveOutputs = outputs => Object.keys(outputs)", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]show[\\/]focus[\\/]focus\.ts$/ }, () => ({ contents: "export const getAllProjectItems = async items => items", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]utils[\\/]common\.ts$/ }, () => ({ contents: "export const hasNewerUpdate = async () => false", loader: "js" }))
                    builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
                        let source: string
                        if (filename.endsWith("FocusItem.svelte")) source = '<script>export let show</script><div class="grid">{#each Array(10) as _, index}<div class="slide" style="height:300px">{show.id} {index}</div>{/each}</div>'
                        else if (/\b(Icon|T|Center|Loader)\.svelte$/.test(filename)) source = "<slot />"
                        else source = await readFile(filename, "utf8")
                        const processed = await preprocess(source, sveltePreprocess({ typescript: { tsconfigFile: false } }), { filename })
                        return { contents: compile(processed.code, { filename, generate: "dom" }).js.code, loader: "js" }
                    })
                }
            }
        ]
    })
    script = result.outputFiles[0].text
})

test("timed rotations preserve the viewport while manual navigation still follows", async ({ page }) => {
    await page.setContent("<html><body></body></html>")
    await page.addScriptTag({ content: script })
    await expect(page.locator(".slide")).toHaveCount(20)
    // Wait for project initialization and focus synchronization to settle.
    await page.waitForTimeout(200)
    await page.evaluate(() => {
        document.querySelector(".center")!.scrollTop = 1700
    })
    await page.waitForTimeout(550)
    const position = await page.locator(".center").evaluate((element) => element.scrollTop)

    for (const index of [1, 2, 0]) {
        await page.evaluate((index) => (window as any).advance(index, true), index)
        await page.waitForTimeout(100)
        expect(await page.locator(".center").evaluate((element) => element.scrollTop)).toBe(position)
    }

    await page.evaluate(() => (window as any).advance(8, false))
    await expect.poll(() => page.locator(".center").evaluate((element) => element.scrollTop)).toBeGreaterThan(position)

    // Explicitly selecting another show remains available while rotation runs.
    await page.evaluate(() => (window as any).advance(0, true))
    await page.evaluate(() => (window as any).selectNext())
    await expect.poll(() => page.locator(".center").evaluate((element) => element.scrollTop)).toBeGreaterThan(2800)
})

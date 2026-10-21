import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compile, preprocess } from "svelte/compiler"
import sveltePreprocess from "svelte-preprocess"

// Exercise the real output wrapper beneath a keyed parent, as used by slides,
// overlays, and media. Local transitions disappear immediately in this case.
test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} })

let script = ""
test.beforeAll(async () => {
    const filename = path.resolve("config/testing/TransitionHarness.svelte")
    const source = `
        <script>
            import OutputTransition from "../../src/frontend/components/output/transitions/OutputTransition.svelte"
            export let slide = "First"
            export let type = "fade"
        </script>
        {#key slide}
            {#if slide}
                <OutputTransition transition={{type, duration: 800, easing: "linear"}}>
                    <p data-slide={slide}>{slide}</p>
                </OutputTransition>
            {/if}
        {/key}`
    const compiled = compile(source, { filename, generate: "dom" })
    const result = await build({
        stdin: { contents: compiled.js.code + "\nwindow.harness = new TransitionHarness({target: document.body});", resolveDir: path.dirname(filename), sourcefile: filename.replace(".svelte", ".js") },
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        plugins: [
            {
                name: "svelte-test-components",
                setup(builder) {
                    builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
                        const source = await readFile(filename, "utf8")
                        const processed = await preprocess(source, sveltePreprocess({ typescript: { tsconfigFile: false } }), { filename })
                        return { contents: compile(processed.code, { filename, generate: "dom" }).js.code, loader: "js" }
                    })
                }
            }
        ]
    })
    // Svelte names the compiled component after its file.
    script = result.outputFiles[0].text
})

test.beforeEach(async ({ page }) => {
    await page.setContent("<html><body></body></html>")
    await page.addScriptTag({ content: script })
    await page.waitForFunction(() => {
        const element = document.querySelector('[data-slide="First"]')?.parentElement
        return element && Number(getComputedStyle(element).opacity) === 1
    })
})

test("the outgoing and incoming slide fade at the same time", async ({ page }) => {
    await page.evaluate(() => (window as any).harness.$set({ slide: "Second" }))
    await page.waitForFunction(() => {
        const opacity = (slide: string) => {
            const element = document.querySelector(`[data-slide="${slide}"]`)?.parentElement
            return element ? Number(getComputedStyle(element).opacity) : -1
        }
        return opacity("First") > 0.1 && opacity("First") < 0.9 && opacity("Second") > 0.1 && opacity("Second") < 0.9
    })
    await expect(page.locator('[data-slide="First"]')).toHaveCount(0)
    await expect(page.locator('[data-slide="Second"]')).toHaveCount(1)
})

test("clearing fades the previous slide out", async ({ page }) => {
    await page.evaluate(() => (window as any).harness.$set({ slide: "" }))
    await page.waitForFunction(() => {
        const element = document.querySelector('[data-slide="First"]')?.parentElement
        const opacity = element ? Number(getComputedStyle(element).opacity) : -1
        return opacity > 0.1 && opacity < 0.9
    })
    await expect(page.locator("[data-slide]")).toHaveCount(0)
})

test("rapid advances leave only the final slide", async ({ page }) => {
    await page.evaluate(() => (window as any).harness.$set({ slide: "Second" }))
    await expect(page.locator('[data-slide="Second"]')).toHaveCount(1)
    await page.evaluate(() => (window as any).harness.$set({ slide: "Third" }))
    await expect(page.locator('[data-slide="First"]')).toHaveCount(0)
    await expect(page.locator('[data-slide="Second"]')).toHaveCount(0)
    await expect(page.locator('[data-slide="Third"]')).toHaveCount(1)
})

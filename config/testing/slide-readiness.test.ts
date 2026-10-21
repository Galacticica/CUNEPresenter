import { expect, test } from "@playwright/test"
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { compile, preprocess } from "svelte/compiler"
import sveltePreprocess from "svelte-preprocess"

test.use({ launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {} })

let script = ""
test.beforeAll(async () => {
    const filename = path.resolve("config/testing/SlideReadinessHarness.svelte")
    const source = `<script>
        import SlideContent from "../../src/frontend/components/output/layers/SlideContent.svelte"
        export let currentSlide = {id: "First", items: [{id: "textbox", type: "text", lines: [{text: [{value: "First"}]}]}]}
        export let outSlide = {id: "test", index: 0}
    </script>
    <div style="position:relative;width:800px;height:450px">
        <SlideContent {currentSlide} {outSlide} outputId="main" slideData={null} currentStyle={{}} animationData={{}} currentLineId="main" lines={{main: {start: 2, end: 4}}} ratio={0.4} transition={{type: "fade", duration: 120, easing: "linear"}} transitionEnabled />
    </div>`
    const compiled = compile(source, { filename, generate: "dom" })
    const mockTextbox = `<script>
        import {createEventDispatcher, onMount, onDestroy} from "svelte"
        export let item
        export let autoSizeKey = ""
        export let precomputedFontSize = undefined
        export let linesStart = undefined
        export let linesEnd = undefined
        const dispatch = createEventDispatcher()
        let measured = !item.auto
        let timer
        onMount(() => {
            timer = setTimeout(() => { measured = true; dispatch("autosizeReady", {key: autoSizeKey, fontSize: 72}) }, item.measureDelay || 0)
        })
        onDestroy(() => clearTimeout(timer))
    </script>
    <div class="test-text" data-text={item.lines[0].text[0].value} data-range={linesStart + ":" + linesEnd} style="opacity:{measured || precomputedFontSize > 0 ? 1 : 0};font-size:{precomputedFontSize || 72}px">{item.lines[0].text[0].value}</div>`
    const result = await build({
        stdin: {
            contents:
                compiled.js.code +
                `
            window.harness = new SlideReadinessHarness({target: document.body})
            let index = 0
            window.changeSlide = (text, delay = 350, cached = false) => window.harness.$set({
                outSlide: {id: "test", index: ++index},
                currentSlide: {id: text, items: [{id: "textbox", type: "text", auto: true, autoFontSize: cached ? 40 : undefined, measureDelay: delay, lines: [{text: [{value: text}]}]}]}
            })`,
            resolveDir: path.dirname(filename)
        },
        bundle: true,
        write: false,
        platform: "browser",
        format: "iife",
        plugins: [
            {
                name: "controlled-text-readiness",
                setup(builder) {
                    // Exercise the actual SlideContent + transition components. Only
                    // replace disk/app services and text measurement with a controlled
                    // delay longer than the previous 150 ms preparation deadline.
                    builder.onLoad({ filter: /[\\/]helpers[\\/]output\.ts$/ }, () => ({
                        contents: `
                    export const itemHasAutoSize = item => !!item.auto
                    export const itemNeedsAutoSize = item => !!item.auto && !item.autoFontSize
                    export const getStyleTemplate = () => ({})
                    export const slideHasAutoSizeItem = slide => slide?.items?.some(itemHasAutoSize)
                `,
                        loader: "js"
                    }))
                    builder.onLoad({ filter: /[\\/]helpers[\\/]array\.ts$/ }, () => ({ contents: "export const clone = value => structuredClone(value)", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]helpers[\\/]fonts\.ts$/ }, () => ({ contents: "export const loadCustomFonts = () => {}", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]scripts[\\/]itemHelpers\.ts$/ }, () => ({ contents: "export const shouldItemBeShown = () => true", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]scripts[\\/]textStyle\.ts$/ }, () => ({ contents: "export const getItemText = item => item.lines?.flatMap(line => line.text.map(text => text.value)).join('') || ''", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]utils[\\/]common\.ts$/ }, () => ({ contents: "export const waitUntilValueIsDefined = async () => true", loader: "js" }))
                    builder.onLoad({ filter: /[\\/]timeline[\\/]SlideTimeline\.ts$/ }, () => ({ contents: "export const SlideTimeline = {}", loader: "js" }))
                    builder.onLoad({ filter: /\.svelte$/ }, async ({ path: filename }) => {
                        const source = filename.endsWith("Textbox.svelte") ? mockTextbox : await readFile(filename, "utf8")
                        const processed = await preprocess(source, sveltePreprocess({ typescript: { tsconfigFile: false } }), { filename })
                        return { contents: compile(processed.code, { filename, generate: "dom" }).js.code, loader: "js" }
                    })
                }
            }
        ]
    })
    script = result.outputFiles[0].text
})

test.beforeEach(async ({ page }) => {
    await page.setContent("<html><body></body></html>")
    await page.addScriptTag({ content: script })
    await expect(page.locator('[data-text="First"]')).toBeVisible()
    await page.waitForFunction(() => {
        const text = document.querySelector('[data-text="First"]')
        return text?.parentElement && getComputedStyle(text.parentElement).opacity === "1"
    })
    await page.evaluate(() => {
        const state = { running: true, blankFrames: 0, samples: 0 }
        ;(window as any).frameTrace = state
        function sample() {
            const visible = [...document.querySelectorAll(".test-text")].some((text) => {
                let element: Element | null = text
                let opacity = 1
                while (element) {
                    const style = getComputedStyle(element)
                    if (style.visibility === "hidden" || style.display === "none") return false
                    opacity *= Number(style.opacity)
                    element = element.parentElement
                }
                return opacity > 0.01
            })
            state.samples++
            if (!visible) state.blankFrames++
            if (state.running) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
    })
})

for (const cached of [false, true]) {
    test(`slow incoming text never leaves a blank frame (${cached ? "existing size" : "cold size"})`, async ({ page }) => {
        await page.evaluate((cached) => (window as any).changeSlide("Second", 350, cached), cached)
        const probe = page.locator(".autosize-precompute")
        await expect(probe).toHaveCSS("width", "800px")
        await expect(probe).toHaveCSS("height", "450px")
        await expect(probe.locator(".test-text")).toHaveAttribute("data-range", "2:4")
        await expect(page.locator('[data-text="First"]')).toHaveCount(0)
        await expect(page.locator('[data-text="Second"]')).toHaveCSS("font-size", "72px")
        const frames = await page.evaluate(() => {
            const trace = (window as any).frameTrace
            trace.running = false
            return trace
        })
        expect(frames.samples).toBeGreaterThan(5)
        expect(frames.blankFrames).toBe(0)
    })
}

test("advancing again while text is preparing does not reveal the superseded slide", async ({ page }) => {
    await page.evaluate(() => (window as any).changeSlide("Second", 500))
    await page.waitForTimeout(100)
    await page.evaluate(() => (window as any).changeSlide("Third", 350))
    await expect(page.locator('[data-text="First"]')).toHaveCount(0)
    await expect(page.locator('[data-text="Second"]')).toHaveCount(0)
    await expect(page.locator('[data-text="Third"]')).toHaveCSS("font-size", "72px")
    expect(await page.evaluate(() => (window as any).frameTrace.blankFrames)).toBe(0)
})

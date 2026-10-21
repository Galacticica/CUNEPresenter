import { beforeEach, describe, expect, it, vi } from "vitest"
import { OutputVisibility } from "./OutputVisibility"

const state = vi.hoisted(() => ({ displays: [] as any[] }))
vi.mock("electron", () => ({ screen: { getAllDisplays: () => state.displays } }))
vi.mock("../..", () => ({ isMac: false, mainWindow: { getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }) }, toApp: vi.fn() }))
vi.mock("../OutputHelper", () => ({ OutputHelper: {} }))
vi.mock("./OutputAlwaysOnTop", () => ({ setOutputAlwaysOnTop: vi.fn() }))

describe("restoring the selected output display", () => {
    const primary = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }
    const projector = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 720 } }
    beforeEach(() => {
        state.displays = [primary, projector]
    })

    it("follows the saved monitor after Windows rearranges the displays", () => {
        // The old projector coordinates now fall within the primary monitor.
        expect(OutputVisibility.resolveOutputBounds({ bounds: primary.bounds, screen: "2" }, true)).toEqual(projector.bounds)
    })

    it("keeps locked custom bounds even with a saved monitor", () => {
        const bounds = { x: 2100, y: 100, width: 800, height: 600 }
        expect(OutputVisibility.resolveOutputBounds({ bounds, screen: "2", boundsLocked: true }, true)).toEqual(bounds)
    })

    it("keeps manual bounds when no monitor was selected", () => {
        const bounds = { x: 2100, y: 100, width: 800, height: 600 }
        expect(OutputVisibility.resolveOutputBounds({ bounds, screen: null }, true)).toEqual(bounds)
    })

    it("handles a disconnected saved monitor without losing valid fallback bounds", () => {
        state.displays = [primary]
        expect(OutputVisibility.resolveOutputBounds({ bounds: primary.bounds, screen: "2" })).toEqual(primary.bounds)
    })
})

import { describe, expect, it } from "vitest"
import type { Show } from "../../../types/Show"
import { getEffectiveOutputLineLimit } from "./outputLineLimit"

const show = (bypassOutputLineLimit?: boolean) => ({ settings: { bypassOutputLineLimit } }) as Show

describe("output line limit exceptions", () => {
    it("keeps the configured output limit for existing shows", () => {
        expect(getEffectiveOutputLineLimit(show(), { name: "Songs" }, 6)).toBe(6)
        expect(getEffectiveOutputLineLimit(undefined, undefined, 2)).toBe(2)
    })

    it("uses all lines for a show bypass on every configured output", () => {
        expect(getEffectiveOutputLineLimit(show(true), { name: "Songs" }, 2)).toBe(0)
        expect(getEffectiveOutputLineLimit(show(true), { name: "Songs" }, 6)).toBe(0)
    })

    it("applies a category bypass even when the show box is unchecked", () => {
        expect(getEffectiveOutputLineLimit(show(false), { name: "Presentations", bypassOutputLineLimit: true }, 2)).toBe(0)
        expect(getEffectiveOutputLineLimit(show(false), { name: "Songs" }, 2)).toBe(2)
    })

    it("restores the configured limit when both exceptions are off", () => {
        expect(getEffectiveOutputLineLimit(show(false), { name: "Presentations", bypassOutputLineLimit: false }, 6)).toBe(6)
    })

    it("keeps template bypass independent from line limit bypass", () => {
        expect(getEffectiveOutputLineLimit({ settings: { bypassOutputTemplate: true } } as Show, { name: "Songs", bypassOutputTemplate: true }, 2)).toBe(2)
        expect(getEffectiveOutputLineLimit(show(true), { name: "Songs", bypassOutputTemplate: false }, 2)).toBe(0)
    })

    it("uses a show's custom count instead of each output's default", () => {
        const customShow = { settings: { outputLineLimit: 6 } } as Show
        expect(getEffectiveOutputLineLimit(customShow, undefined, 2)).toBe(6)
        expect(getEffectiveOutputLineLimit(customShow, undefined, 0)).toBe(6)
    })

    it("allows a custom show count to override a category's all-lines setting", () => {
        expect(getEffectiveOutputLineLimit({ settings: { outputLineLimit: 3 } } as Show, { name: "Presentations", bypassOutputLineLimit: true }, 2)).toBe(3)
    })

    it("shows all lines when show bypass is enabled, even with a saved custom count", () => {
        expect(getEffectiveOutputLineLimit({ settings: { bypassOutputLineLimit: true, outputLineLimit: 6 } } as Show, undefined, 2)).toBe(0)
    })
})

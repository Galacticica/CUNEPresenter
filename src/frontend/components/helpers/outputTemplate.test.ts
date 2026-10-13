import { describe, expect, it } from "vitest"
import type { Show, Slide } from "../../../types/Show"
import { bypassesOutputTemplate } from "./outputTemplate"

const show = (bypassOutputTemplate?: boolean) => ({ settings: { bypassOutputTemplate } }) as Show
const slide = (bypassOutputTemplate?: boolean) => ({ settings: { bypassOutputTemplate } }) as Slide

describe("output template bypass", () => {
    it("leaves existing shows and slides using the output template by default", () => {
        expect(bypassesOutputTemplate(show(), slide(), { name: "Songs" })).toBe(false)
        expect(bypassesOutputTemplate(null, null, null)).toBe(false)
    })

    it("allows a slide exception without affecting its sibling", () => {
        expect(bypassesOutputTemplate(show(), slide(true))).toBe(true)
        expect(bypassesOutputTemplate(show(), slide(false))).toBe(false)
    })

    it("applies a show exception to every slide, including unchecked slides", () => {
        expect(bypassesOutputTemplate(show(true), slide(false))).toBe(true)
        expect(bypassesOutputTemplate(show(true), slide())).toBe(true)
        expect(bypassesOutputTemplate(show(false), slide(false))).toBe(false)
    })

    it("applies a category exception even when both narrower boxes are unchecked", () => {
        expect(bypassesOutputTemplate(show(false), slide(false), { name: "Presentations", bypassOutputTemplate: true })).toBe(true)
        expect(bypassesOutputTemplate(show(false), slide(false), { name: "Songs", bypassOutputTemplate: false })).toBe(false)
    })

    it("does not clear narrower exceptions when a broader bypass is disabled", () => {
        expect(bypassesOutputTemplate(show(false), slide(true), { name: "Songs", bypassOutputTemplate: false })).toBe(true)
    })
})

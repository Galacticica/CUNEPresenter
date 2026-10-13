import { XMLParser } from "fast-xml-parser"
import { describe, expect, it, vi } from "vitest"
import type { Item } from "../../../types/Show"

vi.mock("../../components/helpers/array", () => ({ clone: (value: any) => structuredClone(value) }))
vi.mock("../../components/edit/scripts/textStyle", () => ({ getItemText: (item: Item) => (item.lines || []).flatMap((line) => line.text.map((text) => text.value)).join("") }))

import { PowerPointPackage } from "./PowerPointHelper"

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", preserveOrder: true, allowBooleanAttributes: true, ignoreDeclaration: true, trimValues: false })
const relType = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
const emu = (pixels: number) => pixels * 9525
const transform = (x = 100, y = 80, width = 500, height = 200) => `<a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(width)}" cy="${emu(height)}"/></a:xfrm>`
const shape = (text: string, geometry = transform(), placeholder = "", listStyle = "", body = "") => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Text"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr><p:spPr>${geometry}</p:spPr><p:txBody><a:bodyPr ${body}/><a:lstStyle>${listStyle}</a:lstStyle>${text}</p:txBody></p:sp>`
const run = (text: string, size?: number) => `<a:r><a:rPr ${size ? `sz="${size}"` : ""}/><a:t>${text}</a:t></a:r>`

function importItems(shapes: string, layoutShapes = "", masterShapes = "", masterStyle = "", size = { width: 1920, height: 1080 }) {
    const parts = {
        "ppt/presentation.xml": `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="slide"/></p:sldIdLst><p:sldSz cx="${emu(size.width)}" cy="${emu(size.height)}"/></p:presentation>`,
        "ppt/_rels/presentation.xml.rels": `<Relationships><Relationship Id="slide" Type="${relType}slide" Target="slides/slide1.xml"/></Relationships>`,
        "ppt/slides/slide1.xml": `<p:sld><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:sld>`,
        "ppt/slides/_rels/slide1.xml.rels": `<Relationships><Relationship Id="layout" Type="${relType}slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`,
        "ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout><p:cSld><p:spTree>${layoutShapes}</p:spTree></p:cSld></p:sldLayout>`,
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": `<Relationships><Relationship Id="master" Type="${relType}slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`,
        "ppt/slideMasters/slideMaster1.xml": `<p:sldMaster><p:cSld><p:spTree>${masterShapes}</p:spTree></p:cSld><p:txStyles><p:bodyStyle>${masterStyle}</p:bodyStyle></p:txStyles></p:sldMaster>`
    }
    const pkg = new PowerPointPackage(Object.fromEntries(Object.entries(parts).map(([path, xml]) => [path, parser.parse(xml)])))
    return pkg.getSlide(pkg.getPresentation()!, "ppt/slides/slide1.xml")!.items
}

describe("PowerPoint layout preservation", () => {
    it("preserves percentage superscripts and line spacing from the reference scripture slide", () => {
        const paragraph = `<a:p><a:pPr algn="ctr" indent="0" marL="457200" marR="457200"><a:lnSpc><a:spcPct val="105.0%"/></a:lnSpc><a:buNone/><a:defRPr sz="7500"><a:latin typeface="Verdana"/></a:defRPr></a:pPr><a:r><a:rPr baseline="25%"/><a:t>1</a:t></a:r>${run("Reference text")}</a:p>`
        const geometry = '<a:xfrm><a:off x="254000" y="254000"/><a:ext cx="23876000" cy="12194906"/></a:xfrm>'
        const [item] = importItems(shape(paragraph, geometry), "", "", "", { width: 2560, height: 1440 })
        expect(item.lines![0].text[0].value).toBe("1")
        expect(item.lines![0].text[0].style).toContain("font-size: 45px")
        expect(item.lines![0].text[0].style).toContain("vertical-align: 18.75px")
        expect(item.lines![0].text[1].style).toContain("font-size: 75px")
        expect(item.lines![0].text[1].style).toContain("line-height: 1.26em")
        expect(item.lines![0].align).toContain("text-wrap: wrap")
        expect(Number(item.style.match(/left: ([\d.]+)px/)?.[1])).toBeCloseTo(20, 2)
        expect(Number(item.style.match(/width: ([\d.]+)px/)?.[1])).toBeCloseTo(1880, 2)
        expect(JSON.stringify(item)).not.toContain("NaN")
    })

    it("supports integer-encoded superscripts and negative percentage subscripts", () => {
        const paragraph = `<a:p><a:pPr><a:defRPr sz="2400"/></a:pPr><a:r><a:rPr baseline="25000"/><a:t>Up</a:t></a:r><a:r><a:rPr baseline="-25%"/><a:t>Down</a:t></a:r></a:p>`
        const [item] = importItems(shape(paragraph))
        expect(item.lines![0].text[0].style).toContain("vertical-align: 8px")
        expect(item.lines![0].text[1].style).toContain("vertical-align: -8px")
    })
    it("preserves mixed run sizes and local paragraph defaults ahead of master defaults", () => {
        const ph = '<p:ph type="body" idx="1"/>'
        const text = `<a:p><a:pPr><a:defRPr sz="1200"/></a:pPr>${run("Small")}${run("Large", 3000)}</a:p>`
        const [item] = importItems(shape(text, transform(), ph), shape("", transform(), ph), "", '<a:lvl1pPr><a:defRPr sz="3600"/></a:lvl1pPr>')
        expect(item.lines![0].text[0].style).toContain("font-size: 16px")
        expect(item.lines![0].text[1].style).toContain("font-size: 40px")
    })

    it("uses the shape's list-level defaults before inherited defaults", () => {
        const [item] = importItems(shape(`<a:p><a:pPr lvl="1"/>${run("Second level")}</a:p>`, transform(), "", '<a:lvl2pPr><a:defRPr sz="1500"/></a:lvl2pPr>'))
        expect(item.lines![0].text[0].style).toContain("font-size: 20px")
    })

    it("merges local default bold with an inherited size and preserves an explicit run override", () => {
        const ph = '<p:ph type="body" idx="1"/>'
        const [item] = importItems(shape(`<a:p><a:pPr><a:defRPr b="1"/></a:pPr>${run("Inherited")}${run("Override", 1200)}</a:p>`, transform(), ph), shape("", transform(), ph), "", '<a:lvl1pPr><a:defRPr sz="3000"/></a:lvl1pPr>')
        expect(item.lines![0].text[0].style).toContain("font-size: 40px")
        expect(item.lines![0].text[0].style).toContain("font-weight: bold")
        expect(item.lines![0].text[1].style).toContain("font-size: 16px")
    })

    it("inherits list-level margins and allows a paragraph to disable inherited bullets", () => {
        const listStyle = `<a:lvl2pPr marL="${emu(60)}" indent="${emu(-20)}"><a:buChar char="•"/><a:defRPr sz="1800"/></a:lvl2pPr>`
        const [item] = importItems(shape(`<a:p><a:pPr lvl="1"><a:buNone/></a:pPr>${run("Plain")}</a:p>`, transform(), "", listStyle))
        expect(item.lines![0].align).toContain("padding-left: 60px")
        expect(item.lines![0].text).toHaveLength(1)
        expect(item.lines![0].text[0].value).toBe("Plain")
    })

    it("keeps non-bullet paragraph margins and first-line indents", () => {
        const [item] = importItems(shape(`<a:p><a:pPr marL="${emu(40)}" marR="${emu(20)}" indent="${emu(15)}"/>${run("Indented", 1800)}</a:p>`))
        expect(item.lines![0].align).toContain("padding-left: 40px")
        expect(item.lines![0].align).toContain("padding-right: 20px")
        expect(item.lines![0].align).toContain("text-indent: 15px")
    })

    it("keeps a hanging bullet's text and wrapped lines aligned", () => {
        const [item] = importItems(shape(`<a:p><a:pPr marL="${emu(48)}" indent="${emu(-24)}"><a:buChar char="•"/></a:pPr>${run("Bullet", 1800)}</a:p>`))
        expect(item.lines![0].align).toContain("padding-left: 48px")
        expect(item.lines![0].align).toContain("text-indent: -24px")
        expect(item.lines![0].text[0].style).toContain("width: 24px")
    })

    it("maps group child origins and scaling into slide coordinates", () => {
        const group = `<p:grpSp><p:nvGrpSpPr/><p:grpSpPr><a:xfrm><a:off x="${emu(100)}" y="${emu(50)}"/><a:ext cx="${emu(400)}" cy="${emu(200)}"/><a:chOff x="${emu(10)}" y="${emu(20)}"/><a:chExt cx="${emu(200)}" cy="${emu(100)}"/></a:xfrm></p:grpSpPr>${shape(`<a:p>${run("Grouped", 1800)}</a:p>`, transform(30, 40, 80, 30))}</p:grpSp>`
        const [item] = importItems(group)
        expect(item.style).toContain("left: 140px")
        expect(item.style).toContain("top: 90px")
        expect(item.style).toContain("width: 160px")
        expect(item.style).toContain("height: 60px")
        expect(item.lines![0].text[0].style).toContain("font-size: 48px")
    })

    it("keeps explicit zero text box insets instead of replacing them with defaults", () => {
        const [item] = importItems(shape(`<a:p>${run("No padding", 1800)}</a:p>`, transform(), "", "", 'lIns="0" rIns="0" tIns="0" bIns="0"'))
        expect(item.style).toContain("padding: 0px 0px 0px 0px")
        expect(item.style).toContain("box-sizing: border-box")
    })

    it.each(["75000", "75%"])("respects stored PowerPoint autofit scaling (%s) without flattening mixed sizes", (fontScale) => {
        const text = `<p:sp><p:nvSpPr><p:cNvPr id="2"/><p:nvPr/></p:nvSpPr><p:spPr>${transform()}</p:spPr><p:txBody><a:bodyPr><a:normAutofit fontScale="${fontScale}"/></a:bodyPr><a:lstStyle/><a:p>${run("Small", 1200)}${run("Large", 2400)}</a:p></p:txBody></p:sp>`
        const [item] = importItems(text)
        expect(item.lines![0].text[0].style).toContain("font-size: 12px")
        expect(item.lines![0].text[1].style).toContain("font-size: 24px")
    })

    it("inherits missing placeholder extents without discarding a local position", () => {
        const ph = '<p:ph type="body" idx="1"/>'
        const geometry = `<a:xfrm><a:off x="${emu(200)}" y="${emu(100)}"/></a:xfrm>`
        const [item] = importItems(shape(`<a:p>${run("Placeholder", 1800)}</a:p>`, geometry, ph), shape("", transform(30, 40, 600, 300), ph))
        expect(item.style).toContain("left: 200px")
        expect(item.style).toContain("top: 100px")
        expect(item.style).toContain("width: 600px")
        expect(item.style).toContain("height: 300px")
    })

    it("composes nested group positions and font scaling", () => {
        const textShape = shape(`<a:p>${run("Nested", 1800)}</a:p>`, transform(5, 10, 20, 15))
        const inner = `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="${emu(30)}" y="${emu(40)}"/><a:ext cx="${emu(80)}" cy="${emu(40)}"/><a:chOff x="0" y="0"/><a:chExt cx="${emu(40)}" cy="${emu(20)}"/></a:xfrm></p:grpSpPr>${textShape}</p:grpSp>`
        const outer = `<p:grpSp><p:grpSpPr><a:xfrm><a:off x="${emu(100)}" y="${emu(50)}"/><a:ext cx="${emu(400)}" cy="${emu(200)}"/><a:chOff x="${emu(10)}" y="${emu(20)}"/><a:chExt cx="${emu(200)}" cy="${emu(100)}"/></a:xfrm></p:grpSpPr>${inner}</p:grpSp>`
        const [item] = importItems(outer)
        expect(item.style).toContain("left: 160px")
        expect(item.style).toContain("top: 130px")
        expect(item.style).toContain("width: 80px")
        expect(item.style).toContain("height: 60px")
        expect(item.lines![0].text[0].style).toContain("font-size: 96px")
    })
})

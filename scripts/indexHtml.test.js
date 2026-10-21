const { test } = require("node:test")
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs")
const path = require("node:path")
const { setIndexHtmlMode } = require("./indexHtml")

const project = path.resolve(__dirname, "..")
const testRoot = path.join(project, "test-output")
const devEntry = '<script type="module" src="/src/frontend/main.ts"></script>'
const prodEntry = '<script type="module" crossorigin src="./build/bundle.js"></script><link rel="stylesheet" href="./build/bundle.css">'

function fixture(run) {
    mkdirSync(testRoot, { recursive: true })
    const root = mkdtempSync(path.join(testRoot, "index-html-"))
    try {
        for (const dir of ["scripts", "public/assets", "public/build", "build/electron", "node_modules/@discordjs/opus/prebuild", "node_modules/pdfjs-dist/build"]) mkdirSync(path.join(root, dir), { recursive: true })
        for (const file of ["indexHtml.js", "preBuild.js", "postBuild.js"]) copyFileSync(path.join(__dirname, file), path.join(root, "scripts", file))
        writeFileSync(path.join(root, "public/index.html"), `<html><head>${devEntry}</head><body></body></html>`)
        writeFileSync(path.join(root, "public/build/bundle.js"), "console.log('frontend')")
        writeFileSync(path.join(root, "build/electron/index.js"), "console.log('electron')")
        writeFileSync(path.join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), "// worker")
        run(root)
    } finally {
        // Only delete the disposable fixture created inside this project's test-output.
        assert.equal(path.dirname(root), testRoot)
        rmSync(root, { recursive: true, force: true })
    }
}

function runScript(root, script, mode) {
    execFileSync(process.execPath, [path.join(root, "scripts", script)], {
        cwd: root,
        env: { ...process.env, NODE_ENV: mode, NODE_PATH: path.join(project, "node_modules") },
        stdio: "pipe"
    })
}

test("npm start preparation restores the development entry after an installer build", () => {
    fixture((root) => {
        const index = path.join(root, "public/index.html")
        setIndexHtmlMode(true, index)
        runScript(root, "preBuild.js", "development")
        assert.ok(readFileSync(index, "utf8").includes(devEntry))
        assert.ok(!readFileSync(index, "utf8").includes(prodEntry))
    })
})

for (const previousMode of ["development", "production"]) {
    test(`packaging copies a production entry when starting from ${previousMode}`, () => {
        fixture((root) => {
            const index = path.join(root, "public/index.html")
            setIndexHtmlMode(previousMode === "production", index)
            runScript(root, "postBuild.js", "production")
            const packagedHtml = readFileSync(path.join(root, "build/public/index.html"), "utf8")
            assert.ok(packagedHtml.includes(prodEntry))
            assert.ok(!packagedHtml.includes(devEntry))
        })
    })
}

test("switching modes repeatedly does not duplicate frontend entries", () => {
    fixture((root) => {
        const index = path.join(root, "public/index.html")
        for (const production of [true, true, false, false, true, false]) setIndexHtmlMode(production, index)
        assert.equal(readFileSync(index, "utf8").split(devEntry).length - 1, 1)
        assert.ok(!readFileSync(index, "utf8").includes(prodEntry))
    })
})

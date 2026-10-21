const { readFileSync, writeFileSync } = require("fs")
const { join } = require("path")

const devScriptPath = '<script type="module" src="/src/frontend/main.ts"></script>'
const prodHTMLPaths = '<script type="module" crossorigin src="./build/bundle.js"></script><link rel="stylesheet" href="./build/bundle.css">'

function setIndexHtmlMode(production, indexPath = join(__dirname, "..", "public", "index.html")) {
    const html = readFileSync(indexPath, "utf8")
    if (!html.includes(devScriptPath) && !html.includes(prodHTMLPaths)) throw new Error("Cannot find the frontend entry point in index.html")
    const nextHtml = production ? html.replace(devScriptPath, prodHTMLPaths) : html.replace(prodHTMLPaths, devScriptPath)
    if (nextHtml !== html) writeFileSync(indexPath, nextHtml)
}

module.exports = { setIndexHtmlMode }

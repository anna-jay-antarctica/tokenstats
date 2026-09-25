import { copyFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const destination = join(root, ".opencode", "plugins", "tokenstat")
const files = ["index.ts", "tui.tsx", "package.json"]

await mkdir(destination, { recursive: true })
await Promise.all(files.map((file) => copyFile(join(root, file), join(destination, file))))

console.log(`Copied ${files.join(", ")} to ${destination}`)

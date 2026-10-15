import { appendFile } from "node:fs/promises"
import { join } from "node:path"
import { fetchUsage } from "../usage.ts"

const root = process.argv[2]
const tokens = { input: 100, output: 10, reasoning: 2, cache: { read: 50, write: 5 } }
const context = {
  client: {
    server: { info: async () => ({ urls: ["http://server:1234"], paths: { tmp: "/server/tmp" } }) },
    session: {
      list: async () => ({ data: [{ id: "database" }] }),
      stats: async () => {
        await appendFile(join(root, "events.log"), `start ${process.pid}\n`)
        await new Promise((resolve) => setTimeout(resolve, 25))
        await appendFile(join(root, "events.log"), `end ${process.pid}\n`)
        return { sessions: 1, steps: 2, tokens, cost: 0, models: [{ model: { providerID: "openai", id: "test" }, steps: 2, tokens, cost: 0 }] }
      },
    },
  },
}

const result = await fetchUsage(context, "session", "all", 1, () => {}, new AbortController().signal, () => {}, {
  cacheRoot: root, now: Date.UTC(2026, 9, 15, 12, 34, 56),
})
if (result.errors.length) throw new Error(result.errors.join("; "))
console.log(JSON.stringify({ steps: result.steps, completed: result.completedDays }))

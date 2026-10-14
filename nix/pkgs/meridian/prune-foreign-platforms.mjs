import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"

const [root, os, cpu] = process.argv.slice(2)
if (!root || !os || !cpu) throw new Error("usage: prune-foreign-platforms.mjs <node_modules> <os> <cpu>")

function admits(list, value) {
  if (!Array.isArray(list)) return true
  if (list.includes(`!${value}`)) return false
  const allowed = list.filter((entry) => !entry.startsWith("!"))
  return allowed.length === 0 || allowed.includes(value)
}

function packageDirs(modules) {
  return readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .flatMap((entry) =>
      entry.name.startsWith("@")
        ? readdirSync(join(modules, entry.name), { withFileTypes: true })
            .filter((scoped) => scoped.isDirectory())
            .map((scoped) => join(modules, entry.name, scoped.name))
        : [join(modules, entry.name)],
    )
}

function prune(modules) {
  for (const dir of packageDirs(modules)) {
    const manifest = join(dir, "package.json")
    if (existsSync(manifest)) {
      const { cpu: cpus, os: oses } = JSON.parse(readFileSync(manifest, "utf8"))
      if (!admits(oses, os) || !admits(cpus, cpu)) {
        rmSync(dir, { recursive: true })
        console.log(`pruned ${dir}`)
        continue
      }
    }
    const nested = join(dir, "node_modules")
    if (existsSync(nested)) prune(nested)
  }
}

prune(root)

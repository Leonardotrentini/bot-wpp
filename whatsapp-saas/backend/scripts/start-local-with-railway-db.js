/**
 * Sobe o backend local usando DATABASE_PUBLIC_URL do Railway quando disponível.
 */
if (process.env.DATABASE_PUBLIC_URL) {
  process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL
}

const { spawnSync } = require("child_process")

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: true, env: process.env })
  if (r.status) process.exit(r.status || 1)
}

const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL || "").hostname || "(none)"
  } catch {
    return "(invalid)"
  }
})()
console.log("[local] DATABASE host:", host)

run("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"])
run("node", ["src/server.js"])

// @refresh reload

import { render } from "solid-js/web"
import { AppBaseProviders, AppInterface } from "@/app"
import { type Platform, PlatformProvider } from "@/context/platform"
import { dict as en } from "@/i18n/en"
import { dict as zh } from "@/i18n/zh"
import { handleNotificationClick } from "@/utils/notification-click"
import pkg from "../package.json"
import { ServerConnection } from "./context/server"

const DEFAULT_SERVER_URL_KEY = "opencode.settings.dat:defaultServerUrl"

const getLocale = () => {
  if (typeof navigator !== "object") return "en" as const
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  for (const language of languages) {
    if (!language) continue
    if (language.toLowerCase().startsWith("zh")) return "zh" as const
  }
  return "en" as const
}

const getRootNotFoundError = () => {
  const key = "error.dev.rootNotFound" as const
  const locale = getLocale()
  return locale === "zh" ? (zh[key] ?? en[key]) : en[key]
}

const getStorage = (key: string) => {
  if (typeof localStorage === "undefined") return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const setStorage = (key: string, value: string | null) => {
  if (typeof localStorage === "undefined") return
  try {
    if (value !== null) {
      localStorage.setItem(key, value)
      return
    }
    localStorage.removeItem(key)
  } catch {
    return
  }
}

const readDefaultServerUrl = () => getStorage(DEFAULT_SERVER_URL_KEY)
const writeDefaultServerUrl = (url: string | null) => setStorage(DEFAULT_SERVER_URL_KEY, url)

const notify: Platform["notify"] = async (title, description, href) => {
  if (!("Notification" in window)) return

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission().catch(() => "denied")
      : Notification.permission

  if (permission !== "granted") return

  const inView = document.visibilityState === "visible" && document.hasFocus()
  if (inView) return

  const notification = new Notification(title, {
    body: description ?? "",
    icon: "https://opencode.ai/favicon-96x96-v3.png",
  })

  notification.onclick = () => {
    handleNotificationClick(href)
    notification.close()
  }
}

const openLink: Platform["openLink"] = (url) => {
  window.open(url, "_blank")
}

const back: Platform["back"] = () => {
  window.history.back()
}

const forward: Platform["forward"] = () => {
  window.history.forward()
}

const restart: Platform["restart"] = async () => {
  window.location.reload()
}

const root = document.getElementById("root")
if (!(root instanceof HTMLElement) && import.meta.env.DEV) {
  throw new Error(getRootNotFoundError())
}

const getCurrentUrl = () => {
  if (location.hostname.includes("opencode.ai")) return "http://localhost:4096"
  if (import.meta.env.DEV)
    return `http://${import.meta.env.VITE_OPENCODE_SERVER_HOST ?? "localhost"}:${import.meta.env.VITE_OPENCODE_SERVER_PORT ?? "4096"}`
  return location.origin
}

const getDefaultUrl = () => {
  const lsDefault = readDefaultServerUrl()
  if (lsDefault) return lsDefault
  return getCurrentUrl()
}

const MANAGER_URL = import.meta.env.VITE_MANAGER_URL || location.origin

async function fetchManagedServers(): Promise<ServerConnection.Http[]> {
  try {
    const resp = await fetch(`${MANAGER_URL}/api/instances`)
    if (!resp.ok) return []
    const instances = await resp.json() as Array<{ publicIp: string | null; status: string; name: string }>
    return instances
      .filter((i) => i.publicIp && i.status === "healthy")
      .map((i) => ({
        type: "http" as const,
        displayName: i.name,
        http: { url: `http://${i.publicIp}:4096` },
      }))
  } catch {
    return []
  }
}

function startServerSync(addServer: (conn: ServerConnection.Http) => void) {
  const sync = async () => {
    const managed = await fetchManagedServers()
    for (const s of managed) {
      addServer(s)
    }
  }
  sync()
  setInterval(sync, 30_000)
}

const platform: Platform = {
  platform: "web",
  version: pkg.version,
  openLink,
  back,
  forward,
  restart,
  notify,
  getDefaultServer: async () => {
    const stored = readDefaultServerUrl()
    return stored ? ServerConnection.Key.make(stored) : null
  },
  setDefaultServer: writeDefaultServerUrl,
}

if (root instanceof HTMLElement) {
  ;(async () => {
    const managedServers = await fetchManagedServers()
    const allServers: ServerConnection.Http[] = [...managedServers]

    // No servers available — show a launch page instead of crashing
    if (allServers.length === 0 && !readDefaultServerUrl()) {
      const launchServer = async (btn: HTMLButtonElement) => {
        const name = (document.getElementById("server-name") as HTMLInputElement)?.value?.trim() || `dev-${Date.now()}`
        btn.disabled = true
        btn.textContent = "Launching..."
        try {
          const managerUrl = MANAGER_URL
          await fetch(`${managerUrl}/api/instances`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          })
          btn.textContent = "Waiting for server..."
          // Poll until a healthy server appears
          const poll = setInterval(async () => {
            const servers = await fetchManagedServers()
            if (servers.length > 0) {
              clearInterval(poll)
              location.reload()
            }
          }, 10_000)
        } catch (err) {
          btn.disabled = false
          btn.textContent = "Launch server"
          alert("Failed to launch: " + err)
        }
      }

      root.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0a0a0a;color:#e5e5e5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
          <h1 style="font-size:1.5rem;font-weight:600;margin-bottom:1rem;">No servers running</h1>
          <p style="color:#888;margin-bottom:1.5rem;">Launch a server to get started.</p>
          <input id="server-name" type="text" placeholder="Server name (e.g. dev-1)" style="padding:0.5rem 1rem;border-radius:6px;border:1px solid #333;background:#1a1a1a;color:#e5e5e5;font-size:0.875rem;margin-bottom:1rem;width:250px;" />
          <button id="launch-btn" style="padding:0.5rem 1.5rem;border-radius:6px;border:none;background:#2563eb;color:white;font-size:0.875rem;cursor:pointer;">Launch server</button>
        </div>
      `
      document.getElementById("launch-btn")!.addEventListener("click", function () {
        launchServer(this as HTMLButtonElement)
      })
      return
    }

    const defaultUrl = managedServers.length > 0 ? managedServers[0].http.url : getCurrentUrl()

    render(
      () => (
        <PlatformProvider value={platform}>
          <AppBaseProviders>
            <AppInterface
              defaultServer={ServerConnection.Key.make(readDefaultServerUrl() || defaultUrl)}
              servers={allServers}
              disableHealthCheck
            />
          </AppBaseProviders>
        </PlatformProvider>
      ),
      root,
    )

    // Periodically sync managed servers into localStorage
    // Adds new healthy servers, removes servers that no longer exist in the manager
    setInterval(async () => {
      const servers = await fetchManagedServers()
      const key = `opencode.global.dat:server.v3`
      try {
        const stored = JSON.parse(localStorage.getItem(key) || "{}")
        const list: Array<{ type: string; http: { url: string }; displayName?: string }> = stored.list || []
        const managedUrls = new Set(servers.map((s) => s.http.url))

        // Add new servers
        for (const s of servers) {
          if (!list.some((existing) => existing.http?.url === s.http.url)) {
            list.push({ type: "http", http: { url: s.http.url }, displayName: s.displayName })
          }
        }

        // Remove servers with :4096 that are no longer in the manager
        const cleaned = list.filter((entry) => {
          if (!entry.http?.url?.includes(":4096")) return true // keep non-opencode entries
          return managedUrls.has(entry.http.url)
        })

        stored.list = cleaned
        localStorage.setItem(key, JSON.stringify(stored))
      } catch {}
    }, 30_000)
  })()
}

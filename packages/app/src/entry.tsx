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
    const localServer: ServerConnection.Http = { type: "http", http: { url: getCurrentUrl() } }
    const allServers: ServerConnection.Http[] = [...managedServers]
    // Only include local server if it's not already in managed list
    if (!managedServers.some((s) => s.http.url === localServer.http.url)) {
      allServers.push(localServer)
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

    // Periodically sync managed servers into localStorage so the app picks them up
    setInterval(async () => {
      const servers = await fetchManagedServers()
      for (const s of servers) {
        const key = `opencode.global.dat:server.v3`
        try {
          const stored = JSON.parse(localStorage.getItem(key) || "{}")
          const list: Array<{ type: string; http: { url: string }; displayName?: string }> = stored.list || []
          if (!list.some((existing) => existing.http?.url === s.http.url)) {
            list.push({ type: "http", http: { url: s.http.url }, displayName: s.displayName })
            stored.list = list
            localStorage.setItem(key, JSON.stringify(stored))
          }
        } catch {}
      }
    }, 30_000)
  })()
}

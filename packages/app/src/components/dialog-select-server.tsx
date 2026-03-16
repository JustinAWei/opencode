import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { List } from "@opencode-ai/ui/list"
import { TextField } from "@opencode-ai/ui/text-field"
import { showToast } from "@opencode-ai/ui/toast"
import { useNavigate } from "@solidjs/router"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { createStore, reconcile } from "solid-js/store"
import { ServerHealthIndicator, ServerRow } from "@/components/server/server-row"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { normalizeServerUrl, ServerConnection, useServer } from "@/context/server"
import { type ServerHealth, useCheckServerHealth } from "@/utils/server-health"

const DEFAULT_USERNAME = "opencode"

interface ServerFormProps {
  value: string
  name: string
  username: string
  password: string
  placeholder: string
  busy: boolean
  error: string
  status: boolean | undefined
  onChange: (value: string) => void
  onNameChange: (value: string) => void
  onUsernameChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onSubmit: () => void
  onBack: () => void
}

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer() {
  const language = useLanguage()
  const platform = usePlatform()
  const [defaultKey, defaultUrlActions] = createResource(
    async () => {
      try {
        const key = await platform.getDefaultServer?.()
        if (!key) return null
        return key
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const canDefault = createMemo(() => !!platform.getDefaultServer && !!platform.setDefaultServer)
  const setDefault = async (key: ServerConnection.Key | null) => {
    try {
      await platform.setDefaultServer?.(key)
      defaultUrlActions.mutate(key)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaultKey, canDefault, setDefault }
}

function useServerPreview() {
  const checkServerHealth = useCheckServerHealth()

  const looksComplete = (value: string) => {
    const normalized = normalizeServerUrl(value)
    if (!normalized) return false
    const host = normalized.replace(/^https?:\/\//, "").split("/")[0]
    if (!host) return false
    if (host.includes("localhost") || host.startsWith("127.0.0.1")) return true
    return host.includes(".") || host.includes(":")
  }

  const previewStatus = async (
    value: string,
    username: string,
    password: string,
    setStatus: (value: boolean | undefined) => void,
  ) => {
    setStatus(undefined)
    if (!looksComplete(value)) return
    const normalized = normalizeServerUrl(value)
    if (!normalized) return
    const http: ServerConnection.HttpBase = { url: normalized }
    if (username) http.username = username
    if (password) http.password = password
    const result = await checkServerHealth(http)
    setStatus(result.healthy)
  }

  return { previewStatus }
}

function ServerForm(props: ServerFormProps) {
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <div class="px-5">
      <div class="bg-surface-base rounded-md p-5 flex flex-col gap-3">
        <TextField
          type="text"
          label="Server name"
          placeholder="e.g. dev-1, staging, my-project"
          value={props.name}
          autofocus
          validationState={props.error ? "invalid" : "valid"}
          error={props.error}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />
        <Show when={props.busy}>
          <p class="text-text-dimmed-extra text-12-regular">Launching instance... this takes 2-3 minutes.</p>
        </Show>
      </div>
    </div>
  )
}

function EditServerForm(props: ServerFormProps) {
  const language = useLanguage()
  const keyDown = (event: KeyboardEvent) => {
    event.stopPropagation()
    if (event.key === "Escape") {
      event.preventDefault()
      props.onBack()
      return
    }
    if (event.key !== "Enter" || event.isComposing) return
    event.preventDefault()
    props.onSubmit()
  }

  return (
    <div class="px-5">
      <div class="bg-surface-base rounded-md p-5 flex flex-col gap-3">
        <div class="flex-1 min-w-0 [&_[data-slot=input-wrapper]]:relative">
          <TextField
            type="text"
            label={language.t("dialog.server.add.url")}
            placeholder={props.placeholder}
            value={props.value}
            autofocus
            validationState={props.error ? "invalid" : "valid"}
            error={props.error}
            disabled={props.busy}
            onChange={props.onChange}
            onKeyDown={keyDown}
          />
        </div>
        <TextField
          type="text"
          label={language.t("dialog.server.add.name")}
          placeholder={language.t("dialog.server.add.namePlaceholder")}
          value={props.name}
          disabled={props.busy}
          onChange={props.onNameChange}
          onKeyDown={keyDown}
        />
        <div class="grid grid-cols-2 gap-2 min-w-0">
          <TextField
            type="text"
            label={language.t("dialog.server.add.username")}
            placeholder={language.t("dialog.server.add.usernamePlaceholder")}
            value={props.username}
            disabled={props.busy}
            onChange={props.onUsernameChange}
            onKeyDown={keyDown}
          />
          <TextField
            type="password"
            label={language.t("dialog.server.add.password")}
            placeholder={language.t("dialog.server.add.passwordPlaceholder")}
            value={props.password}
            disabled={props.busy}
            onChange={props.onPasswordChange}
            onKeyDown={keyDown}
          />
        </div>
      </div>
    </div>
  )
}

type ManagedInstance = { name: string; status: string; publicIp: string | null; instanceId: string }

function ProvisioningInstances() {
  const [instances, setInstances] = createSignal<ManagedInstance[]>([])

  const fetchInstances = async () => {
    try {
      const managerUrl = (import.meta as any).env?.VITE_MANAGER_URL || location.origin
      const resp = await fetch(`${managerUrl}/api/instances`)
      if (!resp.ok) return
      const all = (await resp.json()) as ManagedInstance[]
      setInstances(all.filter((i) => i.status !== "healthy" && i.status !== "terminated" && i.status !== "stopping"))
    } catch {}
  }

  fetchInstances()
  const interval = setInterval(fetchInstances, 5_000)
  onCleanup(() => clearInterval(interval))

  return (
    <Show when={instances().length > 0}>
      <div class="px-5 pb-2">
        <For each={instances()}>
          {(inst) => (
            <div class="flex items-center gap-3 min-w-0 p-3 opacity-60">
              <div class="size-1.5 rounded-full shrink-0 bg-amber-400" />
              <div class="flex flex-col min-w-0">
                <span class="text-14-regular truncate">{inst.name}</span>
                <span class="text-12-regular text-text-dimmed-extra">{inst.status}...</span>
              </div>
            </div>
          )}
        </For>
      </div>
    </Show>
  )
}

export function DialogSelectServer() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const server = useServer()
  const platform = usePlatform()
  const language = useLanguage()
  const { defaultKey, canDefault, setDefault } = useDefaultServer()
  const { previewStatus } = useServerPreview()
  const checkServerHealth = useCheckServerHealth()
  const [store, setStore] = createStore({
    status: {} as Record<ServerConnection.Key, ServerHealth | undefined>,
    addServer: {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      adding: false,
      error: "",
      showForm: false,
      status: undefined as boolean | undefined,
    },
    editServer: {
      id: undefined as string | undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      busy: false,
      status: undefined as boolean | undefined,
    },
  })

  const resetAdd = () => {
    setStore("addServer", {
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      adding: false,
      error: "",
      showForm: false,
      status: undefined,
    })
  }
  const resetEdit = () => {
    setStore("editServer", {
      id: undefined,
      value: "",
      name: "",
      username: "",
      password: "",
      error: "",
      status: undefined,
      busy: false,
    })
  }

  const replaceServer = (original: ServerConnection.Http, next: ServerConnection.Http) => {
    const active = server.key
    const newConn = server.add(next)
    if (!newConn) return
    const nextActive = active === ServerConnection.key(original) ? ServerConnection.key(newConn) : active
    if (nextActive) server.setActive(nextActive)
    server.remove(ServerConnection.key(original))
  }

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((x) => x !== current)]
  })

  const current = createMemo(() => items().find((x) => ServerConnection.key(x) === server.key) ?? items()[0])

  const sortedItems = createMemo(() => {
    const list = items()
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((url, index) => [url, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff = rank(store.status[ServerConnection.key(a)]) - rank(store.status[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  async function refreshHealth() {
    const results: Record<ServerConnection.Key, ServerHealth> = {}
    await Promise.all(
      items().map(async (conn) => {
        results[ServerConnection.key(conn)] = await checkServerHealth(conn.http)
      }),
    )
    setStore("status", reconcile(results))
  }

  createEffect(() => {
    items()
    refreshHealth()
    const interval = setInterval(refreshHealth, 10_000)
    onCleanup(() => clearInterval(interval))
  })

  async function select(conn: ServerConnection.Any, persist?: boolean) {
    if (!persist && store.status[ServerConnection.key(conn)]?.healthy === false) return
    const wasActive = server.key
    dialog.close()
    if (persist && conn.type === "http") {
      server.add(conn)
    }
    server.setActive(ServerConnection.key(conn))
    // If switching to a different server, reload to clear stale sessions/state
    if (wasActive !== ServerConnection.key(conn)) {
      window.location.href = "/"
      return
    }
    navigate("/")
  }

  const handleAddChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { url: value, error: "" })
    void previewStatus(value, store.addServer.username, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddNameChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { name: value, error: "" })
  }

  const handleAddUsernameChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { username: value, error: "" })
    void previewStatus(store.addServer.url, value, store.addServer.password, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleAddPasswordChange = (value: string) => {
    if (store.addServer.adding) return
    setStore("addServer", { password: value, error: "" })
    void previewStatus(store.addServer.url, store.addServer.username, value, (next) =>
      setStore("addServer", { status: next }),
    )
  }

  const handleEditChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { value, error: "" })
    void previewStatus(value, store.editServer.username, store.editServer.password, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  const handleEditNameChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { name: value, error: "" })
  }

  const handleEditUsernameChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { username: value, error: "" })
    void previewStatus(store.editServer.value, value, store.editServer.password, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  const handleEditPasswordChange = (value: string) => {
    if (store.editServer.busy) return
    setStore("editServer", { password: value, error: "" })
    void previewStatus(store.editServer.value, store.editServer.username, value, (next) =>
      setStore("editServer", { status: next }),
    )
  }

  async function handleAdd(_value: string) {
    if (store.addServer.adding) return
    const name = store.addServer.name.trim()
    if (!name) {
      setStore("addServer", { error: "Server name is required" })
      return
    }

    setStore("addServer", { adding: true, error: "" })

    try {
      const managerUrl = (import.meta as any).env?.VITE_MANAGER_URL || location.origin
      const resp = await fetch(`${managerUrl}/api/instances`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!resp.ok) throw new Error(await resp.text())

      // Close dialog — the periodic sync in entry.tsx will add the server
      // to the list once it becomes healthy (every 30s)
      setStore("addServer", { adding: false })
      resetAdd()
      dialog.close()
    } catch (err) {
      setStore("addServer", { adding: false, error: `Failed to launch: ${err}` })
    }
  }

  async function handleEdit(original: ServerConnection.Any, value: string) {
    if (store.editServer.busy || original.type !== "http") return
    const normalized = normalizeServerUrl(value)
    if (!normalized) {
      resetEdit()
      return
    }

    const name = store.editServer.name.trim() || undefined
    const username = store.editServer.username || undefined
    const password = store.editServer.password || undefined
    const existingName = original.displayName
    if (
      normalized === original.http.url &&
      name === existingName &&
      username === original.http.username &&
      password === original.http.password
    ) {
      resetEdit()
      return
    }

    setStore("editServer", { busy: true, error: "" })

    const conn: ServerConnection.Http = {
      type: "http",
      displayName: name,
      http: { url: normalized, username, password },
    }
    const result = await checkServerHealth(conn.http)
    setStore("editServer", { busy: false })
    if (!result.healthy) {
      setStore("editServer", { error: language.t("dialog.server.add.error") })
      return
    }
    if (normalized === original.http.url) {
      server.add(conn)
    } else {
      replaceServer(original, conn)
    }

    resetEdit()
  }

  const mode = createMemo<"list" | "add" | "edit">(() => {
    if (store.editServer.id) return "edit"
    if (store.addServer.showForm) return "add"
    return "list"
  })

  const editing = createMemo(() => {
    if (!store.editServer.id) return
    return items().find((x) => x.type === "http" && x.http.url === store.editServer.id)
  })

  const resetForm = () => {
    resetAdd()
    resetEdit()
  }

  const startAdd = () => {
    resetEdit()
    setStore("addServer", {
      showForm: true,
      url: "",
      name: "",
      username: DEFAULT_USERNAME,
      password: "",
      error: "",
      status: undefined,
    })
  }

  const startEdit = (conn: ServerConnection.Http) => {
    resetAdd()
    setStore("editServer", {
      id: conn.http.url,
      value: conn.http.url,
      name: conn.displayName ?? "",
      username: conn.http.username ?? "",
      password: conn.http.password ?? "",
      error: "",
      status: store.status[ServerConnection.key(conn)]?.healthy,
      busy: false,
    })
  }

  const submitForm = () => {
    if (mode() === "add") {
      void handleAdd(store.addServer.url)
      return
    }
    const original = editing()
    if (!original) return
    void handleEdit(original, store.editServer.value)
  }

  const isFormMode = createMemo(() => mode() !== "list")
  const isAddMode = createMemo(() => mode() === "add")
  const formBusy = createMemo(() => (isAddMode() ? store.addServer.adding : store.editServer.busy))

  const formTitle = createMemo(() => {
    if (!isFormMode()) return language.t("dialog.server.title")
    return (
      <div class="flex items-center gap-2 -ml-2">
        <IconButton icon="arrow-left" variant="ghost" onClick={resetForm} aria-label={language.t("common.goBack")} />
        <span>{isAddMode() ? language.t("dialog.server.add.title") : language.t("dialog.server.edit.title")}</span>
      </div>
    )
  })

  createEffect(() => {
    if (!store.editServer.id) return
    if (editing()) return
    resetEdit()
  })

  async function handleRemove(url: ServerConnection.Key) {
    server.remove(url)
    if ((await platform.getDefaultServer?.()) === url) {
      platform.setDefaultServer?.(null)
    }
  }

  async function handleTerminate(conn: ServerConnection.Http) {
    const managerUrl = (import.meta as any).env?.VITE_MANAGER_URL || location.origin
    const key = ServerConnection.key(conn)
    try {
      // Find the instance by its public IP
      const ip = conn.http.url.replace(/^https?:\/\//, "").split(":")[0]
      const resp = await fetch(`${managerUrl}/api/instances`)
      if (!resp.ok) throw new Error("Failed to fetch instances")
      const instances = await resp.json() as Array<{ instanceId: string; publicIp: string | null }>
      const match = instances.find((i) => i.publicIp === ip)
      if (match) {
        await fetch(`${managerUrl}/api/instances/${match.instanceId}`, { method: "DELETE" })
      }
      handleRemove(key)
      refreshHealth()
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return (
    <Dialog title={formTitle()}>
      <div class="flex flex-col gap-2">
        <Show
          when={!isFormMode()}
          fallback={
            <Show
              when={isAddMode()}
              fallback={
                <EditServerForm
                  value={store.editServer.value}
                  name={store.editServer.name}
                  username={store.editServer.username}
                  password={store.editServer.password}
                  placeholder={language.t("dialog.server.add.placeholder")}
                  busy={store.editServer.busy}
                  error={store.editServer.error}
                  status={store.editServer.status}
                  onChange={handleEditChange}
                  onNameChange={handleEditNameChange}
                  onUsernameChange={handleEditUsernameChange}
                  onPasswordChange={handleEditPasswordChange}
                  onSubmit={submitForm}
                  onBack={resetForm}
                />
              }
            >
              <ServerForm
                value={store.addServer.url}
                name={store.addServer.name}
                username={store.addServer.username}
                password={store.addServer.password}
                placeholder=""
                busy={store.addServer.adding}
                error={store.addServer.error}
                status={store.addServer.status}
                onChange={handleAddChange}
                onNameChange={handleAddNameChange}
                onUsernameChange={handleAddUsernameChange}
                onPasswordChange={handleAddPasswordChange}
                onSubmit={submitForm}
                onBack={resetForm}
              />
            </Show>
          }
        >
          <List
            search={{
              placeholder: language.t("dialog.server.search.placeholder"),
              autofocus: false,
            }}
            noInitialSelection
            emptyMessage={language.t("dialog.server.empty")}
            items={sortedItems}
            key={(x) => x.http.url}
            onSelect={(x) => {
              if (x) select(x)
            }}
            divider={true}
            class="px-5 [&_[data-slot=list-search-wrapper]]:w-full [&_[data-slot=list-scroll]]h-[300px] [&_[data-slot=list-scroll]]:overflow-y-auto [&_[data-slot=list-items]]:bg-surface-base [&_[data-slot=list-items]]:rounded-md [&_[data-slot=list-item]]:min-h-14 [&_[data-slot=list-item]]:p-3 [&_[data-slot=list-item]]:!bg-transparent"
          >
            {(i) => {
              const key = ServerConnection.key(i)
              return (
                <div class="flex items-center gap-3 min-w-0 flex-1 w-full group/item">
                  <div class="flex flex-col h-full items-start w-5">
                    <ServerHealthIndicator health={store.status[key]} />
                  </div>
                  <ServerRow
                    conn={i}
                    dimmed={store.status[key]?.healthy === false}
                    status={store.status[key]}
                    class="flex items-center gap-3 min-w-0 flex-1"
                    badge={
                      <Show when={defaultKey() === ServerConnection.key(i)}>
                        <span class="text-text-base bg-surface-base text-14-regular px-1.5 rounded-xs">
                          {language.t("dialog.server.status.default")}
                        </span>
                      </Show>
                    }
                    showCredentials
                  />
                  <div class="flex items-center justify-center gap-4 pl-4">
                    <Show when={ServerConnection.key(current()) === key}>
                      <Icon name="check" class="h-6" />
                    </Show>

                    <Show when={i.type === "http"}>
                      <DropdownMenu>
                        <DropdownMenu.Trigger
                          as={IconButton}
                          icon="dot-grid"
                          variant="ghost"
                          class="shrink-0 size-8 hover:bg-surface-base-hover data-[expanded]:bg-surface-base-active"
                          onClick={(e: MouseEvent) => e.stopPropagation()}
                          onPointerDown={(e: PointerEvent) => e.stopPropagation()}
                        />
                        <DropdownMenu.Portal>
                          <DropdownMenu.Content class="mt-1">
                            <DropdownMenu.Item
                              onSelect={() => {
                                if (i.type !== "http") return
                                startEdit(i)
                              }}
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.edit")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <Show when={canDefault() && defaultKey() !== key}>
                              <DropdownMenu.Item onSelect={() => setDefault(key)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.default")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <Show when={canDefault() && defaultKey() === key}>
                              <DropdownMenu.Item onSelect={() => setDefault(null)}>
                                <DropdownMenu.ItemLabel>
                                  {language.t("dialog.server.menu.defaultRemove")}
                                </DropdownMenu.ItemLabel>
                              </DropdownMenu.Item>
                            </Show>
                            <DropdownMenu.Separator />
                            <DropdownMenu.Item
                              onSelect={() => {
                                if (i.type !== "http") return
                                if (!confirm("Terminate this cloud instance? This will destroy the server.")) return
                                handleTerminate(i)
                              }}
                              class="text-text-on-critical-base hover:bg-surface-critical-weak"
                            >
                              <DropdownMenu.ItemLabel>Terminate instance</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                            <DropdownMenu.Item
                              onSelect={() => handleRemove(ServerConnection.key(i))}
                              class="text-text-on-critical-base hover:bg-surface-critical-weak"
                            >
                              <DropdownMenu.ItemLabel>{language.t("dialog.server.menu.delete")}</DropdownMenu.ItemLabel>
                            </DropdownMenu.Item>
                          </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                      </DropdownMenu>
                    </Show>
                  </div>
                </div>
              )
            }}
          </List>
          <ProvisioningInstances />
        </Show>

        <div class="px-5 pb-5">
          <Show
            when={isFormMode()}
            fallback={
              <Button
                variant="secondary"
                icon="plus-small"
                size="large"
                onClick={startAdd}
                class="py-1.5 pl-1.5 pr-3 flex items-center gap-1.5"
              >
                {language.t("dialog.server.add.button")}
              </Button>
            }
          >
            <Button variant="primary" size="large" onClick={submitForm} disabled={formBusy()} class="px-3 py-1.5">
              {formBusy()
                ? (isAddMode() ? "Launching..." : language.t("dialog.server.add.checking"))
                : isAddMode()
                  ? "Launch server"
                  : language.t("common.save")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}

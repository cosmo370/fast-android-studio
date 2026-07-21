import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, Box, Bug, Check, ChevronDown, CircleStop, Clipboard,
  ExternalLink, Filter, FolderOpen, MonitorSmartphone, Play, RefreshCw, RotateCw,
  PanelsTopLeft, Search, Server, Smartphone, TerminalSquare, Trash2, Usb, WifiOff,
  XCircle,
} from "lucide-react";
import type { Bootstrap, ConsoleEvent, DeviceInfo, ProjectInfo, RunStatus, StepStatus } from "./types";

const STEP_META = [
  ["environment", "Environment"], ["dependencies", "Dependencies"], ["target", "Target"],
  ["server", "Dev server"], ["bridge", "ADB bridge"], ["sync", "Project sync"],
  ["build", "Build & install"], ["launch", "Launch"], ["logs", "Log stream"],
] as const;

const demoBootstrap: Bootstrap = {
  environment: {
    sdk: null, adb: null, emulator: null, java: null, node: null,
    tools: ["Node.js", "Android SDK", "ADB", "JDK", "Android Emulator"].map((label, index) => ({
      id: label.toLowerCase().replaceAll(" ", "-"), label, path: null, required: index === 0, status: "missing" as const,
    })),
  }, devices: [], avds: [],
};

type LogItem = ConsoleEvent & { key: number };
type StepState = Record<string, { status: StepStatus; detail?: string }>;

function StatusDot({ status }: { status: StepStatus | RunStatus | "ready" | "missing" }) {
  if (status === "complete" || status === "ready") return <span className="status-dot ok"><Check size={10} /></span>;
  if (status === "failed" || status === "missing") return <span className="status-dot error"><XCircle size={11} /></span>;
  if (status === "running") return <span className="status-dot running" />;
  if (status === "skipped") return <span className="status-dot skipped">-</span>;
  return <span className="status-dot pending" />;
}

function DeviceIcon({ device }: { device: DeviceInfo }) {
  return device.kind === "usb" ? <Smartphone size={14} /> : <MonitorSmartphone size={14} />;
}

export default function App() {
  const api = window.mobileConsole;
  const [bootstrap, setBootstrap] = useState<Bootstrap>(demoBootstrap);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [target, setTarget] = useState("auto");
  const [mode, setMode] = useState<"development" | "production">("development");
  const [runStatus, setRunStatus] = useState<RunStatus>("idle");
  const [runDetail, setRunDetail] = useState("Ready");
  const [steps, setSteps] = useState<StepState>(() => Object.fromEntries(STEP_META.map(([id]) => [id, { status: "pending" }])));
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [webViewLogs, setWebViewLogs] = useState<LogItem[]>([]);
  const [networkLogs, setNetworkLogs] = useState<LogItem[]>([]);
  const [webViewStatus, setWebViewStatus] = useState({ status: "idle", detail: "Waiting for an active debug session" });
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("all");
  const [activeTab, setActiveTab] = useState<"logs" | "problems" | "network" | "console">("logs");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const logKey = useRef(0);
  const logEnd = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    try { setBootstrap(await api.refreshTargets()); } catch { /* surfaced through environment state */ }
  }, [api]);

  useEffect(() => {
    if (!api) return;
    api.bootstrap().then(setBootstrap).catch((error) => {
      setRunStatus("failed");
      setRunDetail(error instanceof Error ? error.message : "Environment check failed");
    });
    const previousProject = window.localStorage.getItem("mobile-console:project");
    if (previousProject) {
      api.inspectProject(previousProject).then((detected) => {
        setProject(detected);
        setRunDetail(`${detected.adapter} project restored`);
      }).catch(() => window.localStorage.removeItem("mobile-console:project"));
    }
    const unsubscribe = api.onEvent((event) => {
      if (event.type === "log") setLogs((current) => [...current.slice(-4999), { ...event, key: logKey.current++ }]);
      if (event.type === "webview-console") {
        setWebViewLogs((current) => [...current.slice(-1999), { ...event, source: "WebView", key: logKey.current++ }]);
      }
      if (event.type === "network") {
        const status = typeof event.status === "number" ? ` ${event.status}` : "";
        const detail = event.text || (event.phase === "failed" ? event.errorText : event.url);
        const source = `${event.method || event.resourceType || "HTTP"}${status}`.trim();
        const eventLevel = event.phase === "failed" || Number(event.status || 0) >= 400 ? "error" : "info";
        setNetworkLogs((current) => [...current.slice(-1999), { ...event, source, text: detail || "Network event", level: eventLevel, key: logKey.current++ }]);
      }
      if (event.type === "webview-status") setWebViewStatus({ status: String(event.status || "idle"), detail: event.detail || "" });
      if (event.type === "step" && event.id) setSteps((current) => ({ ...current, [event.id!]: { status: event.status as StepStatus, detail: event.detail } }));
      if (event.type === "run") {
        setRunStatus(event.status as RunStatus);
        setRunDetail(event.detail || (event.status === "running" ? "Running" : String(event.status || "Ready")));
      }
      if (event.type === "preview" && event.url) setPreviewUrl(event.url);
    });
    const timer = window.setInterval(refresh, 5000);
    return () => { unsubscribe(); window.clearInterval(timer); };
  }, [api, refresh]);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: "nearest" }); }, [logs.length]);

  const chooseProject = async () => {
    if (!api) return;
    const selected = await api.chooseProject();
    if (selected) {
      setProject(selected);
      window.localStorage.setItem("mobile-console:project", selected.root);
      setLogs([]);
      setWebViewLogs([]);
      setNetworkLogs([]);
      setRunStatus("idle");
      setRunDetail(`${selected.adapter} project detected`);
    }
  };

  const start = async () => {
    if (!api || !project) return;
    setBusy(true);
    setPreviewUrl(null);
    try { await api.start({ projectPath: project.root, target, mode, port: project.adapter === "vite" ? 5173 : 3000 }); }
    catch (error) { setRunStatus("failed"); setRunDetail(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const stop = async () => { if (api) { setBusy(true); await api.stop().finally(() => setBusy(false)); } };
  const restart = async () => { if (api) { setBusy(true); await api.restart().finally(() => setBusy(false)); } };

  const problems = useMemo(() => [...logs, ...webViewLogs, ...networkLogs].filter((item) => item.problem || item.level === "error"), [logs, networkLogs, webViewLogs]);
  const displayed = useMemo(() => {
    const source = activeTab === "problems" ? problems : activeTab === "network" ? networkLogs : activeTab === "console" ? webViewLogs : logs;
    return source.filter((item) => (level === "all" || item.level === level) && (!query || `${item.source} ${item.text}`.toLowerCase().includes(query.toLowerCase())));
  }, [activeTab, level, logs, networkLogs, problems, query, webViewLogs]);

  const copyText = async (key: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => current === key ? null : current), 1500);
  };

  const clearActive = () => {
    if (activeTab === "problems") { setLogs([]); setWebViewLogs([]); setNetworkLogs([]); }
    else if (activeTab === "network") setNetworkLogs([]);
    else if (activeTab === "console") setWebViewLogs([]);
    else setLogs([]);
  };

  const readyDevices = bootstrap.devices.filter((device) => device.state === "device");
  const missing = bootstrap.environment.tools.filter((tool) => tool.status === "missing").length;
  const running = runStatus === "running";

  return (
    <div className="app-shell">
      <header className="titlebar">
        <div className="brand"><span className="brand-mark"><PanelsTopLeft size={17} /></span><strong>Fast Android Studio</strong><span className="version">0.1</span></div>
        <div className={`run-indicator ${runStatus}`}><span />{runDetail}</div>
      </header>

      <section className="commandbar">
        <button className="project-picker" onClick={chooseProject} disabled={!api}>
          <FolderOpen size={16} />
          <span><small>PROJECT</small><strong>{project?.name || "Select project"}</strong></span>
          {project && <em>{project.adapter}</em>}
        </button>
        <div className="command-separator" />
        <label className="select-control"><small>TARGET</small><span className="select-value">
          {target === "auto" ? <RefreshCw size={14} /> : target === "preview" ? <Box size={14} /> : <Smartphone size={14} />}
          <select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="auto">Auto</option>
            <option value="preview">Quick Preview</option>
            <option value="usb">USB device</option>
            <option value="emulator">Emulator</option>
            {readyDevices.map((device) => <option key={device.serial} value={device.serial}>{device.model}</option>)}
          </select><ChevronDown size={13} /></span>
        </label>
        <div className="segmented" aria-label="Build mode">
          <button className={mode === "development" ? "active" : ""} onClick={() => setMode("development")}>Development</button>
          <button className={mode === "production" ? "active" : ""} onClick={() => setMode("production")}>Production</button>
        </div>
        <div className="command-actions">
          <button className="primary-button" onClick={start} disabled={!project || busy || running}><Play size={15} fill="currentColor" />Start</button>
          <button className="icon-command" title="Stop" onClick={stop} disabled={!running || busy}><CircleStop size={17} /></button>
          <button className="icon-command" title="Restart without clearing data" onClick={restart} disabled={!running || busy || target === "preview"}><RotateCw size={17} /></button>
        </div>
      </section>

      <main className="workspace">
        <aside className="sidebar">
          <section className="side-section">
            <div className="section-heading"><span>ENVIRONMENT</span><button title="Refresh" onClick={refresh}><RefreshCw size={13} /></button></div>
            <div className="tool-list">
              {bootstrap.environment.tools.map((tool) => <div className="tool-row" key={tool.id} title={tool.path || "Not detected"}>
                <StatusDot status={tool.status} /><span>{tool.label}</span><small>{tool.status}</small>
              </div>)}
            </div>
            {missing > 0 && <div className="diagnostic-action"><AlertCircle size={14} />{missing} missing tools</div>}
          </section>

          <section className="side-section grow">
            <div className="section-heading"><span>DEVICES</span><span className="count">{bootstrap.devices.length}</span></div>
            <div className="device-list">
              {bootstrap.devices.map((device) => <button className="device-row" key={device.serial} onClick={() => setTarget(device.serial)}>
                <DeviceIcon device={device} /><span><strong>{device.model}</strong><small>{device.serial}</small></span>
                <i className={device.state === "device" ? "online" : "offline"} />
              </button>)}
              {bootstrap.devices.length === 0 && <div className="empty-compact"><WifiOff size={17} /><span>No active devices</span></div>}
              {bootstrap.avds.map((avd) => <div className="avd-row" key={avd}><MonitorSmartphone size={14} /><span>{avd}</span><small>AVD</small></div>)}
            </div>
          </section>
          <div className="connection-state"><Usb size={13} /><span>ADB</span><strong>{bootstrap.environment.adb ? "Available" : "Unavailable"}</strong></div>
        </aside>

        <section className="content">
          <div className="pipeline-band">
            <div className="panel-title"><span>RUN PIPELINE</span>{project && <small>{project.root}</small>}</div>
            <div className="pipeline">
              {STEP_META.map(([id, label], index) => <div className={`pipeline-step ${steps[id]?.status || "pending"}`} key={id} title={steps[id]?.detail}>
                <div className="step-index"><StatusDot status={steps[id]?.status || "pending"} /></div>
                <span>{label}</span>{index < STEP_META.length - 1 && <i />}
              </div>)}
            </div>
          </div>

          <div className="console-panel">
            <div className="tabs">
              <button className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}><TerminalSquare size={14} />Logs<span>{logs.length}</span></button>
              <button className={activeTab === "problems" ? "active" : ""} onClick={() => setActiveTab("problems")}><Bug size={14} />Problems{problems.length > 0 && <span className="error-count">{problems.length}</span>}</button>
              <button className={activeTab === "network" ? "active" : ""} onClick={() => setActiveTab("network")}><Server size={14} />Network<span>{networkLogs.length}</span></button>
              <button className={activeTab === "console" ? "active" : ""} onClick={() => setActiveTab("console")}><Box size={14} />WebView<span>{webViewLogs.length}</span></button>
              <div className="tab-actions">
                {previewUrl && <button title="Open preview" onClick={() => api?.openExternal(previewUrl)}><ExternalLink size={14} /></button>}
                <button className={copiedKey === "visible" ? "copied" : ""} title={copiedKey === "visible" ? "Copied" : "Copy visible logs"} onClick={() => copyText("visible", displayed.map((item) => item.text).join("\n"))}>{copiedKey === "visible" ? <Check size={14} /> : <Clipboard size={14} />}</button>
                <button title="Clear current view" onClick={clearActive}><Trash2 size={14} /></button>
              </div>
            </div>

            <div className="log-toolbar">
              <label className="search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search logs" /></label>
              <label className="level-filter"><Filter size={13} /><select value={level} onChange={(event) => setLevel(event.target.value)}><option value="all">All levels</option><option value="error">Errors</option><option value="warn">Warnings</option><option value="info">Info</option></select></label>
              <span className="result-count">{displayed.length} entries</span>
            </div>

            <div className="log-view">
              {displayed.length === 0 ? <div className="empty-state"><TerminalSquare size={22} /><strong>{activeTab === "problems" ? "No problems detected" : activeTab === "network" ? "No network activity" : activeTab === "console" ? "No WebView console output" : "No process output"}</strong><span>{activeTab === "network" || activeTab === "console" ? webViewStatus.detail : project ? "Start a run to stream output" : "Select a project to begin"}</span></div>
              : activeTab === "problems" ? displayed.map((item) => <article className={`problem-card ${item.level || "error"}`} key={item.key}>
                  <header>
                    <AlertCircle size={16} />
                    <div><strong>{item.problem?.title || "Runtime error"}</strong><span>{item.source || "Unknown source"} · {item.at ? new Date(item.at).toLocaleTimeString([], { hour12: false }) : ""}</span></div>
                    <button className={`row-copy ${copiedKey === `problem-${item.key}` ? "copied" : ""}`} title={copiedKey === `problem-${item.key}` ? "Copied" : "Copy full diagnostic"} onClick={() => copyText(`problem-${item.key}`, `${item.problem?.title || "Runtime error"}\n[${item.source || "unknown"}] ${item.text || ""}`)}>{copiedKey === `problem-${item.key}` ? <Check size={13} /> : <Clipboard size={13} />}</button>
                  </header>
                  <pre>{item.text}</pre>
                </article>)
              : displayed.map((item) => <div className={`log-line ${item.level || "info"}`} key={item.key}>
                  <time>{item.at ? new Date(item.at).toLocaleTimeString([], { hour12: false }) : ""}</time>
                  <span className="log-source">{item.source}</span>
                  <pre>{item.text}</pre>
                  {(item.problem || item.level === "error") && <span className="problem-tag">{item.problem?.title || "Error"}</span>}
                </div>)}
              <div ref={logEnd} />
            </div>
          </div>
        </section>
      </main>

      <footer className="statusbar">
        <span><span className={`footer-dot ${api ? "connected" : ""}`} />{api ? "Desktop bridge connected" : "Browser preview"}</span>
        <span>{project ? `${project.packageManager} / ${project.adapter}` : "No project"}</span>
        <span className="status-spacer" />
        <span>{readyDevices.length} ready targets</span>
        <span>Local</span>
      </footer>
    </div>
  );
}

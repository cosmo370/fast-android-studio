export type ToolStatus = "ready" | "missing";
export type RunStatus = "idle" | "running" | "failed" | "stopped";
export type StepStatus = "pending" | "running" | "complete" | "failed" | "skipped";

export interface ToolInfo { id: string; label: string; path: string | null; required: boolean; status: ToolStatus }
export interface EnvironmentInfo { sdk: string | null; adb: string | null; emulator: string | null; java: string | null; node: string | null; tools: ToolInfo[] }
export interface DeviceInfo { serial: string; state: string; model: string; product: string; transportId: string; kind: "usb" | "emulator" }
export interface ProjectInfo {
  root: string;
  name: string;
  adapter: string;
  packageManager: string;
  scripts: string[];
  capabilities: { preview: boolean; android: boolean };
}
export interface Bootstrap { environment: EnvironmentInfo; devices: DeviceInfo[]; avds: string[] }
export interface ConsoleEvent {
  type: "log" | "step" | "run" | "preview" | "process" | "webview-status" | "webview-console" | "network";
  at: string;
  source?: string;
  level?: string;
  text?: string;
  problem?: { id: string; severity: string; title: string } | null;
  id?: string;
  status?: string | number;
  detail?: string;
  url?: string;
  phase?: "request" | "response" | "failed";
  requestId?: string;
  method?: string;
  statusText?: string;
  resourceType?: string;
  errorText?: string;
  responseBody?: string;
  initiator?: string;
  timestamp?: number;
}
export interface RunConfig { projectPath: string; target: string; mode: "development" | "production"; port: number; packageId?: string }
export interface DesktopApi {
  bootstrap(): Promise<Bootstrap>;
  chooseProject(): Promise<ProjectInfo | null>;
  inspectProject(path: string): Promise<ProjectInfo>;
  refreshTargets(): Promise<Bootstrap>;
  start(config: RunConfig): Promise<void>;
  stop(): Promise<void>;
  restart(): Promise<void>;
  openExternal(url: string): Promise<void>;
  onEvent(callback: (event: ConsoleEvent) => void): () => void;
}

declare global { interface Window { mobileConsole?: DesktopApi } }

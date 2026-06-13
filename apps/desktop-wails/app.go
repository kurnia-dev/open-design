package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"
	"time"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App struct instance
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	// Start Next.js and daemon sidecars if they are not running yet
	a.startSidecars()

	// Check screen dimensions. If the primary monitor is smaller than 1280x720,
	// automatically maximize the window to ensure it fits and is fully usable.
	screens, err := wailsRuntime.ScreenGetAll(ctx)
	if err == nil && len(screens) > 0 {
		primaryScreen := screens[0]
		for _, s := range screens {
			if s.IsPrimary {
				primaryScreen = s
				break
			}
		}

		if primaryScreen.Width < 1280 || primaryScreen.Height < 720 {
			wailsRuntime.WindowMaximise(ctx)
		}
	}

	go a.startRedirectionLoop()
}

func (a *App) startSidecars() {
	// 1. Try to discover if already running
	url := a.DiscoverWebURL()
	if url != "" {
		return
	}

	// 2. Try starting using tools-dev in development
	pnpmPath, err := exec.LookPath("pnpm")
	if err == nil {
		cmd := exec.Command(pnpmPath, "tools-dev", "start", "web")

		// Look for workspace root
		cwd, err := os.Getwd()
		if err == nil {
			if strings.HasSuffix(cwd, "desktop-wails") {
				cmd.Dir = "../.."
			} else if _, err := os.Stat("../../package.json"); err == nil {
				cmd.Dir = "../.."
			}
		}

		// Ensure environment path is propagated so pnpm can resolve node
		cmd.Env = os.Environ()

		_ = cmd.Start()

		// Poll for up to 10 seconds to see if web socket becomes ready
		for i := 0; i < 20; i++ {
			time.Sleep(500 * time.Millisecond)
			if a.DiscoverWebURL() != "" {
				return
			}
		}
	}

	// 3. In production, try starting using system node + prebundled sidecars
	nodePath, err := exec.LookPath("node")
	if err == nil {
		exePath, err := os.Executable()
		if err == nil {
			// On macOS packaged bundle, resources are at ../Resources
			resourcesDir := filepath.Join(filepath.Dir(exePath), "../Resources")
			daemonEntry := filepath.Join(resourcesDir, "app/prebundled/daemon/daemon-sidecar.mjs")

			if _, err := os.Stat(daemonEntry); err == nil {
				daemonCmd := exec.Command(nodePath, daemonEntry)
				_ = daemonCmd.Start()
			}
		}
	}
}

func (a *App) startRedirectionLoop() {
	for {
		url := a.DiscoverWebURL()
		if url != "" {
			wailsRuntime.WindowExecJS(a.ctx, fmt.Sprintf("window.location.href = '%s';", url))
			if goRuntime.GOOS == "darwin" {
				go a.injectChromeCSSLoop()
			}
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
}

func (a *App) injectChromeCSSLoop() {
	css := `
  .app-chrome-header {
    --app-chrome-traffic-space: 70px !important;
    --app-chrome-traffic-margin: 8px !important;
    -webkit-app-region: drag;
  }
  .app-chrome-traffic-space {
    flex: 0 0 80px !important;
    width: 80px !important;
  }
  .app-chrome-header button,
  .app-chrome-header a,
  .app-chrome-header [role="button"],
  .app-chrome-header [contenteditable],
  .app-chrome-actions,
  .app-chrome-actions *,
  .avatar-popover,
  .avatar-popover *,
  .inline-switcher__popover,
  .inline-switcher__popover *,
  .workspace-tabs-popover,
  .workspace-tabs-popover * {
    -webkit-app-region: no-drag;
  }
  .app-chrome-drag {
    -webkit-app-region: drag;
  }
`
	js := fmt.Sprintf(`
		if (document.head && !document.getElementById('wails-mac-chrome-css')) {
			var style = document.createElement('style');
			style.id = 'wails-mac-chrome-css';
			style.innerHTML = %s;
			document.head.appendChild(style);
		}
	`, "`"+css+"`")

	for {
		time.Sleep(1 * time.Second)
		wailsRuntime.WindowExecJS(a.ctx, js)
	}
}

// Greet returns a greeting for the given name
func (a *App) Greet(name string) string {
	if name == "" {
		return "Hello, Friend! Welcome to Open Design on Wails."
	}
	return fmt.Sprintf("Hello %s! Welcome to Open Design on Wails.", name)
}

// SystemInfo represents some system metadata
type SystemInfo struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	GoVersion   string `json:"goVersion"`
	NumCPU      int    `json:"numCpu"`
	BackendType string `json:"backendType"`
}

// GetSystemInfo returns basic system statistics to the frontend
func (a *App) GetSystemInfo() SystemInfo {
	return SystemInfo{
		OS:          goRuntime.GOOS,
		Arch:        goRuntime.GOARCH,
		GoVersion:   goRuntime.Version(),
		NumCPU:      goRuntime.NumCPU(),
		BackendType: "Wails (Go Backend)",
	}
}

// DiscoverWebURL attempts to discover the Next.js web URL over the sidecar IPC socket
func (a *App) DiscoverWebURL() string {
	namespace := os.Getenv("OD_NAMESPACE")
	if namespace == "" {
		// Try parsing from command line arguments
		for _, arg := range os.Args {
			if strings.HasPrefix(arg, "--od-stamp-namespace=") {
				namespace = strings.TrimPrefix(arg, "--od-stamp-namespace=")
				break
			}
		}
	}
	if namespace == "" {
		namespace = "default"
	}

	ipcBase := os.Getenv("OD_IPC_BASE")
	if ipcBase == "" {
		ipcBase = "/tmp/open-design/ipc"
	}

	var socketPath string
	if goRuntime.GOOS == "windows" {
		// Windows named pipe resolution matching resolveAppIpcPath
		socketPath = fmt.Sprintf(`\\.\pipe\open-design-%s-web`, namespace)
	} else {
		// Unix socket path resolution matching resolveAppIpcPath
		socketPath = filepath.Join(ipcBase, namespace, "web.sock")
	}

	var conn net.Conn
	var err error

	if goRuntime.GOOS == "windows" {
		// On Windows, named pipes can be dialed with pipe network type
		conn, err = net.DialTimeout("pipe", socketPath, 1*time.Second)
	} else {
		conn, err = net.DialTimeout("unix", socketPath, 1*time.Second)
	}

	if err != nil {
		return ""
	}
	defer conn.Close()

	// Send status query
	req := map[string]string{"type": "status"}
	reqBytes, _ := json.Marshal(req)
	_, err = conn.Write(append(reqBytes, '\n'))
	if err != nil {
		return ""
	}

	// Read response
	decoder := json.NewDecoder(conn)
	var resp struct {
		Ok     bool `json:"ok"`
		Result struct {
			URL string `json:"url"`
		} `json:"result"`
	}

	err = decoder.Decode(&resp)
	if err != nil || !resp.Ok {
		return ""
	}

	return resp.Result.URL
}

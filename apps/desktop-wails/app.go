package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
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

func (a *App) startRedirectionLoop() {
	for {
		url := a.DiscoverWebURL()
		if url != "" {
			wailsRuntime.WindowExecJS(a.ctx, fmt.Sprintf("window.location.href = '%s';", url))
			break
		}
		time.Sleep(500 * time.Millisecond)
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


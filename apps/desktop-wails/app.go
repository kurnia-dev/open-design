package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	goRuntime "runtime"
	"strings"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// App struct
type App struct {
	ctx    context.Context
	app    *application.App
	window *application.WebviewWindow
}

// NewApp creates a new App struct instance
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	log.Println("[Wails] App.startup called!")
	a.ctx = ctx

	// Start Next.js and daemon sidecars if they are not running yet
	log.Println("[Wails] Starting sidecars...")
	a.startSidecars()
	log.Println("[Wails] Sidecars started or discovered.")

	// Check screen dimensions. If the primary monitor is smaller than 1280x720,
	// automatically maximize the window to ensure it fits and is fully usable.
	screens := a.app.Screen.GetAll()
	log.Printf("[Wails] Found %d screens", len(screens))
	if len(screens) > 0 {
		primaryScreen := screens[0]
		for _, s := range screens {
			if s.IsPrimary {
				primaryScreen = s
				break
			}
		}

		if primaryScreen.Size.Width < 1280 || primaryScreen.Size.Height < 720 {
			log.Println("[Wails] Screen too small, maximizing window")
			a.window.Maximise()
		}
	}

	log.Println("[Wails] Starting redirection loop...")
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
	log.Println("[Wails] startRedirectionLoop entered")
	for {
		url := a.DiscoverWebURL()
		if url != "" {
			log.Printf("[Wails] Redirection URL discovered: %s", url)
			log.Println("[Wails] Setting window URL using SetURL...")
			a.window.SetURL(url)
			log.Println("[Wails] SetURL called successfully.")
			break
		}
		log.Println("[Wails] Redirection URL not discovered yet, retrying...")
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
func (a *App) GetSystemInfo() SystemInfo {
	return SystemInfo{
		OS:          goRuntime.GOOS,
		Arch:        goRuntime.GOARCH,
		GoVersion:   goRuntime.Version(),
		NumCPU:      goRuntime.NumCPU(),
		BackendType: "Wails (Go Backend)",
	}
}

type SystemInfo struct {
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	GoVersion   string `json:"goVersion"`
	NumCPU      int    `json:"numCpu"`
	BackendType string `json:"backendType"`
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

	log.Printf("[Wails] DiscoverWebURL: namespace=%s, socketPath=%s", namespace, socketPath)

	if goRuntime.GOOS == "windows" {
		// On Windows, named pipes can be dialed with pipe network type
		conn, err = net.DialTimeout("pipe", socketPath, 1*time.Second)
	} else {
		conn, err = net.DialTimeout("unix", socketPath, 1*time.Second)
	}

	if err != nil {
		log.Printf("[Wails] DiscoverWebURL connection error: %v", err)
		return ""
	}
	defer conn.Close()

	// Send status query
	req := map[string]string{"type": "status"}
	reqBytes, _ := json.Marshal(req)
	_, err = conn.Write(append(reqBytes, '\n'))
	if err != nil {
		log.Printf("[Wails] DiscoverWebURL socket write error: %v", err)
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
	if err != nil {
		log.Printf("[Wails] DiscoverWebURL socket decode error: %v", err)
		return ""
	}
	if !resp.Ok {
		log.Printf("[Wails] DiscoverWebURL socket response not OK: %+v", resp)
		return ""
	}

	log.Printf("[Wails] DiscoverWebURL successfully decoded URL: %s", resp.Result.URL)
	return resp.Result.URL
}

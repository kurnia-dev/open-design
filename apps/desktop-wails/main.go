package main

import (
	"context"
	"embed"
	"io/fs"
	"log"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Get sub-filesystem for frontend assets
	frontendFS, err := fs.Sub(assets, "frontend")
	if err != nil {
		log.Fatal(err)
	}

	// Create Wails v3 application
	appInstance := application.New(application.Options{
		Name:        "Open Design (Wails)",
		Description: "Open Design Desktop Client",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontendFS),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Assign the app instance to our App struct
	app.app = appInstance

	// Create main window
	windowInstance := appInstance.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "Open Design",
		Width:  1280,
		Height: 720,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 34,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHidden,
		},
		BackgroundColour: application.NewRGB(255, 255, 255),
		URL:              "/",
	})

	// Assign the window instance to our App struct
	app.window = windowInstance

	// Register startup event when application has started
	var startupOnce sync.Once
	appInstance.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(event *application.ApplicationEvent) {
		log.Println("[Wails] ApplicationStarted event triggered!")
		startupOnce.Do(func() {
			go app.startup(context.Background())
		})
	})

	// Run the application
	err = appInstance.Run()
	if err != nil {
		log.Fatal(err)
	}
}

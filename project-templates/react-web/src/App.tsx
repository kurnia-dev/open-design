function App() {
  return (
    <main className="page">
      <section>
        <div className="container hero">
          <div className="stack">
            <p className="eyebrow">Open Design x Elegant</p>
            <h1>{'{{projectName}}'}</h1>
            <p className="lead">
              This is a project template, not a finished design.
            </p>
            <div className="actions">
              <a className="btn btn-primary" href="#">
                Ask a design agent to begin
              </a>
            </div>
          </div>
          <article className="panel">
            <div className="panel-head">
              <div>
                <p className="eyebrow">Template scaffold</p>
                <h3>Whats included</h3>
              </div>
              <span className="status">ready</span>
            </div>
            <div className="metric-grid">
              <div className="metric">
                <strong>React 19</strong>
                <span>UI library</span>
              </div>
              <div className="metric">
                <strong>Vite 8</strong>
                <span>Bundler</span>
              </div>
              <div className="metric">
                <strong>TS 6</strong>
                <span>TypeScript</span>
              </div>
            </div>
            <div className="card-row">
              <div className="mini-card">
                <h3>Design tokens</h3>
                <p>Elegant tokens baked in as CSS custom properties and Tailwind v4 theme values.</p>
                <div className="swatches">
                  <span className="swatch swatch-accent" />
                  <span className="swatch swatch-surface" />
                  <span className="swatch swatch-warm" />
                  <span className="swatch swatch-fg" />
                </div>
              </div>
              <div className="mini-card">
                <h3>Ready to design</h3>
                <p>Bring your design agent here to replace this scaffold with your actual interface.</p>
                <div className="field">
                  <label htmlFor="demo-input">Example input</label>
                  <input id="demo-input" defaultValue="Start designing" />
                </div>
              </div>
            </div>
          </article>
        </div>
      </section>
      <section>
        <div className="container tile-grid">
          <article className="tile">
            <p className="eyebrow">Typography</p>
            <h2>Display rhythm</h2>
            <p>Serif display head, sans-serif body, monospace labels — the Elegant type scale is ready.</p>
          </article>
          <article className="tile">
            <p className="eyebrow">Palette</p>
            <h2>Warm neutrals</h2>
            <p>Accent-driven color system with surface, warm, border, and semantic token layers.</p>
          </article>
          <article className="tile">
            <p className="eyebrow">Interaction</p>
            <h2>Motion & states</h2>
            <p>Focus rings, hover lifts, input states — system-defined and ready to use.</p>
          </article>
        </div>
      </section>
    </main>
  );
}

export default App;
